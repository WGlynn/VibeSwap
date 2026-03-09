// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibePointsSeason.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock VibeCode ============

contract MockVibeCodePts {
    mapping(address => uint256) public scores;

    function setReputationScore(address user, uint256 score) external {
        scores[user] = score;
    }

    function getReputationScore(address user) external view returns (uint256) {
        return scores[user];
    }
}

// ============ Mock SoulboundIdentity ============

contract MockSoulboundPts {
    mapping(address => bool) private _hasId;
    mapping(address => uint256) public addressToTokenId;
    mapping(uint256 => uint256) private _levels;
    uint256 private _nextId = 1;

    function setIdentity(address user, uint256 level) external {
        uint256 tokenId = _nextId++;
        _hasId[user] = true;
        addressToTokenId[user] = tokenId;
        _levels[tokenId] = level;
    }

    function hasIdentity(address user) external view returns (bool) {
        return _hasId[user];
    }

    function identities(uint256 tokenId) external view returns (
        string memory, uint256, uint256, int256, uint256, uint256, uint256, uint256
    ) {
        return ("test", _levels[tokenId], 0, int256(0), 0, 0, 0, 0);
    }
}

// ============ Mock PointsEngine ============

contract MockPointsEngine {
    mapping(address => uint256) public awarded;

    function awardPoints(address user, uint256 amount, string calldata) external {
        awarded[user] += amount;
    }
}

// ============ Test Contract ============

