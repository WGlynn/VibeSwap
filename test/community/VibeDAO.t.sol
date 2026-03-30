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

        VibeDAO.SubDAO memory d = dao.getDAO(1);
        assertEq(d.daoId, 1);
        assertEq(d.name, "Test DAO");
        assertEq(d.description, "A test DAO");
        assertEq(d.creator, alice);
        assertEq(d.memberCount, 1);
        assertEq(uint8(d.govType), uint8(VibeDAO.GovernanceType.TOKEN_VOTING));
        assertEq(d.quorumBps, 5000);
        assertEq(d.votingPeriod, 1 hours);
        assertTrue(d.active);
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

        assertEq(dao.getDAO(daoId).memberCount, 2);
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

        VibeDAO.DAOProposal memory p = dao.getProposal(daoId, propId);
        assertEq(p.proposalId, 1);
        assertEq(p.daoId, daoId);
        assertEq(p.proposer, alice);
        assertEq(p.title, "Proposal 1");
        assertEq(p.votesFor, 0);
        assertEq(p.votesAgainst, 0);
        assertGt(p.endTime, block.timestamp);
        assertFalse(p.executed);
        assertFalse(p.cancelled);
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

        assertEq(dao.getProposal(daoId, propId).votesFor, 1);
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

        assertEq(dao.getProposal(daoId, propId).votesAgainst, 1);
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

        assertTrue(dao.getProposal(daoId, propId).executed);
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

        // Add 3 more members (total 4: alice + bob + charlie + dave)
        // quorumNeeded = floor(4 * 5000 / 10000) = 2, but only alice votes (1 vote) => quorum not met
        vm.prank(bob);
        dao.joinDAO(daoId);
        vm.prank(charlie);
        dao.joinDAO(daoId);
        address dave = makeAddr("dave_quorum");
        vm.prank(dave);
        dao.joinDAO(daoId);

        vm.prank(alice);
        uint256 propId = dao.createProposal(daoId, "Prop", "", address(0), "");

        // Only alice votes (1 out of 4) — quorum is 50% so need 2 votes, but only 1 cast
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

        assertEq(dao.getDAO(daoId).totalFunding, 1 ether);
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
        assertEq(dao.getDAO(daoId).quorumBps, quorumBps);
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

        assertEq(dao.getProposal(daoId, propId).votesFor, uint256(numVoters) + 1);
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
