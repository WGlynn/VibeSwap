// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

/**
 * P-001: No Extraction Ever — Autonomous Self-Correction Simulation
 *
 * Proves that Shapley fairness measurement detects extraction beyond
 * a shadow of a doubt, enabling autonomous self-correction without governance.
 *
 * "If extraction is mathematically provable on-chain, the system self-corrects
 *  autonomously for ungoverned neutrality." — Will Glynn, 2026
 */
contract ExtractionDetectionTest is Test {
    // ============ Constants ============
    uint256 constant BPS = 10_000;
    uint256 constant FAIRNESS_THRESHOLD_BPS = 100; // 1% deviation triggers correction

    // ============ Types ============
    struct Player {
        address addr;
        uint256 contribution;  // What they actually contributed
        uint256 allocation;    // What they received
        uint256 shapleyValue;  // What they SHOULD have received (marginal contribution)
    }

    struct CooperativeGame {
        Player[] players;
        uint256 totalValue;    // Total value of the grand coalition
        uint256 totalAllocated;
    }

    // ============ Events ============
    event ExtractionDetected(address indexed extractor, uint256 shapleyValue, uint256 actualAllocation, uint256 extractionAmount);
    event SelfCorrectionTriggered(address indexed extractor, uint256 correctionAmount);
    event FairnessVerified(uint256 maxDeviation, bool allFair);

    // ============ Shapley Math ============

    /// @notice Calculate Shapley value for a player using marginal contribution
    /// In a simplified cooperative game: shapley_i = marginal contribution of player i
    /// averaged over all possible orderings (simplified to proportional contribution)
    function calculateShapleyValue(
        uint256 playerContribution,
        uint256 totalContributions,
        uint256 totalValue
    ) internal pure returns (uint256) {
        if (totalContributions == 0) return 0;
        // Shapley value = (player's marginal contribution / total contributions) * total value
        return (playerContribution * totalValue) / totalContributions;
    }

    /// @notice Detect if a player is extracting (taking more than their Shapley value)
    function detectExtraction(
        uint256 shapleyValue,
        uint256 actualAllocation
    ) internal pure returns (bool isExtracting, uint256 extractionAmount) {
        if (actualAllocation > shapleyValue) {
            isExtracting = true;
            extractionAmount = actualAllocation - shapleyValue;
        }
    }

    /// @notice Check if deviation exceeds fairness threshold
    function exceedsFairnessThreshold(
        uint256 shapleyValue,
        uint256 actualAllocation
    ) internal pure returns (bool) {
        if (shapleyValue == 0) return actualAllocation > 0;
        uint256 deviation;
        if (actualAllocation > shapleyValue) {
            deviation = ((actualAllocation - shapleyValue) * BPS) / shapleyValue;
        } else {
            deviation = ((shapleyValue - actualAllocation) * BPS) / shapleyValue;
        }
        return deviation > FAIRNESS_THRESHOLD_BPS;
    }

    /// @notice Autonomous correction: redistribute extraction back to fair allocation
    function selfCorrect(
        uint256[] memory contributions,
        uint256[] memory allocations,
        uint256 totalValue
    ) internal pure returns (uint256[] memory corrected) {
        uint256 totalContributions = 0;
        for (uint256 i = 0; i < contributions.length; i++) {
            totalContributions += contributions[i];
        }

        corrected = new uint256[](allocations.length);
        for (uint256 i = 0; i < allocations.length; i++) {
            // Correct to Shapley value
            corrected[i] = calculateShapleyValue(contributions[i], totalContributions, totalValue);
        }
    }

    // ============ SCENARIO 1: Protocol Skims LP Fees ============

    function test_P001_DetectsProtocolFeeSkimming() public {
        // Setup: 3 LPs contribute liquidity, protocol tries to skim 5%
        uint256 lp1Contribution = 100_000e18;
        uint256 lp2Contribution = 50_000e18;
        uint256 lp3Contribution = 25_000e18;
        uint256 totalContributions = lp1Contribution + lp2Contribution + lp3Contribution;

        uint256 totalFees = 1_000e18; // Total fees generated

        // Fair Shapley allocation
        uint256 lp1Fair = calculateShapleyValue(lp1Contribution, totalContributions, totalFees);
        uint256 lp2Fair = calculateShapleyValue(lp2Contribution, totalContributions, totalFees);
        uint256 lp3Fair = calculateShapleyValue(lp3Contribution, totalContributions, totalFees);

        // Verify Shapley efficiency axiom: sum of values = total value
        assertApproxEqAbs(lp1Fair + lp2Fair + lp3Fair, totalFees, 3, "Efficiency axiom violated");

        // Now protocol skims 5%
        uint256 protocolSkim = (totalFees * 500) / BPS; // 5%
        uint256 remainingForLPs = totalFees - protocolSkim;

        uint256 lp1Skimmed = calculateShapleyValue(lp1Contribution, totalContributions, remainingForLPs);
        uint256 lp2Skimmed = calculateShapleyValue(lp2Contribution, totalContributions, remainingForLPs);
        uint256 lp3Skimmed = calculateShapleyValue(lp3Contribution, totalContributions, remainingForLPs);

        // DETECT: Each LP receives less than their Shapley value
        assertTrue(lp1Skimmed < lp1Fair, "LP1 should receive less after skim");
        assertTrue(lp2Skimmed < lp2Fair, "LP2 should receive less after skim");
        assertTrue(lp3Skimmed < lp3Fair, "LP3 should receive less after skim");

        // The protocol's "contribution" is 0 (it added no liquidity)
        uint256 protocolShapley = calculateShapleyValue(0, totalContributions, totalFees);
        assertEq(protocolShapley, 0, "Protocol Shapley value should be 0 (null player)");

        // PROVE extraction: protocol took 50e18 but Shapley says it deserves 0
        (bool isExtracting, uint256 extractionAmount) = detectExtraction(protocolShapley, protocolSkim);
        assertTrue(isExtracting, "Protocol IS extracting");
        assertEq(extractionAmount, protocolSkim, "Extraction = full skim amount");

        // SELF-CORRECT: redistribute back to fair allocation
        uint256[] memory contributions = new uint256[](4);
        contributions[0] = lp1Contribution;
        contributions[1] = lp2Contribution;
        contributions[2] = lp3Contribution;
        contributions[3] = 0; // protocol contributed nothing

        uint256[] memory skimmedAllocations = new uint256[](4);
        skimmedAllocations[0] = lp1Skimmed;
        skimmedAllocations[1] = lp2Skimmed;
        skimmedAllocations[2] = lp3Skimmed;
        skimmedAllocations[3] = protocolSkim;

        uint256[] memory corrected = selfCorrect(contributions, skimmedAllocations, totalFees);

        // After correction: protocol gets 0, LPs get full fair share
        assertEq(corrected[3], 0, "Protocol allocation corrected to 0");
        assertApproxEqAbs(corrected[0], lp1Fair, 1, "LP1 restored to fair share");
        assertApproxEqAbs(corrected[1], lp2Fair, 1, "LP2 restored to fair share");
        assertApproxEqAbs(corrected[2], lp3Fair, 1, "LP3 restored to fair share");
    }

    // ============ SCENARIO 2: Whale Tries to Dominate ============

    function test_P001_DetectsWhaleOverallocation() public {
        // Whale provides 90% of liquidity but claims 95% of fees
        uint256 whaleContribution = 900_000e18;
        uint256 smallLP1 = 50_000e18;
        uint256 smallLP2 = 50_000e18;
        uint256 total = whaleContribution + smallLP1 + smallLP2;
        uint256 totalFees = 10_000e18;

        // Fair values
        uint256 whaleFair = calculateShapleyValue(whaleContribution, total, totalFees); // 90% = 9000
        uint256 small1Fair = calculateShapleyValue(smallLP1, total, totalFees); // 5% = 500
        uint256 small2Fair = calculateShapleyValue(smallLP2, total, totalFees); // 5% = 500

        // Whale claims 95%
        uint256 whaleActual = (totalFees * 9500) / BPS;
        uint256 small1Actual = (totalFees * 250) / BPS;
        uint256 small2Actual = (totalFees * 250) / BPS;

        // DETECT: whale took more than Shapley value
        (bool whaleExtracting, uint256 whaleExtraction) = detectExtraction(whaleFair, whaleActual);
        assertTrue(whaleExtracting, "Whale IS extracting");
        assertEq(whaleExtraction, whaleActual - whaleFair, "Whale extraction = 500e18 (5% overallocation)");

        // Small LPs received LESS than fair
        assertTrue(small1Actual < small1Fair, "Small LP1 underallocated");
        assertTrue(small2Actual < small2Fair, "Small LP2 underallocated");

        // Threshold check
        assertTrue(exceedsFairnessThreshold(whaleFair, whaleActual), "Whale exceeds fairness threshold");
        assertTrue(exceedsFairnessThreshold(small1Fair, small1Actual), "Small LP1 exceeds threshold too");
    }

    // ============ SCENARIO 3: Admin Sets protocolFeeShare Nonzero ============

    function test_P001_DetectsAdminFeeExtraction() public {
        // Simulate admin setting protocolFeeShare = 1000 (10%)
        uint256 protocolFeeShareBps = 1000;

        uint256 lpContribution = 500_000e18;
        uint256 totalFees = 5_000e18;

        // Fair: LP contributed all liquidity, deserves all fees
        uint256 lpShapley = calculateShapleyValue(lpContribution, lpContribution, totalFees);
        assertEq(lpShapley, totalFees, "LP Shapley = 100% of fees");

        // Admin extraction: protocol takes 10%
        uint256 protocolTake = (totalFees * protocolFeeShareBps) / BPS;
        uint256 lpActual = totalFees - protocolTake;

        // Protocol contributed 0 liquidity
        uint256 protocolShapley = calculateShapleyValue(0, lpContribution, totalFees);
        assertEq(protocolShapley, 0, "Protocol Shapley = 0 (null player axiom)");

        // DETECT
        (bool isExtracting,) = detectExtraction(protocolShapley, protocolTake);
        assertTrue(isExtracting, "Admin fee setting IS extraction");
        assertTrue(exceedsFairnessThreshold(protocolShapley, protocolTake), "Exceeds threshold");

        // LP is being extracted FROM
        assertTrue(exceedsFairnessThreshold(lpShapley, lpActual), "LP fairness violated");
    }

    // ============ SCENARIO 4: Null Player Axiom ============

    function test_P001_NullPlayerGetsNothing() public {
        // A player who contributes nothing should receive nothing
        uint256 activeLP = 100_000e18;
        uint256 freeloader = 0;
        uint256 totalFees = 1_000e18;

        uint256 freeloaderShapley = calculateShapleyValue(freeloader, activeLP + freeloader, totalFees);
        assertEq(freeloaderShapley, 0, "Null player axiom: zero contribution = zero reward");

        // If freeloader somehow receives anything, it's extraction
        uint256 freeloaderAllocation = 1e18; // Even 1 token
        (bool isExtracting,) = detectExtraction(freeloaderShapley, freeloaderAllocation);
        assertTrue(isExtracting, "Any allocation to null player is extraction");
    }

    // ============ SCENARIO 5: Symmetry Axiom ============

    function test_P001_SymmetricPlayersGetEqual() public {
        // Two players with equal contributions must get equal allocation
        uint256 player1 = 100_000e18;
        uint256 player2 = 100_000e18;
        uint256 totalFees = 2_000e18;

        uint256 shapley1 = calculateShapleyValue(player1, player1 + player2, totalFees);
        uint256 shapley2 = calculateShapleyValue(player2, player1 + player2, totalFees);

        assertEq(shapley1, shapley2, "Symmetry axiom: equal contribution = equal reward");
        assertEq(shapley1, 1_000e18, "Each gets exactly half");

        // If one gets more, the OTHER is being extracted from
        uint256 unfairAlloc1 = 1_200e18;
        uint256 unfairAlloc2 = 800e18;

        (bool is1Extracting,) = detectExtraction(shapley1, unfairAlloc1);
        assertTrue(is1Extracting, "Player1 extracting from Player2");
        assertTrue(exceedsFairnessThreshold(shapley2, unfairAlloc2), "Player2 fairness violated");
    }

    // ============ SCENARIO 6: Efficiency Axiom (Conservation) ============

    function test_P001_EfficiencyConservesTotal() public {
        // Sum of all Shapley values must equal total value (no value created or destroyed)
        uint256[] memory contributions = new uint256[](5);
        contributions[0] = 100_000e18;
        contributions[1] = 75_000e18;
        contributions[2] = 50_000e18;
        contributions[3] = 25_000e18;
        contributions[4] = 10_000e18;

        uint256 totalContributions = 0;
        for (uint256 i = 0; i < 5; i++) {
            totalContributions += contributions[i];
        }

        uint256 totalValue = 5_000e18;

        uint256 sumShapley = 0;
        for (uint256 i = 0; i < 5; i++) {
            sumShapley += calculateShapleyValue(contributions[i], totalContributions, totalValue);
        }

        // Allow rounding tolerance of N-1 wei (integer division)
        assertApproxEqAbs(sumShapley, totalValue, 4, "Efficiency axiom: sum of Shapley values = total value");
    }

    // ============ SCENARIO 7: Autonomous Correction Restores Fairness ============

    function test_P001_SelfCorrectionRestoresFairness() public {
        // Start with unfair allocation, prove correction restores fairness
        uint256[] memory contributions = new uint256[](3);
        contributions[0] = 60_000e18;
        contributions[1] = 30_000e18;
        contributions[2] = 10_000e18;

        uint256 totalValue = 1_000e18;

        // Unfair allocation (player 0 takes too much)
        uint256[] memory unfair = new uint256[](3);
        unfair[0] = 700e18;  // Should be 600
        unfair[1] = 200e18;  // Should be 300
        unfair[2] = 100e18;  // Should be 100

        // Self-correct
        uint256[] memory corrected = selfCorrect(contributions, unfair, totalValue);

        // Verify fairness restored
        uint256 totalContributions = 100_000e18;
        for (uint256 i = 0; i < 3; i++) {
            uint256 expected = calculateShapleyValue(contributions[i], totalContributions, totalValue);
            assertApproxEqAbs(corrected[i], expected, 1, "Correction restored fair share");
            assertFalse(exceedsFairnessThreshold(expected, corrected[i]), "No player exceeds threshold after correction");
        }
    }

    // ============ SCENARIO 8: Fuzz — Random Extraction Always Detected ============

    function testFuzz_P001_ExtractionAlwaysDetected(
        uint256 contribution,
        uint256 extraction
    ) public pure {
        // Bound inputs to reasonable ranges
        contribution = bound(contribution, 1e18, 1_000_000e18);
        extraction = bound(extraction, 1, 1_000e18);

        uint256 totalValue = 10_000e18;
        uint256 shapleyValue = calculateShapleyValue(contribution, contribution, totalValue);

        // Any amount above Shapley value is extraction
        uint256 overAllocation = shapleyValue + extraction;
        (bool isExtracting, uint256 amount) = detectExtraction(shapleyValue, overAllocation);

        assert(isExtracting); // ALWAYS detected
        assert(amount == extraction); // EXACT amount identified
    }

    // ============ SCENARIO 9: Fuzz — Self-Correction Always Conserves Value ============

    function testFuzz_P001_CorrectionConservesValue(
        uint256 c1,
        uint256 c2,
        uint256 c3,
        uint256 totalValue
    ) public pure {
        c1 = bound(c1, 1e18, 1_000_000e18);
        c2 = bound(c2, 1e18, 1_000_000e18);
        c3 = bound(c3, 1e18, 1_000_000e18);
        totalValue = bound(totalValue, 1e18, 100_000e18);

        uint256[] memory contributions = new uint256[](3);
        contributions[0] = c1;
        contributions[1] = c2;
        contributions[2] = c3;

        uint256[] memory allocations = new uint256[](3);
        allocations[0] = 0;
        allocations[1] = 0;
        allocations[2] = 0;

        uint256[] memory corrected = selfCorrect(contributions, allocations, totalValue);

        uint256 sum = corrected[0] + corrected[1] + corrected[2];
        // Conservation: sum of corrected allocations ≈ total value (within rounding)
        assert(sum <= totalValue);
        assert(totalValue - sum <= 2); // Max 2 wei rounding
    }
}
