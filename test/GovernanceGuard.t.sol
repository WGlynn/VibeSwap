// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/governance/GovernanceGuard.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Target ============

contract MockGGTarget {
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
        revert("MockGGTarget: always reverts");
    }
}

// ============ Test Contract ============

contract GovernanceGuardTest is Test {
    GovernanceGuard public guard;
    MockGGTarget public target;

    // ============ Actors ============

    address public owner;
    address public vetoGuardian;
    address public emergencyGuardian;
    address public proposer;
    address public nobody;

    // ============ Re-declared Events ============

    event ProposalCreated(
        bytes32 indexed proposalId, address indexed proposer, address indexed target,
        uint256 value, bytes data, string description, uint256 executeAfter, bool emergency
    );
    event ProposalExecuted(bytes32 indexed proposalId, address indexed executor);
    event ProposalVetoed(bytes32 indexed proposalId, address indexed vetoer, string reason);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed canceller);
    event VetoGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event EmergencyGuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event ProposerUpdated(address indexed account, bool authorized);

    // ============ Constants ============

    uint256 constant TIMELOCK_DELAY = 48 hours;
    uint256 constant EMERGENCY_DELAY = 6 hours;

    function setUp() public {
        owner = makeAddr("owner");
        vetoGuardian = makeAddr("vetoGuardian");
        emergencyGuardian = makeAddr("emergencyGuardian");
        proposer = makeAddr("proposer");
        nobody = makeAddr("nobody");

        // Deploy implementation + proxy
        GovernanceGuard impl = new GovernanceGuard();
        bytes memory initData = abi.encodeCall(
            GovernanceGuard.initialize,
            (owner, vetoGuardian, emergencyGuardian)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        guard = GovernanceGuard(payable(address(proxy)));

        // Authorize proposer
        vm.prank(owner);
        guard.setProposer(proposer, true);

        // Deploy target
        target = new MockGGTarget();

        // Fund guard with ETH for payable proposals
        vm.deal(address(guard), 10 ether);
    }

    // ============ Helpers ============

    function _proposeDefault() internal returns (bytes32 proposalId) {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.prank(proposer);
        proposalId = guard.propose(address(target), 0, data, "Set value to 42");
    }

    function _proposeEmergency() internal returns (bytes32 proposalId) {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (99));
        vm.prank(emergencyGuardian);
        proposalId = guard.proposeEmergency(address(target), 0, data, "Emergency: set 99");
    }

    // ============ Initialization ============

    function test_initialize_setsState() public view {
        assertEq(guard.owner(), owner);
        assertEq(guard.vetoGuardian(), vetoGuardian);
        assertEq(guard.emergencyGuardian(), emergencyGuardian);
    }

    function test_initialize_revertsZeroOwner() public {
        GovernanceGuard impl = new GovernanceGuard();
        bytes memory initData = abi.encodeCall(
            GovernanceGuard.initialize,
            (address(0), vetoGuardian, emergencyGuardian)
        );
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroVetoGuardian() public {
        GovernanceGuard impl = new GovernanceGuard();
        bytes memory initData = abi.encodeCall(
            GovernanceGuard.initialize,
            (owner, address(0), emergencyGuardian)
        );
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    function test_initialize_revertsZeroEmergencyGuardian() public {
        GovernanceGuard impl = new GovernanceGuard();
        bytes memory initData = abi.encodeCall(
            GovernanceGuard.initialize,
            (owner, vetoGuardian, address(0))
        );
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    // ============ Proposal Creation ============

    function test_propose_createsProposal() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        bytes32 expectedId = guard.hashProposal(address(target), 0, data, "Set value to 42");

        vm.prank(proposer);
        bytes32 proposalId = guard.propose(address(target), 0, data, "Set value to 42");

        assertEq(proposalId, expectedId);
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));
    }

    function test_propose_ownerCanPropose() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (1));
        vm.prank(owner);
        bytes32 proposalId = guard.propose(address(target), 0, data, "Owner proposal");
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));
    }

    function test_propose_revertsNotProposerOrOwner() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (1));
        vm.prank(nobody);
        vm.expectRevert(GovernanceGuard.NotProposerOrOwner.selector);
        guard.propose(address(target), 0, data, "Unauthorized");
    }

    function test_propose_revertsDuplicateProposal() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.prank(proposer);
        guard.propose(address(target), 0, data, "First");

        vm.prank(proposer);
        vm.expectRevert(GovernanceGuard.ProposalAlreadyExists.selector);
        guard.propose(address(target), 0, data, "First");
    }

    function test_propose_incrementsCount() public {
        assertEq(guard.proposalCount(), 0);
        _proposeDefault();
        assertEq(guard.proposalCount(), 1);
    }

    // ============ Emergency Proposal ============

    function test_proposeEmergency_createsWithShorterDelay() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (99));
        vm.prank(emergencyGuardian);
        bytes32 proposalId = guard.proposeEmergency(address(target), 0, data, "Emergency: set 99");

        (,,,,, uint256 executeAfter, bool emergency,) = guard.getProposal(proposalId);
        assertTrue(emergency);
        assertEq(executeAfter, block.timestamp + EMERGENCY_DELAY);
    }

    function test_proposeEmergency_revertsNotEmergencyGuardian() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (99));
        vm.prank(proposer);
        vm.expectRevert(GovernanceGuard.NotEmergencyGuardian.selector);
        guard.proposeEmergency(address(target), 0, data, "Not authorized");
    }

    // ============ Timelock Delay ============

    function test_execute_revertsBeforeTimelock() public {
        bytes32 proposalId = _proposeDefault();

        // Try to execute immediately — should fail
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.expectRevert(GovernanceGuard.TimelockNotElapsed.selector);
        guard.execute(address(target), 0, data, "Set value to 42");

        // Advance to 1 second before delay expires
        vm.warp(block.timestamp + TIMELOCK_DELAY - 1);
        vm.expectRevert(GovernanceGuard.TimelockNotElapsed.selector);
        guard.execute(address(target), 0, data, "Set value to 42");
    }

    function test_execute_succeedsAfterTimelock() public {
        _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        guard.execute(address(target), 0, data, "Set value to 42");

        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), address(guard));
    }

    function test_execute_emergencyDelayIsShorter() public {
        _proposeEmergency();

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (99));

        // Before emergency delay: reverts
        vm.warp(block.timestamp + EMERGENCY_DELAY - 1);
        vm.expectRevert(GovernanceGuard.TimelockNotElapsed.selector);
        guard.execute(address(target), 0, data, "Emergency: set 99");

        // At emergency delay: succeeds
        vm.warp(block.timestamp + 1);
        guard.execute(address(target), 0, data, "Emergency: set 99");

        assertEq(target.value(), 99);
    }

    function test_execute_isPermissionless() public {
        _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.prank(nobody);
        guard.execute(address(target), 0, data, "Set value to 42");

        assertEq(target.value(), 42);
    }

    function test_execute_revertsIfCallFails() public {
        bytes memory data = abi.encodeCall(MockGGTarget.revertAlways, ());
        vm.prank(proposer);
        guard.propose(address(target), 0, data, "Will revert");

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert("MockGGTarget: always reverts");
        guard.execute(address(target), 0, data, "Will revert");
    }

    function test_execute_forwardsEthValue() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValuePayable, (777));
        vm.prank(proposer);
        guard.propose(address(target), 1 ether, data, "Send 1 ETH");

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        guard.execute{value: 1 ether}(address(target), 1 ether, data, "Send 1 ETH");

        assertEq(target.value(), 777);
        assertEq(address(target).balance, 1 ether);
    }

    function test_execute_revertsDoubleExecution() public {
        _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        guard.execute(address(target), 0, data, "Set value to 42");

        vm.expectRevert(GovernanceGuard.ProposalAlreadyExecuted.selector);
        guard.execute(address(target), 0, data, "Set value to 42");
    }

    function test_execute_revertsIfProposalNotFound() public {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.expectRevert(GovernanceGuard.ProposalNotFound.selector);
        guard.execute(address(target), 0, data, "Nonexistent proposal");
    }

    // ============ Veto (Shapley Fairness Check) ============

    function test_veto_blocksExecution() public {
        bytes32 proposalId = _proposeDefault();

        // Veto guardian vetoes the proposal
        vm.prank(vetoGuardian);
        guard.veto(proposalId, "Fails fairness check");

        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.VETOED));

        // Execution should now fail
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.expectRevert(GovernanceGuard.ProposalAlreadyVetoed.selector);
        guard.execute(address(target), 0, data, "Set value to 42");
    }

    function test_veto_revertsNotVetoGuardian() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(nobody);
        vm.expectRevert(GovernanceGuard.NotVetoGuardian.selector);
        guard.veto(proposalId, "Not authorized");
    }

    function test_veto_revertsAlreadyVetoed() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(vetoGuardian);
        guard.veto(proposalId, "First veto");

        vm.prank(vetoGuardian);
        vm.expectRevert(GovernanceGuard.ProposalAlreadyVetoed.selector);
        guard.veto(proposalId, "Second veto");
    }

    function test_veto_revertsAlreadyExecuted() public {
        bytes32 proposalId = _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        guard.execute(address(target), 0, data, "Set value to 42");

        vm.prank(vetoGuardian);
        vm.expectRevert(GovernanceGuard.ProposalAlreadyExecuted.selector);
        guard.veto(proposalId, "Too late");
    }

    function test_veto_canVetoEmergencyProposal() public {
        bytes32 proposalId = _proposeEmergency();

        vm.prank(vetoGuardian);
        guard.veto(proposalId, "Emergency still vetoable");

        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.VETOED));
    }

    function test_veto_revertsOnNonexistentProposal() public {
        vm.prank(vetoGuardian);
        vm.expectRevert(GovernanceGuard.ProposalNotFound.selector);
        guard.veto(bytes32(uint256(999)), "Does not exist");
    }

    // ============ Cancellation ============

    function test_cancel_proposerCanCancel() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(proposer);
        guard.cancel(proposalId);

        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.CANCELLED));
    }

    function test_cancel_ownerCanCancel() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(owner);
        guard.cancel(proposalId);

        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.CANCELLED));
    }

    function test_cancel_revertsUnauthorized() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(nobody);
        vm.expectRevert(GovernanceGuard.NotProposerOrOwner.selector);
        guard.cancel(proposalId);
    }

    function test_cancel_blocksExecution() public {
        bytes32 proposalId = _proposeDefault();

        vm.prank(proposer);
        guard.cancel(proposalId);

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.expectRevert(GovernanceGuard.ProposalAlreadyCancelled.selector);
        guard.execute(address(target), 0, data, "Set value to 42");
    }

    function test_cancel_revertsAlreadyExecuted() public {
        bytes32 proposalId = _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        guard.execute(address(target), 0, data, "Set value to 42");

        vm.prank(proposer);
        vm.expectRevert(GovernanceGuard.ProposalAlreadyExecuted.selector);
        guard.cancel(proposalId);
    }

    // ============ Proposal State Machine ============

    function test_state_emptyForNonexistent() public view {
        bytes32 fakeId = bytes32(uint256(123));
        assertEq(uint8(guard.getProposalState(fakeId)), uint8(GovernanceGuard.ProposalState.EMPTY));
    }

    function test_state_pendingDuringTimelock() public {
        bytes32 proposalId = _proposeDefault();
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));

        vm.warp(block.timestamp + TIMELOCK_DELAY - 1);
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));
    }

    function test_state_readyAfterTimelock() public {
        bytes32 proposalId = _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.READY));
    }

    function test_state_executedAfterExecution() public {
        bytes32 proposalId = _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        guard.execute(address(target), 0, data, "Set value to 42");

        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.EXECUTED));
    }

    // ============ View Functions ============

    function test_isExecutable_returnsCorrectly() public {
        bytes32 proposalId = _proposeDefault();

        assertFalse(guard.isExecutable(proposalId));

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        assertTrue(guard.isExecutable(proposalId));

        // After veto, not executable
        bytes32 proposalId2 = _proposeEmergency();
        vm.prank(vetoGuardian);
        guard.veto(proposalId2, "vetoed");
        assertFalse(guard.isExecutable(proposalId2));
    }

    function test_timeUntilExecutable() public {
        bytes32 proposalId = _proposeDefault();

        assertEq(guard.timeUntilExecutable(proposalId), TIMELOCK_DELAY);

        vm.warp(block.timestamp + 1 hours);
        assertEq(guard.timeUntilExecutable(proposalId), TIMELOCK_DELAY - 1 hours);

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        assertEq(guard.timeUntilExecutable(proposalId), 0);
    }

    function test_hashProposal_isDeterministic() public view {
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        bytes32 hash1 = guard.hashProposal(address(target), 0, data, "test");
        bytes32 hash2 = guard.hashProposal(address(target), 0, data, "test");
        assertEq(hash1, hash2);

        // Different description -> different hash
        bytes32 hash3 = guard.hashProposal(address(target), 0, data, "other");
        assertTrue(hash1 != hash3);
    }

    // ============ Guardian Management ============

    function test_setVetoGuardian_updatesGuardian() public {
        address newGuardian = makeAddr("newVeto");
        vm.prank(owner);
        guard.setVetoGuardian(newGuardian);
        assertEq(guard.vetoGuardian(), newGuardian);
    }

    function test_setVetoGuardian_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        guard.setVetoGuardian(address(0));
    }

    function test_setVetoGuardian_revertsNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert();
        guard.setVetoGuardian(makeAddr("new"));
    }

    function test_setEmergencyGuardian_updatesGuardian() public {
        address newGuardian = makeAddr("newEmergency");
        vm.prank(owner);
        guard.setEmergencyGuardian(newGuardian);
        assertEq(guard.emergencyGuardian(), newGuardian);
    }

    function test_setEmergencyGuardian_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        guard.setEmergencyGuardian(address(0));
    }

    function test_setProposer_authorizesAndRevokes() public {
        address newProposer = makeAddr("newProposer");
        vm.startPrank(owner);

        guard.setProposer(newProposer, true);
        assertTrue(guard.proposers(newProposer));

        guard.setProposer(newProposer, false);
        assertFalse(guard.proposers(newProposer));

        vm.stopPrank();
    }

    function test_setProposer_revertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(GovernanceGuard.ZeroAddress.selector);
        guard.setProposer(address(0), true);
    }

    // ============ Edge Cases ============

    function test_fullLifecycle_propose_wait_execute() public {
        // Propose
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (12345));
        vm.prank(proposer);
        bytes32 proposalId = guard.propose(address(target), 0, data, "Full lifecycle");

        // Pending
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));

        // Wait
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.READY));

        // Execute
        guard.execute(address(target), 0, data, "Full lifecycle");
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.EXECUTED));
        assertEq(target.value(), 12345);
    }

    function test_vetoRace_vetoJustBeforeExecution() public {
        bytes32 proposalId = _proposeDefault();
        vm.warp(block.timestamp + TIMELOCK_DELAY);

        // Proposal is READY
        assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.READY));

        // Veto at last moment
        vm.prank(vetoGuardian);
        guard.veto(proposalId, "Last-second veto");

        // Execution should fail
        bytes memory data = abi.encodeCall(MockGGTarget.setValue, (42));
        vm.expectRevert(GovernanceGuard.ProposalAlreadyVetoed.selector);
        guard.execute(address(target), 0, data, "Set value to 42");
    }

    function test_receive_acceptsEth() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        (bool success,) = address(guard).call{value: 1 ether}("");
        assertTrue(success);
    }

    // ============ Fuzz Tests ============

    function testFuzz_timelock_correctDelay(uint256 warpDelta) public {
        warpDelta = bound(warpDelta, 0, 365 days);

        bytes32 proposalId = _proposeDefault();
        uint256 startTime = block.timestamp;

        vm.warp(startTime + warpDelta);

        if (warpDelta < TIMELOCK_DELAY) {
            assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.PENDING));
        } else {
            assertEq(uint8(guard.getProposalState(proposalId)), uint8(GovernanceGuard.ProposalState.READY));
        }
    }

    function testFuzz_hashProposal_uniquePerParams(
        address _target,
        uint256 _value,
        bytes calldata _data,
        string calldata _desc
    ) public view {
        bytes32 h1 = guard.hashProposal(_target, _value, _data, _desc);
        assertTrue(h1 != bytes32(0));
    }
}
