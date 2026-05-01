// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CircuitBreaker.sol";

/// @notice Concrete implementation that exposes the C39 migration helper plus
///         enough of the abstract CircuitBreaker surface to test default-on
///         attested-resume behavior end-to-end.
contract C39ConcreteCircuitBreaker is CircuitBreaker {
    /// @notice Track whether the "fresh-deploy initialize() called the C39
    ///         migration" path produced the right preserved-set (empty) so
    ///         tests can assert the constructor-time invariant.
    function initializeFresh(address _owner) external initializer {
        __Ownable_init(_owner);
        // C39: fresh deploys have no in-flight trips so this is purely the
        // "claim the slot" call. It must still be invoked because subsequent
        // upgrades will check `c39SecurityDefaultsInitialized` to decide
        // whether the upgrade-path migration is a no-op.
        _initializeC39SecurityDefaults();
    }

    /// @notice Pre-C39 init path: simulates a proxy that was deployed BEFORE
    ///         C39 (no migration). Used to set up the upgrade-path test where
    ///         a tripped LOSS_BREAKER pre-exists.
    function initializeLegacy(address _owner) external initializer {
        __Ownable_init(_owner);
        // Intentionally DOES NOT call `_initializeC39SecurityDefaults()` so
        // we can later run it as the upgrade migration and assert it
        // preserves any in-flight trip.
    }

    /// @notice Simulates the upgrade-path reinitializer that wires C39 in.
    function migrateToC39() external reinitializer(2) onlyOwner {
        _initializeC39SecurityDefaults();
    }

    /// @notice Expose `_updateBreaker` for testing.
    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }

    /// @notice Expose `_checkBreaker` for testing.
    function checkBreaker(bytes32 breakerType) external {
        _checkBreaker(breakerType);
    }
}

