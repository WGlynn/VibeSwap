// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISlippageGuaranteeFund
 * @notice Interface for trader slippage protection fund
 */
interface ISlippageGuaranteeFund {
    // Events
    event ExecutionRecorded(bytes32 indexed claimId, bytes32 indexed poolId, address indexed trader, uint256 shortfall);
    event ClaimProcessed(bytes32 indexed claimId, address indexed trader, uint256 compensation);
    event ClaimExpired(bytes32 indexed claimId);
    event FundsDeposited(address token, uint256 amount);
    event ConfigUpdated(uint256 maxClaimPercentBps, uint256 userDailyLimitBps, uint256 claimWindow);

    // Structs
    struct SlippageClaim {
        address trader;
        bytes32 poolId;
        address token;
        uint256 expectedOutput;
        uint256 actualOutput;
        uint256 shortfall;
        uint256 eligibleCompensation;
        uint64 timestamp;
        bool processed;
        bool expired;
    }

    struct UserClaimState {
        uint256 claimedToday;
        uint64 lastClaimDay;          // Day number for daily reset
        uint256 totalLifetimeClaims;
    }

    struct FundConfig {
        uint256 maxClaimPercentBps;   // Max claim as % of trade (200 = 2%)
        uint256 userDailyLimitBps;    // Daily limit as % of trade volume
        uint64 claimWindow;           // Seconds to claim after execution
        uint256 minShortfallBps;      // Minimum shortfall to qualify (50 = 0.5%)
    }

    // Execution recording
    function recordExecution(
        bytes32 poolId,
        address trader,
        address token,
        uint256 expectedOut,
        uint256 actualOut
    ) external returns (bytes32 claimId);

    // Claims
    function processClaim(bytes32 claimId) external returns (uint256 compensation);
    function expireClaim(bytes32 claimId) external;

    // View functions
    function getClaim(bytes32 claimId) external view returns (SlippageClaim memory);
    function getUserState(address user) external view returns (UserClaimState memory);
    function getUserRemainingLimit(address user) external view returns (uint256);
    function getConfig() external view returns (FundConfig memory);
    function getTotalReserves(address token) external view returns (uint256);
    function canClaim(bytes32 claimId) external view returns (bool eligible, string memory reason);

    // Admin
    function setConfig(FundConfig calldata config) external;
    function depositFunds(address token, uint256 amount) external;
    function withdrawExcess(address token, uint256 amount, address recipient) external;
}
