# ContributionDAG and the Lawson Constant: What If Removing Credit Broke the Code?

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Open source licenses say "keep my name in the credits." Nobody reads them. Forks strip attribution in seconds. We built a system where **removing the creator's credit hash causes the protocol to stop working**. Not because of DRM or obfuscation -- because the attribution hash is a structural dependency in the trust computation engine. Fork VibeSwap, delete `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`, and the Shapley reward distribution collapses. And CKB's cell model makes this pattern even stronger than it is on EVM.

---

## The Problem Nobody Solved

Here is the dirty secret of open source: **attribution is decorative**.

GPL says "keep the copyright notice." MIT says "include the license." Apache says "state your changes." All three assume that a human will read the license file, understand the obligations, and comply voluntarily. When they don't -- and they usually don't -- the creator's only recourse is a lawsuit.

A lawsuit. For a side project. Maintained by one person. Against a company with lawyers.

The result: open source creators capture almost none of the value their work generates. The code doesn't care who wrote it. The license is a text file nobody reads. Attribution is a suggestion.

We think attribution should be architecture.

---

## ContributionDAG: A Web of Trust On-Chain

ContributionDAG is a Solidity contract (`contracts/identity/ContributionDAG.sol`) that implements an on-chain trust graph. The core idea is simple:

1. **Users vouch for each other.** A vouch is a directed endorsement -- "I trust this person."
2. **Bidirectional vouches form handshakes.** If Alice vouches for Bob AND Bob vouches for Alice, that is a handshake -- mutual trust confirmation.
3. **BFS from founder nodes computes trust scores.** Starting from designated founders (maximum 20), the contract performs a breadth-first search along handshake edges, computing trust scores that decay by 15% per hop.

The actual trust score formula:

```
score(h) = 1e18 * (8500 / 10000)^h = 1e18 * 0.85^h
```

Where `h` is hops from the nearest founder. Maximum depth: 6 hops.

| Hops | Trust Score | Level | Voting Power |
|---|---|---|---|
| 0 (founder) | 100.0% | FOUNDER | 3.0x |
| 1 | 85.0% | TRUSTED | 2.0x |
| 2 | 72.2% | TRUSTED | 2.0x |
| 3 | 61.4% | PARTIAL_TRUST | 1.5x |
| 4 | 52.2% | PARTIAL_TRUST | 1.5x |
| 5 | 44.4% | PARTIAL_TRUST | 1.5x |
| 6 | 37.7% | PARTIAL_TRUST | 1.5x |
| not connected | 0% | UNTRUSTED | 0.5x |

These trust scores feed into everything: Shapley reward distribution, Proof of Mind consensus, referral quality, attestation credibility, and AI agent reputation. They are not decorative. They are load-bearing.

---

## The Lawson Constant

Here is the part that is different from every other Web of Trust implementation.

At the top of `ContributionDAG.sol`:

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

And in `recalculateTrustScores()` -- the function that computes all trust scores via BFS:

```solidity
function recalculateTrustScores() external onlyOwner {
    // Lawson Constant integrity check -- attribution is load-bearing
    require(
        LAWSON_CONSTANT == keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026"),
        "Attribution tampered"
    );

    // ... BFS trust computation follows ...
}
```

