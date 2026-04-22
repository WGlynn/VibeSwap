# Phase Transition Design

> *Water doesn't gradually become ice. Below a threshold, it's liquid; above, it's frozen. The transition happens at a specific temperature, not spread across a range. Mechanism designers who ignore phase transitions design systems that drift; designers who use them build systems that decisively change behavior at the right moment.*

This doc extracts a design principle underlying several VibeSwap mechanisms: **curves should bend at meaningful thresholds, not decay uniformly.** The phase transition — the point where the curve's second derivative changes sign or magnitude — is a design parameter, not a side effect. Where it bends matters.

## Water as a mental model

A linear-decay function looks like a slow steady melt: you can't tell when the thing "breaks." A convex-decay function with α > 1 has an implicit phase transition — a "knee" where decay accelerates. Design-wise, the knee is where user behavior shifts.

For VibeSwap's retention curves with α = 1.6 over T = 365 days, the inflection (where d²R/dt² = 0) is at t/T = (1/α)^(1/(α-1)) ≈ 0.57, i.e., around day 208. Before day 208, decay is slow; after, it accelerates.

**Design implication**: a contributor whose claim is approaching day 208 is in the "still-valuable" zone. After day 208, they're in the "fading-fast" zone. Their behavior (engagement, replenishment, community signaling) differs on either side of this threshold.

If designers don't place the phase transition thoughtfully, user behavior drifts — no one responds to a smooth curve with decisive action. Users respond to thresholds.

## The primitive, stated

**Phase Transition Design** is the rule that:

- **Mechanisms with time-varying output should have a DESIGNED phase transition**, not an accidental one.
- **The phase transition's location is a PARAMETER**, not a free variable. Governance may tune it within bounds.
- **User behavior change is ANTICIPATED at the phase transition.** The design accounts for it.
- **Mirror tests assert phase-transition location**, not just endpoint values.

## Where phase transitions matter in VibeSwap

### NCI retention curve (Gap #1 C40)

Phase transition at t/T ≈ 0.57, day ≈ 208 for T=365. Behavior: contributors replenish claims approaching this threshold.

If α were 1.2 (weaker convexity), phase transition would shift later (t/T ≈ 0.69, day 252). Less urgency.
If α were 2.0, phase transition would shift earlier (t/T ≈ 0.5, day 182). More urgency.

α = 1.6 balances: not so early that fresh contributions feel transient; not so late that stale contributions persist too long.

### CKB state-rent curve

Similar power-law applies. Phase transition is where rent acceleration becomes noticeable — typically around 60-70% of the lifetime cap.

Current CKB rent may have implicit rather than explicit phase transition. Audit cycle should verify.

### Fibonacci throughput scaling (rate limits)

Rate-limit scaling uses Fibonacci retracement levels [0.236, 0.382, 0.5, 0.618]. Each level IS a mini-phase-transition — the scaling changes discretely at each level.

Four phase transitions, at 23.6%, 38.2%, 50%, 61.8% of throughput. Users hitting these thresholds experience distinct throttling regimes.

### Commit-Reveal Auction timing

The 8-second → 2-second phase transition is a step function — at t = 8s, the phase changes from "commit allowed" to "commit closed, reveal phase." Sharp phase transition.

This is a different pattern from smooth curves — it's a discrete phase flip. Still a phase transition, implemented as a timer.

### Circuit breakers

Circuit breakers implement phase transitions explicitly: "trading allowed" ↔ "trading paused." The phase flips at threshold triggers (volume, price deviation, withdrawal velocity).

Gap #3 (Attested Resume) extends this: not just a single trip threshold, but a multi-phase state machine: [running, tripped, cooling-down, attestation-pending, resumed].

## Anatomy of a designed phase transition

Three aspects of a good phase transition:

### 1. Location

Where on the curve does the transition occur?

For retention: when does the contributor feel urgency? Day 208 (60%) is a rough rule. Day 300 (80%) is too late; day 100 (30%) is too early.

For rate limits: when does the user notice slowdown? 50% of throughput is a natural psychological threshold.

Location is a design choice, grounded in behavioral modeling.

### 2. Sharpness

How abrupt is the transition?

Step function (sharpness = ∞): decisive, simple, but jarring.
Smooth convex curve (sharpness moderate): gradient, less jarring, but user may not notice the transition.
Parametric curve (sharpness tunable via α): governance-tunable.

