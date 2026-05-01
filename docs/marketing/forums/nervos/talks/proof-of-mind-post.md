# Proof of Mind: A Consensus Mechanism Where the Only Way to Attack Is to Contribute

**Authors:** Faraday1 & JARVIS -- vibeswap.io
**Date:** March 2026

---

## TL;DR

We built a consensus mechanism called **Proof of Mind (PoM)** that makes Sybil attacks asymptotically impossible. The core idea: 60% of a validator's voting power comes from their accumulated, verified cognitive contributions (code, data, governance work) -- not their stake, not their hash rate. Since mind score cannot be bought, rented, or faked -- only earned through genuine work over time -- the cost of attacking a PoM network includes an irreducible amount of *real time spent doing real work*. The older the network gets, the harder it is to attack. We think CKB is the ideal substrate for this mechanism, and this post explains why.

**Full paper:** [Proof of Mind: Hybrid Consensus with Irreducible Temporal Security](../papers/proof-of-mind-consensus.md)

---

## The Problem with Existing Consensus

Every major consensus mechanism has the same structural weakness: the security resource can be acquired faster than it can be defended.

- **PoW**: Rent hash power by the hour. Attack, profit, return the hardware.
- **PoS**: Buy tokens in a single market cycle. Accumulate 51% stake. Vote maliciously.
- **DPoS**: Run a marketing campaign. Buy delegate votes. Capture governance.
- **PoA**: Bribe or compromise a known, small validator set.

All of these measure *willingness to spend* -- energy, capital, social capital. None of them measure *accumulated demonstrated competence*. A validator who has operated honestly for 5 years has no structural advantage over an attacker who showed up yesterday with a bigger wallet.

That gap is what PoM closes.

---

## How It Works

### The Vote Weight Formula

Every validator in a PoM network has a vote weight computed from three components:

```
vote_weight = (stake * 30%) + (pow * 10%) + (mind_score * 60%)
```

Concretely, from the `ProofOfMind.sol` contract:

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Stake (PoS) | 30% (`STAKE_WEIGHT_BPS = 3000`) | Economic skin in the game |
| PoW | 10% (`POW_WEIGHT_BPS = 1000`) | Per-vote spam resistance |
| Mind Score (PoM) | 60% (`MIND_WEIGHT_BPS = 6000`) | Cumulative verified cognitive output |

Stake ensures validators have something to lose. PoW prevents vote spam (every vote requires solving a hashcash puzzle with auto-adjusting difficulty, target 30-second solve time). But the dominant factor is **mind score** -- a cumulative, non-transferable measure of how much genuine intellectual work a validator has produced and had verified by the network.

### How Mind Score Accumulates

When a validator produces a verified contribution (code commit, data asset, governance proposal, dispute resolution), the network records it on-chain:

```
mindScore += log2(1e18 + contribution_value)
```

The `log2` scaling is critical. It means:
- **No single contribution can dominate.** A contribution worth 1,000,000 adds roughly the same score increment as one worth 1 (both are approximately `log2(1e18) ~ 60`). The differentiation comes from *how many* contributions you make, not how big any single one is.
- **Burst accumulation is impossible.** Each contribution is a separate on-chain transaction, verified by existing high-mind-score participants. You can't batch-submit a year's worth of work in one block.
- **Score compounds slowly over time.** This is the point. Time is the one resource that no amount of money can buy.

### The Web of Trust (ContributionDAG)

Mind scores don't exist in isolation. They're validated through a **Web of Trust** implemented in `ContributionDAG.sol`:

- Users vouch for each other on-chain. Bidirectional vouches form **handshakes**.
- Trust scores are computed via BFS from founder nodes, with **15% decay per hop** (`TRUST_DECAY_PER_HOP = 1500` BPS), maximum **6 hops** deep.
- Trust levels determine voting power multipliers:

