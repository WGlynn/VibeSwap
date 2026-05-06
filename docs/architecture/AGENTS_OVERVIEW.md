# Agents Subsystem — Architecture Overview

**Status**: shipped (15 contracts; all UUPS-upgradeable)
**Subsystem**: `contracts/agents/`
**Companions**: [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md), [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md)

---

## What this subsystem does

On-chain primitives for AI agents as economic actors. The subsystem absorbs patterns from the wider AI-agent ecosystem (Paperclip, Pippin, Dexter, Accomplish, Shannon, ChatLens, claude-mem, Google GenAI) into a unified decentralized stack — agents that trade, govern, audit, hire, remember, and self-improve, with on-chain identity, reputation, and accountability.

The thesis: AI agents will be economic participants regardless of whether the substrate is ready for them. Building agent-native primitives ensures their participation is verifiable, accountable, and bounded — rather than opaque, unaccountable, and unbounded as it would be on standard chains.

## Contract map (15 contracts)

| Contract | Role |
|----------|------|
| `VibeAgentProtocol` | unifies external agent frameworks (Paperclip, Pippin, Google GenAI) into a single protocol |
| `VibeAgentNetwork` | DNS + messaging + matchmaking — agents discover each other, form teams, negotiate |
| `VibeAgentOrchestrator` | DAG-based multi-agent workflows + swarms; parallel execution when dependencies satisfied |
| `VibeAgentMemory` | episodic / semantic / procedural / contextual memory layer with on-chain anchoring |
| `VibeAgentPersistence` | claude-mem-style cross-session durable memory + cross-agent sharing |
| `VibeAgentMarketplace` | deploy / discover / hire / compensate agents; Shapley-weighted skill match + 95/5 split |
| `VibeAgentReputation` | unified reputation across all subsystems (task / trading / consensus / audit / memory) |
| `VibeAgentSelfImprovement` | bounded recursive optimization tracking with safety constraints (Paperclip pattern) |
| `VibeAgentTrading` | autonomous trading strategies + strategy vaults + perf-based fee sharing (Dexter pattern) |
| `VibeAgentInsurance` | risk-adjusted insurance pools for trading losses, contract failures, oracle manipulation |
| `VibeAgentGovernance` | bounded-autonomy voting + proposing + delegating; human override + weight caps |
| `VibeAgentConsensus` | structural fix for "Can AI Agents Agree?" (Berdoz et al., 2025) — Byzantine-resistant consensus |
| `VibeAgentAnalytics` | privacy-preserving conversation/performance analytics (ChatLens pattern absorbed) |
| `VibeSecurityOracle` | decentralized audit marketplace; agents do parallel vuln scanning + proof-of-exploit for bug bounties |
| `VibeTaskEngine` | task DAGs with parallel execution + verifiable completion (Accomplish pattern) |

## Why 15 contracts, not one big monolith

The natural objection: this looks like over-engineering. One `AgentRegistry` with all the methods would do the same job.

The composition argument:

- **Each contract has one concern.** Memory ≠ reputation ≠ trading ≠ governance. Splitting them maps the problem domain to the contract layer cleanly.
- **Reputation is a consumer, not a producer.** `VibeAgentReputation` reads scores from many sources (task completion, trading performance, consensus participation, audit quality). A monolithic contract would either tightly couple the score calculation to the data sources (brittle) or split it anyway (back to many contracts).
- **Insurance and trading are upgrade-asymmetric.** Trading strategies evolve fast; insurance actuarial models change slowly. Putting them in one contract forces both to upgrade together. Split, they upgrade on their own clocks.
- **External-pattern absorption is decentralized too.** Paperclip is one pattern; Pippin is another; ChatLens is a third. Each lands in its own absorbing contract. New patterns (e.g., a future Anthropic agent SDK) plug into the protocol without forcing a redesign.

The size cost is real (15 contracts to deploy + maintain). The cohesion benefit is also real (each contract is bounded; audit surface stays tractable per contract; cross-cutting concerns like reputation aggregate across them rather than centralizing).

