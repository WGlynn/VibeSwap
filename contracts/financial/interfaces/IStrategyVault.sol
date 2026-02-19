// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStrategy
 * @notice Interface for pluggable yield strategies used by StrategyVault.
 */
interface IStrategy {
    /// @notice The underlying asset this strategy manages
    function asset() external view returns (address);

    /// @notice The vault that owns this strategy
    function vault() external view returns (address);

    /// @notice Total assets under management in the strategy
    function totalAssets() external view returns (uint256);

    /// @notice Deploy assets into the strategy
    function deposit(uint256 amount) external;

    /// @notice Withdraw assets from the strategy back to vault
    function withdraw(uint256 amount) external returns (uint256 actualWithdrawn);

    /// @notice Harvest profits and return them to the vault
    function harvest() external returns (uint256 profit);

    /// @notice Emergency exit — pull everything back to vault regardless of loss
    function emergencyWithdraw() external returns (uint256 recovered);
}

/**
 * @title IStrategyVault
 * @notice ERC-4626 vault with pluggable yield strategies.
 *         Part of VSOS DeFi/DeFAI layer.
 */
interface IStrategyVault {
    // ============ Events ============

    event StrategyProposed(address indexed strategy, uint256 activationTime);
    event StrategyActivated(address indexed strategy);
    event StrategyMigrated(address indexed oldStrategy, address indexed newStrategy);
    event Harvested(uint256 profit, uint256 performanceFee, uint256 managementFee);
    event DepositCapUpdated(uint256 newCap);
    event EmergencyShutdown(bool active);
    event FeesUpdated(uint256 performanceFeeBps, uint256 managementFeeBps);
    event FeeRecipientUpdated(address indexed newRecipient);
    event FeeRouterUpdated(address indexed newRouter);

    // ============ Errors ============

    error DepositCapExceeded();
    error NoStrategy();
    error EmergencyActive();
    error NotEmergency();
    error ZeroAddress();
    error ZeroAmount();
    error ExcessiveFee();
    error TimelockActive();
    error NoProposedStrategy();
    error TimelockNotElapsed();
    error StrategyAssetMismatch();
    error NothingToHarvest();

    // ============ Views ============

    function strategy() external view returns (address);
    function proposedStrategy() external view returns (address);
    function strategyActivationTime() external view returns (uint256);
    function depositCap() external view returns (uint256);
    function performanceFeeBps() external view returns (uint256);
    function managementFeeBps() external view returns (uint256);
    function feeRecipient() external view returns (address);
    function lastHarvestTime() external view returns (uint256);
    function emergencyShutdownActive() external view returns (bool);
    function strategyTimelock() external view returns (uint256);
    function feeRouter() external view returns (address);

    // ============ Actions ============

    function proposeStrategy(address newStrategy) external;
    function activateStrategy() external;
    function harvest() external returns (uint256 profit);
    function setDepositCap(uint256 cap) external;
    function setFees(uint256 performanceBps, uint256 managementBps) external;
    function setFeeRecipient(address recipient) external;
    function setEmergencyShutdown(bool active) external;
    function setFeeRouter(address router) external;
}
