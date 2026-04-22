# The Observer Effect in Attestation

**Status**: Goodhart's Law applied to attestation mechanisms.
**Depth**: Where measuring contributions distorts what gets contributed, and how to design around it.
**Related**: [ContributionAttestor Explainer](./CONTRIBUTION_ATTESTOR_EXPLAINER.md), [Shapley Reward System](./SHAPLEY_REWARD_SYSTEM.md), [Substrate Incompleteness](./SUBSTRATE_INCOMPLETENESS.md).

---

## Goodhart's Law, stated

*When a measure becomes a target, it ceases to be a good measure.*

Charles Goodhart, 1975. Originally observed in monetary policy: when a central bank targets M1 money supply, the market adjusts to game M1 without affecting the underlying economic variable M1 was supposed to represent.

The generalization (Marilyn Strathern): *When a metric is used to govern, it distorts what it measures.*

Applied to VibeSwap: the moment attestation-weight is used to allocate rewards, contributors will optimize for attestation-weight, not for the underlying cognitive-economic contributions that attestation-weight was supposed to measure.

## Why this is inevitable

Goodhart's Law is not a contingent feature of particular mechanisms — it's a structural feature of any measurable-and-incentivized metric. The logic:

1. Metric M measures property P.
2. System rewards high-M.
3. Rational agents optimize for high-M.
4. Optimizing for high-M produces different behavior than optimizing for P (because M is a proxy, not P itself).
5. Over time, the distribution of M drifts away from representing the distribution of P.

The only escape is to make M = P exactly. For most P worth incentivizing, this is uncomputable (see [The Uncomputable Marginal](./THE_UNCOMPUTABLE_MARGINAL.md)). So Goodhart's Law bites every real mechanism.

## VibeSwap-specific Goodhart pressures

### Pressure 1 — Attestation-weight gaming

Attestation weight is computed from trust × multiplier. Rational contributors maximize by accumulating handshakes with high-trust nodes, building trust-score, and appearing in many attestations.

If this produces more cooperative-production (the underlying P), great. If it produces shallow reciprocity (I attest your claim, you attest mine, neither contribution is substantive), the metric has drifted.

Observed in similar systems: cross-attestation rings where a small group of users mutually attest to inflate each other's weights.

### Pressure 2 — Contribution-type gaming

9 contribution types. Different types may have different Shapley value distributions. Rational contributors focus on the type that pays best per unit effort.

If Code is highly rewarded but Design is not, contributors shift toward Code even when Design would have been their comparative advantage. Result: a stack of mediocre Code with insufficient Design — not what was incentivized.

### Pressure 3 — Evidence-hash gaming

The evidenceHash commits to off-chain content. Rational contributors might commit to content that looks substantive (long, complex) without actually creating value. The hash can't evaluate content quality.

Observed in similar systems: content-length optimization, fancy-formatting optimization, keyword-stuffing — all of which increase apparent-substance without increasing real-substance.

### Pressure 4 — Lineage-depth gaming

ParentAttestations create lineage. Contributors benefit from being cited as a parent. Rational contributors try to position their contributions as load-bearing predecessors — writing the "first" on a topic, making claims that later work has to cite.

If this produces genuine precedent-setting work, great. If it produces race-to-claim-a-topic without substantive depth, the lineage structure is distorted.

## The design toolkit

VibeSwap's architecture includes several anti-Goodhart primitives:

### Tool 1 — Multiple branches

[Three-branch attestation](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) means gaming one branch (executive peer-attestation) doesn't capture the others (judicial tribunal, legislative governance). Gaming becomes exponentially harder when three independent measures must all be spoofed.

Effectiveness: high for gross gaming, medium for subtle gaming. Sophisticated actors can still bias the executive branch while staying out of tribunal and governance scope.

### Tool 2 — Quadratic weighting

Quadratic voting in the legislative branch diminishes returns for coordinated voting. If 10 sockpuppets each vote 100 units, they achieve `sqrt(10 × 100) = 31.6`, not 1000. Gaming becomes expensive.

Effectiveness: high for Sybil-style gaming, limited for coordinated-non-Sybil gaming (e.g., a small group of real-identity actors coordinating).

### Tool 3 — Novelty bonus ([Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md))

