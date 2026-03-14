// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITemporalCollateral
 * @notice Interface for the Temporal Collateral mechanism — future commitments as present capital.
 *         Part of the IT meta-pattern. Users make cryptographic commitments about future
 *         protocol state. These commitments have verifiable collateral value NOW.
 *         Breached commitments are routed to AdversarialSymbiosis (attacks strengthen system).
 */
interface ITemporalCollateral {

    // ============ Enums ============

    enum CommitmentType {
        LIQUIDITY_PROVISION,    // Commit to provide X liquidity for N batches
        ORDER_FLOW,             // Commit to minimum trade volume over N batches
        PRICE_BOUND,            // Commit to keeping oracle price within range
        UPTIME                  // Commit to maintaining a service (keeper, oracle)
    }

    enum CommitmentStatus {
        ACTIVE,                 // Commitment is live and being tracked
        VERIFIED,               // Checkpoint passed verification
        BREACHED,               // Commitment was broken
        COMPLETED,              // Commitment fulfilled, collateral released
        EXPIRED                 // Commitment period ended without verification
    }

    // ============ Structs ============

    struct StateCommitment {
        bytes32 commitmentId;
        address committer;
        CommitmentType commitType;
        bytes32 stateHash;          // Hash of the committed future state parameters
        uint256 stakedCollateral;   // ETH/token staked as backing
        uint256 collateralValue;    // Computed collateral value (time-weighted)
        uint64 startBlock;
        uint64 endBlock;
        uint64 lastCheckpoint;
        uint256 checkpointsPassed;
        CommitmentStatus status;
    }

    struct CommitmentParams {
        CommitmentType commitType;
        bytes32 stateHash;          // Hash of specific parameters (amount, bounds, etc.)
        uint64 duration;            // Duration in blocks
        uint64 checkpointInterval;  // Blocks between verification checkpoints
    }

    // ============ Events ============

    event CommitmentCreated(
        bytes32 indexed commitmentId,
        address indexed committer,
        CommitmentType indexed commitType,
        uint256 stakedCollateral,
        uint64 startBlock,
        uint64 endBlock
    );

    event CommitmentVerified(
        bytes32 indexed commitmentId,
        uint256 checkpointNumber,
        uint256 newCollateralValue
    );

    event CommitmentBreached(
        bytes32 indexed commitmentId,
        address indexed committer,
        uint256 slashedAmount
    );

    event CommitmentCompleted(
        bytes32 indexed commitmentId,
        address indexed committer,
        uint256 returnedCollateral,
        uint256 totalCheckpoints
    );

    event CollateralValueUpdated(
        bytes32 indexed commitmentId,
        uint256 oldValue,
        uint256 newValue
    );

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDuration();
    error InvalidCheckpointInterval();
    error CommitmentNotFound();
    error CommitmentNotActive();
    error CommitmentAlreadyFinalized();
    error CheckpointTooEarly();
    error NotCommitter();
    error NotAuthorized();
    error InsufficientCollateral();
    error InvalidProof();

    // ============ Core ============

    /**
     * @notice Create a new temporal commitment backed by staked collateral
     * @param params Commitment parameters (type, state hash, duration, checkpoint interval)
     * @return commitmentId Unique identifier for this commitment
     */
    function createCommitment(
        CommitmentParams calldata params
    ) external payable returns (bytes32 commitmentId);

    /**
     * @notice Verify a commitment at a checkpoint — confirm the committed state holds
     * @param commitmentId The commitment to verify
     * @param proof Proof that the committed state holds (e.g., Merkle proof of liquidity)
     */
    function verifyCheckpoint(
        bytes32 commitmentId,
        bytes calldata proof
    ) external;

    /**
     * @notice Report a breach of commitment — committed state no longer holds
     * @param commitmentId The commitment that was breached
     * @param evidence Evidence of the breach
     */
    function reportBreach(
        bytes32 commitmentId,
        bytes calldata evidence
    ) external;

    /**
     * @notice Complete a commitment that has fulfilled its full duration
     * @param commitmentId The commitment to complete
     */
    function completeCommitment(bytes32 commitmentId) external;

    // ============ Views ============

    /**
     * @notice Get the current collateral value of a commitment (time-weighted)
     * @dev Value increases with each passed checkpoint and remaining duration
     */
    function getCollateralValue(bytes32 commitmentId) external view returns (uint256);

    /**
     * @notice Get full commitment details
     */
    function getCommitment(bytes32 commitmentId) external view returns (StateCommitment memory);

    /**
     * @notice Get all active commitments for a user
     */
    function getUserCommitments(address user) external view returns (bytes32[] memory);

    /**
     * @notice Get total collateral value across all active commitments for a user
     */
    function getUserTotalCollateralValue(address user) external view returns (uint256);

    /**
     * @notice Check if a commitment is eligible for checkpoint verification
     */
    function isCheckpointReady(bytes32 commitmentId) external view returns (bool);
}
