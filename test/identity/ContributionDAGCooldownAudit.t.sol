// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/identity/interfaces/IContributionDAG.sol";

/// @title ContributionDAG Cooldown Observability Audit Tests (Strengthen #3)
/// @notice Validates the new on-chain metrics that let us audit cooldown hit-rate
///         from chain data without re-deriving from event logs alone.
/// @dev Targeted run:
///        forge test --match-path test/identity/ContributionDAGCooldownAudit.t.sol -vvv
contract ContributionDAGCooldownAuditTest is Test {
    // Re-declare events for vm.expectEmit (Solidity 0.8.20 cannot reference
    // events through the contract type when not on the calling interface).
    event HandshakeBlockedByCooldown(
        address indexed from,
        address indexed to,
        uint256 remaining
    );
    event HandshakeConfirmed(address indexed user1, address indexed user2);

    ContributionDAG public dag;

    address public alice;
    address public bob;
    address public carol;
    address public dave;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");

        // address(0) disables the soulbound identity check — keeps the test
        // focused on cooldown observability without dragging in identity setup.
        dag = new ContributionDAG(address(0));
    }

    // ============ Counter Initialization ============

    function test_counters_initiallyZero() public view {
        assertEq(dag.totalHandshakeAttempts(), 0, "attempts");
        assertEq(dag.totalHandshakeSuccesses(), 0, "successes");
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0, "blocked");

        (uint256 a, uint256 s, uint256 b) = dag.getCooldownAuditCounters();
        assertEq(a, 0);
        assertEq(s, 0);
        assertEq(b, 0);
    }

    // ============ Happy Path: addVouch increments attempts + successes ============

    function test_addVouch_incrementsAttempts() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        assertEq(dag.totalHandshakeAttempts(), 1);
        assertEq(dag.totalHandshakeSuccesses(), 0); // one-way only — no handshake yet
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);
    }

    function test_addVouch_handshakeIncrementsSuccesses() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));

        // Two attempts, one new handshake confirmed.
        assertEq(dag.totalHandshakeAttempts(), 2);
        assertEq(dag.totalHandshakeSuccesses(), 1);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);
    }

    function test_addVouch_handshakeUpdatesLastHandshakeAt() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        uint256 t0 = block.timestamp;
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));

        // Symmetric key: should be retrievable from either ordering.
        bytes32 keyAB = _key(alice, bob);
        bytes32 keyBA = _key(bob, alice);
        assertEq(keyAB, keyBA, "key symmetric");
        assertEq(dag.lastHandshakeAt(keyAB), t0);
    }

    // ============ Cooldown Block: addVouch reverts (legacy path) ============

    function test_addVouch_cooldownReverts_butAttemptCounted() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        assertEq(dag.totalHandshakeAttempts(), 1);

        // Second vouch within cooldown reverts. The increment INSIDE the
        // reverting call is wiped — that's fine; the legacy addVouch path
        // is documented as wiping its counter on cooldown-revert. Use
        // tryAddVouch for accurate cooldown-block telemetry.
        vm.prank(alice);
        vm.expectRevert(); // VouchCooldown(remaining)
        dag.addVouch(bob, bytes32(0));

        // Counter still 1 — the failed attempt's increment was wiped, so
        // addVouch's revert path is invisible to the on-chain hit-rate.
        assertEq(dag.totalHandshakeAttempts(), 1);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);
    }

    // ============ Cooldown Block: tryAddVouch increments + emits ============

    function test_tryAddVouch_cooldownBlocked_incrementsCounterAndEmits() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        // Second attempt within cooldown via tryAddVouch — does NOT revert.
        bytes32 msgHash = bytes32(uint256(0xCAFE));

        vm.expectEmit(true, true, false, true);
        emit HandshakeBlockedByCooldown(alice, bob, dag.HANDSHAKE_COOLDOWN());

        vm.prank(alice);
        (
            ContributionDAG.VouchStatus status,
            bool isHandshake,
            uint256 remaining
        ) = dag.tryAddVouch(bob, msgHash);

        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.BlockedByCooldown));
        assertFalse(isHandshake);
        assertEq(remaining, dag.HANDSHAKE_COOLDOWN());

        // Counters: attempts++ AND blocked++. Successes unchanged.
        assertEq(dag.totalHandshakeAttempts(), 2);
        assertEq(dag.totalHandshakeSuccesses(), 0);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 1);
    }

    function test_tryAddVouch_cooldownBlocked_remainingShrinksOverTime() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        uint256 cooldown = dag.HANDSHAKE_COOLDOWN();
        vm.warp(block.timestamp + cooldown / 4);

        vm.prank(alice);
        (, , uint256 remaining) = dag.tryAddVouch(bob, bytes32(0));

        // ~3/4 of the cooldown should still be remaining.
        assertApproxEqAbs(remaining, (cooldown * 3) / 4, 2);
    }

    // ============ Cooldown is per-pair, not global ============

    function test_cooldown_isPerPair_notGlobal() public {
        // Alice vouches for Bob (starts cooldown on alice→bob).
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        // Alice can still vouch for Carol immediately — different pair.
        vm.prank(alice);
        dag.addVouch(carol, bytes32(0));

        // Carol can vouch for Dave — different pair entirely.
        vm.prank(carol);
        dag.addVouch(dave, bytes32(0));

        // Three successful new vouches, zero cooldown blocks.
        assertEq(dag.totalHandshakeAttempts(), 3);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);

        // But alice→bob in the same block IS still cooldown-blocked.
        vm.prank(alice);
        (ContributionDAG.VouchStatus status, , ) = dag.tryAddVouch(bob, bytes32(0));
        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.BlockedByCooldown));
        assertEq(dag.totalHandshakesBlockedByCooldown(), 1);
    }

    function test_cooldown_directionSpecific() public {
        // alice→bob has fired. bob→alice should still be free.
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.prank(bob);
        (ContributionDAG.VouchStatus status, bool isHandshake, ) =
            dag.tryAddVouch(alice, bytes32(0));

        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.Success));
        assertTrue(isHandshake, "bob's reverse vouch confirms handshake");
        assertEq(dag.totalHandshakeSuccesses(), 1);
    }

    // ============ Cooldown elapses ============

    function test_tryAddVouch_afterCooldown_succeeds() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.warp(block.timestamp + dag.HANDSHAKE_COOLDOWN() + 1);

        vm.prank(alice);
        (ContributionDAG.VouchStatus status, , uint256 remaining) =
            dag.tryAddVouch(bob, bytes32(0));

        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.Success));
        assertEq(remaining, 0);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);
    }

    // ============ getCooldownStatus view ============

    function test_getCooldownStatus_inactiveWithoutPriorVouch() public view {
        (bool active, uint256 remaining) = dag.getCooldownStatus(alice, bob);
        assertFalse(active);
        assertEq(remaining, 0);
    }

    function test_getCooldownStatus_activeAfterVouch() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        (bool active, uint256 remaining) = dag.getCooldownStatus(alice, bob);
        assertTrue(active);
        assertEq(remaining, dag.HANDSHAKE_COOLDOWN());
    }

    function test_getCooldownStatus_inactiveAfterElapse() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.warp(block.timestamp + dag.HANDSHAKE_COOLDOWN() + 1);

        (bool active, uint256 remaining) = dag.getCooldownStatus(alice, bob);
        assertFalse(active);
        assertEq(remaining, 0);
    }

    // ============ tryAddVouch other status codes ============

    function test_tryAddVouch_self_blocked() public {
        vm.prank(alice);
        (ContributionDAG.VouchStatus status, , ) = dag.tryAddVouch(alice, bytes32(0));
        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.BlockedBySelf));
        // Self-block is pre-cooldown-gate, must NOT count as an attempt.
        assertEq(dag.totalHandshakeAttempts(), 0);
    }

    function test_tryAddVouch_vouchLimit_blocked() public {
        // Max out alice's outgoing vouches.
        uint256 maxV = dag.MAX_VOUCH_PER_USER();
        for (uint256 i = 0; i < maxV; i++) {
            address t = address(uint160(0x1000 + i));
            vm.prank(alice);
            dag.addVouch(t, bytes32(0));
        }

        // (maxV + 1)-th vouch via tryAddVouch should be blocked, NOT counted.
        uint256 attemptsBefore = dag.totalHandshakeAttempts();
        vm.prank(alice);
        (ContributionDAG.VouchStatus status, , ) =
            dag.tryAddVouch(address(uint160(0x9999)), bytes32(0));

        assertEq(uint256(status), uint256(ContributionDAG.VouchStatus.BlockedByVouchLimit));
        // Vouch-limit block is pre-cooldown-gate — attempts unchanged.
        assertEq(dag.totalHandshakeAttempts(), attemptsBefore);
    }

    // ============ Hit-rate scenario ============

    function test_hitRate_compositeScenario() public {
        // Two pairs: (alice,bob) and (carol,dave).
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0)); // handshake confirmed
        vm.prank(carol);
        dag.addVouch(dave, bytes32(0));

        // Three "real" attempts so far, 1 success, 0 blocks.
        assertEq(dag.totalHandshakeAttempts(), 3);
        assertEq(dag.totalHandshakeSuccesses(), 1);
        assertEq(dag.totalHandshakesBlockedByCooldown(), 0);

        // Two cooldown-blocked tryAddVouch calls.
        vm.prank(alice);
        dag.tryAddVouch(bob, bytes32(0));
        vm.prank(carol);
        dag.tryAddVouch(dave, bytes32(0));

        // Each tryAddVouch counts as an attempt + a block.
        (uint256 attempts, uint256 successes, uint256 blocked) =
            dag.getCooldownAuditCounters();
        assertEq(attempts, 5);
        assertEq(successes, 1);
        assertEq(blocked, 2);

        // Hit-rate (in BPS) = blocked / attempts = 4000 (40%).
        uint256 hitRateBps = (blocked * 10_000) / attempts;
        assertEq(hitRateBps, 4_000);
    }

    // ============ Regression: pre-existing observable behavior preserved ============

    function test_regression_addVouchStillRevertsOnCooldown() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.prank(alice);
        vm.expectRevert(); // VouchCooldown(remaining)
        dag.addVouch(bob, bytes32(0));
    }

    function test_regression_handshakeCountUnchangedSemantics() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));

        // The legacy enumeration count must still match the new success counter.
        assertEq(dag.getHandshakeCount(), 1);
        assertEq(dag.totalHandshakeSuccesses(), 1);
    }

    function test_regression_hasHandshakeStillWorks() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));

        assertTrue(dag.hasHandshake(alice, bob));
        assertTrue(dag.hasHandshake(bob, alice));
    }

    function test_regression_revokeAfterHandshake_keepsHistoricalTimestamp() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        vm.prank(bob);
        dag.addVouch(alice, bytes32(0));

        bytes32 key = _key(alice, bob);
        uint256 confirmedAt = dag.lastHandshakeAt(key);
        assertGt(confirmedAt, 0);

        // Revoke: the handshake is removed from the active map but the
        // historical timestamp is intentionally preserved for analytics.
        vm.prank(alice);
        dag.revokeVouch(bob);

        assertFalse(dag.hasHandshake(alice, bob));
        // lastHandshakeAt is a historical anchor, not a liveness flag.
        assertEq(dag.lastHandshakeAt(key), confirmedAt);
    }

    // ============ Helpers ============

    function _key(address a, address b) internal pure returns (bytes32) {
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(lo, hi));
    }
}
