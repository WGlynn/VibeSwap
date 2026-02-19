// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IBuybackEngine
 * @notice Automated buyback-and-burn for protocol token value accrual.
 *         Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 */
interface IBuybackEngine {
    // ============ Structs ============

    struct BuybackRecord {
        address tokenIn;
        uint256 amountIn;
        uint256 amountBurned;
        uint256 timestamp;
    }

    // ============ Events ============

    event BuybackExecuted(
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 burned
    );
    event MinBuybackUpdated(address indexed token, uint256 newMinimum);
    event SlippageToleranceUpdated(uint256 newTolerance);
    event CooldownUpdated(uint256 newCooldown);
    event ProtocolTokenUpdated(address indexed newToken);
    event BurnAddressUpdated(address indexed newBurnAddress);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error BelowMinimum(uint256 amount, uint256 minimum);
    error CooldownActive(uint256 nextBuybackTime);
    error NoPoolForToken(address token);
    error SlippageTooHigh(uint256 tolerance);
    error InsufficientOutput(uint256 got, uint256 expected);

    // ============ Views ============

    function amm() external view returns (address);
    function protocolToken() external view returns (address);
    function burnAddress() external view returns (address);
    function slippageToleranceBps() external view returns (uint256);
    function cooldownPeriod() external view returns (uint256);
    function lastBuybackTime(address token) external view returns (uint256);
    function minBuybackAmount(address token) external view returns (uint256);
    function totalBurned() external view returns (uint256);
    function totalBuybacks() external view returns (uint256);
    function getBuybackRecord(uint256 index) external view returns (BuybackRecord memory);

    // ============ Actions ============

    function executeBuyback(address token) external returns (uint256 burned);
    function executeBuybackMultiple(address[] calldata tokens) external returns (uint256 totalBurnedAmount);
    function setMinBuybackAmount(address token, uint256 amount) external;
    function setSlippageTolerance(uint256 bps) external;
    function setCooldown(uint256 period) external;
    function setProtocolToken(address token) external;
    function setBurnAddress(address addr) external;
    function emergencyRecover(address token, uint256 amount, address to) external;
}
