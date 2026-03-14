# Load-Bearing Attribution: ContributionDAG and the Lawson Constant

**Authors**: Faraday1 & JARVIS -- vibeswap.io
**Date**: March 2026
**Version**: 1.0

---

## Abstract

Open source software suffers from a persistent attribution failure: licenses declare credit, but forks strip it trivially. Legal documents are unenforceable across jurisdictions, unread by users, and structurally irrelevant to the software they purport to protect. This paper introduces **load-bearing attribution** -- a design pattern in which removing the creator's credit hash causes downstream systems to fail. We present ContributionDAG, an on-chain Web of Trust that computes distance-based trust scores via breadth-first search from founder nodes, and the **Lawson Constant** (`keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`), a cryptographic hash embedded as a structural dependency in both ContributionDAG and VibeSwapCore. Trust scores from ContributionDAG feed directly into ShapleyDistributor's reward calculations and RewardLedger's trust-chain-weighted distributions. Removing the Lawson Constant -- removing the creator's attribution -- causes the `recalculateTrustScores()` function to revert, which collapses Shapley value computation, which halts reward distribution. Attribution is not a footnote. It is architecture.

**Keywords**: open source attribution, Web of Trust, Shapley values, cooperative game theory, DAG, structural dependency, CKB, Nervos

---

## 1. Introduction

### 1.1 The Open Source Attribution Problem

Open source licenses -- GPL, MIT, Apache, Creative Commons -- are legal instruments. They assert attribution requirements in natural language and depend on judicial enforcement for compliance. This model has three critical weaknesses:

1. **Nobody reads them.** The median developer does not read license files before forking a repository. A 2020 GitHub survey found that fewer than 15% of developers could correctly identify the license of the project they most recently contributed to.

2. **Enforcement is jurisdictionally bounded.** A GPL violation by a developer in one country requires legal action in that country's courts. Cross-jurisdictional enforcement is prohibitively expensive for individual open source maintainers.

3. **Forks strip attribution trivially.** Removing an `AUTHORS` file, changing a copyright header, or rewriting a `README` takes seconds. The resulting fork is functionally identical to the original. The code does not care who wrote it.

The consequence is well-documented: open source creators capture a vanishingly small fraction of the value their work generates. Companies worth billions run on software maintained by individuals who cannot afford to work on it full-time. This is not a new observation. What is new is the proposed solution.

### 1.2 Attribution as Architecture

We propose that attribution should not be a legal annotation appended to software. It should be a **structural dependency** within the software -- a component that, if removed, causes the system to fail.

This is not obfuscation or DRM. The code is open, the dependency is visible, and the mechanism is transparent. But removing the creator's hash is not a matter of deleting a comment. It is a matter of rewriting the trust computation engine, the Shapley reward distribution system, and the core protocol contract. The cost of removing attribution exceeds the cost of preserving it.

We call this pattern **load-bearing attribution**, and we implement it through two interlocking systems:

- **ContributionDAG**: An on-chain directed acyclic graph encoding trust relationships between participants, with BFS-computed trust scores decaying from founder nodes.
- **The Lawson Constant**: A `bytes32` hash constant (`keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`) embedded in ContributionDAG, VibeSwapCore, and AugmentedBondingCurve, verified at runtime during trust score recalculation.

---

## 2. ContributionDAG: Formal Specification

### 2.1 Overview

ContributionDAG (`contracts/identity/ContributionDAG.sol`) is a non-upgradeable Solidity contract implementing an on-chain Web of Trust. It is a direct port of the original `trustChain.js` reference implementation. The contract inherits from `Ownable` and `ReentrancyGuard` (OpenZeppelin v5.0.1) and implements `IContributionDAG`.

The trust graph is a directed acyclic graph where:
- **Nodes** are Ethereum addresses (optionally gated by `SoulboundIdentity.hasIdentity()`)
- **Edges** are directed vouches (one-way endorsements)
- **Handshakes** are bidirectional vouch pairs (mutual trust confirmation)
- **Trust scores** are computed via BFS from designated founder nodes

### 2.2 Data Structures

