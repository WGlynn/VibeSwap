// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/QuadraticVoting.sol";

// ============ Mocks ============

contract MockQVToken {
    string public name = "Joule";
    string public symbol = "JUL";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient");
        require(allowance[from][msg.sender] >= amount, "Allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockQVReputation {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external {
        tiers[user] = tier;
    }

    function getTrustScore(address user) external view returns (uint256) {
        return uint256(tiers[user]) * 100;
    }

    function getTrustTier(address user) external view returns (uint8) {
        return tiers[user];
    }

    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return tiers[user] >= requiredTier;
    }
}

contract MockQVIdentity {
    mapping(address => bool) public identities;

    function grantIdentity(address user) external {
        identities[user] = true;
    }

    function hasIdentity(address addr) external view returns (bool) {
        return identities[addr];
    }
}

// ============ Test Contract ============

contract QuadraticVotingTest is Test {
    // ============ Re-declare events for expectEmit ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        bytes32 ipfsHash,
        uint64 startTime,
        uint64 endTime
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 numVotes,
        uint256 tokenCost
    );
    event ProposalFinalized(uint256 indexed proposalId, IQuadraticVoting.ProposalState state);
    event TokensWithdrawn(uint256 indexed proposalId, address indexed voter, uint256 amount);

    // ============ State ============

    QuadraticVoting public qv;
    MockQVToken public jul;
    MockQVReputation public reputation;
    MockQVIdentity public identity;

    address public alice;
    address public bob;
    address public charlie;
    address public dave;
    address public owner;

    // ============ Constants ============

    uint256 constant INITIAL_BALANCE = 100_000 ether;
    uint256 constant PROPOSAL_THRESHOLD = 100 ether;

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");

        jul = new MockQVToken();
        reputation = new MockQVReputation();
        identity = new MockQVIdentity();

        vm.prank(owner);
        qv = new QuadraticVoting(
            address(jul),
            address(reputation),
            address(identity)
        );

        // Grant identities
        identity.grantIdentity(alice);
        identity.grantIdentity(bob);
        identity.grantIdentity(charlie);
        identity.grantIdentity(dave);

        // Set reputation tiers
        reputation.setTier(alice, 2);
        reputation.setTier(bob, 2);
        reputation.setTier(charlie, 2);
        reputation.setTier(dave, 1);

        // Fund actors
        jul.mint(alice, INITIAL_BALANCE);
        jul.mint(bob, INITIAL_BALANCE);
        jul.mint(charlie, INITIAL_BALANCE);
        jul.mint(dave, INITIAL_BALANCE);

        // Approve
        vm.prank(alice);
        jul.approve(address(qv), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(qv), type(uint256).max);
        vm.prank(charlie);
        jul.approve(address(qv), type(uint256).max);
        vm.prank(dave);
        jul.approve(address(qv), type(uint256).max);
    }

    // ============ Helpers ============

    function _createProposal() internal returns (uint256) {
        vm.prank(alice);
        return qv.createProposal("Test Proposal", bytes32("ipfs_hash"));
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(qv.owner(), owner);
    }

    function test_constructor_setsDeps() public view {
        assertEq(address(qv.julToken()), address(jul));
        assertEq(address(qv.reputationOracle()), address(reputation));
        assertEq(address(qv.soulboundIdentity()), address(identity));
        assertEq(qv.proposalThreshold(), PROPOSAL_THRESHOLD);
        assertEq(qv.quorumVotes(), 10);
        assertEq(qv.minProposerTier(), 1);
    }

    // ============ createProposal Tests ============

    function test_createProposal_happyPath() public {
        uint256 id = _createProposal();
        assertEq(id, 1);
        assertEq(qv.proposalCount(), 1);

        IQuadraticVoting.Proposal memory p = qv.getProposal(1);
        assertEq(p.proposer, alice);
        assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.ACTIVE));
        assertEq(p.forVotes, 0);
        assertEq(p.againstVotes, 0);
    }

    function test_createProposal_revertsWithoutIdentity() public {
        address noId = makeAddr("noId");
        jul.mint(noId, INITIAL_BALANCE);
        reputation.setTier(noId, 2);

        vm.prank(noId);
        vm.expectRevert(IQuadraticVoting.NoIdentity.selector);
        qv.createProposal("Fail", bytes32(0));
    }

    function test_createProposal_revertsLowReputation() public {
        address lowRep = makeAddr("lowRep");
        identity.grantIdentity(lowRep);
        reputation.setTier(lowRep, 0); // below minProposerTier
        jul.mint(lowRep, INITIAL_BALANCE);

        vm.prank(lowRep);
        vm.expectRevert(IQuadraticVoting.InsufficientReputation.selector);
        qv.createProposal("Fail", bytes32(0));
    }

    function test_createProposal_revertsBelowThreshold() public {
        address poor = makeAddr("poor");
        identity.grantIdentity(poor);
        reputation.setTier(poor, 2);
        jul.mint(poor, 10 ether); // below 100 JUL threshold

        vm.prank(poor);
        vm.expectRevert(IQuadraticVoting.BelowProposalThreshold.selector);
        qv.createProposal("Fail", bytes32(0));
    }

    // ============ castVote Tests ============

    function test_castVote_singleVoteCostsOne() public {
        uint256 id = _createProposal();

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        qv.castVote(id, true, 1);
        uint256 balAfter = jul.balanceOf(bob);

        // 1 vote costs 1^2 = 1 token
        assertEq(balBefore - balAfter, 1);

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(id, bob);
        assertEq(pos.votesFor, 1);
        assertEq(pos.tokensLocked, 1);
    }

    function test_castVote_multipleVotesCostNSquared() public {
        uint256 id = _createProposal();

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        qv.castVote(id, true, 5);
        uint256 balAfter = jul.balanceOf(bob);

        // 5 votes costs 5^2 = 25 tokens
        assertEq(balBefore - balAfter, 25);

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(id, bob);
        assertEq(pos.votesFor, 5);
        assertEq(pos.tokensLocked, 25);
    }

    function test_castVote_incrementalCostCorrect() public {
        uint256 id = _createProposal();

        // First: cast 3 votes (cost = 9)
        vm.prank(bob);
        qv.castVote(id, true, 3);
        assertEq(jul.balanceOf(bob), INITIAL_BALANCE - 9);

        // Then: cast 2 more votes (cost = (3+2)^2 - 3^2 = 25-9 = 16)
        vm.prank(bob);
        qv.castVote(id, true, 2);
        assertEq(jul.balanceOf(bob), INITIAL_BALANCE - 25);

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(id, bob);
        assertEq(pos.votesFor, 5);
        assertEq(pos.tokensLocked, 25);
    }

    function test_castVote_bothForAndAgainst() public {
        uint256 id = _createProposal();

        vm.startPrank(bob);
        qv.castVote(id, true, 3);   // 9 tokens for
        qv.castVote(id, false, 2);  // 4 tokens against
        vm.stopPrank();

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(id, bob);
        assertEq(pos.votesFor, 3);
        assertEq(pos.votesAgainst, 2);
        assertEq(pos.tokensLocked, 13); // 9 + 4

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);
        assertEq(p.forVotes, 3);
        assertEq(p.againstVotes, 2);
    }

    function test_castVote_revertsInsufficientTokens() public {
        uint256 id = _createProposal();

        address poor = makeAddr("poor_voter");
        identity.grantIdentity(poor);
        jul.mint(poor, 10); // Only 10 tokens
        vm.prank(poor);
        jul.approve(address(qv), type(uint256).max);

        // 4 votes cost 16 > 10 available
        vm.prank(poor);
        vm.expectRevert(); // SafeERC20 will revert
        qv.castVote(id, true, 4);
    }

    function test_castVote_revertsZeroVotes() public {
        uint256 id = _createProposal();

        vm.prank(bob);
        vm.expectRevert(IQuadraticVoting.ZeroVotes.selector);
        qv.castVote(id, true, 0);
    }

    function test_castVote_revertsAfterVotingEnds() public {
        uint256 id = _createProposal();

        // Warp past voting end
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(bob);
        vm.expectRevert(IQuadraticVoting.VotingEnded.selector);
        qv.castVote(id, true, 1);
    }

    // ============ finalizeProposal Tests ============

    function test_finalizeProposal_succeeds() public {
        uint256 id = _createProposal();

        // Cast enough votes for quorum (10 needed)
        vm.prank(bob);
        qv.castVote(id, true, 8);
        vm.prank(charlie);
        qv.castVote(id, true, 3);

        // Warp past end
        vm.warp(block.timestamp + 3 days + 1);

        qv.finalizeProposal(id);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);
        assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.SUCCEEDED));
    }

    function test_finalizeProposal_defeated() public {
        uint256 id = _createProposal();

        // More against than for
        vm.prank(bob);
        qv.castVote(id, true, 3);
        vm.prank(charlie);
        qv.castVote(id, false, 8);

        vm.warp(block.timestamp + 3 days + 1);

        qv.finalizeProposal(id);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);
        assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.DEFEATED));
    }

    function test_finalizeProposal_quorumNotMet() public {
        uint256 id = _createProposal();

        // Only 4 total votes (quorum = 10)
        vm.prank(bob);
        qv.castVote(id, true, 3);
        vm.prank(charlie);
        qv.castVote(id, false, 1);

        vm.warp(block.timestamp + 3 days + 1);

        qv.finalizeProposal(id);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);
        assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.DEFEATED));
    }

    function test_finalizeProposal_revertsBeforeEnd() public {
        uint256 id = _createProposal();

        vm.expectRevert(IQuadraticVoting.VotingNotEnded.selector);
        qv.finalizeProposal(id);
    }

    // ============ withdrawTokens Tests ============

    function test_withdrawTokens_afterFinalization() public {
        uint256 id = _createProposal();

        vm.prank(bob);
        qv.castVote(id, true, 5); // costs 25

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        qv.withdrawTokens(id);
        uint256 balAfter = jul.balanceOf(bob);

        assertEq(balAfter - balBefore, 25);
    }

    function test_withdrawTokens_revertsBeforeFinalization() public {
        uint256 id = _createProposal();

        vm.prank(bob);
        qv.castVote(id, true, 3);

        vm.prank(bob);
        vm.expectRevert(IQuadraticVoting.ProposalNotFinalized.selector);
        qv.withdrawTokens(id);
    }

    function test_withdrawTokens_revertsDoubleWithdraw() public {
        uint256 id = _createProposal();

        vm.prank(bob);
        qv.castVote(id, true, 3);

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        vm.prank(bob);
        qv.withdrawTokens(id);

        vm.prank(bob);
        vm.expectRevert(IQuadraticVoting.AlreadyWithdrawn.selector);
        qv.withdrawTokens(id);
    }

    function test_withdrawTokens_revertsNoTokens() public {
        uint256 id = _createProposal();

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        // Dave never voted
        vm.prank(dave);
        vm.expectRevert(IQuadraticVoting.NoTokensToWithdraw.selector);
        qv.withdrawTokens(id);
    }

    // ============ voteCost View ============

    function test_voteCost_returnsNSquared() public view {
        assertEq(qv.voteCost(0), 0);
        assertEq(qv.voteCost(1), 1);
        assertEq(qv.voteCost(5), 25);
        assertEq(qv.voteCost(10), 100);
        assertEq(qv.voteCost(100), 10000);
    }
}
