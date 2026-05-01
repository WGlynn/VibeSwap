# Cooperative Emergence Threshold

**Status**: Research memo with specific 9-15 month projection.
**Audience**: First-encounter OK. Each parameter walked with concrete state.

---

## Start with an observation about scale

If you put 5 people in a room, they can have a conversation. Decisions get made by agreement.

Put 50 people in the same room, decisions get made by small groups dominating while others watch.

Put 500 people, chaos. No coherent decisions emerge.

Something happens between 5 and 50. And something else between 50 and 500. These transitions aren't continuous — they're phase transitions.

This doc is about VibeSwap's analogous phase transition. When does cooperative intelligence EMERGE from the mechanism set? Below the threshold, the protocol executes but the collective doesn't have emergent properties. Above it, the collective exhibits self-correcting, routing, coordinating behaviors no individual has.

## The question

If VibeSwap has 100 contributors, does "cooperative intelligence" exist?

With 1,000? 10,000?

What ABOUT the 100 vs 1,000 transition makes the emergence occur?

## The Santa Fe research

Complex-systems research (Santa Fe Institute, Ostrom, Page, Axelrod, Scott) has identified a pattern: cooperative systems exhibit phase transitions. Below the transition, system = sum of parts. Above, whole > sum of parts.

The transition depends on four parameters:

1. **Connectivity** — how densely interconnected participants are.
2. **Heterogeneity** — how diverse participant types / strategies / information are.
3. **Feedback speed** — how fast system state propagates to new decisions.
4. **Institutional fit** — how well coordination mechanism matches substrate.

Each parameter has an empirically-observed threshold. Below threshold, emergence doesn't fire. Above, it does.

Meeting 3 of 4 produces degraded coordination (some emergence, some not). Meeting all 4 produces full phase transition.

## Walk through each parameter

Let me apply each to VibeSwap's current state.

### Parameter 1 — Connectivity

**Measure**: median trust-graph degree in ContributionDAG — how many handshakes per average contributor.

**Critical value**: median degree ≥ 5. Below this, small-world coordination properties don't emerge. Above, they do.

**Current state (2026-04-22)**: bootstrap phase. Median degree probably 1-3. **BELOW threshold.**

**To reach threshold**: conscious handshake facilitation. Onboarding pairs new contributors with existing ones. Events that produce handshakes. 12-18 months at current recruitment pace.

**Gap analysis**: we need ~3x growth in handshake density. Achievable.

### Parameter 2 — Heterogeneity

**Measure**: Shannon entropy of contribution-type distribution. 9 possible types (Code, Design, Research, Community, Marketing, Security, Governance, Inspiration, Other).

**Critical value**: Shannon entropy ≥ 2.5 bits. Requires meaningful presence of 5-6 types each.

**Current state**: Code + Research + Inspiration dominate. Entropy probably 1.5-2.0 bits. **BELOW threshold.**

**Concrete gap**: Design, Security, Community, Governance need more active contributors. Need targeted outreach to specific communities (design DAOs, audit firms, DAO-governance-experienced contributors).

**To reach threshold**: 9-15 months with deliberate effort.

### Parameter 3 — Feedback speed

**Measure**: time from contribution → attestation → reward distribution → future-contribution incentive.

**Critical value**: feedback loop ≤ 1 week.

**Current state**: 
- ContributionAttestor claimTTL = 1 day.
- Happy-path attestation: hours to a day.
- Tribunal escalation: days.
- Governance escalation: weeks.
- Average happy-path feedback: < 1 week.

**Result**: **ABOVE threshold** (for happy path).

**Risk**: escalation paths can extend feedback dramatically. Need to ensure escalation remains rare.

### Parameter 4 — Institutional fit

**Measure**: degree to which mechanisms match substrate geometry. [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) compliance + [Correspondence Triad](./CORRESPONDENCE_TRIAD.md) compliance.

**Critical value**: qualitative — every mechanism passes the Triad gate.

**Current state**: ~80% of mechanisms pass. Some inherited (linear NCI retention) don't. ETM Build Roadmap Gaps 1-3 address these.

**To reach threshold**: 3-6 months if Roadmap gaps ship on cadence.

### Composite

Current state: 1 of 4 parameters above threshold (feedback speed). 3 below.

Bootstrap phase. Protocol executes; collective doesn't yet have emergent properties.

## The emergence timeline

Assuming current trajectory, realistic estimates:

| Parameter | Current state | Target reach |
|---|---|---|
| Connectivity | ~30% of threshold | 12-18 months |
| Heterogeneity | ~50% of threshold | 9-15 months |
| Feedback speed | ABOVE | — (maintain) |
| Institutional fit | ~80% | 3-6 months |

Earliest full threshold crossing: **9-15 months** from 2026-04-22.

Earlier if outreach accelerates. Later if contributor count plateaus.

## What emergence looks like in practice

Once the four parameters cross threshold, observable phenomena:

### Self-correcting drift

Someone proposes an extractive mechanism. The community surfaces the extraction via multiple independent attestations BEFORE the proposal reaches governance. The system recognizes the threat without central coordination.

### Cross-substrate routing

A contributor who specializes in Design gets credited for enabling Security outcomes they didn't implement but whose attention-framing prevented the need for.

### Gaming resistance

