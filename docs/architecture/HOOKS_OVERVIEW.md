# Hooks Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/hooks/`
**Companions**: [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md), [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`MECHANISM_COMPOSITION_ALGEBRA.md`](./MECHANISM_COMPOSITION_ALGEBRA.md)

---

## What this subsystem does

Pre/post-action hook layer (Uniswap V4-style) for VibeSwap pools. Third parties attach hook logic — dynamic fees, rewards, compliance, custom routing — to specific pools without modifying core protocol contracts. Pool owners select hooks; the protocol enforces the security boundary.

The thesis: extension should be additive, not invasive. New behaviors plug into hook points; existing behavior is untouched. The protocol stays small; the ecosystem grows around it.

## File map

```
contracts/hooks/
├── VibeHookRegistry.sol     ← registry: pool -> hook attachment, owner controls, gas limits
├── DynamicFeeHook.sol       ← reference hook: surge fee on volatility
└── interfaces/
    ├── IVibeHook.sol        ← interface every hook implements
    └── IVibeHookRegistry.sol
```

## Per-component role

### VibeHookRegistry — the dispatcher

The registry holds the `pool → hook` mapping. Each pool has at most one attached hook. Pool owners are managed by protocol admin (a parameter, not enforced as DAO-only — enables flexible deployment).

Hook execution lifecycle:
- The pool calls `registry.beforeX(pool, args)`; the registry looks up the attached hook.
- If a hook is attached: registry calls the hook in a `try/catch` with a gas limit.
- If the hook reverts or runs out of gas: failure is logged via event, the swap proceeds without the hook's effect.
- If the hook succeeds: returnData is passed back to the pool, which can decide how to interpret it.

Failure mode: a buggy or malicious hook **cannot brick the pool**. The try/catch isolates failure; the gas limit prevents griefing. This is the [fail-closed-on-upgrade](../concepts/primitives/fail-closed-on-upgrade.md) shape applied to extension code.

### DynamicFeeHook — the canonical hook

First concrete implementation. Adjusts AMM fees based on observed swap volatility:

- Tracks recent swap volumes per pool in a windowed buffer.
- High volume → higher fees (surge pricing protects LPs during volatility).
- Low volume → base fees (competitive pricing during calm markets).
- Fee multiplier formula: `baseFee * (1 + surgeMultiplier * volumeRatio)`.

The hook returns encoded fee recommendations as returnData; the pool reads them and applies on the next swap. The hook does not modify pool state directly — it observes and recommends. State changes happen only at the pool's call sites, preserving auditability.

The economic shape is [cooperative capitalism](./AUGMENTED_GOVERNANCE.md): LPs are protected during high-volatility events when adverse selection is highest; arbitrageurs pay more for the privilege of capturing volatility-driven price discovery; calm markets stay competitive. Math-enforced fairness across all market regimes.

## Hook points

Hook points map to the protocol's two execution paths:

| Hook point | Phase | When it fires |
|------------|-------|---------------|
| `beforeCommit` | commit-reveal auction | order submission begins |
| `afterCommit` | commit-reveal auction | order submission ends |
| `beforeSettle` | commit-reveal auction | batch settlement begins |
| `afterSettle` | commit-reveal auction | batch settlement ends |
| `beforeSwap` | AMM direct swap | swap calculation begins |
| `afterSwap` | AMM direct swap | swap completed, pool state updated |

Hooks may implement any subset. A fee hook only cares about the swap path; a compliance hook may attach to commit-reveal phases; a routing hook may use multiple points.

## Security model

The hook layer is the most ecosystem-facing surface in the protocol — third-party code runs in the protocol's transaction context. Three properties bound the risk:

**Pool owner control.** Only the pool owner can attach or change a hook. The protocol admin manages pool owner assignments but doesn't directly install hooks. Misbehavior is contained to the pool whose owner installed it.

**Try/catch isolation.** Hook execution is wrapped. A reverting hook does NOT revert the pool action; it logs failure and proceeds. Hooks cannot deny service to a pool by buggy code.

**Gas limit.** Hook execution has a gas cap. A hook that would consume unbounded gas is forced to revert at the cap, treated as a failure case. Prevents griefing-via-gas.

The combination: a hook can extend behavior (additive), can fail (logged, not fatal), and cannot consume more than its gas budget. The protocol's invariants stay intact regardless of hook quality.

## Why Uniswap V4-style, but for batch auctions

V4-style hooks are well-known but originally designed for AMMs. VibeSwap's primary execution path is commit-reveal batch auction, with AMM as the secondary path. The hook system extends V4's pattern to cover both:

- Hooks attach at AMM entry points (beforeSwap / afterSwap) just like V4.
- Hooks ALSO attach at commit-reveal entry points (beforeCommit / beforeSettle / afterCommit / afterSettle).

This means a hook can implement, e.g., compliance gating that runs at commit submission, blocking ineligible users before they enter the batch. Or reward distribution logic that runs at afterSettle to compute Shapley shares for batch participants. The hook system is genuinely orthogonal to the execution model — it works equally well for both auction and AMM paths.

## Composition with broader stack

| External contract | Used by hooks for |
|-------------------|-------------------|
| `VibeAMM` | swap-path hook firing |
| `CommitRevealAuction` | auction-path hook firing |
| `ComplianceRegistry` | compliance hooks (potential future) |
| `ShapleyDistributor` | distribution hooks (potential future) |
| `BehavioralReputation` | tier-gating hooks (potential future) |

The current `DynamicFeeHook` is the only concrete hook in the codebase. The registry and interface are designed to support many; the ecosystem-side bet is that third parties will write the rest.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `hookGasLimit` | configurable | gas cap per hook execution |
| `surgeMultiplier` (DynamicFeeHook) | per-pool | how aggressively fees scale with volume |
| `volumeWindow` (DynamicFeeHook) | per-pool | sliding-window length for volume tracking |
| pool-owner mapping | admin-managed | who owns which pool, gates who attaches hooks |

VibeHookRegistry is `Ownable` (admin manages pool owners); individual hooks are typically `Ownable` per their implementer.

## Why hooks instead of inheritance

A common alternative to hooks is inheritance: a `FeeAwarePool` extends `Pool` with custom fee logic. Three failure modes:

- **Composition limit**: only one inheritance chain. Can't combine fee-aware + reward-aware + compliance-aware in the same pool unless someone writes the union class.
- **Upgrade brittleness**: changing the base contract cascades through all derivative classes.
- **Audit surface multiplication**: every variant is a separate audit target.

Hook composition: many hooks can attach to one pool sequentially (or one composite hook can call sub-hooks). Pool stays unchanged across feature additions. Audit surface stays bounded — the pool is fixed, hooks are individually scoped.

## Related

- [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md) — AMM consumer of the swap-path hooks.
- [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md) — commit-reveal consumer of the auction-path hooks.
- [`MECHANISM_COMPOSITION_ALGEBRA.md`](./MECHANISM_COMPOSITION_ALGEBRA.md) — broader composition framing.
- [`fail-closed-on-upgrade`](../concepts/primitives/fail-closed-on-upgrade.md) — sibling pattern: failure handling that doesn't brick the protocol.
