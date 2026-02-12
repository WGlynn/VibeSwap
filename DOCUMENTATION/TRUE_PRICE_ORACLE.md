# True Price Oracle

## A Quantitative Framework for Manipulation-Resistant Price Discovery

**Version 2.0 | February 2026**

---

## Abstract

Cryptocurrency spot prices are systematically distorted by leverage, forced liquidations, order-book manipulation, and cross-venue arbitrage by dominant actors. These distortions create prices that deviate materially from underlying economic equilibrium, generating false signals and cascading liquidations that transfer wealth from retail participants to sophisticated actors.

This paper presents a rigorous framework for computing a **True Price**—a latent equilibrium price estimate that is:

- **Exchange-agnostic**: Not dependent on any single venue
- **Slow-moving**: Resistant to short-term manipulation
- **Statistically robust**: Formally modeled with quantified uncertainty
- **Actionable**: Provides deviation signals for mean-reversion opportunities

We employ a **state-space model** with Kalman filtering to estimate True Price as a hidden state, incorporating multi-venue price data, leverage metrics, on-chain fundamentals, order-book quality signals, and **stablecoin flow dynamics**.

A key innovation of this framework is the **asymmetric treatment of stablecoins**: USDT flows are modeled as leverage-enabling and volatility-amplifying, while USDC flows are modeled as capital-confirming and trend-validating. This distinction is critical for separating genuine price discovery from leverage-fueled manipulation.

The framework outputs not just a price estimate, but confidence intervals and regime classifications that distinguish organic volatility from manipulation-driven distortions.

---

## Table of Contents

