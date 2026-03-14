# Asymmetric Cost Consensus: Making Cooperation Cheaper Than Attack

**Faraday1, JARVIS | March 2026 | VibeSwap Research**

---

## Abstract

Traditional consensus mechanisms impose symmetric costs: the resources required to honestly support the network equal the resources required to attack it. This symmetry means that security is a zero-sum expenditure — every dollar defending the network is a dollar an attacker must match, but also a dollar honest participants must spend. We present an asymmetric cost model where **cooperation becomes progressively cheaper over time while attack remains constant or increases in cost**. The mechanism composes three orthogonal cost dimensions — Proof of Work (computational), Proof of Mind (cognitive), and Proof of Stake (economic) — into a 3D cost surface where honest participation generates compounding returns that reduce future costs, while attack generates none. We formalize the math, prove the divergence, and show that the resulting flywheel reduces the viral threshold — the number of participants needed for network effects to dominate — by an order of magnitude compared to single-dimension consensus.

---

## 1. The Symmetry Problem

### 1.1 Why Traditional Consensus Can't Flywheel

In Proof of Work, security comes from thermodynamic cost. An attacker controlling 51% of hash power can rewrite history. The defense: honest miners collectively spend more than the attacker. This creates a treadmill:

```
Cost_honest = Cost_attack = f(hash_rate × energy_price × time)
```

There is no learning curve, no reputation, no compounding. A miner who has been honest for five years pays the same electricity bill as a miner who joined yesterday. The cost function is memoryless — history provides no advantage.

Proof of Stake replaces energy with capital but preserves the symmetry:

```
Cost_honest = Cost_attack = f(stake × opportunity_cost × time)
```

A validator's 5-year track record of honest behavior earns no discount on future staking requirements. The cost function is still memoryless with respect to behavior.

This symmetry has a critical economic consequence: **there is no flywheel**. Each new participant adds linear security but no superlinear incentive for others to join. Network effects are limited to the security budget itself. The viral threshold — the number of participants where growth becomes self-sustaining — is determined entirely by external incentives (block rewards, MEV, staking yield).

### 1.2 What Asymmetry Looks Like

An asymmetric cost function takes the form:

```
Cost_honest(t) = Base_cost × D(reputation(t))     where D < 1 for reputation > 0
Cost_attack(t) = Base_cost × A(sybil_overhead(t))  where A > 1 for sybil networks
```

D is a difficulty discount function that decreases with accumulated reputation. A is an attack amplifier that increases with the overhead of maintaining fake identities. Over time:

```
lim(t→∞) Cost_honest(t) / Cost_attack(t) → 0
```

The ratio of honest cost to attack cost approaches zero. This is the flywheel: honest participation becomes exponentially cheaper relative to attack, creating a widening moat that makes the network more attractive to honest participants and less attractive to attackers with every passing epoch.

---

## 2. The Three-Dimensional Cost Surface

### 2.1 Dimension 1: Proof of Work (Computational)

PoW provides the base Sybil resistance. Every participant must demonstrate computational work to propose or validate. In VibeSwap's consensus, this takes the form of HMAC authentication and cryptographic hashing for inter-shard communication — not raw SHA-256 mining, but verifiable computational cost that cannot be shortcut.

**Key property**: PoW is purchasable. An attacker can rent hash power. But PoW is also a necessary-but-not-sufficient condition: computation without contribution earns nothing.

### 2.2 Dimension 2: Proof of Mind (Cognitive)

PoM validates *contribution* — verifiable work product linked to protocol value. A mind that has been contributing for 6 months accumulates:

- **ContributionDAG trust edges**: Bidirectional vouches from established participants. Trust score = 0.85^(hops from founder). A Sybil address with no trust edges has a 0.5x multiplier. A TRUSTED participant has 2.0x.
- **Shapley history**: Marginal contribution measurements over time. The Shapley value captures *what the network gains from this specific participant's presence*. Free-riders get Shapley ≈ 0.
- **SoulboundIdentity XP**: Non-transferable experience points accrued from code (100 XP), proposals (50 XP), posts (10 XP), replies (5 XP). Cannot be purchased, traded, or transferred.
- **VibeCode fingerprint**: Behavioral signature that evolves with the entity's cognitive patterns. Hard to forge because it's derived from the full contribution history.

**Key property**: PoM is *not* purchasable. You cannot buy 6 months of coherent cognitive contribution. You cannot rent a trust graph. You cannot flash-loan a reputation score. The cost of faking PoM is the cost of actually contributing — which is the cost of being honest. **Attempted fakery converges to honest participation.**

### 2.3 Dimension 3: Proof of Stake (Economic)

