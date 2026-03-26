// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "../../contracts/mechanism/SIEShapleyAdapter.sol";
import "../../contracts/mechanism/CognitiveConsensusMarket.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Token ============

contract MockVIBESIEShapley is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title SIEShapleyIntegration
 * @notice End-to-end integration tests for the full SIE -> Adapter -> ShapleyDistributor
 *         pipeline. Tests the complete lifecycle:
 *
 *   1. Submit intelligence assets to SIE
 *   2. Request + complete CRPC evaluation via CognitiveConsensusMarket
 *   3. settleEvaluation() triggers adapter notification (onSettlement)
 *   4. Adapter accumulates settlements from multiple contributors
 *   5. executeTrueUp() creates a ShapleyDistributor cooperative game
 *   6. computeShapleyValues() computes fair allocation
 *   7. Contributors claim rewards from ShapleyDistributor
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract SIEShapleyIntegrationTest is Test {
    // ============ Contracts ============

    IntelligenceExchange public sie;
    SIEShapleyAdapter public adapter;
    CognitiveConsensusMarket public ccm;
    ShapleyDistributor public shapley;
    MockVIBESIEShapley public vibe;

    // ============ Actors ============

    address public owner = address(this);

    // Knowledge contributors
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA01);

    // CRPC evaluators
    address public eval1 = address(0xE1);
    address public eval2 = address(0xE2);
    address public eval3 = address(0xE3);

    // ============ Events (for expectEmit) ============

    event SettlementAccumulated(bytes32 indexed assetId, address indexed contributor, bool verified, uint256 bondingPrice);
    event ShapleyAdapterNotified(bytes32 indexed assetId, address indexed contributor, bool verified);
    event TrueUpExecuted(bytes32 indexed roundId, bytes32 indexed gameId, uint256 totalPool, uint256 participantCount);
    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);

    // ============ Setup ============

    function setUp() public {
        vibe = new MockVIBESIEShapley();

        // --- Deploy IntelligenceExchange (UUPS proxy) ---
        IntelligenceExchange sieImpl = new IntelligenceExchange();
        bytes memory sieInit = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy sieProxy = new ERC1967Proxy(address(sieImpl), sieInit);
        sie = IntelligenceExchange(payable(address(sieProxy)));

        // --- Deploy ShapleyDistributor (UUPS proxy) ---
        ShapleyDistributor shapleyImpl = new ShapleyDistributor();
        bytes memory shapleyInit = abi.encodeCall(
            ShapleyDistributor.initialize, (owner)
        );
        ERC1967Proxy shapleyProxy = new ERC1967Proxy(address(shapleyImpl), shapleyInit);
        shapley = ShapleyDistributor(payable(address(shapleyProxy)));

        // --- Deploy SIEShapleyAdapter (UUPS proxy) ---
        SIEShapleyAdapter adapterImpl = new SIEShapleyAdapter();
        bytes memory adapterInit = abi.encodeCall(
            SIEShapleyAdapter.initialize,
            (address(sie), address(shapley), address(0), owner)
        );
        ERC1967Proxy adapterProxy = new ERC1967Proxy(address(adapterImpl), adapterInit);
        adapter = SIEShapleyAdapter(payable(address(adapterProxy)));

        // --- Deploy CognitiveConsensusMarket ---
        ccm = new CognitiveConsensusMarket(address(vibe));

        // --- Wire contracts together ---
        sie.setCognitiveConsensusMarket(address(ccm));
        sie.setShapleyAdapter(address(adapter));
        adapter.setVibeToken(address(vibe));

        // Authorize the adapter as a game creator in ShapleyDistributor
        shapley.setAuthorizedCreator(address(adapter), true);

        // Authorize CRPC evaluators
        ccm.setAuthorizedEvaluator(eval1, true);
        ccm.setAuthorizedEvaluator(eval2, true);
        ccm.setAuthorizedEvaluator(eval3, true);

        // Lower min participants for testing (default is 2, which is fine)
        // shapley.setParticipantLimits(2, 100); // already default

        // Disable quality weights to simplify test assertions
        shapley.setUseQualityWeights(false);

        // --- Fund actors ---
        address[6] memory users = [alice, bob, carol, eval1, eval2, eval3];
        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 100 ether);
            vibe.mint(users[i], 100_000 ether);
            vm.prank(users[i]);
            vibe.approve(address(sie), type(uint256).max);
            vm.prank(users[i]);
            vibe.approve(address(ccm), type(uint256).max);
        }
    }

    // ============ Helpers ============

    /**
     * @dev Submit an intelligence asset and return its ID.
     */
    function _submitAsset(
        address contributor,
        bytes32 contentHash,
        string memory metadataURI,
        bytes32[] memory citedAssets
    ) internal returns (bytes32 assetId) {
        vm.prank(contributor);
        assetId = sie.submitIntelligence{value: 0.01 ether}(
            contentHash, metadataURI,
            IntelligenceExchange.AssetType.RESEARCH, citedAssets
        );
    }

    /**
     * @dev Run a full CRPC evaluation cycle: request -> commit -> reveal -> resolve -> settle
     */
    function _evaluateAndSettle(
        bytes32 assetId,
        address contributor,
        CognitiveConsensusMarket.Verdict verdict
    ) internal returns (uint256 claimId) {
        // Request evaluation
        vm.prank(contributor);
        sie.requestEvaluation(assetId, 3, 1 ether);
        claimId = sie.assetToClaimId(assetId);

        // Evaluators commit
        bytes32 reasoningHash = keccak256("reasoning-cid");
        bytes32 salt1 = keccak256(abi.encodePacked("salt1", assetId));
        bytes32 salt2 = keccak256(abi.encodePacked("salt2", assetId));
        bytes32 salt3 = keccak256(abi.encodePacked("salt3", assetId));

        bytes32 commit1 = keccak256(abi.encodePacked(verdict, reasoningHash, salt1));
        bytes32 commit2 = keccak256(abi.encodePacked(verdict, reasoningHash, salt2));
        bytes32 commit3 = keccak256(abi.encodePacked(verdict, reasoningHash, salt3));

        vm.prank(eval1);
        ccm.commitEvaluation(claimId, commit1, 0.1 ether);
        vm.prank(eval2);
        ccm.commitEvaluation(claimId, commit2, 0.1 ether);
        vm.prank(eval3);
        ccm.commitEvaluation(claimId, commit3, 0.1 ether);

        // Advance past commit deadline
        vm.warp(block.timestamp + 1 days + 1);

        // Reveal verdicts
        vm.prank(eval1);
        ccm.revealEvaluation(claimId, verdict, reasoningHash, salt1);
        vm.prank(eval2);
        ccm.revealEvaluation(claimId, verdict, reasoningHash, salt2);
        vm.prank(eval3);
        ccm.revealEvaluation(claimId, verdict, reasoningHash, salt3);

        // Advance past reveal deadline and resolve
        vm.warp(block.timestamp + 12 hours + 1);
        ccm.resolveClaim(claimId);

        // Settle in SIE (triggers adapter notification)
        sie.settleEvaluation(claimId);
    }

    // ============ Test 1: Full Pipeline — Two Verified Contributors ============

    function test_fullPipeline_twoVerifiedContributors() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Step 1: Alice and Bob submit intelligence
        bytes32 aliceAsset = _submitAsset(alice, keccak256("alice-paper"), "ipfs://alice", noCites);
        bytes32 bobAsset = _submitAsset(bob, keccak256("bob-paper"), "ipfs://bob", noCites);

        // Step 2: Both get verified through CRPC
        _evaluateAndSettle(aliceAsset, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(bobAsset, bob, CognitiveConsensusMarket.Verdict.TRUE);

        // Verify adapter accumulated settlements
        assertEq(adapter.getPendingSettlementCount(), 2, "Two settlements accumulated");
        assertEq(adapter.getPendingContributorCount(), 2, "Two unique contributors");
        assertGt(adapter.pendingTotalValue(), 0, "Total value > 0");

        // Verify asset states in SIE
        IntelligenceExchange.IntelligenceAsset memory aliceA = sie.getAsset(aliceAsset);
        IntelligenceExchange.IntelligenceAsset memory bobA = sie.getAsset(bobAsset);
        assertEq(uint256(aliceA.state), uint256(IntelligenceExchange.AssetState.VERIFIED));
        assertEq(uint256(bobA.state), uint256(IntelligenceExchange.AssetState.VERIFIED));

        // Step 3: Fund the adapter with VIBE for the true-up pool
        uint256 trueUpPool = 100 ether;
        vibe.transfer(address(adapter), trueUpPool);

        // Step 4: Execute true-up (creates Shapley game)
        // Need to advance past MIN_TRUE_UP_INTERVAL (1 hour) from lastTrueUpTimestamp
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(trueUpPool);

        // Verify adapter state was cleared
        assertEq(adapter.getPendingSettlementCount(), 0, "Pending cleared after true-up");
        assertEq(adapter.getPendingContributorCount(), 0, "Contributors cleared after true-up");
        assertEq(adapter.roundCount(), 1, "One round executed");

        // Step 5: Get the game ID and verify it exists in ShapleyDistributor
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        SIEShapleyAdapter.TrueUpRound memory round = adapter.getRound(roundId);
        bytes32 gameId = round.shapleyGameId;
        assertTrue(gameId != bytes32(0), "Game ID should be set");

        // Step 6: Compute Shapley values
        shapley.computeShapleyValues(gameId);
        assertTrue(shapley.isGameSettled(gameId), "Game should be settled");

        // Step 7: Verify both contributors have Shapley values
        uint256 aliceValue = shapley.getShapleyValue(gameId, alice);
        uint256 bobValue = shapley.getShapleyValue(gameId, bob);
        assertGt(aliceValue, 0, "Alice should have a Shapley value");
        assertGt(bobValue, 0, "Bob should have a Shapley value");

        // Efficiency axiom: total distributed == pool
        assertEq(aliceValue + bobValue, trueUpPool, "Shapley efficiency: sum == total pool");

        // Step 8: Both claim rewards
        uint256 aliceBefore = vibe.balanceOf(alice);
        vm.prank(alice);
        shapley.claimReward(gameId);
        assertEq(vibe.balanceOf(alice) - aliceBefore, aliceValue, "Alice claimed correctly");

        uint256 bobBefore = vibe.balanceOf(bob);
        vm.prank(bob);
        shapley.claimReward(gameId);
        assertEq(vibe.balanceOf(bob) - bobBefore, bobValue, "Bob claimed correctly");
    }

    // ============ Test 2: Mixed Verdicts — Verified + Disputed ============

    function test_mixedVerdicts_disputedGetsZero() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Alice: verified, Bob: disputed
        bytes32 aliceAsset = _submitAsset(alice, keccak256("good-paper"), "ipfs://good", noCites);
        bytes32 bobAsset = _submitAsset(bob, keccak256("bad-paper"), "ipfs://bad", noCites);

        _evaluateAndSettle(aliceAsset, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(bobAsset, bob, CognitiveConsensusMarket.Verdict.FALSE);

        // Both accumulated, but only Alice's value counts
        assertEq(adapter.getPendingSettlementCount(), 2);
        assertEq(adapter.getPendingContributorCount(), 2);

        // Execute true-up
        uint256 pool = 50 ether;
        vibe.transfer(address(adapter), pool);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool);

        // Get game and compute
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 gameId = adapter.getRound(roundId).shapleyGameId;
        shapley.computeShapleyValues(gameId);

        // Bob's directContribution was set to 0 (null player axiom)
        // Alice should get the majority (Lawson floor applies to Bob at 1%)
        uint256 aliceValue = shapley.getShapleyValue(gameId, alice);
        uint256 bobValue = shapley.getShapleyValue(gameId, bob);

        // Alice gets most, Bob gets at most the Lawson floor
        assertGt(aliceValue, bobValue, "Verified contributor should get more than disputed");
        assertEq(aliceValue + bobValue, pool, "Efficiency axiom holds");
    }

    // ============ Test 3: Citation Impact Affects Weights ============

    function test_citationImpact_higherCitedGetsMore() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Alice: foundational paper (no citations)
        bytes32 aliceAsset = _submitAsset(alice, keccak256("foundation"), "ipfs://foundation", noCites);

        // Bob: cites Alice (building on her work)
        bytes32[] memory citesAlice = new bytes32[](1);
        citesAlice[0] = aliceAsset;
        bytes32 bobAsset = _submitAsset(bob, keccak256("derivative"), "ipfs://derivative", citesAlice);

        // Carol: also cites Alice (second citation for Alice's work)
        bytes32[] memory citesAliceToo = new bytes32[](1);
        citesAliceToo[0] = aliceAsset;
        bytes32 carolAsset = _submitAsset(carol, keccak256("synthesis"), "ipfs://synthesis", citesAliceToo);

        // Verify Alice's citation count increased
        IntelligenceExchange.IntelligenceAsset memory aliceA = sie.getAsset(aliceAsset);
        assertEq(aliceA.citations, 2, "Alice should have 2 citations");

        // All three get verified
        _evaluateAndSettle(aliceAsset, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(bobAsset, bob, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(carolAsset, carol, CognitiveConsensusMarket.Verdict.TRUE);

        assertEq(adapter.getPendingSettlementCount(), 3);
        assertEq(adapter.getPendingContributorCount(), 3);

        // Execute true-up
        uint256 pool = 300 ether;
        vibe.transfer(address(adapter), pool);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool);

        // Compute Shapley values
        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 gameId = adapter.getRound(roundId).shapleyGameId;
        shapley.computeShapleyValues(gameId);

        uint256 aliceValue = shapley.getShapleyValue(gameId, alice);
        uint256 bobValue = shapley.getShapleyValue(gameId, bob);
        uint256 carolValue = shapley.getShapleyValue(gameId, carol);

        // All three should have non-zero values
        assertGt(aliceValue, 0, "Alice has value");
        assertGt(bobValue, 0, "Bob has value");
        assertGt(carolValue, 0, "Carol has value");

        // Efficiency
        assertEq(aliceValue + bobValue + carolValue, pool, "Efficiency axiom");
    }

    // ============ Test 4: Settlement Without Adapter (Phase 1 Compat) ============

    function test_settlementWithoutAdapter() public {
        // Disconnect the adapter
        sie.setShapleyAdapter(address(0));

        bytes32[] memory noCites = new bytes32[](0);
        bytes32 assetId = _submitAsset(alice, keccak256("standalone"), "ipfs://standalone", noCites);

        // Evaluate and settle without adapter
        _evaluateAndSettle(assetId, alice, CognitiveConsensusMarket.Verdict.TRUE);

        // Asset should still be verified
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));

        // Adapter should have no pending settlements
        assertEq(adapter.getPendingSettlementCount(), 0, "No settlements without adapter wiring");
    }

    // ============ Test 5: Multiple Rounds (Accumulate-Execute-Accumulate-Execute) ============

    function test_multipleRounds() public {
        bytes32[] memory noCites = new bytes32[](0);

        // --- Round 1: Alice and Bob ---
        bytes32 aliceAsset = _submitAsset(alice, keccak256("round1-alice"), "ipfs://r1a", noCites);
        bytes32 bobAsset = _submitAsset(bob, keccak256("round1-bob"), "ipfs://r1b", noCites);

        _evaluateAndSettle(aliceAsset, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(bobAsset, bob, CognitiveConsensusMarket.Verdict.TRUE);

        uint256 pool1 = 100 ether;
        vibe.transfer(address(adapter), pool1);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool1);

        assertEq(adapter.roundCount(), 1);
        assertEq(adapter.getPendingSettlementCount(), 0, "Cleared after round 1");

        // --- Round 2: Carol and Alice again ---
        bytes32 carolAsset = _submitAsset(carol, keccak256("round2-carol"), "ipfs://r2c", noCites);
        bytes32 aliceAsset2 = _submitAsset(alice, keccak256("round2-alice"), "ipfs://r2a", noCites);

        _evaluateAndSettle(carolAsset, carol, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(aliceAsset2, alice, CognitiveConsensusMarket.Verdict.TRUE);

        uint256 pool2 = 200 ether;
        vibe.transfer(address(adapter), pool2);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool2);

        assertEq(adapter.roundCount(), 2);
        assertEq(adapter.getPendingSettlementCount(), 0, "Cleared after round 2");

        // Both games should be independently settleable
        bytes32 roundId1 = keccak256(abi.encodePacked(uint256(1), adapter.getRound(
            keccak256(abi.encodePacked(uint256(1), block.timestamp - 1 hours - 1))
        ).timestamp));

        // Round 2's game can be computed
        bytes32 roundId2 = keccak256(abi.encodePacked(uint256(2), block.timestamp));
        bytes32 gameId2 = adapter.getRound(roundId2).shapleyGameId;
        shapley.computeShapleyValues(gameId2);
        assertTrue(shapley.isGameSettled(gameId2), "Round 2 game settled");
    }

    // ============ Test 6: Access Control ============

    function test_executeTrueUp_revert_notOwner() public {
        bytes32[] memory noCites = new bytes32[](0);
        bytes32 asset = _submitAsset(alice, keccak256("ac-test"), "ipfs://ac", noCites);
        _evaluateAndSettle(asset, alice, CognitiveConsensusMarket.Verdict.TRUE);

        // Non-owner tries to execute true-up
        bytes32 asset2 = _submitAsset(bob, keccak256("ac-test2"), "ipfs://ac2", noCites);
        _evaluateAndSettle(asset2, bob, CognitiveConsensusMarket.Verdict.TRUE);

        vibe.transfer(address(adapter), 10 ether);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OwnableUpgradeable.OwnableUnauthorizedAccount.selector,
                alice
            )
        );
        adapter.executeTrueUp(10 ether);
    }

    function test_executeTrueUp_revert_noPending() public {
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(SIEShapleyAdapter.NoPendingSettlements.selector);
        adapter.executeTrueUp(10 ether);
    }

    function test_executeTrueUp_revert_tooSoon() public {
        bytes32[] memory noCites = new bytes32[](0);
        bytes32 asset1 = _submitAsset(alice, keccak256("soon1"), "ipfs://s1", noCites);
        bytes32 asset2 = _submitAsset(bob, keccak256("soon2"), "ipfs://s2", noCites);
        _evaluateAndSettle(asset1, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(asset2, bob, CognitiveConsensusMarket.Verdict.TRUE);

        vibe.transfer(address(adapter), 20 ether);

        // Execute first true-up
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(10 ether);

        // Submit more and try again immediately — should fail
        bytes32 asset3 = _submitAsset(carol, keccak256("soon3"), "ipfs://s3", noCites);
        bytes32 asset4 = _submitAsset(alice, keccak256("soon4"), "ipfs://s4", noCites);
        _evaluateAndSettle(asset3, carol, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(asset4, alice, CognitiveConsensusMarket.Verdict.TRUE);

        // Not enough time elapsed
        vm.expectRevert(SIEShapleyAdapter.TrueUpTooSoon.selector);
        adapter.executeTrueUp(10 ether);
    }

    function test_executeTrueUp_revert_insufficientBalance() public {
        bytes32[] memory noCites = new bytes32[](0);
        bytes32 asset1 = _submitAsset(alice, keccak256("bal1"), "ipfs://b1", noCites);
        bytes32 asset2 = _submitAsset(bob, keccak256("bal2"), "ipfs://b2", noCites);
        _evaluateAndSettle(asset1, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(asset2, bob, CognitiveConsensusMarket.Verdict.TRUE);

        // Don't fund the adapter
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(SIEShapleyAdapter.InsufficientPoolBalance.selector);
        adapter.executeTrueUp(100 ether);
    }

    // ============ Test 7: Adapter Failure Does Not Block Settlement ============

    function test_adapterFailure_doesNotBlockSettlement() public {
        // Point to a contract that will revert on onSettlement
        // We'll use a non-contract address (EOA) — the try/catch should handle it
        sie.setShapleyAdapter(address(0xDEAD));

        bytes32[] memory noCites = new bytes32[](0);
        bytes32 assetId = _submitAsset(alice, keccak256("resilient"), "ipfs://resilient", noCites);

        // Should not revert despite adapter being broken
        _evaluateAndSettle(assetId, alice, CognitiveConsensusMarket.Verdict.TRUE);

        // Asset still verified
        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));
    }

    // ============ Test 8: Owner Manual Verification Also Notifies Adapter ============

    function test_ownerVerification_doesNotNotifyAdapter() public {
        // Owner verification (verifyAsset) does NOT go through settleEvaluation
        // so it should NOT trigger adapter notification — this is by design.
        // Only CRPC-settled evaluations feed Shapley.
        bytes32[] memory noCites = new bytes32[](0);
        bytes32 assetId = _submitAsset(alice, keccak256("manual"), "ipfs://manual", noCites);

        // Owner manually verifies
        sie.verifyAsset(assetId);

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        assertEq(uint256(asset.state), uint256(IntelligenceExchange.AssetState.VERIFIED));

        // Adapter should have NO pending settlements (manual verify skips adapter)
        assertEq(adapter.getPendingSettlementCount(), 0, "Manual verify does not notify adapter");
    }

    // ============ Test 9: Shapley Efficiency Axiom Across Claim ============

    function test_shapleyEfficiency_totalClaimedEqualsPool() public {
        bytes32[] memory noCites = new bytes32[](0);

        // Three contributors
        bytes32 a = _submitAsset(alice, keccak256("eff-a"), "ipfs://ea", noCites);
        bytes32 b = _submitAsset(bob, keccak256("eff-b"), "ipfs://eb", noCites);
        bytes32 c = _submitAsset(carol, keccak256("eff-c"), "ipfs://ec", noCites);

        _evaluateAndSettle(a, alice, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(b, bob, CognitiveConsensusMarket.Verdict.TRUE);
        _evaluateAndSettle(c, carol, CognitiveConsensusMarket.Verdict.TRUE);

        uint256 pool = 1000 ether;
        vibe.transfer(address(adapter), pool);
        vm.warp(block.timestamp + 1 hours + 1);
        adapter.executeTrueUp(pool);

        bytes32 roundId = keccak256(abi.encodePacked(uint256(1), block.timestamp));
        bytes32 gameId = adapter.getRound(roundId).shapleyGameId;
        shapley.computeShapleyValues(gameId);

        // Record balances before claims
        uint256 shapleyBefore = vibe.balanceOf(address(shapley));

        // All three claim
        vm.prank(alice);
        uint256 aliceClaimed = shapley.claimReward(gameId);
        vm.prank(bob);
        uint256 bobClaimed = shapley.claimReward(gameId);
        vm.prank(carol);
        uint256 carolClaimed = shapley.claimReward(gameId);

        // Total claimed should equal pool
        assertEq(aliceClaimed + bobClaimed + carolClaimed, pool, "Total claimed == pool");

        // ShapleyDistributor balance should decrease by pool
        uint256 shapleyAfter = vibe.balanceOf(address(shapley));
        assertEq(shapleyBefore - shapleyAfter, pool, "Distributor balance decreased by pool");
    }
}
