# Monetary Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/monetary/`
**Companions**: [`COGNITIVE_RENT_ECONOMICS`](../concepts/monetary/COGNITIVE_RENT_ECONOMICS.md), [`ECONOMITRA`](../concepts/monetary/ECONOMITRA.md), [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md)

---

## What this subsystem does

VibeSwap's monetary stack: 3 distinct tokens with orthogonal roles, plus a stablecoin and a JUL→CKB-native bridge. Each token serves one economic function; they compose without overlap.

The thesis: a single token cannot serve as money, governance instrument, AND state-rent capital simultaneously. The economic shapes are different. Conflating them produces designs that fail at all three. The 3-token model assigns each role to its appropriate substrate.

## File map

```
contracts/monetary/
├── Joule.sol                ← JUL: PoW-mineable money (Ergon model + 3 stability mechanisms)
├── JULBridge.sol            ← one-way burn: JUL → CKB-native
├── CKBNativeToken.sol       ← CKB-native: PoS state-rent token (third in 3-token model)
├── VIBEToken.sol            ← VIBE: governance + contribution reward (21M cap, Shapley-distributed, 60% PoM)
├── JarvisComputeVault.sol   ← JCV: tracks JUL backing in rebase-invariant units
├── VibeStable.sol           ← stablecoin: MakerDAO CDP + multi-collateral + PID auto-stabilization
└── interfaces/
```

## The 3-token model

The model assigns three orthogonal roles. Per `[F·jul-is-primary-liquidity]`:

| Token | Role | Issuance shape | Cap |
|-------|------|----------------|-----|
| **JUL** (`Joule.sol`) | Money — primary liquidity layer | PoW-mineable (Ergon model) | none (continuous mining) |
| **VIBE** (`VIBEToken.sol`) | Governance + contribution reward | Shapley-distributed, mint-on-contribution only | 21M (60% Proof of Mind) |
| **CKB-native** (`CKBNativeToken.sol`) | State-rent capital — pays for substrate state | PoS-staked, accrues from JUL bridge | scarce by design |

The orthogonality is structural, not just semantic: trying to use VIBE as money breaks governance attribution; trying to use JUL as governance breaks the PoW-money property; trying to use CKB-native as either undermines state-rent economics. Each token's mechanics are tuned for its specific role.

## Per-contract role

### Joule (JUL) — Proof-of-Work money

ERC-20 mineable token implementing the Ergon proportional-PoW model. Three stability mechanisms compose in one asset:

1. **Proportional PoW mining**: hash-rate proportional issuance — miners with X% of network hash get X% of new JUL. No winner-take-all; no halving cliff.
2. **Internal-balance API** (`IJouleInternal`): rebase-invariant tracking for downstream contracts (e.g., JarvisComputeVault) to hold JUL without distortion from rebase events.
3. **Burn-to-bridge**: JUL can be burned to mint CKB-native (one-way), connecting the PoW issuance economy to the PoS state-rent economy.

The shape: JUL is *money* — fungible, continuously issued, used as the unit of account for compute subsidies, marketplace fees, and inter-agent trade. Not governance. Not capital. Money.

### JULBridge — one-way burn

Locks the JUL → CKB-native conversion. Burning N JUL mints `f(N)` CKB-native at a rate set by governance. The reverse is not implemented and not planned: state-rent capital should accumulate, not return to circulation.

This is a deliberate asymmetry. JUL flows continuously (PoW issuance); CKB-native accumulates monotonically (PoS staking + bridge inflows). The substrate's state-rent demand grows over time; the supply tracks.

### CKBNativeToken — state-rent capital

The third token of the model. Distinct from VIBE (governance) and JUL (money). Used to pay for state-rent on the substrate — every contract holding state pays a recurring fee in CKB-native to keep that state alive. Idle storage → no fee → state expires → reclaimable.

This is the [Common Knowledge Base](../concepts/monetary/COGNITIVE_RENT_ECONOMICS.md) economic foundation: state has rent; contributors are paid in VIBE for adding to it; users pay in JUL for using it; the substrate maintains itself in CKB-native.

### VIBEToken — governance + contribution reward