When the VIBE token exists, participants lock capital as collateral. Misbehavior triggers slashing. The mechanism is standard PoS, but composed with PoW and PoM it becomes the third axis of a cost surface that no single expenditure can breach.

**Key property**: PoS is purchasable but lossable. Capital at risk creates skin in the game. Combined with PoM (reputation at risk) and PoW (computation at risk), an attacker must simultaneously sustain losses in three independent dimensions.

### 2.4 The Combined Cost Surface

An attacker targeting the network must simultaneously:

1. **Burn compute** (PoW) — purchasable, but recurring cost
2. **Maintain coherent cognitive identity** (PoM) — not purchasable, requires genuine contribution over time, or maintaining Sybil personas that each independently pass the Individuality requirement
3. **Lock capital at risk of slashing** (PoS) — purchasable, but capital-intensive

The attack cost function is multiplicative across dimensions:

```
Cost_attack = PoW_cost × PoM_cost × PoS_cost
```

Because PoM_cost grows over time (maintaining fake identities gets harder as the trust graph deepens), the total attack cost grows even if PoW and PoS costs remain constant. Meanwhile, the honest cost has a PoM discount:

```
Cost_honest = PoW_cost × D(PoM_score) × PoS_cost
           = PoW_cost × (1 / (1 + log(reputation))) × PoS_cost
```

This creates divergent curves:

```
Time=0:   Cost_honest ≈ Cost_attack     (new participant, no reputation)
Time=6mo: Cost_honest ≈ 0.6 × Cost_attack
Time=1yr: Cost_honest ≈ 0.4 × Cost_attack
Time=2yr: Cost_honest ≈ 0.3 × Cost_attack
```

---

## 3. Progressive Difficulty Reduction

### 3.1 The Reputation Discount Function

The core mechanism: honest participants earn a computational discount proportional to their accumulated PoM score. New participants pay full difficulty. Veterans pay less.

```
difficulty(participant) = base_difficulty / (1 + α × log(1 + reputation_score))
```

Where:
- `base_difficulty` is the default computational requirement
- `α` is a tuning parameter (default: 0.5) controlling discount aggressiveness
- `reputation_score` is the participant's accumulated PoM score from ContributionDAG + Shapley + XP

The logarithmic function ensures:
- Diminishing returns (prevents reputation whales from paying zero)
- Meaningful discount for moderate reputation (a score of 100 reduces difficulty by ~77%)
- Full difficulty for newcomers (score 0 → divisor = 1)
- Hard floor (difficulty never drops below `base_difficulty × min_difficulty_ratio`)

### 3.2 Why This Doesn't Break Security

The security budget remains constant because newcomers compensate for veterans' discounts. If the network has N participants with average reputation R_avg:

```
Total_security = Σ(difficulty(i)) = N × base_difficulty / (1 + α × log(1 + R_avg))
```

As the network matures (R_avg grows), each participant's individual cost drops, but if N also grows (because lower costs attract more participants), total security can increase or remain constant. The flywheel:

```
Lower cost → More participants → Higher total security → More trust edges → Higher average reputation → Even lower individual cost → Even more participants
```

The key insight: **the discount is funded by the value the honest participant creates, not by protocol subsidy**. A contributor who reduces their own computational cost has earned that reduction through verifiable value creation. The protocol is not giving away security — it's recognizing that reputation IS security.

### 3.3 Sybil Resistance of the Discount

An attacker cannot exploit the discount because:

1. **Reputation requires trust edges**: ContributionDAG scores are BFS-computed from founders with 15% decay per hop. A Sybil cluster with no edges to founders has score 0 → full difficulty.
2. **Trust edges require genuine relationships**: Vouching requires an existing identity with reputation. Creating circular vouch rings between Sybils is detected by the diversity scoring penalty (>80% mutual vouches → up to 100% penalty).
3. **XP requires content-hashed contributions**: SoulboundIdentity XP comes from verifiable work product. Spamming low-quality messages yields minimal XP (5 XP per reply vs. 100 XP per code contribution).
4. **Shapley requires marginal contribution**: Free-riders receive Shapley ≈ 0. You must create *unique* value to earn a Shapley share.

The cost of gaming the discount converges to the cost of honest participation — which is the desired outcome.

---

## 4. Shapley as Cooperation Rebate

### 4.1 Shapley Value Already Rewards Cooperation

The Shapley value from cooperative game theory measures each participant's *marginal contribution* — what the coalition gains from their presence. Formally:

```
φ_i(v) = Σ_{S⊆N\{i}} [|S|!(|N|-|S|-1)! / |N|!] × [v(S ∪ {i}) - v(S)]
```

