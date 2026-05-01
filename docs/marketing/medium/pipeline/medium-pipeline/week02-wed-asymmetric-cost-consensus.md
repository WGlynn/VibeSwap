# Asymmetric Cost Consensus: Why Attack Cost Must Grow Faster Than Defense Cost

## The difference between a lock that's hard to pick and a door that doesn't exist

---

Traditional security in decentralized finance operates as a treadmill: defenders spend more, attackers spend more, and neither side achieves a durable advantage. This paper argues that the fundamental design objective for secure mechanism design is not to make attacks expensive, but to make the *ratio* of attack cost to defense cost diverge to infinity.

We formalize this as the Asymmetric Cost Theorem: a mechanism is asymptotically secure if and only if the cost of attacking it grows strictly faster than the cost of defending it as the system scales.

---

## 1. The Hobbesian Trap in DeFi

Thomas Hobbes described the state of nature as a war of all against all — not because every actor is malicious, but because every actor *must assume* that every other actor might be. The rational response is to arm yourself. The rational counter-response is to arm yourself more. The result: everyone spends heavily on offense and defense, nobody gains a relative advantage, and the total cost of participation rises without bound.

DeFi has inherited this trap precisely. MEV searchers invest in faster infrastructure; protocols invest in MEV protection. Oracle manipulators invest in capital to move prices; protocols invest in TWAP windows and circuit breakers. Governance attackers accumulate voting power; protocols invest in timelocks and quorums.

In each case, both sides face costs that scale the same way. The attacker pays more, the defender pays more, and the security margin remains roughly constant.

**This is the security treadmill. It's the default when attack and defense costs scale symmetrically.**

The treadmill doesn't just fail to solve the problem — it creates new instances of it. The history of DeFi exploits is substantially a history of complexity-induced bugs in defensive code: reentrancy guards applied to four of five entry points, oracle checks that protected one feed but not another, access control enforced on the main contract but not on its proxy.

The alternative: design mechanisms where the defender's cost is *structurally different* from the attacker's cost. Not merely lower, but growing at a fundamentally slower rate.

---

## 2. Symmetric vs. Asymmetric Cost Scaling

**Symmetric cost scaling:** The attack/defense cost ratio stays bounded by constants. Both costs grow at the same asymptotic rate. Neither side achieves a durable advantage.

**Asymmetric cost scaling:** The attack/defense cost ratio diverges to infinity. No constant multiple of the defense cost suffices to mount an attack at sufficient scale.

The absolute magnitude of attack cost is not, by itself, a useful security metric. A mechanism where attack costs $1 billion and defense costs $1 billion is not secure — it's just expensive for everyone. If the attacker has $2 billion and the defender doesn't, the attacker wins.

The ratio captures something more fundamental: the structural advantage of one side over the other. A diverging ratio means no amount of capital accumulation by the attacker can overcome the defender's positional advantage.

Asymmetric cost appears wherever one side possesses an advantage that can't be purchased:

- **Cryptographic hash functions:** Computing a hash costs O(1). Inverting it costs O(2^256).
- **Geographic defense:** Defending a mountain pass costs far less than assaulting it.
- **Temporal irreducibility:** Verifying someone contributed for three years takes O(1). Fabricating three years of genuine contribution takes three years, regardless of capital.

---

## 3. The Asymmetric Cost Theorem

**Theorem:** Let M be a mechanism with attack cost C_attack(n) and defense cost C_defense(n), where n is system scale. If the cost ratio diverges to infinity, and the maximum attack reward is bounded by some polynomial, then there exists a threshold n* beyond which no rational attacker will invest. M is asymptotically secure.

**Why:** If attack cost grows superlinearly or exponentially while rewards grow at most polynomially, the cost eventually exceeds the reward permanently. Beyond that threshold, expected profit is negative.

The critical insight: the bounded reward condition is a design choice, not an assumption about the world. A mechanism where a single exploit can drain all locked value has unbounded attack reward. A mechanism where exploits are contained to individual batches (through per-batch caps, rate limiting, collateral requirements) has bounded attack reward.

**The only security metric that matters in the long run is the growth rate of the attack/defense cost ratio.** If constant, the mechanism will eventually be broken. If divergent, the mechanism becomes more secure over time. Scale becomes the defender's ally.

---

## 4. Five Case Studies

### 4.1 Commit-Reveal: Exponential Asymmetry

To front-run a committed order, the attacker must invert a SHA-256 hash: cost O(2^256). The defender computes one hash per order: cost O(1).

**Cost ratio: O(2^256).** This isn't expensive. It's computationally impossible within the age of the universe.

### 4.2 Shapley Sybil Resistance: Zero Reward

To extract rewards via sybil identities, the attacker creates N fake accounts at O(N * collateral) cost. The Shapley value's null player axiom guarantees that any participant whose marginal contribution is zero receives exactly zero reward. Sybil identities contribute nothing the primary identity doesn't already contribute.

**Attack cost: linear. Attack reward: zero.** The attack becomes more expensive without ever becoming more profitable.

### 4.3 Flash Loan Neutralization: Leverage Nullification

Flash loans provide infinite leverage — borrow any amount, pay only gas. VibeSwap's temporal lock (collateral must persist across block boundaries) reduces this leverage to exactly 1x. The attacker must use real capital.

**Defense cost: one storage write.** A single temporal constraint converts infinite leverage into zero leverage.

### 4.4 Governance Capture: Temporal Irreducibility

