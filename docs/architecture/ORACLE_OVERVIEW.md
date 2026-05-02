# Oracle Overview

> A reader's map of VibeSwap's oracle architecture — beginning with the load-bearing claim that **trade execution does not depend on a price oracle at all**, then walking through the off-chain consumers, fallback architecture, and freshness gates.

For consensus context, see [`CONSENSUS_OVERVIEW.md`](CONSENSUS_OVERVIEW.md). For how the AMM consumes these oracles defensively (TWAP / drift gates), see [`AMM_OVERVIEW.md`](AMM_OVERVIEW.md). For deep dives on individual oracle pieces, see [`../concepts/oracles/`](../concepts/oracles/).

---

## 1. The Oracle Problem (Sidestepped)

> **Load-bearing claim**: VibeSwap does not depend on a price oracle for trade execution. The execution price emerges from the batch clearing itself.

The standard DeFi oracle problem: protocols consume an external price feed to settle trades. That feed becomes the attack surface — manipulate the feed, manipulate the settlement. Defenses pile on (multi-source aggregation, deviation gates, pause logic) but the structural dependency remains.

VibeSwap's commit-reveal batch auction breaks this dependency. Each batch:

1. Collects committed orders blindly (intent hidden, see [`CONSENSUS_OVERVIEW.md`](CONSENSUS_OVERVIEW.md) §3).
2. Reveals all orders simultaneously after the commit window closes.
3. Computes a **uniform clearing price from the revealed order book itself** — supply and demand within the batch determine the price.

There is no external oracle in the settlement path. The oracle stack below exists for *defensive cross-checks*, *off-chain consumers*, and *cross-chain price portability* — none of these are on the critical path of "what price does this trade execute at."

This is the same principle as on-exchange price discovery in traditional markets: the auction *is* the oracle.

---

## 2. TruePriceOracle (TPO)

Implementation: [`contracts/oracles/TruePriceOracle.sol`](../../contracts/oracles/TruePriceOracle.sol).

**What it is**: A Bayesian-posterior estimator of equilibrium price, computed off-chain by a Kalman filter and pushed on-chain via EIP-712-signed updates. Filters out leverage-driven distortions, liquidation cascades, and stablecoin-enabled manipulation ([`TruePriceOracle.sol:13-28`](../../contracts/oracles/TruePriceOracle.sol)).

**What it is for**:
- Off-chain consumers (analytics dashboards, portfolio tools, indexers) that want a noise-filtered price reference.
- Defensive cross-check inside VibeAMM via `truePriceMaxStaleness` ([`VibeAMM.sol:188-191`](../../contracts/amm/VibeAMM.sol)) — used as a sanity bound, not as the execution price.
- Cross-chain price portability where one chain's batch hasn't yet cleared and a fresh reference is needed.

**Freshness gates** ([`TruePriceOracle.sol:43-49`](../../contracts/oracles/TruePriceOracle.sol)):

| Constant | Value | Purpose |
|---|---|---|
| `MAX_STALENESS` | 5 minutes | Hard age cap on usable prices. |
| `MAX_PRICE_JUMP_BPS` | 1000 (10%) | Max delta between consecutive updates. |
| `HISTORY_SIZE` | 24 | Two hours of 5-minute updates retained. |

**C49-F1 (post-fix)**: Aggregator pulls now enforce the same `MAX_STALENESS` window against `batch.revealDeadline`, not just replay-protection. Without it, an adversary could pull a long-settled batch (whose median reflected market conditions days/weeks old) for the *first* time and overwrite the live TruePrice. See [`TruePriceOracle.sol:461-472`](../../contracts/oracles/TruePriceOracle.sol).

Stablecoin-aware bounds ([`TruePriceOracle.sol:51-53`](../../contracts/oracles/TruePriceOracle.sol)): when USDT dominates flow, validation tightens to 80%; when USDC dominates, it loosens to 120%. Mechanism explained in [`../concepts/oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md`](../concepts/oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md).

EIP-712 signed updates only, with per-signer nonces ([`TruePriceOracle.sol:65-78, 92-94`](../../contracts/oracles/TruePriceOracle.sol)).

---

## 3. VibeOracleRouter

Implementation: [`contracts/oracles/VibeOracleRouter.sol`](../../contracts/oracles/VibeOracleRouter.sol).

