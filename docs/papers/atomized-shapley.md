# Atomized Shapley: Universal Fair Measurement for Decentralized Systems

**William T. Glynn & JARVIS**
**VibeSwap Protocol — March 2026**

---

## Abstract

Every metric in crypto is gameable. TVL can be inflated by mercenary capital. Volume can be faked by wash trading. Follower counts can be bought. Commit counts can be padded. These metrics reward performance theater, not genuine contribution.

We propose **Atomized Shapley** — the application of Shapley value theory to every protocol interaction, not just reward distribution. By asking "what would be missing if this participant weren't here?" for each trade, each governance vote, each community insight, and each liquidity position, we create a universal measurement system that is resistant to gaming by construction.

This paper describes the architecture, the mathematical foundation, and the first implementation in VibeSwap's micro-game system.

---

## 1. The Problem: Gameable Metrics

Decentralized systems inherit their metrics from centralized ones. This creates a measurement crisis:

| Metric | What It Claims to Measure | How It's Gamed |
|--------|--------------------------|----------------|
| TVL | Protocol adoption | Deposit, screenshot, withdraw (mercenary capital) |
| Volume | Trading activity | Wash trading between own wallets |
| Follower count | Community size | Bot farms, purchased followers |
| Token holdings | Governance commitment | Flash loan governance attacks |
| Commit count | Development activity | Trivial commits, whitespace changes |
| APY | Yield attractiveness | Unsustainable emission rates |

These metrics share a flaw: they measure **activity** rather than **contribution**. A participant who deposits $1M for 5 minutes to farm a snapshot scores the same TVL as one who provides liquidity for a year. A wash trader generates the same volume as a genuine price discovery trade.

The result is that DeFi leaderboards rank participants by how well they perform extraction theater, not by how much value they actually create.

---

## 2. Shapley Values: The Counterfactual Metric

The Shapley value, from cooperative game theory (Shapley, 1953), answers a precise question: **given a coalition of participants producing collective value, what is each participant's marginal contribution?**

Formally, for a game with players N and characteristic function v, player i's Shapley value is:

```
φᵢ(v) = Σ [|S|!(|N|-|S|-1)! / |N|!] × [v(S ∪ {i}) - v(S)]
```

For all subsets S ⊆ N \ {i}. This averages the marginal contribution of player i across all possible orderings of coalition formation.

### 2.1 Why Shapley Values Can't Be Gamed

Five axioms make Shapley values uniquely fair:

1. **Efficiency**: All value is distributed. No surplus for extraction.
2. **Symmetry**: Equal contributors receive equal rewards. No favoritism.
3. **Null Player**: Participants who add zero marginal value receive zero. Wash traders, bot followers, and mercenary capital score zero by construction.
4. **Additivity**: The value of combined activities equals the sum of individual values. No double-counting.
5. **Linearity**: The metric scales predictably. No threshold manipulation.

The **null player axiom** is the key anti-gaming property. A wash trader's marginal contribution to price discovery is zero — removing them doesn't change the clearing price. A bot follower's marginal contribution to community quality is zero — removing them doesn't change the conversation. Shapley values detect this automatically.

---

## 3. Atomization: Shapley for Every Interaction

Traditional applications of Shapley values in DeFi are limited to reward distribution (e.g., distributing fees among liquidity providers). We extend this to every protocol interaction by creating **micro-games** — small, frequent Shapley games that measure contribution in real-time.

### 3.1 The Micro-Game Architecture

```
Every trade batch    → Shapley game (who provided useful liquidity?)
Every governance vote → Shapley game (whose vote was pivotal?)
Every community insight → Shapley game (whose conversation improved the protocol?)
Every oracle update   → Shapley game (whose data improved price accuracy?)
```

Each micro-game has:
- **Participants**: The set of contributors to that specific interaction
- **Coalition value**: The measurable outcome (trade volume facilitated, governance quality, price accuracy improvement)
- **Shapley values**: Each participant's marginal contribution to that outcome

### 3.2 The Two-Layer Implementation

**Layer 1: UtilizationAccumulator** (hot path, ~30K gas per batch)