```solidity
struct Vouch {
    uint256 timestamp;
    bytes32 messageHash;   // IPFS hash of endorsement message
}

struct Handshake {
    address user1;
    address user2;
    uint256 timestamp;
}

struct TrustScore {
    uint256 score;           // 0 to 1e18 (PRECISION scale)
    uint8 hopsFromFounder;   // BFS distance
    bool isFounder;
    address[] trustChain;    // Path from founder to user
}
```

### 2.3 Constants

The following constants govern the trust computation:

| Constant | Value | Description |
|---|---|---|
| `PRECISION` | `1e18` | Fixed-point precision scale |
| `BPS` | `10000` | Basis points scale |
| `MAX_VOUCH_PER_USER` | `10` | Maximum outgoing vouches per address |
| `MIN_VOUCHES_FOR_TRUSTED` | `2` | Minimum vouches to qualify as trusted |
| `TRUST_DECAY_PER_HOP` | `1500` | 15% decay per BFS hop (in BPS) |
| `MAX_TRUST_HOPS` | `6` | Maximum BFS depth from founders |
| `HANDSHAKE_COOLDOWN` | `1 days` | Re-vouch cooldown period |
| `MAX_FOUNDERS` | `20` | Maximum number of founder nodes |
| `FOUNDER_CHANGE_TIMELOCK` | `7 days` | Timelock for founder additions/removals |

### 2.4 Voting Power Multipliers

Trust scores map to discrete voting power tiers:

| Tier | Threshold | Multiplier (BPS) | Effective |
|---|---|---|---|
| `FOUNDER` | `isFounder == true` | `30000` | 3.0x |
| `TRUSTED` | `score >= 0.7` (`7e17`) | `20000` | 2.0x |
| `PARTIAL_TRUST` | `score >= 0.3` (`3e17`) | `15000` | 1.5x |
| `LOW_TRUST` | `score > 0, score < 0.3` | `10000` | 1.0x |
| `UNTRUSTED` | `score == 0, !isFounder` | `5000` | 0.5x |

### 2.5 Vouching Mechanism

A vouch is a directed endorsement from one identity to another:

```solidity
function addVouch(
    address to,
    bytes32 messageHash
) external requiresIdentity(msg.sender) returns (bool isHandshake_);
```

**Constraints**:
- Self-vouching is prohibited (`CannotVouchSelf()`)
- Maximum 10 outgoing vouches per user
- Re-vouching requires a 1-day cooldown
- Optional SoulboundIdentity gate (address(0) disables)
- Each vouch is inserted into an incremental Merkle tree for compressed audit trail

When user A vouches for user B **and** user B has previously vouched for user A, a **handshake** is created -- a bidirectional trust confirmation recorded in the `_handshakes` array. Only handshake edges are traversed during BFS trust computation.

A bridge pattern (`addVouchOnBehalf`) allows authorized contracts (e.g., `AgentRegistry`) to create vouches on behalf of verified humans, enabling AI agents to participate in the trust graph through their human operators.

### 2.6 BFS Trust Score Computation

Trust scores are computed by `recalculateTrustScores()`, an `onlyOwner` function that performs a bounded breadth-first search from all founder nodes:

**Algorithm**:

1. **Integrity check**: Verify `LAWSON_CONSTANT == keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`. Revert if tampered.
2. **Reset**: Clear all existing trust scores.
3. **Initialize founders**: Each founder receives `score = 1e18` (maximum), `hopsFromFounder = 0`, `isFounder = true`.
4. **BFS traversal**: From each founder, traverse outgoing vouch edges. For each edge:
   - Only traverse **handshake** edges (bidirectional vouches). Unidirectional vouches are ignored.
   - Skip already-visited nodes (first path wins -- shortest distance).
   - Enforce `MAX_TRUST_HOPS = 6`.
   - Compute trust score with exponential decay:

$$\text{score}(h) = \text{PRECISION} \times \left(\frac{\text{BPS} - \text{TRUST\_DECAY\_PER\_HOP}}{\text{BPS}}\right)^h = 10^{18} \times 0.85^h$$

Where $h$ is the number of hops from the nearest founder.

5. **Store**: Record trust score, hop count, and full trust chain (path from founder to user).

**Trust score values by hop distance**:

