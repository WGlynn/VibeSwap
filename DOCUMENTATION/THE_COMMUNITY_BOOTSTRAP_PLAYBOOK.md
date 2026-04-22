# The Community Bootstrap Playbook

**Status**: Operational manual for converting early contributors into durable community.
**Depth**: Concrete tactics + anti-grift filters + onboarding funnels.
**Related**: [Cooperative Emergence Threshold](./COOPERATIVE_EMERGENCE_THRESHOLD.md), [Why VibeSwap Wins in 2030](./WHY_VIBESWAP_WINS_IN_2030.md), [The Coordination Primitive Market](./THE_COORDINATION_PRIMITIVE_MARKET.md).

---

## What "community bootstrap" means

The period between "zero users" and "community has emergent properties". For VibeSwap, this is roughly 2025-2028 — when the protocol is operational but the network effect hasn't yet kicked in.

During bootstrap, ordinary metrics mislead. Active-contributor count grows but mostly from early enthusiasts. Handshake density is shallow. The community feels real to insiders but looks sparse from outside.

The playbook: specific tactics to cross bootstrap into emergence.

## The recruitment funnel

### Top of funnel — awareness

Who encounters VibeSwap? Where? Why should they care?

**Channels**:
- Twitter/X via accounts discussing crypto mechanism design, coordination, governance.
- Telegram groups focused on serious-DeFi and decentralized science.
- Hacker News (occasional technical discussions).
- Academic venues — SBC, IC3, DeSciHK conferences.
- The 30-doc content pipeline (LinkedIn / Medium / X distribution).

**Messaging** at this stage: "VibeSwap is building a coordination primitive for cooperative work." Not "VibeSwap is a DEX" (which invites comparisons to existing DEXes and loses the differentiation).

**Rejection criteria at this stage**: people who are purely speculation-focused. They'll filter themselves out when they read the docs. We don't chase them.

### Mid-funnel — engagement

Who goes deeper? Who reads the docs, joins Telegram, tries the contracts?

**Expected flow**:
- Read 1-2 foundational docs (CONTRIBUTION_TRACEABILITY.md, ECONOMIC_THEORY_OF_MIND.md).
- Join Telegram (`t.me/+3uHbNxyZH-tiOGY8`).
- Try a test transaction on testnet.
- Submit a `[Dialogue]` issue or comment on existing discussions.

**Supports needed**:
- Clear onboarding docs (mostly exist).
- Responsive Telegram (bot + human).
- Functional testnet deployment (current status: yes).
- Low-friction issue-template (shipped 2026-04-22).

### Bottom of funnel — contribution

Who makes a sustained contribution? Who attests, builds, audits?

**Expected contributors by category**:
- **Code** — developers wanting to contribute Solidity, tests, frontend. Source: existing crypto-dev community.
- **Design** — UI/UX and mechanism designers. Source: crypto-design community, academic mechanism-design.
- **Research** — writers of memos, analyses, mechanism-design papers. Source: academic, industry R&D.
- **Security** — auditors and bug-hunters. Source: crypto audit firms, individual researchers.
- **Governance** — people interested in DAO operations. Source: DAO participants.
- **Community** — moderators, onboarding helpers, educators. Source: Discord / Telegram community-operators.
- **Inspiration** — philosophers, framers, visionaries. Source: public intellectuals, DeSci communities.

Each category needs targeted outreach. Shipping documentation broadly misses; targeted outreach to specific communities converts.

## The Heterogeneity Mandate

Per [Cooperative Emergence Threshold](./COOPERATIVE_EMERGENCE_THRESHOLD.md), emergence requires contributor-type heterogeneity (Shannon entropy ≥ 2.5 bits). That means 5-6 contribution types with meaningful presence, not just Code.

Current state (2026-04-22): heavily skewed to Code + Research + Inspiration. Need more Design, Security, Community, Governance. Some Marketing. Some Other.

**Action items**:
- Partner with a design school or design DAO for Design contributor pipeline.
- Engage with audit firms for recurring Security contributions.
- Cultivate moderators to become Community contributors.
- Propose to a DAO operating group for Governance contributors.

## The onboarding funnel tactics

### Tactic 1 — "Smallest possible contribution" ramp

When a prospective contributor shows interest, offer them a tiny, high-leverage first contribution that takes <1 hour:

