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

    /// @notice Per-breaker flag. When true, cooldown expiry does NOT auto-reset state;
    ///         resume requires `attestResume` from certified attestors (cooldown floor
    ///         still enforced). Defaults to false for backwards compatibility.
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

    /// @dev Reserved storage gap for future upgrades. Consumed 6 slots for C43:
    ///      requiresAttestedResume, certifiedAttestor, resumeAttestationThreshold,
    ///      resumeAttestationCount, tripGeneration, _hasAttestedResume. 44 remain.
    uint256[44] private __gap;

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

    /// @notice Opt a breaker type into attested-resume (cooldown floor only; no auto-reset).
    /// @dev Off by default. Existing consumers keep wall-clock auto-reset semantics
    ///      unless explicitly opted in.
    function setAttestedResumeRequired(bytes32 breakerType, bool required) external onlyOwner {
        requiresAttestedResume[breakerType] = required;
        emit AttestedResumeRequirementSet(breakerType, required);
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
            // Opted-in breakers stay tripped past cooldown until `attestResume` clears.
            if (requiresAttestedResume[breakerType]) {
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
            if (
                block.timestamp >= state.trippedAt + config.cooldownPeriod &&
                !requiresAttestedResume[breakerType]
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
