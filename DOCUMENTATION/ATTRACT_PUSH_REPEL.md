# Attract-Push-Repel: Force Duality in Markets, Communities, and Protocol Design

**Faraday1**

**March 2026**

---

## Abstract

Every force in a coordinated system creates its counterforce. Selling pressure creates buying opportunity. Gatekeeping creates desire. Chasing validation repels credibility. This paper formalizes what we call the Attract-Push-Repel (APR) duality: *you attract what you push and repel, and you push and repel that which you pull.* We apply this principle to five domains --- markets, liquidity, community, ideas, and identity --- and demonstrate that VibeSwap's architecture exploits APR duality by refusing to pull. Where conventional protocols pursue liquidity through aggressive incentives (pull), VibeSwap makes itself the path of least resistance (push), which attracts liquidity organically. We connect APR duality to the JP Morgan Formula ("they optimize for X, we optimize for Y"), to the Graceful Inversion Doctrine (positive-sum mutualistic absorption rather than hostile disruption), and to Cooperative Capitalism (competition pushes, cooperation pulls, together they create stable equilibrium). The thesis: systems that understand force duality outperform systems that apply force naively, because every naive pull generates the repulsion that defeats it.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Duality Principle](#2-the-duality-principle)
3. [Application: Markets](#3-application-markets)
4. [Application: Liquidity](#4-application-liquidity)
5. [Application: Community](#5-application-community)
6. [Application: Ideas](#6-application-ideas)
7. [Application: Identity](#7-application-identity)
8. [Connection to Cooperative Capitalism](#8-connection-to-cooperative-capitalism)
9. [Connection to Graceful Inversion](#9-connection-to-graceful-inversion)
10. [The JP Morgan Formula](#10-the-jp-morgan-formula)
11. [Formal Structure](#11-formal-structure)
12. [Implications for Protocol Design](#12-implications-for-protocol-design)
13. [Conclusion](#13-conclusion)

---

## 1. Introduction

### 1.1 Force and Counterforce

Newtonian mechanics teaches that every action has an equal and opposite reaction. Economics teaches that every price movement creates its correction. Sociology teaches that every cultural norm generates its counter-culture. These are not analogies. They are instances of the same underlying principle: *forces in coordinated systems generate counterforces.*

The DeFi industry has learned this lesson the hard way. Liquidity mining programs (pull) attract mercenary capital that leaves the moment incentives end (repel). Aggressive token launches (pull) create sell pressure from speculators who never intended to stay (repel). Community gatekeeping (push) creates desire in precisely the people most likely to contribute (attract).

Yet protocol teams continue to design as if forces were unidirectional --- as if pulling harder produces more attraction without limit, and pushing harder produces more repulsion without limit. They are wrong on both counts.

### 1.2 The APR Principle

The principle, stated precisely:

> **You attract what you push and repel, and you push and repel that which you pull.**

This is not a paradox. It is the fundamental dynamic of all coordinated systems. Pushing creates scarcity, and scarcity creates desire. Pulling creates desperation, and desperation creates aversion. The relationship between force and outcome is not linear. It is dual.

---

## 2. The Duality Principle

### 2.1 Definitions

| Term | Definition |
|------|-----------|
| **Push** | Any action that creates distance, scarcity, or boundary between the actor and a target |
| **Pull** | Any action that attempts to reduce distance, increase access, or remove boundaries |
| **Attract** | The emergent response where the target moves toward the actor |
| **Repel** | The emergent response where the target moves away from the actor |

### 2.2 The Duality Table

| Action | Intended Effect | Actual Effect | Mechanism |
|--------|----------------|---------------|-----------|
| Push (create boundary) | Distance | Attraction | Scarcity creates desire |
| Pull (remove boundary) | Closeness | Repulsion | Desperation creates aversion |
| Push + Pull (balanced) | Oscillation | Stable equilibrium | Forces cancel, orbit forms |
| Neither (path of least resistance) | Neutral | Organic flow | No counterforce generated |

### 2.3 The Critical Insight

The most effective strategy is often *neither push nor pull*. When a system makes itself the path of least resistance --- not pulling users in, not pushing them away --- it attracts flow without generating counterforce. Water does not pull or push. It finds the lowest point. The architect who shapes the landscape determines where water flows without touching the water.

---

## 3. Application: Markets

### 3.1 Selling Pressure Creates Buying Opportunity

When a large holder sells (push), the price drops. The price drop creates a buying opportunity. Buyers who were waiting for a better entry point now act. The sell pressure *attracted* buy pressure. This is not speculation. It is the mechanism by which markets mean-revert.

### 3.2 Buying Pressure Creates Sell Walls

When demand spikes (pull), the price rises. The price rise motivates existing holders to sell at profit. The buy pressure *created* the sell wall. Every rally generates its own resistance.

### 3.3 The Order Book as APR Visualization

```
Sell Wall (push by sellers)     ████████████  $105.00
                                ██████████    $104.50
                                ████████      $104.00
--- Current Price ---           ─────────     $103.50
                                ██████        $103.00
                                ████████████  $102.50
Buy Wall (push by buyers)      ██████████████$102.00
```

Each wall is simultaneously a push (resistance to price movement) and an attract (opportunity for the opposing side). The order book is a static snapshot of APR duality in action.

### 3.4 VibeSwap's Response

Batch auctions dissolve the temporal structure of push-pull dynamics. By processing all orders simultaneously at a uniform clearing price, the protocol eliminates the sequential information asymmetry that allows one side's push to be exploited by the other side's pull. The clearing price is the equilibrium that push and pull would have reached --- without the extraction that occurs during the convergence process.

---

## 4. Application: Liquidity

### 4.1 The Liquidity Paradox

The harder a protocol pulls for liquidity, the more liquidity fragments:

| Pull Strategy | Intended Effect | Actual Effect |
|--------------|----------------|---------------|
| High APY liquidity mining | Attract permanent LPs | Attract mercenary capital that leaves when APY drops |
| Exclusive partnerships | Lock liquidity in one venue | Fragment liquidity across competing exclusive deals |
| Vampire attacks | Drain competitor liquidity | Trigger counter-attacks, fragment ecosystem |
| Bribing governance | Direct liquidity flows | Inflate bribe costs, create bribe dependency |

Each strategy is a pull. Each pull generates its repulsion. The mercenary capital that liquidity mining attracts is the *counterforce* to the pull --- it is liquidity that repels permanence.

### 4.2 VibeSwap's Path-of-Least-Resistance

VibeSwap does not pull liquidity. It creates conditions where liquidity flows naturally:

| Conventional Protocol (Pull) | VibeSwap (Path of Least Resistance) |
|------------------------------|-------------------------------------|
| Pay LPs to come | Make LP experience so fair that leaving costs more than staying |
| Lock liquidity with penalties | Reward consistency via Shapley (no lock required) |
| Outbid competitors | Offer structural guarantees competitors cannot match (MEV elimination) |
| Chase TVL metrics | Let TVL emerge from genuine utility |

The Graceful Inversion Doctrine states: *not hostile zero-sum disruption, but seamless mutualistic symmetrical positive-sum absorption.* This is APR duality applied to competitive strategy: do not pull liquidity from competitors (which creates counterforce). Make yourself the path of least resistance (which generates no counterforce).

---

## 5. Application: Community

### 5.1 Gatekeeping Attracts; Desperation Repels

| Community Strategy | APR Classification | Effect on Quality Members |
|-------------------|-------------------|---------------------------|
| "Anyone can join, we need everyone" | Pure pull | Repels quality (low signal-to-noise) |
| "Prove yourself to earn access" | Moderate push | Attracts quality (challenge = selection) |
| "We don't need more members" | Strong push | Strongly attracts quality (scarcity + confidence) |
| "Please join us, we're desperate" | Desperate pull | Maximally repels quality |

The communities with the highest quality members are typically those that push hardest. Not through hostility, but through *standards*. Having standards is a push. Standards create scarcity. Scarcity attracts people who meet the standard and want to prove it.

### 5.2 VibeSwap's Community Design

VibeSwap's Shapley-based contribution scoring is a natural push mechanism:

- Contributing meaningfully is hard (push)
- High Shapley scores are scarce (push)
- Scarcity creates desire to earn high scores (attract)
- Desire drives genuine contribution (community health)

The alternative --- rewarding everyone equally regardless of contribution --- is a pull (come get your free tokens). The pull attracts freeloaders and repels genuine contributors, who feel their effort is not valued.

---

## 6. Application: Ideas

### 6.1 Forcing Ideas Creates Curiosity

When a person states a position firmly (push), others become curious about why. The confidence signals that the position is worth understanding. Confident statements attract engagement even --- especially --- from those who initially disagree.

### 6.2 Chasing Validation Repels Credibility

When a person seeks approval for their ideas (pull), others sense the insecurity. The pull for validation *repels* the credibility that would have made validation unnecessary. Ideas that need permission to exist are ideas that do not deserve it.

| Idea Communication | APR Type | Outcome |
|-------------------|----------|---------|
| "Here is what we believe. Take it or leave it." | Push | Attracts engagement, respect, critique |
| "What do you think? Is this good? Should we pivot?" | Pull | Repels confidence, attracts doubt |
| "We built this. It works. Here are the proofs." | Push (evidence-backed) | Strongest attraction |
| "Please try our product, we really need users" | Pull (desperation) | Strongest repulsion |

### 6.3 Implication for VibeSwap

VibeSwap's documentation, research papers, and public communication should state positions rather than seek validation. "Batch auctions eliminate MEV" is a push. "Do you think batch auctions might help with MEV?" is a pull. The former attracts engagement. The latter repels confidence.

---

## 7. Application: Identity

### 7.1 State Positions, Attract Engagement

An identity that pushes --- states positions, sets boundaries, holds standards --- attracts respect and engagement. An identity that pulls --- chases relevance, seeks approval, follows trends --- repels both.

| Identity Strategy | APR Type | Result |
|------------------|----------|--------|
| State positions publicly | Push | Attract engagement, allies, and worthy adversaries |
| Chase trending topics for visibility | Pull | Repel credibility, attract only shallow attention |
| Build in public with conviction | Push | Attract builders, investors, community |
| Beg for attention on social media | Pull | Repel everyone except other attention-seekers |

### 7.2 Protocol Identity

Protocols have identity just as people do. A protocol that chases every trend (pull) --- launching an NFT collection this month, an AI integration next month, a memecoin the month after --- repels serious users. A protocol that maintains focus on its core thesis (push) attracts serious users who share that thesis.

VibeSwap's identity is a push: *batch auctions, Shapley fairness, zero extraction, cooperative capitalism.* The protocol does not chase trends. It states what it believes and builds accordingly. The push attracts those who resonate. The absence of pull avoids generating counterforce.

---

## 8. Connection to Cooperative Capitalism

### 8.1 Competition as Push, Cooperation as Pull

In VibeSwap's Cooperative Capitalism framework:

- **Competition** is push: priority auctions, arbitrage, merit-based rewards
- **Cooperation** is pull: insurance pools, treasury stabilization, mutualized risk

The two forces create stable equilibrium when balanced. Pure competition (all push) fragments the system --- every competitive advantage creates its counterforce. Pure cooperation (all pull) collapses the system --- free riders exploit the pull. The combination creates orbit: competitive push generates value, cooperative pull distributes it, and the system sustains itself.

### 8.2 The Equilibrium Condition

```
Competitive Push (priority bids, Shapley competition)
        │
        ▼
    Value Generated
        │
        ▼
Cooperative Pull (insurance pools, IL protection)
        │
        ▼
    Value Distributed
        │
        ▼
Competitive Push (next epoch)
        │
        ... (stable cycle)
```

The cycle is stable because each force generates the conditions for the next. Competition creates surplus. Surplus funds cooperation. Cooperation creates safety. Safety attracts more competitors. More competitors create more surplus. The system deepens.

---

## 9. Connection to Graceful Inversion

### 9.1 Absorption, Not Extraction

The Graceful Inversion Doctrine states:

> "We don't want to crash the market through 'disruption' necessarily but seamless mutualistic symmetrical positive-sum absorption of their liquidity."

In APR terms: disruption is a pull (we want your users, your liquidity, your market share). Pulling from competitors generates counterforce --- legal challenges, competitive responses, community resistance. Graceful inversion is a push (we are building something different) that attracts without generating counterforce.

### 9.2 The Inversion in Practice

| Traditional Disruption (Pull) | Graceful Inversion (Push) |
|------------------------------|---------------------------|
| Vampire attack competitor liquidity | Build superior mechanism, let liquidity flow naturally |
| Negative marketing against competitors | Positive positioning of own advantages |
| Fork competitor code, steal community | Create novel mechanism that attracts new community |
| Race to bottom on fees | Provide structural fairness that justifies any fee level |

The inversion is complete: the strategy that *appears* passive (not pulling) is the strategy that *actually* generates the strongest attraction. The strategy that *appears* aggressive (pulling) is the strategy that *actually* generates the strongest resistance.

---

## 10. The JP Morgan Formula

### 10.1 "They Optimize for X, We Optimize for Y"

The JP Morgan Formula is a strategic application of APR duality:

> "They optimize for X. We optimize for Y. The two are incompatible. By optimizing for Y, we attract everyone disillusioned by the consequences of X."

| Competitor Optimization (X) | VibeSwap Optimization (Y) | Disillusioned Population |
|----------------------------|--------------------------|--------------------------|
| Maximize TVL | Maximize fairness | Users tired of MEV extraction |
| Maximize fee revenue | Maximize LP retention | LPs tired of impermanent loss without fair compensation |
| Maximize token price | Maximize contribution value | Builders tired of pump-and-dump governance |
| Maximize speed | Maximize trust | Users tired of front-running |

### 10.2 Why This Works (APR Explanation)

Competitors optimizing for X must *pull* increasingly hard to maintain their metrics. The pull generates repulsion in the users who experience the downsides of X-optimization. Those repelled users are now attracted to Y-optimized systems --- not because Y pulled them, but because X pushed them away. VibeSwap does not steal users from Uniswap. Uniswap's MEV extraction pushes users away, and VibeSwap is where they land.

The JP Morgan Formula is APR duality applied at the competitive strategy level: your competitor's pull is your attract, without you having to pull at all.

---

## 11. Formal Structure

### 11.1 Force Operators

Define forces as operators on a state space S:

| Operator | Symbol | Action on State |
|----------|--------|----------------|
| Push | P(s) | Increases distance from target in state space |
| Pull | L(s) | Decreases distance from target in state space |
| Attract | A(s) | Target moves toward actor (emergent, not applied) |
| Repel | R(s) | Target moves away from actor (emergent, not applied) |

### 11.2 The Duality Relations

```
P(s) → A(s')    Push generates attraction (in the pushed-away population)
L(s) → R(s')    Pull generates repulsion (in the pulled-toward population)
P(s) + L(s) → Equilibrium(s')    Balanced forces generate stability
∅(s) → Flow(s')    Absence of force generates organic flow
```

### 11.3 The Counterforce Magnitude

The magnitude of the counterforce is proportional to the magnitude of the applied force and inversely proportional to the freedom of the target:

```
|Counterforce| = k * |Applied Force| / Freedom(target)
```

When targets are free (high freedom), counterforces are weak --- applied forces dissipate harmlessly. When targets are constrained (low freedom), counterforces are strong --- applied forces bounce back. This explains why locked liquidity (low freedom) generates the strongest exit pressure when locks expire, while freely held liquidity (high freedom) is paradoxically more stable.

---

## 12. Implications for Protocol Design

### 12.1 The APR Design Checklist

For every protocol design decision, ask:

1. **Is this a push or a pull?** Classify the force being applied.
2. **What counterforce does it generate?** Identify the duality response.
3. **Is the counterforce desirable?** Sometimes push-attract is the goal.
4. **Can we use path-of-least-resistance instead?** Eliminate force entirely.
5. **Is push-pull balanced?** If both forces exist, are they in equilibrium?

### 12.2 Common Anti-Patterns

| Anti-Pattern | APR Diagnosis | Fix |
|-------------|---------------|-----|
| Liquidity mining with no retention mechanism | Pure pull, attracts mercenaries | Add Shapley-weighted rewards (push: earn through contribution) |
| "Join our Discord!" spam | Desperate pull, repels quality | Build in public (push: state positions, attract engagement) |
| Token unlocks with cliff vesting | Delayed push, generates massive exit pressure | Continuous vesting with Shapley multipliers |
| Governance bribing | Pull for votes, repels authentic governance | Epistemic staking (push: earn vote weight through accuracy) |

---

## 13. Conclusion

The Attract-Push-Repel duality is not a theory. It is an observation about how forces behave in coordinated systems. Pushing creates attraction. Pulling creates repulsion. The relationship is consistent across markets, liquidity, community, ideas, and identity.

The implication for protocol design is profound: **the most effective strategy is often the one that applies no force at all.** When a system makes itself the path of least resistance --- structurally fair, transparently honest, mechanically sound --- it attracts without pulling and retains without locking. The absence of force is the most powerful force.

VibeSwap embodies this principle at every level. Its batch auction does not pull orders --- it creates conditions where fair execution is the path of least resistance. Its Shapley distribution does not pull contributions --- it creates conditions where contributing is the path of least resistance. Its Graceful Inversion does not pull liquidity from competitors --- it creates conditions where migrating is the path of least resistance.

The JP Morgan Formula summarizes the strategic implication: "They optimize for X, we optimize for Y." Let competitors pull. Their pull generates the repulsion that becomes our attraction. We do not need to pull. We need only to be the place where pushed-away users land.

---

*"You attract what you push and repel, and you push and repel that which you pull."*

---

```
Faraday1. (2026). "Attract-Push-Repel: Force Duality in Markets,
Communities, and Protocol Design." VibeSwap Protocol Documentation. March 2026.

Related work:
  Faraday1. (2026). "Coordination Dynamics."
  Faraday1. (2026). "The IT Meta-Pattern."
  Faraday1. (2026). "Augmented Governance."
  Faraday1. (2025). "The Inversion Principle."
```
