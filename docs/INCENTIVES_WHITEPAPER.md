# VibeSwap Incentives Whitepaper

## Fair Rewards Through Cooperative Game Theory & Reputation-Based Access

**Version 2.0 | February 2026**

---

## Abstract

VibeSwap introduces a novel incentive architecture that combines cooperative game theory with practical DeFi economics and reputation-based access control. Rather than simple pro-rata reward distribution, VibeSwap employs Shapley value calculations to fairly compensate liquidity providers based on their *marginal contribution* to the system.

The protocol implements a **"Credit Score for Web3"** - a soulbound reputation system that gates access to advanced features like leverage and flash loans. This creates Nash equilibrium stability where honest behavior is the dominant strategy, and the barrier to entry balances security with accessibility.

This whitepaper details the mathematical foundations, implementation mechanics, and game-theoretic properties of VibeSwap's interconnected incentive and reputation systems.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Soulbound Identity & Reputation](#2-soulbound-identity--reputation)
3. [Reputation-Gated Access Control](#3-reputation-gated-access-control)
4. [Shapley Value Distribution](#4-shapley-value-distribution)
5. [Impermanent Loss Protection](#5-impermanent-loss-protection)
6. [Loyalty Rewards System](#6-loyalty-rewards-system)
7. [Slippage Guarantee Fund](#7-slippage-guarantee-fund)
8. [Volatility Insurance Pool](#8-volatility-insurance-pool)
9. [Mutual Insurance & Security](#9-mutual-insurance--security)
10. [Dynamic Fee Architecture](#10-dynamic-fee-architecture)
11. [Nash Equilibrium Analysis](#11-nash-equilibrium-analysis)
12. [Conclusion](#12-conclusion)

---

## 1. Introduction

### 1.1 The Problem with Anonymous DeFi

Traditional DeFi has two fundamental problems:

**Problem 1: Unfair Distribution**
- Fees distributed proportionally to capital, ignoring timing, scarcity, and commitment
- Mercenary capital extracts value without contributing to stability

**Problem 2: Zero Accountability**
- Attackers create fresh wallets, exploit, and disappear
- No persistent consequences for malicious behavior
- Flash loans enable zero-capital attacks

### 1.2 VibeSwap's Solution

VibeSwap addresses both through integrated systems:

| System | Purpose |
|--------|---------|
| **Soulbound Identity** | Persistent, non-transferable reputation |
| **Reputation Gating** | Access scales with trust (leverage, flash loans) |
| **Shapley Distribution** | Fair rewards based on marginal contribution |
| **IL Protection** | Tiered coverage against price divergence |
| **Loyalty Rewards** | Time-weighted multipliers for commitment |
| **Mutual Insurance** | Community-funded protection against exploits |

### 1.3 The Core Insight

> "The barrier needs to be high enough to protect the network but low enough to not disincentivize new users."

This is the fundamental tension VibeSwap solves through **continuous access scaling** rather than binary gates. New users can participate immediately with limited access, earning expanded capabilities through positive behavior.

---

## 2. Soulbound Identity & Reputation

### 2.1 The Credit Score for Web3

Just as traditional finance uses credit scores to gate lending, VibeSwap uses on-chain reputation to gate advanced features. Unlike credit scores:

- **Fully transparent**: Algorithm is public, scores are verifiable
- **Self-sovereign**: You control your identity, not a central authority
- **Privacy-preserving**: Proves reputation without revealing activity details

### 2.2 Soulbound Tokens (Non-Transferable)

VibeSwap Soulbound Tokens (VST) cannot be transferred or sold:

```
Traditional Token:  Alice → Bob (transfer allowed)
Soulbound Token:    Alice → Bob (REVERTS - cannot transfer)
```

**Why non-transferable?**
- Prevents reputation markets (buying good reputation)
- Ensures accountability follows the actor
- Makes "fresh wallet escape" ineffective

### 2.3 Reputation Accumulation

Reputation grows through positive-sum participation:

| Action | Reputation Gain | Rationale |
|--------|-----------------|-----------|
| Successful swap | +1 per $1k volume | Active participation |
| LP provision (per day) | +5 per $10k liquidity | Capital commitment |
| Governance participation | +10 per vote | Engaged stakeholder |
| Bug bounty submission | +100 to +10,000 | Security contribution |
| Successful flash loan | +1 | Responsible usage |

| Violation | Reputation Loss | Consequence |
|-----------|-----------------|-------------|
| Wash trading detected | -1,000 | Market manipulation |
| Failed exploit attempt | -∞ (blacklist) | Malicious actor |
| False insurance claim | -500 | Attempted fraud |

### 2.4 Trust Tiers

Four tiers based on reputation, stake, and account age:

```
Tier 0 - Pseudonymous (New Users)
├── Fresh wallet, no history
├── Reputation: 0
└── Access: Basic swaps only, low limits

Tier 1 - Proven (Established)
├── Wallet age > 6 months OR reputation > 100
├── Can import cross-protocol reputation
└── Access: Standard features, moderate limits

Tier 2 - Staked (Committed)
├── Locked stake (e.g., 1000 VIBE for 1 year)
├── Stake slashable for violations
└── Access: Full features, high limits

Tier 3 - Verified (Maximum Trust)
├── ZK-proof of unique personhood (optional)
├── Maximum reputation score
└── Access: Unlimited, governance weight bonus
```

### 2.5 Cross-Wallet Linking

Users can voluntarily link wallets to aggregate reputation:

```
Wallet A: 500 reputation
Wallet B: 300 reputation
           ↓
Link wallets (user choice)
           ↓
Both wallets: 800 reputation (shared)
```

**The tradeoff**: Linking gives better access, but violations on ANY linked wallet affect ALL linked wallets. This is intentional—it creates accountability.

---

## 3. Reputation-Gated Access Control

### 3.1 The Scaling Philosophy

Instead of binary access (yes/no), VibeSwap uses continuous scaling:

```
Access Level = f(Reputation, Stake, Account Age, Behavior)
```

This creates smooth incentive gradients that reward good behavior incrementally.

### 3.2 Feature Access Matrix

| Feature | Tier 0 (New) | Tier 1 (Proven) | Tier 2 (Staked) | Tier 3 (Verified) |
|---------|--------------|-----------------|-----------------|-------------------|
| **Spot Swaps** | $1k/day | $100k/day | $1M/day | Unlimited |
| **LP Provision** | $10k max | $500k max | $5M max | Unlimited |
| **Flash Loans** | Disabled | $10k max | $1M max | $10M max |
| **Leverage** | Disabled | 2x max | 5x max | 10x max |
| **Governance** | View only | 1x vote weight | 1.5x weight | 2x weight |

### 3.3 Flash Loan Protection

Flash loans enable atomic attacks with zero capital at risk. VibeSwap's defense:

**Tier 0**: Flash loans disabled entirely
**Tier 1**: Requires 10% collateral (reduces attack profitability)
**Tier 2**: Requires 1% collateral
**Tier 3**: Requires 0.1% collateral

```
Attack Economics:
  Traditional: Borrow $1M → Attack → Repay → Keep profit (no capital needed)
  VibeSwap Tier 1: Borrow $1M → Lock $100k collateral → Attack
                   If detected: Lose $100k collateral
                   Attack becomes negative EV
```

### 3.4 Leverage & Network Health

Reputation-based leverage limits create system-wide stability:

```
                    Max Leverage by Tier
Tier 0:  ████                              (0x - disabled)
Tier 1:  ████████                          (2x max)
Tier 2:  ████████████████████              (5x max)
Tier 3:  ████████████████████████████████  (10x max)
```

**Why this matters for health factor**:

- New/unknown users can't take leveraged positions
- Only proven participants can access higher leverage
- System-wide leverage is bounded by reputation distribution
- Prevents cascade liquidations from affecting stable LPs

### 3.5 Graceful Onboarding

New users aren't blocked—they're graduated:

```
Day 1:    Tier 0 - Can swap up to $1k/day, provide up to $10k LP
Day 30:   Activity builds reputation → Tier 1 access unlocked
Day 90:   Stakes VIBE → Tier 2 access unlocked
Day 365:  Consistent behavior → Tier 3 potential
```

This balances security (high barrier for risky features) with accessibility (anyone can start participating immediately).

---

## 4. Shapley Value Distribution

### 4.1 Theoretical Foundation

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

### 4.2 Practical Implementation

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

### 4.3 The Glove Game Analogy

Consider the classic glove game: left gloves are worthless alone, right gloves are worthless alone, but a pair has value. The Shapley value recognizes that both sides contribute equally to creating value.

In VibeSwap's batch auctions:
- A pool with 100 ETH of buys and 0 sells executes nothing
- Adding 50 ETH of sells enables 50 ETH of matched volume
- The scarce sell-side deserves recognition beyond raw proportion

### 4.4 Reputation Integration

Shapley distribution incorporates reputation as a quality multiplier:

```
qualityMultiplier = 0.5 + (reputation / maxReputation) × 1.0
Range: 0.5x (zero reputation) to 1.5x (max reputation)
```

This means high-reputation LPs earn up to 50% more from Shapley distribution, rewarding consistent positive behavior.

---

## 5. Impermanent Loss Protection

### 5.1 Understanding Impermanent Loss

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

### 5.2 Tiered Protection Model

Rather than unsustainable full coverage, VibeSwap offers tiered partial protection:

| Tier | Coverage | Minimum Duration |
|------|----------|------------------|
| Basic | 25% | 0 days |
| Standard | 50% | 30 days |
| Premium | 80% | 90 days |

**Reputation Bonus**: Higher reputation reduces deductible:
- Tier 0 reputation: 20% deductible
- Max reputation: 5% deductible

### 5.3 Position Lifecycle

1. **Registration**: On liquidity addition, entry price is recorded
2. **Accrual**: IL tracked continuously against entry price
3. **Closure**: On removal, exit price determines final IL
4. **Claiming**: If minimum duration met, claim coverage from reserves

### 5.4 Sustainability

The tiered model ensures sustainability:
- Partial coverage keeps claims manageable
- Longer locks reduce claim frequency
- Reserve-based funding with emergency circuit breaker

---

## 6. Loyalty Rewards System

### 6.1 Time-Weighted Multipliers

Loyalty rewards incentivize long-term capital commitment through escalating multipliers:

| Tier | Duration | Multiplier | Early Exit Penalty |
|------|----------|------------|-------------------|
| Bronze | 7+ days | 1.0x | 5% |
| Silver | 30+ days | 1.25x | 3% |
| Gold | 90+ days | 1.5x | 1% |
| Platinum | 365+ days | 2.0x | 0% |

### 6.2 Reward Mechanics

The system uses standard staking mechanics with accumulated reward tracking:

```
pendingRewards = (liquidity × rewardPerShare) - rewardDebt
claimableAmount = pendingRewards × tierMultiplier
```

Tier is determined by *continuous* stake duration, not cumulative history. Unstaking resets the timer.

### 6.3 Early Exit Penalties

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

### 6.4 Reputation Synergy

Loyalty tier contributes to overall reputation:

```
Reputation bonus from loyalty:
  Bronze: +10/month
  Silver: +25/month
  Gold: +50/month
  Platinum: +100/month
```

Long-term LPs naturally accumulate higher reputation, gaining access to better features.

---

## 7. Slippage Guarantee Fund

### 7.1 Trader Protection

The Slippage Guarantee Fund protects traders against execution shortfall - when actual output is less than expected minimum.

### 7.2 Claim Generation

Claims are automatically created when:

```
actualOutput < expectedOutput
AND
shortfallBps >= 50 (0.5% minimum)
```

### 7.3 Limits and Constraints

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Minimum Shortfall | 0.5% | Filter trivial claims |
| Maximum Per Claim | 2% of expected | Cap exposure |
| Daily User Limit | Scales with reputation | Prevent abuse |
| Claim Window | 1 hour | Timely claiming |

**Reputation Integration**: Daily claim limit scales with trust tier:
- Tier 0: 1 claim/day max
- Tier 1: 3 claims/day max
- Tier 2: 10 claims/day max
- Tier 3: Unlimited (but flagged if excessive)

### 7.4 Fund Management

The fund is capitalized by protocol revenue and maintains reserves per token. Claims are processed first-come-first-served subject to available reserves.

---

## 8. Volatility Insurance Pool

### 8.1 Dynamic Premium Collection

During high volatility, dynamic fees increase. The excess above base fees flows to the insurance pool:

```
Base Fee: 0.30%
Volatility Tier: EXTREME (2.0x multiplier)
Execution Fee: 0.60%
Insurance Premium: 0.30% (the excess)
```

### 8.2 Volatility Tiers

| Tier | Annualized Volatility | Fee Multiplier |
|------|----------------------|----------------|
| LOW | 0-20% | 1.0x |
| MEDIUM | 20-50% | 1.25x |
| HIGH | 50-100% | 1.5x |
| EXTREME | >100% | 2.0x |

### 8.3 Claim Triggering

Insurance claims are triggered when:
1. Circuit breaker activates due to extreme price movement
2. Volatility tier is EXTREME
3. 24-hour cooldown has passed since last claim

### 8.4 Distribution

Claims are distributed pro-rata to LPs based on their covered liquidity:

```
lpShare = (totalPayout × lpLiquidity) / totalCoveredLiquidity
```

Maximum payout per event is capped at 50% of reserves to prevent fund depletion.

---

## 9. Mutual Insurance & Security

### 9.1 On-Chain Accountability ("On-Chain Jail")

When malicious behavior is detected, wallets enter restricted states:

```
Restriction Levels:
├── WATCH_LIST: Enhanced monitoring, normal access
├── RESTRICTED: No leverage, no flash loans
├── QUARANTINED: Can only withdraw existing positions
└── BLACKLISTED: Cannot interact with protocol
```

**Key property**: Restrictions apply to ALL linked wallets. Attackers can't escape by creating new addresses if their identity is established.

### 9.2 Slashing & Redistribution

When stakes are slashed for violations, funds strengthen the system:

```
Slashed Funds Distribution:
├── 50% → Insurance pool (more coverage for victims)
├── 30% → Bug bounty pool (rewards reporters)
└── 20% → Burned (token value increase)
```

**Anti-Fragile Property**: Every detected attack makes the insurance pool larger and rewards vigilant community members.

### 9.3 Mutual Insurance Pool

The protocol maintains a community-funded insurance pool for:

| Claim Type | Coverage | Funded By |
|------------|----------|-----------|
| Smart contract bugs | 80% | Protocol fees (10%) |
| Oracle failures | 60% | Slashed stakes |
| Governance attacks | 50% | Violation penalties |
| User error | 0% | N/A |

### 9.4 External Insurance Integration

For catastrophic risks beyond on-chain reserves:

- Partnership with Nexus Mutual (smart contract cover)
- Partnership with InsurAce (cross-chain cover)
- Traditional insurance for extreme scenarios

### 9.5 Appeals Process

False positives are handleable through governance:

1. User stakes appeal bond (returned if successful)
2. Evidence submitted to governance
3. Community vote on restoration
4. If approved: restrictions lifted, reputation compensated

---

## 10. Dynamic Fee Architecture

### 10.1 Base Fee Structure

```
Trading Fee: 0.30% (30 bps)
  ├── 80% → LP Pool Reserves
  └── 20% → Protocol Treasury
```

### 10.2 Volatility Adjustment

The VolatilityOracle monitors realized volatility using a rolling window of price observations:

- **Observation interval**: 5 minutes
- **Window size**: 24 observations (~2 hours)
- **Calculation**: Variance of log returns, annualized

### 10.3 Fee Routing

```
Total Dynamic Fee
      ↓
  ├── Base portion (0.30%) → Standard LP/Treasury split
  └── Excess portion → Volatility Insurance Pool
```

### 10.4 Auction Proceeds

Commit-reveal batch auction proceeds (from priority bids) are distributed 100% to LPs, routed through the Shapley distribution system when enabled.

---

## 11. Nash Equilibrium Analysis

### 11.1 Defining the Game

**Players**: Honest Users, Potential Attackers, LPs, Protocol

**Key Question**: Under what conditions is honest behavior the dominant strategy for all players?

### 11.2 Attack Payoff Analysis

For a rational attacker considering an exploit:

```
Expected Value of Attack = P(success) × Gain - P(failure) × Loss - Cost

Where:
  P(success) = Probability attack succeeds undetected
  P(failure) = 1 - P(success)
  Loss = Slashed stake + Reputation loss + Blacklist
  Cost = Development time + Opportunity cost
```

**Design Goal**: Make EV(Attack) < 0 for all attack vectors

### 11.3 Parameter Calibration

With 95% detection rate and full stake slashing:

```
For attack to be rational:
  0.05 × Gain > 0.95 × Stake + Cost
  Gain > 19 × Stake + 20 × Cost

With required stake = 10% of access level:
  Gain > 19 × (10% × AccessLevel) + Cost
  Gain > 1.9 × AccessLevel + Cost
```

This means: To profitably attack $1M, attacker needs access level of $1M, which requires $100k stake. If attack fails (95% chance), they lose $100k. Attack is negative EV.

### 11.4 Honest Behavior Dominance

For honest users:

```
EV(Honest) = Trading gains + LP fees + Reputation growth + Insurance coverage
EV(Attack) = Negative (as shown above)
EV(Exit) = Forfeit reputation + Early exit penalties

Honest > Attack (by design)
Honest > Exit (for long-term participants)
```

### 11.5 The Nash Equilibrium

The system reaches equilibrium when:

1. **Honest users prefer honesty**: Reputation gains + feature access > attack potential
2. **Attackers prefer not attacking**: EV(attack) < 0 for all known vectors
3. **LPs prefer staying**: Loyalty multipliers + IL protection > exit value
4. **Protocol prefers defending**: Insurance reserves remain solvent

### 11.6 Balancing Scale and Security

The fundamental tension:

```
Too High Barrier → New users can't participate → No growth
Too Low Barrier → Attackers exploit easily → No security
```

**VibeSwap's Solution**: Continuous scaling with smooth gradients

```
Access(reputation) = BaseAccess × (1 + reputation/maxReputation)
```

- Day 1 user: ~50% access (can participate meaningfully)
- Established user: ~100% access (full features)
- Proven user: ~150% access (power user benefits)

This creates:
- Immediate utility for new users (growth)
- Increasing returns for positive behavior (retention)
- Bounded risk from any single actor (security)

---

## 12. Conclusion

VibeSwap's incentive architecture represents a paradigm shift in AMM design. By combining:

1. **Cooperative game theory** (Shapley values) for fair distribution
2. **Soulbound reputation** for persistent accountability
3. **Continuous access scaling** for balanced security/accessibility
4. **Mutual insurance** for community-funded protection
5. **Anti-fragile mechanisms** that strengthen under attack

The result is a protocol where:

- **Honest behavior is the dominant strategy** (Nash equilibrium)
- **Attacks make the system stronger** (anti-fragility)
- **New users can participate immediately** (accessibility)
- **Bad actors face permanent consequences** (accountability)
- **Long-term commitment is rewarded** (sustainability)

> "Finding the right balance between scale and security" - this is the core problem VibeSwap solves through mechanism design, not arbitrary rules.

The barrier is high enough to protect the network, low enough to welcome new users, and scales smoothly with demonstrated trustworthiness. This is the Credit Score for Web3.

---

## Appendix A: Key Parameters

| Parameter | Default Value | Rationale |
|-----------|---------------|-----------|
| Shapley Direct Weight | 40% | Largest factor is actual contribution |
| Shapley Time Weight | 30% | Significant reward for commitment |
| Shapley Scarcity Weight | 20% | Reward enabling trades |
| Shapley Stability Weight | 10% | Bonus for volatility presence |
| IL Coverage Tier 0 | 25% | Immediate partial protection |
| IL Coverage Tier 1 | 50% | Standard protection |
| IL Coverage Tier 2 | 80% | Premium protection |
| Loyalty Multiplier Max | 2.0x | Double rewards for 1-year commitment |
| Minimum Stake (Tier 2) | 1000 VIBE | Meaningful skin in the game |
| Detection Target | 95% | Makes most attacks negative EV |
| Slash Rate | 100% | Full accountability |

## Appendix B: Contract Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    IDENTITY LAYER                            │
│  SoulboundToken ←→ ReputationOracle ←→ AccessController     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   INCENTIVE LAYER                            │
│  IncentiveController (Coordinator)                          │
│  ├── ShapleyDistributor                                     │
│  ├── ILProtectionVault                                      │
│  ├── LoyaltyRewardsManager                                  │
│  ├── SlippageGuaranteeFund                                  │
│  ├── VolatilityInsurancePool                                │
│  └── VolatilityOracle                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    CORE LAYER                                │
│  VibeSwapCore ←→ VibeAMM ←→ CommitRevealAuction            │
└─────────────────────────────────────────────────────────────┘
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

**Attack Expected Value**:
```
EV = P(success) × Gain - P(failure) × Stake - Cost
Design constraint: EV < 0 for all vectors
```

**Access Scaling**:
```
Access(rep) = BaseAccess × (0.5 + rep/maxRep)
Range: 50% (new) to 150% (max reputation)
```

---

*VibeSwap - Fair Rewards, Protected Returns, Accountable Participants*

**Related Documents**:
- [Security Mechanism Design](SECURITY_MECHANISM_DESIGN.md) - Deep dive into anti-fragile security architecture
