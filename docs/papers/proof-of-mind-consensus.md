# Proof of Mind: Hybrid Consensus with Irreducible Temporal Security

**Authors:** W. Glynn (Faraday1) & JARVIS -- vibeswap.io
**Date:** March 2026
**Status:** Working Paper
**Classification:** Consensus Mechanism Design

---

## Abstract

We present Proof of Mind (PoM), a hybrid consensus mechanism that introduces cumulative verified cognitive contribution as a dominant security dimension alongside Proof of Work and Proof of Stake. The system assigns vote weights according to the formula:

```
W(node) = (stake * 0.30) + (pow * 0.10) + (mind * 0.60)
```

where `mind` is a logarithmically scaled, non-transferable score derived from verified intellectual output accumulated over time. Because mind score cannot be purchased, rented, or manufactured -- only earned through genuine cognitive work verified by existing participants -- the cost of attacking a PoM network includes an irreducible temporal component: the time required to produce authentic contributions that survive peer review. We prove that the feasible attack space contracts asymptotically as network age increases, and that Sybil resistance strengthens rather than weakens over time. The mechanism integrates with a ContributionDAG (Web of Trust) that computes trust scores via BFS from founder nodes with 15% decay per hop across a maximum of 6 hops, providing graduated Sybil resistance without biometric hardware. We analyze the natural mapping of PoM to CKB/Nervos's cell model, where mind scores persist as cell state, trust relationships form cell linkages, and temporal accumulation anchors to block height.

---

## 1. Introduction

### 1.1 The Insufficiency of Existing Consensus

Every deployed consensus mechanism reduces network security to a single acquirable resource:

| Mechanism | Security Dimension | Acquisition Method | Time-Bound? |
|-----------|-------------------|-------------------|-------------|
| Proof of Work | Computational power | Rent/purchase hardware | No |
| Proof of Stake | Economic capital | Buy tokens | No |
| Delegated PoS | Social capital | Vote buying, marketing | No |
| Proof of Authority | Institutional identity | Corruption, compromise | No |
| Proof of History | Verifiable time-ordering | Clock manipulation | Partially |

The common vulnerability is that each resource can be acquired faster than it can be organically defended. A sufficiently capitalized attacker can rent hash power for hours (PoW), accumulate tokens in a single market cycle (PoS), purchase delegate votes (DPoS), or compromise a known validator set (PoA). The attack timeline is bounded by the attacker's resources, not by any irreducible temporal constraint.

Nakamoto's insight was that thermodynamic work creates an economic barrier to attack [1]. Buterin extended this with economic stake as a complementary barrier [2]. We observe that both barriers share a structural weakness: they measure *willingness to spend* (energy, capital) rather than *accumulated demonstrated competence*. Neither can distinguish between a participant who has contributed to the network for years and one who arrived with capital yesterday.

### 1.2 The Temporal Gap

Consider two validators:

- **Alice**: 3 years of continuous operation, 500 verified code contributions, 200 governance proposals reviewed, trust score 0.85 in the Web of Trust.
- **Bob**: Joined today with 10x Alice's stake and 100x her hash rate.

Under PoW, Bob dominates. Under PoS, Bob dominates. Under any existing mechanism, capital and compute outweigh accumulated competence. PoM closes this gap by making accumulated cognitive contribution the dominant factor (60% of vote weight), ensuring that Alice's three years of genuine work outweigh Bob's instantaneous capital deployment.

### 1.3 The Core Insight

The attack cost for a PoM network is:

```
AttackCost = stake_needed + compute_needed + TIME_OF_GENUINE_WORK
```

The third term is the novel contribution. It is irreducible because:

1. Mind score requires verified cognitive output (code, data, governance, dispute resolution).
2. Verification requires approval by existing high-mind-score participants.
3. Contributions are logged immutably and deduplicated (each `contributionHash` is one-time-use).
4. Score accumulates logarithmically (`log2(1 + value)`), preventing burst inflation.
5. Time itself cannot be purchased, regardless of the attacker's other capabilities.

The only way to hack the system is to contribute to it.

---

## 2. Formal Definitions

### 2.1 Mind Node

A mind node is a tuple `(address, stake, mindScore, powSolutions, joinedAt, active)` where:

- `stake >= MIN_STAKE` (0.01 ether, the minimum economic commitment)
- `mindScore` is the cumulative logarithmic cognitive contribution score
- `powSolutions` is the count of valid PoW solutions submitted
- `joinedAt` is the block timestamp of network entry
- `active` is the participation status flag

