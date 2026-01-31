// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../core/interfaces/ICommitRevealAuction.sol";

/**
 * @title IIncentiveController
 * @notice Central coordinator for all incentive mechanisms
 */
interface IIncentiveController {
    // Events
    event VolatilityFeeRouted(bytes32 indexed poolId, address token, uint256 amount);
    event AuctionProceedsDistributed(uint64 indexed batchId, uint256 totalAmount);
    event LiquidityAdded(bytes32 indexed poolId, address indexed lp, uint256 liquidity, uint256 entryPrice);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed lp, uint256 liquidity);
    event ExecutionRecorded(bytes32 indexed poolId, address indexed trader, uint256 amountIn, uint256 amountOut);
    event ILProtectionClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event SlippageCompensationClaimed(bytes32 indexed claimId, address indexed trader, uint256 amount);
    event LoyaltyRewardsClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);

    // Structs
    struct IncentiveConfig {
        uint256 volatilityFeeRatioBps;     // % of dynamic fees to volatility pool
        uint256 auctionToLPRatioBps;       // % of auction proceeds to LPs
        uint256 ilProtectionCapBps;        // Max IL coverage %
        uint256 slippageGuaranteeCapBps;   // Max slippage coverage
        uint256 loyaltyBoostMaxBps;        // Max loyalty multiplier
    }

    struct PoolIncentiveStats {
        uint256 volatilityReserve;
        uint256 ilReserve;
        uint256 slippageReserve;
        uint256 totalLoyaltyStaked;
        uint256 totalAuctionProceedsDistributed;
    }

    // Fee routing
    function routeVolatilityFee(bytes32 poolId, address token, uint256 amount) external;
    function distributeAuctionProceeds(uint64 batchId, bytes32[] calldata poolIds, uint256[] calldata amounts) external payable;

    // LP lifecycle hooks
    function onLiquidityAdded(bytes32 poolId, address lp, uint256 liquidity, uint256 entryPrice) external;
    function onLiquidityRemoved(bytes32 poolId, address lp, uint256 liquidity) external;

    // Execution tracking
    function recordExecution(
        bytes32 poolId,
        address trader,
        uint256 amountIn,
        uint256 amountOut,
        uint256 expectedMinOut
    ) external returns (bytes32 claimId);

    // Claims
    function claimILProtection(bytes32 poolId) external returns (uint256 amount);
    function claimSlippageCompensation(bytes32 claimId) external returns (uint256 amount);
    function claimLoyaltyRewards(bytes32 poolId) external returns (uint256 amount);
    function claimAuctionProceeds(bytes32 poolId) external returns (uint256 amount);

    // View functions
    function getPoolIncentiveStats(bytes32 poolId) external view returns (PoolIncentiveStats memory);
    function getPoolConfig(bytes32 poolId) external view returns (IncentiveConfig memory);
    function getPendingILClaim(bytes32 poolId, address lp) external view returns (uint256);
    function getPendingLoyaltyRewards(bytes32 poolId, address lp) external view returns (uint256);
    function getPendingAuctionProceeds(bytes32 poolId, address lp) external view returns (uint256);

    // Admin
    function setPoolConfig(bytes32 poolId, IncentiveConfig calldata config) external;
    function setDefaultConfig(IncentiveConfig calldata config) external;
}
