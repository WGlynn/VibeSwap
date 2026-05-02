# Observability Before Tuning

**Status**: shipped (cycle C46-class — Strengthen #3)
**First instance**: `ContributionDAG` handshake-cooldown observability + `tryAddVouch` non-reverting twin
**Convergence with**: `revert-wipes-counter-non-reverting-twin.md`, `pair-keyed-historical-anchor.md`

## The pattern

This is a **process** primitive, not a code primitive. A protocol parameter — a cooldown window, a rate-limit threshold, a multiplier, a fee bps — cannot be tuned with confidence until it has been *measured*. The naive shape skips measurement: someone proposes "we should change X to Y because it feels too low/high," ships the PR, and the protocol's calibration becomes a function of vibes. The observability-before-tuning shape inverts the order:

1. **Ship the audit metric first.** Counters, events, view functions that quantify how often the parameter is the binding constraint.
2. **Wait for data.** Run for a measurement window (days / weeks / months — depends on activity volume).
3. **Read the data.** Compute hit-rate, distribution, percentiles, whatever the metric is structured to expose.
4. **Then propose a tuning change**, citing the data.

No metric → no tuning PR. This is the rule. "We should reduce the cooldown" without "the cooldown is hit X% of the time" is not a tuning proposal; it is a guess.

The metric ships in **its own PR**, separately from any tuning change, so the act of measuring cannot be conflated with the act of changing. Tuning then arrives in a follow-up PR that cites measurements taken at the prior version.

## Why it works

A parameter that gates behavior is doing one of three jobs:

- **Effective gate.** Hit-rate is high; the parameter is shaping behavior. Tuning here is meaningful — you can dial the gate to be looser or tighter.
- **Vacuous gate.** Hit-rate is near zero; the parameter is decorative. Tuning is ceremony — no behavior changes regardless of value.
- **Pathological gate.** Hit-rate is so high that legitimate users are blocked at the same rate as adversaries. The parameter has the wrong *shape*, not the wrong *value*. Tuning won't fix it; redesign will.

Without observability, you cannot tell which of the three regimes you are in. A "5% feels too restrictive" intuition might be perfectly correct (effective gate, dial down), correct-by-accident (vacuous gate, change does nothing), or actively wrong (pathological gate, change papers over the real bug). Observability collapses the three into a single decision-tree.

The cost of shipping the metric is low: a counter, an event, sometimes a view. The cost of tuning blind is high — every parameter change is a potential security regression that can only be caught in incident response.

## Concrete example

From `contracts/identity/ContributionDAG.sol`. The 1-day handshake cooldown was identified as a candidate for tuning. Before changing the value, the protocol shipped:

```solidity
// ============ Strengthen #3: Handshake Cooldown Observability ============
//
// The 1-day handshake cooldown models attention-rarity. To audit whether
// the cooldown is calibrated correctly we need on-chain metrics:
//   - totalHandshakeAttempts: every (addVouch | tryAddVouch) call that
//     reaches the cooldown gate (i.e., post-identity, post-self-check,
//     post-vouch-limit). Distinct from successes because some get gated.
//   - totalHandshakeSuccesses: every NEW handshake confirmation
//     (a Handshake row appended to _handshakes).
//   - totalHandshakesBlockedByCooldown: every cooldown-gated attempt
//     observed via tryAddVouch (the non-reverting entry point — reverting
//     entry points cannot increment counters because reverts wipe state).
//   - lastHandshakeAt[pairKey]: O(1) per-pair last-handshake timestamp,
//     surfaced for off-chain hit-rate analytics.
//
// Hit-rate audit: blocks / attempts. If the hit-rate is high the cooldown
// is too coarse; if near-zero it isn't doing meaningful gating. Data first,
// tuning second — see ETM_BUILD_ROADMAP Strengthen #3.
event HandshakeBlockedByCooldown(
    address indexed from,
    address indexed to,
    uint256 remaining
);

uint256 public totalHandshakeAttempts;
uint256 public totalHandshakeSuccesses;
uint256 public totalHandshakesBlockedByCooldown;
mapping(bytes32 => uint256) public lastHandshakeAt;       // pair-keyed
```

The audit metric is the *primary deliverable* of the cycle. The cooldown value (`HANDSHAKE_COOLDOWN = 1 days`) is unchanged. A future PR — based on the measurements this cycle enables — may propose to tune it.

The metric ships with a non-reverting twin entry-point (`tryAddVouch`) because the existing reverting entry (`addVouch`) cannot increment a counter — see [`revert-wipes-counter-non-reverting-twin.md`](./revert-wipes-counter-non-reverting-twin.md). This is the typical EVM-specific fix-up that observability work generates.

## When to use

- Any proposed tuning change to a security-relevant parameter (cooldowns, thresholds, multipliers, fees).
- Any new gate / rate-limit / circuit-breaker that ships without a clear hit-rate baseline.
- Any "we should change X to Y" conversation that has been ongoing for more than one cycle without measurement.

## When NOT to use

- Constants that are mathematically derived (e.g., `BPS = 10000`, golden-ratio-derived multipliers). The "value" is determined by the math, not by observation.
- Pre-launch tuning of a brand-new parameter where no production data exists. Use simulation / backtest data instead, but ship the on-chain metric concurrently so post-launch tuning can use real data.
- Emergency parameter changes during active incident response. Ship the metric in the post-incident PR, not the hotfix.

## Related primitives

- [`revert-wipes-counter-non-reverting-twin.md`](./revert-wipes-counter-non-reverting-twin.md) — the EVM-specific implementation pattern that observability-before-tuning routinely needs: a non-reverting twin entry-point so cooldown-blocked attempts increment a counter.
- [`pair-keyed-historical-anchor.md`](./pair-keyed-historical-anchor.md) — companion data structure that surfaced from the same cycle: `lastHandshakeAt[pairKey]` for per-pair analytics.
