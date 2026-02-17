// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/VibeCode.sol";

contract VibeCodeTest is Test {
    // Re-declare events for expectEmit
    event ContributionRecorded(address indexed user, IVibeCode.ContributionCategory indexed category, uint256 value, bytes32 evidenceHash);
    event VibeCodeRefreshed(address indexed user, bytes32 oldCode, bytes32 newCode, uint256 reputationScore);

    VibeCode public vibeCode;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public source; // Authorized source (e.g., ContributionAttestor)

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        source = makeAddr("source");

        vibeCode = new VibeCode();
        vibeCode.setAuthorizedSource(source, true);
    }

    // ============ Helpers ============

    function _record(address user, IVibeCode.ContributionCategory cat, uint256 value) internal {
        vm.prank(source);
        vibeCode.recordContribution(user, cat, value, bytes32("evidence"));
    }

    function _recordAndRefresh(address user, IVibeCode.ContributionCategory cat, uint256 value) internal {
        _record(user, cat, value);
        vibeCode.refreshVibeCode(user);
    }

    // ============ Constructor ============

    function test_constructor_setsOwner() public view {
        assertEq(vibeCode.owner(), owner);
    }

    function test_constructor_noActiveProfiles() public view {
        assertEq(vibeCode.getActiveProfileCount(), 0);
    }

    // ============ Authorization ============

    function test_setAuthorizedSource_success() public {
        address newSource = makeAddr("newSource");
        vibeCode.setAuthorizedSource(newSource, true);
        assertTrue(vibeCode.authorizedSources(newSource));
    }

    function test_setAuthorizedSource_revoke() public {
        vibeCode.setAuthorizedSource(source, false);
        assertFalse(vibeCode.authorizedSources(source));
    }

    function test_setAuthorizedSource_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vibeCode.setAuthorizedSource(alice, true);
    }

    function test_setAuthorizedSource_zeroAddress_reverts() public {
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.setAuthorizedSource(address(0), true);
    }

    function test_ownerCanRecordWithoutAuthorization() public {
        // Owner is implicitly authorized
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 1e18, bytes32("test"));
        assertTrue(vibeCode.isActive(alice));
    }

    // ============ Record Contribution ============

    function test_recordContribution_firstContribution_initializesProfile() public {
        assertFalse(vibeCode.isActive(alice));
        assertEq(vibeCode.getActiveProfileCount(), 0);

        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        assertTrue(vibeCode.isActive(alice));
        assertEq(vibeCode.getActiveProfileCount(), 1);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.totalContributions, 1);
        assertGt(profile.firstActiveAt, 0);
        assertEq(profile.lastActiveAt, block.timestamp);
    }

    function test_recordContribution_accumulatesCategory() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        _record(alice, IVibeCode.ContributionCategory.CODE, 200e18);

        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE), 300e18);
    }

    function test_recordContribution_multipleCategories() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        _record(alice, IVibeCode.ContributionCategory.IDEA, 50e18);
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, 10e18);

        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE), 100e18);
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.IDEA), 50e18);
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.ATTESTATION), 10e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.totalContributions, 3);
    }

    function test_recordContribution_multipleUsers() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        _record(bob, IVibeCode.ContributionCategory.IDEA, 200e18);

        assertEq(vibeCode.getActiveProfileCount(), 2);
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE), 100e18);
        assertEq(vibeCode.getCategoryValue(bob, IVibeCode.ContributionCategory.IDEA), 200e18);
    }

    function test_recordContribution_unauthorized_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCode.UnauthorizedSource.selector);
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 100e18, bytes32("x"));
    }

    function test_recordContribution_zeroAddress_reverts() public {
        vm.prank(source);
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.recordContribution(address(0), IVibeCode.ContributionCategory.CODE, 100e18, bytes32("x"));
    }

    function test_recordContribution_zeroValue_reverts() public {
        vm.prank(source);
        vm.expectRevert(IVibeCode.ZeroValue.selector);
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 0, bytes32("x"));
    }

    function test_recordContribution_emitsEvent() public {
        vm.prank(source);
        vm.expectEmit(true, true, false, true);
        emit ContributionRecorded(alice, IVibeCode.ContributionCategory.CODE, 100e18, bytes32("ev"));
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 100e18, bytes32("ev"));
    }

    function test_recordContribution_activeProfileCountOnlyIncrementsOnce() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);
        assertEq(vibeCode.getActiveProfileCount(), 1);

        _record(alice, IVibeCode.ContributionCategory.IDEA, 1e18);
        assertEq(vibeCode.getActiveProfileCount(), 1); // Still 1
    }

    // ============ Refresh Vibe Code ============

    function test_refreshVibeCode_computesHash() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        assertEq(vibeCode.getVibeCode(alice), bytes32(0)); // Not yet computed

        vibeCode.refreshVibeCode(alice);

        assertNotEq(vibeCode.getVibeCode(alice), bytes32(0));
    }

    function test_refreshVibeCode_deterministic() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        vibeCode.refreshVibeCode(alice); // Same inputs → same output
        bytes32 code2 = vibeCode.getVibeCode(alice);

        assertEq(code1, code2);
    }

    function test_refreshVibeCode_changesWithNewContributions() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        _record(alice, IVibeCode.ContributionCategory.CODE, 1000e18);
        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        assertNotEq(code1, code2, "Vibe code must change with new contributions");
    }

    function test_refreshVibeCode_noProfile_reverts() public {
        vm.expectRevert(IVibeCode.NoProfile.selector);
        vibeCode.refreshVibeCode(alice);
    }

    function test_refreshVibeCode_zeroAddress_reverts() public {
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.refreshVibeCode(address(0));
    }

    function test_refreshVibeCode_emitsEvent() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        vm.expectEmit(true, false, false, false);
        emit VibeCodeRefreshed(alice, bytes32(0), bytes32(0), 0);
        vibeCode.refreshVibeCode(alice);
    }

    function test_refreshVibeCode_permissionless() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        // Anyone can refresh — bob refreshes alice's code
        vm.prank(bob);
        vibeCode.refreshVibeCode(alice);

        assertNotEq(vibeCode.getVibeCode(alice), bytes32(0));
    }

    function test_refreshVibeCode_setsLastRefreshed() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.lastRefreshed, block.timestamp);
    }

    // ============ Score Computation ============

    function test_builderScore_codeContributions() public {
        // 1024e18 CODE → log2(1024+1) ≈ 10 → 10 * 200 = 2000
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 1024e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 2000);
    }

    function test_builderScore_combinesCodeExecutionReview() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 500e18);
        _record(alice, IVibeCode.ContributionCategory.EXECUTION, 300e18);
        _record(alice, IVibeCode.ContributionCategory.REVIEW, 200e18);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        // Total = 1000e18, log2(1000+1) ≈ 9, score = 9*200 = 1800
        assertEq(profile.builderScore, 1800);
    }

    function test_builderScore_cappedAtMax() public {
        // 2^16 = 65536 → log2(65536+1) ≈ 16 → 16*200 = 3200 → capped at 3000
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 65536e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, vibeCode.BUILDER_MAX());
    }

    function test_funderScore_ideaFunding() public {
        // 100e18 IDEA → log2(100+1) ≈ 6 → 6 * 140 = 840
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.IDEA, 100e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.funderScore, 840);
    }

    function test_funderScore_cappedAtMax() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.IDEA, 1_000_000e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertLe(profile.funderScore, vibeCode.FUNDER_MAX());
    }

    function test_ideatorScore_linear() public {
        // 5 ideas (5e18 DESIGN) → 5 * 150 = 750
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.DESIGN, 5e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.ideatorScore, 750);
    }

    function test_ideatorScore_cappedAtMax() public {
        // 20 ideas → 20 * 150 = 3000 → capped at 1500
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.DESIGN, 20e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.ideatorScore, vibeCode.IDEATOR_MAX());
    }

    function test_communityScore_attestationsAndGovernance() public {
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, 50e18);
        _record(alice, IVibeCode.ContributionCategory.GOVERNANCE, 30e18);
        _record(alice, IVibeCode.ContributionCategory.COMMUNITY, 20e18);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        // Total = 100e18, log2(100+1) ≈ 6, score = 6 * 140 = 840
        assertEq(profile.communityScore, 840);
    }

    function test_longevityScore_grows() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);

        vm.warp(block.timestamp + 30 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        // 30 days * 4 = 120
        assertEq(profile.longevityScore, 120);
    }

    function test_longevityScore_cappedAtMax() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);

        vm.warp(block.timestamp + 730 days); // ~2 years
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.longevityScore, vibeCode.LONGEVITY_MAX());
    }

    function test_longevityScore_zeroOnSameDay() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 1e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.longevityScore, 0);
    }

    function test_reputationScore_sumOfDimensions() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 100e18);       // builder: log2(101)*200 = 6*200 = 1200
        _record(alice, IVibeCode.ContributionCategory.IDEA, 50e18);        // funder: log2(51)*140 = 5*140 = 700
        _record(alice, IVibeCode.ContributionCategory.DESIGN, 3e18);       // ideator: 3*150 = 450
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, 10e18); // community: log2(11)*140 = 3*140 = 420
        vm.warp(block.timestamp + 10 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        uint256 expectedTotal = profile.builderScore
            + profile.funderScore
            + profile.ideatorScore
            + profile.communityScore
            + profile.longevityScore;
        assertEq(profile.reputationScore, expectedTotal);
    }

    function test_reputationScore_maxIs10000() public {
        // Max out every dimension
        _record(alice, IVibeCode.ContributionCategory.CODE, 1_000_000e18);
        _record(alice, IVibeCode.ContributionCategory.IDEA, 1_000_000e18);
        _record(alice, IVibeCode.ContributionCategory.DESIGN, 100e18);
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, 1_000_000e18);
        vm.warp(block.timestamp + 730 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertLe(profile.reputationScore, vibeCode.MAX_SCORE());
    }

    // ============ Visual Seed ============

    function test_visualSeed_derivedFromHash() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        assertTrue(seed.hue < 360);
        assertTrue(seed.pattern < 16);
        assertTrue(seed.border < 16);
        assertTrue(seed.glow < 16);
        assertTrue(seed.shape < 16);
        assertTrue(seed.background < 16);
    }

    function test_visualSeed_zeroForNoProfile() public view {
        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        assertEq(seed.hue, 0);
        assertEq(seed.pattern, 0);
    }

    function test_visualSeed_deterministicFromHash() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        IVibeCode.VisualSeed memory seed1 = vibeCode.getVisualSeed(alice);

        vibeCode.refreshVibeCode(alice); // Refresh again, same inputs
        IVibeCode.VisualSeed memory seed2 = vibeCode.getVisualSeed(alice);

        assertEq(seed1.hue, seed2.hue);
        assertEq(seed1.pattern, seed2.pattern);
        assertEq(seed1.border, seed2.border);
    }

    function test_visualSeed_differentUsersGetDifferentSeeds() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 100e18);
        _recordAndRefresh(bob, IVibeCode.ContributionCategory.CODE, 100e18);

        IVibeCode.VisualSeed memory seedA = vibeCode.getVisualSeed(alice);
        IVibeCode.VisualSeed memory seedB = vibeCode.getVisualSeed(bob);

        // Different users with same contributions get different seeds (address is in the hash)
        bytes32 codeA = vibeCode.getVibeCode(alice);
        bytes32 codeB = vibeCode.getVibeCode(bob);
        assertNotEq(codeA, codeB);
        // Visual seed components may or may not differ (modular arithmetic), but codes differ
    }

    // ============ Display Code ============

    function test_displayCode_first4Bytes() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 100e18);

        bytes4 display = vibeCode.getDisplayCode(alice);
        bytes32 code = vibeCode.getVibeCode(alice);
        assertEq(display, bytes4(code));
    }

    function test_displayCode_zeroForNoProfile() public view {
        assertEq(vibeCode.getDisplayCode(alice), bytes4(0));
    }

    // ============ isActive ============

    function test_isActive_falseBeforeContribution() public view {
        assertFalse(vibeCode.isActive(alice));
    }

    function test_isActive_trueAfterContribution() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, 1e18);
        assertTrue(vibeCode.isActive(alice));
    }

    // ============ Different Profiles Produce Different Codes ============

    function test_differentProfilesDifferentCodes() public {
        // Alice: heavy builder
        _record(alice, IVibeCode.ContributionCategory.CODE, 10_000e18);
        vibeCode.refreshVibeCode(alice);

        // Bob: heavy funder
        _record(bob, IVibeCode.ContributionCategory.IDEA, 10_000e18);
        vibeCode.refreshVibeCode(bob);

        assertNotEq(vibeCode.getVibeCode(alice), vibeCode.getVibeCode(bob));
    }

    // ============ Log2 Edge Cases (via score computation) ============

    function test_builderScore_zeroForNoContributions() public {
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.IDEA, 100e18); // Not builder category

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 0);
    }

    function test_builderScore_smallContribution() public {
        // Less than 1e18 → scaled to 0 → log2(0+1) = 0 → score = 0
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 0.5e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 0);
    }

    function test_builderScore_exactlyOneToken() public {
        // 1e18 CODE → scaled = 1, log2(1+1) = 1, score = 200
        _recordAndRefresh(alice, IVibeCode.ContributionCategory.CODE, 1e18);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 200);
    }
}
