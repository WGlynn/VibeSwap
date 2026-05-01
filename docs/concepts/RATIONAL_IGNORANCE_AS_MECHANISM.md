# Rational Ignorance as Mechanism

**Status**: Public-choice theory applied to on-chain governance + attestation.
**Audience**: First-encounter OK. Math walked with specific cost estimates.

---

## Start with your own voting history

Have you voted in a national election? A local election? A corporate vote? An online poll?

Did you deeply research each candidate / issue / option? Or did you go with a heuristic — party line, friend's recommendation, gut feel?

Most of us use heuristics. Most of us don't invest hours of research per vote. And we're usually correct to — there's a specific economic reason.

## The calculation

Anthony Downs, economist, 1957. Proposed:

A voter's decision to invest in being informed is economically rational when:

```
cost of being informed < benefit to voter from informed vote
```

Let's run the math for a typical voter.

**Cost of being informed on a proposition**:
- Read background (30 min).
- Consider multiple perspectives (30 min).
- Understand implications (30 min).
- Total: ~90 min.

**Monetary value**: at $20-50/hour (median earnings), 90 min = $30-75 in labor cost.

**Benefit of being correctly informed**:
- Voter's vote is one of millions.
- Probability vote changes outcome: ~1 in 10M for state/national, 1 in 10K for local.
- Voter's share of outcome benefit: tiny.

**Expected benefit**: perhaps pennies in expected value.

**Conclusion**: for any specific vote, rational cost-benefit says DO NOT research. Use heuristics.

This is rational ignorance. It's not laziness — it's equilibrium outcome of a specific information-economy.

## Why this is a PROBLEM for governance systems

Most governance systems assume informed participation. They design for the "rational engaged voter" who researches and votes.

Rational ignorance says this voter is rare. Actual voter participation is mostly heuristic-driven.

Consequences:
- Outcomes determined by: whoever CARES most (highly-invested minority).
- Or whoever pays attention for NON-ECONOMIC reasons (ideologues, enthusiasts).
- Or default heuristics (status quo bias, whoever-sounds-best, whoever-paid-for-ads).

NOT "informed broad-based consent."

## Applied to VibeSwap attestation

Same calculus applies to attestations. A potential attestor evaluating whether a claim is meritorious faces:

**Cost to be informed**:
- Read issue body (5 min).
- Verify evidence (15 min).
- Consider context (10 min).
- Total: ~30 min of labor.

**Monetary value of 30 min**: $50-200 depending on opportunity cost.

**Benefit from correct attestation**:
- Fraction of the Shapley share weighted by this attestation's impact on aggregate weight.
- For 1-of-50 attestations on a claim with modest Shapley value ($100): expected marginal benefit per attestation ~$2.

**Result**: cost ($50-200) >> benefit ($2). Rational individual response: skim or abstain.

Collectively: attestations become ceremonial. Shallow rubber-stamps or no-participation. Gaming-resistance weakens.

## Design responses

If rational ignorance is inevitable, governance systems must design AROUND it, not against it. Four responses:

### Response 1 — Align incentives (pay for thoroughness)

If the attestor who invests 30 min of careful review gets additional reward, calculation flips.

**VibeSwap implementation**:
- `previewAttestationWeight` — shows attestor their effective weight before committing.
- Trust-weighted multipliers — high-trust attestors' votes count for more → per-attestation benefit is higher for them → rational to invest.

