# The Observer Effect in Attestation

**Status**: Goodhart's Law applied with concrete gaming scenarios + counter-moves.
**Audience**: First-encounter OK.

---

## Goodhart's Law — a short history

In 1975, British economist Charles Goodhart made an observation about central banks. When a central bank chose "M1 money supply" as a target to control, the market adjusted around it. M1 stopped correlating with the underlying economic health it was supposed to indicate. The metric became a target; the correlation broke.

Marilyn Strathern generalized: *"When a measure becomes a target, it ceases to be a good measure."*

Modern examples:
- Schools teach to the standardized test (test score becomes a target; doesn't measure actual learning anymore).
- Researchers publish for citation count (citation count becomes a target; research quality doesn't necessarily improve).
- Tech workers aim for performance-review metrics (metrics become a target; actual work quality can degrade).

This is the observer effect applied to measurement. The act of measuring changes what's measured.

## Applied to VibeSwap

VibeSwap's attestation mechanism weights trust × multiplier. Users contributing earn credit based on attestations. Attestations from high-trust users count more.

The moment this becomes visible as a reward system, rational contributors will optimize for it. They will work on things that earn attestations. They will seek attestations from high-trust users. They will accumulate handshakes.

This is fine IF optimizing for the metric produces the behavior we want (good contributions → attestations → rewards). If NOT, Goodhart fires: people optimize for attestation-shaped work rather than actually-good work.

## The four Goodhart pressures on VibeSwap

### Pressure 1 — Attestation-weight gaming

Contributors try to accumulate attestation weight directly — not by producing valuable work, but by working the system.

**Concrete gaming scenario**: Alice and Bob form a "handshake ring." They mutually attest each other's claims. Their trust-scores rise rapidly because they each get a high-weight attestation per claim.

**Why this gets through**: plain attestation-weight would reward them equally to legitimately-high-trust contributors.

**Counter-move**: quadratic voting (smaller weight per additional vote from same source). Random selection for tribunals bypasses coordinated-attestation. Three-branch capture-resistance means their executive-branch gaming doesn't carry to tribunal or governance.

**Residual gaming possible**: 2-3 person rings that stay below detection. Small value extracted; acceptable residual.

### Pressure 2 — Contribution-type gaming

Different contribution types (Code, Research, Security, etc.) may have different payoff curves. Contributors will gravitate to the types that pay best per unit effort.

**Concrete gaming scenario**: Code contributions are highly rewarded. Design contributions are less so. Contributors shift toward Code even when their comparative advantage is in Design. Result: lots of mediocre Code; insufficient Design.

**Counter-move**: the heterogeneity mandate (see [Cooperative Emergence Threshold](../../concepts/ai-native/COOPERATIVE_EMERGENCE_THRESHOLD.md)) — Shannon entropy of contribution types must remain high. Governance can adjust payoff curves per type to restore balance.

**Residual gaming possible**: within a single type, contributors still game relative payoffs.

### Pressure 3 — Evidence-hash gaming

evidenceHash commits to off-chain content. Rational contributors might commit to content that looks substantive (long, complex, impressive) without actually creating value.

**Concrete gaming scenario**: Alice submits a "security audit" that's really 50 pages of pseudo-formal prose with few actual findings. Looks substantive; doesn't prevent real bugs.

**Why this gets through**: the evidenceHash verifies content exists but doesn't evaluate quality.

**Counter-move**: peer attestations evaluate quality. Tribunal re-evaluation for disputed claims. Multi-branch requirements prevent pure-evidence-hash capture.

**Residual gaming possible**: novice reviewers might be fooled by surface-substantive content. Takes time for community to develop detection.

### Pressure 4 — Lineage-depth gaming

ParentAttestations create lineage. Contributors benefit from being cited as a parent. Rational contributors position themselves as load-bearing predecessors.

**Concrete gaming scenario**: Alice claims her 2022 Telegram message was the foundational inspiration for Bob's 2026 breakthrough. She retroactively claims lineage credit for significant downstream work.

**Why this gets through**: if Alice's claim has even a modest evidence base, the lineage link gets credit.

**Counter-move**: Novelty Bonus (see [Novelty Bonus Theorem](./THE_NOVELTY_BONUS_THEOREM.md)) penalizes contributions with high similarity-to-prior. Lineage-claiming requires demonstrable influence, not just priority.

**Residual gaming possible**: subtle lineage-gaming where influence IS plausible but overstated.

## Why no single tool prevents Goodhart

Substrate Incompleteness ([`SUBSTRATE_INCOMPLETENESS.md`](../../concepts/SUBSTRATE_INCOMPLETENESS.md)) applies. Every mechanism has gaming surfaces. Composing mechanisms doesn't eliminate them; it reduces them.

The asymmetry VibeSwap aims for: defenders (honest contributors + governance) have structural advantages over attackers (Goodharting actors).

Specifically:
- **Defenders see all branches**: executive, judicial, legislative. Attackers must fool multiple.
- **Defenders have time-integrating audits**: attackers have to maintain gaming across rounds.
- **Defenders have higher-level governance**: attackers can't modify governance without exposure.

The asymmetry doesn't eliminate Goodharting. It makes the cost/benefit unfavorable for most adversaries most of the time.

## Reverse-Goodhart — designing for misaligned optimization

If contributors WILL optimize for the metric, pick metrics whose optimization produces desirable behavior.

**Example of reverse-Goodhart:**

- BAD metric: "Number of handshakes per contributor." Contributors handshake with everyone regardless of quality. Metric optimized; behavior bad.
- BETTER metric: "Handshakes weighted by partner's trust-score." Contributors pursue deliberate cultivation of high-trust relationships. Metric optimized; behavior better.

Another example:

- BAD: "Number of attestations received." Contributors seek as many attestations as possible, regardless of quality.
- BETTER: "Attestations received weighted by attestor's trust and type-diversity." Contributors pursue multi-type cross-substrate collaboration. Metric optimized; behavior substantively better.

The iteration: propose metric, predict its Goodhart, refine until Goodharting produces good behavior.

## The honesty discipline

A transparent mechanism documents:
- The metrics that drive rewards.
- The known Goodhart pressures on each.
- The known mitigations.
- The residual gaming surfaces.

Don't claim "VibeSwap's attestation is Goodhart-proof." Claim "VibeSwap's attestation has specific Goodhart surfaces with specific mitigations and acknowledged residuals."

This is honest about limits while maintaining confidence in the overall design.

## The social-epistemology dimension

Goodharting isn't just individual behavior — it can become collective norm. If "building attestation weight" is celebrated as smart participation, more people do it. Culture reinforces Goodharting.

Counter-culture: celebrate substantive contribution. Make attestation-weight visible but secondary. Emphasize [Lawson Constant](../proofs/LAWSON_CONSTANT.md) attribution as THE goal (who really did this?), not Shapley percentage as the goal (who got how much?).

This is cultural design, not just mechanism design. Both matter.

## Concrete counter-culture tactics

- Weekly "best contribution" highlight in Telegram celebrates quality, not attestation-weight.
- Public "contribution-of-the-quarter" post describes WHY a contribution was valuable (substance-focused).
- Mentor-new-contributors norm; senior members model substance-focused behavior.
- Governance discussions reference substantive examples rather than weight-statistics.

## Goodhart metrics we CAN measure

Things that indicate Goodharting has started:

- **Attestation concentration**: few contributors receiving disproportionate attestations.
- **Handshake velocity**: sudden increases in handshake rate per user (potentially ring formation).
- **Contribution-type mono-culture**: entropy drops as contributors concentrate in one type.
- **Lineage abuse**: sudden increases in "my contribution enabled this" claims.

Monitoring these via dashboards. Alerts on anomalies. Early-warning for Goodhart drift.

## For students

Exercise: think of a metric in your life (grades, GitHub stars, Twitter followers, step-count). For that metric:

1. What's it supposed to measure?
2. How do people optimize for it (what behaviors does it produce)?
3. Is the behavior good for what the metric was supposed to measure?
4. If not, what's a better metric that wouldn't Goodhart?

This exercise teaches Goodhart detection.

## Relationship to cognitive economy

Under [Economic Theory of Mind](../../concepts/etm/ECONOMIC_THEORY_OF_MIND.md), cognitive self-measurement also has Goodhart dynamics. If you measure yourself by book-pages-read, you read superficially-many. If you measure by productive-hours, you schedule meetings to fill time.

Cognition's response: periodically reframe what "productive" means. Introspection updates the measure. This prevents long-term Goodhart drift.

VibeSwap's governance has the same role. Periodic updates to attestation weighting, Shapley parameters, and tribunal criteria are the on-chain analog of cognitive reframing.

## Relationship to other primitives

- **Connected**: [Rational Ignorance as Mechanism](../../concepts/RATIONAL_IGNORANCE_AS_MECHANISM.md) — attestation-weight gaming is harder when contributors are rationally ignorant about gaming details.
- **Counter-weights**: [Novelty Bonus](./THE_NOVELTY_BONUS_THEOREM.md), [Quadratic voting](../../concepts/monetary/WHY_THREE_TOKENS_NOT_TWO.md).

## One-line summary

*Goodhart's Law — metrics used to govern distort what they measure. Four specific gaming pressures on VibeSwap (attestation-weight, contribution-type, evidence-hash, lineage-depth) with specific mitigations for each. No single tool prevents Goodharting; composition raises cost. Asymmetry favors defenders via multi-branch + time-integration + meta-governance. Reverse-Goodhart design: pick metrics whose optimization produces desirable behavior.*
