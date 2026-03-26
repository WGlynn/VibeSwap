// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/VibeEmergencyDAO.sol";

/// @dev Minimal pausable stub for emergency action tests
contract PausableStub {
    bool public paused;
    bool public circuitBroken;

    function pause() external { paused = true; }
    function unpause() external { paused = false; }
    function triggerCircuitBreaker() external { circuitBroken = true; }
}

contract VibeEmergencyDAOTest is Test {
    VibeEmergencyDAO public dao;
    PausableStub     public stub;

    address public owner;
    address public g0;
    address public g1;
    address public g2;
    address public g3;
    address public g4;
    address public stranger;

    event EmergencyProposed(uint256 indexed id, VibeEmergencyDAO.ActionType actionType, address target, string reason);
    event EmergencyApproved(uint256 indexed id, address guardian);
    event EmergencyExecuted(uint256 indexed id, VibeEmergencyDAO.ActionType actionType, address target);
    event EmergencyExpired(uint256 indexed id);
    event AddressFrozen(address indexed addr, string reason);
    event AddressUnfrozen(address indexed addr);
    event ContractPaused(address indexed target);
    event ContractUnpaused(address indexed target);
    event GuardianRotated(uint256 index, address oldGuardian, address newGuardian);

    function setUp() public {
        owner    = address(this);
        g0       = makeAddr("g0");
        g1       = makeAddr("g1");
        g2       = makeAddr("g2");
        g3       = makeAddr("g3");
        g4       = makeAddr("g4");
        stranger = makeAddr("stranger");

        address[5] memory guardians = [g0, g1, g2, g3, g4];

        VibeEmergencyDAO impl = new VibeEmergencyDAO();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeEmergencyDAO.initialize.selector, guardians)
        );
        dao = VibeEmergencyDAO(payable(address(proxy)));

        stub = new PausableStub();
    }

    // ============ Helpers ============

    /// Propose an action and return its id. Proposer auto-approves (count = 1).
    function _propose(
        address proposer,
        VibeEmergencyDAO.ActionType aType,
        address target_,
        bytes memory data_,
        string memory reason_
    ) internal returns (uint256 id) {
        vm.prank(proposer);
        id = dao.proposeEmergency(aType, target_, data_, reason_);
    }

    /// Approve an action from a guardian
    function _approve(address guardian, uint256 id) internal {
        vm.prank(guardian);
        dao.approveEmergency(id);
    }

    /// Reach the 3-of-5 threshold: proposer = g0, then g1 + g2 approve
    function _reach3of5(
        VibeEmergencyDAO.ActionType aType,
        address target_,
        bytes memory data_,
        string memory reason_
    ) internal returns (uint256 id) {
        id = _propose(g0, aType, target_, data_, reason_);
        _approve(g1, id);
        // g2 triggers execution
        vm.prank(g2);
        dao.approveEmergency(id);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        address[5] memory gs = dao.getGuardians();
        assertEq(gs[0], g0);
        assertEq(gs[1], g1);
        assertEq(gs[2], g2);
        assertEq(gs[3], g3);
        assertEq(gs[4], g4);

        assertTrue(dao.isGuardian(g0));
        assertTrue(dao.isGuardian(g4));
        assertFalse(dao.isGuardian(stranger));

        assertEq(dao.actionCount(), 0);
        assertEq(dao.totalActionsExecuted(), 0);
    }

    function test_init_revert_zeroGuardian() public {
        address[5] memory bad = [g0, g1, g2, g3, address(0)];
        VibeEmergencyDAO impl2 = new VibeEmergencyDAO();
        vm.expectRevert("Zero guardian");
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeEmergencyDAO.initialize.selector, bad)
        );
    }

    // ============ Propose ============

    function test_proposeEmergency_basic() public {
        vm.prank(g0);
        vm.expectEmit(true, false, false, true);
        emit EmergencyProposed(0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "test");
        uint256 id = dao.proposeEmergency(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "test");

        assertEq(id, 0);
        assertEq(dao.actionCount(), 1);
        assertTrue(dao.approvals(id, g0));

        VibeEmergencyDAO.EmergencyAction memory a = dao.getAction(id);
        assertEq(uint8(a.actionType), uint8(VibeEmergencyDAO.ActionType.PAUSE));
        assertEq(a.target, address(stub));
        assertEq(a.approvalCount, 1);
        assertFalse(a.executed);
        assertFalse(a.expired);
        assertEq(a.proposer, g0);
    }

    function test_proposeEmergency_revert_notGuardian() public {
        vm.prank(stranger);
        vm.expectRevert("Not guardian");
        dao.proposeEmergency(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "reason");
    }

    function test_proposeEmergency_revert_cooldown() public {
        // First proposal ok
        _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "first");
        // Second proposal immediately blocked by cooldown — need an executed action first
        // Actually cooldown checks lastActionTime+COOLDOWN; lastActionTime only updates on execute.
        // So consecutive proposals before any execution are fine. But after an execution:
        _approve(g1, 0);
        _approve(g2, 0); // executes, sets lastActionTime

        vm.prank(g0);
        vm.expectRevert("Cooldown active");
        dao.proposeEmergency(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "too soon");
    }

    function test_proposeEmergency_afterCooldown() public {
        _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "first");
        _approve(g1, 0);
        _approve(g2, 0); // executes at block.timestamp

        vm.warp(block.timestamp + dao.COOLDOWN() + 1);

        vm.prank(g0);
        uint256 id2 = dao.proposeEmergency(VibeEmergencyDAO.ActionType.UNPAUSE, address(stub), "", "second");
        assertEq(id2, 1);
    }

    // ============ Approve & Execute ============

    function test_approveEmergency_incrementsCount() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.prank(g1);
        vm.expectEmit(true, false, false, true);
        emit EmergencyApproved(id, g1);
        dao.approveEmergency(id);

        VibeEmergencyDAO.EmergencyAction memory a = dao.getAction(id);
        assertEq(a.approvalCount, 2);
        assertTrue(dao.approvals(id, g1));
    }

    function test_approveEmergency_revert_notGuardian() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.prank(stranger);
        vm.expectRevert("Not guardian");
        dao.approveEmergency(id);
    }

    function test_approveEmergency_revert_alreadyApproved() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.prank(g0);
        vm.expectRevert("Already approved");
        dao.approveEmergency(id);
    }

    function test_approveEmergency_revert_expired() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.warp(block.timestamp + dao.EXPIRY_WINDOW() + 1);
        dao.expireAction(id);

        vm.prank(g1);
        vm.expectRevert("Expired");
        dao.approveEmergency(id);
    }

    function test_approveEmergency_revert_windowClosed() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.warp(block.timestamp + dao.EXPIRY_WINDOW() + 1);

        vm.prank(g1);
        vm.expectRevert("Window closed");
        dao.approveEmergency(id);
    }

    // ============ Action Types ============

    function test_execute_pause() public {
        bytes memory data = "";
        vm.expectEmit(false, false, false, true);
        emit ContractPaused(address(stub));
        _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), data, "pause test");

        assertTrue(dao.isPaused(address(stub)));
        assertEq(dao.totalActionsExecuted(), 1);
    }

    function test_execute_unpause() public {
        // First pause it
        _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "pause");
        vm.warp(block.timestamp + dao.COOLDOWN() + 1);

        vm.expectEmit(false, false, false, true);
        emit ContractUnpaused(address(stub));
        _reach3of5(VibeEmergencyDAO.ActionType.UNPAUSE, address(stub), "", "unpause");

        assertFalse(dao.isPaused(address(stub)));
        assertEq(dao.totalActionsExecuted(), 2);
    }

    function test_execute_freezeAddress() public {
        address victim = makeAddr("victim");

        vm.expectEmit(true, false, false, false);
        emit AddressFrozen(victim, "hacker");
        _reach3of5(VibeEmergencyDAO.ActionType.FREEZE_ADDRESS, victim, "", "hacker");

        assertTrue(dao.isFrozen(victim));
    }

    function test_execute_circuitBreaker_withCalldata() public {
        bytes memory data = abi.encodeWithSelector(PausableStub.triggerCircuitBreaker.selector);

        _reach3of5(VibeEmergencyDAO.ActionType.CIRCUIT_BREAKER, address(stub), data, "cb");

        assertTrue(stub.circuitBroken());
    }

    function test_execute_escalate_withCalldata() public {
        bytes memory data = abi.encodeWithSelector(PausableStub.pause.selector);

        _reach3of5(VibeEmergencyDAO.ActionType.ESCALATE, address(stub), data, "escalate");

        assertTrue(stub.paused());
    }

    function test_execute_emitsExecuted() public {
        vm.expectEmit(true, false, false, true);
        emit EmergencyExecuted(0, VibeEmergencyDAO.ActionType.PAUSE, address(stub));
        _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "emit test");
    }

    function test_execute_updatesLastActionTime() public {
        uint256 before = block.timestamp;
        _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");
        assertEq(dao.lastActionTime(), before);
    }

    function test_approveEmergency_revert_alreadyExecuted() public {
        uint256 id = _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.prank(g3);
        vm.expectRevert("Already executed");
        dao.approveEmergency(id);
    }

    // ============ Expiry ============

    function test_expireAction() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.warp(block.timestamp + dao.EXPIRY_WINDOW() + 1);

        vm.expectEmit(true, false, false, false);
        emit EmergencyExpired(id);
        dao.expireAction(id);

        VibeEmergencyDAO.EmergencyAction memory a = dao.getAction(id);
        assertTrue(a.expired);
    }

    function test_expireAction_revert_notExpired() public {
        uint256 id = _propose(g0, VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");

        vm.expectRevert("Not expired");
        dao.expireAction(id);
    }

    function test_expireAction_revert_alreadyExecuted() public {
        uint256 id = _reach3of5(VibeEmergencyDAO.ActionType.PAUSE, address(stub), "", "r");
        vm.warp(block.timestamp + dao.EXPIRY_WINDOW() + 1);

        vm.expectRevert("Already executed");
        dao.expireAction(id);
    }

    // ============ Guardian Rotation ============

    function test_rotateGuardian() public {
        address newGuard = makeAddr("newGuard");

        vm.expectEmit(false, false, false, true);
        emit GuardianRotated(0, g0, newGuard);
        dao.rotateGuardian(0, newGuard);

        address[5] memory gs = dao.getGuardians();
        assertEq(gs[0], newGuard);
        assertTrue(dao.isGuardian(newGuard));
        // Old guardian is no longer in the array but isGuardian does a linear search
        assertFalse(dao.isGuardian(g0));
    }

    function test_rotateGuardian_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        dao.rotateGuardian(0, stranger);
    }

    function test_rotateGuardian_revert_invalidIndex() public {
        vm.expectRevert("Invalid index");
        dao.rotateGuardian(5, makeAddr("x"));
    }

    function test_rotateGuardian_revert_zeroAddress() public {
        vm.expectRevert("Zero address");
        dao.rotateGuardian(0, address(0));
    }

    // ============ Unfreeze ============

    function test_unfreezeAddress() public {
        address victim = makeAddr("victim");
        _reach3of5(VibeEmergencyDAO.ActionType.FREEZE_ADDRESS, victim, "", "freeze");
        assertTrue(dao.isFrozen(victim));

        vm.warp(block.timestamp + dao.COOLDOWN() + 1);

        vm.expectEmit(true, false, false, false);
        emit AddressUnfrozen(victim);
        dao.unfreezeAddress(victim);

        assertFalse(dao.isFrozen(victim));
    }

    function test_unfreezeAddress_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        dao.unfreezeAddress(stranger);
    }

    // ============ View Helpers ============

    function test_isGuardian_returnsCorrect() public view {
        assertTrue(dao.isGuardian(g0));
        assertTrue(dao.isGuardian(g1));
        assertFalse(dao.isGuardian(stranger));
    }

    function test_isPaused_defaultFalse() public view {
        assertFalse(dao.isPaused(address(stub)));
    }

    function test_isFrozen_defaultFalse() public view {
        assertFalse(dao.isFrozen(stranger));
    }

    function test_receiveEther() public {
        (bool ok,) = address(dao).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_proposeAndApprove_multipleActions(uint8 count) public {
        count = uint8(bound(count, 1, 5));

        for (uint8 i = 0; i < count; i++) {
            vm.warp(block.timestamp + dao.COOLDOWN() + 1);
            address addr = makeAddr(string(abi.encodePacked("target", i)));
            _reach3of5(VibeEmergencyDAO.ActionType.FREEZE_ADDRESS, addr, "", "fuzz");
            assertTrue(dao.isFrozen(addr));
        }

        assertEq(dao.totalActionsExecuted(), count);
    }
}
