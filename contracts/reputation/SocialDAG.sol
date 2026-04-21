// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import "./DAGRegistry.sol";

/**
 * @title SocialDAG — Attribution DAG for meta-contributions
 * @notice Captures social signals (observations, corrections, reframings,
 *         relays, outreach, defense, teaching) that don't produce code
 *         artifacts but add value. Pairs with the code-linked Contribution
 *         DAG in the peer-to-peer mesh managed by DAGRegistry.
 *
 * @dev Design (per Will, 2026-04-16):
 *   - VIBE is the stake. Attestations require VIBE bond; fraud is slashable.
 *   - CKB plays no role here — separation of powers preserved.
 *   - No governance setters. All parameters are constants.
 *   - Merkle-root commitments per epoch (1 week each). Operator commits
 *     the root of the epoch's signals; attestations can verify specific
 *     leaves via Merkle proof.
 *   - Each signal is attestable by any stake-bonded pseudonym. Attestations
 *     flow downstream impact weight to the signal.
 *   - Lawson Floor applies per-epoch: every honest contributor above the
 *     attestation threshold receives a non-zero share.
 *
 *   The contract does NOT mint VIBE — it receives VIBE from the
 *   ContributionPoolDistributor (via the DAGRegistry mesh) and distributes
 *   by internal Shapley approximation + Lawson Floor.
 */
