// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionYieldTokenizer.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCYTToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract ContributionYieldTokenizerFuzzTest is Test {
    ContributionYieldTokenizer public tokenizer;
    MockCYTToken public rewardToken;

    address public alice;
    address public bob;
    address public carol;

    uint256 public constant MAX_FUND = 10_000_000e18;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        rewardToken = new MockCYTToken();

        tokenizer = new ContributionYieldTokenizer(
            address(rewardToken),
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

    // ============ Fuzz: stream auto-flows with funding ============

    function testFuzz_streamAutoFlows(uint256 funding) public {
        funding = bound(funding, 1e18, MAX_FUND);

        uint256 ideaId = _createAndFundIdea(funding);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        uint256 expectedRate = funding / 30 days;
        assertEq(stream.streamRate, expectedRate, "Stream rate must be funding / 30 days");
    }

    // ============ Fuzz: equal split among multiple streams ============

    function testFuzz_equalSplitAmongStreams(uint256 funding, uint256 numStreams) public {
        funding = bound(funding, 1e18, MAX_FUND);
        numStreams = bound(numStreams, 1, 10);

        uint256 ideaId = _createAndFundIdea(funding);

        uint256[] memory sIds = new uint256[](numStreams);
        for (uint256 i = 0; i < numStreams; i++) {
            address executor = address(uint160(9000 + i));
            vm.prank(executor);
            sIds[i] = tokenizer.proposeExecution(ideaId);
        }

        // All streams should have equal rates
        uint256 expectedRate = funding / numStreams / 30 days;
        for (uint256 i = 0; i < numStreams; i++) {
            assertEq(tokenizer.getStreamRate(sIds[i]), expectedRate, "All streams must have equal rate");
        }
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

    // ============ Fuzz: claim capped at total funding ============

    function testFuzz_claimCappedAtFunding(uint256 funding, uint256 timeElapsed) public {
        funding = bound(funding, 1e18, MAX_FUND);
        timeElapsed = bound(timeElapsed, 1 days, 365 days);

        uint256 ideaId = _createAndFundIdea(funding);
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        vm.warp(block.timestamp + timeElapsed);

        uint256 pending = tokenizer.pendingStreamAmount(streamId);
        assertLe(pending, funding, "Pending must never exceed total funding");
    }
}
