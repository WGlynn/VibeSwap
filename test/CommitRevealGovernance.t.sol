// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/CommitRevealGovernance.sol";

// ============ Mocks ============

contract MockCRGToken {
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

contract MockCRGReputation {
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

contract MockCRGIdentity {
    mapping(address => bool) public identities;

    function grantIdentity(address user) external {
        identities[user] = true;
    }

    function hasIdentity(address addr) external view returns (bool) {
        return identities[addr];
    }
}

// ============ Test Contract ============

contract CommitRevealGovernanceTest is Test {
    // ============ Re-declare events for expectEmit ============

    event VoteCreated(
        uint256 indexed voteId,
        address indexed proposer,
        string description,
        uint64 commitEnd,
        uint64 revealEnd
    );
    event VoteCommitted(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        uint256 deposit
    );
    event VoteRevealed(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        ICommitRevealGovernance.VoteChoice choice,
        uint256 weight
    );
    event VoteTallied(
        uint256 indexed voteId,
        uint256 forWeight,
        uint256 againstWeight,
        uint256 abstainWeight,
        bool passed
    );
    event UnrevealedSlashed(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        uint256 slashAmount
    );
    event VoteExecuted(uint256 indexed voteId);

    // ============ State ============

    CommitRevealGovernance public crg;
    MockCRGToken public jul;
    MockCRGReputation public reputation;
    MockCRGIdentity public identity;

    address public alice;
    address public bob;
    address public charlie;
    address public treasuryAddr;
    address public owner;

    // ============ Constants ============

    uint256 constant JUL_BALANCE = 10_000 ether;
    uint256 constant DEPOSIT = 0.01 ether;
    bytes32 constant SECRET = bytes32("secret123");

    // ============ setUp ============

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        treasuryAddr = makeAddr("treasury");

        jul = new MockCRGToken();
        reputation = new MockCRGReputation();
        identity = new MockCRGIdentity();

        vm.prank(owner);
        crg = new CommitRevealGovernance(
            address(jul),
            address(reputation),
            address(identity),
            treasuryAddr
        );

        // Grant identities
        identity.grantIdentity(alice);
        identity.grantIdentity(bob);
        identity.grantIdentity(charlie);

        // Set reputation
        reputation.setTier(alice, 2);
        reputation.setTier(bob, 2);
        reputation.setTier(charlie, 2);

        // Fund JUL for weight snapshots
        jul.mint(alice, JUL_BALANCE);
        jul.mint(bob, JUL_BALANCE);
        jul.mint(charlie, JUL_BALANCE);

        // Fund ETH for deposits
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);

        // Set quorum low for testing
        vm.prank(owner);
        crg.setQuorum(100 ether);
    }

    // ============ Helpers ============

    function _createVote() internal returns (uint256) {
        vm.prank(alice);
        return crg.createVote("Test Vote", bytes32("ipfs"));
    }

    function _computeHash(
        address voter,
        uint256 voteId,
        ICommitRevealGovernance.VoteChoice choice,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(voter, voteId, choice, secret));
    }

    function _commitFor(
        address voter,
        uint256 voteId,
        ICommitRevealGovernance.VoteChoice choice,
        bytes32 secret
    ) internal returns (bytes32) {
        bytes32 hash = _computeHash(voter, voteId, choice, secret);
        vm.prank(voter);
        return crg.commitVote{value: DEPOSIT}(voteId, hash);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(crg.owner(), owner);
    }

    function test_constructor_setsDeps() public view {
        assertEq(address(crg.julToken()), address(jul));
        assertEq(address(crg.reputationOracle()), address(reputation));
        assertEq(address(crg.soulboundIdentity()), address(identity));
        assertEq(crg.treasury(), treasuryAddr);
        assertEq(crg.slashRateBps(), 5000);
        assertEq(crg.defaultCommitDuration(), 2 days);
        assertEq(crg.defaultRevealDuration(), 1 days);
    }

    // ============ createVote Tests ============

    function test_createVote_happyPath() public {
        uint256 id = _createVote();
        assertEq(id, 1);
        assertEq(crg.voteCount(), 1);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(1);
        assertEq(v.proposer, alice);
        assertEq(uint8(v.phase), uint8(ICommitRevealGovernance.VotePhase.COMMIT));
        assertEq(v.commitCount, 0);
    }

    function test_createVote_revertsNoIdentity() public {
        address noId = makeAddr("noId");
        reputation.setTier(noId, 2);

        vm.prank(noId);
        vm.expectRevert(ICommitRevealGovernance.NoIdentity.selector);
        crg.createVote("Fail", bytes32(0));
    }

    function test_createVote_revertsLowReputation() public {
        address lowRep = makeAddr("lowRep");
        identity.grantIdentity(lowRep);
        reputation.setTier(lowRep, 0);

        vm.prank(lowRep);
        vm.expectRevert(ICommitRevealGovernance.InsufficientReputation.selector);
        crg.createVote("Fail", bytes32(0));
    }

    // ============ commitVote Tests ============

    function test_commitVote_happyPath() public {
        uint256 voteId = _createVote();
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        assertTrue(commitId != bytes32(0));

        ICommitRevealGovernance.VoteCommitment memory c = crg.getCommitment(commitId);
        assertEq(c.voter, bob);
        assertEq(c.deposit, DEPOSIT);
        assertEq(c.weight, JUL_BALANCE); // snapshot at commit time
        assertFalse(c.revealed);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(v.commitCount, 1);
    }

    function test_commitVote_revertsDuplicate() public {
        uint256 voteId = _createVote();
        _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        bytes32 hash = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.AGAINST, SECRET);
        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.AlreadyCommitted.selector);
        crg.commitVote{value: DEPOSIT}(voteId, hash);
    }

    function test_commitVote_revertsWrongPhase() public {
        uint256 voteId = _createVote();

        // Warp to reveal phase
        vm.warp(block.timestamp + 2 days + 1);

        bytes32 hash = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.WrongPhase.selector);
        crg.commitVote{value: DEPOSIT}(voteId, hash);
    }

    function test_commitVote_revertsInsufficientDeposit() public {
        uint256 voteId = _createVote();
        bytes32 hash = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.InsufficientDeposit.selector);
        crg.commitVote{value: 0.0001 ether}(voteId, hash);
    }

    // ============ revealVote Tests ============

    function test_revealVote_happyPath() public {
        uint256 voteId = _createVote();
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        // Warp to reveal phase
        vm.warp(block.timestamp + 2 days + 1);

        uint256 balBefore = bob.balance;
        vm.prank(bob);
        crg.revealVote(voteId, commitId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        uint256 balAfter = bob.balance;

        // Deposit refunded
        assertEq(balAfter - balBefore, DEPOSIT);

        ICommitRevealGovernance.VoteCommitment memory c = crg.getCommitment(commitId);
        assertTrue(c.revealed);
        assertEq(uint8(c.choice), uint8(ICommitRevealGovernance.VoteChoice.FOR));

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(v.forWeight, JUL_BALANCE);
        assertEq(v.revealCount, 1);
    }

    function test_revealVote_revertsWrongHash() public {
        uint256 voteId = _createVote();
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 2 days + 1);

        // Try revealing with wrong choice
        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.InvalidReveal.selector);
        crg.revealVote(voteId, commitId, ICommitRevealGovernance.VoteChoice.AGAINST, SECRET);
    }

    function test_revealVote_revertsWrongPhase() public {
        uint256 voteId = _createVote();
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        // Still in commit phase
        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.WrongPhase.selector);
        crg.revealVote(voteId, commitId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
    }

    function test_revealVote_revertsAlreadyRevealed() public {
        uint256 voteId = _createVote();
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(bob);
        crg.revealVote(voteId, commitId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.prank(bob);
        vm.expectRevert(ICommitRevealGovernance.AlreadyRevealed.selector);
        crg.revealVote(voteId, commitId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
    }

    // ============ tallyVotes Tests ============

    function test_tallyVotes_quorumMetPasses() public {
        uint256 voteId = _createVote();

        // Two voters commit FOR
        bytes32 c1 = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        bytes32 c2 = _commitFor(charlie, voteId, ICommitRevealGovernance.VoteChoice.FOR, bytes32("secret2"));

        // Reveal
        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(bob);
        crg.revealVote(voteId, c1, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        vm.prank(charlie);
        crg.revealVote(voteId, c2, ICommitRevealGovernance.VoteChoice.FOR, bytes32("secret2"));

        // Tally
        vm.warp(block.timestamp + 1 days + 1);
        crg.tallyVotes(voteId);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(uint8(v.phase), uint8(ICommitRevealGovernance.VotePhase.EXECUTED));
    }

    function test_tallyVotes_quorumNotMet() public {
        uint256 voteId = _createVote();

        // Set very high quorum
        vm.prank(owner);
        crg.setQuorum(1_000_000 ether);

        bytes32 c1 = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(bob);
        crg.revealVote(voteId, c1, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 1 days + 1);
        crg.tallyVotes(voteId);

        // Quorum not met, so phase stays at TALLY (not EXECUTED)
        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(uint8(v.phase), uint8(ICommitRevealGovernance.VotePhase.TALLY));
    }

    // ============ slashUnrevealed Tests ============

    function test_slashUnrevealed_happyPath() public {
        uint256 voteId = _createVote();

        // Bob commits but never reveals
        bytes32 commitId = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        // Warp past reveal phase
        vm.warp(block.timestamp + 3 days + 1);

        uint256 treasuryBefore = treasuryAddr.balance;
        uint256 bobBefore = bob.balance;

        crg.slashUnrevealed(voteId, commitId);

        uint256 slashAmount = (DEPOSIT * 5000) / 10000; // 50%
        uint256 refund = DEPOSIT - slashAmount;

        assertEq(treasuryAddr.balance - treasuryBefore, slashAmount);
        assertEq(bob.balance - bobBefore, refund);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(v.slashedDeposits, slashAmount);
    }

    // ============ executeVote Tests ============

    function test_executeVote_happyPath() public {
        uint256 voteId = _createVote();

        bytes32 c1 = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(bob);
        crg.revealVote(voteId, c1, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 1 days + 1);
        crg.tallyVotes(voteId);

        // Owner can execute
        vm.prank(owner);
        crg.executeVote(voteId);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertTrue(v.executed);
    }

    function test_executeVote_resolverCanExecute() public {
        uint256 voteId = _createVote();

        bytes32 c1 = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(bob);
        crg.revealVote(voteId, c1, ICommitRevealGovernance.VoteChoice.FOR, SECRET);

        vm.warp(block.timestamp + 1 days + 1);
        crg.tallyVotes(voteId);

        // Add resolver
        vm.prank(owner);
        crg.addResolver(charlie);

        vm.prank(charlie);
        crg.executeVote(voteId);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertTrue(v.executed);
    }

    function test_executeVote_revertsNotPassed() public {
        uint256 voteId = _createVote();

        // Warp past all phases, no votes
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(owner);
        vm.expectRevert(ICommitRevealGovernance.VoteNotPassed.selector);
        crg.executeVote(voteId);
    }

    // ============ Full Lifecycle Test ============

    function test_fullLifecycle() public {
        // 1. Create vote
        uint256 voteId = _createVote();

        // 2. Commits during commit phase
        bytes32 c1 = _commitFor(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        bytes32 c2 = _commitFor(charlie, voteId, ICommitRevealGovernance.VoteChoice.AGAINST, bytes32("charlie_secret"));

        // 3. Advance to reveal phase
        vm.warp(block.timestamp + 2 days + 1);

        // 4. Both reveal
        vm.prank(bob);
        crg.revealVote(voteId, c1, ICommitRevealGovernance.VoteChoice.FOR, SECRET);
        vm.prank(charlie);
        crg.revealVote(voteId, c2, ICommitRevealGovernance.VoteChoice.AGAINST, bytes32("charlie_secret"));

        // 5. Advance to tally
        vm.warp(block.timestamp + 1 days + 1);

        // 6. Tally
        crg.tallyVotes(voteId);

        // Both have equal weight — should NOT pass (for not > against)
        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);
        assertEq(v.forWeight, JUL_BALANCE);
        assertEq(v.againstWeight, JUL_BALANCE);
        // Tie: doesn't pass
        assertEq(uint8(v.phase), uint8(ICommitRevealGovernance.VotePhase.TALLY));
    }
}