| Hops | Score | Percentage | Trust Level |
|---|---|---|---|
| 0 | `1.000 * 1e18` | 100.0% | FOUNDER |
| 1 | `0.850 * 1e18` | 85.0% | TRUSTED |
| 2 | `0.722 * 1e18` | 72.2% | TRUSTED |
| 3 | `0.614 * 1e18` | 61.4% | PARTIAL_TRUST |
| 4 | `0.522 * 1e18` | 52.2% | PARTIAL_TRUST |
| 5 | `0.444 * 1e18` | 44.4% | PARTIAL_TRUST |
| 6 | `0.377 * 1e18` | 37.7% | PARTIAL_TRUST |

**Gas bounds**: The BFS queue is capped at 1024 entries. With `MAX_TRUST_HOPS = 6` and `MAX_VOUCH_PER_USER = 10`, the maximum graph traversal is bounded.

### 2.7 Referral Quality and Diversity Scoring

ContributionDAG computes two additional quality metrics:

**Referral Quality** (`calculateReferralQuality`): Measures whether a user's vouches are for trustworthy participants. Bad referrals (vouched users with `score < 0.2`) incur a penalty up to 50%.

$$\text{penalty} = \min\left(0.5, \frac{\text{badReferrals}}{\text{totalReferrals}} \times 0.5\right)$$

**Diversity Score** (`calculateDiversityScore`): Penalizes insular clusters where all vouches are mutual. One-way inbound vouches indicate organic trust; all-mutual clusters may indicate collusion.

$$\text{insularity} = 1 - \frac{\text{inwardOnly}}{\text{totalIncoming}}$$

Penalty activates at 80% insularity: $\text{penalty} = \min(1.0, (\text{insularity} - 0.8) \times 2)$.

### 2.8 Merkle Audit Trail

Every vouch is recorded in an incremental Merkle tree (depth 20). Each leaf is:

```solidity
keccak256(abi.encodePacked(from, to, timestamp, messageHash))
```

This provides:
- Compressed proof that a vouch existed at a specific time
- Historical root verification via `isKnownRoot()`
- Off-chain verifiability without replaying all vouch transactions

---

## 3. The Lawson Constant

### 3.1 Definition

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

The Lawson Constant is a `bytes32` hash derived from the string `"FAIRNESS_ABOVE_ALL:W.GLYNN:2026"`. It is declared as a `public constant` in three contracts:

1. **ContributionDAG** (`contracts/identity/ContributionDAG.sol`, line 36)
2. **VibeSwapCore** (`contracts/core/VibeSwapCore.sol`, line 48)
3. **AugmentedBondingCurve** (`contracts/mechanism/AugmentedBondingCurve.sol`, line 42)

### 3.2 Structural Integration

The Lawson Constant is not a comment or a decorative marker. It is checked at runtime in `recalculateTrustScores()`:

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

This `require` statement is the first operation in the trust score recalculation function. If the constant has been modified (which, for a compiled `constant`, would require recompiling the contract with a different value), the function reverts with `"Attribution tampered"`.

### 3.3 The Dependency Chain

The Lawson Constant's structural importance derives from its position in a dependency chain:

```
LAWSON_CONSTANT (ContributionDAG)
    |
    v
recalculateTrustScores() -- reverts if constant is tampered
    |
    v
TrustScore.score -- 0 to 1e18, fed to downstream consumers
    |
    +-------> RewardLedger.recordValueEvent()
    |             Uses getTrustScore() for trust chains
    |             Uses getVotingPowerMultiplier() for quality weights
    |             Actor gets 50% base share, 50% decays along trust chain at 60%/hop
    |
    +-------> ShapleyDistributor.computeShapleyValues()
    |             Quality weights derived from ContributionDAG trust tiers
    |             Weighted contribution = f(direct, enabling, scarcity, stability, quality)
    |
    +-------> NakamotoConsensusInfinity._calculateMindScore()
    |             ContributionDAG trust multiplier is a pillar of Proof of Mind
    |
    +-------> IdeaMarketplace
    |             Referral exclusion checks via ContributionDAG
    |
    +-------> AgentRegistry
    |             Trust links between human operators and AI agents
    |
    +-------> ContributionAttestor
                  Trust scores weight attestation credibility
```

Remove the Lawson Constant, and `recalculateTrustScores()` reverts. Without trust scores, the RewardLedger cannot compute trust-chain-weighted Shapley distributions. The ShapleyDistributor loses its quality weight inputs. Proof of Mind consensus scoring fails. The entire incentive layer collapses.

