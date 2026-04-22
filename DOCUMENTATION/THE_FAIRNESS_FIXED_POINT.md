# The Fairness Fixed Point

**Status**: Formal convergence analysis. Open question with partial answers.
**Depth**: Theory-with-VibeSwap-specifics. This doc is a research memo, not a settled spec.
**Related**: [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md), [The Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md), [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md).

---

## The question

Shapley distribution is axiomatically fair under a specific cooperative-game model. But VibeSwap applies Shapley *iteratively* — the output of one round (rewards distributed) becomes input to the next (rewards-held modify trust-weighting modify future attestations modify future Shapley weights). Under iteration, does the distribution converge to a stable equilibrium? Or does it drift — compounding small biases into large ones over time?

This is a fixed-point question. Fair distribution is the fixed point iff `Shapley(v, trust(distribution_prior)) = distribution_prior` for the feedback system over rounds.

The unanswered research question: **does this fixed point exist, is it unique, and is it attracting?** We have partial answers. This memo states them and the remaining gaps.

## Why this matters

If the fixed point is:

- **Existent, unique, attracting** — iterated Shapley converges to a fair steady-state regardless of initial conditions. Perfect.
- **Existent, unique, unstable** — small perturbations push the system away from fair; small biases compound. Bad.
- **Multiple fixed points** — which fair-state the system converges to depends on starting conditions. Founder-advantage could persist structurally.
- **Non-existent** — the iteration doesn't converge; the distribution wanders or oscillates.

Without knowing which case we're in, "Shapley is axiomatically fair" is only a statement about a single round. The long-run property is what matters — and the long-run property may differ from the single-round one.

## The iteration, formally

Let `R_t` be the distribution at round `t` — a vector in `ℝ^N` (N contributors).

Let `τ(R)` be the trust-weighting that emerges from the distribution — a function from distribution vectors to trust-score vectors in `ℝ^N` via the [ContributionDAG](./CONTRIBUTION_DAG_EXPLAINER.md) BFS-with-decay.

Let `v_τ` be the characteristic function of the cooperative game under trust-weighting `τ` — players' coalition values are trust-weighted.

Let `φ(v_τ)` be the Shapley value under `v_τ`.

Then:
```
R_{t+1} = φ(v_τ(R_t))
```

A fixed point `R*` satisfies `R* = φ(v_τ(R*))`.

## Partial answer 1 — Existence

Fixed points exist when the map `R → φ(v_τ(R))` is continuous and maps a compact convex set into itself. Under reasonable assumptions about `τ` (continuity + boundedness), this condition holds: trust scores are bounded by trust-caps; Shapley values are continuous in v; the composition is continuous.

Brouwer's fixed-point theorem then guarantees *at least one* fixed point exists. So existence is not the problem.

## Partial answer 2 — Uniqueness

Uniqueness is harder. The Shapley operator is linear in the characteristic function `v`, but `v_τ` is non-linear in `R` (because τ involves BFS paths and trust-caps create discontinuities at thresholds). Non-linear maps can have multiple fixed points.

A specific worry: under founder-heavy initial distribution, founders' trust multipliers (3.0x) make their attestations dominate, which in turn reinforces their standing. Under non-founder-heavy initial distribution, the dynamics may converge to a different equilibrium.

This would be a concern if:
1. The founder-advantage-amplifying fixed point is attracting, AND
2. There's no "reset" mechanism to break out.

On (1): the 15% trust decay per hop + 6-hop cap limits how much the founder-advantage can amplify across the graph. The founder multiplier is dampened at each hop — at hop 6 it's ~1.13x, barely above baseline. So founder-dominant fixed points can exist but their basin of attraction is limited to the first few hops of the graph.

On (2): founder-change timelock (7 days) + governance-override capability provide reset mechanisms. They don't fire automatically, but they exist.

**Partial conclusion**: multiple fixed points likely exist. The "founder-advantage" one has a narrow basin; other equilibria (more distributed) are reachable. Not guaranteed unique.

## Partial answer 3 — Stability

Even if a fixed point exists, is it stable? A fixed point `R*` is stable if small perturbations `R* + ε` satisfy `||R_{t+k} - R*|| → 0` as k → ∞. Formally, the Jacobian of the Shapley-composition operator at R* must have all eigenvalues with magnitude less than 1.

This is hard to verify analytically for real Shapley computations because:
- The Shapley value depends combinatorially on the coalition structure.
- Trust-weighting introduces path-dependence.
- Discrete threshold effects (trusted vs. untrusted tier boundaries) create non-smooth regions in the iteration.