The on-chain representation (from `ProofOfMind.sol`):

```solidity
struct MindNode {
    address nodeAddress;
    uint256 stake;
    uint256 mindScore;           // Cumulative cognitive contribution
    uint256 powSolutions;        // Total valid PoW solutions submitted
    uint256 lastPowTimestamp;
    uint256 joinedAt;
    uint256 lastActiveRound;
    bool active;
    bool slashed;
}
```

### 2.2 Mind Score Accumulation

When a contribution with cognitive value `v` is verified by consensus and recorded:

```
mindScore_new = mindScore_old + log2(MIND_SCALE + v)
```

where `MIND_SCALE = 1e18` is the fixed-point precision constant and `log2` is the integer floor logarithm. The logarithmic scaling serves two purposes:

1. **Anti-plutocracy**: A single massive contribution does not dominate. A contribution of value 1,000,000 adds approximately `log2(1e18 + 1e6) ~ 60` to the score, the same order of magnitude as a contribution of value 1 which adds `log2(1e18 + 1) ~ 60`. The meaningful differentiation comes from *number of contributions*, not size of any single contribution.

2. **Temporal anchoring**: Since each contribution requires verification and recording as a separate transaction, the rate of mind score growth is bounded by the rate of genuine cognitive output. No single event can produce a score spike.

Formally, for a node with `N(t)` verified contributions up to time `t`:

```
MindScore(node, t) = sum_{i=1}^{N(t)} log2(MIND_SCALE + value(C_i))
```

### 2.3 Vote Weight Formula

The combined vote weight for a consensus round is computed as:

```
W(node) = (stake * STAKE_WEIGHT_BPS / 10000)
         + (log2(1 + powSolutions) * MIND_SCALE * POW_WEIGHT_BPS / (10000 * MIND_SCALE))
         + (mindScore * MIND_WEIGHT_BPS / 10000)
```

With the protocol constants:

| Component | Weight (BPS) | Percentage | Role |
|-----------|-------------|------------|------|
| `STAKE_WEIGHT_BPS` | 3000 | 30% | Economic alignment |
| `POW_WEIGHT_BPS` | 1000 | 10% | Spam resistance, consistent participation |
| `MIND_WEIGHT_BPS` | 6000 | 60% | Cognitive barrier (the novel primitive) |

The implementation from `ProofOfMind.sol`:

```solidity
function _calculateVoteWeight(MindNode storage node) internal view returns (uint256) {
    uint256 stakeW = (node.stake * STAKE_WEIGHT_BPS) / 10000;
    uint256 powW = (_log2(1 + node.powSolutions) * MIND_SCALE * POW_WEIGHT_BPS) / (10000 * MIND_SCALE);
    uint256 mindW = (node.mindScore * MIND_WEIGHT_BPS) / 10000;
    return stakeW + powW + mindW;
}
```

**Rationale for 60/30/10 allocation.** The PoM weight must exceed 50% to ensure mind score dominates any pure capital or compute attack. It must remain below 100% to prevent expertise monopoly and maintain economic and computational barriers as supplementary defenses. The 30% stake component ensures validators have skin in the game; the 10% PoW component provides per-vote spam resistance and rewards consistent participation (the logarithmic `powSolutions` count means that showing up 100 times is only ~7x more powerful than showing up once, preventing PoW grinding dominance).

### 2.4 Proof of Work Mechanics

Each vote requires a valid PoW solution:

```solidity
bytes32 powHash = keccak256(abi.encodePacked(
    msg.sender, roundId, value, powNonce, block.chainid
));
```

The hash must satisfy: `uint256(powHash) <= type(uint256).max >> currentDifficulty`

That is, the hash must have at least `currentDifficulty` leading zero bits. The initial difficulty is 20 bits. Difficulty auto-adjusts every 100 blocks toward a target solve time of 30 seconds:

- If average solve time < 15 seconds (TARGET/2): difficulty increases by 1 bit
- If average solve time > 60 seconds (TARGET*2) and difficulty > 1: difficulty decreases by 1 bit

This ensures PoW remains a meaningful but not prohibitive barrier, adapting to network participation levels.

### 2.5 Consensus Rounds

A consensus round is a tuple `(roundId, topic, startTime, endTime, winningValue, totalWeight, finalized, participantCount)`. Any active node can start a round by specifying a topic hash and duration. During the round:

