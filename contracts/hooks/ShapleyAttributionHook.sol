// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVibeHook.sol";
import "../libraries/PairwiseFairness.sol";

/**
 * @title ShapleyAttributionHook
 * @notice An afterSwap hook that turns the PairwiseFairness axiom verifier into an
 *         on-chain NON-ADDITIVITY ROUTER for value attribution.
 * @dev Part of VSOS (VibeSwap Operating System) hooks layer. Attached to pools via
 *      VibeHookRegistry alongside any other IVibeHook.
 *
 *      MOTIVATION
 *      ----------
 *      Distributing value (MEV attribution, LP rewards) exactly requires Shapley values,
 *      which are expensive. A cheap additive approximation (pro-rata / linear coefficients)
 *      captures the additive mass but is structurally blind to the higher-order (synergistic)
 *      dividends that live on coalitions of size two and up. Empirically that non-additive
 *      tail is a material minority of events but carries the coordination value, so it cannot
 *      simply be approximated away.
 *
 *      The router answer is: run the cheap additive allocation on-chain, DETECT when a
 *      work-unit is non-additive, and ESCALATE only those units to an exact off-chain
 *      Shapley computation. The detection must key on structure, not on trade size.
 *
 *      THE MECHANISM (verifier becomes router)
 *      ---------------------------------------
 *      PairwiseFairness.verifyAllPairs checks Pairwise Proportionality: for an additive
 *      rule, every pair must satisfy phi_i / phi_j == w_i / w_j. Proportionality is the
 *      SIGNATURE of additivity. So a VIOLATION of pairwise proportionality by the additive
 *      allocation is itself the cheap on-chain signal that the work-unit is non-additive:
 *
 *        - proportionality holds within tolerance  -> additive fast path, settle on-chain.
 *        - proportionality violated beyond tolerance -> flag the unit, escalate to exact
 *          off-chain Shapley, settle only after the exact allocation is submitted back.
 *
 *      routingTolerance is the sensitivity knob. Sweeping it traces the fraction of units
 *      that escalate at each precision target (the routing budget); pick the tolerance at
 *      the knee of that curve.
 *
 *      THE ESCALATED PATH VERIFIES EFFICIENCY + NULL PLAYER, NOT PROPORTIONALITY.
 *      An exact Shapley allocation for a genuinely non-additive game is SUPPOSED to violate
 *      pairwise proportionality (that is why it was escalated). Re-imposing proportionality
 *      on the exact result would regress it back toward the additive mean, defeating the
 *      point. So submitExactAllocation checks the axioms that must still hold: the payout
 *      sums to the distributable value (Efficiency) and zero-weight players get zero
 *      (Null Player).
 *
 *      The hook never moves funds. afterSwap returns an encoded routing decision that the
 *      settlement path reads; submitExactAllocation records the resolved allocation for a
 *      previously escalated unit. Both are inspectable on-chain.
 */
