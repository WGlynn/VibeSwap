# Substrate Incompleteness

**Status**: Design humility. Gödel's insight applied to mechanism design.
**Depth**: Theoretical limits of what augmented mechanisms can guarantee.
**Related**: [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md), [The Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md), [The Recursion of Self-Design](./THE_RECURSION_OF_SELF_DESIGN.md).

---

## The claim

Every mechanism can capture some cases of unfairness but not all. The cases it doesn't capture are its capture surface. This is a structural property, not a design deficiency — it's the mechanism-design analog of Gödel's incompleteness theorems.

Consequences:
- There is no complete fairness mechanism.
- Every mechanism has out-of-scope extraction vulnerabilities.
- Adding complexity to capture more cases introduces new out-of-scope cases elsewhere.
- Design humility is not cultural softness — it's mathematical necessity.

## The Gödel parallel

Gödel: any sufficiently expressive formal system contains true statements it cannot prove within itself. Completeness and consistency are incompatible; you must pick at most one.

Mechanism-design corollary: any sufficiently expressive fairness mechanism contains unfair outcomes it cannot prevent within itself. Completeness (captures all unfairness) and implementability (can actually be coded and run) are incompatible; you must pick at most one.

The parallel is not mere analogy. Both arise from the same underlying structural fact: self-referential systems that are powerful enough to describe themselves must leave some self-descriptions outside their descriptive power. A fairness mechanism powerful enough to describe all unfairness would have to describe its own failure modes, which creates an infinite regress unless the mechanism is incomplete somewhere.

## Why it matters

Many DeFi projects market themselves as "fully fair" or "trustless" or "eliminates X" where X is some failure mode. Substrate incompleteness says these claims are, strictly, impossible. The honest version is: "captures case A, B, C; does not capture case D, E, F; case D has mitigation M1, case E has M2, case F is accepted out-of-scope."

VibeSwap's design documents aim to be honest in this way. This doc explicitly names where the mechanisms have capture surfaces, not to undermine confidence but to set correct expectations.

## The incompleteness surfaces in VibeSwap

### Surface 1 — The `v(S)` estimation gap

Shapley distribution depends on the characteristic function `v(S)`. `v(S)` is inherently estimated — different observers will produce different estimates. The gap between true `v(S)` (unknowable in general) and estimated `v(S)` is the first incompleteness surface.

Mitigation: multiple estimation paths (peer attestation, tribunal, governance) with cross-validation. Doesn't close the surface; makes estimation errors harder to concentrate in a single attacker's favor.

### Surface 2 — The unmeasured contribution

Any mechanism records observable contributions. Unobserved contributions (negative space, prevented-disasters, continuity-maintenance, emotional labor) go unrecorded. The [Attribution Problem Gap 3](./THE_ATTRIBUTION_PROBLEM.md) captures this.

Mitigation: [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) enables more types of contributions to be recorded. Doesn't close the surface; some work is inherently unobservable.

### Surface 3 — The coalition beyond mechanism reach

Augmented mechanisms address extraction within their scope. A coalition operating outside the mechanism — coordinating off-chain, using external leverage, or operating at a time-scale longer than the mechanism's memory — bypasses the mechanism's checks.

Example: a well-resourced adversary who patiently accumulates DAG trust over 3 years specifically to eventually execute a single attribution-capture attack. The mechanism can't detect "accumulating for a future attack" — only the attack itself.

Mitigation: governance as an out-of-band check; tribunal as a legal-equivalent; community vigilance. None is internal to the mechanism.

### Surface 4 — The value-function mismatch

The cooperative-game formalism assumes contributors are optimizing against a shared value function `v`. In practice, contributors have heterogeneous value functions — some optimize for money, some for reputation, some for impact, some for craft. The mechanism can only optimize for the aggregate that `v` represents; individual misalignments are out-of-scope.

Mitigation: the [three-token economy](./WHY_THREE_TOKENS_NOT_TWO.md) gives contributors multiple dimensions to optimize along (monetary via JUL, governance via VIBE, substrate-ownership via CKB-native). Closer to multi-dimensional contributor utility, but still incomplete.

### Surface 5 — The ETM-blindness to phenomenal states

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) maps cognitive-economic processes to on-chain. It does not map phenomenal consciousness, affect, embodiment. Mechanisms that inadvertently trigger phenomenal harm (attention extraction, shame-based engagement loops, dignity erosion) can pass the ETM-alignment audit while still being harmful.

Mitigation: [P-000 (Fairness Above All)](./LAWSON_CONSTANT.md) as a constitutional override; "dignity" as a design criterion even where ETM doesn't explicitly measure it.