Rewards early-novel contributions super-linearly and replicated contributions sub-linearly. Makes pattern-matching to recent-high-reward-contributions progressively less rewarding.

Effectiveness: medium. Novelty-detection is itself a metric; can be Goodharted (people optimize for novelty-detector outputs rather than actual novelty).

### Tool 4 — Tribunal escalation

Disputed attestations can escalate to tribunal for jury-based adjudication. The jury is randomly selected from a high-trust pool, reducing the ability of any single gaming attempt to consistently influence outcomes.

Effectiveness: high for case-specific gaming, low for meta-gaming (e.g., influencing the jury-pool selection).

### Tool 5 — Governance override

Ultimate supreme authority can override any attestation. Reserved for systemic-drift cases.

Effectiveness: absolute in principle, political in practice. Governance itself can be Goodharted (vote-buying, proposal-ordering).

## The fundamental asymmetry

No single tool prevents Goodharting. The composition of tools makes Goodharting harder but not impossible. Substrate Incompleteness ([`SUBSTRATE_INCOMPLETENESS.md`](./SUBSTRATE_INCOMPLETENESS.md)) applies: every mechanism has gaming surfaces.

The asymmetry VibeSwap aims for: **defenders (honest contributors + governance) have structural advantages over attackers (Goodharting actors)**. Specifically:

- Defenders see all branches; attackers must fool multiple.
- Defenders have time-integrating audits; attackers have to maintain the gaming across rounds.
- Defenders have higher-level governance; attackers can't modify governance without exposure.

The asymmetry doesn't eliminate Goodharting. It makes the cost/benefit unfavorable for most adversaries most of the time.

## Reverse-Goodhart — designing for misaligned optimization

Design principle: if contributors WILL optimize for the metric, pick metrics whose optimization produces desirable behavior.

Example: "Reward number of handshakes" produces social butterflies. Not useful. "Reward number of handshakes weighted by partner's trust-score" produces deliberate cultivation of high-trust relationships — closer to what we want.

Example: "Reward attestations received" produces spammy self-promotion. "Reward attestations received weighted by attestor's trust and type-diversity" produces multi-type cross-substrate collaboration — closer to what we want.

The iteration of metric design: propose a metric; predict how it gets Goodharted; modify to make the Goodharting produce good behavior; repeat.

## The honesty-in-framing implication

A transparent mechanism documents:
- The metrics that drive rewards.
- The known Goodhart pressures on each.
- The known mitigations.
- The residual gaming surfaces.

Don't claim a mechanism is "Goodhart-proof". Claim it has "specific Goodhart surfaces with specific mitigations". This is honest about limits while maintaining confidence in the overall design.

## The social-epistemology dimension

Goodharting is not just individual behavior — it can become collective norms. If "building attestation weight" is celebrated as smart participation, more people do it. Culture reinforces Goodharting.

Counter-culture: celebrate substantive contribution. Make attestation-weight visible but secondary. Emphasize [Lawson Constant](./LAWSON_CONSTANT.md) attribution as the goal (who really did this?), not Shapley percentage as the goal (who got how much?).

This is cultural design, not mechanism design. Both matter.

## Relationship to cognitive economy

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive self-measurement also has Goodhart dynamics. If you measure yourself by book-pages-read, you read superficially-many. If you measure yourself by productive-hours, you schedule meetings to fill time. Each measure distorts the activity it measures.

Cognition's response: periodically reframe what "productive" means. Introspection updates the measure. This prevents long-term Goodhart drift.

VibeSwap's governance has the same role. Periodic governance updates to attestation weighting, Shapley parameters, and tribunal criteria are the on-chain analog of cognitive reframing.

## Open questions

1. **Can we detect Goodharting via DAG-topology signatures?** Spam-attestation rings have characteristic graph shapes; can we automatically flag?
2. **What's the optimal governance-update cadence?** Too frequent and the system is unstable; too rare and Goodharting entrenches.
3. **Are there Goodhart-immune metrics?** Almost certainly not in general, but some metrics degrade more slowly than others.

## One-line summary

*Goodhart's Law is structural — every measurable-incentivized metric distorts what it measures. VibeSwap's composed tools (three-branch + quadratic + novelty + tribunal + governance) make gaming exponentially harder without eliminating it; honesty about residual surfaces is the correct stance.*
