# Proof of Mind: Cognitive Work as an Irreducible Consensus Security Dimension

*ethresear.ch*
*March 2026*

---

## Abstract

Proof of Work secures networks through thermodynamic cost. Proof of Stake secures them through economic lockup. Both are proxies for commitment, and both share a structural weakness: the resources they measure -- hash rate and capital -- can be acquired instantaneously by a sufficiently funded attacker. Neither mechanism can distinguish between a participant who has contributed to the network for three years and one who arrived with a large balance sheet yesterday.

This post presents Proof of Mind (PoM), a consensus weight function that incorporates cumulative verified cognitive contribution as a third security dimension. We show that this dimension introduces an irreducible temporal component to the attack cost function -- one that cannot be compressed with capital or computation. We describe the on-chain implementation (584 lines of Solidity), analyze the asymptotic attack cost properties, and discuss the implications for networks where human and AI actors participate in the same consensus process.

---

## 1. The Problem: Memoryless Security

Every deployed consensus mechanism has a memoryless cost function. A Bitcoin miner who has been honest for five years pays the same electricity per hash as a miner who started today. An Ethereum validator who has proposed 100,000 correct blocks receives the same base staking reward per epoch as a validator who just deposited 32 ETH. History provides no structural advantage in either system.

This memorylessness is a security gap:

| Attack Vector | PoW Defense Time | PoS Defense Time | Can Capital Accelerate? |
|---|---|---|---|
| 51% hashrate | Rent for hours (NiceHash) | N/A | Yes |
| Stake accumulation | N/A | Days to weeks (market buys) | Yes |
| Validator set capture | N/A | One deposit tx per validator | Yes |
| Governance takeover | N/A | Buy governance tokens | Yes |

In every case, the attack timeline is bounded by the attacker's resources, not by any intrinsic temporal constraint. A billionaire can execute any of these attacks faster than an honest participant of modest means can accumulate equivalent influence.

The question is whether we can add a security dimension where time-in-system is the primary barrier, and no amount of capital can substitute for it.

---

## 2. The Mechanism

### 2.1 Vote Weight Formula

PoM assigns consensus vote weight as a weighted sum of three dimensions:

```
vote_weight(node) = (stake * 0.30) + (pow * 0.10) + (mind * 0.60)
```

Where:
- `stake` is the economic collateral locked by the node (linear, denominated in the staking token)
- `pow` is the cumulative valid Proof of Work solutions submitted by the node (logarithmically scaled)
- `mind` is the cumulative verified cognitive contribution score (logarithmically scaled)

The 60% weight on the mind dimension is the critical design choice. It means that cognitive contribution dominates economic and computational investment in determining consensus influence.

### 2.2 Mind Score Accumulation

When a node produces verified cognitive output -- code committed and reviewed, data assets curated, evaluation tasks completed, governance proposals analyzed -- the output is hashed, verified by existing high-mind-score participants via a commit-reveal pairwise comparison protocol, and recorded on-chain:

```
mindScore(n+1) = mindScore(n) + log2(1 + mindValue)
```

The logarithmic accumulation is essential. It produces two properties simultaneously:

1. **Diminishing returns**: Doubling your mind score requires exponentially more genuine cognitive work. This prevents mind-score plutocracy -- early contributors retain meaningful influence, but cannot lock out newcomers indefinitely.

2. **Anti-burst protection**: An attacker attempting to rapidly accumulate mind score faces logarithmic compression. 1000 contributions of value 1 yield more mind score than 1 contribution of value 1000. Sustained, distributed effort is structurally favored over concentrated bursts.

Each contribution hash is one-time-use (`verifiedContributions[hash]` flips from false to true). The same work cannot be recorded twice. And critically, only active nodes can call `recordContribution()` -- the verification step requires existing consensus participants, creating a bootstrapping property where the network's immune system strengthens as more legitimate participants join.

### 2.3 Proof of Work Component

Each consensus vote requires solving a hashcash puzzle:

```solidity
bytes32 powHash = keccak256(abi.encodePacked(
    msg.sender, roundId, value, powNonce, block.chainid
));
require(uint256(powHash) <= type(uint256).max >> currentDifficulty);
```

The PoW difficulty auto-adjusts based on solution rate, targeting one solution per 30 seconds. This is lighter than mainchain mining -- it exists to impose a computational floor that prevents zero-cost vote spam, not to serve as the primary security dimension. Including `block.chainid` in the hash preimage prevents cross-chain PoW reuse.

The PoW component carries only 10% of vote weight. Its purpose is Sybil resistance at the margin: creating a minimum computational cost per vote that makes flooding the network with low-quality votes economically impractical, without making participation hardware-intensive.

### 2.4 Stake and Slashing

Nodes stake a minimum of 0.01 ETH to participate. The staking mechanism follows standard PoS patterns: economic collateral that can be slashed for misbehavior.