**What it is**: A multi-source oracle aggregation router that unifies three feed paradigms — Chainlink-style aggregators, API3-style first-party feeds, and Pyth-style low-latency feeds — into one quality-weighted layer with Shapley-attributed rewards ([`VibeOracleRouter.sol:8-22`](../../contracts/oracles/VibeOracleRouter.sol)).

**Design choices** ([`VibeOracleRouter.sol:17-22`](../../contracts/oracles/VibeOracleRouter.sol)):
- Pull-pattern rewards (providers call `claimRewards`).
- Accuracy scores **decay toward baseline** — no permanent reputation lock-in, fresh providers can earn in.
- Weighted median resists up to 49% of corrupted weight.
- Feed IDs are deterministic: `keccak256(abi.encodePacked(base, quote))`.

**Accuracy economics** ([`VibeOracleRouter.sol:73-79`](../../contracts/oracles/VibeOracleRouter.sol)):
- Initial score: 5000 bps (50%).
- Each report within 200 bps of the median: +50 bps.
- Each report outside: -200 bps.
- Asymmetric — rewards accuracy slowly, punishes deviation 4× faster.

**Staleness handling** ([`VibeOracleRouter.sol:104`](../../contracts/oracles/VibeOracleRouter.sol)): `maxStaleness` enforced before fallback. Circuit-breaker per feed when deviation exceeds `deviationThreshold`.

This is the layer external integrations should typically read from. TPO is the manipulation-resistant *true price*; VibeOracleRouter is the multi-source *quoted price* with provenance.

---

## 4. VWAPOracle

Implementation: [`contracts/libraries/VWAPOracle.sol`](../../contracts/libraries/VWAPOracle.sol).

**What it is**: A volume-weighted average price library used as a backup signal alongside TWAP. State lives per-pool inside VibeAMM ([`VibeAMM.sol:196`](../../contracts/amm/VibeAMM.sol)).

**C19-F1 (post-fix dust-trade handling)** — [`VWAPOracle.sol:97-112`](../../contracts/libraries/VWAPOracle.sol):

The prior implementation truncated volume at *different stages* in the price-contribution and volume-cumulative computations:

```
priceContribution = scaledPrice * volume / PRECISION    // truncates here
volumeCumulative += volume / PRECISION                  // truncates here
```

For sub-1-token trades on 18-decimal assets — or any non-trivial trade on low-decimal tokens like USDC-6 — `priceContribution` accumulated a non-zero value while `volumeCumulative` did not. Net effect: VWAP biased toward dust-trade prices, which an attacker could exploit by spamming dust orders at a target price.

Fix: normalize volume to PRECISION units up-front so both cumulators truncate symmetrically; treat dust trades (`scaledVolume == 0`) as no-ops that update `lastPrice` for fallback queries but do not pollute either cumulator.

This is a worked example of the **observability-before-tuning** primitive ([`../concepts/primitives/observability-before-tuning.md`](../concepts/primitives/observability-before-tuning.md)) — the bias was structurally invisible until volume-weighted accumulation was instrumented at the precision boundary.

VWAP role: cross-check against TWAP. When the two diverge significantly, manipulation is likely on at least one. Both feed into VibeAMM circuit-breaker decisions.

---

## 5. Commit-Reveal Aggregation (OracleAggregationCRA)

Implementation: [`contracts/oracles/OracleAggregationCRA.sol`](../../contracts/oracles/OracleAggregationCRA.sol).

**What it is**: A commit-reveal batch aggregator for off-chain price contributions, used when multi-party off-chain inputs need to be aggregated into a single trustworthy on-chain median.

**Why it exists**: Implements FAT-AUDIT-2 / ETM Alignment Gap 2 — replaces TPO's policy-level 5% deviation gate with **structural commit-reveal opacity** over a batch of registered issuers ([`OracleAggregationCRA.sol:13-21`](../../contracts/oracles/OracleAggregationCRA.sol)). Same primitive as the trade auction (Section 1 above), applied to oracle inputs.

**Phase parameters** ([`OracleAggregationCRA.sol:31-42`](../../contracts/oracles/OracleAggregationCRA.sol)):

| Constant | Value | Source |
|---|---|---|
| `COMMIT_PHASE_DURATION` | 30 seconds | Paper §6.1 — temporal augmentation window. |
| `REVEAL_PHASE_DURATION` | 10 seconds | Mirrors SOR challenge response window. |
| `MIN_REVEALS_FOR_SETTLEMENT` | 3 | Min reveals to compute a valid median. |
| `NON_REVEAL_SLASH_BPS` | 5000 (50%) | Issuers who commit but fail to reveal lose half their stake (Paper §5.3 CRBA SLASH_RATE, §6.5 Compensatory Augmentation). |

