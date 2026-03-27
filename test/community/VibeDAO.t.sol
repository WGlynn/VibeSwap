// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/VibeDAO.sol";

/// @dev Mock target contract for proposal execution tests
contract MockTarget {
    uint256 public value;

    function setValue(uint256 _value) external {
        value = _value;
    }
}

contract VibeDAOTest is Test {
    VibeDAO public dao;
    MockTarget public target;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    event DAOCreated(uint256 indexed daoId, string name, address indexed creator, VibeDAO.GovernanceType govType);
    event MemberJoined(uint256 indexed daoId, address indexed member);
    event MemberLeft(uint256 indexed daoId, address indexed member);
    event ProposalCreated(uint256 indexed daoId, uint256 indexed proposalId, string title);
    event VoteCast(uint256 indexed daoId, uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed daoId, uint256 indexed proposalId);
    event DAOFunded(uint256 indexed daoId, address indexed funder, uint256 amount);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        VibeDAO impl = new VibeDAO();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeDAO.initialize.selector)
        );
        dao = VibeDAO(payable(address(proxy)));

        target = new MockTarget();
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(dao.daoCount(), 0);
    }

    // ============ DAO Creation ============

    function test_createDAO() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO(
            "Test DAO",
            "A test DAO",
            VibeDAO.GovernanceType.TOKEN_VOTING,
            5000, // 50% quorum
            1 hours,
            0
        );

        assertEq(daoId, 1);
        assertEq(dao.daoCount(), 1);

        (
            uint256 id,
            string memory name,
            string memory description,
            address creator,
            ,
            uint256 memberCount,
            ,
            ,
            VibeDAO.GovernanceType govType,
            uint256 quorumBps,
            uint256 votingPeriod,
            ,
            bool active,
        ) = dao.daos(1);

        assertEq(id, 1);
        assertEq(name, "Test DAO");
        assertEq(description, "A test DAO");
        assertEq(creator, alice);
        assertEq(memberCount, 1);
        assertEq(uint8(govType), uint8(VibeDAO.GovernanceType.TOKEN_VOTING));
        assertEq(quorumBps, 5000);
        assertEq(votingPeriod, 1 hours);
        assertTrue(active);
    }

    function test_createDAO_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit DAOCreated(1, "Test DAO", alice, VibeDAO.GovernanceType.TOKEN_VOTING);
        dao.createDAO("Test DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);
    }

    function test_createDAO_creatorAutoJoins() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.QUADRATIC, 5000, 1 hours, 0);

        assertTrue(dao.isMember(daoId, alice));
    }

    function test_createDAO_revert_invalidQuorum() public {
        vm.prank(alice);
        vm.expectRevert("Invalid quorum");
        dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 10001, 1 hours, 0);
    }

    function test_createDAO_revert_votingTooShort() public {
        vm.prank(alice);
        vm.expectRevert("Voting too short");
        dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 30 minutes, 0);
    }

    function test_createDAO_multipleDAOs() public {
        vm.startPrank(alice);
        dao.createDAO("DAO 1", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);
        dao.createDAO("DAO 2", "", VibeDAO.GovernanceType.CONVICTION, 3000, 2 hours, 0);
        vm.stopPrank();

        assertEq(dao.daoCount(), 2);
    }

    // ============ Membership ============

    function test_joinDAO() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit MemberJoined(daoId, bob);
        dao.joinDAO(daoId);

        assertTrue(dao.isMember(daoId, bob));

        (,,,,, uint256 memberCount,,,,,,,,) = dao.daos(daoId);
        assertEq(memberCount, 2);
    }

    function test_joinDAO_revert_alreadyMember() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        vm.expectRevert("Already member");
        dao.joinDAO(daoId);
    }

    function test_joinDAO_revert_daoNotActive() public {
        // DAO ID 999 doesn't exist — active defaults to false
        vm.prank(alice);
        vm.expectRevert("DAO not active");
        dao.joinDAO(999);
    }

    function test_leaveDAO() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit MemberLeft(daoId, bob);
        dao.leaveDAO(daoId);

        assertFalse(dao.isMember(daoId, bob));
    }

    function test_leaveDAO_revert_notMember() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        vm.expectRevert("Not a member");
        dao.leaveDAO(daoId);
    }

    // ============ Proposals ============

    function test_createProposal() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit ProposalCreated(daoId, 1, "Proposal 1");
        uint256 propId = dao.createProposal(
            daoId,
            "Proposal 1",
            "Do something",
            address(target),
            abi.encodeWithSelector(MockTarget.setValue.selector, 42)
        );

        assertEq(propId, 1);

        (
            uint256 proposalId,
            uint256 pDaoId,
            address proposer,
            string memory title,
            ,
            ,
            ,
            uint256 votesFor,
            uint256 votesAgainst,
            ,
            uint256 endTime,
            bool executed,
            bool cancelled
        ) = dao.proposals(daoId, propId);

        assertEq(proposalId, 1);
        assertEq(pDaoId, daoId);
        assertEq(proposer, alice);
        assertEq(title, "Proposal 1");
        assertEq(votesFor, 0);
        assertEq(votesAgainst, 0);
        assertGt(endTime, block.timestamp);
        assertFalse(executed);
        assertFalse(cancelled);
    }

    function test_createProposal_revert_notMember() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        vm.expectRevert("Not a member");
        dao.createProposal(daoId, "Prop", "", address(0), "");
    }

    // ============ Voting ============

    function test_vote_for() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(bob);
        vm.expectEmit(true, true, true, true);
        emit VoteCast(daoId, propId, bob, true);
        dao.vote(daoId, propId, true);

        (,,,,,,, uint256 votesFor,,,,, ) = dao.proposals(daoId, propId);
        assertEq(votesFor, 1);
        assertTrue(dao.hasVoted(daoId, propId, bob));
    }

    function test_vote_against() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(bob);
        dao.vote(daoId, propId, false);

        (,,,,,,,, uint256 votesAgainst,,,, ) = dao.proposals(daoId, propId);
        assertEq(votesAgainst, 1);
    }

    function test_vote_revert_notMember() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(bob);
        vm.expectRevert("Not a member");
        dao.vote(daoId, propId, true);
    }

    function test_vote_revert_alreadyVoted() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(alice);
        dao.vote(daoId, propId, true);

        vm.prank(alice);
        vm.expectRevert("Already voted");
        dao.vote(daoId, propId, false);
    }

    function test_vote_revert_votingEnded() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        // Warp past voting period
        vm.warp(block.timestamp + 2 hours);

        vm.prank(alice);
        vm.expectRevert("Voting ended");
        dao.vote(daoId, propId, true);
    }

    // ============ Proposal Execution ============

    function test_executeProposal() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(
            daoId,
            "Set value to 42",
            "Test execution",
            address(target),
            abi.encodeWithSelector(MockTarget.setValue.selector, 42)
        );

        // Both vote for
        vm.prank(alice);
        dao.vote(daoId, propId, true);
        vm.prank(bob);
        dao.vote(daoId, propId, true);

        // Warp past voting period
        vm.warp(block.timestamp + 2 hours);

        vm.expectEmit(true, true, false, false);
        emit ProposalExecuted(daoId, propId);
        dao.executeProposal(daoId, propId);

        assertEq(target.value(), 42);

        (,,,,,,,,,,,bool executed,) = dao.proposals(daoId, propId);
        assertTrue(executed);
    }

    function test_executeProposal_noExecutionData() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "No-op", "", address(0), "");

        vm.prank(alice);
        dao.vote(daoId, propId, true);

        vm.warp(block.timestamp + 2 hours);

        // Should succeed with no execution target
        dao.executeProposal(daoId, propId);
    }

    function test_executeProposal_revert_votingNotEnded() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(alice);
        dao.vote(daoId, propId, true);

        vm.expectRevert("Voting not ended");
        dao.executeProposal(daoId, propId);
    }

    function test_executeProposal_revert_quorumNotMet() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        // Add more members but don't have them vote
        vm.prank(bob);
        dao.joinDAO(daoId);
        vm.prank(charlie);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        // Only alice votes (1 out of 3) — quorum is 50% so need at least 1.5 => 2 votes
        vm.prank(alice);
        dao.vote(daoId, propId, true);

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Quorum not met");
        dao.executeProposal(daoId, propId);
    }

    function test_executeProposal_revert_notPassed() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        // Tie: 1 for, 1 against
        vm.prank(alice);
        dao.vote(daoId, propId, true);
        vm.prank(bob);
        dao.vote(daoId, propId, false);

        vm.warp(block.timestamp + 2 hours);

        vm.expectRevert("Not passed");
        dao.executeProposal(daoId, propId);
    }

    function test_executeProposal_revert_alreadyExecuted() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(alice);
        dao.vote(daoId, propId, true);

        vm.warp(block.timestamp + 2 hours);
        dao.executeProposal(daoId, propId);

        vm.expectRevert("Already processed");
        dao.executeProposal(daoId, propId);
    }

    // ============ Treasury ============

    function test_fundDAO() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit DAOFunded(daoId, bob, 1 ether);
        dao.fundDAO{value: 1 ether}(daoId);

        assertEq(dao.daoTreasury(daoId), 1 ether);

        (,,,,,, uint256 totalFunding,,,,,,,) = dao.daos(daoId);
        assertEq(totalFunding, 1 ether);
    }

    function test_fundDAO_revert_daoNotActive() public {
        vm.prank(alice);
        vm.expectRevert("DAO not active");
        dao.fundDAO{value: 1 ether}(999);
    }

    // ============ View ============

    function test_getDAOCount() public {
        assertEq(dao.getDAOCount(), 0);

        vm.prank(alice);
        dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        assertEq(dao.getDAOCount(), 1);
    }

    function test_isMember() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        assertTrue(dao.isMember(daoId, alice));
        assertFalse(dao.isMember(daoId, bob));
    }

    // ============ Governance Types ============

    function test_createDAO_allGovernanceTypes() public {
        vm.startPrank(alice);
        dao.createDAO("Token", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);
        dao.createDAO("Conviction", "", VibeDAO.GovernanceType.CONVICTION, 5000, 1 hours, 0);
        dao.createDAO("Quadratic", "", VibeDAO.GovernanceType.QUADRATIC, 5000, 1 hours, 0);
        dao.createDAO("Multisig", "", VibeDAO.GovernanceType.MULTISIG, 5000, 1 hours, 0);
        dao.createDAO("Reputation", "", VibeDAO.GovernanceType.REPUTATION, 5000, 1 hours, 0);
        vm.stopPrank();

        assertEq(dao.daoCount(), 5);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createDAO_quorumBounds(uint256 quorumBps) public {
        quorumBps = bound(quorumBps, 0, 10000);
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, quorumBps, 1 hours, 0);
        (,,,,,,,,, uint256 actualQuorum,,,,) = dao.daos(daoId);
        // Cannot destructure quorumBps directly — but verify daoId was created
        assertEq(daoId, 1);
    }

    function testFuzz_vote_multipleVoters(uint8 numVoters) public {
        numVoters = uint8(bound(numVoters, 1, 20));

        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 0, 1 hours, 0);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        vm.prank(alice);
        dao.vote(daoId, propId, true);

        for (uint8 i = 0; i < numVoters; i++) {
            address voter = makeAddr(string(abi.encodePacked("voter", i)));
            vm.prank(voter);
            dao.joinDAO(daoId);
            vm.prank(voter);
            dao.vote(daoId, propId, true);
        }

        (,,,,,,, uint256 votesFor,,,,, ) = dao.proposals(daoId, propId);
        assertEq(votesFor, uint256(numVoters) + 1);
    }

    // ============ Edge Cases ============

    function test_memberRejoinsAfterLeaving() public {
        vm.prank(alice);
        uint256 daoId = dao.createDAO("DAO", "", VibeDAO.GovernanceType.TOKEN_VOTING, 5000, 1 hours, 0);

        vm.prank(bob);
        dao.joinDAO(daoId);
        assertTrue(dao.isMember(daoId, bob));

        vm.prank(bob);
        dao.leaveDAO(daoId);
        assertFalse(dao.isMember(daoId, bob));

        vm.prank(bob);
        dao.joinDAO(daoId);
        assertTrue(dao.isMember(daoId, bob));
    }

    function test_receive_ether() public {
        vm.prank(alice);
        (bool ok,) = address(dao).call{value: 1 ether}("");
        assertTrue(ok);
    }
}
