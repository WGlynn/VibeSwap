# From MEV to GEV: Generalized Extractable Value Resistance Through Cooperative Mechanism Design

**William Glynn**
*VibeSwap — Independent Research*
*March 2026*

---

## Abstract

Maximal Extractable Value (MEV) has dominated DeFi security discourse since its formalization by Daian et al. (2019). Solutions — private mempools, MEV auctions, encrypted order flow — treat MEV as an isolated pathology. We argue MEV is one instance of a broader class we term **Generalized Extractable Value (GEV)**: any value that an intermediary can capture from a system's participants by exploiting structural asymmetries in information, governance, timing, or capital access. We identify seven distinct GEV vectors present across major DeFi protocols and present VSOS (VibeSwap Operating System), a financial operating system where each layer structurally eliminates its corresponding extraction vector through Shapley-fair attribution, physics-based parameter control, and non-rent-seeking token economics. The central claim is architectural: MEV-resistance is a feature; GEV-resistance is a design principle that must be applied at every layer of a financial system, not bolted onto one.

**Keywords:** MEV, extractable value, mechanism design, Shapley values, cooperative game theory, DeFi, rent-seeking

---

## 1. Introduction

Every major DeFi protocol solves a real problem. Chainlink solved oracle reliability. AAVE solved permissionless lending. Curve solved low-slippage stablecoin trading. Synthetix solved synthetic asset issuance. Then each one put a tollbooth in front of the solution.

LINK holders extract rent from oracle queries without providing data. AAVE governance token holders extract protocol revenue without providing liquidity. CRV's vote-escrow mechanism created a permanent governance aristocracy monetized through bribe markets (Convex, Votium). SNX stakers bear socialized debt risk without Shapley-proportional attribution of their marginal contribution.

These are not bugs. They are features — features designed to capture value for intermediaries at the expense of the users who generate it. MEV is merely the most visible instance of this pattern because it operates on millisecond timescales and leaves on-chain evidence. But the extraction is the same whether it takes milliseconds (sandwich attacks), months (VC lockup dumps), or is continuous (token rent on every transaction).

We propose that the correct unit of analysis is not MEV but **GEV** — the total extractable value across all structural asymmetries in a protocol. A system is GEV-resistant when no participant can extract disproportionate value relative to their marginal contribution, as measured by Shapley values from cooperative game theory.

---

## 2. Taxonomy of Generalized Extractable Value

We identify seven distinct GEV vectors, each exploiting a different structural asymmetry:

### 2.1 Transaction Ordering Extractable Value (MEV)

**Asymmetry exploited:** Information about pending transactions in the mempool.

**Mechanism:** Validators, builders, and searchers reorder, insert, or censor transactions to capture value. Sandwich attacks bracket a victim's swap with a frontrun (buy) and backrun (sell), extracting the price impact as profit. Flashbots reports cumulative MEV extraction exceeding $680M on Ethereum mainnet through 2024.

**Who extracts:** Block builders, searchers, validators.

**Who pays:** Traders, who receive worse execution prices.

### 2.2 Governance Extractable Value (GoEV)

**Asymmetry exploited:** Concentration of governance tokens enables minority control over protocol parameters that affect all participants.

**Mechanism:** Governance token holders vote to direct protocol revenue, emissions, or fee structures to benefit themselves. This manifests as:
- **Bribe markets:** Convex and Votium enable CRV holders to sell their governance votes, converting public goods (emission direction) into private rent.
- **Parameter capture:** MakerDAO's stability fee is set by MKR holders who benefit from higher fees (more MKR burned) at the expense of borrowers.
- **Insider governance:** Foundation-held tokens vote on proposals that benefit the foundation.

**Who extracts:** Large token holders, bribe market participants, protocol insiders.

**Who pays:** Users subject to governance-set parameters (borrowers, LPs, traders).

### 2.3 Token Rent-Seeking Extractable Value (TrEV)

**Asymmetry exploited:** Protocol-mandated token intermediation in value flows that don't require a token.

**Mechanism:** A protocol requires holding or spending its native token to access services, when the token adds no technical necessity. LINK must be held by Chainlink node operators not because the cryptographic oracle mechanism requires it, but because the tokenomics model imposes it as economic rent. GRT curators stake tokens to signal which subgraphs deserve indexing — the staking is speculative positioning, not a quality signal.

**Who extracts:** Token holders who earn rent from mandatory intermediation.

