// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../libraries/ILMeasurement.sol";

/**
 * @title FeeController
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice PID-tuned fee controller that auto-adjusts swap fees based on measured impermanent loss
 * @dev The fee is not a parameter. It is a measurement.
 *
 *      Traditional DEXs set fees to compensate LPs for impermanent loss (IL).
 *      Uniswap uses 0.3% because that's roughly what LPs lose to arbitrage.
 *      But VibeSwap's batch auction eliminates most IL from toxic flow (MEV, frontrunning).
 *      So the fair fee is lower — but how much lower?
 *
 *      This contract answers that question by measuring actual IL and tuning the fee
 *      to match. The fee equals what LPs actually sacrifice, nothing more, nothing less.
 *
 *      Components:
 *        1. IL Measurement — actual impermanent loss per pool, computed from reserve changes
 *        2. EWMA Smoothing — exponentially weighted moving average to filter noise
 *        3. PID Controller — proportional-integral-derivative tuning for stable convergence
 *           P: current IL rate (fee tracks real cost)
 *           I: accumulated under/over-compensation (corrects drift)
 *           D: rate of IL change (anticipates volatility spikes)
 *        4. Bounds — floor (gas cost) and ceiling (safety cap)
 *
 *      Shapley fairness: the fee equals LPs' marginal cost of participation.
 *      A null player takes nothing. An LP bearing IL gets compensated exactly.
 *
 *      "Replace governance with physics."
 *
 *      DISINTERMEDIATION: Grade A target. Once tuned, this runs without human input.
 *      No committee picks fees. No governance vote on tiers. The math responds to reality.
 */
