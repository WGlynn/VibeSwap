// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/AdversarialSymbiosis.sol";
import "../../contracts/mechanism/TemporalCollateral.sol";
import "../../contracts/mechanism/EpistemicStaking.sol";
import "../../contracts/libraries/MemorylessFairness.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ MemorylessFairness Harness ============

contract MemorylessFairnessHarness {
    using MemorylessFairness for *;

    function computeFairOrdering(bytes32 seed, uint256 count)
        external pure returns (uint256[] memory indices, bytes32 proofHash)
    {
        return MemorylessFairness.computeFairOrdering(seed, count);
    }

    function verifyFairOrdering(bytes32 seed, uint256[] memory ordering, uint256 count)
        external pure returns (bool)
    {
        return MemorylessFairness.verifyFairOrdering(seed, ordering, count);
    }

    function computeUniformClearingPrice(
        uint256[] memory buyPrices,
        uint256[] memory buyAmounts,
        uint256[] memory sellPrices,
        uint256[] memory sellAmounts
    ) external pure returns (MemorylessFairness.ClearingResult memory) {
        return MemorylessFairness.computeUniformClearingPrice(buyPrices, buyAmounts, sellPrices, sellAmounts);
    }

    function computeFairAllocation(bytes32 seed, uint256 total, uint256 count)
        external pure returns (uint256[] memory)
    {
        return MemorylessFairness.computeFairAllocation(seed, total, count);
    }

    function generateFairnessProof(bytes32 seed, uint256 count, uint256 price)
        external pure returns (MemorylessFairness.FairnessProof memory)
    {
        return MemorylessFairness.generateFairnessProof(seed, count, price);
    }

    function verifyFairnessProof(MemorylessFairness.FairnessProof memory proof)
        external pure returns (bool)
    {
        return MemorylessFairness.verifyFairnessProof(proof);
    }

    function verifyBatchIndependence(bytes32 s1, bytes32 s2) external pure returns (bool) {
        return MemorylessFairness.verifyBatchIndependence(s1, s2);
    }
}

// ============ AdversarialSymbiosis Tests ============

