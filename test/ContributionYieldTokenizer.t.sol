// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/identity/ContributionYieldTokenizer.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockRewardToken2 is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Contract ============

contract ContributionYieldTokenizerTest is Test {
    // Re-declare events for expectEmit (Solidity 0.8.20)
    event IdeaCreated(uint256 indexed ideaId, address indexed creator, address ideaToken, bytes32 contentHash);
    event IdeasMerged(uint256 indexed sourceIdeaId, uint256 indexed targetIdeaId, address indexed merger, uint256 fundingTransferred, uint256 mergerBounty);
    ContributionYieldTokenizer public tokenizer;
    MockRewardToken2 public rewardToken;

    address public owner;
    address public alice; // idea creator, funder
    address public bob;   // executor
    address public carol; // funder
    address public dave;  // redirect candidate

    uint256 public constant FUND_AMOUNT = 10_000e18;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");

        rewardToken = new MockRewardToken2();

        // Deploy tokenizer (rewardLedger = address(0) for unit tests)
        tokenizer = new ContributionYieldTokenizer(
            address(rewardToken),
            address(0) // rewardLedger
        );

        // Fund alice with reward tokens
        rewardToken.mint(alice, FUND_AMOUNT * 10);
        vm.prank(alice);
        rewardToken.approve(address(tokenizer), type(uint256).max);

        // Fund carol too
        rewardToken.mint(carol, FUND_AMOUNT * 10);
        vm.prank(carol);
        rewardToken.approve(address(tokenizer), type(uint256).max);
    }

    // ============ Helpers ============

    uint256 private _hashNonce;

    function _createAndFundIdea(uint256 funding) internal returns (uint256 ideaId) {
        bytes32 hash = keccak256(abi.encodePacked("ipfs_hash", _hashNonce++));
        vm.prank(alice);
        ideaId = tokenizer.createIdea(hash, funding);
    }

    function _createIdeaAndStream() internal returns (uint256 ideaId, uint256 streamId) {
        ideaId = _createAndFundIdea(FUND_AMOUNT);
        vm.prank(bob);
        streamId = tokenizer.proposeExecution(ideaId);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(address(tokenizer.rewardToken()), address(rewardToken));
        assertEq(tokenizer.nextIdeaId(), 1);
        assertEq(tokenizer.nextStreamId(), 1);
    }

    function test_constructor_zeroRewardToken_reverts() public {
        vm.expectRevert(IContributionYieldTokenizer.ZeroAddress.selector);
        new ContributionYieldTokenizer(address(0), address(0));
    }

    // ============ Idea Creation Tests ============

    function test_createIdea_noFunding() public {
        vm.prank(alice);
        uint256 ideaId = tokenizer.createIdea(bytes32("ipfs"), 0);

        assertEq(ideaId, 1);
        assertEq(tokenizer.nextIdeaId(), 2);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        assertEq(idea.creator, alice);
        assertEq(idea.contentHash, bytes32("ipfs"));
        assertEq(idea.totalFunding, 0);
        assertTrue(idea.ideaToken != address(0));
    }

    function test_createIdea_withFunding_mintsIT() public {
        uint256 ideaId = _createAndFundIdea(1000e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        assertEq(idea.totalFunding, 1000e18);

        // Alice should have IT tokens
        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(alice), 1000e18);
        assertEq(it.totalSupply(), 1000e18);
    }

    function test_createIdea_transfersRewardTokens() public {
        uint256 balBefore = rewardToken.balanceOf(alice);
        _createAndFundIdea(1000e18);
        assertEq(balBefore - rewardToken.balanceOf(alice), 1000e18);
        assertEq(rewardToken.balanceOf(address(tokenizer)), 1000e18);
    }

    function test_createIdea_emitsEvents() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit IdeaCreated(1, alice, address(0), bytes32("h")); // ideaToken addr unknown
        tokenizer.createIdea(bytes32("h"), 0);
    }

    // ============ Fund Idea Tests ============

    function test_fundIdea_success() public {
        uint256 ideaId = _createAndFundIdea(0);

        vm.prank(alice);
        tokenizer.fundIdea(ideaId, 500e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        assertEq(idea.totalFunding, 500e18);

        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(alice), 500e18);
    }

    function test_fundIdea_multipleFunders() public {
        uint256 ideaId = _createAndFundIdea(500e18);

        vm.prank(carol);
        tokenizer.fundIdea(ideaId, 300e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        assertEq(idea.totalFunding, 800e18);

        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(alice), 500e18);
        assertEq(it.balanceOf(carol), 300e18);
    }

    function test_fundIdea_notFound_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaNotFound.selector);
        tokenizer.fundIdea(999, 100e18);
    }

    function test_fundIdea_zeroAmount_reverts() public {
        uint256 ideaId = _createAndFundIdea(0);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.ZeroAmount.selector);
        tokenizer.fundIdea(ideaId, 0);
    }

    // ============ Execution Stream Tests ============

    function test_proposeExecution_success() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        assertEq(streamId, 1);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.ideaId, ideaId);
        assertEq(stream.executor, bob);
        assertGt(stream.streamRate, 0); // auto-starts flowing
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.ACTIVE));
    }

    function test_proposeExecution_autoFlows() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);

        // Rate = FUND_AMOUNT / 1 active stream / 30 days
        uint256 expectedRate = FUND_AMOUNT / 30 days;
        assertEq(stream.streamRate, expectedRate);
    }

    function test_proposeExecution_notFound_reverts() public {
        vm.prank(bob);
        vm.expectRevert(IContributionYieldTokenizer.IdeaNotFound.selector);
        tokenizer.proposeExecution(999);
    }

    function test_proposeExecution_multipleStreamsPerIdea() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        tokenizer.proposeExecution(ideaId);

        assertEq(tokenizer.getIdeaStreamCount(ideaId), 2);

        uint256[] memory streams = tokenizer.getIdeaStreams(ideaId);
        assertEq(streams.length, 2);
    }

    function test_proposeExecution_equalSplit() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        uint256 stream1 = tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        uint256 stream2 = tokenizer.proposeExecution(ideaId);

        IContributionYieldTokenizer.ExecutionStream memory s1 = tokenizer.getStream(stream1);
        IContributionYieldTokenizer.ExecutionStream memory s2 = tokenizer.getStream(stream2);

        // Both should have equal rates = FUND_AMOUNT / 2 / 30 days
        uint256 expectedRate = FUND_AMOUNT / 2 / 30 days;
        assertEq(s1.streamRate, expectedRate);
        assertEq(s2.streamRate, expectedRate);
    }

    function test_proposeExecution_noFunding_zeroRate() public {
        uint256 ideaId = _createAndFundIdea(0); // no funding

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.streamRate, 0);
    }

    // ============ Stream Claim Tests ============

    function test_claimStream_afterTimeElapsed() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // Advance 10 days
        vm.warp(block.timestamp + 10 days);

        uint256 pending = tokenizer.pendingStreamAmount(streamId);
        assertGt(pending, 0);

        uint256 bobBalBefore = rewardToken.balanceOf(bob);
        vm.prank(bob);
        tokenizer.claimStream(streamId);

        assertEq(rewardToken.balanceOf(bob) - bobBalBefore, pending);
    }

    function test_claimStream_nothingToClaim_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // No time elapsed
        vm.prank(bob);
        vm.expectRevert(IContributionYieldTokenizer.NothingToClaim.selector);
        tokenizer.claimStream(streamId);
    }

    function test_claimStream_notExecutor_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(alice); // not executor
        vm.expectRevert(IContributionYieldTokenizer.NotExecutor.selector);
        tokenizer.claimStream(streamId);
    }

    function test_claimStream_cappedAtFunding() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // Advance way past 30 days
        vm.warp(block.timestamp + 365 days);

        uint256 pending = tokenizer.pendingStreamAmount(streamId);
        // Should be capped at total funding
        assertLe(pending, FUND_AMOUNT);
    }

    // ============ Milestone Tests ============

    function test_reportMilestone_success() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.warp(block.timestamp + 1 days);

        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("evidence1"));

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.lastMilestone, block.timestamp);
    }

    function test_reportMilestone_notExecutor_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(alice); // not the executor
        vm.expectRevert(IContributionYieldTokenizer.NotExecutor.selector);
        tokenizer.reportMilestone(streamId, bytes32("evidence"));
    }

    function test_reportMilestone_streamNotFound_reverts() public {
        vm.prank(bob);
        vm.expectRevert(IContributionYieldTokenizer.StreamNotFound.selector);
        tokenizer.reportMilestone(999, bytes32("evidence"));
    }

    // ============ Stale Check Tests ============

    function test_checkStale_afterStaleDuration() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // Warp past stale duration (14 days)
        vm.warp(block.timestamp + 15 days);

        tokenizer.checkStale(streamId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.STALLED));
        assertEq(stream.streamRate, 0);
    }

    function test_checkStale_beforeStaleDuration_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.warp(block.timestamp + 7 days); // only 7 of 14 days

        vm.expectRevert(IContributionYieldTokenizer.StalePeriodNotReached.selector);
        tokenizer.checkStale(streamId);
    }

    function test_checkStale_afterMilestoneResetsTimer() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // 10 days pass
        vm.warp(block.timestamp + 10 days);

        // Executor reports milestone (resets timer)
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("progress"));

        // 10 more days pass (only 10 since last milestone, < 14)
        vm.warp(block.timestamp + 10 days);

        vm.expectRevert(IContributionYieldTokenizer.StalePeriodNotReached.selector);
        tokenizer.checkStale(streamId);
    }

    // ============ Redirect Stream Tests ============

    function test_redirectStream_success() public {
        (, uint256 streamId) = _createIdeaAndStream();

        // Stale the stream
        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        // Alice (IT holder from initial funding) redirects to dave
        vm.prank(alice);
        tokenizer.redirectStream(streamId, dave);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.executor, dave);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.ACTIVE));
        assertGt(stream.streamRate, 0); // rate restored
    }

    function test_redirectStream_notStalled_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.StreamStillActive.selector);
        tokenizer.redirectStream(streamId, dave);
    }

    function test_redirectStream_noITTokens_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        // Dave has no IT
        vm.prank(dave);
        vm.expectRevert(IContributionYieldTokenizer.NotIdeaTokenHolder.selector);
        tokenizer.redirectStream(streamId, alice);
    }

    function test_redirectStream_zeroAddress_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.ZeroAddress.selector);
        tokenizer.redirectStream(streamId, address(0));
    }

    // ============ Complete Stream Tests ============

    function test_completeStream_byExecutor() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(bob);
        tokenizer.completeStream(streamId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.COMPLETED));
        assertEq(stream.streamRate, 0);
    }

    function test_completeStream_byOwner() public {
        (, uint256 streamId) = _createIdeaAndStream();

        tokenizer.completeStream(streamId); // owner (address(this))

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.COMPLETED));
    }

    function test_completeStream_notExecutorOrOwner_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(carol);
        vm.expectRevert(IContributionYieldTokenizer.NotExecutor.selector);
        tokenizer.completeStream(streamId);
    }

    function test_completeStream_alreadyCompleted_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(bob);
        tokenizer.completeStream(streamId);

        vm.prank(bob);
        vm.expectRevert(IContributionYieldTokenizer.StreamNotActive.selector);
        tokenizer.completeStream(streamId);
    }

    function test_completeStream_redistributesRate() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        uint256 stream1 = tokenizer.proposeExecution(ideaId);
        vm.prank(carol);
        uint256 stream2 = tokenizer.proposeExecution(ideaId);

        // Both get half the rate
        uint256 halfRate = FUND_AMOUNT / 2 / 30 days;
        assertEq(tokenizer.getStreamRate(stream1), halfRate);
        assertEq(tokenizer.getStreamRate(stream2), halfRate);

        // Complete stream 1 — stream 2 should get the full rate
        vm.prank(bob);
        tokenizer.completeStream(stream1);

        uint256 fullRate = FUND_AMOUNT / 30 days;
        assertEq(tokenizer.getStreamRate(stream2), fullRate);
    }

    // ============ View Function Tests ============

    function test_pendingStreamAmount_grows() public {
        (, uint256 streamId) = _createIdeaAndStream();
        uint256 startTime = block.timestamp;

        assertEq(tokenizer.pendingStreamAmount(streamId), 0);

        vm.warp(startTime + 1 days);
        uint256 pending1 = tokenizer.pendingStreamAmount(streamId);
        assertGt(pending1, 0);

        vm.warp(startTime + 2 days);
        uint256 pending2 = tokenizer.pendingStreamAmount(streamId);
        assertGt(pending2, pending1);
    }

    function test_getIdeaStreamCount_empty() public {
        uint256 ideaId = _createAndFundIdea(0);
        assertEq(tokenizer.getIdeaStreamCount(ideaId), 0);
    }

    // ============ IdeaToken Tests ============

    function test_ideaToken_transferable() public {
        uint256 ideaId = _createAndFundIdea(1000e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);

        // Alice transfers IT to dave
        vm.prank(alice);
        it.transfer(dave, 400e18);

        assertEq(it.balanceOf(alice), 600e18);
        assertEq(it.balanceOf(dave), 400e18);
    }

    function test_ideaToken_onlyTokenizerCanMint() public {
        uint256 ideaId = _createAndFundIdea(100e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);

        vm.prank(alice);
        vm.expectRevert("Only tokenizer");
        it.mint(alice, 100e18);
    }

    function test_ideaToken_onlyTokenizerCanBurn() public {
        uint256 ideaId = _createAndFundIdea(100e18);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);

        vm.prank(alice);
        vm.expectRevert("Only tokenizer");
        it.burn(alice, 50e18);
    }

    // ============ Admin Tests ============

    function test_setRewardLedger_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        tokenizer.setRewardLedger(address(1));
    }

    // ============ Integration Flow Test ============

    function test_fullFlow_createIdea_fund_propose_milestone_claim_complete() public {
        // 1. Alice creates and funds an idea
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        // 2. Carol also funds the idea
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, 2000e18);

        // 3. Bob proposes to execute — stream auto-starts
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // 4. Stream should have a rate immediately
        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertGt(stream.streamRate, 0);

        // 5. Time passes, bob reports milestones
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("milestone1"));

        // 6. Bob claims earnings
        uint256 bobBalBefore = rewardToken.balanceOf(bob);
        vm.prank(bob);
        tokenizer.claimStream(streamId);
        assertGt(rewardToken.balanceOf(bob), bobBalBefore);

        // 7. More time passes
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("milestone2"));

        // 8. Bob completes the stream
        vm.prank(bob);
        tokenizer.completeStream(streamId);

        stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.COMPLETED));
    }

    // ============ ContentHash Uniqueness Tests ============

    function test_createIdea_duplicateContentHash_reverts() public {
        vm.prank(alice);
        tokenizer.createIdea(bytes32("unique_hash"), 0);

        // Same contentHash should revert
        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.DuplicateContentHash.selector);
        tokenizer.createIdea(bytes32("unique_hash"), 0);
    }

    function test_createIdea_duplicateContentHash_differentCreator_reverts() public {
        vm.prank(alice);
        tokenizer.createIdea(bytes32("shared_hash"), 0);

        // Even a different creator can't use the same hash
        vm.prank(carol);
        vm.expectRevert(IContributionYieldTokenizer.DuplicateContentHash.selector);
        tokenizer.createIdea(bytes32("shared_hash"), 0);
    }

    function test_contentHashToIdeaId_mapping() public {
        vm.prank(alice);
        uint256 ideaId = tokenizer.createIdea(bytes32("lookup_hash"), 0);

        assertEq(tokenizer.contentHashToIdeaId(bytes32("lookup_hash")), ideaId);
        assertEq(tokenizer.contentHashToIdeaId(bytes32("nonexistent")), 0);
    }

    function test_createIdea_differentHashes_succeed() public {
        vm.prank(alice);
        uint256 id1 = tokenizer.createIdea(bytes32("hash_a"), 0);

        vm.prank(alice);
        uint256 id2 = tokenizer.createIdea(bytes32("hash_b"), 0);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(tokenizer.contentHashToIdeaId(bytes32("hash_a")), 1);
        assertEq(tokenizer.contentHashToIdeaId(bytes32("hash_b")), 2);
    }

    // ============ Merge Tests ============

    function _createTwoIdeas() internal returns (uint256 sourceId, uint256 targetId) {
        vm.prank(alice);
        sourceId = tokenizer.createIdea(bytes32("source_idea"), FUND_AMOUNT);

        vm.prank(alice);
        targetId = tokenizer.createIdea(bytes32("target_idea"), FUND_AMOUNT);
    }

    function test_mergeIdeas_success() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        IContributionYieldTokenizer.Idea memory targetBefore = tokenizer.getIdea(targetId);
        uint256 aliceBalBefore = rewardToken.balanceOf(alice);

        // Alice holds source IT, so she can merge
        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Source is now MERGED
        IContributionYieldTokenizer.Idea memory source = tokenizer.getIdea(sourceId);
        assertEq(uint256(source.status), uint256(IContributionYieldTokenizer.IdeaStatus.MERGED));

        // mergedInto pointer set
        assertEq(tokenizer.mergedInto(sourceId), targetId);

        // Target received funding (minus 1% bounty)
        IContributionYieldTokenizer.Idea memory target = tokenizer.getIdea(targetId);
        uint256 bounty = (FUND_AMOUNT * 100) / 10000; // 1%
        uint256 transferred = FUND_AMOUNT - bounty;
        assertEq(target.totalFunding, targetBefore.totalFunding + transferred);

        // Alice received the bounty
        assertEq(rewardToken.balanceOf(alice) - aliceBalBefore, bounty);
    }

    function test_mergeIdeas_haltsSourceStreams() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        // Bob proposes execution on source
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(sourceId);

        IContributionYieldTokenizer.ExecutionStream memory streamBefore = tokenizer.getStream(streamId);
        assertEq(uint256(streamBefore.status), uint256(IContributionYieldTokenizer.StreamStatus.ACTIVE));

        // Merge
        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Stream should be stalled
        IContributionYieldTokenizer.ExecutionStream memory streamAfter = tokenizer.getStream(streamId);
        assertEq(uint256(streamAfter.status), uint256(IContributionYieldTokenizer.StreamStatus.STALLED));
        assertEq(streamAfter.streamRate, 0);
    }

    function test_mergeIdeas_afterStreaming_transfersRemaining() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        // Bob executes, streams for 10 days
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(sourceId);
        vm.warp(block.timestamp + 10 days);

        // Claim what's streamed
        vm.prank(bob);
        tokenizer.claimStream(streamId);
        uint256 bobEarned = rewardToken.balanceOf(bob);
        assertGt(bobEarned, 0);

        // Now merge — only remaining funding transfers
        IContributionYieldTokenizer.Idea memory targetBefore = tokenizer.getIdea(targetId);
        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        IContributionYieldTokenizer.Idea memory target = tokenizer.getIdea(targetId);
        uint256 remainingFunding = FUND_AMOUNT - bobEarned;
        uint256 bounty = (remainingFunding * 100) / 10000;
        uint256 transferred = remainingFunding - bounty;
        // Allow 1 wei rounding tolerance
        assertApproxEqAbs(target.totalFunding - targetBefore.totalFunding, transferred, 1);
    }

    function test_mergeIdeas_selfMerge_reverts() public {
        vm.prank(alice);
        uint256 ideaId = tokenizer.createIdea(bytes32("self_merge"), FUND_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.CannotMergeSelf.selector);
        tokenizer.mergeIdeas(ideaId, ideaId);
    }

    function test_mergeIdeas_sourceAlreadyMerged_reverts() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Try to merge the already-merged source again
        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaAlreadyMerged.selector);
        tokenizer.mergeIdeas(sourceId, targetId);
    }

    function test_mergeIdeas_targetAlreadyMerged_reverts() public {
        vm.prank(alice);
        uint256 id1 = tokenizer.createIdea(bytes32("idea_1"), FUND_AMOUNT);
        vm.prank(alice);
        uint256 id2 = tokenizer.createIdea(bytes32("idea_2"), FUND_AMOUNT);
        vm.prank(alice);
        uint256 id3 = tokenizer.createIdea(bytes32("idea_3"), FUND_AMOUNT);

        // Merge id2 into id3
        vm.prank(alice);
        tokenizer.mergeIdeas(id2, id3);

        // Can't merge into id2 since it's MERGED
        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaAlreadyMerged.selector);
        tokenizer.mergeIdeas(id1, id2);
    }

    function test_mergeIdeas_notHolder_reverts() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        // Bob has no source IT
        vm.prank(bob);
        vm.expectRevert(IContributionYieldTokenizer.NotIdeaTokenHolderForMerge.selector);
        tokenizer.mergeIdeas(sourceId, targetId);
    }

    function test_mergeIdeas_sourceNotFound_reverts() public {
        vm.prank(alice);
        uint256 targetId = tokenizer.createIdea(bytes32("target_only"), 0);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaNotFound.selector);
        tokenizer.mergeIdeas(999, targetId);
    }

    function test_mergeIdeas_targetNotFound_reverts() public {
        vm.prank(alice);
        uint256 sourceId = tokenizer.createIdea(bytes32("source_only"), FUND_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaNotFound.selector);
        tokenizer.mergeIdeas(sourceId, 999);
    }

    function test_mergeIdeas_noFunding_noRevert() public {
        // Source has zero funding — should still merge cleanly
        vm.prank(alice);
        uint256 sourceId = tokenizer.createIdea(bytes32("empty_source"), 0);
        vm.prank(alice);
        uint256 targetId = tokenizer.createIdea(bytes32("empty_target"), 0);

        // Alice needs source IT to merge — but with 0 funding, she has 0 IT
        // This should revert because she's not a holder
        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.NotIdeaTokenHolderForMerge.selector);
        tokenizer.mergeIdeas(sourceId, targetId);
    }

    function test_mergeIdeas_emitsEvent() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        uint256 bounty = (FUND_AMOUNT * 100) / 10000;
        uint256 transferred = FUND_AMOUNT - bounty;

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit IdeasMerged(sourceId, targetId, alice, transferred, bounty);
        tokenizer.mergeIdeas(sourceId, targetId);
    }

    // ============ Claim Merge Tests ============

    function test_claimMerge_swapsTokens1to1() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        IContributionYieldTokenizer.Idea memory source = tokenizer.getIdea(sourceId);
        IContributionYieldTokenizer.Idea memory target = tokenizer.getIdea(targetId);
        IdeaToken sourceIT = IdeaToken(source.ideaToken);
        IdeaToken targetIT = IdeaToken(target.ideaToken);

        uint256 aliceSourceBal = sourceIT.balanceOf(alice);
        assertEq(aliceSourceBal, FUND_AMOUNT);

        // Merge
        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Alice swaps her source IT for target IT
        uint256 swapAmount = 5000e18;
        vm.prank(alice);
        tokenizer.claimMerge(sourceId, swapAmount);

        assertEq(sourceIT.balanceOf(alice), aliceSourceBal - swapAmount);
        // Alice had FUND_AMOUNT target IT from initial funding, plus swapAmount from merge
        assertEq(targetIT.balanceOf(alice), FUND_AMOUNT + swapAmount);
    }

    function test_claimMerge_fullSwap() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        IContributionYieldTokenizer.Idea memory source = tokenizer.getIdea(sourceId);
        IdeaToken sourceIT = IdeaToken(source.ideaToken);

        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Swap entire balance
        uint256 fullBal = sourceIT.balanceOf(alice);
        vm.prank(alice);
        tokenizer.claimMerge(sourceId, fullBal);

        assertEq(sourceIT.balanceOf(alice), 0);
    }

    function test_claimMerge_notMerged_reverts() public {
        vm.prank(alice);
        uint256 ideaId = tokenizer.createIdea(bytes32("not_merged"), FUND_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.IdeaNotFound.selector);
        tokenizer.claimMerge(ideaId, 100e18);
    }

    function test_claimMerge_zeroAmount_reverts() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.ZeroAmount.selector);
        tokenizer.claimMerge(sourceId, 0);
    }

    function test_claimMerge_multipleHolders() public {
        (uint256 sourceId, uint256 targetId) = _createTwoIdeas();

        // Carol also funds the source idea
        vm.prank(carol);
        tokenizer.fundIdea(sourceId, 2000e18);

        IContributionYieldTokenizer.Idea memory source = tokenizer.getIdea(sourceId);
        IContributionYieldTokenizer.Idea memory target = tokenizer.getIdea(targetId);
        IdeaToken sourceIT = IdeaToken(source.ideaToken);
        IdeaToken targetIT = IdeaToken(target.ideaToken);

        assertEq(sourceIT.balanceOf(alice), FUND_AMOUNT);
        assertEq(sourceIT.balanceOf(carol), 2000e18);

        // Merge (alice triggers it)
        vm.prank(alice);
        tokenizer.mergeIdeas(sourceId, targetId);

        // Both can swap independently
        vm.prank(alice);
        tokenizer.claimMerge(sourceId, FUND_AMOUNT);
        assertEq(sourceIT.balanceOf(alice), 0);
        assertEq(targetIT.balanceOf(alice), FUND_AMOUNT + FUND_AMOUNT); // original + swapped

        vm.prank(carol);
        tokenizer.claimMerge(sourceId, 2000e18);
        assertEq(sourceIT.balanceOf(carol), 0);
        assertEq(targetIT.balanceOf(carol), 2000e18); // carol only had source IT
    }

    // ============ Integration Flow Tests ============

    function test_freeMarket_anyoneCanExecute() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        // Bob, Carol, and Dave all propose to execute — free market
        vm.prank(bob);
        uint256 s1 = tokenizer.proposeExecution(ideaId);
        vm.prank(carol);
        uint256 s2 = tokenizer.proposeExecution(ideaId);
        vm.prank(dave);
        uint256 s3 = tokenizer.proposeExecution(ideaId);

        // All three should have equal rates
        uint256 expectedRate = FUND_AMOUNT / 3 / 30 days;
        assertEq(tokenizer.getStreamRate(s1), expectedRate);
        assertEq(tokenizer.getStreamRate(s2), expectedRate);
        assertEq(tokenizer.getStreamRate(s3), expectedRate);

        // Bob stalls out, gets staled after 14 days
        vm.warp(block.timestamp + 15 days);

        // Carol and Dave report milestones (they're still active)
        vm.prank(carol);
        tokenizer.reportMilestone(s2, bytes32("progress"));
        vm.prank(dave);
        tokenizer.reportMilestone(s3, bytes32("progress"));

        // Anyone can trigger stale check on bob
        tokenizer.checkStale(s1);

        // Carol and Dave now split the remaining funding equally
        // After 15 days with 3 streams, ~50% of funding consumed → remaining split between 2
        IContributionYieldTokenizer.ExecutionStream memory sc = tokenizer.getStream(s2);
        IContributionYieldTokenizer.ExecutionStream memory sd = tokenizer.getStream(s3);
        assertEq(sc.streamRate, sd.streamRate, "Carol and Dave must have equal rates");
        assertGt(sc.streamRate, 0, "Rate must be > 0 after redistribution");
    }
}
