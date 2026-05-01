# The Community Bootstrap Playbook

**Status**: Operational manual for converting early contributors into durable community.
**Audience**: First-encounter OK. Tactical, concrete, contributor-facing.

---

## A stage name

In start-up parlance, "bootstrap phase" is a well-known stage. For a crypto protocol, it's the period between "zero users" and "community has emergent properties" (see [Cooperative Emergence Threshold](../../concepts/ai-native/COOPERATIVE_EMERGENCE_THRESHOLD.md)).

For VibeSwap, bootstrap is roughly 2025-2028.

During bootstrap, ordinary metrics mislead:
- Active-contributor count grows (mostly early enthusiasts).
- Handshake density is shallow.
- The community feels real to insiders but looks sparse from outside.
- Venture funding perceives it as "not yet critical mass."

The playbook: specific tactics to cross bootstrap into emergence.

## Why a playbook matters

Most projects bootstrap by accident — whoever happens to find the project, contributes. Some succeed; most don't.

With a playbook, bootstrap becomes intentional:
- Know what you're trying to achieve (emergence threshold crossings).
- Know what tactics move toward that goal.
- Know what anti-patterns to avoid.

## The recruitment funnel

### Top of funnel — awareness

Who encounters VibeSwap? Where? Why should they care?

**Channels**:
- Twitter/X accounts discussing crypto mechanism design, coordination, governance.
- Telegram groups (serious-DeFi and decentralized science).
- Hacker News (occasional technical discussions).
- Academic venues (SBC, IC3, DeSciHK conferences).
- The 30-doc content pipeline (LinkedIn / Medium / X distribution).

**Messaging at this stage**: "VibeSwap is building a coordination primitive for cooperative work."

NOT: "VibeSwap is a DEX." That invites DEX comparisons and loses differentiation.

**Rejection criteria**: people purely speculation-focused. They filter themselves when reading docs. Don't chase.

### Mid-funnel — engagement

Who goes deeper? Who reads docs, joins Telegram, tries contracts?

**Expected flow**:
- Read 1-2 foundational docs (CONTRIBUTION_TRACEABILITY, ECONOMIC_THEORY_OF_MIND).
- Join Telegram.
- Try a test transaction on testnet.
- Submit a `[Dialogue]` issue or comment on existing discussions.

**Supports needed**:
- Clear onboarding docs (mostly exist).
- Responsive Telegram (bot + human).
- Functional testnet.
- Low-friction issue-template (shipped 2026-04-22).

### Bottom of funnel — contribution

Who makes a sustained contribution? Who attests, builds, audits?

**Expected contributors by category**:
- **Code** — developers. Source: crypto-dev community.
- **Design** — UI/UX + mechanism designers. Source: crypto-design community, academic mechanism-design.
- **Research** — writers of memos, analyses. Source: academic, industry R&D.
- **Security** — auditors, bug-hunters. Source: crypto audit firms.
- **Governance** — people interested in DAO operations. Source: DAO participants.
- **Community** — moderators, onboarding helpers. Source: Discord / Telegram community-operators.
- **Inspiration** — philosophers, framers. Source: public intellectuals, DeSci.

Each category needs targeted outreach. Shipping docs broadly misses; targeted outreach converts.

## The Heterogeneity Mandate

Per [Cooperative Emergence Threshold](../../concepts/ai-native/COOPERATIVE_EMERGENCE_THRESHOLD.md), emergence requires contributor-type heterogeneity (Shannon entropy ≥ 2.5 bits). Means 5-6 contribution types with meaningful presence, not just Code.

Current state (2026-04-22): heavily skewed Code + Research + Inspiration. Need more Design, Security, Community, Governance.

**Action items**:
- Partner with a design school or design DAO for Design pipeline.
- Engage audit firms for recurring Security contributions.
- Cultivate moderators into Community contributors.
- Propose to a DAO operating group for Governance contributors.

## The onboarding funnel — five tactics

### Tactic 1 — "Smallest possible contribution" ramp

When a prospect shows interest, offer a tiny high-leverage first contribution taking <1 hour:

- Read this doc, flag errors.
- Attest this claim.
- Join this Telegram thread.
- Fix this typo.

Small contribution earns attestation-weight + first DAG entry. Psychological investment primes for larger contributions.

### Tactic 2 — Paired onboarding

Each new contributor paired with an existing trusted contributor for first 30 days. The sponsor:

- Answers questions.
- Introduces them to other contributors.
- Provides context on VibeSwap's culture.
- Vouches for their initial contributions (handshake in ContributionDAG).

Paired onboarding builds trust-graph intentionally.

### Tactic 3 — Weekly office hours

Regular 1-hour Zoom where Will or core contributors are available. Invitations sent to active-engaged prospects.

Low commitment for prospect. High value for VibeSwap (builds relationship).

### Tactic 4 — Problem-solution matchmaking

A prospect says "I'm interested in X." VibeSwap has an open issue matching X. Match deliberately; prospect contributes to a real issue their interest aligns with. First contribution feels meaningful.

### Tactic 5 — Discord + Telegram parallel

Some prefer Discord (structured). Some prefer Telegram (fast). VibeSwap maintains both. Contributors self-select.

## Anti-grift filters