Governance weight is determined by Shapley contribution weight — verified on-chain contribution over time. It's soulbound, non-transferable, and temporally ordered. To achieve weight equivalent to a three-year contributor, the attacker must contribute for three years.

**Time is the one resource that cannot be compressed by capital.** A billionaire and a thousandaire accumulate time at exactly the same rate: one second per second.

The honest participant's cost is zero — contribution is a byproduct of normal usage. The attacker's cost is the full capital commitment sustained for the entire duration.

### 4.5 Circuit Breaker Evasion: Market-Depth Scaling

To exploit the protocol without tripping circuit breakers, the attacker must manipulate prices below detection thresholds. This requires capital proportional to market capitalization and liquidity depth. As the protocol grows, attack cost grows proportionally. Defense cost stays constant.

**A more successful protocol is a more expensive protocol to attack — the exact inversion of the Hobbesian trap.**

---

## 5. The Comparison Table

| Mechanism | Attack Cost Growth | Defense Cost Growth | Ratio | Classification |
|-----------|-------------------|--------------------| ------|---------------|
| PoW (Bitcoin) | O(n) energy | O(n) energy | Constant | Symmetric |
| PoS (Ethereum) | O(stake) | O(stake) | Constant (< 1) | Symmetric, oligarchic |
| Commit-reveal | O(2^256) | O(n) | Diverges (exp) | Asymmetric, exponential |
| Shapley sybil | O(N * collateral) | O(1) | Diverges, R=0 | Asymmetric, zero-reward |
| Flash lock | O(real capital) | O(1) | Diverges | Asymmetric, leverage-nullifying |
| Governance | O(time) | O(1) | Diverges | Asymmetric, temporally irreducible |
| Circuit breaker | O(market cap) | O(1) | Diverges | Asymmetric, market-depth |

PoW: both sides pay the same rate for the same resource. A nation-state could attack Bitcoin with a large but *finite and calculable* electricity bill. No exponential barrier, no temporal irreducibility. Just cost.

PoS: the ratio is less than one — it costs *less* to attack than to defend. Security relies on the assumption that the attacker values their own stake. This fails against ideologically motivated attackers, nation-states, or attackers holding offsetting short positions. Worse, PoS is oligarchic: large holders compound staking rewards to acquire ever-larger fractions, meaning governance capture cost *decreases* with existing power.

---

## 6. Antifragility as Compounding Asymmetry

Asymmetric cost scaling establishes a favorable ratio at any given moment. Antifragility makes the ratio *increase as a consequence of attacks.*

When an attacker submits an invalid reveal, 50% of their collateral is slashed. That capital flows to the insurance pool, which funds deeper liquidity (raising the cost of market manipulation) and future security audits.

```
Attack attempt → Slash → Insurance pool grows → Future attack cost increases
                                               → Future defense cost stays flat
```

Each failed attack deposits capital into the defender's treasury. The attacker is *funding* the asymmetry that makes the next attack more expensive. Not a metaphor — a concrete capital flow encoded in smart contracts.

The attack/defense cost ratio is monotonically increasing not just in system scale, but in the *number of attacks*. Antifragility is compounding asymmetry.

---

## 7. Expensive vs. Impossible

Security analysis commonly reduces to: "How expensive is this attack?" This implicitly assumes every attack has a finite cost. That assumption is wrong.

There's a categorical difference between an attack that costs $10 billion and one that requires inverting SHA-256. The former is expensive. The latter is impossible — not improbable, not impractical, but informationally impossible given the known laws of computation.

Three levels:

1. **Economically impractical.** C_attack > R_attack at current prices. Becomes feasible if conditions change.
2. **Computationally intractable.** Exceeds all assemblable computational resources. May fall to paradigm shifts (quantum).
3. **Informationally impossible.** The information required to execute the attack does not exist at the time it must be executed. No computation can produce information that hasn't been generated yet.

VibeSwap's commit-reveal operates at level 3. The attacker isn't trying to break a cipher. They're trying to read a message that hasn't been sent.

---

## 8. The Design Rule

For every mechanism, compute the attack/defense cost ratio as a function of scale:

- **Ratio constant or decreasing → Redesign.** The mechanism becomes a liability as the protocol scales.
- **Ratio increasing → Ship.** The mechanism becomes more secure with growth.
- **Ratio infinite → Ship with high confidence.** Security doesn't depend on economic conditions, attacker capitalization, or technological progress.

This rule applies to every component, not just the flagship features. A system composed of asymmetric mechanisms with one symmetric mechanism is insecure — the attacker targets the weakest link.

---

## 9. Conclusion

The Hobbesian trap in DeFi is not inevitable. It's the consequence of symmetric cost scaling. The escape is asymmetric cost design.

VibeSwap implements five independent asymmetric mechanisms: cryptographic hiding (exponential), Shapley theory (zero-reward), temporal locking (leverage nullification), contribution weighting (temporal irreducibility), and circuit breakers (market-depth scaling).

The strongest of these — commit-reveal with IIA pricing — achieves something beyond asymmetric cost. It achieves informational impossibility. MEV in VibeSwap is not expensive to extract. It doesn't exist as extractable information.

**Security is not the absence of attackers. It is the presence of asymmetry.**

> *"The difference between a lock that's hard to pick and a door that doesn't exist."*

---

*This is Part 5 of the VibeSwap Security Architecture series.*
*Previously: [Omniscient Adversary Proof](link) — security that holds even if the attacker has infinite energy and can time-travel.*
*Next: Antifragility Metric — formalizing systems that get stronger when attacked.*

*Full source: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)*
