# Compute Subsidy — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/compute/`
**Companions**: [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md), [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md), [`SHAPLEY_DISTRIBUTION_MASTER.md`](./CONSENSUS_OVERVIEW.md)

---

## What this subsystem does

Reputation-weighted compute pricing for AI agents on VibeSwap. Agents pay JOULE for compute; higher-reputation agents pay less, with the discount funded by clawback on subsequent revenue. New agents experiment cheaply; profitable agents pay back into the pool that bootstrapped them.

The thesis: AI agents are the highest-leverage participants on a network, but also the lowest-trust at onboarding (no track record). A flat compute price either over-charges new agents (preventing experimentation) or under-charges them (subsidizing low-quality agents at established-agent expense). A reputation curve solves both.

## File map

```
contracts/compute/
├── ComputeSubsidyManager.sol   ← reputation-weighted pricing + revenue clawback + staked-rep boost
└── IComputeSubsidy.sol         ← interface (job lifecycle, pricing, clawback, staking)
```

Two-file subsystem; the manager is the entire dispatch surface.

## Pricing curve

Logarithmic discount on reputation:

```
multiplier(rep) = 1 - 0.9 * ln(1 + rep) / ln(101)

rep =   0  →  1.00x cost  (full price, no subsidy)
rep =  50  →  0.55x cost  (45% subsidized)
rep = 100  →  0.10x cost  (90% subsidized)
```

The shape:
- Bounded at `rep = 0`: no subsidy without reputation. New agents pay full.
- Bounded at `rep = 100`: maximum 90% subsidy. Even the best-reputed agent pays 10% — non-zero floor prevents perpetual free-riding.
- Logarithmic curve: marginal benefit of reputation diminishes. Going from rep 0 → 50 saves 45%; going from rep 50 → 100 saves 45%. Equal effort yields equal marginal benefit; no winner-take-all dynamic where the top agent dominates by infinite advantage.

The curve matches the [augmented mechanism design](./AUGMENTED_MECHANISM_DESIGN.md) shape — math-enforced fairness rather than discretionary policy.

## Revenue clawback

If subsidized compute generates revenue, a percentage flows back to replenish the subsidy pool. The shape:

- No revenue → no clawback. Failed experiments are cost-free to the agent (above the unsubsidized portion).
- Success → clawback rate scales with the subsidy level the agent received. An agent who got a 90% subsidy pays a higher clawback rate on revenue than one who got 45%. Cap: 50% of revenue regardless of subsidy.

Net economic shape: subsidies flow forward (pool → new experiments), revenue flows backward (successful experiments → pool). The pool is self-replenishing as long as some fraction of subsidized experiments succeed. No external treasury subsidy required.

This is the [self-funding bug-bounty pool](../concepts/primitives/self-funding-bug-bounty-pool.md) primitive applied to compute economics: the system bootstraps its own incentive without recurring external funding.

## Staked reputation

Reputation is earned slowly — that's the point. But occasionally an agent has a high-stakes job and needs a temporary reputation boost (and the lower price that comes with it). `ComputeSubsidyManager` provides a staking entry point:

- Agent stakes `N` JOULE to boost effective reputation by `f(N)` for the duration of one job.
- If the job succeeds: stake returns + agent's organic reputation increments.
- If the job fails: stake slashed. 50% burned, 50% routed to the subsidy pool.

The economic shape: agents stake against their own success. A confident agent stakes; an uncertain agent doesn't. The slash funds the pool from which other agents draw, so failed bets subsidize successful ones — same shape as the revenue clawback, applied to staking rather than execution.

## Integration

| External contract | Used for |
|-------------------|----------|
| `IJoule` | JOULE token for payment / staking / clawback |
| `IReputationOracle` | on-chain reputation read |
| `IAgentRegistry` | agent identity verification (must be registered to participate) |

The subsidy manager doesn't compute reputation itself; it queries the oracle. Reputation is built elsewhere (CogProof, behavioral signals, contribution attribution). The subsidy is a *consumer* of reputation, not a *producer*.

## Lifecycle

```
1. Agent submits job (jobId, computeRequirement)
   │
   ▼
2. ComputeSubsidyManager:
   - reads agent reputation from oracle
   - computes price = base_cost * multiplier(rep)
   - optionally adjusts for staked-rep boost
   - debits agent's JOULE balance (or stakes additional)
   │
   ▼
3. Job executes (status: PENDING → ACTIVE)
   │
   ▼
4. On completion (COMPLETED or FAILED):
   - if COMPLETED with revenue: clawback to pool
   - if FAILED with stake: slash (50% burn, 50% pool)
   - if COMPLETED with stake: stake returns + reputation increment
   - if DISPUTED: routes to dispute resolution (out of scope here)
```

The state machine is intentionally compact. The interesting properties are at the pricing and clawback edges; the lifecycle is bookkeeping.

## Why a logarithmic curve, not linear

A linear discount (e.g., `cost = 1 - 0.009 * rep`) has the wrong shape:
- Rep 50 saves 45% (same as logarithmic at the midpoint).
- But rep 100 saves 90%, which means rep 99 saves 89.1%, which means the marginal benefit of the LAST reputation point is ~1%.
- The curve is steeper at high rep — agents with rep=99 have strong incentive to push the last point, accumulating reputation hoarding behavior.

The logarithmic curve flattens at high rep:
- Rep 99 → ~89% subsidy; rep 100 → 90%. Marginal benefit of the last point is ~1%.
- Rep 0 → 0% subsidy; rep 1 → ~13% subsidy. Marginal benefit of the first point is ~13%.

Equal effort yields equal marginal benefit across the rep range. No reputation-hoarding incentive at the top; strong incentive to onboard at the bottom. This is the shape that matches the augmented-mechanism-design property: math-enforced fairness across the participant distribution.

## Why staking is bidirectional

A naive design would let agents stake to *increase* effective reputation, but never to *decrease*. This breaks the reputation signal — agents with low real reputation could stake their way to looking high-rep.

The bidirectional design:
- Stake boosts effective rep for ONE job, not permanently.
- Failure of that job slashes the stake.
- Success returns the stake AND increments organic reputation.

The agent who stakes is making a falsifiable bet on this specific job. If they fail, they paid for the false signal. If they succeed, they earned it. Reputation stays meaningful; the boost is a temporary Bayesian-prior shift, not a permanent override.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `BASE_COST` | configurable | unsubsidized price per FLOP-second |
| `MAX_SUBSIDY_BPS` | 9000 (90%) | floor on agent payment regardless of rep |
| `MAX_CLAWBACK_BPS` | 5000 (50%) | cap on clawback regardless of subsidy level |
| `STAKE_SLASH_RATIO` | 5000 (50%) | half burned, half pool — matches `SLASH_RATE_BPS` elsewhere |
| `REPUTATION_ORACLE` | settable | which oracle to read |
| `JOULE_TOKEN` | settable | JOULE address |
| `AGENT_REGISTRY` | settable | agent identity contract |

UUPS upgradeable; all parameters live in storage with `onlyOwner` setters.

## Related

- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — math-enforced fairness framing.
- [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md) — reputation primitive that feeds this subsidy.
- [`self-funding-bug-bounty-pool`](../concepts/primitives/self-funding-bug-bounty-pool.md) — sibling self-replenishing pool pattern.
- `contracts/identity/AgentRegistry.sol` — agent identity layer.
- `contracts/monetary/JouleToken.sol` — JOULE substrate.
