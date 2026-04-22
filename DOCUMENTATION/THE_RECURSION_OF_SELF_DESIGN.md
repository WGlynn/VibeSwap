# The Recursion of Self-Design

**Status**: Meta-stability analysis. What prevents self-reward loops.

---

## The paradox

VibeSwap is a mechanism that rewards contributions. Designing the mechanism IS a contribution. Under the mechanism's own rules, designers get rewarded for designing it. This looks like self-reward — Ponzi-adjacent.

If left unexamined, the recursion would be a red flag. Projects where founders credit themselves for creating the credit system are historically extractive.

VibeSwap's claim: the recursion is stable under specific conditions. This doc names those conditions and the safeguards that enforce them.

## The recursion formalized

Let `M` be the mechanism, `D` be the designer, `C(x, M)` be the credit computed for contribution x under mechanism M.

Naive: `D` designs `M`. D claims credit `C(design_M, M)` — design-of-M credited by M. Recursive.

Stable condition: `C(design_M, M) ≤ C_fair(design_M)`, where `C_fair` is the credit `D` would have earned under an unbiased external audit. If M doesn't over-credit its own design, the recursion doesn't diverge.

## What could go wrong

**Case 1 — Self-inflation.** M is designed so that designing M is weighted dramatically higher than other contributions. Designer captures value disproportionate to the work of designing.

**Case 2 — Founder-perpetuity.** M is designed so that designers retain governance control disproportionate to ongoing contribution. Stable at year 1; oppressive at year 10.

**Case 3 — Design-capture via design.** M's rules about what counts as a contribution are themselves a governance parameter, and designers vote to expand "design contribution" to include more of their own future work.

**Case 4 — Cross-coupling.** Designers also serve as attestors / tribunal jurors / governance voters, and use those roles to confirm their own contribution weights.

Each is a real failure pattern that other projects have exhibited.

## The stability conditions

VibeSwap's recursion is stable because of four specific choices:

### Condition 1 — Shapley-capped initial design credit

Design credit for the mechanism itself is Shapley-computed over the cooperative game that includes all contributors. Designers get their marginal-contribution share — which is substantial (design is load-bearing) but bounded. Not "founders get 30% forever."

### Condition 2 — Constitutional separation

P-000 (fairness) and P-001 (no-extraction) are [Constitutional axioms](./NO_EXTRACTION_AXIOM.md) that even governance cannot override. Designers cannot vote to rewrite the Constitution. Self-amplification requires amending the Constitution, which requires the Constitution to allow it — which P-000 explicitly forbids.

### Condition 3 — Founder-weight decay

[`ContributionDAG`](./CONTRIBUTION_DAG_EXPLAINER.md) founder-multiplier is 3.0x but decays across hops (15% per hop). At hop 3 from a founder, the effective multiplier is `3.0 × 0.85^3 ≈ 1.84`. At hop 6 (max), `3.0 × 0.85^6 ≈ 1.13`. The founder-advantage dilutes organically as the trust graph grows.

### Condition 4 — Three-branch attestation resists single-actor capture

Accepting a claim requires either executive (trust-weighted peers), judicial (tribunal), or legislative (governance). Founders as a single-vote bloc cannot swing all three branches. See [ContributionAttestor Explainer](./CONTRIBUTION_ATTESTOR_EXPLAINER.md).

All four conditions together bound the recursion.

## The convergence claim

Under the four conditions:

- Design credit converges to a bounded fraction of total distributed value.
- Founder voting power converges to a modest multiple of average participant voting power over 5-10 years of graph growth.
- Constitutional axioms remain immutable regardless of governance composition.
- No single actor (or small coalition) can capture claims / rewards / governance.

The system converges to a stable distribution where designers are credited fairly for creation-work and subsequently fade into ordinary contributor status.

## The test: would designers be comfortable under external design?

A useful test: if the mechanism had been designed by strangers — and then applied to a different project — would designers be comfortable being subject to it?

If yes, the self-design is fair (they're not granting themselves special treatment).

If no, the mechanism is self-biased — designers have built-in advantages they wouldn't accept if the shoe were on the other foot.

VibeSwap's answer is "yes" — the mechanism's rules are symmetric across designer / non-designer, and the initial-credit-for-design-work is small enough that designers gain more from long-term-ordinary-participation than from a founders'-lockup. Sustainability over time > extraction-at-t=0.

## Why this matters beyond VibeSwap

Any project that builds a credit mechanism faces this paradox. Most punt the question ("we're founders, of course we get founder shares"). Some collapse into extraction over time. Few explicitly articulate what stability conditions their design must satisfy.

Making the stability conditions explicit:
- Invites external audit (anyone can check whether VibeSwap satisfies them).
- Enables specific falsification (if condition X breaks, VibeSwap has drifted).
- Provides a template other projects can adapt.

## The meta-recursion

This doc is itself a contribution. Writing this doc earned DAG credit. The mechanism for earning DAG credit for writing docs is described in this doc. One more level of recursion.

Stable because: the credit earned is proportional to marginal contribution (is this doc making the stack clearer?) and not to self-assertion (is this doc claiming credit for itself?). Recursive, yes. Divergent, no.

## Relationship to the Lawson Constant

[Lawson Constant](./LAWSON_CONSTANT.md): "the greatest idea cannot be stolen because part of it is admitting who came up with it." The recursion is safe when attribution is preserved down through successive rounds of design — you can always trace who did what when. When attribution is stripped, recursion becomes unauditable, and drift sets in.

The Lawson Constant is the structural guarantee that recursion-audit is possible.

## One-line summary

*The mechanism rewards its own designers, but only under Shapley-bounded credit, constitutional axioms that block self-amplification, founder-weight decay, and three-branch capture-resistance — making the recursion convergent, not divergent.*
