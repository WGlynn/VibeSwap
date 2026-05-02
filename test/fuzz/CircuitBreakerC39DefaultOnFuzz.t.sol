// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CircuitBreaker.sol";

/// @notice Concrete implementation that exposes the C39 migration helper +
///         enough of the abstract CircuitBreaker surface to fuzz the default-on
///         classification under random override sequences.
contract C39FuzzCircuitBreaker is CircuitBreaker {
    function initializeFresh(address _owner) external initializer {
        __Ownable_init(_owner);
        _initializeC39SecurityDefaults();
    }
    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }
    function checkBreaker(bytes32 breakerType) external {
        _checkBreaker(breakerType);
    }
}

/// @title C39 Attested-Resume Default-On Fuzz
/// @notice Property: for any sequence of `setAttestedResumeRequired` and
///         `clearAttestedResumeOverride` calls (mixed with any breaker trips),
///         `isAttestedResumeRequired(bType)` correctly reflects the
///         override-or-classification-default rule:
///
///           - If `attestedResumeOverridden[bType] == true`:
///                 effective = `requiresAttestedResume[bType]`
///           - Else:
///                 effective = `_isSecurityLoadBearing(bType)`
///                          = (bType == LOSS_BREAKER || bType == TRUE_PRICE_BREAKER)
///
/// The fuzz exhausts all five canonical breaker types and arbitrary admin
/// command sequences, asserting the rule holds at every observation point.
contract CircuitBreakerC39DefaultOnFuzz is Test {
    C39FuzzCircuitBreaker public cb;

    address public owner;

    bytes32 internal LOSS;
    bytes32 internal TRUE_PRICE;
    bytes32 internal VOLUME;
    bytes32 internal PRICE;
    bytes32 internal WITHDRAWAL;
    bytes32 internal CUSTOM_BREAKER; // a non-classified-as-security breaker

    bytes32[] internal allBreakers;

    function setUp() public {
        owner = address(this);
        cb = new C39FuzzCircuitBreaker();
        cb.initializeFresh(owner);

        LOSS = cb.LOSS_BREAKER();
        TRUE_PRICE = cb.TRUE_PRICE_BREAKER();
        VOLUME = cb.VOLUME_BREAKER();
        PRICE = cb.PRICE_BREAKER();
        WITHDRAWAL = cb.WITHDRAWAL_BREAKER();
        CUSTOM_BREAKER = keccak256("CUSTOM_FUZZ_BREAKER");

        allBreakers.push(LOSS);
        allBreakers.push(TRUE_PRICE);
        allBreakers.push(VOLUME);
        allBreakers.push(PRICE);
        allBreakers.push(WITHDRAWAL);
        allBreakers.push(CUSTOM_BREAKER);

        // Configure each breaker so trip-paths can fire.
        cb.configureBreaker(LOSS, 100, 1 hours, 1 hours);
        cb.configureBreaker(TRUE_PRICE, 100, 1 hours, 1 hours);
        cb.configureBreaker(VOLUME, 100, 1 hours, 1 hours);
        cb.configureBreaker(PRICE, 100, 1 hours, 1 hours);
        cb.configureBreaker(WITHDRAWAL, 100, 1 hours, 1 hours);
        cb.configureBreaker(CUSTOM_BREAKER, 100, 1 hours, 1 hours);
    }

    function _isSecurityLoadBearing(bytes32 bType) internal view returns (bool) {
        return bType == LOSS || bType == TRUE_PRICE;
    }

    function _expectedEffective(bytes32 bType) internal view returns (bool) {
        if (cb.attestedResumeOverridden(bType)) {
            return cb.requiresAttestedResume(bType);
        }
        return _isSecurityLoadBearing(bType);
    }

    function _pickBreaker(uint256 seed) internal view returns (bytes32) {
        return allBreakers[seed % allBreakers.length];
    }

    /// @notice CORE PROPERTY: at the initial state (no overrides set, no trips),
    ///         only LOSS and TRUE_PRICE return true. All others return false.
    function test_initialClassification() public view {
        assertTrue(cb.isAttestedResumeRequired(LOSS), "LOSS must default-on");
        assertTrue(cb.isAttestedResumeRequired(TRUE_PRICE), "TRUE_PRICE must default-on");
        assertFalse(cb.isAttestedResumeRequired(VOLUME), "VOLUME must default-off");
        assertFalse(cb.isAttestedResumeRequired(PRICE), "PRICE must default-off");
        assertFalse(cb.isAttestedResumeRequired(WITHDRAWAL), "WITHDRAWAL must default-off");
        assertFalse(cb.isAttestedResumeRequired(CUSTOM_BREAKER), "CUSTOM must default-off");
    }

    /// @notice FUZZ — single override action followed by classification check.
    ///         Whatever override gets set, the effective answer must match the
    ///         override-or-default rule.
    function testFuzz_singleSetMatchesRule(uint256 breakerSeed, bool requiredFlag) public {
        bytes32 bType = _pickBreaker(breakerSeed);
        cb.setAttestedResumeRequired(bType, requiredFlag);

        assertEq(
            cb.isAttestedResumeRequired(bType),
            requiredFlag,
            "C39: explicit override not respected"
        );
        assertTrue(cb.attestedResumeOverridden(bType), "override flag not set");
    }

    /// @notice FUZZ — clear after set returns to classification default.
    function testFuzz_clearReturnsToDefault(uint256 breakerSeed, bool requiredFlag) public {
        bytes32 bType = _pickBreaker(breakerSeed);
        cb.setAttestedResumeRequired(bType, requiredFlag);
        cb.clearAttestedResumeOverride(bType);

        assertEq(
            cb.isAttestedResumeRequired(bType),
            _isSecurityLoadBearing(bType),
            "C39: clear did not restore classification default"
        );
        assertFalse(cb.attestedResumeOverridden(bType), "override flag not cleared");
    }

    /// @notice FUZZ — long random sequence of admin actions, classification
    ///         rule must hold at every step for every breaker type.
    function testFuzz_arbitraryAdminSequence(
        uint256[16] calldata breakerSeeds,
        uint256[16] calldata actionSeeds,
        bool[16] calldata flags
    ) public {
        for (uint256 i = 0; i < 16; i++) {
            bytes32 bType = _pickBreaker(breakerSeeds[i]);
            uint256 action = actionSeeds[i] % 4;

            if (action == 0) {
                cb.setAttestedResumeRequired(bType, flags[i]);
            } else if (action == 1) {
                cb.clearAttestedResumeOverride(bType);
            } else if (action == 2) {
                // Trip the breaker via _updateBreaker. Classification rule
                // is purely a function of override flags + classification —
                // trip state must NOT affect the rule's answer.
                cb.updateBreaker(bType, 200);
            } else {
                // Reset windowing by warping past cooldown.
                vm.warp(block.timestamp + 2 hours);
            }

            // After every action: re-check the rule for ALL breakers.
            for (uint256 j = 0; j < allBreakers.length; j++) {
                bytes32 t = allBreakers[j];
                assertEq(
                    cb.isAttestedResumeRequired(t),
                    _expectedEffective(t),
                    "C39: rule violated after admin action"
                );
            }
        }
    }

    /// @notice FUZZ — explicit override of LOSS/TRUE_PRICE to FALSE disengages
    ///         the C39 default-on. This is the documented per-breaker opt-out.
    function testFuzz_explicitFalseOnSecurityBreaker_disengagesDefault(
        uint256 breakerSeed
    ) public {
        // Force the chosen breaker into the security set.
        bytes32 bType = (breakerSeed % 2 == 0) ? LOSS : TRUE_PRICE;

        // Initially default-on.
        assertTrue(cb.isAttestedResumeRequired(bType));

        // Explicit FALSE override flips the effective answer.
        cb.setAttestedResumeRequired(bType, false);
        assertFalse(cb.isAttestedResumeRequired(bType), "C39: explicit FALSE not honored");

        // Clear restores the default.
        cb.clearAttestedResumeOverride(bType);
        assertTrue(cb.isAttestedResumeRequired(bType), "C39: clear didn't restore default-on");
    }

    /// @notice FUZZ — explicit override of NON-security breaker to TRUE engages
    ///         attested-resume on that breaker. Symmetrical opt-in.
    function testFuzz_explicitTrueOnNonSecurityBreaker_engages(
        uint256 breakerSeed
    ) public {
        // Pick from the non-security set: VOLUME, PRICE, WITHDRAWAL, CUSTOM.
        bytes32[4] memory nonSec = [VOLUME, PRICE, WITHDRAWAL, CUSTOM_BREAKER];
        bytes32 bType = nonSec[breakerSeed % 4];

        // Default off.
        assertFalse(cb.isAttestedResumeRequired(bType));

        // Engage via override.
        cb.setAttestedResumeRequired(bType, true);
        assertTrue(cb.isAttestedResumeRequired(bType), "C39: opt-in true not honored");

        // Clear → back to default off.
        cb.clearAttestedResumeOverride(bType);
        assertFalse(cb.isAttestedResumeRequired(bType), "C39: clear didn't return to default-off");
    }

    /// @notice FUZZ — trips and resets must NOT affect the classification rule's
    ///         answer. The rule depends only on (override-flag, override-value,
    ///         breaker-type-classification), never on trip state.
    function testFuzz_tripStateDoesNotAffectRule(
        uint256 breakerSeed,
        uint256 trips,
        bool overrideValue,
        bool useOverride
    ) public {
        bytes32 bType = _pickBreaker(breakerSeed);
        if (useOverride) {
            cb.setAttestedResumeRequired(bType, overrideValue);
        }

        bool ruleBefore = cb.isAttestedResumeRequired(bType);

        // Apply N >= 1 trip cycles (limited to keep runtime in bounds).
        uint256 n = bound(trips, 1, 4);
        for (uint256 i = 0; i < n; i++) {
            cb.updateBreaker(bType, 200);
            // Try to reset (may revert if attestation required + no attestor).
            // Either way, the RULE'S answer must be invariant.
            assertEq(
                cb.isAttestedResumeRequired(bType),
                ruleBefore,
                "C39: rule answer changed mid-trip"
            );
            vm.warp(block.timestamp + 2 hours);
        }
    }
}