/// @title C39 — Attested-Resume Default-On for Security-Load-Bearing Breakers (Gap 6)
/// @notice Tests the C43 → C39 maturation: LOSS_BREAKER and TRUE_PRICE_BREAKER
///         default to attested-resume-required without any governance call,
///         while the per-breaker override remains available, and the migration
///         preserves in-flight tripped state on pre-C39 proxies.
contract CircuitBreakerC39DefaultOnTest is Test {
    C39ConcreteCircuitBreaker public cb;

    address public owner;
    address public guardian;
    address public attestor;

    bytes32 internal LOSS;
    bytes32 internal TRUE_PRICE;
    bytes32 internal VOLUME;
    bytes32 internal PRICE;
    bytes32 internal WITHDRAWAL;

    event SecurityBreakerDefaultOverridden(bytes32 indexed breakerType, bool overrideValue, string reason);
    event C39SecurityDefaultsInitialized(bytes32[] preservedBreakers);
    event AttestedResumeRequirementSet(bytes32 indexed breakerType, bool required);

    function setUp() public {
        owner = address(this);
        guardian = makeAddr("guardian");
        attestor = makeAddr("attestor");

        cb = new C39ConcreteCircuitBreaker();
        cb.initializeFresh(owner);

        LOSS = cb.LOSS_BREAKER();
        TRUE_PRICE = cb.TRUE_PRICE_BREAKER();
        VOLUME = cb.VOLUME_BREAKER();
        PRICE = cb.PRICE_BREAKER();
        WITHDRAWAL = cb.WITHDRAWAL_BREAKER();

        cb.setGuardian(guardian, true);
        cb.setCertifiedAttestor(attestor, true);
        cb.setResumeAttestationThreshold(1);
    }

    // ============ Default-On Classification ============

    /// @dev LOSS_BREAKER must report attested-resume-required by default.
    function test_C39_lossBreaker_isDefaultOn() public view {
        assertTrue(
            cb.isAttestedResumeRequired(LOSS),
            "LOSS_BREAKER must default to attested-resume-required"
        );
        // The raw storage is still false because no override has been set —
        // the classification default produces the effective `true`.
        assertFalse(
            cb.requiresAttestedResume(LOSS),
            "raw `requiresAttestedResume` slot remains false (no override)"
        );
        assertFalse(
            cb.attestedResumeOverridden(LOSS),
            "no override flag set after fresh deploy"
        );
    }

    /// @dev TRUE_PRICE_BREAKER must report attested-resume-required by default.
    function test_C39_truePriceBreaker_isDefaultOn() public view {
        assertTrue(
            cb.isAttestedResumeRequired(TRUE_PRICE),
            "TRUE_PRICE_BREAKER must default to attested-resume-required"
        );
    }

    /// @dev Operational breakers (VOLUME, PRICE, WITHDRAWAL) MUST stay default-OFF.
    function test_C39_operationalBreakers_remainDefaultOff() public view {
        assertFalse(
            cb.isAttestedResumeRequired(VOLUME),
            "VOLUME_BREAKER must remain wall-clock by default"
        );
        assertFalse(
            cb.isAttestedResumeRequired(PRICE),
            "PRICE_BREAKER must remain wall-clock by default"
        );
        assertFalse(
            cb.isAttestedResumeRequired(WITHDRAWAL),
            "WITHDRAWAL_BREAKER must remain wall-clock by default"
        );
    }

    /// @dev An unknown breaker type (not in the security set) must NOT silently
    ///      pick up the default-on classification.
    function test_C39_unknownBreaker_notSecurityLoadBearing() public view {
        bytes32 customType = keccak256("CUSTOM_FUTURE_BREAKER");
        assertFalse(
            cb.isAttestedResumeRequired(customType),
            "unknown breaker types must not be classified security-load-bearing"
        );
    }

    // ============ Default-On Engages End-to-End ============

    /// @dev A tripped LOSS_BREAKER on a fresh-deploy proxy must NOT auto-reset
    ///      after cooldown — the default-on classification keeps it tripped
    ///      until an attestor signs off, EVEN THOUGH no governance call ever
    ///      touched `setAttestedResumeRequired`.
    function test_C39_lossBreaker_defaultOnBlocksWallClockResume() public {
        cb.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        cb.updateBreaker(LOSS, 100 ether); // trips
        (, bool tripped,,,) = cb.getBreakerStatus(LOSS);
        assertTrue(tripped, "precondition: LOSS_BREAKER is tripped");

        // Advance past cooldown.
        vm.warp(block.timestamp + 1 hours + 1);

        // The C39 default-on classification should keep `_checkBreaker` reverting.
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, LOSS));
        cb.checkBreaker(LOSS);

        (, bool stillTripped,,,) = cb.getBreakerStatus(LOSS);
        assertTrue(
            stillTripped,
            "default-on LOSS_BREAKER must remain tripped past cooldown without attestation"
        );
    }

    /// @dev TRUE_PRICE_BREAKER same path: default-on blocks `_updateBreaker`
    ///      auto-reset.
    function test_C39_truePriceBreaker_defaultOnBlocksWallClockResume() public {
        cb.configureBreaker(TRUE_PRICE, 1000 ether, 1 hours, 10 minutes);
        cb.updateBreaker(TRUE_PRICE, 1000 ether); // trips

        vm.warp(block.timestamp + 1 hours + 1);

        // _updateBreaker also must respect default-on: a small additional value
        // post-cooldown should NOT clear the trip; it should return `true`
        // (still tripped, awaiting attestation).
        bool stillTripped = cb.updateBreaker(TRUE_PRICE, 1 ether);
        assertTrue(
            stillTripped,
            "default-on TRUE_PRICE_BREAKER must report still-tripped post-cooldown"
        );
    }

    /// @dev Default-on breaker can still be resumed via attestation.
    function test_C39_lossBreaker_attestationResumes() public {
        cb.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        cb.updateBreaker(LOSS, 100 ether);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(attestor);
        cb.attestResume(LOSS, keccak256("evidence"));

        (, bool tripped,,,) = cb.getBreakerStatus(LOSS);
        assertFalse(tripped, "attestation must clear default-on tripped state");
    }

    /// @dev Operational breaker (VOLUME) auto-resets on cooldown — the default-on
    ///      classification does NOT extend to non-security breakers.
    function test_C39_volumeBreaker_stillAutoResets() public {
        cb.configureBreaker(VOLUME, 100 ether, 1 hours, 10 minutes);
        cb.updateBreaker(VOLUME, 100 ether); // trips

        vm.warp(block.timestamp + 1 hours + 1);
        cb.checkBreaker(VOLUME); // must NOT revert — auto-reset path

        (, bool tripped,,,) = cb.getBreakerStatus(VOLUME);
        assertFalse(tripped, "VOLUME_BREAKER must auto-reset post-cooldown (operational, not security)");
    }

    // ============ Per-Breaker Override Path ============

    /// @dev Governance can OPT OUT of the C39 default-on for a security breaker
    ///      by explicitly calling `setAttestedResumeRequired(LOSS, false)`.
    ///      This is the operational reality escape hatch (e.g., chain has no
    ///      certified attestors yet).
    function test_C39_governanceCanOptOutOfDefault() public {
        // Initially default-on
        assertTrue(cb.isAttestedResumeRequired(LOSS));

        // Governance pins it to false
        vm.expectEmit(true, false, false, true);
        emit AttestedResumeRequirementSet(LOSS, false);
        cb.setAttestedResumeRequired(LOSS, false);

        // Now the override flag is set, raw value is false, effective is false.
        assertTrue(cb.attestedResumeOverridden(LOSS));
        assertFalse(cb.requiresAttestedResume(LOSS));
        assertFalse(
            cb.isAttestedResumeRequired(LOSS),
            "governance opt-out must disengage the C39 default-on"
        );

        // And end-to-end: a tripped LOSS_BREAKER auto-resets on cooldown.
        cb.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        cb.updateBreaker(LOSS, 100 ether);
        vm.warp(block.timestamp + 1 hours + 1);
        cb.checkBreaker(LOSS); // does not revert
        (, bool tripped,,,) = cb.getBreakerStatus(LOSS);
        assertFalse(tripped, "opted-out LOSS_BREAKER returns to wall-clock auto-reset");
    }

    /// @dev `clearAttestedResumeOverride` returns a breaker to the
    ///      classification default, which restores C39 default-on for
    ///      security breakers.
    function test_C39_clearOverride_restoresClassificationDefault() public {
        // Override LOSS to false
        cb.setAttestedResumeRequired(LOSS, false);
        assertFalse(cb.isAttestedResumeRequired(LOSS));

        // Clear override → back to security-load-bearing default = true
        cb.clearAttestedResumeOverride(LOSS);
        assertFalse(cb.attestedResumeOverridden(LOSS), "override flag must be cleared");
        assertFalse(cb.requiresAttestedResume(LOSS), "raw slot must be cleared");
        assertTrue(
            cb.isAttestedResumeRequired(LOSS),
            "clearing override must restore C39 default-on for security breaker"
        );
    }

    /// @dev Governance can engage attested-resume on an operational breaker
    ///      (e.g., a heightened-risk chain may want VOLUME also under attestation).
    ///      C43 explicit-on path stays intact.
    function test_C39_C43Regression_explicitOnVolumeBreaker() public {
        cb.setAttestedResumeRequired(VOLUME, true);
        assertTrue(cb.attestedResumeOverridden(VOLUME));
        assertTrue(cb.requiresAttestedResume(VOLUME));
        assertTrue(cb.isAttestedResumeRequired(VOLUME));

        cb.configureBreaker(VOLUME, 100 ether, 1 hours, 10 minutes);
        cb.updateBreaker(VOLUME, 100 ether); // trips
        vm.warp(block.timestamp + 1 hours + 1);

        // C43 path still works: cooldown floor + attestation requirement.
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, VOLUME));
        cb.checkBreaker(VOLUME);

        vm.prank(attestor);
        cb.attestResume(VOLUME, keccak256("evidence"));
        (, bool tripped,,,) = cb.getBreakerStatus(VOLUME);
        assertFalse(tripped, "C43 explicit-on attestation path still resumes the breaker");
    }

    // ============ Migration: Existing-Data Preservation ============

    /// @dev On a fresh deploy with no in-flight trips, the migration emits
    ///      `C39SecurityDefaultsInitialized` with an empty preserved-set and
    ///      sets the completion flag.
    function test_C39_freshDeployMigration_setsFlagWithEmptyPreservedSet() public view {
        assertTrue(
            cb.c39SecurityDefaultsInitialized(),
            "fresh deploy must have claimed the migration slot"
        );
        // No overrides set on fresh deploy.
        assertFalse(cb.attestedResumeOverridden(LOSS));
        assertFalse(cb.attestedResumeOverridden(TRUE_PRICE));
    }

    /// @dev Upgrade-path migration on a proxy with a tripped LOSS_BREAKER:
    ///      pre-migration the classification default would surprise-flip the
    ///      semantics mid-trip. The migration must pin override=false on
    ///      that in-flight LOSS_BREAKER so it completes on wall-clock.
    function test_C39_upgradeMigration_preservesInFlightTrippedLossBreaker() public {
        // Spin up a fresh proxy as a "pre-C39 legacy" instance.
        C39ConcreteCircuitBreaker legacy = new C39ConcreteCircuitBreaker();
        legacy.initializeLegacy(owner);
        legacy.setCertifiedAttestor(attestor, true);

        // Trip LOSS_BREAKER under PRE-C39 semantics (no migration yet).
        legacy.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        legacy.updateBreaker(LOSS, 100 ether);
        (, bool trippedPre,,,) = legacy.getBreakerStatus(LOSS);
        assertTrue(trippedPre, "precondition: legacy LOSS_BREAKER tripped");

        // Sanity: migration flag is unset before the upgrade.
        assertFalse(legacy.c39SecurityDefaultsInitialized());

        // Run the upgrade-path reinitializer. Migration must pin override=false.
        legacy.migrateToC39();

        // Migration claimed the slot.
        assertTrue(
            legacy.c39SecurityDefaultsInitialized(),
            "upgrade migration must claim the slot"
        );
        // In-flight trip preserved on wall-clock semantics.
        assertTrue(
            legacy.attestedResumeOverridden(LOSS),
            "in-flight LOSS_BREAKER override flag pinned by migration"
        );
        assertFalse(
            legacy.requiresAttestedResume(LOSS),
            "in-flight LOSS_BREAKER pinned to wall-clock (false)"
        );
        assertFalse(
            legacy.isAttestedResumeRequired(LOSS),
            "effective answer: legacy in-flight LOSS_BREAKER stays wall-clock"
        );

        // The trip resumes on wall-clock as it would have before C39.
        vm.warp(block.timestamp + 1 hours + 1);
        legacy.checkBreaker(LOSS); // must NOT revert
        (, bool trippedPost,,,) = legacy.getBreakerStatus(LOSS);
        assertFalse(
            trippedPost,
            "legacy in-flight LOSS_BREAKER auto-resets after cooldown (semantics preserved)"
        );
    }

    /// @dev Upgrade-path migration on a proxy where LOSS_BREAKER is NOT tripped:
    ///      no override is set; the breaker picks up C39 default-on for any
    ///      FUTURE trip.
    function test_C39_upgradeMigration_untrippedBreakerInheritsDefaultOn() public {
        C39ConcreteCircuitBreaker legacy = new C39ConcreteCircuitBreaker();
        legacy.initializeLegacy(owner);

        // No trips on LOSS or TRUE_PRICE.
        legacy.migrateToC39();

        // No overrides — the migration left them untouched.
        assertFalse(legacy.attestedResumeOverridden(LOSS));
        assertFalse(legacy.attestedResumeOverridden(TRUE_PRICE));

        // Effective: default-on engaged.
        assertTrue(legacy.isAttestedResumeRequired(LOSS));
        assertTrue(legacy.isAttestedResumeRequired(TRUE_PRICE));

        // A NEW trip after migration takes the default-on path.
        legacy.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        legacy.updateBreaker(LOSS, 100 ether); // trips
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, LOSS));
        legacy.checkBreaker(LOSS);
    }

    /// @dev Migration is idempotent at TWO layers:
    ///      1. Internal helper is gated by `c39SecurityDefaultsInitialized` so
    ///         a second invocation is a no-op (no surprise downgrade of an
    ///         existing override).
    ///      2. The OZ `reinitializer(2)` modifier on the upgrade entrypoint
    ///         rejects a SECOND call through that same upgrade path.
    function test_C39_migration_idempotent() public {
        // Spin up a legacy proxy and run the upgrade migration ONCE.
        C39ConcreteCircuitBreaker legacy = new C39ConcreteCircuitBreaker();
        legacy.initializeLegacy(owner);
        legacy.migrateToC39();
        assertTrue(legacy.c39SecurityDefaultsInitialized());

        // Layer 2: a SECOND call through the reinitializer(2) entrypoint must
        // revert via OZ Initializable.
        vm.expectRevert(); // OZ InvalidInitialization
        legacy.migrateToC39();

        // Layer 1: state remains stable — the internal-helper guard would
        // also no-op on re-entry. Override flags are NOT touched on a
        // re-attempt (no surprise downgrade).
        assertTrue(legacy.c39SecurityDefaultsInitialized());
        assertFalse(legacy.attestedResumeOverridden(LOSS));
        assertFalse(legacy.attestedResumeOverridden(TRUE_PRICE));
    }

    /// @dev If an in-flight tripped security breaker ALREADY has a governance
    ///      override set (someone explicitly opted in via C43 before the
    ///      migration runs), the migration must NOT overwrite that choice.
    function test_C39_migration_doesNotOverwriteExplicitOverride() public {
        C39ConcreteCircuitBreaker legacy = new C39ConcreteCircuitBreaker();
        legacy.initializeLegacy(owner);
        legacy.setCertifiedAttestor(attestor, true);
        legacy.setResumeAttestationThreshold(1);

        // Pre-migration: governance explicitly opted LOSS into attested-resume
        // (the original C43 flow), AND it's currently tripped.
        legacy.setAttestedResumeRequired(LOSS, true);
        legacy.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);
        legacy.updateBreaker(LOSS, 100 ether);

        // Run migration.
        legacy.migrateToC39();

        // Override remains TRUE — the migration must not have stomped it to false.
        assertTrue(legacy.attestedResumeOverridden(LOSS));
        assertTrue(
            legacy.requiresAttestedResume(LOSS),
            "explicit C43 opt-in survives the C39 migration"
        );
        assertTrue(legacy.isAttestedResumeRequired(LOSS));
    }

    // ============ Storage Layout Sanity ============

    /// @dev Defense in depth: confirm new storage variables are reachable and
    ///      the gap accounting is consistent. A wrong gap reduction would be
    ///      caught by inheriting contracts via OZ's `Initializable` slot
    ///      collision; this is a smoke test rather than an exhaustive layout
    ///      audit.
    function test_C39_storageReachable() public view {
        // Public mappings/flag readable.
        assertFalse(cb.attestedResumeOverridden(LOSS));
        assertFalse(cb.attestedResumeOverridden(TRUE_PRICE));
        assertTrue(cb.c39SecurityDefaultsInitialized());
    }
}