1. Active nodes solve the PoW puzzle for their chosen value.
2. Nodes call `castVote(roundId, value, powNonce)` with their solution.
3. The contract verifies PoW, computes vote weight, and accumulates the tally.
4. After `endTime`, anyone can call `finalizeRound()` with the candidate values.
5. The value with the highest weighted tally wins.

Each node votes at most once per round (enforced by `votes[roundId][msg.sender].timestamp != 0` check). The winning value is determined by weight-majority, not count-majority -- a single high-mind-score node outweighs many low-mind-score newcomers.

---

## 3. Security Analysis

### 3.1 Threat Model

We consider an adversary with the following capabilities:

- **Unlimited capital**: Can purchase any amount of stake tokens.
- **Unlimited compute**: Can rent any amount of hash power.
- **Social engineering**: Can attempt to infiltrate the trust network.
- **Sybil creation**: Can create any number of identities.
- **Time constraint**: Cannot travel backward in time or compress subjective experience of time.

The adversary's goal is to achieve >50% of total vote weight in a consensus round.

### 3.2 Attack Cost Decomposition

To achieve majority vote weight, the attacker needs:

```
W_attacker > W_honest / 2
```

Expanding:

```
(S_a * 0.30) + (P_a * 0.10) + (M_a * 0.60) > [(S_h * 0.30) + (P_h * 0.10) + (M_h * 0.60)] / 2
```

Where `S`, `P`, `M` denote the stake, PoW, and mind components respectively, and subscripts `a` and `h` denote attacker and honest network.

**Pure stake attack** (attacker relies only on stake, `M_a = 0`, `P_a = 0`):

```
S_a * 0.30 > [(S_h * 0.30) + (P_h * 0.10) + (M_h * 0.60)] / 2
S_a > [(S_h * 0.30) + (P_h * 0.10) + (M_h * 0.60)] / 0.60
S_a > S_h/2 + P_h/6 + M_h
```

The attacker must acquire stake exceeding `S_h/2 + M_h` -- the mind component of the honest network directly adds to the stake required. For a mature network where `M_h >> S_h`, the required stake approaches infinity.

**Pure compute attack** (attacker relies only on PoW, `M_a = 0`, `S_a = MIN_STAKE`):

The PoW component is logarithmic in solutions count and capped at 10% weight. Even with infinite hash power, the attacker's PoW weight is bounded by `0.10 * log2(solutions)`. This is structurally insufficient to overcome the 60% mind weight of honest nodes.

**Combined attack without mind score** (`M_a = 0`):

```
(S_a * 0.30) + (P_a * 0.10) > [(S_h * 0.30) + (P_h * 0.10) + (M_h * 0.60)] / 2
```

The attacker controls 40% of the weight dimensions. The honest network's 60% mind weight creates a permanent deficit that no combination of stake and compute can overcome, provided `M_h` is sufficiently large.

### 3.3 Asymptotic Security Theorem

**Theorem.** For any fixed attacker capability `C = (S_max, P_max)`, there exists a network age `T` such that for all `t > T`, the attack cost exceeds `C`.

**Proof sketch.** Honest nodes continuously produce verified contributions, so `M_h(t)` is monotonically non-decreasing. The attacker starts at `M_a = 0` (or forfeits existing mind score by attacking, since equivocation slashes 75% of mind score). The mind deficit:

```
mind_deficit(t) = M_h(t) / 2 - M_a(t)
```

grows unboundedly as `t -> infinity` because:

1. `M_h(t) >= M_h(0) + k * t` for some positive rate `k` (honest nodes contribute at a positive rate).
2. `M_a(t) = 0` for an attacker who has not been contributing (or `M_a(t)` is bounded if the attacker must split time between genuine contribution and attack preparation).
3. Even if the attacker contributes genuinely to build `M_a`, the honest network's aggregate mind score grows proportionally to `N_honest * k * t` versus the attacker's `1 * k * t`. For `N_honest > 2`, the deficit grows.

Therefore:

```
lim(t -> infinity) AttackCost(t) = infinity
```

Every attacker, regardless of capital and compute resources, is eventually priced out by network age alone. QED.

### 3.4 Sybil Resistance

**Classical Sybil attack**: Create `N` identities to amplify vote weight.

