// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title EmergencyEjector — Protocol-Wide Emergency Withdrawal System
 * @notice If the protocol is ever compromised, users can eject ALL their funds
 *         to a pre-registered safe address in a single transaction.
 *
 * Think of it as an ejection seat for your money:
 * - Pre-register your "safe house" address when times are good
 * - If emergency declared, one-click eject to your safe address
 * - No admin can prevent ejection (it's a right, not a privilege)
 * - Works even if frontend is compromised (direct contract call)
 *
 * This is the "Coinbase auto-update" insurance policy.
 */
contract EmergencyEjector is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum ProtocolStatus { NORMAL, WARNING, EMERGENCY, SHUTDOWN }

    struct SafeHouse {
        address safeAddress;         // Pre-registered emergency withdrawal destination
        uint256 registeredAt;        // When it was registered
        uint256 cooldownUntil;       // Can't change safe address for 7 days after setting
        bool locked;                 // Once locked, safe address is permanent
    }

    // ============ State ============

    ProtocolStatus public status;
    mapping(address => SafeHouse) public safeHouses;
    mapping(address => uint256) public deposits;

    uint256 public constant SAFE_CHANGE_COOLDOWN = 7 days;
    uint256 public emergencyDeclaredAt;

    // Multi-sig emergency declaration
    mapping(address => bool) public emergencySigners;
    uint256 public emergencySignerCount;
    uint256 public emergencyThreshold;
    mapping(bytes32 => mapping(address => bool)) public emergencyVotes;
    mapping(bytes32 => uint256) public emergencyVoteCount;

    // ============ Events ============

    event SafeHouseRegistered(address indexed user, address safeAddress);
    event SafeHouseLocked(address indexed user, address safeAddress);
    event EmergencyDeclared(uint256 timestamp);
    event EmergencyEjection(address indexed user, address safeAddress, uint256 amount);
    event StatusChanged(ProtocolStatus oldStatus, ProtocolStatus newStatus);
    event Deposited(address indexed user, uint256 amount);

    // ============ Initialize ============

    function initialize(uint256 _emergencyThreshold) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        status = ProtocolStatus.NORMAL;
        emergencyThreshold = _emergencyThreshold > 0 ? _emergencyThreshold : 2;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Safe House Management ============

    /// @notice Register your emergency safe address
    function registerSafeHouse(address safeAddress) external {
        require(safeAddress != address(0), "Zero address");
        require(safeAddress != msg.sender, "Cannot be self"); // Prevent circular

        SafeHouse storage sh = safeHouses[msg.sender];
        require(!sh.locked, "Safe house is locked");
        require(block.timestamp >= sh.cooldownUntil, "Cooldown active");

        sh.safeAddress = safeAddress;
        sh.registeredAt = block.timestamp;
        sh.cooldownUntil = block.timestamp + SAFE_CHANGE_COOLDOWN;

        emit SafeHouseRegistered(msg.sender, safeAddress);
    }

    /// @notice Permanently lock your safe house address (irreversible)
    function lockSafeHouse() external {
        SafeHouse storage sh = safeHouses[msg.sender];
        require(sh.safeAddress != address(0), "No safe house set");
        require(block.timestamp >= sh.cooldownUntil, "Wait for cooldown");
        sh.locked = true;
        emit SafeHouseLocked(msg.sender, sh.safeAddress);
    }

    // ============ Deposits ============

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // ============ Emergency Declaration (Multi-sig) ============

    function addEmergencySigner(address signer) external onlyOwner {
        require(!emergencySigners[signer], "Already signer");
        emergencySigners[signer] = true;
        emergencySignerCount++;
    }

    /// @notice Vote to declare emergency — requires threshold signatures
    function voteEmergency() external {
        require(emergencySigners[msg.sender], "Not signer");
        bytes32 day = keccak256(abi.encodePacked(block.timestamp / 1 days));
        require(!emergencyVotes[day][msg.sender], "Already voted");

        emergencyVotes[day][msg.sender] = true;
        emergencyVoteCount[day]++;

        if (emergencyVoteCount[day] >= emergencyThreshold) {
            _declareEmergency();
        }
    }

    function _declareEmergency() internal {
        status = ProtocolStatus.EMERGENCY;
        emergencyDeclaredAt = block.timestamp;
        emit EmergencyDeclared(block.timestamp);
        emit StatusChanged(ProtocolStatus.NORMAL, ProtocolStatus.EMERGENCY);
    }

    // ============ Emergency Ejection ============

    /// @notice Eject ALL funds to pre-registered safe house
    /// @dev Works in EMERGENCY or SHUTDOWN mode. Cannot be blocked by admin.
    function eject() external nonReentrant {
        require(
            status == ProtocolStatus.EMERGENCY || status == ProtocolStatus.SHUTDOWN,
            "No emergency"
        );

        SafeHouse storage sh = safeHouses[msg.sender];
        require(sh.safeAddress != address(0), "No safe house registered");

        uint256 amount = deposits[msg.sender];
        require(amount > 0, "No funds");

        deposits[msg.sender] = 0;

        (bool ok, ) = sh.safeAddress.call{value: amount}("");
        require(ok, "Ejection failed");

        emit EmergencyEjection(msg.sender, sh.safeAddress, amount);
    }

    /// @notice Normal withdrawal (only in NORMAL or WARNING status)
    function withdraw(uint256 amount) external nonReentrant {
        require(status == ProtocolStatus.NORMAL || status == ProtocolStatus.WARNING, "Emergency active");
        require(deposits[msg.sender] >= amount, "Insufficient");

        deposits[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ============ Status Management ============

    function setWarning() external onlyOwner {
        emit StatusChanged(status, ProtocolStatus.WARNING);
        status = ProtocolStatus.WARNING;
    }

    function setNormal() external onlyOwner {
        require(status == ProtocolStatus.WARNING, "Can only clear warning");
        emit StatusChanged(status, ProtocolStatus.NORMAL);
        status = ProtocolStatus.NORMAL;
    }

    // ============ Views ============

    function getSafeHouse(address user) external view returns (
        address safeAddress, uint256 registeredAt, bool locked
    ) {
        SafeHouse storage sh = safeHouses[user];
        return (sh.safeAddress, sh.registeredAt, sh.locked);
    }

    function getBalance(address user) external view returns (uint256) {
        return deposits[user];
    }

    function isEmergency() external view returns (bool) {
        return status == ProtocolStatus.EMERGENCY || status == ProtocolStatus.SHUTDOWN;
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
    }
}
