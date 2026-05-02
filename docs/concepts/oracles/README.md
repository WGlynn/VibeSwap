# Oracles

> True-price discovery via Kalman filtering and commit-reveal aggregation.

## What lives here

VibeSwap's oracle stack — the off-chain and on-chain primitives that produce a clearing-price reference robust against manipulation. The TruePriceOracle composes multiple feeds; the Kalman filter does latent-true-price estimation from noisy observations; commit-reveal aggregation prevents front-running of oracle updates themselves. These docs go from concept down to deep-dive math.

## Highlights

| Document | Covers |
|---|---|
| [TRUE_PRICE_ORACLE.md](TRUE_PRICE_ORACLE.md) | Architecture of the multi-source true-price oracle |
| [TRUE_PRICE_ORACLE_DEEP_DIVE.md](TRUE_PRICE_ORACLE_DEEP_DIVE.md) | Mathematical detail — feed fusion, weighting, sanity bounds |
| [TRUE_PRICE_DISCOVERY.md](TRUE_PRICE_DISCOVERY.md) | The discovery problem — what "true price" means when every venue is local |
| [KALMAN_FILTER_ORACLE.md](KALMAN_FILTER_ORACLE.md) | Kalman state-space estimation applied to noisy on-chain price feeds |
| [PRICE_INTELLIGENCE_ORACLE.md](PRICE_INTELLIGENCE_ORACLE.md) | Higher-level intelligence layer — anomaly detection, regime classification |
| [COMMIT_REVEAL_FOR_ORACLES.md](COMMIT_REVEAL_FOR_ORACLES.md) | Applying the commit-reveal pattern to oracle reporters to prevent last-look |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — oracle integration in the AMM
- Related concepts:
  - [../commit-reveal/](../commit-reveal/) — the same primitive applied to user orders
  - [../security/](../security/) — TWAP validation, circuit breakers consume oracle output
  - [../cross-chain/](../cross-chain/) — cross-chain price reconciliation
