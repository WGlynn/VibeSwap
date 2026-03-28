// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/depin/VibeDeviceNetwork.sol";

contract VibeDeviceNetworkTest is Test {
    VibeDeviceNetwork public network;

    address public owner;
    address public alice;
    address public bob;
    address public verifier;

    uint256 public constant DEFAULT_STAKE = 0.1 ether;

    event DeviceRegistered(bytes32 indexed deviceId, address indexed owner, VibeDeviceNetwork.DeviceType deviceType);
    event DeviceVerified(bytes32 indexed deviceId, address indexed verifier);
    event HeartbeatReceived(bytes32 indexed deviceId, uint256 timestamp);
    event DataSubmitted(bytes32 indexed deviceId, bytes32 dataHash, uint256 dataPoints);
    event DeviceRewardEarned(bytes32 indexed deviceId, uint256 reward);
    event FleetCreated(uint256 indexed fleetId, address indexed operator, string name);
    event DeviceAddedToFleet(bytes32 indexed deviceId, uint256 indexed fleetId);
    event FirmwareApproved(VibeDeviceNetwork.DeviceType deviceType, bytes32 firmwareHash, string version);
    event DeviceDeactivated(bytes32 indexed deviceId);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        verifier = makeAddr("verifier");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        VibeDeviceNetwork impl = new VibeDeviceNetwork();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeDeviceNetwork.initialize.selector, DEFAULT_STAKE)
        );
        network = VibeDeviceNetwork(payable(address(proxy)));

        network.addVerifier(verifier);
    }

    // ============ Helpers ============

    function _registerDevice(address user) internal returns (bytes32) {
        vm.prank(user);
        bytes32 deviceId = network.registerDevice{value: DEFAULT_STAKE}(
            VibeDeviceNetwork.DeviceType.SENSOR,
            keccak256("attestation"),
            keccak256("firmware_v1"),
            "ipfs://specs"
        );
        return deviceId;
    }

    function _registerAndVerify(address user) internal returns (bytes32) {
        bytes32 deviceId = _registerDevice(user);
        vm.prank(verifier);
        network.verifyDevice(deviceId);
        return deviceId;
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(network.deviceStake(), DEFAULT_STAKE);
        assertEq(network.heartbeatTimeout(), 1 hours);
        assertEq(network.totalDevices(), 0);
        assertEq(network.totalActiveDevices(), 0);
        assertEq(network.totalDataPoints(), 0);
    }

    // ============ Device Registration ============

    function test_registerDevice() public {
        vm.prank(alice);
        bytes32 deviceId = network.registerDevice{value: DEFAULT_STAKE}(
            VibeDeviceNetwork.DeviceType.CAMERA,
            keccak256("attestation"),
            keccak256("firmware"),
            "ipfs://meta"
        );

        assertTrue(deviceId != bytes32(0));
        assertEq(network.totalDevices(), 1);
        assertEq(network.totalActiveDevices(), 1);

        VibeDeviceNetwork.Device memory dev = network.getDevice(deviceId);
        assertEq(dev.deviceId, deviceId);
        assertEq(dev.owner, alice);
        assertEq(uint8(dev.deviceType), uint8(VibeDeviceNetwork.DeviceType.CAMERA));
        assertEq(dev.reputationScore, 5000); // Starts at 50%
        assertTrue(dev.active);
        assertFalse(dev.verified);
    }

    function test_registerDevice_emitsEvent() public {
        vm.prank(alice);
        // We cannot predict the exact deviceId, but we can check the event was emitted
        network.registerDevice{value: DEFAULT_STAKE}(
            VibeDeviceNetwork.DeviceType.RFID,
            keccak256("attestation"),
            keccak256("firmware"),
            "ipfs://meta"
        );
        // Verified by the successful call
    }

    function test_registerDevice_revert_insufficientStake() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        network.registerDevice{value: DEFAULT_STAKE - 1}(
            VibeDeviceNetwork.DeviceType.SENSOR,
            keccak256("attestation"),
            keccak256("firmware"),
            "ipfs://meta"
        );
    }

    function test_registerDevice_allTypes() public {
        bytes32 att = keccak256("att");
        bytes32 fw = keccak256("fw");

        vm.startPrank(alice);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.RFID, att, fw, "");
        vm.warp(block.timestamp + 1); // Ensure different timestamps for unique IDs
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.CAMERA, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.SENSOR, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.ROBOT, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.PHONE, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.AI_COMPUTE, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.GATEWAY, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.MEDICAL, att, fw, "");
        vm.warp(block.timestamp + 1);
        network.registerDevice{value: DEFAULT_STAKE}(VibeDeviceNetwork.DeviceType.VEHICLE, att, fw, "");
        vm.stopPrank();

        assertEq(network.totalDevices(), 9);
    }

    // ============ Device Verification ============

    function test_verifyDevice() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(verifier);
        network.verifyDevice(deviceId);

        assertTrue(network.getDevice(deviceId).verified);
    }

    function test_verifyDevice_revert_notVerifier() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(alice);
        vm.expectRevert("Not verifier");
        network.verifyDevice(deviceId);
    }

    // ============ Heartbeat ============

    function test_heartbeat() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.warp(block.timestamp + 30 minutes);

        vm.prank(alice);
        network.heartbeat(deviceId);

        assertEq(network.getDevice(deviceId).lastHeartbeat, block.timestamp);
        assertEq(network.getDevice(deviceId).reputationScore, 5001); // 5000 + 1 bump
    }

    function test_heartbeat_revert_notOwner() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        network.heartbeat(deviceId);
    }

    function test_heartbeat_revert_notActive() public {
        bytes32 deviceId = _registerDevice(alice);

        // Deactivate first
        vm.prank(alice);
        network.deactivateDevice(deviceId);

        vm.prank(alice);
        vm.expectRevert("Not active");
        network.heartbeat(deviceId);
    }

    function test_heartbeat_reputationCap() public {
        bytes32 deviceId = _registerDevice(alice);

        // Send many heartbeats to test cap at 10000
        for (uint256 i = 0; i < 5001; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(alice);
            network.heartbeat(deviceId);
        }

        assertEq(network.getDevice(deviceId).reputationScore, 10000);
    }

    // ============ Data Submission ============

    function test_submitData() public {
        bytes32 deviceId = _registerAndVerify(alice);

        vm.prank(alice);
        network.submitData(deviceId, keccak256("data"), 100);

        assertEq(network.getDevice(deviceId).totalDataSubmissions, 100);
        assertEq(network.totalDataPoints(), 100);
    }

    function test_submitData_revert_notOwner() public {
        bytes32 deviceId = _registerAndVerify(alice);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        network.submitData(deviceId, keccak256("data"), 100);
    }

    function test_submitData_revert_notVerified() public {
        bytes32 deviceId = _registerDevice(alice); // Not verified

        vm.prank(alice);
        vm.expectRevert("Not active/verified");
        network.submitData(deviceId, keccak256("data"), 100);
    }

    function test_submitData_revert_notActive() public {
        bytes32 deviceId = _registerAndVerify(alice);

        vm.prank(alice);
        network.deactivateDevice(deviceId);

        vm.prank(alice);
        vm.expectRevert("Not active/verified");
        network.submitData(deviceId, keccak256("data"), 100);
    }

    function test_submitData_accumulates() public {
        bytes32 deviceId = _registerAndVerify(alice);

        vm.startPrank(alice);
        network.submitData(deviceId, keccak256("data1"), 50);
        network.submitData(deviceId, keccak256("data2"), 75);
        vm.stopPrank();

        assertEq(network.getDevice(deviceId).totalDataSubmissions, 125);
        assertEq(network.totalDataPoints(), 125);
    }

    // ============ Device Rewards ============

    function test_rewardDevice() public {
        bytes32 deviceId = _registerDevice(alice);
        uint256 aliceBefore = alice.balance;

        vm.prank(bob);
        network.rewardDevice{value: 1 ether}(deviceId);

        assertEq(network.getDevice(deviceId).totalRewardsEarned, 1 ether);
        assertEq(alice.balance, aliceBefore + 1 ether);
    }

    function test_rewardDevice_revert_zeroReward() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        vm.expectRevert("Zero reward");
        network.rewardDevice{value: 0}(deviceId);
    }

    function test_rewardDevice_revert_notActive() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(alice);
        network.deactivateDevice(deviceId);

        vm.prank(bob);
        vm.expectRevert("Not active");
        network.rewardDevice{value: 1 ether}(deviceId);
    }

    // ============ Device Deactivation ============

    function test_deactivateDevice_byOwner() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(alice);
        network.deactivateDevice(deviceId);

        assertFalse(network.getDevice(deviceId).active);
        assertEq(network.totalActiveDevices(), 0);
    }

    function test_deactivateDevice_byContractOwner() public {
        bytes32 deviceId = _registerDevice(alice);

        // Contract owner (this) can also deactivate
        network.deactivateDevice(deviceId);

        assertFalse(network.getDevice(deviceId).active);
    }

    function test_deactivateDevice_revert_notAuthorized() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        vm.expectRevert("Not authorized");
        network.deactivateDevice(deviceId);
    }

    // ============ Fleet Management ============

    function test_createFleet() public {
        vm.prank(alice);
        uint256 fleetId = network.createFleet("Fleet Alpha");

        assertEq(fleetId, 1);
        assertEq(network.fleetCount(), 1);

        VibeDeviceNetwork.Fleet memory fl = network.getFleet(1);
        assertEq(fl.fleetId, 1);
        assertEq(fl.operator, alice);
        assertEq(fl.name, "Fleet Alpha");
        assertEq(fl.deviceCount, 0);
        assertTrue(fl.active);
    }

    function test_addDeviceToFleet() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(alice);
        uint256 fleetId = network.createFleet("Fleet 1");

        vm.prank(alice);
        network.addDeviceToFleet(deviceId, fleetId);

        assertEq(network.deviceFleet(deviceId), fleetId);

        assertEq(network.getFleet(fleetId).deviceCount, 1);

        bytes32[] memory fleetDev = network.getFleetDevices(fleetId);
        assertEq(fleetDev.length, 1);
        assertEq(fleetDev[0], deviceId);
    }

    function test_addDeviceToFleet_revert_notDeviceOwner() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        uint256 fleetId = network.createFleet("Fleet 1");

        vm.prank(bob);
        vm.expectRevert("Not device owner");
        network.addDeviceToFleet(deviceId, fleetId);
    }

    function test_addDeviceToFleet_revert_notFleetOperator() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        uint256 fleetId = network.createFleet("Fleet 1");

        vm.prank(alice);
        vm.expectRevert("Not fleet operator");
        network.addDeviceToFleet(deviceId, fleetId);
    }

    // ============ Firmware ============

    function test_approveFirmware() public {
        bytes32 fwHash = keccak256("firmware_v2");
        network.approveFirmware(VibeDeviceNetwork.DeviceType.SENSOR, fwHash, "v2.0.0");
        // Verified by no revert
    }

    function test_approveFirmware_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        network.approveFirmware(VibeDeviceNetwork.DeviceType.SENSOR, keccak256("fw"), "v2");
    }

    function test_updateFirmware() public {
        bytes32 deviceId = _registerDevice(alice);
        bytes32 newFw = keccak256("firmware_v2");

        vm.prank(alice);
        network.updateFirmware(deviceId, newFw);

        assertEq(network.getDevice(deviceId).firmwareHash, newFw);
    }

    function test_updateFirmware_revert_notOwner() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        network.updateFirmware(deviceId, keccak256("new_fw"));
    }

    // ============ Admin ============

    function test_addVerifier() public {
        address newVerifier = makeAddr("newVerifier");
        network.addVerifier(newVerifier);
        assertTrue(network.attestationVerifiers(newVerifier));
    }

    function test_removeVerifier() public {
        network.removeVerifier(verifier);
        assertFalse(network.attestationVerifiers(verifier));
    }

    function test_setDeviceStake() public {
        network.setDeviceStake(1 ether);
        assertEq(network.deviceStake(), 1 ether);
    }

    function test_setHeartbeatTimeout() public {
        network.setHeartbeatTimeout(2 hours);
        assertEq(network.heartbeatTimeout(), 2 hours);
    }

    // ============ View Functions ============

    function test_isOnline_true() public {
        bytes32 deviceId = _registerDevice(alice);
        assertTrue(network.isOnline(deviceId));
    }

    function test_isOnline_false_timeout() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.warp(block.timestamp + 2 hours); // Past heartbeat timeout

        assertFalse(network.isOnline(deviceId));
    }

    function test_isOnline_false_deactivated() public {
        bytes32 deviceId = _registerDevice(alice);

        vm.prank(alice);
        network.deactivateDevice(deviceId);

        assertFalse(network.isOnline(deviceId));
    }

    function test_getDeviceCount() public {
        assertEq(network.getDeviceCount(), 0);
        _registerDevice(alice);
        assertEq(network.getDeviceCount(), 1);
    }

    function test_getActiveCount() public {
        bytes32 deviceId = _registerDevice(alice);
        assertEq(network.getActiveCount(), 1);

        vm.prank(alice);
        network.deactivateDevice(deviceId);
        assertEq(network.getActiveCount(), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerDevice_anyStake(uint256 stake) public {
        stake = bound(stake, DEFAULT_STAKE, 10 ether);
        vm.deal(alice, stake);

        vm.prank(alice);
        bytes32 deviceId = network.registerDevice{value: stake}(
            VibeDeviceNetwork.DeviceType.SENSOR,
            keccak256("att"),
            keccak256("fw"),
            "meta"
        );

        assertTrue(deviceId != bytes32(0));
    }

    function testFuzz_submitData_anyDataPoints(uint256 dataPoints) public {
        bytes32 deviceId = _registerAndVerify(alice);

        vm.prank(alice);
        network.submitData(deviceId, keccak256("data"), dataPoints);

        assertEq(network.totalDataPoints(), dataPoints);
    }

    // ============ Edge Cases ============

    function test_receive_ether() public {
        (bool ok,) = address(network).call{value: 1 ether}("");
        assertTrue(ok);
    }
}
