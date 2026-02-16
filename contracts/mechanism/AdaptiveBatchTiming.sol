// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAdaptiveBatchTiming.sol";

/**
 * @title AdaptiveBatchTiming
 * @notice Dynamic commit/reveal window adjustment based on congestion and volatility.
 *         EMA smoothing prevents oscillation. Protocol self-optimizes for user experience.
 *         V1 CommitRevealAuction has hardcoded 8s/2s — this oracle provides dynamic values
 *         for a future V2 integration.
 */
contract AdaptiveBatchTiming is IAdaptiveBatchTiming, Ownable {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant EMA_ALPHA = 0.3e18; // EMA smoothing factor (30%)

    // ============ State ============

    TimingConfig public config;
    mapping(uint64 => BatchMetrics) private _metrics;

    // EMA state
    uint256 public emaOrderCount;
    uint256 public emaRevealRate;
    uint256 public emaGasPrice;

    // Current computed durations
    uint32 public currentCommitDuration;
    uint32 public currentRevealDuration;

    // Access control
    mapping(address => bool) public authorizedRecorders;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        config = TimingConfig({
            minCommit: 4,
            maxCommit: 30,
            minReveal: 2,
            maxReveal: 10,
            targetOrders: 20,
            volatilityWeight: 5000,  // 50%
            congestionWeight: 5000   // 50%
        });

        // Start with defaults matching current V1
        currentCommitDuration = 8;
        currentRevealDuration = 2;

        // Initialize EMA
        emaOrderCount = 20 * PRECISION; // target
        emaRevealRate = 8000 * PRECISION; // 80%
        emaGasPrice = 30e9 * PRECISION; // 30 gwei
    }

    // ============ Core ============

    function recordBatchMetrics(
        uint64 batchId,
        uint256 orderCount,
        uint256 revealRate,
        uint256 avgGasPrice
    ) external {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        if (_metrics[batchId].batchId != 0) revert AlreadyRecorded();

        // Update EMAs: EMA_new = alpha * value + (1 - alpha) * EMA_old
        emaOrderCount = _updateEMA(emaOrderCount, orderCount * PRECISION);
        emaRevealRate = _updateEMA(emaRevealRate, revealRate * PRECISION);
        emaGasPrice = _updateEMA(emaGasPrice, avgGasPrice * PRECISION);

        // Compute new durations
        (uint32 newCommit, uint32 newReveal) = _computeDurations();
        currentCommitDuration = newCommit;
        currentRevealDuration = newReveal;

        _metrics[batchId] = BatchMetrics({
            batchId: batchId,
            orderCount: orderCount,
            revealRate: revealRate,
            avgGasPrice: avgGasPrice,
            volatility: 0, // Set externally if needed
            computedCommitDuration: newCommit,
            computedRevealDuration: newReveal
        });

        emit MetricsRecorded(batchId, orderCount, revealRate, avgGasPrice);
        emit TimingUpdated(newCommit, newReveal, getCurrentCongestionLevel());
    }

    function setConfig(TimingConfig calldata _config) external onlyOwner {
        if (_config.minCommit == 0 || _config.minReveal == 0) revert InvalidConfig();
        if (_config.minCommit > _config.maxCommit) revert InvalidConfig();
        if (_config.minReveal > _config.maxReveal) revert InvalidConfig();
        if (_config.volatilityWeight + _config.congestionWeight > 10000) revert InvalidConfig();

        config = _config;
        emit ConfigUpdated(_config);
    }

    // ============ Admin ============

    function addRecorder(address recorder) external onlyOwner {
        if (recorder == address(0)) revert ZeroAddress();
        authorizedRecorders[recorder] = true;
    }

    function removeRecorder(address recorder) external onlyOwner {
        authorizedRecorders[recorder] = false;
    }

    // ============ Views ============

    function getCommitDuration() external view returns (uint32) {
        return currentCommitDuration;
    }

    function getRevealDuration() external view returns (uint32) {
        return currentRevealDuration;
    }

    function getBatchDuration() external view returns (uint32) {
        return currentCommitDuration + currentRevealDuration;
    }

    function getCurrentCongestionLevel() public view returns (CongestionLevel) {
        uint256 orderRatio = (emaOrderCount * 10000) / (config.targetOrders * PRECISION);

        if (orderRatio < 5000) return CongestionLevel.LOW;          // <50% of target
        if (orderRatio < 10000) return CongestionLevel.MEDIUM;      // 50-100%
        if (orderRatio < 20000) return CongestionLevel.HIGH;        // 100-200%
        return CongestionLevel.EXTREME;                              // >200%
    }

    function getConfig() external view returns (TimingConfig memory) {
        return config;
    }

    function getMetrics(uint64 batchId) external view returns (BatchMetrics memory) {
        return _metrics[batchId];
    }

    // ============ Internal ============

    function _updateEMA(uint256 emaOld, uint256 newValue) internal pure returns (uint256) {
        return (EMA_ALPHA * newValue + (PRECISION - EMA_ALPHA) * emaOld) / PRECISION;
    }

    function _computeDurations() internal view returns (uint32 commitDuration, uint32 revealDuration) {
        CongestionLevel congestion = getCurrentCongestionLevel();

        // Congestion factor: more congestion -> longer windows
        uint256 congestionFactor;
        if (congestion == CongestionLevel.LOW) {
            congestionFactor = 0;       // min durations
        } else if (congestion == CongestionLevel.MEDIUM) {
            congestionFactor = 3333;    // 1/3
        } else if (congestion == CongestionLevel.HIGH) {
            congestionFactor = 6666;    // 2/3
        } else {
            congestionFactor = 10000;   // max durations
        }

        // Reveal rate factor: low reveal rate -> longer reveal window
        uint256 revealRateNorm = emaRevealRate / PRECISION; // in bps
        uint256 revealFactor;
        if (revealRateNorm >= 9000) {
            revealFactor = 0;           // >90% reveal = fast
        } else if (revealRateNorm >= 7000) {
            revealFactor = 3333;
        } else if (revealRateNorm >= 5000) {
            revealFactor = 6666;
        } else {
            revealFactor = 10000;       // <50% reveal = need more time
        }

        // Weighted combination
        uint256 commitRange = config.maxCommit - config.minCommit;
        uint256 revealRange = config.maxReveal - config.minReveal;

        uint256 commitFactor = (congestionFactor * config.congestionWeight) / 10000;
        commitDuration = config.minCommit + uint32((commitRange * commitFactor) / 10000);

        uint256 combinedRevealFactor = (congestionFactor * config.congestionWeight + revealFactor * config.volatilityWeight) / 10000;
        revealDuration = config.minReveal + uint32((revealRange * combinedRevealFactor) / 10000);

        // Clamp
        if (commitDuration > config.maxCommit) commitDuration = config.maxCommit;
        if (revealDuration > config.maxReveal) revealDuration = config.maxReveal;
    }
}
