// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/VibeCode.sol";
import "../../contracts/identity/interfaces/IVibeCode.sol";

// ============ Test Contract ============

/**
 * @title VibeCode Unit Tests
 * @notice Comprehensive tests for the deterministic identity fingerprint system.
 * @dev Covers:
 *      - Constructor and initialization
 *      - Authorized source management
 *      - Contribution recording (all categories)
 *      - VibeCode refresh and score computation
 *      - Logarithmic scaling (breadth > depth)
 *      - Dimension score capping
 *      - Longevity scoring
 *      - Visual seed generation
 *      - Display code
 *      - View functions and edge cases
 *      - Fuzz tests for score bounds
 */
contract VibeCodeTest is Test {

    // Re-declare events for expectEmit
    event ContributionRecorded(
        address indexed user,
        IVibeCode.ContributionCategory indexed category,
        uint256 value,
        bytes32 evidenceHash
    );
    event VibeCodeRefreshed(
        address indexed user,
        bytes32 oldCode,
        bytes32 newCode,
        uint256 reputationScore
    );
    event SourceAuthorized(address indexed source, bool authorized);

    VibeCode public vibeCode;

    address public owner;
    address public alice;
    address public bob;
    address public authorizedSource;
    address public unauthorizedUser;

    uint256 public constant PRECISION = 1e18;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        authorizedSource = makeAddr("authorizedSource");
        unauthorizedUser = makeAddr("unauthorizedUser");

        vibeCode = new VibeCode();

        // Authorize source
        vibeCode.setAuthorizedSource(authorizedSource, true);
    }

    // ============ Helpers ============

    /// @dev Record a contribution as the authorized source
    function _record(
        address user,
        IVibeCode.ContributionCategory category,
        uint256 value
    ) internal {
        vm.prank(authorizedSource);
        vibeCode.recordContribution(user, category, value, bytes32(0));
    }

    /// @dev Record contribution with evidence hash
    function _recordWithEvidence(
        address user,
        IVibeCode.ContributionCategory category,
        uint256 value,
        bytes32 evidenceHash
    ) internal {
        vm.prank(authorizedSource);
        vibeCode.recordContribution(user, category, value, evidenceHash);
    }

    // ================================================================
    //                  CONSTRUCTOR TESTS
    // ================================================================

    function test_constructor_setsOwner() public view {
        assertEq(vibeCode.owner(), owner);
    }

    function test_constructor_zeroActiveProfiles() public view {
        assertEq(vibeCode.activeProfileCount(), 0);
    }

    function test_constructor_constants() public view {
        assertEq(vibeCode.MAX_SCORE(), 10000);
        assertEq(vibeCode.BUILDER_MAX(), 3000);
        assertEq(vibeCode.FUNDER_MAX(), 2000);
        assertEq(vibeCode.IDEATOR_MAX(), 1500);
        assertEq(vibeCode.COMMUNITY_MAX(), 2000);
        assertEq(vibeCode.LONGEVITY_MAX(), 1500);
        assertEq(vibeCode.PRECISION(), 1e18);
    }

    // ================================================================
    //                  AUTHORIZED SOURCE MANAGEMENT
    // ================================================================

    function test_setAuthorizedSource_grantsAccess() public {
        address newSource = makeAddr("newSource");

        vm.expectEmit(true, false, false, true);
        emit SourceAuthorized(newSource, true);
        vibeCode.setAuthorizedSource(newSource, true);

        assertTrue(vibeCode.authorizedSources(newSource));
    }

    function test_setAuthorizedSource_revokesAccess() public {
        vibeCode.setAuthorizedSource(authorizedSource, false);
        assertFalse(vibeCode.authorizedSources(authorizedSource));
    }

    function test_setAuthorizedSource_revertsOnZeroAddress() public {
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.setAuthorizedSource(address(0), true);
    }

    function test_setAuthorizedSource_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        vibeCode.setAuthorizedSource(makeAddr("src"), true);
    }

    // ================================================================
    //                  RECORD CONTRIBUTION
    // ================================================================

    function test_recordContribution_createsProfile() public {
        assertFalse(vibeCode.isActive(alice));
        assertEq(vibeCode.activeProfileCount(), 0);

        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        assertTrue(vibeCode.isActive(alice));
        assertEq(vibeCode.activeProfileCount(), 1);
    }

    function test_recordContribution_emitsEvent() public {
        bytes32 evidence = keccak256("commit:abc123");

        vm.prank(authorizedSource);
        vm.expectEmit(true, true, false, true);
        emit ContributionRecorded(alice, IVibeCode.ContributionCategory.CODE, PRECISION, evidence);
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, PRECISION, evidence);
    }

    function test_recordContribution_accumulatesCategoryValue() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.CODE, 2 * PRECISION);

        uint256 codeValue = vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE);
        assertEq(codeValue, 3 * PRECISION);
    }

    function test_recordContribution_tracksSeparateCategories() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.REVIEW, 2 * PRECISION);
        _record(alice, IVibeCode.ContributionCategory.IDEA, 3 * PRECISION);

        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE), PRECISION);
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.REVIEW), 2 * PRECISION);
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.IDEA), 3 * PRECISION);
    }

    function test_recordContribution_incrementsTotalContributions() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.REVIEW, PRECISION);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.totalContributions, 3);
    }

    function test_recordContribution_setsFirstAndLastActive() public {
        uint256 t1 = block.timestamp;
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.firstActiveAt, t1);
        assertEq(profile.lastActiveAt, t1);

        vm.warp(t1 + 100 days);
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        profile = vibeCode.getProfile(alice);
        assertEq(profile.firstActiveAt, t1); // unchanged
        assertEq(profile.lastActiveAt, t1 + 100 days); // updated
    }

    function test_recordContribution_profileCountOnlyIncrementsOnce() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.REVIEW, PRECISION);

        assertEq(vibeCode.activeProfileCount(), 1);
    }

    function test_recordContribution_multipleUsers() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(bob, IVibeCode.ContributionCategory.REVIEW, PRECISION);

        assertEq(vibeCode.activeProfileCount(), 2);
        assertTrue(vibeCode.isActive(alice));
        assertTrue(vibeCode.isActive(bob));
    }

    function test_recordContribution_revertsOnZeroAddress() public {
        vm.prank(authorizedSource);
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.recordContribution(address(0), IVibeCode.ContributionCategory.CODE, PRECISION, bytes32(0));
    }

    function test_recordContribution_revertsOnZeroValue() public {
        vm.prank(authorizedSource);
        vm.expectRevert(IVibeCode.ZeroValue.selector);
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, 0, bytes32(0));
    }

    function test_recordContribution_revertsForUnauthorized() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(IVibeCode.UnauthorizedSource.selector);
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, PRECISION, bytes32(0));
    }

    function test_recordContribution_ownerCanRecordDirectly() public {
        // Owner is always authorized
        vibeCode.recordContribution(alice, IVibeCode.ContributionCategory.CODE, PRECISION, bytes32(0));
        assertTrue(vibeCode.isActive(alice));
    }

    // ================================================================
    //                  REFRESH VIBE CODE
    // ================================================================

    function test_refreshVibeCode_generatesCodeHash() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.vibeCode != bytes32(0));
        assertTrue(profile.lastRefreshed > 0);
    }

    function test_refreshVibeCode_emitsEvent() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        vm.expectEmit(true, false, false, false);
        emit VibeCodeRefreshed(alice, bytes32(0), bytes32(0), 0);
        vibeCode.refreshVibeCode(alice);
    }

    function test_refreshVibeCode_revertsOnZeroAddress() public {
        vm.expectRevert(IVibeCode.ZeroAddress.selector);
        vibeCode.refreshVibeCode(address(0));
    }

    function test_refreshVibeCode_revertsOnNoProfile() public {
        vm.expectRevert(IVibeCode.NoProfile.selector);
        vibeCode.refreshVibeCode(alice);
    }

    function test_refreshVibeCode_isDeterministic() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        // Same state → same code
        assertEq(code1, code2);
    }

    function test_refreshVibeCode_changesWithNewContributions() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        // Add more contributions
        _record(alice, IVibeCode.ContributionCategory.CODE, 10 * PRECISION);
        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        // Code should change (new contributions alter the score)
        assertTrue(code1 != code2, "VibeCode should change with new contributions");
    }

    function test_refreshVibeCode_isPermissionless() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        // Anyone can refresh anyone's vibe code
        vm.prank(bob);
        vibeCode.refreshVibeCode(alice);

        assertTrue(vibeCode.getVibeCode(alice) != bytes32(0));
    }

    // ================================================================
    //                  SCORE COMPUTATION
    // ================================================================

    function test_builderScore_fromCodeContributions() public {
        // CODE is a builder category
        // scaled = 1 (since PRECISION/PRECISION = 1), log2(2)=1, score = 1*200 = 200
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 200); // log2(1+1) = 1 → 1 * 200
    }

    function test_builderScore_combinesCodeExecutionReview() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.EXECUTION, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.REVIEW, PRECISION);
        // Total = 3e18. scaled = 3. log2(4) = 2. score = 400.
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.builderScore, 400); // log2(3+1) = 2 → 2 * 200
    }

    function test_builderScore_logarithmicScaling() public {
        // 1e18 (1 unit) → log2(2) = 1 → 200
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);
        IVibeCode.VibeProfile memory p1 = vibeCode.getProfile(alice);

        // 1023e18 (1023 units) → log2(1024) = 10 → 2000
        _record(bob, IVibeCode.ContributionCategory.CODE, 1023 * PRECISION);
        vibeCode.refreshVibeCode(bob);
        IVibeCode.VibeProfile memory p2 = vibeCode.getProfile(bob);

        // 1023x more value → only 10x more score (logarithmic)
        assertEq(p1.builderScore, 200);
        assertEq(p2.builderScore, 2000);
    }

    function test_builderScore_cappedAtMax() public {
        // Need log2(scaled+1) * 200 > 3000 → log2(scaled+1) > 15 → scaled+1 > 32768
        // So 32768e18 should cap at 3000
        _record(alice, IVibeCode.ContributionCategory.CODE, 32768 * PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        // log2(32769) = 15 → 15*200=3000 (exactly at cap)
        assertEq(profile.builderScore, 3000);
    }

    function test_funderScore_fromIdeaCategory() public {
        // IDEA contributions → funder score
        _record(alice, IVibeCode.ContributionCategory.IDEA, PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        // log2(1+1) = 1 → 1 * 140 = 140
        assertEq(profile.funderScore, 140);
    }

    function test_funderScore_cappedAtMax() public {
        // Need score > 2000 → log2(scaled+1)*140 > 2000 → log2(scaled+1) > 14.28 → 15
        // 2^15 = 32768, so 32767e18 → log2(32768) = 15 → 15*140 = 2100 > 2000 → capped at 2000
        _record(alice, IVibeCode.ContributionCategory.IDEA, 32767 * PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.funderScore, 2000); // capped
    }

    function test_ideatorScore_fromDesignCategory() public {
        // DESIGN contributions → ideator score (count-based: 1e18 per idea)
        _record(alice, IVibeCode.ContributionCategory.DESIGN, PRECISION); // 1 idea
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.ideatorScore, 150); // 1 * 150
    }

    function test_ideatorScore_linearScaling() public {
        _record(alice, IVibeCode.ContributionCategory.DESIGN, 5 * PRECISION); // 5 ideas
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.ideatorScore, 750); // 5 * 150
    }

    function test_ideatorScore_cappedAtMax() public {
        // 10 ideas → 10 * 150 = 1500 (exactly at cap)
        _record(alice, IVibeCode.ContributionCategory.DESIGN, 10 * PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.ideatorScore, 1500);

        // More ideas should stay capped
        _record(bob, IVibeCode.ContributionCategory.DESIGN, 20 * PRECISION);
        vibeCode.refreshVibeCode(bob);

        IVibeCode.VibeProfile memory profile2 = vibeCode.getProfile(bob);
        assertEq(profile2.ideatorScore, 1500); // still capped
    }

    function test_communityScore_fromAttestationGovernanceCommunity() public {
        _record(alice, IVibeCode.ContributionCategory.ATTESTATION, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.GOVERNANCE, PRECISION);
        _record(alice, IVibeCode.ContributionCategory.COMMUNITY, PRECISION);
        // Total = 3e18. scaled = 3. log2(4) = 2. score = 2*140 = 280
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.communityScore, 280);
    }

    function test_longevityScore_zeroOnSameDay() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.longevityScore, 0); // 0 days elapsed
    }

    function test_longevityScore_growsOverTime() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        vm.warp(block.timestamp + 30 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.longevityScore, 30 * 4); // 30 days * 4 points/day = 120
    }

    function test_longevityScore_cappedAtMax() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);

        // 1500 / 4 = 375 days to cap
        vm.warp(block.timestamp + 400 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.longevityScore, 1500); // capped
    }

    function test_compositeScore_sumOfDimensions() public {
        // Setup contributions across all dimensions
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);        // builder
        _record(alice, IVibeCode.ContributionCategory.IDEA, PRECISION);        // funder
        _record(alice, IVibeCode.ContributionCategory.DESIGN, PRECISION);      // ideator
        _record(alice, IVibeCode.ContributionCategory.COMMUNITY, PRECISION);   // community

        vm.warp(block.timestamp + 10 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory p = vibeCode.getProfile(alice);

        uint256 expectedComposite = p.builderScore + p.funderScore + p.ideatorScore + p.communityScore + p.longevityScore;
        assertEq(p.reputationScore, expectedComposite);
    }

    function test_zeroContributions_zeroScores() public {
        // Record minimum to create a profile, then check everything is minimal
        _record(alice, IVibeCode.ContributionCategory.CODE, 1); // tiny amount, below PRECISION
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory p = vibeCode.getProfile(alice);
        // value=1 < PRECISION, so scaled = 1/1e18 = 0, log2(0+1) = 0 → score = 0
        assertEq(p.builderScore, 0);
        assertEq(p.funderScore, 0);
        assertEq(p.ideatorScore, 0);
        assertEq(p.communityScore, 0);
        assertEq(p.longevityScore, 0);
        assertEq(p.reputationScore, 0);
    }

    // ================================================================
    //                  VISUAL SEED
    // ================================================================

    function test_getVisualSeed_zeroForNoCode() public view {
        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        assertEq(seed.hue, 0);
        assertEq(seed.pattern, 0);
        assertEq(seed.border, 0);
        assertEq(seed.glow, 0);
        assertEq(seed.shape, 0);
        assertEq(seed.background, 0);
    }

    function test_getVisualSeed_derivedFromCode() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        // hue should be 0-359, pattern/border/glow/shape/background 0-15
        assertTrue(seed.hue < 360);
        assertTrue(seed.pattern < 16);
        assertTrue(seed.border < 16);
        assertTrue(seed.glow < 16);
        assertTrue(seed.shape < 16);
        assertTrue(seed.background < 16);
    }

    function test_getVisualSeed_deterministicFromCode() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VisualSeed memory seed1 = vibeCode.getVisualSeed(alice);
        IVibeCode.VisualSeed memory seed2 = vibeCode.getVisualSeed(alice);

        assertEq(seed1.hue, seed2.hue);
        assertEq(seed1.pattern, seed2.pattern);
        assertEq(seed1.border, seed2.border);
    }

    // ================================================================
    //                  DISPLAY CODE
    // ================================================================

    function test_getDisplayCode_zeroForNoCode() public view {
        assertEq(vibeCode.getDisplayCode(alice), bytes4(0));
    }

    function test_getDisplayCode_firstFourBytesOfCode() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        bytes32 fullCode = vibeCode.getVibeCode(alice);
        bytes4 displayCode = vibeCode.getDisplayCode(alice);

        assertEq(displayCode, bytes4(fullCode));
    }

    // ================================================================
    //                  VIEW FUNCTIONS
    // ================================================================

    function test_getProfile_returnsEmptyForUnknownUser() public view {
        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertEq(profile.vibeCode, bytes32(0));
        assertEq(profile.reputationScore, 0);
        assertEq(profile.firstActiveAt, 0);
    }

    function test_getVibeCode_returnsZeroBeforeRefresh() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        assertEq(vibeCode.getVibeCode(alice), bytes32(0)); // not refreshed yet
    }

    function test_getReputationScore_returnsScore() public {
        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vibeCode.refreshVibeCode(alice);

        uint256 score = vibeCode.getReputationScore(alice);
        assertTrue(score > 0);
    }

    function test_isActive_returnsFalseForInactiveUser() public view {
        assertFalse(vibeCode.isActive(alice));
    }

    function test_getCategoryValue_zeroForNoContributions() public view {
        assertEq(vibeCode.getCategoryValue(alice, IVibeCode.ContributionCategory.CODE), 0);
    }

    function test_getActiveProfileCount_tracksAccurately() public {
        assertEq(vibeCode.getActiveProfileCount(), 0);

        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        assertEq(vibeCode.getActiveProfileCount(), 1);

        _record(bob, IVibeCode.ContributionCategory.CODE, PRECISION);
        assertEq(vibeCode.getActiveProfileCount(), 2);

        // Recording again for alice doesn't increment
        _record(alice, IVibeCode.ContributionCategory.REVIEW, PRECISION);
        assertEq(vibeCode.getActiveProfileCount(), 2);
    }

    // ================================================================
    //                  FUZZ TESTS
    // ================================================================

    function testFuzz_builderScore_neverExceedsCap(uint256 value) public {
        value = bound(value, 1, type(uint128).max);

        _record(alice, IVibeCode.ContributionCategory.CODE, value);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.builderScore <= vibeCode.BUILDER_MAX(), "Builder score exceeded cap");
    }

    function testFuzz_funderScore_neverExceedsCap(uint256 value) public {
        value = bound(value, 1, type(uint128).max);

        _record(alice, IVibeCode.ContributionCategory.IDEA, value);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.funderScore <= vibeCode.FUNDER_MAX(), "Funder score exceeded cap");
    }

    function testFuzz_ideatorScore_neverExceedsCap(uint256 value) public {
        value = bound(value, 1, type(uint128).max);

        _record(alice, IVibeCode.ContributionCategory.DESIGN, value);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.ideatorScore <= vibeCode.IDEATOR_MAX(), "Ideator score exceeded cap");
    }

    function testFuzz_communityScore_neverExceedsCap(uint256 value) public {
        value = bound(value, 1, type(uint128).max);

        _record(alice, IVibeCode.ContributionCategory.COMMUNITY, value);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.communityScore <= vibeCode.COMMUNITY_MAX(), "Community score exceeded cap");
    }

    function testFuzz_longevityScore_neverExceedsCap(uint256 daysElapsed) public {
        daysElapsed = bound(daysElapsed, 0, 10000);

        _record(alice, IVibeCode.ContributionCategory.CODE, PRECISION);
        vm.warp(block.timestamp + daysElapsed * 1 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(profile.longevityScore <= vibeCode.LONGEVITY_MAX(), "Longevity score exceeded cap");
    }

    function testFuzz_compositeScore_neverExceedsMax(
        uint256 codeVal,
        uint256 ideaVal,
        uint256 designVal,
        uint256 communityVal,
        uint256 daysElapsed
    ) public {
        codeVal = bound(codeVal, 1, type(uint64).max);
        ideaVal = bound(ideaVal, 1, type(uint64).max);
        designVal = bound(designVal, 1, type(uint64).max);
        communityVal = bound(communityVal, 1, type(uint64).max);
        daysElapsed = bound(daysElapsed, 0, 5000);

        _record(alice, IVibeCode.ContributionCategory.CODE, codeVal);
        _record(alice, IVibeCode.ContributionCategory.IDEA, ideaVal);
        _record(alice, IVibeCode.ContributionCategory.DESIGN, designVal);
        _record(alice, IVibeCode.ContributionCategory.COMMUNITY, communityVal);

        vm.warp(block.timestamp + daysElapsed * 1 days);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VibeProfile memory profile = vibeCode.getProfile(alice);
        assertTrue(
            profile.reputationScore <= vibeCode.MAX_SCORE(),
            "Composite score exceeded max"
        );
    }

    function testFuzz_vibeCodeHash_deterministicForSameInputs(uint256 value) public {
        value = bound(value, PRECISION, 1000 * PRECISION);

        _record(alice, IVibeCode.ContributionCategory.CODE, value);
        vibeCode.refreshVibeCode(alice);
        bytes32 code1 = vibeCode.getVibeCode(alice);

        vibeCode.refreshVibeCode(alice);
        bytes32 code2 = vibeCode.getVibeCode(alice);

        assertEq(code1, code2, "Same inputs must produce same vibe code");
    }

    function testFuzz_visualSeed_boundsCorrect(uint256 value) public {
        value = bound(value, PRECISION, 1000 * PRECISION);

        _record(alice, IVibeCode.ContributionCategory.CODE, value);
        vibeCode.refreshVibeCode(alice);

        IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(alice);
        assertTrue(seed.hue < 360, "Hue out of range");
        assertTrue(seed.pattern < 16, "Pattern out of range");
        assertTrue(seed.border < 16, "Border out of range");
        assertTrue(seed.glow < 16, "Glow out of range");
        assertTrue(seed.shape < 16, "Shape out of range");
        assertTrue(seed.background < 16, "Background out of range");
    }
}
