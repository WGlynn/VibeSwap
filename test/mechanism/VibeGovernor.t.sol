// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/VibeGovernor.sol";

/// @dev Simple target that records calls for execution tests
contract GovTarget {
    uint256 public value;
    bool public paused;

    function setValue(uint256 _v) external { value = _v; }
    function setPaused(bool _p) external { paused = _p; }
}

contract VibeGovernorTest is Test {
    VibeGovernor public gov;
    GovTarget public target;

    address public owner;
    address public alice;
    address public bob;
    address public vetoer;

    // 100_000 total supply makes 4% quorum = 4_000 votes
    uint256 public constant SUPPLY = 100_000 ether;
    uint256 public constant QUORUM = (SUPPLY * 400) / 10_000; // 4 000 ether

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, VibeGovernor.ProposalType pType, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, VibeGovernor.VoteType voteType, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalVetoed(uint256 indexed proposalId, address indexed vetoer);
    event VetoCouncilUpdated(address indexed member, bool added);

    function setUp() public {
        owner  = address(this);
        alice  = makeAddr("alice");
        bob    = makeAddr("bob");
        vetoer = makeAddr("vetoer");

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);

        VibeGovernor impl = new VibeGovernor();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeGovernor.initialize.selector, SUPPLY)
        );
        gov = VibeGovernor(payable(address(proxy)));

        gov.setVetoCouncil(vetoer, true);

        target = new GovTarget();
    }

    // ============ Helpers ============

    function _singleCallProposal(address to, bytes memory data)
        internal pure
        returns (address[] memory t, uint256[] memory v, bytes[] memory c)
    {
        t = new address[](1); v = new uint256[](1); c = new bytes[](1);
        t[0] = to; c[0] = data;
    }

    function _propose(address proposer, address to, bytes memory data)
        internal returns (uint256 proposalId)
    {
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _singleCallProposal(to, data);
        vm.prank(proposer);
        proposalId = gov.propose(VibeGovernor.ProposalType.GENERAL, "test proposal", t, v, c);
    }

    /// Roll to startBlock+1 so the proposal is ACTIVE
    function _activate(uint256 id) internal {
        // proposalId, proposer, pType, description — no arrays in getter
        // Use getProposal view for state, manually advance block
        // startBlock ≈ current + VOTING_DELAY/12
        uint256 delay = gov.VOTING_DELAY() / 12;
        vm.roll(block.number + delay + 2);
    }

    /// Roll past endBlock
    function _closeVoting(uint256 id) internal {
        uint256 delay  = gov.VOTING_DELAY() / 12;
        uint256 period = gov.VOTING_PERIOD() / 12;
        vm.roll(block.number + delay + period + 2);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(gov.totalVotingSupply(), SUPPLY);
        assertEq(gov.proposalCount(), 0);
        assertEq(gov.totalProposals(), 0);
        assertEq(gov.totalVotesCast(), 0);
        assertEq(gov.vetoCouncilCount(), 1);
        assertTrue(gov.vetoCouncil(vetoer));
    }

    // ============ Proposals ============

    function test_propose_createsProposal() public {
        uint256 id = _propose(alice, address(target), abi.encodeWithSelector(GovTarget.setValue.selector, 99));

        assertEq(id, 1);
        assertEq(gov.proposalCount(), 1);
        assertEq(gov.totalProposals(), 1);

        (
            address proposer,
            VibeGovernor.ProposalType pType,
            ,,,
            VibeGovernor.ProposalState state
        ) = gov.getProposal(id);

        assertEq(proposer, alice);
        assertEq(uint8(pType), uint8(VibeGovernor.ProposalType.GENERAL));
        assertEq(uint8(state), uint8(VibeGovernor.ProposalState.PENDING));
    }

    function test_propose_emitsEvent() public {
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _singleCallProposal(address(target), "");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit ProposalCreated(1, alice, VibeGovernor.ProposalType.GENERAL, "test");
        gov.propose(VibeGovernor.ProposalType.GENERAL, "test", t, v, c);
    }

    function test_propose_multipleProposals() public {
        _propose(alice, address(target), "");
        _propose(bob,   address(target), "");

        assertEq(gov.proposalCount(), 2);
        assertEq(gov.totalProposals(), 2);
    }

    function test_propose_revert_emptyTargets() public {
        address[] memory t = new address[](0);
        uint256[] memory v = new uint256[](0);
        bytes[]   memory c = new bytes[](0);

        vm.prank(alice);
        vm.expectRevert("Empty proposal");
        gov.propose(VibeGovernor.ProposalType.GENERAL, "empty", t, v, c);
    }

    function test_propose_revert_lengthMismatch() public {
        address[] memory t = new address[](2);
        uint256[] memory v = new uint256[](1);
        bytes[]   memory c = new bytes[](2);
        t[0] = address(target); t[1] = address(target);
        c[0] = ""; c[1] = "";
        v[0] = 0;

        vm.prank(alice);
        vm.expectRevert("Length mismatch");
        gov.propose(VibeGovernor.ProposalType.GENERAL, "mismatch", t, v, c);
    }

    function test_propose_allProposalTypes() public {
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _singleCallProposal(address(target), "");

        vm.startPrank(alice);
        gov.propose(VibeGovernor.ProposalType.PARAMETER, "param",     t, v, c);
        gov.propose(VibeGovernor.ProposalType.UPGRADE,   "upgrade",   t, v, c);
        gov.propose(VibeGovernor.ProposalType.TREASURY,  "treasury",  t, v, c);
        gov.propose(VibeGovernor.ProposalType.EMERGENCY, "emergency", t, v, c);
        gov.propose(VibeGovernor.ProposalType.GENERAL,   "general",   t, v, c);
        vm.stopPrank();

        assertEq(gov.proposalCount(), 5);
    }

    // ============ State Transitions ============

    function test_getState_pending() public {
        uint256 id = _propose(alice, address(target), "");
        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.PENDING));
    }

    function test_getState_active() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);
        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.ACTIVE));
    }

    function test_getState_defeated_noQuorum() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);
        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM - 1);
        _closeVoting(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.DEFEATED));
    }

    function test_getState_defeated_againstWins() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM);
        vm.prank(bob);
        gov.castVote(id, VibeGovernor.VoteType.AGAINST, QUORUM + 1 ether);
        _closeVoting(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.DEFEATED));
    }

    function test_getState_succeeded() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM + 1 ether);
        _closeVoting(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.SUCCEEDED));
    }

    function test_getState_cancelled() public {
        uint256 id = _propose(alice, address(target), "");
        vm.prank(alice);
        gov.cancel(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.CANCELLED));
    }

    function test_getState_vetoed() public {
        uint256 id = _propose(alice, address(target), "");
        vm.prank(vetoer);
        gov.veto(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.VETOED));
    }

    // ============ Voting ============

    function test_castVote_for() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit VoteCast(id, alice, VibeGovernor.VoteType.FOR, 1000 ether);
        gov.castVote(id, VibeGovernor.VoteType.FOR, 1000 ether);

        assertEq(gov.totalVotesCast(), 1);
        assertTrue(gov.hasVoted(id, alice));
        assertEq(uint8(gov.voteReceipt(id, alice)), uint8(VibeGovernor.VoteType.FOR));

        (, , uint256 forVotes, , , ) = gov.getProposal(id);
        assertEq(forVotes, 1000 ether);
    }

    function test_castVote_against() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.AGAINST, 500 ether);

        (, , , uint256 againstVotes, , ) = gov.getProposal(id);
        assertEq(againstVotes, 500 ether);
    }

    function test_castVote_abstain() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.ABSTAIN, 200 ether);

        (, , , , uint256 abstainVotes, ) = gov.getProposal(id);
        assertEq(abstainVotes, 200 ether);
    }

    function test_castVote_multipleVoters() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, 1000 ether);
        vm.prank(bob);
        gov.castVote(id, VibeGovernor.VoteType.FOR, 2000 ether);

        (, , uint256 forVotes, , , ) = gov.getProposal(id);
        assertEq(forVotes, 3000 ether);
        assertEq(gov.totalVotesCast(), 2);
    }

    function test_castVote_revert_notStarted() public {
        uint256 id = _propose(alice, address(target), "");
        // Proposal is still PENDING — block.number < startBlock

        vm.prank(alice);
        vm.expectRevert("Voting not started");
        gov.castVote(id, VibeGovernor.VoteType.FOR, 100 ether);
    }

    function test_castVote_revert_votingEnded() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);
        _closeVoting(id);

        vm.prank(alice);
        vm.expectRevert("Voting ended");
        gov.castVote(id, VibeGovernor.VoteType.FOR, 100 ether);
    }

    function test_castVote_revert_alreadyVoted() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, 100 ether);

        vm.prank(alice);
        vm.expectRevert("Already voted");
        gov.castVote(id, VibeGovernor.VoteType.AGAINST, 100 ether);
    }

    function test_castVote_revert_zeroWeight() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        vm.expectRevert("Zero weight");
        gov.castVote(id, VibeGovernor.VoteType.FOR, 0);
    }

    function test_castVote_revert_cancelled() public {
        uint256 id = _propose(alice, address(target), "");
        vm.prank(alice);
        gov.cancel(id);
        _activate(id);

        vm.prank(bob);
        vm.expectRevert("Proposal inactive");
        gov.castVote(id, VibeGovernor.VoteType.FOR, 100 ether);
    }

    function test_castVote_revert_vetoed() public {
        uint256 id = _propose(alice, address(target), "");
        vm.prank(vetoer);
        gov.veto(id);
        _activate(id);

        vm.prank(alice);
        vm.expectRevert("Proposal inactive");
        gov.castVote(id, VibeGovernor.VoteType.FOR, 100 ether);
    }

    // ============ Execution ============

    function test_execute_callsTarget() public {
        bytes memory callData = abi.encodeWithSelector(GovTarget.setValue.selector, 42);
        uint256 id = _propose(alice, address(target), callData);
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM + 1 ether);
        _closeVoting(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.SUCCEEDED));

        vm.expectEmit(true, false, false, false);
        emit ProposalExecuted(id);
        gov.execute(id);

        assertEq(target.value(), 42);
        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.EXECUTED));
    }

    function test_execute_revert_notSucceeded_noQuorum() public {
        uint256 id = _propose(alice, address(target), "");
        _activate(id);
        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM - 1);
        _closeVoting(id);

        vm.expectRevert("Not succeeded");
        gov.execute(id);
    }

    function test_execute_revert_alreadyExecuted() public {
        bytes memory callData = abi.encodeWithSelector(GovTarget.setValue.selector, 1);
        uint256 id = _propose(alice, address(target), callData);
        _activate(id);
        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM + 1 ether);
        _closeVoting(id);
        gov.execute(id);

        vm.expectRevert("Already executed");
        gov.execute(id);
    }

    // ============ Cancel ============

    function test_cancel_byProposer() public {
        uint256 id = _propose(alice, address(target), "");

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit ProposalCancelled(id);
        gov.cancel(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.CANCELLED));
    }

    function test_cancel_byOwner() public {
        uint256 id = _propose(alice, address(target), "");

        // owner == address(this)
        vm.expectEmit(true, false, false, false);
        emit ProposalCancelled(id);
        gov.cancel(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.CANCELLED));
    }

    function test_cancel_revert_notAuthorized() public {
        uint256 id = _propose(alice, address(target), "");

        vm.prank(bob);
        vm.expectRevert("Not authorized");
        gov.cancel(id);
    }

    function test_cancel_revert_alreadyExecuted() public {
        bytes memory callData = abi.encodeWithSelector(GovTarget.setValue.selector, 1);
        uint256 id = _propose(alice, address(target), callData);
        _activate(id);
        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM + 1 ether);
        _closeVoting(id);
        gov.execute(id);

        vm.prank(alice);
        vm.expectRevert("Already executed");
        gov.cancel(id);
    }

    // ============ Veto ============

    function test_veto_byCouncilMember() public {
        uint256 id = _propose(alice, address(target), "");

        vm.prank(vetoer);
        vm.expectEmit(true, true, false, false);
        emit ProposalVetoed(id, vetoer);
        gov.veto(id);

        assertEq(uint8(gov.getState(id)), uint8(VibeGovernor.ProposalState.VETOED));
    }

    function test_veto_revert_notCouncil() public {
        uint256 id = _propose(alice, address(target), "");

        vm.prank(alice);
        vm.expectRevert("Not veto council");
        gov.veto(id);
    }

    function test_veto_revert_alreadyExecuted() public {
        bytes memory callData = abi.encodeWithSelector(GovTarget.setValue.selector, 1);
        uint256 id = _propose(alice, address(target), callData);
        _activate(id);
        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, QUORUM + 1 ether);
        _closeVoting(id);
        gov.execute(id);

        vm.prank(vetoer);
        vm.expectRevert("Already executed");
        gov.veto(id);
    }

    // ============ Admin ============

    function test_setVetoCouncil_add() public {
        address newMember = makeAddr("newMember");

        vm.expectEmit(true, false, false, true);
        emit VetoCouncilUpdated(newMember, true);
        gov.setVetoCouncil(newMember, true);

        assertTrue(gov.vetoCouncil(newMember));
        assertEq(gov.vetoCouncilCount(), 2);
    }

    function test_setVetoCouncil_remove() public {
        gov.setVetoCouncil(vetoer, false);

        assertFalse(gov.vetoCouncil(vetoer));
        assertEq(gov.vetoCouncilCount(), 0);
    }

    function test_setVetoCouncil_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        gov.setVetoCouncil(alice, true);
    }

    function test_setTotalVotingSupply() public {
        gov.setTotalVotingSupply(200_000 ether);
        assertEq(gov.totalVotingSupply(), 200_000 ether);
    }

    function test_setTotalVotingSupply_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        gov.setTotalVotingSupply(1);
    }

    // ============ View Helpers ============

    function test_getProposal_view() public {
        uint256 id = _propose(alice, address(target), "");
        (
            address proposer,
            VibeGovernor.ProposalType pType,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes,
            VibeGovernor.ProposalState state
        ) = gov.getProposal(id);

        assertEq(proposer, alice);
        assertEq(uint8(pType), uint8(VibeGovernor.ProposalType.GENERAL));
        assertEq(forVotes, 0);
        assertEq(againstVotes, 0);
        assertEq(abstainVotes, 0);
        assertEq(uint8(state), uint8(VibeGovernor.ProposalState.PENDING));
    }

    function test_getProposalCount() public {
        assertEq(gov.getProposalCount(), 0);
        _propose(alice, address(target), "");
        assertEq(gov.getProposalCount(), 1);
    }

    function test_receiveEther() public {
        (bool ok,) = address(gov).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_castVote_weightAccumulates(uint128 forAmt, uint128 againstAmt) public {
        vm.assume(forAmt > 0 && againstAmt > 0);

        uint256 id = _propose(alice, address(target), "");
        _activate(id);

        vm.prank(alice);
        gov.castVote(id, VibeGovernor.VoteType.FOR, forAmt);
        vm.prank(bob);
        gov.castVote(id, VibeGovernor.VoteType.AGAINST, againstAmt);

        (, , uint256 forVotes, uint256 againstVotes, , ) = gov.getProposal(id);
        assertEq(forVotes, forAmt);
        assertEq(againstVotes, againstAmt);
    }

    function testFuzz_propose_idMonotonicallyIncreases(uint8 count) public {
        count = uint8(bound(count, 1, 20));
        (address[] memory t, uint256[] memory v, bytes[] memory c) = _singleCallProposal(address(target), "");

        for (uint8 i = 0; i < count; i++) {
            vm.prank(alice);
            uint256 id = gov.propose(VibeGovernor.ProposalType.GENERAL, "p", t, v, c);
            assertEq(id, uint256(i) + 1);
        }

        assertEq(gov.proposalCount(), count);
    }
}
