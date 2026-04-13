# Kalman Filter Price Oracle: Bayesian State Estimation for True Price Discovery

## A Technical Analysis of Multi-Source Price Aggregation, Regime Classification, and Stablecoin Flow Dynamics

**Author**: Faraday1
**Date**: March 2026
**Version**: 1.0

---

## Abstract

Spot prices in cryptocurrency markets are systematically distorted. Leverage liquidations, wash trading, stablecoin-enabled manipulation, and exchange order book gaming produce "observed" prices that diverge — sometimes dramatically — from the equilibrium price that would emerge from genuine supply and demand. Naively consuming these prices as oracle inputs imports manipulation into any protocol that depends on them.

This paper presents VibeSwap's True Price Oracle: a Kalman filter-based state estimation system that treats the true equilibrium price as a hidden state variable and observed market prices as noisy measurements. The filter aggregates observations from multiple venues (Binance, Coinbase, OKX, Kraken, Uniswap), weights them by reliability, adjusts noise parameters dynamically based on stablecoin flow analysis and leverage stress indicators, and outputs the most likely true price along with a calibrated confidence interval.

The oracle operates in two layers: an off-chain Python pipeline that runs the Kalman filter, performs regime classification, and generates signed attestations; and an on-chain Solidity contract that validates signatures, enforces price jump limits, maintains a 24-sample ring buffer of historical prices, and exposes the True Price data to other protocol components.

We show that this approach is strictly superior to simple TWAP (Time-Weighted Average Price) oracles because the Kalman filter explicitly models observation noise, adapts its trust in different price sources based on market conditions, and produces mathematically optimal estimates given the noise model.

---

## Table of Contents

