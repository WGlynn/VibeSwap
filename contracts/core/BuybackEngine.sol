// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBuybackEngine.sol";

/**
 * @title BuybackEngine
 * @notice Automated buyback-and-burn for protocol token value accrual.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      Revenue flow: FeeRouter (10% buyback) → BuybackEngine → VibeAMM swap → burn
 *
 *      Set this contract as FeeRouter's buyback target address. When FeeRouter distributes,
 *      various tokens accumulate here. Anyone can call executeBuyback() to swap accumulated
 *      tokens for the protocol token via VibeAMM and burn them.
 *
 *      Cooperative capitalism:
 *        - Keeper-friendly: anyone can trigger buyback (gas incentive via gas rebate optional)
 *        - Transparent: all buyback history on-chain
 *        - Deflationary: burned tokens reduce supply permanently
 *        - Configurable: governance controls thresholds, cooldowns, slippage
 *
 *      Safety:
 *        - Minimum buyback threshold prevents dust transactions
 *        - Cooldown between buybacks prevents sandwich attacks
 *        - Slippage tolerance prevents unfavorable swaps
 *        - Emergency recovery for stuck tokens
 */
contract BuybackEngine is IBuybackEngine, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_SLIPPAGE_BPS = 2000; // 20% max
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ============ Immutables ============

    address private _amm;

    // ============ State ============

    address private _protocolToken;
    address private _burnAddress;
    uint256 private _slippageToleranceBps;
    uint256 private _cooldownPeriod;

    mapping(address => uint256) private _lastBuybackTime;
    mapping(address => uint256) private _minBuybackAmount;

    uint256 private _totalBurned;
    uint256 private _totalBuybacks;
    BuybackRecord[] private _buybackHistory;

    // ============ Constructor ============

    constructor(
        address amm_,
        address protocolToken_,
        uint256 slippageBps_,
        uint256 cooldown_
    ) Ownable(msg.sender) {
        if (amm_ == address(0)) revert ZeroAddress();
        if (protocolToken_ == address(0)) revert ZeroAddress();
        if (slippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(slippageBps_);

        _amm = amm_;
        _protocolToken = protocolToken_;
        _burnAddress = DEAD_ADDRESS;
        _slippageToleranceBps = slippageBps_;
        _cooldownPeriod = cooldown_;
    }

    // ============ Buyback Execution ============

    function executeBuyback(address token) external nonReentrant returns (uint256 burned) {
        if (token == address(0)) revert ZeroAddress();
        if (token == _protocolToken) {
            // If we receive protocol token directly, just burn it
            return _burnDirectly(token);
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        if (balance < _minBuybackAmount[token]) revert BelowMinimum(balance, _minBuybackAmount[token]);

        // Check cooldown (skip for first-ever buyback of this token)
        if (_lastBuybackTime[token] != 0 && block.timestamp < _lastBuybackTime[token] + _cooldownPeriod) {
            revert CooldownActive(_lastBuybackTime[token] + _cooldownPeriod);
        }

        // Verify pool exists for this token pair
        bytes32 poolId = _getPoolId(token, _protocolToken);
        (bool poolValid,) = _checkPool(poolId);
        if (!poolValid) revert NoPoolForToken(token);

        // Calculate minimum output with slippage tolerance
        uint256 expectedOut = _getExpectedOutput(poolId, token, balance);
        uint256 minOut = (expectedOut * (BPS - _slippageToleranceBps)) / BPS;

        // Approve and swap
        IERC20(token).safeIncreaseAllowance(_amm, balance);

        // Execute swap through AMM
        uint256 amountOut;
        try IVibeAMMSwap(_amm).swap(poolId, token, balance, minOut, address(this)) returns (uint256 out) {
            amountOut = out;
        } catch {
            // Reset allowance on failure
            IERC20(token).forceApprove(_amm, 0);
            revert InsufficientOutput(0, minOut);
        }

        // Burn the purchased protocol tokens
        burned = _burn(amountOut);

        _lastBuybackTime[token] = block.timestamp;
        _totalBuybacks++;
        _buybackHistory.push(BuybackRecord({
            tokenIn: token,
            amountIn: balance,
            amountBurned: burned,
            timestamp: block.timestamp
        }));

        emit BuybackExecuted(token, balance, amountOut, burned);
    }

    function executeBuybackMultiple(address[] calldata tokens) external returns (uint256 totalBurnedAmount) {
        for (uint256 i; i < tokens.length; ++i) {
            // Skip tokens with insufficient balance or on cooldown
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal == 0) continue;
            if (bal < _minBuybackAmount[tokens[i]]) continue;
            if (_lastBuybackTime[tokens[i]] != 0 && block.timestamp < _lastBuybackTime[tokens[i]] + _cooldownPeriod) continue;

            try this.executeBuyback(tokens[i]) returns (uint256 burned) {
                totalBurnedAmount += burned;
            } catch {
                // Skip failed buybacks, continue with others
            }
        }
    }

    // ============ Internal ============

    function _burnDirectly(address token) internal returns (uint256 burned) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();

        burned = _burn(balance);

        _lastBuybackTime[token] = block.timestamp;
        _totalBuybacks++;
        _buybackHistory.push(BuybackRecord({
            tokenIn: token,
            amountIn: balance,
            amountBurned: burned,
            timestamp: block.timestamp
        }));

        emit BuybackExecuted(token, balance, balance, burned);
    }

    function _burn(uint256 amount) internal returns (uint256) {
        IERC20(_protocolToken).safeTransfer(_burnAddress, amount);
        _totalBurned += amount;
        return amount;
    }

    function _getPoolId(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    function _checkPool(bytes32 poolId) internal view returns (bool valid, uint256 reserve0) {
        try IVibeAMMSwap(_amm).getPool(poolId) returns (IVibeAMMSwap.Pool memory pool) {
            return (pool.initialized, pool.reserve0);
        } catch {
            return (false, 0);
        }
    }

    function _getExpectedOutput(bytes32 poolId, address tokenIn, uint256 amountIn) internal view returns (uint256) {
        try IVibeAMMSwap(_amm).getPool(poolId) returns (IVibeAMMSwap.Pool memory pool) {
            if (!pool.initialized) return 0;

            bool isToken0 = tokenIn == pool.token0;
            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

            // x*y=k: amountOut = (amountIn * feeMultiplier * reserveOut) / (reserveIn * 10000 + amountIn * feeMultiplier)
            uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
            return (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
        } catch {
            return 0;
        }
    }

    // ============ Configuration ============

    function setMinBuybackAmount(address token, uint256 amount) external onlyOwner {
        _minBuybackAmount[token] = amount;
        emit MinBuybackUpdated(token, amount);
    }

    function setSlippageTolerance(uint256 bps) external onlyOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(bps);
        _slippageToleranceBps = bps;
        emit SlippageToleranceUpdated(bps);
    }

    function setCooldown(uint256 period) external onlyOwner {
        _cooldownPeriod = period;
        emit CooldownUpdated(period);
    }

    function setProtocolToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        _protocolToken = token;
        emit ProtocolTokenUpdated(token);
    }

    function setBurnAddress(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        _burnAddress = addr;
        emit BurnAddressUpdated(addr);
    }

    function emergencyRecover(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyRecovered(token, amount, to);
    }

    // ============ Views ============

    function amm() external view returns (address) { return _amm; }
    function protocolToken() external view returns (address) { return _protocolToken; }
    function burnAddress() external view returns (address) { return _burnAddress; }
    function slippageToleranceBps() external view returns (uint256) { return _slippageToleranceBps; }
    function cooldownPeriod() external view returns (uint256) { return _cooldownPeriod; }
    function lastBuybackTime(address token) external view returns (uint256) { return _lastBuybackTime[token]; }
    function minBuybackAmount(address token) external view returns (uint256) { return _minBuybackAmount[token]; }
    function totalBurned() external view returns (uint256) { return _totalBurned; }
    function totalBuybacks() external view returns (uint256) { return _totalBuybacks; }

    function getBuybackRecord(uint256 index) external view returns (BuybackRecord memory) {
        return _buybackHistory[index];
    }
}

// ============ Minimal AMM Interface ============

interface IVibeAMMSwap {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);

    function getPool(bytes32 poolId) external view returns (Pool memory);
    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32);
}
