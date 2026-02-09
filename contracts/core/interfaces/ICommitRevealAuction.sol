// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICommitRevealAuction
 * @notice Interface for the commit-reveal auction mechanism with priority bidding
 */
interface ICommitRevealAuction {
    // ============ Enums ============

    enum BatchPhase {
        COMMIT,     // Users submit order commitments
        REVEAL,     // Users reveal orders + priority bids
        SETTLING,   // System processing orders
        SETTLED     // Batch complete
    }

    enum CommitStatus {
        NONE,
        COMMITTED,
        REVEALED,
        EXECUTED,
        SLASHED
    }

    // ============ Structs ============

    struct OrderCommitment {
        bytes32 commitHash;
        bytes32 poolId;           // Pool this commitment belongs to
        uint64 batchId;
        uint256 depositAmount;
        address depositor;
        CommitStatus status;
    }

    struct RevealedOrder {
        address trader;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes32 secret;
        uint256 priorityBid;
        uint32 srcChainId;
    }

    struct Batch {
        uint64 batchId;
        uint64 startTimestamp;
        BatchPhase phase;
        bytes32 shuffleSeed;
        uint256 totalPriorityBids;
        uint256 orderCount;
        bool isSettled;
    }

    // ============ Events ============

    event OrderCommitted(
        bytes32 indexed commitId,
        address indexed trader,
        uint64 indexed batchId,
        uint256 depositAmount
    );

    event OrderRevealed(
        bytes32 indexed commitId,
        address indexed trader,
        uint64 indexed batchId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 priorityBid
    );

    event BatchPhaseChanged(
        uint64 indexed batchId,
        BatchPhase oldPhase,
        BatchPhase newPhase
    );

    event BatchSettled(
        uint64 indexed batchId,
        uint256 orderCount,
        uint256 totalPriorityBids,
        bytes32 shuffleSeed
    );

    event OrderSlashed(
        bytes32 indexed commitId,
        address indexed trader,
        uint256 slashedAmount
    );

    event PoWProofAccepted(
        bytes32 indexed commitId,
        address indexed trader,
        uint8 difficulty,
        uint256 powValue
    );

    // Note: PoolConfigCreated event is defined in PoolComplianceConfig library

    // ============ Functions ============

    /**
     * @notice Commit an order hash for the current batch
     * @param commitHash Hash of (trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
     * @return commitId Unique identifier for this commitment
     */
    function commitOrder(bytes32 commitHash) external payable returns (bytes32 commitId);

    /**
     * @notice Commit an order hash to a specific pool
     * @param poolId The pool to commit to (bytes32(0) for default open pool)
     * @param commitHash Hash of order details
     * @param estimatedTradeValue Estimated trade value for collateral calculation
     * @return commitId Unique identifier for this commitment
     */
    function commitOrderToPool(
        bytes32 poolId,
        bytes32 commitHash,
        uint256 estimatedTradeValue
    ) external payable returns (bytes32 commitId);

    /**
     * @notice Reveal a previously committed order
     * @param commitId The commitment ID from commitOrder
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum acceptable tokenOut
     * @param secret Secret used in commitment
     * @param priorityBid Additional bid for priority execution
     */
    function revealOrder(
        bytes32 commitId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid
    ) external payable;

    /**
     * @notice Reveal a committed order with optional proof-of-work for priority
     * @param commitId The commitment ID from commitOrder
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum acceptable tokenOut
     * @param secret Secret used in commitment
     * @param priorityBid Additional ETH bid for priority execution
     * @param powNonce Nonce for proof-of-work (bytes32(0) if not using PoW)
     * @param powAlgorithm 0 = Keccak256, 1 = SHA256
     * @param claimedDifficulty Difficulty bits claimed for PoW
     */
    function revealOrderWithPoW(
        bytes32 commitId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid,
        bytes32 powNonce,
        uint8 powAlgorithm,
        uint8 claimedDifficulty
    ) external payable;

    /**
     * @notice Reveal order on behalf of another address (for cross-chain or aggregator use)
     * @param commitId The commitment ID from commitOrder
     * @param originalDepositor Original address that made the commitment
     * @param tokenIn Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum acceptable tokenOut
     * @param secret Secret used in commitment
     * @param priorityBid Additional bid for priority execution
     */
    function revealOrderCrossChain(
        bytes32 commitId,
        address originalDepositor,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid
    ) external payable;

    /**
     * @notice Get the current batch ID
     */
    function getCurrentBatchId() external view returns (uint64);

    /**
     * @notice Get the current batch phase
     */
    function getCurrentPhase() external view returns (BatchPhase);

    /**
     * @notice Get batch information
     */
    function getBatch(uint64 batchId) external view returns (Batch memory);

    /**
     * @notice Get commitment information
     */
    function getCommitment(bytes32 commitId) external view returns (OrderCommitment memory);

    /**
     * @notice Get revealed orders for a batch (after settlement)
     */
    function getRevealedOrders(uint64 batchId) external view returns (RevealedOrder[] memory);

    /**
     * @notice Advance batch phase (callable by authorized)
     */
    function advancePhase() external;

    /**
     * @notice Settle the current batch
     */
    function settleBatch() external;

    /**
     * @notice Get execution order indices for a settled batch
     */
    function getExecutionOrder(uint64 batchId) external view returns (uint256[] memory indices);

    /**
     * @notice Get time until the next phase change
     */
    function getTimeUntilPhaseChange() external view returns (uint256);

    /**
     * @notice Get the batch duration (PROTOCOL CONSTANT)
     */
    function getBatchDuration() external pure returns (uint256);
}
