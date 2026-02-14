// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibeTimelock.sol";
import "../contracts/governance/interfaces/IVibeTimelock.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTLToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTLOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

/// @dev Simple target contract to test timelock execution
contract MockTarget {
    uint256 public value;
    address public lastCaller;

    function setValue(uint256 _value) external {
        value = _value;
        lastCaller = msg.sender;
    }

    function setValuePayable(uint256 _value) external payable {
        value = _value;
        lastCaller = msg.sender;
    }

    function revertAlways() external pure {
        revert("MockTarget: revert");
    }
}

// ============ Test Contract ============

contract VibeTimelockTest is Test {
    VibeTimelock public timelock;
    MockTLToken public jul;
    MockTLOracle public oracle;
    MockTarget public target;

    // Re-declare events
    event OperationScheduled(bytes32 indexed operationId, address indexed target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay);
    event OperationExecuted(bytes32 indexed operationId, address indexed target, uint256 value, bytes data);
    event OperationCancelled(bytes32 indexed operationId);
    event BatchScheduled(bytes32 indexed operationId, uint256 operationCount, bytes32 predecessor, bytes32 salt, uint256 delay);
    event BatchExecuted(bytes32 indexed operationId, uint256 operationCount);
    event MinDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event ProposerUpdated(address indexed account, bool authorized);
    event ExecutorUpdated(address indexed account, bool authorized);
    event CancellerUpdated(address indexed account, bool authorized);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);

    // ============ Actors ============

    address public proposer;
    address public executor;
    address public canceller;
    address public guardian;
    address public nobody;

    // ============ Constants ============

    uint256 constant MIN_DELAY = 2 days;
    bytes32 constant NO_PREDECESSOR = bytes32(0);
    bytes32 constant SALT = bytes32("salt");

    function setUp() public {
        proposer = makeAddr("proposer");
        executor = makeAddr("executor");
        canceller = makeAddr("canceller");
        guardian = makeAddr("guardian");
        nobody = makeAddr("nobody");

        jul = new MockTLToken("JUL", "JUL");
        oracle = new MockTLOracle();
        target = new MockTarget();

        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = executor;
        address[] memory cancellers = new address[](1);
        cancellers[0] = canceller;

        timelock = new VibeTimelock(
            MIN_DELAY,
            address(jul),
            address(oracle),
            guardian,
            proposers,
            executors,
            cancellers
        );

        // Fund JUL reward pool
        jul.mint(address(this), 1000 ether);
        jul.approve(address(timelock), type(uint256).max);
        timelock.depositJulRewards(100 ether);
    }

    // ============ Helpers ============

    function _scheduleSetValue(uint256 val, uint256 delay) internal returns (bytes32 id, bytes memory data) {
        data = abi.encodeCall(MockTarget.setValue, (val));
        id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, delay);
    }

    function _executeSetValue(uint256 val) internal returns (bytes memory data) {
        data = abi.encodeCall(MockTarget.setValue, (val));
        vm.prank(executor);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsImmutables() public view {
        assertEq(address(timelock.julToken()), address(jul));
        assertEq(address(timelock.reputationOracle()), address(oracle));
        assertEq(timelock.minDelay(), MIN_DELAY);
        assertEq(timelock.guardian(), guardian);
    }

    function test_constructor_setsRoles() public view {
        assertTrue(timelock.isProposer(proposer));
        assertTrue(timelock.isExecutor(executor));
        assertTrue(timelock.isCanceller(canceller));
        assertFalse(timelock.isProposer(nobody));
        assertFalse(timelock.isExecutor(nobody));
        assertFalse(timelock.isCanceller(nobody));
    }

    function test_constructor_zeroAddress_reverts() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(IVibeTimelock.ZeroAddress.selector);
        new VibeTimelock(MIN_DELAY, address(0), address(oracle), guardian, empty, empty, empty);
        vm.expectRevert(IVibeTimelock.ZeroAddress.selector);
        new VibeTimelock(MIN_DELAY, address(jul), address(0), guardian, empty, empty, empty);
    }

    function test_constructor_invalidDelay_reverts() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(IVibeTimelock.DelayBelowMinimum.selector);
        new VibeTimelock(1 hours, address(jul), address(oracle), guardian, empty, empty, empty);
        vm.expectRevert(IVibeTimelock.DelayAboveMaximum.selector);
        new VibeTimelock(31 days, address(jul), address(oracle), guardian, empty, empty, empty);
    }

    function test_constructor_initialState() public view {
        assertEq(timelock.operationCount(), 0);
        assertEq(timelock.julRewardPool(), 100 ether);
    }

    // ============ Schedule Tests ============

    function test_schedule_valid() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);

        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.WAITING));
        assertTrue(timelock.isOperationPending(id));
        assertFalse(timelock.isOperationReady(id));
        assertFalse(timelock.isOperationDone(id));
        assertEq(timelock.operationCount(), 1);
    }

    function test_schedule_emitsEvent() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);

        vm.expectEmit(true, true, false, true);
        emit OperationScheduled(id, address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
    }

    function test_schedule_notProposer_reverts() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(nobody);
        vm.expectRevert(IVibeTimelock.NotProposer.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
    }

    function test_schedule_delayTooShort_reverts() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.DelayBelowMinimum.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, 1 hours);
    }

    function test_schedule_delayTooLong_reverts() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.DelayAboveMaximum.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, 31 days);
    }

    function test_schedule_duplicate_reverts() public {
        _scheduleSetValue(42, MIN_DELAY);

        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.OperationAlreadyScheduled.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
    }

    function test_schedule_sameSaltDifferentData() public {
        _scheduleSetValue(42, MIN_DELAY);

        // Different data, same salt — different operation ID, should work
        bytes memory data2 = abi.encodeCall(MockTarget.setValue, (99));
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data2, NO_PREDECESSOR, SALT, MIN_DELAY);

        assertEq(timelock.operationCount(), 2);
    }

    // ============ Execute Tests ============

    function test_execute_afterDelay() public {
        _scheduleSetValue(42, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        _executeSetValue(42);

        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), address(timelock));
    }

    function test_execute_notReady_reverts() public {
        _scheduleSetValue(42, MIN_DELAY);

        // Try executing before delay
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.OperationNotReady.selector);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_execute_notScheduled_reverts() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.OperationNotReady.selector);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_execute_notExecutor_reverts() public {
        _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);

        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(nobody);
        vm.expectRevert(IVibeTimelock.NotExecutor.selector);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_execute_marksAsDone() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);
        _executeSetValue(42);

        assertTrue(timelock.isOperationDone(id));
        assertFalse(timelock.isOperationPending(id));
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.EXECUTED));
    }

    function test_execute_emitsEvent() public {
        (bytes32 id, bytes memory data) = _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);

        vm.expectEmit(true, true, false, true);
        emit OperationExecuted(id, address(target), 0, data);

        vm.prank(executor);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_execute_withETH() public {
        bytes memory data = abi.encodeCall(MockTarget.setValuePayable, (42));
        vm.prank(proposer);
        timelock.schedule(address(target), 1 ether, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        // Fund timelock with ETH
        vm.deal(address(timelock), 1 ether);

        vm.prank(executor);
        timelock.execute{value: 0}(address(target), 1 ether, data, NO_PREDECESSOR, SALT);

        assertEq(target.value(), 42);
    }

    function test_execute_targetReverts_bubbles() public {
        bytes memory data = abi.encodeCall(MockTarget.revertAlways, ());
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(executor);
        vm.expectRevert("MockTarget: revert");
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_execute_paysKeeperTip() public {
        _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);

        uint256 poolBefore = timelock.julRewardPool();
        uint256 executorBefore = jul.balanceOf(executor);

        _executeSetValue(42);

        assertEq(timelock.julRewardPool(), poolBefore - 10 ether);
        assertEq(jul.balanceOf(executor), executorBefore + 10 ether);
    }

    function test_execute_noTipWhenPoolEmpty() public {
        // Deploy a fresh timelock with no JUL pool
        address[] memory p = new address[](1);
        p[0] = proposer;
        address[] memory e = new address[](1);
        e[0] = executor;
        address[] memory c = new address[](1);
        c[0] = canceller;
        VibeTimelock tl2 = new VibeTimelock(
            MIN_DELAY, address(jul), address(oracle), guardian, p, e, c
        );

        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        tl2.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);

        uint256 executorBefore = jul.balanceOf(executor);
        vm.prank(executor);
        tl2.execute(address(target), 0, data, NO_PREDECESSOR, SALT);

        assertEq(jul.balanceOf(executor), executorBefore); // no tip
        assertEq(target.value(), 42); // still executes
    }

    // ============ Cancel Tests ============

    function test_cancel_valid() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);

        vm.prank(canceller);
        timelock.cancel(id);

        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.CANCELLED));
        assertFalse(timelock.isOperationPending(id));
    }

    function test_cancel_emitsEvent() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);

        vm.expectEmit(true, false, false, false);
        emit OperationCancelled(id);

        vm.prank(canceller);
        timelock.cancel(id);
    }

    function test_cancel_notCanceller_reverts() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);

        vm.prank(nobody);
        vm.expectRevert(IVibeTimelock.NotCanceller.selector);
        timelock.cancel(id);
    }

    function test_cancel_notPending_reverts() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(canceller);
        vm.expectRevert(IVibeTimelock.OperationNotPending.selector);
        timelock.cancel(fakeId);
    }

    function test_cancel_alreadyExecuted_reverts() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);
        _executeSetValue(42);

        vm.prank(canceller);
        vm.expectRevert(IVibeTimelock.OperationAlreadyExecuted.selector);
        timelock.cancel(id);
    }

    function test_cancel_alreadyCancelled_reverts() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);

        vm.prank(canceller);
        timelock.cancel(id);

        vm.prank(canceller);
        vm.expectRevert(IVibeTimelock.OperationAlreadyCancelled.selector);
        timelock.cancel(id);
    }

    function test_cancel_preventsExecution() public {
        (bytes32 id,) = _scheduleSetValue(42, MIN_DELAY);
        vm.prank(canceller);
        timelock.cancel(id);

        vm.warp(block.timestamp + MIN_DELAY);

        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.OperationNotReady.selector);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_cancel_preventsReschedule() public {
        _scheduleSetValue(42, MIN_DELAY);

        bytes32 id = timelock.hashOperation(
            address(target), 0, abi.encodeCall(MockTarget.setValue, (42)), NO_PREDECESSOR, SALT
        );
        vm.prank(canceller);
        timelock.cancel(id);

        // Try to reschedule same operation
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.OperationAlreadyScheduled.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
    }

    // ============ Batch Tests ============

    function test_scheduleBatch_valid() public {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory datas = new bytes[](2);

        targets[0] = address(target);
        targets[1] = address(target);
        values[0] = 0;
        values[1] = 0;
        datas[0] = abi.encodeCall(MockTarget.setValue, (10));
        datas[1] = abi.encodeCall(MockTarget.setValue, (20));

        vm.prank(proposer);
        timelock.scheduleBatch(targets, values, datas, NO_PREDECESSOR, SALT, MIN_DELAY);

        bytes32 id = timelock.hashOperationBatch(targets, values, datas, NO_PREDECESSOR, SALT);
        assertTrue(timelock.isOperationPending(id));
    }

    function test_executeBatch_valid() public {
        MockTarget target2 = new MockTarget();
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory datas = new bytes[](2);

        targets[0] = address(target);
        targets[1] = address(target2);
        values[0] = 0;
        values[1] = 0;
        datas[0] = abi.encodeCall(MockTarget.setValue, (10));
        datas[1] = abi.encodeCall(MockTarget.setValue, (20));

        vm.prank(proposer);
        timelock.scheduleBatch(targets, values, datas, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(executor);
        timelock.executeBatch(targets, values, datas, NO_PREDECESSOR, SALT);

        assertEq(target.value(), 10);
        assertEq(target2.value(), 20);
    }

    function test_scheduleBatch_lengthMismatch_reverts() public {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](1); // mismatch
        bytes[] memory datas = new bytes[](2);

        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.ArrayLengthMismatch.selector);
        timelock.scheduleBatch(targets, values, datas, NO_PREDECESSOR, SALT, MIN_DELAY);
    }

    // ============ Predecessor Tests ============

    function test_predecessor_blocksExecution() public {
        bytes memory data1 = abi.encodeCall(MockTarget.setValue, (1));
        bytes memory data2 = abi.encodeCall(MockTarget.setValue, (2));
        bytes32 salt2 = bytes32("salt2");

        // Schedule op1
        bytes32 id1 = timelock.hashOperation(address(target), 0, data1, NO_PREDECESSOR, SALT);
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data1, NO_PREDECESSOR, SALT, MIN_DELAY);

        // Schedule op2 with op1 as predecessor
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data2, id1, salt2, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        // Try executing op2 before op1 — should fail
        vm.prank(executor);
        vm.expectRevert(IVibeTimelock.PredecessorNotExecuted.selector);
        timelock.execute(address(target), 0, data2, id1, salt2);

        // Execute op1 first
        vm.prank(executor);
        timelock.execute(address(target), 0, data1, NO_PREDECESSOR, SALT);

        // Now op2 should work
        vm.prank(executor);
        timelock.execute(address(target), 0, data2, id1, salt2);

        assertEq(target.value(), 2);
    }

    // ============ Emergency Tests ============

    function test_scheduleEmergency_valid() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (911));
        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);

        vm.prank(guardian);
        timelock.scheduleEmergency(address(target), 0, data, NO_PREDECESSOR, SALT);

        assertTrue(timelock.isOperationPending(id));

        // Should be ready after 6 hours
        vm.warp(block.timestamp + 6 hours);
        assertTrue(timelock.isOperationReady(id));
    }

    function test_scheduleEmergency_notGuardian_reverts() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (911));
        vm.prank(nobody);
        vm.expectRevert(IVibeTimelock.NotGuardian.selector);
        timelock.scheduleEmergency(address(target), 0, data, NO_PREDECESSOR, SALT);
    }

    function test_scheduleEmergency_executeAfterDelay() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (911));

        vm.prank(guardian);
        timelock.scheduleEmergency(address(target), 0, data, NO_PREDECESSOR, SALT);

        vm.warp(block.timestamp + 6 hours);

        vm.prank(executor);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);

        assertEq(target.value(), 911);
    }

    // ============ Reputation Delay Tests ============

    function test_effectiveMinDelay_tier0() public view {
        assertEq(timelock.effectiveMinDelay(proposer), 2 days); // no reduction
    }

    function test_effectiveMinDelay_tier4() public {
        oracle.setTier(proposer, 4);
        // 2 days - 4*6h = 2 days - 24h = 1 day — but floor is 6h
        assertEq(timelock.effectiveMinDelay(proposer), 1 days);
    }

    function test_effectiveMinDelay_floorApplied() public {
        // Set very high tier to force floor
        oracle.setTier(proposer, 255);
        assertEq(timelock.effectiveMinDelay(proposer), 6 hours);
    }

    function test_schedule_withReputationReduction() public {
        oracle.setTier(proposer, 4);
        uint256 effectiveDelay = timelock.effectiveMinDelay(proposer);
        assertEq(effectiveDelay, 1 days);

        // Can schedule with reduced delay
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, 1 days);

        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        assertTrue(timelock.isOperationPending(id));
    }

    function test_schedule_belowEffectiveDelay_reverts() public {
        oracle.setTier(proposer, 4);
        // Effective delay is 1 day, try scheduling with 12 hours
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(proposer);
        vm.expectRevert(IVibeTimelock.DelayBelowMinimum.selector);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, 12 hours);
    }

    // ============ Open Execution Tests ============

    function test_openExecution_anyoneCanExecute() public {
        // Enable open execution
        timelock.setExecutor(address(0), true);

        _scheduleSetValue(42, MIN_DELAY);
        vm.warp(block.timestamp + MIN_DELAY);

        // Nobody should be able to execute
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        vm.prank(nobody);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);

        assertEq(target.value(), 42);
    }

    // ============ Admin Tests ============

    function test_setMinDelay_onlySelf() public {
        // Direct call should fail
        vm.expectRevert(IVibeTimelock.NotSelf.selector);
        timelock.setMinDelay(3 days);
    }

    function test_setMinDelay_throughTimelock() public {
        // Schedule a call to setMinDelay through the timelock
        bytes memory data = abi.encodeCall(VibeTimelock.setMinDelay, (3 days));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.warp(block.timestamp + MIN_DELAY);

        vm.prank(executor);
        timelock.execute(address(timelock), 0, data, NO_PREDECESSOR, SALT);

        assertEq(timelock.minDelay(), 3 days);
    }

    function test_setProposer_valid() public {
        timelock.setProposer(nobody, true);
        assertTrue(timelock.isProposer(nobody));

        timelock.setProposer(nobody, false);
        assertFalse(timelock.isProposer(nobody));
    }

    function test_setProposer_notOwner_reverts() public {
        vm.prank(nobody);
        vm.expectRevert();
        timelock.setProposer(nobody, true);
    }

    function test_setProposer_zeroAddress_reverts() public {
        vm.expectRevert(IVibeTimelock.ZeroAddress.selector);
        timelock.setProposer(address(0), true);
    }

    function test_setExecutor_valid() public {
        timelock.setExecutor(nobody, true);
        assertTrue(timelock.isExecutor(nobody));
    }

    function test_setCanceller_valid() public {
        timelock.setCanceller(nobody, true);
        assertTrue(timelock.isCanceller(nobody));
    }

    function test_setGuardian_valid() public {
        address newGuardian = makeAddr("newGuardian");

        vm.expectEmit(true, true, false, false);
        emit GuardianUpdated(guardian, newGuardian);

        timelock.setGuardian(newGuardian);
        assertEq(timelock.guardian(), newGuardian);
    }

    // ============ JUL Rewards Tests ============

    function test_depositJulRewards_valid() public {
        uint256 before = timelock.julRewardPool();
        jul.mint(address(this), 50 ether);
        jul.approve(address(timelock), 50 ether);
        timelock.depositJulRewards(50 ether);
        assertEq(timelock.julRewardPool(), before + 50 ether);
    }

    function test_depositJulRewards_zeroAmount_reverts() public {
        vm.expectRevert(IVibeTimelock.ZeroAmount.selector);
        timelock.depositJulRewards(0);
    }

    // ============ State Machine Tests ============

    function test_operationState_lifecycle() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);

        // UNSET
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.UNSET));

        // Schedule → WAITING
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.WAITING));

        // Time passes → READY
        vm.warp(block.timestamp + MIN_DELAY);
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.READY));

        // Execute → EXECUTED
        vm.prank(executor);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.EXECUTED));
    }

    function test_operationState_cancelledLifecycle() public {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);

        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        vm.prank(canceller);
        timelock.cancel(id);

        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.CANCELLED));
    }

    // ============ Hash Tests ============

    function test_hashOperation_deterministic() public view {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        bytes32 h1 = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        bytes32 h2 = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        assertEq(h1, h2);
    }

    function test_hashOperation_differentSaltsDiffer() public view {
        bytes memory data = abi.encodeCall(MockTarget.setValue, (42));
        bytes32 h1 = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        bytes32 h2 = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, bytes32("other"));
        assertNotEq(h1, h2);
    }

    // ============ Receive ETH Tests ============

    function test_receiveETH() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        (bool success,) = address(timelock).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(timelock).balance, 1 ether);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Proposer schedules
        bytes memory data = abi.encodeCall(MockTarget.setValue, (100));
        vm.prank(proposer);
        timelock.schedule(address(target), 0, data, NO_PREDECESSOR, SALT, MIN_DELAY);

        // 2. Verify waiting
        bytes32 id = timelock.hashOperation(address(target), 0, data, NO_PREDECESSOR, SALT);
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.WAITING));

        // 3. Time passes
        vm.warp(block.timestamp + MIN_DELAY);
        assertEq(uint8(timelock.getOperationState(id)), uint8(IVibeTimelock.OperationState.READY));

        // 4. Executor executes
        vm.prank(executor);
        timelock.execute(address(target), 0, data, NO_PREDECESSOR, SALT);

        // 5. Verify execution
        assertEq(target.value(), 100);
        assertEq(target.lastCaller(), address(timelock));
        assertTrue(timelock.isOperationDone(id));
    }

    function test_chainedOperations() public {
        bytes memory data1 = abi.encodeCall(MockTarget.setValue, (1));
        bytes memory data2 = abi.encodeCall(MockTarget.setValue, (2));
        bytes memory data3 = abi.encodeCall(MockTarget.setValue, (3));
        bytes32 salt2 = bytes32("s2");
        bytes32 salt3 = bytes32("s3");

        bytes32 id1 = timelock.hashOperation(address(target), 0, data1, NO_PREDECESSOR, SALT);
        bytes32 id2 = timelock.hashOperation(address(target), 0, data2, id1, salt2);

        // Schedule chain: op1 → op2 → op3
        vm.startPrank(proposer);
        timelock.schedule(address(target), 0, data1, NO_PREDECESSOR, SALT, MIN_DELAY);
        timelock.schedule(address(target), 0, data2, id1, salt2, MIN_DELAY);
        timelock.schedule(address(target), 0, data3, id2, salt3, MIN_DELAY);
        vm.stopPrank();

        vm.warp(block.timestamp + MIN_DELAY);

        // Execute in order
        vm.startPrank(executor);
        timelock.execute(address(target), 0, data1, NO_PREDECESSOR, SALT);
        assertEq(target.value(), 1);

        timelock.execute(address(target), 0, data2, id1, salt2);
        assertEq(target.value(), 2);

        timelock.execute(address(target), 0, data3, id2, salt3);
        assertEq(target.value(), 3);
        vm.stopPrank();
    }
}