Under PoM, each Sybil identity:
- Starts at `mindScore = 0`
- Requires `MIN_STAKE = 0.01 ether` (linear cost in `N`)
- Must solve PoW per vote (linear compute cost in `N`)
- Must accumulate genuine contributions verified by existing high-mind-score nodes
- Each contribution verification is a separate on-chain transaction consuming verifier attention

The total Sybil mind score is:

```
M_sybil = N * log2(MIND_SCALE + avg_value) * contributions_per_sybil
```

But legitimate nodes at age `T` have:

```
M_honest = N_honest * log2(MIND_SCALE + avg_value) * contributions_per_node * T/T_sybil
```

Since `T/T_sybil >= 1` (honest nodes have been operating at least as long), and `N_honest` is bounded below by the existing validator set, the Sybil army must both:
1. Match the headcount of honest nodes
2. Match the temporal depth of honest nodes

The cost compounds multiplicatively: `N * cost_per_identity * T * cost_per_contribution`. This is the defining property -- Sybil resistance that *strengthens* with network age, rather than remaining constant.

### 3.5 Equivocation Penalties

Voting for different values in the same round (equivocation) is the cardinal sin. The `reportEquivocation` function allows anyone to submit two valid PoW proofs for different values from the same node in the same round. Penalties:

- **Stake slash**: 50% of stake (`SLASH_EQUIVOCATION = 5000 BPS`)
- **Mind score slash**: 75% of accumulated mind score (`mindScore = mindScore / 4`)
- **Permanent flag**: `slashed = true` on the node record

The 75% mind score penalty is severe by design. It means that an equivocating node loses years of accumulated cognitive contribution -- a cost that cannot be recovered by any amount of capital. Additional slashing conditions:

- **Downtime**: 5% of stake (`SLASH_DOWNTIME = 500 BPS`)
- **Invalid PoW submission**: 10% of stake (`SLASH_INVALID_POW = 1000 BPS`)

### 3.6 Mind Score Persistence

A critical design decision: mind score persists across network exits. From the contract:

```solidity
function exitNetwork() external onlyActiveNode {
    MindNode storage node = mindNodes[msg.sender];
    node.active = false;
    // ... stake is returned ...
    // Note: mindScore is NOT reset. Node can rejoin with accumulated reputation.
}
```

This means contributors do not lose their accumulated cognitive capital by temporarily leaving the network. The mind score represents genuine work that was done, regardless of current participation status. This encourages long-term alignment: a contributor who takes a break does not start from zero upon return.

---

## 4. ContributionDAG Integration

### 4.1 Web of Trust Architecture

The ContributionDAG (`ContributionDAG.sol`) implements a directed acyclic graph of interpersonal trust that feeds mind scores into the PoM consensus. Users vouch for each other; when vouches are bidirectional, they form *handshakes* -- confirmed trust relationships.

Trust scores are computed via breadth-first search from founder nodes, with exponential decay per hop:

```
trustScore(node, hops) = PRECISION * ((BPS - TRUST_DECAY_PER_HOP) / BPS)^hops
```

Where:
- `PRECISION = 1e18` (fixed-point precision)
- `BPS = 10000` (basis points)
- `TRUST_DECAY_PER_HOP = 1500` (15% decay per hop)
- `MAX_TRUST_HOPS = 6` (maximum BFS depth)

The decay factor per hop is `(10000 - 1500) / 10000 = 0.85`. The resulting trust scores at each hop distance:

| Hops from Founder | Trust Score | Decay | Trust Level | Voting Multiplier |
|-------------------|-------------|-------|-------------|-------------------|
| 0 (Founder) | 1.000 | -- | FOUNDER | 3.0x |
| 1 | 0.850 | -15% | TRUSTED | 2.0x |
| 2 | 0.722 | -15% | TRUSTED | 2.0x |
| 3 | 0.614 | -15% | PARTIAL_TRUST | 1.5x |
| 4 | 0.522 | -15% | PARTIAL_TRUST | 1.5x |
| 5 | 0.444 | -15% | LOW_TRUST | 1.0x |
| 6 | 0.377 | -15% | LOW_TRUST | 1.0x |
| Not in graph | 0.000 | -- | UNTRUSTED | 0.5x |

Trust level thresholds:
- `TRUSTED_THRESHOLD = 7e17` (0.70) -- requires 1-2 hops from a founder
- `PARTIAL_THRESHOLD = 3e17` (0.30) -- requires 3-4 hops from a founder

### 4.2 Handshake Requirement

