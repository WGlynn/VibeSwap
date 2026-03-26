// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/community/VibeReputation.sol";

contract VibeReputationTest is Test {
    VibeReputation public rep;

    address public owner;
    address public reporter;
    address public alice;
    address public bob;
    address public charlie;

    event ScoreUpdated(address indexed account, string category, uint256 newScore);
    event Endorsed(address indexed endorser, address indexed endorsee, string category);
    event ReporterAuthorized(address indexed reporter);
    event ProfileCreated(address indexed account);

    function setUp() public {
        owner = address(this);
        reporter = makeAddr("reporter");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        VibeReputation impl = new VibeReputation();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeReputation.initialize.selector)
        );
        rep = VibeReputation(address(proxy));

        rep.authorizeReporter(reporter);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(rep.totalProfiles(), 0);
        assertEq(rep.GOVERNANCE_WEIGHT(), 1500);
        assertEq(rep.TRADING_WEIGHT(), 1500);
        assertEq(rep.LENDING_WEIGHT(), 1500);
        assertEq(rep.LP_WEIGHT(), 1500);
        assertEq(rep.MIND_WEIGHT(), 2000);
        assertEq(rep.COMMUNITY_WEIGHT(), 1000);
        assertEq(rep.DISPUTE_WEIGHT(), 1000);
    }

    function test_weightsSum() public view {
        uint256 totalWeight = rep.GOVERNANCE_WEIGHT()
            + rep.TRADING_WEIGHT()
            + rep.LENDING_WEIGHT()
            + rep.LP_WEIGHT()
            + rep.MIND_WEIGHT()
            + rep.COMMUNITY_WEIGHT()
            + rep.DISPUTE_WEIGHT();
        assertEq(totalWeight, 10000);
    }

    // ============ Score Reporting ============

    function test_reportScore_governance() public {
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit ScoreUpdated(alice, "governance", 100);
        rep.reportScore(alice, "governance", 100);

        (
            uint256 total,
            uint256 governance,
            uint256 trading,
            uint256 lending,
            uint256 lp,
            uint256 mind,
            uint256 community,
            uint256 dispute
        ) = rep.getProfile(alice);

        assertEq(governance, 100);
        assertEq(trading, 0);
        assertEq(lending, 0);
        assertEq(lp, 0);
        assertEq(mind, 0);
        assertEq(community, 0);
        assertEq(dispute, 0);
        // total = (100 * 1500) / 10000 = 15
        assertEq(total, 15);
    }

    function test_reportScore_trading() public {
        vm.prank(reporter);
        rep.reportScore(alice, "trading", 200);

        (, , uint256 trading, , , , , ) = rep.getProfile(alice);
        assertEq(trading, 200);
    }

    function test_reportScore_lending() public {
        vm.prank(reporter);
        rep.reportScore(alice, "lending", 50);

        (, , , uint256 lending, , , , ) = rep.getProfile(alice);
        assertEq(lending, 50);
    }

    function test_reportScore_lp() public {
        vm.prank(reporter);
        rep.reportScore(alice, "lp", 75);

        (, , , , uint256 lp, , , ) = rep.getProfile(alice);
        assertEq(lp, 75);
    }

    function test_reportScore_mind() public {
        vm.prank(reporter);
        rep.reportScore(alice, "mind", 300);

        (, , , , , uint256 mind, , ) = rep.getProfile(alice);
        assertEq(mind, 300);
    }

    function test_reportScore_dispute() public {
        vm.prank(reporter);
        rep.reportScore(alice, "dispute", 10);

        (, , , , , , , uint256 dispute) = rep.getProfile(alice);
        assertEq(dispute, 10);
    }

    function test_reportScore_createsProfile() public {
        assertEq(rep.totalProfiles(), 0);

        vm.prank(reporter);
        vm.expectEmit(true, false, false, false);
        emit ProfileCreated(alice);
        rep.reportScore(alice, "governance", 100);

        assertEq(rep.totalProfiles(), 1);
    }

    function test_reportScore_secondReportDoesNotCreateProfile() public {
        vm.startPrank(reporter);
        rep.reportScore(alice, "governance", 100);
        assertEq(rep.totalProfiles(), 1);

        rep.reportScore(alice, "trading", 200);
        assertEq(rep.totalProfiles(), 1);
        vm.stopPrank();
    }

    function test_reportScore_incrementsAssessmentCount() public {
        vm.startPrank(reporter);
        rep.reportScore(alice, "governance", 100);
        rep.reportScore(alice, "trading", 200);
        rep.reportScore(alice, "lending", 300);
        vm.stopPrank();

        (, , , , , , , , , uint256 assessmentCount) = rep.profiles(alice);
        assertEq(assessmentCount, 3);
    }

    function test_reportScore_updatesLastUpdated() public {
        vm.warp(1000);
        vm.prank(reporter);
        rep.reportScore(alice, "governance", 100);

        (, , , , , , , , uint256 lastUpdated, ) = rep.profiles(alice);
        assertEq(lastUpdated, 1000);
    }

    function test_reportScore_revert_notAuthorized() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        rep.reportScore(bob, "governance", 100);
    }

    // ============ Total Score Calculation ============

    function test_totalScore_multipleCategories() public {
        vm.startPrank(reporter);
        rep.reportScore(alice, "governance", 100);   // 100 * 1500 = 150000
        rep.reportScore(alice, "trading", 100);       // 100 * 1500 = 150000
        rep.reportScore(alice, "lending", 100);       // 100 * 1500 = 150000
        rep.reportScore(alice, "lp", 100);            // 100 * 1500 = 150000
        rep.reportScore(alice, "mind", 100);          // 100 * 2000 = 200000
        rep.reportScore(alice, "dispute", 100);       // 100 * 1000 = 100000
        vm.stopPrank();

        // total = (150000 + 150000 + 150000 + 150000 + 200000 + 0_community + 100000) / 10000
        // = 900000 / 10000 = 90
        uint256 total = rep.getTotalScore(alice);
        assertEq(total, 90);
    }

    function test_totalScore_allCategoriesEqual() public {
        vm.startPrank(reporter);
        rep.reportScore(alice, "governance", 1000);
        rep.reportScore(alice, "trading", 1000);
        rep.reportScore(alice, "lending", 1000);
        rep.reportScore(alice, "lp", 1000);
        rep.reportScore(alice, "mind", 1000);
        rep.reportScore(alice, "dispute", 1000);
        vm.stopPrank();

        // Community = 0, so:
        // (1000*1500 + 1000*1500 + 1000*1500 + 1000*1500 + 1000*2000 + 0*1000 + 1000*1000) / 10000
        // = (1500000 + 1500000 + 1500000 + 1500000 + 2000000 + 0 + 1000000) / 10000
        // = 9000000 / 10000 = 900
        assertEq(rep.getTotalScore(alice), 900);
    }

    // ============ Endorsements ============

    function test_endorse() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Endorsed(alice, bob, "governance");
        rep.endorse(bob, "governance");

        assertEq(rep.endorsementCount(bob), 1);
        assertTrue(rep.hasEndorsed(alice, bob));

        (, , , , , , uint256 community, ) = rep.getProfile(bob);
        assertEq(community, 1);
    }

    function test_endorse_revert_selfEndorse() public {
        vm.prank(alice);
        vm.expectRevert("Cannot self-endorse");
        rep.endorse(alice, "governance");
    }

    function test_endorse_revert_alreadyEndorsed() public {
        vm.prank(alice);
        rep.endorse(bob, "governance");

        vm.prank(alice);
        vm.expectRevert("Already endorsed");
        rep.endorse(bob, "trading");
    }

    function test_endorse_multipleEndorsers() public {
        vm.prank(alice);
        rep.endorse(charlie, "governance");

        vm.prank(bob);
        rep.endorse(charlie, "trading");

        assertEq(rep.endorsementCount(charlie), 2);

        (, , , , , , uint256 community, ) = rep.getProfile(charlie);
        assertEq(community, 2);
    }

    function test_endorse_updatesTotalScore() public {
        vm.prank(alice);
        rep.endorse(bob, "governance");

        // community = 1, weight = 1000
        // total = (1 * 1000) / 10000 = 0 (integer division)
        uint256 total = rep.getTotalScore(bob);
        assertEq(total, 0); // 1000 / 10000 = 0 with integer math

        // After 10 endorsements, community = 10
        for (uint256 i = 1; i < 10; i++) {
            address endorser = makeAddr(string(abi.encodePacked("endorser", i)));
            vm.prank(endorser);
            rep.endorse(bob, "general");
        }

        // total = (10 * 1000) / 10000 = 1
        assertEq(rep.getTotalScore(bob), 1);
    }

    // ============ Admin ============

    function test_authorizeReporter() public {
        address newReporter = makeAddr("newReporter");

        vm.expectEmit(true, false, false, false);
        emit ReporterAuthorized(newReporter);
        rep.authorizeReporter(newReporter);

        assertTrue(rep.authorizedReporters(newReporter));

        // New reporter can now report
        vm.prank(newReporter);
        rep.reportScore(alice, "governance", 100);
    }

    function test_authorizeReporter_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        rep.authorizeReporter(alice);
    }

    // ============ View Functions ============

    function test_getTotalScore_noProfile() public view {
        assertEq(rep.getTotalScore(alice), 0);
    }

    function test_getProfile_noProfile() public view {
        (uint256 total, uint256 governance, uint256 trading, uint256 lending,
         uint256 lp, uint256 mind, uint256 community, uint256 dispute) = rep.getProfile(alice);
        assertEq(total, 0);
        assertEq(governance, 0);
        assertEq(trading, 0);
        assertEq(lending, 0);
        assertEq(lp, 0);
        assertEq(mind, 0);
        assertEq(community, 0);
        assertEq(dispute, 0);
    }

    function test_getEndorsementCount_noEndorsements() public view {
        assertEq(rep.getEndorsementCount(alice), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_reportScore_arbitraryValue(uint256 score) public {
        vm.prank(reporter);
        rep.reportScore(alice, "governance", score);

        (, uint256 governance, , , , , , ) = rep.getProfile(alice);
        assertEq(governance, score);

        // Total = (score * 1500) / 10000
        uint256 expectedTotal = (score * 1500) / 10000;
        assertEq(rep.getTotalScore(alice), expectedTotal);
    }

    function testFuzz_endorse_manyEndorsers(uint8 count) public {
        count = uint8(bound(count, 1, 50));

        for (uint8 i = 0; i < count; i++) {
            address endorser = makeAddr(string(abi.encodePacked("e", i)));
            vm.prank(endorser);
            rep.endorse(alice, "general");
        }

        assertEq(rep.endorsementCount(alice), uint256(count));

        (, , , , , , uint256 community, ) = rep.getProfile(alice);
        assertEq(community, uint256(count));
    }

    // ============ Score Overwrite ============

    function test_reportScore_overwritesPrevious() public {
        vm.startPrank(reporter);
        rep.reportScore(alice, "governance", 100);
        (, uint256 gov1, , , , , , ) = rep.getProfile(alice);
        assertEq(gov1, 100);

        rep.reportScore(alice, "governance", 500);
        (, uint256 gov2, , , , , , ) = rep.getProfile(alice);
        assertEq(gov2, 500);
        vm.stopPrank();
    }
}