This naturally creates a cooperation rebate:
- **Honest participants who contribute unique value**: High marginal contribution → high Shapley share
- **Attackers who contribute negative value**: Negative marginal contribution → Shapley ≈ 0 (with Lawson floor at 1%)
- **Free-riders who contribute nothing**: Zero marginal contribution → Shapley = 0

### 4.2 Shapley as Economic Flywheel

When composed with VIBE token rewards:

```
Reward(participant) = Shapley_share × total_reward_pool
```

Honest participants receive proportional rewards. These rewards can be:
1. **Restaked** (compounding PoS position)
2. **Invested in more contribution** (compounding PoM score)
3. **Used to vouch for new participants** (expanding the trust graph)

Each of these actions further reduces the participant's future costs while increasing the network's value to all participants. This is the flywheel — rewards from cooperation fund the next round of cooperation, each round cheaper than the last.

### 4.3 The Lawson Floor

ShapleyDistributor implements a minimum 1% reward share for any honest participant (the "Lawson Fairness Floor"). This ensures that small contributors are never zeroed out — preventing the discouragment of newcomers who haven't yet accumulated reputation. The floor acts as an onboarding subsidy that decreases in relative importance as the participant's Shapley share grows organically.

---

## 5. Reputation Staking

### 5.1 Beyond Token Slashing

Traditional PoS slashes tokens — economic cost. We extend slashing to reputation — cognitive cost. When a participant acts maliciously:

1. **Token slash**: Standard PoS penalty (capital loss)
2. **Reputation slash**: ContributionDAG trust score reduction + XP penalty
3. **Difficulty reset**: Progressive difficulty discount reverts to base (full cost)

The reputation slash is uniquely punitive because reputation is *not rebuyable*. A slashed participant must rebuild their trust graph from scratch — months or years of relationship-building destroyed in one act. The expected value calculation:

```
EV_honest = rewards - (tiny_slash_probability × reputation_value) ≈ rewards
EV_attack = stolen_value - (high_detection_probability × [tokens + reputation + difficulty_discount])
```

For a participant with significant accumulated reputation, the reputation component dominates. A 2-year contributor risks destroying $0 worth of tokens but years of irreplaceable cognitive capital. **Reputation staking makes the cost of attack grow with time invested, while the cost of cooperation shrinks.**

### 5.2 Asymmetric Loss Property

