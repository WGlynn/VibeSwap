# Framework Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/framework/`
**Companions**: [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md), [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`HOOKS_OVERVIEW.md`](./HOOKS_OVERVIEW.md)

---

## What this subsystem does

The framework subsystem provides VSOS protocol-layer services that compose across multiple subsystems. Two contracts:

- **VibeIntentRouter** — intent-based order routing. Users declare desired outcomes ("swap X for best Y"); the router scores execution venues (AMM, batch auction, cross-chain, PoolFactory pools) and routes to the best one.
- **VibeProtocolOwnedLiquidity** — protocol-owned liquidity primitive that aligns protocol incentives with LP health.

The thesis: above the level of individual primitives (AMM, auction, pool, governance), there's a layer that *composes* them into user-visible flows. The framework subsystem is that layer — protocol-level services that aren't tied to any single mechanism.

## File map

```
contracts/framework/
├── VibeIntentRouter.sol             ← intent routing across venues
├── VibeProtocolOwnedLiquidity.sol   ← POL primitive (protocol-owned LP)
└── interfaces/
```

## Per-contract role

### VibeIntentRouter — intent routing

Users frequently want "the best execution for my swap" rather than "execute on this specific contract." The router lets them state the *intent* and lets the protocol pick the venue.

Routing logic:
1. User calls `router.swap(tokenIn, amountIn, tokenOut, minAmountOut, deadline)`.
2. Router scores available venues:
   - VibeAMM direct swap (current price + slippage estimate).
   - Commit-reveal batch auction (next batch's expected clearing price).
   - Cross-chain venue (LayerZero-routed swap on another chain).
   - PoolFactory pools (any registered pool that can quote `tokenIn → tokenOut`).
3. Router picks the venue with highest expected output for the user.
4. Router executes the swap on the chosen venue.

The user gets best execution without knowing which venue served them. The protocol gets:
- **Individual sovereignty** — users state outcomes, not paths.
- **Cooperative efficiency** — routing volume to healthiest pools strengthens the whole system.

This is the [augmented governance](./AUGMENTED_GOVERNANCE.md) shape applied to execution: math-enforced fairness across venues; the "best for the user" is a measurable property, not a matter of trust.

### VibeProtocolOwnedLiquidity — POL primitive

Protocol-owned liquidity is liquidity held by the protocol itself (rather than by external LPs). The contract manages how the protocol acquires LP positions (typically via bond/treasury deals) and how those positions earn fees that flow back to the protocol treasury.

The economic shape:
- Protocol issues bonds at discount; bond buyers provide LP tokens or assets.
- Protocol receives LP positions; receives fee yield from those positions.
- Yield reinvests into protocol treasury or buys back protocol token.

The structural property: protocol-owned liquidity makes the protocol *less dependent* on external LPs willing to provide liquidity for emissions. Liquidity is acquired once (via bonds) and persists; emissions become reward-shaping rather than rent-paying.

## Composition flow (intent-based swap)

```
1. User has tokenA, wants tokenB
   │
   ▼
2. User calls VibeIntentRouter.swap(tokenA, amountIn, tokenB, minOut, deadline)
   │
   ▼
3. Router queries each venue:
   - VibeAMM: spot price, current liquidity, slippage estimate
   - CommitRevealAuction: next batch expected clearing
   - CrossChainRouter: alternative-chain quotes
   - PoolFactory pools: any registered pool with this pair
   │
   ▼
4. Router compares expected outputs net of gas + slippage
   │
   ▼
5. Router executes on best venue, returns proceeds to user
   │
   ▼
6. (If applicable) Hook callbacks fire on the chosen venue's hook layer
```

The user sees one transaction; the routing is structural.

## Why this layer exists

Without the framework layer, every user-facing wallet/UI re-implements its own routing logic, leading to:
- Inconsistent execution quality across UIs.
- Reduced ability to compose new venues into the routing.
- Centralization of "good routing" at popular UIs.

With the framework layer:
- One canonical router; all UIs consume it.
- New venues plug into the router without UI changes.
- Routing logic is auditable on-chain.

This is the same shape as the [hooks subsystem](./HOOKS_OVERVIEW.md) at a higher level: factor cross-cutting concerns into composable layers, leave the underlying primitives unchanged.

## Composition with broader stack

| External contract | Role |
|-------------------|------|
| `VibeAMM` | swap-path execution venue |
| `CommitRevealAuction` | batch-auction execution venue |
| `CrossChainRouter` | cross-chain execution venue |
| `PoolFactory` | dynamic pool registration |
| `VibeProtocolOwnedLiquidity` | treasury holding for protocol-side LP |
| `VibeTimelock` | timelock for POL governance changes |

The router is deliberately thin — it doesn't implement any of the venues; it scores them and dispatches. POL is similarly thin — it doesn't implement bond mechanics; it consumes a bond contract and manages the resulting LP positions.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `VibeAMM` address | settable | which AMM to score |
| `CommitRevealAuction` address | settable | which auction to score |
| Venue scoring weights | tunable | how to weight gas vs slippage vs latency |
| POL bond rates | governance-tunable | discount applied to bond issuance |

Both contracts are upgradeable but with admin controls (admin set by deploy; transferable via standard ownership).

## Why "framework" and not "router" or "POL"

Naming choice: *framework* is the right name because it implies a *substrate* of services that other contracts consume, not a *single mechanism*. Future additions to this directory will likely be other cross-cutting services (e.g., a unified fee-sink router, a cross-venue MEV-redistribution layer). The `framework/` directory is open-ended; contracts get added as new cross-cutting needs surface.

The alternative (one directory per service) fragments the cross-cutting concerns. The current approach concentrates them, making the protocol's "framework" dimension visible as a single audit surface.

## Related

- [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md) — primary execution venue routed to.
- [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md) — commit-reveal auction venue.
- [`HOOKS_OVERVIEW.md`](./HOOKS_OVERVIEW.md) — sibling cross-cutting layer (hooks attach to venues; router selects between them).
- [`MECHANISM_COVERAGE_MATRIX.md`](./MECHANISM_COVERAGE_MATRIX.md) — what venues exist and what each provides.
- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — math-enforced fairness across execution venues.