Three slashing conditions are enforced:

| Offense | Stake Slash | Mind Score Penalty |
|---|---|---|
| Equivocation (voting for two values in one round) | 50% of stake | 75% of mind score |
| Extended downtime | 5% of stake | None |
| Invalid PoW submission | 10% of stake | None |

The equivocation penalty is particularly severe: it destroys both economic capital (50% of stake) and accumulated reputation (75% of mind score). This dual penalty is deliberate. An attacker who has somehow accumulated genuine mind score faces a catastrophic loss -- not just of money, which can be re-acquired, but of time-weighted reputation that took months or years to build. The mind score penalty makes equivocation uniquely costly in PoM compared to pure PoS systems.

Equivocation is detectable on-chain via `reportEquivocation()`: anyone can submit two valid PoW solutions for the same node, same round, but different values. The proofs are self-verifying -- the contract checks both hashes meet the difficulty target, confirms they target different values, and slashes automatically. No oracle, no committee, no dispute resolution needed.

---

## 3. Attack Cost Analysis

### 3.1 The Three-Dimensional Attack Surface

To achieve majority consensus influence, an attacker must simultaneously satisfy:

```
attacker_stake > total_honest_stake * (0.30 / total_weight_fraction)
attacker_pow > total_honest_pow * (0.10 / total_weight_fraction)
attacker_mind > total_honest_mind * (0.60 / total_weight_fraction)
```

The first two conditions are satisfiable with sufficient capital and hardware. The third is not -- because mind score cannot be purchased, only earned through verified cognitive contributions accepted by existing participants.

The composite attack cost is therefore:

```
AttackCost = CapitalCost + ComputeCost + TIME_OF_GENUINE_CONTRIBUTION
```

The third term is the novel element. It is a function of calendar time, not of resources deployed per unit time. An attacker with $1 billion and an attacker with $1 million face the same minimum time to accumulate sufficient mind score -- because both must produce genuine cognitive work that survives peer review, and the verification bottleneck is bounded by the review capacity of existing participants, not by the attacker's budget.

### 3.2 Asymptotic Security

As the network ages, total accumulated mind score grows monotonically (contributions are additive, and mind scores are never reduced except by slashing for misbehavior). This means:

```
AttackCost(t) >= f(TotalMindScore(t))
```

Since `TotalMindScore(t)` is monotonically increasing:

```
lim(t -> infinity) AttackCost(t) = infinity
```

This is a stronger security property than either PoW or PoS provides alone. PoW security is bounded by global hashrate (which fluctuates with energy prices and hardware availability). PoS security is bounded by token market cap (which fluctuates with speculation). PoM security is bounded by the cumulative cognitive output of the entire network over its lifetime -- a quantity that only grows.

### 3.3 The Sybil Case

A Sybil attacker creating N fake identities gains N addresses but zero mind score across all of them. Each fake identity starts at mind score 0, with no trust edges in the contribution DAG, earning an UNTRUSTED multiplier of 0.5x. To build mind score, each fake identity must independently produce genuine cognitive work that is verified by high-mind-score participants -- who have no reason to verify contributions from untrusted addresses unless the contributions are genuinely valuable.

The critical insight: **the cost of faking mind score converges to the cost of genuinely contributing**. An attacker who must produce real code, real analysis, and real governance participation to accumulate mind score is, by definition, contributing honestly. The attack strategy collapses into the honest strategy. This is the game-theoretic property that distinguishes PoM from reputation systems that can be gamed through social engineering alone.

### 3.4 The Wealthy Newcomer

Consider a well-funded entity joining the network with the goal of acquiring consensus influence:

**Under PoW**: Rent hashrate from NiceHash. Influence acquired in hours.

**Under PoS**: Buy tokens on exchanges. Influence acquired in days.

**Under PoM**: Stake tokens (30% of weight, acquired in days) + solve PoW puzzles (10% of weight, acquired in hours) + accumulate mind score (60% of weight, acquired over months to years).

The wealthy newcomer hits a wall at the mind score component. They can fund 90% of the attack trivially but cannot compress the timeline for the remaining 60% of consensus weight. If the existing network has 100 active nodes with 2+ years of mind score accumulation, the newcomer needs roughly 2 years of sustained genuine contribution to match the average participant's mind weight -- regardless of how much capital they deploy.

This is a qualitative difference. PoW and PoS impose quantitative barriers (spend more money). PoM imposes a temporal barrier that is structurally resistant to capital acceleration.

---

## 4. Consensus Rounds

### 4.1 Round Structure

Any active node can propose a consensus round on a given topic:

```
startRound(topic, duration) -> roundId
```

During the round, nodes cast PoW-backed votes:

```
castVote(roundId, value, powNonce)
```

