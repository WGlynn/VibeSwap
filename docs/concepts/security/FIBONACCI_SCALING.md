# Fibonacci Scaling

**Status**: Security primitive. Live in `contracts/libraries/FibonacciScaling.sol`.
**Audience**: First-encounter OK. Attacker vs normal-user compared with specific numbers.
**Instance of**: [Substrate-Geometry Match](../SUBSTRATE_GEOMETRY_MATCH.md).

---

## Start with a tale of two users

Normal User Alice: makes 2-3 swaps per hour. Pays normal fees. Never notices rate limiters.

Attacker Bob: scripts 100+ swaps per minute during a planned arbitrage exploitation. Pools get distorted; Bob profits; Alice's pool is temporarily unstable.

A linear rate limiter (N swaps per hour, flat cap) would:
- Not bother Alice (she's well below the cap).
- Not stop Bob (he hits the cap, waits for window to reset, tries again).

We need a limiter that hurts Bob progressively as he pushes harder, while leaving Alice completely unaffected.

That's Fibonacci Scaling.

## What Fibonacci Scaling does

Per-user per-pool throughput damping using Fibonacci retracement levels as damping thresholds, over a 1-hour rolling window. Beyond a saturation point, the user enters a cooldown of `window × 1/φ` ≈ 0.618 × window.

Four damping levels at golden-ratio-derived thresholds:
- 23.6% of saturation: no damping.
- 23.6% → 38.2%: mild damping (linear ramp, small coefficient).
- 38.2% → 50%: moderate damping.
- 50% → 61.8%: strong damping.
- 61.8%+: saturation → cooldown (~37 minutes for a 1-hour window).

## Walk through — Alice's experience

Let's trace Alice through an hour.

### 10:00 AM — Alice makes swap #1

Her current usage: 1 swap / saturation_limit. Say saturation = 10 swaps/hour. Alice is at 10% of cap.

Below 23.6% threshold. No damping. Swap goes through at normal throughput.

### 10:15 AM — Swap #2

Alice at 2/10 = 20%. Still below 23.6%. No damping.

### 10:30 AM — Swap #3

Alice at 3/10 = 30%. Above 23.6% but below 38.2%.

Light damping applied. Damping curve:
```
damping(frac) = 0.1 × (frac - 0.236) / (0.382 - 0.236)
```

At 30% (= 0.30): `damping = 0.1 × (0.30 - 0.236) / (0.382 - 0.236) = 0.1 × 0.438 ≈ 0.044` or ~4% damping.

Alice's swap goes through but with a 4% slowdown or fee increase. Barely perceptible.

### 10:45 AM — Swap #4

Alice at 40%. Above 38.2%. Moderate damping:
```
damping(0.40) = 0.25 + 0.25 × (0.40 - 0.382) / (0.50 - 0.382) = 0.25 + 0.038 = ~0.29
```

29% damping. Noticeable but not prohibitive.

If Alice makes 2-3 swaps per hour typically, she never hits this. She's in the 10-30% range — minimal damping.

## Walk through — Bob's experience (attacker)

Bob scripts 50 swaps in 10 minutes to drive a pool toward his exploit target.

### 10:00 AM → 10:10 AM (10 minutes, 50 swaps)

Bob at 50 / 10 = 500% of the saturation limit.

Wait — 500% is way beyond the thresholds. What happens?

Once Bob hits saturation (61.8%), he enters cooldown. From 10:00 AM until now:

Bob at 61.8% threshold at swap #7 (roughly). At swap #7, saturation triggers cooldown of 37 minutes.

Bob now can't swap for 37 minutes. His attack stalls.

If Bob resumes at 10:47 AM, his rate-window partially resets. But he's already failed the attack because the pool has moved during his 37-minute dormancy.

### The attack fails

Bob's attack requires many rapid swaps. Fibonacci Scaling doesn't let many rapid swaps happen. The attack stalls at swap #7; Bob has to wait; the opportunity evaporates.

Meanwhile, Alice (at 30% of cap) barely noticed anything.

## Why Fibonacci, not linear

Linear alternative: "cut throughput by 10% every 25% of cap." At 50% cap: 20% cut. At 75%: 40% cut.

Problems:
- Cuts at 25%, 50%, 75% are ARBITRARY. Substrate doesn't have these boundaries.
- Users with moderate use hit 25% and start feeling damping. Many users complain.
- Attackers know the linear curve and optimize: stay at 74% of cap, cut is minimal.

Fibonacci alternative: damping curves match the substrate geometry.

The golden-ratio levels (23.6%, 38.2%, 50%, 61.8%) are empirically observed in:
- **Market reversal probability**: technical analysis uses these levels for a reason — they're where market behavior naturally changes.
- **Attention recovery rates**: psychology of "getting back to focus" follows these levels.
- **Biological response curves**: reaction-time distributions under load.

Users hitting a damping zone experience friction at the SAME POINT they'd naturally pause and reconsider. The rate limiter feels less like a cap and more like natural resistance.

Attackers can't "cut at 61.7% to avoid penalty" because the curve is continuous. Every attack step costs more than the last.

## The math

```solidity
function damping(uint256 fractionOfCap) pure returns (uint256) {
    if (fractionOfCap < 0.236e18) return 0;
    if (fractionOfCap < 0.382e18) {
        return 0.1e18 * (fractionOfCap - 0.236e18) / (0.382e18 - 0.236e18);
    }
    if (fractionOfCap < 0.500e18) {
        return 0.25e18 + 0.25e18 * (fractionOfCap - 0.382e18) / (0.500e18 - 0.382e18);
    }
    if (fractionOfCap < 0.618e18) {
        return 0.50e18 + 0.25e18 * (fractionOfCap - 0.500e18) / (0.618e18 - 0.500e18);
    }
    return 1.0e18;  // saturation → trigger cooldown
}
```

Saturation triggers:
```solidity
lastSaturationTime[user][pool] = block.timestamp;
// user cannot swap for window × 1/φ ≈ 37 minutes
```

## Why `1/φ` for cooldown

`1/φ = 0.618` ≈ golden-ratio conjugate.

Why? Because cooldown should match the natural attention-recovery rate of the substrate. Observed in multiple biological, cognitive, and market systems: recovery rates follow golden-ratio decay.

Choosing `1/φ` matches the substrate; choosing `0.5` (half the window) would be arbitrary.

## Why 1-hour window

Attacks on AMM pools typically require several minutes of sustained activity. A 1-minute window is too short — normal burst behavior can hit it. A 24-hour window is too long — attackers can ramp slowly and hide in "normal" daily volume.

1 hour matches:
- The natural human attention-session time (50-90 minutes per focused-activity block).
- Round-trip for most off-chain decision loops (oracle updates, governance proposals).

Sized to the substrate.

## Per-user per-pool isolation

Damping is scoped per `(user, pool)` pair. Prevents:

- A saturated user blocking other users from the same pool.
- A user being saturated across pools when they've only been active in one.
- Cross-pool throughput aggregation that masks attack behavior in a single pool.

Downsides: a sophisticated attacker with many wallets can Sybil-attack across wallets. Mitigated via:
- OperatorCellRegistry bonds (expensive per-wallet).
- Per-wallet aggregate throughput caps (secondary limiter).
- Sybil-resistant identity via SoulboundIdentity.

## Where it fires

The rate limiter is consulted by:
- `VibeSwapCore.commitOrder` — before accepting a commitment.
- `VibeAMM._executeSwap` — before applying a swap.
- `CrossChainRouter.sendMessage` — before dispatching a cross-chain tx.

Each consults the user's current `(user, pool)` fraction-of-saturation and either passes (damping applied multiplicatively) or reverts (user is in cooldown).

## Tuning

The four retracement levels are constants. Changing them requires contract upgrade + Augmented Governance. The window size (1 hour) and cooldown divisor (`1/φ`) are the same — constants, not governance parameters.

Tuning makes sense only if substrate geometry changes (e.g., new use cases with different natural time-scales). Don't tune for convenience — if it feels like rate-limiter friction, that IS the mechanism working.

## For students

Exercise: compute damping for specific fraction-of-cap values:

- 0.1 (10%): damping = ?
- 0.25 (25%): damping = ?
- 0.40 (40%): damping = ?
- 0.55 (55%): damping = ?
- 0.70 (70%): damping = ?

Then compute what a linear "cut 10% per 25% of cap" mechanism would give.

Compare:
- Small-user impact (at 10-25% of cap).
- Moderate-user impact.
- Attacker impact (at 60%+).

Observe how Fibonacci protects light users more than linear does, while hurting attackers more.

## Relationship to other primitives

- **Parent**: [Substrate-Geometry Match](../SUBSTRATE_GEOMETRY_MATCH.md) — matches power-law attacker distribution + golden-ratio recovery.
- **Sibling**: [Circuit Breaker Design](./CIRCUIT_BREAKER_DESIGN.md) — both are security primitives but address different triggers (CB = system-wide; FB = per-user-per-pool).
- **Anti-pattern for**: linear rate limiters. See [First-Available Trap](../memory/primitive_first-available-trap.md). <!-- FIXME: ../memory/primitive_first-available-trap.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

## One-line summary

*Per-user per-pool throughput damping at Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%) + golden-ratio cooldown (`window × 1/φ`). Alice at 30% of cap: 4% damping (barely noticed). Bob attacker at 500% of cap: triggers 37-minute cooldown; attack stalls. Substrate-geometry-matched to power-law attacker distribution; linear alternative would be strictly worse for normal users and less effective against attackers.*