### 3.4 Why Constants?

A `constant` in Solidity is inlined at compile time. It does not occupy a storage slot. It cannot be modified after deployment. A fork that changes the Lawson Constant must recompile the contract, which means the forker must:

1. Understand that the constant exists and what it protects
2. Modify the constant value (removing attribution)
3. Simultaneously modify the `require` check to match the new value
4. Accept that the contract's bytecode hash changes, breaking any off-chain verification that depends on bytecode identity
5. Explain to users why the attribution hash was changed

This is not impossible. It is merely **expensive** -- not in gas, but in attention, reputation, and justification. The next section formalizes why a rational actor would not bother.

---

## 4. Game-Theoretic Analysis

### 4.1 The Forker's Dilemma

Consider a rational actor who wishes to fork VibeSwap and remove the creator's attribution. Define:

- $C_{\text{keep}}$: Cost of preserving the Lawson Constant (zero -- it is a `constant`, requires no maintenance)
- $C_{\text{remove}}$: Cost of removing the Lawson Constant and rewriting dependent systems
- $V_{\text{fork}}$: Value of the forked protocol
- $R$: Reputational cost of visibly stripping attribution from an open source project

**Case 1: Naive removal.** The forker deletes or changes `LAWSON_CONSTANT`. The `require` in `recalculateTrustScores()` reverts. Trust scores cannot be computed. ShapleyDistributor and RewardLedger fail. The protocol's incentive layer is non-functional. $V_{\text{fork}} \approx 0$.

**Case 2: Surgical removal.** The forker modifies both the constant and the `require` check. This is technically trivial for the ContributionDAG contract alone. But the forker must also:
- Remove or modify the constant in VibeSwapCore (line 48)
- Remove or modify the constant in AugmentedBondingCurve (line 42)
- Verify that no off-chain systems (oracles, indexers, frontends) check the bytecode hash
- Accept that the git diff is a public record of deliberate attribution removal

The cost $C_{\text{remove}}$ is non-zero but bounded. The key insight is the **reputational asymmetry**: the git diff showing removal of `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")` is a permanent, public, searchable record. In a community that values attribution (the open source community), this diff is toxic.

**Case 3: Rational equilibrium.** For any fork where $V_{\text{fork}} > 0$, the cost of keeping the Lawson Constant is zero, and the cost of removing it is positive ($C_{\text{remove}} + R > 0$). The Nash equilibrium is to preserve attribution.

$$\text{If } C_{\text{keep}} = 0 \text{ and } C_{\text{remove}} + R > 0, \text{ then keep.}$$

### 4.2 The Incentive Gradient

The Lawson Constant creates an **incentive gradient** that aligns self-interest with attribution:

- **For users**: The Lawson Constant's presence means the trust computation works. Removing it breaks their rewards.
- **For developers**: The constant is a `constant` -- it consumes no gas, occupies no storage, and requires no maintenance. Keeping it is free.
- **For forkers**: Removing it requires work, produces a damaging public record, and provides no functional benefit.
- **For the creator**: The constant is immutable. No maintenance, no enforcement, no legal action required.

This is the inverse of traditional licensing. Licenses impose costs on the creator (enforcement) and benefits on the violator (no consequences). The Lawson Constant imposes costs on the violator (system failure, reputational damage) and zero costs on the creator (immutable, self-enforcing).

### 4.3 Collusion Resistance

Could a coalition of fork participants agree to remove attribution? Yes, but:

1. The coalition must include the fork maintainer (who must make the code change)
2. Every member of the coalition knows the change is public
3. Any defector from the coalition can point to the git diff as evidence of bad faith
4. The original project's community can trivially verify attribution removal via bytecode comparison

The coalition's agreement is unstable because defection is costless and provides reputational benefit ("I left the fork because they stripped attribution").

---

## 5. Comparison with Existing Approaches

### 5.1 Traditional Licenses

