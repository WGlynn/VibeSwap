// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/community/IdeaMarketplace.sol";
import "../../contracts/core/interfaces/IIdeaMarketplace.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockContributionDAG {
    mapping(address => bool) public excluded;
    function setExcluded(address a, bool v) external { excluded[a] = v; }
    function isReferralExcluded(address a) external view returns (bool) { return excluded[a]; }
}

// ============ Test Contract ============

contract IdeaMarketplaceTest is Test {
    // Re-declare events for expectEmit
    event IdeaSubmitted(
        uint256 indexed ideaId,
        address indexed author,
        IIdeaMarketplace.IdeaCategory category,
        string title,
        uint256 bountyAmount
    );
    event IdeaScored(
        uint256 indexed ideaId,
        address indexed scorer,
        uint8 feasibility,
        uint8 impact,
        uint8 novelty,
        uint256 totalScore
    );
    event IdeaAutoApproved(uint256 indexed ideaId, uint256 totalScore);
    event IdeaAutoRejected(uint256 indexed ideaId, uint256 totalScore);
    event BountyClaimed(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 collateralStaked,
        uint256 deadline
    );
    event WorkSubmitted(
        uint256 indexed ideaId,
        address indexed builder,
        bytes32 proofHash
    );
    event WorkApproved(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 ideatorReward,
        uint256 builderReward
    );
    event IdeaDisputed(
        uint256 indexed ideaId,
        address indexed disputedBy,
        bytes32 reasonHash
    );
    event ClaimCancelled(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 collateralSlashed
    );
    event ScorerUpdated(address indexed scorer, bool authorized);
    event BountyFunded(uint256 indexed ideaId, address indexed funder, uint256 amount);

    IdeaMarketplace public marketplace;
    MockERC20 public vibeToken;
    MockContributionDAG public mockDAG;

    address public owner;
    address public alice;   // ideator
    address public bob;     // builder
    address public carol;   // scorer 1
    address public dave;    // scorer 2
    address public eve;     // scorer 3
    address public treasury;

    uint256 public constant MIN_STAKE = 100e18;
    uint256 public constant BOUNTY = 1000e18;
    bytes32 public constant DESC_HASH = keccak256("ipfs://idea-description");
    bytes32 public constant PROOF_HASH = keccak256("ipfs://proof-of-completion");
    bytes32 public constant REASON_HASH = keccak256("ipfs://dispute-reason");

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        eve = makeAddr("eve");
        treasury = makeAddr("treasury");

        // Deploy mocks
        vibeToken = new MockERC20();
        mockDAG = new MockContributionDAG();

        // Deploy marketplace via UUPS proxy
        IdeaMarketplace impl = new IdeaMarketplace();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(IdeaMarketplace.initialize, (address(vibeToken), address(mockDAG), treasury))
        );
        marketplace = IdeaMarketplace(address(proxy));

        // Set up scorers
        marketplace.setScorer(carol, true);
        marketplace.setScorer(dave, true);
        marketplace.setScorer(eve, true);

        // Mint VIBE to participants
        vibeToken.mint(alice, 10_000e18);
        vibeToken.mint(bob, 10_000e18);
        vibeToken.mint(carol, 10_000e18);
        vibeToken.mint(dave, 10_000e18);
        vibeToken.mint(eve, 10_000e18);

        // Approve marketplace for all participants
        vm.prank(alice);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(bob);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(carol);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(dave);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(eve);
        vibeToken.approve(address(marketplace), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Submit an idea as alice, returns ideaId
    function _submitIdea() internal returns (uint256) {
        vm.prank(alice);
        return marketplace.submitIdea("Great Idea", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
    }

    /// @dev Submit + score with high marks from 3 scorers (auto-approve)
    function _submitAndApproveScore() internal returns (uint256) {
        uint256 ideaId = _submitIdea();
        // Score 8+8+8=24 each => avg=24 => auto-approve
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 8, 8, 8);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 8, 8, 8);
        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 8, 8, 8);
        return ideaId;
    }

    /// @dev Submit + score + fund bounty + claim by bob
    function _submitScoreFundClaim() internal returns (uint256) {
        uint256 ideaId = _submitAndApproveScore();
        // Fund bounty
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);
        // Claim by bob
        vm.prank(bob);
        marketplace.claimBounty(ideaId);
        return ideaId;
    }

    /// @dev Full flow up to REVIEW status
    function _submitToReview() internal returns (uint256) {
        uint256 ideaId = _submitScoreFundClaim();
        vm.prank(bob);
        marketplace.startWork(ideaId);
        vm.prank(bob);
        marketplace.submitWork(ideaId, PROOF_HASH);
        return ideaId;
    }

    // ============ Initialization ============

    function test_initialization_defaults() public view {
        assertEq(marketplace.minIdeaStake(), 100e18, "minIdeaStake default");
        assertEq(marketplace.builderCollateralBps(), 1000, "builderCollateralBps default");
        assertEq(marketplace.buildDeadline(), 7 days, "buildDeadline default");
        assertEq(marketplace.defaultIdeatorShareBps(), 4000, "defaultIdeatorShareBps default");
        assertEq(marketplace.defaultBuilderShareBps(), 6000, "defaultBuilderShareBps default");
        assertEq(marketplace.minScorers(), 3, "minScorers default");
        assertEq(address(marketplace.vibeToken()), address(vibeToken), "vibeToken set");
        assertEq(address(marketplace.contributionDAG()), address(mockDAG), "contributionDAG set");
        assertEq(marketplace.treasury(), treasury, "treasury set");
        assertEq(marketplace.totalIdeas(), 0, "no ideas initially");
    }

    function test_initialization_revertsZeroVibeToken() public {
        IdeaMarketplace impl = new IdeaMarketplace();
        vm.expectRevert(IIdeaMarketplace.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(IdeaMarketplace.initialize, (address(0), address(mockDAG), treasury))
        );
    }

    function test_initialization_revertsZeroTreasury() public {
        IdeaMarketplace impl = new IdeaMarketplace();
        vm.expectRevert(IIdeaMarketplace.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(IdeaMarketplace.initialize, (address(vibeToken), address(mockDAG), address(0)))
        );
    }

    // ============ submitIdea ============

    function test_submitIdea_happyPath() public {
        uint256 aliceBalBefore = vibeToken.balanceOf(alice);

        vm.expectEmit(true, true, false, true);
        emit IdeaSubmitted(1, alice, IIdeaMarketplace.IdeaCategory.PROTOCOL, "My Idea", 0);

        vm.prank(alice);
        uint256 ideaId = marketplace.submitIdea("My Idea", DESC_HASH, IIdeaMarketplace.IdeaCategory.PROTOCOL);

        assertEq(ideaId, 1, "first idea ID is 1");
        assertEq(marketplace.totalIdeas(), 1, "totalIdeas incremented");

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(idea.author, alice, "author is alice");
        assertEq(idea.title, "My Idea", "title matches");
        assertEq(idea.descriptionHash, DESC_HASH, "descriptionHash matches");
        assertEq(uint256(idea.category), uint256(IIdeaMarketplace.IdeaCategory.PROTOCOL), "category matches");
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "status is OPEN");
        assertEq(idea.bountyAmount, 0, "bounty starts at 0");
        assertEq(idea.builder, address(0), "no builder yet");
        assertEq(idea.createdAt, block.timestamp, "createdAt set");

        // Stake deducted
        assertEq(vibeToken.balanceOf(alice), aliceBalBefore - MIN_STAKE, "stake deducted from alice");
        assertEq(marketplace.ideatorStake(ideaId), MIN_STAKE, "ideatorStake recorded");
    }

    function test_submitIdea_revertsEmptyTitle() public {
        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.EmptyTitle.selector);
        marketplace.submitIdea("", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
    }

    function test_submitIdea_revertsZeroDescriptionHash() public {
        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.EmptyTitle.selector);
        marketplace.submitIdea("Title", bytes32(0), IIdeaMarketplace.IdeaCategory.UX);
    }

    function test_submitIdea_revertsReferralExcluded() public {
        mockDAG.setExcluded(alice, true);
        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.ReferralExcluded.selector);
        marketplace.submitIdea("Title", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
    }

    function test_submitIdea_revertsInsufficientBalance() public {
        address poorUser = makeAddr("poor");
        vm.prank(poorUser);
        vibeToken.approve(address(marketplace), type(uint256).max);
        // poorUser has 0 VIBE, transferFrom will revert
        vm.prank(poorUser);
        vm.expectRevert(); // ERC20 insufficient balance
        marketplace.submitIdea("Title", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
    }

    // ============ scoreIdea ============

    function test_scoreIdea_happyPath() public {
        uint256 ideaId = _submitIdea();

        vm.expectEmit(true, true, false, true);
        emit IdeaScored(ideaId, carol, 7, 8, 9, 24);

        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 7, 8, 9);

        assertTrue(marketplace.hasScored(ideaId, carol), "carol has scored");
        assertEq(marketplace.getScorerCount(ideaId), 1, "scorer count is 1");

        IIdeaMarketplace.IdeaScore memory s = marketplace.getScore(ideaId, carol);
        assertEq(s.feasibility, 7, "feasibility");
        assertEq(s.impact, 8, "impact");
        assertEq(s.novelty, 9, "novelty");
    }

    function test_scoreIdea_revertsNotScorer() public {
        uint256 ideaId = _submitIdea();
        address nobody = makeAddr("nobody");
        vm.prank(nobody);
        vm.expectRevert(IIdeaMarketplace.NotScorer.selector);
        marketplace.scoreIdea(ideaId, 5, 5, 5);
    }

    function test_scoreIdea_revertsAlreadyScored() public {
        uint256 ideaId = _submitIdea();
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 5, 5, 5);

        vm.prank(carol);
        vm.expectRevert(IIdeaMarketplace.AlreadyScored.selector);
        marketplace.scoreIdea(ideaId, 5, 5, 5);
    }

    function test_scoreIdea_revertsInvalidScore() public {
        uint256 ideaId = _submitIdea();
        vm.prank(carol);
        vm.expectRevert(IIdeaMarketplace.InvalidScore.selector);
        marketplace.scoreIdea(ideaId, 11, 5, 5);
    }

    function test_scoreIdea_revertsInvalidScoreImpact() public {
        uint256 ideaId = _submitIdea();
        vm.prank(carol);
        vm.expectRevert(IIdeaMarketplace.InvalidScore.selector);
        marketplace.scoreIdea(ideaId, 5, 11, 5);
    }

    function test_scoreIdea_revertsInvalidScoreNovelty() public {
        uint256 ideaId = _submitIdea();
        vm.prank(carol);
        vm.expectRevert(IIdeaMarketplace.InvalidScore.selector);
        marketplace.scoreIdea(ideaId, 5, 5, 11);
    }

    function test_scoreIdea_autoRejectBelowThreshold() public {
        uint256 ideaId = _submitIdea();

        // Score low: 4+4+4=12 per scorer, avg = 12 < 15
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 4, 4, 4);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 4, 4, 4);

        // Third scorer triggers threshold check
        vm.expectEmit(true, false, false, true);
        emit IdeaAutoRejected(ideaId, 12);

        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 4, 4, 4);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.REJECTED), "auto-rejected");

        // Ideator stake returned on rejection
        assertEq(marketplace.ideatorStake(ideaId), 0, "stake returned");
    }

    function test_scoreIdea_autoApproveAboveThreshold() public {
        uint256 ideaId = _submitIdea();

        // Score high: 8+8+8=24 per scorer, avg = 24 >= 24
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 8, 8, 8);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 8, 8, 8);

        // Third scorer triggers threshold check
        vm.expectEmit(true, false, false, true);
        emit IdeaAutoApproved(ideaId, 24);

        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 8, 8, 8);

        // Status stays OPEN (approved for claiming)
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "stays OPEN after auto-approve");
        assertEq(idea.score, 24, "score is 24");
    }

    function test_scoreIdea_ownerCanScore() public {
        uint256 ideaId = _submitIdea();

        // Owner (this contract) is not explicitly a scorer but onlyScorer allows owner
        marketplace.scoreIdea(ideaId, 5, 5, 5);

        assertTrue(marketplace.hasScored(ideaId, address(this)), "owner scored successfully");
    }

    function test_scoreIdea_pendingRangeMidScore() public {
        uint256 ideaId = _submitIdea();

        // Score in 15-23 range: 6+6+6=18 per scorer, avg = 18
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 6, 6, 6);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 6, 6, 6);
        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 6, 6, 6);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "stays OPEN in pending range");
        assertEq(idea.score, 18, "score is 18");
    }

    // ============ fundBounty ============

    function test_fundBounty_happyPath() public {
        uint256 ideaId = _submitIdea();

        vm.expectEmit(true, true, false, true);
        emit BountyFunded(ideaId, alice, BOUNTY);

        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(idea.bountyAmount, BOUNTY, "bounty funded");
    }

    function test_fundBounty_revertsInvalidStatus() public {
        uint256 ideaId = _submitIdea();
        // Score low to reject it
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 1, 1, 1);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 1, 1, 1);
        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 1, 1, 1);

        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.fundBounty(ideaId, BOUNTY);
    }

    function test_fundBounty_revertsZeroAmount() public {
        uint256 ideaId = _submitIdea();
        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.InsufficientStake.selector);
        marketplace.fundBounty(ideaId, 0);
    }

    // ============ claimBounty ============

    function test_claimBounty_happyPathWithCollateral() public {
        uint256 ideaId = _submitAndApproveScore();

        // Fund bounty
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);

        uint256 expectedCollateral = (BOUNTY * 1000) / 10000; // 10% of 1000e18 = 100e18
        uint256 bobBalBefore = vibeToken.balanceOf(bob);

        vm.expectEmit(true, true, false, true);
        emit BountyClaimed(ideaId, bob, expectedCollateral, block.timestamp + 7 days);

        vm.prank(bob);
        marketplace.claimBounty(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(idea.builder, bob, "builder is bob");
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.CLAIMED), "status is CLAIMED");
        assertEq(marketplace.builderCollateral(ideaId), expectedCollateral, "collateral recorded");
        assertEq(vibeToken.balanceOf(bob), bobBalBefore - expectedCollateral, "collateral transferred from bob");
    }

    function test_claimBounty_revertsSelfClaim() public {
        uint256 ideaId = _submitAndApproveScore();

        vm.prank(alice); // alice is the author
        vm.expectRevert(IIdeaMarketplace.SelfClaim.selector);
        marketplace.claimBounty(ideaId);
    }

    function test_claimBounty_revertsAlreadyClaimed() public {
        uint256 ideaId = _submitAndApproveScore();
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);

        vm.prank(bob);
        marketplace.claimBounty(ideaId);

        // Eve tries to claim the same idea
        vm.prank(eve);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.claimBounty(ideaId);
    }

    function test_claimBounty_revertsNotApproved() public {
        uint256 ideaId = _submitIdea();

        // Score in pending range (15-23), not auto-approved
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 6, 6, 6);
        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 6, 6, 6);
        vm.prank(eve);
        marketplace.scoreIdea(ideaId, 6, 6, 6);

        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.claimBounty(ideaId);
    }

    function test_claimBounty_revertsReferralExcluded() public {
        uint256 ideaId = _submitAndApproveScore();
        mockDAG.setExcluded(bob, true);

        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.ReferralExcluded.selector);
        marketplace.claimBounty(ideaId);
    }

    function test_claimBounty_zeroBountyZeroCollateral() public {
        uint256 ideaId = _submitAndApproveScore();
        // No funding => bountyAmount=0, collateral=0

        uint256 bobBalBefore = vibeToken.balanceOf(bob);

        vm.prank(bob);
        marketplace.claimBounty(ideaId);

        assertEq(marketplace.builderCollateral(ideaId), 0, "zero collateral");
        assertEq(vibeToken.balanceOf(bob), bobBalBefore, "no tokens transferred for zero collateral");
    }

    // ============ startWork ============

    function test_startWork_happyPath() public {
        uint256 ideaId = _submitScoreFundClaim();

        vm.prank(bob);
        marketplace.startWork(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.IN_PROGRESS), "status is IN_PROGRESS");
    }

    function test_startWork_revertsNotBuilder() public {
        uint256 ideaId = _submitScoreFundClaim();

        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.NotBuilder.selector);
        marketplace.startWork(ideaId);
    }

    function test_startWork_revertsInvalidStatus() public {
        uint256 ideaId = _submitAndApproveScore();
        // Still OPEN, not CLAIMED
        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.startWork(ideaId);
    }

    // ============ submitWork ============

    function test_submitWork_happyPath() public {
        uint256 ideaId = _submitScoreFundClaim();
        vm.prank(bob);
        marketplace.startWork(ideaId);

        vm.expectEmit(true, true, false, true);
        emit WorkSubmitted(ideaId, bob, PROOF_HASH);

        vm.prank(bob);
        marketplace.submitWork(ideaId, PROOF_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.REVIEW), "status is REVIEW");
        assertEq(idea.proofHash, PROOF_HASH, "proof hash set");
    }

    function test_submitWork_fromClaimedStatus() public {
        uint256 ideaId = _submitScoreFundClaim();
        // Submit directly from CLAIMED without startWork
        vm.prank(bob);
        marketplace.submitWork(ideaId, PROOF_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.REVIEW), "can submit from CLAIMED");
    }

    function test_submitWork_revertsNotBuilder() public {
        uint256 ideaId = _submitScoreFundClaim();

        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.NotBuilder.selector);
        marketplace.submitWork(ideaId, PROOF_HASH);
    }

    function test_submitWork_revertsDeadlineExpired() public {
        uint256 ideaId = _submitScoreFundClaim();

        // Warp past deadline
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.DeadlineExpired.selector);
        marketplace.submitWork(ideaId, PROOF_HASH);
    }

    function test_submitWork_revertsEmptyProof() public {
        uint256 ideaId = _submitScoreFundClaim();

        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.EmptyTitle.selector);
        marketplace.submitWork(ideaId, bytes32(0));
    }

    // ============ approveWork ============

    function test_approveWork_happyPathShapleySplit() public {
        uint256 ideaId = _submitToReview();

        uint256 aliceBalBefore = vibeToken.balanceOf(alice);
        uint256 bobBalBefore = vibeToken.balanceOf(bob);

        // Expected: 40% ideator, 60% builder
        uint256 expectedIdeatorReward = (BOUNTY * 4000) / 10000; // 400e18
        uint256 expectedBuilderReward = BOUNTY - expectedIdeatorReward; // 600e18
        uint256 collateral = marketplace.builderCollateral(ideaId);

        vm.expectEmit(true, true, false, true);
        emit WorkApproved(ideaId, bob, expectedIdeatorReward, expectedBuilderReward);

        marketplace.approveWork(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.COMPLETED), "status is COMPLETED");
        assertEq(idea.completedAt, block.timestamp, "completedAt set");

        // Alice gets 40% bounty + returned stake
        assertEq(
            vibeToken.balanceOf(alice),
            aliceBalBefore + expectedIdeatorReward + MIN_STAKE,
            "alice receives ideator reward + stake"
        );

        // Bob gets 60% bounty + returned collateral
        assertEq(
            vibeToken.balanceOf(bob),
            bobBalBefore + expectedBuilderReward + collateral,
            "bob receives builder reward + collateral"
        );

        // Collateral and stake cleared
        assertEq(marketplace.builderCollateral(ideaId), 0, "collateral cleared");
        assertEq(marketplace.ideatorStake(ideaId), 0, "stake cleared");
    }

    function test_approveWork_revertsNotOwner() public {
        uint256 ideaId = _submitToReview();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        marketplace.approveWork(ideaId);
    }

    function test_approveWork_revertsInvalidStatus() public {
        uint256 ideaId = _submitScoreFundClaim();
        // Status is CLAIMED, not REVIEW
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.approveWork(ideaId);
    }

    function test_approveWork_ideatorStakeReturned() public {
        uint256 ideaId = _submitToReview();
        uint256 stakeAmount = marketplace.ideatorStake(ideaId);
        assertEq(stakeAmount, MIN_STAKE, "stake was held");

        uint256 aliceBalBefore = vibeToken.balanceOf(alice);
        marketplace.approveWork(ideaId);

        // Alice balance includes both the ideator reward and the returned stake
        uint256 expectedIdeatorReward = (BOUNTY * 4000) / 10000;
        assertEq(
            vibeToken.balanceOf(alice),
            aliceBalBefore + expectedIdeatorReward + MIN_STAKE,
            "stake returned to alice on approval"
        );
        assertEq(marketplace.ideatorStake(ideaId), 0, "stake zeroed out");
    }

    function test_approveWork_builderCollateralReturned() public {
        uint256 ideaId = _submitToReview();
        uint256 collateral = marketplace.builderCollateral(ideaId);
        assertTrue(collateral > 0, "collateral was held");

        uint256 bobBalBefore = vibeToken.balanceOf(bob);
        marketplace.approveWork(ideaId);

        uint256 expectedBuilderReward = BOUNTY - (BOUNTY * 4000) / 10000;
        assertEq(
            vibeToken.balanceOf(bob),
            bobBalBefore + expectedBuilderReward + collateral,
            "collateral returned to bob"
        );
        assertEq(marketplace.builderCollateral(ideaId), 0, "collateral zeroed out");
    }

    // ============ disputeWork ============

    function test_disputeWork_happyPathIdeator() public {
        uint256 ideaId = _submitToReview();

        vm.expectEmit(true, true, false, true);
        emit IdeaDisputed(ideaId, alice, REASON_HASH);

        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.DISPUTED), "status is DISPUTED");
    }

    function test_disputeWork_happyPathBuilder() public {
        uint256 ideaId = _submitToReview();

        vm.prank(bob);
        marketplace.disputeWork(ideaId, REASON_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.DISPUTED), "builder can dispute");
    }

    function test_disputeWork_revertsRandomAddress() public {
        uint256 ideaId = _submitToReview();

        vm.prank(eve);
        vm.expectRevert(IIdeaMarketplace.NotAuthor.selector);
        marketplace.disputeWork(ideaId, REASON_HASH);
    }

    function test_disputeWork_revertsInvalidStatus() public {
        uint256 ideaId = _submitAndApproveScore();
        // Status is OPEN, cannot dispute
        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.disputeWork(ideaId, REASON_HASH);
    }

    function test_disputeWork_fromClaimedStatus() public {
        uint256 ideaId = _submitScoreFundClaim();
        // Ideator disputes during CLAIMED
        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.DISPUTED), "dispute from CLAIMED");
    }

    function test_disputeWork_fromInProgressStatus() public {
        uint256 ideaId = _submitScoreFundClaim();
        vm.prank(bob);
        marketplace.startWork(ideaId);

        vm.prank(bob);
        marketplace.disputeWork(ideaId, REASON_HASH);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.DISPUTED), "dispute from IN_PROGRESS");
    }

    // ============ cancelClaim ============

    function test_cancelClaim_happyPathCollateralSlashedToTreasury() public {
        uint256 ideaId = _submitScoreFundClaim();
        uint256 collateral = marketplace.builderCollateral(ideaId);
        uint256 treasuryBalBefore = vibeToken.balanceOf(treasury);

        vm.expectEmit(true, true, false, true);
        emit ClaimCancelled(ideaId, bob, collateral);

        vm.prank(bob);
        marketplace.cancelClaim(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened to OPEN");
        assertEq(idea.builder, address(0), "builder reset");
        assertEq(idea.claimedAt, 0, "claimedAt reset");
        assertEq(marketplace.builderCollateral(ideaId), 0, "collateral zeroed");
        assertEq(vibeToken.balanceOf(treasury), treasuryBalBefore + collateral, "collateral sent to treasury");
    }

    function test_cancelClaim_revertsNotBuilder() public {
        uint256 ideaId = _submitScoreFundClaim();

        vm.prank(alice);
        vm.expectRevert(IIdeaMarketplace.NotBuilder.selector);
        marketplace.cancelClaim(ideaId);
    }

    function test_cancelClaim_revertsInvalidStatus() public {
        uint256 ideaId = _submitAndApproveScore();
        // Status is OPEN, not CLAIMED/IN_PROGRESS
        vm.prank(bob);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.cancelClaim(ideaId);
    }

    function test_cancelClaim_fromInProgress() public {
        uint256 ideaId = _submitScoreFundClaim();
        vm.prank(bob);
        marketplace.startWork(ideaId);

        vm.prank(bob);
        marketplace.cancelClaim(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened from IN_PROGRESS");
    }

    // ============ reclaimExpired ============

    function test_reclaimExpired_happyPathAfterDeadline() public {
        uint256 ideaId = _submitScoreFundClaim();
        uint256 collateral = marketplace.builderCollateral(ideaId);
        uint256 treasuryBalBefore = vibeToken.balanceOf(treasury);

        // Warp past deadline
        vm.warp(block.timestamp + 7 days + 1);

        marketplace.reclaimExpired(ideaId);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened to OPEN");
        assertEq(idea.builder, address(0), "builder reset");
        assertEq(vibeToken.balanceOf(treasury), treasuryBalBefore + collateral, "collateral slashed to treasury");
    }

    function test_reclaimExpired_revertsBeforeDeadline() public {
        uint256 ideaId = _submitScoreFundClaim();

        // Still within deadline
        vm.expectRevert(IIdeaMarketplace.DeadlineNotExpired.selector);
        marketplace.reclaimExpired(ideaId);
    }

    function test_reclaimExpired_revertsInvalidStatus() public {
        uint256 ideaId = _submitAndApproveScore();
        // Status OPEN, not CLAIMED/IN_PROGRESS
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.reclaimExpired(ideaId);
    }

    // ============ resolveDispute ============

    function test_resolveDispute_approvePath() public {
        uint256 ideaId = _submitToReview();
        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        uint256 aliceBalBefore = vibeToken.balanceOf(alice);
        uint256 bobBalBefore = vibeToken.balanceOf(bob);
        uint256 collateral = marketplace.builderCollateral(ideaId);

        uint256 expectedIdeatorReward = (BOUNTY * 4000) / 10000;
        uint256 expectedBuilderReward = BOUNTY - expectedIdeatorReward;

        vm.expectEmit(true, true, false, true);
        emit WorkApproved(ideaId, bob, expectedIdeatorReward, expectedBuilderReward);

        marketplace.resolveDispute(ideaId, true);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.COMPLETED), "COMPLETED after resolve-approve");

        assertEq(
            vibeToken.balanceOf(alice),
            aliceBalBefore + expectedIdeatorReward + MIN_STAKE,
            "alice gets reward + stake on dispute-approve"
        );
        assertEq(
            vibeToken.balanceOf(bob),
            bobBalBefore + expectedBuilderReward + collateral,
            "bob gets reward + collateral on dispute-approve"
        );
    }

    function test_resolveDispute_rejectPath() public {
        uint256 ideaId = _submitToReview();
        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        uint256 collateral = marketplace.builderCollateral(ideaId);
        uint256 treasuryBalBefore = vibeToken.balanceOf(treasury);

        vm.expectEmit(true, true, false, true);
        emit ClaimCancelled(ideaId, bob, collateral);

        marketplace.resolveDispute(ideaId, false);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened after dispute-reject");
        assertEq(idea.builder, address(0), "builder cleared");
        assertEq(vibeToken.balanceOf(treasury), treasuryBalBefore + collateral, "collateral slashed on dispute-reject");
    }

    function test_resolveDispute_revertsInvalidStatus() public {
        uint256 ideaId = _submitToReview();
        // Not disputed yet — status is REVIEW
        vm.expectRevert(IIdeaMarketplace.InvalidStatus.selector);
        marketplace.resolveDispute(ideaId, true);
    }

    function test_resolveDispute_revertsNotOwner() public {
        uint256 ideaId = _submitToReview();
        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        marketplace.resolveDispute(ideaId, true);
    }

    // ============ Admin Functions ============

    function test_setScorer() public {
        address newScorer = makeAddr("newScorer");
        assertFalse(marketplace.scorers(newScorer), "not a scorer initially");

        vm.expectEmit(true, false, false, true);
        emit ScorerUpdated(newScorer, true);

        marketplace.setScorer(newScorer, true);
        assertTrue(marketplace.scorers(newScorer), "now a scorer");

        marketplace.setScorer(newScorer, false);
        assertFalse(marketplace.scorers(newScorer), "deauthorized");
    }

    function test_setScorer_revertsZeroAddress() public {
        vm.expectRevert(IIdeaMarketplace.ZeroAddress.selector);
        marketplace.setScorer(address(0), true);
    }

    function test_setMinIdeaStake() public {
        marketplace.setMinIdeaStake(200e18);
        assertEq(marketplace.minIdeaStake(), 200e18, "minIdeaStake updated");
    }

    function test_setBuilderCollateralBps() public {
        marketplace.setBuilderCollateralBps(2000);
        assertEq(marketplace.builderCollateralBps(), 2000, "builderCollateralBps updated");
    }

    function test_setBuilderCollateralBps_revertsExceeds100() public {
        vm.expectRevert("Collateral exceeds 100%");
        marketplace.setBuilderCollateralBps(10001);
    }

    function test_setBuildDeadline() public {
        marketplace.setBuildDeadline(14 days);
        assertEq(marketplace.buildDeadline(), 14 days, "buildDeadline updated");
    }

    function test_setBuildDeadline_revertsTooShort() public {
        vm.expectRevert("Deadline too short");
        marketplace.setBuildDeadline(12 hours);
    }

    function test_setDefaultSplit() public {
        marketplace.setDefaultSplit(5000, 5000);
        assertEq(marketplace.defaultIdeatorShareBps(), 5000, "ideator share updated");
        assertEq(marketplace.defaultBuilderShareBps(), 5000, "builder share updated");
    }

    function test_setDefaultSplit_revertsInvalidSum() public {
        vm.expectRevert("Split must sum to 10000");
        marketplace.setDefaultSplit(5000, 4000);
    }

    function test_setIdeaSplit() public {
        uint256 ideaId = _submitIdea();
        marketplace.setIdeaSplit(ideaId, 3000);
        assertEq(marketplace.ideatorShareOverride(ideaId), 3000, "per-idea override set");
    }

    function test_setIdeaSplit_revertsExceeds100() public {
        uint256 ideaId = _submitIdea();
        vm.expectRevert("Ideator share exceeds 100%");
        marketplace.setIdeaSplit(ideaId, 10001);
    }

    function test_setMinScorers() public {
        marketplace.setMinScorers(5);
        assertEq(marketplace.minScorers(), 5, "minScorers updated");
    }

    function test_setMinScorers_revertsZero() public {
        vm.expectRevert("Need at least 1 scorer");
        marketplace.setMinScorers(0);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        marketplace.setTreasury(newTreasury);
        assertEq(marketplace.treasury(), newTreasury, "treasury updated");
    }

    function test_setTreasury_revertsZeroAddress() public {
        vm.expectRevert(IIdeaMarketplace.ZeroAddress.selector);
        marketplace.setTreasury(address(0));
    }

    function test_setContributionDAG() public {
        address newDAG = makeAddr("newDAG");
        marketplace.setContributionDAG(newDAG);
        assertEq(address(marketplace.contributionDAG()), newDAG, "contributionDAG updated");
    }

    function test_setContributionDAG_disableChecks() public {
        marketplace.setContributionDAG(address(0));
        assertEq(address(marketplace.contributionDAG()), address(0), "DAG disabled");

        // Can submit even if previously excluded
        mockDAG.setExcluded(alice, true);
        vm.prank(alice);
        uint256 ideaId = marketplace.submitIdea("Title", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
        assertGt(ideaId, 0, "idea submitted with DAG disabled");
    }

    // ============ View Functions ============

    function test_getIdea() public {
        uint256 ideaId = _submitIdea();
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(idea.id, ideaId, "idea ID");
        assertEq(idea.author, alice, "author");
        assertEq(idea.title, "Great Idea", "title");
    }

    function test_getIdeasByStatus() public {
        _submitIdea(); // id 1
        _submitIdea(); // id 2

        IIdeaMarketplace.Idea[] memory openIdeas = marketplace.getIdeasByStatus(IIdeaMarketplace.IdeaStatus.OPEN, 0, 10);
        assertEq(openIdeas.length, 2, "two OPEN ideas");
        assertEq(openIdeas[0].id, 1, "first idea");
        assertEq(openIdeas[1].id, 2, "second idea");
    }

    function test_getIdeasByStatus_pagination() public {
        _submitIdea();
        _submitIdea();
        _submitIdea();

        IIdeaMarketplace.Idea[] memory page1 = marketplace.getIdeasByStatus(IIdeaMarketplace.IdeaStatus.OPEN, 0, 2);
        assertEq(page1.length, 2, "page 1 has 2");

        IIdeaMarketplace.Idea[] memory page2 = marketplace.getIdeasByStatus(IIdeaMarketplace.IdeaStatus.OPEN, 2, 2);
        assertEq(page2.length, 1, "page 2 has 1");

        IIdeaMarketplace.Idea[] memory empty = marketplace.getIdeasByStatus(IIdeaMarketplace.IdeaStatus.OPEN, 10, 2);
        assertEq(empty.length, 0, "offset beyond range returns empty");
    }

    function test_getIdeasByCategory() public {
        vm.prank(alice);
        marketplace.submitIdea("UX idea", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);
        vm.prank(alice);
        marketplace.submitIdea("Security idea", DESC_HASH, IIdeaMarketplace.IdeaCategory.SECURITY);
        vm.prank(alice);
        marketplace.submitIdea("UX idea 2", DESC_HASH, IIdeaMarketplace.IdeaCategory.UX);

        IIdeaMarketplace.Idea[] memory uxIdeas = marketplace.getIdeasByCategory(IIdeaMarketplace.IdeaCategory.UX, 0, 10);
        assertEq(uxIdeas.length, 2, "two UX ideas");

        IIdeaMarketplace.Idea[] memory secIdeas = marketplace.getIdeasByCategory(IIdeaMarketplace.IdeaCategory.SECURITY, 0, 10);
        assertEq(secIdeas.length, 1, "one SECURITY idea");
    }

    function test_getIdeasByAuthor() public {
        _submitIdea(); // alice submits
        _submitIdea(); // alice submits again

        uint256[] memory aliceIdeas = marketplace.getIdeasByAuthor(alice);
        assertEq(aliceIdeas.length, 2, "alice has 2 ideas");

        uint256[] memory bobIdeas = marketplace.getIdeasByAuthor(bob);
        assertEq(bobIdeas.length, 0, "bob has 0 ideas");
    }

    function test_getIdeasByBuilder() public {
        uint256 ideaId = _submitAndApproveScore();
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);
        vm.prank(bob);
        marketplace.claimBounty(ideaId);

        uint256[] memory bobBuilds = marketplace.getIdeasByBuilder(bob);
        assertEq(bobBuilds.length, 1, "bob has 1 build");
        assertEq(bobBuilds[0], ideaId, "correct ideaId");
    }

    function test_getDeadline() public {
        uint256 ideaId = _submitScoreFundClaim();

        uint256 deadline = marketplace.getDeadline(ideaId);
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(deadline, idea.claimedAt + 7 days, "deadline = claimedAt + 7 days");
    }

    function test_getDeadline_unclaimed() public {
        uint256 ideaId = _submitIdea();
        uint256 deadline = marketplace.getDeadline(ideaId);
        assertEq(deadline, 0, "deadline is 0 for unclaimed idea");
    }

    function test_totalIdeas() public {
        assertEq(marketplace.totalIdeas(), 0, "starts at 0");
        _submitIdea();
        assertEq(marketplace.totalIdeas(), 1, "one idea");
        _submitIdea();
        assertEq(marketplace.totalIdeas(), 2, "two ideas");
    }

    function test_hasScored() public {
        uint256 ideaId = _submitIdea();
        assertFalse(marketplace.hasScored(ideaId, carol), "not scored yet");

        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 5, 5, 5);

        assertTrue(marketplace.hasScored(ideaId, carol), "scored now");
        assertFalse(marketplace.hasScored(ideaId, dave), "dave not scored");
    }

    function test_getScorerCount() public {
        uint256 ideaId = _submitIdea();
        assertEq(marketplace.getScorerCount(ideaId), 0, "zero scorers initially");

        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 5, 5, 5);
        assertEq(marketplace.getScorerCount(ideaId), 1, "one scorer");

        vm.prank(dave);
        marketplace.scoreIdea(ideaId, 5, 5, 5);
        assertEq(marketplace.getScorerCount(ideaId), 2, "two scorers");
    }

    function test_getScore() public {
        uint256 ideaId = _submitIdea();
        vm.prank(carol);
        marketplace.scoreIdea(ideaId, 3, 7, 10);

        IIdeaMarketplace.IdeaScore memory s = marketplace.getScore(ideaId, carol);
        assertEq(s.feasibility, 3, "feasibility");
        assertEq(s.impact, 7, "impact");
        assertEq(s.novelty, 10, "novelty");
    }

    // ============ Edge Cases ============

    function test_edgeCase_zeroBountyClaimed() public {
        uint256 ideaId = _submitAndApproveScore();
        // No funding, bounty = 0

        vm.prank(bob);
        marketplace.claimBounty(ideaId);

        // Collateral is 10% of 0 = 0
        assertEq(marketplace.builderCollateral(ideaId), 0, "zero collateral for zero bounty");

        // Submit and approve
        vm.prank(bob);
        marketplace.submitWork(ideaId, PROOF_HASH);

        uint256 aliceBalBefore = vibeToken.balanceOf(alice);
        uint256 bobBalBefore = vibeToken.balanceOf(bob);

        marketplace.approveWork(ideaId);

        // Alice only gets her stake back (no bounty reward)
        assertEq(vibeToken.balanceOf(alice), aliceBalBefore + MIN_STAKE, "alice only gets stake back");
        // Bob gets nothing (0 bounty, 0 collateral)
        assertEq(vibeToken.balanceOf(bob), bobBalBefore, "bob gets nothing for zero bounty");
    }

    function test_edgeCase_ideatorShareOverride() public {
        uint256 ideaId = _submitAndApproveScore();
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);

        // Override to 70/30 ideator/builder
        marketplace.setIdeaSplit(ideaId, 7000);

        vm.prank(bob);
        marketplace.claimBounty(ideaId);
        vm.prank(bob);
        marketplace.submitWork(ideaId, PROOF_HASH);

        uint256 aliceBalBefore = vibeToken.balanceOf(alice);
        uint256 bobBalBefore = vibeToken.balanceOf(bob);
        uint256 collateral = marketplace.builderCollateral(ideaId);

        marketplace.approveWork(ideaId);

        uint256 expectedIdeatorReward = (BOUNTY * 7000) / 10000; // 700e18
        uint256 expectedBuilderReward = BOUNTY - expectedIdeatorReward; // 300e18

        assertEq(
            vibeToken.balanceOf(alice),
            aliceBalBefore + expectedIdeatorReward + MIN_STAKE,
            "alice gets 70% with override"
        );
        assertEq(
            vibeToken.balanceOf(bob),
            bobBalBefore + expectedBuilderReward + collateral,
            "bob gets 30% with override"
        );
    }

    function test_edgeCase_ideaReopenedAfterCancelCanBeReclaimed() public {
        uint256 ideaId = _submitAndApproveScore();
        vm.prank(alice);
        marketplace.fundBounty(ideaId, BOUNTY);

        // Bob claims then cancels
        vm.prank(bob);
        marketplace.claimBounty(ideaId);
        vm.prank(bob);
        marketplace.cancelClaim(ideaId);

        // Verify reopened
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened");

        // Eve claims the reopened idea
        vm.prank(eve);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(eve);
        marketplace.claimBounty(ideaId);

        idea = marketplace.getIdea(ideaId);
        assertEq(idea.builder, eve, "eve is new builder");
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.CLAIMED), "claimed by eve");
    }

    function test_edgeCase_resolveDisputeRejectReopensForReclaim() public {
        uint256 ideaId = _submitToReview();
        vm.prank(alice);
        marketplace.disputeWork(ideaId, REASON_HASH);

        // Reject dispute => reopened
        marketplace.resolveDispute(ideaId, false);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint256(idea.status), uint256(IIdeaMarketplace.IdeaStatus.OPEN), "reopened after dispute reject");

        // Eve can now claim
        vm.prank(eve);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(eve);
        marketplace.claimBounty(ideaId);

        idea = marketplace.getIdea(ideaId);
        assertEq(idea.builder, eve, "eve claimed reopened idea");
    }

    function test_edgeCase_multipleIdeasIndependent() public {
        uint256 id1 = _submitIdea();
        uint256 id2 = _submitIdea();

        assertEq(id1, 1, "first idea id");
        assertEq(id2, 2, "second idea id");

        IIdeaMarketplace.Idea memory idea1 = marketplace.getIdea(id1);
        IIdeaMarketplace.Idea memory idea2 = marketplace.getIdea(id2);
        assertEq(idea1.author, alice, "idea1 author");
        assertEq(idea2.author, alice, "idea2 author");
        assertTrue(idea1.id != idea2.id, "different IDs");
    }

    function test_edgeCase_ideaNotFoundRevert() public {
        vm.expectRevert(IIdeaMarketplace.IdeaNotFound.selector);
        marketplace.getDeadline(999);
    }

    function test_edgeCase_ideaNotFoundZero() public {
        vm.expectRevert(IIdeaMarketplace.IdeaNotFound.selector);
        marketplace.getDeadline(0);
    }
}
