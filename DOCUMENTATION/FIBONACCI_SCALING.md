# Fibonacci Scaling

**Status**: Security primitive. Live in `contracts/libraries/FibonacciScaling.sol`.
**Instance of**: [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md).

---

## What it does

Per-user per-pool throughput damping that uses Fibonacci retracement levels as damping thresholds, over a 1-hour rolling window. Beyond a saturation point, the user enters a cooldown of `window × 1/φ` ≈ 0.618 × window.

## Why Fibonacci and not linear

Throughput attack surfaces on DEXes have a common profile:

- Normal use is bursty (a few trades per hour per wallet).
- Attack use is sustained and saturated (dozens of trades per hour to exploit an oracle skew or drain a pool).
- The transition between normal-burst and attack-sustained happens across ~log-scale throughput increments, not linear increments.

Linear rate limiters (N trades per window) pick one threshold and apply it flatly. Below the threshold, the limiter does nothing. Above it, the user is blocked. The transition is a cliff.

Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%) apply graduated damping across the range. Below 23.6% of the saturation value, no damping. Between 23.6% and 38.2%, mild. Between 38.2% and 50%, moderate. Between 50% and 61.8%, strong. Above 61.8%, saturated → cooldown.

This shape matches the observed attack-vs-normal-use distribution: normal users occupy the 0-23.6% range; attackers push toward 61.8%+. Damping kicks in where attacker behavior is concentrated, without restricting normal use.

## The math

```
damping(frac) =
    if frac < 0.236:      0              (no damping)
    elif frac < 0.382:    0.1 * (frac - 0.236) / (0.382 - 0.236)
    elif frac < 0.500:    0.25 + 0.25 * (frac - 0.382) / (0.500 - 0.382)
    elif frac < 0.618:    0.50 + 0.25 * (frac - 0.500) / (0.618 - 0.500)
    else:                 1.0 (saturated — cooldown triggered)
```

Saturation triggers a cooldown of `window × 1/φ = 0.618 × window`. For a 1-hour window, that's ~37 minutes of cooldown.

Why `1/φ` and not a round number? Because the cooldown period should match the natural attention-recovery rate of the substrate. The golden-ratio conjugate appears in recovery rates across biological, cognitive, and social systems; choosing it here matches the substrate geometry.

## Why 1-hour window

Attacks on AMM pools typically require several minutes of sustained activity to manifest (arbitrage against stale oracle, drain across slippage bounds). A 1-minute window is too short — normal users can hit it via genuine burst behavior. A 24-hour window is too long — attackers can ramp over 12 hours and hide the attack in "normal" daily volume.

1 hour is within the natural human attention-session time-scale (around 50-90 minutes per focused-activity block in attention research). It's also within one round-trip for most off-chain decision loops (oracle updates, governance proposals). Sized to the substrate.

## The Fibonacci-retracement levels as substrate constants

The 23.6%, 38.2%, 50%, 61.8% levels come from Elliott wave theory / Fibonacci retracement in trading — they're the levels where market reversal probability peaks. For a DEX-rate-limiter, using these levels means:

- The damping thresholds align with where market participants naturally pause and re-evaluate.
- Users who hit a damping zone experience friction at the same point they'd naturally throttle anyway.
- The rate limiter feels less like a cap and more like a natural resistance curve.

This is the [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) principle applied: market behavior has a Fibonacci shape; the limiter has a Fibonacci shape.

## Per-user per-pool isolation

The damping is scoped per `(user, pool)` pair. This prevents:

- A saturated user blocking other users from the same pool.
- A user being saturated across pools when they've only been active in one.
- Cross-pool throughput aggregation that masks attack behavior in a single pool.

Downsides: a sophisticated attacker with many wallets can Sybil-attack across wallets. Mitigated via:

- [`OperatorCellRegistry`](../contracts/identity/../consensus/OperatorCellRegistry.sol) bonds for operator identities.
- Per-wallet aggregate throughput caps (secondary limiter).
- Sybil-resistant identity via [`SoulboundIdentity`](../contracts/identity/SoulboundIdentity.sol).

## When it fires in the stack

The rate limiter is consulted by:
- `VibeSwapCore.commitOrder` — before accepting a commitment.
- `VibeAMM._executeSwap` — before applying a swap.
- `CrossChainRouter.sendMessage` — before dispatching a cross-chain tx.

Each consults the user's current `(user, pool)` fraction-of-saturation and either passes (damping applied multiplicatively to tx size) or reverts (user is in cooldown).

## Tuning

The four retracement levels are constants in `FibonacciScaling.sol`. Changing them requires contract upgrade + [Augmented Governance](./AUGMENTED_GOVERNANCE.md) process. The window size (1 hour) and cooldown divisor (1/φ) are the same — constants, not governance parameters.

Tuning these would only make sense if the substrate geometry changed (e.g., new use cases with different natural time-scales). Don't tune them for convenience — if it feels like rate-limiter friction, that IS the mechanism working.

## Relationship

- Instance of [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) — matches the substrate's fractal/power-law geometry.
- Sibling of [Circuit Breaker Design](./CIRCUIT_BREAKER_DESIGN.md) — both are security primitives, but circuit breakers trip on system-wide signals (volume, price, withdrawal) whereas Fibonacci scaling is per-user per-pool.
- Anti-pattern for: linear rate limiters. See [First-Available Trap](../memory/primitive_first-available-trap.md) — Solidity has off-the-shelf rate limiters; they're all linear; they all mis-fit the substrate.

## One-line summary

*Per-user per-pool throughput damping using Fibonacci retracement levels + golden-ratio cooldown — substrate-geometry-matched security that attackers hit harder than normal users.*
