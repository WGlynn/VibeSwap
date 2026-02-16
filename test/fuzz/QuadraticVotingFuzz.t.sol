// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/QuadraticVoting.sol";

// ============ Mocks ============

contract MockQVFToken {
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

contract MockQVFReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockQVFIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Fuzz Tests ============

contract QuadraticVotingFuzzTest is Test {
    QuadraticVoting public qv;
    MockQVFToken public jul;

    address public alice;
    address public bob;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        jul = new MockQVFToken();
        MockQVFReputation rep = new MockQVFReputation();
        MockQVFIdentity id = new MockQVFIdentity();

        qv = new QuadraticVoting(address(jul), address(rep), address(id));

        // Fund with large balance
        jul.mint(alice, type(uint128).max);
        jul.mint(bob, type(uint128).max);
        vm.prank(alice);
        jul.approve(address(qv), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(qv), type(uint256).max);
    }

    function _createProposal() internal returns (uint256) {
        vm.prank(alice);
        return qv.createProposal("Fuzz Proposal", bytes32("ipfs"));
    }

    // ============ Fuzz: vote cost always = n^2 ============

    function testFuzz_voteCostAlwaysNSquared(uint256 n) public view {
        n = bound(n, 0, 1_000_000);
        assertEq(qv.voteCost(n), n * n, "Vote cost must equal n^2");
    }

    // ============ Fuzz: incremental cost correct for any M, K ============

    function testFuzz_incrementalCostCorrect(uint256 m, uint256 k) public {
        m = bound(m, 0, 10_000);
        k = bound(k, 1, 10_000);

        uint256 id = _createProposal();

        // Cast M votes first
        if (m > 0) {
            vm.prank(bob);
            qv.castVote(id, true, m);
        }

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        qv.castVote(id, true, k);
        uint256 balAfter = jul.balanceOf(bob);

        uint256 expectedCost = (m + k) * (m + k) - m * m;
        assertEq(balBefore - balAfter, expectedCost, "Incremental cost = (M+K)^2 - M^2");
    }

    // ============ Fuzz: total locked = sum of voter positions ============

    function testFuzz_totalLockedEqualsPositions(uint256 votes1, uint256 votes2) public {
        votes1 = bound(votes1, 1, 1000);
        votes2 = bound(votes2, 1, 1000);

        uint256 id = _createProposal();

        vm.prank(alice);
        qv.castVote(id, true, votes1);
        vm.prank(bob);
        qv.castVote(id, false, votes2);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);
        IQuadraticVoting.VoterPosition memory posA = qv.getVoterPosition(id, alice);
        IQuadraticVoting.VoterPosition memory posB = qv.getVoterPosition(id, bob);

        assertEq(
            p.totalTokensLocked,
            posA.tokensLocked + posB.tokensLocked,
            "Total locked must equal sum of positions"
        );
    }

    // ============ Fuzz: finalization deterministic for any vote distribution ============

    function testFuzz_finalizationDeterministic(uint256 forVotes, uint256 againstVotes) public {
        forVotes = bound(forVotes, 0, 500);
        againstVotes = bound(againstVotes, 0, 500);

        // Set quorum to 0 so any vote passes/fails based purely on majority
        vm.prank(qv.owner());
        qv.setQuorum(0);

        uint256 id = _createProposal();

        if (forVotes > 0) {
            vm.prank(alice);
            qv.castVote(id, true, forVotes);
        }
        if (againstVotes > 0) {
            vm.prank(bob);
            qv.castVote(id, false, againstVotes);
        }

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);

        if (forVotes > againstVotes) {
            assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.SUCCEEDED));
        } else {
            assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.DEFEATED));
        }
    }

    // ============ Fuzz: quorum enforcement ============

    function testFuzz_quorumEnforcement(uint256 forVotes, uint256 quorum) public {
        forVotes = bound(forVotes, 1, 500);
        quorum = bound(quorum, 1, 1000);

        vm.prank(qv.owner());
        qv.setQuorum(quorum);

        uint256 id = _createProposal();

        vm.prank(alice);
        qv.castVote(id, true, forVotes);

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        IQuadraticVoting.Proposal memory p = qv.getProposal(id);

        if (forVotes >= quorum) {
            assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.SUCCEEDED));
        } else {
            assertEq(uint8(p.state), uint8(IQuadraticVoting.ProposalState.DEFEATED));
        }
    }

    // ============ Fuzz: withdrawal returns exact locked amount ============

    function testFuzz_withdrawalExact(uint256 votes) public {
        votes = bound(votes, 1, 5000);

        uint256 id = _createProposal();

        vm.prank(bob);
        qv.castVote(id, true, votes);

        uint256 expectedLocked = votes * votes;

        vm.warp(block.timestamp + 3 days + 1);
        qv.finalizeProposal(id);

        uint256 balBefore = jul.balanceOf(bob);
        vm.prank(bob);
        qv.withdrawTokens(id);
        uint256 balAfter = jul.balanceOf(bob);

        assertEq(balAfter - balBefore, expectedLocked, "Withdrawal must return exact locked amount");
    }
}
