// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IILProtectionVault
 * @notice Interface for impermanent loss protection vault
 */
interface IILProtectionVault {
    // Events
    event PositionRegistered(bytes32 indexed poolId, address indexed lp, uint256 liquidity, uint256 entryPrice, uint8 tier);
    event PositionUpdated(bytes32 indexed poolId, address indexed lp, uint256 newLiquidity);
    event PositionClosed(bytes32 indexed poolId, address indexed lp, uint256 ilAmount, uint256 compensation);
    event ProtectionClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event TierConfigured(uint8 tier, uint256 coverageRateBps, uint64 minDuration);
    event FundsDeposited(address token, uint256 amount);

    // Structs
    struct LPPosition {
        uint256 liquidity;
        uint256 entryPrice;           // TWAP at deposit time (scaled 1e18)
        uint64 depositTimestamp;
        uint256 ilAccrued;
        uint256 ilClaimed;
        uint8 protectionTier;         // 0=basic, 1=standard, 2=premium
    }

    struct TierConfig {
        uint256 coverageRateBps;      // Max coverage percentage (10000 = 100%)
        uint64 minDuration;           // Minimum stake duration for this tier
        bool active;
    }

    // Position management
    function registerPosition(
        bytes32 poolId,
        address lp,
        uint256 liquidity,
        uint256 entryPrice,
        uint8 tier
    ) external;

    function updatePosition(bytes32 poolId, address lp, uint256 newLiquidity) external;

    function closePosition(bytes32 poolId, address lp, uint256 exitPrice) external returns (uint256 ilAmount, uint256 compensation);

    // IL calculation
    function calculateIL(uint256 entryPrice, uint256 exitPrice) external pure returns (uint256 ilBps);
    function calculateCurrentIL(bytes32 poolId, address lp) external view returns (uint256 ilBps);

    // Claims
    function claimProtection(bytes32 poolId, address lp) external returns (uint256 amount);
    function getClaimableAmount(bytes32 poolId, address lp) external view returns (uint256);

    // View functions
    function getPosition(bytes32 poolId, address lp) external view returns (LPPosition memory);
    function getTierConfig(uint8 tier) external view returns (TierConfig memory);
    function getTotalReserves(address token) external view returns (uint256);

    // Admin
    function configureTier(uint8 tier, uint256 coverageRateBps, uint64 minDuration) external;
    function depositFunds(address token, uint256 amount) external;
}
