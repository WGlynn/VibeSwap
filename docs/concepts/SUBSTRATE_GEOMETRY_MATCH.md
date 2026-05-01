# Substrate-Geometry Match — "As Above, So Below"

**Status**: Meta-principle, Axis 1 (geometric) of the VibeSwap design stack.
**Audience**: First-encounter OK. No prior background required; real examples up front.
**Primitive**: [`memory/primitive_substrate-geometry-match.md`](../memory/primitive_substrate-geometry-match.md)

---

## Start with a story about rate limiters

You're building a website. You need to prevent scraping (bots hammering your API). You add a rate limiter: max 100 requests per hour per IP.

Works OK for a while. Then you notice:

- Your power users (real humans doing intense research) keep hitting the limit. They churn.
- Your attackers (sophisticated scrapers) just rotate IPs and bypass easily.

Your rate limiter is mis-fit to reality. Real users are **distributed unevenly** — most are casual, a few are deep. Your limiter treats them as uniform. Real attackers are **adaptive** — they shape their behavior around your limiter. Your limiter is static.

The mismatch is between your mechanism's shape (flat-cap per hour) and the substrate's shape (power-law distributed traffic + adversarial adaptation).

This is the exact failure pattern Substrate-Geometry Match addresses — but generalized.

## The principle, stated plainly

*As above, so below.* The hermetic maxim applied to mechanism design.

The macro substrate (whatever the mechanism operates on — markets, attention, trust, bandwidth) has a specific geometry. Power-law distributions. Fractal scaling. Golden-ratio progressions. Self-similar across scales.

Your mechanism's shape must reflect that geometry. If the substrate has a power-law, your mechanism must be power-law-shaped. If it's fractal, your mechanism must scale fractally. Mismatch = the mechanism bleeds at exactly the points where correctness matters most.

## Why reality has "geometries" at all

This isn't mysticism. It's observation.

Network traffic: power-law (most users generate tiny load; a few generate enormous load).
Market capitalization: power-law (most companies small; a few giants).
Attention: power-law (most topics briefly noticed; a few dominate).
Trust propagation through social graphs: exponential decay with plateaus.
Attacker distribution: power-law (most opportunistic; a few resource-rich).
Biological response times: log-scale (reaction gets perceptibly slower at log-scale intervals).

These aren't coincidental. They emerge from the structure of how attention, resources, and preferences distribute in natural systems.

A mechanism designed without awareness of the substrate's geometry is either:
- **Lucky** (the chosen geometry happens to roughly match), or
- **Broken at the tail** (the mismatch shows up where extreme users live).

Broken-at-the-tail failures are the dangerous ones because they happen to the small-but-important segment (power users, motivated attackers, rare-event cases).

## Three concrete VibeSwap examples

### Example 1 — Fibonacci-Scaled Throughput

The per-user per-pool rate limit in `contracts/libraries/FibonacciScaling.sol`. Damping levels at 23.6%, 38.2%, 50%, 61.8% of a saturation threshold. Cooldown = `window × 1/φ ≈ 0.618 × window`.

Why these specific numbers? They're Fibonacci retracement levels and the golden-ratio conjugate. Observed in:
- Market-reversal probability (technical analysis uses these levels for a reason).
- Attention-recovery rates (psychology of "getting back to focus" follows these).
- Biological response curves (reaction-time distributions under load).

The substrate (human + market behavior) has a golden-ratio geometry. The rate-limiter matches it.

Linear alternative would be "cut volume by 10% at each step". It's cleaner to write but doesn't match the substrate. Under the linear alternative:
- Users hitting 30% of cap get the same 10% penalty as users hitting 90%. Unfair to moderate-use cases.
- Attackers learn the flat pattern quickly and shape their attacks around the cut.

