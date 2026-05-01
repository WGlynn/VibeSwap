# The Fairness Fixed Point

**Status**: Formal convergence analysis with concrete iteration scenarios.
**Audience**: First-encounter OK. Math motivated by concrete examples before formalism.

---

## The question, framed as an everyday situation

Imagine a community that distributes rewards based on contributions every month.

Month 1: the community is small. A few high-trust founders attest most contributions. Rewards flow mostly to them.

Month 2: the founders have more accumulated rewards (which often convert to higher trust-weight). Their attestation weight is now higher than month 1's.

Month 3: with even higher trust-weight, founders' attestations pass acceptance thresholds more easily than newer contributors. More rewards flow to founders.

...

Question: does this settle into a stable, fair distribution? Or does it drift — founders accumulating more and more, newcomers accumulating less and less, until the system becomes effectively feudal?

This is the fairness-fixed-point question. It's about iteration, not single rounds.

## Why iteration matters

Shapley distribution ([`SHAPLEY_REWARD_SYSTEM.md`](../../concepts/shapley/SHAPLEY_REWARD_SYSTEM.md)) is provably fair for a SINGLE round under specific cooperative-game assumptions.

But VibeSwap runs Shapley ITERATIVELY. Each round's rewards feed back into the trust-graph, which then affects the next round's Shapley computation. This is a feedback loop.

Feedback loops don't automatically converge. They can:
- **Converge to a stable fair distribution** (good).
- **Converge to a stable unfair distribution** (bad).
- **Oscillate** (worse).
- **Wander without settling** (worst).

"Shapley is fair" is a single-round claim. The iterated version is a separate mathematical question. This doc works through it.

## What "fixed point" means

A fixed point of an iteration is a state where applying the iteration leaves the state unchanged. In our case:

```
distribution_t+1 = iterate(distribution_t)

distribution* is a fixed point iff
distribution* = iterate(distribution*)
```

If iteration converges, it converges to a fixed point. Which fixed point matters — fair ones are the desired outcome.

Three critical questions about fixed points:

1. **Existence**: Does any fixed point exist?
2. **Uniqueness**: Is there only one, or multiple?
3. **Stability**: Do nearby states flow toward the fixed point (stable) or away (unstable)?

For "fair distribution under iterated Shapley", we need all three to have good answers.

## Concrete scenario — 3-contributor system

Let's build intuition with a small example. Three contributors: Alice (founder, trust 3.0), Bob (high-trust, trust 2.0), Carol (newcomer, trust 0.5).

Reward pool per round: $100. Shapley computes each round based on contributions + trust-weights.

Round 1: Alice contributes 10 units, Bob 10, Carol 10. Trust-weighted Shapley: Alice $50, Bob $35, Carol $15.

**The feedback**: Alice's $50 reward somewhat raises her trust (maybe 3.0 → 3.05). Bob's $35 raises his slightly (2.0 → 2.02). Carol's $15 barely moves her (0.5 → 0.502).

Round 2: everyone again contributes 10 units. Same Shapley math, but trust-weights are slightly different.
- Alice: slightly higher share.
- Bob: slightly higher share.
- Carol: slightly higher share.

**But the ratios have shifted slightly toward Alice.**

If this drift compounds over many rounds, we converge to a distribution where Alice takes most of the pool.

Does it actually drift that way? Depends on specific parameters.

## What makes the difference

### Scenario A — Drift toward founder dominance

Suppose trust-weights update as `trust(new) = trust(old) + 0.01 × reward`. Then a $50 reward adds 0.5 to trust. A $15 reward adds 0.15.

Over 100 rounds, Alice gains ~50 trust. Bob gains ~35. Carol gains ~15. The gap widens.

The iteration converges to a distribution where Alice takes ~80%+ of each round. Unfair fixed point.

### Scenario B — Bounded with decay

Suppose trust-weights decay at 5% per round AND update based on reward, but capped at some maximum. Then trust can't grow unbounded.

Over 100 rounds, trust-weights asymptote. Alice settles at some fixed (high but bounded) trust level. The distribution stabilizes.

The iteration converges to a distribution where Alice takes ~40-50% — still high, but bounded. Stable fair-ish fixed point.

### Scenario C — Contribution-matched

Suppose contributions themselves shift. As Alice's rewards grow, she delegates (reduces direct contribution). Bob and Carol step up.

Now Shapley's input is different each round. The system is partially self-correcting.

The iteration oscillates or converges to a distribution that actually matches the LONG-RUN marginal contribution, not the initial trust-graph. Stable fair fixed point.

Three scenarios, three fixed points. Which one VibeSwap is in depends on the actual mechanisms + behaviors.

## What VibeSwap aims for

VibeSwap's architecture targets Scenario C — contribution-matched. But we need to verify this empirically. As of 2026-04-22, the system is still in bootstrap; fixed-point behavior hasn't been measured at scale.

Mitigations that nudge toward Scenario C:

- **Trust-weight cap** at 3.0x for founders. Even with growth, won't exceed.
- **15% per-hop decay** in trust-graph BFS. Prevents concentration.
- **Six-hop max** for BFS. Prevents distant users from inheriting founder influence.
- **Three-branch attestation** (executive/judicial/legislative). Prevents single-branch capture.
- **Constitutional axioms** (P-000, P-001). Prevent self-amplifying wealth-capture.

Each mitigation bounds part of the drift dynamics.

## The formal claim

Let `R_t` be the distribution at round `t`. Let `τ(R)` be trust-weights derived from R via ContributionDAG's BFS-with-decay.

The iteration is: `R_{t+1} = Shapley(v_τ(R_t))`.

A fixed point satisfies: `R* = Shapley(v_τ(R*))`.

