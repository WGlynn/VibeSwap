# AMM Overview

> A reader's map of VibeSwap's AMM stack — how a constant-product invariant, a batch-auction layer, TWAP-based manipulation defenses, position-aware LP accounting, cooperative fee routing, and a cross-chain settlement path compose into one liquidity surface.

For consensus context, see [`CONSENSUS_OVERVIEW.md`](CONSENSUS_OVERVIEW.md). For the oracle pieces this AMM relies on, see [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md).

---

## 1. Constant-Product (x·y=k) Baseline

The base curve is the standard constant-product AMM: `x · y = k`. Implementation: [`contracts/amm/VibeAMM.sol`](../../contracts/amm/VibeAMM.sol).

Key parameters (see [`VibeAMM.sol:62-108`](../../contracts/amm/VibeAMM.sol)):

| Constant | Value | Why |
|---|---|---|
| `DEFAULT_FEE_RATE` | 5 bps (0.05%) | Lower than traditional AMMs because batch auctions reduce IL from MEV extraction. |
| `MINIMUM_LIQUIDITY` | 10 000 | Locked forever; first-depositor-attack defense. |
| `MAX_PRICE_DEVIATION_BPS` | 500 (5%) | Hard cap on per-swap deviation from TWAP. |
| `MAX_TWAP_DRIFT_BPS` | 200 (2%) | Per-window cap. AMM-05 cross-window drift gate. |
| `DEFAULT_TWAP_PERIOD` | 10 minutes | TWAP averaging window. |
| `MAX_TRADE_SIZE_BPS` | 1000 (10%) | Single-trade cap as % of reserves. |
| `SMALL_WITHDRAWAL_BPS_THRESHOLD` | 100 (1%) | CB-04: small LPs can exit even when whales trip the breaker. |

The contract inherits [`CircuitBreaker`](../../contracts/core/CircuitBreaker.sol) directly, so volume / price / withdrawal breakers are first-class on every pool.

---

## 2. Batch-Auction Layer on Top

VibeAMM is *not* the only execution path. The composition is:

```
incoming order
      │
      ▼
┌─────────────────────────┐
│  CommitRevealAuction    │  try direct match within the 10s batch
│  (uniform clearing)     │  ──── matched? settle at clearing price
└─────────────────────────┘            │
      │ unmatched residual             │
      ▼                                ▼
┌─────────────────────────┐    LPs untouched on a clean
│      VibeAMM            │    batch-internal cross
│  (x·y=k fallback)       │
└─────────────────────────┘
```

Direct matches inside a batch never touch LP reserves — they cross at the uniform clearing price between coincidence-of-wants pairs. Only the residual (unmatched volume) hits the AMM curve. Net effect: lower realized slippage for traders, lower IL for LPs, no MEV surface for searchers.

The batch / AMM handoff is orchestrated by [`contracts/core/VibeSwapCore.sol`](../../contracts/core/VibeSwapCore.sol). Settlement is permissionless ([`CommitRevealAuction.sol:796`](../../contracts/core/CommitRevealAuction.sol)).

---

## 3. TWAP Validation

Two distinct gates, defending two distinct attacks:

### 3.1 The 5% single-swap deviation gate
`MAX_PRICE_DEVIATION_BPS = 500` ([`VibeAMM.sol:80`](../../contracts/amm/VibeAMM.sol)). Any single swap that would drive the spot price more than 5% from the TWAP reverts. Catches single-block oracle-distortion attempts.

### 3.2 AMM-05: cross-window drift gate
`MAX_TWAP_DRIFT_BPS = 200` per window of `TWAP_DRIFT_WINDOW = 10 minutes` ([`VibeAMM.sol:88-108`](../../contracts/amm/VibeAMM.sol)).

The threat: a sophisticated attacker walks the TWAP itself across many windows, each individual swap staying under the 5% single-trade limit but compounding into a manipulated reference. The AMM-05 gate pre-checks at every swap whether the TWAP has drifted more than 2% since the previous window's snapshot — if so, the price is damped back toward the snapshot. The honest market can move 2%/window without ever triggering this; a 30-min sustained manipulation campaign (3 windows × 2% = 6%) is caught by the TruePrice circuit breaker before it reaches the ceiling.

