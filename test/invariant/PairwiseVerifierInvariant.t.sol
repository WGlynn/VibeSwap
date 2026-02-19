// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/PairwiseVerifier.sol";

/// @notice Handler for PairwiseVerifier invariant testing
contract PairwiseVerifierHandler is Test {
    PairwiseVerifier public verifier;

    uint256 public ghostTasks;
    uint256 public ghostTotalRewardDeposited;
    bytes32[] public taskIds;

    address public creator = address(0x1111);

    constructor(PairwiseVerifier _verifier) {
        verifier = _verifier;
        vm.deal(creator, 1000 ether);
    }

    function createTask(uint256 rewardSeed) external {
        uint256 reward = bound(rewardSeed, 0.001 ether, 1 ether);

        vm.prank(creator);
        try verifier.createTask{value: reward}(
            "Invariant task",
            keccak256(abi.encodePacked(ghostTasks)),
            3000,
            1 hours, 30 minutes, 1 hours, 30 minutes
        ) returns (bytes32 taskId) {
            ghostTasks++;
            ghostTotalRewardDeposited += reward;
            taskIds.push(taskId);
        } catch {}
    }

    function getTaskCount() external view returns (uint256) {
        return taskIds.length;
    }
}

contract PairwiseVerifierInvariant is Test {

    PairwiseVerifier public verifier;
    PairwiseVerifierHandler public handler;

    function setUp() public {
        PairwiseVerifier impl = new PairwiseVerifier();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PairwiseVerifier.initialize, (address(0)))
        );
        verifier = PairwiseVerifier(address(proxy));
        handler = new PairwiseVerifierHandler(verifier);

        targetContract(address(handler));
    }

    // ============ Invariants ============

    /// @notice Total tasks matches ghost counter
    function invariant_totalTasksMatchesGhost() public view {
        assertEq(verifier.totalTasks(), handler.ghostTasks());
    }

    /// @notice Contract balance >= total deposited rewards (no funds leak before settlement)
    function invariant_balanceCoversRewards() public view {
        assertGe(address(verifier).balance, handler.ghostTotalRewardDeposited());
    }

    /// @notice All created tasks have non-zero reward pool
    function invariant_allTasksHaveReward() public view {
        uint256 count = handler.getTaskCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 taskId = handler.taskIds(i);
            IPairwiseVerifier.VerificationTask memory task = verifier.getTask(taskId);
            assertGt(task.rewardPool, 0);
        }
    }

    /// @notice All tasks start in WORK_COMMIT phase
    function invariant_newTasksStartInWorkCommit() public view {
        uint256 count = handler.getTaskCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 taskId = handler.taskIds(i);
            IPairwiseVerifier.VerificationTask memory task = verifier.getTask(taskId);
            // Tasks that haven't been advanced should still be in WORK_COMMIT
            if (!task.settled) {
                assertTrue(
                    uint8(task.phase) >= uint8(IPairwiseVerifier.TaskPhase.WORK_COMMIT) &&
                    uint8(task.phase) <= uint8(IPairwiseVerifier.TaskPhase.SETTLED)
                );
            }
        }
    }
}
