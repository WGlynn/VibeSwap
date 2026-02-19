// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVibeHook.sol";

/**
 * @title DynamicFeeHook
 * @notice First concrete IVibeHook implementation — adjusts fees based on volatility.
 * @dev Part of VSOS (VibeSwap Operating System) hooks layer.
 *
 *      Attached to pools via VibeHookRegistry. Operates on BEFORE_SWAP and AFTER_SWAP
 *      hook points to implement dynamic fee adjustment.
 *
 *      Fee adjustment logic:
 *        - Tracks recent swap volumes per pool
 *        - High volume → higher fees (surge pricing protects LPs during volatility)
 *        - Low volume → base fees (competitive pricing during calm markets)
 *        - Fee multiplier = baseFee * (1 + surgeMultiplier * volumeRatio)
 *
 *      The hook doesn't modify pool state directly — it returns encoded fee
 *      recommendations that the pool can read via returnData.
 *
 *      Cooperative capitalism:
 *        - LPs protected during high-volatility events (higher fees)
 *        - Traders get lower fees during calm markets (competitive)
 *        - Transparent: fee formula is on-chain and verifiable
 *        - Configurable: governance controls surge parameters
 */
contract DynamicFeeHook is IVibeHook, Ownable {
    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint8 private constant FLAG_BEFORE_SWAP = 16; // bit 4
    uint8 private constant FLAG_AFTER_SWAP = 32;  // bit 5

    // ============ State ============

    uint256 public baseFeeBps;         // Default fee in BPS (e.g., 30 = 0.3%)
    uint256 public maxFeeBps;          // Maximum fee cap
    uint256 public surgeThreshold;     // Volume threshold for surge pricing (in wei)
    uint256 public surgeMultiplierBps; // How much to increase fee per threshold exceeded (in BPS)
    uint256 public windowDuration;     // Volume tracking window (seconds)

    struct PoolVolume {
        uint256 totalVolume;     // Total volume in current window
        uint256 windowStart;     // When current window began
        uint256 swapCount;       // Number of swaps in current window
        uint256 lastFeeApplied;  // Last dynamic fee (for transparency)
    }

    mapping(bytes32 => PoolVolume) public poolVolumes;

    // ============ Events ============

    event DynamicFeeCalculated(bytes32 indexed poolId, uint256 baseFee, uint256 dynamicFee, uint256 volume);
    event SwapRecorded(bytes32 indexed poolId, uint256 volume, uint256 totalWindowVolume);
    event ParametersUpdated(uint256 baseFeeBps, uint256 maxFeeBps, uint256 surgeThreshold, uint256 surgeMultiplierBps);

    // ============ Errors ============

    error InvalidFee();
    error InvalidThreshold();

    // ============ Constructor ============

    constructor(
        uint256 baseFeeBps_,
        uint256 maxFeeBps_,
        uint256 surgeThreshold_,
        uint256 surgeMultiplierBps_,
        uint256 windowDuration_
    ) Ownable(msg.sender) {
        if (baseFeeBps_ > BPS) revert InvalidFee();
        if (maxFeeBps_ > BPS) revert InvalidFee();
        if (maxFeeBps_ < baseFeeBps_) revert InvalidFee();
        if (surgeThreshold_ == 0) revert InvalidThreshold();

        baseFeeBps = baseFeeBps_;
        maxFeeBps = maxFeeBps_;
        surgeThreshold = surgeThreshold_;
        surgeMultiplierBps = surgeMultiplierBps_;
        windowDuration = windowDuration_;
    }

    // ============ IVibeHook Implementation ============

    function getHookFlags() external pure override returns (uint8) {
        return FLAG_BEFORE_SWAP | FLAG_AFTER_SWAP;
    }

    function beforeCommit(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function afterCommit(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function beforeSettle(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function afterSettle(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    /**
     * @notice Called before a swap — returns recommended dynamic fee.
     * @param poolId The pool being swapped
     * @param data Encoded swap amount (uint256)
     * @return Encoded dynamic fee in BPS (uint256)
     */
    function beforeSwap(bytes32 poolId, bytes calldata data) external override returns (bytes memory) {
        uint256 swapAmount;
        if (data.length >= 32) {
            swapAmount = abi.decode(data, (uint256));
        }

        // Reset window if expired
        PoolVolume storage vol = poolVolumes[poolId];
        if (block.timestamp >= vol.windowStart + windowDuration) {
            vol.totalVolume = 0;
            vol.swapCount = 0;
            vol.windowStart = block.timestamp;
        }

        // Calculate dynamic fee based on current window volume
        uint256 dynamicFee = _calculateDynamicFee(vol.totalVolume + swapAmount);

        vol.lastFeeApplied = dynamicFee;

        emit DynamicFeeCalculated(poolId, baseFeeBps, dynamicFee, vol.totalVolume);

        return abi.encode(dynamicFee);
    }

    /**
     * @notice Called after a swap — records volume for future fee calculations.
     * @param poolId The pool that was swapped
     * @param data Encoded swap amount (uint256)
     * @return Empty bytes
     */
    function afterSwap(bytes32 poolId, bytes calldata data) external override returns (bytes memory) {
        uint256 swapAmount;
        if (data.length >= 32) {
            swapAmount = abi.decode(data, (uint256));
        }

        PoolVolume storage vol = poolVolumes[poolId];

        // Reset window if expired
        if (block.timestamp >= vol.windowStart + windowDuration) {
            vol.totalVolume = 0;
            vol.swapCount = 0;
            vol.windowStart = block.timestamp;
        }

        vol.totalVolume += swapAmount;
        vol.swapCount++;

        emit SwapRecorded(poolId, swapAmount, vol.totalVolume);

        return "";
    }

    // ============ Internal ============

    function _calculateDynamicFee(uint256 windowVolume) internal view returns (uint256) {
        if (windowVolume <= surgeThreshold) {
            return baseFeeBps;
        }

        // How many thresholds exceeded
        uint256 surgeLevel = (windowVolume - surgeThreshold) / surgeThreshold;

        // fee = baseFee + baseFee * surgeLevel * surgeMultiplier / BPS
        uint256 surgeIncrease = (baseFeeBps * surgeLevel * surgeMultiplierBps) / BPS;
        uint256 dynamicFee = baseFeeBps + surgeIncrease;

        // Cap at maximum
        if (dynamicFee > maxFeeBps) {
            dynamicFee = maxFeeBps;
        }

        return dynamicFee;
    }

    // ============ Configuration ============

    function setParameters(
        uint256 baseFeeBps_,
        uint256 maxFeeBps_,
        uint256 surgeThreshold_,
        uint256 surgeMultiplierBps_
    ) external onlyOwner {
        if (baseFeeBps_ > BPS) revert InvalidFee();
        if (maxFeeBps_ > BPS) revert InvalidFee();
        if (maxFeeBps_ < baseFeeBps_) revert InvalidFee();
        if (surgeThreshold_ == 0) revert InvalidThreshold();

        baseFeeBps = baseFeeBps_;
        maxFeeBps = maxFeeBps_;
        surgeThreshold = surgeThreshold_;
        surgeMultiplierBps = surgeMultiplierBps_;

        emit ParametersUpdated(baseFeeBps_, maxFeeBps_, surgeThreshold_, surgeMultiplierBps_);
    }

    function setWindowDuration(uint256 duration) external onlyOwner {
        windowDuration = duration;
    }

    // ============ Views ============

    function getPoolVolume(bytes32 poolId) external view returns (PoolVolume memory) {
        return poolVolumes[poolId];
    }

    function calculateFeeForVolume(uint256 volume) external view returns (uint256) {
        return _calculateDynamicFee(volume);
    }
}
