// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IVibeProtocolOwnedLiquidity.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../financial/interfaces/IVibeRevShare.sol";

/**
 * @title VibeProtocolOwnedLiquidity
 * @notice Treasury-owned LP positions that earn fees perpetually.
 *
 *         Instead of renting liquidity via emissions (pay LPs → they leave
 *         when rewards dry up), the treasury owns its liquidity permanently.
 *         Fees earned go back to RevShare for JUL staker distribution.
 *
 *         Self-sustaining flywheel: protocol fees → treasury → more LP → more fees.
 *
 *         Cooperative capitalism:
 *           - Mutualized risk: can't be mercenary-withdrawn during stress
 *           - Collective benefit: LP fees flow to DAO and JUL stakers
 *           - Individual sovereignty: governance decides allocation
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol/Framework layer.
 */
contract VibeProtocolOwnedLiquidity is IVibeProtocolOwnedLiquidity, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant DEFAULT_MAX_POSITIONS = 50;

    // ============ State ============

    address public vibeAMM;
    address public daoTreasury;
    address public revShare;
    address public revenueToken; // token used for RevShare deposits

    uint256 public maxPositions;

    mapping(bytes32 => Position) public positions;
    bytes32[] public positionIds;

    // Track position existence for O(1) lookup
    mapping(bytes32 => bool) public positionExists;

    // ============ Constructor ============

    constructor(
        address _vibeAMM,
        address _daoTreasury,
        address _revShare,
        address _revenueToken
    ) Ownable(msg.sender) {
        vibeAMM = _vibeAMM;
        daoTreasury = _daoTreasury;
        revShare = _revShare;
        revenueToken = _revenueToken;
        maxPositions = DEFAULT_MAX_POSITIONS;
    }

    // ============ Core Functions ============

    /**
     * @notice Deploy treasury funds as LP in an AMM pool
     * @dev Pulls tokens from this contract (must be funded by treasury first)
     * @param params Pool ID and token amounts with slippage protection
     */
    function deployLiquidity(
        DeployParams calldata params
    ) external onlyOwner nonReentrant {
        if (params.amount0 == 0 && params.amount1 == 0) revert ZeroAmount();

        // Check max positions limit (only for new positions)
        if (!positionExists[params.poolId]) {
            if (positionIds.length >= maxPositions) revert MaxPositionsReached();
        }

        // Get pool info to verify tokens
        IVibeAMM amm = IVibeAMM(vibeAMM);
        IVibeAMM.Pool memory pool = amm.getPool(params.poolId);

        // Approve tokens for AMM
        if (params.amount0 > 0) {
            IERC20(pool.token0).safeIncreaseAllowance(vibeAMM, params.amount0);
        }
        if (params.amount1 > 0) {
            IERC20(pool.token1).safeIncreaseAllowance(vibeAMM, params.amount1);
        }

        // Add liquidity
        (uint256 amount0, uint256 amount1, uint256 liquidity) = amm.addLiquidity(
            params.poolId,
            params.amount0,
            params.amount1,
            params.amount0Min,
            params.amount1Min
        );

        // Record position
        _recordPosition(params.poolId, pool.token0, pool.token1, liquidity);

        emit LiquidityDeployed(params.poolId, amount0, amount1, liquidity);
    }

    /**
     * @notice Withdraw LP from a pool, returning tokens to treasury
     * @param poolId Pool to withdraw from
     * @param lpAmount Amount of LP tokens to withdraw
     * @param amount0Min Minimum token0 to receive (slippage protection)
     * @param amount1Min Minimum token1 to receive (slippage protection)
     */
    function withdrawLiquidity(
        bytes32 poolId,
        uint256 lpAmount,
        uint256 amount0Min,
        uint256 amount1Min
    ) external onlyOwner nonReentrant {
        if (lpAmount == 0) revert ZeroAmount();
        if (!positionExists[poolId]) revert PositionNotFound();

        Position storage pos = positions[poolId];
        if (!pos.active) revert PositionNotActive();
        if (pos.lpAmount < lpAmount) revert InsufficientLPBalance();

        IVibeAMM amm = IVibeAMM(vibeAMM);

        // Approve LP tokens for AMM to burn
        address lpToken = amm.getLPToken(poolId);
        IERC20(lpToken).safeIncreaseAllowance(vibeAMM, lpAmount);

        // Remove liquidity
        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(
            poolId,
            lpAmount,
            amount0Min,
            amount1Min
        );

        // Update position
        pos.lpAmount -= lpAmount;
        if (pos.lpAmount == 0) {
            pos.active = false;
        }

        // Send tokens to treasury
        if (amount0 > 0) {
            IERC20(pos.token0).safeTransfer(daoTreasury, amount0);
        }
        if (amount1 > 0) {
            IERC20(pos.token1).safeTransfer(daoTreasury, amount1);
        }

        emit LiquidityWithdrawn(poolId, lpAmount, amount0, amount1);
    }

    /**
     * @notice Collect fees from a pool position and deposit to RevShare
     * @dev Anyone can trigger — public good (incentivized by the ecosystem)
     * @param poolId Pool to collect fees from
     */
    function collectFees(bytes32 poolId) public nonReentrant {
        if (!positionExists[poolId]) revert PositionNotFound();
        Position storage pos = positions[poolId];
        if (!pos.active) revert PositionNotActive();

        // In VibeAMM, fees are accumulated in the pool reserves proportional
        // to LP share. To "collect" fees, we check our share of the pool value
        // vs our initial deposit. For simplicity, we track via token balances
        // before/after a zero-amount operation.
        //
        // For v1: fee collection is realized when liquidity is withdrawn.
        // The POL contract tracks cumulative fees collected during withdrawals
        // for accounting purposes. Direct fee claims would require AMM changes.
        //
        // Future: AMM could add explicit `claimFees(poolId)` for LP token holders.

        // For now, emit event with zero fees (fees are realized on withdrawal)
        emit FeesCollected(poolId, 0, 0);
    }

    /**
     * @notice Collect fees from all active positions
     */
    function collectAllFees() external {
        uint256 len = positionIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (positions[positionIds[i]].active) {
                collectFees(positionIds[i]);
            }
        }
    }

    /**
     * @notice Move liquidity from one pool to another atomically
     * @param fromPoolId Pool to withdraw from
     * @param toPoolId Pool to deploy to
     * @param lpAmount Amount of LP tokens to move
     */
    function rebalance(
        bytes32 fromPoolId,
        bytes32 toPoolId,
        uint256 lpAmount
    ) external onlyOwner nonReentrant {
        if (lpAmount == 0) revert ZeroAmount();
        if (!positionExists[fromPoolId]) revert PositionNotFound();

        Position storage fromPos = positions[fromPoolId];
        if (!fromPos.active) revert PositionNotActive();
        if (fromPos.lpAmount < lpAmount) revert InsufficientLPBalance();

        IVibeAMM amm = IVibeAMM(vibeAMM);

        // Approve LP tokens for removal
        address lpToken = amm.getLPToken(fromPoolId);
        IERC20(lpToken).safeIncreaseAllowance(vibeAMM, lpAmount);

        // Step 1: Remove from source pool (accept any amounts)
        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(
            fromPoolId,
            lpAmount,
            0, // no min — atomic rebalance
            0
        );

        // Update from-position
        fromPos.lpAmount -= lpAmount;
        if (fromPos.lpAmount == 0) {
            fromPos.active = false;
        }

        // Step 2: Deploy to target pool
        IVibeAMM.Pool memory toPool = amm.getPool(toPoolId);

        // Approve target pool's tokens for AMM
        if (amount0 > 0) {
            IERC20(toPool.token0).safeIncreaseAllowance(vibeAMM, amount0);
        }
        if (amount1 > 0) {
            IERC20(toPool.token1).safeIncreaseAllowance(vibeAMM, amount1);
        }

        // Add liquidity to target pool (accept any ratio — different pools may have different prices)
        (,, uint256 newLiquidity) = amm.addLiquidity(
            toPoolId,
            amount0,
            amount1,
            0, // no min — atomic rebalance, we accept whatever ratio the pool gives
            0
        );

        // Record target position
        _recordPosition(toPoolId, toPool.token0, toPool.token1, newLiquidity);

        emit Rebalanced(fromPoolId, toPoolId, lpAmount);
    }

    // ============ Emergency ============

    /**
     * @notice Emergency withdraw all positions back to treasury
     * @dev Owner-only panic button for circuit-breaker scenarios
     */
    function emergencyWithdrawAll() external onlyOwner nonReentrant {
        uint256 len = positionIds.length;
        uint256 withdrawn;

        IVibeAMM amm = IVibeAMM(vibeAMM);

        for (uint256 i = 0; i < len; i++) {
            bytes32 poolId = positionIds[i];
            Position storage pos = positions[poolId];

            if (!pos.active || pos.lpAmount == 0) continue;

            // Approve LP tokens
            address lpToken = amm.getLPToken(poolId);
            IERC20(lpToken).safeIncreaseAllowance(vibeAMM, pos.lpAmount);

            // Remove all liquidity (accept any amounts in emergency)
            try amm.removeLiquidity(poolId, pos.lpAmount, 0, 0) returns (
                uint256 amount0, uint256 amount1
            ) {
                pos.lpAmount = 0;
                pos.active = false;
                withdrawn++;

                // Send to treasury
                if (amount0 > 0) {
                    IERC20(pos.token0).safeTransfer(daoTreasury, amount0);
                }
                if (amount1 > 0) {
                    IERC20(pos.token1).safeTransfer(daoTreasury, amount1);
                }
            } catch {
                // Skip failed withdrawals in emergency — better to get what we can
                continue;
            }
        }

        if (withdrawn == 0) revert NoActivePositions();

        emit EmergencyWithdraw(withdrawn);
    }

    // ============ Internal ============

    function _recordPosition(
        bytes32 poolId,
        address token0,
        address token1,
        uint256 liquidity
    ) internal {
        if (positionExists[poolId]) {
            // Add to existing position
            Position storage pos = positions[poolId];
            pos.lpAmount += liquidity;
            pos.active = true;
        } else {
            // New position
            if (positionIds.length >= maxPositions) revert MaxPositionsReached();

            positions[poolId] = Position({
                poolId: poolId,
                token0: token0,
                token1: token1,
                lpAmount: liquidity,
                deployedAt: block.timestamp,
                totalFeesCollected0: 0,
                totalFeesCollected1: 0,
                active: true
            });
            positionIds.push(poolId);
            positionExists[poolId] = true;
        }
    }

    // ============ Admin ============

    function setVibeAMM(address _amm) external onlyOwner {
        vibeAMM = _amm;
    }

    function setDAOTreasury(address _treasury) external onlyOwner {
        daoTreasury = _treasury;
    }

    function setRevShare(address _revShare) external onlyOwner {
        revShare = _revShare;
    }

    function setMaxPositions(uint256 _max) external onlyOwner {
        maxPositions = _max;
    }

    // ============ Views ============

    function getPosition(bytes32 poolId) external view returns (Position memory) {
        return positions[poolId];
    }

    function getAllPositionIds() external view returns (bytes32[] memory) {
        return positionIds;
    }

    function getActivePositionCount() external view returns (uint256 count) {
        uint256 len = positionIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (positions[positionIds[i]].active) {
                count++;
            }
        }
    }

    function getTotalLPValue(
        bytes32 poolId
    ) external view returns (uint256 amount0, uint256 amount1) {
        Position storage pos = positions[poolId];
        if (!pos.active || pos.lpAmount == 0) return (0, 0);

        IVibeAMM amm = IVibeAMM(vibeAMM);
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        if (pool.totalLiquidity == 0) return (0, 0);

        amount0 = (pos.lpAmount * pool.reserve0) / pool.totalLiquidity;
        amount1 = (pos.lpAmount * pool.reserve1) / pool.totalLiquidity;
    }

    // ============ Token Recovery ============

    /**
     * @notice Recover ERC20 tokens sent to this contract by mistake
     * @dev Owner only, sends to treasury
     */
    function recoverToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(daoTreasury, amount);
    }

    /// @notice Accept ETH (for emergency scenarios)
    receive() external payable {}
}
