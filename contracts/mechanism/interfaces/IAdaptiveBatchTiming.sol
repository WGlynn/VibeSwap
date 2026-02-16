// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAdaptiveBatchTiming {

    // ============ Enums ============

    enum CongestionLevel { LOW, MEDIUM, HIGH, EXTREME }

    // ============ Structs ============

    struct TimingConfig {
        uint32 minCommit;       // minimum commit duration (seconds)
        uint32 maxCommit;       // maximum commit duration (seconds)
        uint32 minReveal;       // minimum reveal duration (seconds)
        uint32 maxReveal;       // maximum reveal duration (seconds)
        uint256 targetOrders;   // target orders per batch
        uint256 volatilityWeight;  // 0-10000 bps
        uint256 congestionWeight;  // 0-10000 bps
    }

    struct BatchMetrics {
        uint64 batchId;
        uint256 orderCount;
        uint256 revealRate;     // bps (10000 = 100% revealed)
        uint256 avgGasPrice;
        uint256 volatility;     // from VolatilityOracle, annualized bps
        uint32 computedCommitDuration;
        uint32 computedRevealDuration;
    }

    // ============ Events ============

    event MetricsRecorded(uint64 indexed batchId, uint256 orderCount, uint256 revealRate, uint256 avgGasPrice);
    event TimingUpdated(uint32 commitDuration, uint32 revealDuration, CongestionLevel congestionLevel);
    event ConfigUpdated(TimingConfig config);

    // ============ Errors ============

    error InvalidConfig();
    error NotAuthorized();
    error ZeroAddress();
    error AlreadyRecorded();

    // ============ Core ============

    function recordBatchMetrics(uint64 batchId, uint256 orderCount, uint256 revealRate, uint256 avgGasPrice) external;
    function setConfig(TimingConfig calldata config) external;

    // ============ Views ============

    function getCommitDuration() external view returns (uint32);
    function getRevealDuration() external view returns (uint32);
    function getBatchDuration() external view returns (uint32);
    function getCurrentCongestionLevel() external view returns (CongestionLevel);
    function getConfig() external view returns (TimingConfig memory);
    function getMetrics(uint64 batchId) external view returns (BatchMetrics memory);
}