contract AdversarialSymbiosisTest is Test {
    AdversarialSymbiosis public asym;
    MockERC20 public token;

    address treasury = makeAddr("treasury");
    address insurance = makeAddr("insurance");
    address traderRewards = makeAddr("traderRewards");
    address priceDiscovery = makeAddr("priceDiscovery");
    address reserve = makeAddr("reserve");
    address adversary = makeAddr("adversary");
    address recorder = makeAddr("recorder");

    function setUp() public {
        token = new MockERC20();
        asym = new AdversarialSymbiosis(treasury, address(token));
        asym.setTargetAddresses(insurance, traderRewards, priceDiscovery, reserve);
        asym.addRecorder(recorder);
    }

    function test_constructorRevertsZeroAddress() public {
        vm.expectRevert(IAdversarialSymbiosis.ZeroAddress.selector);
        new AdversarialSymbiosis(address(0), address(token));
    }

    function test_recordAndDistribute_invalidReveal() public {
        uint256 amount = 100 ether;
        token.mint(recorder, amount);

        vm.startPrank(recorder);
        token.approve(address(asym), amount);
        bytes32 eventId = asym.recordAdversarialEvent(
            1, adversary, IAdversarialSymbiosis.AdversarialType.INVALID_REVEAL, amount
        );
        vm.stopPrank();

        // Check event recorded
        IAdversarialSymbiosis.AdversarialEvent memory evt = asym.getEvent(eventId);
        assertEq(evt.capturedValue, amount);
        assertEq(evt.adversary, adversary);
        assertFalse(evt.distributed);

        // Distribute
        asym.distributeStrengthening(eventId);

        // INVALID_REVEAL: 50% insurance, 30% trader rewards, 20% reserve
        assertEq(token.balanceOf(insurance), 50 ether);
        assertEq(token.balanceOf(traderRewards), 30 ether);
        assertEq(token.balanceOf(reserve), 20 ether);

        // Stats updated
        IAdversarialSymbiosis.StrengtheningStats memory stats = asym.getStats();
        assertEq(stats.totalCaptured, amount);
        assertEq(stats.totalDistributed, amount);
        assertEq(stats.eventCount, 1);
        assertEq(stats.insurancePoolFunded, 50 ether);
    }

    function test_cannotDoubleDistribute() public {
        uint256 amount = 10 ether;
        token.mint(recorder, amount);
        vm.startPrank(recorder);
        token.approve(address(asym), amount);
        bytes32 eventId = asym.recordAdversarialEvent(
            1, adversary, IAdversarialSymbiosis.AdversarialType.GRIEFING, amount
        );
        vm.stopPrank();

        asym.distributeStrengthening(eventId);

        vm.expectRevert(IAdversarialSymbiosis.AlreadyDistributed.selector);
        asym.distributeStrengthening(eventId);
    }

    function test_unauthorizedCannotRecord() public {
        address rando = makeAddr("rando");
        token.mint(rando, 10 ether);
        vm.startPrank(rando);
        token.approve(address(asym), 10 ether);
        vm.expectRevert(IAdversarialSymbiosis.NotAuthorized.selector);
        asym.recordAdversarialEvent(
            1, adversary, IAdversarialSymbiosis.AdversarialType.GRIEFING, 10 ether
        );
        vm.stopPrank();
    }

    function test_allocationSumsMustBe10000() public {
        IAdversarialSymbiosis.StrengtheningTarget[] memory targets = new IAdversarialSymbiosis.StrengtheningTarget[](2);
        targets[0] = IAdversarialSymbiosis.StrengtheningTarget.INSURANCE_POOL;
        targets[1] = IAdversarialSymbiosis.StrengtheningTarget.PROTOCOL_RESERVE;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5000;
        bps[1] = 4999; // doesn't sum to 10000

        vm.expectRevert(IAdversarialSymbiosis.InvalidAllocation.selector);
        asym.setAllocation(IAdversarialSymbiosis.AdversarialType.GRIEFING, targets, bps);
    }

    function test_adversaryTotalAccumulates() public {
        token.mint(recorder, 50 ether);
        vm.startPrank(recorder);
        token.approve(address(asym), 50 ether);
        asym.recordAdversarialEvent(1, adversary, IAdversarialSymbiosis.AdversarialType.GRIEFING, 20 ether);
        asym.recordAdversarialEvent(2, adversary, IAdversarialSymbiosis.AdversarialType.SYBIL_DETECTED, 30 ether);
        vm.stopPrank();

        assertEq(asym.getAdversaryTotal(adversary), 50 ether);
    }

    function testFuzz_distributionConserved(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        token.mint(recorder, amount);

        vm.startPrank(recorder);
        token.approve(address(asym), amount);
        bytes32 eventId = asym.recordAdversarialEvent(
            1, adversary, IAdversarialSymbiosis.AdversarialType.INVALID_REVEAL, amount
        );
        vm.stopPrank();

        asym.distributeStrengthening(eventId);

        // All tokens accounted for
        uint256 total = token.balanceOf(insurance) + token.balanceOf(traderRewards) + token.balanceOf(reserve);
        assertEq(total, amount, "Conservation violated");
    }
}

// ============ TemporalCollateral Tests ============

