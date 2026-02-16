// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/identity/ContributionYieldTokenizer.sol";
import "../contracts/identity/ContributionDAG.sol";
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
    ContributionYieldTokenizer public tokenizer;
    ContributionDAG public dag;
    MockRewardToken2 public rewardToken;

    address public owner;
    address public alice; // idea creator, funder, founder
    address public bob;   // executor
    address public carol; // voter
    address public dave;  // redirect candidate

    uint256 public constant FUND_AMOUNT = 10_000e18;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");

        rewardToken = new MockRewardToken2();
        dag = new ContributionDAG(address(0));
        dag.addFounder(alice);

        // Deploy tokenizer (rewardLedger = address(0) for now, not needed in unit tests)
        tokenizer = new ContributionYieldTokenizer(
            address(rewardToken),
            address(dag),
            address(0) // rewardLedger
        );

        // Fund alice with reward tokens
        rewardToken.mint(alice, FUND_AMOUNT * 10);
        vm.prank(alice);
        rewardToken.approve(address(tokenizer), type(uint256).max);

        // Fund carol too (for voting tests)
        rewardToken.mint(carol, FUND_AMOUNT * 10);
        vm.prank(carol);
        rewardToken.approve(address(tokenizer), type(uint256).max);
    }

    // ============ Helpers ============

    function _createAndFundIdea(uint256 funding) internal returns (uint256 ideaId) {
        vm.prank(alice);
        ideaId = tokenizer.createIdea(bytes32("ipfs_hash"), funding);
    }

    function _createIdeaAndStream() internal returns (uint256 ideaId, uint256 streamId) {
        ideaId = _createAndFundIdea(FUND_AMOUNT);
        vm.prank(bob);
        streamId = tokenizer.proposeExecution(ideaId);
    }

    function _createIdeaStreamAndVote(uint256 voteAmount) internal returns (uint256 ideaId, uint256 streamId) {
        ideaId = _createAndFundIdea(FUND_AMOUNT);

        // Carol also funds to get IT tokens for voting
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, voteAmount);

        vm.prank(bob);
        streamId = tokenizer.proposeExecution(ideaId);

        vm.prank(carol);
        tokenizer.voteConviction(streamId, voteAmount);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsState() public view {
        assertEq(address(tokenizer.rewardToken()), address(rewardToken));
        assertEq(address(tokenizer.contributionDAG()), address(dag));
        assertEq(tokenizer.nextIdeaId(), 1);
        assertEq(tokenizer.nextStreamId(), 1);
    }

    function test_constructor_zeroRewardToken_reverts() public {
        vm.expectRevert(IContributionYieldTokenizer.ZeroAddress.selector);
        new ContributionYieldTokenizer(address(0), address(dag), address(0));
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
        assertEq(stream.streamRate, 0); // starts at 0
        assertEq(stream.totalConviction, 0);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.ACTIVE));
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

    // ============ Conviction Voting Tests ============

    function test_voteConviction_success() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        // Carol funds to get IT tokens
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, 500e18);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // Carol votes with her IT
        vm.prank(carol);
        tokenizer.voteConviction(streamId, 500e18);

        IContributionYieldTokenizer.ConvictionVote memory vote = tokenizer.getConvictionVote(streamId, carol);
        assertEq(vote.amount, 500e18);
        assertGt(vote.conviction, 0);

        // IT burned from carol
        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(carol), 0);
    }

    function test_voteConviction_trustWeighted() public {
        // Setup: alice is founder (3x), carol is untrusted (0.5x)
        dag.recalculateTrustScores();

        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        // Alice has IT from funding
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // Alice votes (founder 3x multiplier)
        vm.prank(alice);
        tokenizer.voteConviction(streamId, 1000e18);

        IContributionYieldTokenizer.ConvictionVote memory aliceVote = tokenizer.getConvictionVote(streamId, alice);
        // conviction = 1000e18 * 30000 / 10000 = 3000e18
        assertEq(aliceVote.conviction, 3000e18);
    }

    function test_voteConviction_insufficientBalance_reverts() public {
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // Dave has no IT tokens
        vm.prank(dave);
        vm.expectRevert(IContributionYieldTokenizer.InsufficientBalance.selector);
        tokenizer.voteConviction(streamId, 100e18);
    }

    function test_voteConviction_alreadyVoting_reverts() public {
        (uint256 ideaId, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        // Carol funds more and tries to vote again
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, 100e18);

        vm.prank(carol);
        vm.expectRevert(IContributionYieldTokenizer.AlreadyVoting.selector);
        tokenizer.voteConviction(streamId, 100e18);
    }

    function test_voteConviction_zeroAmount_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.ZeroAmount.selector);
        tokenizer.voteConviction(streamId, 0);
    }

    // ============ Withdraw Conviction Tests ============

    function test_withdrawConviction_success() public {
        (uint256 ideaId, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        // Carol withdraws
        vm.prank(carol);
        tokenizer.withdrawConviction(streamId);

        // IT returned to carol
        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(carol), 500e18);

        // Vote cleared
        IContributionYieldTokenizer.ConvictionVote memory vote = tokenizer.getConvictionVote(streamId, carol);
        assertEq(vote.amount, 0);

        // Stream conviction reduced
        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.totalConviction, 0);
    }

    function test_withdrawConviction_notVoting_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

        vm.prank(carol);
        vm.expectRevert(IContributionYieldTokenizer.NotVoting.selector);
        tokenizer.withdrawConviction(streamId);
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
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        // Warp past stale duration (14 days)
        vm.warp(block.timestamp + 15 days);

        tokenizer.checkStale(streamId);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.STALLED));
        assertEq(stream.streamRate, 0);
    }

    function test_checkStale_beforeStaleDuration_reverts() public {
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        vm.warp(block.timestamp + 7 days); // only 7 of 14 days

        vm.expectRevert(IContributionYieldTokenizer.StalePeriodNotReached.selector);
        tokenizer.checkStale(streamId);
    }

    function test_checkStale_afterMilestoneResetsTimer() public {
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

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
        (uint256 ideaId, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        // Stale the stream
        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        // Alice (IT holder from initial funding) redirects to dave
        vm.prank(alice);
        tokenizer.redirectStream(streamId, dave);

        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertEq(stream.executor, dave);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.ACTIVE));
    }

    function test_redirectStream_notStalled_reverts() public {
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.StreamStillActive.selector);
        tokenizer.redirectStream(streamId, dave);
    }

    function test_redirectStream_noITTokens_reverts() public {
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        // Dave has no IT
        vm.prank(dave);
        vm.expectRevert(IContributionYieldTokenizer.NotIdeaTokenHolder.selector);
        tokenizer.redirectStream(streamId, alice);
    }

    function test_redirectStream_zeroAddress_reverts() public {
        (, uint256 streamId) = _createIdeaStreamAndVote(500e18);

        vm.warp(block.timestamp + 15 days);
        tokenizer.checkStale(streamId);

        vm.prank(alice);
        vm.expectRevert(IContributionYieldTokenizer.ZeroAddress.selector);
        tokenizer.redirectStream(streamId, address(0));
    }

    // ============ Stream Claim Tests ============

    function test_claimStream_nothingToClaim_reverts() public {
        (, uint256 streamId) = _createIdeaAndStream();

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

    // ============ View Function Tests ============

    function test_pendingStreamAmount_noRate() public {
        (, uint256 streamId) = _createIdeaAndStream();
        assertEq(tokenizer.pendingStreamAmount(streamId), 0);
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

    function test_setContributionDAG_success() public {
        address newDAG = makeAddr("newDAG");
        tokenizer.setContributionDAG(newDAG);
        assertEq(address(tokenizer.contributionDAG()), newDAG);
    }

    function test_setContributionDAG_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        tokenizer.setContributionDAG(address(1));
    }

    // ============ Integration Flow Test ============

    function test_fullFlow_createIdea_fund_propose_vote_milestone_complete() public {
        // 1. Alice creates and funds an idea
        uint256 ideaId = _createAndFundIdea(FUND_AMOUNT);

        // 2. Carol also funds the idea
        vm.prank(carol);
        tokenizer.fundIdea(ideaId, 2000e18);

        // 3. Bob proposes to execute
        vm.prank(bob);
        uint256 streamId = tokenizer.proposeExecution(ideaId);

        // 4. Carol votes with conviction (2000e18 IT)
        vm.prank(carol);
        tokenizer.voteConviction(streamId, 2000e18);

        // 5. Stream should have conviction
        IContributionYieldTokenizer.ExecutionStream memory stream = tokenizer.getStream(streamId);
        assertGt(stream.totalConviction, 0);

        // 6. Bob reports milestones over time
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("milestone1"));

        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        tokenizer.reportMilestone(streamId, bytes32("milestone2"));

        // 7. Bob completes the stream
        vm.prank(bob);
        tokenizer.completeStream(streamId);

        stream = tokenizer.getStream(streamId);
        assertEq(uint256(stream.status), uint256(IContributionYieldTokenizer.StreamStatus.COMPLETED));

        // 8. Carol withdraws conviction (gets IT back)
        vm.prank(carol);
        tokenizer.withdrawConviction(streamId);

        IContributionYieldTokenizer.Idea memory idea = tokenizer.getIdea(ideaId);
        IdeaToken it = IdeaToken(idea.ideaToken);
        assertEq(it.balanceOf(carol), 2000e18);
    }
}
