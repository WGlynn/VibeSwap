// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/SubnetRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Mock VIBE token for testing
contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 10_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SubnetRouterTest is Test {
    SubnetRouter public router;
    MockVIBE public vibe;

    address public owner;
    address public verifierAddr;
    address public alice;   // requester
    address public bob;     // worker 1
    address public carol;   // worker 2
    address public dave;    // worker 3
    address public stranger;

    uint256 constant MIN_STAKE     = 100 ether;
    uint256 constant TASK_PAYMENT  = 1000 ether;
    bytes32 constant INPUT_HASH    = keccak256("task-input-1");
    bytes32 constant OUTPUT_HASH   = keccak256("task-output-1");

    // ============ Events (mirrored for expectEmit) ============

    event SubnetCreated(bytes32 indexed subnetId, string name, uint256 minStake);
    event SubnetDeactivated(bytes32 indexed subnetId);
    event WorkerRegistered(bytes32 indexed subnetId, address indexed worker, uint256 stake);
    event WorkerUnregistered(bytes32 indexed subnetId, address indexed worker, uint256 stakeReturned);
    event TaskSubmitted(bytes32 indexed taskId, bytes32 indexed subnetId, address indexed requester, uint256 payment);
    event TaskClaimed(bytes32 indexed taskId, address indexed worker);
    event OutputSubmitted(bytes32 indexed taskId, bytes32 outputHash);
    event OutputVerified(bytes32 indexed taskId, uint256 qualityScore);
    event OutputDisputed(bytes32 indexed taskId, address indexed requester);
    event RewardClaimed(bytes32 indexed taskId, address indexed worker, uint256 amount);

    // ============ Setup ============

    function setUp() public {
        owner        = makeAddr("owner");
        verifierAddr = makeAddr("verifier");
        alice        = makeAddr("alice");
        bob          = makeAddr("bob");
        carol        = makeAddr("carol");
        dave         = makeAddr("dave");
        stranger     = makeAddr("stranger");

        // Deploy mock VIBE from this contract, then distribute
        vibe = new MockVIBE();

        // Deploy SubnetRouter behind UUPS proxy
        vm.startPrank(owner);

        SubnetRouter impl = new SubnetRouter();
        bytes memory initData = abi.encodeCall(
            SubnetRouter.initialize,
            (address(vibe), verifierAddr, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = SubnetRouter(address(proxy));

        vm.stopPrank();

        // Fund actors
        vibe.mint(alice, 100_000 ether);
        vibe.mint(bob,   100_000 ether);
        vibe.mint(carol,  100_000 ether);
        vibe.mint(dave,   100_000 ether);

        // Approve router for all actors
        vm.prank(alice);
        vibe.approve(address(router), type(uint256).max);
        vm.prank(bob);
        vibe.approve(address(router), type(uint256).max);
        vm.prank(carol);
        vibe.approve(address(router), type(uint256).max);
        vm.prank(dave);
        vibe.approve(address(router), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Owner creates a subnet, returns subnetId
    function _createDefaultSubnet() internal returns (bytes32) {
        vm.prank(owner);
        return router.createSubnet("text-generation", MIN_STAKE);
    }

    /// @dev Register bob as worker in the given subnet
    function _registerBob(bytes32 subnetId) internal {
        vm.prank(bob);
        router.registerWorker(subnetId);
    }

    /// @dev Submit a task from alice, returns taskId
    function _submitDefaultTask(bytes32 subnetId) internal returns (bytes32) {
        vm.prank(alice);
        return router.submitTask(subnetId, INPUT_HASH, TASK_PAYMENT);
    }

    /// @dev Full lifecycle: create subnet, register bob, submit task, claim, submit output, verify
    function _fullLifecycle() internal returns (bytes32 subnetId, bytes32 taskId) {
        subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);

        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        vm.prank(verifierAddr);
        router.verifyOutput(taskId, 8000); // 80% quality
    }

    // ============ Test 1: Subnet Creation (Happy Path) ============

    function test_createSubnet_happyPath() public {
        bytes32 subnetId = _createDefaultSubnet();

        assertNotEq(subnetId, bytes32(0));
        assertEq(router.totalSubnets(), 1);

        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.subnetId, subnetId);
        assertEq(s.name, "text-generation");
        assertEq(s.minStake, MIN_STAKE);
        assertEq(s.workerCount, 0);
        assertEq(s.totalTasks, 0);
        assertEq(s.totalRewards, 0);
        assertEq(s.insuranceFund, 0);
        assertTrue(s.active);
    }

    // ============ Test 2: Worker Registration with Stake ============

    function test_registerWorker_withStake() public {
        bytes32 subnetId = _createDefaultSubnet();
        uint256 bobBefore = vibe.balanceOf(bob);

        _registerBob(subnetId);

        // Stake transferred
        assertEq(vibe.balanceOf(bob), bobBefore - MIN_STAKE);
        assertEq(vibe.balanceOf(address(router)), MIN_STAKE);

        // Worker state correct
        ISubnetRouter.Worker memory w = router.getWorkerStats(bob);
        assertEq(w.workerAddress, bob);
        assertEq(w.subnetId, subnetId);
        assertEq(w.stake, MIN_STAKE);
        assertEq(w.qualityScore, 5000); // starts at 50%
        assertEq(w.tasksCompleted, 0);
        assertTrue(w.active);

        // Subnet worker count updated
        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.workerCount, 1);

        // Worker appears in subnet worker list
        address[] memory workers = router.getSubnetWorkers(subnetId);
        assertEq(workers.length, 1);
        assertEq(workers[0], bob);
    }

    // ============ Test 3: Worker Registration Without Sufficient Stake ============

    function test_registerWorker_insufficientBalance_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();

        // Stranger has no VIBE
        vm.prank(stranger);
        vibe.approve(address(router), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(); // SafeERC20 will revert on transferFrom
        router.registerWorker(subnetId);
    }

    // ============ Test 4: Task Submission to a Subnet ============

    function test_submitTask_happyPath() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);

        uint256 aliceBefore = vibe.balanceOf(alice);

        bytes32 taskId = _submitDefaultTask(subnetId);

        assertNotEq(taskId, bytes32(0));

        // Payment transferred from alice
        assertEq(vibe.balanceOf(alice), aliceBefore - TASK_PAYMENT);

        // Task state
        ISubnetRouter.Task memory t = router.getTask(taskId);
        assertEq(t.taskId, taskId);
        assertEq(t.subnetId, subnetId);
        assertEq(t.requester, alice);
        assertEq(t.payment, TASK_PAYMENT);
        assertEq(t.inputHash, INPUT_HASH);
        assertEq(t.outputHash, bytes32(0));
        assertEq(t.assignedWorker, address(0));
        assertEq(uint256(t.status), uint256(ISubnetRouter.TaskStatus.PENDING));

        // Subnet task count
        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.totalTasks, 1);
    }

    // ============ Test 5: Task Completion and Payment Split (90/10) ============

    function test_claimReward_paymentSplit_90_10() public {
        (bytes32 subnetId, bytes32 taskId) = _fullLifecycle();

        uint256 bobBefore = vibe.balanceOf(bob);

        vm.prank(bob);
        router.claimReward(taskId);

        // Worker quality = EMA: (5000*7 + 8000*3) / 10 = 5900
        // Worker base = 1000e18 * 9000 / 10000 = 900e18
        // Worker reward = 900e18 * 5900 / 10000 = 531e18
        // Insurance = 1000e18 - 531e18 = 469e18
        uint256 expectedQuality = (5000 * 7 + 8000 * 3) / 10; // 5900
        uint256 workerBase = (TASK_PAYMENT * 9000) / 10000;
        uint256 expectedReward = (workerBase * expectedQuality) / 10000;
        uint256 expectedInsurance = TASK_PAYMENT - expectedReward;

        assertEq(vibe.balanceOf(bob), bobBefore + expectedReward);

        // Check subnet insurance fund accumulated
        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.insuranceFund, expectedInsurance);
        assertEq(s.totalRewards, expectedReward);

        // Check worker stats
        ISubnetRouter.Worker memory w = router.getWorkerStats(bob);
        assertEq(w.totalEarned, expectedReward);
    }

    // ============ Test 6: Quality Scoring / Shapley Weighting ============

    function test_verifyOutput_updatesQualityScore_EMA() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);

        // Task 1: quality = 10000 (perfect)
        bytes32 taskId1 = _submitDefaultTask(subnetId);
        vm.prank(bob);
        router.claimTask(taskId1);
        vm.prank(bob);
        router.submitOutput(taskId1, OUTPUT_HASH);
        vm.prank(verifierAddr);
        router.verifyOutput(taskId1, 10000);

        // EMA: (5000*7 + 10000*3) / 10 = 6500
        ISubnetRouter.Worker memory w1 = router.getWorkerStats(bob);
        assertEq(w1.qualityScore, 6500);

        // Task 2: quality = 10000 again
        bytes32 taskId2;
        vm.prank(alice);
        taskId2 = router.submitTask(subnetId, keccak256("input-2"), TASK_PAYMENT);
        vm.prank(bob);
        router.claimTask(taskId2);
        vm.prank(bob);
        router.submitOutput(taskId2, keccak256("output-2"));
        vm.prank(verifierAddr);
        router.verifyOutput(taskId2, 10000);

        // EMA: (6500*7 + 10000*3) / 10 = 7550
        ISubnetRouter.Worker memory w2 = router.getWorkerStats(bob);
        assertEq(w2.qualityScore, 7550);
        assertEq(w2.tasksCompleted, 2);
    }

    // ============ Test 7: Unstake Request + Cooldown Enforcement ============

    function test_unregisterWorker_cooldownNotElapsed_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);

        // First call: initiate cooldown (no revert, no actual unregister)
        vm.prank(bob);
        router.unregisterWorker(subnetId);

        // Worker is still active (cooldown just started)
        ISubnetRouter.Worker memory w = router.getWorkerStats(bob);
        assertTrue(w.active);

        // Second call immediately: cooldown not elapsed
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.CooldownNotElapsed.selector);
        router.unregisterWorker(subnetId);
    }

    // ============ Test 8: Unstake After Cooldown (Should Succeed) ============

    function test_unregisterWorker_afterCooldown_succeeds() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);

        uint256 bobBefore = vibe.balanceOf(bob);

        // Initiate cooldown
        vm.prank(bob);
        router.unregisterWorker(subnetId);

        // Warp past cooldown (1 day)
        vm.warp(block.timestamp + 1 days + 1);

        // Complete unregistration
        vm.prank(bob);
        router.unregisterWorker(subnetId);

        // Stake returned
        assertEq(vibe.balanceOf(bob), bobBefore + MIN_STAKE);

        // Worker deactivated
        ISubnetRouter.Worker memory w = router.getWorkerStats(bob);
        assertFalse(w.active);
        assertEq(w.stake, 0);

        // Subnet worker count decremented
        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.workerCount, 0);

        // Worker removed from subnet list
        address[] memory workers = router.getSubnetWorkers(subnetId);
        assertEq(workers.length, 0);
    }

    // ============ Test 9: Worker Slashing for Bad Quality ============

    function test_claimReward_lowQuality_reducedPayout() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Verify with very low quality (1000 = 10%)
        vm.prank(verifierAddr);
        router.verifyOutput(taskId, 1000);

        uint256 bobBefore = vibe.balanceOf(bob);

        vm.prank(bob);
        router.claimReward(taskId);

        // EMA: (5000*7 + 1000*3) / 10 = 3800
        uint256 expectedQuality = (5000 * 7 + 1000 * 3) / 10; // 3800
        uint256 workerBase = (TASK_PAYMENT * 9000) / 10000;
        uint256 expectedReward = (workerBase * expectedQuality) / 10000;

        assertEq(vibe.balanceOf(bob), bobBefore + expectedReward);

        // Insurance fund gets the larger portion due to low quality
        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        uint256 expectedInsurance = TASK_PAYMENT - expectedReward;
        assertEq(s.insuranceFund, expectedInsurance);

        // Low quality = more to insurance, less to worker
        assertTrue(expectedInsurance > expectedReward, "Bad quality: insurance > worker reward");
    }

    // ============ Test 10: Multiple Workers on Same Subnet ============

    function test_multipleWorkers_sameSubnet() public {
        bytes32 subnetId = _createDefaultSubnet();

        // Register bob, carol, dave
        vm.prank(bob);
        router.registerWorker(subnetId);
        vm.prank(carol);
        router.registerWorker(subnetId);
        vm.prank(dave);
        router.registerWorker(subnetId);

        ISubnetRouter.Subnet memory s = router.getSubnet(subnetId);
        assertEq(s.workerCount, 3);

        address[] memory workers = router.getSubnetWorkers(subnetId);
        assertEq(workers.length, 3);

        // Each has independent state
        ISubnetRouter.Worker memory wBob   = router.getWorkerStats(bob);
        ISubnetRouter.Worker memory wCarol = router.getWorkerStats(carol);
        ISubnetRouter.Worker memory wDave  = router.getWorkerStats(dave);

        assertEq(wBob.subnetId, subnetId);
        assertEq(wCarol.subnetId, subnetId);
        assertEq(wDave.subnetId, subnetId);
        assertEq(wBob.qualityScore, 5000);
        assertEq(wCarol.qualityScore, 5000);
        assertEq(wDave.qualityScore, 5000);

        // Total stake = 3 * MIN_STAKE
        assertEq(vibe.balanceOf(address(router)), MIN_STAKE * 3);
    }

    // ============ Test 11: Access Control (Only Owner Can Create/Deactivate) ============

    function test_createSubnet_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        router.createSubnet("unauthorized", MIN_STAKE);
    }

    function test_deactivateSubnet_onlyOwner() public {
        bytes32 subnetId = _createDefaultSubnet();

        vm.prank(stranger);
        vm.expectRevert();
        router.deactivateSubnet(subnetId);
    }

    function test_setVerifier_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        router.setVerifier(makeAddr("newVerifier"));
    }

    // ============ Test 12: Edge - Register to Non-Existent Subnet ============

    function test_registerWorker_nonExistentSubnet_reverts() public {
        bytes32 fakeSubnetId = keccak256("does-not-exist");

        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.SubnetNotFound.selector);
        router.registerWorker(fakeSubnetId);
    }

    // ============ Test 13: Edge - Complete Task That Doesn't Exist ============

    function test_claimTask_nonExistent_reverts() public {
        bytes32 fakeTaskId = keccak256("fake-task");

        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.TaskNotFound.selector);
        router.claimTask(fakeTaskId);
    }

    function test_submitOutput_nonExistent_reverts() public {
        bytes32 fakeTaskId = keccak256("fake-task");

        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.TaskNotFound.selector);
        router.submitOutput(fakeTaskId, OUTPUT_HASH);
    }

    function test_verifyOutput_nonExistent_reverts() public {
        bytes32 fakeTaskId = keccak256("fake-task");

        vm.prank(verifierAddr);
        vm.expectRevert(ISubnetRouter.TaskNotFound.selector);
        router.verifyOutput(fakeTaskId, 5000);
    }

    // ============ Test 14: Edge - Double-Complete Same Task ============

    function test_claimReward_twice_reverts() public {
        (, bytes32 taskId) = _fullLifecycle();

        vm.prank(bob);
        router.claimReward(taskId);

        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.RewardAlreadyClaimed.selector);
        router.claimReward(taskId);
    }

    function test_submitOutput_alreadyCompleted_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);

        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Second submitOutput should revert (status is COMPLETED, not ASSIGNED)
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.TaskNotAssigned.selector);
        router.submitOutput(taskId, keccak256("output-2"));
    }

    function test_verifyOutput_alreadyVerified_reverts() public {
        (, bytes32 taskId) = _fullLifecycle();

        // Already verified in _fullLifecycle; verify again should revert
        vm.prank(verifierAddr);
        vm.expectRevert(ISubnetRouter.TaskNotCompleted.selector);
        router.verifyOutput(taskId, 9000);
    }

    // ============ Test 15: Edge - Zero Payment Task ============

    function test_submitTask_zeroPayment_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();

        vm.prank(alice);
        vm.expectRevert(ISubnetRouter.ZeroPayment.selector);
        router.submitTask(subnetId, INPUT_HASH, 0);
    }

    // ============ Test 16: Worker Already Registered ============

    function test_registerWorker_alreadyRegistered_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);

        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.WorkerAlreadyRegistered.selector);
        router.registerWorker(subnetId);
    }

    // ============ Test 17: Only Verifier Can Verify ============

    function test_verifyOutput_notVerifier_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Stranger tries to verify
        vm.prank(stranger);
        vm.expectRevert(ISubnetRouter.NotAuthorizedVerifier.selector);
        router.verifyOutput(taskId, 8000);
    }

    // ============ Test 18: Invalid Quality Score ============

    function test_verifyOutput_invalidQualityScore_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Quality > MAX_QUALITY_SCORE (10000)
        vm.prank(verifierAddr);
        vm.expectRevert(ISubnetRouter.InvalidQualityScore.selector);
        router.verifyOutput(taskId, 10001);
    }

    // ============ Test 19: Deactivated Subnet Blocks Registration and Tasks ============

    function test_deactivatedSubnet_blocksRegistrationAndTasks() public {
        bytes32 subnetId = _createDefaultSubnet();

        vm.prank(owner);
        router.deactivateSubnet(subnetId);

        // Cannot register
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.SubnetNotActive.selector);
        router.registerWorker(subnetId);

        // Cannot submit task
        vm.prank(alice);
        vm.expectRevert(ISubnetRouter.SubnetNotActive.selector);
        router.submitTask(subnetId, INPUT_HASH, TASK_PAYMENT);
    }

    // ============ Test 20: Dispute Output ============

    function test_disputeOutput_happyPath() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Alice (requester) disputes
        vm.prank(alice);
        router.disputeOutput(taskId);

        ISubnetRouter.Task memory t = router.getTask(taskId);
        assertEq(uint256(t.status), uint256(ISubnetRouter.TaskStatus.DISPUTED));
    }

    function test_disputeOutput_notRequester_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Bob (not requester) tries to dispute
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.NotTaskRequester.selector);
        router.disputeOutput(taskId);
    }

    // ============ Test 21: Only Assigned Worker Can Submit Output ============

    function test_submitOutput_wrongWorker_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        vm.prank(carol);
        router.registerWorker(subnetId);

        bytes32 taskId = _submitDefaultTask(subnetId);

        // Bob claims
        vm.prank(bob);
        router.claimTask(taskId);

        // Carol tries to submit output
        vm.prank(carol);
        vm.expectRevert(ISubnetRouter.NotTaskWorker.selector);
        router.submitOutput(taskId, OUTPUT_HASH);
    }

    // ============ Test 22: Only Assigned Worker Can Claim Reward ============

    function test_claimReward_wrongWorker_reverts() public {
        (, bytes32 taskId) = _fullLifecycle();

        vm.prank(carol);
        vm.expectRevert(ISubnetRouter.NotTaskWorker.selector);
        router.claimReward(taskId);
    }

    // ============ Test 23: Zero-Stake Subnet (Workers Join Free) ============

    function test_zeroStakeSubnet_workerJoinsFree() public {
        vm.prank(owner);
        bytes32 subnetId = router.createSubnet("free-tier", 0);

        uint256 bobBefore = vibe.balanceOf(bob);

        vm.prank(bob);
        router.registerWorker(subnetId);

        // No tokens transferred
        assertEq(vibe.balanceOf(bob), bobBefore);

        ISubnetRouter.Worker memory w = router.getWorkerStats(bob);
        assertEq(w.stake, 0);
        assertTrue(w.active);
    }

    // ============ Test 24: Events Emitted Correctly ============

    function test_events_subnetCreated() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit SubnetCreated(bytes32(0), "text-generation", MIN_STAKE);
        router.createSubnet("text-generation", MIN_STAKE);
    }

    function test_events_workerRegistered() public {
        bytes32 subnetId = _createDefaultSubnet();

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit WorkerRegistered(subnetId, bob, MIN_STAKE);
        router.registerWorker(subnetId);
    }

    function test_events_taskSubmitted() public {
        bytes32 subnetId = _createDefaultSubnet();

        vm.prank(alice);
        vm.expectEmit(false, true, true, true);
        emit TaskSubmitted(bytes32(0), subnetId, alice, TASK_PAYMENT);
        router.submitTask(subnetId, INPUT_HASH, TASK_PAYMENT);
    }

    // ============ Test 25: Claim Task - Not a Worker in That Subnet ============

    function test_claimTask_workerNotInSubnet_reverts() public {
        bytes32 subnetId1 = _createDefaultSubnet();

        vm.prank(owner);
        bytes32 subnetId2 = router.createSubnet("image-gen", MIN_STAKE);

        // Bob registers in subnet2
        vm.prank(bob);
        router.registerWorker(subnetId2);

        // Task submitted to subnet1
        bytes32 taskId = _submitDefaultTask(subnetId1);

        // Bob (in subnet2) tries to claim task in subnet1
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.WorkerNotFound.selector);
        router.claimTask(taskId);
    }

    // ============ Test 26: Full Lifecycle - Multiple Subnets ============

    function test_multipleSubnets_independentState() public {
        vm.startPrank(owner);
        bytes32 textSubnet  = router.createSubnet("text-generation", MIN_STAKE);
        bytes32 imageSubnet = router.createSubnet("image-gen", 200 ether);
        vm.stopPrank();

        assertEq(router.totalSubnets(), 2);

        ISubnetRouter.Subnet memory s1 = router.getSubnet(textSubnet);
        ISubnetRouter.Subnet memory s2 = router.getSubnet(imageSubnet);

        assertEq(s1.minStake, MIN_STAKE);
        assertEq(s2.minStake, 200 ether);
        assertNotEq(textSubnet, imageSubnet);
    }

    // ============ Test 27: Claim Reward for Non-Verified Task Reverts ============

    function test_claimReward_taskNotVerified_reverts() public {
        bytes32 subnetId = _createDefaultSubnet();
        _registerBob(subnetId);
        bytes32 taskId = _submitDefaultTask(subnetId);

        vm.prank(bob);
        router.claimTask(taskId);
        vm.prank(bob);
        router.submitOutput(taskId, OUTPUT_HASH);

        // Task is COMPLETED but not VERIFIED
        vm.prank(bob);
        vm.expectRevert(ISubnetRouter.TaskNotVerified.selector);
        router.claimReward(taskId);
    }

    // ============ Test 28: Initialize Revert on Zero Address ============

    function test_initialize_zeroAddress_reverts() public {
        SubnetRouter newImpl = new SubnetRouter();

        // Zero vibeToken
        bytes memory initData1 = abi.encodeCall(
            SubnetRouter.initialize,
            (address(0), verifierAddr, owner)
        );
        vm.expectRevert(ISubnetRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(newImpl), initData1);

        // Zero verifier
        SubnetRouter newImpl2 = new SubnetRouter();
        bytes memory initData2 = abi.encodeCall(
            SubnetRouter.initialize,
            (address(vibe), address(0), owner)
        );
        vm.expectRevert(ISubnetRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(newImpl2), initData2);

        // Zero owner
        SubnetRouter newImpl3 = new SubnetRouter();
        bytes memory initData3 = abi.encodeCall(
            SubnetRouter.initialize,
            (address(vibe), verifierAddr, address(0))
        );
        vm.expectRevert(ISubnetRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(newImpl3), initData3);
    }
}
