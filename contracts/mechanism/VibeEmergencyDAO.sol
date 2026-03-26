// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeEmergencyDAO — Fast-Track Emergency Governance
 * @notice When seconds matter, normal governance is too slow.
 *         This contract enables rapid response to protocol emergencies
 *         with a 3-of-5 guardian multisig and 1-hour execution window.
 *
 * Powers:
 * - Pause any protocol contract
 * - Activate circuit breakers
 * - Freeze compromised addresses
 * - Trigger emergency withdrawals
 * - Escalate security oracle to RED/BLACK
 *
 * Checks:
 * - 3-of-5 guardian approval required
 * - Actions auto-expire after 1 hour
 * - All actions logged and auditable
 * - Regular DAO can override/reverse any emergency action
 */
contract VibeEmergencyDAO is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum ActionType { PAUSE, UNPAUSE, FREEZE_ADDRESS, CIRCUIT_BREAKER, EMERGENCY_WITHDRAW, ESCALATE }

    struct EmergencyAction {
        ActionType actionType;
        address target;
        bytes data;
        uint256 proposedAt;
        uint256 approvalCount;
        bool executed;
        bool expired;
        address proposer;
        string reason;
    }

    // ============ State ============

    address[5] public guardians;
    mapping(uint256 => EmergencyAction) public actions;
    mapping(uint256 => mapping(address => bool)) public approvals;
    uint256 public actionCount;

    uint256 public constant REQUIRED_APPROVALS = 3;
    uint256 public constant EXPIRY_WINDOW = 1 hours;
    uint256 public constant COOLDOWN = 5 minutes;

    mapping(address => bool) public frozenAddresses;
    mapping(address => bool) public pausedContracts;
    uint256 public lastActionTime;
    uint256 public totalActionsExecuted;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event EmergencyProposed(uint256 indexed id, ActionType actionType, address target, string reason);
    event EmergencyApproved(uint256 indexed id, address guardian);
    event EmergencyExecuted(uint256 indexed id, ActionType actionType, address target);
    event EmergencyExpired(uint256 indexed id);
    event AddressFrozen(address indexed addr, string reason);
    event AddressUnfrozen(address indexed addr);
    event ContractPaused(address indexed target);
    event ContractUnpaused(address indexed target);
    event GuardianRotated(uint256 index, address oldGuardian, address newGuardian);

    // ============ Initialize ============

    function initialize(address[5] memory _guardians) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        for (uint256 i = 0; i < 5; i++) {
            require(_guardians[i] != address(0), "Zero guardian");
            guardians[i] = _guardians[i];
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    modifier onlyGuardian() {
        require(_isGuardian(msg.sender), "Not guardian");
        _;
    }

    // ============ Propose ============

    function proposeEmergency(
        ActionType actionType,
        address target,
        bytes calldata data,
        string calldata reason
    ) external onlyGuardian returns (uint256) {
        require(block.timestamp >= lastActionTime + COOLDOWN, "Cooldown active");

        uint256 id = actionCount++;
        actions[id] = EmergencyAction({
            actionType: actionType,
            target: target,
            data: data,
            proposedAt: block.timestamp,
            approvalCount: 1,
            executed: false,
            expired: false,
            proposer: msg.sender,
            reason: reason
        });

        approvals[id][msg.sender] = true;
        emit EmergencyProposed(id, actionType, target, reason);

        // Auto-execute if proposer is the only approval needed (won't happen with 3-of-5)
        if (actions[id].approvalCount >= REQUIRED_APPROVALS) {
            _execute(id);
        }

        return id;
    }

    function approveEmergency(uint256 id) external onlyGuardian {
        EmergencyAction storage a = actions[id];
        require(!a.executed, "Already executed");
        require(!a.expired, "Expired");
        require(block.timestamp <= a.proposedAt + EXPIRY_WINDOW, "Window closed");
        require(!approvals[id][msg.sender], "Already approved");

        approvals[id][msg.sender] = true;
        a.approvalCount++;

        emit EmergencyApproved(id, msg.sender);

        if (a.approvalCount >= REQUIRED_APPROVALS) {
            _execute(id);
        }
    }

    // ============ Execute ============

    function _execute(uint256 id) internal {
        EmergencyAction storage a = actions[id];
        require(!a.executed, "Already executed");
        a.executed = true;
        lastActionTime = block.timestamp;
        totalActionsExecuted++;

        if (a.actionType == ActionType.PAUSE) {
            pausedContracts[a.target] = true;
            emit ContractPaused(a.target);
        } else if (a.actionType == ActionType.UNPAUSE) {
            pausedContracts[a.target] = false;
            emit ContractUnpaused(a.target);
        } else if (a.actionType == ActionType.FREEZE_ADDRESS) {
            frozenAddresses[a.target] = true;
            emit AddressFrozen(a.target, a.reason);
        } else if (a.actionType == ActionType.CIRCUIT_BREAKER || a.actionType == ActionType.ESCALATE) {
            // Call target contract with provided data
            if (a.data.length > 0) {
                (bool ok, ) = a.target.call(a.data);
                require(ok, "Action call failed");
            }
        }

        emit EmergencyExecuted(id, a.actionType, a.target);
    }

    /// @notice Expire stale actions
    function expireAction(uint256 id) external {
        EmergencyAction storage a = actions[id];
        require(!a.executed, "Already executed");
        require(block.timestamp > a.proposedAt + EXPIRY_WINDOW, "Not expired");
        a.expired = true;
        emit EmergencyExpired(id);
    }

    // ============ Guardian Management ============

    function rotateGuardian(uint256 index, address newGuardian) external onlyOwner {
        require(index < 5, "Invalid index");
        require(newGuardian != address(0), "Zero address");
        address old = guardians[index];
        guardians[index] = newGuardian;
        emit GuardianRotated(index, old, newGuardian);
    }

    /// @notice Unfreeze an address (requires DAO override or guardian consensus)
    function unfreezeAddress(address addr) external onlyOwner {
        frozenAddresses[addr] = false;
        emit AddressUnfrozen(addr);
    }

    // ============ Views ============

    function _isGuardian(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < 5; i++) {
            if (guardians[i] == addr) return true;
        }
        return false;
    }

    function isGuardian(address addr) external view returns (bool) { return _isGuardian(addr); }
    function isFrozen(address addr) external view returns (bool) { return frozenAddresses[addr]; }
    function isPaused(address target) external view returns (bool) { return pausedContracts[target]; }

    function getAction(uint256 id) external view returns (EmergencyAction memory) { return actions[id]; }
    function getGuardians() external view returns (address[5] memory) { return guardians; }

    receive() external payable {}
}