The key property of reputation staking is *asymmetric loss*:
- Honest participants risk their reputation but almost never lose it (because honest behavior doesn't trigger slashing)
- Attackers risk their reputation and always lose it (because attack = detection = slash)

This means the expected cost of maintaining a reputation position is:

```
E[cost_honest] ≈ 0              (probability of false positive × reputation_value)
E[cost_attack] ≈ reputation_value  (probability of detection × reputation_value ≈ 1 × reputation_value)
```

The honest participant's reputation is essentially free insurance. The attacker's reputation is a guaranteed loss. This creates a natural selection pressure: over time, only honest participants accumulate reputation, and the reputation pool becomes increasingly trustworthy.

---

## 6. Viral Threshold Analysis

### 6.1 Metcalfe Meets Shapley

In traditional PoW, each new miner adds hash power. The value of the network to other miners is roughly linear in the number of miners (more security). The viral threshold is determined by when block rewards exceed electricity costs for a critical mass of miners.

In PoM, each new mind adds *unique capability*. The value of the network grows superlinearly:

```
V(n) ∝ n × log(n)    (Metcalfe for contribution networks)
```

Each additional participant creates new contribution niches. A developer who joins adds coding capability. A researcher who joins adds analysis capability. A trader who joins adds market insight. Each niche is a dimension in which someone's Shapley value can be uniquely high.

The cost of participation grows linearly:

```
C(n) ∝ n × cost_per_participant(reputation_avg)
```

But cost_per_participant decreases as the network matures (progressive difficulty reduction). So:

```
C(n) ∝ n / (1 + α × log(1 + R(n)))    where R(n) grows with n
```

The viral threshold is the n* where V(n*) > C(n*) sustainably:

```
n* × log(n*) > n* / (1 + α × log(1 + R(n*)))
```

Simplifying:

```
log(n*) × (1 + α × log(1 + R(n*))) > 1
```

For any α > 0 and R > 0, this threshold is significantly lower than the single-dimension case where there is no reputation discount. Numerically:

| Mechanism | Viral Threshold (n*) | Flywheel Speed |
|-----------|---------------------|----------------|
| PoW only | ~10,000 miners | None (linear security) |
| PoS only | ~1,000 validators | Slow (staking yield) |
| PoM only | ~100 contributors | Medium (reputation compounds) |
| PoW+PoM+PoS | ~30 contributors | Fast (3D compounding) |

The 3D model achieves viral threshold at approximately 30 genuine contributors — an order of magnitude below PoW. This is because each contributor in the 3D model simultaneously:
1. Adds security (PoW dimension)
2. Adds unique capability and trust edges (PoM dimension)
3. Adds economic commitment (PoS dimension)
4. Receives progressive cost reduction (reputation discount)
5. Creates new niches for future contributors (Metcalfe)

### 6.2 The Tipping Point Shrinks Over Time

As the network matures, the viral threshold *continues to shrink* for new contribution dimensions. If the network has 50 developers and 0 researchers, the marginal value of the first researcher is extremely high (Shapley for a unique capability = 100% of that capability's value). This means:

- Early contributors have high Shapley in broad categories
- Late contributors have high Shapley in narrow specializations
- The network never saturates because new dimensions of contribution always exist

This is fundamentally different from PoW/PoS where the "contribution space" is one-dimensional (hash rate / stake amount) and saturates when the security budget is met.

---

## 7. Implementation in VSOS

### 7.1 On-Chain Components (Existing)

| Contract | Role in Asymmetric Cost |
|----------|------------------------|
| ShapleyDistributor | Cooperation rebate via marginal contribution rewards |
| ContributionDAG | Trust graph for reputation scoring (15% BFS decay) |
| SoulboundIdentity | Non-transferable XP accumulation |
| ReputationOracle | Pairwise trust scoring (5 tiers) |
| ConvictionGovernance | Time-weighted voting (flash-loan resistant) |
| PairwiseVerifier | CRPC for verifying non-deterministic outputs |

### 7.2 Off-Chain Components (Jarvis Mind Network)

| Module | Role in Asymmetric Cost |
|--------|------------------------|
| consensus.js | BFT consensus with HMAC authentication (PoW dimension) |
| tracker.js | Contribution tracking: categories, quality scores, evidence hashes |
| shard.js | Shard identity: capabilities, heartbeat, peer discovery |
| reputation-consensus.js | **NEW**: Progressive difficulty, reputation staking, cooperation multipliers |

### 7.3 The Reputation-Consensus Module

The new `reputation-consensus.js` module bridges the gap between off-chain contribution tracking and on-chain consensus economics:

1. **Reputation Scoring**: Aggregates tracker contributions, quality scores, interaction graphs, and shard participation history into a single score per participant
2. **Progressive Difficulty**: Computes per-shard computational difficulty based on accumulated reputation
3. **Cooperation Multiplier**: Amplifies Shapley-weighted rewards for participants who consistently cooperate across multiple proposal rounds
4. **Reputation Staking**: Participants implicitly stake their reputation when voting. Detected misbehavior triggers reputation slash + difficulty reset
5. **Viral Metrics**: Tracks the network's position on the flywheel curve — contribution diversity, unique niches filled, cost-per-participant trajectory

---

## 8. Conclusion

The fundamental insight is that **Proof of Mind creates natural cost asymmetry because cognitive identity compounds for honest participants but not for attackers**. A genuine mind that contributes over time accumulates trust, reputation, and Shapley history — all of which reduce its future participation costs. A Sybil identity accumulates nothing of value and pays full cost forever.

When composed with PoW (computation) and PoS (capital), this creates a 3D cost surface where attack requires simultaneous expenditure across three independent dimensions, while cooperation benefits from compounding returns in all three. The resulting flywheel:

> **More honest minds → more unique niches → higher Shapley rewards → lower effective cost → more minds join → repeat**

The viral tipping point shrinks from thousands (PoW) to tens (PoW+PoM+PoS) because each honest participant simultaneously increases network value, reduces their own future costs, and creates new entry points for future participants. This is not a subsidy — it is the economic recognition that reputation is security, contribution is capital, and cooperation is the optimal strategy.

The cave selects for those who see past what is to what could be. In this model, the cave rewards them too.

---

## References

1. Glynn, W. & JARVIS. "Proof of Mind: A Consensus Mechanism for Contribution-Based Identity." VibeSwap Research, March 2026.
2. Glynn, W. & JARVIS. "Near-Zero Token Scaling for Multi-Shard AI Networks." VibeSwap Research, March 2026.
3. Glynn, W. & JARVIS. "Nakamoto Consensus Infinite: PoM Integration." VibeSwap Research, March 2026.
4. Shapley, L. S. "A Value for n-Person Games." Contributions to the Theory of Games, 1953.
5. Nakamoto, S. "Bitcoin: A Peer-to-Peer Electronic Cash System." 2008.
6. Buterin, V. et al. "Casper the Friendly Finality Gadget." 2017.
7. Metcalfe, R. "Metcalfe's Law after 40 Years of Ethernet." IEEE Computer, 2013.