Library: [`contracts/libraries/TWAPOracle.sol`](../../contracts/libraries/TWAPOracle.sol). Event surface: `TWAPDriftDetected` ([`VibeAMM.sol:276`](../../contracts/amm/VibeAMM.sol)).

---

## 4. LP Positions

The LP token: [`contracts/amm/VibeLP.sol`](../../contracts/amm/VibeLP.sol) — ERC20, owned by VibeAMM, minted on liquidity-add and burned on liquidity-remove. Symbol auto-generated from the underlying pair (`VLP-<sym0>-<sym1>`).

Position-aware accounting:
- Per-pool LP balance tracked in `liquidityBalance[poolId][user]` as a backup ledger ([`VibeAMM.sol:142`](../../contracts/amm/VibeAMM.sol)).
- VWAP oracle state per-pool ([`VibeAMM.sol:196`](../../contracts/amm/VibeAMM.sol)) drives the position-time weighting that ShapleyDistributor consumes.
- Liquidity-protection config per-pool ([`VibeAMM.sol:199`](../../contracts/amm/VibeAMM.sol)) exposes [`LiquidityProtection`](../../contracts/libraries/LiquidityProtection.sol) hooks.

LP rewards are not pro-rata. They're computed via the **5 Shapley contribution factors** (direct liquidity, enabling time, scarcity, stability, pioneer bonus) — see [`ShapleyDistributor.sol`](../../contracts/incentives/ShapleyDistributor.sol) and [`AUGMENTED_MECHANISM_DESIGN.md`](AUGMENTED_MECHANISM_DESIGN.md).

NFT variant for visualizable positions: [`contracts/amm/VibeLPNFT.sol`](../../contracts/amm/VibeLPNFT.sol). Pool factory: [`contracts/amm/VibePoolFactory.sol`](../../contracts/amm/VibePoolFactory.sol). Router: [`contracts/amm/VibeRouter.sol`](../../contracts/amm/VibeRouter.sol).

---

## 5. Fee Routing

The flow:

```
       VibeAMM swap                       priority bid (CRA)
            │                                     │
            ▼                                     ▼
┌────────────────────────────────────────────────────────────┐
│              ProtocolFeeAdapter                            │
│  (set as VibeAMM "treasury" — bridges direct fees)         │
│  contracts/core/ProtocolFeeAdapter.sol                     │
└────────────────────────────────────────────────────────────┘
            │
            ▼ forwardFees(token) / forwardETH()
┌────────────────────────────────────────────────────────────┐
│                   FeeRouter                                │
│  100% of swap fees → LPs via ShapleyDistributor            │
│  contracts/core/FeeRouter.sol                              │
└────────────────────────────────────────────────────────────┘
            │
            ▼ collectFee(token, amount)
┌────────────────────────────────────────────────────────────┐
│              ShapleyDistributor                            │
│  Shapley FEE_DISTRIBUTION track (time-neutral)             │
│  contracts/incentives/ShapleyDistributor.sol               │
└────────────────────────────────────────────────────────────┘
```

Two pieces:

- [`contracts/core/ProtocolFeeAdapter.sol`](../../contracts/core/ProtocolFeeAdapter.sol) — set as the `treasury` address on VibeAMM and CommitRevealAuction. Catches fees that would otherwise dead-end at a treasury and forwards them through the cooperative path. Comment block at [`ProtocolFeeAdapter.sol:18-40`](../../contracts/core/ProtocolFeeAdapter.sol) lays out the why.
- [`contracts/core/FeeRouter.sol`](../../contracts/core/FeeRouter.sol) — accepts from authorized sources, accumulates per-token, forwards 100% to LPs via ShapleyDistributor. The protocol takes no cut. See the rationale at [`FeeRouter.sol:10-25`](../../contracts/core/FeeRouter.sol).

