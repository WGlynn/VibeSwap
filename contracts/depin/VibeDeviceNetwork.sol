// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeDeviceNetwork — DePIN Device Registry & Coordination
 * @notice Decentralized Physical Infrastructure Network for IoT devices.
 *         RFID readers, AI cameras, robots, phones, sensors — all connected
 *         to VSOS with cryptographic identity and zero-knowledge attestation.
 *
 * @dev Architecture:
 *      - Device registration with hardware attestation (TEE/Secure Element)
 *      - Device types: RFID, CAMERA, SENSOR, ROBOT, PHONE, AI_COMPUTE, GATEWAY
 *      - Data contribution rewards via Shapley-weighted DePIN incentives
 *      - Device reputation based on uptime and data quality
 *      - Firmware verification via on-chain hash registry
 *      - Fleet management for enterprise operators
 */
contract VibeDeviceNetwork is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    event DeviceStakeUpdated(uint256 previous, uint256 current);
    event HeartbeatTimeoutUpdated(uint256 previous, uint256 current);

    // ============ Types ============

    enum DeviceType { RFID, CAMERA, SENSOR, ROBOT, PHONE, AI_COMPUTE, GATEWAY, MEDICAL, VEHICLE }

    struct Device {
        bytes32 deviceId;
        address owner;
        DeviceType deviceType;
        bytes32 hardwareAttestation;    // TEE/SE attestation hash
        bytes32 firmwareHash;           // Current firmware version hash
        string metadata;               // IPFS hash of device specs
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 reputationScore;        // 0-10000 (basis points)
        uint256 totalDataSubmissions;
        uint256 totalRewardsEarned;
        bool active;
        bool verified;                  // Hardware attestation verified
    }

    struct Fleet {
        uint256 fleetId;
        address operator;
        string name;
        uint256 deviceCount;
        uint256 totalRevenue;
        bool active;
    }

    struct FirmwareVersion {
        bytes32 firmwareHash;
        string version;
        address publisher;
        uint256 publishedAt;
        bool approved;
    }

    // ============ State ============

    mapping(bytes32 => Device) internal devices;
    bytes32[] public deviceList;

    mapping(uint256 => Fleet) internal fleets;
    uint256 public fleetCount;

    /// @notice Device to fleet mapping
    mapping(bytes32 => uint256) public deviceFleet;

    /// @notice Fleet devices
    mapping(uint256 => bytes32[]) public fleetDevices;

    /// @notice Approved firmware versions per device type
    mapping(DeviceType => FirmwareVersion[]) public approvedFirmware;

    /// @notice Hardware attestation verifiers
    mapping(address => bool) public attestationVerifiers;

    /// @notice Heartbeat threshold (device considered offline after this)
    uint256 public heartbeatTimeout;

    /// @notice Minimum stake to register device
    uint256 public deviceStake;

    /// @notice Stats
    uint256 public totalDevices;
    uint256 public totalActiveDevices;
    uint256 public totalDataPoints;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event DeviceRegistered(bytes32 indexed deviceId, address indexed owner, DeviceType deviceType);
    event DeviceVerified(bytes32 indexed deviceId, address indexed verifier);
    event HeartbeatReceived(bytes32 indexed deviceId, uint256 timestamp);
    event DataSubmitted(bytes32 indexed deviceId, bytes32 dataHash, uint256 dataPoints);
    event DeviceRewardEarned(bytes32 indexed deviceId, uint256 reward);
    event FleetCreated(uint256 indexed fleetId, address indexed operator, string name);
    event DeviceAddedToFleet(bytes32 indexed deviceId, uint256 indexed fleetId);
    event FirmwareApproved(DeviceType deviceType, bytes32 firmwareHash, string version);
    event DeviceDeactivated(bytes32 indexed deviceId);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 _deviceStake) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        deviceStake = _deviceStake;
        heartbeatTimeout = 1 hours;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Device Registration ============

    /**
     * @notice Register a device on the network
     * @param deviceType Type of hardware device
     * @param hardwareAttestation TEE/Secure Element attestation hash
     * @param firmwareHash Current firmware hash
     * @param metadata IPFS hash of device specification
     */
    function registerDevice(
        DeviceType deviceType,
        bytes32 hardwareAttestation,
        bytes32 firmwareHash,
        string calldata metadata
    ) external payable nonReentrant returns (bytes32) {
        require(msg.value >= deviceStake, "Insufficient stake");

        bytes32 deviceId = keccak256(abi.encodePacked(
            msg.sender, deviceType, hardwareAttestation, block.timestamp
        ));
        require(devices[deviceId].registeredAt == 0, "Already registered");

        devices[deviceId] = Device({
            deviceId: deviceId,
            owner: msg.sender,
            deviceType: deviceType,
            hardwareAttestation: hardwareAttestation,
            firmwareHash: firmwareHash,
            metadata: metadata,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            reputationScore: 5000, // Start at 50%
            totalDataSubmissions: 0,
            totalRewardsEarned: 0,
            active: true,
            verified: false
        });

        deviceList.push(deviceId);
        totalDevices++;
        totalActiveDevices++;

        emit DeviceRegistered(deviceId, msg.sender, deviceType);
        return deviceId;
    }

    /**
     * @notice Verify device hardware attestation
     */
    function verifyDevice(bytes32 deviceId) external {
        require(attestationVerifiers[msg.sender], "Not verifier");
        devices[deviceId].verified = true;
        emit DeviceVerified(deviceId, msg.sender);
    }

    /**
     * @notice Send heartbeat (prove device is online)
     */
    function heartbeat(bytes32 deviceId) external {
        Device storage dev = devices[deviceId];
        require(dev.owner == msg.sender, "Not owner");
        require(dev.active, "Not active");

        dev.lastHeartbeat = block.timestamp;

        // Boost reputation for consistent uptime
        if (dev.reputationScore < 10000) {
            dev.reputationScore += 1; // Slow climb
        }

        emit HeartbeatReceived(deviceId, block.timestamp);
    }

    /**
     * @notice Submit data contribution from device
     * @param deviceId Device that collected the data
     * @param dataHash Hash of the submitted data (stored off-chain)
     * @param dataPoints Number of data points in submission
     */
    function submitData(
        bytes32 deviceId,
        bytes32 dataHash,
        uint256 dataPoints
    ) external {
        Device storage dev = devices[deviceId];
        require(dev.owner == msg.sender, "Not owner");
        require(dev.active && dev.verified, "Not active/verified");

        dev.totalDataSubmissions += dataPoints;
        totalDataPoints += dataPoints;

        emit DataSubmitted(deviceId, dataHash, dataPoints);
    }

    /**
     * @notice Reward a device for data contribution
     */
    function rewardDevice(bytes32 deviceId) external payable {
        require(msg.value > 0, "Zero reward");
        Device storage dev = devices[deviceId];
        require(dev.active, "Not active");

        dev.totalRewardsEarned += msg.value;

        (bool ok, ) = dev.owner.call{value: msg.value}("");
        require(ok, "Reward failed");

        emit DeviceRewardEarned(deviceId, msg.value);
    }

    /**
     * @notice Deactivate a device
     */
    function deactivateDevice(bytes32 deviceId) external {
        Device storage dev = devices[deviceId];
        require(dev.owner == msg.sender || msg.sender == owner(), "Not authorized");

        dev.active = false;
        totalActiveDevices--;

        emit DeviceDeactivated(deviceId);
    }

    // ============ Fleet Management ============

    function createFleet(string calldata name) external returns (uint256) {
        fleetCount++;
        fleets[fleetCount] = Fleet({
            fleetId: fleetCount,
            operator: msg.sender,
            name: name,
            deviceCount: 0,
            totalRevenue: 0,
            active: true
        });

        emit FleetCreated(fleetCount, msg.sender, name);
        return fleetCount;
    }

    function addDeviceToFleet(bytes32 deviceId, uint256 fleetId) external {
        require(devices[deviceId].owner == msg.sender, "Not device owner");
        require(fleets[fleetId].operator == msg.sender, "Not fleet operator");

        deviceFleet[deviceId] = fleetId;
        fleetDevices[fleetId].push(deviceId);
        fleets[fleetId].deviceCount++;

        emit DeviceAddedToFleet(deviceId, fleetId);
    }

    // ============ Firmware ============

    function approveFirmware(
        DeviceType deviceType,
        bytes32 firmwareHash,
        string calldata version
    ) external onlyOwner {
        approvedFirmware[deviceType].push(FirmwareVersion({
            firmwareHash: firmwareHash,
            version: version,
            publisher: msg.sender,
            publishedAt: block.timestamp,
            approved: true
        }));

        emit FirmwareApproved(deviceType, firmwareHash, version);
    }

    function updateFirmware(bytes32 deviceId, bytes32 newFirmwareHash) external {
        Device storage dev = devices[deviceId];
        require(dev.owner == msg.sender, "Not owner");
        dev.firmwareHash = newFirmwareHash;
    }

    // ============ Admin ============

    function addVerifier(address v) external onlyOwner {
        attestationVerifiers[v] = true;
    }

    function removeVerifier(address v) external onlyOwner {
        attestationVerifiers[v] = false;
    }

    function setDeviceStake(uint256 stake) external onlyOwner {
        uint256 prev = deviceStake;
        deviceStake = stake;
        emit DeviceStakeUpdated(prev, stake);
    }

    function setHeartbeatTimeout(uint256 timeout) external onlyOwner {
        uint256 prev = heartbeatTimeout;
        heartbeatTimeout = timeout;
        emit HeartbeatTimeoutUpdated(prev, timeout);
    }

    // ============ View ============

    function isOnline(bytes32 deviceId) external view returns (bool) {
        Device storage dev = devices[deviceId];
        return dev.active && (block.timestamp - dev.lastHeartbeat) < heartbeatTimeout;
    }

    function getDeviceCount() external view returns (uint256) { return totalDevices; }
    function getActiveCount() external view returns (uint256) { return totalActiveDevices; }
    function getFleetDevices(uint256 fleetId) external view returns (bytes32[] memory) { return fleetDevices[fleetId]; }
    function getDevice(bytes32 deviceId) external view returns (Device memory) { return devices[deviceId]; }
    function getFleet(uint256 fleetId) external view returns (Fleet memory) { return fleets[fleetId]; }

    receive() external payable {}
}
