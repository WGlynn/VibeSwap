# Reputation Oracle Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/oracle/`
**Companions**: [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md), [`AGENTS_OVERVIEW.md`](./AGENTS_OVERVIEW.md), [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md)

---

## What this subsystem does

`contracts/oracle/` (singular, distinct from `contracts/oracles/` for price oracles) holds the *reputation oracle* surface:

- **IReputationOracle** — interface for consuming reputation scores.
- **ReputationOracle** — concrete implementation aggregating reputation from multiple sources.

The split: price oracles answer "what is X worth?"; reputation oracles answer "how trusted is address Y?" Both are oracles in the architectural sense (off-chain truth piped on-chain) but different concerns.

## File map

```
contracts/oracle/
├── IReputationOracle.sol     ← interface
└── ReputationOracle.sol      ← reference implementation
```

## What ReputationOracle does

Aggregates reputation signals from multiple sources into a single score consumed by:

- **ComputeSubsidyManager**: reputation-weighted compute pricing (rep=0 → 1.0x cost; rep=100 → 0.1x).
- **MemecoinLaunchAuction**: minimum-tier check on creator + participant reputation.
- **VibeAgentReputation**: feeds into agent-specific aggregate.
- **IdeaMarketplace**: scorer authorization gate.
- **AgentRegistry**: agent eligibility checks.

Sources feeding the oracle:
- `ContributionAttestor` — governance-attested contributions.
- `ContributionDAG` — Web of Trust BFS scores.
- `RewardLedger` — Shapley-distributed contribution value.
- `BehavioralReputationVerifier` (CogProof) — behavioral reputation tier.
- `GitHubContributionTracker` — off-chain GitHub contribution data.
- `PairwiseVerifier` — CRPC commit-reveal verification of AI outputs.

The aggregation is governance-tunable: how to weight each source, decay parameters, normalization curve.

## Why a separate reputation oracle

Without a centralized reputation oracle, every consuming contract would re-aggregate scores from each source. Three failure modes:

- **Inconsistency**: different contracts compute reputation differently; same address has different scores in different contexts.
- **Update lag**: source updates propagate to consumers asynchronously, leaving stale scores in some places.
- **Attack surface multiplication**: each consumer's aggregation logic is its own attack vector.

Centralizing in `ReputationOracle`: one canonical aggregation, consumers all read the same score, source updates propagate uniformly, single audit surface for the aggregation logic.

## Governance discipline

Reputation aggregation weights are governance-tunable but bounded by [Augmented Governance](./AUGMENTED_GOVERNANCE.md) hierarchy:

- Governance can adjust source weights (e.g., increase weight on PairwiseVerifier as AI agents become more economically active).
- Governance cannot violate the no-extraction axiom (e.g., reputation cannot be governance-purchased; that's a Constitutional violation).
- Math invariants override votes: even unanimous DAO vote cannot grant reputation to a sybil-spawned account if `[Shapley null player]` says marginal contribution = 0.

The bounded-flexibility property means the oracle is upgradable in normal circumstances but resistant to capture in adversarial ones.

## Composition with broader stack

| Consumer | What it reads |
|----------|---------------|
| ComputeSubsidyManager | tier for pricing curve |
| MemecoinLaunchAuction | min-tier eligibility gates |
| VibeAgentReputation | feeds agent-specific aggregate |
| IdeaMarketplace | scorer authorization tier |
| AgentRegistry | agent eligibility |
| ComplianceRegistry | KYC tier as one signal |

The oracle is a *reader* — it pulls from many sources and exposes one read interface. It's a *writer* of reputation only via governance-set parameters, not via direct mutation.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Source weights | tunable | how much each source contributes to aggregate |
| Decay parameters | tunable | older signals weighted less |
| Tier thresholds | tunable | rep cutoffs for BLOCKED / RETAIL / ACCREDITED / etc |
| Source registry | governance | which sources feed the aggregate |

UUPS-upgradeable; aggregation logic upgradable but bounded by the governance hierarchy.

## Why this is `oracle/` (singular) not `oracles/`

Naming choice: `oracle/` is for the reputation primitive (one thing); `oracles/` is for price oracles (multiple). The split surfaces the architectural distinction at the directory level.

## Related

- `contracts/oracles/` — price oracles (TruePriceOracle, VWAPOracle, KalmanFilter).
- [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md) — primary consumer.
- [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md) — `BehavioralReputationVerifier` source.
- [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md) — sources (ContributionAttestor, DAG, RewardLedger).
