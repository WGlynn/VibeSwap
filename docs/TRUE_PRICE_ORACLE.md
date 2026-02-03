# True Price Oracle

## A Quantitative Framework for Manipulation-Resistant Price Discovery

**Version 1.0 | February 2026**

---

## Abstract

Cryptocurrency spot prices are systematically distorted by leverage, forced liquidations, order-book manipulation, and cross-venue arbitrage by dominant actors. These distortions create prices that deviate materially from underlying economic equilibrium, generating false signals and cascading liquidations that transfer wealth from retail participants to sophisticated actors.

This paper presents a rigorous framework for computing a **True Price**—a latent equilibrium price estimate that is:

- **Exchange-agnostic**: Not dependent on any single venue
- **Slow-moving**: Resistant to short-term manipulation
- **Statistically robust**: Formally modeled with quantified uncertainty
- **Actionable**: Provides deviation signals for mean-reversion opportunities

We employ a **state-space model** with Kalman filtering to estimate True Price as a hidden state, incorporating multi-venue price data, leverage metrics, on-chain fundamentals, and order-book quality signals. The framework outputs not just a price estimate, but confidence intervals and regime classifications that distinguish organic volatility from manipulation-driven distortions.

---

## Table of Contents

1. [Introduction: The Price Distortion Problem](#1-introduction-the-price-distortion-problem)
2. [What True Price Is (And Is Not)](#2-what-true-price-is-and-is-not)
3. [Model Inputs](#3-model-inputs)
4. [The State-Space Model](#4-the-state-space-model)
5. [Kalman Filter Implementation](#5-kalman-filter-implementation)
6. [Leverage Stress and Trust Weighting](#6-leverage-stress-and-trust-weighting)
7. [Deviation Bands and Regime Detection](#7-deviation-bands-and-regime-detection)
8. [Liquidation Cascade Identification](#8-liquidation-cascade-identification)
9. [Signal Generation Framework](#9-signal-generation-framework)
10. [Bad Actor Neutralization](#10-bad-actor-neutralization)
11. [Integration with VibeSwap](#11-integration-with-vibeswap)
12. [Extensions and Future Work](#12-extensions-and-future-work)
13. [Conclusion](#13-conclusion)

---

## 1. Introduction: The Price Distortion Problem

### 1.1 The Mechanics of Price Manipulation

Spot prices on cryptocurrency exchanges are distorted through several mechanical channels:

**Excessive Leverage**
```
Binance BTC Futures: $5+ billion open interest
Average leverage: 10-50x
At 20x leverage: 5% adverse move = 100% loss = forced liquidation
```

When leverage is high, small price movements trigger large forced flows, which move price further, triggering more liquidations. This is not price discovery—it's a mechanical cascade.

**Forced Liquidations**
```
Liquidation clusters at round numbers: $30,000, $29,500, $29,000
Exchanges see these levels in advance
Rational profit-maximizing behavior: push price to trigger liquidations
Result: prices hunt liquidity, not equilibrium
```

**Order-Book Spoofing**
```
Large limit orders placed to influence price perception
Orders canceled before execution
Creates false impression of support/resistance
Ephemeral liquidity misleads other participants
```

**Cross-Venue Arbitrage by Dominant Actors**
```
Information asymmetry: dominant actors see flow across venues
Latency arbitrage: faster execution extracts value
Market-making privileges: see order flow before public
```

### 1.2 The Cost of Distorted Prices

| Stakeholder | Impact |
|-------------|--------|
| Retail traders | Liquidated at artificial prices |
| Long-term investors | False signals for entry/exit |
| DeFi protocols | Oracles import manipulation |
| Market integrity | Price ceases to reflect value |

### 1.3 The Goal

Design a **True Price** that represents the latent equilibrium price absent forced leverage flows. This price should serve as:

1. A reference point for detecting manipulation
2. A target for mean-reversion expectations
3. An oracle input resistant to gaming
4. A foundation for quantitative trading signals

---

## 2. What True Price Is (And Is Not)

### 2.1 Definition

**True Price** is the Bayesian posterior estimate of the underlying equilibrium price, given all available information, with leverage-driven distortions filtered out.

Formally:

```
P_true(t) = E[P_equilibrium(t) | I(t), L(t), O(t)]

Where:
  I(t) = Information set (prices, volumes, on-chain data)
  L(t) = Leverage state (open interest, funding, liquidations)
  O(t) = Order-book quality (persistence, depth, spoofing probability)
```

### 2.2 What True Price Is NOT

| Concept | Why It's Different |
|---------|-------------------|
| **Spot Price** | Spot includes manipulation, leverage flows, and ephemeral distortions |
| **VWAP** | Volume-weighted average still includes manipulated volume |
| **TWAP** | Time-weighted average doesn't distinguish organic vs. forced flows |
| **Simple Cross-Exchange Average** | Averaging manipulated prices gives manipulated average |
| **Chainlink/Oracle Price** | Aggregates spot prices without leverage filtering |
| **Moving Average** | Lags price but doesn't model underlying equilibrium |

### 2.3 Key Properties

**Exchange-Agnostic**
True Price is not the price on any single exchange. It's an estimate of what price would be if no single venue could dominate.

**Slow-Moving Relative to Spot**
True Price updates based on information, not noise. It should not track every tick—that would make it vulnerable to the distortions we're filtering.

**Statistically Robust**
True Price comes with uncertainty quantification. We report not just a point estimate but confidence intervals that widen during manipulation events.

**Mean-Reversion Anchor**
When spot deviates significantly from True Price, there's statistical expectation of reversion. The deviation magnitude indicates reversion probability.

---

## 3. Model Inputs

### 3.1 Input Categories

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRUE PRICE MODEL INPUTS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: CROSS-VENUE PRICES                                    │
│  ├── Spot prices from N exchanges                               │
│  ├── Futures prices (various expirations)                       │
│  └── Perpetual swap prices                                      │
│                                                                  │
│  Layer 2: LEVERAGE & DERIVATIVES                                │
│  ├── Open interest (aggregate and by exchange)                  │
│  ├── Funding rates (perpetual swaps)                            │
│  ├── Liquidation volume (long/short breakdown)                  │
│  └── Leverage ratio estimates                                   │
│                                                                  │
│  Layer 3: ON-CHAIN METRICS                                      │
│  ├── Realized price (cost basis of moved coins)                 │
│  ├── MVRV ratio (market value / realized value)                 │
│  ├── Dormancy flow (age-weighted spending)                      │
│  └── Exchange inflows/outflows                                  │
│                                                                  │
│  Layer 4: ORDER-BOOK QUALITY                                    │
│  ├── Bid-ask spread (time-weighted)                             │
│  ├── Order persistence (how long orders stay)                   │
│  ├── Depth imbalance (bid depth vs ask depth)                   │
│  └── Spoofing probability score                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Layer 1: Cross-Venue Price Aggregation

**Data Sources**
```
Tier 1 (CEX - High Volume):
  Binance, Coinbase, OKX, Bybit, Kraken

Tier 2 (DEX - Decentralized):
  Uniswap, Curve, GMX

Tier 3 (Aggregators):
  Chainlink, CoinGecko
```

**Aggregation Method: Trimmed Median**

We use median rather than mean to resist outlier manipulation:

```python
def trimmed_median_price(prices, weights, trim_pct=0.1):
    """
    Compute weighted median with outlier trimming.

    Args:
        prices: Array of venue prices
        weights: Array of venue reliability weights
        trim_pct: Fraction of extreme values to exclude

    Returns:
        Trimmed weighted median price
    """
    # Sort by price
    sorted_indices = np.argsort(prices)
    sorted_prices = prices[sorted_indices]
    sorted_weights = weights[sorted_indices]

    # Trim extremes
    n = len(prices)
    trim_n = int(n * trim_pct)
    trimmed_prices = sorted_prices[trim_n:n-trim_n]
    trimmed_weights = sorted_weights[trim_n:n-trim_n]

    # Weighted median
    cumsum = np.cumsum(trimmed_weights)
    median_idx = np.searchsorted(cumsum, cumsum[-1] / 2)

    return trimmed_prices[median_idx]
```

**Venue Weights**

Weights reflect reliability, not just volume:

| Venue Type | Base Weight | Adjustment Factors |
|------------|-------------|-------------------|
| Regulated CEX (Coinbase, Kraken) | 0.8 | +/- manipulation history |
| Major CEX (Binance, OKX) | 0.5 | High volume but manipulation-prone |
| DEX (Uniswap) | 0.6 | Decentralized but flash-loan vulnerable |
| VibeSwap Internal | 1.0 | Manipulation-resistant by design |

### 3.3 Layer 2: Leverage & Derivatives Data

**Open Interest (OI)**

```
OI_aggregate(t) = Σ OI_exchange(t)

OI_change(t) = (OI(t) - OI(t-1)) / OI(t-1)

High OI + High Funding = Crowded position = Liquidation risk
```

**Funding Rate Dynamics**

Funding rate indicates directional crowding:

```
funding_rate > 0: Longs paying shorts (bullish crowding)
funding_rate < 0: Shorts paying longs (bearish crowding)

Extreme funding (|funding| > 0.1% per 8h):
  → High probability of mean reversion
  → Spot price likely deviating from True Price
```

**Liquidation Volume**

```python
def liquidation_imbalance(long_liqs, short_liqs, window='1h'):
    """
    Compute liquidation imbalance as signal of forced flows.

    Returns:
        imbalance: Positive = longs liquidated, Negative = shorts liquidated
        intensity: Total liquidation volume normalized
    """
    long_vol = long_liqs.rolling(window).sum()
    short_vol = short_liqs.rolling(window).sum()

    imbalance = (long_vol - short_vol) / (long_vol + short_vol + 1e-10)
    intensity = (long_vol + short_vol) / typical_volume

    return imbalance, intensity
```

**Leverage Ratio Estimate**

```
leverage_ratio = notional_open_interest / spot_volume

High leverage_ratio (> 20):
  → Price moves dominated by derivatives
  → Spot price less reliable as True Price signal
```

### 3.4 Layer 3: On-Chain Metrics

**Realized Price**

The average cost basis of all coins in circulation:

```
Realized_Price = Σ(UTXO_value × price_when_last_moved) / total_supply

Interpretation:
  Spot > Realized: Market in profit on average
  Spot < Realized: Market in loss on average (capitulation risk)
```

**MVRV Ratio**

Market Value to Realized Value:

```
MVRV = Market_Cap / Realized_Cap = Spot_Price / Realized_Price

MVRV > 3.5: Historically overheated
MVRV < 1.0: Historically undervalued
MVRV ≈ 1.0: Price near aggregate cost basis
```

**Dormancy Flow**

Age-weighted spending indicates conviction:

```
dormancy = Σ(coins_moved × days_since_last_move) / Σ(coins_moved)

High dormancy: Old coins moving (informed selling or profit-taking)
Low dormancy: Only recent coins moving (noise)
```

**Exchange Flows**

```
net_exchange_flow = exchange_inflows - exchange_outflows

Positive (inflows > outflows): Selling pressure building
Negative (outflows > inflows): Accumulation signal
```

### 3.5 Layer 4: Order-Book Quality

**Bid-Ask Spread**

```python
def time_weighted_spread(orderbook_snapshots, interval='5m'):
    """
    Compute time-weighted bid-ask spread.

    Wider spreads indicate:
      - Lower liquidity
      - Higher uncertainty
      - Potential manipulation
    """
    spreads = [(ob['best_ask'] - ob['best_bid']) / ob['mid']
               for ob in orderbook_snapshots]
    return np.mean(spreads)
```

**Order Persistence**

```python
def order_persistence_score(orderbook_history, depth_level='1%'):
    """
    Measure how long orders stay in the book.

    Low persistence = spoofing (orders placed then canceled)
    High persistence = genuine liquidity
    """
    # Track order IDs across snapshots
    # Compute average lifespan of orders at depth_level
    # Normalize to [0, 1] score
    pass
```

**Spoofing Probability Score**

```python
def spoofing_score(orderbook_history):
    """
    Detect spoofing patterns:
      - Large orders that disappear before execution
      - Asymmetric order placement (one side only)
      - Orders that move with price (following, not providing)

    Returns: Probability that current book is being spoofed [0, 1]
    """
    # Pattern 1: Order cancellation rate at top of book
    cancel_rate = compute_cancel_rate(orderbook_history)

    # Pattern 2: Order asymmetry
    asymmetry = compute_depth_asymmetry(orderbook_history)

    # Pattern 3: Order following behavior
    following = compute_following_score(orderbook_history)

    # Combine into probability
    spoof_prob = sigmoid(w1*cancel_rate + w2*asymmetry + w3*following)

    return spoof_prob
```

---

## 4. The State-Space Model

### 4.1 Model Structure

We model True Price as a **hidden state** that generates observable prices through a noisy observation process:

```
State Equation (True Price Evolution):
  P_true(t) = P_true(t-1) + μ(t) + η(t)

  Where:
    μ(t) = drift (long-term trend component)
    η(t) ~ N(0, Q(t)) = process noise (organic volatility)

Observation Equation (Spot Price Generation):
  P_spot(t) = P_true(t) + leverage_distortion(t) + ε(t)

  Where:
    leverage_distortion(t) = f(OI, funding, liquidations)
    ε(t) ~ N(0, R(t)) = observation noise
```

### 4.2 Formal Specification

**State Vector**

```
x(t) = [P_true(t), μ(t)]'

State transition:
x(t) = F × x(t-1) + w(t)

F = [1  1]    (True Price inherits drift)
    [0  ρ]    (Drift is mean-reverting with persistence ρ)

w(t) ~ N(0, Q)

Q = [σ²_price    0        ]
    [0           σ²_drift  ]
```

**Observation Vector**

```
y(t) = [P_spot_1(t), P_spot_2(t), ..., P_spot_N(t), P_realized(t)]'

Observation equation:
y(t) = H × x(t) + v(t)

H = [1  0]    (Each venue observes True Price + noise)
    [1  0]
    [...]
    [1  0]
    [1  0]    (Realized price also observes True Price)

v(t) ~ N(0, R(t))

R(t) = diag(σ²_1(t), σ²_2(t), ..., σ²_N(t), σ²_realized)
```

### 4.3 Time-Varying Noise Covariance

The key innovation: **observation noise variance increases with leverage stress**.

```python
def compute_observation_variance(venue, leverage_state, orderbook_quality):
    """
    Observation variance is NOT constant.
    It increases when:
      - Leverage is high (price driven by forced flows)
      - Orderbook quality is low (spoofing detected)
      - Liquidation cascade in progress
    """
    base_variance = venue.historical_variance

    # Leverage multiplier
    leverage_mult = 1 + leverage_state.stress_score * 5  # Up to 6x during stress

    # Orderbook quality multiplier
    quality_mult = 1 + (1 - orderbook_quality.persistence_score) * 3  # Up to 4x for low quality

    # Liquidation cascade multiplier
    if leverage_state.cascade_detected:
        cascade_mult = 10  # Heavily discount during cascades
    else:
        cascade_mult = 1

    return base_variance * leverage_mult * quality_mult * cascade_mult
```

---

## 5. Kalman Filter Implementation

### 5.1 The Kalman Filter Algorithm

```python
class TruePriceKalmanFilter:
    """
    Kalman filter for True Price estimation.

    State: [P_true, drift]
    Observations: [venue_prices..., realized_price]
    """

    def __init__(self, initial_price, config):
        # State estimate
        self.x = np.array([initial_price, 0.0])  # [P_true, drift]

        # State covariance
        self.P = np.array([
            [config.initial_price_var, 0],
            [0, config.initial_drift_var]
        ])

        # Process noise covariance
        self.Q = np.array([
            [config.process_noise_price, 0],
            [0, config.process_noise_drift]
        ])

        # State transition matrix
        self.F = np.array([
            [1, 1],
            [0, config.drift_persistence]  # ρ ≈ 0.99
        ])

        # Observation matrix (updated dynamically based on available venues)
        self.H = None

        # Observation noise covariance (updated dynamically)
        self.R = None

    def predict(self):
        """
        Prediction step: propagate state forward.
        """
        # State prediction
        self.x_pred = self.F @ self.x

        # Covariance prediction
        self.P_pred = self.F @ self.P @ self.F.T + self.Q

        return self.x_pred[0]  # Return predicted True Price

    def update(self, observations, observation_variances):
        """
        Update step: incorporate new observations.

        Args:
            observations: Array of venue prices + realized price
            observation_variances: Array of venue-specific variances (time-varying!)
        """
        n_obs = len(observations)

        # Build observation matrix
        self.H = np.zeros((n_obs, 2))
        self.H[:, 0] = 1  # All observations measure True Price

        # Build observation noise covariance (DIAGONAL, time-varying)
        self.R = np.diag(observation_variances)

        # Innovation (measurement residual)
        y_pred = self.H @ self.x_pred
        innovation = observations - y_pred

        # Innovation covariance
        S = self.H @ self.P_pred @ self.H.T + self.R

        # Kalman gain
        K = self.P_pred @ self.H.T @ np.linalg.inv(S)

        # State update
        self.x = self.x_pred + K @ innovation

        # Covariance update
        I = np.eye(2)
        self.P = (I - K @ self.H) @ self.P_pred

        return self.x[0], np.sqrt(self.P[0, 0])  # True Price estimate and std dev

    def get_confidence_interval(self, confidence=0.95):
        """
        Return confidence interval for True Price.
        """
        z = stats.norm.ppf((1 + confidence) / 2)
        std = np.sqrt(self.P[0, 0])

        return (self.x[0] - z * std, self.x[0] + z * std)
```

### 5.2 Full Update Cycle

```python
def update_true_price(kf, market_data, leverage_state, orderbook_quality):
    """
    Complete True Price update cycle.

    Args:
        kf: TruePriceKalmanFilter instance
        market_data: Current venue prices, realized price
        leverage_state: Current leverage metrics
        orderbook_quality: Current orderbook quality scores

    Returns:
        true_price: Point estimate
        confidence_interval: (lower, upper)
        deviation_zscore: How far spot is from True Price in std devs
    """
    # 1. Prediction step
    predicted_price = kf.predict()

    # 2. Compute time-varying observation variances
    obs_variances = []
    for venue in market_data.venues:
        var = compute_observation_variance(
            venue,
            leverage_state,
            orderbook_quality[venue.name]
        )
        obs_variances.append(var)

    # Add realized price variance (more stable)
    obs_variances.append(REALIZED_PRICE_VARIANCE)

    # 3. Build observation vector
    observations = [venue.price for venue in market_data.venues]
    observations.append(market_data.realized_price)
    observations = np.array(observations)

    # 4. Update step
    true_price, true_price_std = kf.update(observations, np.array(obs_variances))

    # 5. Compute confidence interval
    ci = kf.get_confidence_interval(confidence=0.95)

    # 6. Compute deviation z-score
    median_spot = np.median([v.price for v in market_data.venues])
    deviation_zscore = (median_spot - true_price) / true_price_std

    return TruePriceEstimate(
        price=true_price,
        std=true_price_std,
        confidence_interval=ci,
        deviation_zscore=deviation_zscore,
        spot_median=median_spot
    )
```

---

## 6. Leverage Stress and Trust Weighting

### 6.1 Leverage Stress Score

```python
def compute_leverage_stress(oi_data, funding_data, liquidation_data):
    """
    Compute composite leverage stress score [0, 1].

    High stress = spot prices less reliable for True Price estimation.
    """
    # Component 1: Open Interest relative to historical
    oi_percentile = percentile_rank(oi_data.current, oi_data.history_90d)
    oi_stress = max(0, (oi_percentile - 0.5) * 2)  # 0 at median, 1 at 100th percentile

    # Component 2: Funding rate extremity
    funding_zscore = abs(funding_data.rate - funding_data.mean_30d) / funding_data.std_30d
    funding_stress = min(1, funding_zscore / 3)  # Saturate at 3 sigma

    # Component 3: Recent liquidation intensity
    liq_intensity = liquidation_data.volume_1h / liquidation_data.typical_volume
    liq_stress = min(1, liq_intensity / 5)  # Saturate at 5x typical

    # Component 4: Funding-price divergence
    # If funding is positive but price is falling, forced liquidations likely
    divergence = funding_data.rate * (-price_return_1h)  # Positive if diverging
    divergence_stress = max(0, min(1, divergence * 10))

    # Weighted combination
    stress = (
        0.25 * oi_stress +
        0.25 * funding_stress +
        0.35 * liq_stress +
        0.15 * divergence_stress
    )

    return LeverageStress(
        score=stress,
        oi_component=oi_stress,
        funding_component=funding_stress,
        liquidation_component=liq_stress,
        divergence_component=divergence_stress
    )
```

### 6.2 Trust Weighting by Venue

When leverage stress is high, we trust certain venues more than others:

```python
def compute_venue_trust_weights(venues, leverage_stress, orderbook_quality):
    """
    Compute trust weights for each venue based on current conditions.

    During high leverage stress:
      - Reduce weight on derivatives-heavy venues (Binance, Bybit)
      - Increase weight on spot-only venues (Coinbase)
      - Increase weight on decentralized venues (Uniswap)
      - Maximum weight on manipulation-resistant venues (VibeSwap)
    """
    weights = {}

    for venue in venues:
        base_weight = venue.base_reliability

        # Derivatives exposure penalty
        if venue.has_derivatives:
            derivatives_penalty = venue.derivatives_ratio * leverage_stress.score
            base_weight *= (1 - derivatives_penalty * 0.5)  # Up to 50% reduction

        # Orderbook quality adjustment
        quality = orderbook_quality[venue.name]
        quality_mult = 0.5 + 0.5 * quality.persistence_score  # 0.5x to 1.0x
        base_weight *= quality_mult

        # Spoofing penalty
        if quality.spoofing_probability > 0.5:
            base_weight *= (1 - quality.spoofing_probability)

        # Decentralization bonus during stress
        if venue.is_decentralized and leverage_stress.score > 0.5:
            base_weight *= 1.2  # 20% bonus for decentralized during stress

        # VibeSwap special case: manipulation-resistant by design
        if venue.name == 'VibeSwap':
            base_weight = 1.0  # Always maximum weight

        weights[venue.name] = max(0.1, base_weight)  # Floor at 0.1

    # Normalize
    total = sum(weights.values())
    weights = {k: v/total for k, v in weights.items()}

    return weights
```

### 6.3 Cascade Detection

```python
def detect_liquidation_cascade(leverage_state, price_data, threshold=0.7):
    """
    Detect if a liquidation cascade is in progress.

    Cascade indicators:
      1. Open interest dropping rapidly (> 5% in 5 minutes)
      2. Liquidation volume spiking (> 5x typical)
      3. Price moving faster than spot volume justifies
      4. Funding rate and price moving in same direction

    Returns:
        is_cascade: Boolean
        cascade_confidence: [0, 1]
        cascade_direction: 'long_squeeze' or 'short_squeeze'
    """
    # Indicator 1: OI drop
    oi_change_5m = (leverage_state.oi_current - leverage_state.oi_5m_ago) / leverage_state.oi_5m_ago
    oi_drop_signal = min(1, abs(oi_change_5m) / 0.05)  # Saturate at 5%

    # Indicator 2: Liquidation spike
    liq_ratio = leverage_state.liquidation_volume_5m / leverage_state.typical_liq_5m
    liq_spike_signal = min(1, liq_ratio / 5)  # Saturate at 5x

    # Indicator 3: Price/volume divergence
    price_change = abs(price_data.return_5m)
    expected_price_change = price_data.volume_5m / price_data.typical_volume * price_data.typical_return
    divergence_ratio = price_change / (expected_price_change + 1e-10)
    divergence_signal = min(1, (divergence_ratio - 1) / 4)  # Signal if > 1, saturate at 5x

    # Indicator 4: Funding alignment
    funding_price_alignment = leverage_state.funding_rate * price_data.return_5m
    alignment_signal = max(0, funding_price_alignment * 100)  # Positive = cascading

    # Combine
    cascade_confidence = (
        0.3 * oi_drop_signal +
        0.4 * liq_spike_signal +
        0.2 * divergence_signal +
        0.1 * alignment_signal
    )

    is_cascade = cascade_confidence > threshold

    # Direction
    if is_cascade:
        if leverage_state.long_liquidations > leverage_state.short_liquidations:
            direction = 'long_squeeze'
        else:
            direction = 'short_squeeze'
    else:
        direction = None

    return CascadeDetection(
        is_cascade=is_cascade,
        confidence=cascade_confidence,
        direction=direction
    )
```

---

## 7. Deviation Bands and Regime Detection

### 7.1 Dynamic Standard Deviation Bands

Standard deviation bands around True Price expand and contract based on regime:

```python
def compute_deviation_bands(true_price, true_price_std, regime):
    """
    Compute dynamic standard deviation bands.

    Bands widen during:
      - High leverage regimes
      - Liquidation cascades
      - Low orderbook quality periods

    Bands tighten during:
      - Low leverage, stable markets
      - High orderbook quality
    """
    # Base multipliers for bands
    base_multipliers = {
        '1_sigma': 1.0,
        '2_sigma': 2.0,
        '3_sigma': 3.0,
        '4_sigma': 4.0
    }

    # Regime adjustment
    if regime == 'cascade':
        regime_mult = 2.0  # Bands 2x wider during cascades
    elif regime == 'high_leverage':
        regime_mult = 1.5
    elif regime == 'normal':
        regime_mult = 1.0
    else:  # 'low_volatility'
        regime_mult = 0.8

    bands = {}
    for name, mult in base_multipliers.items():
        adjusted_mult = mult * regime_mult
        bands[name] = {
            'upper': true_price + adjusted_mult * true_price_std,
            'lower': true_price - adjusted_mult * true_price_std
        }

    return bands
```

### 7.2 Regime Classification

```python
class RegimeClassifier:
    """
    Classify current market regime.

    Regimes:
      - 'low_volatility': Stable, low leverage, tight bands
      - 'normal': Typical conditions
      - 'high_leverage': Elevated leverage but no cascade
      - 'cascade': Active liquidation cascade
      - 'manipulation': Detected spoofing or wash trading
    """

    def __init__(self):
        self.regime_history = []
        self.transition_matrix = None

    def classify(self, leverage_stress, cascade_detection, orderbook_quality, volatility_regime):
        """
        Classify current regime based on multiple inputs.
        """
        # Priority-based classification

        # 1. Check for cascade (highest priority)
        if cascade_detection.is_cascade:
            return Regime('cascade', confidence=cascade_detection.confidence)

        # 2. Check for manipulation
        avg_spoof_prob = np.mean([q.spoofing_probability for q in orderbook_quality.values()])
        if avg_spoof_prob > 0.7:
            return Regime('manipulation', confidence=avg_spoof_prob)

        # 3. Check leverage level
        if leverage_stress.score > 0.7:
            return Regime('high_leverage', confidence=leverage_stress.score)

        # 4. Check volatility
        if volatility_regime.annualized < 0.2:  # < 20% annualized
            return Regime('low_volatility', confidence=1 - volatility_regime.annualized / 0.2)

        # 5. Default to normal
        return Regime('normal', confidence=0.8)

    def get_regime_dependent_parameters(self, regime):
        """
        Return regime-specific model parameters.
        """
        params = {
            'low_volatility': {
                'process_noise_mult': 0.5,
                'observation_noise_mult': 0.8,
                'band_mult': 0.8,
                'reversion_speed': 'fast'
            },
            'normal': {
                'process_noise_mult': 1.0,
                'observation_noise_mult': 1.0,
                'band_mult': 1.0,
                'reversion_speed': 'normal'
            },
            'high_leverage': {
                'process_noise_mult': 1.5,
                'observation_noise_mult': 2.0,
                'band_mult': 1.5,
                'reversion_speed': 'normal'
            },
            'cascade': {
                'process_noise_mult': 0.5,  # True Price shouldn't move fast
                'observation_noise_mult': 5.0,  # Don't trust spot at all
                'band_mult': 2.0,
                'reversion_speed': 'fast'  # Expect quick reversion
            },
            'manipulation': {
                'process_noise_mult': 0.3,  # True Price very stable
                'observation_noise_mult': 10.0,  # Heavily discount observations
                'band_mult': 1.5,
                'reversion_speed': 'fast'
            }
        }
        return params.get(regime.name, params['normal'])
```

### 7.3 Deviation Magnitude and Manipulation Probability

```python
def compute_manipulation_probability(deviation_zscore, regime, leverage_stress):
    """
    Estimate probability that current price deviation is manipulation-driven.

    Higher probability when:
      - Deviation is large (> 2 sigma)
      - Regime indicates stress
      - Leverage is elevated
      - Move happened quickly
    """
    # Base probability from z-score
    # Using logistic function: P = 1 / (1 + exp(-k*(|z| - z0)))
    z0 = 2.0  # Inflection point at 2 sigma
    k = 2.0   # Steepness
    base_prob = 1 / (1 + np.exp(-k * (abs(deviation_zscore) - z0)))

    # Regime adjustment
    regime_multipliers = {
        'cascade': 1.5,        # Very likely manipulation during cascade
        'manipulation': 1.8,   # Already detected manipulation
        'high_leverage': 1.3,
        'normal': 1.0,
        'low_volatility': 0.7  # Less likely during quiet periods
    }
    regime_mult = regime_multipliers.get(regime.name, 1.0)

    # Leverage stress adjustment
    stress_mult = 1 + leverage_stress.score * 0.5  # Up to 1.5x

    # Final probability (capped at 0.95)
    manipulation_prob = min(0.95, base_prob * regime_mult * stress_mult)

    return manipulation_prob
```

---

## 8. Liquidation Cascade Identification

### 8.1 Pre-Cascade Indicators

```python
def compute_precascade_risk(leverage_state, price_data, orderbook):
    """
    Compute probability that a liquidation cascade is imminent.

    Warning signs:
      1. Price approaching major liquidation cluster
      2. Funding rate extreme (crowded positioning)
      3. OI at local high
      4. Orderbook thin near liquidation levels
    """
    # 1. Distance to liquidation cluster
    nearest_cluster = find_nearest_liquidation_cluster(leverage_state.liquidation_map)
    distance_pct = abs(price_data.current - nearest_cluster.price) / price_data.current
    proximity_risk = max(0, 1 - distance_pct / 0.02)  # Risk increases within 2%

    # 2. Funding extremity
    funding_zscore = abs(leverage_state.funding_rate) / leverage_state.funding_std_30d
    funding_risk = min(1, funding_zscore / 3)

    # 3. OI level
    oi_percentile = percentile_rank(leverage_state.oi_current, leverage_state.oi_history_90d)
    oi_risk = max(0, (oi_percentile - 0.7) / 0.3)  # Risk above 70th percentile

    # 4. Orderbook thinness at liquidation level
    depth_at_cluster = orderbook.get_depth_at_price(nearest_cluster.price)
    typical_depth = orderbook.typical_depth
    thinness_risk = max(0, 1 - depth_at_cluster / typical_depth)

    # Combine
    precascade_risk = (
        0.35 * proximity_risk +
        0.25 * funding_risk +
        0.20 * oi_risk +
        0.20 * thinness_risk
    )

    return PrecascadeRisk(
        total=precascade_risk,
        proximity=proximity_risk,
        funding=funding_risk,
        oi=oi_risk,
        thinness=thinness_risk,
        nearest_cluster=nearest_cluster
    )
```

### 8.2 Real vs. Fake Price Movement Classification

```python
def classify_price_movement(price_data, leverage_state, onchain_data, news_data):
    """
    Classify whether a price movement is organic or manipulation-driven.

    Real (organic) movement:
      - Spot volume proportional to price change
      - No liquidation spike
      - On-chain flow supports direction
      - Fundamental news present

    Fake (manipulation) movement:
      - Derivatives volume >> spot volume
      - Liquidation cascade signature
      - On-chain flow contradicts price
      - No fundamental news
    """
    scores = {}

    # Factor 1: Spot vs derivatives volume
    spot_ratio = price_data.spot_volume / (price_data.spot_volume + leverage_state.derivatives_volume)
    scores['spot_dominance'] = spot_ratio  # Higher = more organic

    # Factor 2: Volume-price proportionality
    expected_move = estimate_move_from_volume(price_data.spot_volume)
    actual_move = abs(price_data.return_1h)
    proportionality = min(1, expected_move / (actual_move + 1e-10))
    scores['proportionality'] = proportionality  # Higher = more organic

    # Factor 3: Liquidation contribution
    liq_volume_usd = leverage_state.liquidation_volume_1h
    total_volume_usd = price_data.volume_1h_usd
    liq_contribution = liq_volume_usd / (total_volume_usd + 1e-10)
    scores['non_liquidation'] = 1 - liq_contribution  # Higher = more organic

    # Factor 4: On-chain alignment
    if price_data.return_1h > 0:
        # Price up: should see exchange outflows (buying)
        flow_alignment = -onchain_data.net_exchange_flow_1h / onchain_data.typical_flow
    else:
        # Price down: should see exchange inflows (selling)
        flow_alignment = onchain_data.net_exchange_flow_1h / onchain_data.typical_flow
    scores['onchain_alignment'] = max(0, min(1, flow_alignment))  # Higher = more organic

    # Factor 5: News presence
    scores['news_presence'] = news_data.relevance_score  # Higher = more organic

    # Aggregate
    organic_score = (
        0.25 * scores['spot_dominance'] +
        0.20 * scores['proportionality'] +
        0.25 * scores['non_liquidation'] +
        0.15 * scores['onchain_alignment'] +
        0.15 * scores['news_presence']
    )

    classification = 'organic' if organic_score > 0.5 else 'manipulation'

    return MovementClassification(
        classification=classification,
        organic_score=organic_score,
        manipulation_score=1 - organic_score,
        factor_scores=scores
    )
```

---

## 9. Signal Generation Framework

### 9.1 Trading Distance from Equilibrium

The core trading thesis: **trade mean-reversion when spot deviates from True Price**.

```python
class TruePriceSignalGenerator:
    """
    Generate trading signals based on deviation from True Price.

    Key principle: We trade DISTANCE FROM EQUILIBRIUM, not direction.
    """

    def __init__(self, config):
        self.config = config
        self.signal_history = []

    def generate_signal(self, true_price_estimate, regime, leverage_stress):
        """
        Generate trading signal based on current state.

        Returns:
            Signal with direction, confidence, targets, and timeframe
        """
        z = true_price_estimate.deviation_zscore
        spot = true_price_estimate.spot_median
        true_p = true_price_estimate.price

        # No signal in small deviations
        if abs(z) < self.config.min_zscore_threshold:  # e.g., 1.5
            return Signal(type='NEUTRAL', confidence=0)

        # Compute manipulation probability
        manip_prob = compute_manipulation_probability(z, regime, leverage_stress)

        # Higher manipulation probability = higher reversion probability
        reversion_prob = 0.5 + 0.4 * manip_prob  # Range: 0.5 to 0.9

        # Adjust for regime
        regime_adjustments = {
            'cascade': 0.1,        # Very high reversion during cascade
            'manipulation': 0.1,
            'high_leverage': 0.05,
            'normal': 0,
            'low_volatility': -0.1  # Less confident in reversion during quiet
        }
        reversion_prob += regime_adjustments.get(regime.name, 0)
        reversion_prob = max(0.3, min(0.95, reversion_prob))

        # Direction: opposite of deviation
        if z > 0:
            direction = 'SHORT'  # Spot above True Price, expect reversion down
        else:
            direction = 'LONG'  # Spot below True Price, expect reversion up

        # Confidence scales with z-score
        confidence = min(0.95, 0.5 + 0.1 * (abs(z) - 1.5))

        # Compute targets
        targets = self.compute_reversion_targets(spot, true_p, z, regime)

        # Compute timeframe
        timeframe = self.estimate_reversion_timeframe(z, regime, leverage_stress)

        # Compute stop loss
        stop_loss = self.compute_stop_loss(spot, z, regime)

        return Signal(
            type=direction,
            confidence=confidence,
            reversion_probability=reversion_prob,
            manipulation_probability=manip_prob,
            targets=targets,
            timeframe=timeframe,
            stop_loss=stop_loss,
            zscore=z,
            regime=regime.name
        )

    def compute_reversion_targets(self, spot, true_price, z, regime):
        """
        Compute probabilistic reversion targets.
        """
        deviation = spot - true_price

        targets = []

        # Target 1: 50% reversion
        t1_price = spot - 0.5 * deviation
        t1_prob = 0.75 if regime.name in ['cascade', 'manipulation'] else 0.65
        targets.append(Target(price=t1_price, probability=t1_prob, label='T1_50%'))

        # Target 2: 75% reversion
        t2_price = spot - 0.75 * deviation
        t2_prob = 0.55 if regime.name in ['cascade', 'manipulation'] else 0.45
        targets.append(Target(price=t2_price, probability=t2_prob, label='T2_75%'))

        # Target 3: Full reversion to True Price
        t3_prob = 0.35 if regime.name in ['cascade', 'manipulation'] else 0.25
        targets.append(Target(price=true_price, probability=t3_prob, label='T3_Full'))

        # Target 4: Overshoot (beyond True Price)
        overshoot = true_price - 0.25 * deviation
        t4_prob = 0.15 if regime.name == 'cascade' else 0.10
        targets.append(Target(price=overshoot, probability=t4_prob, label='T4_Overshoot'))

        return targets

    def estimate_reversion_timeframe(self, z, regime, leverage_stress):
        """
        Estimate how quickly reversion will occur.
        """
        # Base timeframe in hours
        base_hours = 4

        # Larger deviation = faster expected reversion (more stretched rubber band)
        zscore_mult = max(0.5, 2 - abs(z) * 0.3)  # Range: 0.5x to 2x

        # Regime affects speed
        regime_mults = {
            'cascade': 0.25,       # Very fast reversion
            'manipulation': 0.5,
            'high_leverage': 0.75,
            'normal': 1.0,
            'low_volatility': 1.5  # Slower reversion
        }
        regime_mult = regime_mults.get(regime.name, 1.0)

        hours = base_hours * zscore_mult * regime_mult

        return Timeframe(
            expected_hours=hours,
            range_hours=(hours * 0.5, hours * 2),
            confidence=0.7
        )

    def compute_stop_loss(self, spot, z, regime):
        """
        Compute stop loss level.

        Stop loss is placed beyond the current deviation,
        anticipating that if we're wrong, the move continues.
        """
        # Extension beyond current deviation
        extension_mult = 1.5 if regime.name in ['cascade', 'high_leverage'] else 1.3

        if z > 0:
            # Short position: stop above current spot
            stop = spot * (1 + abs(z) * 0.01 * extension_mult)
        else:
            # Long position: stop below current spot
            stop = spot * (1 - abs(z) * 0.01 * extension_mult)

        return stop
```

### 9.2 Signal Examples

**Example 1: Liquidation Cascade Signal**

```
Current State:
  True Price:     $30,000
  Spot (median):  $28,200
  Deviation:      -6% (-3.8σ)
  Regime:         cascade
  Leverage Stress: 0.85

Signal Generated:
  Type:           LONG
  Confidence:     0.88
  Manipulation P: 0.91
  Reversion P:    0.89

  Targets:
    T1 (50%): $29,100 - Probability 0.80
    T2 (75%): $29,550 - Probability 0.60
    T3 (Full): $30,000 - Probability 0.40
    T4 (Overshoot): $30,450 - Probability 0.18

  Timeframe: 1-2 hours
  Stop Loss: $27,500
```

**Example 2: High Leverage Warning**

```
Current State:
  True Price:     $30,000
  Spot (median):  $30,900
  Deviation:      +3% (+2.1σ)
  Regime:         high_leverage
  Leverage Stress: 0.72

Signal Generated:
  Type:           SHORT
  Confidence:     0.65
  Manipulation P: 0.58
  Reversion P:    0.68

  Targets:
    T1 (50%): $30,450 - Probability 0.60
    T2 (75%): $30,225 - Probability 0.42
    T3 (Full): $30,000 - Probability 0.28

  Timeframe: 3-6 hours
  Stop Loss: $31,500
```

---

## 10. Bad Actor Neutralization

### 10.1 Why This Framework Reduces Manipulation Advantage

The True Price framework doesn't moralize about "bad actors"—it mechanically reduces their advantage:

**Information Asymmetry Reduction**

```
Traditional:
  Dominant actor sees:
    - Order flow across venues
    - Liquidation levels
    - Stop loss clusters
  Advantage: Trade ahead of forced flows

True Price Framework:
  - Forced flows identified and discounted
  - True Price doesn't move with manipulation
  - Dominant actor's information advantage neutralized
```

**Manipulation Profit Extraction**

```
Traditional manipulation:
  1. Push price to liquidation level
  2. Cascade triggers forced selling
  3. Buy at artificially low prices
  4. Profit as price recovers

With True Price:
  1. Manipulation detected in real-time
  2. True Price doesn't follow manipulation
  3. Counter-traders know reversion is coming
  4. Manipulation becomes negative EV:
     - Cost of manipulation (pushing price)
     - No information edge (everyone knows it's manipulation)
     - Counter-traders front-run the recovery
```

### 10.2 Mechanical Focus, Not Moral Judgment

The framework makes no moral claims about manipulation. It simply:

1. **Identifies** leverage-driven price distortions mechanically
2. **Discounts** distorted observations in the True Price model
3. **Quantifies** reversion probability statistically
4. **Enables** counter-trading that makes manipulation unprofitable

If manipulation becomes unprofitable, rational actors stop doing it. No enforcement required.

### 10.3 Incentive Realignment

```
Old Equilibrium:
  Dominant actor: Manipulate → Profit
  Regular trader: Get liquidated → Loss
  Net: Zero-sum extraction

New Equilibrium (with True Price):
  Dominant actor: Manipulation detected → Counter-traded → Loss
  Regular trader: See manipulation → Trade reversion → Profit
  Net: Manipulation becomes negative EV

Result:
  Rational dominant actors stop manipulating
  Price converges to True Price
  Everyone benefits from accurate prices
```

---

## 11. Integration with VibeSwap

### 11.1 Oracle Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRUE PRICE ORACLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │   Kalman   │  │  Regime    │  │   Signal   │               │
│  │   Filter   │──│ Classifier │──│  Generator │               │
│  └────────────┘  └────────────┘  └────────────┘               │
│        │               │               │                        │
│        ▼               ▼               ▼                        │
│  ┌─────────────────────────────────────────────┐              │
│  │              TRUE PRICE OUTPUT               │              │
│  │  - Point estimate                            │              │
│  │  - Confidence interval                       │              │
│  │  - Deviation z-score                         │              │
│  │  - Regime classification                     │              │
│  │  - Manipulation probability                  │              │
│  │  - Reversion signal                          │              │
│  └─────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VIBESWAP INTEGRATION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. BATCH AUCTION CLEARING                                      │
│     - Use True Price as reference for clearing price bounds     │
│     - Reject batches that clear too far from True Price         │
│                                                                  │
│  2. CIRCUIT BREAKER                                             │
│     - Trigger pause when manipulation probability > 80%         │
│     - Prevent trades during detected cascades                   │
│                                                                  │
│  3. DYNAMIC FEES                                                │
│     - Increase fees during high-deviation regimes               │
│     - Capture volatility premium                                │
│                                                                  │
│  4. LP PROTECTION                                               │
│     - Don't let LPs provide liquidity at manipulated prices     │
│     - IL protection uses True Price, not spot                   │
│                                                                  │
│  5. USER INTERFACE                                              │
│     - Show True Price alongside spot                            │
│     - Display manipulation warnings                             │
│     - Provide reversion signal opt-in                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 Batch Auction Enhancement

```python
def validate_batch_clearing(batch, true_price_oracle):
    """
    Validate that batch clears at a reasonable price relative to True Price.
    """
    clearing_price = batch.computed_clearing_price
    true_price = true_price_oracle.get_current_estimate()

    deviation = abs(clearing_price - true_price.price) / true_price.price
    zscore = (clearing_price - true_price.price) / true_price.std

    # Regime-dependent thresholds
    thresholds = {
        'cascade': 0.005,       # Only 0.5% deviation allowed during cascade
        'manipulation': 0.005,
        'high_leverage': 0.01,
        'normal': 0.02,
        'low_volatility': 0.02
    }

    max_deviation = thresholds.get(true_price.regime, 0.02)

    if deviation > max_deviation:
        return ValidationResult(
            valid=False,
            reason=f"Clearing price deviates {deviation:.2%} from True Price during {true_price.regime} regime",
            suggested_action="Pause batch, wait for price stabilization"
        )

    return ValidationResult(valid=True)
```

### 11.3 LP Protection Enhancement

```python
def compute_il_protection(position, exit_price, true_price_oracle):
    """
    Compute IL protection using True Price instead of manipulated spot.

    This prevents:
      - LPs getting liquidated at manipulated prices
      - IL claims based on temporary distortions
    """
    # Use True Price for IL calculation, not spot
    true_price = true_price_oracle.get_current_estimate()

    # If current spot is significantly manipulated, use True Price
    if true_price.manipulation_probability > 0.7:
        reference_price = true_price.price
        note = "Using True Price due to detected manipulation"
    else:
        # Use average of spot and True Price
        reference_price = (exit_price + true_price.price) / 2
        note = "Using blended price"

    il = compute_impermanent_loss(position.entry_price, reference_price)

    return ILProtectionCalc(
        impermanent_loss=il,
        reference_price=reference_price,
        note=note
    )
```

---

## 12. Extensions and Future Work

### 12.1 Backtesting Framework

```python
class TruePriceBacktester:
    """
    Backtest True Price model and trading signals.
    """

    def __init__(self, historical_data, config):
        self.data = historical_data
        self.config = config
        self.kf = TruePriceKalmanFilter(
            initial_price=historical_data.prices[0],
            config=config
        )

    def run_backtest(self):
        """
        Run full historical backtest.
        """
        results = []

        for t in range(len(self.data)):
            # Update True Price estimate
            estimate = self.update_step(t)

            # Generate signal
            signal = self.generate_signal(estimate)

            # Track signal outcomes
            if signal.type != 'NEUTRAL':
                outcome = self.evaluate_signal_outcome(t, signal)
                results.append(outcome)

        return BacktestResults(
            signals=results,
            accuracy=self.compute_accuracy(results),
            sharpe=self.compute_sharpe(results),
            max_drawdown=self.compute_max_drawdown(results)
        )

    def evaluate_signal_outcome(self, t, signal):
        """
        Evaluate how signal performed.
        """
        entry_price = self.data.spot_prices[t]

        # Look ahead to see if targets hit
        for future_t in range(t + 1, min(t + 48, len(self.data))):  # Up to 48 hours
            future_price = self.data.spot_prices[future_t]

            # Check each target
            for target in signal.targets:
                if signal.type == 'LONG' and future_price >= target.price:
                    return SignalOutcome(
                        signal=signal,
                        entry_price=entry_price,
                        exit_price=future_price,
                        target_hit=target.label,
                        time_to_hit=future_t - t,
                        profit_pct=(future_price - entry_price) / entry_price
                    )
                elif signal.type == 'SHORT' and future_price <= target.price:
                    return SignalOutcome(
                        signal=signal,
                        entry_price=entry_price,
                        exit_price=future_price,
                        target_hit=target.label,
                        time_to_hit=future_t - t,
                        profit_pct=(entry_price - future_price) / entry_price
                    )

            # Check stop loss
            if signal.type == 'LONG' and future_price <= signal.stop_loss:
                return SignalOutcome(
                    signal=signal,
                    entry_price=entry_price,
                    exit_price=signal.stop_loss,
                    target_hit='STOP_LOSS',
                    time_to_hit=future_t - t,
                    profit_pct=(signal.stop_loss - entry_price) / entry_price
                )
            elif signal.type == 'SHORT' and future_price >= signal.stop_loss:
                return SignalOutcome(
                    signal=signal,
                    entry_price=entry_price,
                    exit_price=signal.stop_loss,
                    target_hit='STOP_LOSS',
                    time_to_hit=future_t - t,
                    profit_pct=(entry_price - signal.stop_loss) / entry_price
                )

        # No target or stop hit within window
        return SignalOutcome(
            signal=signal,
            entry_price=entry_price,
            exit_price=self.data.spot_prices[min(t + 48, len(self.data) - 1)],
            target_hit='TIMEOUT',
            time_to_hit=48,
            profit_pct=None
        )
```

### 12.2 True Price Index

A tradeable index based on True Price:

```
TRUE PRICE INDEX (TPI):

Definition:
  TPI(t) = True_Price(t) / True_Price(0) × 100

Properties:
  - Tracks manipulation-resistant price
  - Slower-moving than spot
  - Can serve as benchmark for performance

Potential Products:
  - TPI futures (trade True Price directly)
  - TPI options (volatility on True Price)
  - TPI-spot spread (arbitrage manipulation premium)
```

### 12.3 Multi-Asset Extension

```python
def compute_true_price_correlation(asset_a, asset_b):
    """
    Compute correlation of True Prices (not spot prices).

    True Price correlation is more stable because it filters out
    correlated manipulation events (e.g., cascade on BTC affecting ETH).
    """
    true_prices_a = [estimate.price for estimate in asset_a.true_price_history]
    true_prices_b = [estimate.price for estimate in asset_b.true_price_history]

    true_correlation = np.corrcoef(
        np.diff(np.log(true_prices_a)),
        np.diff(np.log(true_prices_b))
    )[0, 1]

    # Compare to spot correlation
    spot_prices_a = [estimate.spot_median for estimate in asset_a.true_price_history]
    spot_prices_b = [estimate.spot_median for estimate in asset_b.true_price_history]

    spot_correlation = np.corrcoef(
        np.diff(np.log(spot_prices_a)),
        np.diff(np.log(spot_prices_b))
    )[0, 1]

    return TruePriceCorrelation(
        true_correlation=true_correlation,
        spot_correlation=spot_correlation,
        manipulation_correlation=spot_correlation - true_correlation  # Correlated manipulation
    )
```

### 12.4 Machine Learning Enhancement

```python
class MLRegimeClassifier:
    """
    Use machine learning to improve regime classification.

    Features:
      - Kalman filter innovation sequence
      - Leverage stress components
      - Orderbook features
      - On-chain metrics
      - Time of day / day of week

    Labels:
      - Manual labels from known manipulation events
      - Retrospective labels from price reversions
    """

    def __init__(self):
        self.model = GradientBoostingClassifier(n_estimators=100)
        self.feature_names = []

    def train(self, labeled_data):
        """
        Train on historically labeled manipulation events.
        """
        X = self.extract_features(labeled_data)
        y = labeled_data.labels

        self.model.fit(X, y)

    def predict_regime(self, current_state):
        """
        Predict current regime with probability.
        """
        X = self.extract_features([current_state])
        proba = self.model.predict_proba(X)[0]

        return {
            regime: prob
            for regime, prob in zip(self.model.classes_, proba)
        }
```

---

## 13. Conclusion

### 13.1 Summary

This paper has presented a rigorous framework for **True Price** estimation in cryptocurrency markets:

1. **Definition**: True Price is the Bayesian posterior estimate of equilibrium price, filtering out leverage-driven distortions.

2. **Model**: A state-space model with Kalman filtering, where observation noise increases during leverage stress.

3. **Inputs**: Multi-venue prices, leverage metrics, on-chain fundamentals, and order-book quality signals.

4. **Regimes**: Dynamic classification of market conditions with regime-dependent parameters.

5. **Signals**: Trading signals based on deviation from True Price, with probabilistic targets and timeframes.

6. **Integration**: Seamless connection with VibeSwap's batch auction mechanism for manipulation-resistant trading.

### 13.2 Key Properties Achieved

| Requirement | How Achieved |
|-------------|--------------|
| Exchange-agnostic | Weighted multi-venue aggregation |
| Slow-moving | Kalman filter smoothing + low process noise |
| Statistically robust | Formal state-space model with uncertainty quantification |
| Manipulation-resistant | Time-varying observation noise discounts leverage distortions |
| Actionable | Clear signal generation with targets and timeframes |

### 13.3 The Bigger Picture

True Price is not just a technical tool—it's a step toward **fair markets**.

When manipulation becomes detectable and counterable:
- Manipulation becomes unprofitable
- Rational actors stop manipulating
- Prices converge to genuine equilibrium
- Everyone benefits from accurate price signals

This is the vision: markets that serve price discovery, not extraction.

The mathematics is rigorous. The framework is implementable. The question is whether we choose to build it.

---

## Appendix A: Kalman Filter Mathematics

### State-Space Representation

```
State equation:
  x(t) = F × x(t-1) + w(t),    w(t) ~ N(0, Q)

Observation equation:
  y(t) = H × x(t) + v(t),      v(t) ~ N(0, R(t))
```

### Prediction Step

```
x̂(t|t-1) = F × x̂(t-1|t-1)
P(t|t-1) = F × P(t-1|t-1) × F' + Q
```

### Update Step

```
Innovation: ỹ(t) = y(t) - H × x̂(t|t-1)
Innovation covariance: S(t) = H × P(t|t-1) × H' + R(t)
Kalman gain: K(t) = P(t|t-1) × H' × S(t)⁻¹

State update: x̂(t|t) = x̂(t|t-1) + K(t) × ỹ(t)
Covariance update: P(t|t) = (I - K(t) × H) × P(t|t-1)
```

### Time-Varying R(t)

```
R(t) = diag(σ²₁(t), σ²₂(t), ..., σ²ₙ(t))

Where:
  σ²ᵢ(t) = base_variance_i × leverage_mult(t) × quality_mult(t) × cascade_mult(t)
```

---

## Appendix B: Data Source Specifications

| Source | Data Type | Update Frequency | API |
|--------|-----------|------------------|-----|
| Binance | Spot, futures, liquidations | Real-time | WebSocket |
| Coinbase | Spot | Real-time | WebSocket |
| Uniswap | Spot, volume | Per-block | Subgraph |
| Chainlink | Aggregated price | ~1 minute | On-chain |
| Glassnode | On-chain metrics | Hourly | REST API |
| Coinglass | OI, funding, liquidations | Real-time | WebSocket |

---

## Appendix C: Parameter Recommendations

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| Kalman process noise (price) | 0.0001 | Low = slow-moving True Price |
| Kalman process noise (drift) | 0.00001 | Very slow drift adaptation |
| Drift persistence (ρ) | 0.99 | Near unit root |
| Base observation variance | Per-venue historical | Calibrate from data |
| Leverage stress saturation | 5x base variance | During max stress |
| Cascade observation variance | 10x base variance | Heavy discounting |
| Minimum z-score for signal | 1.5σ | Filter noise |
| High-confidence z-score | 3.0σ | Strong signals |

---

*"The market can stay irrational longer than you can stay solvent."*
*— John Maynard Keynes*

*"Unless you can quantify the irrationality and know when it will end."*
*— True Price Oracle*

---

**VibeSwap** - True Prices Through Rigorous Estimation

---

**Document Version**: 1.0
**Date**: February 2026
**License**: MIT