contract TemporalCollateralTest is Test {
    TemporalCollateral public tc;
    address advSym = makeAddr("advSym");
    address committer = makeAddr("committer");
    address verifier = makeAddr("verifier");

    function setUp() public {
        tc = new TemporalCollateral(advSym);
        tc.setVerifier(verifier, true);
        vm.deal(committer, 100 ether);
    }

    function _createCommitment(uint64 duration, uint64 interval) internal returns (bytes32) {
        ITemporalCollateral.CommitmentParams memory params = ITemporalCollateral.CommitmentParams({
            commitType: ITemporalCollateral.CommitmentType.LIQUIDITY_PROVISION,
            stateHash: keccak256("test"),
            duration: duration,
            checkpointInterval: interval
        });
        vm.prank(committer);
        return tc.createCommitment{value: 1 ether}(params);
    }

    function test_createCommitment() public {
        bytes32 id = _createCommitment(200, 50);

        ITemporalCollateral.StateCommitment memory c = tc.getCommitment(id);
        assertEq(c.committer, committer);
        assertEq(c.stakedCollateral, 1 ether);
        assertEq(c.collateralValue, 1 ether);
        assertEq(uint8(c.status), uint8(ITemporalCollateral.CommitmentStatus.ACTIVE));
    }

    function test_checkpointGrowsValue() public {
        bytes32 id = _createCommitment(500, 100);

        // Advance and verify checkpoint
        vm.roll(block.number + 100);
        vm.prank(verifier);
        tc.verifyCheckpoint(id, "");

        ITemporalCollateral.StateCommitment memory c = tc.getCommitment(id);
        assertEq(c.checkpointsPassed, 1);
        // Value should grow: staked * (1e18 + 1e15 * 1) / 1e18 = staked * 1.001
        assertGt(c.collateralValue, 1 ether);
        assertEq(c.collateralValue, 1 ether + 0.001 ether);
    }

    function test_multipleCheckpoints() public {
        bytes32 id = _createCommitment(500, 50);

        for (uint256 i = 1; i <= 5; i++) {
            vm.roll(block.number + 50);
            vm.prank(verifier);
            tc.verifyCheckpoint(id, "");
        }

        ITemporalCollateral.StateCommitment memory c = tc.getCommitment(id);
        assertEq(c.checkpointsPassed, 5);
        // staked * (1e18 + 5 * 1e15) / 1e18 = staked * 1.005
        assertEq(c.collateralValue, 1 ether + 0.005 ether);
    }

    function test_tooEarlyCheckpointReverts() public {
        bytes32 id = _createCommitment(500, 100);
        // Don't advance enough blocks
        vm.roll(block.number + 50);
        vm.prank(verifier);
        vm.expectRevert(ITemporalCollateral.CheckpointTooEarly.selector);
        tc.verifyCheckpoint(id, "");
    }

    function test_breachSlashes50Pct() public {
        bytes32 id = _createCommitment(500, 100);

        uint256 advSymBefore = advSym.balance;
        uint256 committerBefore = committer.balance;

        tc.reportBreach(id, "");

        // 50% slash forwarded to adversarial symbiosis
        assertEq(advSym.balance - advSymBefore, 0.5 ether);
        // 50% returned to committer
        assertEq(committer.balance - committerBefore, 0.5 ether);

        // Status is BREACHED
        ITemporalCollateral.StateCommitment memory c = tc.getCommitment(id);
        assertEq(uint8(c.status), uint8(ITemporalCollateral.CommitmentStatus.BREACHED));
    }

    function test_completeAfterDuration() public {
        bytes32 id = _createCommitment(200, 50);

        vm.roll(block.number + 200);
        uint256 before = committer.balance;
        vm.prank(committer);
        tc.completeCommitment(id);

        // Full collateral returned
        assertEq(committer.balance - before, 1 ether);

        ITemporalCollateral.StateCommitment memory c = tc.getCommitment(id);
        assertEq(uint8(c.status), uint8(ITemporalCollateral.CommitmentStatus.COMPLETED));
    }

    function test_cannotCompleteEarly() public {
        bytes32 id = _createCommitment(500, 100);
        vm.roll(block.number + 100); // Not enough
        vm.prank(committer);
        vm.expectRevert(ITemporalCollateral.CheckpointTooEarly.selector);
        tc.completeCommitment(id);
    }

    function test_breachedValueIsZero() public {
        bytes32 id = _createCommitment(500, 100);
        tc.reportBreach(id, "");
        assertEq(tc.getCollateralValue(id), 0);
    }

    function test_zeroValueReverts() public {
        ITemporalCollateral.CommitmentParams memory params = ITemporalCollateral.CommitmentParams({
            commitType: ITemporalCollateral.CommitmentType.LIQUIDITY_PROVISION,
            stateHash: keccak256("test"),
            duration: 200,
            checkpointInterval: 50
        });
        vm.prank(committer);
        vm.expectRevert(ITemporalCollateral.ZeroAmount.selector);
        tc.createCommitment{value: 0}(params);
    }
}

// ============ EpistemicStaking Tests ============