**Who pays:** Users who pay inflated costs for services that could be priced at marginal cost.

### 2.4 Capital Formation Extractable Value (CfEV)

**Asymmetry exploited:** Asymmetric access to token supply at formation (VC rounds, insider allocations, team reserves).

**Mechanism:** Venture capital firms purchase tokens at pre-public prices with lockup schedules, then liquidate into retail demand. The median VC-backed token in 2024 experienced a 72% price decline within 12 months of lockup expiry (Messari). The value extracted is the delta between the VC entry price and the average retail purchase price, multiplied by supply sold.

**Who extracts:** VCs, team members, advisors with pre-public access.

**Who pays:** Public market participants who absorb sell pressure from lockup expiries.

### 2.5 Oracle Extractable Value (OrEV)

**Asymmetry exploited:** Control over the data pipeline between off-chain reality and on-chain state.

**Mechanism:** Oracle providers extract rent by intermediating price data. Chainlink's decentralized oracle network is technically sound, but LINK's tokenomics impose a tax on every price query — node operators must hold LINK as stake, and the cost is passed to consuming protocols. More critically, oracle latency creates arbitrage opportunities: anyone who sees the off-chain price before the oracle updates the on-chain price can trade the stale price. This is oracle MEV — a hybrid of information asymmetry and timing advantage.

**Who extracts:** Oracle operators (rent), arbitrageurs (latency), oracle manipulators (flash loan attacks on TWAP oracles).

**Who pays:** Protocols that consume price feeds, users who trade against stale prices.

### 2.6 Platform Extractable Value (PlEV)

**Asymmetry exploited:** Platform control over user relationships, data, and access.

**Mechanism:** Centralized frontends, proprietary APIs, and data silos enable platform operators to extract value from user activity. This includes:
- **Fee capture:** Protocol fees set by governance (see GoEV) and directed to insiders.
- **Data harvesting:** User trading patterns, portfolio compositions, and transaction histories monetized without consent.
- **Access control:** API rate limits, frontend geo-restrictions, and KYC gates used as competitive moats rather than regulatory compliance.

**Who extracts:** Platform operators, data brokers, frontend providers.

**Who pays:** Users whose data and activity generate the platform's value.

### 2.7 Liquidation Extractable Value (LqEV)

**Asymmetry exploited:** Priority access to liquidation transactions on lending and perpetual protocols.

**Mechanism:** When a borrower's collateral falls below the health factor threshold, liquidators compete to seize the collateral at a discount. This competition occurs through the same MEV infrastructure (Flashbots, private mempools) but targets a different value source. On Hyperliquid and dYdX, liquidation MEV is the primary extraction vector — the protocol's sequencer has privileged access to liquidation ordering.

**Who extracts:** Liquidation bots, sequencer operators, validators.

**Who pays:** Borrowers who receive worse liquidation prices than necessary.

---

## 3. The GEV Framework

### 3.1 Formal Definition

Let $P$ be a protocol with participant set $N = \{1, 2, \ldots, n\}$. For each participant $i$, define:

- $v_i$ — the value participant $i$ generates for the protocol (e.g., liquidity provision, trade volume, data contribution)
- $\phi_i$ — participant $i$'s Shapley value: their marginal contribution averaged across all possible coalitions
- $r_i$ — the value participant $i$ actually receives from the protocol

**Definition.** The **Generalized Extractable Value** of protocol $P$ is:

$$GEV(P) = \sum_{i \in N} \max(0, r_i - \phi_i)$$

This is the total value received by participants in excess of their Shapley-fair share. A protocol is **GEV-resistant** if and only if $GEV(P) = 0$ — no participant receives more than their marginal contribution warrants.

### 3.2 Properties

GEV has several properties that distinguish it from MEV:

**Comprehensiveness.** MEV captures only transaction-ordering extraction. GEV captures all structural extraction, including governance, tokenomics, capital formation, and platform effects.

**Shapley grounding.** GEV is measured against the Shapley value — the unique allocation satisfying efficiency, symmetry, linearity, and the null player property. This is not an arbitrary fairness criterion; it is the only allocation that satisfies all four axioms of cooperative game theory simultaneously (Shapley, 1953).

**Structural, not behavioral.** GEV measures extraction potential embedded in protocol design, not individual bad behavior. A protocol with GEV > 0 enables extraction even if no participant currently exploits it. The vulnerability is structural, and the fix must be structural.

### 3.3 The Impossibility of Partial GEV-Resistance

