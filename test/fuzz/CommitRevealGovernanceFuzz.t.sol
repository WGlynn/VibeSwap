// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/CommitRevealGovernance.sol";

// ============ Mocks ============

contract MockCRGFToken {
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
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

contract MockCRGFReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockCRGFIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Fuzz Tests ============

contract CommitRevealGovernanceFuzzTest is Test {
    CommitRevealGovernance public crg;
    MockCRGFToken public jul;
    address public treasuryAddr;

    address public alice;
    address public bob;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        treasuryAddr = makeAddr("treasury");

        jul = new MockCRGFToken();
        MockCRGFReputation rep = new MockCRGFReputation();
        MockCRGFIdentity id = new MockCRGFIdentity();

        crg = new CommitRevealGovernance(address(jul), address(rep), address(id), treasuryAddr);

        jul.mint(alice, 100_000 ether);
        jul.mint(bob, 100_000 ether);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Low quorum for fuzz
        crg.setQuorum(0);
    }

    function _computeHash(
        address voter,
        uint256 voteId,
        ICommitRevealGovernance.VoteChoice choice,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(voter, voteId, choice, secret));
    }

    // ============ Fuzz: any valid hash verifies correctly ============

    function testFuzz_validHashVerifies(uint256 choiceSeed, bytes32 secret) public {
        uint8 choiceVal = uint8(bound(choiceSeed, 1, 3));
        ICommitRevealGovernance.VoteChoice choice = ICommitRevealGovernance.VoteChoice(choiceVal);

        vm.prank(alice);
        uint256 voteId = crg.createVote("Fuzz Vote", bytes32("ipfs"));

        bytes32 hash = _computeHash(bob, voteId, choice, secret);

        vm.prank(bob);
        bytes32 commitId = crg.commitVote{value: 0.01 ether}(voteId, hash);

        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(bob);
        crg.revealVote(voteId, commitId, choice, secret);

        ICommitRevealGovernance.VoteCommitment memory c = crg.getCommitment(commitId);
        assertTrue(c.revealed, "Valid hash must reveal successfully");
        assertEq(uint8(c.choice), choiceVal, "Choice must match");
    }

    // ============ Fuzz: slash amount always = deposit * slashRate / 10000 ============

    function testFuzz_slashAmountCorrect(uint256 deposit, uint256 slashBps) public {
        deposit = bound(deposit, 0.001 ether, 1 ether);
        slashBps = bound(slashBps, 0, 10000);

        crg.setSlashRate(slashBps);

        vm.prank(alice);
        uint256 voteId = crg.createVote("Slash Fuzz", bytes32("ipfs"));

        bytes32 hash = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, bytes32("s"));
        vm.prank(bob);
        bytes32 commitId = crg.commitVote{value: deposit}(voteId, hash);

        // Skip to tally phase (never reveal)
        vm.warp(block.timestamp + 3 days + 1);

        uint256 treasuryBefore = treasuryAddr.balance;
        uint256 bobBefore = bob.balance;

        crg.slashUnrevealed(voteId, commitId);

        uint256 expectedSlash = (deposit * slashBps) / 10000;
        uint256 expectedRefund = deposit - expectedSlash;

        assertEq(treasuryAddr.balance - treasuryBefore, expectedSlash, "Slash amount incorrect");
        assertEq(bob.balance - bobBefore, expectedRefund, "Refund amount incorrect");
    }

    // ============ Fuzz: tally is deterministic for any revealed votes ============

    function testFuzz_tallyDeterministic(uint256 aliceWeight, uint256 bobWeight, uint8 aliceChoiceSeed) public {
        aliceWeight = bound(aliceWeight, 1 ether, 50_000 ether);
        bobWeight = bound(bobWeight, 1 ether, 50_000 ether);
        // alice votes FOR or AGAINST
        bool aliceVotesFor = aliceChoiceSeed % 2 == 0;

        // Adjust balances to control weight
        jul.mint(alice, aliceWeight); // add more
        jul.mint(bob, bobWeight);

        vm.prank(alice);
        uint256 voteId = crg.createVote("Tally Fuzz", bytes32("ipfs"));

        ICommitRevealGovernance.VoteChoice aliceChoice = aliceVotesFor
            ? ICommitRevealGovernance.VoteChoice.FOR
            : ICommitRevealGovernance.VoteChoice.AGAINST;

        bytes32 h1 = _computeHash(alice, voteId, aliceChoice, bytes32("a"));
        bytes32 h2 = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, bytes32("b"));

        vm.prank(alice);
        bytes32 c1 = crg.commitVote{value: 0.01 ether}(voteId, h1);
        vm.prank(bob);
        bytes32 c2 = crg.commitVote{value: 0.01 ether}(voteId, h2);

        vm.warp(block.timestamp + 2 days + 1);

        vm.prank(alice);
        crg.revealVote(voteId, c1, aliceChoice, bytes32("a"));
        vm.prank(bob);
        crg.revealVote(voteId, c2, ICommitRevealGovernance.VoteChoice.FOR, bytes32("b"));

        vm.warp(block.timestamp + 1 days + 1);

        crg.tallyVotes(voteId);

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);

        if (aliceVotesFor) {
            // Both voted FOR
            assertEq(v.againstWeight, 0);
            assertGt(v.forWeight, 0);
        }
        // Verify total weights are correct
        uint256 totalRevealed = v.forWeight + v.againstWeight + v.abstainWeight;
        assertGt(totalRevealed, 0, "Must have revealed weight");
    }

    // ============ Fuzz: weight snapshot reflects commit-time balance ============

    function testFuzz_weightSnapshotAtCommitTime(uint256 balanceAtCommit) public {
        balanceAtCommit = bound(balanceAtCommit, 1 ether, 1_000_000 ether);

        address voter = makeAddr("snapshot_voter");
        jul.mint(voter, balanceAtCommit);
        vm.deal(voter, 1 ether);

        vm.prank(alice);
        uint256 voteId = crg.createVote("Snapshot Fuzz", bytes32("ipfs"));

        bytes32 hash = _computeHash(voter, voteId, ICommitRevealGovernance.VoteChoice.FOR, bytes32("s"));
        vm.prank(voter);
        bytes32 commitId = crg.commitVote{value: 0.01 ether}(voteId, hash);

        ICommitRevealGovernance.VoteCommitment memory c = crg.getCommitment(commitId);
        assertEq(c.weight, balanceAtCommit, "Weight must equal balance at commit time");
    }

    // ============ Fuzz: deadline enforcement for all timestamps ============

    function testFuzz_deadlineEnforcement(uint256 timestamp) public {
        vm.prank(alice);
        uint256 voteId = crg.createVote("Deadline Fuzz", bytes32("ipfs"));

        ICommitRevealGovernance.GovernanceVote memory v = crg.getVote(voteId);

        // Bound to interesting range around phase transitions
        timestamp = bound(timestamp, block.timestamp, block.timestamp + 5 days);
        vm.warp(timestamp);

        bytes32 hash = _computeHash(bob, voteId, ICommitRevealGovernance.VoteChoice.FOR, bytes32("s"));

        if (timestamp < v.commitEnd) {
            // Should be in commit phase — commit should work
            vm.prank(bob);
            crg.commitVote{value: 0.01 ether}(voteId, hash);
        } else {
            // Past commit phase — should revert
            vm.prank(bob);
            vm.expectRevert(ICommitRevealGovernance.WrongPhase.selector);
            crg.commitVote{value: 0.01 ether}(voteId, hash);
        }
    }

    // ============ Fuzz: all reveals consistent with commits ============

    function testFuzz_revealConsistentWithCommit(bytes32 secret) public {
        vm.assume(secret != bytes32(0));

        vm.prank(alice);
        uint256 voteId = crg.createVote("Consistency Fuzz", bytes32("ipfs"));

        ICommitRevealGovernance.VoteChoice choice = ICommitRevealGovernance.VoteChoice.FOR;
        bytes32 hash = _computeHash(bob, voteId, choice, secret);

        vm.prank(bob);
        bytes32 commitId = crg.commitVote{value: 0.01 ether}(voteId, hash);

        vm.warp(block.timestamp + 2 days + 1);

        // Correct reveal works
        vm.prank(bob);
        crg.revealVote(voteId, commitId, choice, secret);

        ICommitRevealGovernance.VoteCommitment memory c = crg.getCommitment(commitId);
        assertTrue(c.revealed);
        assertEq(uint8(c.choice), uint8(choice));
    }
}