Records per-batch utilization data at minimal cost:
- Volume processed (how much of the pool's liquidity was actually used)
- Directional imbalance (buy vs sell — determines scarcity)
- Volatility state (were conditions stressful?)

This data accumulates across batches within an epoch (configurable: 1 hour default).

**Layer 2: MicroGameFactory** (permissionless, periodic)

Reads accumulated data and creates Shapley games:
1. Enumerates LPs in the pool
2. Computes utilization-weighted contribution per LP
3. Creates a game via EmissionController
4. ShapleyDistributor computes fair values
5. Participants claim rewards

The factory is permissionless (Grade A disintermediation) — anyone can trigger game creation for a finalized epoch.

### 3.3 The Four Dimensions

Each LP's Shapley contribution is measured across four dimensions:

| Dimension | Weight | What It Measures | Anti-Gaming Property |
|-----------|--------|-----------------|---------------------|
| **Direct Contribution** | 40% | Liquidity actually utilized in trades | Parked capital scores zero |
| **Time in Pool** | 30% | Duration of liquidity provision (log scale) | Flash deposits score near-zero |
| **Scarcity Score** | 20% | Providing the token in higher demand | Following the crowd scores less |
| **Stability Score** | 10% | Maintaining position during volatility | Fair-weather LPs score less |

---

## 4. Beyond Liquidity: Universal Application

### 4.1 Governance Shapley

Current governance: 1 token = 1 vote. A whale with 51% of tokens controls all outcomes regardless of contribution quality.

Atomized Shapley governance: each vote is evaluated by its **pivotality** — did this vote change the outcome? A 1000-token vote that broke a tie has higher Shapley value than a 1M-token vote that followed the majority. This is mathematically equivalent to the Shapley-Shubik power index, applied to every proposal.

### 4.2 Community Shapley

Current community metrics: message count, follower count, engagement rate. All gameable.

Atomized Shapley community: each conversation is evaluated by its **marginal contribution to protocol improvement**. When Catto's observation about price manipulation led to a code change in the oracle, her Shapley value for that interaction is high — removing her from the conversation would have removed the insight. A bot posting "gm" 1000 times has zero Shapley value — removing it changes nothing.

The dialogue-to-code pipeline implements this: conversations are monitored for protocol-relevant insights, compiled into GitHub contributions, and attributed to the original speaker.

### 4.3 Oracle Shapley

Current oracle metrics: number of data submissions, uptime.

Atomized Shapley oracle: each price feed is evaluated by its **marginal contribution to price accuracy**. An oracle that submits the same price as everyone else has low Shapley value (null player — removing it doesn't change the aggregate). An oracle that provides a unique, correct price when others are wrong has high Shapley value.

### 4.4 Development Shapley

Current development metrics: commits, lines of code, PRs merged.

Atomized Shapley development: each contribution is evaluated by its **marginal impact on protocol quality**. A commit that fixes a critical vulnerability has enormous Shapley value. A commit that adds whitespace has zero. The `/code` command implements this — community members' insights become code changes, and the original speaker is credited via the attribution system.

---

## 5. The Lawson Fairness Floor

One risk of pure Shapley measurement: small contributors with marginal-but-real contributions could receive negligibly small rewards, discouraging participation.

The **Lawson Fairness Floor** (named after VibeSwap's constitutional fairness axiom P-000) guarantees a minimum 1% share for any honest participant:

```
floor = totalReward * 0.01 / participantCount
adjustedValue = max(shapleyValue, floor)
```

This ensures that nobody who contributed honestly walks away with zero, while preserving the relative ordering of Shapley values. The 1% floor is funded by proportionally reducing the shares of above-average contributors.

---

## 6. Connection to P-001: No Extraction Ever

VibeSwap's machine-side invariant, P-001, states that no participant may extract more value than they contribute. Atomized Shapley is the enforcement mechanism:

- **Detection**: If participant i's withdrawal exceeds their Shapley value, extraction is occurring
- **Correction**: The system adjusts rewards, reducing the extractor's share to their Shapley value
- **Prevention**: By measuring every interaction via Shapley, extraction vectors are identified before they compound

This creates an economic immune system: the protocol doesn't need manual moderation or governance votes to prevent extraction. The math detects it. The code corrects it. P-001 enforces itself.

---

## 7. Limitations and Future Work

### 7.1 Computational Cost

Full Shapley computation is O(2^n) in the number of participants. For micro-games with < 100 participants, this is tractable on-chain. For larger coalitions, approximation algorithms (Castro et al., 2009) can reduce this to polynomial time with bounded error.

### 7.2 Value Function Design

The quality of Shapley measurement depends on the quality of the value function v(S). Designing value functions that accurately capture "contribution to price discovery" or "contribution to governance quality" is an open research problem. VibeSwap's current implementation uses proxy metrics (utilization ratio, pivotality, insight-to-code conversion) that are imperfect but directionally correct.

### 7.3 Cross-Domain Composition

How should Shapley values from different domains (trading, governance, community) be combined? Simple addition may not capture the complementarity between domains. A participant who contributes to both liquidity and governance may create more value than the sum of their individual contributions. This is a compositional game theory problem that requires further research.

---

## 8. Conclusion

The crypto industry's reliance on gameable metrics (TVL, volume, follower count) has created a culture of performance theater that rewards extraction over contribution. Atomized Shapley replaces these metrics with a single, ungameable measurement: **counterfactual marginal contribution**.

By creating micro-games for every protocol interaction — every trade batch, every governance vote, every community insight — we build an economic immune system that detects and starves extraction automatically. The null player axiom ensures that participants who add no value receive no reward, regardless of how much capital they deploy or how many bots they run.

Shapley values don't care about your follower count. They care about what would be missing if you weren't here. That's the only metric that matters.

---

## References

- Shapley, L.S. (1953). "A Value for n-Person Games." Contributions to the Theory of Games II.
- Castro, J. et al. (2009). "Polynomial calculation of the Shapley value based on sampling." Computers & Operations Research.
- Shapley, L.S. & Shubik, M. (1954). "A Method for Evaluating the Distribution of Power in a Committee System." American Political Science Review.
- Glynn, W.T. (2026). "Dissolving the Owner: VibeSwap's Systematic Elimination of Administrative Control." VibeSwap Protocol.
- nuconstruct (2026). "Open vs. Sealed Auction Format Choice for MEV." Ethereum Research.

---

*VibeSwap Protocol — github.com/WGlynn/VibeSwap*
*"The only metric that matters is what would be missing if you weren't here."*