A protocol that eliminates MEV but retains GoEV is not GEV-resistant. The governance token holders will extract value through parameter manipulation even if they cannot frontrun trades. The extraction simply moves to the governance layer.

This is the fundamental insight: **extraction is conserved across layers**. Eliminating it at one layer without eliminating it at all layers merely redirects it. MEV-resistant protocols with rent-seeking governance tokens have not reduced GEV — they have relocated it.

Corollary: GEV-resistance must be applied at every layer simultaneously. It is an architectural property, not a feature.

---

## 4. VSOS: Layer-by-Layer GEV Elimination

VSOS (VibeSwap Operating System) is a financial operating system designed for GEV = 0 across all layers. Each of the seven GEV vectors is addressed by a specific mechanism:

### 4.1 MEV → Commit-Reveal Batch Auctions

**Mechanism:** Orders are submitted as hashed commitments during an 8-second commit phase, revealed during a 2-second reveal phase, then settled at a uniform clearing price after a Fisher-Yates shuffle using XOR'd participant secrets.

**Why GEV = 0:** No participant can observe other orders before committing (information symmetry). The shuffle eliminates ordering advantage. The uniform clearing price means all participants in a batch receive the same price — there is no "better execution" to extract.

**Formal property:** The commit-reveal scheme is a sealed-bid auction. Under the revelation principle, truthful bidding is weakly dominant. The uniform clearing price eliminates intra-batch price discrimination.

### 4.2 GoEV → Ungovernance + PID Auto-Tuning

**Mechanism:** The Ungovernance Time Bomb decays all voting power over time. Parameters that typically require governance votes (stability fees, emission rates, interest rate curves) are controlled by PID (Proportional-Integral-Derivative) controllers that auto-adjust based on on-chain signals.

**Why GEV = 0:** If voting power decays, governance capture is impossible — no permanent aristocracy can form. If parameters are set by physics (PID feedback loops responding to utilization, peg deviation, or volatility), there are no parameters for governance to capture. The attack surface for GoEV is reduced to zero by eliminating governance's control over extractable parameters.

**Formal property:** The PID controller's setpoint is defined at protocol deployment. The controller adjusts toward the setpoint using on-chain observables. No human input is required or accepted for parameter adjustment. Governance retains control only over non-extractable parameters (UI preferences, documentation).

### 4.3 TrEV → Shapley Distribution, No Tollbooth Tokens

**Mechanism:** Protocol revenue (from priority auction bids, penalty fees, and cross-chain bridge usage) is distributed via Shapley values computed on-chain. There are no tokens that must be held to access services. Oracle queries are pay-per-query. Lending is pay-per-borrow. No LINK, no GRT, no PUSH intermediation.

**Why GEV = 0:** If there is no mandatory token intermediation, there is no rent to extract. Revenue flows to contributors proportional to their marginal contribution (Shapley), not proportional to their token holdings. The pairwise Shapley verification formula enables O(1) on-chain checking:

$$|\phi_i \cdot w_j - \phi_j \cdot w_i| \leq \varepsilon$$

where $\phi_i$ is participant $i$'s Shapley value and $w_i$ is their weight. Any participant can verify their allocation is fair without trusting the protocol.

### 4.4 CfEV → Fair Launch + ContributionDAG + Retroactive Shapley

**Mechanism:** No VC rounds. No insider allocation. No team tokens with lockup schedules. Initial distribution is via contribution mining — participants earn tokens by contributing value (liquidity, code, documentation, community building), with contributions tracked in an on-chain ContributionDAG and retroactively weighted by Shapley values.

**Why GEV = 0:** If there is no asymmetric access to supply, there is no capital formation extraction. All participants face the same acquisition function: contribute value, receive proportional tokens. The ContributionDAG's Lawson constant (a cryptographic commitment to the founder's contribution) ensures even the founder's allocation is Shapley-computable and publicly verifiable.

**Formal property:** The Cave Theorem states that foundational contributions earn more by the mathematics of Shapley values (they appear in more coalitions), not by timestamp advantage or insider access. Early contributors earn more because they contribute more marginal value, not because they had early access.

### 4.5 OrEV → Quality-Weighted Rewards, First-Party Feeds

**Mechanism:** VibeOracleRouter aggregates from three source types: first-party feeds (API3 pattern — data providers run their own nodes), aggregated feeds (Chainlink pattern — multi-source median), and low-latency feeds (Pyth pattern — institutional market makers). Providers are rewarded by accuracy contribution via Shapley attribution. Accuracy scores decay over time to prevent lock-in.