**Settlement path**: settled batches publish to TruePriceOracle via `pullFromAggregator(poolId, batchId)` ([`TruePriceOracle.sol:454`](../../contracts/oracles/TruePriceOracle.sol)). Confidence is proportional to reveal count — 3 reveals → ~30%, 10+ reveals → 100% ([`TruePriceOracle.sol:474-477`](../../contracts/oracles/TruePriceOracle.sol)).

Issuer registry: [`contracts/oracles/IssuerReputationRegistry.sol`](../../contracts/oracles/IssuerReputationRegistry.sol). Issuers stake to participate; non-revealers are slashed; the slash pool sweeps to the treasury.

---

## 6. Heartbeat / Staleness Gates

| Surface | Constant | Value | Reference |
|---|---|---|---|
| TruePriceOracle (signed updates) | `MAX_STALENESS` | 5 min | [`TruePriceOracle.sol:47`](../../contracts/oracles/TruePriceOracle.sol) |
| TruePriceOracle (aggregator pulls, post-C49-F1) | same `MAX_STALENESS` against `revealDeadline` | 5 min | [`TruePriceOracle.sol:461-472`](../../contracts/oracles/TruePriceOracle.sol) |
| VibeOracleRouter | `maxStaleness` (configurable) | runtime | [`VibeOracleRouter.sol:104`](../../contracts/oracles/VibeOracleRouter.sol) |
| VibeAMM (TruePrice consumer) | `truePriceMaxStaleness` | 5 min default | [`VibeAMM.sol:191`](../../contracts/amm/VibeAMM.sol) |
| VibeAMM (TWAP) | `DEFAULT_TWAP_PERIOD` | 10 min | [`VibeAMM.sol:86`](../../contracts/amm/VibeAMM.sol) |
| VibeAMM (TWAP drift snapshot) | `TWAP_DRIFT_WINDOW` | 10 min | [`VibeAMM.sol:108`](../../contracts/amm/VibeAMM.sol) |
| OracleAggregationCRA | `COMMIT_PHASE_DURATION` + `REVEAL_PHASE_DURATION` | 30s + 10s | [`OracleAggregationCRA.sol:31-35`](../../contracts/oracles/OracleAggregationCRA.sol) |

**The C49-F1 lesson**: replay-protection is *not* freshness. Replay only ensures "this exact data wasn't used before" — it says nothing about *when* the data was generated. A long-settled aggregator batch is still "novel" from the perspective of a TPO that hasn't yet pulled it. Freshness must be enforced explicitly against the data's origin timestamp, not against the consumer's last-seen state.

---

## 7. Cross-References

- **Oracle concept docs (one mechanism per doc)** → [`../concepts/oracles/`](../concepts/oracles/)
  - [`TRUE_PRICE_ORACLE.md`](../concepts/oracles/TRUE_PRICE_ORACLE.md), [`TRUE_PRICE_ORACLE_DEEP_DIVE.md`](../concepts/oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md)
  - [`TRUE_PRICE_DISCOVERY.md`](../concepts/oracles/TRUE_PRICE_DISCOVERY.md)
  - [`KALMAN_FILTER_ORACLE.md`](../concepts/oracles/KALMAN_FILTER_ORACLE.md)
  - [`COMMIT_REVEAL_FOR_ORACLES.md`](../concepts/oracles/COMMIT_REVEAL_FOR_ORACLES.md)
  - [`PRICE_INTELLIGENCE_ORACLE.md`](../concepts/oracles/PRICE_INTELLIGENCE_ORACLE.md)
- **Observability-before-tuning primitive** (the C19-F1 lesson) → [`../concepts/primitives/observability-before-tuning.md`](../concepts/primitives/observability-before-tuning.md)
- **Off-chain Kalman filter implementation** → [`../../oracle/`](../../oracle/) (Python)
- **Companion overviews** → [`CONSENSUS_OVERVIEW.md`](CONSENSUS_OVERVIEW.md), [`AMM_OVERVIEW.md`](AMM_OVERVIEW.md)
- **Existing oracle-architecture deliveries** → [`oracle/`](oracle/)

---

*The auction is the oracle. Everything below is defense in depth, off-chain consumption, and cross-chain portability — never the price the trade executes at.*