| Hops from Founder | Trust Score | Multiplier |
|-------------------|-------------|------------|
| 0 (Founder) | 1.000 | 3.0x |
| 1 | 0.850 | 2.0x |
| 2 | 0.722 | 2.0x |
| 3 | 0.614 | 1.5x |
| 4 | 0.522 | 1.5x |
| 5-6 | 0.444-0.377 | 1.0x |
| Not in graph | 0.000 | 0.5x |

Every vouch is Merkle-compressed into an incremental Merkle tree (depth 20, capacity ~1M vouches), creating a cryptographic audit trail that can be verified without replaying the full trust graph.

Why does this matter? Because a Sybil attacker can create 10,000 addresses, but none of them have handshakes with real participants. Without handshakes, they're UNTRUSTED (0.5x multiplier). Even if they somehow get vouched for, the 15% decay per hop means their trust score drops rapidly with distance from the core network.

And each real participant can vouch for at most 10 others (`MAX_VOUCH_PER_USER = 10`). So even a compromised insider can only introduce a bounded number of Sybils into the trust graph.

---

## Why This Matters: Asymptotic Security

Here's the key insight that makes PoM fundamentally different from PoW and PoS:

**The attack cost grows without bound as the network ages.**

In a PoW network, attack cost is roughly constant (proportional to current hash rate). In a PoS network, attack cost is proportional to current total stake. Both can be overcome by a sufficiently capitalized attacker at any point in time.

In a PoM network, the honest nodes are continuously accumulating mind score. A new attacker starts at `mindScore = 0`. Even with infinite capital and compute, they can only access the 40% of vote weight that stake and PoW provide. The 60% mind weight creates a deficit that:

1. Grows with every contribution honest nodes make
2. Cannot be closed by spending money
3. Can only be closed by spending *time doing genuine work*

Mathematically:

```
lim(t -> infinity) AttackCost(t) = infinity
```

Every attacker, no matter how powerful, is eventually priced out by network age alone.

The equivocation penalty reinforces this: if you vote for two different values in the same round (double-voting), you lose **50% of your stake** and **75% of your mind score** (`mindScore = mindScore / 4`). Years of accumulated work, gone. That's a penalty that capital cannot absorb.

---

## Why CKB Is the Right Substrate

This is a Nervos Talks post, so let's talk about why PoM maps naturally to CKB in ways that account-based chains can't replicate.

### Mind Score as Cell State

On CKB, a mind node's accumulated score can be stored as **cell data**, with the type script enforcing the logarithmic accumulation rule on-chain. Mind scores become first-class objects -- visible, verifiable, composable with other scripts. On EVM chains, mind scores are buried in contract storage slots. On CKB, they're cells you can inspect, reference, and reason about.

### Trust Relationships as Cell Linkages

The ContributionDAG's vouch edges map naturally to CKB's cell reference pattern. A vouch from Alice to Bob is a cell whose lock script references both identity cells. A handshake is a pair of such cells. CKB's transaction model -- which can reference multiple input and output cells -- makes trust graph operations a natural transaction shape rather than a gas-expensive loop.

### Temporal Accumulation via Block Height

CKB uses Proof of Work consensus. Mind score accumulation anchored to CKB block height inherits **Bitcoin-class temporal security**: the ordering of contributions is as trustworthy as the chain's hash rate. No validator committee can reorder timestamps. No sequencer can backdate a mind score update. This is a structural property of PoW chains that PoS chains cannot offer.

PoM on CKB means: contributions are ordered by PoW consensus, scored by cognitive output, and weighted at 60% of voting power. The temporal security of CKB's PoW and the temporal accumulation of PoM reinforce each other.

### State Economics

CKB's state rent model naturally handles abandoned identities. Mind score cells occupy real CKBytes. Active participants maintain their cells; inactive ones see their state become reclaimable. This prevents the unbounded accumulation of dead trust graph state that would bloat an EVM chain over time.

### RISC-V Verification

CKB's RISC-V VM can execute the full PoM verification logic on-chain -- PoW hash verification, log2 computation, BFS trust traversal, Merkle proof checking -- without the opcode limitations of the EVM. The verification is native, not emulated.

