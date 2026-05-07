# Community Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/community/`
**Companions**: [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md), [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)

---

## What this subsystem does

Three contracts that handle community-formation, ideation, and notifications within the VSOS ecosystem:

- **IdeaMarketplace** — non-coders submit ideas; builders execute; Shapley splits rewards between ideator and executor.
- **VibeDAO** — lightweight DAO factory; anyone can spin up a DAO for their community, project, or idea.
- **VibePush** — decentralized notification system; protocols create channels, users subscribe, on-chain subscriber tracking with off-chain delivery.

The thesis: a protocol that wants community participation needs primitives for community formation, idea-to-execution flow, and ongoing communication. Each is a different concern; each is solved by a different contract.

## File map

```
contracts/community/
├── IdeaMarketplace.sol   ← idea-execution Shapley split
├── VibeDAO.sol           ← lightweight DAO factory for sub-communities
└── VibePush.sol          ← decentralized notification channels
```

## Per-contract role

### IdeaMarketplace — ideas-as-contributions

The pattern: ideas are valuable but only when executed. Most platforms either reward ideation (and produce idea-spam) or only reward execution (and produce builders-without-ideas). This contract splits the reward via Shapley so both parties share in proportion to their actual contribution.

Flow:
1. Anyone submits an idea, stakes VIBE as anti-spam.
2. Authorized scorers rate feasibility / impact / novelty (each 0-10).
3. Auto-threshold on average total score:
   - `total < 15` → auto-reject (REJECTED)
   - `total >= 24` → auto-approve (stays OPEN for claiming)
   - `15 ≤ total < 24` → pending manual review
4. Builders claim approved ideas, execute, ship.
5. On ship: Shapley split — ideator gets attribution-share; executor gets execution-share. Both paid in VIBE.

The structural property: idea-spam is filtered by stake (anti-spam) + score threshold (quality gate). High-quality unclaimed ideas accumulate; builders pick from the top. The market clears.

The Shapley split closes the airgap between *who had the insight* and *who built it*. Both contributions are economically meaningful; neither subsidizes the other.

### VibeDAO — sub-community factory

A factory contract that lets anyone deploy a lightweight DAO. Use cases:
- A subset of contributors forming a working group.
- A community organizing around a specific protocol absorption.
- A project that needs governance but doesn't want to be the *whole* protocol.

The deployed DAOs are subordinate to the main VSOS governance hierarchy (Physics > Constitution > Governance from `[AugmentedGovernance]`). Sub-DAO votes cannot violate VSOS-level invariants; they have free choice within the bounded space.

The factory pattern: DAO formation should be cheap and standard, not bespoke. A user deploys a DAO; the deployment uses VSOS-curated DAO logic; the sub-community gets governance without reimplementing it.

### VibePush — decentralized notifications

The classic problem: how do you notify users of relevant on-chain events without centralizing on a notification SaaS?

VibePush's design:
- Protocols create *channels* (e.g., "VibeAMM price alerts", "Forum mentions").
- Users subscribe to channels by adding their address.
- Notifications fire as on-chain events (cheap; events are gas-efficient).
- Off-chain delivery (push notifications, email, mobile alerts) reads the events and routes per user preference.

The economic shape: subscriber tracking is on-chain (anyone can verify a user is subscribed), notification delivery is off-chain (much cheaper than on-chain delivery). The hybrid keeps the "notification market" decentralized — any delivery service can read events and route them; users aren't locked into a specific provider.

This is the [airgap closure](../research/papers/airgap-problem-onepager.md) shape applied to notifications: the on-chain part is the *fact* of notification (who, what, when), the off-chain part is the *delivery mechanism*. The fact stays on-chain (verifiable, censorship-resistant), the delivery stays off-chain (cheap, performant).

## Composition flow (community lifecycle)

```
1. User has an idea
   │
   ▼
2. IdeaMarketplace.submitIdea — stakes VIBE, idea enters scoring queue
   │
   ▼
3. Scorers rate; idea auto-approves or auto-rejects or goes to manual review
   │
   ▼
4. (If approved) Builder claims, executes, ships
   │
   ▼
5. (If sub-community emerges) VibeDAO.createDAO for the project
   │
   ▼
6. (If notifications needed) VibePush channel created for the project
   subscribers added; events emitted; off-chain delivery routes
   │
   ▼
7. Shapley reward split flows to ideator + executor + (optionally) sub-DAO members
```

## Why three contracts, not one

Each handles a property with its own clock and adversary:

- **Ideas** (slow-changing, idea-spam adversary).
- **DAOs** (slow-changing, governance-capture adversary).
- **Notifications** (fast-changing, spam adversary at the delivery layer).

Conflating ties slow concerns to fast clocks (DAO updates burdened by notification frequency) or fast concerns to slow clocks (notifications gated by DAO governance). Splitting lets each operate at native speed.

## Composition with broader stack

| Community contract | Uses | For |
|--------------------|------|-----|
| `IdeaMarketplace` | `ContributionDAG` (identity) | referral exclusion checks |
| `IdeaMarketplace` | `ShapleyDistributor` (incentives) | reward split |
| `IdeaMarketplace` | `IPredictionMarket` (mechanism) | scoring oracles |
| `IdeaMarketplace` | `IReputationOracle` (oracle) | scorer authorization |
| `IdeaMarketplace` | `IContextAnchor` (identity) | idea provenance anchoring |
| `VibeDAO` | `VibeTimelock` (governance) | sub-DAO timelock |
| `VibePush` | (none) | self-contained event-emission contract |

`IdeaMarketplace` is the most heavily-composed; it's a "thin" contract that orchestrates many primitives. `VibePush` is the most isolated; it's just a subscriber registry + event emitter.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `IdeaMarketplace.minStakeVIBE` | configurable | anti-spam stake amount |
| `IdeaMarketplace.scoreThresholds` | (15, 24) | reject / approve cutoffs |
| `IdeaMarketplace.scorerAuthorization` | curated | who can score |
| `VibeDAO.factoryParams` | per-DAO | quorum, threshold, timelock |
| `VibePush.channelCreationCost` | configurable | per-channel deploy fee |

All UUPS-upgradeable; parameters governance-tunable.

## Why community matters for VibeSwap

The protocol's value propositions ("cooperative capitalism", "Shapley fairness across contributions", "augmented mechanism design") are easier to demonstrate when there's an active community building, ideating, and communicating. The community subsystem is the substrate that lets that activity happen *on-chain* with the same guarantees the rest of the protocol provides.

A protocol with great mechanism design but no community-formation primitives ends up renting community formation from external SaaS (Discord, Telegram, Notion). The community subsystem refuses that frame — community formation is a first-class on-chain capability, not an off-chain dependency.

## Related

- [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md) — `ContributionDAG`, `ContextAnchor`, `RewardLedger` consumed by IdeaMarketplace.
- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — sub-DAO governance hierarchy.
- [`COMPLIANCE_OVERVIEW.md`](./COMPLIANCE_OVERVIEW.md) — `ComplianceRegistry` may gate sub-DAO participation in regulated jurisdictions.
- [`bonded-permissionless-contest`](../concepts/primitives/bonded-permissionless-contest.md) — pattern available for sub-DAO dispute resolution.
