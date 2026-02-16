// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeProtocolOwnedLiquidity
 * @notice Interface for protocol-owned liquidity management.
 *
 *         Instead of renting liquidity via emissions (mercenary capital),
 *         the treasury owns LP positions permanently. Fees flow back to
 *         the DAO and JUL stakers via RevShare — self-sustaining flywheel.
 *
 *         Cooperative capitalism: mutualized risk (can't be mercenary-withdrawn),
 *         collective benefit (fees to community), individual sovereignty
 *         (governance decides allocation).
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol/Framework layer.
 */
interface IVibeProtocolOwnedLiquidity {
    // ============ Structs ============

    struct Position {
        bytes32 poolId;
        address token0;
        address token1;
        uint256 lpAmount;
        uint256 deployedAt;
        uint256 totalFeesCollected0;
        uint256 totalFeesCollected1;
        bool active;
    }

    struct DeployParams {
        bytes32 poolId;
        uint256 amount0;
        uint256 amount1;
        uint256 amount0Min;
        uint256 amount1Min;
    }

    // ============ Events ============

    event LiquidityDeployed(bytes32 indexed poolId, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event LiquidityWithdrawn(bytes32 indexed poolId, uint256 lpAmount, uint256 amount0, uint256 amount1);
    event FeesCollected(bytes32 indexed poolId, uint256 amount0, uint256 amount1);
    event Rebalanced(bytes32 indexed fromPool, bytes32 indexed toPool, uint256 lpAmount);
    event EmergencyWithdraw(uint256 positionsWithdrawn);

    // ============ Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error PositionNotFound();
    error PositionNotActive();
    error InsufficientLPBalance();
    error MaxPositionsReached();
    error NoActivePositions();

    // ============ Core Functions ============

    function deployLiquidity(DeployParams calldata params) external;
    function withdrawLiquidity(bytes32 poolId, uint256 lpAmount, uint256 amount0Min, uint256 amount1Min) external;
    function collectFees(bytes32 poolId) external;
    function collectAllFees() external;
    function rebalance(bytes32 fromPoolId, bytes32 toPoolId, uint256 lpAmount) external;

    // ============ Emergency ============

    function emergencyWithdrawAll() external;

    // ============ Admin ============

    function setVibeAMM(address amm) external;
    function setDAOTreasury(address treasury) external;
    function setRevShare(address revShare) external;
    function setMaxPositions(uint256 max) external;

    // ============ Views ============

    function getPosition(bytes32 poolId) external view returns (Position memory);
    function getAllPositionIds() external view returns (bytes32[] memory);
    function getActivePositionCount() external view returns (uint256);
    function getTotalLPValue(bytes32 poolId) external view returns (uint256 amount0, uint256 amount1);
}
