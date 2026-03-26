// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeAnalytics — On-Chain Protocol Metrics
 * @notice Aggregates and exposes protocol health metrics on-chain.
 *         TVL, volume, user counts, fee revenue — all queryable.
 *         Feeds the frontend dashboard and governance decisions.
 */
contract VibeAnalytics is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct ProtocolMetrics {
        uint256 totalValueLocked;
        uint256 dailyVolume;
        uint256 weeklyVolume;
        uint256 totalVolume;
        uint256 uniqueUsers;
        uint256 totalTransactions;
        uint256 totalFeeRevenue;
        uint256 activePoolCount;
        uint256 activeNodeCount;
        uint256 mindScoreTotal;
        uint256 lastUpdated;
    }

    struct ModuleMetrics {
        string moduleName;
        uint256 tvl;
        uint256 volume24h;
        uint256 users;
        uint256 transactions;
        uint256 revenue;
        uint256 lastUpdated;
        bool active;
    }

    // ============ State ============

    ProtocolMetrics public protocolMetrics;
    mapping(bytes32 => ModuleMetrics) public moduleMetrics;
    bytes32[] public moduleList;

    /// @notice Authorized reporters (protocol modules)
    mapping(address => bool) public reporters;

    /// @notice Historical snapshots: epoch => metrics
    mapping(uint256 => ProtocolMetrics) public snapshots;
    uint256 public snapshotCount;
    uint256 public snapshotInterval;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event MetricsUpdated(string module, uint256 tvl, uint256 volume, uint256 users);
    event SnapshotTaken(uint256 indexed epoch, uint256 tvl, uint256 volume);
    event ReporterAdded(address indexed reporter);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        snapshotInterval = 1 days;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Reporting ============

    function reportMetrics(
        string calldata moduleName,
        uint256 tvl,
        uint256 volume,
        uint256 users,
        uint256 transactions,
        uint256 revenue
    ) external {
        require(reporters[msg.sender], "Not authorized");

        bytes32 key = keccak256(abi.encodePacked(moduleName));

        if (moduleMetrics[key].lastUpdated == 0) {
            moduleList.push(key);
        }

        moduleMetrics[key] = ModuleMetrics({
            moduleName: moduleName,
            tvl: tvl,
            volume24h: volume,
            users: users,
            transactions: transactions,
            revenue: revenue,
            lastUpdated: block.timestamp,
            active: true
        });

        // Update aggregate
        _updateAggregate();

        emit MetricsUpdated(moduleName, tvl, volume, users);
    }

    function takeSnapshot() external {
        require(
            block.timestamp >= protocolMetrics.lastUpdated + snapshotInterval,
            "Too soon"
        );

        snapshotCount++;
        snapshots[snapshotCount] = protocolMetrics;
        emit SnapshotTaken(snapshotCount, protocolMetrics.totalValueLocked, protocolMetrics.totalVolume);
    }

    // ============ Admin ============

    function addReporter(address reporter) external onlyOwner {
        reporters[reporter] = true;
        emit ReporterAdded(reporter);
    }

    // ============ View ============

    function getProtocolMetrics() external view returns (
        uint256 tvl, uint256 dailyVol, uint256 totalVol,
        uint256 users, uint256 txCount, uint256 feeRevenue
    ) {
        ProtocolMetrics storage m = protocolMetrics;
        return (m.totalValueLocked, m.dailyVolume, m.totalVolume,
                m.uniqueUsers, m.totalTransactions, m.totalFeeRevenue);
    }

    function getModuleCount() external view returns (uint256) { return moduleList.length; }
    function getSnapshotCount() external view returns (uint256) { return snapshotCount; }

    // ============ Internal ============

    function _updateAggregate() internal {
        uint256 totalTVL;
        uint256 totalVol;
        uint256 totalUsers;
        uint256 totalTx;
        uint256 totalRev;

        for (uint256 i = 0; i < moduleList.length; i++) {
            ModuleMetrics storage m = moduleMetrics[moduleList[i]];
            if (m.active) {
                totalTVL += m.tvl;
                totalVol += m.volume24h;
                totalUsers += m.users;
                totalTx += m.transactions;
                totalRev += m.revenue;
            }
        }

        protocolMetrics.totalValueLocked = totalTVL;
        protocolMetrics.dailyVolume = totalVol;
        protocolMetrics.totalVolume += totalVol;
        protocolMetrics.uniqueUsers = totalUsers;
        protocolMetrics.totalTransactions = totalTx;
        protocolMetrics.totalFeeRevenue = totalRev;
        protocolMetrics.lastUpdated = block.timestamp;
    }
}
