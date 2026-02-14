// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeStream
 * @notice Interface for streaming payments — ERC-721 NFTs representing continuous token flows
 */
interface IVibeStream {
    // ============ Structs ============

    /// @notice Stream data — storage-packed into 3 slots
    struct Stream {
        // Slot 1 (32/32 bytes)
        address sender;          // 20 bytes — who funded the stream
        uint40  startTime;       // 5 bytes  — when streaming begins
        uint40  endTime;         // 5 bytes  — when streaming ends
        bool    cancelable;      // 1 byte   — can sender cancel?
        bool    canceled;        // 1 byte   — has been canceled?

        // Slot 2 (25/32 bytes)
        address token;           // 20 bytes — ERC-20 token being streamed
        uint40  cliffTime;       // 5 bytes  — cliff timestamp (0 = no cliff)

        // Slot 3 (32/32 bytes)
        uint128 depositAmount;   // 16 bytes — total tokens deposited (reduced on cancel)
        uint128 withdrawnAmount; // 16 bytes — tokens already withdrawn by recipient
    }

    struct CreateParams {
        address recipient;
        address token;
        uint128 depositAmount;
        uint40  startTime;
        uint40  endTime;
        uint40  cliffTime;       // 0 = no cliff
        bool    cancelable;
    }

    // ============ FundingPool Structs ============

    /// @notice FundingPool data — conviction-weighted distribution to multiple recipients
    struct FundingPool {
        // Slot 1 (31/32 bytes)
        address creator;         // 20 bytes — who funded
        uint40  startTime;       // 5 bytes
        uint40  endTime;         // 5 bytes
        bool    canceled;        // 1 byte

        // Slot 2 (20/32 bytes)
        address token;           // 20 bytes

        // Slot 3 (32/32 bytes)
        uint128 totalDeposit;    // 16 bytes
        uint128 totalWithdrawn;  // 16 bytes
    }

    /// @notice Aggregated conviction data per recipient (O(1) conviction computation)
    struct ConvictionAggregate {
        uint256 totalStake;      // Σ stake_i
        uint256 stakeTimeProd;   // Σ (stake_i × signalTime_i)
    }

    /// @notice Individual voter's signal for a recipient
    struct VoterSignal {
        uint128 amount;          // Tokens staked
        uint40  signalTime;      // When signal started
    }

    /// @notice Parameters for creating a funding pool
    struct CreateFundingPoolParams {
        address token;
        uint128 depositAmount;
        address[] recipients;
        uint40  startTime;
        uint40  endTime;
    }

    // ============ Events ============

    event StreamCreated(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint128 depositAmount,
        uint40 startTime,
        uint40 endTime,
        uint40 cliffTime,
        bool cancelable
    );

    event Withdrawn(
        uint256 indexed streamId,
        address indexed to,
        uint128 amount
    );

    event Canceled(
        uint256 indexed streamId,
        uint128 senderRefund,
        uint128 recipientAmount
    );

    event StreamBurned(uint256 indexed streamId);

    // ============ FundingPool Events ============

    event FundingPoolCreated(uint256 indexed poolId, address indexed creator, address token, uint128 amount, uint256 recipientCount);
    event ConvictionSignaled(uint256 indexed poolId, address indexed voter, address indexed recipient, uint128 amount);
    event ConvictionRemoved(uint256 indexed poolId, address indexed voter, address indexed recipient, uint128 amount);
    event PoolWithdrawn(uint256 indexed poolId, address indexed recipient, uint128 amount);
    event PoolCanceled(uint256 indexed poolId, uint128 refundAmount);

    // ============ Errors ============

    error StreamNotCancelable();
    error StreamAlreadyCanceled();
    error ZeroAmount();
    error ZeroRecipient();
    error InvalidTimeRange();
    error CliffOutOfRange();
    error NotStreamSender();
    error WithdrawAmountExceeded();
    error NothingToWithdraw();
    error StreamNotDepleted();

    // ============ FundingPool Errors ============

    error PoolNotFound();
    error NotPoolCreator();
    error PoolAlreadyCanceled();
    error PoolNotStarted();
    error NotRecipient();
    error NoConviction();
    error SignalAlreadyExists();
    error NoSignalExists();
    error NoRecipientsProvided();
    error DuplicateRecipient();

    // ============ Core Functions ============

    function createStream(CreateParams calldata params) external returns (uint256 streamId);

    function withdraw(uint256 streamId, uint128 amount, address to) external;

    function cancel(uint256 streamId) external;

    function burn(uint256 streamId) external;

    // ============ View Functions ============

    function streamedAmount(uint256 streamId) external view returns (uint128);

    function withdrawable(uint256 streamId) external view returns (uint128);

    function refundable(uint256 streamId) external view returns (uint128);

    function getStream(uint256 streamId) external view returns (Stream memory);

    function getStreamsByOwner(address owner) external view returns (uint256[] memory);

    function getStreamsBySender(address sender) external view returns (uint256[] memory);

    function totalStreams() external view returns (uint256);

    // ============ FundingPool Functions ============

    function createFundingPool(CreateFundingPoolParams calldata params) external returns (uint256 poolId);

    function signalConviction(uint256 poolId, address recipient, uint128 stakeAmount) external;

    function removeSignal(uint256 poolId, address recipient) external;

    function withdrawFromPool(uint256 poolId) external returns (uint128 amount);

    function cancelPool(uint256 poolId) external;

    // ============ FundingPool View Functions ============

    function getPool(uint256 poolId) external view returns (FundingPool memory);

    function getPoolRecipients(uint256 poolId) external view returns (address[] memory);

    function getConviction(uint256 poolId, address recipient) external view returns (uint256);

    function getTotalConviction(uint256 poolId) external view returns (uint256);

    function getPoolWithdrawable(uint256 poolId, address recipient) external view returns (uint128);

    function verifyPoolFairness(uint256 poolId, address r1, address r2)
        external view returns (bool fair, uint256 deviation);

    function getPoolsBySender(address creator) external view returns (uint256[] memory);

    function getVoterSignal(uint256 poolId, address recipient, address voter)
        external view returns (VoterSignal memory);
}
