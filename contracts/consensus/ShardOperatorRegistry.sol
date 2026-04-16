// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice C11-AUDIT-14: minimal view over StateRentVault for cell-existence
///         checks during challenge-response. The vault's Cell struct contains
///         an `active` field; we reproduce the layout here (view-only) to
///         avoid a circular import.
interface IStateRentVaultForRegistry {
    struct Cell {
        address owner;
        uint256 capacity;
        bytes32 contentHash;
        uint256 createdAt;
        bool active;
    }
    function getCell(bytes32 cellId) external view returns (Cell memory);
}

/**
 * @title ShardOperatorRegistry — CKA Shard Node Management
 * @notice Registers shard nodes, tracks cells served, distributes secondary issuance.
 *
 * @dev Shard nodes are CKA protocol nodes that:
 *   - Store and serve CKA cells to clients
 *   - Participate in BFT consensus (if authority type)
 *   - Stake CKB-native as collateral
 *   - Earn secondary issuance proportional to (cells_served × uptime × stake)
 *
 *   The shard network IS the protocol. Each TG bot instance running Jarvis
 *   is a shard node storing cells, serving queries, participating in consensus.
 *
 *   Uses Masterchef-style accRewardPerShare for O(1) reward distribution.
 */
contract ShardOperatorRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant HEARTBEAT_INTERVAL = 24 hours;
    uint256 public constant HEARTBEAT_GRACE = 48 hours;
    uint256 public constant MIN_STAKE = 100e18;
    uint256 public constant MAX_CELLS_SERVED = 1e12; // NCI-011: Cap to prevent overflow in weight calc
    uint256 private constant ACC_PRECISION = 1e18;

    // ============ C10-AUDIT-3: Challenge-Response Constants ============

    /// @notice Delay before a committed cellsReport finalizes into weight.
    uint256 public constant CHALLENGE_WINDOW = 1 hours;

    /// @notice Operator's window to respond after being challenged.
    uint256 public constant CHALLENGE_RESPONSE_WINDOW = 30 minutes;

    /// @notice Bond a challenger escrows. Forfeited on losing challenge.
    uint256 public constant CHALLENGE_BOND = 10e18;

    /// @notice Slash fraction of operator stake on successful challenge (basis points).
    uint256 public constant CHALLENGE_SLASH_BPS = 1000; // 10%

    // ============ State ============

    IERC20 public ckbToken;

    struct Shard {
        address operator;
        bytes32 shardId;
        uint256 stake;
        uint256 cellsServed;
        uint256 lastHeartbeat;
        uint256 registeredAt;
        uint256 rewardDebt;
        bool active;
    }

    mapping(bytes32 => Shard) public shards;
    mapping(address => bytes32) public operatorShard;
    bytes32[] public shardList;
    uint256 public activeShardCount;

    /// @notice Total stake across all active shards
    uint256 public totalStaked;

    /// @notice Total cells served across all active shards
    uint256 public totalCellsServed;

    /// @notice Accumulated reward per weighted share
    uint256 public accRewardPerShare;

    /// @notice Total weight (sum of each shard's cells × stake product)
    uint256 public totalWeight;

    /// @notice NCI-012: Authorized issuance controller (only caller for distributeRewards)
    address public issuanceController;

    // ============ C10-AUDIT-3: Challenge-Response State ============

    /// @notice A pending cellsServed report awaiting finalization or challenge.
    /// @dev Operator commits (count, merkleRoot). During CHALLENGE_WINDOW,
    ///      any caller may challenge by specifying a cellIndex and posting bond.
    ///      Operator must respond with a Merkle proof of the cell at that index.
    struct PendingReport {
        uint256 count;              // Claimed cellsServed
        bytes32 merkleRoot;         // Root of Merkle tree over leaves = keccak256(abi.encode(i, cellId))
        uint256 commitAt;
        uint256 finalizeAt;         // commitAt + CHALLENGE_WINDOW
        // Challenge state — zero if no active challenge
        address challenger;
        uint256 challengeIndex;
        uint256 challengerBond;
        uint256 challengeDeadline;  // challenger's commit time + CHALLENGE_RESPONSE_WINDOW
        bool resolved;              // true once finalized, refuted, or slashed
    }

    /// @notice Active pending report per shard (at most one in-flight).
    mapping(bytes32 => PendingReport) public pendingReports;

    /// @notice C11-AUDIT-14: canonical source of truth for cell existence.
    ///         When non-zero, respondToChallenge requires the refuted cellId to
    ///         be an active cell in this vault. Closes the "commit to any
    ///         preimage" gap from C10-AUDIT-3: operators can no longer refute
    ///         with fabricated cellIds that don't correspond to real cells.
    ///         Must be set post-upgrade via setStateRentVault; refutes revert
    ///         with VaultNotSet until then (upgrade-path security enforced).
    IStateRentVaultForRegistry public stateRentVault;

    /// @dev Reserved storage gap (reduced 48 → 47 for stateRentVault slot).
    uint256[47] private __gap;

    // ============ Events ============

    event ShardRegistered(bytes32 indexed shardId, address indexed operator, uint256 stake);
    event ShardDeactivated(bytes32 indexed shardId, string reason);
    event CellsReported(bytes32 indexed shardId, uint256 cellCount);
    event HeartbeatReceived(bytes32 indexed shardId, uint256 timestamp);
    event RewardClaimed(address indexed operator, uint256 amount);
    event RewardsDistributed(uint256 amount, uint256 newAccRewardPerShare);
    /// @notice C10-AUDIT-2: emitted when anyone kicks a stale (non-heartbeating) shard
    event StaleShardReaped(bytes32 indexed shardId, address indexed reaper, uint256 stakeReturned);
    // C10-AUDIT-3: challenge-response events
    event CellsReportCommitted(bytes32 indexed shardId, uint256 count, bytes32 merkleRoot, uint256 finalizeAt);
    event CellsReportFinalized(bytes32 indexed shardId, uint256 count);
    event ChallengeRaised(bytes32 indexed shardId, address indexed challenger, uint256 cellIndex, uint256 deadline);
    event ChallengeRefuted(bytes32 indexed shardId, address indexed challenger, uint256 cellIndex);
    event ChallengeSucceeded(bytes32 indexed shardId, address indexed challenger, uint256 operatorSlashed);

    // ============ Errors ============

    error AlreadyRegistered();
    error ShardIdTaken();
    error NotRegistered();
    error InsufficientStake();
    error NotActive();
    error ZeroAmount();
    error CellsExceedCap();
    error ShardStale();
    error ShardNotStale();
    // C10-AUDIT-3
    error PendingReportActive();
    error NoPendingReport();
    error ReportNotMature();
    error ChallengeActive();
    error ChallengeExpired();
    error ChallengeNotExpired();
    error InvalidMerkleProof();
    error InvalidChallengeIndex();
    // C11-AUDIT-8/9: challenge collusion hardening
    error SelfChallenge();
    error NotOperator();
    // C11-AUDIT-14: cell-existence cross-ref
    error VaultNotSet();
    error InactiveCell();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _ckbToken, address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        ckbToken = IERC20(_ckbToken);
    }

    // ============ Registration ============

    /**
     * @notice Register a shard node with CKB-native stake
     */
    function registerShard(bytes32 shardId, uint256 stakeAmount) external nonReentrant {
        if (operatorShard[msg.sender] != bytes32(0)) revert AlreadyRegistered();
        // NCI-005: Prevent shardId collision — don't overwrite existing operator's shard
        if (shards[shardId].operator != address(0)) revert ShardIdTaken();
        if (stakeAmount < MIN_STAKE) revert InsufficientStake();

        ckbToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        shards[shardId] = Shard({
            operator: msg.sender,
            shardId: shardId,
            stake: stakeAmount,
            cellsServed: 0,
            lastHeartbeat: block.timestamp,
            registeredAt: block.timestamp,
            rewardDebt: 0,
            active: true
        });

        operatorShard[msg.sender] = shardId;
        shardList.push(shardId);
        activeShardCount++;
        totalStaked += stakeAmount;

        emit ShardRegistered(shardId, msg.sender, stakeAmount);
    }

    // ============ Operations ============

    /**
     * @notice C10-AUDIT-3: Commit a cellsServed report. Goes into a pending state
     *         for CHALLENGE_WINDOW before becoming effective. Any caller can
     *         challenge by specifying a cellIndex; the operator must respond
     *         with a Merkle proof that the indexed cell is actually served.
     * @param count Claimed cellsServed (<= MAX_CELLS_SERVED)
     * @param merkleRoot Root of Merkle tree where leaf[i] = keccak256(abi.encode(i, cellId[i]))
     * @dev NCI-011: capped. C10-AUDIT-2: reverts if stale. C10-AUDIT-9: nonReentrant.
     *      Only one in-flight pending report per shard at a time (must finalize/be-slashed
     *      before committing again). Weight doesn't update until finalization.
     */
    function commitCellsReport(uint256 count, bytes32 merkleRoot) external nonReentrant {
        if (count > MAX_CELLS_SERVED) revert CellsExceedCap();

        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();
        if (_isStale(shard)) revert ShardStale();

        PendingReport storage p = pendingReports[shardId];
        // Reject if a prior report is in flight. Operator must call finalizeCellsReport()
        // (after challenge window) or claimChallengeSlash() (if they lost a challenge)
        // to clear the slot before committing a new one.
        if (p.commitAt != 0 && !p.resolved) revert PendingReportActive();

        pendingReports[shardId] = PendingReport({
            count: count,
            merkleRoot: merkleRoot,
            commitAt: block.timestamp,
            finalizeAt: block.timestamp + CHALLENGE_WINDOW,
            challenger: address(0),
            challengeIndex: 0,
            challengerBond: 0,
            challengeDeadline: 0,
            resolved: false
        });

        emit CellsReportCommitted(shardId, count, merkleRoot, block.timestamp + CHALLENGE_WINDOW);
    }

    /**
     * @notice Finalize a committed cellsServed report after the challenge window
     *         expires without a successful challenge. Updates shard weight.
     * @dev Permissionless — anyone can call. Claims rewards at OLD weight first
     *      (NCI-037 Masterchef invariant) before updating.
     */
    function finalizeCellsReport(bytes32 shardId) external nonReentrant {
        PendingReport storage p = pendingReports[shardId];
        if (p.commitAt == 0 || p.resolved) revert NoPendingReport();
        if (block.timestamp < p.finalizeAt) revert ReportNotMature();
        if (p.challenger != address(0)) revert ChallengeActive();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();
        if (_isStale(shard)) revert ShardStale();

        // NCI-037: claim pending rewards at OLD weight before changing
        _claimRewards(shardId);

        uint256 oldWeight = _shardWeight(shard);
        uint256 oldCells = shard.cellsServed;
        shard.cellsServed = p.count;
        uint256 newWeight = _shardWeight(shard);

        if (oldWeight > 0) totalWeight -= oldWeight;
        totalWeight += newWeight;

        totalCellsServed = totalCellsServed - oldCells + p.count;

        p.resolved = true;

        emit CellsReportFinalized(shardId, p.count);
        emit CellsReported(shardId, p.count); // legacy event preserved
    }

    /**
     * @notice Challenge a pending cellsReport. Post CHALLENGE_BOND in CKB; name a
     *         cellIndex you believe the operator cannot prove membership of in
     *         the committed Merkle root.
     * @dev Only one challenge per pending report. cellIndex must be < pending.count.
     *      The challenger must have approved this contract for CHALLENGE_BOND.
     *      Operator has CHALLENGE_RESPONSE_WINDOW from the challenge tx to respond.
     */
    function challengeCellsReport(bytes32 shardId, uint256 cellIndex) external nonReentrant {
        PendingReport storage p = pendingReports[shardId];
        if (p.commitAt == 0 || p.resolved) revert NoPendingReport();
        if (block.timestamp >= p.finalizeAt) revert ReportNotMature(); // too late to challenge
        if (p.challenger != address(0)) revert ChallengeActive();
        if (cellIndex >= p.count) revert InvalidChallengeIndex();
        // C11-AUDIT-8: prevent operator from sybil-challenging their own commit
        // to lock out the single challenger slot, self-refuting to recycle the
        // bond, and effectively disabling real adversarial pressure.
        if (msg.sender == shards[shardId].operator) revert SelfChallenge();

        ckbToken.safeTransferFrom(msg.sender, address(this), CHALLENGE_BOND);

        p.challenger = msg.sender;
        p.challengeIndex = cellIndex;
        p.challengerBond = CHALLENGE_BOND;
        p.challengeDeadline = block.timestamp + CHALLENGE_RESPONSE_WINDOW;

        emit ChallengeRaised(shardId, msg.sender, cellIndex, p.challengeDeadline);
    }

    /**
     * @notice Operator refutes an active challenge by providing a Merkle proof
     *         that the challenged cellIndex maps to a valid cellId in the committed root.
     * @param cellId The cellId at the challenged index (operator's data).
     * @param proof  Merkle proof of membership in pendingReport.merkleRoot.
     *               Leaf is keccak256(abi.encode(challengeIndex, cellId)).
     * @dev Successful refutation: challenger's bond is transferred to the operator.
     *      The report remains pending and can still be finalized after CHALLENGE_WINDOW.
     *      C11-AUDIT-9: restricted to the operator. Previously any address could
     *      refute, which combined with C11-AUDIT-8 let colluding pairs simulate
     *      challenge activity to lock out honest challengers.
     */
    function respondToChallenge(
        bytes32 shardId,
        bytes32 cellId,
        bytes32[] calldata proof
    ) external nonReentrant {
        PendingReport storage p = pendingReports[shardId];
        if (p.commitAt == 0 || p.resolved) revert NoPendingReport();
        if (p.challenger == address(0)) revert NoPendingReport();
        if (block.timestamp > p.challengeDeadline) revert ChallengeExpired();
        // C11-AUDIT-9: only the shard operator may refute. Prevents an accomplice
        // with out-of-band access to the cellId data from rescuing fraudulent
        // reports on the operator's behalf.
        if (msg.sender != shards[shardId].operator) revert NotOperator();

        bytes32 leaf = keccak256(abi.encode(p.challengeIndex, cellId));
        if (!MerkleProof.verify(proof, p.merkleRoot, leaf)) revert InvalidMerkleProof();

        // C11-AUDIT-14: prove the cellId is a REAL active cell, not just a
        // hash the operator committed to. Closes "commit to any preimage"
        // gap from C10-AUDIT-3. Requires post-upgrade setStateRentVault().
        if (address(stateRentVault) == address(0)) revert VaultNotSet();
        if (!stateRentVault.getCell(cellId).active) revert InactiveCell();

        // Challenger loses bond to the operator
        uint256 bond = p.challengerBond;
        address challenger = p.challenger;
        uint256 cIdx = p.challengeIndex;

        // Clear challenge state (report remains pending, finalizer can still run)
        p.challenger = address(0);
        p.challengeIndex = 0;
        p.challengerBond = 0;
        p.challengeDeadline = 0;

        address operator_ = shards[shardId].operator;
        ckbToken.safeTransfer(operator_, bond);

        emit ChallengeRefuted(shardId, challenger, cIdx);
    }

    /**
     * @notice Called after CHALLENGE_RESPONSE_WINDOW elapses with no valid refutation.
     *         Slashes CHALLENGE_SLASH_BPS of operator stake. Slashed amount plus the
     *         challenger's bond are transferred to the challenger. Pending report is
     *         discarded; cellsServed stays at its prior value.
     * @dev Permissionless — anyone can call, but funds go to the challenger specifically.
     *      Also removes the report from the pending slot so the operator can commit anew.
     */
    function claimChallengeSlash(bytes32 shardId) external nonReentrant {
        PendingReport storage p = pendingReports[shardId];
        if (p.commitAt == 0 || p.resolved) revert NoPendingReport();
        if (p.challenger == address(0)) revert NoPendingReport();
        if (block.timestamp <= p.challengeDeadline) revert ChallengeNotExpired();

        Shard storage shard = shards[shardId];
        uint256 slash = (shard.stake * CHALLENGE_SLASH_BPS) / 10_000;
        if (slash > shard.stake) slash = shard.stake;

        // Reduce operator's stake — triggers weight reduction via _shardWeight
        // on next claim/finalize. We update totalWeight here to keep accounting
        // fresh immediately.
        uint256 oldWeight = _shardWeight(shard);
        shard.stake -= slash;
        uint256 newWeight = _shardWeight(shard);
        if (oldWeight > 0) totalWeight = totalWeight + newWeight - oldWeight;

        totalStaked -= slash;

        address challenger = p.challenger;
        uint256 payout = slash + p.challengerBond;

        // Discard pending report without updating cellsServed
        p.resolved = true;
        p.challenger = address(0);
        p.challengerBond = 0;

        ckbToken.safeTransfer(challenger, payout);

        emit ChallengeSucceeded(shardId, challenger, slash);
    }

    /**
     * @notice Heartbeat — prove shard liveness
     */
    function heartbeat() external {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        shards[shardId].lastHeartbeat = block.timestamp;
        emit HeartbeatReceived(shardId, block.timestamp);
    }

    /**
     * @notice Deactivate a shard (voluntary exit)
     */
    function deactivateShard() external nonReentrant {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();

        // C11-AUDIT-3: block voluntary exit while a pending report is unresolved.
        // Without this gate an operator could commit a fraudulent report, get
        // challenged, then deactivate before the response window expires —
        // zeroing stake and reducing slash to 0. Operator must finalize or be
        // slashed first.
        PendingReport storage p_ = pendingReports[shardId];
        if (p_.commitAt != 0 && !p_.resolved) revert PendingReportActive();

        // Claim pending rewards
        _claimRewards(shardId);

        // Remove weight
        totalWeight -= _shardWeight(shard);

        shard.active = false;
        activeShardCount--;
        totalStaked -= shard.stake;
        // C11-AUDIT-7: saturating subtraction — guard against state drift that
        // would otherwise revert the whole deactivate tx and strand operators.
        totalCellsServed = totalCellsServed >= shard.cellsServed
            ? totalCellsServed - shard.cellsServed
            : 0;

        // Return stake
        uint256 stakeReturn = shard.stake;
        shard.stake = 0;
        // NCI-023: Clear operatorShard so operator can re-register
        operatorShard[msg.sender] = bytes32(0);
        ckbToken.safeTransfer(msg.sender, stakeReturn);

        emit ShardDeactivated(shardId, "voluntary");
    }

    // ============ Rewards ============

    /**
     * @notice Distribute rewards from SecondaryIssuanceController
     * @dev NCI-012: Restricted to issuanceController. Reverts if totalWeight=0
     *      to prevent tokens from being permanently locked.
     */
    function distributeRewards(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // NCI-012: Only issuance controller can distribute (or owner during setup)
        require(
            msg.sender == issuanceController || msg.sender == owner(),
            "Not authorized"
        );
        // NCI-012: Don't accept tokens that can never be claimed
        require(totalWeight > 0, "No active shards");

        ckbToken.safeTransferFrom(msg.sender, address(this), amount);
        accRewardPerShare += (amount * ACC_PRECISION) / totalWeight;

        emit RewardsDistributed(amount, accRewardPerShare);
    }

    /// @notice Set the issuance controller address
    function setIssuanceController(address controller) external onlyOwner {
        issuanceController = controller;
    }

    /// @notice C11-AUDIT-14: wire the canonical StateRentVault for
    ///         cell-existence checks in respondToChallenge. MUST be called
    ///         post-upgrade before any challenge can be refuted — refutes
    ///         revert VaultNotSet when the address is zero.
    function setStateRentVault(address vault) external onlyOwner {
        stateRentVault = IStateRentVaultForRegistry(vault);
    }

    /**
     * @notice Claim accumulated rewards
     * @dev C10-AUDIT-2: Live (heartbeat-fresh) shards only. Prevents zombie
     *      shards from draining accrued rewards after going offline.
     *      Operators can reclaim by heartbeating first. If they fail to
     *      heartbeat within the grace window, any caller can reap the shard
     *      via deactivateStaleShard and the unclaimed rewards route via the
     *      standard claim path once reactivated under a new shardId.
     */
    function claimRewards() external nonReentrant {
        bytes32 shardId = operatorShard[msg.sender];
        if (shardId == bytes32(0)) revert NotRegistered();

        Shard storage shard = shards[shardId];
        if (!shard.active) revert NotActive();
        if (_isStale(shard)) revert ShardStale();

        _claimRewards(shardId);
    }

    /**
     * @notice C10-AUDIT-2: Permissionless cleanup of stale (non-heartbeating) shards.
     *         Any caller can invoke after the grace window. Removes shard's weight
     *         from the active pool so future rewards flow to live operators, and
     *         returns the stake to the operator (no slash — this is eviction, not fraud).
     *
     * @dev The operator forfeits their accumulated rewardDebt surplus (which would
     *      have been earnable via heartbeat + claim) as the stake-removal side-effect.
     *      If you don't want to lose it, heartbeat within the grace window.
     */
    function deactivateStaleShard(bytes32 shardId) external nonReentrant {
        Shard storage shard = shards[shardId];
        if (shard.operator == address(0)) revert NotRegistered();
        if (!shard.active) revert NotActive();
        if (!_isStale(shard)) revert ShardNotStale();

        // C11-AUDIT-2: reject stale-reap while a pending report is unresolved.
        // An operator who committed a fraudulent report could go silent for 48h
        // and have an accomplice reap the shard — returning full stake and
        // erasing the slash. Force the challenge lifecycle to complete first:
        // the challenger can call claimChallengeSlash() after the response
        // window expires, which slashes and then leaves shard.active=true but
        // stake reduced; a subsequent stale-reap returns the residual.
        PendingReport storage p_ = pendingReports[shardId];
        if (p_.commitAt != 0 && !p_.resolved) revert PendingReportActive();

        // Remove weight from active pool. We do NOT credit the stale shard with
        // pending rewards here — those were forfeited by going silent.
        totalWeight -= _shardWeight(shard);

        shard.active = false;
        activeShardCount--;
        totalStaked -= shard.stake;
        // C11-AUDIT-7: saturating subtraction (symmetric with deactivateShard)
        totalCellsServed = totalCellsServed >= shard.cellsServed
            ? totalCellsServed - shard.cellsServed
            : 0;

        address operator = shard.operator;
        uint256 stakeReturn = shard.stake;
        shard.stake = 0;
        shard.rewardDebt = 0; // forfeit pending surplus
        operatorShard[operator] = bytes32(0);

        ckbToken.safeTransfer(operator, stakeReturn);

        emit StaleShardReaped(shardId, msg.sender, stakeReturn);
        emit ShardDeactivated(shardId, "stale");
    }

    /// @dev C10-AUDIT-2: Shard is stale if its last heartbeat is older than the grace window.
    function _isStale(Shard storage shard) internal view returns (bool) {
        return block.timestamp > shard.lastHeartbeat + HEARTBEAT_GRACE;
    }

    /// @notice View: is this shard currently stale?
    function isStale(bytes32 shardId) external view returns (bool) {
        Shard storage shard = shards[shardId];
        if (shard.operator == address(0) || !shard.active) return false;
        return block.timestamp > shard.lastHeartbeat + HEARTBEAT_GRACE;
    }

    function _claimRewards(bytes32 shardId) internal {
        Shard storage shard = shards[shardId];
        uint256 weight = _shardWeight(shard);

        uint256 accumulated = (weight * accRewardPerShare) / ACC_PRECISION;
        uint256 pending = accumulated - shard.rewardDebt;

        if (pending > 0) {
            shard.rewardDebt = accumulated;
            ckbToken.safeTransfer(shard.operator, pending);
            emit RewardClaimed(shard.operator, pending);
        } else {
            shard.rewardDebt = accumulated;
        }
    }

    // ============ Internal ============

    /// @notice Shard weight = sqrt(cellsServed * stake) — geometric mean
    /// @dev Prevents gaming by either maxing cells with min stake or vice versa
    function _shardWeight(Shard storage shard) internal view returns (uint256) {
        if (shard.cellsServed == 0 || shard.stake == 0) return 0;
        return _sqrt(shard.cellsServed * shard.stake);
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ View Functions ============

    function getShard(bytes32 shardId) external view returns (Shard memory) {
        return shards[shardId];
    }

    function pendingRewards(address operator) external view returns (uint256) {
        bytes32 shardId = operatorShard[operator];
        if (shardId == bytes32(0)) return 0;

        Shard storage shard = shards[shardId];
        uint256 weight = _shardWeight(shard);
        uint256 accumulated = (weight * accRewardPerShare) / ACC_PRECISION;
        return accumulated > shard.rewardDebt ? accumulated - shard.rewardDebt : 0;
    }

    function getActiveShardCount() external view returns (uint256) {
        return activeShardCount;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
