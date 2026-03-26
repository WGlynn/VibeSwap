// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeTimelock — Governance-Controlled Timelock
 * @notice All critical protocol operations must pass through a timelock delay.
 *         Provides safety window for users to react to governance actions.
 *
 * @dev Delay tiers:
 *      - Standard operations: 24 hours
 *      - Parameter changes: 48 hours
 *      - Upgrade operations: 7 days
 *      - Emergency: 6 hour fast-track (requires security council)
 */
contract VibeTimelock is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Constants ============

    uint256 public constant STANDARD_DELAY = 24 hours;
    uint256 public constant PARAMETER_DELAY = 48 hours;
    uint256 public constant UPGRADE_DELAY = 7 days;
    uint256 public constant EMERGENCY_DELAY = 6 hours;
    uint256 public constant GRACE_PERIOD = 14 days;

    // ============ Types ============

    enum DelayTier { STANDARD, PARAMETER, UPGRADE, EMERGENCY }

    struct QueuedTransaction {
        bytes32 txHash;
        address target;
        uint256 value;
        bytes data;
        uint256 eta;             // Earliest time of execution
        DelayTier tier;
        bool executed;
        bool cancelled;
    }

    // ============ State ============

    mapping(bytes32 => QueuedTransaction) public queuedTransactions;
    bytes32[] public transactionHashes;

    /// @notice Security council (for emergency fast-track)
    mapping(address => bool) public securityCouncil;
    uint256 public councilCount;

    /// @notice Custom delays per target contract
    mapping(address => uint256) public customDelays;

    uint256 public totalQueued;
    uint256 public totalExecuted;
    uint256 public totalCancelled;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event TransactionQueued(bytes32 indexed txHash, address indexed target, uint256 eta, DelayTier tier);
    event TransactionExecuted(bytes32 indexed txHash, address indexed target);
    event TransactionCancelled(bytes32 indexed txHash);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Queue ============

    function queueTransaction(
        address target,
        uint256 value,
        bytes calldata data,
        DelayTier tier
    ) external onlyOwner returns (bytes32) {
        if (tier == DelayTier.EMERGENCY) {
            require(securityCouncil[msg.sender], "Not security council");
        }

        uint256 delay = _getDelay(target, tier);
        uint256 eta = block.timestamp + delay;

        bytes32 txHash = keccak256(abi.encodePacked(target, value, data, eta));

        queuedTransactions[txHash] = QueuedTransaction({
            txHash: txHash,
            target: target,
            value: value,
            data: data,
            eta: eta,
            tier: tier,
            executed: false,
            cancelled: false
        });

        transactionHashes.push(txHash);
        totalQueued++;

        emit TransactionQueued(txHash, target, eta, tier);
        return txHash;
    }

    // ============ Execute ============

    function executeTransaction(bytes32 txHash) external onlyOwner returns (bytes memory) {
        QueuedTransaction storage tx_ = queuedTransactions[txHash];
        require(!tx_.executed, "Already executed");
        require(!tx_.cancelled, "Cancelled");
        require(block.timestamp >= tx_.eta, "Too early");
        require(block.timestamp <= tx_.eta + GRACE_PERIOD, "Stale transaction");

        tx_.executed = true;
        totalExecuted++;

        (bool success, bytes memory result) = tx_.target.call{value: tx_.value}(tx_.data);
        require(success, "Execution failed");

        emit TransactionExecuted(txHash, tx_.target);
        return result;
    }

    // ============ Cancel ============

    function cancelTransaction(bytes32 txHash) external onlyOwner {
        QueuedTransaction storage tx_ = queuedTransactions[txHash];
        require(!tx_.executed, "Already executed");
        require(!tx_.cancelled, "Already cancelled");

        tx_.cancelled = true;
        totalCancelled++;

        emit TransactionCancelled(txHash);
    }

    // ============ Security Council ============

    function addCouncilMember(address member) external onlyOwner {
        if (!securityCouncil[member]) {
            securityCouncil[member] = true;
            councilCount++;
            emit CouncilMemberAdded(member);
        }
    }

    function removeCouncilMember(address member) external onlyOwner {
        if (securityCouncil[member]) {
            securityCouncil[member] = false;
            councilCount--;
            emit CouncilMemberRemoved(member);
        }
    }

    // ============ Admin ============

    function setCustomDelay(address target, uint256 delay) external onlyOwner {
        customDelays[target] = delay;
    }

    // ============ Internal ============

    function _getDelay(address target, DelayTier tier) internal view returns (uint256) {
        // Custom delay takes precedence
        if (customDelays[target] > 0) return customDelays[target];

        if (tier == DelayTier.STANDARD) return STANDARD_DELAY;
        if (tier == DelayTier.PARAMETER) return PARAMETER_DELAY;
        if (tier == DelayTier.UPGRADE) return UPGRADE_DELAY;
        return EMERGENCY_DELAY;
    }

    // ============ View ============

    function getTransaction(bytes32 txHash) external view returns (QueuedTransaction memory) {
        return queuedTransactions[txHash];
    }

    function isReady(bytes32 txHash) external view returns (bool) {
        QueuedTransaction storage tx_ = queuedTransactions[txHash];
        return !tx_.executed && !tx_.cancelled
            && block.timestamp >= tx_.eta
            && block.timestamp <= tx_.eta + GRACE_PERIOD;
    }

    function getQueueLength() external view returns (uint256) { return transactionHashes.length; }

    receive() external payable {}
}