1. [Introduction: The Price Distortion Problem](#1-introduction-the-price-distortion-problem)
2. [What True Price Is (And Is Not)](#2-what-true-price-is-and-is-not)
3. [Model Inputs](#3-model-inputs)
4. [Stablecoin Flow Dynamics](#4-stablecoin-flow-dynamics)
5. [The State-Space Model](#5-the-state-space-model)
6. [Kalman Filter Implementation](#6-kalman-filter-implementation)
7. [Leverage Stress and Trust Weighting](#7-leverage-stress-and-trust-weighting)
8. [Deviation Bands and Regime Detection](#8-deviation-bands-and-regime-detection)
9. [Liquidation Cascade Identification](#9-liquidation-cascade-identification)
10. [Signal Generation Framework](#10-signal-generation-framework)
11. [Bad Actor Neutralization](#11-bad-actor-neutralization)
12. [Integration with VibeSwap](#12-integration-with-vibeswap)
13. [Extensions and Future Work](#13-extensions-and-future-work)
14. [Conclusion](#14-conclusion)

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

**Stablecoin-Enabled Leverage**
```
USDT minted → Flows to derivatives exchanges → Enables margin positions
Large USDT mints often precede volatility spikes
The "capital" entering is not genuine investment—it's leverage fuel
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
P_true(t) = E[P_equilibrium(t) | I(t), L(t), O(t), S(t)]

Where:
  I(t) = Information set (prices, volumes, on-chain data)
  L(t) = Leverage state (open interest, funding, liquidations)
  O(t) = Order-book quality (persistence, depth, spoofing probability)
  S(t) = Stablecoin flow state (USDT vs USDC dynamics)
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

**Stablecoin-Aware**
True Price distinguishes between capital inflows (USDC-dominant) and leverage enablement (USDT-dominant), adjusting confidence accordingly.

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
│  Layer 5: STABLECOIN FLOWS (NEW)                                │
│  ├── USDT mint/burn volume and destination                      │
│  ├── USDC mint/burn volume and destination                      │
│  ├── Stablecoin exchange flow classification                    │
│  └── USDT/USDC flow ratio and regime signals                    │
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

## 4. Stablecoin Flow Dynamics

### 4.1 Why Stablecoins Must Be Treated Asymmetrically

**Critical Insight**: Not all stablecoin inflows represent genuine capital. The distinction between USDT and USDC flows is fundamental to understanding whether a price move reflects real demand or leverage-fueled manipulation.

```
USDT (Tether):
├── Primary use: Derivatives margin, offshore trading
├── Destination: Binance, Bybit, OKX (derivatives-heavy)
├── Behavior: Enables leverage, amplifies volatility
├── Model treatment: VOLATILITY AMPLIFIER
└── Effect on True Price: Increases σ, reduces trust in spot

USDC (Circle):
├── Primary use: Spot trading, custody, DeFi
├── Destination: Coinbase, regulated venues, on-chain
├── Behavior: Represents genuine capital movement
├── Model treatment: CAPITAL VALIDATOR
└── Effect on True Price: Confirms slow drift direction
```

**Why Symmetric Treatment Is Wrong**

```
Treating all stablecoins equally:
  $1B USDT mint = $1B "capital inflow"

Reality:
  $1B USDT mint → Flows to Binance → Enables $10-50B notional leverage
  $1B USDC mint → Flows to Coinbase → $1B actual buying power

The same "inflow" has 10-50x different impact on price dynamics.
```

### 4.2 Stablecoin Flow Classification

We classify stablecoin activity into three categories:

```python
class StablecoinFlowClassifier:
    """
    Classify stablecoin flows by their market impact.
    """

    def classify_flow(self, mint_data, exchange_flow_data, leverage_data):
        """
        Classify a stablecoin flow event.

        Categories:
          1. INVENTORY_REBALANCING - Neutral, market-making activity
          2. LEVERAGE_ENABLEMENT - Fuel for derivatives positions
          3. GENUINE_CAPITAL - Real investment inflow

        Returns:
          classification: Category label
          confidence: [0, 1]
          market_impact: Expected impact on price dynamics
        """
        features = self.extract_features(mint_data, exchange_flow_data, leverage_data)
        return self.model.predict(features)

    def extract_features(self, mint_data, exchange_flow_data, leverage_data):
        """
        Extract classification features.
        """
        return {
            # Mint characteristics
            'mint_size': mint_data.amount,
            'mint_frequency': mint_data.frequency_24h,
            'stablecoin_type': mint_data.token,  # USDT vs USDC

            # Destination characteristics
            'dest_derivatives_ratio': exchange_flow_data.derivatives_venue_ratio,
            'dest_spot_ratio': exchange_flow_data.spot_venue_ratio,
            'dest_defi_ratio': exchange_flow_data.defi_ratio,

            # Leverage context
            'oi_change_concurrent': leverage_data.oi_change_1h,
            'funding_rate_current': leverage_data.funding_rate,
            'funding_acceleration': leverage_data.funding_rate_change,

            # Timing
            'time_to_oi_increase': leverage_data.lag_to_oi_increase,
            'time_to_price_move': leverage_data.lag_to_price_move,
        }
```

### 4.3 Classification Logic

**Category 1: Inventory Rebalancing**
```
Indicators:
├── Small to medium mint size (< $100M)
├── Flow to multiple venues proportionally
├── No significant OI change following
├── No funding rate acceleration
├── Balanced time distribution

Interpretation:
  Market makers adjusting inventory
  Neutral for True Price

Model Treatment:
  Weight: 0 (ignore for True Price calculation)
```

**Category 2: Leverage Enablement**
```
Indicators:
├── Large mint size (> $100M) OR high frequency
├── Flow concentrated to derivatives venues
├── OI increases within 1-4 hours
├── Funding rate accelerates in one direction
├── Often USDT, rarely USDC

Interpretation:
  Fuel for leveraged positions
  Will amplify volatility
  Price moves NOT representative of genuine demand

Model Treatment:
  USDT: Increase observation noise σ by 50-200%
  USDC: Rare, but if occurs, still increase σ by 25%
```

**Category 3: Genuine Capital**
```
Indicators:
├── Gradual mint over days/weeks
├── Flow to spot-heavy venues or custody
├── No corresponding OI increase
├── Stable or decreasing funding rates
├── Often USDC, sometimes USDT

Interpretation:
  Real capital entering the market
  Supports slow True Price drift

Model Treatment:
  USDC: Increase confidence in True Price drift direction
  USDT: Partial weight (0.3x) due to uncertainty
```

### 4.4 USDT-Specific Modeling

```python
class USDTFlowModel:
    """
    Model USDT flows as leverage-enabling and volatility-amplifying.
    """

    def compute_usdt_impact(self, usdt_flow_data, leverage_state):
        """
        Compute impact of USDT flows on True Price model.

        USDT flows:
          - Do NOT directly influence True Price level
          - DO increase expected volatility (σ)
          - DO reduce trust in spot price inputs
          - DO raise manipulation probability

        Returns:
          volatility_multiplier: Factor to multiply σ
          trust_reduction: Factor to reduce spot price weight
          manipulation_prob_adjustment: Addition to manipulation probability
        """
        # Base metrics
        mint_volume_24h = usdt_flow_data.mint_volume_24h
        flow_to_derivatives = usdt_flow_data.derivatives_exchange_flow
        oi_correlation = self.compute_oi_correlation(usdt_flow_data, leverage_state)

        # Volatility amplification
        # Large USDT flows to derivatives venues = expect volatility
        vol_multiplier = 1.0 + (
            0.5 * normalize(mint_volume_24h, typical_mint) +
            0.3 * flow_to_derivatives / (flow_to_derivatives + usdt_flow_data.spot_flow + 1) +
            0.2 * max(0, oi_correlation)
        )
        vol_multiplier = min(3.0, vol_multiplier)  # Cap at 3x

        # Trust reduction in spot prices
        # When USDT enables leverage, spot prices reflect leverage, not value
        trust_reduction = 0.5 * (vol_multiplier - 1.0)  # 0 to 1

        # Manipulation probability adjustment
        # Large concentrated flows = higher manipulation probability
        manip_adjustment = 0.2 * normalize(flow_to_derivatives, typical_flow)

        return USDTImpact(
            volatility_multiplier=vol_multiplier,
            trust_reduction=trust_reduction,
            manipulation_prob_adjustment=manip_adjustment
        )

    def compute_oi_correlation(self, usdt_flow_data, leverage_state):
        """
        Compute correlation between USDT flows and OI changes.

        High correlation = USDT is enabling leverage
        Low correlation = USDT may be for spot or custody
        """
        usdt_flows = usdt_flow_data.hourly_flows[-24:]
        oi_changes = leverage_state.hourly_oi_changes[-24:]

        # Lag correlation (USDT typically precedes OI by 1-4 hours)
        max_corr = 0
        for lag in range(1, 5):
            corr = np.corrcoef(usdt_flows[:-lag], oi_changes[lag:])[0, 1]
            max_corr = max(max_corr, corr)

        return max_corr
```

### 4.5 USDC-Specific Modeling

```python
class USDCFlowModel:
    """
    Model USDC flows as capital-confirming and trend-validating.
    """

    def compute_usdc_impact(self, usdc_flow_data, price_trend):
        """
        Compute impact of USDC flows on True Price model.

        USDC flows:
          - Marginally increase confidence in slow True Price drift
          - Help distinguish trend from manipulation
          - Do NOT directly move True Price

        Returns:
          drift_confidence_adjustment: Factor to adjust drift confidence
          regime_signal: Trend vs manipulation signal
        """
        # Metrics
        mint_volume_7d = usdc_flow_data.mint_volume_7d
        flow_to_spot = usdc_flow_data.spot_exchange_flow
        flow_to_custody = usdc_flow_data.custody_flow
        flow_to_defi = usdc_flow_data.defi_flow

        # Capital confirmation score
        # USDC to spot/custody = genuine capital
        capital_score = (
            0.5 * normalize(flow_to_spot, typical_spot_flow) +
            0.3 * normalize(flow_to_custody, typical_custody_flow) +
            0.2 * normalize(flow_to_defi, typical_defi_flow)
        )

        # Drift confidence adjustment
        # If USDC flows align with price direction, increase confidence
        if price_trend.direction == 'up' and mint_volume_7d > typical_mint:
            drift_confidence_adj = 0.1 * capital_score  # Up to +10%
        elif price_trend.direction == 'down' and usdc_flow_data.burn_volume_7d > typical_burn:
            drift_confidence_adj = 0.1 * capital_score  # Confirms downtrend
        else:
            drift_confidence_adj = 0  # Neutral

        # Regime signal
        # Strong USDC flows = more likely genuine trend
        regime_signal = self.compute_regime_signal(usdc_flow_data, price_trend)

        return USDCImpact(
            drift_confidence_adjustment=drift_confidence_adj,
            regime_signal=regime_signal
        )

    def compute_regime_signal(self, usdc_flow_data, price_trend):
        """
        Compute whether current price action is trend or manipulation.

        USDC-dominant = more likely trend
        USDT-dominant = more likely manipulation
        """
        usdc_flow = usdc_flow_data.total_flow_7d
        usdt_flow = usdc_flow_data.usdt_comparison_flow_7d

        usdc_ratio = usdc_flow / (usdc_flow + usdt_flow + 1e-10)

        if usdc_ratio > 0.6:
            return RegimeSignal('TREND', confidence=usdc_ratio)
        elif usdc_ratio < 0.3:
            return RegimeSignal('MANIPULATION', confidence=1 - usdc_ratio)
        else:
            return RegimeSignal('UNCERTAIN', confidence=0.5)
```

### 4.6 Stablecoin Flow Ratio

```python
def compute_stablecoin_flow_ratio(usdt_flow, usdc_flow, window='7d'):
    """
    Compute the USDT/USDC flow ratio as a regime indicator.

    Ratio interpretation:
      > 3.0: USDT-dominant, high leverage risk, manipulation likely
      1.0-3.0: Mixed, moderate leverage
      < 1.0: USDC-dominant, genuine capital, trend likely

    Returns:
      ratio: USDT flow / USDC flow
      regime_probability: P(manipulation) based on ratio
    """
    usdt_total = usdt_flow.sum(window)
    usdc_total = usdc_flow.sum(window)

    ratio = usdt_total / (usdc_total + 1e-10)

    # Manipulation probability as function of ratio
    # Logistic function centered at ratio = 2
    regime_probability = 1 / (1 + np.exp(-1.5 * (ratio - 2)))

    return StablecoinRatio(
        ratio=ratio,
        usdt_dominant=(ratio > 2),
        usdc_dominant=(ratio < 0.5),
        manipulation_probability=regime_probability
    )
```

### 4.7 Integration with True Price Model

```python
def incorporate_stablecoin_dynamics(kalman_filter, stablecoin_state):
    """
    Adjust Kalman filter parameters based on stablecoin flows.
    """
    usdt_impact = stablecoin_state.usdt_impact
    usdc_impact = stablecoin_state.usdc_impact

    # 1. Adjust observation noise (R matrix)
    # USDT flows increase observation noise (less trust in spot)
    observation_noise_mult = usdt_impact.volatility_multiplier

    # 2. Adjust process noise (Q matrix)
    # USDC-confirmed trends allow slightly faster True Price drift
    if usdc_impact.regime_signal.label == 'TREND':
        process_noise_mult = 1.0 + 0.2 * usdc_impact.drift_confidence_adjustment
    else:
        process_noise_mult = 1.0

    # 3. Adjust venue weights
    # During USDT-dominant periods, reduce weight on derivatives-heavy venues
    if stablecoin_state.flow_ratio.usdt_dominant:
        venue_weight_adjustments = {
            'binance': 0.5,  # Reduce weight
            'bybit': 0.5,
            'coinbase': 1.2,  # Increase weight
            'kraken': 1.2,
        }
    else:
        venue_weight_adjustments = {}  # No adjustment

    return KalmanAdjustments(
        observation_noise_mult=observation_noise_mult,
        process_noise_mult=process_noise_mult,
        venue_weight_adjustments=venue_weight_adjustments
    )
```

---

## 5. The State-Space Model

### 5.1 Model Structure

We model True Price as a **hidden state** that generates observable prices through a noisy observation process:

```
State Equation (True Price Evolution):
  P_true(t) = P_true(t-1) + μ(t) + η(t)

  Where:
    μ(t) = drift (long-term trend component)
    η(t) ~ N(0, Q(t)) = process noise (organic volatility)

Observation Equation (Spot Price Generation):
  P_spot(t) = P_true(t) + leverage_distortion(t) + stablecoin_distortion(t) + ε(t)

  Where:
    leverage_distortion(t) = f(OI, funding, liquidations)
    stablecoin_distortion(t) = f(USDT_flow, USDC_flow)
    ε(t) ~ N(0, R(t)) = observation noise
```

### 5.2 Formal Specification

**State Vector**

```
x(t) = [P_true(t), μ(t)]'

State transition:
x(t) = F × x(t-1) + w(t)

F = [1  1]    (True Price inherits drift)
    [0  ρ]    (Drift is mean-reverting with persistence ρ)

w(t) ~ N(0, Q(t))

Q(t) = [σ²_price(t)    0           ]
       [0              σ²_drift(t)  ]

Note: Q is now TIME-VARYING based on USDC confirmation
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

Note: R is TIME-VARYING based on leverage stress AND USDT flows
```

### 5.3 Time-Varying Noise Covariance

The key innovation: **observation noise variance increases with leverage stress AND USDT activity**.

```python
def compute_observation_variance(venue, leverage_state, orderbook_quality, stablecoin_state):
    """
    Observation variance is NOT constant.
    It increases when:
      - Leverage is high (price driven by forced flows)
      - Orderbook quality is low (spoofing detected)
      - Liquidation cascade in progress
      - USDT flows are elevated (leverage enablement)

    It may decrease when:
      - USDC flows confirm the trend (genuine capital)
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

    # USDT multiplier (NEW)
    usdt_mult = stablecoin_state.usdt_impact.volatility_multiplier  # 1.0 to 3.0

    # USDC adjustment (NEW)
    # If USDC confirms trend, slightly reduce variance
    if stablecoin_state.usdc_impact.regime_signal.label == 'TREND':
        usdc_adj = 0.9  # 10% reduction
    else:
        usdc_adj = 1.0

    return base_variance * leverage_mult * quality_mult * cascade_mult * usdt_mult * usdc_adj
```

---

## 6. Kalman Filter Implementation

### 6.1 The Kalman Filter Algorithm

```python
class TruePriceKalmanFilter:
    """
    Kalman filter for True Price estimation with stablecoin dynamics.

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

        # Process noise covariance (base, adjusted dynamically)
        self.Q_base = np.array([
            [config.process_noise_price, 0],
            [0, config.process_noise_drift]
        ])

        # State transition matrix
        self.F = np.array([
            [1, 1],
            [0, config.drift_persistence]  # ρ ≈ 0.99
        ])

    def predict(self, stablecoin_state):
        """
        Prediction step: propagate state forward.
        Adjust process noise based on stablecoin dynamics.
        """
        # Adjust Q based on USDC confirmation
        usdc_adj = 1.0
        if stablecoin_state.usdc_impact.regime_signal.label == 'TREND':
            usdc_adj = 1.0 + 0.2 * stablecoin_state.usdc_impact.drift_confidence_adjustment

        Q = self.Q_base * usdc_adj

        # State prediction
        self.x_pred = self.F @ self.x

        # Covariance prediction
        self.P_pred = self.F @ self.P @ self.F.T + Q

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
        H = np.zeros((n_obs, 2))
        H[:, 0] = 1  # All observations measure True Price

        # Build observation noise covariance (DIAGONAL, time-varying)
        R = np.diag(observation_variances)

        # Innovation (measurement residual)
        y_pred = H @ self.x_pred
        innovation = observations - y_pred

        # Innovation covariance
        S = H @ self.P_pred @ H.T + R

        # Kalman gain
        K = self.P_pred @ H.T @ np.linalg.inv(S)

        # State update
        self.x = self.x_pred + K @ innovation

        # Covariance update
        I = np.eye(2)
        self.P = (I - K @ H) @ self.P_pred

        return self.x[0], np.sqrt(self.P[0, 0])  # True Price estimate and std dev

    def get_confidence_interval(self, confidence=0.95):
        """
        Return confidence interval for True Price.
        """
        z = stats.norm.ppf((1 + confidence) / 2)
        std = np.sqrt(self.P[0, 0])

        return (self.x[0] - z * std, self.x[0] + z * std)
```

### 6.2 Full Update Cycle

```python
def update_true_price(kf, market_data, leverage_state, orderbook_quality, stablecoin_state):
    """
    Complete True Price update cycle with stablecoin dynamics.

    Args:
        kf: TruePriceKalmanFilter instance
        market_data: Current venue prices, realized price
        leverage_state: Current leverage metrics
        orderbook_quality: Current orderbook quality scores
        stablecoin_state: Current USDT/USDC flow state

    Returns:
        true_price: Point estimate
        confidence_interval: (lower, upper)
        deviation_zscore: How far spot is from True Price in std devs
        regime: Current regime classification
    """
    # 1. Prediction step (with stablecoin adjustment)
    predicted_price = kf.predict(stablecoin_state)

    # 2. Compute time-varying observation variances
    obs_variances = []
    for venue in market_data.venues:
        var = compute_observation_variance(
            venue,
            leverage_state,
            orderbook_quality[venue.name],
            stablecoin_state
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

    # 7. Classify regime (incorporating stablecoin signals)
    regime = classify_regime(
        deviation_zscore,
        leverage_state,
        stablecoin_state
    )

    return TruePriceEstimate(
        price=true_price,
        std=true_price_std,
        confidence_interval=ci,
        deviation_zscore=deviation_zscore,
        spot_median=median_spot,
        regime=regime
    )
```

---

## 7. Leverage Stress and Trust Weighting

### 7.1 Leverage Stress Score

```python
def compute_leverage_stress(oi_data, funding_data, liquidation_data, stablecoin_state):
    """
    Compute composite leverage stress score [0, 1].
    Now incorporates stablecoin flow signals.

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
    divergence = funding_data.rate * (-price_return_1h)
    divergence_stress = max(0, min(1, divergence * 10))

    # Component 5: USDT flow stress (NEW)
    usdt_stress = min(1, (stablecoin_state.usdt_impact.volatility_multiplier - 1) / 2)

    # Weighted combination
    stress = (
        0.20 * oi_stress +
        0.20 * funding_stress +
        0.25 * liq_stress +
        0.10 * divergence_stress +
        0.25 * usdt_stress  # NEW: USDT is significant factor
    )

    return LeverageStress(
        score=stress,
        oi_component=oi_stress,
        funding_component=funding_stress,
        liquidation_component=liq_stress,
        divergence_component=divergence_stress,
        usdt_component=usdt_stress
    )
```

### 7.2 Trust Weighting by Venue

When leverage stress is high OR USDT flows are elevated, we trust certain venues more than others:

```python
def compute_venue_trust_weights(venues, leverage_stress, orderbook_quality, stablecoin_state):
    """
    Compute trust weights for each venue based on current conditions.

    During high leverage stress OR USDT-dominant periods:
      - Reduce weight on derivatives-heavy venues (Binance, Bybit)
      - Increase weight on spot-only venues (Coinbase)
      - Increase weight on decentralized venues (Uniswap)
      - Maximum weight on manipulation-resistant venues (VibeSwap)
    """
    weights = {}

    # Is this a USDT-dominant period?
    usdt_dominant = stablecoin_state.flow_ratio.usdt_dominant

    for venue in venues:
        base_weight = venue.base_reliability

        # Derivatives exposure penalty
        if venue.has_derivatives:
            derivatives_penalty = venue.derivatives_ratio * leverage_stress.score
            base_weight *= (1 - derivatives_penalty * 0.5)

            # Additional penalty during USDT-dominant periods
            if usdt_dominant:
                base_weight *= 0.7  # Extra 30% reduction

        # Orderbook quality adjustment
        quality = orderbook_quality[venue.name]
        quality_mult = 0.5 + 0.5 * quality.persistence_score
        base_weight *= quality_mult

        # Spoofing penalty
        if quality.spoofing_probability > 0.5:
            base_weight *= (1 - quality.spoofing_probability)

        # Decentralization bonus during stress
        if venue.is_decentralized and leverage_stress.score > 0.5:
            base_weight *= 1.2

        # USDC-heavy venue bonus during USDC-dominant periods (NEW)
        if stablecoin_state.flow_ratio.usdc_dominant and venue.usdc_primary:
            base_weight *= 1.3  # 30% bonus

        # VibeSwap special case
        if venue.name == 'VibeSwap':
            base_weight = 1.0  # Always maximum weight

        weights[venue.name] = max(0.1, base_weight)

    # Normalize
    total = sum(weights.values())
    weights = {k: v/total for k, v in weights.items()}

    return weights
```

### 7.3 Cascade Detection with Stablecoin Context

```python
def detect_liquidation_cascade(leverage_state, price_data, stablecoin_state, threshold=0.7):
    """
    Detect if a liquidation cascade is in progress.
    Stablecoin context helps distinguish cascade from genuine selling.

    Cascade indicators:
      1. Open interest dropping rapidly (> 5% in 5 minutes)
      2. Liquidation volume spiking (> 5x typical)
      3. Price moving faster than spot volume justifies
      4. Funding rate and price moving in same direction
      5. USDT-dominant conditions (leverage-enabled) - NEW

    Returns:
        is_cascade: Boolean
        cascade_confidence: [0, 1]
        cascade_direction: 'long_squeeze' or 'short_squeeze'
    """
    # Existing indicators...
    oi_drop_signal = min(1, abs(leverage_state.oi_change_5m) / 0.05)
    liq_spike_signal = min(1, leverage_state.liq_ratio / 5)
    divergence_signal = min(1, (leverage_state.divergence_ratio - 1) / 4)
    alignment_signal = max(0, leverage_state.funding_price_alignment * 100)

    # NEW: Stablecoin context
    # If USDT-dominant, more likely to be cascade
    # If USDC-dominant, more likely to be genuine move
    stablecoin_signal = stablecoin_state.flow_ratio.manipulation_probability

    # Combine
    cascade_confidence = (
        0.25 * oi_drop_signal +
        0.30 * liq_spike_signal +
        0.15 * divergence_signal +
        0.10 * alignment_signal +
        0.20 * stablecoin_signal  # NEW
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
        direction=direction,
        stablecoin_context=stablecoin_state.flow_ratio
    )
```

---

## 8. Deviation Bands and Regime Detection

### 8.1 Dynamic Standard Deviation Bands

Standard deviation bands around True Price expand and contract based on regime AND stablecoin dynamics:

```python
def compute_deviation_bands(true_price, true_price_std, regime, stablecoin_state):
    """
    Compute dynamic standard deviation bands.

    Bands widen during:
      - High leverage regimes
      - Liquidation cascades
      - Low orderbook quality periods
      - USDT-dominant periods (NEW)

    Bands tighten during:
      - Low leverage, stable markets
      - High orderbook quality
      - USDC-dominant periods (NEW)
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
        regime_mult = 2.0
    elif regime == 'high_leverage':
        regime_mult = 1.5
    elif regime == 'manipulation':
        regime_mult = 1.75
    elif regime == 'normal':
        regime_mult = 1.0
    else:  # 'low_volatility' or 'trend'
        regime_mult = 0.8

    # Stablecoin adjustment (NEW)
    if stablecoin_state.flow_ratio.usdt_dominant:
        stablecoin_mult = 1.3  # Widen bands by 30%
    elif stablecoin_state.flow_ratio.usdc_dominant:
        stablecoin_mult = 0.85  # Tighten bands by 15%
    else:
        stablecoin_mult = 1.0

    combined_mult = regime_mult * stablecoin_mult

    bands = {}
    for name, mult in base_multipliers.items():
        adjusted_mult = mult * combined_mult
        bands[name] = {
            'upper': true_price + adjusted_mult * true_price_std,
            'lower': true_price - adjusted_mult * true_price_std
        }

    return bands
```

### 8.2 Regime Classification with Stablecoin Signals

```python
class RegimeClassifier:
    """
    Classify current market regime using stablecoin flow signals.

    Regimes:
      - 'trend': USDC-dominant, genuine price discovery
      - 'low_volatility': Stable, low leverage, tight bands
      - 'normal': Typical conditions
      - 'high_leverage': Elevated leverage but no cascade
      - 'manipulation': USDT-dominant, leverage-driven
      - 'cascade': Active liquidation cascade
    """

    def classify(self, leverage_stress, cascade_detection, orderbook_quality,
                 volatility_regime, stablecoin_state):
        """
        Classify current regime incorporating stablecoin signals.
        """
        # Priority-based classification

        # 1. Check for cascade (highest priority)
        if cascade_detection.is_cascade:
            return Regime('cascade', confidence=cascade_detection.confidence)

        # 2. Check stablecoin-based manipulation signal (NEW)
        if stablecoin_state.flow_ratio.manipulation_probability > 0.7:
            return Regime('manipulation',
                         confidence=stablecoin_state.flow_ratio.manipulation_probability)

        # 3. Check for USDC-confirmed trend (NEW)
        if (stablecoin_state.usdc_impact.regime_signal.label == 'TREND' and
            stablecoin_state.flow_ratio.usdc_dominant):
            return Regime('trend',
                         confidence=stablecoin_state.usdc_impact.regime_signal.confidence)

        # 4. Check leverage level
        if leverage_stress.score > 0.7:
            return Regime('high_leverage', confidence=leverage_stress.score)

        # 5. Check volatility
        if volatility_regime.annualized < 0.2:
            return Regime('low_volatility', confidence=1 - volatility_regime.annualized / 0.2)

        # 6. Default to normal
        return Regime('normal', confidence=0.8)

    def get_regime_dependent_parameters(self, regime):
        """
        Return regime-specific model parameters.
        """
        params = {
            'trend': {  # NEW regime
                'process_noise_mult': 1.2,  # Allow True Price to drift
                'observation_noise_mult': 0.8,  # Trust observations more
                'band_mult': 0.85,
                'reversion_speed': 'slow'  # Don't expect reversion in trends
            },
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
            'manipulation': {  # USDT-dominant
                'process_noise_mult': 0.3,  # True Price very stable
                'observation_noise_mult': 3.0,  # Don't trust spot
                'band_mult': 1.5,
                'reversion_speed': 'fast'  # Expect reversion
            },
            'cascade': {
                'process_noise_mult': 0.5,
                'observation_noise_mult': 5.0,
                'band_mult': 2.0,
                'reversion_speed': 'fast'
            }
        }
        return params.get(regime.name, params['normal'])
```

### 8.3 Manipulation Probability with Stablecoin Context

```python
def compute_manipulation_probability(deviation_zscore, regime, leverage_stress, stablecoin_state):
    """
    Estimate probability that current price deviation is manipulation-driven.

    Stablecoin context is critical:
      - Same deviation with USDT-dominant flows = high manipulation probability
      - Same deviation with USDC-dominant flows = lower manipulation probability

    Higher probability when:
      - Deviation is large (> 2 sigma)
      - Regime indicates stress
      - Leverage is elevated
      - Move happened quickly
      - USDT flows are elevated (NEW)
    """
    # Base probability from z-score
    z0 = 2.0
    k = 2.0
    base_prob = 1 / (1 + np.exp(-k * (abs(deviation_zscore) - z0)))

    # Regime adjustment
    regime_multipliers = {
        'cascade': 1.5,
        'manipulation': 1.8,
        'high_leverage': 1.3,
        'normal': 1.0,
        'low_volatility': 0.7,
        'trend': 0.5  # NEW: trends are less likely manipulation
    }
    regime_mult = regime_multipliers.get(regime.name, 1.0)

    # Leverage stress adjustment
    stress_mult = 1 + leverage_stress.score * 0.5

    # Stablecoin adjustment (NEW - key innovation)
    stablecoin_mult = 1.0
    if stablecoin_state.flow_ratio.usdt_dominant:
        # USDT-dominant: much more likely manipulation
        stablecoin_mult = 1.5
    elif stablecoin_state.flow_ratio.usdc_dominant:
        # USDC-dominant: less likely manipulation
        stablecoin_mult = 0.6

    # Final probability (capped at 0.95)
    manipulation_prob = min(0.95, base_prob * regime_mult * stress_mult * stablecoin_mult)

    return manipulation_prob
```

---

## 9. Liquidation Cascade Identification

### 9.1 Pre-Cascade Indicators

```python
def compute_precascade_risk(leverage_state, price_data, orderbook, stablecoin_state):
    """
    Compute probability that a liquidation cascade is imminent.
    Incorporates stablecoin context for better prediction.

    Warning signs:
      1. Price approaching major liquidation cluster
      2. Funding rate extreme (crowded positioning)
      3. OI at local high
      4. Orderbook thin near liquidation levels
      5. Recent large USDT inflows to derivatives venues (NEW)
    """
    # Existing indicators...
    proximity_risk = compute_liquidation_proximity_risk(leverage_state, price_data)
    funding_risk = compute_funding_extremity_risk(leverage_state)
    oi_risk = compute_oi_risk(leverage_state)
    thinness_risk = compute_orderbook_thinness_risk(orderbook, leverage_state)

    # NEW: USDT flow risk
    # Large USDT flows to derivatives = ammunition for cascade
    usdt_derivatives_flow = stablecoin_state.usdt_flow_data.derivatives_exchange_flow_24h
    typical_flow = stablecoin_state.usdt_flow_data.typical_derivatives_flow
    usdt_risk = min(1, usdt_derivatives_flow / (typical_flow * 3))  # Risk at 3x typical

    # Combine
    precascade_risk = (
        0.30 * proximity_risk +
        0.20 * funding_risk +
        0.15 * oi_risk +
        0.15 * thinness_risk +
        0.20 * usdt_risk  # NEW: significant weight
    )

    return PrecascadeRisk(
        total=precascade_risk,
        proximity=proximity_risk,
        funding=funding_risk,
        oi=oi_risk,
        thinness=thinness_risk,
        usdt=usdt_risk,
        stablecoin_context=stablecoin_state.flow_ratio
    )
```

### 9.2 Real vs. Fake Price Movement Classification

```python
def classify_price_movement(price_data, leverage_state, onchain_data, news_data, stablecoin_state):
    """
    Classify whether a price movement is organic or manipulation-driven.
    Stablecoin context is now a primary signal.

    Real (organic) movement:
      - Spot volume proportional to price change
      - No liquidation spike
      - On-chain flow supports direction
      - Fundamental news present
      - USDC-dominant stablecoin flows (NEW)

    Fake (manipulation) movement:
      - Derivatives volume >> spot volume
      - Liquidation cascade signature
      - On-chain flow contradicts price
      - No fundamental news
      - USDT-dominant stablecoin flows (NEW)
    """
    scores = {}

    # Existing factors...
    scores['spot_dominance'] = compute_spot_ratio(price_data, leverage_state)
    scores['proportionality'] = compute_volume_proportionality(price_data)
    scores['non_liquidation'] = compute_non_liquidation_ratio(leverage_state, price_data)
    scores['onchain_alignment'] = compute_onchain_alignment(onchain_data, price_data)
    scores['news_presence'] = news_data.relevance_score

    # NEW: Stablecoin context (major factor)
    if stablecoin_state.flow_ratio.usdc_dominant:
        scores['stablecoin_organic'] = 0.8 + 0.2 * stablecoin_state.flow_ratio.ratio
    elif stablecoin_state.flow_ratio.usdt_dominant:
        scores['stablecoin_organic'] = 0.2 * (1 / stablecoin_state.flow_ratio.ratio)
    else:
        scores['stablecoin_organic'] = 0.5

    # Aggregate with stablecoin as significant factor
    organic_score = (
        0.15 * scores['spot_dominance'] +
        0.15 * scores['proportionality'] +
        0.20 * scores['non_liquidation'] +
        0.10 * scores['onchain_alignment'] +
        0.10 * scores['news_presence'] +
        0.30 * scores['stablecoin_organic']  # NEW: 30% weight
    )

    classification = 'organic' if organic_score > 0.5 else 'manipulation'

    return MovementClassification(
        classification=classification,
        organic_score=organic_score,
        manipulation_score=1 - organic_score,
        factor_scores=scores,
        stablecoin_context=stablecoin_state.flow_ratio
    )
```

---

## 10. Signal Generation Framework

### 10.1 Trading Distance from Equilibrium

The core trading thesis: **trade mean-reversion when spot deviates from True Price**, but adjust expectations based on stablecoin context.

```python
class TruePriceSignalGenerator:
    """
    Generate trading signals based on deviation from True Price.
    Now incorporates stablecoin context for signal confidence.

    Key principles:
      - Trade DISTANCE FROM EQUILIBRIUM, not direction
      - USDT-dominant deviations = higher reversion probability
      - USDC-dominant deviations = lower reversion probability (may be trend)
    """

    def generate_signal(self, true_price_estimate, regime, leverage_stress, stablecoin_state):
        """
        Generate trading signal based on current state.
        """
        z = true_price_estimate.deviation_zscore
        spot = true_price_estimate.spot_median
        true_p = true_price_estimate.price

        # No signal in small deviations
        if abs(z) < self.config.min_zscore_threshold:
            return Signal(type='NEUTRAL', confidence=0)

        # Compute manipulation probability (includes stablecoin context)
        manip_prob = compute_manipulation_probability(z, regime, leverage_stress, stablecoin_state)

        # Reversion probability depends on manipulation probability AND stablecoin context
        if stablecoin_state.flow_ratio.usdt_dominant:
            # USDT-dominant: high reversion probability
            reversion_prob = 0.6 + 0.35 * manip_prob  # Range: 0.6 to 0.95
        elif stablecoin_state.flow_ratio.usdc_dominant:
            # USDC-dominant: lower reversion probability (may be trend)
            reversion_prob = 0.3 + 0.3 * manip_prob  # Range: 0.3 to 0.6
        else:
            # Mixed: standard calculation
            reversion_prob = 0.5 + 0.4 * manip_prob  # Range: 0.5 to 0.9

        # Adjust for regime
        regime_adjustments = {
            'cascade': 0.1,
            'manipulation': 0.1,
            'high_leverage': 0.05,
            'normal': 0,
            'low_volatility': -0.1,
            'trend': -0.2  # NEW: trends don't revert quickly
        }
        reversion_prob += regime_adjustments.get(regime.name, 0)
        reversion_prob = max(0.2, min(0.95, reversion_prob))

        # Direction: opposite of deviation
        if z > 0:
            direction = 'SHORT'
        else:
            direction = 'LONG'

        # Confidence scales with z-score AND stablecoin clarity
        base_confidence = min(0.95, 0.5 + 0.1 * (abs(z) - 1.5))
        stablecoin_clarity = abs(stablecoin_state.flow_ratio.ratio - 1)  # Clearer signal when ratio != 1
        confidence = base_confidence * (1 + 0.1 * min(stablecoin_clarity, 3))
        confidence = min(0.95, confidence)

        # Compute targets
        targets = self.compute_reversion_targets(spot, true_p, z, regime, stablecoin_state)

        # Compute timeframe
        timeframe = self.estimate_reversion_timeframe(z, regime, stablecoin_state)

        # Compute stop loss
        stop_loss = self.compute_stop_loss(spot, z, regime, stablecoin_state)

        return Signal(
            type=direction,
            confidence=confidence,
            reversion_probability=reversion_prob,
            manipulation_probability=manip_prob,
            targets=targets,
            timeframe=timeframe,
            stop_loss=stop_loss,
            zscore=z,
            regime=regime.name,
            stablecoin_context={
                'ratio': stablecoin_state.flow_ratio.ratio,
                'usdt_dominant': stablecoin_state.flow_ratio.usdt_dominant,
                'usdc_dominant': stablecoin_state.flow_ratio.usdc_dominant
            }
        )

    def compute_reversion_targets(self, spot, true_price, z, regime, stablecoin_state):
        """
        Compute probabilistic reversion targets.
        Adjust probabilities based on stablecoin context.
        """
        deviation = spot - true_price
        targets = []

        # Base probabilities
        if stablecoin_state.flow_ratio.usdt_dominant:
            # USDT-dominant: higher reversion probabilities
            prob_mult = 1.2
        elif stablecoin_state.flow_ratio.usdc_dominant:
            # USDC-dominant: lower reversion probabilities
            prob_mult = 0.7
        else:
            prob_mult = 1.0

        # Target 1: 50% reversion
        t1_price = spot - 0.5 * deviation
        t1_prob = min(0.95, 0.70 * prob_mult)
        targets.append(Target(price=t1_price, probability=t1_prob, label='T1_50%'))

        # Target 2: 75% reversion
        t2_price = spot - 0.75 * deviation
        t2_prob = min(0.80, 0.50 * prob_mult)
        targets.append(Target(price=t2_price, probability=t2_prob, label='T2_75%'))

        # Target 3: Full reversion to True Price
        t3_prob = min(0.60, 0.35 * prob_mult)
        targets.append(Target(price=true_price, probability=t3_prob, label='T3_Full'))

        # Target 4: Overshoot (more likely in cascade/manipulation)
        overshoot = true_price - 0.25 * deviation
        t4_prob = min(0.30, 0.15 * prob_mult)
        targets.append(Target(price=overshoot, probability=t4_prob, label='T4_Overshoot'))

        return targets

    def estimate_reversion_timeframe(self, z, regime, stablecoin_state):
        """
        Estimate how quickly reversion will occur.
        USDT-dominant = faster reversion (manipulation resolves quickly)
        USDC-dominant = slower or no reversion (may be trend)
        """
        base_hours = 4

        zscore_mult = max(0.5, 2 - abs(z) * 0.3)

        regime_mults = {
            'cascade': 0.25,
            'manipulation': 0.5,
            'high_leverage': 0.75,
            'normal': 1.0,
            'low_volatility': 1.5,
            'trend': 3.0  # NEW: trends don't revert quickly
        }
        regime_mult = regime_mults.get(regime.name, 1.0)

        # Stablecoin adjustment (NEW)
        if stablecoin_state.flow_ratio.usdt_dominant:
            stablecoin_mult = 0.7  # Faster reversion
        elif stablecoin_state.flow_ratio.usdc_dominant:
            stablecoin_mult = 1.5  # Slower reversion
        else:
            stablecoin_mult = 1.0

        hours = base_hours * zscore_mult * regime_mult * stablecoin_mult

        return Timeframe(
            expected_hours=hours,
            range_hours=(hours * 0.5, hours * 2),
            confidence=0.7
        )
```

### 10.2 Signal Examples

**Example 1: USDT-Dominant Liquidation Cascade**

```
Current State:
  True Price:     $30,000
  Spot (median):  $28,200
  Deviation:      -6% (-3.8σ)
  Regime:         cascade

Stablecoin Context:
  USDT/USDC Ratio: 4.2 (USDT-dominant)
  USDT 24h Flow:   $800M to derivatives
  USDC 24h Flow:   $150M to spot

Signal Generated:
  Type:           LONG (expect reversion)
  Confidence:     0.91
  Manipulation P: 0.94
  Reversion P:    0.92

  Targets:
    T1 (50%): $29,100 - Probability 0.84
    T2 (75%): $29,550 - Probability 0.65
    T3 (Full): $30,000 - Probability 0.48
    T4 (Overshoot): $30,450 - Probability 0.22

  Timeframe: 0.5-2 hours (fast reversion expected)
  Stop Loss: $27,500

  Note: High confidence due to USDT-dominant conditions
        indicating leverage-driven manipulation
```

**Example 2: USDC-Dominant Trend**

```
Current State:
  True Price:     $30,000
  Spot (median):  $32,500
  Deviation:      +8.3% (+2.5σ)
  Regime:         trend

Stablecoin Context:
  USDT/USDC Ratio: 0.4 (USDC-dominant)
  USDT 24h Flow:   $200M (mixed)
  USDC 24h Flow:   $500M to spot/custody

Signal Generated:
  Type:           SHORT (against trend)
  Confidence:     0.45 (LOW)
  Manipulation P: 0.35
  Reversion P:    0.42

  Targets:
    T1 (50%): $31,250 - Probability 0.40
    T2 (75%): $30,625 - Probability 0.28
    T3 (Full): $30,000 - Probability 0.18

  Timeframe: 6-12 hours (slow if at all)
  Stop Loss: $33,800

  WARNING: USDC-dominant conditions suggest genuine trend.
           Consider NOT trading against this deviation.
           True Price may need to adjust upward.
```

---

## 11. Bad Actor Neutralization

### 11.1 Why This Framework Reduces Manipulation Advantage

The True Price framework doesn't moralize about "bad actors"—it mechanically reduces their advantage:

**Information Asymmetry Reduction**

```
Traditional:
  Dominant actor sees:
    - Order flow across venues
    - Liquidation levels
    - Stop loss clusters
    - Stablecoin flows (mints they control)
  Advantage: Trade ahead of forced flows

True Price Framework:
  - Forced flows identified and discounted
  - Stablecoin flows classified and incorporated
  - USDT flows flagged as volatility signal, not capital
  - True Price doesn't move with manipulation
  - Dominant actor's information advantage neutralized
```

**Stablecoin Visibility Neutralization (NEW)**

```
Traditional manipulation:
  1. Mint USDT
  2. Flow to Binance
  3. Enable massive leverage
  4. Push price to liquidation level
  5. Cascade triggers
  6. Buy the dip
  7. Price recovers
  8. Profit

With True Price + Stablecoin Analysis:
  1. USDT mint detected
  2. Flow to derivatives flagged
  3. Model increases observation noise (don't trust spot)
  4. True Price doesn't follow manipulation
  5. Counter-traders see USDT-dominant regime
  6. Counter-traders front-run the recovery
  7. Manipulation becomes negative EV
```

### 11.2 Mechanical Focus, Not Moral Judgment

The framework makes no moral claims about USDT or USDC. It simply:

1. **Observes** that USDT flows correlate with leverage enablement
2. **Observes** that USDC flows correlate with spot capital
3. **Models** these correlations mathematically
4. **Adjusts** confidence based on observable behavior

If USDT becomes used primarily for spot trading, the model will adapt. If USDC becomes used for leverage, the model will adapt. The framework follows mechanics, not narratives.

### 11.3 Incentive Realignment

```
Old Equilibrium:
  USDT mint → Leverage → Manipulation → Profit
  Regular trader → Liquidated → Loss

New Equilibrium (with True Price + Stablecoin Analysis):
  USDT mint → Detected as leverage enablement
  Manipulation attempt → True Price stable, regime flagged
  Counter-traders → Trade reversion → Profit
  Manipulator → Counter-traded → Loss

Result:
  Manipulation becomes unprofitable
  Rational actors stop manipulating
  Price converges to True Price
```

---

## 12. Integration with VibeSwap

### 12.1 Oracle Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRUE PRICE ORACLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │   Kalman   │  │ Stablecoin │  │  Regime    │               │
│  │   Filter   │◄─┤  Analyzer  │──┤ Classifier │               │
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
│  │  - Stablecoin context (USDT/USDC ratio)     │              │
│  │  - Reversion signal                          │              │
│  └─────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 Stablecoin-Aware Circuit Breaker

```python
def should_trigger_circuit_breaker(true_price_estimate, stablecoin_state):
    """
    Enhanced circuit breaker with stablecoin context.
    """
    z = abs(true_price_estimate.deviation_zscore)
    regime = true_price_estimate.regime

    # Base thresholds
    if regime.name == 'cascade':
        threshold = 2.0  # Stricter during cascade
    elif regime.name == 'manipulation':
        threshold = 2.5
    else:
        threshold = 3.0

    # Stablecoin adjustment
    if stablecoin_state.flow_ratio.usdt_dominant:
        # USDT-dominant: be more conservative
        threshold *= 0.8  # Lower threshold = trigger earlier
    elif stablecoin_state.flow_ratio.usdc_dominant:
        # USDC-dominant: may be genuine trend
        threshold *= 1.2  # Higher threshold = more tolerant

    if z > threshold:
        return CircuitBreakerDecision(
            trigger=True,
            reason=f"Deviation {z:.1f}σ exceeds threshold {threshold:.1f}σ",
            stablecoin_context=stablecoin_state.flow_ratio,
            recommended_action="Pause trading, wait for stabilization"
        )

    return CircuitBreakerDecision(trigger=False)
```

---

## 13. Extensions and Future Work

### 13.1 Stablecoin Flow Machine Learning

```python
class StablecoinFlowPredictor:
    """
    ML model to predict stablecoin flow impact on price.
    """

    def __init__(self):
        self.model = GradientBoostingRegressor()
        self.features = [
            'usdt_mint_volume',
            'usdc_mint_volume',
            'usdt_derivatives_ratio',
            'usdc_spot_ratio',
            'oi_change_lag1',
            'funding_rate',
            'price_return_lag1',
            'volatility_regime',
        ]

    def predict_price_impact(self, stablecoin_data, leverage_data):
        """
        Predict expected price impact of current stablecoin flows.
        """
        X = self.extract_features(stablecoin_data, leverage_data)
        return self.model.predict(X)

    def train(self, historical_data):
        """
        Train on historical stablecoin flows and subsequent price moves.
        """
        X = self.extract_features(historical_data)
        y = historical_data.price_return_next_24h
        self.model.fit(X, y)
```

### 13.2 True Price Index with Stablecoin Adjustment

```
TRUE PRICE INDEX (TPI) v2.0:

Definition:
  TPI(t) = True_Price(t) / True_Price(0) × 100

Stablecoin-Adjusted TPI:
  TPI_adj(t) = TPI(t) × (1 + stablecoin_confidence_adjustment(t))

Where:
  stablecoin_confidence_adjustment =
    +0.05 if USDC-dominant (higher confidence)
    -0.05 if USDT-dominant (lower confidence)
    0 otherwise
```

### 13.3 Cross-Stablecoin Regime Indicator

```python
def compute_stablecoin_regime_indicator():
    """
    A single metric summarizing stablecoin market structure.

    Range: -1 (fully USDT-dominant, manipulation likely)
           +1 (fully USDC-dominant, trend likely)
    """
    usdt_score = normalize(usdt_flow, typical_usdt)
    usdc_score = normalize(usdc_flow, typical_usdc)

    indicator = (usdc_score - usdt_score) / (usdc_score + usdt_score + 1e-10)

    return StablecoinRegimeIndicator(
        value=indicator,
        interpretation='MANIPULATION_LIKELY' if indicator < -0.3 else
                       'TREND_LIKELY' if indicator > 0.3 else
                       'NEUTRAL'
    )
```

---

## 14. Conclusion

### 14.1 Summary

This paper has presented a rigorous framework for **True Price** estimation that explicitly incorporates **stablecoin flow dynamics**:

1. **Definition**: True Price is the Bayesian posterior estimate of equilibrium price, filtering out leverage-driven distortions and stablecoin-enabled manipulation.

2. **Asymmetric Stablecoin Treatment**: USDT flows are modeled as leverage-enabling and volatility-amplifying. USDC flows are modeled as capital-confirming and trend-validating. This distinction is critical.

3. **Model**: A state-space model with Kalman filtering, where observation noise increases during USDT-dominant periods and decreases during USDC-dominant periods.

4. **Regimes**: Dynamic classification now includes 'trend' (USDC-dominant) and 'manipulation' (USDT-dominant) as distinct regimes.

5. **Signals**: Trading signals adjust reversion probability based on stablecoin context. USDT-dominant deviations have higher reversion probability; USDC-dominant deviations may be genuine trends.

### 14.2 Key Innovations

| Innovation | Benefit |
|------------|---------|
| Asymmetric stablecoin treatment | Distinguishes capital from leverage |
| USDT as volatility signal | Increases observation noise appropriately |
| USDC as trend confirmation | Validates slow True Price drift |
| Stablecoin flow classification | Separates inventory/leverage/capital |
| Regime-dependent signal generation | Avoids trading against genuine trends |
| Manipulation probability adjustment | More accurate under USDT-dominant conditions |

### 14.3 Why USDT and USDC Must Never Be Treated Symmetrically

The empirical reality is clear:

- USDT flows to derivatives venues and correlates with OI increases
- USDC flows to spot venues and correlates with genuine capital movement

Treating them symmetrically would be like treating margin debt and cash deposits as equivalent—they're not. The True Price framework respects this distinction mathematically.

### 14.4 The Bigger Picture

This framework transforms stablecoin flows from a manipulation tool into a transparency signal:

- When USDT dominates, we know to distrust spot prices
- When USDC dominates, we know to trust the trend
- The information that dominant actors use to manipulate becomes the information that neutralizes their advantage

Markets can be fair. Manipulation can be detected. True prices can emerge.

We just have to model the mechanics correctly.

---

## Appendix A: Kalman Filter Mathematics

### State-Space Representation

```
State equation:
  x(t) = F × x(t-1) + w(t),    w(t) ~ N(0, Q(t))

Observation equation:
  y(t) = H × x(t) + v(t),      v(t) ~ N(0, R(t))

Key: Both Q(t) and R(t) are now TIME-VARYING based on stablecoin dynamics
```

### Stablecoin-Adjusted Covariances

```
R(t) = R_base × leverage_mult(t) × usdt_mult(t) × usdc_adj(t)

Where:
  usdt_mult(t) = 1 + 0.5 × usdt_flow_normalized(t)  # Range: 1.0 to 3.0
  usdc_adj(t) = 0.9 if USDC-dominant else 1.0       # 10% reduction if USDC

Q(t) = Q_base × trend_mult(t)

Where:
  trend_mult(t) = 1.2 if USDC-confirmed trend else 1.0
```

---

## Appendix B: Stablecoin Data Sources

| Source | Data Available | Update Frequency |
|--------|----------------|------------------|
| Tether Treasury | USDT mints/burns | Real-time (on-chain) |
| Circle API | USDC mints/burns | Real-time (on-chain) |
| Glassnode | Stablecoin exchange flows | Hourly |
| CryptoQuant | Stablecoin exchange reserves | Real-time |
| DefiLlama | Stablecoin market caps | Real-time |
| Arkham | Stablecoin flow destinations | Real-time |

---

## Appendix C: Parameter Recommendations

| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| USDT volatility multiplier range | 1.0 - 3.0 | Based on flow intensity |
| USDC confidence adjustment | +/- 10% | When dominant |
| Flow ratio manipulation threshold | > 2.0 | USDT/USDC ratio |
| Flow ratio trend threshold | < 0.5 | USDT/USDC ratio |
| USDT classification: leverage | > 60% to derivatives | Destination-based |
| USDC classification: capital | > 60% to spot/custody | Destination-based |

---

*"The market can stay irrational longer than you can stay solvent."*
*— John Maynard Keynes*

*"Unless you can see which stablecoins are fueling the irrationality."*
*— True Price Oracle v2.0*

---

**VibeSwap** - True Prices Through Stablecoin-Aware Estimation

---

**Document Version**: 2.0
**Date**: February 2026
**Major Update**: Stablecoin Flow Dynamics (USDT vs USDC asymmetric treatment)
**License**: MIT