### Cross-Chain Trust Portability

The Merkle audit trail enables trust portability. A participant's trust score earned on an EVM deployment can be verified on CKB by submitting a Merkle proof against the known root. The ContributionDAG becomes a cross-chain identity layer, and CKB is the natural settlement point for that identity because of its cell model and PoW security.

---

## What We've Built

This isn't theoretical. The contracts are deployed and tested:

- **`ProofOfMind.sol`** (583 lines): Full consensus mechanism with PoW verification, mind score accumulation, consensus rounds, equivocation detection, meta-node architecture, and auto-adjusting difficulty.
- **`ContributionDAG.sol`** (700 lines): Web of Trust with BFS trust scoring, handshake protocol, Merkle audit trail, vouch constraints, timelocked founder management, and referral quality scoring.
- **CKB SDK** (15 Rust crates, 9 RISC-V scripts): Complete CKB implementation including PoW lock scripts, batch auction type scripts, and knowledge cells.

All source code is open: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

## The Philosophical Dimension

PoM is not just a technical mechanism. It encodes a thesis about what *should* grant authority in a decentralized system.

PoW says: authority comes from energy expenditure.
PoS says: authority comes from capital.
PoM says: **authority comes from demonstrated competence, accumulated over time, verified by peers.**

A mind score cannot be bought. Cannot be rented. Cannot be manufactured. Cannot be inherited. Cannot be delegated. It can only be earned through genuine cognitive output that survives peer review. The only way to hack the system is to contribute to it.

This connects to a broader principle from cooperative game theory. Ostrom showed that commons can be governed sustainably when institutional design satisfies specific structural conditions: defined boundaries, proportional equivalence, graduated sanctions, monitoring, conflict resolution. PoM satisfies all eight of Ostrom's principles. It's mechanism design that takes human nature seriously -- not by requiring altruism, but by making honest contribution the dominant strategy.

---

## Discussion Questions

We'd love to hear what the Nervos community thinks:

1. **Cell model fit**: We've argued that mind scores as cells, trust edges as cell linkages, and PoW-anchored timestamps make CKB a natural substrate. Do you see other CKB-specific properties that would strengthen or challenge this mapping?

2. **Bootstrapping**: PoM's security improves with network age. What mechanisms would you suggest for the bootstrap phase, when total mind score is low and the network is most vulnerable?

3. **State economics**: Mind score cells occupy CKBytes. Should there be a minimum CKB lockup for maintaining a mind score cell? How should abandoned mind scores be handled -- preserved indefinitely or reclaimable after inactivity?

4. **RISC-V scripts**: We've implemented PoW lock scripts and batch auction type scripts for CKB. Would the community benefit from a standalone PoM type script that any CKB application could integrate for contribution-weighted governance?

5. **Cross-chain trust**: The Merkle audit trail enables trust portability across chains. What would it take to make CKB the canonical settlement layer for a cross-chain Web of Trust?

6. **AI participants**: PoM is substrate-agnostic -- it measures contribution, not consciousness. Should a CKB-native PoM system have different trust decay parameters for AI agents versus human participants, or should the mechanism remain fully substrate-neutral?

---

## Further Reading

- **Full paper**: [Proof of Mind: Hybrid Consensus with Irreducible Temporal Security](../papers/proof-of-mind-consensus.md)
- **Mechanism design paper**: [Proof of Mind: A Consensus Mechanism for Contribution-Based Identity](../papers/proof-of-mind-mechanism.md)
- **CKB integration paper**: [Nervos and VibeSwap: The Case for CKB as Settlement Layer](nervos-vibeswap-synergy.md)
- **PoW shared state on CKB**: [PoW Shared State and VibeSwap: Solving Cell Contention](pow-shared-state-vibeswap.md)
- **Source code**: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

Fairness Above All. -- P-000, VibeSwap Protocol