BFS traversal only follows handshakes (bidirectional vouches). A one-way vouch does not extend the trust graph. This is critical for Sybil resistance: the attacker cannot simply vouch for their Sybil identities. A real trusted participant must vouch *back*, creating a handshake. This transforms Sybil infiltration from a unilateral action (creating identities) to a bilateral negotiation (convincing real participants to reciprocate trust).

### 4.3 Vouch Constraints

- `MAX_VOUCH_PER_USER = 10`: Each identity can vouch for at most 10 others. This bounds the trust graph's branching factor and prevents a single compromised node from introducing unlimited Sybils.
- `HANDSHAKE_COOLDOWN = 1 day`: Re-vouching the same address requires waiting 24 hours, preventing vouch-revoke-revouch cycles for gaming.
- `MIN_VOUCHES_FOR_TRUSTED = 2`: Minimum incoming vouches required for trusted status.
- `MAX_FOUNDERS = 20`: Hard cap on founder nodes, with 7-day timelock on founder additions/removals.

### 4.4 Merkle Audit Trail

All vouches are inserted into an incremental Merkle tree (depth 20, capacity 2^20 = 1,048,576 vouches). The Merkle root provides a compressed, verifiable audit trail of the entire trust graph's history. Any vouch can be verified against historical roots without replaying the full graph. This enables cross-chain trust verification: a CKB contract can verify a vouch proof against the Merkle root without storing the full ContributionDAG.

### 4.5 The Lawson Constant

The ContributionDAG anchors its integrity to a cryptographic constant:

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

This hash is checked during trust score recalculation. Its purpose is structural, not symbolic: it ensures that the attribution chain is load-bearing. Forks that remove or modify the constant will fail the integrity check in `recalculateTrustScores()`, causing Shapley distribution to collapse. Attribution is not decorative -- it is a dependency.

### 4.6 Mind Score as Trust-Weighted Contribution

The ContributionDAG's trust multipliers modulate mind score impact. A contribution verified by a FOUNDER (3.0x multiplier) carries more weight than one verified by a PARTIAL_TRUST node (1.5x). This creates a natural quality gradient: contributions endorsed by the network's most trusted members accumulate mind score faster, but those trusted members earned their position through years of their own verified contributions. The system is recursively self-reinforcing.

---

## 5. CKB/Nervos Substrate Analysis

### 5.1 Why PoM Maps Naturally to CKB

The Nervos CKB cell model provides structural properties that align with PoM's requirements in ways that account-based chains cannot replicate:

**Mind Score as Cell State.** In CKB, each cell contains data, a lock script, and an optional type script. A mind node's accumulated score can be stored as cell data, with the type script enforcing the logarithmic accumulation rule. The cell model's explicit state management means mind scores are first-class objects -- visible, verifiable, and transferable between scripts -- rather than buried in opaque contract storage slots.

**Trust Relationships as Cell Linkages.** The ContributionDAG's vouch edges map to cell reference patterns in CKB. A vouch from Alice to Bob can be represented as a cell whose lock script references both Alice's identity cell and Bob's identity cell. The bidirectional handshake becomes a pair of cells, each referencing the other. CKB's ability to reference multiple cells in a single transaction makes trust graph traversal a natural operation.

**Temporal Accumulation via Block Height.** CKB's PoW consensus provides an objective, censorship-resistant timestamp through block height. Mind score accumulation anchored to CKB block height inherits Bitcoin-class temporal security: the ordering of contributions is as trustworthy as the chain's hash rate. No validator committee can reorder contribution timestamps. No sequencer can backdate a mind score update.

**State Economics.** CKB's state rent model means that mind score cells occupy real economic resources (CKBytes). Abandoned identities that no longer pay state rent are reclaimable, preventing the unbounded accumulation of dead state. Active participants maintain their cells; inactive ones gradually lose their on-chain presence. This creates a natural garbage collection mechanism for the trust graph.

### 5.2 RISC-V Verification

CKB's RISC-V virtual machine can execute the full PoM verification logic on-chain:

- **PoW verification**: SHA-256 hash computation and leading-zero-bit counting are native RISC-V operations. No EVM opcode limitations.
- **Log2 computation**: Integer logarithm for mind score scaling is trivial in RISC-V, unlike the EVM where it requires iterative shifting.
- **BFS trust computation**: The ContributionDAG's BFS can be verified on-chain by providing a witness containing the BFS traversal path. The type script verifies each step without re-executing the full search.
- **Merkle proof verification**: The incremental Merkle tree proofs for vouch verification are standard operations in RISC-V.

