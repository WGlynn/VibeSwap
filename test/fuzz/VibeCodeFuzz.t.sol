// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/VibeCode.sol";

contract VibeCodeFuzzTest is Test {
    VibeCode public vibeCode;

    address public source;
    address public alice;

    uint256 public constant MAX_VALUE = 100_000_000e18;

    function setUp() public {
        alice = makeAddr("alice");
        source = makeAddr("source");

        vibeCode = new VibeCode();
        vibeCode.setAuthorizedSource(source, true);
    }

    // ============ Helpers ============

    function _record(address user, IVibeCode.ContributionCategory cat, uint256 value) internal {
        vm.prank(source);
        vibeCode.recordContribution(user, cat, value, bytes32("ev"));
    }

    // ============ Fuzz: Reputation score always bounded ============

    function testFuzz_reputationScoreBounded(
        uint256 codeVal,
        uint256 ideaVal,
        uint256 designVal,
        uint256 attestVal,
        uint256 timeSkip
    ) public {
        codeVal = bound(codeVal, 1e18, MAX_VALUE);
        ideaVal = bound(ideaVal, 1e18, MAX_VALUE);
        designVal = bound(designVal, 1e18, MAX_VALUE);
        attestVal = bound(attestVal, 1e18, MAX_VALUE);
        timeSkip = bound(timeSkip, 0, 1460 days); // up to 4 years

        _record(alice, IVibeCode.ContributionCategory.CODE, codeVal);
        _record(alice, IVibeCode.ContributionCategory.IDEA, ideaVal);
        _record(alice, IVibeCode.ContributionCategory.DESIGN, designVal);
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, attestVal);

        vm.warp(block.timestamp + timeSkip);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);

        assertLe(profile.reputationScore, vibeCode.MAX_SCORE(), "Score must be <= 10000");
        assertLe(profile.builderScore, vibeCode.BUILDER_MAX(), "Builder must be <= 3000");
        assertLe(profile.funderScore, vibeCode.FUNDER_MAX(), "Funder must be <= 2000");
        assertLe(profile.ideatorScore, vibeCode.IDEATOR_MAX(), "Ideator must be <= 1500");
        assertLe(profile.communityScore, vibeCode.COMMUNITY_MAX(), "Community must be <= 2000");
        assertLe(profile.longevityScore, vibeCode.LONGEVITY_MAX(), "Longevity must be <= 1500");
    }

    // ============ Fuzz: Vibe code deterministic ============

    function testFuzz_vibeCodeDeterministic(uint256 codeVal) public {
        codeVal = bound(codeVal, 1e18, MAX_VALUE);

        _record(alice, IVibeCode.ContributionCategory.CODE, codeVal);

        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        assertEq(code1, code2, "Same inputs must produce same vibe code");
    }

    // ============ Fuzz: More contributions → higher or equal score ============

    function testFuzz_moreContributionsHigherScore(uint256 val1, uint256 val2) public {
        val1 = bound(val1, 1e18, 1_000e18);
        val2 = bound(val2, 1e18, MAX_VALUE);

        // Record small contribution
        _record(alice, IVibeCode.ContributionCategory.CODE, val1);
        vibeCode.refreshVibeCode(alice);
        uint256 score1 = vibeCode.getReputationScore(alice);

        // Record more
        _record(alice, IVibeCode.ContributionCategory.CODE, val2);
        vibeCode.refreshVibeCode(alice);
        uint256 score2 = vibeCode.getReputationScore(alice);

        assertGe(score2, score1, "More contributions must give >= score");
    }

    // ============ Fuzz: Different users produce different codes ============

    function testFuzz_differentUsersDifferentCodes(uint256 val) public {
        val = bound(val, 1e18, MAX_VALUE);

        address bob = makeAddr("bob");

        _record(alice, IVibeCode.ContributionCategory.CODE, val);
        _record(bob, IVibeCode.ContributionCategory.CODE, val);

        vibeCode.refreshVibeCode(alice);
        vibeCode.refreshVibeCode(bob);

        assertNotEq(
            vibeCode.getVibeCode(alice),
            vibeCode.getVibeCode(bob),
            "Different users must have different vibe codes"
        );
    }

    // ============ Fuzz: Visual seed components bounded ============

    function testFuzz_visualSeedBounded(uint256 codeVal) public {
        codeVal = bound(codeVal, 1e18, MAX_VALUE);

        _record(alice, IVibeCode.ContributionCategory.CODE, codeVal);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        assertTrue(seed.hue < 360, "Hue must be < 360");
        assertTrue(seed.pattern < 16, "Pattern must be < 16");
        assertTrue(seed.border < 16, "Border must be < 16");
        assertTrue(seed.glow < 16, "Glow must be < 16");
        assertTrue(seed.shape < 16, "Shape must be < 16");
        assertTrue(seed.background < 16, "Background must be < 16");
    }

    // ============ Fuzz: Category values accumulate correctly ============

    function testFuzz_categoryValuesAccumulate(uint256 val1, uint256 val2) public {
        val1 = bound(val1, 1e18, MAX_VALUE / 2);
        val2 = bound(val2, 1e18, MAX_VALUE / 2);

        _record(alice, IVibeCode.ContributionCategory.CODE, val1);
        _record(alice, IVibeCode.ContributionCategory.CODE, val2);

        assertEq(
            vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE),
            val1 + val2,
            "Category values must accumulate"
        );
    }

    // ============ Fuzz: Longevity grows with time ============

    function testFuzz_longevityGrowsWithTime(uint256 days1, uint256 days2) public {
        days1 = bound(days1, 1, 365);
        days2 = bound(days2, days1 + 1, 730);

        _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);
        uint256 startTime = block.timestamp;

        vm.warp(startTime + days1 * 1 days);
        vibeCode.refreshVibeCode(alice);
        uint256 score1 = vibeCode.getProfile(alice).longevityScore;

        vm.warp(startTime + days2 * 1 days);
        vibeCode.refreshVibeCode(alice);
        uint256 score2 = vibeCode.getProfile(alice).longevityScore;

        assertGe(score2, score1, "Longevity must grow with time");
    }

    // ============ Fuzz: Contribution count tracks correctly ============

    function testFuzz_contributionCountCorrect(uint256 numContribs) public {
        numContribs = bound(numContribs, 1, 50);

        for (uint256 i = 0; i < numContribs; i++) {
            _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);
        }

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.totalContributions, numContribs, "Contribution count must match");
    }

    // ============ Fuzz: Log2 scaling reduces whale advantage ============

    function testFuzz_logScalingReducesWhaleAdvantage(uint256 smallVal, uint256 largeMultiplier) public {
        smallVal = bound(smallVal, 10e18, 100e18);
        largeMultiplier = bound(largeMultiplier, 10, 10000);
        uint256 largeVal = smallVal * largeMultiplier;

        // Small contributor
        _record(alice, IVibeCode.ContributionCategory.CODE, smallVal);
        vibeCode.refreshVibeCode(alice);
        uint256 smallScore = vibeCode.getProfile(alice).builderScore;

        // Large contributor (10-10000x more)
        address whale = makeAddr("whale");
        _record(whale, IVibeCode.ContributionCategory.CODE, largeVal);
        vibeCode.refreshVibeCode(whale);
        uint256 whaleScore = vibeCode.getProfile(whale).builderScore;

        // Whale should NOT have proportional advantage
        // If whale has 100x value, they should have ~3.3x score (log2(100) ≈ 6.6, vs log2(1) = 0)
        // But definitely less than multiplier * smallScore
        if (smallScore > 0) {
            assertTrue(
                whaleScore < smallScore * largeMultiplier,
                "Log scaling must reduce whale advantage"
            );
        }
    }

    // ============ Fuzz: Display code is first 4 bytes of vibe code ============

    function testFuzz_displayCodeMatchesVibeCode(uint256 val) public {
        val = bound(val, 1e18, MAX_VALUE);

        _record(alice, IVibeCode.ContributionCategory.CODE, val);
        vibeCode.refreshVibeCode(alice);

        bytes32 code = vibeCode.getVibeCode(alice);
        bytes4 display = vibeCode.getDisplayCode(alice);

        assertEq(display, bytes4(code), "Display code must be first 4 bytes of vibe code");
    }

    // ============ Fuzz: Vibe code changes with new contributions ============

    function testFuzz_vibeCodeChangesWithContributions(uint256 val1, uint256 val2) public {
        val1 = bound(val1, 1e18, MAX_VALUE / 2);
        val2 = bound(val2, 1e18, MAX_VALUE / 2);

        _record(alice, IVibeCode.ContributionCategory.CODE, val1);
        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        _record(alice, IVibeCode.ContributionCategory.CODE, val2);
        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        // Score must change (more contributions → different log2) unless both map to same log
        // The vibe code includes totalContributions which always differs, so hash changes
        assertNotEq(code1, code2, "Code must change with new contributions");
    }
}
