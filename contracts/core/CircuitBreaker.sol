// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title CircuitBreaker
 * @notice Emergency stop mechanism to protect against exploits
 * @dev Implements multiple levels of circuit breakers with automatic and manual triggers
 */
abstract contract CircuitBreaker is OwnableUpgradeable {
    // ============ Structs ============

    struct BreakerConfig {
        bool enabled;
        uint256 threshold;        // Threshold value that triggers breaker
        uint256 cooldownPeriod;   // How long breaker stays active
        uint256 windowDuration;   // Rolling window for threshold checks
    }

    struct BreakerState {
        bool tripped;
        uint256 trippedAt;
        uint256 windowStart;
        uint256 windowValue;
    }

    // ============ State ============

    /// @notice Global pause state
    bool public globalPaused;

    /// @notice Per-function pause states
    mapping(bytes4 => bool) public functionPaused;

    /// @notice Authorized guardians who can trigger emergency stops
    mapping(address => bool) public guardians;

    /// @notice Circuit breaker configurations by type
    mapping(bytes32 => BreakerConfig) public breakerConfigs;

    /// @notice Circuit breaker states by type
    mapping(bytes32 => BreakerState) public breakerStates;

    /// @notice Breaker type identifiers
    bytes32 public constant VOLUME_BREAKER = keccak256("VOLUME_BREAKER");
    bytes32 public constant PRICE_BREAKER = keccak256("PRICE_BREAKER");
    bytes32 public constant WITHDRAWAL_BREAKER = keccak256("WITHDRAWAL_BREAKER");
    bytes32 public constant LOSS_BREAKER = keccak256("LOSS_BREAKER");
    bytes32 public constant TRUE_PRICE_BREAKER = keccak256("TRUE_PRICE_BREAKER");

    // ============ C43: Attested-Resume State (ETM Build Roadmap Gap #3) ============
    //
    // The default resume behavior is wall-clock: once cooldown expires, `_checkBreaker`
    // and `_updateBreaker` auto-reset state and trading can proceed. That is the
    // cognitive equivalent of a flinch that relaxes on a timer — the substrate does
    // NOT do that. Biological flinch relaxation requires an explicit safety evaluation.
    //
    // C43 augments (does not replace) the behavior. When `requiresAttestedResume`
    // is set for a breaker type, cooldown becomes a FLOOR rather than an automatic
    // trigger: state remains tripped past cooldown expiry until M certified attestors
    // submit a resume attestation. Defaults remain backwards-compatible — the flag
    // is opt-in per breaker type.

    /// @notice Per-breaker explicit override of attested-resume requirement.
    ///         Read in conjunction with `attestedResumeOverridden[breakerType]`.
    ///         When override is unset, the EFFECTIVE value falls back to the
    ///         classification default (see `_isAttestedResumeRequired`).
    /// @dev Direct reads of this slot do NOT reflect C39 default-on behavior for
    ///      security-load-bearing breakers (LOSS_BREAKER, TRUE_PRICE_BREAKER) when
    ///      no override has been set. External consumers should call
    ///      `isAttestedResumeRequired(breakerType)` for the effective answer.
    mapping(bytes32 => bool) public requiresAttestedResume;

    /// @notice Registry of governance-certified attestors eligible to sign resume evaluations.
    mapping(address => bool) public certifiedAttestor;

    /// @notice M in the M-of-N resume threshold. Minimum attestors that must agree a
    ///         tripped breaker is safe to resume. Defaults to 1; governance-tunable.
    uint256 public resumeAttestationThreshold;

    /// @notice Monotone counter of distinct resume attestations submitted against the
    ///         CURRENT tripped state. Reset on resume. Keyed by breakerType.
    mapping(bytes32 => uint256) public resumeAttestationCount;

    /// @notice Trip generation per breaker type. Increments on each trip transition;
    ///         used to scope attestation records to the current trip without iterating
    ///         the attestor set to clear state on reset.
    mapping(bytes32 => uint256) public tripGeneration;

    /// @notice Per-generation, per-attestor attestation record.
    ///         Key: (breakerType, tripGeneration, attestor).
    ///         Old generations are implicitly stale when generation increments.
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) private _hasAttestedResume;

    // ============ C39: Default-On Attested-Resume for Security-Load-Bearing Breakers (Gap 6) ============
    //
    // C43 shipped attested-resume as opt-in: `requiresAttestedResume[bType]` defaulted
    // false, governance had to call `setAttestedResumeRequired(bType, true)` to engage
    // the augmentation. Section 7 / Gap 6 of ETM_ALIGNMENT_AUDIT.md identifies this as
    // the highest-confidence-low-cost maturation: while C43 is dormant, the structural
    // augmentation is shipped but not load-bearing.
    //
    // C39 promotes `LOSS_BREAKER` and `TRUE_PRICE_BREAKER` to default-on. These are the
    // breakers where mistaken wall-clock auto-resume is cognitively-incorrect: a
    // depleted insurance pool or a manipulated true-price oracle does not heal on a
    // timer; only an explicit safety re-evaluation can authorize resume.
    //
    // The override path (`setAttestedResumeRequired`) is preserved. Once governance
    // explicitly sets the flag (true OR false) on a security-load-bearing breaker,
    // the override takes precedence over the classification default. This lets
    // governance flip OFF the default-on behavior per breaker if operational reality
    // demands it (e.g., a chain with no certified attestors yet).
    //
    // Existing-data preservation: a one-shot reinitializer-class migration runs in
    // child contracts to detect any in-flight tripped state on a security breaker
    // that has no override set, and pin its override to FALSE so the trip-in-progress
    // continues on the wall-clock semantics it started under. New trips after
    // migration get the default-on behavior.

    /// @notice Per-breaker override flag. When true, `requiresAttestedResume[bType]`
    ///         is the authoritative answer. When false (default), the effective
    ///         requirement is determined by `_isSecurityLoadBearing(bType)`.
    /// @dev Set automatically by `setAttestedResumeRequired` (any explicit governance
    ///      call locks in the chosen value, regardless of whether it agrees with the
    ///      classification default). This means a governance call to
    ///      `setAttestedResumeRequired(LOSS_BREAKER, false)` will pin LOSS_BREAKER to
    ///      false and disengage the C39 default-on behavior for that breaker.
    mapping(bytes32 => bool) public attestedResumeOverridden;

    /// @notice C39 migration completion flag. Per `primitive_post-upgrade-initialization-gate`:
    ///         the zero-value of this slot ("false") semantically means "C39 migration
    ///         has not run on this proxy". Concrete inheritors MUST call
    ///         `_initializeC39SecurityDefaults()` from their own initializer (fresh
    ///         deploy) and from a `reinitializer(N)` (upgrade path) to claim this slot.
    /// @dev Without the migration, EXISTING tripped breakers on a pre-C39 proxy would
    ///      surprise-flip semantics mid-trip on the next read of `_isAttestedResumeRequired`.
    ///      The migration pins overrides on any in-flight tripped security breaker so
    ///      the trip-in-progress completes under its original wall-clock semantics.
    bool public c39SecurityDefaultsInitialized;

    /// @dev Reserved storage gap for future upgrades. C43 consumed 6 slots; C39
    ///      consumed 2 more (attestedResumeOverridden, c39SecurityDefaultsInitialized).
    ///      44 - 2 = 42 remain.
    uint256[42] private __gap;

    // ============ Events ============

    event GlobalPauseChanged(bool paused, address indexed by);
    event FunctionPauseChanged(bytes4 indexed selector, bool paused, address indexed by);
    event GuardianUpdated(address indexed guardian, bool status);
    event BreakerConfigured(bytes32 indexed breakerType, uint256 threshold, uint256 cooldown);
    event BreakerTripped(bytes32 indexed breakerType, uint256 value, uint256 threshold);
    event BreakerReset(bytes32 indexed breakerType, address indexed by);
    event AnomalyDetected(bytes32 indexed anomalyType, uint256 value, string description);
    event BreakerDisabled(bytes32 indexed breakerType);
    // C43 attested-resume events
    event AttestedResumeRequirementSet(bytes32 indexed breakerType, bool required);
    event AttestorCertified(address indexed attestor, bool status);
    event ResumeAttestationThresholdSet(uint256 threshold);
    event ResumeAttestationSubmitted(bytes32 indexed breakerType, address indexed attestor, bytes32 evidenceHash, uint256 count);
    event BreakerResumedByAttestation(bytes32 indexed breakerType, uint256 totalAttestations);
    // C39 default-on events
    event C39SecurityDefaultsInitialized(bytes32[] preservedBreakers);
    event SecurityBreakerDefaultOverridden(bytes32 indexed breakerType, bool overrideValue, string reason);

    // ============ Errors ============

    error GloballyPaused();
    error FunctionPaused(bytes4 selector);
    error BreakerTrippedError(bytes32 breakerType);
    error NotGuardian();
    error CooldownActive();
    // C43 attested-resume errors
    error NotCertifiedAttestor();
    error BreakerNotTripped();
    error AlreadyAttestedResume();
    error ResumeThresholdZero();

    // ============ Modifiers ============

    modifier whenNotGloballyPaused() {
        if (globalPaused) revert GloballyPaused();
        _;
    }

    modifier whenFunctionNotPaused() {
        if (functionPaused[msg.sig]) revert FunctionPaused(msg.sig);
        _;
    }

    modifier whenBreakerNotTripped(bytes32 breakerType) {
        _checkBreaker(breakerType);
        _;
    }

    modifier onlyGuardian() {
        if (!guardians[msg.sender] && msg.sender != owner()) revert NotGuardian();
        _;
    }

    // ============ Guardian Functions ============

    /**
     * @notice Set global pause state
     * @param paused Whether to pause
     */
    function setGlobalPause(bool paused) external onlyGuardian {
        globalPaused = paused;
        emit GlobalPauseChanged(paused, msg.sender);
    }

    /**
     * @notice Pause/unpause specific function
     * @param selector Function selector
     * @param paused Whether to pause
     */
    function setFunctionPause(bytes4 selector, bool paused) external onlyGuardian {
        functionPaused[selector] = paused;
        emit FunctionPauseChanged(selector, paused, msg.sender);
    }

    /**
     * @notice Emergency pause all critical functions
     */
    function emergencyPauseAll() external onlyGuardian {
        globalPaused = true;
        emit GlobalPauseChanged(true, msg.sender);
    }

    /**
     * @notice Reset a tripped circuit breaker
     * @param breakerType Type of breaker to reset
     */
    function resetBreaker(bytes32 breakerType) external onlyGuardian {
        BreakerState storage state = breakerStates[breakerType];
        BreakerConfig storage config = breakerConfigs[breakerType];

        // Only reset if cooldown has passed
        if (state.tripped && block.timestamp < state.trippedAt + config.cooldownPeriod) {
            revert CooldownActive();
        }

        state.tripped = false;
        state.trippedAt = 0;
        state.windowStart = block.timestamp;
        state.windowValue = 0;

        emit BreakerReset(breakerType, msg.sender);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set guardian status
     * @param guardian Address to update
     * @param status Whether address is guardian
     */
    function setGuardian(address guardian, bool status) external onlyOwner {
        guardians[guardian] = status;
        emit GuardianUpdated(guardian, status);
    }

    /**
     * @notice Configure circuit breaker
     * @param breakerType Type of breaker
     * @param threshold Threshold that triggers breaker
     * @param cooldownPeriod How long breaker stays active
     * @param windowDuration Rolling window for accumulation
     */
    /// @dev TRP-R24-CB03: Added validation. threshold=0 causes instant permanent trip.
    ///      cooldownPeriod=0 causes _checkBreaker to revert "Breaker not configured".
    function configureBreaker(
        bytes32 breakerType,
        uint256 threshold,
        uint256 cooldownPeriod,
        uint256 windowDuration
    ) external onlyOwner {
        require(threshold > 0, "Threshold must be > 0");
        require(cooldownPeriod > 0, "Cooldown must be > 0");
        require(windowDuration > 0, "Window must be > 0");

        breakerConfigs[breakerType] = BreakerConfig({
            enabled: true,
            threshold: threshold,
            cooldownPeriod: cooldownPeriod,
            windowDuration: windowDuration
        });

        emit BreakerConfigured(breakerType, threshold, cooldownPeriod);
    }

    /**
     * @notice Disable a circuit breaker
     */
    /// @dev TRP-R24-CB07: Also clear state to prevent stale tripped state on re-enable.
    function disableBreaker(bytes32 breakerType) external onlyOwner {
        breakerConfigs[breakerType].enabled = false;
        delete breakerStates[breakerType];
        emit BreakerDisabled(breakerType);
    }

    // ============ C43: Attested-Resume Admin ============

    /// @notice Set the attested-resume requirement for a breaker type. Always pins
    ///         the effective answer to `required` for this breaker, overriding the
    ///         C39 classification default if any.
    /// @dev C43 originally defaulted false for all breakers. C39 (Gap 6) flips
    ///      `LOSS_BREAKER` and `TRUE_PRICE_BREAKER` to default-on. Calling this
    ///      function — with EITHER value — sets `attestedResumeOverridden[bType]`
    ///      to true so the explicit choice locks in. To reset back to "follow the
    ///      classification default", call `clearAttestedResumeOverride`.
    function setAttestedResumeRequired(bytes32 breakerType, bool required) external onlyOwner {
        requiresAttestedResume[breakerType] = required;
        attestedResumeOverridden[breakerType] = true;
        emit AttestedResumeRequirementSet(breakerType, required);
    }

    /// @notice Clear a per-breaker override and let the C39 classification default
    ///         decide whether attested-resume is required.
    /// @dev After this call, `isAttestedResumeRequired(breakerType)` returns
    ///      `_isSecurityLoadBearing(breakerType)`. This is the only path that can
    ///      restore the classification default after governance has explicitly
    ///      pinned a value via `setAttestedResumeRequired`.
    function clearAttestedResumeOverride(bytes32 breakerType) external onlyOwner {
        delete attestedResumeOverridden[breakerType];
        delete requiresAttestedResume[breakerType];
        emit AttestedResumeRequirementSet(breakerType, _isAttestedResumeRequired(breakerType));
    }

    /// @notice Register or revoke a certified resume-attestor.
    /// @dev Governance-gated on upgrades. Low-attestor count is the bootstrap assumption;
    ///      threshold can be raised as the pool matures.
    function setCertifiedAttestor(address attestor, bool status) external onlyOwner {
        certifiedAttestor[attestor] = status;
        emit AttestorCertified(attestor, status);
    }

    /// @notice Set M in the M-of-N resume threshold. Must be ≥ 1.
    function setResumeAttestationThreshold(uint256 m) external onlyOwner {
        if (m == 0) revert ResumeThresholdZero();
        resumeAttestationThreshold = m;
        emit ResumeAttestationThresholdSet(m);
    }

    /// @notice Certified attestor signals that the stress condition is resolved and
    ///         trading may safely resume on this breaker.
    /// @dev The cooldown floor is still enforced. M distinct attestations clears state.
    ///      Duplicate attestations from the same attestor are rejected (not idempotent
    ///      silently — we revert so the caller learns they already voted).
    /// @param breakerType Tripped breaker to attest on.
    /// @param evidenceHash Off-chain artifact hash documenting the safety evaluation.
    ///                    Opaque to the contract; emitted for auditability.
    function attestResume(bytes32 breakerType, bytes32 evidenceHash) external {
        if (!certifiedAttestor[msg.sender]) revert NotCertifiedAttestor();

        BreakerState storage state = breakerStates[breakerType];
        BreakerConfig storage config = breakerConfigs[breakerType];

        if (!state.tripped) revert BreakerNotTripped();
        // Cooldown floor still applies. Attestations submitted during cooldown revert.
        if (block.timestamp < state.trippedAt + config.cooldownPeriod) revert CooldownActive();
        uint256 gen = tripGeneration[breakerType];
        if (_hasAttestedResume[breakerType][gen][msg.sender]) revert AlreadyAttestedResume();

        _hasAttestedResume[breakerType][gen][msg.sender] = true;
        uint256 newCount = resumeAttestationCount[breakerType] + 1;
        resumeAttestationCount[breakerType] = newCount;

        emit ResumeAttestationSubmitted(breakerType, msg.sender, evidenceHash, newCount);

        uint256 threshold = resumeAttestationThreshold == 0 ? 1 : resumeAttestationThreshold;
        if (newCount >= threshold) {
            _resumeAfterAttestation(breakerType);
        }
    }

    /// @dev Clear tripped state and bump trip generation so per-attestor flags for
    ///      this breaker are implicitly stale on the next trip. No iteration required.
    function _resumeAfterAttestation(bytes32 breakerType) internal {
        BreakerState storage state = breakerStates[breakerType];
        uint256 finalCount = resumeAttestationCount[breakerType];

        state.tripped = false;
        state.trippedAt = 0;
        state.windowStart = block.timestamp;
        state.windowValue = 0;
        resumeAttestationCount[breakerType] = 0;
        // Bump generation: prior attestations are now in a dead generation and cannot
        // short-circuit a future trip's threshold.
        tripGeneration[breakerType] += 1;

        emit BreakerResumedByAttestation(breakerType, finalCount);
    }

    // ============ C39: Default-On Classification + Migration ============

    /// @notice Pure classification: is this breaker security-load-bearing?
    /// @dev Security-load-bearing breakers are those whose mistaken wall-clock
    ///      auto-resume materially harms users. Currently:
    ///      - LOSS_BREAKER: insurance-pool or PnL-vault depletion event; resuming on
    ///        a timer cannot heal a depleted reserve.
    ///      - TRUE_PRICE_BREAKER: oracle deviation event; resuming on a timer cannot
    ///        confirm the oracle is no longer manipulated.
    ///      VOLUME_BREAKER, PRICE_BREAKER, WITHDRAWAL_BREAKER are operational and
    ///      keep wall-clock auto-resume by default. New breaker types added in
    ///      future cycles must be classified explicitly here if they qualify.
    function _isSecurityLoadBearing(bytes32 breakerType) internal pure returns (bool) {
        return breakerType == LOSS_BREAKER || breakerType == TRUE_PRICE_BREAKER;
    }

    /// @notice Effective answer to "is attested-resume required for this breaker"?
    ///         Combines C43 explicit-override with C39 classification default.
    /// @dev Resolution order:
    ///      1. If governance has explicitly set the override (`attestedResumeOverridden`),
    ///         return the stored `requiresAttestedResume` value verbatim.
    ///      2. Otherwise return `_isSecurityLoadBearing(breakerType)` (C39 default).
    function _isAttestedResumeRequired(bytes32 breakerType) internal view returns (bool) {
        if (attestedResumeOverridden[breakerType]) {
            return requiresAttestedResume[breakerType];
        }
        return _isSecurityLoadBearing(breakerType);
    }

    /// @notice External read of the effective attested-resume requirement.
    ///         Use this rather than `requiresAttestedResume(bType)` for the
    ///         post-C39 answer.
    function isAttestedResumeRequired(bytes32 breakerType) external view returns (bool) {
        return _isAttestedResumeRequired(breakerType);
    }

    /// @notice C39 (post-upgrade-initialization-gate): one-shot migration that
    ///         pins overrides on any IN-FLIGHT tripped security-load-bearing
    ///         breaker so the trip-in-progress completes under the wall-clock
    ///         semantics it started under. Idempotent via `c39SecurityDefaultsInitialized`.
    /// @dev Concrete inheritors MUST call this from BOTH:
    ///      - `initialize()` (fresh deploy — no in-flight trips, sets the flag)
    ///      - `reinitializer(N)` (upgrade — preserves in-flight trips, sets the flag)
    ///
    ///      Without this migration, an existing pre-C39 proxy whose LOSS_BREAKER
    ///      is currently tripped would see `_isAttestedResumeRequired` flip from
    ///      false to true on the next read — pinning the breaker tripped past
    ///      cooldown until attestors arrive. We pin the override to false on
    ///      ALREADY-TRIPPED security breakers with no override set, which keeps
    ///      the in-flight trip on its original wall-clock path. New trips after
    ///      this point fall through to the C39 default-on classification.
    function _initializeC39SecurityDefaults() internal {
        if (c39SecurityDefaultsInitialized) return;

        bytes32[] memory preserved = new bytes32[](2);
        uint256 preservedCount = 0;

        bytes32[2] memory securityBreakers = [LOSS_BREAKER, TRUE_PRICE_BREAKER];
        for (uint256 i = 0; i < securityBreakers.length; i++) {
            bytes32 bType = securityBreakers[i];
            // Only pin on IN-FLIGHT tripped breakers without an existing override.
            // Untripped breakers fall through to the new classification default.
            if (
                breakerStates[bType].tripped &&
                !attestedResumeOverridden[bType]
            ) {
                attestedResumeOverridden[bType] = true;
                requiresAttestedResume[bType] = false;
                preserved[preservedCount] = bType;
                preservedCount++;
                emit SecurityBreakerDefaultOverridden(
                    bType,
                    false,
                    "C39 migration: in-flight trip preserved on wall-clock"
                );
            }
        }

        c39SecurityDefaultsInitialized = true;

        // Trim preserved[] to the actual count for the event payload.
        bytes32[] memory finalPreserved = new bytes32[](preservedCount);
        for (uint256 j = 0; j < preservedCount; j++) {
            finalPreserved[j] = preserved[j];
        }
        emit C39SecurityDefaultsInitialized(finalPreserved);
    }

    // ============ Internal Functions ============

    /**
     * @notice Check if breaker is tripped, auto-reset stale state after cooldown
     */
    /// @dev TRP-R40-CB05: Changed from view to state-mutating so that stale
    ///      windowValue is cleared when cooldown expires. Without this, a
    ///      modifier-only gate would let the tx through but leave windowValue
    ///      at its pre-trip level, causing the next _updateBreaker call to
    ///      immediately re-trip on a small addition.
    function _checkBreaker(bytes32 breakerType) internal {
        BreakerState storage state = breakerStates[breakerType];
        BreakerConfig storage config = breakerConfigs[breakerType];

        if (!config.enabled) return;

        // Verify this breaker was actually configured (cooldownPeriod > 0)
        require(config.cooldownPeriod > 0, "Breaker not configured");

        if (state.tripped) {
            // Check if cooldown has passed
            if (block.timestamp < state.trippedAt + config.cooldownPeriod) {
                revert BreakerTrippedError(breakerType);
            }
            // C43: cooldown expiry auto-resets only when attestation is NOT required.
            // C39: lookup the EFFECTIVE answer — explicit override or security-default.
            // Opted-in breakers stay tripped past cooldown until `attestResume` clears.
            if (_isAttestedResumeRequired(breakerType)) {
                revert BreakerTrippedError(breakerType);
            }
            // Cooldown expired — auto-reset state so windowValue is fresh
            state.tripped = false;
            state.trippedAt = 0;
            state.windowStart = block.timestamp;
            state.windowValue = 0;
        }
    }

    /**
     * @notice Update breaker state with new value
     * @param breakerType Type of breaker
     * @param value Value to add to accumulator
     * @return tripped Whether this update tripped the breaker
     */
    function _updateBreaker(
        bytes32 breakerType,
        uint256 value
    ) internal returns (bool tripped) {
        BreakerConfig storage config = breakerConfigs[breakerType];
        BreakerState storage state = breakerStates[breakerType];

        if (!config.enabled) return false;

        // TRP-R24-CB01: Auto-reset tripped state after cooldown expires.
        // Previously, _updateBreaker returned true permanently after first trip
        // because it never checked cooldown. The tripped flag was only clearable
        // via manual resetBreaker() call.
        //
        // C43: opt-in attested-resume breakers skip the auto-reset path entirely
        // and keep returning `true` (tripped) until `attestResume` clears state.
        if (state.tripped) {
            // C39: read the EFFECTIVE attested-resume requirement (explicit override
            // wins; otherwise security-load-bearing classification default).
            if (
                block.timestamp >= state.trippedAt + config.cooldownPeriod &&
                !_isAttestedResumeRequired(breakerType)
            ) {
                // Cooldown expired AND attestation not required — auto-reset.
                state.tripped = false;
                state.trippedAt = 0;
                state.windowStart = block.timestamp;
                state.windowValue = 0;
            } else {
                return true; // Still in cooldown OR awaiting attestation
            }
        }

        // Reset window if expired
        if (block.timestamp >= state.windowStart + config.windowDuration) {
            state.windowStart = block.timestamp;
            state.windowValue = 0;
        }

        // Accumulate value
        state.windowValue += value;

        // Check threshold
        if (state.windowValue >= config.threshold) {
            state.tripped = true;
            state.trippedAt = block.timestamp;
            // C43: bump generation on every new trip so any stale attestations from
            // a previous trip cannot leak into this trip's threshold accounting.
            tripGeneration[breakerType] += 1;

            emit BreakerTripped(breakerType, state.windowValue, config.threshold);
            return true;
        }

        return false;
    }

    /**
     * @notice Log anomaly for monitoring
     */
    function _logAnomaly(
        bytes32 anomalyType,
        uint256 value,
        string memory description
    ) internal {
        emit AnomalyDetected(anomalyType, value, description);
    }

    /**
     * @notice Check multiple conditions and trip if any fail
     */
    function _checkInvariants(
        bool[] memory conditions,
        string[] memory errorMessages
    ) internal view {
        require(conditions.length == errorMessages.length, "Length mismatch");

        for (uint256 i = 0; i < conditions.length; i++) {
            require(conditions[i], errorMessages[i]);
        }
    }

    // ============ View Functions ============

    /**
     * @notice Check if system is operational
     */
    function isOperational() external view returns (bool) {
        return !globalPaused;
    }

    /**
     * @notice Get breaker status
     */
    function getBreakerStatus(bytes32 breakerType) external view returns (
        bool enabled,
        bool tripped,
        uint256 currentValue,
        uint256 threshold,
        uint256 cooldownRemaining
    ) {
        BreakerConfig storage config = breakerConfigs[breakerType];
        BreakerState storage state = breakerStates[breakerType];

        enabled = config.enabled;
        tripped = state.tripped;
        currentValue = state.windowValue;
        threshold = config.threshold;

        if (state.tripped && block.timestamp < state.trippedAt + config.cooldownPeriod) {
            cooldownRemaining = (state.trippedAt + config.cooldownPeriod) - block.timestamp;
        }
    }
}