**Why GEV = 0:** No LINK/GRT/TRAC tribute token. Providers earn by the quality of their data, not by holding a rent-seeking token. The weighted median resists 49% corruption. Accuracy decay ensures providers must continuously earn their position — historical accuracy does not create permanent rent.

### 4.6 PlEV → Cooperative Capitalism, Fork Escape, Mutualist Absorption

**Mechanism:** VSOS's Plugin Registry, Hook System, and Fractal Fork Network ensure that any layer can be forked with zero penalty. Protocols absorbed into VSOS retain their innovation while shedding their extractive tokenomics. Contributors to absorbed protocols receive Shapley-fair retroactive rewards through mutualist absorption — not vampire attacks.

**Why GEV = 0:** If the cost of forking is zero, platform lock-in is impossible. If platform lock-in is impossible, platform extraction is impossible. Users can exit to a fork at any time, which disciplines the protocol against extractive behavior. This is the same mechanism that disciplines competitive markets — the threat of exit constrains rent-seeking.

**Formal property:** The Fractal Fork Network implements Hirschman's exit-voice framework (1970) as a protocol primitive. Exit is costless. Therefore, the only sustainable strategy is to provide value at marginal cost — which is exactly the GEV = 0 condition.

### 4.7 LqEV → Batch-Settled Perpetuals

**Mechanism:** VibePerpEngine settles liquidations through the same commit-reveal batch auction used for spot trading. Liquidations are not first-come-first-served races. They are batched, shuffled, and settled at uniform clearing prices.

**Why GEV = 0:** The same information symmetry that eliminates MEV in spot trading eliminates LqEV in perpetual liquidations. No liquidator has ordering advantage. No sequencer has privileged access. The liquidation discount is set by market clearing, not by the speed of a liquidation bot.

---

## 5. The Composability Constraint

GEV-resistance is not compositional by default. Two GEV-resistant modules can create GEV when composed if their interface permits extraction.

**Example:** A GEV-resistant lending protocol composed with a GEV-resistant oracle can still create OrEV if the lending protocol's liquidation threshold depends on oracle latency that a sophisticated actor can anticipate.

VSOS addresses this through three composability constraints:

1. **All modules read ShapleyDistributor for reward distribution.** There is one canonical attribution mechanism, not per-module attribution that could be gamed across boundaries.

2. **All modules write to ContributionDAG for credit.** Cross-module contributions are tracked in a single graph, preventing double-counting or attribution gaps at module boundaries.

3. **All modules use CircuitBreaker for safety.** Volume, price, and withdrawal circuit breakers apply globally, preventing cross-module cascading failures that create extraction opportunities.

These three constraints ensure that GEV-resistance composes. The proof is straightforward: if every value flow passes through Shapley attribution, every credit is recorded in one graph, and every risk is bounded by one breaker, then no cross-module extraction is possible that isn't caught by one of the three.

---

## 6. Comparison with Existing Approaches

### 6.1 MEV-Only Solutions

**Flashbots/MEV-Share:** Redistributes MEV to users via orderflow auctions. Does not address GoEV, TrEV, CfEV, OrEV, PlEV, or LqEV. GEV reduction: ~14% (only the MEV component).

**Encrypted mempools (Shutter, threshold encryption):** Eliminates frontrunning by encrypting transactions until block inclusion. Does not address post-inclusion extraction (governance, tokenomics). GEV reduction: ~14%.

**Batch auctions (CowSwap, 1inch Fusion):** Eliminates intra-batch ordering extraction. Similar to our approach for MEV specifically, but does not extend to other GEV vectors. GEV reduction: ~14%.

### 6.2 Governance Reform

**Optimistic governance (Compound, Nouns):** Reduces governance overhead but does not eliminate governance extraction — token holders still control extractable parameters. GEV reduction: marginal.

**Conviction voting:** Aligns vote weight with time commitment. Reduces but does not eliminate governance capture (whales with long time horizons still dominate). GEV reduction: partial on GoEV only.

### 6.3 Fair Launch Protocols

**Liquidity bootstrapping pools (Balancer LBP):** Fairer initial distribution but does not prevent post-launch extraction through governance or tokenomics. GEV reduction: partial on CfEV only.

### 6.4 VSOS

**All seven vectors addressed simultaneously.** GEV reduction: total, by design.