contract ShapleyAttributionHook is IVibeHook, Ownable {
    // ============ Constants ============

    uint8 private constant FLAG_AFTER_SWAP = 32; // bit 5 (matches VibeHookRegistry / DynamicFeeHook)

    // ============ Config ============

    /// @notice Max pairwise-proportionality deviation tolerated before a unit is deemed
    ///         non-additive and escalated. Per PairwiseFairness, cross-multiplication
    ///         amplifies rounding by max(weight), so a value on the order of the total
    ///         weight is the neutral setting; lower = more escalation, higher = less.
    uint256 public routingTolerance;

    /// @notice The only address allowed to submit exact-Shapley results for escalated units
    ///         (the off-chain attributor / solver).
    address public attributor;

    // ============ State ============

    struct Escalation {
        bool pending;
        uint256 worstDeviation;
        uint256 worstPairA;
        uint256 worstPairB;
    }

    /// @notice workUnitSig => escalation record (set when the additive path fails routing).
    mapping(bytes32 => Escalation) public escalations;

    /// @notice workUnitSig => true once the additive fast path settled it on-chain.
    mapping(bytes32 => bool) public settledAdditive;

    /// @notice workUnitSig => true once an exact allocation was submitted for an escalated unit.
    mapping(bytes32 => bool) public resolvedExact;

    // ============ Events ============

    event AdditiveSettled(bytes32 indexed poolId, bytes32 indexed workUnitSig, uint256 worstDeviation);
    event EscalationRequired(
        bytes32 indexed poolId,
        bytes32 indexed workUnitSig,
        uint256 worstDeviation,
        uint256 worstPairA,
        uint256 worstPairB
    );
    event ExactAllocationSubmitted(bytes32 indexed poolId, bytes32 indexed workUnitSig, uint256 totalValue);
    event RoutingToleranceUpdated(uint256 previous, uint256 current);
    event AttributorUpdated(address previous, address current);

    // ============ Errors ============

    error LengthMismatch();
    error EmptyWorkUnit();
    error NotAttributor();
    error NotEscalated();
    error AlreadyResolved();
    error ExactAllocationInefficient();
    error ExactAllocationViolatesNullPlayer();

    // ============ Constructor ============

    constructor(uint256 routingTolerance_, address attributor_) Ownable(msg.sender) {
        routingTolerance = routingTolerance_;
        attributor = attributor_ == address(0) ? msg.sender : attributor_;
    }

    // ============ IVibeHook Implementation ============

    function getHookFlags() external pure override returns (uint8) {
        return FLAG_AFTER_SWAP;
    }

    function beforeCommit(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function afterCommit(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function beforeSettle(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function afterSettle(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    function beforeSwap(bytes32, bytes calldata) external pure override returns (bytes memory) {
        return "";
    }

    /**
     * @notice Route a work-unit: additive fast path vs escalate to exact Shapley.
     * @param poolId The pool the work-unit belongs to.
     * @param data abi.encode(bytes32 workUnitSig, uint256[] additiveRewards, uint256[] weights)
     *        where additiveRewards is the cheap additive/pro-rata allocation proposed for the
     *        unit and weights is each participant's weighted contribution.
     * @return abi.encode(bool escalate, uint256 worstDeviation). escalate=false means the
     *         additive allocation was proportional (settle on-chain); escalate=true means the
     *         unit is non-additive and awaits an exact allocation via submitExactAllocation.
     */
    function afterSwap(bytes32 poolId, bytes calldata data) external override returns (bytes memory) {
        (bytes32 workUnitSig, uint256[] memory additiveRewards, uint256[] memory weights) =
            abi.decode(data, (bytes32, uint256[], uint256[]));
        return _route(poolId, workUnitSig, additiveRewards, weights);
    }

    // ============ Router ============

    function _route(
        bytes32 poolId,
        bytes32 workUnitSig,
        uint256[] memory additiveRewards,
        uint256[] memory weights
    ) internal returns (bytes memory) {
        if (additiveRewards.length != weights.length) revert LengthMismatch();
        if (additiveRewards.length == 0) revert EmptyWorkUnit();

        (bool allFair, uint256 worstDeviation, uint256 worstPairA, uint256 worstPairB) =
            PairwiseFairness.verifyAllPairs(additiveRewards, weights, routingTolerance);

        if (allFair) {
            // Additive allocation is proportional -> no higher-order dividend detected.
            settledAdditive[workUnitSig] = true;
            emit AdditiveSettled(poolId, workUnitSig, worstDeviation);
            return abi.encode(false, worstDeviation);
        }

        // Proportionality broken -> non-additivity detected -> escalate this unit only.
        escalations[workUnitSig] = Escalation({
            pending: true,
            worstDeviation: worstDeviation,
            worstPairA: worstPairA,
            worstPairB: worstPairB
        });
        emit EscalationRequired(poolId, workUnitSig, worstDeviation, worstPairA, worstPairB);
        return abi.encode(true, worstDeviation);
    }

    /**
     * @notice Preview the routing decision for a candidate additive allocation without
     *         mutating state. Lets a caller decide off-chain whether to bother computing
     *         exact Shapley before submitting the unit.
     */
    function previewRoute(uint256[] calldata additiveRewards, uint256[] calldata weights)
        external
        view
        returns (bool escalate, uint256 worstDeviation, uint256 worstPairA, uint256 worstPairB)
    {
        if (additiveRewards.length != weights.length) revert LengthMismatch();
        if (additiveRewards.length == 0) revert EmptyWorkUnit();
        bool allFair;
        (allFair, worstDeviation, worstPairA, worstPairB) =
            PairwiseFairness.verifyAllPairs(additiveRewards, weights, routingTolerance);
        escalate = !allFair;
    }

    // ============ Exact-Shapley Submission (escalated path) ============

    /**
     * @notice Record the exact-Shapley allocation for a previously escalated work-unit.
     * @dev Verifies the axioms that MUST still hold for a non-additive allocation:
     *      Efficiency (sum of payouts == distributable value) and Null Player (zero weight
     *      => zero reward). Pairwise proportionality is intentionally NOT checked here: an
     *      exact allocation for a non-additive game is expected to break it.
     * @param poolId The pool the unit belongs to.
     * @param workUnitSig The escalated unit's signature.
     * @param exactRewards The exact Shapley allocation.
     * @param weights The participants' weighted contributions (same order as exactRewards).
     * @param totalValue The distributable value the allocation must sum to.
     * @param efficiencyTolerance Rounding tolerance for the efficiency check (typically the
     *        participant count).
     */
    function submitExactAllocation(
        bytes32 poolId,
        bytes32 workUnitSig,
        uint256[] calldata exactRewards,
        uint256[] calldata weights,
        uint256 totalValue,
        uint256 efficiencyTolerance
    ) external {
        if (msg.sender != attributor) revert NotAttributor();
        if (!escalations[workUnitSig].pending) revert NotEscalated();
        if (resolvedExact[workUnitSig]) revert AlreadyResolved();
        if (exactRewards.length != weights.length) revert LengthMismatch();
        if (exactRewards.length == 0) revert EmptyWorkUnit();

        // Efficiency: allocation sums to the distributable value.
        PairwiseFairness.FairnessResult memory eff =
            PairwiseFairness.verifyEfficiency(exactRewards, totalValue, efficiencyTolerance);
        if (!eff.fair) revert ExactAllocationInefficient();

        // Null Player: zero-weight participants receive nothing.
        for (uint256 i = 0; i < exactRewards.length; i++) {
            if (!PairwiseFairness.verifyNullPlayer(exactRewards[i], weights[i])) {
                revert ExactAllocationViolatesNullPlayer();
            }
        }

        escalations[workUnitSig].pending = false;
        resolvedExact[workUnitSig] = true;
        emit ExactAllocationSubmitted(poolId, workUnitSig, totalValue);
    }

    // ============ Views ============

    function isEscalated(bytes32 workUnitSig) external view returns (bool) {
        return escalations[workUnitSig].pending;
    }

    // ============ Configuration ============

    function setRoutingTolerance(uint256 routingTolerance_) external onlyOwner {
        uint256 prev = routingTolerance;
        routingTolerance = routingTolerance_;
        emit RoutingToleranceUpdated(prev, routingTolerance_);
    }

    function setAttributor(address attributor_) external onlyOwner {
        address prev = attributor;
        attributor = attributor_;
        emit AttributorUpdated(prev, attributor_);
    }
}