### Partial answer 1 — Existence

Fixed points exist when the iteration map is continuous and maps a compact set to itself.

- τ is continuous (BFS with bounded decay is continuous in R).
- Shapley is continuous in the characteristic function.
- The mapping is from the distribution-simplex to itself.

Brouwer's fixed-point theorem → at least one fixed point exists.

### Partial answer 2 — Uniqueness

Uniqueness is harder to prove. The iteration is non-linear (trust-weight has path-dependencies; trust-caps create discontinuities).

Non-linear maps can have multiple fixed points. Likely outcome: one "balanced" fixed point, one "founder-dominant" fixed point. Which basin of attraction the system ends up in depends on initial conditions and noise.

### Partial answer 3 — Stability

Stability near a fixed point requires the local Jacobian to have eigenvalues with magnitude < 1 (strictly contractive).

For Shapley-via-trust-weight composition near a balanced fixed point:
- Shapley is an averaging operator; averaging operators generally have spectral radius < 1.
- BFS-with-decay is also averaging.
- Their composition has spectral radius < 1.

Balanced fixed points are likely stable.

## The honest assessment

As of 2026-04-22:
- **Existence**: confirmed (Brouwer).
- **Uniqueness**: NOT proven. Multiple fixed points plausible.
- **Stability of balanced fixed point**: conjectured via local linearization, not verified.
- **Basin sizes**: founder-dominant basin has narrow reach (capped multipliers + decay); balanced basin is broad.

Practical implication: VibeSwap is probably operating in a balanced-fixed-point basin. But "probably" is not "proven".

The [ETM Build Roadmap](../../concepts/etm/ETM_BUILD_ROADMAP.md) queues an empirical simulation cycle to verify convergence on a realistic contributor graph. Results will inform whether additional mitigations are needed.

## The goal of simulation

Queued research cycle: run iterated Shapley on a realistic contributor graph for 100+ rounds. Observe:

- Does the distribution stabilize?
- Does founder-dominance emerge?
- Do mitigations (trust caps, decay, three-branch attestation) prevent drift?
- Are there surprising failure modes?

Simulations would test the conjectures. Results update the theory.

## What could break convergence

### Break 1 — Reward-to-trust multiplier too aggressive

If `trust(new) = trust(old) × (1 + 0.1 × reward/100)`, small rewards produce large trust increases. Compounds rapidly.

Mitigation: cap the multiplier. VibeSwap's trust-weight is bounded at 3.0x.

### Break 2 — Reward accumulation feeds directly into voting power

If rewards directly translate to voting power without decay, early-accumulated rewards become permanent voting leverage.

Mitigation: VibeSwap's voting-multiplier is based on TRUST (not accumulated rewards). Trust decays. Voting power follows decay.

### Break 3 — Acceptance threshold tuned for founders

If the acceptance threshold is low (2.0), a single founder's attestation (trust 3.0 × multiplier 3.0 = 9.0) passes easily. Claims accepted disproportionately when founders attest.

Mitigation: acceptance threshold at 2.0 is workable for diverse attestors but could bias toward single-founder-attests. Quadratic voting or multi-branch attestation reduce this.

### Break 4 — Tribunal capture

If tribunals consistently favor certain claim-types, the judicial branch becomes a bias-amplifier.

Mitigation: random jury selection from high-trust pool. Less gameable than fixed-tribunal.

### Break 5 — Governance capture of constitutional amendments

If governance can amend P-000 or P-001, the constitutional backstop fails.

Mitigation: constitutional axioms are NOT governance parameters. Amendment would require forking.

## Implications for monitoring

If we assume the fixed-point question matters, we should monitor:

- **Rolling-window Shapley distribution**: how has the distribution shifted over the past N rounds? Alert on sustained drift.
- **Trust-weight concentration**: Gini coefficient of trust-weights. Alert on increases.
- **Founder-hop-distribution**: fraction of rewards flowing to hop-0, hop-1, etc. from founders. Alert on concentration.
- **Multi-branch concurrency**: ratio of claims resolving via executive vs. tribunal vs. governance. Alert on dramatic shifts.

These metrics don't PROVE convergence. But they make drift observable in real-time.

## For students

Exercise: build a toy simulation of iterated Shapley. Three contributors, 50 rounds. Parameters:
- Initial contributions: all equal.
- Trust update: `trust(new) = trust(old) × (1 + k × reward)` for various k.
- Trust cap: various values.

Compute and plot:
- Rewards per contributor over time.
- Trust-weights over time.
- Gini coefficient of rewards.

Try different k and cap values. Observe:
- Which configurations converge to balanced fixed points?
- Which converge to founder-dominant fixed points?
- Which oscillate or wander?

This exercise teaches fixed-point intuition via experimentation.

## Relationship to other primitives

- **[Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md)**: permutation-symmetric Shapley under-rewards novelty. Modifying Shapley for novelty changes the iteration dynamics — a fresh fixed-point analysis is needed for the modified system.
- **[The Attribution Problem](../essays/THE_ATTRIBUTION_PROBLEM.md)**: `v(S)` estimation errors propagate through iteration. Error bounds on the fixed-point estimate are another research direction.
- **[Mechanism Composition Algebra](../../architecture/MECHANISM_COMPOSITION_ALGEBRA.md)**: other mechanisms compose with Shapley iteration; their interactions affect the fixed-point structure.

## One-line summary

*Fairness depends on what Shapley iteration converges to, not what it computes for a single round. Existence of fixed points is proven (Brouwer); uniqueness is open (multiple plausible); stability of balanced-fixed-point is conjectured via spectral analysis. VibeSwap's mitigations (trust caps, decay, three-branch, constitutional axioms) bound drift dynamics. Verification queued as empirical simulation.*