The key differentiator is not that VSOS has better solutions for any single vector — CowSwap's batch auction is comparable to ours for MEV specifically. The differentiator is that VSOS applies GEV-resistance as an architectural constraint across every layer, ensuring extraction cannot relocate from one vector to another.

---

## 7. Limitations and Open Questions

### 7.1 Shapley Computation Complexity

The exact Shapley value requires evaluating the marginal contribution of each player across all $2^n$ coalitions. For large participant sets, this is computationally infeasible. VSOS uses the pairwise verification formula for O(1) on-chain checking, but the underlying Shapley calculation relies on off-chain computation with on-chain verification. The security of this approach depends on the verifier's ability to detect incorrect Shapley values — an open challenge for adversarial environments.

### 7.2 PID Controller Robustness

PID auto-tuning eliminates GoEV by removing human control over parameters. But PID controllers can be manipulated through their input signals. An attacker who can influence the on-chain observables that the PID controller reads (utilization rate, peg deviation) can indirectly control the parameters. VSOS mitigates this with TWAP validation (max 5% deviation) and circuit breakers, but the formal robustness guarantee against adversarial PID manipulation remains an open problem.

### 7.3 Fork Escape as Deterrent vs. Reality

The Fractal Fork Network's GEV-resistance depends on the credibility of the fork threat. In practice, forking a protocol with significant network effects (liquidity, integrations, user base) is costly despite being technically free. The GEV = 0 argument assumes rational actors who will fork when extraction exceeds forking costs. If forking costs are high due to network effects, some PlEV may persist. This is the same limitation that constrains competition in traditional markets.

### 7.4 Cross-Chain GEV

VSOS operates across chains via LayerZero V2. Cross-chain message latency creates a new GEV vector: participants who observe state on one chain can act on another chain before the cross-chain message arrives. The BatchProver's cross-chain proof verification reduces but may not eliminate this vector. Cross-chain GEV resistance is an active area of development.

---

## 8. Conclusion

MEV is not the disease. It is a symptom. The disease is structural extraction — value captured by intermediaries through asymmetries in information, governance, timing, capital access, data control, and liquidation priority.

We have formalized this as Generalized Extractable Value (GEV) and identified seven distinct vectors. We have shown that partial solutions — addressing MEV alone, or governance alone, or tokenomics alone — merely relocate extraction to the unaddressed vectors. Extraction is conserved across layers.

VSOS demonstrates that GEV-resistance is achievable as an architectural property, not a feature. The mechanisms are not novel individually — batch auctions, Shapley values, PID controllers, and fair launches are established primitives. The contribution is compositional: applying all of them simultaneously, at every layer, with three composability constraints (unified Shapley attribution, unified contribution tracking, unified circuit breaking) that ensure GEV-resistance is preserved under composition.

The result is a financial operating system where the answer to "who extracts?" is "nobody" — not because extraction is prohibited by governance (which can be captured), but because extraction is impossible by construction. Policy becomes physics.

> Every protocol on the VSOS absorption list solved a real problem. Then they put a tollbooth in front of the solution. We remove the tollbooth and replace it with math.

---

## References

1. Daian, P., Goldfeder, S., Kell, T., et al. (2019). "Flash Boys 2.0: Frontrunning, Transaction Reordering, and Consensus Instability in Decentralized Exchanges." *IEEE S&P 2020*.

2. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, pp. 307–317. Princeton University Press.

3. Hirschman, A. O. (1970). *Exit, Voice, and Loyalty: Responses to Decline in Firms, Organizations, and States.* Harvard University Press.

4. Roughgarden, T. (2021). "Transaction Fee Mechanism Design." *ACM EC 2021*.

5. Flashbots. (2024). "MEV-Explore: Cumulative Extracted MEV." https://explore.flashbots.net.

6. Messari. (2024). "VC Token Unlock Impact Analysis." Messari Research Report.

7. Buterin, V. (2021). "Moving beyond coin voting governance." https://vitalik.eth.limo.

8. Glynn, W. (2026). "VSOS Protocol Absorption: 28 Protocols into 9 Modular Layers." VibeSwap Documentation.

9. Glynn, W. (2026). "Symbolic Compression in Human-AI Knowledge Systems." arXiv preprint.

10. Glynn, W. (2018). "Wallet Security Axioms: Seven Principles for Cryptocurrency Key Management." Independent Publication.

---

*Corresponding author: William Glynn — github.com/wglynn*