contract EpistemicStakingTest is Test {
    EpistemicStaking public es;
    address staker = makeAddr("staker");
    address resolver = makeAddr("resolver");

    function setUp() public {
        es = new EpistemicStaking();
        es.addResolver(resolver);
    }

    function _predict(uint256 marketId, bool yes, uint256 confidence) internal returns (bytes32) {
        vm.prank(staker);
        return es.recordPrediction(marketId, yes, confidence);
    }

    function _resolve(bytes32 predictionId, bool actual) internal {
        vm.prank(resolver);
        es.resolvePrediction(predictionId, actual);
    }

    function test_recordPrediction() public {
        bytes32 id = _predict(1, true, 80);
        IEpistemicStaking.PredictionRecord memory p = es.getPrediction(id);
        assertEq(p.staker, staker);
        assertTrue(p.predictedYes);
        assertEq(p.confidence, 80);
        assertFalse(p.resolved);
    }

    function test_cannotPredictSameMarketTwice() public {
        _predict(1, true, 80);
        vm.prank(staker);
        vm.expectRevert(IEpistemicStaking.MarketAlreadyPredicted.selector);
        es.recordPrediction(1, false, 50);
    }

    function test_correctPredictionUpdatesEMA() public {
        bytes32 id = _predict(1, true, 80);
        _resolve(id, true); // correct

        IEpistemicStaking.EpistemicProfile memory p = es.getProfile(staker);
        assertEq(p.totalPredictions, 1);
        assertEq(p.correctPredictions, 1);
        assertEq(p.streak, 1);
        assertGt(p.accuracyEMA, 0);
    }

    function test_incorrectResetStreak() public {
        // Build a streak
        for (uint256 i = 1; i <= 3; i++) {
            bytes32 id = _predict(i, true, 80);
            _resolve(id, true);
        }
        assertEq(es.getProfile(staker).streak, 3);

        // Wrong prediction resets streak
        bytes32 wrongId = _predict(4, true, 80);
        _resolve(wrongId, false);
        assertEq(es.getProfile(staker).streak, 0);
        assertEq(es.getProfile(staker).longestStreak, 3);
    }

    function test_weightRequiresMinPredictions() public {
        // Less than MIN_PREDICTIONS (5) → weight stays 0
        for (uint256 i = 1; i <= 4; i++) {
            bytes32 id = _predict(i, true, 80);
            _resolve(id, true);
        }
        assertEq(es.getProfile(staker).epistemicWeight, 0);

        // 5th prediction → weight becomes nonzero
        bytes32 id5 = _predict(5, true, 80);
        _resolve(id5, true);
        assertGt(es.getProfile(staker).epistemicWeight, 0);
    }

    function test_inactivityDecay() public {
        // Build up weight
        for (uint256 i = 1; i <= 6; i++) {
            bytes32 id = _predict(i, true, 90);
            _resolve(id, true);
        }
        uint256 weightBefore = es.getProfile(staker).epistemicWeight;
        assertGt(weightBefore, 0);

        // Advance past inactivity threshold (50 blocks per period)
        vm.roll(block.number + 150); // 3 inactive periods
        es.applyInactivityDecay(staker);

        uint256 weightAfter = es.getProfile(staker).epistemicWeight;
        assertLt(weightAfter, weightBefore);
    }

    function test_totalWeightTracking() public {
        address staker2 = makeAddr("staker2");

        // Staker 1: 5 correct
        for (uint256 i = 1; i <= 5; i++) {
            bytes32 id = _predict(i, true, 90);
            _resolve(id, true);
        }

        // Staker 2: 5 correct
        for (uint256 i = 6; i <= 10; i++) {
            vm.prank(staker2);
            bytes32 id2 = es.recordPrediction(i, true, 90);
            _resolve(id2, true);
        }

        uint256 w1 = es.getProfile(staker).epistemicWeight;
        uint256 w2 = es.getProfile(staker2).epistemicWeight;
        assertEq(es.getTotalEpistemicWeight(), w1 + w2);
    }

    function test_invalidConfidenceReverts() public {
        vm.prank(staker);
        vm.expectRevert(IEpistemicStaking.InvalidConfidence.selector);
        es.recordPrediction(1, true, 0);

        vm.prank(staker);
        vm.expectRevert(IEpistemicStaking.InvalidConfidence.selector);
        es.recordPrediction(2, true, 101);
    }

    function test_unauthorizedResolver() public {
        bytes32 id = _predict(1, true, 80);
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(IEpistemicStaking.NotAuthorized.selector);
        es.resolvePrediction(id, true);
    }
}

// ============ MemorylessFairness Tests ============

