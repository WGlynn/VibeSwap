// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/VibeCode.sol";

// ============ Handler ============

contract VibeCodeHandler is Test {
    VibeCode public vibeCode;

    address public alice;
    address public bob;
    address public carol;
    address[] public users;

    // Ghost variables
    uint256 public ghost_totalContributions;
    uint256 public ghost_totalRefreshes;
    uint256 public ghost_usersWithContributions;

    // Track per-user contribution counts
    mapping(address => uint256) public ghost_userContributions;
    mapping(address => bool) public ghost_userActive;

    constructor(VibeCode _vibeCode, address _alice, address _bob, address _carol) {
        vibeCode = _vibeCode;
        alice = _alice;
        bob = _bob;
        carol = _carol;
        users.push(_alice);
        users.push(_bob);
        users.push(_carol);
    }

    function recordCode(uint256 userSeed, uint256 value) public {
        address user = users[userSeed % users.length];
        value = bound(value, 1e18, 10_000_000e18);

        vibeCode.recordContribution(user, IVibeCode.ContributionCategory.CODE, value, bytes32("ev"));
        ghost_totalContributions++;
        ghost_userContributions[user]++;
        if (!ghost_userActive[user]) {
            ghost_userActive[user] = true;
            ghost_usersWithContributions++;
        }
    }

    function recordIdea(uint256 userSeed, uint256 value) public {
        address user = users[userSeed % users.length];
        value = bound(value, 1e18, 10_000_000e18);

        vibeCode.recordContribution(user, IVibeCode.ContributionCategory.IDEA, value, bytes32("ev"));
        ghost_totalContributions++;
        ghost_userContributions[user]++;
        if (!ghost_userActive[user]) {
            ghost_userActive[user] = true;
            ghost_usersWithContributions++;
        }
    }

    function recordAttestation(uint256 userSeed, uint256 value) public {
        address user = users[userSeed % users.length];
        value = bound(value, 1e18, 1_000_000e18);

        vibeCode.recordContribution(user, IVibeCode.ContributionCategory.ATTESTATION, value, bytes32("ev"));
        ghost_totalContributions++;
        ghost_userContributions[user]++;
        if (!ghost_userActive[user]) {
            ghost_userActive[user] = true;
            ghost_usersWithContributions++;
        }
    }

    function recordDesign(uint256 userSeed, uint256 value) public {
        address user = users[userSeed % users.length];
        value = bound(value, 1e18, 100e18);

        vibeCode.recordContribution(user, IVibeCode.ContributionCategory.DESIGN, value, bytes32("ev"));
        ghost_totalContributions++;
        ghost_userContributions[user]++;
        if (!ghost_userActive[user]) {
            ghost_userActive[user] = true;
            ghost_usersWithContributions++;
        }
    }

    function refreshUser(uint256 userSeed) public {
        address user = users[userSeed % users.length];
        if (!ghost_userActive[user]) return;

        try vibeCode.refreshVibeCode(user) {
            ghost_totalRefreshes++;
        } catch {}
    }

    function advanceTime(uint256 timeSeed) public {
        uint256 delta = bound(timeSeed, 1 hours, 90 days);
        vm.warp(block.timestamp + delta);
    }

    function getUserCount() external view returns (uint256) {
        return users.length;
    }

    function getUserAt(uint256 index) external view returns (address) {
        return users[index];
    }
}

// ============ Invariant Tests ============

contract VibeCodeInvariantTest is StdInvariant, Test {
    VibeCode public vibeCode;
    VibeCodeHandler public handler;

    address public alice;
    address public bob;
    address public carol;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        vibeCode = new VibeCode();

        handler = new VibeCodeHandler(vibeCode, alice, bob, carol);

        // Authorize the handler as a source (it calls recordContribution directly on vibeCode)
        vibeCode.setAuthorizedSource(address(handler), true);

        targetContract(address(handler));
    }

    // ============ Invariant: Score bounds ============

    function invariant_scoreBounds() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);
            IVibeCode.VibeProfile memory profile = vibeCode.getProfile(user);

            assertLe(profile.builderScore, vibeCode.BUILDER_MAX(), "Builder must be bounded");
            assertLe(profile.funderScore, vibeCode.FUNDER_MAX(), "Funder must be bounded");
            assertLe(profile.ideatorScore, vibeCode.IDEATOR_MAX(), "Ideator must be bounded");
            assertLe(profile.communityScore, vibeCode.COMMUNITY_MAX(), "Community must be bounded");
            assertLe(profile.longevityScore, vibeCode.LONGEVITY_MAX(), "Longevity must be bounded");
            assertLe(profile.reputationScore, vibeCode.MAX_SCORE(), "Total score must be bounded");
        }
    }

    // ============ Invariant: Active profile count matches actual ============

    function invariant_activeProfileCountConsistent() public view {
        assertEq(
            vibeCode.getActiveProfileCount(),
            handler.ghost_usersWithContributions(),
            "Active count must match ghost"
        );
    }

    // ============ Invariant: Contribution counts match ghost ============

    function invariant_contributionCountsConsistent() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);
            IVibeCode.VibeProfile memory profile = vibeCode.getProfile(user);

            assertEq(
                profile.totalContributions,
                handler.ghost_userContributions(user),
                "Contribution count must match ghost"
            );
        }
    }

    // ============ Invariant: isActive consistent with profile ============

    function invariant_isActiveConsistent() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);

            if (handler.ghost_userActive(user)) {
                assertTrue(vibeCode.isActive(user), "User with contributions must be active");
            } else {
                assertFalse(vibeCode.isActive(user), "User without contributions must not be active");
            }
        }
    }

    // ============ Invariant: Vibe code is zero before first refresh ============

    function invariant_vibeCodeZeroBeforeRefresh() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);
            IVibeCode.VibeProfile memory profile = vibeCode.getProfile(user);

            // If never refreshed, vibeCode should be 0
            if (profile.lastRefreshed == 0) {
                assertEq(profile.vibeCode, bytes32(0), "Code must be zero before refresh");
            }
        }
    }

    // ============ Invariant: Reputation score equals sum of dimensions ============

    function invariant_reputationScoreIsSum() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);
            IVibeCode.VibeProfile memory profile = vibeCode.getProfile(user);

            if (profile.lastRefreshed > 0) {
                uint256 expectedSum = profile.builderScore
                    + profile.funderScore
                    + profile.ideatorScore
                    + profile.communityScore
                    + profile.longevityScore;

                assertEq(
                    profile.reputationScore,
                    expectedSum,
                    "Reputation must equal sum of dimensions"
                );
            }
        }
    }

    // ============ Invariant: Visual seed bounded ============

    function invariant_visualSeedBounded() public view {
        for (uint256 i = 0; i < handler.getUserCount(); i++) {
            address user = handler.getUserAt(i);
            IVibeCode.VisualSeed memory seed = vibeCode.getVisualSeed(user);

            assertTrue(seed.hue < 360 || seed.hue == 0, "Hue must be < 360");
            assertTrue(seed.pattern < 16, "Pattern must be < 16");
            assertTrue(seed.border < 16, "Border must be < 16");
            assertTrue(seed.glow < 16, "Glow must be < 16");
            assertTrue(seed.shape < 16, "Shape must be < 16");
            assertTrue(seed.background < 16, "Background must be < 16");
        }
    }
}
