// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITreasuryStabilizer
 * @notice Interface for counter-cyclical treasury operations
 */
interface ITreasuryStabilizer {
    // Events
    event MarketAssessed(address indexed token, int256 trend, bool isBearMarket);
    event BackstopDeployed(address indexed token, bytes32 indexed poolId, uint256 amount);
    event BackstopWithdrawn(address indexed token, bytes32 indexed poolId, uint256 amount);
    event ConfigUpdated(address indexed token, StabilizerConfig config);
    event EmergencyModeActivated(address indexed token);
    event EmergencyModeDeactivated(address indexed token);

    // Structs
    struct StabilizerConfig {
        uint256 bearMarketThresholdBps;   // % decline to trigger (2000 = 20%)
        uint256 deploymentRateBps;        // % of treasury to deploy per period
        uint256 maxDeploymentPerPeriod;   // Absolute max per period
        uint64 assessmentPeriod;          // Seconds between assessments
        uint64 deploymentCooldown;        // Minimum seconds between deployments
        bool enabled;
    }

    struct MarketState {
        int256 currentTrend;              // Trend in bps (negative = declining)
        uint64 lastAssessment;
        bool isBearMarket;
        uint256 totalDeployed;
        uint256 deployedThisPeriod;
        uint64 periodStart;
    }

    struct DeploymentRecord {
        bytes32 poolId;
        uint256 amount;
        uint64 timestamp;
        uint256 lpTokensReceived;
    }

    // Market assessment
    function assessMarketConditions(address token) external;
    function isBearMarket(address token) external view returns (bool);
    function getMarketState(address token) external view returns (MarketState memory);

    // Deployment
    function shouldDeployBackstop(address token) external view returns (bool should, uint256 amount);
    function executeDeployment(address token, bytes32 poolId) external returns (uint256 deployed);
    function withdrawDeployment(address token, bytes32 poolId, uint256 lpAmount) external returns (uint256 received);

    // View functions
    function getConfig(address token) external view returns (StabilizerConfig memory);
    function getDeploymentHistory(address token) external view returns (DeploymentRecord[] memory);
    function getAvailableForDeployment(address token) external view returns (uint256);

    // Admin
    function setConfig(address token, StabilizerConfig calldata config) external;
    function setEmergencyMode(address token, bool enabled) external;
    function pause() external;
    function unpause() external;
}
