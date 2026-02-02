# VibeSwap Incentives Whitepaper

## Fair Rewards Through Cooperative Game Theory

**Version 1.0 | February 2026**

---

## Abstract

VibeSwap introduces a novel incentive architecture that combines cooperative game theory with practical DeFi economics. Rather than simple pro-rata reward distribution, VibeSwap employs Shapley value calculations to fairly compensate liquidity providers based on their *marginal contribution* to the system. This is complemented by a comprehensive risk management suite including tiered Impermanent Loss protection, loyalty multipliers, slippage guarantees, and volatility-based insurance.

This whitepaper details the mathematical foundations, implementation mechanics, and game-theoretic properties of VibeSwap's five interconnected incentive systems.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Shapley Value Distribution](#2-shapley-value-distribution)
3. [Impermanent Loss Protection](#3-impermanent-loss-protection)
4. [Loyalty Rewards System](#4-loyalty-rewards-system)
5. [Slippage Guarantee Fund](#5-slippage-guarantee-fund)
6. [Volatility Insurance Pool](#6-volatility-insurance-pool)
7. [Dynamic Fee Architecture](#7-dynamic-fee-architecture)
8. [Game Theory Analysis](#8-game-theory-analysis)
9. [Conclusion](#9-conclusion)

---

## 1. Introduction

### 1.1 The Problem with Pro-Rata Distribution

Traditional AMMs distribute trading fees proportionally to liquidity share. While simple, this approach fails to recognize that not all liquidity is equally valuable:

- **Timing matters**: Liquidity provided during high-volume periods generates more value
- **Balance matters**: The scarce side of an imbalanced pool enables more trades
- **Commitment matters**: Long-term liquidity provides stability; mercenary capital extracts value

### 1.2 VibeSwap's Approach

VibeSwap addresses these limitations through five integrated systems:

| System | Purpose |
|--------|---------|
| **Shapley Distribution** | Fair rewards based on marginal contribution |
| **IL Protection** | Tiered coverage against price divergence |
| **Loyalty Rewards** | Time-weighted multipliers for commitment |
| **Slippage Guarantee** | Trader protection against execution shortfall |
| **Volatility Insurance** | Circuit-breaker triggered LP coverage |

All systems are coordinated through the `IncentiveController`, which routes fees and manages lifecycle events.

---

## 2. Shapley Value Distribution

### 2.1 Theoretical Foundation

The Shapley value, from cooperative game theory, provides the unique distribution satisfying four fairness axioms:

1. **Efficiency**: All generated value is distributed
2. **Symmetry**: Equal contributors receive equal rewards
3. **Null Player**: Zero contribution yields zero reward
4. **Additivity**: Consistent across combined games

For a cooperative game (N, v) where N is the set of participants and v(S) is the value of coalition S, the Shapley value for participant i is:

```
φᵢ(v) = Σ [|S|!(|N|-|S|-1)! / |N|!] × [v(S ∪ {i}) - v(S)]
```

This measures the average marginal contribution of participant i across all possible orderings.

### 2.2 Practical Implementation

Computing exact Shapley values is O(2^n), impractical on-chain. VibeSwap uses a weighted approximation that is O(n):

```
weightedContribution(i) =
    directContribution × 40%
  + timeScore × 30%
  + scarcityScore × 20%
  + stabilityScore × 10%
```

#### Direct Contribution (40%)
Raw liquidity or volume provided. The baseline measure of participation.

#### Time Score (30%)
Logarithmic scaling rewards long-term commitment with diminishing returns:

```
timeScore = log₂(daysInPool + 1) × 0.1
```

| Duration | Multiplier |
|----------|------------|
| 1 day | 1.0x |
| 7 days | 1.9x |
| 30 days | 2.7x |
| 365 days | 4.2x |

#### Scarcity Score (20%)
Implements the "glove game" principle: value comes from complementary contributions.

In an 80% buy / 20% sell batch:
- Sellers are scarce and receive bonus scoring
- Buyers on the abundant side receive reduced scoring
- Major contributors to the scarce side get additional bonus

#### Stability Score (10%)
Rewards presence during volatile periods when liquidity is most valuable.

### 2.3 The Glove Game Analogy

Consider the classic glove game: left gloves are worthless alone, right gloves are worthless alone, but a pair has value. The Shapley value recognizes that both sides contribute equally to creating value.

In VibeSwap's batch auctions:
- A pool with 100 ETH of buys and 0 sells executes nothing
- Adding 50 ETH of sells enables 50 ETH of matched volume
- The scarce sell-side deserves recognition beyond raw proportion

### 2.4 Distribution Flow

```
Batch Settlement
      ↓
Create Shapley Game (gameId, totalFees, participants[])
      ↓
Compute Weighted Contributions
      ↓
Distribute Proportionally to Weights
      ↓
LPs Claim Individual Rewards
```

---

## 3. Impermanent Loss Protection

### 3.1 Understanding Impermanent Loss

When providing liquidity to an AMM, price divergence between deposited assets creates "impermanent loss" - the opportunity cost versus simply holding the assets.

The IL formula:

```
IL = 2√(priceRatio) / (1 + priceRatio) - 1
```

| Price Change | Impermanent Loss |
|--------------|------------------|
| 1.25x | 0.6% |
| 1.5x | 2.0% |
| 2x | 5.7% |
| 3x | 13.4% |
| 5x | 25.5% |

### 3.2 Tiered Protection Model

Rather than unsustainable full coverage, VibeSwap offers tiered partial protection:

| Tier | Coverage | Minimum Duration |
|------|----------|------------------|
| Basic | 25% | 0 days |
| Standard | 50% | 30 days |
| Premium | 80% | 90 days |

**Example**: An LP experiences 10% IL after 90 days in Premium tier:
- Eligible compensation: 10% × 80% = 8% of position value
- LP still absorbs 2% loss (skin in the game)

### 3.3 Position Lifecycle

1. **Registration**: On liquidity addition, entry price is recorded
2. **Accrual**: IL tracked continuously against entry price
3. **Closure**: On removal, exit price determines final IL
4. **Claiming**: If minimum duration met, claim coverage from reserves

### 3.4 Sustainability

The tiered model ensures sustainability:
- Partial coverage keeps claims manageable
- Longer locks reduce claim frequency
- Reserve-based funding with emergency circuit breaker

---

## 4. Loyalty Rewards System

### 4.1 Time-Weighted Multipliers

Loyalty rewards incentivize long-term capital commitment through escalating multipliers:

| Tier | Duration | Multiplier | Early Exit Penalty |
|------|----------|------------|-------------------|
| Bronze | 7+ days | 1.0x | 5% |
| Silver | 30+ days | 1.25x | 3% |
| Gold | 90+ days | 1.5x | 1% |
| Platinum | 365+ days | 2.0x | 0% |

### 4.2 Reward Mechanics

The system uses standard staking mechanics with accumulated reward tracking:

```
pendingRewards = (liquidity × rewardPerShare) - rewardDebt
claimableAmount = pendingRewards × tierMultiplier
```

Tier is determined by *continuous* stake duration, not cumulative history. Unstaking resets the timer.

### 4.3 Early Exit Penalties

Penalties create commitment and redistribute to patient capital:

```
Early Exit Flow:
  LP unstakes before tier threshold
       ↓
  Penalty calculated (e.g., 3% for Silver tier)
       ↓
  Split: 30% to Treasury, 70% to remaining stakers
       ↓
  70% added to reward pool as bonus
```

This creates positive-sum dynamics: early exits benefit long-term stakers.

### 4.4 Anti-Gaming Properties

- **Continuous duration**: Can't accumulate time across multiple stakes
- **Penalty on partial unstakes**: No free option to test the waters
- **Multiplier on claim**: Must maintain tier status through claim

---

## 5. Slippage Guarantee Fund

### 5.1 Trader Protection

The Slippage Guarantee Fund protects traders against execution shortfall - when actual output is less than expected minimum.

### 5.2 Claim Generation

Claims are automatically created when:

```
actualOutput < expectedOutput
AND
shortfallBps >= 50 (0.5% minimum)
```

### 5.3 Limits and Constraints

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Minimum Shortfall | 0.5% | Filter trivial claims |
| Maximum Per Claim | 2% of expected | Cap exposure |
| Daily User Limit | 1 token unit | Prevent abuse |
| Claim Window | 1 hour | Timely claiming |

### 5.4 Fund Management

The fund is capitalized by protocol revenue and maintains reserves per token. Claims are processed first-come-first-served subject to available reserves.

---

## 6. Volatility Insurance Pool

### 6.1 Dynamic Premium Collection

During high volatility, dynamic fees increase. The excess above base fees flows to the insurance pool:

```
Base Fee: 0.30%
Volatility Tier: EXTREME (2.0x multiplier)
Execution Fee: 0.60%
Insurance Premium: 0.30% (the excess)
```

### 6.2 Volatility Tiers

| Tier | Annualized Volatility | Fee Multiplier |
|------|----------------------|----------------|
| LOW | 0-20% | 1.0x |
| MEDIUM | 20-50% | 1.25x |
| HIGH | 50-100% | 1.5x |
| EXTREME | >100% | 2.0x |

### 6.3 Claim Triggering

Insurance claims are triggered when:
1. Circuit breaker activates due to extreme price movement
2. Volatility tier is EXTREME
3. 24-hour cooldown has passed since last claim

### 6.4 Distribution

Claims are distributed pro-rata to LPs based on their covered liquidity:

```
lpShare = (totalPayout × lpLiquidity) / totalCoveredLiquidity
```

Maximum payout per event is capped at 50% of reserves to prevent fund depletion.

---

## 7. Dynamic Fee Architecture

### 7.1 Base Fee Structure

```
Trading Fee: 0.30% (30 bps)
  ├── 80% → LP Pool Reserves
  └── 20% → Protocol Treasury
```

### 7.2 Volatility Adjustment

The VolatilityOracle monitors realized volatility using a rolling window of price observations:

- **Observation interval**: 5 minutes
- **Window size**: 24 observations (~2 hours)
- **Calculation**: Variance of log returns, annualized

### 7.3 Fee Routing

```
Total Dynamic Fee
      ↓
  ├── Base portion (0.30%) → Standard LP/Treasury split
  └── Excess portion → Volatility Insurance Pool
```

### 7.4 Auction Proceeds

Commit-reveal batch auction proceeds (from priority bids) are distributed 100% to LPs, routed through the Shapley distribution system when enabled.

---

## 8. Game Theory Analysis

### 8.1 Incentive Alignment

| Actor | Incentive | Mechanism |
|-------|-----------|-----------|
| Short-term LP | Provide liquidity when scarce | Scarcity scoring |
| Long-term LP | Maintain position | Loyalty multipliers |
| Trader | Use VibeSwap | Slippage protection |
| Protocol | Sustainable growth | Fee routing |

### 8.2 Anti-Gaming Properties

**Shapley Distribution**:
- Sybil attacks dilute scarcity scores
- Quality weighting penalizes reputation farming
- Event-based games prevent manipulation

**Loyalty System**:
- Continuous duration prevents timer gaming
- Early exit penalties create real commitment cost
- Penalty redistribution rewards patience

**Insurance Systems**:
- Reserve caps prevent depletion attacks
- Cooldowns limit claim frequency
- Minimum thresholds filter spam

### 8.3 Nash Equilibrium Analysis

The dominant strategy for LPs is:
1. Provide liquidity on the scarce side when possible
2. Maintain position for loyalty tier advancement
3. Participate in volatile periods for insurance coverage

This aligns individual incentives with protocol health.

### 8.4 Sustainability Properties

| System | Funding Source | Sustainability Mechanism |
|--------|---------------|-------------------------|
| Shapley | Trading fees | Self-funding from volume |
| IL Protection | Protocol reserves | Partial coverage limits exposure |
| Loyalty | External rewards | Penalties don't inflate supply |
| Slippage | Protocol revenue | Per-claim and daily caps |
| Volatility Insurance | Dynamic fee excess | Higher risk = higher premium |

---

## 9. Conclusion

VibeSwap's incentive architecture represents a significant advancement in AMM design. By applying cooperative game theory through Shapley value distribution, complemented by tiered risk protection systems, VibeSwap creates a sustainable ecosystem that:

1. **Rewards fairly** based on marginal contribution, not just capital
2. **Protects participants** through IL coverage, slippage guarantees, and volatility insurance
3. **Incentivizes commitment** through loyalty multipliers and early exit penalties
4. **Sustains itself** through reserve-based systems with built-in caps and cooldowns

The result is an AMM where doing what's good for the protocol is also what's good for individual participants - true incentive alignment through mechanism design.

---

## Appendix A: Key Parameters

| Parameter | Default Value |
|-----------|---------------|
| Shapley Direct Weight | 40% |
| Shapley Time Weight | 30% |
| Shapley Scarcity Weight | 20% |
| Shapley Stability Weight | 10% |
| IL Coverage Tier 0 | 25% |
| IL Coverage Tier 1 | 50% |
| IL Coverage Tier 2 | 80% |
| Loyalty Multiplier Max | 2.0x |
| Slippage Guarantee Cap | 2% |
| Insurance Claim Cap | 50% of reserves |
| Insurance Cooldown | 24 hours |

## Appendix B: Contract Architecture

```
IncentiveController (Coordinator)
├── ShapleyDistributor
├── ILProtectionVault
├── LoyaltyRewardsManager
├── SlippageGuaranteeFund
├── VolatilityInsurancePool
└── VolatilityOracle
```

## Appendix C: Mathematical Reference

**Impermanent Loss**:
```
IL = 2√r / (1 + r) - 1
where r = max(P₁/P₀, P₀/P₁)
```

**Shapley Time Score**:
```
timeScore = log₂(days + 1) × 0.1
```

**Volatility (Annualized)**:
```
σ = √(Var(ln(Pᵢ/Pᵢ₋₁))) × √(periods_per_year)
```

---

*VibeSwap - Fair Rewards, Protected Returns*