Each vote requires a valid PoW solution and is weighted by the node's combined `vote_weight`. Votes are tallied per value, and the value with the highest aggregate weight wins after the round timer expires.

Finalization is permissionless -- anyone can call `finalizeRound()` after the timer, providing the set of candidate values. The contract iterates through candidates and selects the highest-weighted value. This design avoids relying on a privileged finalizer.

### 4.2 Parallel with Nakamoto Consensus

In Bitcoin, the longest chain wins because it represents the most cumulative work. In PoM, the highest-weighted value wins because it represents the most cumulative cognitive, economic, and computational commitment. The parallel extends naturally:

| Property | Bitcoin | PoM |
|---|---|---|
| Selection rule | Most cumulative PoW | Most cumulative PoW + PoS + PoM |
| Fork resolution | Longest chain | Highest aggregate weight |
| Finality | Probabilistic (6 blocks) | Deterministic (round timer + 2/3 supermajority) |
| Attack cost dimension | 1 (compute) | 3 (compute + capital + time) |

The deterministic finality is achieved when a value accumulates > 66.67% of the total weight cast in a round (the BFT supermajority threshold). Probabilistic finality in Bitcoin requires waiting for confirmations because a single dimension of security can be temporarily outspent. Three-dimensional security with a supermajority threshold provides stronger finality guarantees.

---

## 5. Meta Nodes: Participation Without Voting Power

Not every network participant needs consensus voting power. PoM introduces a "meta node" tier -- read-only P2P nodes that sync with voting nodes (called "trinity nodes") but carry no vote weight:

```solidity
function registerMetaNode(
    string calldata endpoint,
    address[] calldata trinityPeers
) external
```

Meta nodes serve the client layer: they provide local state for applications, relay transactions, and reduce load on trinity nodes. They can be run by anyone -- no stake, no PoW, no mind score required. This two-tier design separates network utility (everyone can participate) from consensus authority (earned through the three dimensions).

The meta node / trinity node separation also provides a natural scaling path: as the network grows, the number of meta nodes can scale linearly with user demand while the number of trinity nodes grows more slowly, bounded by the mind score verification throughput.

---

## 6. AI Participation in Consensus

### 6.1 Substrate Agnosticism

The four components of mind score measurement -- verified code contributions, data curation, task completion, governance analysis -- make no reference to the biological or computational nature of the contributor. This is deliberate.

An AI agent that produces verified Solidity code that passes review earns the same mind score increment as a human developer who produces equivalent code. The verification protocol checks the work product, not the worker. The hash of a correct function is the same regardless of who wrote it.

This creates a natural framework for AI agents as first-class consensus participants -- not through a special "AI validator" role, but through the same general mechanism that evaluates all contributors. An AI agent that accumulates 2 years of verified contributions earns 2 years of mind score, identical in consensus weight to a human contributor with the same history.

### 6.2 The Turing Test Irrelevance

Traditional approaches to AI participation in governance require resolving whether the agent is "truly intelligent" or "merely pattern matching." PoM sidesteps this debate entirely. The relevant question is not "Is this agent conscious?" but "Has this agent produced verifiable value?"

The Shapley value framework provides the mathematical answer: the agent's marginal contribution to the cooperative game is measurable regardless of the computational substrate that produced it. If removing the agent from the network reduces the network's value by X, the agent's Shapley value is X. Consciousness is orthogonal to contribution.

### 6.3 Trust Graph Integration

AI agents enter the same ContributionDAG trust graph as human participants. Trust scores propagate via BFS from founder nodes with 15% decay per hop, maximum 6 hops deep. An AI agent vouched for by a trusted human inherits decayed trust. An AI agent with no human vouches starts at UNTRUSTED (0.5x multiplier).

This creates a natural bootstrapping process: AI agents prove themselves through contributions, earn human vouches, accumulate trust scores, and gradually increase their consensus influence. The trust graph acts as a distributed immune system -- new participants (human or AI) must demonstrate value before gaining significant influence.

---

## 7. Relation to Existing Work

**Proof of Humanity (Kleros):** Uses video submissions to verify biological uniqueness. Explicitly excludes non-human participants. PoM replaces the biological substrate test with a contribution test -- verifiable value creation rather than verifiable DNA.

**Proof of Personhood (Worldcoin):** Uses iris biometrics for one-person-one-account Sybil resistance. Requires specialized hardware (the Orb). PoM achieves Sybil resistance through the trust graph and logarithmic mind score accumulation, requiring no hardware beyond a standard computer.

**Proof of Authority:** Relies on a known, pre-approved validator set. Efficient but centralized -- the authority set is a single point of capture. PoM distributes authority through cumulative contribution, making the "authority set" an emergent property of the network's cognitive history rather than a fixed list.

