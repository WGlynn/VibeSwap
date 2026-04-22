# Rational Ignorance as Mechanism

**Status**: Public-choice theory applied to on-chain governance and attestation.
**Depth**: Why informed participation is economically irrational, and design patterns that work with (not against) that reality.
**Related**: [Augmented Governance](./AUGMENTED_GOVERNANCE.md), [The Observer Effect in Attestation](./THE_OBSERVER_EFFECT_IN_ATTESTATION.md), [Why Three Tokens Not Two](./WHY_THREE_TOKENS_NOT_TWO.md).

---

## The observation

Anthony Downs, 1957: a voter who votes is rational to invest less in being informed than the benefit of voting correctly. The probability that any single vote changes the outcome is tiny; the cost of being well-informed is real. Rational voters stay shallow.

This isn't laziness. It's the equilibrium outcome of a specific information-economy. In any large-N voting system, the marginal benefit of deeper information collapses as N grows.

Applied to VibeSwap: the same calculus applies to attestations. A potential attestor evaluating whether a claim is meritorious must invest in understanding the claim's substance. For a single attestation's weight, that investment is almost never cost-effective. Rational attestors stay shallow — they skim, pattern-match, or abstain.

This looks like a bug. Design-for-reality says treat it as a feature to design around.

## Why this matters

Governance and attestation systems assume informed participation. If participants are rationally ignorant, the assumption fails. Outcomes are then determined by:

- Whoever cares most (irrational or highly-invested — e.g., proposers themselves)
- Whoever pays attention for non-economic reasons (ideologues, enthusiasts)
- Shallow pattern-matchers who default to heuristics

Not necessarily bad, but not "broad-based informed consent" either. Honest framing matters.

## The calculation

For a single attestation decision:

- Cost to become informed: read the issue body (5 min) + verify evidence (15 min) + consider context (10 min) = 30 min of labor.
- Monetary value of 30 min: $50-$200 depending on contributor's opportunity cost.
- Benefit from correct attestation: fraction of the Shapley share weighted by this attestation's impact on the aggregate weight.
- For 1-of-50 attestations on a claim with modest Shapley value ($100): expected marginal benefit per attestation ~= $2. Far below cost.

Rational individual response: skim or abstain.

Collective consequence: attestations become ceremonial; shallow rubber-stamps or no-participation. Gaming-resistance weakens because the gamers care and the non-gamers don't.

## Four design responses

### Response 1 — Align incentives

Pay attestors for thoroughness. If the attestor who invests 30 min of careful review gets additional reward (e.g., higher Shapley share for thoroughly-verified claims), the calculation flips.

VibeSwap implementation: `previewAttestationWeight` — shows the attestor their effective weight before they commit. Plus: trust-weighted multipliers mean high-trust attestors' votes count for more, increasing their per-attestation benefit.

Limitation: this only works if "thoroughness" is itself measurable. [Goodhart](./THE_OBSERVER_EFFECT_IN_ATTESTATION.md) bites here too.

### Response 2 — Delegate to informed

Build a delegation system: most attestors delegate to a small number of "expert" attestors who are paid for the work. The experts care because they're paid; the delegators get representation without individually investing.

VibeSwap implementation: partial, via trust-weighting. High-trust attestors are effectively delegates — their weight represents their past accuracy. But delegation is implicit; no explicit proxy.

Limitation: expert-delegate capture. If a small group of experts gains delegation, they can be lobbied or bribed; delegation centralizes power.

### Response 3 — Reduce the cost of informedness

Make the information legible. Clear issue templates ([Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md)) reduce the cost of evaluation. Evidence hashes link to preservation. Closing comments summarize resolution.

VibeSwap implementation: canonical format for issues, commits, closing comments. A reviewer can evaluate substance in 5 min instead of 30.

Effectiveness: high for reducing the cost side of the equation. Doesn't eliminate rational ignorance but moves the threshold.

### Response 4 — Accept and design around

If rational ignorance is inevitable, design mechanisms that don't assume informed participation. Rely on:

- Aggregate votes across many shallow reviewers to wash out noise.
- Tribunal escalation for cases where shallow review is insufficient.
- Governance override for meta-level issues that require depth.

VibeSwap implementation: three-branch architecture. Executive branch (peer attestation) is where rational-ignorance drives shallow voting; tribunal (judicial) is where depth can be invoked; governance (legislative) is the depth-reservoir.