21M hard cap (matches Bitcoin's number). Mint-only-on-contribution: no pre-mine, no airdrop, no faucet. New VIBE comes from `ShapleyDistributor` paying out to participants whose contributions advance the protocol.

60% allocated via Proof of Mind (long-horizon contribution scoring); the remaining 40% across other contribution categories (LP, market-making, integration, audit, etc.).

VIBE holders vote in governance. Their vote weight is bounded by the [Augmented Governance](./AUGMENTED_GOVERNANCE.md) hierarchy: math invariants override DAO votes, fairness floors override math invariants. Vote concentration cannot violate the protocol's structural properties.

### JarvisComputeVault — JUL-backed compute capital

Tracks JUL holdings in rebase-invariant units for downstream contracts. The vault holds JUL deposits, accrues yield from compute subsidy clawback, and exposes a stable interface for `ComputeSubsidyManager` and other JUL consumers.

Rebase-invariant tracking matters because Joule's internal balance API does pre-rebase scalar arithmetic. Naive holders would see balance drift across rebase events; JCV's internal accounting holds steady.

### VibeStable — multi-collateral stablecoin

Merges three lineage patterns:
- **MakerDAO CDP**: collateralized debt positions; user locks collateral, mints stablecoin, repays to unlock.
- **Reserve Rights multi-collateral basket**: stablecoin backed by a basket, not a single asset, reducing single-collateral risk.
- **VibeSwap PID auto-stabilization**: proportional-integral-derivative control loop adjusting collateral ratios in response to peg deviation.

Use cases: predictable-value transfers (where JUL's PoW volatility is unwanted), cross-chain settlement (stable peg makes bridging predictable), institutional integration (regulators expect stable-value instruments).

## Composition flow (simplified)

```
miner runs hash      → mints JUL                       [PoW issuance]
miner sells JUL      → user pays for compute / fees     [JUL as money]
contributor ships    → ShapleyDistributor mints VIBE    [VIBE as contribution reward]
VIBE holder votes    → governance proposal              [VIBE as governance]
substrate state held → CKB-native rent paid             [CKB-native as state capital]
JUL holder bridges   → burn JUL → mint CKB-native       [one-way conversion]
collateral lockup    → mint VibeStable                  [stable peg use]
```

The flows are orthogonal. JUL's velocity (high) does not affect VIBE's distribution (Shapley) does not affect CKB-native's accumulation (PoS+burn) does not affect VibeStable's peg (PID).

## Why three, not one or two

A 1-token model conflates roles: the same instrument is money, governance, and state-rent. Result: vote weight tracks short-term holdings (anyone who buys volume can change governance); state-rent payments compete with money-velocity demand; new contributors face a token cap that wasn't sized for them.

A 2-token model splits money from governance but conflates one with state-rent. The conflation shows up as: state-rent fees affect token velocity (slowing trading) OR governance weight tracks state-rent payments (penalizing low-state participants). Neither is acceptable.

The 3-token model assigns each role to a token whose mechanics fit. Money flows; governance distributes by contribution; state-rent accumulates monotonically. No conflation.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| JUL mining params | per-network | hash-rate weight, block reward |
| VIBE Shapley weights | governance-tunable | how to weight contribution categories |
| CKB-native rent rate | per-state-class | different storage classes have different rents |
| VibeStable PID gains | governance-tunable | proportional/integral/derivative coefficients |
| JUL → CKB-native bridge rate | governance-tunable | burn-to-mint conversion factor |

All tokens are upgrade-resistant in their core math (issuance, supply caps); upgradability is restricted to admin-tunable parameters. The 21M VIBE cap and the JUL PoW model are not governance-mutable.

## Related

- [`COGNITIVE_RENT_ECONOMICS.md`](../concepts/monetary/COGNITIVE_RENT_ECONOMICS.md) — economic foundation for CKB-native rent.
- [`ECONOMITRA.md`](../concepts/monetary/ECONOMITRA.md) — broader economic theory of the protocol.
- [`COMPUTE_SUBSIDY_OVERVIEW.md`](./COMPUTE_SUBSIDY_OVERVIEW.md) — primary JUL consumer.
- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — VIBE vote-weight bounds.
- [`DEPLOYMENT_TOPOLOGY.md`](./DEPLOYMENT_TOPOLOGY.md) — deploy order and wiring across the monetary contracts.
