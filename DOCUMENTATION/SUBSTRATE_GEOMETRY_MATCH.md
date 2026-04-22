# Substrate-Geometry Match — "As Above, So Below"

**Status**: Meta-principle, Axis 1 (geometric) of the design stack.
**Primitive**: [`memory/primitive_substrate-geometry-match.md`](../memory/primitive_substrate-geometry-match.md)
**Parent**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md)

---

## The principle

The hermetic maxim — *as above, so below* — applied to mechanism design. The macro substrate (fractal markets, power-law tail distributions, self-similar attention economies) must be reflected in the micro mechanism (Fibonacci scaling, golden-ratio progressions, logarithmic throughput curves). When the geometries match, the mechanism composes with the substrate; when they mismatch, the mechanism fights the substrate and bleeds.

## Why this matters

DeFi's recurring failure mode is linear mechanisms laid over power-law substrate. Fixed fees, linear rate limits, arithmetic progression of tiers — all break at the tail. Traffic is power-law; attention is power-law; capital concentration is power-law. Mechanisms that assume Gaussian distributions are wrong at exactly the points where correctness matters most.

Substrate-geometry match demands:
- **Fractal scaling** for rate limits (see [`FIBONACCI_SCALING.md`](./FIBONACCI_SCALING.md)).
- **Logarithmic curves** for fee schedules that must smooth across orders-of-magnitude transaction sizes.
- **Golden-ratio cooldowns** for retry / eviction timers that should decay at the rate attention actually recovers.
- **Power-law bond curves** for Sybil-resistance deposits that must price-out the tail of motivated attackers, not the average.

## The failure mode it prevents — the First-Available Trap

When choosing a mechanism, engineering defaults pull toward the *first available tool* from the ecosystem library. Solidity has a built-in rate limiter → use it. An auction library already implements Dutch auctions → use it. Zero-knowledge proofs have a well-maintained circuit compiler → use it.

The First-Available Trap: the ecosystem default is not shaped like the substrate. A rate limiter that's linear in time when the substrate is power-law in attention. A Dutch auction that decays arithmetically when the attention-curve decays geometrically. A ZK circuit that's fixed-arity when the data is self-similar across scales.

Substrate-geometry match is the antidote: before selecting a mechanism, characterize the substrate's geometry; reject any candidate that doesn't match.

See [`memory/primitive_first-available-trap.md`](../memory/primitive_first-available-trap.md) for the generalized anti-pattern and [`memory/primitive_pattern-match-drift-on-novelty.md`](../memory/primitive_pattern-match-drift-on-novelty.md) for the cognitive variant.

## Concrete examples in VibeSwap

### Fibonacci-scaled throughput

`contracts/libraries/FibonacciScaling.sol` implements per-user per-pool rate limits using Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%) as damping thresholds. Rationale: attention recovers in golden-ratio-decayed slices in natural settings; the rate limiter matches that curve rather than imposing a linear-time window.

Saturation cooldown = `window × 1/φ` (≈ 0.618 × window), not a round-number fraction. The cooldown matches the attention-recovery rate of the substrate, not the engineer's preference for round numbers.

### Commit-Reveal batch duration

10-second batches (8s commit + 2s reveal). Why 10 and not 5 or 30? Because the target substrate (human-driven UX decisions + bot pricing latency) has a characteristic attention-time on the order of 10 seconds. Sub-5s windows strand human traders; super-30s windows break bot opportunity-cost accounting. The substrate has a natural time-scale; the mechanism matches it.

### Trust decay per hop

ContributionDAG uses 15% trust decay per hop (≈ golden-ratio-conjugate-squared). Six hops = max range. The substrate (social graph distance sensitivity) decays sharply in roughly this shape; a linear 10%/hop decay or a cliff-edge 50%/hop would mismatch observed social-trust dynamics.

### Shapley weights

Shapley distribution of batch surplus uses marginal contribution, which is inherently non-linear. The substrate (knowledge-compounding cooperative production) has super-linear returns to early contributors; Shapley preserves this because marginal-value-of-contribution IS the metric in the theory. A flat pro-rata distribution would match the substrate less well.

## How to apply

When designing a mechanism, run this check before coding:

1. **What is the substrate?** Name the thing the mechanism will live on top of (attention, capital, trust, bandwidth, attention-spans, retries).
2. **What is the substrate's geometry?** Is it power-law, Gaussian, exponential, linear, fractal? Look at the actual data, not the folk theory.
3. **What is the candidate mechanism's geometry?** Fees, windows, thresholds, curves — characterize them.
4. **Do they match?** If yes, proceed. If no, find a mechanism whose geometry matches, even if it's harder to implement.

The cost of implementing a non-matching mechanism is paid at the tail — where the engineers forgot to look. Better to pay the implementation cost upfront than the tail-failure cost in production.

## Relationship to other principles

- **Parent**: [`ECONOMIC_THEORY_OF_MIND.md`](./ECONOMIC_THEORY_OF_MIND.md). ETM says "the mind is an economy"; Substrate-Geometry Match says "and the shapes of its subsystems come in specific geometries that the externalizing mechanism must honor."
- **Sibling**: [`AUGMENTED_MECHANISM_DESIGN.md`](./AUGMENTED_MECHANISM_DESIGN.md) is the methodology; substrate-geometry match is the geometric correctness criterion applied by the methodology.
- **Enforcement**: [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md) is the 3-check gate; substrate-geometry match is check #1.

## One-line summary

*Match the mechanism's geometry to the substrate's geometry — fractal to fractal, power-law to power-law, golden-ratio to golden-ratio — or the mechanism bleeds at the tail.*