Fees stay in the token they were generated in (no swap-to-USDC). MEV-priority bids are bridged through WETH.

`protocolFeeShare` on VibeAMM defaults to 0 (100% to LPs) and is capped at 25% to ensure LPs always receive the majority ([`VibeAMM.sol:73`](../../contracts/amm/VibeAMM.sol)).

---

## 6. Cross-Chain Swap Path

Cross-chain swaps run on LayerZero V2 via [`contracts/messaging/CrossChainRouter.sol`](../../contracts/messaging/CrossChainRouter.sol).

Message types ([`CrossChainRouter.sol:62-69`](../../contracts/messaging/CrossChainRouter.sol)):

```
ORDER_COMMIT           — relay commit hash + deposit to dest chain
ORDER_REVEAL           — relay reveal + secret + priority bid
BATCH_RESULT           — propagate batch outcomes
LIQUIDITY_SYNC         — keep cross-chain reserves consistent
ASSET_TRANSFER         — bridge actual tokens
SETTLEMENT_CONFIRM     — XC-003: dest → source confirmation that batch settled
```

Flow (success):
1. User commits on source chain. CrossChainRouter relays `ORDER_COMMIT` to dest chain CRA.
2. User reveals on source chain → `ORDER_REVEAL` relayed.
3. Dest chain settles its batch (Fisher-Yates + uniform clearing).
4. `SETTLEMENT_CONFIRM` returns to source chain, calls `markCrossChainSettled(commitHash)` on VibeSwapCore ([`CrossChainRouter.sol:14-17`](../../contracts/messaging/CrossChainRouter.sol)).
5. Tokens land at the user's `destinationRecipient` (XC-005, [`CrossChainRouter.sol:78`](../../contracts/messaging/CrossChainRouter.sol)) — explicitly chosen up-front so smart-wallet users don't lose funds to address-mapping ambiguity.

Refund path:
- Unspent ETH from fee budget refunded synchronously to caller ([`CrossChainRouter.sol:486-490`](../../contracts/messaging/CrossChainRouter.sol)).
- Unrevealed cross-chain commits return to depositor via the timeout-refund path; double-spend prevented by the post-settlement confirmation gate.

Replay defense: every commit carries `dstChainId` and `srcTimestamp` ([`CrossChainRouter.sol:71-79`](../../contracts/messaging/CrossChainRouter.sol)) so the same commit hash on different chains resolves to different on-chain identities.

---

## 7. Cross-References

- **Oracles** the AMM consumes (TWAP, VWAP, TruePrice, Aggregator, Router) → [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md), [`../concepts/oracles/`](../concepts/oracles/)
- **Circuit breakers** (volume / price / withdrawal) → [`../concepts/security/CIRCUIT_BREAKER_DESIGN.md`](../concepts/security/CIRCUIT_BREAKER_DESIGN.md), implementation [`contracts/core/CircuitBreaker.sol`](../../contracts/core/CircuitBreaker.sol)
- **Flash-loan protection** → [`../concepts/security/FLASH_LOAN_PROTECTION.md`](../concepts/security/FLASH_LOAN_PROTECTION.md)
- **Fibonacci-scaled throughput** (per-user damping, AMM swap-rate limits) → [`../concepts/security/FIBONACCI_SCALING.md`](../concepts/security/FIBONACCI_SCALING.md), library [`contracts/libraries/FibonacciScaling.sol`](../../contracts/libraries/FibonacciScaling.sol)
- **Composition rules between AMM and other mechanisms** → [`MECHANISM_COMPOSITION_ALGEBRA.md`](MECHANISM_COMPOSITION_ALGEBRA.md)
- **Companion overviews** → [`CONSENSUS_OVERVIEW.md`](CONSENSUS_OVERVIEW.md), [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md)
- **Auto-amnesia / write-through state protocols (relevant to settlement event accounting)** → [`../_meta/protocols/`](../_meta/protocols/)

---

*The AMM curve is the fallback. The first try is always a coincidence-of-wants match at the uniform clearing price — LPs are paid for being there, not for being arbitraged.*