## The four cross-cutting properties

Every agent contract participates in four properties shared across the subsystem:

### Identity
Agents have on-chain identity via `AgentRegistry` (in `contracts/identity/`). This subsystem consumes that identity rather than re-implementing it. An agent's reputation, memory, trading history, and governance participation all key off the same identity primitive.

### Accountability
Every agent action is auditable. `VibeAgentAnalytics` records performance; `VibeAgentReputation` aggregates; `VibeAgentInsurance` prices risk based on the aggregate. There is no "trust the agent" — only "verify the agent's track record."

### Bounded autonomy
`VibeAgentGovernance` is the canonical example: agents vote within caps, with human override, transparency mandatory. Same pattern repeats: trading vaults have stop-loss caps, self-improvement cycles have safety constraints, swarm orchestration has consensus thresholds. Agents are *participants*, not *sovereigns*.

### Composability
`VibeAgentOrchestrator` runs DAGs that span agent and non-agent contracts. An agent can call another agent, an AMM, a governance proposal, all in one task DAG. The orchestrator doesn't care; the verification surface (each contract's own checks) does.

## Composition with broader stack

| Agent contract | External dependency | Used for |
|----------------|---------------------|----------|
| `VibeAgentMemory` | `ContextAnchor` (identity/) | on-chain anchoring of memory hashes |
| `VibeAgentReputation` | `BehavioralReputationVerifier` (CogProof) | reputation tier feed |
| `VibeAgentTrading` | `VibeAMM` + `CommitRevealAuction` | execution venues |
| `VibeAgentMarketplace` | `ShapleyDistributor` | skill-matching value calculation |
| `VibeAgentGovernance` | `DAOTreasury` + `VibeTimelock` | proposal execution paths |
| `VibeAgentInsurance` | `JOULE` token | premium / payout currency |
| `VibeSecurityOracle` | `ClawbackRegistry` | follow-through on confirmed bugs |
| `VibeTaskEngine` | `VibeAgentOrchestrator` | task-DAG dispatch |

The pattern: agent contracts define agent-specific logic; underlying primitives (token, AMM, auction, distributor, treasury) come from elsewhere. Composition over inheritance.

## Why this exists in VibeSwap specifically

A natural alternative is "build agent infrastructure on a separate chain." VibeSwap embeds it for three reasons:

1. **The substrate is already correct.** VibeSwap's commit-reveal + Shapley + bonded-contest primitives are exactly the substrate AI agents need. Building agent infrastructure on EVM means re-creating those primitives without their underlying assumptions; building it on VibeSwap inherits them.
2. **Agent activity is liquidity-relevant.** Agents trade, swap, provide liquidity. Their participation should land in the same trading surface as everyone else, not a separate ghetto.
3. **Reputation is cross-subsystem.** An agent's trading performance affects its insurance premium, its governance weight, its marketplace ranking. A separate-chain design fragments this; the embedded design lets reputation aggregate naturally.

## Configurability

Per-contract: typical UUPS upgrade pattern with `_authorizeUpgrade(onlyOwner)`. Most contracts have settable parameters for fees, caps, voting thresholds, insurance premiums, etc.

Cross-cutting: the `VibeAgentReputation` weighting across subsystems is governance-tunable. As new agent patterns absorb in (e.g., a future protocol), reputation contributes get weights without redeploying existing contracts.

## Related

- [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md) — how agents pay for compute (reputation-weighted JOULE pricing).
- [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md) — reputation primitive that feeds `VibeAgentReputation`.
- [`REASONING_VERIFICATION_OVERVIEW.md`](./REASONING_VERIFICATION_OVERVIEW.md) — the structural way to verify agent reasoning on-chain (forward-looking, complementary).
- `contracts/identity/AgentRegistry.sol` — identity primitive consumed by every contract here.
- [`AIRGAP_PROBLEM_ONEPAGER`](../research/papers/airgap-problem-onepager.md) — substrate-level framing for why agent infrastructure on EVM hits a ceiling.