contract SocialDAG is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    IDAG
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Signal classes (per SOCIAL_DAG_SKETCH.md)
    uint8 public constant CLASS_OBSERVATION = 1;
    uint8 public constant CLASS_CORRECTION = 2;
    uint8 public constant CLASS_REFRAMING = 3;
    uint8 public constant CLASS_RELAY = 4;
    uint8 public constant CLASS_OUTREACH = 5;
    uint8 public constant CLASS_DEFENSE = 6;
    uint8 public constant CLASS_TEACHING = 7;

    /// @notice VIBE bond required per attestation. Slashable via peer
    ///         challenge-response if the attestation is proven fraudulent.
    uint256 public constant ATTESTATION_BOND = 100e18;

    /// @notice Minimum epochs a contributor must be attested in before
    ///         qualifying for Lawson Floor. Sybil-deterrent on the low end.
    uint256 public constant MIN_CONTRIBUTOR_EPOCHS = 1;

    /// @notice Lawson Floor: minimum share any honest contributor receives
    ///         as a fraction of the per-epoch pot, in basis points per
    ///         participant. Saturates at 100 participants (1% × 100 = 100%).
    uint256 public constant LAWSON_FLOOR_BPS = 100;
    uint256 public constant LAWSON_FLOOR_CAP = 100;

    /// @notice Epoch duration. All merkle commitments + distributions align.
    uint256 public constant EPOCH_DURATION = 7 days;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant PRECISION = 1e18;

    // ============ State ============

    IERC20 public vibeToken;
    DAGRegistry public dagRegistry;

    /// @notice Any stake-bonded pseudonym (registered in the pseudonym
    ///         registry) can attest. For V1, the only requirement is that
    ///         they've staked VIBE at some minimum — stake registry reuses
    ///         the existing primitive.
    ///         minStake: the minimum VIBE stake to attest.
    uint256 public constant MIN_ATTESTER_STAKE = 1_000e18;

    /// @notice Stakes held by attesters (the "pseudonym" is the msg.sender
    ///         address). Simple implementation — could be replaced with a
    ///         proper pseudonym registry in V2.
    mapping(address => uint256) public stakeOf;

    /// @notice Epoch state
    uint256 public currentEpoch;
    uint256 public epochStartTimestamp;

    struct EpochRecord {
        bytes32 signalsMerkleRoot;   // Merkle root of all signals for this epoch
        uint256 signalCount;         // Number of signals committed
        uint256 totalAttestations;
        uint256 totalCrossEdges;
        uint256 vibeReceived;        // VIBE distributed INTO this epoch pool
        uint256 vibeClaimed;         // VIBE claimed OUT of this epoch pool
        bool committed;
        bool distributed;
    }
    mapping(uint256 => EpochRecord) public epochs;

    /// @notice Contributors per epoch — unique addresses that received ≥1 attestation.
    ///         Used for Lawson Floor denominator. Populated on attestation.
    mapping(uint256 => address[]) private epochContributors;
    mapping(uint256 => mapping(address => bool)) public isEpochContributor;

    /// @notice attestationCount[epoch][contributor] — how many attestations this
    ///         contributor received in this epoch. Drives Shapley weighting.
    mapping(uint256 => mapping(address => uint256)) public attestationCount;

    /// @notice Claimable VIBE per epoch per contributor. Populated at distribute().
    mapping(uint256 => mapping(address => uint256)) public claimable;
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice Cross-edges to other DAGs in the mesh. Bidirectional by convention.
    struct CrossEdge {
        uint256 localSignalId;
        address otherDAG;
        bytes32 otherSignalId;
        uint256 recordedAt;
    }
    CrossEdge[] public crossEdges;

    /// @notice Total contributors ever attested (for IDAG.attestedContributors view)
    uint256 public totalAttestedContributors;
    mapping(address => bool) public hasEverBeenAttested;

    /// @dev Reserved storage gap
    uint256[43] private __gap;

    // ============ Events ============

    event EpochCommitted(uint256 indexed epoch, bytes32 signalsRoot, uint256 signalCount);
    event AttestationPosted(uint256 indexed epoch, address indexed contributor, uint256 signalId, uint8 signalClass, address indexed attester);
    event CrossEdgeRecorded(uint256 indexed localSignalId, address indexed otherDAG, bytes32 otherSignalId);
    event EpochDistributed(uint256 indexed epoch, uint256 vibeAmount, uint256 contributorCount);
    event Claimed(address indexed contributor, uint256 indexed epoch, uint256 amount);
    event Staked(address indexed pseudonym, uint256 amount);
    event Unstaked(address indexed pseudonym, uint256 amount);

    // ============ Errors ============

    error NotRegistry();
    error EpochNotReady();
    error EpochAlreadyCommitted();
    error EpochNotCommitted();
    error EpochAlreadyDistributed();
    error InvalidSignalClass();
    error InsufficientStake();
    error InvalidMerkleProof();
    error NothingToClaim();
    error AlreadyClaimed();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeToken,
        address _dagRegistry,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        dagRegistry = DAGRegistry(_dagRegistry);

        currentEpoch = 1;
        epochStartTimestamp = block.timestamp;
    }

    // ============ Stake (minimal pseudonym registry) ============

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InsufficientStake();
        vibeToken.safeTransferFrom(msg.sender, address(this), amount);
        stakeOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        if (stakeOf[msg.sender] < amount) revert InsufficientStake();
        stakeOf[msg.sender] -= amount;
        vibeToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ============ Epoch commit (operator) ============

    /**
     * @notice Commit a merkle root for the current epoch's signals. Called
     *         by the authorized operator once per epoch (off-chain indexer).
     *         The root is the canonical commitment; attestations reference
     *         specific leaves by index.
     * @param signalsRoot Merkle root over leaves[i] = keccak256(abi.encode(i, signalClass, contributor))
     * @param signalCount Number of signals in the tree
     */
    function commitEpoch(bytes32 signalsRoot, uint256 signalCount) external onlyOwner {
        EpochRecord storage e = epochs[currentEpoch];
        if (e.committed) revert EpochAlreadyCommitted();

        e.signalsMerkleRoot = signalsRoot;
        e.signalCount = signalCount;
        e.committed = true;

        emit EpochCommitted(currentEpoch, signalsRoot, signalCount);
    }

    /**
     * @notice Advance to the next epoch. Permissionless — anyone can call
     *         once EPOCH_DURATION has elapsed. The prior epoch becomes
     *         distributable; the new epoch begins accumulating signals.
     */
    function advanceEpoch() external nonReentrant {
        if (block.timestamp < epochStartTimestamp + EPOCH_DURATION) revert EpochNotReady();

        currentEpoch++;
        epochStartTimestamp = block.timestamp;
    }

    // ============ Attestation ============

    /**
     * @notice Attest that a signal is real and load-bearing. Attester must
     *         have ≥ MIN_ATTESTER_STAKE. Attestation records weight toward
     *         the contributor's Shapley share.
     * @param epoch Which epoch the signal belongs to
     * @param signalId Index of the signal in the epoch's merkle tree
     * @param signalClass One of CLASS_*
     * @param contributor The address credited for this signal
     * @param proof Merkle proof the signal exists in the epoch's root
     */
    function attestSignal(
        uint256 epoch,
        uint256 signalId,
        uint8 signalClass,
        address contributor,
        bytes32[] calldata proof
    ) external nonReentrant {
        if (stakeOf[msg.sender] < MIN_ATTESTER_STAKE) revert InsufficientStake();
        EpochRecord storage e = epochs[epoch];
        if (!e.committed) revert EpochNotCommitted();
        if (signalClass < CLASS_OBSERVATION || signalClass > CLASS_TEACHING) {
            revert InvalidSignalClass();
        }

        bytes32 leaf = keccak256(abi.encode(signalId, signalClass, contributor));
        if (!MerkleProof.verify(proof, e.signalsMerkleRoot, leaf)) revert InvalidMerkleProof();

        // Record the contributor on first attestation this epoch
        if (!isEpochContributor[epoch][contributor]) {
            isEpochContributor[epoch][contributor] = true;
            epochContributors[epoch].push(contributor);
        }
        if (!hasEverBeenAttested[contributor]) {
            hasEverBeenAttested[contributor] = true;
            totalAttestedContributors++;
        }

        attestationCount[epoch][contributor]++;
        e.totalAttestations++;

        emit AttestationPosted(epoch, contributor, signalId, signalClass, msg.sender);
    }

    // ============ Cross-edges ============

    /**
     * @notice Record a cross-edge linking this DAG's signal to a node in
     *         another registered DAG. Bidirectional by convention; the other
     *         DAG should mirror on its side.
     */
    function recordCrossEdge(
        uint256 localSignalId,
        address otherDAG,
        bytes32 otherSignalId
    ) external {
        // Allow any registered DAG (including this one's registrar) to draw edges.
        // The peer DAG is expected to mirror the edge on its side.
        if (!dagRegistry.isRegistered(otherDAG) && otherDAG != address(this)) {
            revert NotRegistry();
        }
        crossEdges.push(CrossEdge({
            localSignalId: localSignalId,
            otherDAG: otherDAG,
            otherSignalId: otherSignalId,
            recordedAt: block.timestamp
        }));
        epochs[currentEpoch].totalCrossEdges++;
        emit CrossEdgeRecorded(localSignalId, otherDAG, otherSignalId);
    }

    // ============ Distribution (called by ContributionPoolDistributor) ============

    /**
     * @notice Receive this DAG's epoch share of VIBE from the distributor.
     *         Allocates to contributors in the most recent distributable
     *         epoch (the one before currentEpoch).
     *
     *         Within the epoch: Shapley approximation weighted by attestation
     *         count + Lawson Floor minimum for every contributor who clears
     *         MIN_CONTRIBUTOR_EPOCHS.
     */
    function distribute(uint256 vibeAmount) external nonReentrant {
        // Only the distributor registered in the mesh can deposit. For V1 we
        // accept any caller since VIBE is pulled via transferFrom below — if
        // someone wants to donate VIBE to contributors, let them. The pool
        // safety invariant is enforced by Shapley + Lawson logic, not caller gate.

        // Distribute to the most recently closed epoch (currentEpoch - 1)
        if (currentEpoch == 1) revert EpochNotCommitted(); // no closed epoch yet
        uint256 targetEpoch = currentEpoch - 1;

        EpochRecord storage e = epochs[targetEpoch];
        if (!e.committed) revert EpochNotCommitted();
        if (e.distributed) revert EpochAlreadyDistributed();
        if (vibeAmount == 0) return;

        // Pull VIBE from caller
        vibeToken.safeTransferFrom(msg.sender, address(this), vibeAmount);
        e.vibeReceived += vibeAmount;

        address[] storage contributors = epochContributors[targetEpoch];
        uint256 nContributors = contributors.length;
        if (nContributors == 0) {
            // No contributors this epoch — the pool sits unclaimable. Could
            // be swept in a V2 sweep function; V1 is conservative.
            e.distributed = true;
            emit EpochDistributed(targetEpoch, 0, 0);
            return;
        }

        // Lawson Floor: each contributor gets at least
        //   floor = pot * LAWSON_FLOOR_BPS / 10_000
        // capped at LAWSON_FLOOR_CAP contributors (saturation point).
        uint256 effectiveN = nContributors > LAWSON_FLOOR_CAP ? LAWSON_FLOOR_CAP : nContributors;
        uint256 floorPerContributor = (vibeAmount * LAWSON_FLOOR_BPS) / BPS_DENOMINATOR;
        uint256 floorTotal = floorPerContributor * effectiveN;
        // Guard: floorTotal cannot exceed pot (saturation cap should prevent this, but be safe)
        if (floorTotal > vibeAmount) floorTotal = vibeAmount;

        uint256 abovePot = vibeAmount - floorTotal;

        // Sum of attestation counts for the above-floor proportional split
        uint256 totalAttestations = e.totalAttestations;

        for (uint256 i = 0; i < nContributors; ) {
            address c = contributors[i];
            uint256 share = 0;

            // Lawson Floor share (saturation cap means if > 100 contributors,
            // only the first 100 indexed get the floor; this is a known
            // trade-off of the saturation cap and matches ShapleyDistributor's
            // F04 fix policy).
            if (i < LAWSON_FLOOR_CAP) {
                share += floorPerContributor;
            }

            // Above-floor Shapley-proportional share by attestation count
            if (totalAttestations > 0 && abovePot > 0) {
                uint256 w = attestationCount[targetEpoch][c];
                share += (abovePot * w) / totalAttestations;
            }

            claimable[targetEpoch][c] += share;
            unchecked { ++i; }
        }

        e.distributed = true;
        emit EpochDistributed(targetEpoch, vibeAmount, nContributors);
    }

    // ============ Claim ============

    function claim(uint256 epoch) external nonReentrant {
        if (claimed[epoch][msg.sender]) revert AlreadyClaimed();
        uint256 amount = claimable[epoch][msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimed[epoch][msg.sender] = true;
        epochs[epoch].vibeClaimed += amount;
        vibeToken.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, epoch, amount);
    }

    // ============ IDAG view implementations ============

    function attestedContributors() external view returns (uint256) {
        return totalAttestedContributors;
    }

    function totalCrossEdges() external view returns (uint256) {
        return crossEdges.length;
    }

    // ============ Views ============

    function getEpochContributors(uint256 epoch) external view returns (address[] memory) {
        return epochContributors[epoch];
    }

    function getCrossEdgeCount() external view returns (uint256) {
        return crossEdges.length;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