Recurring failure mode in crypto bootstraps: people attracted to "free money" not genuine work. These grifters absorb resources without producing value.

### Filter 1 — Long-form first-engagement

New prospects must read at least 2 full docs before engaging. Verify via specific question in Telegram onboarding. Grifters don't read; honest prospects do.

### Filter 2 — No speculative rewards at bootstrap

VibeSwap hasn't distributed tokens yet. No one can be attracted by token-price speculation. Filters out pure speculators during bootstrap.

### Filter 3 — Multi-type contribution required for high-weight status

Can't get high-trust status in just one contribution-type. Requires diverse contributions. Grifters often focus on one gamed-type; honest contributors span multiple.

### Filter 4 — Evidence-hash requirement

All claims need evidence. Frivolous or fake evidence detectable by multi-branch attestation. Slow but effective.

### Filter 5 — Community self-policing

Experienced members recognize grifter patterns (over-emphasizing tokens, asking "when airdrop", disengaging after contribution). Flag to core. Trust-graph damage contained.

## Culture-building

Culture emerges from repeated interactions. VibeSwap's deliberate culture:

### Norm 1 — Density-first communication

Per [Density First](../../concepts/DENSITY_FIRST.md). Crisp, direct over wordy.

### Norm 2 — Substance over marketing

Don't announce "upcoming features." Don't hype. Ship, then describe. Lead-with-Crux feedback applied culturally.

### Norm 3 — Attribution preservation

When citing others' ideas, credit. When building on work, acknowledge. On-chain Lawson Constant applied socially.

### Norm 4 — Honest failure-acknowledgment

When something doesn't work, say so openly. Don't hide mistakes. Defend-Reasoning-When-Wrong feedback applied culturally.

### Norm 5 — Mentorship expectation

Senior contributors help newer ones. Not optional; cultural.

## Specific risk patterns

### Risk 1 — Founder-dominance

If Will is always the decision-maker, community never matures.

Counter: explicit delegation to sub-groups. Founder-change timelock makes founder-shifts legitimate governance actions.

### Risk 2 — Echo chamber

Community agrees on everything. Missing contradictory viewpoints.

Counter: actively invite skeptics. Treat dissent as contribution.

### Risk 3 — Scaling capacity loss

Core team hits capacity. Bottlenecks.

Counter: progressive delegation. Documentation so new contributors self-onboard.

### Risk 4 — Token-speculation emergence

Even in bootstrap, if tokens tradeable, speculation dominates.

Counter: keep token-utility-first. Defer liquid trading until mechanism stability.

## Measuring bootstrap progress

### Weekly metrics

- New contributors onboarded — target 3-5/week at peak.
- Average handshake count per contributor — target 2-5 in first 90 days.
- Issue volume by contribution type — target balanced across 5+ types within 6 months.
- Attestation activity — target 10-20 attestations/week.

### Monthly metrics

- Contributor retention (60-day) — target 50-70%.
- Cross-substrate contributions — target 30% of contributors touching 2+ types.
- Disintermediation Grade average — target rising toward 4.

### Quarterly metrics

- Narrative health assessment.
- Retention anomalies investigation.
- Governance engagement rate.

## Budget

From the $2.0M seed:
- ~$200-500K community-building (events, travel, grants to significant contributors).
- ~$100K educational content (Eridu partnerships, course materials).
- ~$50K moderation / community infrastructure.

Modest budget. Community-building is about presence + engagement, not spending.

## Concrete quarterly targets

**Q2 2026**:
- 20 → 50 active contributors.
- First 2 external integrations.
- 3 published 30-doc pipeline articles picked up by external outlets.

**Q3 2026**:
- 50 → 100 active contributors.
- First Eridu course launched.
- 10 new contributors across non-Code types.

**Q4 2026**:
- 100 → 200 active contributors.
- Emergence threshold parameters improving visibly.
- First tribunal case resolved successfully.

## The long arc

Bootstrap ends when community self-sustains. New contributors onboard without core-team intervention. Attestations flow organically. Mechanisms produce outcomes matching intent.

Expected endpoint: 2027-2028.

Post-bootstrap, playbook shifts to [Cooperative Emergence Threshold](../../concepts/ai-native/COOPERATIVE_EMERGENCE_THRESHOLD.md) management — tune for sustained emergence; don't revert to bootstrap patterns.

## For contributors

If you're bootstrapping a community:

1. Build the funnel explicitly (awareness → engagement → contribution).
2. Make the smallest first-contribution easy.
3. Use paired onboarding for trust-graph growth.
4. Mandate heterogeneity, not just headcount.
5. Filter grifters explicitly.
6. Deliberately build culture through norms.
7. Measure progress via specific metrics.

Apply to any decentralized community — VibeSwap-specific or not.

## One-line summary

*Bootstrap (2025-2028) converts early contributors into durable community. Specific funnel tactics (small-contribution ramp, paired onboarding, office hours, problem-match) + anti-grift filters (long-form first-engagement, no-speculation, multi-type required, evidence-hash, community-policing) + culture norms (density, substance, attribution, failure-honesty, mentorship). Weekly/monthly/quarterly metrics track progress. Budget ~$500K for community + education + moderation. End state: community self-sustains by 2027-2028.*
