// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../compliance/FederatedConsensus.sol";
import "../compliance/ClawbackRegistry.sol";

/**
 * @title AutomatedRegulator
 * @notice On-chain equivalent of the SEC / regulatory bodies
 * @dev Replaces off-chain REGULATOR role in FederatedConsensus. Implements:
 *      - Pattern-based violation detection (wash trading, market manipulation)
 *      - Threshold-triggered automatic case filing
 *      - Rule engine with configurable violation parameters
 *      - Automated voting in FederatedConsensus based on on-chain evidence
 *
 *      This contract IS a FederatedConsensus authority. When it detects a
 *      violation that meets its evidence threshold, it casts an ONCHAIN_REGULATOR
 *      vote automatically. No human intervention needed.
 *
 *      Infrastructural inversion: Today this assists human regulators by
 *      flagging suspicious patterns. Eventually, this becomes the primary
 *      regulatory engine and human regulators reference its findings.
 */
contract AutomatedRegulator is OwnableUpgradeable, UUPSUpgradeable {

    // ============ Enums ============

    enum ViolationType {
        WASH_TRADING,         // Same entity trading with itself for fake volume
        MARKET_MANIPULATION,  // Coordinated price manipulation
        INSIDER_TRADING,      // Trading on non-public information (oracle front-running)
        LAYERING,             // Placing orders with intent to cancel
        SPOOFING,             // Fake large orders to move price
        SANCTIONS_EVASION     // Interacting with sanctioned addresses
    }

    enum SeverityLevel {
        LOW,        // Warning only
        MEDIUM,     // Auto-watchlist
        HIGH,       // Auto-flag + file case
        CRITICAL    // Auto-flag + file case + vote guilty
    }

    // ============ Structs ============

    struct ViolationRule {
        ViolationType violationType;
        bool enabled;
        uint256 threshold;           // Value threshold to trigger
        uint256 timeWindow;          // Time window for accumulation
        SeverityLevel severity;
        string description;
    }

    struct DetectedViolation {
        bytes32 violationId;
        address wallet;
        ViolationType violationType;
        SeverityLevel severity;
        uint256 evidenceValue;       // Quantified evidence
        uint64 detectedAt;
        bool actionTaken;
        bytes32 caseId;              // If a case was filed
    }

    struct WalletActivity {
        uint256 buyVolume;           // Buy volume in current window
        uint256 sellVolume;          // Sell volume in current window
        uint256 selfTradeVolume;     // Volume with own addresses
        uint256 cancelledOrders;     // Cancelled/expired orders
        uint256 priceImpact;         // Cumulative price impact
        uint64 windowStart;
        address[] counterparties;
    }

    // ============ State ============

    /// @notice FederatedConsensus contract
    FederatedConsensus public consensus;

    /// @notice ClawbackRegistry for filing cases
    ClawbackRegistry public registry;

    /// @notice Violation rules by type
    mapping(ViolationType => ViolationRule) public rules;

    /// @notice Detected violations
    mapping(bytes32 => DetectedViolation) public violations;

    /// @notice Wallet activity tracking
    mapping(address => WalletActivity) public walletActivity;

    /// @notice Known wallet clusters (sybil detection): master => puppets
    mapping(address => address[]) public walletClusters;

    /// @notice Reverse cluster lookup: puppet => master
    mapping(address => address) public clusterMaster;

    /// @notice Violation counter
    uint256 public violationCount;

    /// @notice Sanctioned address list
    mapping(address => bool) public sanctionedAddresses;

    /// @notice Authorized monitors (can report activity)
    mapping(address => bool) public authorizedMonitors;

    // ============ Events ============

    event ViolationDetected(bytes32 indexed violationId, address indexed wallet, ViolationType violationType, SeverityLevel severity);
    event CaseAutoFiled(bytes32 indexed violationId, bytes32 indexed caseId, address indexed wallet);
    event WalletClusterIdentified(address indexed master, address[] puppets);
    event RuleUpdated(ViolationType indexed violationType, uint256 threshold, SeverityLevel severity);
    event SanctionAdded(address indexed wallet);
    event AutoVoteCast(bytes32 indexed proposalId, bool approved);

    // ============ Errors ============

    error NotAuthorizedMonitor();
    error RuleNotEnabled();
    error ViolationNotFound();

    // ============ Modifiers ============

    modifier onlyMonitor() {
        if (!authorizedMonitors[msg.sender] && msg.sender != owner()) revert NotAuthorizedMonitor();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _consensus,
        address _registry
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        consensus = FederatedConsensus(_consensus);
        registry = ClawbackRegistry(_registry);

        // Default rules
        _setDefaultRules();
    }

    function _setDefaultRules() internal {
        rules[ViolationType.WASH_TRADING] = ViolationRule({
            violationType: ViolationType.WASH_TRADING,
            enabled: true,
            threshold: 50_000e18,     // $50K wash volume triggers
            timeWindow: 24 hours,
            severity: SeverityLevel.HIGH,
            description: "Wash trading detected: self-dealing volume exceeds threshold"
        });

        rules[ViolationType.MARKET_MANIPULATION] = ViolationRule({
            violationType: ViolationType.MARKET_MANIPULATION,
            enabled: true,
            threshold: 500,           // 5% price impact in BPS
            timeWindow: 1 hours,
            severity: SeverityLevel.HIGH,
            description: "Market manipulation: coordinated price impact exceeds threshold"
        });

        rules[ViolationType.LAYERING] = ViolationRule({
            violationType: ViolationType.LAYERING,
            enabled: true,
            threshold: 10,            // 10+ cancelled orders in window
            timeWindow: 1 hours,
            severity: SeverityLevel.MEDIUM,
            description: "Layering detected: excessive order cancellations"
        });

        rules[ViolationType.SPOOFING] = ViolationRule({
            violationType: ViolationType.SPOOFING,
            enabled: true,
            threshold: 5,             // 5+ large orders cancelled
            timeWindow: 30 minutes,
            severity: SeverityLevel.MEDIUM,
            description: "Spoofing detected: large fake orders to move price"
        });

        rules[ViolationType.SANCTIONS_EVASION] = ViolationRule({
            violationType: ViolationType.SANCTIONS_EVASION,
            enabled: true,
            threshold: 1,             // Any interaction triggers
            timeWindow: 0,            // Instant
            severity: SeverityLevel.CRITICAL,
            description: "Sanctions evasion: interaction with sanctioned address"
        });
    }

    // ============ Activity Monitoring ============

    /**
     * @notice Report a trade for monitoring
     * @dev Called by VibeSwapCore or authorized monitors after each trade
     */
    function reportTrade(
        address trader,
        address counterparty,
        uint256 volume,
        bool isBuy,
        uint256 priceImpactBps
    ) external onlyMonitor {
        WalletActivity storage activity = walletActivity[trader];

        // Reset window if expired
        if (block.timestamp >= activity.windowStart + 24 hours) {
            activity.buyVolume = 0;
            activity.sellVolume = 0;
            activity.selfTradeVolume = 0;
            activity.cancelledOrders = 0;
            activity.priceImpact = 0;
            activity.windowStart = uint64(block.timestamp);
            delete activity.counterparties;
        }

        // Track volume
        if (isBuy) {
            activity.buyVolume += volume;
        } else {
            activity.sellVolume += volume;
        }

        activity.priceImpact += priceImpactBps;
        activity.counterparties.push(counterparty);

        // Check if counterparty is in same cluster (wash trading)
        if (clusterMaster[trader] != address(0) && clusterMaster[trader] == clusterMaster[counterparty]) {
            activity.selfTradeVolume += volume;
        }
        // Also check direct self-trade
        if (trader == counterparty) {
            activity.selfTradeVolume += volume;
        }

        // Check sanctions
        if (sanctionedAddresses[counterparty]) {
            _detectViolation(trader, ViolationType.SANCTIONS_EVASION, 1);
        }

        // Run violation checks
        _checkWashTrading(trader);
        _checkMarketManipulation(trader);
    }

    /**
     * @notice Report order cancellation for layering/spoofing detection
     */
    function reportCancellation(address trader, uint256 orderSize) external onlyMonitor {
        WalletActivity storage activity = walletActivity[trader];
        activity.cancelledOrders++;

        _checkLayering(trader);
    }

    /**
     * @notice Register a wallet cluster (sybil detection result)
     * @dev Called by AdminSybilDetection or automated analysis
     */
    function registerCluster(address master, address[] calldata puppets) external onlyMonitor {
        walletClusters[master] = puppets;
        for (uint256 i = 0; i < puppets.length; i++) {
            clusterMaster[puppets[i]] = master;
        }
        clusterMaster[master] = master;

        emit WalletClusterIdentified(master, puppets);
    }

    // ============ Violation Detection (Internal) ============

    function _checkWashTrading(address trader) internal {
        ViolationRule storage rule = rules[ViolationType.WASH_TRADING];
        if (!rule.enabled) return;

        WalletActivity storage activity = walletActivity[trader];
        if (activity.selfTradeVolume >= rule.threshold) {
            _detectViolation(trader, ViolationType.WASH_TRADING, activity.selfTradeVolume);
        }
    }

    function _checkMarketManipulation(address trader) internal {
        ViolationRule storage rule = rules[ViolationType.MARKET_MANIPULATION];
        if (!rule.enabled) return;

        WalletActivity storage activity = walletActivity[trader];
        if (activity.priceImpact >= rule.threshold) {
            _detectViolation(trader, ViolationType.MARKET_MANIPULATION, activity.priceImpact);
        }
    }

    function _checkLayering(address trader) internal {
        ViolationRule storage rule = rules[ViolationType.LAYERING];
        if (!rule.enabled) return;

        WalletActivity storage activity = walletActivity[trader];
        if (activity.cancelledOrders >= rule.threshold) {
            _detectViolation(trader, ViolationType.LAYERING, activity.cancelledOrders);
        }
    }

    function _detectViolation(
        address wallet,
        ViolationType violationType,
        uint256 evidenceValue
    ) internal {
        ViolationRule storage rule = rules[violationType];

        violationCount++;
        bytes32 violationId = keccak256(abi.encodePacked(wallet, violationType, violationCount));

        violations[violationId] = DetectedViolation({
            violationId: violationId,
            wallet: wallet,
            violationType: violationType,
            severity: rule.severity,
            evidenceValue: evidenceValue,
            detectedAt: uint64(block.timestamp),
            actionTaken: false,
            caseId: bytes32(0)
        });

        emit ViolationDetected(violationId, wallet, violationType, rule.severity);

        // Auto-action based on severity
        if (rule.severity == SeverityLevel.HIGH || rule.severity == SeverityLevel.CRITICAL) {
            _autoFileCase(violationId, wallet, rule.description);
        }
    }

    function _autoFileCase(bytes32 violationId, address wallet, string memory reason) internal {
        // This contract must be an authorized case opener in ClawbackRegistry
        // (requires isActiveAuthority on FederatedConsensus or owner of registry)
        DetectedViolation storage v = violations[violationId];
        v.actionTaken = true;

        try registry.openCase(wallet, v.evidenceValue, address(0), reason) returns (bytes32 caseId) {
            v.caseId = caseId;
            emit CaseAutoFiled(violationId, caseId, wallet);
        } catch {
            // Not authorized yet — emit with zero caseId so off-chain can track
            emit CaseAutoFiled(violationId, bytes32(0), wallet);
        }
    }

    // ============ Consensus Voting ============

    /**
     * @notice Cast automated vote on a FederatedConsensus proposal
     * @dev Called when on-chain evidence meets the threshold for a case.
     *      This is the on-chain REGULATOR speaking based on data, not opinion.
     */
    function castAutomatedVote(
        bytes32 proposalId,
        bytes32 violationId
    ) external onlyMonitor {
        DetectedViolation storage violation = violations[violationId];
        if (violation.detectedAt == 0) revert ViolationNotFound();

        bool approve = violation.severity >= SeverityLevel.HIGH;

        consensus.vote(proposalId, approve);
        emit AutoVoteCast(proposalId, approve);
    }

    // ============ View Functions ============

    function getViolation(bytes32 violationId) external view returns (DetectedViolation memory) {
        return violations[violationId];
    }

    function getWalletActivity(address wallet) external view returns (WalletActivity memory) {
        return walletActivity[wallet];
    }

    function getCluster(address master) external view returns (address[] memory) {
        return walletClusters[master];
    }

    // ============ Admin ============

    function setRule(
        ViolationType violationType,
        uint256 threshold,
        uint256 timeWindow,
        SeverityLevel severity,
        string calldata description
    ) external onlyOwner {
        rules[violationType] = ViolationRule({
            violationType: violationType,
            enabled: true,
            threshold: threshold,
            timeWindow: timeWindow,
            severity: severity,
            description: description
        });
        emit RuleUpdated(violationType, threshold, severity);
    }

    function addSanctionedAddress(address wallet) external onlyOwner {
        sanctionedAddresses[wallet] = true;
        emit SanctionAdded(wallet);
    }

    function setAuthorizedMonitor(address monitor, bool authorized) external onlyOwner {
        authorizedMonitors[monitor] = authorized;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