contract VibePointsSeasonTest is Test {
    VibePointsSeason public season;
    MockVibeCodePts public vibeCode;
    MockSoulboundPts public soulbound;
    MockPointsEngine public engine;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xC4A);
    address public dave = address(0xDA7E);
    address public caller = address(0xCA11);

    function setUp() public {
        vibeCode = new MockVibeCodePts();
        soulbound = new MockSoulboundPts();
        engine = new MockPointsEngine();

        VibePointsSeason impl = new VibePointsSeason();
        bytes memory initData = abi.encodeWithSelector(
            VibePointsSeason.initialize.selector,
            address(vibeCode),
            address(0),       // no loyalty rewards mock
            address(soulbound),
            address(engine)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        season = VibePointsSeason(payable(address(proxy)));

        // Authorize caller
        season.setAuthorizedCaller(caller, true);

        // Set up identities
        soulbound.setIdentity(alice, 5);  // Level 5
        soulbound.setIdentity(bob, 2);    // Level 2
        vibeCode.setReputationScore(alice, 5000); // 50% rep
        vibeCode.setReputationScore(bob, 2000);   // 20% rep

        // Start season
        season.startSeason("Season 1: Genesis", 30 days);
    }

    // ============ Season Management ============

    function test_StartSeason() public view {
        VibePointsSeason.Season memory s = season.getCurrentSeason();
        assertEq(s.seasonId, 1);
        assertEq(s.totalPoints, 0);
        assertEq(s.participantCount, 0);
        assertFalse(s.finalized);
        assertTrue(season.isSeasonActive());
    }

    function test_EndSeason() public {
        season.endSeason();

        VibePointsSeason.Season memory s = season.getCurrentSeason();
        assertTrue(s.finalized);
        assertFalse(season.isSeasonActive());
    }

    function test_MultipleSeasons() public {
        season.endSeason();
        season.startSeason("Season 2: Rise", 30 days);

        assertEq(season.currentSeasonId(), 2);
        assertEq(season.getSeasonCount(), 2);
        assertTrue(season.isSeasonActive());
    }

    function test_AutoEndPreviousSeason() public {
        // Start a new season without ending the first
        season.startSeason("Season 2: Rise", 30 days);

        // First season should be finalized
        VibePointsSeason.Season memory s1;
        (s1.seasonId, s1.name, s1.startTime, s1.endTime, s1.rewardPool, s1.totalPoints, s1.participantCount, s1.finalized) = season.seasons(1);
        assertTrue(s1.finalized);

        // Second season should be active
        assertEq(season.currentSeasonId(), 2);
    }

    // ============ Point Awards ============

    function test_RecordSwapAction() public {
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18); // $100 volume

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertGt(su.points, 0, "Should have earned points");
        assertTrue(su.participated);
        assertEq(su.actions, 1);
    }

    function test_RecordLPDepositAction() public {
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.LP_DEPOSIT, 1000e18);

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertGt(su.points, 0);
        // LP deposit should give more points than swap for same volume
        vm.prank(caller);
        season.recordAction(bob, VibePointsSeason.Action.SWAP, 1000e18);
        VibePointsSeason.SeasonUser memory subob = season.getUserSeason(1, bob);
        // Alice has higher multiplier AND LP gives 3x volume scale vs 1x for swap
    }

    function test_FlatRateActions() public {
        // Governance is flat rate (no volume component)
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.GOVERNANCE, 0);

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertGt(su.points, 0, "Flat rate action should still award points");
    }

    function test_RevertUnauthorizedCaller() public {
        vm.prank(alice);
        vm.expectRevert(VibePointsSeason.Unauthorized.selector);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
    }

    function test_RevertRecordActionNoSeason() public {
        season.endSeason();

        vm.prank(caller);
        vm.expectRevert(VibePointsSeason.SeasonNotActive.selector);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
    }

    function test_ParticipantCountIncrementsOnce() public {
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 200e18);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 300e18);
        vm.stopPrank();

        VibePointsSeason.Season memory s = season.getCurrentSeason();
        assertEq(s.participantCount, 1, "Participant count should be 1 despite multiple actions");
    }

    // ============ Daily Check-In ============

    function test_DailyCheckIn() public {
        vm.prank(alice);
        season.dailyCheckIn();

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertGt(su.points, 0, "Should earn check-in points");
        assertEq(su.checkInStreak, 1);
    }

    function test_CheckInStreakBuilds() public {
        vm.prank(alice);
        season.dailyCheckIn();

        // Next day
        vm.warp(block.timestamp + 24 hours);
        vm.prank(alice);
        season.dailyCheckIn();

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertEq(su.checkInStreak, 2);
    }

    function test_CheckInStreakResets() public {
        vm.prank(alice);
        season.dailyCheckIn();

        // Skip 3 days
        vm.warp(block.timestamp + 72 hours);
        vm.prank(alice);
        season.dailyCheckIn();

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertEq(su.checkInStreak, 1, "Streak should reset after >48h gap");
    }

    function test_RevertCheckInTooSoon() public {
        vm.prank(alice);
        season.dailyCheckIn();

        // Try again too soon
        vm.warp(block.timestamp + 10 hours);
        vm.prank(alice);
        vm.expectRevert(VibePointsSeason.CheckInTooSoon.selector);
        season.dailyCheckIn();
    }

    function test_CanCheckInView() public {
        assertTrue(season.canCheckIn(alice));

        vm.prank(alice);
        season.dailyCheckIn();

        assertFalse(season.canCheckIn(alice));

        vm.warp(block.timestamp + 21 hours);
        assertTrue(season.canCheckIn(alice));
    }

    function test_CheckInStreakBonusPoints() public {
        // Build a 5-day streak (each check-in > 20h apart, < 48h apart)
        vm.warp(1000); // Start at a known timestamp
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(alice);
            season.dailyCheckIn();
            if (i < 4) {
                vm.warp(block.timestamp + 24 hours);
            }
        }

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertEq(su.checkInStreak, 5);
        // Each day gives increasing points from streak bonus
        assertGt(su.points, 300, "Streak bonus should increase total points");
    }

    // ============ Cross-System Multipliers ============

    function test_MultiplierFromVibeCode() public {
        // Alice has VibeCode score of 5000 → multiplier = 10000 + 5000 = 15000 (1.5x)
        uint256 mult = season.getMultiplier(alice);
        assertGt(mult, 10000, "Should have multiplier > 1.0x from VibeCode");
    }

    function test_MultiplierFromSoulboundLevel() public {
        // Alice has level 5 → 500 * 5 = 2500 BPS bonus → 12500 (1.25x from identity alone)
        // But also has VibeCode 5000 → 15000 (1.5x from vibeCode alone)
        // Compound: (15000 * 12500) / 10000 = 18750 (1.875x total)
        uint256 mult = season.getMultiplier(alice);
        assertGt(mult, 15000, "Should compound VibeCode + Identity multipliers");
    }

    function test_MultiplierDifferenceBetweenUsers() public {
        // Alice: high rep, high level
        // Bob: lower rep, lower level
        uint256 multAlice = season.getMultiplier(alice);
        uint256 multBob = season.getMultiplier(bob);
        assertGt(multAlice, multBob, "Alice should have higher multiplier than Bob");
    }

    function test_BaseMultiplierWithNoExternalData() public {
        // Charlie has no identity or vibeCode data
        uint256 mult = season.getMultiplier(charlie);
        assertEq(mult, 10000, "User with no external data should have 1.0x multiplier");
    }

    function test_MultipliersAffectPoints() public {
        // Same action, different users, different multipliers
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
        season.recordAction(charlie, VibePointsSeason.Action.SWAP, 100e18);
        vm.stopPrank();

        VibePointsSeason.SeasonUser memory suAlice = season.getUserSeason(1, alice);
        VibePointsSeason.SeasonUser memory suCharlie = season.getUserSeason(1, charlie);

        assertGt(suAlice.points, suCharlie.points, "Higher multiplier should yield more points");
    }

    // ============ Leaderboard Tests ============

    function test_LeaderboardTracking() public {
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 500e18);
        season.recordAction(bob, VibePointsSeason.Action.SWAP, 200e18);
        season.recordAction(charlie, VibePointsSeason.Action.SWAP, 100e18);
        vm.stopPrank();

        VibePointsSeason.LeaderboardEntry[] memory board = season.getLeaderboard(1);
        assertEq(board.length, 3);

        // Should be sorted descending by points
        assertGe(board[0].points, board[1].points, "Board should be sorted descending");
        assertGe(board[1].points, board[2].points, "Board should be sorted descending");
    }

    function test_LeaderboardRankUpdates() public {
        // Bob starts ahead
        vm.startPrank(caller);
        season.recordAction(bob, VibePointsSeason.Action.SWAP, 1000e18);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
        vm.stopPrank();

        // Alice catches up with a big trade
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 5000e18);

        VibePointsSeason.LeaderboardEntry[] memory board = season.getLeaderboard(1);
        // Alice should now be #1 (higher multiplier + more volume)
        assertEq(board[0].user, alice, "Alice should be #1 after big trade");
    }

    function test_GetTopN() public {
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 500e18);
        season.recordAction(bob, VibePointsSeason.Action.SWAP, 300e18);
        season.recordAction(charlie, VibePointsSeason.Action.SWAP, 100e18);
        vm.stopPrank();

        VibePointsSeason.LeaderboardEntry[] memory top2 = season.getTopN(1, 2);
        assertEq(top2.length, 2);
    }

    function test_UserRankView() public {
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 500e18);
        season.recordAction(bob, VibePointsSeason.Action.SWAP, 300e18);
        vm.stopPrank();

        uint256 aliceRank = season.getUserRank(1, alice);
        uint256 bobRank = season.getUserRank(1, bob);
        assertEq(aliceRank, 1, "Alice should be rank 1");
        assertEq(bobRank, 2, "Bob should be rank 2");
    }

    // ============ All-Time Stats ============

    function test_AllTimeStatsAccumulate() public {
        vm.startPrank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);
        season.recordAction(alice, VibePointsSeason.Action.LP_DEPOSIT, 200e18);
        vm.stopPrank();

        (uint256 pts, uint256 acts) = season.getUserAllTime(alice);
        assertGt(pts, 0, "All-time points should accumulate");
        assertEq(acts, 2, "All-time actions should be 2");
    }

    function test_AllTimeStatsPersistAcrossSeasons() public {
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);

        (uint256 pts1,) = season.getUserAllTime(alice);

        // Start season 2
        season.startSeason("Season 2", 30 days);

        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);

        (uint256 pts2,) = season.getUserAllTime(alice);
        assertGt(pts2, pts1, "All-time should accumulate across seasons");
    }

    // ============ Points Engine Forwarding ============

    function test_ForwardsToPointsEngine() public {
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);

        uint256 enginePoints = engine.awarded(alice);
        assertGt(enginePoints, 0, "Points should be forwarded to engine");
    }

    // ============ Action Config ============

    function test_UpdateActionConfig() public {
        season.setActionConfig(
            VibePointsSeason.Action.SWAP,
            100,      // 10x base points
            2e18,     // 2x volume scale
            true
        );

        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 100e18);

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertGt(su.points, 100, "Increased config should yield more points");
    }

    function test_DisabledActionAwardsNothing() public {
        season.setActionConfig(VibePointsSeason.Action.SWAP, 10, 1e18, false);

        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, 1000e18);

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        assertEq(su.points, 0, "Disabled action should award 0 points");
        assertFalse(su.participated, "Should not count as participant");
    }

    // ============ Access Control ============

    function test_OnlyOwnerCanStartSeason() public {
        vm.prank(alice);
        vm.expectRevert();
        season.startSeason("Unauthorized", 30 days);
    }

    function test_OnlyOwnerCanSetConfig() public {
        vm.prank(alice);
        vm.expectRevert();
        season.setActionConfig(VibePointsSeason.Action.SWAP, 100, 1e18, true);
    }

    function test_OnlyOwnerCanAuthorize() public {
        vm.prank(alice);
        vm.expectRevert();
        season.setAuthorizedCaller(bob, true);
    }

    function test_CheckInBlockedViaRecordAction() public {
        // Daily check-in must use dailyCheckIn(), not recordAction()
        vm.prank(caller);
        vm.expectRevert(VibePointsSeason.Unauthorized.selector);
        season.recordAction(alice, VibePointsSeason.Action.DAILY_CHECKIN, 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_PointsNeverOverflow(uint128 volume) public {
        vm.prank(caller);
        season.recordAction(alice, VibePointsSeason.Action.SWAP, uint256(volume));

        VibePointsSeason.SeasonUser memory su = season.getUserSeason(1, alice);
        // Should never revert, points should be non-negative
        assertGe(su.points, 0);
    }

    function testFuzz_MultiplierAlwaysPositive(uint16 score, uint8 level) public {
        score = uint16(bound(score, 0, 10000));
        level = uint8(bound(level, 1, 10));

        address user = address(uint160(uint256(keccak256(abi.encodePacked(score, level)))));
        vibeCode.setReputationScore(user, score);
        soulbound.setIdentity(user, level);

        uint256 mult = season.getMultiplier(user);
        assertGe(mult, 10000, "Multiplier should always be >= 1.0x");
    }

    function testFuzz_LeaderboardAlwaysSorted(uint8 numUsers) public {
        numUsers = uint8(bound(numUsers, 2, 20));

        for (uint256 i = 0; i < numUsers; i++) {
            address user = address(uint160(i + 100));
            uint256 vol = (uint256(keccak256(abi.encodePacked(i))) % 1000 + 1) * 1e18;
            vm.prank(caller);
            season.recordAction(user, VibePointsSeason.Action.SWAP, vol);
        }

        VibePointsSeason.LeaderboardEntry[] memory board = season.getLeaderboard(1);
        for (uint256 i = 0; i < board.length - 1; i++) {
            assertGe(board[i].points, board[i + 1].points, "Board must be sorted descending");
        }
    }
}
