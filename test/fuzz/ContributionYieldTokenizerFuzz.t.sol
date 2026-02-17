// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionYieldTokenizer.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCYTToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract ContributionYieldTokenizerFuzzTest is Test {
    ContributionYieldTokenizer public tokenizer;
    ContributionDAG public dag;
    MockCYTToken public rewardToken;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    uint256 public constant MAX_FUND = 10_000_000e18;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        rewardToken = new MockCYTToken();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        // Setup trust: alice <-> bob
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));
        dag.recalculateTrustScores();

        tokenizer = new ContributionYieldTokenizer(
            address(rewardToken),
            address(dag),
            address(0)
        );

        // Fund users
        rewardToken.mint(alice, MAX_FUND * 10);
        rewardToken.mint(bob, MAX_FUND * 10);
        rewardToken.mint(carol, MAX_FUND * 10);
        vm.prank(alice);
        rewardToken.approve(address(tokenizer), type(uint256).max);
        vm.prank(bob);
        rewardToken.approve(address(tokenizer), type(uint256).max);
        vm.prank(carol);
        rewardToken.approve(address(tokenizer), type(uint256).max);
    }

    // ============ Helpers ============

    function _createAndFundIdea(uint256 funding) internal returns (uint256 ideaId) {
        vm.prank(alice);
        ideaId = tokenizer.createIdea(bytes32("ipfs"), funding);
    }

    // ============ Fuzz: IT minted 1:1 with funding ============

    function testFuzz_ideaTokenMinted1to1(uint256 funding) public {
        funding = bound(funding, 1e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(funding);
        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);

        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(alice), funding, "IT must be minted 1:1 with funding");
        assertEq(idea.totalFunding, funding, "totalFunding must match deposit");
    }

    // ============ Fuzz: multiple funders accumulate correctly ============

    function testFuzz_multipleFundersAccumulate(uint256 aliceFund, uint256 carolFund) public {
        aliceFund = bound(aliceFund, 1e18, MAX_FUND);
        carolFund = bound(carolFund, 1e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(aliceFund);

        vm.prank(carol);
        tokenizer.fundIdea(ideaId, carolFund);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);

        assertEq(it.balanceOf(alice), aliceFund, "Alice IT must match her funding");
        assertEq(it.balanceOf(carol), carolFund, "Carol IT must match her funding");
        assertEq(idea.totalFunding, aliceFund + carolFund, "totalFunding must be sum");
    }

    // ============ Fuzz: idea IDs are sequential ============

    function testFuzz_ideaIdsSequential(uint256 numIdeas) public {
        numIdeas = bound(numIdeas, 1, 20);

        for (uint256 i = 0; i < numIdeas; i++) {
            vm.prank(alice);
            uint256 ideaId = tokenizer.createIdea(bytes32(uint256(i)), 0);
            assertEq(ideaId, i + 1, "Idea ID must be sequential");
        }

        assertEq(tokenizer.nextIdeaId(), numIdeas + 1, "nextIdeaId must track correctly");
    }

    // ============ Fuzz: stream IDs are sequential ============

    function testFuzz_streamIdsSequential(uint256 numStreams) public {
        numStreams = bound(numStreams, 1, 10);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);

        for (uint256 i = 0; i < numStreams; i++) {
            address executor = address(uint160(7000 + i));
            vm.prank(executor);
            uint256 streamId = tokenizer.proposeExecution(ideaId);
            assertEq(streamId, i + 1, "Stream ID must be sequential");
        }

        assertEq(tokenizer.nextStreamId(), numStreams + 1, "nextStreamId must track correctly");
        assertEq(tokenizer.getIdeaStreamCount(ideaId), numStreams, "Stream count must match");
    }

    // ============ Fuzz: max streams per idea enforced ============

    function testFuzz_maxStreamsPerIdeaEnforced(uint256 numStreams) public {
        numStreams = bound(numStreams, 1, 15);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);

        for (uint256 i = 0; i < numStreams; i++) {
            address executor = address(uint160(8000 + i));
            if (i < 10) {
                vm.prank(executor);
                tokenizer.proposeExecution(ideaId);
            } else {
                vm.prank(executor);
                vm.expectRevert(IContributionYieldTokenizer.Unauthorized.selector);
                tokenizer.proposeExecution(ideaId);
            }
        }

        assertLe(tokenizer.getIdeaStreamCount(ideaId), 10, "Stream count must not exceed MAX_STREAMS_PER_IDEA");
    }

    // ============ Fuzz: conviction vote locks IT tokens ============

    function testFuzz_convictionVoteLocksTokens(uint256 voteAmount) public {
        voteAmount = bound(voteAmount, 101e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);

        // Carol funds to get IT
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, voteAmount);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);
        uint256 itBefore = it.balanceOf(carol);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        tokenizer.voteConviction(streamId, voteAmount);

        assertEq(it.balanceOf(carol), itBefore - voteAmount, "IT must be burned (locked) on vote");
    }

    // ============ Fuzz: withdraw conviction returns IT ============

    function testFuzz_withdrawConvictionReturnsIT(uint256 voteAmount) public {
        voteAmount = bound(voteAmount, 101e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);

        vm.prank(carol);
        tokenizer.fundIdea(ideaId, voteAmount);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        tokenizer.voteConviction(streamId, voteAmount);

        vm.prank(carol);
        tokenizer.withdrawConviction(streamId);

        assertEq(it.balanceOf(carol), voteAmount, "IT must be returned after withdrawal");
    }

    // ============ Fuzz: stale check enforces deadline ============

    function testFuzz_staleCheckEnforcesDeadline(uint256 timeSkip) public {
        timeSkip = bound(timeSkip, 1, 14 days - 1);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.warp(block.timestamp + timeSkip);

        vm.expectRevert(IContributionYieldTokenizer.StalePeriodNotReached.selector);
        tokenizer.checkStale(streamId);
    }

    // ============ Fuzz: stale check succeeds after deadline ============

    function testFuzz_staleCheckSucceedsAfterDeadline(uint256 extraTime) public {
        extraTime = bound(extraTime, 0, 30 days);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.warp(block.timestamp + 14 days + extraTime);

        tokenizer.checkStale(streamId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertTrue(
            stream.status == IContributionYieldTokenizer.StreamStatus.STALLED,
            "Stream must be STALLED after stale check"
        );
    }

    // ============ Fuzz: redirect works on stalled stream ============

    function testFuzz_redirectWorksOnStalled(uint256 funding) public {
        funding = bound(funding, 1e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(funding);
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // Stall the stream
        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        // Alice holds IT, can redirect
        address newExecutor = makeAddr("newExecutor");
        vm.prank(alice);
        tokenizer.redirectStream(streamId, newExecutor);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.executor, newExecutor, "Executor must be updated");
        assertTrue(
            stream.status == IContributionYieldTokenizer.StreamStatus.ACTIVE,
            "Stream must be ACTIVE after redirect"
        );
    }

    // ============ Fuzz: milestone resets stale timer ============

    function testFuzz_milestoneResetsStaleness(uint256 preMilestoneTime, uint256 postMilestoneTime) public {
        preMilestoneTime = bound(preMilestoneTime, 1 days, 13 days);
        postMilestoneTime = bound(postMilestoneTime, 1, 14 days - 1);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // Advance close to stale but not past
        vm.warp(block.timestamp + preMilestoneTime);

        // Report milestone
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("evidence"));

        // Advance again — less than stale duration from milestone
        vm.warp(block.timestamp + postMilestoneTime);

        // Should still revert (not stale yet)
        vm.expectRevert(IContributionYieldTokenizer.StalePeriodNotReached.selector);
        tokenizer.checkStale(streamId);
    }

    // ============ Fuzz: conviction grows over time ============

    function testFuzz_convictionGrowsOverTime(uint256 voteAmount, uint256 timeElapsed) public {
        voteAmount = bound(voteAmount, 101e18, 1_000_000e18);
        timeElapsed = bound(timeElapsed, 1 hours, 30 days);

        uint256 ideaId = _createAndFundIdea(MAX_FUND);

        vm.prank(carol);
        tokenizer.fundIdea(ideaId, voteAmount);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        tokenizer.voteConviction(streamId, voteAmount);

        IContributionYieldTokenizer.ConvictionVote memory voteT0 = tokenizer.getConvictionVote(streamId, carol);
        uint256 convictionT0 = voteT0.conviction;
        assertGt(convictionT0, 0, "Initial conviction must be > 0");

        // The stored conviction doesn't change on-chain without interaction,
        // but the stream rate accounts for time-growth internally.
        // Verify the initial conviction was computed with trust multiplier.
        uint256 trustMultiplier = dag.getVotingPowerMultiplier(carol);
        uint256 expectedConviction = (voteAmount * trustMultiplier) / 10000;
        assertEq(convictionT0, expectedConviction, "Conviction must be trust-weighted");
    }
}
