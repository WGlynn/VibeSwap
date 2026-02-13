// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDAOTreasury
 * @notice Interface for DAO treasury with backstop liquidity functionality
 */
interface IDAOTreasury {
    // ============ Structs ============

    struct BackstopConfig {
        address token;
        uint256 targetReserve;      // Target reserve amount
        uint256 currentReserve;     // Current reserve
        uint256 smoothingFactor;    // Price smoothing (1e18 scale)
        uint256 lastPrice;          // Last recorded price
        bool isStoreOfValue;        // BTC, ETH, etc.
        bool isActive;
    }

    struct WithdrawalRequest {
        address recipient;
        address token;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
    }

    // ============ Events ============

    event ProtocolFeesReceived(
        address indexed token,
        uint256 amount,
        uint64 indexed batchId
    );

    event AuctionProceedsReceived(
        uint256 amount,
        uint64 indexed batchId
    );

    event BackstopConfigured(
        address indexed token,
        uint256 targetReserve,
        uint256 smoothingFactor,
        bool isStoreOfValue
    );

    event BackstopLiquidityProvided(
        address indexed token,
        uint256 amount,
        bytes32 indexed poolId
    );

    event WithdrawalQueued(
        uint256 indexed requestId,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        uint256 executeAfter
    );

    event WithdrawalExecuted(
        uint256 indexed requestId,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event WithdrawalCancelled(uint256 indexed requestId);

    event PriceSmoothed(
        address indexed token,
        uint256 rawPrice,
        uint256 smoothedPrice
    );

    // ============ Functions ============

    /**
     * @notice Receive protocol fees from AMM
     * @param token Token address
     * @param amount Fee amount
     * @param batchId Batch that generated fees
     */
    function receiveProtocolFees(
        address token,
        uint256 amount,
        uint64 batchId
    ) external;

    /**
     * @notice Receive auction proceeds (priority bid payments)
     * @param batchId Batch that generated proceeds
     */
    function receiveAuctionProceeds(uint64 batchId) external payable;

    /**
     * @notice Configure backstop for a token
     * @param token Token to backstop
     * @param targetReserve Target reserve amount
     * @param smoothingFactor EMA smoothing factor (1e18 scale)
     * @param isStoreOfValue Whether token is a store of value asset
     */
    function configureBackstop(
        address token,
        uint256 targetReserve,
        uint256 smoothingFactor,
        bool isStoreOfValue
    ) external;

    /**
     * @notice Provide backstop liquidity to AMM pool
     * @param poolId Pool to provide liquidity to
     * @param token0Amount Amount of token0
     * @param token1Amount Amount of token1
     */
    function provideBackstopLiquidity(
        bytes32 poolId,
        uint256 token0Amount,
        uint256 token1Amount
    ) external;

    /**
     * @notice Remove backstop liquidity from AMM pool
     * @param poolId Pool to remove liquidity from
     * @param lpAmount LP tokens to burn
     * @return received Amount of tokens received
     */
    function removeBackstopLiquidity(
        bytes32 poolId,
        uint256 lpAmount,
        uint256 minAmount0,
        uint256 minAmount1
    ) external returns (uint256 received);

    /**
     * @notice Queue a withdrawal (timelock)
     * @param recipient Address to receive funds
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @return requestId Withdrawal request ID
     */
    function queueWithdrawal(
        address recipient,
        address token,
        uint256 amount
    ) external returns (uint256 requestId);

    /**
     * @notice Execute a queued withdrawal after timelock
     * @param requestId Withdrawal request ID
     */
    function executeWithdrawal(uint256 requestId) external;

    /**
     * @notice Cancel a pending withdrawal
     * @param requestId Withdrawal request ID
     */
    function cancelWithdrawal(uint256 requestId) external;

    /**
     * @notice Calculate smoothed price for backstop
     * @param token Token address
     * @param currentPrice Current market price
     * @return smoothedPrice EMA-smoothed price
     */
    function calculateSmoothedPrice(
        address token,
        uint256 currentPrice
    ) external view returns (uint256 smoothedPrice);

    /**
     * @notice Get backstop configuration
     */
    function getBackstopConfig(address token) external view returns (BackstopConfig memory);

    /**
     * @notice Get withdrawal request details
     */
    function getWithdrawalRequest(uint256 requestId) external view returns (WithdrawalRequest memory);

    /**
     * @notice Get treasury balance for a token
     */
    function getBalance(address token) external view returns (uint256);

    /**
     * @notice Get timelock duration
     */
    function timelockDuration() external view returns (uint256);
}
