// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/CircuitBreaker.sol";
import "../../contracts/amm/VibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice C39-F1 — Wiring tests for the C39 attested-resume migration on the
///         concrete inheritors VibeSwapCore and VibeAMM.
///
/// @dev Audit (docs/audits/2026-05-01-storage-layout-followup.md) flagged:
///   - HIGH: `_initializeC39SecurityDefaults()` is dead code on existing inheritors.
///     Pre-C39 proxy upgrades miss the in-flight trip preservation, so a tripped
///     LOSS_BREAKER / TRUE_PRICE_BREAKER would surprise-flip its semantic from
///     wall-clock to attested-resume mid-trip.
///
///   This test asserts:
///   (a) Fresh deploys (initialize()) claim the C39 slot.
///   (b) `initializeC39Migration()` reinitializer migrates pre-C39 proxies safely
///       (in-flight tripped security breakers have their override pinned to false
///       so the trip-in-progress completes on its original wall-clock semantics).
///   (c) `initializeC39Migration()` cannot be called twice (reinitializer(2)
///       semantics — second call reverts with InvalidInitialization).
///   (d) Only the owner can call `initializeC39Migration()`.
///   (e) Regression: pre-existing initialize() behavior is preserved (volume
///       breaker still configured, owner / treasury / etc. set correctly).
///
/// Approach for (b): we cannot trip a breaker on a pre-C39 proxy here (we only
///   have one implementation in-tree), so we simulate the pre-C39 state by
///   `vm.store`-ing `c39SecurityDefaultsInitialized = false` on a fresh proxy
///   AFTER tripping a security breaker. That recreates the upgrade-time
///   condition: in-flight trip + un-claimed C39 slot.
contract C39MigrationWiringTest is Test {
    address public owner;
    address public guardian;
    address public attestor;

    bytes32 internal LOSS;
    bytes32 internal TRUE_PRICE;
    bytes32 internal VOLUME;

    // Mirror events for vm.expectEmit
    event SecurityBreakerDefaultOverridden(bytes32 indexed breakerType, bool overrideValue, string reason);
    event C39SecurityDefaultsInitialized(bytes32[] preservedBreakers);

    function setUp() public {
        owner = address(this);
        guardian = makeAddr("guardian");
        attestor = makeAddr("attestor");

        LOSS = keccak256("LOSS_BREAKER");
        TRUE_PRICE = keccak256("TRUE_PRICE_BREAKER");
        VOLUME = keccak256("VOLUME_BREAKER");
    }

    // ============ Helpers ============

    /// @dev Resolve the storage slot of `c39SecurityDefaultsInitialized` in the
    ///      CircuitBreaker linear storage block. Slot index is determined by the
    ///      order of state declarations in CircuitBreaker.sol:
    ///        0: globalPaused (bool, occupies a full word as bool here)
    ///        1: functionPaused
    ///        2: guardians
    ///        3: breakerConfigs
    ///        4: breakerStates
    ///        5: requiresAttestedResume       (C43)
    ///        6: certifiedAttestor            (C43)
    ///        7: resumeAttestationThreshold   (C43)
    ///        8: resumeAttestationCount       (C43)
    ///        9: tripGeneration               (C43)
    ///       10: _hasAttestedResume           (C43)
    ///       11: attestedResumeOverridden     (C39)
    ///       12: c39SecurityDefaultsInitialized (C39)
    ///      OZ v5 parents (Ownable / UUPS / ReentrancyGuard / Initializable) use
    ///      ERC-7201 namespaced storage so they do NOT consume sequential slots.
    ///      VibeSwapCore / VibeAMM extend at slot 13 onward — that does not
    ///      affect the slot of the C39 flag inherited from CircuitBreaker.
    function _c39FlagSlot() internal pure returns (uint256) {
        return 12;
    }

    function _deployVibeSwapCore() internal returns (VibeSwapCore core) {
        // Stub addresses — VibeSwapCore.initialize() requires non-zero pointers
        // for auction/amm/treasury/router but does not call into them at init.
        address auction = makeAddr("auction");
        address amm = makeAddr("amm");
        address treasury = makeAddr("treasury");
        address router = makeAddr("router");

        VibeSwapCore impl = new VibeSwapCore();
        bytes memory initData = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector,
            owner,
            auction,
            amm,
            treasury,
            router
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        core = VibeSwapCore(payable(address(proxy)));
    }

    function _deployVibeAMM() internal returns (VibeAMM amm) {
        address treasury = makeAddr("amm-treasury");
        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));
    }

    // ============ VibeSwapCore — Fresh Deploy ============

    function test_C39F1_VibeSwapCore_freshDeployClaimsC39Slot() public {
        VibeSwapCore core = _deployVibeSwapCore();
        assertTrue(
            core.c39SecurityDefaultsInitialized(),
            "fresh deploy must claim c39SecurityDefaultsInitialized via initialize()"
        );
    }

    function test_C39F1_VibeSwapCore_freshDeploySecurityBreakersDefaultOn() public {
        VibeSwapCore core = _deployVibeSwapCore();
        assertTrue(
            core.isAttestedResumeRequired(LOSS),
            "LOSS_BREAKER must default to attested-resume-required on fresh deploy"
        );
        assertTrue(
            core.isAttestedResumeRequired(TRUE_PRICE),
            "TRUE_PRICE_BREAKER must default to attested-resume-required on fresh deploy"
        );
        assertFalse(
            core.isAttestedResumeRequired(VOLUME),
            "VOLUME_BREAKER must remain wall-clock by default"
        );
    }

    function test_C39F1_VibeSwapCore_volumeBreakerStillConfigured() public {
        // Regression: pre-existing initialize() behavior — VOLUME_BREAKER must
        // still be configured by `_configureDefaultBreakers()`.
        VibeSwapCore core = _deployVibeSwapCore();
        (bool enabled,,, uint256 threshold,) = core.getBreakerStatus(VOLUME);
        assertTrue(enabled, "VOLUME_BREAKER must be enabled post-init");
        assertEq(threshold, 10_000_000 * 1e18, "VOLUME_BREAKER threshold preserved");
    }

    // ============ VibeSwapCore — Reinitializer Path ============

    function test_C39F1_VibeSwapCore_reinitializerCannotRunTwiceOnFreshDeploy() public {
        VibeSwapCore core = _deployVibeSwapCore();
        // Fresh deploys already advanced `_initialized` to 1. The reinitializer(2)
        // is callable exactly once and is then exhausted.
        core.initializeC39Migration(); // first call OK (no-op body)

        vm.expectRevert(); // InvalidInitialization() from OZ
        core.initializeC39Migration();
    }

    function test_C39F1_VibeSwapCore_reinitializerOnlyOwner() public {
        VibeSwapCore core = _deployVibeSwapCore();
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        core.initializeC39Migration();
    }

    /// @dev Simulate an upgrade from a pre-C39 proxy that has an in-flight
    ///      tripped LOSS_BREAKER. We use vm.store to clear the C39 flag
    ///      AFTER tripping the breaker (recreating the storage state of a
    ///      proxy that was initialized before C39 shipped).
    function test_C39F1_VibeSwapCore_reinitializerPreservesInFlightLossTrip() public {
        VibeSwapCore core = _deployVibeSwapCore();

        // 1. Configure + trip LOSS_BREAKER (use guardian path via setGuardian
        //    + breakerConfigs admin since core.setGuardian is owner-gated and we
        //    are owner). We don't have a public way to call _updateBreaker on
        //    the proxy directly, so we trip via configure + simulate by writing
        //    BreakerState.tripped via vm.store.
        core.configureBreaker(LOSS, 100 ether, 1 hours, 10 minutes);

        // BreakerState lives at slot 4 (mapping(bytes32 => BreakerState)).
        // BreakerState packs: tripped(bool, slot+0), trippedAt(uint256, slot+1),
        // windowStart(uint256, slot+2), windowValue(uint256, slot+3).
        bytes32 stateSlot = keccak256(abi.encode(LOSS, uint256(4)));
        // Write tripped = true (bool occupies its own slot when not packed).
        vm.store(address(core), stateSlot, bytes32(uint256(1)));
        // Write trippedAt = block.timestamp.
        vm.store(address(core), bytes32(uint256(stateSlot) + 1), bytes32(block.timestamp));

        // Sanity: getBreakerStatus reflects the simulated trip.
        (, bool tripped,,,) = core.getBreakerStatus(LOSS);
        assertTrue(tripped, "precondition: LOSS_BREAKER simulated tripped");

        // 2. Clear C39 init flag to simulate pre-C39 storage (slot 12).
        vm.store(address(core), bytes32(_c39FlagSlot()), bytes32(uint256(0)));
        assertFalse(
            core.c39SecurityDefaultsInitialized(),
            "precondition: C39 flag cleared (pre-C39 proxy state)"
        );

        // 3. Run the migration via the reinitializer. It must:
        //    (a) pin attestedResumeOverridden[LOSS] = true with raw value false
        //    (b) flip c39SecurityDefaultsInitialized = true
        // Note: OZ's `initializer` modifier in `initialize()` already advanced
        // `_initialized` to 1, so reinitializer(2) is callable.
        vm.expectEmit(true, false, false, true, address(core));
        emit SecurityBreakerDefaultOverridden(
            LOSS,
            false,
            "C39 migration: in-flight trip preserved on wall-clock"
        );
        core.initializeC39Migration();

        // Post-migration: in-flight LOSS_BREAKER trip is preserved on wall-clock.
        assertTrue(
            core.attestedResumeOverridden(LOSS),
            "post-migration: in-flight LOSS_BREAKER override pinned"
        );
        assertFalse(
            core.requiresAttestedResume(LOSS),
            "post-migration: pinned override value is false (preserves wall-clock)"
        );
        assertFalse(
            core.isAttestedResumeRequired(LOSS),
            "post-migration: effective answer for in-flight trip is wall-clock"
        );
        assertTrue(
            core.c39SecurityDefaultsInitialized(),
            "post-migration: C39 slot claimed"
        );

        // TRUE_PRICE_BREAKER was NOT in-flight, so it falls through to the C39
        // default-on classification.
        assertTrue(
            core.isAttestedResumeRequired(TRUE_PRICE),
            "TRUE_PRICE_BREAKER (untripped) gets C39 default-on classification"
        );
    }

    // ============ VibeAMM — Fresh Deploy ============

    function test_C39F1_VibeAMM_freshDeployClaimsC39Slot() public {
        VibeAMM amm = _deployVibeAMM();
        assertTrue(
            amm.c39SecurityDefaultsInitialized(),
            "fresh deploy must claim c39SecurityDefaultsInitialized via initialize()"
        );
    }

    function test_C39F1_VibeAMM_freshDeploySecurityBreakersDefaultOn() public {
        VibeAMM amm = _deployVibeAMM();
        assertTrue(amm.isAttestedResumeRequired(LOSS), "LOSS_BREAKER default-on");
        assertTrue(
            amm.isAttestedResumeRequired(TRUE_PRICE),
            "TRUE_PRICE_BREAKER default-on"
        );
        assertFalse(amm.isAttestedResumeRequired(VOLUME), "VOLUME_BREAKER wall-clock");
    }

    function test_C39F1_VibeAMM_truePriceBreakerStillConfigured() public {
        // Regression: VibeAMM's initialize() configures TRUE_PRICE_BREAKER. After
        // C39-F1 wiring, that configuration must still hold.
        VibeAMM amm = _deployVibeAMM();
        (bool enabled,,, uint256 threshold,) = amm.getBreakerStatus(TRUE_PRICE);
        assertTrue(enabled, "TRUE_PRICE_BREAKER must be enabled post-init");
        assertEq(threshold, 3000, "TRUE_PRICE_BREAKER threshold preserved (3000 bps)");
    }

    // ============ VibeAMM — Reinitializer Path ============

    function test_C39F1_VibeAMM_reinitializerCannotRunTwiceOnFreshDeploy() public {
        VibeAMM amm = _deployVibeAMM();
        amm.initializeC39Migration(); // first call OK
        vm.expectRevert();
        amm.initializeC39Migration();
    }

    function test_C39F1_VibeAMM_reinitializerOnlyOwner() public {
        VibeAMM amm = _deployVibeAMM();
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        amm.initializeC39Migration();
    }

    function test_C39F1_VibeAMM_reinitializerPreservesInFlightTruePriceTrip() public {
        VibeAMM amm = _deployVibeAMM();

        // Trip TRUE_PRICE_BREAKER via storage simulation (same approach as core).
        amm.configureBreaker(TRUE_PRICE, 1000 ether, 1 hours, 10 minutes);
        bytes32 stateSlot = keccak256(abi.encode(TRUE_PRICE, uint256(4)));
        vm.store(address(amm), stateSlot, bytes32(uint256(1)));
        vm.store(address(amm), bytes32(uint256(stateSlot) + 1), bytes32(block.timestamp));

        (, bool tripped,,,) = amm.getBreakerStatus(TRUE_PRICE);
        assertTrue(tripped, "precondition: TRUE_PRICE_BREAKER simulated tripped");

        // Clear C39 flag (slot 12 — same offset since CircuitBreaker is the
        // first non-OZ-namespaced parent and OZ v5 parents are namespaced).
        vm.store(address(amm), bytes32(_c39FlagSlot()), bytes32(uint256(0)));
        assertFalse(amm.c39SecurityDefaultsInitialized());

        vm.expectEmit(true, false, false, true, address(amm));
        emit SecurityBreakerDefaultOverridden(
            TRUE_PRICE,
            false,
            "C39 migration: in-flight trip preserved on wall-clock"
        );
        amm.initializeC39Migration();

        assertTrue(amm.attestedResumeOverridden(TRUE_PRICE));
        assertFalse(amm.requiresAttestedResume(TRUE_PRICE));
        assertFalse(amm.isAttestedResumeRequired(TRUE_PRICE));
        assertTrue(amm.c39SecurityDefaultsInitialized());
    }
}