**Proof of Reputation (various):** Several systems assign non-transferable reputation scores based on on-chain activity. Most treat reputation as a gate (access control) rather than a consensus weight. PoM integrates reputation directly into the vote weight formula at 60% -- reputation is not a prerequisite for participation but a continuous, dominant factor in consensus influence.

**EigenLayer restaking:** Extends PoS security by allowing validators to secure multiple services with the same stake. EigenLayer is an economic innovation (capital efficiency) but remains single-dimensional in its security model (all stake, no cognitive component). PoM's three-dimensional approach is complementary -- a PoM network could integrate with EigenLayer for the PoS pillar while maintaining independent PoW and PoM dimensions.

---

## 8. Open Questions

**Optimal mind weight**: We use 60% for the cognitive dimension based on the argument that time-irreducibility provides the strongest security guarantees. But is 60% optimal? A higher weight makes the network harder to attack but slower to onboard new participants (they need more time to accumulate meaningful vote weight). A lower weight makes the system more accessible but closer to standard PoS in its security properties. What is the optimal weight as a function of network maturity?

**Mind score decay**: The current implementation uses logarithmic accumulation with no decay. This means early contributors permanently retain influence proportional to their cumulative contributions. An alternative is exponential decay with a long half-life (e.g., 2 years), which would require sustained contribution to maintain influence. The trade-off is network stability (no decay: founding contributors anchor the network) vs. fresh-blood incentive (with decay: stale participants lose weight, active newcomers catch up). Has anyone formalized this trade-off?

**Cross-chain mind score portability**: Mind score is accumulated per-chain. A contributor active on one PoM network cannot port their reputation to another. Cross-chain mind score bridging would require trust assumptions about the source chain's verification integrity. Is there a minimal-trust mechanism for portable cognitive reputation, analogous to how light clients verify PoW chains without replaying every block?

**Verification throughput**: Mind score contributions require verification by existing participants. This creates a throughput bottleneck: the rate at which new mind score enters the system is bounded by the review bandwidth of current participants. In a fast-growing network, this could create a queue. How should verification be scaled -- through committee-based review, threshold signatures, or automated verification with human appeals?

**The bootstrap problem**: A new PoM network has zero accumulated mind score. In its early epochs, the mind dimension contributes nothing to security, and the network is effectively a PoW/PoS hybrid. How long must a PoM network operate before the cognitive dimension provides meaningful security? We conjecture this is proportional to the number of founding contributors and their initial mind score imports, but a formal bound would be valuable.

---

## 9. Summary

The security of every deployed consensus mechanism is bounded by resources that can be acquired instantaneously with sufficient capital: hash rate (PoW), tokens (PoS), votes (DPoS). Proof of Mind introduces a third dimension -- cumulative verified cognitive contribution -- that is bounded by calendar time, not by capital. The key properties:

1. Mind score grows logarithmically, preventing plutocracy of expertise.
2. Each contribution hash is one-time-use, preventing replay.
3. Verification requires existing participants, creating a bootstrapping immune system.
4. The attack cost function includes an irreducible temporal term that grows monotonically with network age.
5. The cost of faking mind score converges to the cost of genuinely contributing.

The combined vote weight formula (30% stake, 10% PoW, 60% mind) means that consensus influence is earned primarily through sustained cognitive contribution -- a property that neither PoW nor PoS provides alone.

The mechanism is substrate-agnostic by design. Human and AI contributors accumulate mind score through the same verification process, and their consensus weight is determined by the same formula. The relevant test is contribution, not consciousness.

Implementation: 584 lines of Solidity (`ProofOfMind.sol`), with auto-adjusting PoW difficulty, equivocation detection and slashing, meta node support, and `getAttackCost()` that computes the current cost to achieve majority consensus weight across all three dimensions.

---

## References

- [ProofOfMind.sol -- Three-Dimensional Consensus Primitive](https://github.com/WGlynn/VibeSwap)
- [NakamotoConsensusInfinity.sol -- Full NCI Implementation (UUPS)](https://github.com/WGlynn/VibeSwap)
- [ContributionDAG.sol -- Trust Graph with BFS Scoring](https://github.com/WGlynn/VibeSwap)
- [ShapleyDistributor.sol -- Cooperative Game Theory Distribution](https://github.com/WGlynn/VibeSwap)
- [Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System"](https://bitcoin.org/bitcoin.pdf)
- [Buterin, V. et al. (2020). "Combining GHOST and Casper"](https://arxiv.org/abs/2003.03052)
- [Shapley, L.S. (1953). "A Value for n-Person Games"](https://doi.org/10.1515/9781400881970-018)
- [EigenLayer (2023). "Restaking: Extending Ethereum's Security"](https://eigenlayer.xyz)
- [Proof of Humanity -- Kleros](https://proofofhumanity.id)
- [Worldcoin -- Proof of Personhood](https://worldcoin.org)
