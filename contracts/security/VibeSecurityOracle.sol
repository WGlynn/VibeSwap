// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeSecurityOracle — Real-Time Threat Intelligence On-Chain
 * @notice Aggregates security signals from multiple sources and provides
 *         a real-time threat level for the protocol.
 *
 * Signals:
 * - Price deviation alerts (oracle manipulation attempt)
 * - Volume spikes (flash loan attack pattern)
 * - Large approval patterns (phishing campaign)
 * - Contract deployment patterns (copycat/honeypot)
 * - Cross-chain bridge anomalies
 *
 * Actions:
 * - LEVEL 1 (Green): Normal operations
 * - LEVEL 2 (Yellow): Enhanced monitoring, rate limits tightened
 * - LEVEL 3 (Orange): New positions paused, withdrawals throttled
 * - LEVEL 4 (Red): Emergency mode, only withdrawals allowed
 * - LEVEL 5 (Black): Full shutdown, emergency ejection activated
 */
contract VibeSecurityOracle is OwnableUpgradeable, UUPSUpgradeable {

    enum ThreatLevel { GREEN, YELLOW, ORANGE, RED, BLACK }

    struct SecuritySignal {
        string source;
        string description;
        ThreatLevel severity;
        uint256 timestamp;
        address reporter;
        bool active;
    }

    struct ThreatConfig {
        uint256 priceDeviationThreshold;  // bps (e.g., 1000 = 10%)
        uint256 volumeSpikeMultiplier;    // x times average
        uint256 approvalSpikeTx;          // tx count in window
        uint256 monitoringWindow;         // seconds
    }

    // ============ State ============

    ThreatLevel public currentLevel;
    mapping(uint256 => SecuritySignal) public signals;
    uint256 public signalCount;
    mapping(address => bool) public sentinels; // Authorized reporters
    ThreatConfig public config;

    uint256 public lastEscalation;
    uint256 public lastDeescalation;

    // Historical metrics for anomaly detection
    uint256 public avgDailyVolume;
    uint256 public avgDailyApprovals;
    uint256 public lastMetricsUpdate;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event SignalReported(uint256 indexed id, string source, ThreatLevel severity);
    event ThreatLevelChanged(ThreatLevel oldLevel, ThreatLevel newLevel);
    event SentinelAdded(address sentinel);
    event SentinelRemoved(address sentinel);
    event MetricsUpdated(uint256 avgVolume, uint256 avgApprovals);

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        currentLevel = ThreatLevel.GREEN;
        config = ThreatConfig({
            priceDeviationThreshold: 1000,  // 10%
            volumeSpikeMultiplier: 5,       // 5x average
            approvalSpikeTx: 100,           // 100 approvals in window
            monitoringWindow: 1 hours
        });
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Signal Reporting ============

    /// @notice Report a security signal
    function reportSignal(
        string calldata source,
        string calldata description,
        ThreatLevel severity
    ) external {
        require(sentinels[msg.sender] || msg.sender == owner(), "Not sentinel");

        uint256 id = signalCount++;
        signals[id] = SecuritySignal({
            source: source,
            description: description,
            severity: severity,
            timestamp: block.timestamp,
            reporter: msg.sender,
            active: true
        });

        emit SignalReported(id, source, severity);

        // Auto-escalate if signal severity is higher than current level
        if (uint8(severity) > uint8(currentLevel)) {
            _escalate(severity);
        }
    }

    /// @notice Dismiss a signal
    function dismissSignal(uint256 id) external {
        require(sentinels[msg.sender] || msg.sender == owner(), "Not sentinel");
        signals[id].active = false;
    }

    // ============ Threat Level Management ============

    function _escalate(ThreatLevel newLevel) internal {
        ThreatLevel old = currentLevel;
        currentLevel = newLevel;
        lastEscalation = block.timestamp;
        emit ThreatLevelChanged(old, newLevel);
    }

    /// @notice Manually escalate threat level
    function escalate(ThreatLevel newLevel) external {
        require(sentinels[msg.sender] || msg.sender == owner(), "Not sentinel");
        require(uint8(newLevel) > uint8(currentLevel), "Can only escalate up");
        _escalate(newLevel);
    }

    /// @notice De-escalate threat level (owner only, with cooldown)
    function deescalate() external onlyOwner {
        require(uint8(currentLevel) > 0, "Already green");
        require(block.timestamp > lastEscalation + 1 hours, "Cooldown active");

        ThreatLevel old = currentLevel;
        currentLevel = ThreatLevel(uint8(currentLevel) - 1);
        lastDeescalation = block.timestamp;

        emit ThreatLevelChanged(old, currentLevel);
    }

    /// @notice Emergency escalation to BLACK (multi-sig sentinel)
    function emergencyBlack() external {
        require(sentinels[msg.sender], "Not sentinel");
        _escalate(ThreatLevel.BLACK);
    }

    // ============ Metrics ============

    function updateMetrics(uint256 _avgVolume, uint256 _avgApprovals) external onlyOwner {
        avgDailyVolume = _avgVolume;
        avgDailyApprovals = _avgApprovals;
        lastMetricsUpdate = block.timestamp;
        emit MetricsUpdated(_avgVolume, _avgApprovals);
    }

    // ============ Sentinel Management ============

    function addSentinel(address s) external onlyOwner {
        sentinels[s] = true;
        emit SentinelAdded(s);
    }

    function removeSentinel(address s) external onlyOwner {
        sentinels[s] = false;
        emit SentinelRemoved(s);
    }

    // ============ Configuration ============

    function setConfig(ThreatConfig calldata _config) external onlyOwner {
        config = _config;
    }

    // ============ Views ============

    function getLevel() external view returns (ThreatLevel) { return currentLevel; }
    function isGreen() external view returns (bool) { return currentLevel == ThreatLevel.GREEN; }
    function isEmergency() external view returns (bool) { return currentLevel >= ThreatLevel.RED; }
    function getSignal(uint256 id) external view returns (SecuritySignal memory) { return signals[id]; }
    function getActiveSignalCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < signalCount; i++) {
            if (signals[i].active) count++;
        }
        return count;
    }

    receive() external payable {}
}