The same constant appears in `VibeSwapCore.sol` (the protocol's main orchestrator) and `AugmentedBondingCurve.sol`.

**What happens if you fork VibeSwap and remove this?**

1. `recalculateTrustScores()` reverts with `"Attribution tampered"`
2. No trust scores can be computed
3. `RewardLedger` cannot distribute rewards along trust chains (depends on `getTrustScore()`)
4. `ShapleyDistributor` loses quality weight inputs from the trust graph
5. Proof of Mind consensus scoring fails (trust multiplier is a scoring pillar)
6. The protocol's entire incentive layer is non-functional

You cannot fork VibeSwap and strip attribution without breaking the reward system. This is not a bug. It is the point.

---

## Why Rational Actors Keep It

The game theory is straightforward:

- **Cost of keeping the Lawson Constant**: Zero. It is a `constant` -- inlined at compile time, no gas cost, no storage, no maintenance.
- **Cost of removing it**: Positive. You must modify the constant, update the `require` check, verify no other contracts depend on the exact bytecode, and accept that your git diff permanently records "I deliberately stripped the creator's attribution hash."

For any fork where the protocol has value, the Nash equilibrium is to keep attribution.

This inverts the traditional open source dynamic:

| | Traditional License | Lawson Constant |
|---|---|---|
| Cost on creator to enforce | High (lawyers) | Zero (self-enforcing) |
| Cost on forker to comply | Low (copy a text file) | Zero (do nothing) |
| Cost on forker to violate | Low (delete a text file) | High (system failure + public record) |
| Jurisdiction | Country-specific | Global (blockchain) |

The creator pays nothing. The honest forker pays nothing. Only the dishonest forker pays -- and what they pay is system failure.

---

## Anti-Collusion: Referral Quality and Diversity Scoring

ContributionDAG does not just compute trust distances. It actively penalizes manipulation:

**Referral Quality**: If you vouch for untrustworthy users (trust score below 0.2), you get penalized. Bad referrals cost you up to 50% of your referral quality score. This means you cannot boost a sybil network without tanking your own reputation.

**Diversity Score**: If all your vouches are mutual (you only vouch for people who vouch for you back), you get penalized for insularity. The penalty kicks in at 80% mutual-vouch ratio. This prevents closed-loop collusion clusters.

**Merkle Audit Trail**: Every vouch is recorded in an incremental Merkle tree (depth 20). The vouch tree root is publicly queryable. Anyone can verify that a vouch existed at a specific time without replaying the entire transaction history.

---

## The CKB Angle: Why Cells Are Natural for Trust Graphs

This is where it gets interesting for the Nervos community.

On Ethereum, all trust scores live in one contract's storage mappings. `_trustScores[address]` is a slot in a monolithic contract. You cannot inspect one trust score without interacting with the contract that holds all of them. BFS computation happens on-chain, bounded by gas limits (we cap the queue at 1024 entries).

**CKB's cell model changes the architecture fundamentally:**

### Trust Scores as Independent Cells

Each trust score would be an independent cell:

```
Trust Score Cell {
    capacity: minimum CKBytes
    data: { score, hopsFromFounder, isFounder, trustChain[] }
    type_script: ContributionDAG type script
    lock_script: user's lock
}
```

Each cell is independently addressable, independently verifiable, and independently composable. You can read one trust score without touching the entire trust graph.

### The Lawson Constant Becomes the Type Script Identity

On EVM, the Lawson Constant is checked at runtime (`require`). On CKB, it would be embedded in the **type script hash** itself. The constant is part of the code that defines what a trust score cell *is*.

Change the Lawson Constant, and the type script hash changes. All existing trust score cells become invalid -- wrong type. All downstream contracts that filter by type script hash stop finding them. The fork must rebuild the entire trust graph from scratch.

This is structurally stronger than the EVM version. On EVM, attribution is *verified*. On CKB, attribution is *identity*.

### Off-Chain Compute, On-Chain Verify

CKB's natural pattern -- compute off-chain, verify on-chain -- maps perfectly to BFS trust computation:

1. Indexer finds all Vouch cells (O(1) query)
2. Off-chain process runs BFS from founder cells, computing trust scores
3. Submit trust score cells as a CKB transaction
4. Type script verifies: correct decay factor (8500/10000 per hop), valid handshake edges (both vouch cells consumed), hop count within 6, and Lawson Constant integrity

No gas-bounded queue. No on-chain BFS. Just verification of the result.

### Cell References as Trust Edges

Vouch cells would reference their endpoints:

```
Vouch Cell {
    data: { from, to, timestamp, messageHash }
    type_script: Vouch type script (enforces constraints)
    deps: [from_identity_cell, to_identity_cell]
}
```

The type script enforces self-vouch prohibition, vouch limits (count cells by type), cooldowns (via CKB's Since field -- relative timelock, 1 day), and identity requirements. All structural. No `require` statements -- the transaction is simply invalid if constraints are violated.

---

## How It Connects to Shapley Distribution

The trust scores from ContributionDAG are not standalone. They feed into VibeSwap's cooperative game theory reward system:

**ShapleyDistributor** computes Shapley values for each cooperative game (batch settlement, fee distribution). Weighted contributions combine four factors:
- 40% direct contribution (liquidity provision)
- 30% enabling contribution (time in pool, logarithmic scaling)
- 20% scarcity contribution (providing the scarce side of the market)
- 10% stability contribution (staying during volatility)

Quality weights from ContributionDAG trust scores modulate these contributions. A founder (3.0x) earns more than an untrusted participant (0.5x) for the same raw contribution, because trust is a form of contribution.

**RewardLedger** distributes rewards along trust chains:
- The value creator gets a 50% base share
- The remaining 50% decays along the trust chain at 60% per hop
- Maximum depth: 5 hops

The person who vouched for you -- and the person who vouched for them, all the way back to the founder -- shares in the value you create. Attribution is not just credit. It is a revenue stream. Removing it doesn't just erase a name. It erases an income pathway for everyone in the trust chain.

---

## The Bigger Picture: Can This Solve Open Source Attribution?

We think the load-bearing attribution pattern generalizes. Any system where:

1. An attribution artifact is **necessary** for a core function
2. That core function is **necessary** for the system's value proposition
3. The attribution artifact **encodes the creator's identity** verifiably
4. Removing the artifact **costs more** than keeping it

...has load-bearing attribution. The Lawson Constant is one implementation. There could be others.

The open source sustainability crisis is not fundamentally about money. It is about the structural invisibility of creators. You can donate to a maintainer, but you cannot *architecturally require* that their contribution is acknowledged. Until now.

> "The greatest idea can't be stolen because part of it is admitting who came up with it."

---

## Discussion Questions

1. **What CKB-native patterns strengthen load-bearing attribution?** The Since timelock for vouch cooldowns and type script identity for the Lawson Constant are two examples. What other CKB primitives could be used?

2. **Should the pattern be symmetric?** Currently, only the original creator's hash is embedded. Should major contributors be able to add their own load-bearing attribution hashes? How would that affect the dependency chain?

3. **How does this interact with the First Issuance Right?** CKB's economic model is about storing value. Trust score cells are a form of stored value -- reputation value. Should they pay state rent? Should they be exempt because they serve a public good (trust computation)?

4. **Can the pattern prevent parasitic forks in practice?** The theory says rational actors preserve attribution. But crypto is not always rational. Has anyone tried a similar pattern and seen it hold up?

5. **Is attribution-as-dependency an anti-pattern?** Some will argue that coupling attribution to functionality is a form of vendor lock-in. We disagree -- the code is open, the constant is visible, and keeping it costs nothing. But we want to hear the counterarguments.

The full formal paper is available: `docs/papers/contribution-dag-lawson-constant.md`

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [contribution-dag-lawson-constant.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/contribution-dag-lawson-constant.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
