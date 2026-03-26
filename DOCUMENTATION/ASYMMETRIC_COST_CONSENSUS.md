# Asymmetric Cost Consensus: Why Attack Cost Must Grow Faster Than Defense Cost

**Faraday1 (Will Glynn)**

**March 2026**

---

## Abstract

Traditional security in decentralized finance operates as a treadmill: defenders spend more, attackers spend more, and neither side achieves a durable advantage. This paper argues that the fundamental design objective for secure mechanism design is not to make attacks expensive, but to make the *ratio* of attack cost to defense cost diverge to infinity. We formalize this as the Asymmetric Cost Theorem: a mechanism M is asymptotically secure if and only if the cost of attacking M grows strictly faster than the cost of defending M as the system scales. We analyze five mechanisms deployed in VibeSwap --- commit-reveal batch auctions, Shapley-based reward distribution, flash loan collateral locks, governance contribution weighting, and circuit breakers --- and show that each exhibits superlinear or exponential attack-cost growth against constant or sublinear defense cost. We then connect asymmetric cost design to antifragility, temporal irreducibility, and the structural distinction between "expensive" and "impossible." We conclude by proposing a universal design rule: no mechanism should ship unless its attack/defense cost ratio is monotonically increasing.

---

## Table of Contents

1. [Introduction: The Hobbesian Trap in DeFi](#1-introduction-the-hobbesian-trap-in-defi)
2. [Symmetric vs. Asymmetric Cost Scaling](#2-symmetric-vs-asymmetric-cost-scaling)
3. [The Asymmetric Cost Theorem](#3-the-asymmetric-cost-theorem)
4. [Case Studies in VibeSwap](#4-case-studies-in-vibeswap)
5. [Antifragility as Compounding Asymmetry](#5-antifragility-as-compounding-asymmetry)
6. [Temporal Irreducibility and Proof of Contribution](#6-temporal-irreducibility-and-proof-of-contribution)
7. [Comparison: PoW, PoS, and IIA Mechanisms](#7-comparison-pow-pos-and-iia-mechanisms)
8. [Expensive vs. Impossible: A Structural Distinction](#8-expensive-vs-impossible-a-structural-distinction)
9. [The Design Rule](#9-the-design-rule)
10. [Limitations and Future Work](#10-limitations-and-future-work)
11. [Conclusion](#11-conclusion)

---

## 1. Introduction: The Hobbesian Trap in DeFi

### 1.1 The Arms Race Problem

Thomas Hobbes described the state of nature as a war of all against all, not because every actor is malicious, but because every actor *must assume* that every other actor might be. The rational response is to arm yourself. The rational counter-response is to arm yourself more. The result is an equilibrium where everyone spends heavily on offense and defense, nobody gains a relative advantage, and the total cost of participation rises without bound.

Decentralized finance has inherited this trap in a precise and measurable form. MEV searchers invest in faster infrastructure; protocols invest in MEV protection. Oracle manipulators invest in capital to move prices; protocols invest in TWAP windows and circuit breakers. Governance attackers accumulate voting power; protocols invest in timelocks, quorums, and veTokenomics. In each case, both sides of the contest face costs that scale in the same way. The attacker pays more, the defender pays more, and the security margin --- the gap between attack cost and attack reward --- remains roughly constant.

This is the security treadmill. It is the default outcome when attack and defense costs scale symmetrically.

### 1.2 The Cost of Symmetric Security

The cost of the treadmill is not merely financial. It is architectural. When defense cost scales linearly with attack cost, every new defense mechanism must be maintained, upgraded, and monitored indefinitely. The protocol accumulates complexity. Complexity creates new attack surfaces. New attack surfaces require new defenses. The defender's codebase grows monotonically, and with it, the probability of implementation error.

This is not a theoretical concern. The history of DeFi exploits is substantially a history of complexity-induced bugs in defensive code: reentrancy guards that were applied to four of five entry points, oracle checks that protected one price feed but not another, access control that was enforced on the main contract but not on its proxy. The treadmill does not merely fail to solve the problem. It *creates* new instances of the problem.

### 1.3 The Alternative

The alternative is to design mechanisms where the defender's cost is *structurally different* from the attacker's cost --- not merely lower, but growing at a fundamentally slower rate. If the defender pays once and the attacker must pay exponentially more with each additional unit of attack power, then scaling favors the defender. The security margin does not remain constant; it diverges. Time is on the defender's side. The treadmill stops.

This paper formalizes that intuition.

---

## 2. Symmetric vs. Asymmetric Cost Scaling

### 2.1 Definitions

Let M be a mechanism. Let C_defense(n) denote the cost to the defender (protocol operator or honest participants) of securing M when the system processes n units of activity (transactions, batches, proposals, etc.). Let C_attack(n) denote the minimum cost to an attacker of successfully exploiting M at scale n.

**Definition 1 (Symmetric Cost Scaling).** M exhibits symmetric cost scaling if there exist constants c_1, c_2 > 0 such that for all sufficiently large n:

```
c_1 <= C_attack(n) / C_defense(n) <= c_2
```

That is, the attack/defense cost ratio is bounded above and below by constants. Both costs grow at the same asymptotic rate.

**Definition 2 (Asymmetric Cost Scaling).** M exhibits asymmetric cost scaling in favor of the defender if:

```
lim (n -> infinity) C_attack(n) / C_defense(n) = infinity
```

The attack cost grows strictly faster than the defense cost. No constant multiple of the defense cost suffices to mount an attack at sufficient scale.

### 2.2 Why the Ratio Matters

The absolute magnitude of C_attack(n) is not, by itself, a useful security metric. A mechanism where C_attack = $1 billion and C_defense = $1 billion is not secure in any meaningful sense; it is merely expensive for both parties. If the attacker has access to $2 billion and the defender does not, the attacker wins.

The ratio C_attack / C_defense captures something more fundamental: the *structural advantage* of one side over the other. A diverging ratio means that no amount of capital accumulation by the attacker can overcome the defender's positional advantage. The defender does not need to match the attacker dollar for dollar. The defender needs only to maintain the mechanism, and the mechanism itself imposes escalating costs on the attacker.

### 2.3 Examples of Symmetric and Asymmetric Costs in Nature

Symmetric cost scaling appears throughout adversarial systems. In conventional warfare, both attacker and defender must pay the cost of soldiers, materiel, and logistics, and these costs scale roughly linearly with the scale of the conflict. In corporate competition, both incumbents and challengers must pay for talent, marketing, and infrastructure. In cybersecurity, both penetration and patching require human expertise that scales with code complexity.

Asymmetric cost scaling appears wherever one side possesses an informational or physical advantage that cannot be purchased. Cryptographic hash functions exhibit extreme asymmetry: computing a hash costs O(1), but inverting it costs O(2^n). Geographic defense exhibits asymmetry: defending a mountain pass costs far less than assaulting it. Temporal irreducibility exhibits asymmetry: verifying that someone has contributed to a project for three years takes O(1) (check the ledger), but fabricating three years of genuine contribution takes three years, irrespective of capital.

---

## 3. The Asymmetric Cost Theorem

### 3.1 Statement

**Theorem (Asymmetric Cost Security).** Let M be a mechanism with attack cost function C_attack(n) and defense cost function C_defense(n), where n represents system scale. Let R_attack(n) denote the maximum reward available to a successful attacker at scale n. If:

1. C_attack(n) / C_defense(n) -> infinity as n -> infinity, and
2. R_attack(n) is bounded above by some polynomial in n,

then there exists a threshold n* such that for all n > n*, no rational attacker will invest in attacking M. That is, M is asymptotically secure against rational adversaries.

### 3.2 Proof Sketch

A rational attacker invests in attack if and only if expected reward exceeds expected cost: E[R_attack(n)] > C_attack(n). By condition (2), R_attack(n) <= p(n) for some polynomial p. By condition (1), C_attack(n) grows faster than any constant multiple of C_defense(n), and since C_defense(n) >= 1 for any operational mechanism, C_attack(n) itself grows without bound. Since C_attack(n) -> infinity and R_attack(n) <= p(n), and since superlinear or exponential growth eventually dominates any polynomial, there exists n* such that C_attack(n) > R_attack(n) for all n > n*. Beyond this threshold, the expected profit of attack is negative. A rational attacker will not invest.

### 3.3 The Bounded Reward Condition

Condition (2) deserves elaboration. In most DeFi protocols, the reward available to an attacker is bounded by the value locked in the system at the time of attack. If the mechanism is designed so that no single transaction or batch can access more than a bounded fraction of total value, then R_attack(n) grows at most linearly with n (proportional to the value in each batch). This is achievable through per-batch caps, rate limiting, and collateral requirements --- all of which VibeSwap implements.

The critical insight is that the bounded reward condition is itself a design choice. A mechanism where a single exploit can drain all locked value has R_attack(n) proportional to total TVL, which may grow superlinearly. A mechanism where exploits are contained to individual batches has R_attack(n) proportional to batch size, which is bounded by design. The bounded reward condition is not an assumption about the world; it is a property of well-designed mechanisms.

### 3.4 Implications

The theorem has a sharp practical implication: **the only security metric that matters in the long run is the growth rate of the attack/defense cost ratio.** If the ratio is constant, the mechanism will eventually be broken by a sufficiently capitalized attacker. If the ratio diverges, the mechanism becomes more secure over time, even as more value flows through it. Scale is the defender's ally, not the attacker's.

---

## 4. Case Studies in VibeSwap

### 4.1 Commit-Reveal: Cryptographic Asymmetry

**Mechanism.** Users submit hash(order || secret) during the commit phase. Orders are revealed in the subsequent reveal phase. Settlement uses a uniform clearing price computed after all orders are visible.

**Defense cost.** Computing one SHA-256 hash per order: O(1) per commit. Storing and verifying hashes: O(n) per batch, where n is the number of orders.

**Attack cost.** To front-run or sandwich a committed order, the attacker must determine the order's contents before the reveal phase. This requires inverting the SHA-256 hash, which has computational cost O(2^256) per hash. No amount of capital reduces this cost; it is a property of the hash function's preimage resistance.

**Cost ratio.** C_attack / C_defense = O(2^256) / O(n) = O(2^256 / n). For any realistic n (even 10^18 orders per batch), this ratio is astronomically large and *increasing* as defense cost per unit decreases through batching efficiencies.

**Classification.** Exponential asymmetry. The attack is not expensive. It is computationally impossible within the age of the universe. This is the strongest possible form of asymmetric cost.

### 4.2 Sybil Attack on Shapley Distribution

**Mechanism.** The ShapleyDistributor allocates rewards proportional to each participant's marginal contribution to the coalition, as computed by the Shapley value. The Shapley value satisfies four axioms: efficiency, symmetry, linearity, and the null player axiom.

**Defense cost.** Computing Shapley values: O(1) per participant (amortized, using on-chain contribution tracking). The null player axiom is enforced automatically by the mathematical structure of the Shapley value --- it requires no additional code, monitoring, or human intervention.

**Attack cost.** To extract rewards via sybil identities, the attacker creates N fake accounts. Each account must post collateral (linear cost: N * collateral_per_account). However, the null player axiom guarantees that any participant whose marginal contribution to every coalition is zero receives a Shapley value of exactly zero. Sybil identities, by definition, contribute nothing that the attacker's primary identity does not already contribute. Their marginal contribution is zero. Their reward is zero.

**Cost ratio.** C_attack = O(N * collateral). R_attack = 0. The ratio C_attack / C_defense is technically undefined (division by positive defense cost yields a finite ratio, but the *net return* to the attacker is negative for any N > 0). More precisely: the attacker's cost grows linearly with N while the attacker's reward remains identically zero. The attack becomes more expensive without ever becoming more profitable.

**Classification.** Linear cost, zero reward. The asymmetry here is not in the cost ratio per se, but in the complete decoupling of cost and reward. The Shapley null player axiom is not a defense mechanism bolted onto the protocol; it is a mathematical property of the reward function. There is nothing to attack. The cost of attempting an attack is positive; the reward is provably zero.

### 4.3 Flash Loan Neutralization

**Mechanism.** VibeSwap requires collateral to be locked in the same transaction that creates a commitment. The collateral must persist across block boundaries (the commit phase spans multiple blocks). Flash loans, by construction, must be borrowed and repaid within a single transaction.

**Defense cost.** One storage write per commitment to record the collateral lock: O(1). One block-number check per reveal to verify temporal separation: O(1). Total defense cost: constant, independent of system scale.

**Attack cost.** To use a flash loan for MEV extraction, the attacker must borrow capital, commit, wait for the reveal phase (which occurs in a later block), and then reveal. But the flash loan must be repaid within the originating transaction. The temporal gap between commit and reveal makes flash-loaned capital structurally unavailable. The attacker must therefore use *real* capital --- capital they actually own or can borrow at market rates over multiple blocks.

**Cost ratio.** Flash loans provide infinite leverage (borrow any amount, pay only gas + fees). VibeSwap's temporal lock reduces this leverage to exactly 1x. The attacker's effective cost goes from near-zero (flash loan fee) to the full capital requirement. If we model the flash loan attacker's cost as epsilon (arbitrarily small), then the ratio of "cost with VibeSwap's defense" to "cost without defense" is:

```
C_attack(with lock) / C_attack(without lock) = capital_required / epsilon -> infinity
```

The defense converts infinite leverage into zero leverage at O(1) cost.

**Classification.** Leverage nullification. The asymmetry is categorical: the attacker's most powerful tool (flash loans) is rendered entirely inoperative, not by an expensive countermeasure, but by a single temporal constraint that costs one storage write.

### 4.4 Governance Capture via Shapley Weighting

**Mechanism.** Governance weight in VibeSwap is not determined by token holdings alone. It is determined by Shapley contribution weight, which reflects the participant's marginal contribution to protocol value over time. Proposals can be vetoed if they violate constitutional constraints (P-000, P-001), and the veto computation costs O(1) per proposal.

**Defense cost.** Evaluating a proposal against constitutional constraints: O(1). Computing Shapley weights for voters: amortized O(1) per participant (weights are updated incrementally as contributions accrue).

**Attack cost.** To capture governance, the attacker must accumulate sufficient Shapley weight to outvote honest participants. Shapley weight is a function of *genuine contribution over time*. Contributions include liquidity provision, trading volume, oracle reporting, and other protocol-beneficial activities, all verified on-chain. The attacker cannot purchase Shapley weight on the open market; it is soulbound to the contributing address. The attacker cannot accelerate contribution; it accumulates in real time. To achieve weight equivalent to a participant who has contributed for T time units, the attacker must contribute for T time units.

**Cost ratio.** C_defense = O(1) per proposal (veto check). C_attack = O(T) where T is the *wall-clock time* required to accumulate sufficient contribution weight. Time is the one resource that cannot be compressed by capital. A billionaire and a thousandaire accumulate time at exactly the same rate: one second per second.

**Classification.** Temporal irreducibility. The attack cost is not merely high; it is denominated in an uncompressible resource. The cost ratio C_attack / C_defense = O(T) / O(1) = O(T), which diverges as the required contribution threshold increases. Moreover, honest participants accumulate weight passively through normal protocol usage, while the attacker must sustain dedicated capital commitment for the entire duration. The defender's cost is a byproduct of participation; the attacker's cost is the purpose of participation.

### 4.5 Circuit Breaker Evasion

**Mechanism.** Circuit breakers monitor per-batch volume, price deviation, and withdrawal rate. When any metric exceeds a configurable threshold, the breaker halts the affected operation until the anomaly resolves. Monitoring cost is O(n) per batch, where n is the number of transactions.

**Defense cost.** O(n) per batch for monitoring. Since n is bounded by batch size (which is a protocol parameter), this is effectively O(1) per batch at design-time scale.

**Attack cost.** To trigger protocol-damaging behavior without tripping the circuit breaker, the attacker must keep all monitored metrics below their thresholds while still executing a profitable exploit. This requires either: (a) executing the exploit so slowly that it falls below rate limits, which reduces the attacker's profit rate below the cost of capital; or (b) manipulating the metrics themselves, which requires moving real markets. Moving the market price of an asset by X% requires capital proportional to the asset's market capitalization and liquidity depth. As the protocol grows (higher TVL, deeper liquidity), the capital required to move prices without detection grows proportionally.

**Cost ratio.** C_defense = O(1) per batch (bounded monitoring). C_attack = O(market_cap * target_deviation) to manipulate prices sufficiently to exploit the protocol without triggering breakers. As the protocol scales and market cap grows, C_attack grows proportionally while C_defense remains constant.

**Classification.** Market-depth asymmetry. The defense cost is internal and fixed. The attack cost is external and scales with the protocol's success. A more successful protocol is a more expensive protocol to attack --- the exact inversion of the Hobbesian trap.

---

## 5. Antifragility as Compounding Asymmetry

### 5.1 The Feedback Loop

Asymmetric cost scaling establishes a favorable ratio at any given moment. Antifragility goes further: it makes the ratio *increase as a consequence of attacks*. The two properties are complementary. Asymmetric cost scaling is a static property (the ratio diverges with scale). Antifragility is a dynamic property (the ratio increases with adversarial activity).

### 5.2 Slashed Stakes Fund Defense

When an attacker in VibeSwap submits an invalid reveal, 50% of their committed collateral is slashed. This slashed capital flows to the insurance pool, which funds future defense: compensating victims of any exploit that does slip through, funding security audits, and deepening liquidity (which increases the cost of market manipulation).

The feedback loop is:

```
Attack attempt -> Slash -> Insurance pool grows -> Future attack cost increases
                                                -> Future defense cost stays flat
```

Each failed attack deposits capital into the defender's treasury. The attacker is *funding* the asymmetry that will make the next attack more expensive. This is not a metaphor. It is a concrete capital flow encoded in the protocol's smart contracts.

### 5.3 Formalization

Let A_k denote the k-th attack attempt, and let S_k denote the slashed amount from A_k. The insurance pool after k attacks is:

```
I_k = I_0 + sum(S_j, j=1..k)
```

The cost of the (k+1)-th attack is at minimum:

```
C_attack(k+1) >= C_attack(k) + f(S_k)
```

where f(S_k) represents the marginal increase in attack cost attributable to the insurance pool's growth (deeper liquidity, higher collateral requirements calibrated to pool size, etc.). Defense cost remains:

```
C_defense(k+1) = C_defense(k) + epsilon
```

where epsilon is negligible (monitoring an additional entry in the insurance ledger). The ratio:

```
C_attack(k) / C_defense(k)
```

is therefore monotonically increasing in k --- not merely in n (system scale), but in the *number of attacks*. Antifragility is compounding asymmetry.

---

## 6. Temporal Irreducibility and Proof of Contribution

### 6.1 Time as the Ultimate Asymmetric Cost

Every asymmetric cost mechanism we have examined relies on some resource that the attacker cannot cheaply produce: computational intractability (commit-reveal), genuine contribution (Shapley), real capital (flash loan lock), or market depth (circuit breakers). Among these, one resource is uniquely irreducible: time.

Computational intractability relies on assumptions about the hardness of mathematical problems. These assumptions may be violated by future algorithmic breakthroughs or quantum computing. Capital requirements can be met by sufficiently wealthy attackers. Market depth can be overcome by coordinated multi-party attacks. But time cannot be compressed. A year of contribution takes a year. No technology, no capital, no coordination can change this.

### 6.2 Proof of Contribution

VibeSwap's Proof of Contribution (PoC) weights governance and reward distribution by verified on-chain contribution history. The contribution record is soulbound, non-transferable, and temporally ordered. To achieve a contribution weight of W accumulated over time T, an attacker must:

1. Deploy real capital (collateral for trades, liquidity provision, etc.) for the full duration T.
2. Generate genuine value (the Shapley value detects and zeros out non-contributory activity).
3. Wait. There is no alternative.

The cost of fabricating T units of contribution history is *at minimum* T units of wall-clock time, multiplied by the opportunity cost of the deployed capital. This cost is irreducible in the strongest possible sense: it does not depend on hardware, algorithms, or market conditions. It depends only on the laws of physics.

### 6.3 The Contribution Asymmetry

A legitimate participant accumulates contribution weight as a *byproduct* of using the protocol for its intended purpose (trading, providing liquidity, reporting oracle prices). The marginal cost of contribution for an honest participant is zero: they are already doing what the protocol measures. An attacker, by contrast, must perform these activities *solely* to accumulate weight, at real capital cost, with no return from the activities themselves (since the Shapley value ensures that extractive behavior earns zero weight). The honest participant's contribution is costless. The attacker's contribution is expensive. This asymmetry is inherent in the structure of the mechanism and cannot be engineered away by the attacker.

---

## 7. Comparison: PoW, PoS, and IIA Mechanisms

### 7.1 Proof of Work: Symmetric and Linear

In Bitcoin's Proof of Work, both the honest miner and the attacking miner pay the same cost per unit of hash power: electricity. If the honest network produces H hashes per second at cost C_honest = H * energy_per_hash, then an attacker who wishes to achieve 51% of hash power must produce at least H hashes per second at cost C_attack = H * energy_per_hash. The cost ratio is:

```
C_attack / C_defense = (H * e) / (H * e) = 1
```

The ratio is constant. PoW security is symmetric: both sides pay the same rate for the same resource. The only defense is to outspend the attacker in absolute terms. This works when the honest network is large and the attacker is small, but it is not a structural advantage. It is a quantitative advantage that can be overcome by a sufficiently capitalized adversary. If a nation-state decided to attack Bitcoin, the cost would be large but *finite and calculable* --- there is no exponential barrier, no informational impossibility, no temporal irreducibility. Just a very large electricity bill.

### 7.2 Proof of Stake: Linear with Oligarchic Risk

In Proof of Stake, security is proportional to the value staked by honest validators. An attacker who wishes to control 33% of stake must acquire 33% of the staked token supply. The cost ratio is:

```
C_attack / C_defense = (0.33 * S * P) / (0.67 * S * P) = 0.49
```

where S is total staked supply and P is token price. The ratio is not merely constant; it is *less than one*. It costs less to attack than to defend. The defender's advantage comes from the fact that a successful attack would crash the token price, destroying the attacker's own stake. This is economic deterrence, not structural asymmetry. It relies on the attacker being rational and valuing their stake --- assumptions that fail against ideologically motivated attackers, nation-states, or attackers who hold offsetting short positions.

Moreover, PoS is oligarchic: large holders can compound staking rewards to acquire ever-larger fractions of total stake. Over time, the cost of governance capture *decreases* for the largest staker. This is the opposite of asymmetric cost scaling; it is *convergent* cost scaling, where the attacker's cost decreases with their existing power.

### 7.3 IIA Mechanisms: Exponential Through Information Hiding

VibeSwap's mechanisms derive their asymmetry from two sources that are categorically different from energy expenditure or capital accumulation:

**Information hiding.** The commit-reveal protocol, combined with the Independence of Irrelevant Alternatives (IIA) property of the batch auction, ensures that no individual order can be profitably front-run even if the attacker observes all other orders. The IIA condition means that the clearing price for any pair of assets is independent of the presence or absence of other orders. This is not a defense that can be overwhelmed by capital. It is a mathematical property of the pricing function. The attacker cannot "spend more" to defeat IIA any more than they can "spend more" to make 2 + 2 = 5.

**Temporal irreducibility.** Proof of Contribution imposes a cost denominated in time, which no technology can compress. A mechanism secured by temporal irreducibility has an attack cost that scales with wall-clock time, while the defense cost (verifying the contribution ledger) remains constant.

### 7.4 Summary Table

| Mechanism     | C_attack Growth     | C_defense Growth | Ratio Behavior  | Classification          |
|---------------|---------------------|------------------|-----------------|-------------------------|
| PoW           | O(n) (energy)       | O(n) (energy)    | Constant        | Symmetric, linear       |
| PoS           | O(S) (stake)        | O(S) (stake)     | Constant (< 1)  | Symmetric, oligarchic   |
| Commit-reveal | O(2^256) (compute)  | O(n) (hashes)    | Diverges (exp)  | Asymmetric, exponential |
| Shapley sybil | O(N * collateral)   | O(1) (math)      | Diverges, R = 0 | Asymmetric, zero-reward |
| Flash lock    | O(capital) (real)   | O(1) (storage)   | Diverges        | Asymmetric, leverage-nullifying |
| Governance    | O(T) (time)         | O(1) (veto)      | Diverges        | Asymmetric, temporally irreducible |
| Circuit break | O(market_cap)       | O(1) (monitor)   | Diverges        | Asymmetric, market-depth |

---

## 8. Expensive vs. Impossible: A Structural Distinction

### 8.1 The Spectrum of Deterrence

Security analysis in DeFi commonly reduces to the question: "How expensive is this attack?" This framing implicitly assumes that every attack has a finite cost, and that security is a matter of ensuring that the cost exceeds the reward. This assumption is wrong.

There is a categorical difference between an attack that costs $10 billion and an attack that requires inverting a SHA-256 hash. The former is expensive. The latter is impossible --- not improbable, not impractical, but *informationally impossible* given the known laws of computation. The distinction is not quantitative. It is qualitative. An attack that costs $10 billion will be executed by an adversary with $10 billion and sufficient motivation. An attack that requires 2^256 operations will not be executed by any adversary, regardless of motivation, because the required operations exceed the computational capacity of the observable universe.

### 8.2 VibeSwap's Position on the Spectrum

MEV extraction in VibeSwap is not expensive. It is informationally impossible.

A front-running attack requires knowing the contents of a committed order before the reveal phase. The committed order is concealed behind a SHA-256 hash. Recovering the order from the hash requires a preimage attack on SHA-256. The cost of this attack is not "high" in any economically meaningful sense. It is infinite in practice: the expected time to find a preimage exceeds the heat death of the universe by many orders of magnitude.

This is why the title of this paper uses the word "consensus" in a specific sense: the mechanisms agree, unanimously and independently, that attack cost must grow faster than defense cost. But the strongest of these mechanisms go beyond growth rates entirely. They place the attack cost at infinity --- not as a limit, but as a floor.

### 8.3 Degrees of Impossibility

It is useful to distinguish three levels:

1. **Economically impractical.** C_attack > R_attack at current prices and technology. The attack becomes feasible if prices change or technology improves. Example: 51% attack on a small PoW chain.

2. **Computationally intractable.** C_attack exceeds all computational resources that could plausibly be assembled. The attack is infeasible for any actor within the current technological paradigm, but may become feasible under paradigm shifts (e.g., quantum computing). Example: brute-forcing a 128-bit key.

3. **Informationally impossible.** The information required to execute the attack does not exist at the time the attack must be executed. No amount of computation can produce information that has not yet been generated. Example: predicting the content of a committed order before the reveal phase, when the order's secret is known only to the committer and has not been transmitted.

VibeSwap's commit-reveal mechanism operates at level 3. The order content is not merely hidden behind a computational barrier; it is *not yet public information*. The attacker is not trying to break a cipher. They are trying to read a message that has not been sent. This is a fundamentally different security posture than "the cipher is hard to break."

---

## 9. The Design Rule

### 9.1 Statement

For every new mechanism M proposed for inclusion in VibeSwap, compute:

```
R(n) = C_attack(n) / C_defense(n)
```

as a function of system scale n.

- If R(n) is constant or decreasing: **redesign**. The mechanism will become a liability as the protocol scales.
- If R(n) is increasing: **ship**. The mechanism becomes more secure as the protocol scales.
- If R(n) = infinity for all n (informational impossibility): **ship with high confidence**. The mechanism's security does not depend on economic conditions, attacker capitalization, or technological progress (within the current computational paradigm).

### 9.2 Application During Development

This rule is not merely a post-hoc evaluation criterion. It is a design constraint that should be applied during mechanism development. When designing a new feature, the first question is not "Is this attack expensive?" but "Does the attack cost grow faster than the defense cost?" If the answer is no, the mechanism should not be built in its current form, regardless of how expensive the attack appears at current scale. A constant ratio means that the attacker will eventually catch up. Scale will not save you. Only asymmetry will save you.

### 9.3 Composability

A system composed of multiple mechanisms is asymptotically secure if and only if every mechanism in the system is individually asymptotically secure. A single mechanism with a constant cost ratio creates an attack surface that scales with the system, regardless of how asymmetric the other mechanisms are. The attacker will target the weakest link. Therefore, the design rule must be applied to every mechanism, not merely to the system's most prominent features.

This is the reason VibeSwap employs defense in depth: commit-reveal (informational impossibility) + Shapley (zero-reward sybil resistance) + flash loan lock (leverage nullification) + circuit breakers (market-depth scaling) + governance contribution weighting (temporal irreducibility). Each mechanism independently exhibits asymmetric cost scaling. The composition inherits the *minimum* asymmetry of its components, which in VibeSwap's case is at least linear divergence (governance) and at best infinite (commit-reveal).

---

## 10. Limitations and Future Work

### 10.1 Rational Attacker Assumption

The Asymmetric Cost Theorem applies to rational attackers who maximize expected profit. It does not apply to irrational attackers (griefing, state-sponsored sabotage) who are willing to incur unbounded losses. Against irrational attackers, the relevant metric is not cost ratio but *blast radius*: how much damage can an attacker inflict regardless of cost? VibeSwap addresses this through circuit breakers and per-batch isolation, which bound the blast radius of any single attack. Formalizing blast radius bounds as a complement to the asymmetric cost framework is an open problem.

### 10.2 Quantum Computing

The commit-reveal mechanism's exponential asymmetry relies on the preimage resistance of SHA-256, which is believed to be secure against quantum computers (Grover's algorithm reduces the preimage cost from O(2^256) to O(2^128), which remains astronomically large). However, other cryptographic primitives used in the protocol (ECDSA signatures, for instance) are vulnerable to quantum attacks. Migrating to post-quantum cryptographic primitives while preserving the asymmetric cost properties is future work.

### 10.3 Empirical Validation

The asymptotic analysis presented here describes limiting behavior. Real systems operate at finite scale. Empirical measurement of actual attack/defense cost ratios at current VibeSwap scale, and tracking of these ratios as the protocol grows, would provide valuable validation of the theoretical framework.

### 10.4 Cross-Protocol Attacks

This analysis treats VibeSwap as an isolated system. In practice, DeFi protocols are composable, and attacks may exploit interactions between protocols. The cost ratio for cross-protocol attacks may differ from the single-protocol analysis. Extending the asymmetric cost framework to composable systems is an important direction for future research.

---

## 11. Conclusion

The Hobbesian trap in DeFi is not inevitable. It is the consequence of symmetric cost scaling: when attackers and defenders pay the same rate for the same resources, security becomes an arms race that neither side can win permanently. The escape from the trap is asymmetric cost design: mechanisms where the defender pays once and the attacker pays exponentially more with each unit of scale.

VibeSwap's architecture demonstrates that asymmetric cost scaling is not merely achievable but is already implemented across multiple independent mechanisms: cryptographic hiding (exponential asymmetry), Shapley reward theory (zero-reward sybil resistance), temporal collateral locking (leverage nullification), contribution-weighted governance (temporal irreducibility), and circuit breakers (market-depth scaling). These mechanisms do not merely make attacks expensive. They make attacks structurally unwinnable.

The strongest of these mechanisms --- commit-reveal with IIA pricing --- achieves something beyond asymmetric cost. It achieves informational impossibility. MEV in VibeSwap is not expensive to extract. It does not exist as extractable information at the time an attacker would need to act on it. The cost is not high. It is infinite. The distinction between "expensive" and "impossible" is the distinction between a lock that is hard to pick and a door that does not exist.

The design rule that emerges from this analysis is simple and absolute: for every mechanism, compute the attack/defense cost ratio as a function of scale. If the ratio is constant, redesign. If it diverges, ship. This rule, applied consistently, transforms security from a treadmill into a ratchet --- one that tightens with every unit of growth and, through antifragile feedback, with every attempted attack.

Security is not the absence of attackers. It is the presence of asymmetry.

---

## References

1. Hobbes, T. (1651). *Leviathan*.
2. Taleb, N. N. (2012). *Antifragile: Things That Gain from Disorder*. Random House.
3. Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System."
4. Shapley, L. S. (1953). "A Value for n-Person Games." In *Contributions to the Theory of Games II*. Princeton University Press.
5. Daian, P. et al. (2020). "Flash Boys 2.0: Frontrunning in Decentralized Exchanges." *IEEE S&P*.
6. Faraday1 (2026). "The IT Meta-Pattern: Adversarial Symbiosis, Temporal Collateral, Epistemic Staking, Memoryless Fairness." VibeSwap Documentation.
7. Faraday1 (2026). "Adversarial Symbiosis: Formalizing Antifragility as a Provable Mechanism Property." VibeSwap Documentation.
8. Faraday1 (2026). "Formal Fairness Proofs for VibeSwap." VibeSwap Documentation.
9. Arrow, K. J. (1950). "A Difficulty in the Concept of Social Welfare." *Journal of Political Economy*, 58(4).
10. Grover, L. K. (1996). "A Fast Quantum Mechanical Algorithm for Database Search." *Proceedings of STOC*.
