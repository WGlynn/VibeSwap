// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/PairwiseVerifier.sol";

contract PairwiseVerifierFuzz is Test {

    PairwiseVerifier public verifier;
    address public owner = address(this);
    address public creator = address(0x1);
    address public worker1 = address(0x2);
    address public worker2 = address(0x3);
    address public validator1 = address(0x4);
    address public validator2 = address(0x5);
    address public validator3 = address(0x6);

    function setUp() public {
        PairwiseVerifier impl = new PairwiseVerifier();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PairwiseVerifier.initialize, (address(0)))
        );
        verifier = PairwiseVerifier(address(proxy));

        // Fund actors
        vm.deal(creator, 100 ether);
        vm.deal(worker1, 1 ether);
        vm.deal(worker2, 1 ether);
    }

    // ============ Task Creation Fuzz ============

    function testFuzz_createTask_variousRewards(uint256 reward) public {
        reward = bound(reward, 1, 10 ether);

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: reward}(
            "Fuzz task",
            keccak256("spec"),
            3000, // 30% validator
            1 hours,
            30 minutes,
            1 hours,
            30 minutes
        );

        IPairwiseVerifier.VerificationTask memory task = verifier.getTask(taskId);
        assertEq(task.rewardPool, reward);
        assertEq(task.validatorRewardBps, 3000);
        assertEq(uint8(task.phase), uint8(IPairwiseVerifier.TaskPhase.WORK_COMMIT));
    }

    function testFuzz_createTask_variousValidatorBps(uint256 bps) public {
        bps = bound(bps, 0, 20000); // May exceed BPS

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: 1 ether}(
            "Bps test",
            keccak256("spec"),
            bps,
            1 hours, 30 minutes, 1 hours, 30 minutes
        );

        IPairwiseVerifier.VerificationTask memory task = verifier.getTask(taskId);
        // If bps > 10000, should default to 3000
        if (bps > 10000) {
            assertEq(task.validatorRewardBps, 3000);
        } else {
            assertEq(task.validatorRewardBps, bps);
        }
    }

    // ============ Work Commit/Reveal Fuzz ============

    function testFuzz_workCommitReveal_validPreimage(bytes32 workHash, bytes32 secret) public {
        vm.assume(workHash != bytes32(0) && secret != bytes32(0));

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: 1 ether}(
            "Preimage test",
            keccak256("spec"),
            3000, 1 hours, 30 minutes, 1 hours, 30 minutes
        );

        bytes32 commitHash = keccak256(abi.encodePacked(workHash, secret));

        vm.prank(worker1);
        bytes32 subId = verifier.commitWork(taskId, commitHash);

        // Advance to reveal phase
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(worker1);
        verifier.revealWork(taskId, subId, workHash, secret);

        IPairwiseVerifier.WorkSubmission memory sub = verifier.getSubmission(subId);
        assertTrue(sub.revealed);
        assertEq(sub.workHash, workHash);
    }

    function testFuzz_workReveal_invalidPreimage_reverts(
        bytes32 workHash,
        bytes32 secret,
        bytes32 wrongSecret
    ) public {
        vm.assume(secret != wrongSecret);
        vm.assume(workHash != bytes32(0));

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: 1 ether}(
            "Bad preimage",
            keccak256("spec"),
            3000, 1 hours, 30 minutes, 1 hours, 30 minutes
        );

        bytes32 commitHash = keccak256(abi.encodePacked(workHash, secret));

        vm.prank(worker1);
        bytes32 subId = verifier.commitWork(taskId, commitHash);

        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(worker1);
        vm.expectRevert(IPairwiseVerifier.InvalidPreimage.selector);
        verifier.revealWork(taskId, subId, workHash, wrongSecret);
    }

    // ============ Comparison Fuzz ============

    function testFuzz_comparisonReveal_validPreimage(uint8 choiceRaw, bytes32 secret) public {
        vm.assume(secret != bytes32(0));
        uint8 choiceBounded = uint8(bound(choiceRaw, 1, 3)); // FIRST, SECOND, EQUIVALENT

        // Create task and submit two works
        (bytes32 taskId, bytes32 sub1, bytes32 sub2) = _createTaskWithTwoRevealedWorks();

        // Advance to compare commit
        vm.warp(block.timestamp + 30 minutes + 1);
        verifier.advancePhase(taskId);

        bytes32 commitHash = keccak256(abi.encodePacked(choiceBounded, secret));

        vm.prank(validator1);
        bytes32 compId = verifier.commitComparison(taskId, sub1, sub2, commitHash);

        // Advance to compare reveal
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(validator1);
        verifier.revealComparison(compId, IPairwiseVerifier.CompareChoice(choiceBounded), secret);

        IPairwiseVerifier.PairwiseComparison memory comp = verifier.getComparison(compId);
        assertTrue(comp.revealed);
        assertEq(uint8(comp.choice), choiceBounded);
    }

    // ============ Full Lifecycle Fuzz ============

    function testFuzz_fullLifecycle_rewardsDistributed(uint256 reward) public {
        reward = bound(reward, 0.01 ether, 5 ether);

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: reward}(
            "Full lifecycle",
            keccak256("spec"),
            3000, // 30% validator
            1 hours, 30 minutes, 1 hours, 30 minutes
        );

        // Two workers commit
        bytes32 work1Hash = keccak256("work1");
        bytes32 work2Hash = keccak256("work2");
        bytes32 secret1 = keccak256("secret1");
        bytes32 secret2 = keccak256("secret2");

        vm.prank(worker1);
        bytes32 sub1 = verifier.commitWork(taskId, keccak256(abi.encodePacked(work1Hash, secret1)));
        vm.prank(worker2);
        bytes32 sub2 = verifier.commitWork(taskId, keccak256(abi.encodePacked(work2Hash, secret2)));

        // Advance and reveal
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(worker1);
        verifier.revealWork(taskId, sub1, work1Hash, secret1);
        vm.prank(worker2);
        verifier.revealWork(taskId, sub2, work2Hash, secret2);

        // Advance to compare commit
        vm.warp(block.timestamp + 30 minutes + 1);
        verifier.advancePhase(taskId);

        // Three validators all vote for worker1
        bytes32 compSecret = keccak256("csecret");
        bytes32 compCommit = keccak256(abi.encodePacked(uint8(1), compSecret)); // FIRST

        vm.prank(validator1);
        bytes32 c1 = verifier.commitComparison(taskId, sub1, sub2, compCommit);
        vm.prank(validator2);
        bytes32 c2 = verifier.commitComparison(taskId, sub1, sub2, compCommit);
        vm.prank(validator3);
        bytes32 c3 = verifier.commitComparison(taskId, sub1, sub2, compCommit);

        // Advance to compare reveal
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(validator1);
        verifier.revealComparison(c1, IPairwiseVerifier.CompareChoice.FIRST, compSecret);
        vm.prank(validator2);
        verifier.revealComparison(c2, IPairwiseVerifier.CompareChoice.FIRST, compSecret);
        vm.prank(validator3);
        verifier.revealComparison(c3, IPairwiseVerifier.CompareChoice.FIRST, compSecret);

        // Settle
        vm.warp(block.timestamp + 30 minutes + 1);
        verifier.settle(taskId);

        // Worker1 should get more than worker2
        uint256 w1Reward = verifier.getWorkerReward(taskId, worker1);
        uint256 w2Reward = verifier.getWorkerReward(taskId, worker2);
        assertGt(w1Reward, w2Reward, "Winner should get more");

        // Total rewards should not exceed pool
        uint256 totalDistributed = w1Reward + w2Reward;
        for (uint256 i = 0; i < 3; i++) {
            address val = i == 0 ? validator1 : (i == 1 ? validator2 : validator3);
            totalDistributed += verifier.getValidatorReward(taskId, val);
        }
        assertLe(totalDistributed, reward, "Cannot exceed reward pool");
    }

    // ============ Phase Timing Fuzz ============

    function testFuzz_phaseAdvance_respectsTiming(
        uint64 workCommit,
        uint64 workReveal,
        uint64 compareCommit,
        uint64 compareReveal
    ) public {
        workCommit = uint64(bound(workCommit, 1 minutes, 7 days));
        workReveal = uint64(bound(workReveal, 1 minutes, 7 days));
        compareCommit = uint64(bound(compareCommit, 1 minutes, 7 days));
        compareReveal = uint64(bound(compareReveal, 1 minutes, 7 days));

        vm.prank(creator);
        bytes32 taskId = verifier.createTask{value: 1 ether}(
            "Timing test",
            keccak256("spec"),
            3000,
            workCommit, workReveal, compareCommit, compareReveal
        );

        IPairwiseVerifier.VerificationTask memory task = verifier.getTask(taskId);
        assertEq(uint8(task.phase), uint8(IPairwiseVerifier.TaskPhase.WORK_COMMIT));

        // Can't advance before time
        vm.expectRevert();
        verifier.advancePhase(taskId);

        // Advance past work commit
        vm.warp(block.timestamp + workCommit + 1);
        verifier.advancePhase(taskId);
        task = verifier.getTask(taskId);
        assertEq(uint8(task.phase), uint8(IPairwiseVerifier.TaskPhase.WORK_REVEAL));
    }

    // ============ Helpers ============

    function _createTaskWithTwoRevealedWorks() internal returns (bytes32 taskId, bytes32 sub1, bytes32 sub2) {
        vm.prank(creator);
        taskId = verifier.createTask{value: 1 ether}(
            "Helper task",
            keccak256("spec"),
            3000, 1 hours, 30 minutes, 1 hours, 30 minutes
        );

        bytes32 w1 = keccak256("w1");
        bytes32 w2 = keccak256("w2");
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");

        vm.prank(worker1);
        sub1 = verifier.commitWork(taskId, keccak256(abi.encodePacked(w1, s1)));
        vm.prank(worker2);
        sub2 = verifier.commitWork(taskId, keccak256(abi.encodePacked(w2, s2)));

        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        vm.prank(worker1);
        verifier.revealWork(taskId, sub1, w1, s1);
        vm.prank(worker2);
        verifier.revealWork(taskId, sub2, w2, s2);
    }
}
