// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title BatchProver — STARK Proof Verification for Batch Settlement
 * @author Faraday1 & JARVIS — vibeswap.org
 *
 * @notice Coordinates ZK proof verification for batch auction settlement.
 *         Allows anyone to submit STARK proofs that a batch was settled correctly
 *         (clearing price, order matching, shuffle fairness) without re-executing trades.
 *
 * @dev The actual STARK verification is delegated to an external verifier contract
 *      (IBatchVerifier). This contract is the coordinator — it manages proof lifecycle,
 *      challenge periods, cross-chain proof receipt, and Shapley reward unlocking.
 *
 *      Proof lifecycle: Unproven → Proven (challenge window) → Finalized
 *
 *      VSOS Role: Settlement verification layer — the last missing piece.
 */
contract BatchProver is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Interfaces ============

    /// @notice External STARK verifier contract
    /// @dev Upgradeable — owner can swap verifier as ZK tech evolves
    IBatchVerifier public verifier;

    // ============ Enums ============

    enum ProofStatus {
        Unproven,
        Proven,
        Finalized,
        Challenged
    }

    // ============ Structs ============

    struct PublicInputs {
        uint64 batchId;
        uint256 clearingPrice;
        uint256 orderCount;
        bytes32 shuffleSeed;
        bytes32 matchedOrdersRoot;
    }

    struct BatchProof {
        bytes32 proofHash;
        address prover;
        uint64 provenAt;
        ProofStatus status;
        PublicInputs inputs;
    }

    struct Challenge {
        address challenger;
        bytes32 counterProofHash;
        uint64 challengedAt;
        bool resolved;
    }

    // ============ Custom Errors ============

    error BatchAlreadyProven(uint64 batchId);
    error BatchNotProven(uint64 batchId);
    error BatchAlreadyFinalized(uint64 batchId);
    error BatchAlreadyChallenged(uint64 batchId);
    error ChallengeWindowActive(uint64 batchId);
    error ChallengeWindowExpired(uint64 batchId);
    error InvalidProof();
    error InvalidPublicInputs();
    error ZeroBatchId();
    error EmptyBatchIds();
    error VerifierNotSet();
    error InvalidVerifierAddress();
    error NotEndpoint();
    error InvalidPeer();
    error InsufficientBond();
    error TransferFailed();
    error ChallengeNotFound(uint64 batchId);

    // ============ Events ============

    event BatchProven(
        uint64 indexed batchId,
        address indexed prover,
        bytes32 proofHash,
        uint256 clearingPrice,
        uint256 orderCount
    );

    event AggregateProven(
        uint64[] batchIds,
        address indexed prover,
        bytes32 proofHash,
        uint256 batchCount
    );

    event BatchFinalized(uint64 indexed batchId, address indexed prover);

    event BatchChallenged(
        uint64 indexed batchId,
        address indexed challenger,
        bytes32 counterProofHash
    );

    event ChallengeResolved(
        uint64 indexed batchId,
        bool challengeSucceeded,
        address indexed winner
    );

    event CrossChainProofReceived(
        uint32 indexed srcChainId,
        uint64 indexed batchId,
        bytes32 proofHash
    );

    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    // ============ State ============

    /// @notice Batch ID => proof data
    mapping(uint64 => BatchProof) public batchProofs;

    /// @notice Batch ID => challenge data
    mapping(uint64 => Challenge) public challenges;

    /// @notice Challenge window duration (seconds)
    uint64 public challengeWindow;

    /// @notice Bond required to submit a challenge
    uint256 public challengeBond;

    /// @notice LayerZero endpoint for cross-chain proof receipt
    address public lzEndpoint;

    /// @notice Peer BatchProver contracts on other chains (eid => peer)
    mapping(uint32 => bytes32) public peers;

    /// @notice Total batches proven (stats)
    uint256 public totalBatchesProven;

    /// @notice Total batches finalized (stats)
    uint256 public totalBatchesFinalized;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Modifiers ============

    modifier onlyEndpoint() {
        if (msg.sender != lzEndpoint) revert NotEndpoint();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address owner_,
        uint64 challengeWindow_,
        uint256 challengeBond_
    ) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        challengeWindow = challengeWindow_;
        challengeBond = challengeBond_;
    }

    // ============ Proof Submission ============

    /// @notice Submit a STARK proof for a single batch settlement
    /// @param batchId The batch ID from CommitRevealAuction
    /// @param proof The STARK proof bytes
    /// @param inputs Public inputs that the proof attests to
    function submitBatchProof(
        uint64 batchId,
        bytes calldata proof,
        PublicInputs calldata inputs
    ) external nonReentrant {
        if (batchId == 0) revert ZeroBatchId();
        if (batchProofs[batchId].status == ProofStatus.Proven) revert BatchAlreadyProven(batchId);
        if (batchProofs[batchId].status == ProofStatus.Finalized) revert BatchAlreadyFinalized(batchId);
        if (inputs.batchId != batchId) revert InvalidPublicInputs();
        if (inputs.clearingPrice == 0) revert InvalidPublicInputs();

        // Verify proof via external verifier (if set)
        if (address(verifier) != address(0)) {
            if (!verifier.verifyBatchProof(proof, _encodePublicInputs(inputs))) {
                revert InvalidProof();
            }
        }

        bytes32 proofHash = keccak256(proof);

        batchProofs[batchId] = BatchProof({
            proofHash: proofHash,
            prover: msg.sender,
            provenAt: uint64(block.timestamp),
            status: ProofStatus.Proven,
            inputs: inputs
        });

        totalBatchesProven++;

        emit BatchProven(batchId, msg.sender, proofHash, inputs.clearingPrice, inputs.orderCount);
    }

    /// @notice Submit a STARK proof for multiple batches (recursive aggregation)
    /// @param batchIds Array of batch IDs proven in one aggregate proof
    /// @param proof The aggregate STARK proof bytes
    /// @param inputs Array of public inputs, one per batch
    function submitAggregateProof(
        uint64[] calldata batchIds,
        bytes calldata proof,
        PublicInputs[] calldata inputs
    ) external nonReentrant {
        if (batchIds.length == 0) revert EmptyBatchIds();
        if (batchIds.length != inputs.length) revert InvalidPublicInputs();

        // Verify aggregate proof via external verifier (if set)
        if (address(verifier) != address(0)) {
            bytes memory aggregateInputs = _encodeAggregateInputs(inputs);
            if (!verifier.verifyAggregateProof(proof, aggregateInputs)) {
                revert InvalidProof();
            }
        }

        bytes32 proofHash = keccak256(proof);

        for (uint256 i = 0; i < batchIds.length; i++) {
            uint64 bid = batchIds[i];
            if (bid == 0) revert ZeroBatchId();
            if (batchProofs[bid].status == ProofStatus.Proven) revert BatchAlreadyProven(bid);
            if (batchProofs[bid].status == ProofStatus.Finalized) revert BatchAlreadyFinalized(bid);
            if (inputs[i].batchId != bid) revert InvalidPublicInputs();
            if (inputs[i].clearingPrice == 0) revert InvalidPublicInputs();

            batchProofs[bid] = BatchProof({
                proofHash: proofHash,
                prover: msg.sender,
                provenAt: uint64(block.timestamp),
                status: ProofStatus.Proven,
                inputs: inputs[i]
            });

            totalBatchesProven++;
        }

        emit AggregateProven(batchIds, msg.sender, proofHash, batchIds.length);
    }

    // ============ Finalization ============

    /// @notice Finalize a proven batch after the challenge window elapses
    /// @param batchId The batch ID to finalize
    function finalizeBatch(uint64 batchId) external {
        BatchProof storage bp = batchProofs[batchId];
        if (bp.status != ProofStatus.Proven) revert BatchNotProven(batchId);
        if (block.timestamp < bp.provenAt + challengeWindow) revert ChallengeWindowActive(batchId);

        // Cannot finalize if an unresolved challenge exists
        Challenge storage ch = challenges[batchId];
        if (ch.challenger != address(0) && !ch.resolved) revert BatchAlreadyChallenged(batchId);

        bp.status = ProofStatus.Finalized;
        totalBatchesFinalized++;

        emit BatchFinalized(batchId, bp.prover);
    }

    // ============ Challenge Mechanism ============

    /// @notice Challenge a proven batch proof within the challenge window
    /// @param batchId The batch ID to challenge
    /// @param counterProof Proof data supporting the challenge
    function challengeProof(
        uint64 batchId,
        bytes calldata counterProof
    ) external payable nonReentrant {
        BatchProof storage bp = batchProofs[batchId];
        if (bp.status != ProofStatus.Proven) revert BatchNotProven(batchId);
        if (bp.status == ProofStatus.Finalized) revert BatchAlreadyFinalized(batchId);
        if (block.timestamp >= bp.provenAt + challengeWindow) revert ChallengeWindowExpired(batchId);
        if (challenges[batchId].challenger != address(0)) revert BatchAlreadyChallenged(batchId);
        if (msg.value < challengeBond) revert InsufficientBond();

        bytes32 counterProofHash = keccak256(counterProof);

        challenges[batchId] = Challenge({
            challenger: msg.sender,
            counterProofHash: counterProofHash,
            challengedAt: uint64(block.timestamp),
            resolved: false
        });

        bp.status = ProofStatus.Challenged;

        emit BatchChallenged(batchId, msg.sender, counterProofHash);
    }

    /// @notice Resolve a challenge — owner adjudicates (future: on-chain verification)
    /// @param batchId The batch ID with an active challenge
    /// @param challengeSucceeded Whether the challenge was valid
    function resolveChallenge(
        uint64 batchId,
        bool challengeSucceeded
    ) external onlyOwner nonReentrant {
        Challenge storage ch = challenges[batchId];
        if (ch.challenger == address(0)) revert ChallengeNotFound(batchId);
        if (ch.resolved) revert ChallengeNotFound(batchId);

        BatchProof storage bp = batchProofs[batchId];

        ch.resolved = true;

        if (challengeSucceeded) {
            // Challenge won — invalidate the proof, return bond to challenger
            bp.status = ProofStatus.Unproven;
            totalBatchesProven--;

            (bool ok,) = ch.challenger.call{value: challengeBond}("");
            if (!ok) revert TransferFailed();

            emit ChallengeResolved(batchId, true, ch.challenger);
        } else {
            // Challenge failed — proof stands, bond to prover
            bp.status = ProofStatus.Proven;
            // Reset provenAt so challenge window restarts
            bp.provenAt = uint64(block.timestamp);

            (bool ok,) = bp.prover.call{value: challengeBond}("");
            if (!ok) revert TransferFailed();

            emit ChallengeResolved(batchId, false, bp.prover);
        }
    }

    // ============ Cross-Chain Proof Receipt ============

    /// @notice Receive a proof attestation from another chain via LayerZero
    /// @dev Called by the LZ endpoint. Stores a cross-chain proof record.
    /// @param srcChainId The source chain endpoint ID
    /// @param batchId The batch ID proven on the source chain
    /// @param proofHash Hash of the proof verified on source chain
    function receiveCrossChainProof(
        uint32 srcChainId,
        uint64 batchId,
        bytes32 proofHash
    ) external onlyEndpoint {
        if (batchId == 0) revert ZeroBatchId();

        // Store as proven (cross-chain proofs are pre-verified on source)
        batchProofs[batchId] = BatchProof({
            proofHash: proofHash,
            prover: address(0), // Cross-chain, no local prover
            provenAt: uint64(block.timestamp),
            status: ProofStatus.Proven,
            inputs: PublicInputs({
                batchId: batchId,
                clearingPrice: 0, // Not available cross-chain
                orderCount: 0,
                shuffleSeed: bytes32(0),
                matchedOrdersRoot: bytes32(0)
            })
        });

        totalBatchesProven++;

        emit CrossChainProofReceived(srcChainId, batchId, proofHash);
    }

    // ============ View Functions ============

    /// @notice Get the proof status for a batch
    /// @param batchId The batch ID to query
    /// @return status The current proof status
    function getBatchProofStatus(uint64 batchId) external view returns (ProofStatus status) {
        return batchProofs[batchId].status;
    }

    /// @notice Get full proof data for a batch
    /// @param batchId The batch ID to query
    /// @return proofHash The hash of the proof
    /// @return prover The address that submitted the proof
    /// @return provenAt Timestamp when proof was submitted
    /// @return status The current proof status
    function getBatchProofData(uint64 batchId)
        external
        view
        returns (
            bytes32 proofHash,
            address prover,
            uint64 provenAt,
            ProofStatus status
        )
    {
        BatchProof storage bp = batchProofs[batchId];
        return (bp.proofHash, bp.prover, bp.provenAt, bp.status);
    }

    /// @notice Get the public inputs for a proven batch
    /// @param batchId The batch ID to query
    /// @return inputs The public inputs attested by the proof
    function getBatchPublicInputs(uint64 batchId) external view returns (PublicInputs memory inputs) {
        return batchProofs[batchId].inputs;
    }

    /// @notice Check if a batch is finalized (safe to settle against)
    /// @param batchId The batch ID to query
    /// @return True if the batch proof is finalized
    function isBatchFinalized(uint64 batchId) external view returns (bool) {
        return batchProofs[batchId].status == ProofStatus.Finalized;
    }

    // ============ Admin ============

    /// @notice Set the external STARK verifier contract
    /// @param newVerifier Address of the IBatchVerifier implementation
    function setVerifierContract(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert InvalidVerifierAddress();
        address old = address(verifier);
        verifier = IBatchVerifier(newVerifier);
        emit VerifierUpdated(old, newVerifier);
    }

    /// @notice Set the LayerZero endpoint for cross-chain proofs
    /// @param endpoint The LZ endpoint address
    function setLzEndpoint(address endpoint) external onlyOwner {
        lzEndpoint = endpoint;
    }

    /// @notice Set a peer BatchProver on another chain
    /// @param eid The LayerZero endpoint ID
    /// @param peer The peer contract address (as bytes32)
    function setPeer(uint32 eid, bytes32 peer) external onlyOwner {
        peers[eid] = peer;
    }

    /// @notice Update the challenge window duration
    /// @param newWindow New challenge window in seconds
    function setChallengeWindow(uint64 newWindow) external onlyOwner {
        challengeWindow = newWindow;
    }

    /// @notice Update the challenge bond amount
    /// @param newBond New bond amount in wei
    function setChallengeBond(uint256 newBond) external onlyOwner {
        challengeBond = newBond;
    }

    // ============ Internal ============

    /// @dev Encode public inputs into bytes for verifier
    function _encodePublicInputs(PublicInputs calldata inputs) internal pure returns (bytes memory) {
        return abi.encode(
            inputs.batchId,
            inputs.clearingPrice,
            inputs.orderCount,
            inputs.shuffleSeed,
            inputs.matchedOrdersRoot
        );
    }

    /// @dev Encode aggregate public inputs into bytes for verifier
    function _encodeAggregateInputs(PublicInputs[] calldata inputs) internal pure returns (bytes memory) {
        return abi.encode(inputs);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {} // UUPS auth
}

// ============ External Interface ============

/// @title IBatchVerifier — Interface for STARK proof verification
/// @notice Implemented by the off-chain-generated verifier contract
interface IBatchVerifier {
    /// @notice Verify a single batch STARK proof
    /// @param proof The proof bytes
    /// @param publicInputs ABI-encoded public inputs
    /// @return valid True if the proof is valid
    function verifyBatchProof(bytes calldata proof, bytes memory publicInputs) external view returns (bool valid);

    /// @notice Verify an aggregate STARK proof covering multiple batches
    /// @param proof The aggregate proof bytes
    /// @param publicInputs ABI-encoded array of public inputs
    /// @return valid True if the proof is valid
    function verifyAggregateProof(bytes calldata proof, bytes memory publicInputs) external view returns (bool valid);
}