1. [The Problem: Distorted Price Signals](#1-the-problem-distorted-price-signals)
2. [The Solution: Price as Hidden State](#2-the-solution-price-as-hidden-state)
3. [How Kalman Filtering Works](#3-how-kalman-filtering-works)
4. [Multi-Source Aggregation](#4-multi-source-aggregation)
5. [Regime Classification](#5-regime-classification)
6. [Stablecoin Flow Asymmetry](#6-stablecoin-flow-asymmetry)
7. [On-Chain Component](#7-on-chain-component)
8. [Why Kalman > TWAP](#8-why-kalman--twap)
9. [Integration with VibeSwap](#9-integration-with-vibeswap)
10. [Conclusion](#10-conclusion)

---

## 1. The Problem: Distorted Price Signals

### 1.1 Sources of Price Distortion

Cryptocurrency prices are subject to systematic distortions that go beyond random noise:

| Distortion Source | Mechanism | Magnitude |
|-------------------|-----------|-----------|
| **Leverage liquidations** | Forced selling cascades that push prices below equilibrium | 5-20% in severe events |
| **Wash trading** | Fake volume that inflates apparent liquidity | 70-95% of reported CEX volume |
| **Stablecoin manipulation** | Large USDT minting followed by strategic buying | Variable, correlated with market tops |
| **Order book spoofing** | Fake orders that shift perceived supply/demand | Temporary but frequent |
| **MEV extraction** | Sandwich attacks that distort execution prices | Per-trade, cumulative effect on TWAP |

### 1.2 Why This Matters for DeFi

Protocols that consume manipulated prices expose their users to:

- **Oracle manipulation attacks**: Attacker distorts price, protocol acts on distorted price, attacker profits
- **Liquidation cascades**: Borrowed positions liquidated based on fake price drops
- **Impermanent loss amplification**: LPs lose more when price feeds include manipulation noise
- **Circuit breaker false positives**: Protection mechanisms trigger on fake volatility, halting legitimate trading

### 1.3 The Observation

The key insight is epistemological: **what we observe is not what is real**. Observed prices are measurements of an underlying reality (the true equilibrium price), corrupted by noise (manipulation, leverage effects, technical artifacts). The problem is one of *state estimation* — inferring the hidden true state from noisy observations.

This is exactly what Kalman filters were invented to solve.

---

## 2. The Solution: Price as Hidden State

### 2.1 The State-Space Model

We model the market as a linear dynamical system with two state variables:

- **P_true**: The latent equilibrium price — the price that would prevail under genuine supply and demand
- **drift**: A long-term trend component that is mean-reverting

The state vector:

```
x = [P_true, drift]
```

The state transition model:

```
P_true(t) = P_true(t-1) + drift(t-1) + process_noise
drift(t)  = rho * drift(t-1) + drift_noise
```

Where `rho` is the drift persistence parameter (default 0.99), controlling how quickly the trend component reverts to zero. This model captures both the slow-moving equilibrium price and short-term directional trends.

### 2.2 Observations

Each venue's price is an observation of the true price, corrupted by venue-specific noise:

```
price_binance  = P_true + noise_binance
price_coinbase = P_true + noise_coinbase
price_okx      = P_true + noise_okx
price_kraken   = P_true + noise_kraken
price_uniswap  = P_true + noise_uniswap
```

The noise variance for each venue varies with market conditions. During a liquidation cascade, Binance's price is much noisier (it hosts the most derivatives trading). During normal conditions, Coinbase's price is relatively clean (institutional, spot-dominant, USDC-primary).

### 2.3 Why This Model Is Appropriate

The state-space formulation captures three critical properties:

1. **True price is latent**: We never observe it directly. We only observe noisy measurements.
2. **True price changes slowly**: Equilibrium shifts are driven by real supply/demand changes, which evolve slowly relative to manipulation-driven price spikes.
3. **Noise is heterogeneous**: Different venues have different noise characteristics, and these characteristics change with market regime.

---

## 3. How Kalman Filtering Works

### 3.1 The Two-Step Process

The Kalman filter alternates between two steps:

**Predict Step**: Estimate the next state based on the model dynamics.

```python
def predict(self, stablecoin_state=None):
    # Compute dynamic process noise
    Q = self.cov_manager.compute_process_noise(self.Q_base, stablecoin_state)

    # State prediction: x_pred = F * x
    self.x_pred = self.F @ self.x

    # Covariance prediction: P_pred = F * P * F' + Q
    self.P_pred = self.F @ self.P @ self.F.T + Q

    return self.x_pred[0]  # Predicted true price
```

**Update Step**: Correct the estimate using new observations, weighted by confidence.

```python
def update(self, observations, observation_variances):
    # Observation matrix: all observations measure True Price
    H = np.zeros((n_obs, 2))
    H[:, 0] = 1

    # Observation noise covariance (diagonal, time-varying)
    R = np.diag(observation_variances)

    # Innovation (measurement residual)
    innovation = observations - H @ self.x_pred

    # Innovation covariance
    S = H @ self.P_pred @ H.T + R

    # Kalman gain: how much to trust observations vs prediction
    K = self.P_pred @ H.T @ np.linalg.inv(S)

    # State update
    self.x = self.x_pred + K @ innovation

    # Covariance update (Joseph form for numerical stability)
    I = np.eye(2)
    self.P = (I - K @ H) @ self.P_pred @ (I - K @ H).T + K @ R @ K.T

    return self.x[0], np.sqrt(self.P[0, 0])
```

### 3.2 The Kalman Gain: Adaptive Trust

The Kalman gain `K` is the core of the filter's intelligence. It determines how much weight to give new observations versus the prior prediction:

- **High observation noise** (e.g., during cascade): `K` is small. The filter trusts its prediction more than the observations. Manipulated prices have minimal effect on the True Price estimate.
- **Low observation noise** (e.g., normal market): `K` is large. The filter incorporates new price information quickly.
- **High process noise** (e.g., during genuine trend): The filter allows the True Price to drift more freely, following real market movements.

This adaptive weighting is what makes the Kalman filter fundamentally superior to fixed-weight averaging schemes.

### 3.3 Confidence Interval

The filter maintains a covariance matrix `P` that quantifies uncertainty in the estimate. The 95% confidence interval for the True Price is:

```python
def get_confidence_interval(self, confidence=0.95):
    z = stats.norm.ppf((1 + confidence) / 2)
    std = np.sqrt(self.P[0, 0])
    return (self.x[0] - z * std, self.x[0] + z * std)
```

This confidence interval widens during high-uncertainty regimes (cascades, manipulation) and tightens during stable conditions. It provides a calibrated measure of how much to trust the current estimate.

### 3.4 Deviation Z-Score

The oracle computes a z-score measuring how far the current spot price deviates from the True Price:

```python
def compute_deviation_zscore(self, spot_price):
    std = np.sqrt(self.P[0, 0])
    if std == 0:
        return 0.0
    return (spot_price - self.x[0]) / std
```

A z-score of +3.0 means the spot price is 3 standard deviations above the estimated True Price — a strong signal of potential manipulation or bubble conditions.

---

## 4. Multi-Source Aggregation

### 4.1 Venue Configuration

The oracle aggregates prices from five venues, each with different reliability characteristics:

| Venue | Base Reliability | Derivatives | USDC Primary | Decentralized |
|-------|-----------------|-------------|-------------|---------------|
| Binance | 0.50 | Yes (70% ratio) | No | No |
| Coinbase | 0.80 | No | Yes | No |
| OKX | 0.50 | Yes (60% ratio) | No | No |
| Kraken | 0.80 | No | No | No |
| Uniswap | 0.60 | No | No | Yes |

### 4.2 Reliability Weighting

Base reliability determines the default observation variance for each venue. Lower reliability means higher assumed noise, which means the Kalman gain assigns less weight to that venue's prices:

```
observation_variance = base_observation_var / base_reliability
```

Binance has a base reliability of 0.50 because it hosts the most derivatives trading. During liquidation cascades, Binance's prices deviate most from equilibrium. Coinbase and Kraken have reliability of 0.80 because they are spot-dominant with less leverage-driven distortion.

### 4.3 Dynamic Variance Adjustment

During different market regimes, observation variances are scaled dynamically:

```python
# From regime classifier
RegimeType.MANIPULATION: {
    "observation_noise_mult": 3.0,  # Don't trust spot prices
    "process_noise_mult": 0.3,      # True Price very stable
}
RegimeType.CASCADE: {
    "observation_noise_mult": 5.0,  # Heavily distrust spot
    "process_noise_mult": 0.5,      # True Price somewhat stable
}
RegimeType.TREND: {
    "observation_noise_mult": 0.8,  # Trust observations more
    "process_noise_mult": 1.2,      # Allow True Price to drift
}
```

During a manipulation event, observation noise is multiplied by 3x, causing the filter to largely ignore spot prices and rely on its prediction. During a confirmed trend (USDC-dominant flows), the filter loosens its prediction and follows the market.

---

## 5. Regime Classification

### 5.1 Regime Types

The oracle classifies the current market into one of six regimes, ordered by severity:

```python
class RegimeType(Enum):
    CASCADE         # Active liquidation cascade (highest priority)
    MANIPULATION    # USDT-dominant, leverage-driven distortion
    TREND           # USDC-dominant, genuine price discovery
    HIGH_LEVERAGE   # Elevated leverage but no cascade
    LOW_VOLATILITY  # Stable, low leverage, tight bands
    NORMAL          # Default market conditions
```

### 5.2 Classification Logic

The classifier uses a priority-based decision tree:

```python
def classify(self, leverage_stress, cascade_detection, stablecoin_state,
             volatility_annualized):

    # Priority 1: Cascade (most severe)
    if cascade_detection.is_cascade:
        return Regime.cascade(confidence=cascade_detection.confidence)

    # Priority 2: Manipulation
    manip_prob = stablecoin_state.flow_ratio.manipulation_probability
    if manip_prob > self.config.manipulation_prob_threshold:  # > 0.7
        return Regime.manipulation(confidence=manip_prob)

    # Priority 3: Genuine trend
    if (usdc_impact.regime_signal == "TREND" and
        stablecoin_state.flow_ratio.usdc_dominant):
        return Regime.trend(confidence=usdc_impact.confidence)

    # Priority 4: High leverage
    if leverage_stress.score > self.config.leverage_stress_high:  # > 0.7
        return Regime.high_leverage(confidence=leverage_stress.score)

    # Priority 5: Low volatility
    if volatility_annualized < self.config.volatility_low_threshold:  # < 20%
        return Regime.low_volatility(confidence=...)

    # Priority 6: Normal
    return Regime.normal(confidence=0.8)
```

### 5.3 Regime-Specific Parameters

Each regime adjusts the filter's behavior through four parameters:

| Regime | Process Noise Mult | Observation Noise Mult | Band Mult | Reversion Speed |
|--------|-------------------|----------------------|-----------|-----------------|
| NORMAL | 1.0 | 1.0 | 1.0 | normal |
| TREND | 1.2 | 0.8 | 0.85 | slow |
| LOW_VOLATILITY | 0.5 | 0.8 | 0.8 | fast |
| HIGH_LEVERAGE | 1.5 | 2.0 | 1.5 | normal |
| MANIPULATION | 0.3 | 3.0 | 1.5 | fast |
| CASCADE | 0.5 | 5.0 | 2.0 | fast |

The key insight: during manipulation, the True Price should be nearly stationary (low process noise) while observed prices are highly untrustworthy (high observation noise). During a genuine trend, the True Price should be allowed to drift (higher process noise) and observations should be more trusted (lower observation noise).

---

## 6. Stablecoin Flow Asymmetry

### 6.1 The Signal

Stablecoin flows provide a powerful signal for distinguishing manipulation from genuine price movement. The key observation:

- **USDT-dominant flows** (USDT/USDC ratio > 2.0): Associated with leverage-driven activity, derivatives manipulation, and wash trading. USDT has higher derivatives correlation and is the primary stablecoin on leverage-heavy exchanges.
- **USDC-dominant flows** (USDT/USDC ratio < 0.5): Associated with genuine institutional buying, spot accumulation, and organic demand. USDC is the primary stablecoin for regulated, spot-dominant venues.

### 6.2 Oracle Response

The stablecoin flow ratio directly modulates the filter's noise parameters:

```python
# Stablecoin configuration
manipulation_ratio_threshold: float = 2.0   # USDT/USDC > 2.0 = manipulation likely
trend_ratio_threshold: float = 0.5          # USDT/USDC < 0.5 = trend likely
```

When USDT flows dominate:
- Observation noise multiplier increases (up to 3x)
- True Price bands tighten to 80% of normal
- Reversion speed increases (expect snapback)

When USDC flows dominate:
- Observation noise multiplier decreases
- True Price is allowed to drift faster
- Bands loosen to 120% of normal

### 6.3 On-Chain Stablecoin Context

The stablecoin assessment is published on-chain as part of the oracle's update:

```solidity
struct StablecoinContext {
    uint256 usdtUsdcRatio;        // USDT/USDC flow ratio (18 decimals)
    bool usdtDominant;            // True if ratio > 2.0
    bool usdcDominant;            // True if ratio < 0.5
    uint256 volatilityMultiplier; // Observation noise multiplier (18 decimals)
}
```

Other protocol components (VibeAMM, circuit breakers) can query this context to adjust their own behavior — for example, tightening price deviation bounds during USDT-dominant conditions.

---

## 7. On-Chain Component

### 7.1 Architecture

The on-chain `TruePriceOracle` contract receives signed updates from the off-chain Kalman filter and provides validated True Price data to other protocol components.

```
Off-Chain Pipeline                    On-Chain Contract
┌───────────────────┐                ┌────────────────────┐
│ Price Feeds       │                │ TruePriceOracle    │
│  ├─ Binance       │                │  ├─ EIP-712 verify │
│  ├─ Coinbase      │                │  ├─ Price jump check│
│  ├─ OKX          │   EIP-712      │  ├─ Ring buffer    │
│  ├─ Kraken       │   signed       │  ├─ Stablecoin ctx │
│  └─ Uniswap      │  attestation   │  └─ TruePriceData  │
│         │         │ ─────────────► │         │          │
│    Kalman Filter  │                │    Consumer calls   │
│         │         │                │  ├─ VibeAMM        │
│  Regime Classifier│                │  ├─ CircuitBreaker │
│         │         │                │  └─ CommitReveal   │
│  Stablecoin Model │                │                    │
└───────────────────┘                └────────────────────┘
```

### 7.2 EIP-712 Signed Attestation

Updates are signed using EIP-712 typed structured data:

```solidity
bytes32 public constant PRICE_UPDATE_TYPEHASH = keccak256(
    "PriceUpdate(bytes32 poolId,uint256 price,uint256 confidence,"
    "int256 deviationZScore,uint8 regime,uint256 manipulationProb,"
    "bytes32 dataHash,uint256 nonce,uint256 deadline)"
);
```

The signature includes a monotonic nonce (preventing replay) and a deadline (preventing stale submissions):

```solidity
/// @notice Nonces for replay protection
mapping(address => uint256) public signerNonces;
```

### 7.3 Price Jump Validation

To prevent oracle manipulation, the contract rejects updates where the price changes by more than 10% from the previous value:

```solidity
uint256 public constant MAX_PRICE_JUMP_BPS = 1000; // 10% max jump between updates
```

If a legitimate price move exceeds 10%, the oracle must traverse it across multiple updates. This bounds the maximum per-update impact of a compromised signer.

### 7.4 Ring Buffer History

The contract maintains a 24-sample ring buffer of historical True Price data per pool:

```solidity
uint8 public constant HISTORY_SIZE = 24; // 2 hours of 5-min updates

struct PriceHistory {
    TruePriceData[24] history;
    uint8 index;
    uint8 count;
}
```

This history enables trend analysis and provides a lookback window for detecting sustained deviations.

### 7.5 TruePriceData Struct

The complete data published for each pool:

```solidity
struct TruePriceData {
    uint256 price;              // True Price estimate (18 decimals)
    uint256 confidence;         // Confidence interval width (18 decimals)
    int256 deviationZScore;     // Z-score of spot vs true (signed, 18 decimals)
    RegimeType regime;          // Current regime classification
    uint256 manipulationProb;   // Manipulation probability (18 decimals, 0-1e18)
    uint64 timestamp;           // Update timestamp
    bytes32 dataHash;           // Hash of off-chain data used for verification
}
```

Every field serves a purpose:

| Field | Consumer Use |
|-------|-------------|
| `price` | VibeAMM uses for clearing price validation and damping |
| `confidence` | Circuit breakers widen thresholds when confidence is low |
| `deviationZScore` | Fee surcharges scale with deviation magnitude |
| `regime` | Fee surcharges increase during CASCADE and MANIPULATION |
| `manipulationProb` | Direct input to circuit breaker decisions |
| `timestamp` | Staleness check — stale data is ignored |
| `dataHash` | Off-chain auditability — anyone can verify what data produced the estimate |

### 7.6 Stablecoin-Aware Price Bounds

The oracle adjusts acceptable price deviation bounds based on stablecoin context:

```solidity
uint256 public constant USDT_DOMINANT_TIGHTENING = 8000;  // 80% of normal bounds
uint256 public constant USDC_DOMINANT_LOOSENING = 12000;   // 120% of normal bounds
```

During USDT-dominant conditions (manipulation likely), the acceptable price range tightens — the protocol becomes more conservative. During USDC-dominant conditions (genuine trend likely), the range loosens — the protocol allows larger price movements.

---

## 8. Why Kalman > TWAP

### 8.1 What TWAP Does

A Time-Weighted Average Price computes the arithmetic mean of prices over a window:

```
TWAP = (1/N) * Σ price(t_i) for i = 1..N
```

This is a filter in the signal processing sense — it smooths high-frequency noise. But it is a *fixed* filter with no model of the noise generating process.

### 8.2 What Kalman Does Differently

| Property | TWAP | Kalman Filter |
|----------|------|---------------|
| **Noise model** | Implicit (assumes white noise) | Explicit (time-varying, regime-dependent) |
| **Source weighting** | Equal weight to all observations | Reliability-weighted per venue |
| **Adaptation** | Fixed window, fixed weights | Dynamic gains based on noise estimates |
| **Output** | Point estimate only | Point estimate + confidence interval |
| **Regime awareness** | None | Six-regime classification affects all parameters |
| **Stablecoin awareness** | None | USDT/USDC ratio modulates noise model |
| **Optimality** | Minimum variance for white noise | Minimum variance for the specified noise model |
| **Latency** | Inherent (window-length lag) | Minimal (one-step prediction + update) |

### 8.3 Concrete Example

Consider a liquidation cascade on Binance that drops the price 15% in 30 seconds before reverting:

**TWAP response**: The TWAP dutifully incorporates the 15% drop. With a 5-minute window, the TWAP drops approximately 1.5% (15% * 30s/300s). Any protocol using this TWAP as a reference — for liquidations, clearing prices, circuit breakers — is affected by a fake price movement.

**Kalman response**: The filter detects a CASCADE regime. Observation noise is multiplied by 5x. The Kalman gain drops to near zero. Binance's price is effectively ignored. The True Price estimate barely moves. The confidence interval widens, signaling uncertainty. When Binance's price reverts, the filter smoothly returns to normal operation.

### 8.4 The Mathematical Guarantee

For a linear system with Gaussian noise, the Kalman filter is provably the **minimum variance unbiased estimator** — no other linear estimator can achieve lower estimation error. While cryptocurrency prices are not perfectly Gaussian, the Kalman filter's adaptive noise model provides a much better approximation than the implicit white noise assumption of TWAP.

---

## 9. Integration with VibeSwap

### 9.1 VibeAMM Integration

The VibeAMM queries the True Price Oracle for clearing price validation:

```solidity
try truePriceOracle.getTruePrice(poolId) returns (
    ITruePriceOracle.TruePriceData memory tpData
) {
    uint256 truePrice = tpData.price;
    if (truePrice == 0) return clearingPrice;

    // Check staleness
    if (!TruePriceLib.isFresh(tpData.timestamp, truePriceMaxStaleness)) {
        return clearingPrice; // Stale data - don't enforce
    }

    // Get regime-adjusted deviation bounds
    uint256 adjustedMaxDeviation = TruePriceLib.adjustDeviationForRegime(
        maxDeviationBps, tpData.regime
    );

    // Validate and damp clearing price
    // ...
}
```

If the clearing price deviates too far from the True Price, it is damped toward the True Price. This prevents manipulated batches from executing at distorted prices.

### 9.2 Fee Surcharges

The oracle also drives dynamic fee surcharges:

- During CASCADE: +200% surcharge on base fee
- During MANIPULATION: +100% surcharge
- High deviation z-score: additional surcharge scaling with deviation magnitude
- Maximum cap: 500 bps (5%)

These surcharges make trading during manipulation events expensive, deterring exploitation while allowing genuinely motivated traders to continue operating.

### 9.3 Circuit Breaker Integration

The circuit breaker system uses the oracle's `manipulationProb` and `regime` fields to make halt/resume decisions. A manipulation probability above 70% combined with a CASCADE regime triggers enhanced protection modes.

---

## 10. Conclusion

VibeSwap's True Price Oracle transforms price discovery from a passive data consumption problem into an active state estimation problem. By treating the true equilibrium price as a hidden state and observed market prices as noisy measurements, the Kalman filter produces mathematically optimal price estimates that are resistant to the systematic distortions that plague cryptocurrency markets.

The key innovations are:

1. **Multi-venue aggregation with reliability weighting**: Venues known to be distortion-prone (high derivatives activity) receive less weight than spot-dominant, regulated venues.

2. **Dynamic noise modeling**: Observation and process noise parameters adapt to the current market regime, allowing the filter to ignore manipulated prices during cascades while following genuine trends.

3. **Stablecoin flow analysis**: The USDT/USDC flow ratio provides a powerful signal for distinguishing manipulation from organic price movement, directly modulating the filter's trust in observations.

4. **On-chain validation**: EIP-712 signed attestations, monotonic nonces, price jump limits, and ring buffer history ensure that the True Price data on-chain is timely, authentic, and bounded.

5. **Calibrated uncertainty**: Unlike point-estimate oracles, the Kalman filter provides confidence intervals and deviation z-scores, enabling downstream consumers to make uncertainty-aware decisions.

The True Price Oracle is not an oracle in the traditional sense — it does not simply relay external data. It is an intelligence system that understands when prices are real and when they are fake, and provides the entire VibeSwap protocol with the information it needs to act accordingly.

**0% noise. 100% signal.**

---

## References

1. Kalman, R. E. "A New Approach to Linear Filtering and Prediction Problems." Journal of Basic Engineering, 82(1):35-45, 1960.
2. Harvey, A. C. "Forecasting, Structural Time Series Models and the Kalman Filter." Cambridge University Press, 1990.
3. Binance. "Futures Market Data." binance.com, 2024.
4. VibeSwap. "TruePriceOracle.sol." VibeSwap Protocol, 2026.
5. VibeSwap. "ITruePriceOracle.sol." VibeSwap Protocol, 2026.
6. VibeSwap. "oracle/kalman/filter.py." VibeSwap Oracle Pipeline, 2026.
7. VibeSwap. "oracle/regime/classifier.py." VibeSwap Oracle Pipeline, 2026.

---

## See Also

- [True Price Discovery](TRUE_PRICE_DISCOVERY.md) — Philosophy: why true price matters
- [True Price Oracle](TRUE_PRICE_ORACLE.md) — Full oracle engine this filter powers
- [Price Intelligence Oracle](PRICE_INTELLIGENCE_ORACLE.md) — Intelligence layer built on this filter
- [Clearing Price Convergence Proof](../docs/papers/clearing-price-convergence-proof.md) — Proof that batch prices converge