This is the most robust response because it doesn't fight human nature.

## The three-branch re-framing

Viewed through rational ignorance:

- **Executive branch** — rational-ignorance-compatible. Many shallow votes aggregate; high volume compensates for low depth.
- **Judicial branch** — rational-ignorance-bypass. Tribunal jurors are compensated and random-selected; they invest in depth because they're paid.
- **Legislative branch** — rational-ignorance-override. Governance participants are highly-invested (token holders with significant stake); they care intrinsically.

The three-branch architecture is not arbitrary. It's designed so different branches handle different ignorance-profiles. Executive is populous + shallow; judicial is small + deep; legislative is invested + strategic.

## The cost of high attestor burden

If attestation becomes too burdensome, no one does it. The mechanism relies on attestations firing; rational-ignorance equilibrium could kill the protocol.

Mitigations:
- Keep attestations lightweight (fast path, easy UX).
- Reward meaningful participation explicitly.
- Make skipping explicitly costly only in high-stakes cases.
- Accept that 80% of claims will get rubber-stamp attestations; design so rubber-stamping is still fair for typical claims.

The last is the most important. A mechanism that requires deep attention for every decision fails. A mechanism that has fast paths for typical cases and depth for exceptions succeeds.

## Rational ignorance in governance

Token-weighted governance voting is especially prone to rational ignorance. Someone with 0.01% of tokens is rationally indifferent to whether they vote informed. Quadratic voting partially addresses this (diminishing returns for concentration), but even with quadratic voting, the rational-ignorance pressure remains.

VibeSwap's responses:

- **Quadratic voting** as the first layer — reduces whale-capture, gives informed small-holders relative advantage.
- **Proposal structure** — proposals must include Source + rationale + expected outcome + reversibility. Reduces evaluation cost.
- **Expert delegation** (partial) — via trust-weighting, high-trust attestors' votes matter more.
- **Augmented governance hierarchy** — Physics + Constitution override governance, so governance errors are bounded in blast radius.

None eliminates rational ignorance. All reduce its harm.

## The interaction with attention economy

Rational ignorance is a specific attention-allocation pattern: allocate attention to things where the marginal benefit exceeds the marginal cost. For most one-off attestation decisions, the benefit side is too low.

But attestation over time can compound. An attestor who builds reputation for accurate attestations sees their trust-score rise and their per-attestation benefit rise accordingly. For sustained-participation attestors, the calculation flips.

Implication: the rational-ignorance equilibrium is worst for casual one-time attestors and least-bad for sustained participants. Mechanism design should implicitly favor sustained participation to shift the population toward less-rationally-ignorant.

VibeSwap does this: trust compounds with attestation-accuracy over time. Long-term attestors accumulate advantage; short-term rubber-stampers don't.

## Honest marketing

Don't claim: "VibeSwap's governance is fully-informed broad-based consent."

Do claim: "VibeSwap's governance is structured to handle rational ignorance — aggregating many shallow votes at the executive branch, investing deeply at the tribunal branch, concentrating influence among long-term participants."

This is a defensible architectural claim. The first is a claim nobody's governance can honor.

## Relationship to ETM

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), rational ignorance is a cognitive-economic equilibrium: attention is scarce, decisions are many, most decisions don't justify full attention. Humans have evolved heuristics (gut feel, pattern-match, defer-to-expert) that navigate this economy well.

VibeSwap's architecture mirrors these cognitive heuristics on-chain. Trust-delegation = defer-to-expert. Pattern-matching = shallow but fast evaluation. Tribunal escalation = reach for deep attention when it matters.

Not fighting the cognitive economy; implementing it.

## Open questions

1. **Optimal attestation UX** — how much information is the right amount to show an attestor? Too little → superficial; too much → overwhelms.
2. **Delegation market** — should VibeSwap have explicit delegation primitives, or rely on implicit trust-weighting?
3. **Rational-ignorance metrics** — can we measure the mean depth-of-attention-per-attestation over time? Alert on decline?

## One-line summary

*Rational ignorance is inevitable at large N — informed participation costs more than it benefits per-decision. VibeSwap's three-branch architecture accepts this: populous-shallow executive + small-deep tribunal + invested-strategic legislative; don't fight human nature, design around it.*