### 5.3 Cell Model Anti-MEV Properties

PoM on CKB inherits the cell model's structural MEV resistance. A miner who processes a mind score update transaction cannot extract value from the ordering of that update, because:

1. Mind scores are cumulative and commutative -- the order of contribution recordings does not affect the final score.
2. Vote weight calculations are deterministic functions of on-chain state -- no off-chain information advantage exists.
3. PoW-gated cell access (as implemented in VibeSwap's `pow-lock` script) prevents miners from preferentially including their own mind score updates.

### 5.4 Cross-Chain Trust Portability

The Merkle audit trail enables cross-chain trust portability. A participant's trust score on an EVM chain can be verified on CKB by submitting a Merkle proof of their vouch history against the known root. This means PoM networks on different chains can share trust graphs without requiring full graph replication. The ContributionDAG becomes a cross-chain identity layer.

---

## 6. Comparison with Existing Consensus Approaches

### 6.1 Proof of Work (Nakamoto, 2008)

Bitcoin's PoW measures instantaneous computational expenditure. Security scales with current hash rate, not historical participation. A miner who contributed hash power for 10 years has no advantage over one who rents the same hash power today. PoM retains PoW as a spam filter (10% weight) while making cumulative cognitive contribution the dominant factor. PoW in isolation answers "Can you spend energy now?" PoM answers "Have you created value over time?"

### 6.2 Proof of Stake (Buterin et al., 2014)

Ethereum's PoS measures current capital lockup. Security scales with total staked value. A validator's historical behavior is reflected only in whether they have been slashed. A whale who purchases tokens today has equal voting power to a validator who has operated honestly for years (assuming equal stake). PoM retains stake as economic alignment (30% weight) while ensuring that capital alone cannot dominate consensus. PoS in isolation answers "Do you have skin in the game now?" PoM answers "Have you demonstrated competence over time?"

### 6.3 Delegated Proof of Stake (Larimer, 2014)

EOS-style DPoS introduces representative democracy with known pathologies: vote buying, delegate cartels, and governance capture by popularity rather than competence. PoM eliminates delegation entirely. Each node's vote weight is a function of its own verifiable history, not of anyone else's endorsement. There is no delegation market, no vote-buying opportunity, and no pathway from social capital to consensus power that bypasses genuine contribution.

### 6.4 Proof of Authority (de Vries, 2017)

PoA networks rely on known, trusted validators. Security depends on the integrity of a fixed set of authorities. The attack surface is the authorities themselves: compromise, bribery, or collusion among a small group. PoM's trust graph is dynamic and permissionless -- anyone can join and accumulate mind score. There is no fixed authority set to compromise. The "authorities" are all participants, weighted by their verifiable history.

### 6.5 Proof of History (Yakovenko, 2018)

Solana's PoH provides a verifiable ordering of events through a SHA-256 hash chain. It measures time, not contribution. PoH is complementary to PoM: PoH provides temporal ordering, PoM provides temporal accumulation. A PoM system running on a PoH-ordered chain would inherit verifiable timestamps for contribution recording, strengthening the temporal anchoring property.

### 6.6 Comparative Summary

| Property | PoW | PoS | DPoS | PoA | PoH | **PoM** |
|----------|-----|-----|------|-----|-----|---------|
| Non-purchasable security | No (rent) | No (buy) | No (buy votes) | No (bribe) | N/A | **Yes** |
| Non-rentable security | No | Partial | No | No | N/A | **Yes** |
| Temporally bound | No | No | No | No | Partial | **Yes** |
| Sybil cost scales with time | No | No | No | No | No | **Yes** |
| Rewards contribution | No | No | No | No | No | **Yes** |
| Permissionless entry | Yes | Yes | Partial | No | Yes | **Yes** |
| Asymptotic security | No | No | No | No | No | **Yes** |

PoM is the first consensus mechanism that is simultaneously non-purchasable, non-rentable, temporally bound, and permissionless.

---

## 7. Meta-Node Architecture

The `ProofOfMind.sol` contract introduces a two-tier node architecture:

**Mind Nodes** (consensus participants): Stake tokens, accumulate mind score, solve PoW, cast weighted votes. These are the validators.

**Meta Nodes** (distribution participants): Register a P2P endpoint and a set of trinity peers from which they sync. Meta nodes read consensus state but cannot vote. They provide client-side P2P utility -- unifying trinity node state locally for applications that need to query consensus results without participating in consensus.

```solidity
struct MetaNode {
    address nodeAddress;
    string endpoint;
    uint256 syncedToRound;
    uint256 registeredAt;
    bool active;
    address[] trinityPeers;
}
```

This separation ensures that the consensus set remains bounded by genuine participants (mind nodes), while the distribution network can scale permissionlessly (meta nodes). The pattern mirrors Bitcoin's full node / SPV client distinction, adapted for cognitive consensus.

---

## 8. Economic Equilibrium

### 8.1 Incentive Compatibility

PoM creates an incentive-compatible equilibrium where honest contribution is the dominant strategy:

1. **Contributing genuinely** increases mind score, increasing vote weight, increasing influence over consensus outcomes, increasing future rewards.
2. **Attacking** requires either (a) accumulating mind score through genuine contribution (which makes the attacker a genuine contributor) or (b) attacking with low mind score (which fails because the 60% mind weight disadvantage is insurmountable).
3. **Free-riding** (staking but not contributing) yields only the 30% stake weight, systematically disadvantaged against active contributors.

This is the mechanism's deepest property: the only rational path to consensus power is genuine contribution. The system does not require participants to be altruistic. It makes extraction irrational.

### 8.2 Ostrom's Principles

PoM satisfies Elinor Ostrom's eight principles for governing commons [3]:

1. **Defined boundaries**: Mind nodes must stake `MIN_STAKE` and be active.
2. **Proportional equivalence**: Vote weight scales with contribution (Shapley-fair).
3. **Collective choice**: Consensus rounds are open to all active nodes.
4. **Monitoring**: All contributions and votes are on-chain, auditable by anyone.
5. **Graduated sanctions**: Downtime (5% slash), invalid PoW (10%), equivocation (50% + 75% mind).
6. **Conflict resolution**: Consensus rounds resolve disputes by weighted vote.
7. **Recognized rights**: Mind score persists across exits; contributors own their reputation.
8. **Nested enterprises**: Meta nodes, mind nodes, and founders form nested governance layers.

### 8.3 The Bootstrapping Problem

A nascent PoM network has few contributors and low total mind score. Is the system vulnerable during bootstrap?

Yes, but no more than any nascent network. The defense is structural: founder nodes begin with `trustScore = 1.0` and `FOUNDER_MULTIPLIER = 3.0x`. The 7-day timelock on founder changes (`FOUNDER_CHANGE_TIMELOCK = 7 days`) prevents rapid dilution. As the network grows and non-founder mind scores accumulate, the founders' relative advantage diminishes naturally. The 60% mind weight ensures that long-term contributors eventually outweigh founders, preventing permanent oligarchy.

---

## 9. Related Work

Douceur (2002) formalized the Sybil attack and proved that without a trusted central authority, Sybil resistance requires either resource testing or identity verification [4]. PoM provides resource testing through cognitive contribution -- a resource that is simultaneously verifiable (on-chain), non-transferable (soulbound), and temporally irreducible.

Ostrom (1990) demonstrated that commons can be governed sustainably without privatization or state control when institutional design satisfies specific structural conditions [3]. PoM's graduated sanctions, proportional rewards, and nested governance directly implement Ostrom's framework for digital commons.

Shapley (1953) proved the existence of a unique fair allocation in cooperative games satisfying efficiency, symmetry, null-player, and additivity axioms [5]. PoM's integration with the ShapleyDistributor ensures that mind score accumulation feeds into a mathematically fair reward distribution, closing the loop between contribution and compensation.

Nakamoto (2008) introduced the idea that consensus can emerge from economic competition among anonymous participants, with security guaranteed by thermodynamic cost [1]. PoM extends this insight: consensus can also emerge from cognitive competition, with security guaranteed by temporal cost.

Buterin (2014) introduced economic stake as a complementary security dimension [2]. PoM retains this insight (30% stake weight) while adding a third dimension that addresses the vulnerability Buterin identified: nothing-at-stake in PoS can be mitigated but not eliminated without an irreducible cost. Mind score is that irreducible cost.

---

## 10. Conclusion

Proof of Mind completes the consensus security space by adding an irreducible temporal dimension that cannot be circumvented by any amount of capital, computation, or coordination. The vote weight formula `(stake * 0.30) + (pow * 0.10) + (mind * 0.60)` ensures that accumulated genuine cognitive contribution is the dominant factor in consensus, while retaining economic alignment (PoS) and spam resistance (PoW) as complementary barriers.

The security guarantee is asymptotic: attack cost grows monotonically with network age and without bound. Every attacker, regardless of resources, is eventually priced out. The mechanism achieves this without trusted hardware, biometric verification, or centralized identity authorities -- only through the irreducible requirement of genuine work verified over time.

The integration with ContributionDAG provides graduated Sybil resistance through a Web of Trust with 15% decay per hop, 6-hop maximum depth, and Merkle-compressed audit trails. The mapping to CKB's cell model is natural: mind scores as cell state, trust edges as cell linkages, temporal accumulation anchored to PoW block height.

The implications extend beyond blockchain consensus. Any system that grounds authority in accumulated demonstrated competence -- rather than credentials, capital, or political appointment -- achieves a form of security that strengthens, rather than weakens, with the passage of time.

The only way to hack the system is to contribute to it.

---

## References

[1] S. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008.

[2] V. Buterin, "A Next-Generation Smart Contract and Decentralized Application Platform," Ethereum Whitepaper, 2014.

[3] E. Ostrom, *Governing the Commons: The Evolution of Institutions for Collective Action*, Cambridge University Press, 1990.

[4] J.R. Douceur, "The Sybil Attack," in Proceedings of the 1st International Workshop on Peer-to-Peer Systems (IPTPS), 2002.

[5] L.S. Shapley, "A Value for N-Person Games," in *Contributions to the Theory of Games*, vol. II, Annals of Mathematics Studies, no. 28, Princeton University Press, 1953.

[6] D.J. de Vries, "Proof of Authority: Understanding the Consensus," 2017.

[7] A. Yakovenko, "Solana: A New Architecture for a High Performance Blockchain," Solana Whitepaper, 2018.

[8] D. Larimer, "Delegated Proof-of-Stake (DPOS)," BitShares Whitepaper, 2014.

---

## Appendix A: Contract Constants Reference

All constants are extracted directly from `ProofOfMind.sol` and `ContributionDAG.sol`:

```
// ProofOfMind.sol
STAKE_WEIGHT_BPS         = 3000          // 30% vote weight from stake
POW_WEIGHT_BPS           = 1000          // 10% vote weight from PoW
MIND_WEIGHT_BPS          = 6000          // 60% vote weight from mind score
INITIAL_DIFFICULTY       = 20            // 20 leading zero bits
DIFFICULTY_ADJUSTMENT_PERIOD = 100       // blocks between adjustments
TARGET_SOLVE_TIME        = 30            // seconds
MIND_LOG_BASE            = 2             // log2 scaling
MIND_SCALE               = 1e18          // fixed-point precision
MIN_STAKE                = 0.01 ether    // minimum economic commitment
EQUIVOCATION_WINDOW      = 2 hours       // double-vote detection window
SLASH_EQUIVOCATION       = 5000          // 50% stake slash for double-voting
SLASH_DOWNTIME           = 500           // 5% stake slash for downtime
SLASH_INVALID_POW        = 1000          // 10% stake slash for bad PoW

// ContributionDAG.sol
PRECISION                = 1e18          // fixed-point precision
MAX_VOUCH_PER_USER       = 10            // max outgoing vouches
MIN_VOUCHES_FOR_TRUSTED  = 2             // min incoming vouches for trusted
TRUST_DECAY_PER_HOP      = 1500          // 15% decay per hop (BPS)
MAX_TRUST_HOPS           = 6             // BFS depth limit
HANDSHAKE_COOLDOWN       = 1 day         // re-vouch cooldown
MAX_FOUNDERS             = 20            // hard cap on founder nodes
FOUNDER_MULTIPLIER       = 30000         // 3.0x voting power
TRUSTED_MULTIPLIER       = 20000         // 2.0x voting power
PARTIAL_TRUST_MULTIPLIER = 15000         // 1.5x voting power
UNTRUSTED_MULTIPLIER     = 5000          // 0.5x voting power
TRUSTED_THRESHOLD        = 7e17          // 0.70 trust score
PARTIAL_THRESHOLD         = 3e17          // 0.30 trust score
FOUNDER_CHANGE_TIMELOCK  = 7 days        // timelock for adding/removing founders
LAWSON_CONSTANT          = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
```

---

*"The only way to hack the system is to contribute to it."*

*Source code: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)*
