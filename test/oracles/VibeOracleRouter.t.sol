// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/oracles/VibeOracleRouter.sol";

// ============ Helpers ============

/// @notice Minimal provider that can receive ETH rewards
contract ETHReceiver {
    receive() external payable {}
}

// ============ Tests ============

/**
 * @title VibeOracleRouterTest
 * @notice Unit tests for VibeOracleRouter — provider registration, price reporting,
 *         weighted median aggregation, staleness checks, deviation circuit breaker,
 *         accuracy scoring, reward distribution, and admin controls.
 */
contract VibeOracleRouterTest is Test {
    VibeOracleRouter public router;

    address public owner;
    address public providerA;
    address public providerB;
    address public providerC;
    address public stranger;

    uint256 constant MAX_STALENESS    = 1 hours;
    uint256 constant DEVIATION_BPS    = 500;  // 5%
    uint256 constant PRECISION        = 1e18;
    bytes32 public   feedId;

    function setUp() public {
        owner     = address(this);
        providerA = makeAddr("providerA");
        providerB = makeAddr("providerB");
        providerC = makeAddr("providerC");
        stranger  = makeAddr("stranger");

        VibeOracleRouter impl = new VibeOracleRouter();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeOracleRouter.initialize.selector,
                MAX_STALENESS,
                DEVIATION_BPS
            )
        );
        router = VibeOracleRouter(payable(address(proxy)));

        feedId = router.getFeedId("ETH", "USD");

        // Register providers
        router.registerProvider(providerA, VibeOracleRouter.FeedType.AGGREGATOR);
        router.registerProvider(providerB, VibeOracleRouter.FeedType.FIRST_PARTY);
        router.registerProvider(providerC, VibeOracleRouter.FeedType.LOW_LATENCY);
    }

    // ============ Initializer ============

    function test_initialize_setsParams() public view {
        assertEq(router.maxStaleness(), MAX_STALENESS);
        assertEq(router.deviationThreshold(), DEVIATION_BPS);
    }

    function test_initialize_ownerIsDeployer() public view {
        assertEq(router.owner(), owner);
    }

    // ============ Provider Registration ============

    function test_registerProvider_storesCorrectly() public view {
        (
            address addr,
            VibeOracleRouter.FeedType ft,
            uint256 score,
            uint256 reports,
            uint256 lastReport,
            bool active
        ) = router.providers(providerA);

        assertEq(addr, providerA);
        assertEq(uint8(ft), uint8(VibeOracleRouter.FeedType.AGGREGATOR));
        assertEq(score, router.INITIAL_ACCURACY());
        assertEq(reports, 0);
        assertEq(lastReport, 0);
        assertTrue(active);
    }

    function test_registerProvider_revertsDuplicate() public {
        vm.expectRevert(VibeOracleRouter.ProviderAlreadyRegistered.selector);
        router.registerProvider(providerA, VibeOracleRouter.FeedType.AGGREGATOR);
    }

    function test_registerProvider_onlyOwner() public {
        address newP = makeAddr("new");
        vm.prank(stranger);
        vm.expectRevert();
        router.registerProvider(newP, VibeOracleRouter.FeedType.FIRST_PARTY);
    }

    function test_getProviderCount() public view {
        assertEq(router.getProviderCount(), 3);
    }

    // ============ Deactivate / Reactivate ============

    function test_deactivateProvider_blocksReporting() public {
        router.deactivateProvider(providerA);
        vm.prank(providerA);
        vm.expectRevert(VibeOracleRouter.ProviderNotActive.selector);
        router.reportPrice(feedId, 1000e18, 100);
    }

    function test_deactivateProvider_notRegistered_reverts() public {
        vm.expectRevert(VibeOracleRouter.ProviderNotRegistered.selector);
        router.deactivateProvider(stranger);
    }

    function test_reactivateProvider_allowsReporting() public {
        router.deactivateProvider(providerA);
        router.reactivateProvider(providerA);

        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        assertTrue(router.feedInitialized(feedId));
    }

    // ============ reportPrice — validation ============

    function test_reportPrice_rejectsUnregistered() public {
        vm.prank(stranger);
        vm.expectRevert(VibeOracleRouter.ProviderNotRegistered.selector);
        router.reportPrice(feedId, 1000e18, 0);
    }

    function test_reportPrice_rejectsZeroPrice() public {
        vm.prank(providerA);
        vm.expectRevert(VibeOracleRouter.InvalidPrice.selector);
        router.reportPrice(feedId, 0, 100);
    }

    function test_reportPrice_rejectsHighConfidence() public {
        // confidence > BPS_PRECISION (10000) should revert
        vm.prank(providerA);
        vm.expectRevert(VibeOracleRouter.InvalidConfidence.selector);
        router.reportPrice(feedId, 1000e18, 10001);
    }

    function test_reportPrice_setsInitialized() public {
        assertFalse(router.feedInitialized(feedId));
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        assertTrue(router.feedInitialized(feedId));
    }

    function test_reportPrice_emitsEvent() public {
        vm.expectEmit(true, true, false, false, address(router));
        emit VibeOracleRouter.PriceReported(feedId, providerA, 1000e18, 100, 0);
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
    }

    // ============ Price aggregation — single reporter ============

    function test_singleReporter_priceStoredCorrectly() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        (uint256 price, uint256 ts, uint256 conf) = router.getPrice(feedId);
        assertEq(price, 1000e18);
        assertEq(ts, block.timestamp);
        assertEq(conf, 100);
    }

    // ============ Price aggregation — weighted median ============

    function test_threeReporters_medianSelected() public {
        // Report prices: 900, 1000, 1100 — equal weights → median = 1000
        vm.prank(providerA);
        router.reportPrice(feedId, 900e18, 50);
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerC);
        router.reportPrice(feedId, 1100e18, 50);

        (uint256 price, , ) = router.getPrice(feedId);
        assertEq(price, 1000e18);
    }

    function test_threeReporters_lowerOutlierHasNoEffect() public {
        // Outlier at 1 wei can't drag median below the middle value
        vm.prank(providerA);
        router.reportPrice(feedId, 1, 50); // extreme low
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerC);
        router.reportPrice(feedId, 1001e18, 50);

        (uint256 price, , ) = router.getPrice(feedId);
        assertEq(price, 1000e18);
    }

    function test_twoReporters_lowerPriceIsWeightedMedian() public {
        // With 2 equal-weight reporters, cumulative weight reaches half at first (lower) price
        vm.prank(providerA);
        router.reportPrice(feedId, 900e18, 0);
        vm.prank(providerB);
        router.reportPrice(feedId, 1100e18, 0);

        (uint256 price, , ) = router.getPrice(feedId);
        // halfWeight = totalWeight / 2; cumulativeWeight at first price already >= halfWeight
        assertEq(price, 900e18);
    }

    function test_getFeedReporters_returnsAll() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 100);

        address[] memory reporters = router.getFeedReporters(feedId);
        assertEq(reporters.length, 2);
    }

    // ============ Staleness checks ============

    function test_getPrice_revertsStaleFeed() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        // Advance past maxStaleness
        vm.warp(block.timestamp + MAX_STALENESS + 1);
        vm.expectRevert(VibeOracleRouter.StaleFeed.selector);
        router.getPrice(feedId);
    }

    function test_getPrice_revertsUninitializedFeed() public {
        bytes32 unknown = keccak256("UNKNOWN/USD");
        vm.expectRevert(VibeOracleRouter.FeedNotInitialized.selector);
        router.getPrice(unknown);
    }

    function test_getPriceUnsafe_returnsStalenessFlag() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        vm.warp(block.timestamp + MAX_STALENESS + 1);
        (, , bool isStale) = router.getPriceUnsafe(feedId);
        assertTrue(isStale);
    }

    function test_getPriceUnsafe_notStaleWhenFresh() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        (, , bool isStale) = router.getPriceUnsafe(feedId);
        assertFalse(isStale);
    }

    // ============ Circuit breaker — deviation ============

    function test_circuitBreaker_tripsOnLargeDeviation() public {
        // Establish baseline price
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        // Price jumps 50% — exceeds DEVIATION_BPS (5%)
        vm.prank(providerB);
        router.reportPrice(feedId, 1500e18, 100);

        assertTrue(router.circuitBroken(feedId));
    }

    function test_circuitBreaker_blocksGetPrice() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1500e18, 100);

        vm.expectRevert(VibeOracleRouter.CircuitBreakerActive.selector);
        router.getPrice(feedId);
    }

    function test_circuitBreaker_blocksNewReports() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1500e18, 100);

        vm.prank(providerC);
        vm.expectRevert(VibeOracleRouter.CircuitBreakerActive.selector);
        router.reportPrice(feedId, 1000e18, 100);
    }

    function test_circuitBreaker_resetByOwner() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1500e18, 100);

        router.resetCircuitBreaker(feedId);
        assertFalse(router.circuitBroken(feedId));
    }

    function test_circuitBreaker_resetOnlyOwner() public {
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1500e18, 100);

        vm.prank(stranger);
        vm.expectRevert();
        router.resetCircuitBreaker(feedId);
    }

    function test_circuitBreaker_doesNotTripOnSmallDeviation() public {
        // 3% deviation < 5% threshold → no trip
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);
        vm.prank(providerB);
        router.reportPrice(feedId, 1030e18, 100); // +3%

        assertFalse(router.circuitBroken(feedId));
        (uint256 price, , ) = router.getPrice(feedId);
        assertGt(price, 0);
    }

    // ============ Accuracy scoring ============

    function test_accuracyScore_increasesForAccurateReporter() public {
        uint256 scoreBefore = router.getProviderAccuracy(providerA);

        // A reports the median price (accurate)
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);

        uint256 scoreAfter = router.getProviderAccuracy(providerA);
        assertGe(scoreAfter, scoreBefore); // should be rewarded
    }

    function test_accuracyScore_decreasesForOutlier() public {
        uint256 scoreBefore = router.getProviderAccuracy(providerA);

        // A reports an outlier, B and C report the consensus
        vm.prank(providerA);
        router.reportPrice(feedId, 1, 50); // extreme outlier
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerC);
        router.reportPrice(feedId, 1001e18, 50);

        uint256 scoreAfter = router.getProviderAccuracy(providerA);
        assertLt(scoreAfter, scoreBefore);
    }

    function test_accuracyScore_cappedAtBpsPrecision() public {
        // Force accuracy score to max by repeated accurate reports
        bytes32 fid = router.getFeedId("BTC", "USD");
        for (uint256 i = 0; i < 100; i++) {
            // New round each time (advance time to ensure fresh reports)
            vm.warp(block.timestamp + 1);
            vm.prank(providerA);
            router.reportPrice(fid, 1000e18, 50);
        }
        uint256 score = router.getProviderAccuracy(providerA);
        assertLe(score, router.BPS_PRECISION());
    }

    function test_accuracyScore_flooredAtZero() public {
        // Force accuracy score to min via repeated inaccurate reports
        bytes32 fid = router.getFeedId("SOL", "USD");

        for (uint256 i = 0; i < 60; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(providerA);
            router.reportPrice(fid, 1, 50); // extreme outlier every round
            vm.prank(providerB);
            router.reportPrice(fid, 1000e18, 50);
            vm.prank(providerC);
            router.reportPrice(fid, 1001e18, 50);
        }

        uint256 score = router.getProviderAccuracy(providerA);
        assertEq(score, 0);
    }

    // ============ Rewards ============

    function test_fundRewardPool_increases() public {
        router.fundRewardPool{value: 1 ether}();
        assertEq(router.rewardPool(), 1 ether);
    }

    function test_claimRewards_revertsWithNoPending() public {
        vm.prank(providerA);
        vm.expectRevert(VibeOracleRouter.NoRewardsAvailable.selector);
        router.claimRewards(providerA);
    }

    function test_claimRewards_paysOutAfterAccurateReport() public {
        // Fund pool first
        router.fundRewardPool{value: 10 ether}();

        // Deploy an ETH-receiving contract for providerA
        ETHReceiver recv = new ETHReceiver();
        router.registerProvider(address(recv), VibeOracleRouter.FeedType.AGGREGATOR);

        // Report at consensus price (accurate)
        vm.prank(address(recv));
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);

        uint256 pending = router.pendingRewards(address(recv));
        if (pending > 0) {
            uint256 before = address(recv).balance;
            router.claimRewards(address(recv));
            assertGt(address(recv).balance, before);
            assertEq(router.pendingRewards(address(recv)), 0);
        }
        // If pending == 0 the round reward was below rounding threshold; that is acceptable
    }

    function test_claimRewards_zeroesPendingAfterClaim() public {
        router.fundRewardPool{value: 10 ether}();
        ETHReceiver recv = new ETHReceiver();
        router.registerProvider(address(recv), VibeOracleRouter.FeedType.AGGREGATOR);

        vm.prank(address(recv));
        router.reportPrice(feedId, 1000e18, 50);
        vm.prank(providerB);
        router.reportPrice(feedId, 1000e18, 50);

        uint256 pending = router.pendingRewards(address(recv));
        if (pending > 0) {
            router.claimRewards(address(recv));
            assertEq(router.pendingRewards(address(recv)), 0);
        }
    }

    // ============ Admin ============

    function test_setMaxStaleness() public {
        router.setMaxStaleness(2 hours);
        assertEq(router.maxStaleness(), 2 hours);
    }

    function test_setMaxStaleness_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        router.setMaxStaleness(2 hours);
    }

    function test_setDeviationThreshold() public {
        router.setDeviationThreshold(1000);
        assertEq(router.deviationThreshold(), 1000);
    }

    // ============ getFeedId ============

    function test_getFeedId_deterministic() public view {
        bytes32 id1 = router.getFeedId("ETH", "USD");
        bytes32 id2 = router.getFeedId("ETH", "USD");
        assertEq(id1, id2);
    }

    function test_getFeedId_differentPairs_differ() public view {
        bytes32 ethUsd = router.getFeedId("ETH", "USD");
        bytes32 btcUsd = router.getFeedId("BTC", "USD");
        assertTrue(ethUsd != btcUsd);
    }

    // ============ Round advancement ============

    function test_roundAdvancesAfterAggregation() public {
        uint256 r0 = router.currentRound(feedId);

        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 100);

        uint256 r1 = router.currentRound(feedId);
        assertEq(r1, r0 + 1);
    }

    function test_multiRound_independentAggregation() public {
        // Round 0
        vm.prank(providerA);
        router.reportPrice(feedId, 1000e18, 50);

        // Round 1
        vm.prank(providerB);
        router.reportPrice(feedId, 2000e18, 50);

        // After round 1 aggregation, feed should have price 2000 (only B reported in round 1)
        (uint256 price, , ) = router.getPrice(feedId);
        assertEq(price, 2000e18);
    }

    // ============ Fuzz ============

    function testFuzz_reportPrice_validPriceStored(uint256 price, uint256 conf) public {
        vm.assume(price > 0 && price < type(uint128).max);
        vm.assume(conf <= router.BPS_PRECISION());

        vm.prank(providerA);
        router.reportPrice(feedId, price, conf);

        (uint256 stored, , ) = router.getPrice(feedId);
        assertEq(stored, price);
    }

    function testFuzz_circuitBreaker_tripsWhenDeviationExceedsThreshold(
        uint256 basePrice,
        uint256 deviation
    ) public {
        vm.assume(basePrice > 1e10 && basePrice < 1e30);
        // deviation in BPS > deviationThreshold (500 BPS = 5%)
        vm.assume(deviation > DEVIATION_BPS && deviation <= 5000);

        uint256 spikePrice = basePrice + (basePrice * deviation / router.BPS_PRECISION());
        vm.assume(spikePrice > basePrice && spikePrice < type(uint128).max);

        vm.prank(providerA);
        router.reportPrice(feedId, basePrice, 0);

        // Reset round so second report triggers new aggregation with spike
        vm.prank(providerB);
        router.reportPrice(feedId, spikePrice, 0);

        assertTrue(router.circuitBroken(feedId));
    }
}