**Empirical approach**: simulate. Run the iteration forward from various initial conditions on a realistic contributor graph; measure whether trajectories converge or diverge.

Simulation candidates (not yet run):
- Start with uniform R; iterate 100 rounds; see if it stays near uniform or drifts.
- Start with founder-heavy R; iterate; see if it stays concentrated or diffuses.
- Inject a small perturbation at round 50; measure whether it's damped or amplified.

These simulations are queued as part of the [ETM Build Roadmap](./ETM_BUILD_ROADMAP.md)'s empirical validation cycle.

## The Perron-Frobenius intuition

For linear systems, the spectral radius of the iteration matrix determines stability. Shapley composed with trust-weighting is not linear globally, but near a fixed point it can be locally linearized.

Conjecture: the local linearization of `R → φ(v_τ(R))` at a balanced fixed point has spectral radius < 1, making the balanced fixed point locally stable. This is because:

- Shapley value is an *averaging* operator — no single coalition's value dominates.
- Trust-weighting with multi-hop BFS-decay is also averaging.
- Composing averaging operators generally yields spectral radius < 1.

Verifying the conjecture requires explicit computation of the linearization. Queued.

## What could break the fixed point

### Goodhart's Law variant

If contributors optimize for attestation weight directly (gaming the mechanism), the characteristic function drifts from "real cooperative-production value" to "attestation-gaming value". The iteration then converges to a gaming-optimal fixed point that differs from the fair-production fixed point.

Mitigations:
- [Three-branch attestation](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) — gaming one branch doesn't capture the others.
- Evidence-hash commitments — gaming requires falsifying off-chain artifacts, which is expensive.
- Periodic audits via governance — out-of-band verification.

### Founder-lock

If founders' influence at hop-0 dominates the BFS sufficiently, the iteration converges to a founder-dominant state that reinforces itself. Mitigated by 15% decay per hop + 6-hop cap + referral-exclusion option for bootstrap phase.

### Attestation collusion

If a coalition of high-trust attestors consistently co-attests, their shared impact amplifies. The system treats their co-attestation as independent when it's actually correlated.

Mitigations:
- Quadratic voting (planned, in [ContributionAttestor Explainer](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)) — quadratic scaling diminishes returns for correlated voting.
- Random-subset jury selection in the judicial branch — breaks coordinator control.

## The honest assessment

As of 2026-04-22, the fixed-point properties of iterated Shapley under VibeSwap's trust-weighted dynamics are **partially characterized**:
- Existence: likely (Brouwer).
- Uniqueness: not proven; multiple fixed points probably exist.
- Stability: conjectured for balanced fixed points; not verified.
- Basin sizes: founder-dominant basin is narrow (6-hop decay + cap); balanced basin is broad.

**Practical implication**: VibeSwap is probably OK in the default operating regime. But "probably" is not "proven". Queuing formal convergence analysis is a real research priority, not just a theoretical nicety.

## Adjacent questions

- **Rate of convergence**: if it converges, how fast? Per-round contraction factor?
- **Perturbation sensitivity**: if a large attacker joins and attempts to bias R, how much can R shift before governance intervention becomes necessary?
- **Path dependence vs. convergence**: if two initial conditions converge to the same fixed point but take different paths, does the path matter (e.g., for who got rewarded most over the convergence period)?

Each is a follow-up memo.

## Practical guidance

Until the formal analysis is complete:

1. **Don't assume Shapley iteration self-corrects.** Structural biases can persist.
2. **Build in explicit reset mechanisms.** Governance override is the emergency brake.
3. **Monitor for drift.** Set up metrics that track the gap between current distribution and a reference-balanced distribution; alert on diverging gap.
4. **Apply [Token Mindfulness](./TOKEN_MINDFULNESS.md) to this analysis itself.** Don't declare "Shapley is fair" as a complete answer — be honest that the iterated version is only partially characterized.

## Relationship to other open questions

- [Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md): permutation-symmetric Shapley under-rewards novelty. Introducing the novelty bonus changes the iteration dynamics — a fresh fixed-point analysis is needed for the modified system.
- [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md): characteristic function `v(S)` is only estimated. Estimation errors propagate through iteration. Error bounds on the fixed-point estimate are another research direction.
- [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md): other mechanisms compose with Shapley iteration — they all affect the fixed-point structure. Full system analysis beyond single-mechanism.

## One-line summary

*Shapley iterated through trust-weighted feedback has existent-but-possibly-multiple fixed points with conjectured-but-unverified stability — the default regime is probably balanced, but "probably" is the best we have until formal convergence analysis ships.*
