# The Three-Token Economy

**Lifetime Caps, Circulating Caps, and Energy Anchors in Omnichain Monetary Design**

*Faraday1, March 2026*

---

## Abstract

We present a three-token monetary architecture for the VibeSwap protocol, where each token is deployed on the blockchain whose economic model matches its monetary philosophy. VIBE (Ethereum/Base) implements a lifetime cap of 21 million tokens with permanent burns, optimizing for governance and scarcity. JUL (EVM chains) is an elastic energy token mined via SHA-256 proof-of-work with a rebase scalar and PI controller, anchoring its value to the real-world cost of electricity. A future CKB-native token (Nervos) implements a circulating cap with state-rent-based burns, where token destruction represents state occupation and release returns tokens to circulation. The key insight is that lifetime caps and circulating caps are not competing models — they optimize for different participants (holders vs. users) and different economic functions (store of value vs. medium of exchange). All three tokens participate in the same Shapley distribution framework, enabling cross-chain cooperative game theory where contributions on any chain are measured by the same fairness axioms.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Two Cap Models](#2-the-two-cap-models)
3. [VIBE: The Governance Token](#3-vibe-the-governance-token)
4. [JUL: The Energy Token](#4-jul-the-energy-token)
5. [CKB-Native: The Utility Token](#5-ckb-native-the-utility-token)
6. [The Trinomial Architecture](#6-the-trinomial-architecture)
7. [Unified Shapley Distribution](#7-unified-shapley-distribution)
8. [Revenue Architecture](#8-revenue-architecture)
9. [Security and Invariants](#9-security-and-invariants)
10. [Conclusion](#10-conclusion)

---

## 1. Introduction

### 1.1 The Problem with Single-Token Design

Most DeFi protocols issue a single governance token that is expected to serve all economic functions: governance voting, fee payment, staking rewards, liquidity incentives, and store of value. This creates fundamental conflicts:

- **Governance vs. liquidity**: Tokens locked in governance cannot provide liquidity.
- **Scarcity vs. utility**: Deflationary pressure (good for holders) reduces circulating supply (bad for users).
- **Store of value vs. medium of exchange**: Holding is rewarded, spending is penalized.
- **Single-chain vs. omnichain**: One token design cannot optimize for different blockchain architectures simultaneously.

### 1.2 The Insight

> Lifetime cap and circulating cap are not competing models. They optimize for different things. Deploy both on chains whose architecture matches.

Rather than forcing one token to serve all purposes, VibeSwap deploys three tokens — each matched to the blockchain architecture and economic model where it functions optimally.

### 1.3 The Analogy

| Token | Physical Analogy | Attracts | Function |
|-------|-----------------|----------|----------|
| VIBE | Gold (scarce, stored) | Holders, investors | Governance, scarcity signal |
| JUL | Electricity (metered, flowing) | Operators, miners | Operational cost, energy anchor |
| CKB-native | Water (bounded, cycling) | Users, builders | State access, utilization tracking |

---

## 2. The Two Cap Models

### 2.1 Lifetime Cap

A lifetime cap means: once N tokens have been minted across all time, no more can ever exist. Burns are permanent. Supply only decreases. This is the Bitcoin model.

**Properties:**
- Total supply is monotonically non-increasing after max mint.
- Every burn makes remaining tokens strictly more scarce.
- Scarcity is absolute — it does not depend on usage patterns.
- Optimal for: store of value, governance power, long-term alignment.

**Formal definition:**

```
Let M(t) = cumulative tokens minted by time t
Let B(t) = cumulative tokens burned by time t
Let S(t) = current circulating supply at time t

Lifetime cap N:
  M(t) ≤ N  ∀t
  S(t) = M(t) - B(t)
  M is monotonically non-decreasing
  B is monotonically non-decreasing
  S is monotonically non-increasing after M(t) = N
```

### 2.2 Circulating Cap

A circulating cap means: at most N tokens can exist at any given time. Burns release capacity for future minting. Supply breathes — tokens flow through the system like matter through an ecosystem.

**Properties:**
- Circulating supply is bounded but elastic.
- Burns are temporary — they release capacity, not destroy it permanently.
- Scarcity is relative to current usage.
- Optimal for: operational access, state representation, utilization-proportional economics.

**Formal definition:**

```
Let M(t) = cumulative tokens minted by time t
Let B(t) = cumulative tokens burned by time t
Let S(t) = current circulating supply at time t

Circulating cap N:
  S(t) ≤ N  ∀t
  S(t) = M(t) - B(t)
  M(t) may exceed N (tokens can be re-minted after burns)
  Burns release capacity: if S(t) < N, new minting is possible
```

### 2.3 Why Both

Neither model is universally superior. They serve different economic functions:

| Property | Lifetime Cap (VIBE) | Circulating Cap (CKB-native) |
|----------|--------------------|---------------------------|
| Scarcity model | Absolute (fixed forever) | Relative (bounded by usage) |
| Burns | Permanent destruction | Temporary occupation |
| Supply trajectory | Monotonically non-increasing | Elastic within bounds |
| Attracts | Holders, investors | Users, builders |
| Governance | Direct (ERC20Votes) | Indirect (usage = skin in game) |
| Chain match | Account model (Ethereum) | UTXO/cell model (CKB) |
| Narrative | "Only 21M will ever exist" | "The ecosystem has a carrying capacity" |

The key realization: deploying both on chains whose architecture matches their monetary philosophy is strictly superior to forcing one model onto all chains.

---

## 3. VIBE: The Governance Token

### 3.1 Specification

| Parameter | Value |
|-----------|-------|
| **Name** | VIBE |
| **Chain** | Ethereum / Base |
| **Standard** | ERC20 + ERC20Votes (OpenZeppelin v5) |
| **Lifetime cap** | 21,000,000 VIBE |
| **Burns** | Permanent (reduces total supply forever) |
| **Emission** | Shapley-distributed through contribution, never airdropped |
| **Governance** | Direct on-chain voting via token delegation |
| **Upgradeability** | UUPS proxy (Phase 1), renounce upgrade authority (Phase 4) |

### 3.2 Emission Schedule

VIBE follows a Bitcoin-inspired halving schedule implemented in the ShapleyDistributor:

```
Era 0: Base emission rate
Era 1: 50% of Era 0
Era 2: 25% of Era 0
...
Era n: Base / 2^n
```

Emission is not time-based but contribution-based. Tokens are minted only when the Shapley distribution algorithm determines that a participant has made a non-zero marginal contribution to a cooperative game. No contribution, no emission.

### 3.3 Why Lifetime Cap

VIBE's lifetime cap serves three functions:

**Scarcity signal**: A governance token with unlimited supply dilutes voting power. A lifetime cap ensures that governance influence is zero-sum — gaining power requires earning or buying tokens from existing holders, not waiting for new emissions.

**Commitment device**: Permanent burns create irreversible skin in the game. A participant who burns VIBE for protocol access has made a permanent sacrifice that cannot be reversed. This aligns long-term incentives.

**Narrative clarity**: "21 million means 21 million" is a property that participants, investors, and analysts can verify and trust. No governance vote, no admin key, no emergency mechanism can increase the supply beyond the cap. The constraint is in the bytecode.

### 3.4 P-001 Enforcement

The lifetime cap is protected by P-001 (No Extraction Ever):

- Distributions are irreversible — you cannot burn-and-remint to game Shapley.
- The emission controller enforces the cap in code (`require(totalMinted + amount <= LIFETIME_CAP)`).
- No `onlyOwner` bypass exists for the cap. Even the contract owner cannot mint beyond 21M.

---

## 4. JUL: The Energy Token

### 4.1 Specification

| Parameter | Value |
|-----------|-------|
| **Name** | JUL (Joule) |
| **Chain** | EVM-compatible chains |
| **Mining** | SHA-256 proof-of-work |
| **Supply model** | Elastic (rebase scalar + PI controller) |
| **Value anchor** | Real-world electricity cost |
| **Emission** | Proportional to work performed |
| **Fair launch** | No ICO, no premine |

### 4.2 The Energy Anchor

JUL's defining property is that its value is anchored to the cost of electricity. Unlike tokens whose value is purely speculative, JUL has a production cost floor: the energy required to mine it via SHA-256 proof-of-work.

**The deep capital problem**: In Bitcoin, early miners accumulated tokens at a fraction of current mining cost. This creates an unfair advantage for early participants that compounds over time. JUL solves this through a difficulty correction mechanism that accounts for hardware improvements (Moore's Law correction). The cost to mine the first JUL is approximately equal to the cost to mine JUL today.

```
Traditional PoW:
  Cost to mine token #1:        $0.001
  Cost to mine token #1,000,000: $100.00
  Early miners: 100,000x advantage

JUL (corrected):
  Cost to mine token #1:        ~$X
  Cost to mine token #1,000,000: ~$X (adjusted for hardware efficiency)
  Early miners: no structural advantage
```

### 4.3 Elastic Supply via PI Controller

JUL uses a proportional-integral (PI) controller to manage its rebase scalar:

- **High demand** (price above energy cost peg): Increase emission rate. More JUL enters circulation. Price pressure downward toward peg.
- **Low demand** (price below energy cost peg): Decrease emission rate. Less JUL enters circulation. Price pressure upward toward peg.
- **Proportional term**: Responds to current deviation from peg.
- **Integral term**: Responds to accumulated historical deviation (prevents persistent drift).

This creates a token that behaves like a decentralized stablecoin, but pegged to energy cost rather than fiat currency. The peg is maintained by market forces and mining economics, not by collateral reserves or central bank operations.

### 4.4 The Bridge Between Scarcity and Utility

JUL occupies the space between VIBE (scarce, stored) and CKB-native (elastic, flowing):

| Dimension | VIBE | JUL | CKB-native |
|-----------|------|-----|------------|
| Supply | Fixed forever | Elastic around peg | Bounded but cycling |
| Value source | Scarcity + governance | Energy cost | State utilization |
| Stability | Volatile (speculation) | Stable (energy peg) | Usage-correlated |
| Role | Governance token | Operational token | Access token |

JUL is the operational currency of the VibeSwap ecosystem — used for transaction fees, priority bids, and cross-chain operations where a stable unit of account is needed.

### 4.5 RuneScape GP Analogy

JUL follows the same economic model as gold pieces in RuneScape:

- Supply is proportional to demand (more players = more gold generated through gameplay).
- Obtained through work (time and effort = proof of work).
- Functions as a reserve currency within the ecosystem.
- Not ultra-scarce (unlike rare items / VIBE) — meant to flow, not to hoard.

---

## 5. CKB-Native: The Utility Token

### 5.1 Specification

| Parameter | Value |
|-----------|-------|
| **Name** | TBD (CKB-native VibeSwap token) |
| **Chain** | Nervos CKB |
| **Standard** | CKB cell model (not ERC20) |
| **Supply model** | Circulating cap (state rent) |
| **Burns** | State occupation (temporary lock) |
| **Release** | State freed (tokens return to circulation) |
| **Status** | **Not yet in contracts** — design phase |

### 5.2 The State Rent Model

Nervos CKB's economic model is uniquely suited to a circulating cap because state occupation IS the burn mechanism:

```
Creating a CKB cell   = locking CKBytes     = burning from circulation
Destroying a CKB cell = releasing CKBytes   = returning to circulation
Total CKBytes         = bounded by issuance schedule
Available CKBytes     = total issued - total occupied
```

A CKB-native VibeSwap token mirrors this exactly:

```
Opening a position/pool  = locking tokens  = burns from circulating supply
Closing a position        = releasing tokens = available for re-minting
Total capacity           = bounded (circulating cap)
Active supply            = cap - occupied
```

### 5.3 The Biological Analogy

The circulating cap model is biological. Cells consume resources when active and release them when they die. The ecosystem has a carrying capacity (max supply), but the atoms cycle through organisms (positions, pools, agents).

```
Ecosystem carrying capacity  ←→  Circulating cap
Organism consumes resources  ←→  Token locked in state
Organism dies, releases      ←→  Position closed, token released
Population fluctuates        ←→  Active supply elastic
Total matter conserved       ←→  Cap never exceeded
```

The protocol's monetary supply tracks its actual utilization. High usage = more tokens locked = fewer available = higher marginal cost of new state. Low usage = more tokens free = lower marginal cost. The price of participation self-regulates.

### 5.4 Why Nervos CKB

The CKB-native token is not deployable on Ethereum because Ethereum's account model has no concept of state rent. On Ethereum, once you create a storage slot, it persists indefinitely at no ongoing cost (beyond the initial SSTORE gas). The circulating cap model requires a chain where state occupation has an ongoing cost — and CKB is the only production L1 where this is native.

| Feature | Ethereum | Nervos CKB |
|---------|----------|------------|
| State model | Account (persistent) | Cell (UTXO, state rent) |
| Storage cost | One-time (SSTORE) | Ongoing (CKBytes locked) |
| State cleanup incentive | Minimal (SSTORE refund deprecated) | Native (releasing cells frees CKBytes) |
| Circulating cap natural fit | No | Yes |

---

## 6. The Trinomial Architecture

### 6.1 Three Tokens, Three Chains, Three Audiences

```
┌────────────────────────────────────────────────────────┐
│                  VibeSwap Protocol                      │
│                                                        │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │   VIBE   │    │   JUL    │    │   CKB-native     │  │
│  │ ETH/Base │    │   EVM    │    │   Nervos CKB     │  │
│  │          │    │          │    │                   │  │
│  │ Lifetime │    │ Elastic  │    │ Circulating       │  │
│  │ 21M cap  │    │ PI peg   │    │ State rent cap    │  │
│  │          │    │          │    │                   │  │
│  │ Gold     │    │ Electric │    │ Water             │  │
│  │ (stored) │    │ (metered)│    │ (cycles)          │  │
│  │          │    │          │    │                   │  │
│  │ Holders  │    │ Operators│    │ Users/Builders    │  │
│  └────┬─────┘    └────┬─────┘    └────────┬──────────┘  │
│       │               │                   │             │
│       └───────────────┼───────────────────┘             │
│                       │                                 │
│              Shapley Distribution                       │
│            (same axioms, all chains)                    │
└────────────────────────────────────────────────────────┘
```

### 6.2 The Complementarity

The three tokens are not competitors. They form a complementary system:

- **VIBE holders** provide governance and long-term capital alignment.
- **JUL miners** provide operational liquidity and a stable unit of account.
- **CKB-native users** provide state utilization and builder activity.

Each token attracts a different participant class. Each participant class contributes something the others cannot. The Shapley distribution measures all three contributions on the same scale.

### 6.3 Cross-Token Earning

A critical design property: you can earn one token by contributing value denominated in another.

- A CKB builder who locks tokens to occupy state (enabling infrastructure) earns VIBE (governance power).
- A VIBE staker who delegates governance votes (directing protocol resources) earns JUL (operational liquidity).
- A JUL miner who provides hash power (securing energy anchor) earns CKB-native tokens (state access).

The permanent token (VIBE) rewards elastic work (CKB, JUL). Scarcity compensates utility. This creates a natural circulation: participants move value between chains by contributing where they have comparative advantage and earning where they need access.

---

## 7. Unified Shapley Distribution

### 7.1 The Cooperative Game

All three tokens participate in the same cooperative game `v: 2^N → R` where:

- N = set of all participants across all chains
- v(S) = total value created by coalition S
- Contributions measured by Shapley axioms regardless of which token denominates them

### 7.2 Cross-Chain Marginal Contribution

The Shapley value for participant `i` across all chains:

```
φᵢ(v) = Σ_{S ⊆ N\{i}} [ |S|!(|N|-|S|-1)! / |N|! ] × [ v(S ∪ {i}) - v(S) ]
```

Where `v(S)` aggregates value from:
- VIBE: governance participation, staking, delegation
- JUL: hash power, operational liquidity, fee payment
- CKB-native: state occupation, builder activity, infrastructure

### 7.3 The Five Axioms Hold Across Chains

| Axiom | VIBE | JUL | CKB-native |
|-------|------|-----|------------|
| **Efficiency** | Sum of VIBE rewards = total VIBE value created | Sum of JUL rewards = total JUL value created | Sum of CKB rewards = total CKB value created |
| **Symmetry** | Equal governance contribution = equal VIBE reward | Equal hash power = equal JUL reward | Equal state contribution = equal CKB reward |
| **Null Player** | Zero governance contribution = zero VIBE | Zero hash power = zero JUL | Zero state contribution = zero CKB |
| **Proportionality** | VIBE ratio = governance contribution ratio | JUL ratio = hash power ratio | CKB ratio = state contribution ratio |
| **Time Neutrality** | Same contribution at t₁ and t₂ = same reward | Same hash power at t₁ and t₂ = same reward | Same state at t₁ and t₂ = same reward |

---

## 8. Revenue Architecture

### 8.1 The Zero-Extraction Principle

VibeSwap's revenue architecture is constrained by P-001 (No Extraction Ever):

| Revenue Source | Recipient | Rationale |
|---------------|-----------|-----------|
| DEX swap fees | 100% to LPs | LPs provide the liquidity. They created the value. Shapley says it is theirs. |
| Bridge fees | 0% (always) | Cross-chain access is infrastructure, not a product. Charging for it is intermediation. |
| Priority bids | Treasury | Users voluntarily pay for execution priority. Not extracted — offered. |
| Slashing penalties | Treasury | 50% slash on invalid reveals. Penalty for defection, not extraction from cooperation. |
| SVC marketplace | Treasury | Service marketplace fees. Value exchange, not rent-seeking. |

### 8.2 Why 100% to LPs

The Shapley null player axiom provides the formal justification:

1. The protocol itself provides no liquidity (it is the mechanism, not a participant).
2. A null player — one who contributes nothing to any coalition — receives zero (Shapley axiom 3).
3. If the protocol takes swap fees, it takes payment for zero marginal contribution.
4. That is extraction by definition.
5. P-001 detects it and self-corrects.

Therefore: 100% of swap fees go to LPs. Not as a policy choice. As a mathematical consequence.

### 8.3 Why 0% Bridge Fees

Cross-chain messaging is infrastructure. Charging users to move their own assets between chains is intermediation — inserting the protocol as a toll booth between the user and their destination. The bridge fee is the middleman's fee. The disintermediation roadmap (see companion paper) requires its elimination.

LayerZero relayer fees are pass-through costs (paid to the messaging layer, not to VibeSwap). VibeSwap adds no markup.

### 8.4 Treasury Revenue

The treasury funds protocol development, grants, insurance pools, and operational costs. Its revenue comes exclusively from sources where participants voluntarily pay for premium services or are penalized for defection:

```
Treasury Revenue = Priority Bids + Slashing Penalties + SVC Marketplace Fees
                 ≠ LP Fees (those are the LPs')
                 ≠ Bridge Tolls (those don't exist)
```

---

## 9. Security and Invariants

### 9.1 Cross-Token Invariants

The three-token system maintains the following invariants:

```
VIBE:
  totalMinted(t) ≤ 21,000,000          (lifetime cap)
  totalBurned(t) is monotonically non-decreasing  (burns are permanent)
  circulatingSupply(t) = totalMinted(t) - totalBurned(t)

JUL:
  price(t) ≈ energyCost(t) ± ε         (PI controller peg)
  emissionRate(t) = f(demand(t))        (elastic supply)
  no premine, no ICO                    (fair launch)

CKB-native:
  circulatingSupply(t) ≤ CAP            (circulating cap)
  burns(t) = stateOccupied(t)           (burns = state access)
  releases(t) = stateFreed(t)           (releases = state cleanup)
```

### 9.2 Anti-Gaming Properties

**VIBE**: Cannot burn-and-remint to game Shapley. Burns are permanent. Once burned, the capacity is gone forever. A participant who burns tokens to manipulate a Shapley game loses the tokens permanently.

**JUL**: Cannot mine at zero cost. SHA-256 proof-of-work requires real energy expenditure. The PI controller prevents depegging attacks by adjusting emission dynamically.

**CKB-native**: Cannot lock tokens without providing state utility. State occupation must correspond to actual cell creation on CKB. The chain itself enforces this.

### 9.3 P-001 Across All Three Tokens

P-001 applies uniformly:

- Extraction detection via Shapley marginal contribution.
- Self-correction via autonomous rebalancing.
- The same math detects extraction in VIBE governance, JUL mining, and CKB state access.
- A middleman who adds zero value to any token's cooperative game receives zero from that game. Across all three chains. Simultaneously.

---

## 10. Conclusion

The three-token economy is not three separate tokens awkwardly sharing a brand. It is a unified monetary system where each token occupies a distinct economic niche, deployed on the blockchain architecture that matches its monetary philosophy.

VIBE is gold: absolutely scarce, permanently burnable, governance-weighted. It sits on Ethereum where the account model and ERC20Votes standard make direct governance natural.

JUL is electricity: real-cost-anchored, elastically supplied, operationally necessary. It sits on EVM chains where SHA-256 mining infrastructure and PI controllers can operate.

The CKB-native token is water: bounded but cycling, occupation-based, utilization-tracking. It sits on Nervos CKB where the cell model and state rent mechanism make circulating caps native.

All three participate in the same Shapley distribution. All three are governed by P-000 (Fairness Above All) and P-001 (No Extraction Ever). All three are measured by the same five axioms. The cooperative game is one game, played across three chains, with three tokens that each do what the others cannot.

> "VIBE = gold (scarce, stored). CKB-native = energy (bounded, flows). JUL = the bridge between, anchored to real-world energy cost."

---

```
Faraday1 (2026). "The Three-Token Economy: Lifetime Caps, Circulating Caps,
and Energy Anchors in Omnichain Monetary Design." VibeSwap Protocol
Documentation. March 2026.

Depends on:
  VibeSwap (2026). "Incentives Whitepaper."
  VibeSwap (2026). "Formal Fairness Proofs."
  Faraday1 (2026). "The Lawson Constant."
  Glynn, W. (2026). "Ergon Foundation & Voting Integrity Theory."
```

---

## See Also

- [Economitra](ECONOMITRA.md) — The economic model framework this token system implements
- [Economitra v1.2](ECONOMITRA_V1.2.md) — Updated version with trinomial stability
- [Economitra (paper)](../../research/papers/ECONOMITRA.md) — Academic treatment with formal proofs
- [Time-Neutral Tokenomics](TIME_NEUTRAL_TOKENOMICS.md) — Mathematical framework ensuring no cohort advantage
- [Cooperative Emission Design](../../research/papers/cooperative-emission-design.md) — Emission mechanism for cooperative token distribution
- [Near-Zero Token Scaling](../../research/papers/near-zero-token-scaling.md) — Scaling with minimal token overhead