## The composition problem

You might hope to close incompleteness surfaces by composing multiple mechanisms: mechanism A captures cases X and Y; mechanism B captures cases Z and W; composing gives X ∪ Y ∪ Z ∪ W. Progress, right?

Partly. But composition introduces new surfaces — interactions between A and B that neither mechanism alone captures, per [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md). Adding mechanisms is not monotonic progress toward completeness; each addition opens some cases and creates new ones.

The honest framing: design is asymptotic approach, never reach.

## Design implications

### Implication 1 — Default to explicitly scoped claims

Instead of "VibeSwap eliminates MEV", say "VibeSwap eliminates block-ordering MEV structurally (commit-reveal + uniform price), mitigates oracle-manipulation MEV economically (stake + slashing), and accepts residual informational asymmetry as out-of-scope for mitigation by the current mechanism set".

The longer statement is more accurate and more usable. Adversaries who read the short statement overestimate protection; those who read the long statement get an accurate threat model.

### Implication 2 — Track capture surfaces as first-class artifacts

Maintain a public list: for each mechanism, the known capture surfaces. Update as new surfaces are discovered. Rank by severity.

This is the [RSI backlog](../memory/project_rsi-backlog.md) discipline applied at the architectural level — honest about what the current stack doesn't catch.

### Implication 3 — Resist "one more mechanism will close it"

The asymptotic nature of design means adding mechanisms doesn't converge to complete coverage. At some point, adding is strictly worse than accepting — the composition complexity exceeds the marginal coverage gain. Know where to stop.

Governance and tribunal are the "human-in-the-loop" backstops for residual surfaces. They are not a failure of the mechanism; they are the correct acknowledgment that some things need to be handled out-of-band.

### Implication 4 — Name the surfaces publicly

An adversary can discover capture surfaces by attack. A defender knows them by design. If the defender names them publicly, defenders and adversaries start at the same information level — which is where defenders have structural advantages (patient design, collaborative analysis).

Hiding surfaces = pretending the mechanism is complete = adversarial advantage. Naming = honesty about incompleteness = defender advantage over time.

## The positive flip

Incompleteness sounds like defeat. It isn't. A few positive framings:

- **Design is living.** If mechanisms could be complete, design would be a one-shot problem. Incompleteness makes design an ongoing discipline — which matches how cooperative production actually works.
- **Humility scales.** Systems that acknowledge their limits invite collaboration to extend them. Systems that claim completeness discourage the inspection that would reveal problems.
- **Diversity has room.** Different mechanisms capture different surfaces. Multiple honest mechanisms composed thoughtfully cover more ground than one dishonest "complete" mechanism.
- **External checks become legitimate.** If no mechanism is complete, governance and social oversight are not admissions of failure — they're correct architectural components.

## Relationship to the Cave Philosophy

The [Cave Philosophy](../.claude/CLAUDE.md) says: Tony Stark built Mark I in a cave with scraps. The iteration from Mark I to Mark LXXXV isn't moving toward a complete suit (there is no complete suit); it's moving through a series of suits, each addressing the limitations of the prior, with new limitations of their own.

VibeSwap's mechanism stack is the same. v1 deploys with known surfaces. v2 closes some, opens others. v3 iterates. There is no v∞ that's complete — and that's OK, because the iteration itself is valuable.

## Relationship to Augmented Governance

[Augmented Governance](./AUGMENTED_GOVERNANCE.md) Physics > Constitution > Governance. Each layer handles surfaces the other layers don't. Physics (math invariants) handles the structural cases. Constitution (axioms) handles cases Physics can't enumerate. Governance (votes) handles cases Constitution doesn't anticipate.

The three-layer architecture IS incompleteness accepted: no single layer is complete, so three layers cover different surfaces and defer to each other for residuals.

## Open research

1. **Formalize the incompleteness theorem for mechanism design.** Is there a crisp theorem stating "no mechanism M captures all extraction in cooperative games with property X"?
2. **Bound the rate of surface-discovery.** How often do new surfaces appear as the system grows? This informs how much capacity to leave for governance response.
3. **Compare completeness tradeoffs.** Given two mechanisms with different incompleteness profiles, when should you pick one over the other? Is there a meta-principle?

Each is a research direction, not a settled answer.

## One-line summary

*Every mechanism has capture surfaces; no mechanism is complete; design is asymptotic approach, never reach — substrate incompleteness is a mathematical property, not a deficiency. Honesty about which surfaces exist is a security property.*
