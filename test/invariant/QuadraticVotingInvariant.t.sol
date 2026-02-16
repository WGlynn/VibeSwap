// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/QuadraticVoting.sol";

// ============ Mocks ============

contract MockQVIToken {
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

contract MockQVIReputation {
    function getTrustScore(address) external pure returns (uint256) { return 200; }
    function getTrustTier(address) external pure returns (uint8) { return 2; }
    function isEligible(address, uint8) external pure returns (bool) { return true; }
}

contract MockQVIIdentity {
    function hasIdentity(address) external pure returns (bool) { return true; }
}

// ============ Handler ============

contract QVHandler is Test {
    QuadraticVoting public qv;
    MockQVIToken public jul;

    address[] public actors;
    uint256 public activeProposalId;

    // Ghost variables
    uint256 public ghost_totalLockedByVoters;
    mapping(address => uint256) public ghost_voterLocked;
    uint256 public ghost_totalForVotes;
    uint256 public ghost_totalAgainstVotes;
    uint256 public ghost_withdrawals;
    bool public ghost_finalized;

    constructor(QuadraticVoting _qv, MockQVIToken _jul, address[] memory _actors) {
        qv = _qv;
        jul = _jul;
        actors = _actors;
    }

    function setProposal(uint256 id) external {
        activeProposalId = id;
    }

    function castVoteFor(uint256 actorSeed, uint256 numVotes) public {
        if (ghost_finalized) return;
        if (activeProposalId == 0) return;

        address actor = actors[actorSeed % actors.length];
        numVotes = bound(numVotes, 1, 100);

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(activeProposalId, actor);
        uint256 existing = pos.votesFor;
        uint256 cost = (existing + numVotes) * (existing + numVotes) - existing * existing;

        if (jul.balanceOf(actor) < cost) return;

        vm.prank(actor);
        try qv.castVote(activeProposalId, true, numVotes) {
            ghost_totalLockedByVoters += cost;
            ghost_voterLocked[actor] += cost;
            ghost_totalForVotes += numVotes;
        } catch {}
    }

    function castVoteAgainst(uint256 actorSeed, uint256 numVotes) public {
        if (ghost_finalized) return;
        if (activeProposalId == 0) return;

        address actor = actors[actorSeed % actors.length];
        numVotes = bound(numVotes, 1, 100);

        IQuadraticVoting.VoterPosition memory pos = qv.getVoterPosition(activeProposalId, actor);
        uint256 existing = pos.votesAgainst;
        uint256 cost = (existing + numVotes) * (existing + numVotes) - existing * existing;

        if (jul.balanceOf(actor) < cost) return;

        vm.prank(actor);
        try qv.castVote(activeProposalId, false, numVotes) {
            ghost_totalLockedByVoters += cost;
            ghost_voterLocked[actor] += cost;
            ghost_totalAgainstVotes += numVotes;
        } catch {}
    }

    function finalizeProposal() public {
        if (ghost_finalized) return;
        if (activeProposalId == 0) return;

        IQuadraticVoting.Proposal memory p = qv.getProposal(activeProposalId);
        vm.warp(p.endTime + 1);

        try qv.finalizeProposal(activeProposalId) {
            ghost_finalized = true;
        } catch {}
    }

    function withdrawTokens(uint256 actorSeed) public {
        if (!ghost_finalized) return;
        if (activeProposalId == 0) return;

        address actor = actors[actorSeed % actors.length];

        vm.prank(actor);
        try qv.withdrawTokens(activeProposalId) {
            ghost_withdrawals += ghost_voterLocked[actor];
        } catch {}
    }
}

// ============ Invariant Tests ============

contract QuadraticVotingInvariantTest is StdInvariant, Test {
    QuadraticVoting public qv;
    MockQVIToken public jul;
    QVHandler public handler;

    address[] public actors;

    function setUp() public {
        jul = new MockQVIToken();
        MockQVIReputation rep = new MockQVIReputation();
        MockQVIIdentity id = new MockQVIIdentity();
        qv = new QuadraticVoting(address(jul), address(rep), address(id));

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(actor);
            jul.mint(actor, 1_000_000 ether);
            vm.prank(actor);
            jul.approve(address(qv), type(uint256).max);
        }

        // Create a proposal
        vm.prank(actors[0]);
        uint256 proposalId = qv.createProposal("Invariant Proposal", bytes32("ipfs"));

        handler = new QVHandler(qv, jul, actors);
        handler.setProposal(proposalId);

        targetContract(address(handler));
    }

    // ============ Invariant: total JUL in contract = sum of active positions ============

    function invariant_julBalanceMatchesLocked() public view {
        IQuadraticVoting.Proposal memory p = qv.getProposal(1);
        uint256 contractBalance = jul.balanceOf(address(qv));

        // Contract balance should be >= total locked (may be > if tokens sent directly)
        assertGe(
            contractBalance,
            p.totalTokensLocked - handler.ghost_withdrawals(),
            "ACCOUNTING VIOLATION: contract JUL < locked tokens"
        );
    }

    // ============ Invariant: proposal vote counts = sum of individual votes ============

    function invariant_voteCountsMatchGhost() public view {
        IQuadraticVoting.Proposal memory p = qv.getProposal(1);

        assertEq(
            p.forVotes,
            handler.ghost_totalForVotes(),
            "VOTE COUNT VIOLATION: forVotes mismatch"
        );
        assertEq(
            p.againstVotes,
            handler.ghost_totalAgainstVotes(),
            "VOTE COUNT VIOLATION: againstVotes mismatch"
        );
    }

    // ============ Invariant: no voter withdraws more than locked ============

    function invariant_noOverWithdrawal() public view {
        assertLe(
            handler.ghost_withdrawals(),
            handler.ghost_totalLockedByVoters(),
            "WITHDRAWAL VIOLATION: withdrew more than locked"
        );
    }

    // ============ Invariant: finalized proposals never change state ============

    function invariant_finalizedStateImmutable() public view {
        if (!handler.ghost_finalized()) return;

        IQuadraticVoting.Proposal memory p = qv.getProposal(1);
        assertTrue(
            p.state == IQuadraticVoting.ProposalState.SUCCEEDED ||
            p.state == IQuadraticVoting.ProposalState.DEFEATED ||
            p.state == IQuadraticVoting.ProposalState.EXECUTED ||
            p.state == IQuadraticVoting.ProposalState.EXPIRED,
            "STATE VIOLATION: finalized proposal in invalid state"
        );
    }

    // ============ Invariant: proposal count bounded ============

    function invariant_proposalCountBounded() public view {
        assertLe(qv.proposalCount(), 100, "Too many proposals created");
    }
}