- Read this doc, flag errors in a comment.
- Attest this claim (of someone else's contribution).
- Join this Telegram thread and share what you think.
- Fix this typo in this doc.

The small contribution earns attestation-weight and first DAG entry. The contributor now has skin in the game; the psychological investment primes them for larger contributions.

### Tactic 2 — Paired onboarding

Each new contributor is paired with an existing trusted contributor for their first 30 days. The sponsor:
- Answers questions.
- Introduces them to other contributors.
- Provides context on VibeSwap's culture and norms.
- Vouches for their initial contributions (handshake in ContributionDAG).

Paired onboarding builds the trust-graph intentionally rather than hoping for organic growth.

### Tactic 3 — Office hours

Regular (weekly?) office hours where Will or core contributors are available for 1-hour Zoom calls to answer questions. Invitations sent to active-engaged prospects.

Low commitment for the prospect (1 hour). High value for VibeSwap (builds relationship).

### Tactic 4 — Problem-solution matchmaking

A prospect says "I'm interested in X". VibeSwap has an open issue matching X. The match is deliberately-made; prospect contributes to a real issue their interest aligns with. First contribution feels meaningful.

### Tactic 5 — Discord thread + Telegram thread pattern

Some contributors prefer Discord (structured); some prefer Telegram (fast). VibeSwap maintains both. Contributors self-select; no friction forcing them to switch.

## Anti-grift filters

A recurring failure mode in crypto-project bootstraps: people arrive attracted to "free money" not genuine work. These grifters absorb resources (time, attention, reputation) without producing value.

Filters:

### Filter 1 — Long-form first-engagement requirement

New prospects must read at least 2 full docs before engaging. Can be verified via specific question in Telegram onboarding. Grifters don't read; honest prospects do.

### Filter 2 — No speculative rewards at bootstrap

VibeSwap hasn't yet distributed tokens. Therefore no one can be attracted by token-price speculation. This filters out pure speculation-interested grifters during the bootstrap window.

### Filter 3 — Multi-type contribution requirement for high-weight status

You can't get high-trust status in just one contribution-type (say, Code). Requires diverse contributions across multiple types. Grifters often focus on one gamed-type; honest contributors span multiple types.

### Filter 4 — Evidence-hash requirement for claims

All claims need evidence. Frivolous or fake evidence is detectable by multi-branch attestation. Slow but effective filter.

### Filter 5 — Community self-policing

Experienced community members recognize grifter patterns (over-emphasizing tokens, asking "when airdrop", disengaging after contribution). They flag to core team; trust-graph damage is contained.

## Culture-building

Culture emerges from repeated interactions. VibeSwap's deliberate culture includes:

### Norm 1 — Density-first communication

Per [Density First](./DENSITY_FIRST.md). Crisp, direct communication valued over wordy/social-performance.

### Norm 2 — Substance over marketing

Don't announce "upcoming features" repeatedly. Don't hype. Ship, then describe. This is the Lead-with-Crux feedback applied culturally.

### Norm 3 — Attribution preservation (Lawson Constant culture)

When you cite someone else's idea, credit them. When you build on their work, acknowledge it explicitly. This is the on-chain Lawson Constant applied socially.

### Norm 4 — Honest failure-acknowledgment

When something doesn't work, say so openly. Don't hide mistakes. Don't defend obviously-wrong positions. This is the Defend-Reasoning-When-Wrong feedback applied culturally.

### Norm 5 — Mentorship from senior contributors

Senior contributors are expected to help newer ones. This isn't optional; it's cultural.

## The specific risk patterns

### Risk 1 — Founder-dominance

If Will is always the person who decides, the community never matures. Counter: explicit delegation of decisions to sub-groups; founder-change timelock makes founder-shifts legitimate governance actions.

### Risk 2 — Echo chamber

If the community agrees on everything, we're missing contradictory viewpoints. Counter: actively invite skeptics; treat dissent as contribution.

### Risk 3 — Scaling capacity loss

If core team hits capacity limits, bottlenecks emerge. Counter: progressive delegation; documentation so new contributors can self-onboard.

### Risk 4 — Token-speculation emergence

Even in bootstrap, if tokens become tradeable, speculation can dominate. Counter: keep token-utility-first, defer liquid trading until substantial mechanism stability.

## Measuring bootstrap progress

Weekly metrics:
- **New contributors onboarded** — target: 3-5/week at bootstrap peak.
- **Average handshake count per contributor** — target: 2-5 in first 90 days.
- **Issue volume by contribution type** — target: balanced across 5+ types within 6 months.
- **Attestation activity** — target: 10-20 attestations/week.

Monthly metrics:
- **Contributor retention (60-day)** — target: 50-70%.
- **Cross-substrate contributions** — target: 30% of contributors touching 2+ types.
- **Disintermediation Grade average** — target: rising toward 4.

Quarterly metrics:
- **Overall health report** — narrative assessment of community state.
- **Retention anomalies** — investigate drops.
- **Governance engagement** — participation in proposals.

## Budget for bootstrap

From the $2.0M seed:
- ~$200K-$500K for community-building activities (events, travel, grant disbursements to significant contributors).
- ~$100K for educational content (Eridu partnerships, course materials).
- ~$50K for moderation / community infrastructure.

Not a massive budget; community-building is more about presence and engagement than spending.

## The long-arc

Bootstrap ends when the community self-sustains — new contributors onboard without core-team intervention; attestations flow organically; mechanisms produce outcomes that match mechanism-design intent.

Expected endpoint: 2027-2028.

Post-bootstrap, the playbook shifts to [Cooperative Emergence Threshold](./COOPERATIVE_EMERGENCE_THRESHOLD.md) management — tune for sustained emergence; don't revert to bootstrap-phase patterns.

## One-line summary

*Bootstrap is 2025-2028 for VibeSwap; specific funnel tactics (small-contribution ramp, paired onboarding, office hours, problem-match) + anti-grift filters + culture-building + heterogeneity mandate. Weekly/monthly/quarterly metrics track progress toward emergence threshold. Budget is modest (~$500K); most work is presence + engagement.*