**Limitation**: only works if "thoroughness" is measurable. [Goodhart's Law](./THE_OBSERVER_EFFECT_IN_ATTESTATION.md) bites here too.

### Response 2 — Delegate to informed (expert proxies)

Most attestors delegate to small number of "expert" attestors who are paid for work. Experts care because they're paid; delegators get representation without individual investment.

**VibeSwap implementation**: partial via trust-weighting. High-trust attestors effectively serve as delegates.

**Limitation**: expert-delegate capture. If small group of experts gains delegation, they can be lobbied or bribed.

### Response 3 — Reduce the cost of informedness

Make information legible. Canonical issue templates + traceability chains + closing comments.

**VibeSwap implementation**: [Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md) canonical format reduces per-attestation evaluation cost from ~30 min to ~5 min.

**Effectiveness**: high — cost side of equation reduced dramatically.

### Response 4 — Accept and design around

Design mechanisms that DON'T ASSUME informed participation.

- Rely on aggregate votes across many shallow reviewers to wash out noise.
- Tribunal escalation for cases where shallow review is insufficient.
- Governance override for meta-level issues.

**VibeSwap implementation**: three-branch architecture explicitly:
- Executive branch — rational-ignorance-compatible. Many shallow votes aggregate.
- Judicial branch — rational-ignorance-bypass. Tribunal jurors compensated + random-selected.
- Legislative branch — rational-ignorance-override. Governance participants highly invested.

This is the most robust response. Doesn't fight human nature.

## Walk through a specific scenario

Let me show how these four responses compose.

### A claim is submitted

Alice submits a claim about Bob's contribution. Claim needs attestations to accept.

### Rational-ignorance response

Most potential attestors skim the issue, form quick impression. Don't invest 30 min per vote.

### Executive branch handles it

Many shallow attestations roll in. Each is weighted by trust × multiplier. Aggregate signals whether the claim has support.

Gaming attempt (Alice creates sockpuppets to inflate attestations): harder because sockpuppets have low trust-weight. Shallow-vote aggregation washes out low-trust noise.

Accepted if aggregate > threshold.

### If contested

Dave contests the claim. Now it's not rolling to auto-accept. Escalates to tribunal.

Tribunal jurors are compensated (say, $200 per claim). At $200, rational-ignorance calculation flips. Jurors invest 30 min to evaluate thoroughly. Their verdict is informed.

### If exceptional

Tribunal verdict is disputed at governance level. Legislative branch engages. Governance participants are highly-invested (token holders); they care intrinsically.

Rational-ignorance handled at each branch appropriately.

## The three-branch re-framing

Viewed through rational ignorance:

- **Executive branch** — rational-ignorance-compatible. Many shallow votes aggregate; high volume compensates for low depth.
- **Judicial branch** — rational-ignorance-bypass. Tribunal jurors compensated; they invest in depth because paid.
- **Legislative branch** — rational-ignorance-override. Governance participants highly-invested; they care intrinsically.

The three-branch architecture is not arbitrary. Designed so different branches handle different ignorance-profiles. Populous + shallow, small + deep, invested + strategic. Each does its job.

## The cost of high attestor burden

If attestation becomes too burdensome, no one does it. Mechanism relies on attestations firing; rational-ignorance equilibrium could kill the protocol.

Mitigations:
- Keep attestations lightweight (fast path, easy UX).
- Reward meaningful participation explicitly.
- Make skipping explicitly costly only in high-stakes cases.
- Accept that 80% of claims will get rubber-stamp attestations; design so rubber-stamping is still FAIR for typical claims.

The last is most important. A mechanism requiring deep attention for every decision fails. A mechanism with fast paths for typical cases + depth for exceptions succeeds.

## Rational ignorance in governance voting

Token-weighted voting especially prone to rational ignorance. Someone with 0.01% of tokens is rationally indifferent to whether they vote informed.

Quadratic voting partially addresses this (diminishing returns for concentration), but even with quadratic voting, rational-ignorance pressure remains.

VibeSwap's responses:
- **Quadratic voting** first layer — reduces whale-capture.
- **Proposal structure** — proposals must include Source + rationale + expected outcome + reversibility. Reduces evaluation cost.
- **Expert delegation (partial)** — via trust-weighting, high-trust attestors' votes matter more.
- **Augmented governance hierarchy** — Physics + Constitution override governance, so governance errors are bounded in blast radius.

None eliminates rational ignorance. All reduce its harm.

## Honest marketing

Don't claim: "VibeSwap's governance is fully-informed broad-based consent."

Do claim: "VibeSwap's governance is structured to handle rational ignorance — aggregating shallow votes at Executive, investing deeply at Judicial, concentrating influence among long-term participants at Legislative."

This is defensible. First is a claim nobody's governance can honor.

## Interaction with attention economy

Rational ignorance is a specific attention-allocation pattern: allocate attention to activities where marginal benefit exceeds marginal cost. For one-off attestations, benefit side is too low.

But attestation over time can compound. An attestor who builds reputation for accurate attestations sees their trust-score rise and their per-attestation benefit rise. For sustained-participation attestors, the calculation flips.

**Implication**: rational-ignorance equilibrium is worst for casual one-time attestors, least-bad for sustained participants. Mechanism design should IMPLICITLY FAVOR sustained participation.

VibeSwap does this: trust compounds with attestation accuracy over time. Long-term attestors accumulate advantage; short-term rubber-stampers don't.

## Relationship to ETM

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), rational ignorance is a cognitive-economic equilibrium. Attention is scarce, decisions are many, most decisions don't justify full attention. Humans evolved heuristics (gut feel, pattern-match, defer-to-expert) that navigate this economy well.

VibeSwap's architecture mirrors these heuristics on-chain. Trust-delegation = defer-to-expert. Pattern-matching = shallow fast evaluation. Tribunal escalation = reach for deep attention when it matters.

Not fighting cognitive economy; implementing it.

## For students

Exercise: track your own voting/attestation-like decisions for a week. Note:

1. How much effort did you invest per decision?
2. Were you rationally ignorant?
3. Did your heuristic-decision turn out correct (can you check retroactively)?

Most of us make 80-90% heuristic decisions. That's rational. The meta-question is: are we in systems that exploit or respect our rational-ignorance?

## One-line summary

*Rational ignorance is equilibrium outcome of information-economy — informed participation costs more than it benefits per-decision at scale. VibeSwap's three-branch architecture handles this: Executive (populous-shallow aggregation) + Judicial (compensated-deep tribunal) + Legislative (invested-strategic governance). Doesn't fight human nature; designs around it. Trust compounds over time, favoring sustained participants.*
