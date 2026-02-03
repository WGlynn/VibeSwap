# VibeSwap: Complete Mechanism Design

## A Comprehensive Framework for Cooperative Price Discovery, Fair Rewards, Anti-Fragile Security, and Price Intelligence

**Version 1.0 | February 2026**

---

# Preface: The Story This Document Tells

This document presents VibeSwap's complete mechanism design in narrative form. It's organized as a journey from problem to solution:

1. **Part I: The Problem** — Why current markets are broken
2. **Part II: The Philosophy** — Cooperative capitalism as the alternative
3. **Part III: The Mechanism** — How batch auctions enable true price discovery
4. **Part IV: Fair Rewards** — Shapley values and incentive alignment
5. **Part V: Identity & Reputation** — Soulbound tokens and trust tiers
6. **Part VI: Security Architecture** — Anti-fragile defense systems
7. **Part VII: Price Intelligence** — Detecting manipulation and predicting reversions
8. **Part VIII: Integration** — How all systems work together

Each part builds on the previous. The philosophy motivates the mechanism. The mechanism enables fair rewards. Fair rewards require identity. Identity enables security. Security protects price intelligence. And price intelligence feeds back into better mechanisms.

This is the complete picture.

---

# Table of Contents

## Part I: The Problem
- [1. The Price Discovery Problem](#1-the-price-discovery-problem)
- [2. The Cost of Adversarial Markets](#2-the-cost-of-adversarial-markets)
- [3. The Problem with Anonymous DeFi](#3-the-problem-with-anonymous-defi)
- [4. The Manipulation Problem](#4-the-manipulation-problem)

## Part II: The Philosophy
- [5. What Is True Price?](#5-what-is-true-price)
- [6. Cooperative Capitalism](#6-cooperative-capitalism)
- [7. The Design Principles](#7-the-design-principles)

## Part III: The Mechanism
- [8. Batch Auctions and Uniform Clearing](#8-batch-auctions-and-uniform-clearing)
- [9. The Commit-Reveal Protocol](#9-the-commit-reveal-protocol)
- [10. Priority Auctions](#10-priority-auctions)
- [11. Information Aggregation vs. Exploitation](#11-information-aggregation-vs-exploitation)

## Part IV: Fair Rewards
- [12. Shapley Values and Fair Attribution](#12-shapley-values-and-fair-attribution)
- [13. Impermanent Loss Protection](#13-impermanent-loss-protection)
- [14. Loyalty Rewards System](#14-loyalty-rewards-system)
- [15. Slippage Guarantee Fund](#15-slippage-guarantee-fund)
- [16. Volatility Insurance Pool](#16-volatility-insurance-pool)
- [17. Dynamic Fee Architecture](#17-dynamic-fee-architecture)

## Part V: Identity & Reputation
- [18. Soulbound Identity](#18-soulbound-identity)
- [19. Trust Tiers](#19-trust-tiers)
- [20. Reputation-Gated Access Control](#20-reputation-gated-access-control)
- [21. Flash Loan and Leverage Controls](#21-flash-loan-and-leverage-controls)

## Part VI: Security Architecture
- [22. Threat Model](#22-threat-model)
- [23. On-Chain Accountability System](#23-on-chain-accountability-system)
- [24. Mutual Insurance Mechanism](#24-mutual-insurance-mechanism)
- [25. Anti-Fragile Defense Loops](#25-anti-fragile-defense-loops)
- [26. Nash Equilibrium Analysis](#26-nash-equilibrium-analysis)

## Part VII: Price Intelligence
- [27. Price Aggregation Architecture](#27-price-aggregation-architecture)
- [28. Statistical Anomaly Detection](#28-statistical-anomaly-detection)
- [29. Liquidation Cascade Identification](#29-liquidation-cascade-identification)
- [30. Rubber Band Reversion Model](#30-rubber-band-reversion-model)
- [31. Flash Crash and Flash Loan Detection](#31-flash-crash-and-flash-loan-detection)
- [32. Reputation-Weighted Signal Network](#32-reputation-weighted-signal-network)

## Part VIII: Integration
- [33. How It All Fits Together](#33-how-it-all-fits-together)
- [34. Contract Architecture](#34-contract-architecture)
- [35. Conclusion](#35-conclusion)

## Appendices
- [Appendix A: Mathematical Foundations](#appendix-a-mathematical-foundations)
- [Appendix B: Key Parameters](#appendix-b-key-parameters)
- [Appendix C: Comparison of Market Mechanisms](#appendix-c-comparison-of-market-mechanisms)

---

# Part I: The Problem

---

## 1. The Price Discovery Problem

### 1.1 What Markets Are Supposed to Do

Markets exist to answer a fundamental question: **What is this worth?**

The theoretical ideal is elegant:
- Buyers reveal how much they value something
- Sellers reveal how much they need to receive
- The intersection determines the "true" price
- Resources flow to highest-valued uses

This is what economists mean by "efficient markets." Price emerges from the aggregation of dispersed information, coordinating economic activity without central planning.

Beautiful in theory. Broken in practice.

### 1.2 What Markets Actually Do

Modern markets have become **extraction games**:

- High-frequency traders spend billions on speed to front-run orders
- Market makers profit from information asymmetry, not liquidity provision
- Arbitrageurs extract value from price discrepancies they didn't help create
- Regular participants systematically lose to faster, better-informed players

The price that emerges isn't the "true" price—it's the price after extraction.

### 1.3 The Transformation of Price Discovery

What went wrong? Sequential execution.

When orders arrive and execute one at a time:
- **Ordering games emerge**: Profit from being first
- **Information leaks**: Each trade reveals information to observers
- **Extraction opportunities multiply**: Trade against others' revealed information

Price discovery became adversarial—not because participants are malicious, but because the mechanism rewards extraction.

**This is the critical insight: DeFi didn't set out to create MEV. Uniswap didn't design sandwich attacks. These emerged because the mechanisms allowed them.**

We're not facing a people problem. We're facing a mechanism design problem.

And mechanism design problems have solutions.

---

## 2. The Cost of Adversarial Markets

### 2.1 Who Loses and How

| Who Loses | How They Lose |
|-----------|---------------|
| Retail traders | Sandwiched, front-run, worse execution |
| Long-term investors | Prices distorted by short-term extraction |
| Liquidity providers | Adverse selection from informed flow |
| Market integrity | Prices reflect speed, not information |
| Society | Resources misallocated based on distorted signals |

### 2.2 MEV: The Quantification of Extraction

MEV (Maximal Extractable Value) in DeFi alone exceeds **$1 billion annually**. This isn't profit from adding value—it's rent from exploiting mechanism flaws.

Every dollar of MEV represents:
- A trader who got worse execution
- An LP who lost to adverse selection
- A price signal that was distorted

### 2.3 The Adversarial Equilibrium

Current markets have reached a stable but suboptimal equilibrium:

```
For traders:
  Hide true size, split orders, time carefully

For LPs:
  Accept adverse selection as cost of business

For extractors:
  Invest in speed, information, extraction tech
```

Everyone is worse off than they could be, but no one can unilaterally deviate.

This is a **bad equilibrium**. Game theory tells us we can design better ones.

---

## 3. The Problem with Anonymous DeFi

### 3.1 Zero Accountability

Traditional DeFi has two fundamental problems:

**Problem 1: Unfair Distribution**
- Fees distributed proportionally to capital, ignoring timing, scarcity, and commitment
- Mercenary capital extracts value without contributing to stability

**Problem 2: Zero Accountability**
- Attackers create fresh wallets, exploit, and disappear
- No persistent consequences for malicious behavior
- Flash loans enable zero-capital attacks

### 3.2 The Fresh Wallet Problem

In anonymous DeFi, an attacker can:

1. Create new wallet (free, instant)
2. Execute attack
3. Profit or fail
4. If fail: abandon wallet, no consequence
5. If succeed: move funds, repeat

There's no learning. No accumulated consequence. No way to distinguish first-time attackers from repeat offenders.

### 3.3 The Flash Loan Amplifier

Flash loans make this worse:

```
Traditional Attack:
  Attacker needs capital → Capital at risk → Incentive to be careful

Flash Loan Attack:
  Attacker borrows unlimited capital → Zero capital at risk → Free lottery ticket
```

The combination of anonymity and flash loans creates an environment where attacks are essentially free to attempt.

---

## 4. The Manipulation Problem

### 4.1 The Myth of Price Discovery

We're told crypto prices reflect supply and demand. In reality:

**Binance and major CEXs**:
- See all order flow before execution
- Know liquidation levels of leveraged positions
- Can trade against their own customers
- Face minimal regulatory oversight

**The result**: Prices move to **hunt liquidations**, not to discover value.

### 4.2 How Manipulation Works

```
Step 1: Exchange sees $500M in long liquidations at $29,500

Step 2: Large sell pressure pushes price toward $29,500
        (Often the exchange's own trading desk)

Step 3: Liquidation cascade triggers
        - Forced selling from liquidated longs
        - Cascading liquidations as price falls further
        - Stop losses triggered

Step 4: Exchange (and informed traders) buy the dip

Step 5: Price "rubber bands" back to fair value

Step 6: Exchange profits, retail loses
```

This isn't conspiracy—it's the rational behavior of profit-maximizing entities with information advantages.

### 4.3 The Evidence

**Statistical signatures of manipulation**:
- Price moves cluster around round numbers (liquidation levels)
- Volatility spikes on low volume (fake moves)
- Rapid reversions after extreme moves (rubber bands)
- Suspicious timing (before major announcements, during low liquidity)

**Volume analysis**:
- Wash trading estimates: 70-95% of reported CEX volume is fake
- Liquidation volume far exceeds organic selling
- Order book depth disappears before major moves

### 4.4 Why This Matters

If we use external prices naively:
- We import manipulation into our price feeds
- Our users get worse execution during manipulation events
- Liquidations on our platform could be triggered by fake prices

We need to **distinguish real price discovery from manipulation**.

---

# Part II: The Philosophy

---

## 5. What Is True Price?

### 5.1 The Naive Definition

"True price" might seem obvious: whatever buyers and sellers agree on.

But this ignores **how** they arrive at agreement. If the process is corrupted, the outcome is corrupted.

### 5.2 A Better Definition

**True price** is the price that would emerge if:

1. All participants revealed their genuine valuations
2. No participant could profit from information about others' orders
3. No participant could profit from execution speed
4. The mechanism aggregated information efficiently

In other words: the price that reflects **actual supply and demand**, not the artifacts of the trading mechanism.

### 5.3 The Revelation Principle

Game theory tells us something profound: any outcome achievable through strategic behavior can also be achieved through a mechanism where **honest revelation is optimal**.

This is called the **revelation principle**. It means we can design markets where telling the truth is the best strategy.

Current markets violate this. Participants are incentivized to:
- Hide their true valuations
- Split orders to avoid detection
- Time orders strategically
- Exploit others' revealed information

The revelation principle says this is a **choice**, not a necessity. We can do better.

### 5.4 True Price as Nash Equilibrium

A price is "true" when it represents a **Nash equilibrium** of honest revelation:

- No buyer could profit by misrepresenting their valuation
- No seller could profit by misrepresenting their reservation price
- No third party could profit by exploiting the mechanism

If honest behavior is the dominant strategy for everyone, the resulting price aggregates genuine information.

---

## 6. Cooperative Capitalism

### 6.1 Beyond the False Dichotomy

Traditional framing presents these as opposites:

**Free markets** (competition, individual profit, minimal coordination)
vs.
**Central planning** (cooperation, collective benefit, heavy coordination)

This is a false choice. VibeSwap shows they're **complementary**:

| Layer | Mechanism | Type |
|-------|-----------|------|
| Price discovery | Batch auction clearing | Collective |
| Participation | Voluntary trading | Individual choice |
| Risk | Mutual insurance pools | Collective |
| Reward | Trading profits, LP fees | Individual |
| Stability | Counter-cyclical measures | Collective |
| Competition | Priority auction bidding | Individual |

### 6.2 The Core Insight

> Collective mechanisms for **infrastructure**. Individual mechanisms for **activity**.

Roads are collective (everyone benefits from their existence).
Driving is individual (you choose where to go).

Price discovery is infrastructure—everyone benefits from accurate prices.
Trading is individual—you choose what to trade.

We've been treating price discovery as individual when it's actually collective.

### 6.3 Mutualized Downside, Privatized Upside

Nobody wants to individually bear:
- Impermanent loss during crashes
- Slippage on large trades
- Protocol exploits and hacks

Everyone wants to individually capture:
- Trading profits
- LP fees
- Arbitrage gains

**Solution**: Insurance pools for downside, markets for upside.

This isn't ideology—it's optimal risk allocation. It's how credit unions and mutual insurance companies work. Members are both customers and beneficiaries.

### 6.4 The Invisible Hand, Redirected

Adam Smith's insight was that self-interest, properly channeled, produces social benefit.

The problem isn't self-interest—it's **bad channels**.

Current market design channels self-interest toward extraction.
Cooperative design channels self-interest toward contribution.

The invisible hand still operates. We just point it somewhere useful.

### 6.5 From Accidental Adversaries to Intentional Cooperators

DeFi didn't set out to create MEV. These patterns emerged because the mechanisms allowed them.

**We can be intentional.**

Design mechanisms where:
- Cooperation pays better than defection
- Contribution pays better than extraction
- Long-term participation pays better than hit-and-run

The result: markets that produce true prices as a byproduct of self-interest.

---

## 7. The Design Principles

### 7.1 Three Core Principles

**Principle 1: Information Hiding**
No one can see others' orders before committing their own.

**Principle 2: Simultaneous Resolution**
All orders in a batch execute together at one price.

**Principle 3: Fair Attribution**
Rewards flow to those who contributed to price discovery.

### 7.2 The Cooperative Framework

| Adversarial | Cooperative |
|-------------|-------------|
| First-come, first-served | Batch processing |
| Continuous execution | Discrete auctions |
| Price impact per trade | Uniform clearing price |
| Information exploitation | Information aggregation |
| Zero-sum extraction | Positive-sum contribution |

### 7.3 Five Security Principles

1. **Make attacks economically irrational** — Cost of attack > Potential gain
2. **Make honest behavior the dominant strategy** — Cooperation pays better than defection
3. **Convert attack energy into protocol strength** — Attacker losses fund defender gains
4. **Eliminate single points of failure** — Distribute trust across mechanisms
5. **Assume breach, design for recovery** — Graceful degradation over catastrophic failure

---

# Part III: The Mechanism

---

## 8. Batch Auctions and Uniform Clearing

### 8.1 The Batch Auction Model

Instead of continuous trading where orders arrive and execute immediately:

```
Time 0-8 sec:   COMMIT PHASE
                - Traders submit hashed orders
                - Nobody can see others' orders
                - Information is sealed

Time 8-10 sec:  REVEAL PHASE
                - Traders reveal actual orders
                - No new orders accepted
                - Batch is sealed

Time 10+ sec:   SETTLEMENT
                - Single clearing price calculated
                - All orders execute at same price
                - No "before" and "after"
```

### 8.2 Why Batching Enables True Price Discovery

**No front-running**: Can't trade ahead of orders you can't see

**No sandwiching**: No price to manipulate between trades

**Information aggregation**: All orders contribute to one price

**Honest revelation**: No benefit to misrepresenting valuations

### 8.3 Uniform Clearing Price

All trades in a batch execute at the **same price**:

```
Batch contains:
  - Buy orders: 100 ETH total demand
  - Sell orders: 80 ETH total supply

Clearing price: Where supply meets demand

All buyers pay the same price.
All sellers receive the same price.
```

This is how traditional stock exchanges run opening and closing auctions—because it's mathematically fairer.

### 8.4 The Single Price Property

With one price, there's no "price impact" per trade:

```
Traditional AMM:
  Trade 1: Buy 10 ETH at $2000
  Trade 2: Buy 10 ETH at $2010 (price moved)
  Trade 3: Buy 10 ETH at $2020 (price moved more)

Batch Auction:
  All trades: Buy 30 ETH at $2015 (single clearing price)
```

The uniform price removes the advantage of trading first.

---

## 9. The Commit-Reveal Protocol

### 9.1 Phase 1: Commit (8 seconds)

Users submit a **hash** of their order. Nobody can see what you're trading.

```
You want to buy 10 ETH
You submit: hash(buy, 10 ETH, secret_xyz) → 0x7f3a9c2b...
Observers see: meaningless hex. Can't frontrun what they can't read.
```

The hash commits you to a specific order without revealing it.

### 9.2 Phase 2: Reveal (2 seconds)

Users reveal their actual orders by submitting the preimage:

```
You reveal: (buy, 10 ETH, secret_xyz)
Protocol verifies: hash(buy, 10 ETH, secret_xyz) == 0x7f3a9c2b... ✓
```

Once reveal closes, the batch is **sealed**. No new orders can enter.

### 9.3 Why This Works

**Commit phase**: Information is hidden
- Observers see only hashes
- No way to know order direction, size, or price
- Front-running impossible

**Reveal phase**: Too late to act
- Orders visible but no new orders allowed
- Batch composition is fixed
- Information can only be aggregated, not exploited

### 9.4 The Result

When information can't be exploited, it can only be **contributed**.

The clearing price incorporates:
- All buy pressure in the batch
- All sell pressure in the batch
- No extraction or distortion

This is information aggregation as intended—the market as collective intelligence.

---

## 10. Priority Auctions

### 10.1 The Need for Priority

Some traders genuinely need execution priority:
- Arbitrageurs correcting mispricing
- Hedgers managing time-sensitive risk
- Large traders ensuring fill

Without a mechanism, priority seeking becomes MEV extraction.

### 10.2 The Solution: Auction Priority

Instead of giving priority away (to validators, to the fastest), **auction it**:

```
Priority bidders (5 traders):
  Position 1: Trader A bid 0.10 ETH → executes first
  Position 2: Trader B bid 0.05 ETH → executes second
  Position 3: Trader C bid 0.03 ETH → executes third
  ...

Regular orders (95 traders):
  Positions 6-100: Shuffled randomly
```

### 10.3 Where Priority Bids Go

**Critical**: Priority bids go to LPs, not validators, not the protocol.

```
Traditional MEV flow:
  Value → Validators → Not captured by protocol

VibeSwap priority flow:
  Value → LPs → Rewards liquidity provision
```

This captures value that would otherwise leak to MEV extraction.

### 10.4 Fair Ordering for Non-Priority Orders

Regular orders get **deterministically shuffled** using a collective secret:

```
1. Every trader revealed a secret during reveal phase

2. All secrets are XORed together to create a seed:
   seed = secret₁ ⊕ secret₂ ⊕ secret₃ ⊕ ... ⊕ secret₉₅

3. This seed drives a Fisher-Yates shuffle:
   for i = n-1 down to 1:
       j = random(seed, i)     ← deterministic from seed
       swap(orders[i], orders[j])
```

**Why XOR all secrets together?**
- **No single trader controls the seed** — it's derived from everyone's input
- To manipulate ordering, you'd need to know everyone else's secrets before revealing
- But secrets are committed as hashes first — you can't see them until reveal
- **Manipulation requires collusion with ALL other traders** (impractical)

### 10.5 The Complete Settlement Flow

```
REVEAL PHASE                           SETTLEMENT
───────────────                        ─────────────────────────────────

Order A (bid: 0.1 ETH) ─┐              1. [A] ← Priority (0.10 ETH bid)
Order B (no bid) ───────┤              2. [C] ← Priority (0.05 ETH bid)
Order C (bid: 0.05 ETH)─┤    ────►     3. [F] ← Shuffled
Order D (no bid) ───────┤              4. [B] ← Shuffled
Order E (no bid) ───────┤              5. [D] ← Shuffled
Order F (no bid) ───────┘              6. [E] ← Shuffled

                                       All execute at SAME clearing price
                                       Priority bids (0.15 ETH) → LPs
```

**The result:** Fair ordering without centralized sequencing. Arbs pay for priority, that payment goes to LPs, everyone else gets random-fair ordering.

---

## 11. Information Aggregation vs. Exploitation

### 11.1 Information in Markets

Every trade contains information:
- A large buy suggests positive news
- A large sell suggests negative news
- Order flow reveals market sentiment

The question is: **who benefits from this information?**

### 11.2 The Exploitation Model (Current)

```
Trader submits order
       ↓
Order visible in mempool/order book
       ↓
Informed parties trade first
       ↓
Original trader gets worse price
       ↓
Information "leaked" to extractors
```

Information doesn't improve price discovery—it's captured as private profit.

### 11.3 The Aggregation Model (Cooperative)

```
All traders submit sealed orders
       ↓
Orders revealed simultaneously
       ↓
Single clearing price calculated from ALL orders
       ↓
Everyone gets the same price
       ↓
Information aggregated into accurate price
```

Information improves the price everyone gets, not just the fastest.

### 11.4 Why Cooperative Markets Produce True Prices

**Can you profit by lying about your valuation?**
No—you either:
- Miss trades you wanted (if you underbid)
- Pay more than necessary (if you overbid)

Honest revelation maximizes your expected outcome.

**Can you profit by front-running?**
No—orders are hidden until reveal phase. Nothing to front-run.

**Can you profit by sandwiching?**
No—single clearing price. No "before" and "after" to exploit.

### 11.5 The Dominant Strategy

In cooperative batch auctions:

```
For traders:
  Optimal strategy = Submit true valuation

For LPs:
  Optimal strategy = Provide genuine liquidity

For would-be extractors:
  Optimal strategy = Become honest participants (extraction unprofitable)
```

Honesty isn't just possible—it's **dominant**.

---

# Part IV: Fair Rewards

---

## 12. Shapley Values and Fair Attribution

### 12.1 Who Creates Price Discovery?

Accurate prices don't emerge from nothing. They require:

- **Buyers** revealing demand
- **Sellers** revealing supply
- **Liquidity providers** enabling trades
- **Arbitrageurs** correcting mispricing

All contribute. How do we reward fairly?

### 12.2 The Problem with Pro-Rata

Traditional pro-rata distribution: `your_reward = (your_liquidity / total_liquidity) × fees`

This ignores:
- You stayed when others left (enabling)
- You provided the scarce side (critical)
- You've been here longer (stability)

### 12.3 The Shapley Value

From cooperative game theory: the **Shapley value** measures each participant's marginal contribution.

```
Imagine all participants arriving in random order.
Your Shapley value = Average contribution when you arrive
                     across all possible orderings
```

This satisfies four fairness axioms:
1. **Efficiency**: All value distributed
2. **Symmetry**: Equal contributors get equal shares
3. **Null player**: Zero contribution gets zero
4. **Additivity**: Consistent across combined activities

### 12.4 The Shapley Formula

For a cooperative game (N, v) where N is the set of participants and v(S) is the value of coalition S, the Shapley value for participant i is:

```
φᵢ(v) = Σ [|S|!(|N|-|S|-1)! / |N|!] × [v(S ∪ {i}) - v(S)]
```

This measures the average marginal contribution of participant i across all possible orderings.

### 12.5 The Glove Game Intuition

Classic game theory example:

```
Left glove alone = $0
Right glove alone = $0
Pair together = $10

Who deserves the $10?
Shapley answer: $5 each
```

Applied to markets:
- Buy orders alone = no trades
- Sell orders alone = no trades
- Together = functioning market

Neither "deserves" all the fees. **Value comes from cooperation.**

### 12.6 Practical Implementation

Computing exact Shapley values is O(2^n), impractical on-chain. VibeSwap uses a weighted approximation that is O(n):

```
weightedContribution(i) =
    directContribution × 40%
  + timeScore × 30%
  + scarcityScore × 20%
  + stabilityScore × 10%
```

### 12.7 Contribution Components

**Direct Contribution (40%)**
Raw liquidity or volume provided. The baseline measure of participation.

**Time Score (30%)**
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

**Scarcity Score (20%)**
Implements the glove game principle: value comes from complementary contributions.

```
Batch has:
  - 80 ETH of buy orders
  - 20 ETH of sell orders

Sell-side LPs are SCARCE (high demand, low supply)
Buy-side LPs are ABUNDANT

Shapley weights sell-side LPs higher for this batch
They provided the scarce resource that enabled trades
```

**Stability Score (10%)**
Rewards presence during volatile periods when liquidity is most valuable.

### 12.8 Reputation Integration

Shapley distribution incorporates reputation as a quality multiplier:

```
qualityMultiplier = 0.5 + (reputation / maxReputation) × 1.0
Range: 0.5x (zero reputation) to 1.5x (max reputation)
```

High-reputation LPs earn up to 50% more from Shapley distribution, rewarding consistent positive behavior.

### 12.9 Why This Matters for True Price

When rewards flow to contributors (not extractors), the incentive shifts:

**Adversarial**: Profit by exploiting others' information
**Cooperative**: Profit by contributing to accurate prices

Participants are **paid for price discovery**, not for extraction.

---

## 13. Impermanent Loss Protection

### 13.1 Understanding Impermanent Loss

When providing liquidity to an AMM, price divergence between deposited assets creates "impermanent loss" — the opportunity cost versus simply holding the assets.

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

### 13.2 Tiered Protection Model

Rather than unsustainable full coverage, VibeSwap offers tiered partial protection:

| Tier | Coverage | Minimum Duration |
|------|----------|------------------|
| Basic | 25% | 0 days |
| Standard | 50% | 30 days |
| Premium | 80% | 90 days |

**Reputation Bonus**: Higher reputation reduces deductible:
- Tier 0 reputation: 20% deductible
- Max reputation: 5% deductible

### 13.3 Position Lifecycle

1. **Registration**: On liquidity addition, entry price is recorded
2. **Accrual**: IL tracked continuously against entry price
3. **Closure**: On removal, exit price determines final IL
4. **Claiming**: If minimum duration met, claim coverage from reserves

### 13.4 Sustainability

The tiered model ensures sustainability:
- Partial coverage keeps claims manageable
- Longer locks reduce claim frequency
- Reserve-based funding with emergency circuit breaker

---

## 14. Loyalty Rewards System

### 14.1 Time-Weighted Multipliers

Loyalty rewards incentivize long-term capital commitment through escalating multipliers:

| Tier | Duration | Multiplier | Early Exit Penalty |
|------|----------|------------|-------------------|
| Bronze | 7+ days | 1.0x | 5% |
| Silver | 30+ days | 1.25x | 3% |
| Gold | 90+ days | 1.5x | 1% |
| Platinum | 365+ days | 2.0x | 0% |

### 14.2 Reward Mechanics

The system uses standard staking mechanics with accumulated reward tracking:

```
pendingRewards = (liquidity × rewardPerShare) - rewardDebt
claimableAmount = pendingRewards × tierMultiplier
```

Tier is determined by *continuous* stake duration, not cumulative history. Unstaking resets the timer.

### 14.3 Early Exit Penalties

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

### 14.4 Reputation Synergy

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

## 15. Slippage Guarantee Fund

### 15.1 Trader Protection

The Slippage Guarantee Fund protects traders against execution shortfall — when actual output is less than expected minimum.

### 15.2 Claim Generation

Claims are automatically created when:

```
actualOutput < expectedOutput
AND
shortfallBps >= 50 (0.5% minimum)
```

### 15.3 Limits and Constraints

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

### 15.4 Fund Management

The fund is capitalized by protocol revenue and maintains reserves per token. Claims are processed first-come-first-served subject to available reserves.

---

## 16. Volatility Insurance Pool

### 16.1 Dynamic Premium Collection

During high volatility, dynamic fees increase. The excess above base fees flows to the insurance pool:

```
Base Fee: 0.30%
Volatility Tier: EXTREME (2.0x multiplier)
Execution Fee: 0.60%
Insurance Premium: 0.30% (the excess)
```

### 16.2 Volatility Tiers

| Tier | Annualized Volatility | Fee Multiplier |
|------|----------------------|----------------|
| LOW | 0-20% | 1.0x |
| MEDIUM | 20-50% | 1.25x |
| HIGH | 50-100% | 1.5x |
| EXTREME | >100% | 2.0x |

### 16.3 Claim Triggering

Insurance claims are triggered when:
1. Circuit breaker activates due to extreme price movement
2. Volatility tier is EXTREME
3. 24-hour cooldown has passed since last claim

### 16.4 Distribution

Claims are distributed pro-rata to LPs based on their covered liquidity:

```
lpShare = (totalPayout × lpLiquidity) / totalCoveredLiquidity
```

Maximum payout per event is capped at 50% of reserves to prevent fund depletion.

---

## 17. Dynamic Fee Architecture

### 17.1 Base Fee Structure

```
Trading Fee: 0.30% (30 bps)
  ├── 80% → LP Pool Reserves
  └── 20% → Protocol Treasury
```

### 17.2 Volatility Adjustment

The VolatilityOracle monitors realized volatility using a rolling window of price observations:

- **Observation interval**: 5 minutes
- **Window size**: 24 observations (~2 hours)
- **Calculation**: Variance of log returns, annualized

### 17.3 Fee Routing

```
Total Dynamic Fee
      ↓
  ├── Base portion (0.30%) → Standard LP/Treasury split
  └── Excess portion → Volatility Insurance Pool
```

### 17.4 Auction Proceeds

Commit-reveal batch auction proceeds (from priority bids) are distributed 100% to LPs, routed through the Shapley distribution system when enabled.

---

# Part V: Identity & Reputation

---

## 18. Soulbound Identity

### 18.1 The Credit Score for Web3

Just as traditional finance uses credit scores to gate lending, VibeSwap uses on-chain reputation to gate advanced features. Unlike credit scores:

- **Fully transparent**: Algorithm is public, scores are verifiable
- **Self-sovereign**: You control your identity, not a central authority
- **Privacy-preserving**: Proves reputation without revealing activity details

### 18.2 Soulbound Tokens (Non-Transferable)

VibeSwap Soulbound Tokens (VST) cannot be transferred or sold:

```
Traditional Token:  Alice → Bob (transfer allowed)
Soulbound Token:    Alice → Bob (REVERTS - cannot transfer)
```

**Why non-transferable?**
- Prevents reputation markets (buying good reputation)
- Ensures accountability follows the actor
- Makes "fresh wallet escape" ineffective

### 18.3 The Soulbound Interface

```solidity
interface IVibeSoulbound {
    // Non-transferable - reverts on transfer attempts
    function transfer(address, uint256) external returns (bool); // Always reverts

    // Soul-level data
    function getReputation(address soul) external view returns (uint256);
    function getAccountAge(address soul) external view returns (uint256);
    function getViolations(address soul) external view returns (Violation[]);
    function getTrustTier(address soul) external view returns (TrustTier);

    // Reputation modifications (governance/system only)
    function increaseReputation(address soul, uint256 amount, bytes32 reason) external;
    function decreaseReputation(address soul, uint256 amount, bytes32 reason) external;
    function recordViolation(address soul, ViolationType vType, bytes32 evidence) external;
}
```

### 18.4 Reputation Accumulation

Reputation grows through positive-sum participation:

| Action | Reputation Gain | Rationale |
|--------|-----------------|-----------|
| Successful swap | +1 per $1k volume | Active participation |
| LP provision (per day) | +5 per $10k liquidity | Capital commitment |
| Governance participation | +10 per vote | Engaged stakeholder |
| Referring new users | +20 per active referral | Network growth |
| Bug bounty submission | +100 to +10,000 | Security contribution |
| Successful flash loan | +1 | Responsible usage |

| Violation | Reputation Loss | Consequence |
|-----------|-----------------|-------------|
| Insurance claim denied (false claim) | -500 | Attempted fraud |
| Wash trading detected | -1,000 | Market manipulation |
| Failed exploit attempt | -∞ (blacklist) | Malicious actor |

### 18.5 Cross-Wallet Linking

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

```solidity
function linkWallet(address newWallet, bytes calldata proof) external {
    // Proof that msg.sender controls newWallet (signed message)
    require(verifyOwnership(msg.sender, newWallet, proof));

    // Link reputations - both wallets share the same soul
    linkedSouls[newWallet] = linkedSouls[msg.sender];

    // IMPORTANT: Violations on ANY linked wallet affect ALL
    // This is the cost of reputation aggregation
}
```

**Game Theory**: Linking is profitable (aggregated reputation = better access) but risky (shared liability). Rational actors only link wallets they control legitimately.

---

## 19. Trust Tiers

### 19.1 Four Tiers of Trust

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

### 19.2 Identity Binding Mechanisms

**Problem**: How to prevent creating new wallet = new identity?

**Solutions** (layered, opt-in for higher trust tiers):

**Tier 0 - Pseudonymous (Default)**:
- Fresh wallet, no history
- Limited access (no leverage, no flash loans, low limits)
- Reputation starts at 0

**Tier 1 - On-Chain Proven**:
- Wallet age > 6 months
- Transaction history > 100 txs
- Cross-protocol reputation (imported from Aave, Compound, etc.)
- Access: Standard features, moderate limits

**Tier 2 - Stake-Bound**:
- Locked stake (e.g., 1000 VIBE for 1 year)
- Stake slashable for violations
- Access: Full features, high limits

**Tier 3 - Identity-Verified (Optional)**:
- ZK-proof of unique personhood (e.g., Worldcoin, Proof of Humanity)
- Privacy-preserving: proves uniqueness without revealing identity
- Access: Maximum limits, governance weight bonus

### 19.3 Graceful Onboarding

New users aren't blocked—they're graduated:

```
Day 1:    Tier 0 - Can swap up to $1k/day, provide up to $10k LP
Day 30:   Activity builds reputation → Tier 1 access unlocked
Day 90:   Stakes VIBE → Tier 2 access unlocked
Day 365:  Consistent behavior → Tier 3 potential
```

This balances security (high barrier for risky features) with accessibility (anyone can start participating immediately).

---

## 20. Reputation-Gated Access Control

### 20.1 The Scaling Philosophy

Instead of binary access (yes/no), VibeSwap uses continuous scaling:

```
Access Level = f(Reputation, Stake, Account Age, Behavior Score)
```

This creates smooth incentive gradients that reward good behavior incrementally.

### 20.2 Feature Access Matrix

| Feature | Tier 0 (New) | Tier 1 (Proven) | Tier 2 (Staked) | Tier 3 (Verified) |
|---------|--------------|-----------------|-----------------|-------------------|
| **Spot Swaps** | $1k/day | $100k/day | $1M/day | Unlimited |
| **LP Provision** | $10k max | $500k max | $5M max | Unlimited |
| **Flash Loans** | Disabled | $10k max | $1M max | $10M max |
| **Leverage** | Disabled | 2x max | 5x max | 10x max |
| **Governance** | View only | 1x vote weight | 1.5x weight | 2x weight |
| **Priority Execution** | Disabled | Enabled | Priority queue | Front of queue |

### 20.3 Dynamic Limit Calculation

```solidity
function calculateLimit(
    address user,
    FeatureType feature
) public view returns (uint256) {
    TrustTier tier = getTrustTier(user);
    uint256 baseLimit = tierBaseLimits[tier][feature];

    // Reputation multiplier (0.5x to 2x based on reputation)
    uint256 reputation = getReputation(user);
    uint256 repMultiplier = 5000 + min(reputation, 10000) * 15000 / 10000;
    // At 0 rep: 0.5x, at max rep: 2x

    // Behavior score (recent activity quality)
    uint256 behaviorScore = getBehaviorScore(user);
    uint256 behaviorMultiplier = 8000 + behaviorScore * 4000 / 10000;
    // Range: 0.8x to 1.2x

    // Account age bonus (logarithmic)
    uint256 ageBonus = log2(getAccountAge(user) / 1 days + 1) * 500;
    // +5% per doubling of account age

    uint256 finalLimit = baseLimit
        * repMultiplier / 10000
        * behaviorMultiplier / 10000
        * (10000 + ageBonus) / 10000;

    return finalLimit;
}
```

---

## 21. Flash Loan and Leverage Controls

### 21.1 Flash Loan Protection

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

### 21.2 Flash Loan Implementation

```solidity
function executeFlashLoan(
    address receiver,
    address token,
    uint256 amount,
    bytes calldata data
) external nonReentrant {
    // 1. Reputation gate
    uint256 maxFlashLoan = calculateLimit(receiver, FeatureType.FLASH_LOAN);
    require(amount <= maxFlashLoan, "Exceeds reputation-based limit");

    // 2. Collateral requirement (scales inversely with reputation)
    uint256 collateralBps = getFlashLoanCollateralRequirement(receiver);
    // Tier 0: 100% collateral (defeats purpose)
    // Tier 1: 10% collateral
    // Tier 2: 1% collateral
    // Tier 3: 0.1% collateral

    uint256 requiredCollateral = amount * collateralBps / 10000;
    require(getAvailableCollateral(receiver) >= requiredCollateral);

    // 3. Lock collateral
    lockCollateral(receiver, requiredCollateral);

    // 4. Execute flash loan
    IERC20(token).transfer(receiver, amount);
    IFlashLoanReceiver(receiver).executeOperation(token, amount, data);

    // 5. Verify repayment
    uint256 fee = amount * FLASH_LOAN_FEE / 10000;
    require(
        IERC20(token).balanceOf(address(this)) >= preBalance + fee,
        "Flash loan not repaid"
    );

    // 6. Release collateral
    unlockCollateral(receiver, requiredCollateral);

    // 7. Reward good behavior
    reputationToken.increaseReputation(receiver, 1, "FLASH_LOAN_REPAID");
}
```

**Nash Equilibrium**:
- Honest users: Gain reputation over time → Lower collateral requirements → More profitable flash loans
- Attackers: Need high collateral (Tier 0) → Attack capital at risk → Attack becomes unprofitable

### 21.3 Leverage Parameters by Tier

Reputation affects both maximum leverage AND liquidation parameters:

```solidity
struct LeverageParams {
    uint256 maxLeverage;           // Maximum allowed leverage
    uint256 maintenanceMargin;     // Margin before liquidation
    uint256 liquidationPenalty;    // Penalty on liquidation
    uint256 gracePeriod;           // Time to add margin before liquidation
}
```

| Tier | Max Leverage | Maintenance Margin | Liquidation Penalty | Grace Period |
|------|-------------|-------------------|---------------------|--------------|
| Tier 0 | 0x (disabled) | N/A | N/A | N/A |
| Tier 1 | 2x | 20% | 10% | 1 hour |
| Tier 2 | 5x | 15% | 7% | 4 hours |
| Tier 3 | 10x | 10% | 5% | 12 hours |

**System Health Property**: Lower-reputation users have stricter requirements → System-wide leverage is bounded by reputation distribution → Prevents cascade liquidations from affecting high-reputation stable LPs.

---

# Part VI: Security Architecture

---

## 22. Threat Model

### 22.1 Attack Categories

| Category | Examples | Traditional Defense | Anti-Fragile Defense |
|----------|----------|---------------------|----------------------|
| **Smart Contract Exploits** | Reentrancy, overflow, logic bugs | Audits, formal verification | Insurance pools + bounties that grow from fees |
| **Economic Attacks** | Flash loans, oracle manipulation, sandwich | Circuit breakers, TWAPs | Reputation gates + attack profit redistribution |
| **Governance Attacks** | Vote buying, malicious proposals | Timelocks, quorums | Skin-in-the-game requirements + slashing |
| **Sybil Attacks** | Fake identities, wash trading | KYC, stake requirements | Soulbound reputation + behavioral analysis |
| **Griefing** | Spam, DoS, dust attacks | Gas costs, minimums | Attacker funds fund defender rewards |

### 22.2 Attacker Profiles

```
Rational Attacker: Maximizes profit, responds to incentives
  → Defense: Make attack NPV negative

Irrational Attacker: Destroys value without profit motive
  → Defense: Limit blast radius, rapid recovery

Sophisticated Attacker: Multi-step, cross-protocol attacks
  → Defense: Holistic monitoring, reputation across DeFi

Insider Attacker: Privileged access exploitation
  → Defense: Distributed control, mandatory delays
```

### 22.3 Security Invariants

These must NEVER be violated:

1. **Solvency**: `totalAssets >= totalLiabilities` always
2. **Atomicity**: Partial state = reverted state
3. **Authorization**: Only permitted actors can execute permitted actions
4. **Accountability**: Every action traceable to a reputation-staked identity

---

## 23. On-Chain Accountability System

### 23.1 "On-Chain Jail" Mechanism

When malicious behavior is detected, the wallet enters a restricted state:

```solidity
enum RestrictionLevel {
    NONE,           // Full access
    WATCH_LIST,     // Enhanced monitoring, normal access
    RESTRICTED,     // Limited functionality (no leverage, no flash loans)
    QUARANTINED,    // Can only withdraw existing positions
    BLACKLISTED     // Cannot interact with protocol at all
}

mapping(address => RestrictionLevel) public restrictions;
mapping(address => uint256) public restrictionExpiry; // 0 = permanent
```

### 23.2 Violation Detection & Response

```
Automated Detection:
├── Reentrancy patterns → Immediate QUARANTINE
├── Flash loan attack signatures → Immediate BLACKLIST
├── Wash trading patterns → RESTRICTED for 30 days
├── Unusual withdrawal patterns → WATCH_LIST + human review
└── Failed oracle manipulation → RESTRICTED + stake slash

Governance Detection:
├── Community report + evidence → Review committee
├── Bug bounty hunter report → Immediate response team
└── Cross-protocol alert → Automated WATCH_LIST
```

### 23.3 Slashing & Redistribution

When stakes are slashed, funds flow to defenders:

```solidity
function slashAndRedistribute(
    address violator,
    uint256 slashAmount,
    bytes32 violationType
) internal {
    uint256 stake = stakedBalance[violator];
    uint256 actualSlash = min(slashAmount, stake);

    stakedBalance[violator] -= actualSlash;

    // Distribution of slashed funds:
    uint256 toInsurance = actualSlash * 50 / 100;      // 50% to insurance pool
    uint256 toBounty = actualSlash * 30 / 100;         // 30% to reporter/detector
    uint256 toBurn = actualSlash * 20 / 100;           // 20% burned (deflation)

    insurancePool.deposit(toInsurance);
    bountyRewards[msg.sender] += toBounty;  // Reporter gets rewarded
    VIBE.burn(toBurn);

    emit Slashed(violator, actualSlash, violationType);
}
```

**Anti-Fragile Property**: Every attack that gets caught makes the insurance pool larger and rewards vigilant community members.

### 23.4 Appeals Process

False positives must be handleable:

```solidity
struct Appeal {
    address appellant;
    bytes32 evidenceHash;      // IPFS hash of appeal evidence
    uint256 bondAmount;        // Must stake to appeal (returned if successful)
    uint256 votingDeadline;
    uint256 forVotes;
    uint256 againstVotes;
    bool resolved;
}
```

1. User stakes appeal bond (returned if successful)
2. Evidence submitted to governance
3. Community vote on restoration
4. If approved: restrictions lifted, reputation compensated

---

## 24. Mutual Insurance Mechanism

### 24.1 Insurance Pool Architecture

```
                    ┌─────────────────────────────────────┐
                    │       MUTUAL INSURANCE POOL         │
                    ├─────────────────────────────────────┤
  Funding Sources:  │                                     │
  ├─ Protocol fees (10%)                                  │
  ├─ Slashed stakes ──────►  RESERVE POOL  ◄───── Claims │
  ├─ Violation penalties         │                        │
  └─ Voluntary deposits          │                        │
                                 ▼                        │
                         Coverage Tiers:                  │
                    ├─ Smart contract bugs: 80% coverage  │
                    ├─ Oracle failures: 60% coverage      │
                    ├─ Governance attacks: 50% coverage   │
                    └─ User error: 0% coverage            │
                    └─────────────────────────────────────┘
```

### 24.2 Coverage Calculation

```solidity
struct InsuranceCoverage {
    uint256 maxCoverage;          // Maximum claimable amount
    uint256 coverageRateBps;      // Percentage of loss covered
    uint256 deductibleBps;        // User pays first X%
    uint256 premiumRateBps;       // Annual premium rate
}
```

Coverage scales with participation and claim type:
- Smart contract bugs: 80% coverage
- Oracle failures: 60% coverage
- Governance attacks: 50% coverage
- User error: 0% coverage

Deductible inversely proportional to reputation:
- High reputation: 5% deductible
- Zero reputation: 20% deductible (effectively no coverage)

### 24.3 Claim Verification (Hybrid Approach)

```
Small Claims (< $10k):
  → Automated verification
  → On-chain evidence matching
  → 24-hour payout if valid

Medium Claims ($10k - $100k):
  → Committee review (elected reviewers)
  → 3-of-5 multisig approval
  → 7-day review period

Large Claims (> $100k):
  → Full governance vote
  → External audit requirement
  → 14-day review + 7-day timelock

Catastrophic Claims (> $1M or > 10% of pool):
  → Emergency pause
  → External arbitration (e.g., Kleros)
  → May trigger protocol upgrade
```

### 24.4 External Insurance Integration

For risks beyond on-chain coverage:

```solidity
interface IExternalInsurance {
    function verifyCoverage(address protocol, uint256 amount) external view returns (bool);
    function fileClaim(bytes32 incidentId, uint256 amount) external;
}

// Partner integrations
address public nexusMutualCover;    // Smart contract cover
address public insurAceCover;       // Cross-chain cover
address public unslashedCover;      // Slashing cover
```

---

## 25. Anti-Fragile Defense Loops

### 25.1 What is Anti-Fragility?

```
Fragile:      Breaks under stress
Robust:       Resists stress, stays same
Anti-Fragile: Gets STRONGER under stress
```

**Goal**: Design mechanisms where attacks make the system more secure.

### 25.2 Attack → Strength Conversion Loops

#### Loop 1: Failed Attacks Fund Defense

```
Attacker attempts exploit
        ↓
Attack detected & reverted
        ↓
Attacker's collateral/stake slashed
        ↓
Slashed funds distributed:
├── 50% → Insurance pool (more coverage)
├── 30% → Bug bounty pool (more hunters)
└── 20% → Burned (token value increase)
        ↓
Next attack is HARDER:
├── More insurance = less profitable target
├── More bounty hunters = faster detection
└── Higher token value = more stake at risk
```

#### Loop 2: Successful Attacks Trigger Upgrades

```
Attacker succeeds (worst case)
        ↓
Insurance pays affected users
        ↓
Post-mortem analysis
        ↓
Vulnerability patched
        ↓
Bounty pool INCREASED for similar bugs
        ↓
System now has:
├── Patched vulnerability
├── Larger bounty incentive
├── Community knowledge of attack vector
└── Precedent for insurance payouts
```

#### Loop 3: Reputation Attacks Strengthen Identity

```
Sybil attacker creates fake identities
        ↓
Behavioral analysis detects patterns
        ↓
Detection algorithm improves
        ↓
Legitimate users get "sybil-resistant" badge
        ↓
Next Sybil attack:
├── Easier to detect (better algorithms)
├── Less effective (legitimate users distinguished)
└── More expensive (need more sophisticated fakes)
```

### 25.3 Honeypot Mechanisms

Deliberately create attractive attack vectors that are actually traps:

```solidity
contract HoneypotVault {
    // Appears to have vulnerability (e.g., missing reentrancy guard)
    // Actually monitored and protected

    uint256 public honeypotBalance;
    mapping(address => bool) public knownAttackers;

    function vulnerableLookingFunction() external {
        // This LOOKS vulnerable but isn't
        // Any interaction triggers attacker flagging

        knownAttackers[msg.sender] = true;
        reputationToken.recordViolation(
            msg.sender,
            ViolationType.EXPLOIT_ATTEMPT,
            keccak256(abi.encode(msg.sender, block.number))
        );

        // Attacker is now flagged across entire protocol
        emit AttackerDetected(msg.sender);

        // Revert with misleading error to waste attacker time
        revert("Out of gas"); // Looks like failed attack, actually detection
    }
}
```

### 25.4 Graduated Response System

Response intensity scales with threat severity:

```
Threat Level 1 (Anomaly):
  → Increase monitoring
  → No user impact

Threat Level 2 (Suspicious):
  → Rate limit affected functions
  → Alert security committee

Threat Level 3 (Active Threat):
  → Pause affected feature
  → Notify all users
  → Begin incident response

Threat Level 4 (Active Exploit):
  → Emergency pause all features
  → Guardian multisig activated
  → External security partners notified

Threat Level 5 (Catastrophic):
  → Full protocol pause
  → User withdrawal-only mode
  → Governance emergency session
```

---

## 26. Nash Equilibrium Analysis

### 26.1 Defining the Security Game

**Players**: {Honest Users, Attackers, Protocol, Insurance Pool}

**Strategies**:
- Honest User: {Participate honestly, Attempt exploit, Exit}
- Attacker: {Attack, Don't attack}
- Protocol: {Defend, Don't defend}

### 26.2 Attack Payoff Analysis

For a rational attacker considering an exploit:

```
Expected Value of Attack = P(success) × Gain - P(failure) × Loss - Cost

Where:
  P(success) = Probability attack succeeds undetected
  Gain = Value extractable if successful
  P(failure) = 1 - P(success)
  Loss = Slashed stake + Reputation loss + Legal risk
  Cost = Development cost + Opportunity cost
```

**Design Goal**: Make EV(Attack) < 0 for all attack vectors

### 26.3 Parameter Calibration

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

### 26.4 Honest Behavior Dominance

For honest users:

```
EV(Honest) = Trading gains + LP fees + Reputation growth + Insurance coverage
EV(Attack) = Negative (as shown above)
EV(Exit) = Forfeit reputation + Early exit penalties

Honest > Attack (by design)
Honest > Exit (for long-term participants)
```

### 26.5 The Nash Equilibrium

The system reaches equilibrium when:

1. **Honest users prefer honesty**: Reputation gains + feature access > attack potential
2. **Attackers prefer not attacking**: EV(attack) < 0 for all known vectors
3. **LPs prefer staying**: Loyalty multipliers + IL protection > exit value
4. **Protocol prefers defending**: Insurance reserves remain solvent

### 26.6 Balancing Scale and Security

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

# Part VII: Price Intelligence

> **Note**: For the rigorous quantitative framework including Kalman filter state-space models, Bayesian estimation, and formal signal generation, see the companion document: [True Price Oracle](TRUE_PRICE_ORACLE.md). This section provides the conceptual overview.

---

## 27. Price Aggregation Architecture

### 27.1 Data Sources

**Tier 1: Centralized Exchanges** (high volume, high manipulation risk)
- Binance (spot and futures)
- Coinbase
- OKX
- Bybit
- Kraken

**Tier 2: Decentralized Exchanges** (lower volume, lower manipulation)
- Uniswap (Ethereum)
- PancakeSwap (BSC)
- Curve
- GMX (perps)

**Tier 3: Aggregators and Indices**
- CoinGecko
- CoinMarketCap
- Chainlink price feeds

**Tier 4: VibeSwap Internal**
- Our own batch auction clearing prices
- Commit-reveal protected, manipulation-resistant

### 27.2 Aggregation Model

```
                    ┌─────────────────────────────────────────┐
                    │       PRICE INTELLIGENCE ORACLE         │
                    ├─────────────────────────────────────────┤
                    │                                         │
   Binance ────────►│  ┌─────────────┐   ┌───────────────┐  │
   Coinbase ───────►│  │   Price     │   │   Anomaly     │  │
   OKX ────────────►│  │ Aggregator  │──►│  Detection    │  │
   Uniswap ────────►│  │             │   │               │  │
   VibeSwap ───────►│  └─────────────┘   └───────────────┘  │
                    │         │                   │          │
                    │         ▼                   ▼          │
                    │  ┌─────────────┐   ┌───────────────┐  │
                    │  │  Reference  │   │   Signal      │  │
                    │  │   Price     │   │  Generation   │  │
                    │  └─────────────┘   └───────────────┘  │
                    │                                         │
                    └─────────────────────────────────────────┘
```

### 27.3 Weighting by Reliability

Not all prices are equal:

```
Weight = f(Volume, Manipulation History, Decentralization, Latency)

Example weights:
  VibeSwap internal:     1.0  (manipulation-resistant by design)
  Chainlink aggregated:  0.9  (decentralized, slower)
  Coinbase:              0.7  (regulated, lower manipulation)
  Uniswap:               0.6  (decentralized but manipulable)
  Binance:               0.4  (high volume but manipulation-prone)
```

### 27.4 The Reference Price

Our **reference price** isn't a simple average. It's:

```
Reference Price = Σ(weight_i × price_i) / Σ(weight_i)

                  EXCLUDING anomalous prices (>2σ deviation)
```

This gives us a manipulation-resistant baseline to compare against.

---

## 28. Statistical Anomaly Detection

### 28.1 The Standard Deviation Framework

For any price series, we track:

```
μ (mu)     = Rolling mean price (e.g., 1-hour TWAP)
σ (sigma)  = Rolling standard deviation
Z-score    = (current_price - μ) / σ
```

### 28.2 Anomaly Classification

| Z-Score | Classification | Interpretation |
|---------|----------------|----------------|
| |Z| < 2σ | Normal | Within expected variance |
| 2σ ≤ |Z| < 3σ | Elevated | Unusual but possible |
| 3σ ≤ |Z| < 4σ | Anomalous | Likely manipulation or major event |
| |Z| ≥ 4σ | Extreme | Almost certainly not organic |

**Why 3σ matters**:
- In a normal distribution, 3σ events should occur 0.3% of the time
- In crypto, they occur far more frequently
- This excess is the **manipulation signature**

### 28.3 Multi-Source Divergence Detection

Single-source anomalies might be data errors. We look for **divergence patterns**:

```
Scenario: Binance shows -8% while others show -2%

Analysis:
  Binance:    $27,500 (-8%)
  Coinbase:   $29,200 (-2%)
  Uniswap:    $29,400 (-1.5%)
  VibeSwap:   $29,350 (-1.7%)

  Binance divergence: 5.8% below consensus
  Z-score of divergence: 4.2σ

Signal: MANIPULATION DETECTED on Binance
        Likely liquidation hunt
        Expect rubber band to ~$29,300
```

### 28.4 Time-Series Anomaly Patterns

Beyond point-in-time anomalies, we track patterns:

**Spike-and-Revert**: Sudden move followed by rapid return
```
Price: 30000 → 28500 → 29800 (in 5 minutes)
Pattern: Classic liquidation cascade + recovery
```

**Staircase Down**: Sequential liquidation levels being hit
```
Price: 30000 → 29500 → 29000 → 28500 (at regular intervals)
Pattern: Systematic liquidation hunting
```

**Volume Divergence**: Price moves on unusually low or high volume
```
Price: -5% move on 20% of normal volume
Pattern: Likely wash trading or thin book manipulation
```

### 28.5 Confidence Scoring

Each anomaly gets a confidence score:

```
Confidence = f(
  Z-score magnitude,
  Number of sources diverging,
  Historical pattern match,
  Time of day (low liquidity = higher manipulation probability),
  Recent liquidation volume
)
```

High confidence anomalies become trading signals.

---

## 29. Liquidation Cascade Identification

### 29.1 The Liquidation Problem

Leverage is the primary weapon of manipulation:

```
Binance BTC Futures Open Interest: $5+ billion
Typical leverage: 10-50x

At 20x leverage:
  5% adverse move = 100% loss = liquidation

Liquidation levels cluster at round numbers:
  $30,000, $29,500, $29,000, etc.
```

When price hits these levels, **forced selling** accelerates the move.

### 29.2 Liquidation Data Sources

**Direct data** (where available):
- Exchange liquidation feeds
- On-chain liquidation events (DeFi protocols)
- Funding rate extremes (indicate crowded positioning)

**Inferred data**:
- Open interest changes
- Volume spikes without corresponding spot flow
- Order book shape changes

### 29.3 Liquidation Cascade Model

```
Pre-Cascade Indicators:
├── Funding rate > 0.1% (longs paying premium)
├── Open interest at local high
├── Price approaching round number liquidation level
└── Low spot volume relative to derivatives

Cascade Confirmation:
├── Open interest drops > 5% in minutes
├── Liquidation volume spike
├── Price moves faster than spot selling could cause
└── Spread between spot and perps widens

Post-Cascade:
├── Open interest stabilizes at lower level
├── Funding rate normalizes or reverses
├── Price stabilizes or reverses
└── Rubber band potential HIGH
```

### 29.4 Real vs. Fake Price Movement

**Real price discovery**:
- Driven by spot buying/selling
- Volume consistent with move magnitude
- News or fundamentals explain the move
- Sustained at new level

**Liquidation-driven (fake)**:
- Derivatives volume >> spot volume
- Open interest drops rapidly
- No fundamental news
- Quick reversion likely

We classify each move as **real** or **liquidation-driven** with a probability score.

---

## 30. Rubber Band Reversion Model

### 30.1 The Rubber Band Hypothesis

**Manipulation creates temporary mispricings.** Like a rubber band stretched too far, prices tend to snap back.

```
Fair value: $30,000
Manipulation pushes to: $28,000 (liquidation cascade)
Expected reversion: $29,500-$30,000

The further from fair value, the stronger the snap-back force.
```

### 30.2 Reversion Probability Model

```
P(reversion) = f(
  Deviation magnitude,        # Larger = more likely to revert
  Move velocity,              # Faster = more likely manipulation
  Volume profile,             # Low volume = more likely fake
  Liquidation signature,      # Liquidation = high reversion probability
  Time of day,                # Low liquidity = higher manipulation
  Historical pattern match    # Similar past events
)
```

### 30.3 Reversion Targets

Not just "will it revert?" but "to where?"

```
Level 1 (50% reversion):
  Target = manipulation_low + 0.5 × (pre_manipulation - manipulation_low)

Level 2 (75% reversion):
  Target = manipulation_low + 0.75 × (pre_manipulation - manipulation_low)

Level 3 (Full reversion):
  Target = pre_manipulation_price

Level 4 (Overshoot):
  Target > pre_manipulation (short squeeze)
```

### 30.4 Timing Model

**How fast will it revert?**

```
Fast reversion (minutes):
  - Flash crash pattern
  - Obvious manipulation
  - Strong buying response

Slow reversion (hours):
  - Sustained fear/uncertainty
  - Multiple liquidation waves
  - Weak buying interest

No reversion:
  - Fundamental news justified move
  - Trend change, not manipulation
  - New information incorporated
```

### 30.5 Signal Generation

```
RUBBER BAND SIGNAL:

  Trigger: 3.5σ deviation detected on Binance
           Liquidation cascade confirmed
           Low spot volume

  Direction: LONG (expecting reversion up)

  Confidence: 78%

  Targets:
    T1 (50% reversion): $29,000 - Probability 85%
    T2 (75% reversion): $29,500 - Probability 65%
    T3 (Full):          $30,000 - Probability 45%

  Timeframe: 1-4 hours

  Stop-loss: Below liquidation low ($27,800)
```

---

## 31. Flash Crash and Flash Loan Detection

### 31.1 Flash Crash Signatures

**Traditional flash crash**:
- Extreme move in seconds/minutes
- Often triggered by algorithm malfunction or fat finger
- Immediate partial recovery
- Full recovery within hours

**Crypto flash crash**:
- Similar pattern but often intentional
- Triggered by large market sells into thin books
- Liquidation cascades amplify the move
- Recovery depends on buying interest

### 31.2 Flash Loan Attack Patterns

On-chain manipulation via flash loans:

```
Flash Loan Attack Pattern:
1. Borrow massive amount (no collateral needed)
2. Manipulate DEX price (large swap)
3. Exploit protocols using that price
4. Return loan + keep profit
5. Price reverts after loan repaid

Duration: 1 block (12 seconds on Ethereum)
```

**Detection**:
- Extreme intra-block price movement
- Price returns to pre-attack level within blocks
- Large swap volume from single address
- Protocol exploits occurring simultaneously

### 31.3 Real-Time Flash Detection

```
Monitoring Loop:
  Every block:
    Calculate block-to-block price change
    If change > threshold (e.g., 2%):
      Check volume source (single large trade?)
      Check if followed by immediate reversion
      Check for protocol interactions

      If flash loan pattern matched:
        Flag as MANIPULATION
        Do NOT use this price for oracles
        Alert trading signals
```

### 31.4 Cross-DEX Flash Detection

Flash loans often manipulate one DEX to exploit another:

```
Attack: Manipulate Uniswap price down
        Liquidate positions on Aave using Uniswap oracle
        Uniswap price reverts

Detection:
  Monitor price divergence between DEXs
  If one DEX diverges >5% from others for <5 blocks:
    Likely flash loan manipulation
    Ignore divergent price
    Use consensus of other sources
```

---

## 32. Reputation-Weighted Signal Network

### 32.1 The Problem with Signals

Anyone can claim to have trading signals. Most are:
- Random noise presented as insight
- Survivorship bias (show winners, hide losers)
- Pump and dump schemes
- Simply wrong

### 32.2 Soulbound Reputation for Traders

Extend VibeSwap's soulbound reputation system to signal providers:

```
Trader Reputation Score = f(
  Prediction accuracy,       # Were their signals correct?
  Risk-adjusted returns,     # Sharpe ratio of following signals
  Consistency,               # Stable performance, not one lucky call
  Transparency,              # Do they explain reasoning?
  Ethics track record,       # No pump-and-dump history
  Stake at risk              # Skin in the game
)
```

### 32.3 Signal Provider Tiers

| Tier | Requirements | Weight in Consensus |
|------|--------------|---------------------|
| **Verified Oracle** | 70%+ accuracy over 6+ months, staked collateral, identity verified | 1.0x |
| **Trusted Trader** | 60%+ accuracy over 3+ months, reputation stake | 0.7x |
| **Established** | Positive track record, some stake | 0.4x |
| **Newcomer** | Limited history, minimal stake | 0.1x |
| **Flagged** | Poor accuracy or ethics violations | 0x (excluded) |

### 32.4 Ethical Whitelist Criteria

Not just accuracy—**ethics**:

```
Whitelist Requirements:
├── No pump-and-dump history
├── Signals given BEFORE taking position (not after)
├── Transparent about conflicts of interest
├── No wash trading on signal tokens
├── Consistent methodology explanation
└── Accepts accountability (slashing for bad behavior)
```

### 32.5 Consensus Signal Aggregation

Individual signals are noisy. Aggregate them:

```
Consensus Signal = Σ(reputation_weight × signal) / Σ(reputation_weight)

Where signal ∈ {-1 (bearish), 0 (neutral), +1 (bullish)}

Example:
  Verified Oracle A (weight 1.0): BULLISH (+1)
  Trusted Trader B (weight 0.7): BULLISH (+1)
  Trusted Trader C (weight 0.7): NEUTRAL (0)
  Established D (weight 0.4): BEARISH (-1)

  Consensus = (1×1 + 0.7×1 + 0.7×0 + 0.4×-1) / (1 + 0.7 + 0.7 + 0.4)
            = 1.3 / 2.8
            = 0.46 (Moderately bullish)
```

### 32.6 Slashing for Bad Signals

Reputation has consequences:

```
Signal Outcome Tracking:
  Signal given: BULLISH on BTC at $30,000
  Timeframe: 24 hours
  Threshold: 2% move

Outcome Scenarios:
  BTC at $30,600 (+2%): CORRECT → Reputation +5
  BTC at $30,200 (+0.7%): NEUTRAL → Reputation +0
  BTC at $29,400 (-2%): INCORRECT → Reputation -10

Consistent incorrect signals:
  → Tier demotion
  → Eventual blacklist
  → Stake slashing for egregious cases
```

### 32.7 Privacy-Preserving Signals

Traders don't want to reveal their exact positions:

```
Signal Types:
  Direction only: "Bullish on ETH" (no size/entry)
  Confidence level: "High conviction long"
  Timeframe: "Next 4-24 hours"

Traders reveal reasoning, not positions.
Reputation tracks directional accuracy, not PnL.
```

---

# Part VIII: Integration

---

## 33. How It All Fits Together

### 33.1 The Complete System

VibeSwap isn't a collection of independent features. It's an **integrated system** where each component reinforces the others:

```
PHILOSOPHY
    │
    ▼
MECHANISM (Batch Auctions + Commit-Reveal)
    │
    ├──► TRUE PRICES (No front-running, no sandwiching)
    │        │
    │        ▼
    ├──► FAIR REWARDS (Shapley distribution)
    │        │
    │        ▼
    └──► REPUTATION (Soulbound identity enables access control)
             │
             ├──► SECURITY (Anti-fragile defense loops)
             │        │
             │        ▼
             └──► PRICE INTELLIGENCE (Manipulation detection feeds back)
                      │
                      └──► BETTER PRICES (Full circle)
```

### 33.2 Feedback Loops

**Loop 1: Reputation → Access → Reputation**
- Good behavior → Higher reputation
- Higher reputation → More access
- More participation → More reputation building opportunities

**Loop 2: Security → Insurance → Security**
- Attacks detected → Stakes slashed
- Slashed funds → Insurance pool
- Larger insurance → More coverage → Better security

**Loop 3: Prices → Signals → Prices**
- Manipulation detected → Signals generated
- Signals used → Better execution
- Better execution → More accurate prices

### 33.3 The Positive-Sum Result

All mechanisms align:

| Participant | Individual Incentive | System Benefit |
|-------------|---------------------|----------------|
| Traders | Better execution | Price discovery |
| LPs | Higher fees, IL protection | Liquidity provision |
| Arbitrageurs | Pay for priority | Prices stay accurate |
| Signal providers | Reputation + rewards | Information aggregation |
| Security reporters | Bounties | System hardening |

Everyone acts in self-interest. The system is designed so that self-interest produces collective benefit.

---

## 34. Contract Architecture

### 34.1 System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    IDENTITY LAYER                                │
│  SoulboundToken ←→ ReputationOracle ←→ AccessController         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   SECURITY LAYER                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Violation   │  │  Insurance   │  │   Appeal     │          │
│  │   Registry   │◄─┤    Pool      │◄─┤   Court      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                          │                                       │
│                          ▼                                       │
│               ┌──────────────────┐                              │
│               │ Security Council │ (Emergency multisig)         │
│               └──────────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   INCENTIVE LAYER                                │
│  IncentiveController (Coordinator)                              │
│  ├── ShapleyDistributor                                         │
│  ├── ILProtectionVault                                          │
│  ├── LoyaltyRewardsManager                                      │
│  ├── SlippageGuaranteeFund                                      │
│  ├── VolatilityInsurancePool                                    │
│  └── VolatilityOracle                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  PRICE INTELLIGENCE LAYER                        │
│  PriceIntelligenceOracle                                        │
│  ├── MultiSourceAggregator                                      │
│  ├── AnomalyDetector                                            │
│  ├── LiquidationCascadeMonitor                                  │
│  ├── RubberBandPredictor                                        │
│  └── SignalNetwork                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CORE LAYER                                    │
│  VibeSwapCore ←→ VibeAMM ←→ CommitRevealAuction                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  CROSS-CHAIN LAYER                               │
│  CrossChainRouter (LayerZero V2 OApp)                           │
│  └── DAOTreasury (Backstop + Treasury Stabilizer)               │
└─────────────────────────────────────────────────────────────────┘
```

### 34.2 Data Flow

```
User submits order
        ↓
AccessController checks reputation/limits
        ↓
CommitRevealAuction accepts commit
        ↓
[Wait for reveal phase]
        ↓
User reveals order
        ↓
PriceIntelligenceOracle provides reference price
        ↓
VibeAMM calculates clearing price
        ↓
ShapleyDistributor allocates rewards
        ↓
ReputationOracle updates user reputation
        ↓
User receives tokens + reputation
```

### 34.3 Deployment Sequence

```
1. Deploy SoulboundToken (non-transferable ERC-721)
2. Deploy ReputationOracle (reads from SoulboundToken)
3. Deploy ViolationRegistry (writes to SoulboundToken)
4. Deploy InsurancePool (funded by protocol fees)
5. Deploy AccessController (reads ReputationOracle)
6. Deploy AppealCourt (governance-controlled)
7. Deploy SecurityCouncil (multisig for emergencies)
8. Deploy IncentiveController and sub-contracts
9. Deploy PriceIntelligenceOracle
10. Deploy VibeAMM and CommitRevealAuction
11. Deploy VibeSwapCore (main entry point)
12. Deploy CrossChainRouter (LayerZero integration)
13. Wire all contracts together
14. Transfer ownership to governance (with timelock)
```

---

## 35. Conclusion

### 35.1 The Thesis

**True price discovery requires cooperation, not competition.**

Current markets are adversarial by accident, not necessity. The same game theory that explains extraction can design cooperation.

### 35.2 The Complete Mechanism

```
Commit-Reveal Batching
       ↓
No information leakage
       ↓
Uniform Clearing Price
       ↓
No execution advantage
       ↓
Shapley Distribution
       ↓
Rewards for contribution
       ↓
Soulbound Reputation
       ↓
Accountable participation
       ↓
Anti-Fragile Security
       ↓
Attacks strengthen system
       ↓
Price Intelligence
       ↓
Manipulation detected
       ↓
Nash Equilibrium
       ↓
Honest revelation is dominant strategy
       ↓
TRUE PRICE DISCOVERY
```

### 35.3 The Philosophy

Cooperative capitalism isn't about eliminating self-interest. It's about **channeling** self-interest toward collective benefit.

- Competition where it helps (innovation, efficiency)
- Cooperation where it helps (price discovery, risk management)

Markets as **positive-sum games**, not zero-sum extraction.

### 35.4 The Result

A protocol where:

- **Honest behavior is the dominant strategy** (Nash equilibrium)
- **Attacks make the system stronger** (anti-fragility)
- **New users can participate immediately** (accessibility)
- **Bad actors face permanent consequences** (accountability)
- **Long-term commitment is rewarded** (sustainability)
- **Manipulation is detected and predicted** (intelligence)
- **True prices emerge** (the goal)

### 35.5 The Invitation

We've shown that cooperative price discovery is:
- Theoretically sound (game-theoretically optimal)
- Practically implementable (commit-reveal, batch auctions)
- Incentive-compatible (honest revelation is dominant)
- Secure (anti-fragile defense architecture)
- Intelligent (manipulation detection and prediction)

The technology exists. The math works. The question is whether we choose to build it.

Markets can be cooperative. Prices can be true. Capitalism can serve everyone.

We just have to design it that way.

---

# Appendices

---

## Appendix A: Mathematical Foundations

### Shapley Value Formula

```
φᵢ(v) = Σ [|S|!(|N|-|S|-1)! / |N|!] × [v(S ∪ {i}) - v(S)]
```

### Uniform Clearing Price

```
P* = argmax Σmin(demand(p), supply(p))
```

### Nash Equilibrium Condition

```
∀i: uᵢ(sᵢ*, s₋ᵢ*) ≥ uᵢ(sᵢ, s₋ᵢ*) for all sᵢ
```

### Revelation Principle

```
Any equilibrium outcome achievable with strategic behavior
can also be achieved with a mechanism where truth-telling is optimal.
```

### Impermanent Loss

```
IL = 2√r / (1 + r) - 1
where r = max(P₁/P₀, P₀/P₁)
```

### Shapley Time Score

```
timeScore = log₂(days + 1) × 0.1
```

### Volatility (Annualized)

```
σ = √(Var(ln(Pᵢ/Pᵢ₋₁))) × √(periods_per_year)
```

### Attack Expected Value

```
EV = P(success) × Gain - P(failure) × Stake - Cost
Design constraint: EV < 0 for all vectors
```

### Access Scaling

```
Access(rep) = BaseAccess × (0.5 + rep/maxRep)
Range: 50% (new) to 150% (max reputation)
```

### Z-Score Calculation

```
Z = (X - μ) / σ

Where:
  X = Current price
  μ = Rolling mean (e.g., 1-hour TWAP)
  σ = Rolling standard deviation
```

### Divergence Score

```
D = |P_source - P_reference| / P_reference × 100%
```

### Reversion Probability Model (simplified)

```
P(reversion) = base_rate × (1 + α×Z + β×liquidation_flag + γ×pattern_match)

Where:
  base_rate ≈ 0.5 (no information)
  α, β, γ = coefficients fit to historical data
```

---

## Appendix B: Key Parameters

### Shapley Distribution Parameters

| Parameter | Default Value | Rationale |
|-----------|---------------|-----------|
| Direct Weight | 40% | Largest factor is actual contribution |
| Time Weight | 30% | Significant reward for commitment |
| Scarcity Weight | 20% | Reward enabling trades |
| Stability Weight | 10% | Bonus for volatility presence |

### IL Protection Parameters

| Parameter | Default Value | Rationale |
|-----------|---------------|-----------|
| Tier 0 Coverage | 25% | Immediate partial protection |
| Tier 1 Coverage | 50% | Standard protection |
| Tier 2 Coverage | 80% | Premium protection |

### Loyalty Rewards Parameters

| Parameter | Default Value | Rationale |
|-----------|---------------|-----------|
| Max Multiplier | 2.0x | Double rewards for 1-year commitment |
| Bronze Duration | 7 days | Minimum commitment |
| Platinum Duration | 365 days | Maximum loyalty tier |

### Security Parameters

| Parameter | Recommended Value | Rationale |
|-----------|-------------------|-----------|
| Minimum stake | 1000 VIBE | Entry barrier for serious participation |
| Slash rate | 100% | Full accountability |
| Detection target | 95% | Makes most attacks negative EV |
| Insurance coverage | 80% | Meaningful protection, not moral hazard |
| Appeal bond | 0.5 ETH | Prevents frivolous appeals |
| Upgrade timelock | 7 days | Time for community review |
| Emergency pause threshold | 5% TVL drop in 1 hour | Detect flash crashes/exploits |

### Price Intelligence Parameters

| Parameter | Default Value | Rationale |
|-----------|---------------|-----------|
| Anomaly threshold | 3σ | Statistical significance |
| Extreme threshold | 4σ | Almost certainly manipulation |
| Liquidation drop threshold | 5% OI in minutes | Cascade confirmation |
| Flash detection threshold | 2% per block | Extreme intra-block movement |

---

## Appendix C: Comparison of Market Mechanisms

| Property | Continuous Order Book | AMM | VibeSwap Batch Auction |
|----------|----------------------|-----|------------------------|
| Information leakage | High | High | None |
| Front-running possible | Yes | Yes | No |
| Sandwich attacks | Yes | Yes | No |
| Execution speed matters | Critical | Important | Irrelevant |
| Price reflects | Recent trades | Pool ratio | Batch supply/demand |
| LP adverse selection | Severe | Severe | Minimal |
| Honest revelation optimal | No | No | Yes |
| MEV extraction | High | High | Eliminated |
| Fair ordering | No | No | Yes (deterministic shuffle) |
| Priority auction | No | No | Yes (funds LPs) |
| Reputation integration | No | No | Yes (soulbound) |
| Manipulation detection | No | No | Yes (price intelligence) |
| Anti-fragile security | No | No | Yes |

---

*"The question is not whether markets work. The question is: work for whom?"*

*Cooperative capitalism answers: for everyone.*

---

**VibeSwap** - True Price Discovery Through Cooperative Design

---

**Document Version**: 1.0
**Date**: February 2026
**Components**:
- True Price Discovery Philosophy
- Incentives Whitepaper
- Security Mechanism Design
- Price Intelligence Oracle
- True Price Oracle (Quantitative Framework)

**Related Documents**:
- [True Price Oracle](TRUE_PRICE_ORACLE.md) - Rigorous quantitative framework with Kalman filter state-space model, Bayesian estimation, regime detection, and signal generation

**License**: MIT