contract MemorylessFairnessTest is Test {
    MemorylessFairnessHarness public mf;

    function setUp() public {
        mf = new MemorylessFairnessHarness();
    }

    function test_fairOrderingDeterministic() public view {
        bytes32 seed = keccak256("test_seed");
        (uint256[] memory a, bytes32 hashA) = mf.computeFairOrdering(seed, 10);
        (uint256[] memory b, bytes32 hashB) = mf.computeFairOrdering(seed, 10);

        assertEq(hashA, hashB);
        for (uint256 i; i < 10; i++) {
            assertEq(a[i], b[i]);
        }
    }

    function test_fairOrderingIsPermutation() public view {
        bytes32 seed = keccak256("perm_test");
        (uint256[] memory indices, ) = mf.computeFairOrdering(seed, 8);

        // Every index 0..7 must appear exactly once
        bool[8] memory seen;
        for (uint256 i; i < 8; i++) {
            assertLt(indices[i], 8);
            assertFalse(seen[indices[i]], "duplicate index");
            seen[indices[i]] = true;
        }
    }

    function test_differentSeedsDifferentOrderings() public view {
        bytes32 s1 = keccak256("seed1");
        bytes32 s2 = keccak256("seed2");
        (, bytes32 h1) = mf.computeFairOrdering(s1, 10);
        (, bytes32 h2) = mf.computeFairOrdering(s2, 10);
        assertTrue(h1 != h2);
    }

    function test_verifyFairOrdering() public view {
        bytes32 seed = keccak256("verify");
        (uint256[] memory ordering, ) = mf.computeFairOrdering(seed, 5);
        assertTrue(mf.verifyFairOrdering(seed, ordering, 5));

        // Tampered ordering fails
        uint256[] memory bad = new uint256[](5);
        for (uint256 i; i < 5; i++) bad[i] = ordering[i];
        bad[0] = ordering[1];
        bad[1] = ordering[0]; // swap two elements
        assertFalse(mf.verifyFairOrdering(seed, bad, 5));
    }

    function test_uniformClearingPrice() public view {
        uint256[] memory buyPrices = new uint256[](3);
        uint256[] memory buyAmounts = new uint256[](3);
        uint256[] memory sellPrices = new uint256[](3);
        uint256[] memory sellAmounts = new uint256[](3);

        // Buyers willing to pay 110, 105, 100
        buyPrices[0] = 110; buyAmounts[0] = 10;
        buyPrices[1] = 105; buyAmounts[1] = 15;
        buyPrices[2] = 100; buyAmounts[2] = 20;

        // Sellers willing to sell at 95, 100, 108
        sellPrices[0] = 95;  sellAmounts[0] = 12;
        sellPrices[1] = 100; sellAmounts[1] = 18;
        sellPrices[2] = 108; sellAmounts[2] = 10;

        MemorylessFairness.ClearingResult memory result =
            mf.computeUniformClearingPrice(buyPrices, buyAmounts, sellPrices, sellAmounts);

        // Clearing price should maximize volume
        assertGt(result.clearingPrice, 0);
        assertGt(result.totalFilled, 0);
    }

    function test_fairAllocationConservesTotal() public view {
        bytes32 seed = keccak256("alloc_test");
        uint256 total = 1000;
        uint256 count = 7;

        uint256[] memory allocs = mf.computeFairAllocation(seed, total, count);
        assertEq(allocs.length, count);

        uint256 sum;
        for (uint256 i; i < count; i++) sum += allocs[i];
        assertEq(sum, total, "Allocation must conserve total");
    }

    function testFuzz_allocationConservation(uint256 total, uint256 count) public view {
        total = bound(total, 0, 1e24);
        count = bound(count, 1, 100);

        uint256[] memory allocs = mf.computeFairAllocation(keccak256("fuzz"), total, count);

        uint256 sum;
        for (uint256 i; i < count; i++) sum += allocs[i];
        assertEq(sum, total);
    }

    function test_fairnessProofRoundtrip() public view {
        bytes32 seed = keccak256("proof_test");
        MemorylessFairness.FairnessProof memory proof =
            mf.generateFairnessProof(seed, 20, 1500);

        assertTrue(mf.verifyFairnessProof(proof));
        assertEq(proof.clearingPrice, 1500);
        assertEq(proof.participantCount, 20);
    }

    function test_batchIndependence() public view {
        bytes32 s1 = keccak256("batch1");
        bytes32 s2 = keccak256("batch2");
        assertTrue(mf.verifyBatchIndependence(s1, s2));
        assertFalse(mf.verifyBatchIndependence(s1, s1));
    }

    function test_emptyOrdersNoClear() public view {
        uint256[] memory empty = new uint256[](0);
        MemorylessFairness.ClearingResult memory result =
            mf.computeUniformClearingPrice(empty, empty, empty, empty);
        assertEq(result.clearingPrice, 0);
    }
}
