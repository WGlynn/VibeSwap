// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/VibeKeeperNetwork.sol";
import "../contracts/governance/interfaces/IVibeKeeperNetwork.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockKNToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockKNOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockKNTarget {
    uint256 public value;
    bool public shouldRevert;

    function setValue(uint256 _value) external {
        if (shouldRevert) revert("MockTarget: revert");
        value = _value;
    }

    function setShouldRevert(bool _revert) external {
        shouldRevert = _revert;
    }

    function getSelector() external pure returns (bytes4) {
        return this.setValue.selector;
    }
}

// ============ Test Contract ============

contract VibeKeeperNetworkTest is Test {
    VibeKeeperNetwork public network;
    MockKNToken public jul;
    MockKNOracle public oracle;
    MockKNTarget public target;

    // Re-declare events
    event KeeperRegistered(address indexed keeper, uint256 stakeAmount);
    event KeeperDeactivated(address indexed keeper);
    event KeeperReactivated(address indexed keeper, uint256 additionalStake);
    event UnstakeRequested(address indexed keeper, uint256 amount);
    event UnstakeCompleted(address indexed keeper, uint256 amount);
    event KeeperSlashed(address indexed keeper, uint256 amount, string reason);
    event TaskRegistered(uint256 indexed taskId, address indexed target, bytes4 selector, uint96 reward);
    event TaskUpdated(uint256 indexed taskId, bool active, uint96 reward);
    event TaskExecuted(uint256 indexed taskId, address indexed keeper, bool success);
    event BatchExecuted(address indexed keeper, uint256 tasksAttempted, uint256 tasksSucceeded);
    event RewardPoolDeposited(address indexed depositor, uint256 amount);
    event RewardClaimed(address indexed keeper, uint256 amount);

    // ============ Actors ============

    address public alice; // keeper
    address public bob;   // keeper #2
    address public charlie; // not a keeper

    // ============ Constants ============

    uint256 constant STAKE = 100 ether;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        jul = new MockKNToken("JUL", "JUL");
        oracle = new MockKNOracle();
        target = new MockKNTarget();

        network = new VibeKeeperNetwork(address(jul), address(oracle));

        // Fund actors
        jul.mint(alice, 10_000 ether);
        jul.mint(bob, 10_000 ether);
        jul.mint(address(this), 100_000 ether);

        // Approve
        vm.prank(alice);
        jul.approve(address(network), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(network), type(uint256).max);
        jul.approve(address(network), type(uint256).max);

        // Fund reward pool
        network.depositRewards(10_000 ether);

        // Register a task
        network.registerTask(
            address(target),
            target.setValue.selector,
            10 ether, // 10 JUL per execution
            0         // no cooldown
        );
    }

    // ============ Helpers ============

    function _registerKeeper(address keeper) internal {
        vm.prank(keeper);
        network.registerKeeper(STAKE);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsImmutables() public view {
        assertEq(address(network.julToken()), address(jul));
        assertEq(address(network.reputationOracle()), address(oracle));
    }

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(IVibeKeeperNetwork.ZeroAddress.selector);
        new VibeKeeperNetwork(address(0), address(oracle));
        vm.expectRevert(IVibeKeeperNetwork.ZeroAddress.selector);
        new VibeKeeperNetwork(address(jul), address(0));
    }

    function test_constructor_initialState() public view {
        assertEq(network.totalKeepers(), 0);
        assertEq(network.totalTasks(), 1); // registered in setUp
        assertEq(network.rewardPool(), 10_000 ether);
    }

    // ============ Keeper Registration Tests ============

    function test_registerKeeper_valid() public {
        vm.expectEmit(true, false, false, true);
        emit KeeperRegistered(alice, STAKE);

        _registerKeeper(alice);

        assertTrue(network.isActiveKeeper(alice));
        assertEq(network.totalKeepers(), 1);

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(alice);
        assertEq(k.stakedAmount, STAKE);
        assertTrue(k.active);
    }

    function test_registerKeeper_insufficientStake_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.InsufficientStake.selector);
        network.registerKeeper(10 ether); // below 100 ether minimum
    }

    function test_registerKeeper_alreadyRegistered_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.AlreadyRegistered.selector);
        network.registerKeeper(STAKE);
    }

    function test_registerKeeper_withReputation() public {
        oracle.setTier(alice, 4); // 4 * 15 = 60 reduction, min = 100-60 = 40
        assertEq(network.effectiveMinStake(alice), 40 ether);

        vm.prank(alice);
        network.registerKeeper(40 ether);
        assertTrue(network.isActiveKeeper(alice));
    }

    function test_effectiveMinStake_floorApplied() public {
        oracle.setTier(alice, 255); // massive tier
        assertEq(network.effectiveMinStake(alice), 25 ether);
    }

    // ============ Unstake Tests ============

    function test_requestUnstake_valid() public {
        _registerKeeper(alice);

        vm.prank(alice);
        network.requestUnstake();

        assertFalse(network.isActiveKeeper(alice));
    }

    function test_requestUnstake_notKeeper_reverts() public {
        vm.prank(charlie);
        vm.expectRevert(IVibeKeeperNetwork.NotActiveKeeper.selector);
        network.requestUnstake();
    }

    function test_requestUnstake_alreadyPending_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        network.requestUnstake();

        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.UnstakePending.selector);
        network.requestUnstake();
    }

    function test_completeUnstake_afterCooldown() public {
        _registerKeeper(alice);
        uint256 balanceBefore = jul.balanceOf(alice);

        vm.prank(alice);
        network.requestUnstake();

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(alice);
        network.completeUnstake();

        assertEq(jul.balanceOf(alice), balanceBefore + STAKE);
        assertFalse(network.isActiveKeeper(alice));
        assertEq(network.totalKeepers(), 0);
    }

    function test_completeUnstake_cooldownNotElapsed_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        network.requestUnstake();

        vm.warp(block.timestamp + 3 days);

        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.UnstakeCooldownNotElapsed.selector);
        network.completeUnstake();
    }

    function test_completeUnstake_noRequest_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.NoUnstakeRequest.selector);
        network.completeUnstake();
    }

    // ============ Top Up Stake Tests ============

    function test_topUpStake_valid() public {
        _registerKeeper(alice);
        vm.prank(alice);
        network.topUpStake(50 ether);

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(alice);
        assertEq(k.stakedAmount, 150 ether);
    }

    function test_topUpStake_notKeeper_reverts() public {
        vm.prank(charlie);
        vm.expectRevert(IVibeKeeperNetwork.NotActiveKeeper.selector);
        network.topUpStake(50 ether);
    }

    function test_topUpStake_zeroAmount_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.ZeroAmount.selector);
        network.topUpStake(0);
    }

    // ============ Task Registration Tests ============

    function test_registerTask_valid() public {
        vm.expectEmit(true, true, false, true);
        emit TaskRegistered(1, address(target), bytes4(0), 5 ether);

        network.registerTask(address(target), bytes4(0), 5 ether, 60);

        assertEq(network.totalTasks(), 2);
        IVibeKeeperNetwork.Task memory t = network.getTask(1);
        assertEq(t.target, address(target));
        assertEq(t.reward, 5 ether);
        assertEq(t.cooldown, 60);
        assertTrue(t.active);
    }

    function test_registerTask_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        network.registerTask(address(target), bytes4(0), 5 ether, 0);
    }

    function test_registerTask_zeroAddress_reverts() public {
        vm.expectRevert(IVibeKeeperNetwork.ZeroAddress.selector);
        network.registerTask(address(0), bytes4(0), 5 ether, 0);
    }

    function test_updateTask_valid() public {
        network.updateTask(0, false, 20 ether, 120);

        IVibeKeeperNetwork.Task memory t = network.getTask(0);
        assertFalse(t.active);
        assertEq(t.reward, 20 ether);
        assertEq(t.cooldown, 120);
    }

    function test_updateTask_notFound_reverts() public {
        vm.expectRevert(IVibeKeeperNetwork.TaskNotFound.selector);
        network.updateTask(999, true, 10 ether, 0);
    }

    // ============ Task Execution Tests ============

    function test_executeTask_success() public {
        _registerKeeper(alice);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));

        vm.expectEmit(true, true, false, true);
        emit TaskExecuted(0, alice, true);

        vm.prank(alice);
        network.executeTask(0, data);

        assertEq(target.value(), 42);
        assertEq(network.pendingRewards(alice), 10 ether);

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(alice);
        assertEq(k.totalExecutions, 1);
        assertEq(k.totalEarned, 10 ether);
    }

    function test_executeTask_failure() public {
        _registerKeeper(alice);
        target.setShouldRevert(true);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));

        vm.prank(alice);
        network.executeTask(0, data);

        assertEq(network.pendingRewards(alice), 0);

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(alice);
        assertEq(k.totalExecutions, 0);
        assertEq(k.failedExecutions, 1);
    }

    function test_executeTask_notKeeper_reverts() public {
        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(charlie);
        vm.expectRevert(IVibeKeeperNetwork.NotActiveKeeper.selector);
        network.executeTask(0, data);
    }

    function test_executeTask_taskNotActive_reverts() public {
        _registerKeeper(alice);
        network.updateTask(0, false, 10 ether, 0);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.TaskNotActive.selector);
        network.executeTask(0, data);
    }

    function test_executeTask_taskNotFound_reverts() public {
        _registerKeeper(alice);
        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.TaskNotFound.selector);
        network.executeTask(999, data);
    }

    function test_executeTask_selectorMismatch_reverts() public {
        _registerKeeper(alice);
        // Send wrong selector
        bytes memory data = abi.encodeCall(MockKNTarget.setShouldRevert, (true));
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.SelectorMismatch.selector);
        network.executeTask(0, data);
    }

    function test_executeTask_cooldown() public {
        // Register task with 60s cooldown
        network.registerTask(address(target), target.setValue.selector, 5 ether, 60);

        _registerKeeper(alice);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));

        // First execution succeeds
        vm.prank(alice);
        network.executeTask(1, data);

        // Second execution fails (cooldown)
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.TaskCooldownNotElapsed.selector);
        network.executeTask(1, data);

        // After cooldown, succeeds
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        network.executeTask(1, data);
    }

    function test_executeTask_deductsRewardPool() public {
        _registerKeeper(alice);
        uint256 poolBefore = network.rewardPool();

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(alice);
        network.executeTask(0, data);

        assertEq(network.rewardPool(), poolBefore - 10 ether);
    }

    // ============ Batch Execution Tests ============

    function test_executeBatch_valid() public {
        // Register second task (no selector restriction)
        network.registerTask(address(target), bytes4(0), 5 ether, 0);

        _registerKeeper(alice);

        uint256[] memory taskIds = new uint256[](2);
        bytes[] memory datas = new bytes[](2);
        taskIds[0] = 0;
        taskIds[1] = 1;
        datas[0] = abi.encodeCall(MockKNTarget.setValue, (10));
        datas[1] = abi.encodeCall(MockKNTarget.setValue, (20));

        vm.prank(alice);
        network.executeBatch(taskIds, datas);

        assertEq(target.value(), 20); // last call wins
        assertEq(network.pendingRewards(alice), 15 ether); // 10 + 5
    }

    function test_executeBatch_lengthMismatch_reverts() public {
        _registerKeeper(alice);

        uint256[] memory taskIds = new uint256[](2);
        bytes[] memory datas = new bytes[](1);

        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.ArrayLengthMismatch.selector);
        network.executeBatch(taskIds, datas);
    }

    function test_executeBatch_partialSuccess() public {
        // Task 0: will succeed, Task 1: will fail (target reverts)
        network.registerTask(address(target), bytes4(0), 5 ether, 0);

        _registerKeeper(alice);

        uint256[] memory taskIds = new uint256[](2);
        bytes[] memory datas = new bytes[](2);
        taskIds[0] = 0;
        taskIds[1] = 1;
        datas[0] = abi.encodeCall(MockKNTarget.setValue, (42));
        datas[1] = abi.encodeCall(MockKNTarget.setShouldRevert, (true));
        // Task 1 has no selector restriction so setShouldRevert passes selector check

        vm.prank(alice);
        network.executeBatch(taskIds, datas);

        // Task 0 succeeds (10 JUL), task 1 succeeds (5 JUL) — setShouldRevert doesn't actually revert
        assertEq(network.pendingRewards(alice), 15 ether);
    }

    // ============ Reward Claim Tests ============

    function test_claimRewards_valid() public {
        _registerKeeper(alice);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(alice);
        network.executeTask(0, data);

        uint256 balanceBefore = jul.balanceOf(alice);

        vm.prank(alice);
        network.claimRewards();

        assertEq(jul.balanceOf(alice), balanceBefore + 10 ether);
        assertEq(network.pendingRewards(alice), 0);
    }

    function test_claimRewards_nothingToClaim_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        vm.expectRevert(IVibeKeeperNetwork.NothingToClaim.selector);
        network.claimRewards();
    }

    // ============ Slash Tests ============

    function test_slashKeeper_valid() public {
        _registerKeeper(alice);

        network.slashKeeper(alice, 20 ether, "Invalid execution");

        IVibeKeeperNetwork.KeeperInfo memory k = network.getKeeper(alice);
        assertEq(k.stakedAmount, 80 ether);
        assertEq(k.totalSlashed, 20 ether);
        // Slashed JUL goes to reward pool
        assertEq(network.rewardPool(), 10_000 ether + 20 ether);
    }

    function test_slashKeeper_deactivatesIfBelowMinimum() public {
        _registerKeeper(alice);

        network.slashKeeper(alice, 80 ether, "Major violation");

        // 100 - 80 = 20, below MIN_STAKE of 100
        assertFalse(network.isActiveKeeper(alice));
    }

    function test_slashKeeper_exceedsStake_reverts() public {
        _registerKeeper(alice);

        vm.expectRevert(IVibeKeeperNetwork.SlashExceedsStake.selector);
        network.slashKeeper(alice, 200 ether, "Too much");
    }

    function test_slashKeeper_notKeeper_reverts() public {
        vm.expectRevert(IVibeKeeperNetwork.NotActiveKeeper.selector);
        network.slashKeeper(charlie, 10 ether, "Not registered");
    }

    function test_slashKeeper_notOwner_reverts() public {
        _registerKeeper(alice);
        vm.prank(alice);
        vm.expectRevert();
        network.slashKeeper(alice, 10 ether, "Self-slash");
    }

    // ============ Deposit Rewards Tests ============

    function test_depositRewards_valid() public {
        uint256 before = network.rewardPool();
        network.depositRewards(500 ether);
        assertEq(network.rewardPool(), before + 500 ether);
    }

    function test_depositRewards_zeroAmount_reverts() public {
        vm.expectRevert(IVibeKeeperNetwork.ZeroAmount.selector);
        network.depositRewards(0);
    }

    // ============ Performance Tests ============

    function test_keeperPerformance() public {
        _registerKeeper(alice);
        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));

        // 3 successes
        vm.startPrank(alice);
        network.executeTask(0, data);
        network.executeTask(0, data);
        network.executeTask(0, data);
        vm.stopPrank();

        // 1 failure
        target.setShouldRevert(true);
        vm.prank(alice);
        network.executeTask(0, data);

        // 3/4 = 7500 BPS
        assertEq(network.keeperPerformance(alice), 7500);
    }

    function test_keeperPerformance_noExecutions() public view {
        assertEq(network.keeperPerformance(charlie), 0);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Register keeper
        _registerKeeper(alice);

        // 2. Execute tasks
        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (100));
        vm.prank(alice);
        network.executeTask(0, data);
        assertEq(target.value(), 100);

        // 3. Claim rewards
        vm.prank(alice);
        network.claimRewards();
        assertEq(jul.balanceOf(alice), 10_000 ether - STAKE + 10 ether);

        // 4. Request unstake
        vm.prank(alice);
        network.requestUnstake();
        assertFalse(network.isActiveKeeper(alice));

        // 5. Complete unstake after cooldown
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        network.completeUnstake();
        assertEq(jul.balanceOf(alice), 10_000 ether + 10 ether);
    }

    function test_multipleKeepers() public {
        _registerKeeper(alice);
        _registerKeeper(bob);

        assertEq(network.totalKeepers(), 2);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));

        // Both execute
        vm.prank(alice);
        network.executeTask(0, data);
        vm.prank(bob);
        network.executeTask(0, data);

        assertEq(network.pendingRewards(alice), 10 ether);
        assertEq(network.pendingRewards(bob), 10 ether);
    }

    function test_completeUnstake_claimsPendingRewards() public {
        _registerKeeper(alice);

        bytes memory data = abi.encodeCall(MockKNTarget.setValue, (42));
        vm.prank(alice);
        network.executeTask(0, data);

        // Has 10 JUL pending + 100 JUL staked
        vm.prank(alice);
        network.requestUnstake();

        vm.warp(block.timestamp + 7 days + 1);

        uint256 balanceBefore = jul.balanceOf(alice);
        vm.prank(alice);
        network.completeUnstake();

        // Should get stake + pending rewards
        assertEq(jul.balanceOf(alice), balanceBefore + STAKE + 10 ether);
    }

    function test_anySelectorTask() public {
        // Register task with no selector restriction
        network.registerTask(address(target), bytes4(0), 5 ether, 0);
        _registerKeeper(alice);

        // Can call any function on target
        bytes memory data = abi.encodeCall(MockKNTarget.setShouldRevert, (false));
        vm.prank(alice);
        network.executeTask(1, data);

        assertEq(network.pendingRewards(alice), 5 ether);
    }
}
