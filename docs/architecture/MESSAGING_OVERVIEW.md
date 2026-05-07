# Messaging Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/messaging/`
**Companions**: [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md), [`DEPLOYMENT_TOPOLOGY.md`](./DEPLOYMENT_TOPOLOGY.md)

---

## What this subsystem does

A single contract: `CrossChainRouter`. LayerZero V2-compatible cross-chain router for order submission and liquidity synchronization across the chains where VibeSwap is deployed.

The thesis: an omnichain DEX needs a unified order-submission surface and a unified liquidity view. Without it, each chain becomes its own siloed market and arbitrage between them happens off-protocol (via external bridges with their own trust assumptions). With it, an order submitted on chain A can settle on chain B's liquidity, and liquidity providers see one aggregated pool not N isolated ones.

## File map

```
contracts/messaging/
└── CrossChainRouter.sol
```

One contract. The `messaging/` directory is single-purpose for now; future cross-chain messaging primitives may join.

## What `CrossChainRouter` does

Two primary roles:

### Cross-chain order submission

Users on chain A submit orders to be settled on chain B's liquidity. The router:

1. Accepts the commit hash from chain A's `CommitRevealAuction` (or direct AMM swap).
2. Sends a LayerZero V2 message to chain B's router.
3. Chain B's router executes the order against B's liquidity; produces fill event.
4. Fill event flows back to chain A; chain A's settlement layer (`VibeSwapCoreSettlement`) marks the order settled.

LayerZero V2 provides the cross-chain-message reliability surface; the router handles the protocol-specific semantics (commit hash binding, settlement callback, message rate limiting).

### Liquidity synchronization

Pool state on each chain needs to be visible to the others for routing decisions. The router periodically syncs:
- Aggregate pool reserves per (chain, pair).
- Cumulative volume.
- TWAP snapshots for price discovery.

The sync messages are LayerZero V2 lzReceive callbacks. Rate-limited to bound message gas.

## Trust model

LayerZero V2's Ultra Light Node (ULN) trust assumption sits underneath. The protocol trusts:
- LayerZero's relayer + executor to deliver messages.
- LayerZero's verifier to validate messages haven't been tampered with.
- The DVN (Decentralized Verifier Network) configuration of the pool.

This is weaker than SPV-style trustless bridges (e.g., what CAT Protocol's cross-chain transfer offers on Bitcoin substrate) but stronger than pure-multisig bridges. The trade-off: latency vs trustlessness. SPV requires waiting for finality; ULN is typically faster but adds the DVN trust.

VibeSwap's choice: ULN is correct for AMM-style synchronization where seconds matter. For high-stakes value bridging, the DVN configuration can be tightened (more verifiers, more costly attack).

## Composition flow (cross-chain swap)

```
User on chain A wants to swap A.tokenX for B.tokenY:
   │
   ▼
1. User commits order to chain A's CommitRevealAuction
   commit hash H = keccak(order || secret)
   │
   ▼
2. After commit window, user reveals on chain A
   Chain A computes order intent locally
   │
   ▼
3. CrossChainRouter on chain A sends LayerZero V2 message:
   { commitHash: H, intentParams, deadline }
   to chain B's CrossChainRouter
   │
   ▼
4. Chain B's CrossChainRouter executes against B's liquidity:
   B.VibeAMM.swap or B.CommitRevealAuction.fill
   produces fill event with estimatedOut
   │
   ▼
5. Chain B sends settlement-confirmation message back to chain A
   IVibeSwapCoreSettlement.settleCrossChainOrder(commitHash, poolId, estimatedOut)
   │
   ▼
6. Chain A marks the order settled via markCrossChainSettled(commitHash)
   user's order is settled with proceeds from B's liquidity
```

The user sees one transaction (commit on A, reveal on A); the cross-chain mechanics happen via the router under the hood.

## Why a router, not direct contract calls

Without the router, every cross-chain interaction would re-implement LayerZero V2 wiring. This produces:
- Duplicated cross-chain logic across many contracts.
- Inconsistent message-rate-limiting policy (each contract sets its own).
- Higher audit surface (each cross-chain call site is a new attack vector).

With the router:
- One canonical contract handles all cross-chain messaging.
- Rate limiting is uniform across pool types.
- LayerZero V2 wiring is in one place; auditable as a single surface.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| LayerZero endpoint | per-chain | the LZ V2 endpoint contract address on this chain |
| Peer routers | settable | which chains' routers to talk to (one per supported chain) |
| Message rate limits | tunable | per-peer cap on incoming messages per block |
| Settlement callback | settable | which `IVibeSwapCoreSettlement` to call on this chain |

UUPS-upgradeable; admin controls peers and rate limits.

## Cross-chain order risk surface

Cross-chain orders introduce risk that single-chain orders don't:

- **Settlement delay**: chain B's liquidity may move adversely between commit on A and execution on B.
- **Message failure**: LayerZero message could fail to deliver; order needs a refund-on-timeout path.
- **Adversarial routing**: a malicious proposer could route a cross-chain order to a chain where they hold pool liquidity, profiting from the price gap.

The router addresses each:
- Settlement-delay: order has `deadline` parameter; expired orders refund automatically.
- Message-failure: settlement-callback timeout triggers refund; user gets back deposit on chain A.
- Adversarial routing: routing decision is made by the router (deterministic), not by the proposer; gaming requires controlling the router config.

## Pending design calls (per SESSION_STATE)

The CrossChainRouter has known issues flagged in earlier sessions:
- LayerZero EID 4-arg signature mismatch (BLOCKING for deployment)
- BuybackEngine cross-chain integration

These are design-call-required, not regressions. Settlement of these blocks deployment of cross-chain functionality but doesn't affect single-chain operation.

## Composition with broader stack

| External contract | Role |
|-------------------|------|
| `VibeSwapCore` | settlement callback target (`markCrossChainSettled`, `settleCrossChainOrder`) |
| `CommitRevealAuction` | order source for cross-chain orders |
| `VibeAMM` | direct-swap execution venue on remote chain |
| LayerZero V2 endpoint (external) | message transport |

## Why this is its own subsystem

Cross-chain messaging is structurally distinct from intra-chain mechanisms. The trust model differs (LayerZero ULN vs single-chain consensus). The latency differs (block time × hop count). The economic model differs (cross-chain MEV is a different surface than intra-chain MEV).

Conflating cross-chain with intra-chain forces every contract to handle both. Splitting lets cross-chain concerns concentrate in `messaging/` while other subsystems stay chain-local.

## Related

- [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md) — commit-reveal auction submission origin.
- [`DEPLOYMENT_TOPOLOGY.md`](./DEPLOYMENT_TOPOLOGY.md) — which chains the protocol deploys on.
- [`CROSS_CHAIN_ATTESTATION.md`](../concepts/cross-chain/CROSS_CHAIN_ATTESTATION.md) — sibling design framing.
- [`CROSS_CHAIN_SETTLEMENT.md`](../concepts/cross-chain/CROSS_CHAIN_SETTLEMENT.md) — settlement-flow design.
- [`CROSS_CHAIN_STATE_ATOMICITY.md`](../concepts/cross-chain/CROSS_CHAIN_STATE_ATOMICITY.md) — atomicity guarantees.