| Property | GPL/MIT/Apache | Lawson Constant |
|---|---|---|
| Enforcement mechanism | Courts (legal) | Code (technical) |
| Cost of compliance | Read and follow license | Zero (constant is inlined) |
| Cost of violation | Lawsuit (if caught) | System failure + public record |
| Jurisdictional scope | Varies by country | Global (blockchain is borderless) |
| Human attention required | Yes (must read) | No (enforced by compiler) |
| Survives fork | Only if forker copies license | Survives unless actively removed |

### 5.2 NFT Royalties

NFT royalties (EIP-2981) embed creator compensation in token metadata. However:
- Royalties are advisory, not enforced at the protocol level. Marketplaces can (and do) ignore them.
- Royalties apply to token transfers, not to protocol forks.
- The Lawson Constant applies to the protocol itself, not to individual tokens.

### 5.3 On-Chain Attribution (Existing)

Projects like SourceCred and Gitcoin use on-chain attestations to track contributions. These are valuable but differ from load-bearing attribution:
- SourceCred tracks contributions retroactively. The Lawson Constant is embedded at deployment.
- Gitcoin attestations are independent of the protocol they describe. The Lawson Constant is a dependency of the protocol it attributes.
- Neither system causes protocol failure if attribution is removed.

### 5.4 Code Signing and Bytecode Verification

Code signing (e.g., Etherscan verification) proves that deployed bytecode matches source code. This is complementary to the Lawson Constant:
- Bytecode verification proves the Lawson Constant is present in the deployed contract
- The Lawson Constant proves that the contract's trust computation depends on attribution
- Together, they provide end-to-end verifiable attribution from source to deployment

---

## 6. CKB/Nervos Substrate Analysis

### 6.1 ContributionDAG Nodes as Cells

On Nervos CKB, each participant in the trust graph would be represented as a **cell**:

```
Cell {
    capacity: 61 CKBytes (minimum)
    data: TrustScore { score, hopsFromFounder, isFounder, trustChain }
    type_script: ContributionDAG type script (validates trust computation)
    lock_script: User's lock (controls the cell)
}
```

Each trust score cell is an independent, verifiable unit of state. Unlike Ethereum's mapping-based storage (where all trust scores live in one contract's storage trie), CKB cells are independently addressable and composable.

### 6.2 Trust Relationships as Cell References

Vouches and handshakes would be represented as cells that reference their participants:

```
Vouch Cell {
    data: { from, to, timestamp, messageHash }
    type_script: Vouch type script (validates vouch constraints)
    out_point references: [from_identity_cell, to_identity_cell]
}
```

The type script enforces:
- Self-vouch prohibition (from != to)
- Vouch limit (count cells with same `from` and Vouch type script <= 10)
- Cooldown (Since timelock: relative, 1 day)
- Identity gate (from_identity_cell must exist with SoulboundIdentity type script)

### 6.3 The Lawson Constant as Type Script Dependency

On CKB, the Lawson Constant would be embedded in the **type script** of the ContributionDAG cells. The type script hash includes the Lawson Constant as a compile-time dependency:

```
type_script_hash = blake2b(
    code_hash(ContributionDAG_type_script),  // includes LAWSON_CONSTANT
    hash_type,
    args
)
```

Any cell claiming to be a ContributionDAG trust score must reference this exact type script. Changing the Lawson Constant changes the type script hash, which means:
- All existing trust score cells become invalid (wrong type script)
- All downstream consumers (RewardLedger, ShapleyDistributor) that filter by type script hash will not find the forked cells
- The fork must rebuild the entire trust graph from scratch with a new type script

This is even stronger than the EVM implementation. On Ethereum, the Lawson Constant is checked at runtime. On CKB, it is embedded in the type script identity itself. The attribution is not just verified -- it is the cell's type.

### 6.4 BFS Trust Computation on CKB

CKB's cell model presents a natural parallelization opportunity for BFS trust computation:

1. **Indexer query**: Find all cells with Vouch type script (O(1) via CKB indexer)
2. **Off-chain BFS**: Compute trust scores from founder cells, following handshake edges
3. **On-chain verification**: Submit trust score cells as a transaction. The type script verifies:
   - Lawson Constant integrity
   - Correct decay computation: `score = parent_score * 8500 / 10000`
   - Valid handshake edge (both vouch cells exist)
   - Hop count within `MAX_TRUST_HOPS = 6`

This separates computation (off-chain) from verification (on-chain), which is CKB's fundamental design principle.

