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

    // ============ Events ============

    event GlobalPauseChanged(bool paused, address indexed by);
    event FunctionPauseChanged(bytes4 indexed selector, bool paused, address indexed by);
    event GuardianUpdated(address indexed guardian, bool status);
    event BreakerConfigured(bytes32 indexed breakerType, uint256 threshold, uint256 cooldown);
    event BreakerTripped(bytes32 indexed breakerType, uint256 value, uint256 threshold);
    event BreakerReset(bytes32 indexed breakerType, address indexed by);
    event AnomalyDetected(bytes32 indexed anomalyType, uint256 value, string description);

    // ============ Errors ============

    error GloballyPaused();
    error FunctionPaused(bytes4 selector);
    error BreakerTripped(bytes32 breakerType);
    error NotGuardian();
    error CooldownActive();

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
    function configureBreaker(
        bytes32 breakerType,
        uint256 threshold,
        uint256 cooldownPeriod,
        uint256 windowDuration
    ) external onlyOwner {
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
    function disableBreaker(bytes32 breakerType) external onlyOwner {
        breakerConfigs[breakerType].enabled = false;
    }

    // ============ Internal Functions ============

    /**
     * @notice Check if breaker is tripped
     */
    function _checkBreaker(bytes32 breakerType) internal view {
        BreakerState storage state = breakerStates[breakerType];
        BreakerConfig storage config = breakerConfigs[breakerType];

        if (!config.enabled) return;

        if (state.tripped) {
            // Check if cooldown has passed
            if (block.timestamp < state.trippedAt + config.cooldownPeriod) {
                revert BreakerTripped(breakerType);
            }
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
        if (state.tripped) return true; // Already tripped

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
