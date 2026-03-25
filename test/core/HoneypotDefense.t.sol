// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/HoneypotDefense.sol";

/**
 * @title HoneypotDefense Tests — The Siren Protocol
 * @notice "He thought he was hacking God. God was hacking him."
 */
contract HoneypotDefenseTest is Test {
    HoneypotDefense public hp;

    address sentinel = makeAddr("sentinel");
    address attacker = makeAddr("attacker");

    function setUp() public {
        hp = new HoneypotDefense();
        hp.registerSentinel(sentinel);
    }

    // ============ Sentinel Management ============

    function test_registerSentinel() public {
        address newSentinel = makeAddr("newSentinel");
        hp.registerSentinel(newSentinel);
        assertTrue(hp.sentinels(newSentinel));
    }

    function test_nonSentinelCannotReport() public {
        vm.prank(attacker);
        vm.expectRevert(HoneypotDefense.NotSentinel.selector);
        hp.reportAnomaly(attacker, "pow_rate", 20);
    }

    // ============ Anomaly Detection ============

    function test_reportAnomalyBelowThreshold() public {
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 5); // Below SUSPICIOUS_POW_RATE=10

        // Should be tracked but NOT escalated past NONE
        assertFalse(hp.isTracked(attacker));
    }

    function test_reportAnomalyAboveThreshold() public {
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 15); // Above threshold

        assertTrue(hp.isTracked(attacker));
        (HoneypotDefense.ThreatLevel level, , , , , ) = hp.getAttackProfile(attacker);
        assertEq(uint8(level), uint8(HoneypotDefense.ThreatLevel.MONITORING));
    }

    function test_threatEscalation() public {
        // First anomaly → MONITORING
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 15);
        (HoneypotDefense.ThreatLevel l1, , , , , ) = hp.getAttackProfile(attacker);
        assertEq(uint8(l1), uint8(HoneypotDefense.ThreatLevel.MONITORING));

        // Second anomaly → ENGAGED
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "stake_rate", 10);
        (HoneypotDefense.ThreatLevel l2, , , , , ) = hp.getAttackProfile(attacker);
        assertEq(uint8(l2), uint8(HoneypotDefense.ThreatLevel.ENGAGED));

        // Third anomaly → EXHAUSTING
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 50);
        (HoneypotDefense.ThreatLevel l3, , , , , ) = hp.getAttackProfile(attacker);
        assertEq(uint8(l3), uint8(HoneypotDefense.ThreatLevel.EXHAUSTING));
    }

    // ============ Correlation Detection ============

    function test_correlationEscalatesBoth() public {
        address sybil1 = makeAddr("sybil1");
        address sybil2 = makeAddr("sybil2");

        vm.prank(sentinel);
        hp.reportCorrelation(sybil1, sybil2, 90); // Above CORRELATION_THRESHOLD=80

        assertTrue(hp.isTracked(sybil1));
        assertTrue(hp.isTracked(sybil2));
    }

    function test_correlationBelowThreshold() public {
        address a = makeAddr("a");
        address b = makeAddr("b");

        vm.prank(sentinel);
        hp.reportCorrelation(a, b, 50); // Below threshold

        assertFalse(hp.isTracked(a));
        assertFalse(hp.isTracked(b));
    }

    // ============ Shadow Branch ============

    function test_createShadowState() public {
        // Escalate to ENGAGED first
        vm.startPrank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 15);
        hp.reportAnomaly(attacker, "pow_rate", 15);
        vm.stopPrank();

        bytes32 fakeRoot = keccak256("fake_state");
        vm.prank(sentinel);
        hp.createShadowState(attacker, fakeRoot, 1000);

        (bytes32 root, , , , , bool active) = hp.shadowStates(attacker);
        assertEq(root, fakeRoot);
        assertTrue(active);
    }

    function test_cannotShadowUnengaged() public {
        vm.prank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 15); // Only MONITORING

        vm.prank(sentinel);
        vm.expectRevert("Not engaged");
        hp.createShadowState(attacker, keccak256("fake"), 1000);
    }

    // ============ Resource Tracking ============

    function test_recordComputeWasted() public {
        _engageAttacker();

        vm.prank(sentinel);
        hp.recordComputeWasted(attacker, 100);

        (, uint256 compute, , uint256 fakeRewards, , ) = hp.getAttackProfile(attacker);
        assertEq(compute, 100);
        assertEq(fakeRewards, 100 * 1e15); // 0.001 ETH per solution
    }

    function test_recordStakeLocked() public {
        _engageAttacker();

        vm.prank(sentinel);
        hp.recordStakeLocked(attacker, 5 ether);

        (, , uint256 stake, , , ) = hp.getAttackProfile(attacker);
        assertEq(stake, 5 ether);
    }

    // ============ The Reveal ============

    function test_revealTrap() public {
        _engageAttacker();

        vm.prank(sentinel);
        hp.recordComputeWasted(attacker, 500);
        vm.prank(sentinel);
        hp.recordStakeLocked(attacker, 10 ether);

        // Fast forward past MIN_TRAP_DURATION
        vm.warp(block.timestamp + 2 hours);

        vm.prank(sentinel);
        hp.revealTrap(attacker);

        (HoneypotDefense.ThreatLevel level, , , , , bool active) = hp.getAttackProfile(attacker);
        assertEq(uint8(level), uint8(HoneypotDefense.ThreatLevel.REVEALED));
        assertFalse(active);
        assertEq(hp.totalTrapped(), 1);
        assertEq(hp.totalStakeSlashed(), 10 ether);
    }

    function test_cannotRevealTooSoon() public {
        _engageAttacker();

        vm.prank(sentinel);
        vm.expectRevert("Too soon");
        hp.revealTrap(attacker);
    }

    // ============ Evidence ============

    function test_publishEvidence() public {
        _engageAttacker();

        vm.prank(sentinel);
        hp.publishEvidence(attacker, "ipfs://QmEvidence1");
        vm.prank(sentinel);
        hp.publishEvidence(attacker, "ipfs://QmEvidence2");
    }

    // ============ Helper ============

    function _engageAttacker() internal {
        vm.startPrank(sentinel);
        hp.reportAnomaly(attacker, "pow_rate", 15); // → MONITORING
        hp.reportAnomaly(attacker, "pow_rate", 15); // → ENGAGED
        vm.stopPrank();
    }
}