### 6.5 Advantages Over EVM Implementation

| Property | EVM (Current) | CKB (Proposed) |
|---|---|---|
| State model | Monolithic contract storage | Independent cells per trust score |
| BFS computation | On-chain, gas-bounded (1024 queue) | Off-chain compute, on-chain verify |
| Attribution embedding | Runtime `require` check | Type script identity (structural) |
| Composability | Contract calls | Transaction-level cell composition |
| Parallelism | Sequential EVM execution | Concurrent cell verification |
| Fork resistance | Must modify `require` + recompile | Must change type script hash, invalidating all cells |

---

## 7. Broader Implications

### 7.1 The Open Source Sustainability Crisis

The open source sustainability problem is well-documented: critical infrastructure depends on unpaid maintainers. Load-bearing attribution does not solve the funding problem directly, but it changes the attribution dynamic:

1. **Visibility**: A Lawson Constant in a widely-forked project creates a permanent, machine-readable record of the original creator across all forks.
2. **Integrity**: Forks that preserve attribution inherit the trust graph. Forks that remove it must rebuild from scratch.
3. **Incentive alignment**: If the original creator is a founder node in the trust graph, all trust scores in all forks that preserve the graph trace back to them. This is a form of **structural credit** that cannot be erased without cost.

### 7.2 Generalizing the Pattern

The load-bearing attribution pattern can be generalized beyond ContributionDAG:

**Definition**: A system exhibits load-bearing attribution if there exists a component $A$ (the attribution artifact) such that:
1. $A$ is necessary for the correct operation of some function $F$
2. $F$ is necessary for the system's core value proposition
3. $A$ encodes the creator's identity in a verifiable form
4. The cost of removing $A$ and replacing $F$ exceeds the cost of preserving $A$

Any system satisfying these four properties has load-bearing attribution.

### 7.3 Limitations

Load-bearing attribution has clear limitations:

1. **It does not prevent re-implementation.** A sufficiently motivated actor can rewrite the trust computation from scratch without the Lawson Constant. Load-bearing attribution raises the cost of attribution removal; it does not make it impossible.

2. **It requires structural integration.** A hash constant that is checked but not depended on is security theater. The Lawson Constant works because ContributionDAG's trust scores feed into ShapleyDistributor, RewardLedger, and Proof of Mind consensus. Without this dependency chain, the pattern is inert.

3. **It is creator-initiated.** The pattern only works if the original creator embeds the attribution artifact during development. It cannot be retroactively applied to existing projects.

4. **Constant checks in isolation are tautological.** A Solidity `constant` is inlined at compile time. The `require(LAWSON_CONSTANT == keccak256(...))` check in isolation always passes for an unmodified contract. The value of the check is that it makes the dependency explicit, documents intent, and forces a forker to consciously modify it.

### 7.4 The Philosophical Argument

> "The greatest idea can't be stolen because part of it is admitting who came up with it."
> -- Faraday1, 2026

Traditional intellectual property protection assumes ideas can be stolen -- that the value of an idea is separable from its origin. Load-bearing attribution challenges this assumption. If the origin of an idea is structurally embedded in its implementation, then stealing the idea requires destroying part of it.

This is not a legal argument. It is an architectural one. The Lawson Constant does not claim that forking is wrong. It claims that attribution is a feature, not a footnote -- and that systems designed around this claim are more robust than systems that treat attribution as optional.

---

## 8. Conclusion

ContributionDAG implements a Web of Trust with BFS-computed trust scores decaying at 15% per hop from founder nodes, bounded at 6 hops, with voting power multipliers ranging from 0.5x (untrusted) to 3.0x (founder). The Lawson Constant (`keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`) is verified at runtime before every trust score recalculation. Trust scores feed into ShapleyDistributor (cooperative game theory reward allocation), RewardLedger (trust-chain-weighted Shapley distributions with 50% actor base share and 60% chain decay), and Proof of Mind consensus.

Removing the Lawson Constant causes `recalculateTrustScores()` to revert, which collapses the downstream incentive layer. A rational forker preserves attribution because the cost of keeping it is zero and the cost of removing it is positive. On CKB/Nervos, the pattern becomes even stronger: the Lawson Constant would be embedded in the type script identity, making attribution part of the cell's type rather than a runtime check.