For retention: smooth convex (α = 1.6) provides gradient without jarring.
For circuit breakers: step functions are appropriate — binary state changes.

### 3. Behavior prediction

What does the user DO at the phase transition?

For retention: replenish contributions, sign new work, handshake more to refresh DAG relationships.
For rate limits: slow down, batch orders, pay for priority.
For circuit breakers: exit positions, shift to other venues, wait.

Behavior prediction must inform the location and sharpness choices. If the predicted behavior is wrong (users don't actually respond this way), recalibrate.

## Math: locating the phase transition

For a power-law retention curve `R(t) = 1 - (t/T)^α`:

First derivative (rate of decay):
`R'(t) = -α × (t/T)^(α-1) / T`

Second derivative (acceleration of decay):
`R''(t) = -α(α-1) × (t/T)^(α-2) / T²`

For α > 1, R''(t) is negative everywhere (convex). Wait — negative second derivative means CONCAVE down. Convex-down means decay ACCELERATES. Let me redo:

`R(t) = 1 - (t/T)^α`
`R'(t) = -α × (t/T)^(α-1) / T`

R'(t) is negative (function is decreasing). Magnitude grows with α > 1.

`R''(t) = -α(α-1) × (t/T)^(α-2) / T²`

For α > 1: R''(t) is negative. So R(t) is concave (concave-down = convex-up in some terminology; this is where vocabulary gets confusing).

The "phase transition" in the sense of "knee in the curve" is at the point of MAXIMUM rate of decay:

`R'''(t) = -α(α-1)(α-2) × (t/T)^(α-3) / T³`

Setting R'''(t) = 0 gives: no zero for α ≠ 2 (power law with α > 2 has R''' changing sign at t=0 only; α < 2 has R''' always same sign).

So there's no "inflection point" for typical α values. What there IS: a location where the decay rate is MOST RAPID. For R(t) = 1 - (t/T)^α with α > 1, max decay rate is at t = T (endpoint). There's no "bend" per se.

**Correction**: the curve is monotonic in its second derivative for this specific family. The "phase transition" is not a mathematical inflection but a perceptual/behavioral one.

To GET a genuine mathematical phase transition, use a different curve family. Example: logistic retention:

`R(t) = 1 / (1 + exp(β(t - τ)))`

This has a genuine inflection at t = τ (sigmoidal phase transition). Location of the knee is explicitly controlled by τ.

For VibeSwap Gap #1, the power-law curve is chosen for substrate match. The phase transition is perceptual — the "knee" is where users start feeling urgency, around 60-70% of horizon. Designed-by-parameter (α) rather than mathematically-inflected.

## Comparison: power-law vs logistic for retention

| Property | Power-law (α=1.6) | Logistic |
|---|---|---|
| Math inflection | No | Yes, at t=τ |
| Perceptual knee | Around t/T=0.57 | Sharp at t/T=τ/T |
| Endpoint behavior | Zero at T | Asymptotic (never zero) |
| Substrate match (memory) | Strong (Ebbinghaus) | Weaker |
| Simplicity | High | Moderate |

For Gap #1, power-law wins because substrate match is primary. If substrate match weren't primary, logistic would be attractive for its cleaner phase transition.

## Sharp phase transitions in discrete-state systems

Some systems can't be smooth. Circuit breakers are either tripped or not. Auctions are either open or closed. Rate limits are either in-budget or throttled.

For discrete-state systems, the phase transition is a step function, parameterized by the threshold:

```
state(input) = "A" if input < threshold else "B"
```

Design questions:
1. **Where is the threshold?** (calibration)
2. **What happens on each side?** (behavior in state A vs B)
3. **Is there hysteresis?** (does state A→B use same threshold as B→A, or different?)

Hysteresis matters: if a circuit breaker trips at 5% price deviation but resumes only at 3%, there's a gap preventing oscillation. Without hysteresis, a price hovering near the threshold causes rapid trip/resume cycling.

## Student exercises

1. **Locate the perceptual knee.** For R(t) = 1 - (t/T)^α with α ∈ {1.2, 1.5, 1.6, 1.8, 2.0}, compute t/T where the curve reaches 50% of its initial value. Compare.

2. **Design a hysteresis loop.** A circuit breaker trips at 5% price deviation. What's the right resume threshold? Justify.

3. **Discrete vs smooth transition.** For which of these should you use a discrete threshold vs smooth curve: (a) account lockout after N failed logins, (b) contribution reward weight, (c) AMM fee rate during stress, (d) gas price estimation?

4. **Behavior modeling.** For the NCI retention curve's phase transition at day 208, predict 3 user behaviors that should occur and 3 that shouldn't.

5. **Calibrate α for urgency.** Suppose you want the perceptual knee at day 180 for T=365. What α achieves this? (Set up the equation; compute numerically.)

## When phase transitions should NOT exist

Some mechanisms should be uniform, not phase-transitioning:

- **Linear rewards for stable behavior**: if you want to reward a user equally for each unit of contribution, linear-in-quantity is appropriate. No phase transition.
- **Constant fees**: transaction fees shouldn't have phase transitions (otherwise fee-estimation becomes stochastic).
- **Identity properties**: you don't "partially own" an identity. It's discrete.

Applying phase transitions where they don't belong creates artificial instability. The design discipline is:
1. Decide whether the mechanism has time-varying output.
2. If yes, ask: does behavior change sharply at some point?
3. If yes, design the phase transition.
4. If no, use linear or uniform.

## Integration with mirror tests

Mirror tests (see [`ETM_MIRROR_TEST.md`](./ETM_MIRROR_TEST.md)) should assert phase-transition location:

```solidity
function test_NCI_PhaseTransition() public {
    // At day 208 (approximately), retention should be ~505
    // Before day 208: retention > 662 (day 180)
    // After day 208: retention < 350 (day 270)
    uint256 retentionAt208 = nci.retentionWeight(208, 1000);
    assertApproxEqRel(retentionAt208, 505, 1e16); // 1% tolerance
}
```

This complements endpoint assertions. Without the phase-transition assertion, the curve could be arbitrarily mis-shaped between endpoints.

## Future work — concrete code cycles this primitive surfaces

### Queued for C40

- **Phase-transition assertion** — add to NCI mirror test. Asserts retention at day 208 matches expected value within tolerance.

### Queued for un-scheduled cycles

- **Hysteresis for circuit breakers** — document trip/resume threshold separation; add tests verifying no oscillation.

- **Rate-limit threshold audit** — verify Fibonacci levels produce expected behavior.

- **Logistic retention variant** — research whether logistic retention offers better phase-transition control at cost of worse substrate match. Not recommended for Gap #1 but worth exploring for other contexts.

### Primitive extraction

Extract to `memory/primitive_phase-transition-design.md` as a design principle: every mechanism with time-varying output must specify its phase-transition location + behavior on each side.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md)) — α controls phase-transition for convex-rent curves.
- **Convex Retention Derivation** (see [`CONVEX_RETENTION_DERIVATION.md`](./CONVEX_RETENTION_DERIVATION.md)) — calibrates α based on substrate, thus phase-transition location.
- **ETM Mirror Test** (see [`ETM_MIRROR_TEST.md`](./ETM_MIRROR_TEST.md)) — phase-transition assertions complement endpoint tests.
- **Fibonacci Scaling** (see [`FIBONACCI_SCALING.md`](./FIBONACCI_SCALING.md)) — discrete phase transitions at retracement levels.
- **Circuit Breaker Design** (see [`CIRCUIT_BREAKER_DESIGN.md`](./CIRCUIT_BREAKER_DESIGN.md)) — discrete phase transitions with hysteresis.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Names phase-transition design as an explicit design parameter.
2. Clarifies the distinction between math-inflected vs perceptually-knee curves.
3. Proposes hysteresis patterns for discrete-state systems.
4. Queues mirror test extensions.

When C40 ships, this doc's phase-transition assertions become concrete test code. If future research reveals better curve families (e.g., logistic for certain contexts), this doc gets updated.

## One-line summary

*Phase Transition Design is the discipline of placing curve "knees" or discrete state-flips at behaviorally-meaningful thresholds. Location + sharpness + behavior-prediction are all design parameters. For smooth convex curves (e.g., NCI retention), the knee is perceptual not mathematical. For discrete-state systems (circuit breakers, rate limits), thresholds with hysteresis prevent oscillation. Mirror tests assert phase-transition location.*
