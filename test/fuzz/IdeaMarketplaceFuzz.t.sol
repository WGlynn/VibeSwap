// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/IdeaMarketplace.sol";

// ============ Mock Contracts ============

contract MockERC20Fuzz is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockDAGFuzz {
    mapping(address => bool) public excluded;
    function setExcluded(address a, bool v) external { excluded[a] = v; }
    function isReferralExcluded(address a) external view returns (bool) { return excluded[a]; }
}

// ============ Fuzz Test Contract ============

contract IdeaMarketplaceFuzz is Test {
    IdeaMarketplace public marketplace;
    MockERC20Fuzz public vibeToken;
    MockDAGFuzz public mockDAG;

    address public owner;
    address public treasury;
    address public ideator;
    address public builder;
    address public scorer1;
    address public scorer2;
    address public scorer3;

    uint256 public constant STAKE = 100e18;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        ideator = makeAddr("ideator");
        builder = makeAddr("builder");
        scorer1 = makeAddr("scorer1");
        scorer2 = makeAddr("scorer2");
        scorer3 = makeAddr("scorer3");

        vibeToken = new MockERC20Fuzz();
        mockDAG = new MockDAGFuzz();

        // Deploy via UUPS proxy
        IdeaMarketplace impl = new IdeaMarketplace();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(IdeaMarketplace.initialize, (address(vibeToken), address(mockDAG), treasury))
        );
        marketplace = IdeaMarketplace(address(proxy));

        // Authorize scorers
        marketplace.setScorer(scorer1, true);
        marketplace.setScorer(scorer2, true);
        marketplace.setScorer(scorer3, true);

        // Mint VIBE to key actors
        vibeToken.mint(ideator, 1_000_000e18);
        vibeToken.mint(builder, 1_000_000e18);

        // Approve marketplace for key actors
        vm.prank(ideator);
        vibeToken.approve(address(marketplace), type(uint256).max);
        vm.prank(builder);
        vibeToken.approve(address(marketplace), type(uint256).max);
    }

    // ============ Helpers ============

    /// @notice Submit an idea as ideator and return its ID
    function _submitIdea() internal returns (uint256) {
        vm.prank(ideator);
        return marketplace.submitIdea("Test Idea", keccak256("desc"), IIdeaMarketplace.IdeaCategory.UX);
    }

    /// @notice Score an idea with high scores (auto-approve range) using all 3 scorers
    function _scoreHighAll(uint256 ideaId) internal {
        vm.prank(scorer1);
        marketplace.scoreIdea(ideaId, 9, 9, 9); // 27
        vm.prank(scorer2);
        marketplace.scoreIdea(ideaId, 8, 8, 8); // 24
        vm.prank(scorer3);
        marketplace.scoreIdea(ideaId, 10, 10, 10); // 30 => avg = (27+24+30)/3 = 27
    }

    /// @notice Fund a bounty for an idea from a fresh funder
    function _fundBounty(uint256 ideaId, uint256 amount) internal {
        address funder = makeAddr("funder");
        vibeToken.mint(funder, amount);
        vm.prank(funder);
        vibeToken.approve(address(marketplace), amount);
        vm.prank(funder);
        marketplace.fundBounty(ideaId, amount);
    }

    /// @notice Get an idea through to CLAIMED status
    function _submitScoreApproveAndClaim(
        address _ideator,
        address _builder,
        uint256 bounty
    ) internal returns (uint256) {
        // Submit idea
        vm.prank(_ideator);
        uint256 ideaId = marketplace.submitIdea("Test Idea", keccak256("desc"), IIdeaMarketplace.IdeaCategory.UX);

        // Score with 3 scorers (high scores to auto-approve)
        vm.prank(scorer1);
        marketplace.scoreIdea(ideaId, 9, 9, 9);
        vm.prank(scorer2);
        marketplace.scoreIdea(ideaId, 8, 8, 8);
        vm.prank(scorer3);
        marketplace.scoreIdea(ideaId, 10, 10, 10);

        // Fund bounty
        if (bounty > 0) {
            _fundBounty(ideaId, bounty);
        }

        // Builder claims
        uint256 collateral = (bounty * marketplace.builderCollateralBps()) / marketplace.BPS_PRECISION();
        vibeToken.mint(_builder, collateral);
        vm.prank(_builder);
        vibeToken.approve(address(marketplace), collateral);
        vm.prank(_builder);
        marketplace.claimBounty(ideaId);

        return ideaId;
    }

    // ============ Fuzz Tests ============

    /// @notice Any valid IdeaCategory enum value should succeed for submission
    function testFuzz_submitIdea_anyCategory(uint8 categoryRaw) public {
        // IdeaCategory has 5 values: 0=UX, 1=PROTOCOL, 2=TOOLING, 3=GROWTH, 4=SECURITY
        categoryRaw = uint8(bound(categoryRaw, 0, 4));
        IIdeaMarketplace.IdeaCategory category = IIdeaMarketplace.IdeaCategory(categoryRaw);

        vm.prank(ideator);
        uint256 ideaId = marketplace.submitIdea(
            "Fuzz Idea",
            keccak256(abi.encodePacked("desc", categoryRaw)),
            category
        );

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint8(idea.category), categoryRaw, "Category mismatch");
        assertEq(idea.author, ideator, "Author mismatch");
        assertEq(uint8(idea.status), uint8(IIdeaMarketplace.IdeaStatus.OPEN), "Status should be OPEN");
        assertGt(ideaId, 0, "Idea ID should be > 0");
    }

    /// @notice Valid score dimensions (each 0-10) should compute aggregate correctly
    function testFuzz_scoreIdea_validScores(uint8 f, uint8 i, uint8 n) public {
        f = uint8(bound(f, 0, 10));
        i = uint8(bound(i, 0, 10));
        n = uint8(bound(n, 0, 10));

        uint256 ideaId = _submitIdea();

        vm.prank(scorer1);
        marketplace.scoreIdea(ideaId, f, i, n);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        uint256 expectedScore = uint256(f) + uint256(i) + uint256(n);
        assertEq(idea.score, expectedScore, "Score mismatch after single scorer");
        assertTrue(marketplace.hasScored(ideaId, scorer1), "Scorer should be marked");
        assertEq(marketplace.getScorerCount(ideaId), 1, "Scorer count should be 1");
    }

    /// @notice At least one dimension > 10 should revert with InvalidScore
    function testFuzz_scoreIdea_invalidScores(uint8 f, uint8 i, uint8 n) public {
        // Ensure at least one score > 10
        // Strategy: pick one dimension to be invalid, keep others valid
        uint256 choice = uint256(keccak256(abi.encodePacked(f, i, n))) % 3;
        if (choice == 0) {
            f = uint8(bound(f, 11, 255));
            i = uint8(bound(i, 0, 10));
            n = uint8(bound(n, 0, 10));
        } else if (choice == 1) {
            f = uint8(bound(f, 0, 10));
            i = uint8(bound(i, 11, 255));
            n = uint8(bound(n, 0, 10));
        } else {
            f = uint8(bound(f, 0, 10));
            i = uint8(bound(i, 0, 10));
            n = uint8(bound(n, 11, 255));
        }

        uint256 ideaId = _submitIdea();

        vm.prank(scorer1);
        vm.expectRevert(IIdeaMarketplace.InvalidScore.selector);
        marketplace.scoreIdea(ideaId, f, i, n);
    }

    /// @notice Funding any amount (1 to 1e24) should accumulate on bounty correctly
    function testFuzz_fundBounty_anyAmount(uint256 amount) public {
        amount = bound(amount, 1, 1e24);

        uint256 ideaId = _submitIdea();

        IIdeaMarketplace.Idea memory ideaBefore = marketplace.getIdea(ideaId);
        uint256 bountyBefore = ideaBefore.bountyAmount;

        _fundBounty(ideaId, amount);

        IIdeaMarketplace.Idea memory ideaAfter = marketplace.getIdea(ideaId);
        assertEq(ideaAfter.bountyAmount, bountyBefore + amount, "Bounty should accumulate");
    }

    /// @notice Collateral on claim = bountyAmount * builderCollateralBps / BPS_PRECISION
    function testFuzz_claimBounty_collateralCalculation(uint256 bountyAmount) public {
        bountyAmount = bound(bountyAmount, 1e18, 1e24);

        uint256 ideaId = _submitIdea();
        _scoreHighAll(ideaId);
        _fundBounty(ideaId, bountyAmount);

        uint256 expectedCollateral = (bountyAmount * marketplace.builderCollateralBps()) / marketplace.BPS_PRECISION();

        // Mint exact collateral to builder
        vibeToken.mint(builder, expectedCollateral);
        vm.prank(builder);
        vibeToken.approve(address(marketplace), expectedCollateral);

        uint256 builderBalBefore = vibeToken.balanceOf(builder);

        vm.prank(builder);
        marketplace.claimBounty(ideaId);

        uint256 builderBalAfter = vibeToken.balanceOf(builder);
        uint256 storedCollateral = marketplace.builderCollateral(ideaId);

        // Default builderCollateralBps = 1000 (10%), so collateral = bountyAmount * 1000 / 10000
        assertEq(storedCollateral, expectedCollateral, "Stored collateral mismatch");
        assertEq(builderBalBefore - builderBalAfter, expectedCollateral, "Builder should pay exact collateral");
    }

    /// @notice Ideator + builder rewards must sum to total bounty (no dust lost)
    function testFuzz_approveWork_shapleySplit(uint256 bountyAmount, uint256 ideatorBps) public {
        bountyAmount = bound(bountyAmount, 1e18, 1e24);
        // Contract treats ideatorShareOverride == 0 as "use default"
        // Bound to [100, 9900] to test non-trivial splits away from edge cases
        ideatorBps = bound(ideatorBps, 100, 9900);

        // Submit, score, fund, claim
        uint256 ideaId = _submitScoreApproveAndClaim(ideator, builder, bountyAmount);

        // Override the ideator share for this idea
        marketplace.setIdeaSplit(ideaId, ideatorBps);

        // Builder submits work
        vm.prank(builder);
        marketplace.submitWork(ideaId, keccak256("proof"));

        // Compute expected amounts the same way the contract does
        uint256 expectedIdeatorReward = (bountyAmount * ideatorBps) / 10000;
        uint256 expectedBuilderReward = bountyAmount - expectedIdeatorReward;
        uint256 collateral = (bountyAmount * marketplace.builderCollateralBps()) / marketplace.BPS_PRECISION();

        // Snapshot balances before approval
        uint256 ideatorBalBefore = vibeToken.balanceOf(ideator);
        uint256 builderBalBefore = vibeToken.balanceOf(builder);
        // Owner approves
        marketplace.approveWork(ideaId);

        uint256 ideatorBalAfter = vibeToken.balanceOf(ideator);
        uint256 builderBalAfter = vibeToken.balanceOf(builder);

        // Ideator receives: reward + stake return
        uint256 ideatorGain = ideatorBalAfter - ideatorBalBefore;
        assertEq(ideatorGain, expectedIdeatorReward + STAKE, "Ideator should get reward + stake");

        // Builder receives: reward + collateral return
        uint256 builderGain = builderBalAfter - builderBalBefore;
        assertEq(builderGain, expectedBuilderReward + collateral, "Builder should get reward + collateral");

        // Conservation: rewards sum to bounty
        assertEq(expectedIdeatorReward + expectedBuilderReward, bountyAmount, "Shapley split must sum to bounty");
    }

    /// @notice Submitting work within deadline should succeed
    function testFuzz_submitWork_withinDeadline(uint256 timeElapsed) public {
        uint256 deadline = marketplace.buildDeadline();
        timeElapsed = bound(timeElapsed, 0, deadline - 1);

        uint256 ideaId = _submitScoreApproveAndClaim(ideator, builder, 10e18);

        // Warp forward but stay within deadline
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        vm.warp(idea.claimedAt + timeElapsed);

        vm.prank(builder);
        marketplace.submitWork(ideaId, keccak256("proof"));

        IIdeaMarketplace.Idea memory ideaAfter = marketplace.getIdea(ideaId);
        assertEq(uint8(ideaAfter.status), uint8(IIdeaMarketplace.IdeaStatus.REVIEW), "Should be in REVIEW");
        assertEq(ideaAfter.proofHash, keccak256("proof"), "Proof hash mismatch");
    }

    /// @notice Submitting work after deadline should revert
    function testFuzz_submitWork_afterDeadline(uint256 timeElapsed) public {
        uint256 deadline = marketplace.buildDeadline();
        timeElapsed = bound(timeElapsed, deadline + 1, type(uint128).max);

        uint256 ideaId = _submitScoreApproveAndClaim(ideator, builder, 10e18);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        vm.warp(idea.claimedAt + timeElapsed);

        vm.prank(builder);
        vm.expectRevert(IIdeaMarketplace.DeadlineExpired.selector);
        marketplace.submitWork(ideaId, keccak256("proof"));
    }

    /// @notice Three scorers with low scores should auto-reject (avg < 15)
    function testFuzz_autoReject_belowThreshold(
        uint8 f1, uint8 i1, uint8 n1,
        uint8 f2, uint8 i2, uint8 n2,
        uint8 f3, uint8 i3, uint8 n3
    ) public {
        // Bound each dimension to 0-10
        f1 = uint8(bound(f1, 0, 10));
        i1 = uint8(bound(i1, 0, 10));
        n1 = uint8(bound(n1, 0, 10));
        f2 = uint8(bound(f2, 0, 10));
        i2 = uint8(bound(i2, 0, 10));
        n2 = uint8(bound(n2, 0, 10));
        f3 = uint8(bound(f3, 0, 10));
        i3 = uint8(bound(i3, 0, 10));
        n3 = uint8(bound(n3, 0, 10));

        // Compute totals and average
        uint256 total1 = uint256(f1) + uint256(i1) + uint256(n1);
        uint256 total2 = uint256(f2) + uint256(i2) + uint256(n2);
        uint256 total3 = uint256(f3) + uint256(i3) + uint256(n3);
        uint256 sum = total1 + total2 + total3;
        uint256 avg = sum / 3;

        // Only proceed if average is below AUTO_REJECT_THRESHOLD (15)
        vm.assume(avg < 15);

        uint256 ideaId = _submitIdea();

        vm.prank(scorer1);
        marketplace.scoreIdea(ideaId, f1, i1, n1);
        vm.prank(scorer2);
        marketplace.scoreIdea(ideaId, f2, i2, n2);
        vm.prank(scorer3);
        marketplace.scoreIdea(ideaId, f3, i3, n3);

        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint8(idea.status), uint8(IIdeaMarketplace.IdeaStatus.REJECTED), "Should be auto-rejected");
        assertEq(idea.score, avg, "Score should be average");
    }

    /// @notice Three scorers with high scores should auto-approve (avg >= 24)
    function testFuzz_autoApprove_aboveThreshold(uint256 seed) public {
        // Generate 9 scores in [8,10] range from seed to guarantee avg >= 24
        // Each scorer total >= 24, so average >= 24
        uint8 f1 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 i1 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 n1 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 f2 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 i2 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 n2 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 f3 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 i3 = uint8(8 + (seed % 3)); seed = seed / 3;
        uint8 n3 = uint8(8 + (seed % 3));

        uint256 total1 = uint256(f1) + uint256(i1) + uint256(n1);
        uint256 total2 = uint256(f2) + uint256(i2) + uint256(n2);
        uint256 total3 = uint256(f3) + uint256(i3) + uint256(n3);
        uint256 sum = total1 + total2 + total3;
        uint256 avg = sum / 3;

        uint256 ideaId = _submitIdea();

        vm.prank(scorer1);
        marketplace.scoreIdea(ideaId, f1, i1, n1);
        vm.prank(scorer2);
        marketplace.scoreIdea(ideaId, f2, i2, n2);
        vm.prank(scorer3);
        marketplace.scoreIdea(ideaId, f3, i3, n3);

        // Auto-approve keeps status OPEN (idea is approved for claiming, not transitioned)
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        assertEq(uint8(idea.status), uint8(IIdeaMarketplace.IdeaStatus.OPEN), "Should stay OPEN (auto-approved)");
        assertEq(idea.score, avg, "Score should be average");
        assertTrue(idea.score >= 24, "Score must be >= 24 for auto-approve");
    }

    /// @notice Reclaiming an expired idea should work after deadline passes
    function testFuzz_reclaimExpired_afterDeadline(uint256 extraTime) public {
        extraTime = bound(extraTime, 1, 365 days);

        uint256 bounty = 50e18;
        uint256 ideaId = _submitScoreApproveAndClaim(ideator, builder, bounty);

        uint256 expectedCollateral = (bounty * marketplace.builderCollateralBps()) / marketplace.BPS_PRECISION();
        uint256 treasuryBalBefore = vibeToken.balanceOf(treasury);

        // Warp past deadline
        IIdeaMarketplace.Idea memory idea = marketplace.getIdea(ideaId);
        vm.warp(idea.claimedAt + marketplace.buildDeadline() + extraTime);

        // Anyone can reclaim
        address reclaimer = makeAddr("reclaimer");
        vm.prank(reclaimer);
        marketplace.reclaimExpired(ideaId);

        // Verify idea is reopened
        IIdeaMarketplace.Idea memory ideaAfter = marketplace.getIdea(ideaId);
        assertEq(uint8(ideaAfter.status), uint8(IIdeaMarketplace.IdeaStatus.OPEN), "Should reopen to OPEN");
        assertEq(ideaAfter.builder, address(0), "Builder should be cleared");
        assertEq(ideaAfter.claimedAt, 0, "ClaimedAt should be reset");

        // Verify collateral was slashed to treasury
        uint256 treasuryBalAfter = vibeToken.balanceOf(treasury);
        assertEq(treasuryBalAfter - treasuryBalBefore, expectedCollateral, "Treasury should receive slashed collateral");
        assertEq(marketplace.builderCollateral(ideaId), 0, "Stored collateral should be zeroed");
    }
}
