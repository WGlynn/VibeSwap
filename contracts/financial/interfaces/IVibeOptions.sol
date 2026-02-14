// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeOptions
 * @notice Interface for on-chain European-style options — ERC-721 NFTs representing
 *         call/put positions, cash-settled from collateral using TWAP pricing.
 */
interface IVibeOptions {
    // ============ Enums ============

    enum OptionType { CALL, PUT }
    enum OptionState { WRITTEN, ACTIVE, EXERCISED, RECLAIMED, CANCELED }

    // ============ Structs ============

    /// @notice Option data — storage-packed
    struct Option {
        // Slot 1 (32/32 bytes)
        address writer;          // 20 bytes
        uint40  expiry;          // 5 bytes
        uint40  exerciseEnd;     // 5 bytes
        OptionType optionType;   // 1 byte
        OptionState state;       // 1 byte

        // Slot 2 (32/32 bytes)
        bytes32 poolId;

        // Slot 3 (32/32 bytes)
        uint256 amount;          // notional (underlying units)

        // Slot 4 (32/32 bytes)
        uint256 strikePrice;     // token1 per token0, 1e18

        // Slot 5 (32/32 bytes)
        uint256 collateral;      // actual collateral deposited

        // Slot 6 (32/32 bytes)
        uint256 premium;         // premium set by writer
    }

    struct WriteParams {
        bytes32 poolId;
        OptionType optionType;
        uint256 amount;
        uint256 strikePrice;
        uint256 premium;
        uint40  expiry;
        uint40  exerciseWindow;  // duration after expiry (default 24h)
    }

    // ============ Events ============

    event OptionWritten(
        uint256 indexed optionId,
        address indexed writer,
        bytes32 indexed poolId,
        OptionType optionType,
        uint256 amount,
        uint256 strikePrice,
        uint256 premium,
        uint40 expiry
    );

    event OptionPurchased(uint256 indexed optionId, address indexed buyer, uint256 premium);
    event OptionExercised(uint256 indexed optionId, address indexed holder, uint256 payoff);
    event OptionReclaimed(uint256 indexed optionId, address indexed writer, uint256 amount);
    event OptionCanceled(uint256 indexed optionId);

    // ============ Errors ============

    error OptionNotFound();
    error NotOptionWriter();
    error OptionExpired();
    error OptionNotExpired();
    error OptionAlreadyExercised();
    error OptionAlreadyReclaimed();
    error OptionAlreadyPurchased();
    error OptionNotPurchased();
    error OptionNotActive();
    error OptionOutOfTheMoney();
    error ExerciseWindowClosed();
    error InvalidStrikePrice();
    error InvalidExpiry();
    error InvalidExerciseWindow();
    error InvalidAmount();
    error PoolNotInitialized();
    error InsufficientPriceHistory();

    // ============ Core Functions ============

    function writeOption(WriteParams calldata params) external returns (uint256 optionId);
    function purchase(uint256 optionId) external;
    function exercise(uint256 optionId) external;
    function reclaim(uint256 optionId) external;
    function cancel(uint256 optionId) external;
    function burn(uint256 optionId) external;

    // ============ View Functions ============

    function getOption(uint256 optionId) external view returns (Option memory);
    function getPayoff(uint256 optionId) external view returns (uint256);
    function isITM(uint256 optionId) external view returns (bool);
    function suggestPremium(
        bytes32 poolId,
        OptionType optionType,
        uint256 amount,
        uint256 strikePrice,
        uint40 expiry
    ) external view returns (uint256);
    function getOptionsByOwner(address owner) external view returns (uint256[] memory);
    function getOptionsByWriter(address writer) external view returns (uint256[] memory);
    function totalOptions() external view returns (uint256);
}