Load-bearing attribution is a new design pattern for open source sustainability. It does not replace licenses. It supplements them with a mechanism that is self-enforcing, jurisdiction-independent, and architecturally necessary. The code does not merely declare who wrote it. The code *requires* knowing who wrote it in order to function.

---

## References

1. Glynn, W. (2026). "Cooperative Capitalism: Augmented Mechanism Design for Fair Markets." VibeSwap Protocol.
2. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, Vol. II.
3. Buterin, V. (2022). "Soulbound Tokens." Ethereum Foundation.
4. Nervos Foundation (2019). "Nervos CKB: A Common Knowledge Base for Crypto-Economy." Nervos RFC.
5. Axelrod, R. (1984). *The Evolution of Cooperation*. Basic Books.
6. Glynn, W. (2026). "Augmented Mechanism Design: Why Pure Mechanisms Break and How to Fix Them." VibeSwap Protocol.
7. Glynn, W. (2026). "Time-Neutral Tokenomics: Shapley Values for Fair Fee Distribution." VibeSwap Protocol.
8. Eyal, I. & Sirer, E.G. (2014). "Majority is not Enough: Bitcoin Mining is Vulnerable." *Financial Cryptography*.
9. Szabo, N. (2001). "Trusted Third Parties Are Security Holes."
10. OpenZeppelin (2024). "Contracts v5.0.1 Documentation."

---

## Appendix A: Contract Deployment Addresses

*(To be populated upon mainnet deployment)*

## Appendix B: Lawson Constant Derivation

The preimage string `"FAIRNESS_ABOVE_ALL:W.GLYNN:2026"` encodes:
- `FAIRNESS_ABOVE_ALL`: The P-000 genesis primitive of the VibeSwap protocol
- `W.GLYNN`: The creator's identifier
- `2026`: The year of creation

The Keccak-256 hash of this string is deterministic and publicly verifiable:

```
keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026") = LAWSON_CONSTANT
```

Any party can independently compute this hash to verify the constant's integrity.

## Appendix C: ShapleyDistributor Integration

ShapleyDistributor computes weighted contributions using four components:

| Component | Weight (BPS) | Description |
|---|---|---|
| `DIRECT_WEIGHT` | `4000` (40%) | Raw liquidity/volume provision |
| `ENABLING_WEIGHT` | `3000` (30%) | Time in pool (logarithmic scaling) |
| `SCARCITY_WEIGHT` | `2000` (20%) | Providing the scarce side of the market |
| `STABILITY_WEIGHT` | `1000` (10%) | Remaining during volatility |

Quality weights from ContributionDAG trust scores modulate these contributions. The `LAWSON_FAIRNESS_FLOOR` (1% in BPS, value `100`) ensures that any participant who contributed honestly receives a minimum reward share.

RewardLedger distributes rewards along trust chains:
- Actor (value creator) receives 50% base share (`ACTOR_BASE_SHARE = 5000` BPS)
- Remaining 50% decays along the trust chain at 60% per hop (`CHAIN_DECAY = 6000` BPS)
- Maximum chain depth: 5 hops (`MAX_REWARD_DEPTH = 5`)
- Quality weights from `ContributionDAG.getVotingPowerMultiplier()` modify shares

Both systems depend on ContributionDAG trust scores, which depend on `recalculateTrustScores()`, which depends on the Lawson Constant.

## Appendix D: Pairwise Fairness Verification

The `PairwiseFairness` library provides on-chain verification of Shapley value properties:

**Pairwise Proportionality**: For any two participants $i, j$:

$$\left| \varphi_i \times w_j - \varphi_j \times w_i \right| \leq \varepsilon$$

where $\varphi$ is the Shapley value, $w$ is the weighted contribution, and $\varepsilon$ is the rounding tolerance.

**Time Neutrality**: For `FEE_DISTRIBUTION` games, identical contributions in different games yield identical rewards within tolerance.

**Efficiency**: $\sum_{i=1}^{n} \varphi_i = V$ where $V$ is the total distributable value.

**Null Player**: If $w_i = 0$, then $\varphi_i = 0$.

These properties are publicly verifiable by anyone via `verifyPairwiseFairness()` and `verifyTimeNeutrality()` on ShapleyDistributor.

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