Attempts to game attestations fail because multiple attestation branches converge on gaming-awareness. Attacker gets detected, not rewarded.

### Knowledge compounding

Later contributors routinely reference earlier work explicitly. DAG develops visible lineage depth. Ideas that would have been forgotten are preserved via lineage.

### Novel mechanism suggestions

Community proposes mechanism refinements that core team hadn't considered. Some are adopted. Contribution extends beyond what the founding team envisioned.

Before the transition, NONE of these reliably occur. After, they become default operating mode.

## Bootstrap strategy for the 9-15 month window

### Phase 1 (now – 3 months) — Institutional fit

Ship Roadmap gap fixes (C40-C43). Bring mechanism set to Triad compliance. This is prerequisite — emergent coordination doesn't emerge on mis-fitted mechanisms.

### Phase 2 (3-6 months) — Heterogeneity

Recruit across contribution types. Not "more Code contributors" but "Design + Research + Security + Governance contributors." Targeted outreach to:
- Design DAOs (Frontier Foundation, etc.)
- Audit firms (Sigma Prime, Trail of Bits, Zellic).
- DAO-governance-experienced folks (Aragon community, DAOhaus).

### Phase 3 (6-9 months) — Connectivity

Facilitate handshakes systematically. Not left to chance.

Tactics:
- Working-group formation around specific topics.
- Regular community calls producing introductions.
- Explicit "onboarding pair" protocol for new contributors.
- Events (hackathons, conferences) that create handshake opportunities.

### Phase 4 (9-12 months) — Emergence

All four parameters approaching threshold. Watch for emergence phenomena; respond to them.

Resist premature optimizations that could push parameters back below threshold.

### Phase 5 (12-15 months) — Consolidation

Emergence phenomena stable. System has collective-intelligence properties.

Mechanism refinement shifts from "trigger emergence" to "improve efficiency."

## What could prevent emergence

Four specific risks:

### Trap 1 — Premature scaling

Growing contributor count without growing connectivity or heterogeneity. Result: N increases but parameters 1, 2 stay below threshold.

Mitigation: resist growth-for-growth's-sake metrics. Prioritize connectivity + heterogeneity over headcount.

### Trap 2 — Single-type dominance

Code contributors continue to dominate. Entropy stays low. Heterogeneity threshold unreached.

Mitigation: actively credit non-Code contributions. Publicize non-Code contributor stories. Balance the team's own contribution types.

### Trap 3 — Mechanism drift

Triad compliance slips. New mechanisms pass audit but distort substrate. Institutional fit degrades.

Mitigation: ongoing ETM alignment audits. Triad gate as hard requirement for new mechanisms.

### Trap 4 — Economic constraint

Contributors can't afford to work on VibeSwap while waiting for emergence-driven payouts. They leave.

Mitigation: deploy initial liquidity to seed contribution rewards. Use founder allocations to front-load the compensation curve.

## The cognitive parallel

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive intelligence is also a phase-transition phenomenon. Individual neurons don't think; networks of neurons do.

The transition in cognition depends on connectivity, heterogeneity, feedback speed, and institutional fit within the brain substrate. Same 4-parameter framework.

If cognitive science knows how to cross the threshold (and it does — extensively studied), we can apply the learnings on-chain.

## Quality over quantity

Network-effects theory (Metcalfe's Law): value scales with N². More participants = more value.

But Metcalfe doesn't distinguish quality. More participants are more value regardless.

Emergence-threshold theory is stronger: more participants aren't enough. Connectivity + heterogeneity + feedback + institutional-fit are REQUIRED.

A VibeSwap with 10,000 homogeneous shallow-handshake users might not emerge.
A VibeSwap with 500 heterogeneous deep-handshake users WOULD emerge.

Quality over quantity, with specific mechanics determining quality.

## For students

Exercise: identify a coordination system you're familiar with (team, club, company). For each of the 4 parameters:

1. What's its current state?
2. Has the system crossed the threshold?
3. Do you observe emergence phenomena?

Apply to academic departments, open-source projects, company departments, etc. Observe: emergence is rare. Most systems stay below threshold.

## Relationship to other primitives

- **Depends on**: [Correspondence Triad](./CORRESPONDENCE_TRIAD.md) (for Parameter 4).
- **Feeds**: [The Community Bootstrap Playbook](./THE_COMMUNITY_BOOTSTRAP_PLAYBOOK.md) (operational tactics).
- **Grounded in**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) (cognitive emergence parallel).

## Open research

1. **Empirical calibration** — what ARE the actual threshold values for VibeSwap specifically?
2. **Gradient indicators** — leading indicators (clustering coefficient, contribution-type entropy trend) that predict approach to threshold?
3. **Parameter interactions** — can high connectivity compensate for low heterogeneity, or are thresholds independent?

Each is research direction. Data from the 9-15 month bootstrap will inform.

## One-line summary

*Cooperative intelligence emerges at a phase transition (Santa Fe lineage). Four parameters with empirically-observed thresholds: connectivity (median degree ≥ 5), heterogeneity (Shannon entropy ≥ 2.5 bits), feedback speed (≤ 1 week), institutional fit (mechanisms pass Triad). VibeSwap currently: 1/4 above (feedback speed). Emergence timeline 9-15 months with deliberate bootstrap. Four traps to avoid. Quality > quantity; Metcalfe's Law insufficient.*