Fibonacci-scaled:
- 30% of cap → minimal damping (users don't notice).
- 60% of cap → heavy damping (attackers feel the pressure).
- Attackers can't "cut at 59% to avoid penalty" because the curve is continuous; every attack step costs more than the last.

See [`FIBONACCI_SCALING.md`](./FIBONACCI_SCALING.md) for full mechanism detail.

### Example 2 — Commit-Reveal Batch Duration

VibeSwap's commit-reveal auction: 8-second commit phase + 2-second reveal phase = 10-second total.

Why 10, not 5 or 30?

- Sub-5s strands human traders (they can't commit in time for UX reasons).
- Super-30s breaks bot opportunity-cost accounting (their alternative arbitrage opportunities mature in seconds).
- ~10s matches the substrate's characteristic attention-time for short-duration decisions.

The substrate (human + bot trading ecosystem) has a ~10-second natural time-scale. The auction matches it.

### Example 3 — ContributionDAG's 15% Decay Per Hop

ContributionDAG uses trust-score BFS with 15% decay per hop. Max 6 hops.

Why 15%? Why 6?

- Empirical studies of social-trust propagation show roughly 15% degradation per hop in natural settings (close friend → their friend → friend-of-friend → ...).
- Six hops is the natural bound before trust becomes negligible AND the BFS gas cost becomes unbounded.

Linear alternative: "divide trust by 2 per hop" (50% decay). Too steep; chops social-graph distances that still matter. Or "1% decay per hop" — too shallow; trust propagates to distant, unverified corners of the graph.

15% per hop isn't an arbitrary tuning. It's the substrate's measured geometry.

## The First-Available Trap — what Substrate-Geometry Match prevents

Engineers choosing a mechanism often default to the first available library implementation. Solidity has a rate-limiter. You use it. Compound has an auction. You fork it. OpenZeppelin has a voting module. You integrate it.

Each off-the-shelf mechanism was designed by someone, for some substrate, with some geometry assumptions baked in. The geometry might or might not match YOUR substrate.

First-Available Trap: the ecosystem default is not shaped like YOUR substrate. You adopt it because it's there. Your mechanism bleeds at the tail where the mismatch shows up.

See [`memory/primitive_first-available-trap.md`](../memory/primitive_first-available-trap.md) for the full anti-pattern.

Substrate-Geometry Match is the antidote: characterize your substrate's geometry before choosing a mechanism. Reject candidates that don't match, even if they're readily available.

## How to apply — the 4-step check

Before committing to a mechanism, run this 4-step check:

### Step 1 — Name the substrate

What does the mechanism operate on? Be concrete:
- Attention of human traders?
- Capital of institutional investors?
- Trust between social contacts?
- Bandwidth of network operators?
- Retry patterns of automated systems?

### Step 2 — Characterize the substrate's geometry

Look at actual data. What distribution does this substrate follow?
- Power-law (most users small, few users huge)?
- Gaussian (most users middle, few extreme)?
- Exponential (decay from a peak)?
- Fractal (self-similar across scales)?
- Log-scale (perceptible changes at doublings, not linear increments)?

Reference data from existing deployments, if possible. Otherwise, consult domain experts (behavioral economics for attention, network engineers for bandwidth, social scientists for trust).

### Step 3 — Characterize the candidate mechanism's geometry

What shape does the candidate have?
- Flat? (Linear in input.)
- Curved? (Log, exponential, polynomial.)
- Threshold-based? (Step functions.)
- Fractal? (Self-similar.)

### Step 4 — Check the match

Does the mechanism's geometry match the substrate's?
- Yes → proceed.
- No → reject and find a mechanism that matches.

The "find a match" step sometimes means designing a new mechanism rather than using an off-the-shelf one. That's a real cost. But the cost of a matched mechanism at build-time is cheaper than the cost of a mismatched mechanism at tail-failure time.

## The broader principle — substrate as teacher

The larger lesson: the substrate is the teacher. You don't impose a mechanism and hope the substrate accepts it. You observe the substrate and design a mechanism that fits.

This inverts the typical engineering posture. Engineers often default to "choose a good pattern, apply it." Substrate-Geometry Match says "the substrate tells you what pattern to use."

## Relationship to other meta-principles

- **Parent**: [`ECONOMIC_THEORY_OF_MIND.md`](./ECONOMIC_THEORY_OF_MIND.md). ETM says mind is an economy; Substrate-Geometry Match says the economy's mechanisms must match the cognitive-substrate geometry.
- **Sibling**: [`AUGMENTED_MECHANISM_DESIGN.md`](./AUGMENTED_MECHANISM_DESIGN.md). The methodology; substrate-geometry is the geometric correctness criterion the methodology applies.
- **Enforcement**: [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md). Check 1 of the triad.

## Practical test questions

When you're uncertain whether a mechanism matches the substrate:

- If you sampled 100 users randomly, would the top 10% be 10x the median? (If yes, substrate is roughly linear. If they'd be 100x+, substrate is power-law.)
- Does behavior change dramatically at specific thresholds, or gradually? (Threshold changes need threshold-based mechanisms.)
- Does the substrate have a natural time-scale (attention session, trading cycle, decision latency)? (Your mechanism should match it.)
- Do extreme cases (top 1%) matter more than average cases? (Power-law-shaped mechanisms serve them well; linear mechanisms don't.)

## For students

Exercise: pick a mechanism you've seen in practice (a rate limiter, a rewards schedule, a governance threshold). Find its geometry. Find the substrate's geometry (look up real data if possible). Check the match.

If they don't match, redesign the mechanism to match. Write down your reasoning.

This exercise, applied to a real mechanism in a real project, is the core skill of mechanism design.

## The deeper bet

Substrate-Geometry Match bets that the universe has specific geometries that DO matter for design. It bets that "the math of things" is a real thing, not merely convention.

Critics might say: "it's mysticism to look for golden ratios in engineering." The response: "we're not looking for golden ratios in everything. We're looking for golden ratios where substrates have shown golden ratios empirically." Specificity, not mysticism.

## One-line summary

*Every mechanism lives on a substrate with its own geometry — power-law, fractal, log-scale — and the mechanism must match it. Fibonacci retracement for throughput because attention recovers at golden-ratio. 10-second batch duration because human+bot substrate has a ~10s characteristic time. 15% trust decay per hop because social-graph substrate decays there empirically. Mismatch bleeds at the tail.*