contract FeeController is Ownable {
    using ILMeasurement for uint256;

    // ============ Constants ============

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS_PRECISION = 10000;

    /// @notice Absolute minimum fee — covers gas/settlement cost (1 bps = 0.01%)
    uint256 public constant MIN_FEE_BPS = 1;

    /// @notice Absolute maximum fee — safety cap even in extreme volatility (50 bps = 0.5%)
    uint256 public constant MAX_FEE_BPS = 50;

    /// @notice Default fee before first measurement (5 bps = 0.05%)
    uint256 public constant DEFAULT_FEE_BPS = 5;

    // ============ PID Tuning Parameters ============

    /// @notice Proportional gain — how strongly fee responds to current IL
    /// @dev Higher Kp = faster response but more oscillation
    uint256 public kP = 5000; // 0.5 * PRECISION/10000 scaling

    /// @notice Integral gain — how strongly fee corrects accumulated error
    /// @dev Higher Ki = eliminates steady-state error but risks overshoot
    uint256 public kI = 500;  // 0.05 * PRECISION/10000 scaling

    /// @notice Derivative gain — how strongly fee anticipates IL changes
    /// @dev Higher Kd = smoother transitions but can amplify noise
    uint256 public kD = 1000; // 0.1 * PRECISION/10000 scaling

    /// @notice EWMA smoothing factor (alpha). Higher = more responsive to new data
    uint256 public alpha = PRECISION / 10; // 10% weight on new samples

    // ============ Per-Pool State ============

    struct PoolFeeState {
        // Current auto-tuned fee in BPS
        uint256 currentFeeBps;

        // IL measurement state
        uint256 smoothedIL;           // EWMA of IL measurements (BPS)
        uint256 previousIL;           // Last IL measurement (for derivative)
        int256 integralError;         // Accumulated error (can be negative)

        // Reserve snapshots for IL computation
        uint256 snapshotReserve0;
        uint256 snapshotReserve1;
        uint256 lastUpdateTimestamp;

        // Stats
        uint256 totalMeasurements;
        uint256 totalILAccumulated;   // Sum of all IL measurements (BPS)
        bool initialized;
    }

    mapping(bytes32 => PoolFeeState) public poolState;

    // ============ Events ============

    event FeeUpdated(
        bytes32 indexed poolId,
        uint256 oldFeeBps,
        uint256 newFeeBps,
        uint256 measuredILBps,
        uint256 smoothedILBps
    );
    event PoolInitialized(bytes32 indexed poolId, uint256 reserve0, uint256 reserve1);
    event PIDTuned(uint256 kP, uint256 kI, uint256 kD, uint256 alpha);
    event SnapshotTaken(bytes32 indexed poolId, uint256 reserve0, uint256 reserve1);

    // ============ Errors ============

    error PoolNotInitialized();
    error TooSoon();
    error InvalidPIDParams();

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Initialization ============

    /**
     * @notice Initialize fee tracking for a pool
     * @param poolId Pool identifier
     * @param reserve0 Current token0 reserves
     * @param reserve1 Current token1 reserves
     */
    function initializePool(
        bytes32 poolId,
        uint256 reserve0,
        uint256 reserve1
    ) external onlyOwner {
        PoolFeeState storage state = poolState[poolId];
        state.currentFeeBps = DEFAULT_FEE_BPS;
        state.snapshotReserve0 = reserve0;
        state.snapshotReserve1 = reserve1;
        state.lastUpdateTimestamp = block.timestamp;
        state.initialized = true;

        emit PoolInitialized(poolId, reserve0, reserve1);
    }

    // ============ Core: Measure IL and Update Fee ============

    /**
     * @notice Measure IL since last snapshot and auto-tune the fee
     * @dev Called after batch settlement or periodically by keepers.
     *      The cycle: snapshot reserves → trades happen → measure IL → update fee → new snapshot
     * @param poolId Pool identifier
     * @param currentReserve0 Current token0 reserves
     * @param currentReserve1 Current token1 reserves
     * @return newFeeBps The updated fee in basis points
     */
    function measureAndUpdate(
        bytes32 poolId,
        uint256 currentReserve0,
        uint256 currentReserve1
    ) external returns (uint256 newFeeBps) {
        PoolFeeState storage state = poolState[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        // Measure actual IL from reserve changes
        uint256 measuredIL = ILMeasurement.computeILFromReserves(
            state.snapshotReserve0,
            state.snapshotReserve1,
            currentReserve0,
            currentReserve1
        );

        // Update EWMA
        state.smoothedIL = ILMeasurement.updateEWMA(state.smoothedIL, measuredIL, alpha);

        // PID computation
        newFeeBps = _computePID(state, measuredIL);

        // Clamp to bounds
        if (newFeeBps < MIN_FEE_BPS) newFeeBps = MIN_FEE_BPS;
        if (newFeeBps > MAX_FEE_BPS) newFeeBps = MAX_FEE_BPS;

        // Update state
        uint256 oldFee = state.currentFeeBps;
        state.currentFeeBps = newFeeBps;
        state.previousIL = measuredIL;
        state.totalMeasurements++;
        state.totalILAccumulated += measuredIL;

        // Take new snapshot for next period
        state.snapshotReserve0 = currentReserve0;
        state.snapshotReserve1 = currentReserve1;
        state.lastUpdateTimestamp = block.timestamp;

        emit FeeUpdated(poolId, oldFee, newFeeBps, measuredIL, state.smoothedIL);

        return newFeeBps;
    }

    /**
     * @notice Take a reserve snapshot without updating fees
     * @dev Useful for resetting the measurement window (e.g., after liquidity events)
     */
    function takeSnapshot(
        bytes32 poolId,
        uint256 reserve0,
        uint256 reserve1
    ) external onlyOwner {
        PoolFeeState storage state = poolState[poolId];
        if (!state.initialized) revert PoolNotInitialized();

        state.snapshotReserve0 = reserve0;
        state.snapshotReserve1 = reserve1;
        state.lastUpdateTimestamp = block.timestamp;

        emit SnapshotTaken(poolId, reserve0, reserve1);
    }

    // ============ PID Computation ============

    /**
     * @notice Compute PID-tuned fee from IL measurement
     * @dev P = proportional to current smoothed IL (track the real cost)
     *      I = integral of error (correct accumulated under/over-compensation)
     *      D = derivative of IL change (anticipate volatility shifts)
     *
     *      Target: fee should equal smoothed IL. Error = smoothedIL - currentFee.
     *      When error > 0: fee is too low (LPs underpaid), increase.
     *      When error < 0: fee is too high (traders overpaying), decrease.
     */
    function _computePID(
        PoolFeeState storage state,
        uint256 measuredIL
    ) internal returns (uint256 feeBps) {
        // Error = what LPs lose - what they're compensated
        // Positive error = LPs are underpaid, fee should go up
        int256 error = int256(state.smoothedIL) - int256(state.currentFeeBps);

        // Proportional: respond to current error
        int256 pTerm = (int256(kP) * error) / int256(BPS_PRECISION);

        // Integral: accumulate error over time (with anti-windup clamping)
        state.integralError += error;
        // Anti-windup: clamp integral to prevent runaway accumulation
        int256 maxIntegral = int256(MAX_FEE_BPS * BPS_PRECISION);
        if (state.integralError > maxIntegral) state.integralError = maxIntegral;
        if (state.integralError < -maxIntegral) state.integralError = -maxIntegral;
        int256 iTerm = (int256(kI) * state.integralError) / int256(BPS_PRECISION);

        // Derivative: respond to rate of change in IL
        int256 derivative = int256(measuredIL) - int256(state.previousIL);
        int256 dTerm = (int256(kD) * derivative) / int256(BPS_PRECISION);

        // New fee = current fee + PID adjustment
        int256 adjustment = pTerm + iTerm + dTerm;
        int256 newFee = int256(state.currentFeeBps) + adjustment;

        // Floor at 0 before returning as uint (clamping happens in caller)
        if (newFee < 0) newFee = 0;

        return uint256(newFee);
    }

    // ============ Views ============

    /**
     * @notice Get the current auto-tuned fee for a pool
     * @param poolId Pool identifier
     * @return feeBps Current fee in basis points
     */
    function getFee(bytes32 poolId) external view returns (uint256 feeBps) {
        PoolFeeState storage state = poolState[poolId];
        if (!state.initialized) return DEFAULT_FEE_BPS;
        return state.currentFeeBps;
    }

    /**
     * @notice Get full fee state for a pool (for monitoring/dashboards)
     */
    function getPoolFeeState(bytes32 poolId) external view returns (
        uint256 currentFeeBps,
        uint256 smoothedIL,
        uint256 previousIL,
        int256 integralError,
        uint256 totalMeasurements,
        uint256 averageIL
    ) {
        PoolFeeState storage state = poolState[poolId];
        currentFeeBps = state.currentFeeBps;
        smoothedIL = state.smoothedIL;
        previousIL = state.previousIL;
        integralError = state.integralError;
        totalMeasurements = state.totalMeasurements;
        averageIL = state.totalMeasurements > 0
            ? state.totalILAccumulated / state.totalMeasurements
            : 0;
    }

    // ============ Configuration ============

    /**
     * @notice Tune PID parameters
     * @dev DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
     *      After sufficient data, PID params can be frozen (Grade A).
     *      The goal is to find params that converge for all pool types,
     *      then make them immutable.
     */
    function setPIDParams(
        uint256 _kP,
        uint256 _kI,
        uint256 _kD,
        uint256 _alpha
    ) external onlyOwner {
        if (_alpha > PRECISION) revert InvalidPIDParams();
        kP = _kP;
        kI = _kI;
        kD = _kD;
        alpha = _alpha;
        emit PIDTuned(_kP, _kI, _kD, _alpha);
    }
}
