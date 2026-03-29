// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/SIEShapleyAdapter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SIEShapleyAdapterTest is Test {
    // Mirror events from SIEShapleyAdapter for vm.expectEmit
    event TrueUpInitiated(bytes32 indexed roundId, uint256 totalPool, uint256 participantCount);
    event TrueUpFinalized(bytes32 indexed roundId, uint256 distributed);
    event SettlementAccumulated(bytes32 indexed assetId, address indexed contributor, bool verified, uint256 bondingPrice);

    SIEShapleyAdapter public adapter;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    // Mock addresses for constructor dependencies
    address public mockSIE = address(uint160(0x51E));
    address public mockDistributor = address(uint160(0xD157));
    address public mockVerifier = address(uint160(0xBE41));

    function setUp() public {
        // Deploy SIEShapleyAdapter behind UUPS proxy
        SIEShapleyAdapter impl = new SIEShapleyAdapter();
        bytes memory initData = abi.encodeCall(
            SIEShapleyAdapter.initialize,
            (mockSIE, mockDistributor, mockVerifier, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        adapter = SIEShapleyAdapter(payable(address(proxy)));
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(adapter.intelligenceExchange(), mockSIE);
        assertEq(adapter.shapleyDistributor(), mockDistributor);
        assertEq(adapter.shapleyVerifier(), mockVerifier);
        assertEq(adapter.owner(), owner);
        assertEq(adapter.roundCount(), 0);
        assertEq(adapter.lastTrueUpTimestamp(), 0);
    }

    function test_initialize_revert_doubleInit() public {
        vm.expectRevert();
        adapter.initialize(mockSIE, mockDistributor, mockVerifier, owner);
    }

    // ============ Weight Constants ============

    function test_weightFactorsSumTo100Percent() public view {
        uint256 sum = adapter.WEIGHT_ORIGINALITY()
            + adapter.WEIGHT_CITATION()
            + adapter.WEIGHT_SCARCITY()
            + adapter.WEIGHT_CONSISTENCY();
        assertEq(sum, adapter.BPS(), "Weight factors must sum to 10000 BPS (100%)");
    }

    function test_weightBreakdownMatchesConstants() public view {
        (uint256 originality, uint256 citation, uint256 scarcity, uint256 consistency) =
            adapter.getWeightBreakdown();
        assertEq(originality, 4000, "Originality weight should be 40%");
        assertEq(citation, 3000, "Citation weight should be 30%");
        assertEq(scarcity, 2000, "Scarcity weight should be 20%");
        assertEq(consistency, 1000, "Consistency weight should be 10%");
    }

    // ============ computeWeight ============

    function test_computeWeight_allMax() public view {
        uint256 weight = adapter.computeWeight(10000, 10000, 10000, 10000);
        assertEq(weight, 10000, "All-max inputs should yield 10000 BPS total weight");
    }

    function test_computeWeight_allZeros() public view {
        uint256 weight = adapter.computeWeight(0, 0, 0, 0);
        assertEq(weight, 0, "All-zero inputs should yield zero weight");
    }

    function test_computeWeight_onlyOriginality() public view {
        uint256 weight = adapter.computeWeight(10000, 0, 0, 0);
        assertEq(weight, 4000, "Max originality alone should yield 4000 (40%)");
    }

    function test_computeWeight_onlyCitation() public view {
        uint256 weight = adapter.computeWeight(0, 10000, 0, 0);
        assertEq(weight, 3000, "Max citation alone should yield 3000 (30%)");
    }

    function test_computeWeight_onlyScarcity() public view {
        uint256 weight = adapter.computeWeight(0, 0, 10000, 0);
        assertEq(weight, 2000, "Max scarcity alone should yield 2000 (20%)");
    }

    function test_computeWeight_onlyConsistency() public view {
        uint256 weight = adapter.computeWeight(0, 0, 0, 10000);
        assertEq(weight, 1000, "Max consistency alone should yield 1000 (10%)");
    }

    function test_computeWeight_mixedValues() public view {
        uint256 weight = adapter.computeWeight(5000, 8000, 3000, 7000);
        assertEq(weight, 5700, "Mixed inputs should yield correct weighted sum");
    }

    function test_computeWeight_halfValues() public view {
        uint256 weight = adapter.computeWeight(5000, 5000, 5000, 5000);
        assertEq(weight, 5000, "All-half inputs should yield 5000 (50%)");
    }

    function test_computeWeight_clampsAboveBPS() public view {
        uint256 weight = adapter.computeWeight(20000, 20000, 20000, 20000);
        uint256 maxWeight = adapter.computeWeight(10000, 10000, 10000, 10000);
        assertEq(weight, maxWeight, "Inputs above BPS should be clamped to BPS");
    }

    function test_computeWeight_singleFactorDominant_originality() public view {
        uint256 weight = adapter.computeWeight(10000, 100, 100, 100);
        assertEq(weight, 4060, "Originality-dominant case");
    }

    function test_computeWeight_singleFactorDominant_citation() public view {
        uint256 weight = adapter.computeWeight(100, 10000, 100, 100);
        assertEq(weight, 3070, "Citation-dominant case");
    }

    function test_computeWeight_isPure() public view {
        uint256 w1 = adapter.computeWeight(1234, 5678, 9012, 3456);
        uint256 w2 = adapter.computeWeight(1234, 5678, 9012, 3456);
        assertEq(w1, w2, "computeWeight must be deterministic");
    }

    // ============ onSettlement ============

    function test_onSettlement_accumulates() public {
        bytes32 assetId = keccak256("test-asset");

        vm.prank(mockSIE);
        adapter.onSettlement(assetId, alice, true, 1 ether, 3);

        assertEq(adapter.getPendingSettlementCount(), 1);
        assertEq(adapter.getPendingContributorCount(), 1);
        assertEq(adapter.pendingTotalValue(), 1 ether);
    }

    function test_onSettlement_multipleFromSameContributor() public {
        bytes32 asset1 = keccak256("asset-1");
        bytes32 asset2 = keccak256("asset-2");

        vm.startPrank(mockSIE);
        adapter.onSettlement(asset1, alice, true, 1 ether, 2);
        adapter.onSettlement(asset2, alice, true, 2 ether, 5);
        vm.stopPrank();

        assertEq(adapter.getPendingSettlementCount(), 2);
        assertEq(adapter.getPendingContributorCount(), 1, "Same contributor counted once");
        assertEq(adapter.pendingTotalValue(), 3 ether);
    }

    function test_onSettlement_disputedNotAddedToValue() public {
        bytes32 assetId = keccak256("disputed-asset");

        vm.prank(mockSIE);
        adapter.onSettlement(assetId, alice, false, 1 ether, 3);

        assertEq(adapter.getPendingSettlementCount(), 1);
        assertEq(adapter.pendingTotalValue(), 0, "Disputed settlements don't add to value");
    }

    function test_onSettlement_emitsEvent() public {
        bytes32 assetId = keccak256("event-asset");

        vm.expectEmit(true, true, false, true);
        emit SettlementAccumulated(assetId, alice, true, 1 ether);

        vm.prank(mockSIE);
        adapter.onSettlement(assetId, alice, true, 1 ether, 3);
    }

    function test_onSettlement_revert_notSIE() public {
        vm.prank(alice);
        vm.expectRevert(SIEShapleyAdapter.NotIntelligenceExchange.selector);
        adapter.onSettlement(keccak256("x"), alice, true, 1 ether, 1);
    }

    // ============ initiateTrueUp (legacy) ============

    function test_initiateTrueUp_createsRound() public {
        uint256 totalPool = 1000 ether;
        uint256 participantCount = 42;

        adapter.initiateTrueUp(totalPool, participantCount);

        assertEq(adapter.roundCount(), 1);
        assertEq(adapter.lastTrueUpTimestamp(), block.timestamp);
    }

    function test_initiateTrueUp_roundParameters() public {
        uint256 totalPool = 500 ether;
        uint256 participantCount = 10;

        uint256 expectedRoundCount = 1;
        bytes32 expectedRoundId = keccak256(
            abi.encodePacked(expectedRoundCount, block.timestamp)
        );

        adapter.initiateTrueUp(totalPool, participantCount);

        SIEShapleyAdapter.TrueUpRound memory round = adapter.getRound(expectedRoundId);
        assertEq(round.roundId, expectedRoundId);
        assertEq(round.totalPool, totalPool);
        assertEq(round.participantCount, participantCount);
        assertEq(round.shapleyRoot, bytes32(0));
        assertEq(round.shapleyGameId, bytes32(0));
        assertEq(round.timestamp, block.timestamp);
        assertFalse(round.finalized);
    }

    function test_initiateTrueUp_emitsEvent() public {
        uint256 totalPool = 1000 ether;
        uint256 participantCount = 42;

        bytes32 expectedRoundId = keccak256(
            abi.encodePacked(uint256(1), block.timestamp)
        );

        vm.expectEmit(true, false, false, true);
        emit TrueUpInitiated(expectedRoundId, totalPool, participantCount);

        adapter.initiateTrueUp(totalPool, participantCount);
    }

    function test_initiateTrueUp_multipleRounds() public {
        adapter.initiateTrueUp(100 ether, 5);
        assertEq(adapter.roundCount(), 1);

        vm.warp(block.timestamp + 1 hours);

        adapter.initiateTrueUp(200 ether, 10);
        assertEq(adapter.roundCount(), 2);
        assertEq(adapter.lastTrueUpTimestamp(), block.timestamp);
    }

    function test_initiateTrueUp_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                alice
            )
        );
        adapter.initiateTrueUp(100 ether, 5);
    }

    // ============ finalizeTrueUp ============

    function test_finalizeTrueUp_setsShapleyRoot() public {
        adapter.initiateTrueUp(1000 ether, 42);
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));

        bytes32 shapleyRoot = keccak256("shapley-merkle-root");
        adapter.finalizeTrueUp(roundId, shapleyRoot);

        SIEShapleyAdapter.TrueUpRound memory round = adapter.getRound(roundId);
        assertEq(round.shapleyRoot, shapleyRoot);
        assertTrue(round.finalized);
    }

    function test_finalizeTrueUp_emitsEvent() public {
        uint256 totalPool = 1000 ether;
        adapter.initiateTrueUp(totalPool, 42);
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 shapleyRoot = keccak256("shapley-root");

        vm.expectEmit(true, false, false, true);
        emit TrueUpFinalized(roundId, totalPool);

        adapter.finalizeTrueUp(roundId, shapleyRoot);
    }

    function test_finalizeTrueUp_revert_alreadyFinalized() public {
        adapter.initiateTrueUp(1000 ether, 42);
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 shapleyRoot = keccak256("shapley-root");

        adapter.finalizeTrueUp(roundId, shapleyRoot);

        vm.expectRevert(SIEShapleyAdapter.RoundAlreadyFinalized.selector);
        adapter.finalizeTrueUp(roundId, keccak256("different-root"));
    }

    function test_finalizeTrueUp_revert_roundNotFound() public {
        bytes32 fakeRoundId = keccak256("nonexistent-round");

        vm.expectRevert(SIEShapleyAdapter.RoundNotFound.selector);
        adapter.finalizeTrueUp(fakeRoundId, keccak256("root"));
    }

    function test_finalizeTrueUp_revert_notOwner() public {
        adapter.initiateTrueUp(1000 ether, 42);
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                alice
            )
        );
        adapter.finalizeTrueUp(roundId, keccak256("root"));
    }

    // ============ Access Control ============

    function test_onlyOwner_initiateTrueUp() public {
        adapter.initiateTrueUp(100 ether, 5);
        assertEq(adapter.roundCount(), 1);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                bob
            )
        );
        adapter.initiateTrueUp(200 ether, 10);
    }

    function test_onlyOwner_finalizeTrueUp() public {
        adapter.initiateTrueUp(100 ether, 5);
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                bob
            )
        );
        adapter.finalizeTrueUp(roundId, keccak256("root"));

        adapter.finalizeTrueUp(roundId, keccak256("root"));
        assertTrue(adapter.getRound(roundId).finalized);
    }

    // ============ Full Flow Integration ============

    function test_fullFlow_initiateThenFinalize() public {
        uint256 totalPool = 5000 ether;
        uint256 participantCount = 100;
        adapter.initiateTrueUp(totalPool, participantCount);

        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));

        SIEShapleyAdapter.TrueUpRound memory pending = adapter.getRound(roundId);
        assertFalse(pending.finalized);
        assertEq(pending.shapleyRoot, bytes32(0));

        bytes32 shapleyRoot = keccak256("full-shapley-computation-result");
        adapter.finalizeTrueUp(roundId, shapleyRoot);

        SIEShapleyAdapter.TrueUpRound memory finalized = adapter.getRound(roundId);
        assertTrue(finalized.finalized);
        assertEq(finalized.shapleyRoot, shapleyRoot);
        assertEq(finalized.totalPool, totalPool);
        assertEq(finalized.participantCount, participantCount);
    }

    // ============ Fuzz Tests ============

    function testFuzz_computeWeight_bounded(
        uint256 originality,
        uint256 citationImpact,
        uint256 scarcity,
        uint256 consistency
    ) public view {
        uint256 weight = adapter.computeWeight(originality, citationImpact, scarcity, consistency);
        assertLe(weight, 10000, "Weight must never exceed 10000 BPS");
    }

    function testFuzz_computeWeight_correctFormula(
        uint256 originality,
        uint256 citationImpact,
        uint256 scarcity,
        uint256 consistency
    ) public view {
        originality = originality > 10000 ? 10000 : originality;
        citationImpact = citationImpact > 10000 ? 10000 : citationImpact;
        scarcity = scarcity > 10000 ? 10000 : scarcity;
        consistency = consistency > 10000 ? 10000 : consistency;

        uint256 expected = (
            originality * 4000 +
            citationImpact * 3000 +
            scarcity * 2000 +
            consistency * 1000
        ) / 10000;

        uint256 actual = adapter.computeWeight(originality, citationImpact, scarcity, consistency);
        assertEq(actual, expected, "Weight must match formula");
    }

    function testFuzz_trueUpRoundIdUnique(uint256 ts1, uint256 ts2) public {
        // Bound ts1 to [1, max-1] so ts1+1 never overflows and stays within uint128 range
        ts1 = bound(ts1, 1, type(uint128).max - 1);
        ts2 = bound(ts2, ts1 + 1, type(uint128).max);

        vm.warp(ts1);
        adapter.initiateTrueUp(100 ether, 5);
        bytes32 roundId1 = keccak256(abi.encodePacked(uint256(1), ts1));

        vm.warp(ts2);
        adapter.initiateTrueUp(200 ether, 10);
        bytes32 roundId2 = keccak256(abi.encodePacked(uint256(2), ts2));

        assertTrue(roundId1 != roundId2, "Different rounds must have different IDs");
    }

    // ============ Receive ETH ============

    function test_receiveEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool success,) = address(adapter).call{value: 0.5 ether}("");
        assertTrue(success, "Adapter should accept ETH via receive()");
        assertEq(address(adapter).balance, 0.5 ether);
    }
}
