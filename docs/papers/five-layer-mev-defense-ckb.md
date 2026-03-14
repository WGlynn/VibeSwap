# Five-Layer MEV Defense: PoW Locking, MMR Accumulation, Forced Inclusion, Fisher-Yates Shuffle, and Uniform Clearing on Nervos CKB

**Authors**: Faraday1, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research

---

## Abstract

Maximal Extractable Value (MEV) on account-based blockchains is well-studied, with defenses ranging from Flashbots auction mechanisms to threshold encryption schemes. UTXO-based blockchains present a fundamentally different MEV landscape: there is no global mutable state, no deterministic mempool ordering, and contention for shared resources manifests as cell consumption races rather than gas priority auctions. Nervos CKB, a UTXO-extended blockchain with programmable lock and type scripts running on a PoW consensus (NC-Max), introduces both unique challenges and unique opportunities for MEV elimination.

We present a five-layer defense stack for VibeSwap's deployment on CKB. Each layer addresses a distinct and independent attack vector:

1. **PoW Lock** -- computational cost floor for write access, preventing free reordering.
2. **MMR Accumulation** -- append-only cryptographic commitment structure, preventing selective inclusion.
3. **Forced Inclusion** -- structural censorship resistance through user-posted cells and type script enforcement.
4. **Fisher-Yates Shuffle** -- deterministic but unpredictable execution ordering via XORed user secrets.
5. **Uniform Clearing Price** -- identical settlement price for all orders in a batch, rendering ordering irrelevant.

The composition creates defense-in-depth where removing any single layer opens a specific, exploitable attack vector. No layer is redundant. No single layer is sufficient. The five-layer stack achieves MEV elimination without trusted third parties, centralized sequencers, or threshold cryptography committees -- properties that are structurally impossible on account-based chains.

---

## 1. Introduction

### 1.1 The MEV Problem

MEV refers to the profit extractable by parties who control or influence transaction ordering. On Ethereum, this manifests as front-running, sandwich attacks, and just-in-time liquidity -- all enabled by the public mempool and the sequential execution model. A validator (or MEV searcher colluding with one) observes a pending swap, inserts a transaction before it to move the price, and another after it to capture the difference. The victim receives a worse price. The attacker profits from information asymmetry and ordering control.

The annual MEV extraction on Ethereum has exceeded $600M. Existing defenses -- Flashbots MEV-Share, MEV Blocker, threshold encryption proposals -- reduce but do not eliminate MEV. They introduce trusted intermediaries (block builders, encryption committees) or rely on economic incentives (auction revenue sharing) rather than structural impossibility.

### 1.2 Why CKB Changes the Landscape

Nervos CKB's architecture differs from account-based chains in three fundamental ways:

**Cell Model (Extended UTXO).** State is stored in discrete cells, each with a lock script (authorization) and type script (validation). Cells are consumed and recreated atomically. There is no mutable contract storage that multiple transactions can read and write within a single block. Two transactions cannot modify the same state -- one consumes the cell, the other fails.

**PoW Consensus (NC-Max).** CKB uses Nakamoto-style proof-of-work with the NC-Max protocol, which improves throughput while maintaining Bitcoin-class security assumptions. Block producers are miners, not validators with known identities. There is no proposer-builder separation because there are no proposers -- just miners competing on hash power.

**No Global State.** There is no `SSTORE`/`SLOAD` equivalent. Application state is explicitly carried in cell data and reconstructed by scripts at verification time. This means there is no "state access list" that reveals which cells a transaction will touch before execution.

These properties eliminate some EVM-style MEV vectors (no `SLOAD`-based information leakage, no gas priority ordering within a block for same-cell access) but introduce a new one: **cell contention**. When a DEX order book, liquidity pool, or auction accumulator lives in a single cell, multiple users racing to update it creates a contention bottleneck where most transactions fail. The naive solution -- a centralized operator sequencing updates -- reintroduces the MEV surface that CKB's architecture should eliminate.

### 1.3 Contribution

We present a five-layer MEV defense stack designed for CKB's cell model. The stack composes independent mechanisms at different abstraction layers -- infrastructure ordering, data accumulation, inclusion enforcement, execution ordering, and pricing -- to achieve defense-in-depth. Each layer is necessary. The composition is the innovation.

---

## 2. CKB Architecture Primer

### 2.1 The Cell Model

A CKB cell is an immutable data container with four fields:

| Field | Purpose |
|-------|---------|
| `capacity` | CKBytes locked in this cell (minimum storage cost) |
| `lock` | Script that must succeed for the cell to be consumed (authorization) |
| `type` | Script that validates state transitions (application logic) |
| `data` | Arbitrary bytes (application state) |

Transactions consume input cells and produce output cells. A transaction is valid if and only if: (a) every input cell's lock script succeeds, and (b) every output cell's type script succeeds. This is verification, not computation -- scripts verify that a state transition is valid, they do not compute the transition itself.

The critical property for MEV defense: **lock and type are orthogonal**. Authorization ("who can update this cell") is completely independent of validation ("what constitutes a valid update"). This separation enables the PoW lock to control access without knowing anything about the auction logic, and the auction type script to validate state transitions without knowing how access was granted.

### 2.2 NC-Max Consensus

CKB's NC-Max is a two-step transaction confirmation protocol built on Nakamoto PoW:

1. **Propose**: Transactions are proposed in block `n` (their IDs appear in the proposal zone).
2. **Commit**: Proposed transactions are committed (fully included) in blocks `n+2` through `n+w` (the commitment window).

This two-step process means that by the time a transaction is committed, it has been publicly visible for at least two blocks. On account-based chains, this visibility window would be a MEV gift -- searchers would have two blocks to construct front-running transactions. On CKB, the cell model neutralizes this: if a searcher sees a commit transaction consuming cell X, they cannot construct a competing transaction for cell X because cell X will already be consumed. The contention is at the cell level, not the mempool level.

However, this protection applies only to direct cell contention. A sophisticated attacker might observe pending commits to an auction cell and submit their own commit with a competing PoW solution, hoping to be included first. This is precisely what the PoW lock layer addresses.

### 2.3 Script Verification Model

CKB scripts run on a RISC-V virtual machine (CKB-VM). Scripts have access to:

- **Cell data**: Contents of input and output cells
- **Witnesses**: Auxiliary data attached to the transaction (proofs, signatures, secrets)
- **Header deps**: Block headers referenced by the transaction (for difficulty adjustment, timestamps)

Scripts cannot access external state, make network calls, or observe the mempool. They are pure verification functions: given the transaction, return success or failure. This purity is a security property -- scripts cannot be manipulated by external state changes between proposal and commitment.

---

## 3. The Five Layers

### 3.1 Layer 1: PoW Lock

**Attack vector addressed**: Free reordering. Without a cost floor, anyone can submit competing state transitions at negligible cost, enabling race conditions and ordering manipulation.

#### 3.1.1 Mechanism

The auction cell's lock script requires proof-of-work to consume. The lock script verifies:

1. The transaction witness contains a valid SHA-256 PoW proof.
2. The proof meets the current difficulty target embedded in the cell.
3. The proof commits to the hash chain of prior state transitions (preventing proof reuse).

```
PoWLockArgs {
    pair_id: [u8; 32],       // Identifies the shared state system
    min_difficulty: u8,       // Minimum difficulty (bits of leading zeros)
}
```

The implementation reuses the Bitcoin block header format for the proof structure, making it SPV-verifiable and compatible with existing SHA-256 mining hardware. Each state transition commits to the prior transition's hash, forming a mini-blockchain within the cell's history.

#### 3.1.2 Difficulty Adjustment

Difficulty adjusts dynamically based on state transition frequency. The lock script uses `header_deps` to reference CKB block headers containing the timestamps of the previous two state transitions. If transitions are happening too frequently (contention is high), difficulty increases. If transitions are infrequent, difficulty decreases.

This creates an economic equilibrium: the cost of PoW for write access self-adjusts to match the value of the state transition. For high-volume trading pairs where MEV extraction would be profitable, difficulty rises until the PoW cost exceeds the extractable value. For low-volume pairs, difficulty stays low and updates are cheap.

#### 3.1.3 Anti-Griefing

Griefing attacks -- submitting PoW solutions to claim write access without performing useful state transitions -- are self-punishing. The attacker burns real hash power (electricity cost) but gains no economic value, because the type script independently validates that the state transition is meaningful (a legitimate commit, reveal, or settlement). An attacker who mines a valid PoW but submits an invalid state transition wastes their work -- the transaction fails type script validation.

#### 3.1.4 Attack Scenario: Layer 1 Removed

Without the PoW lock, write access to the auction cell defaults to CKB's native transaction ordering -- whichever transaction the miner includes first. This reintroduces speed-of-access races:

- **Scenario**: Alice submits a commit to the auction cell. Bob, a colluding miner, sees Alice's pending transaction and submits his own commit first, consuming the auction cell before Alice's transaction can be committed. Alice's transaction fails (cell already consumed).
- **Impact**: The miner becomes a de facto centralized sequencer with full control over who can participate in the auction. This is functionally identical to the "operator issuing tickets" model that Matt's PoW proposal was designed to replace.
- **MEV extraction**: The miner can selectively include or exclude commits, enabling information-based front-running even though the commits are hashed.

#### 3.1.5 Key Property

**PoW creates a cost floor for ordering manipulation that scales with the value at stake.** This cost is enforced by thermodynamics (energy expenditure), not by protocol rules that can be gamed through validator collusion or MEV auctions.

---

### 3.2 Layer 2: MMR Accumulation

**Attack vector addressed**: Selective inclusion/exclusion of orders within a batch. Without a compact, verifiable accumulator, a miner who wins PoW access could cherry-pick which orders to include.

#### 3.2.1 Mechanism

Committed orders are accumulated into a Merkle Mountain Range (MMR) -- an append-only data structure that produces a compact root hash over an arbitrary number of leaves. The MMR root stored in the auction cell commits to the complete, ordered set of all commits received during the batch.

Standard MMR properties:
- **Append-only**: Leaves can only be added, never removed or reordered.
- **Compact**: The accumulator state is O(log n) peak hashes, not O(n) individual leaves.
- **Provable**: Any individual leaf can be proven as a member of the MMR in O(log n) time.

#### 3.2.2 Recursive MMR Innovation

The implementation uses recursive MMR compression (credit: Matt, Nervos). Instead of hashing peaks together naively to produce a single root, peaks are recursively inserted into another MMR, which is itself compressed, and so on until a single root remains. This yields:

- **Uniform proof format**: Verification always operates within an MMR structure, never switching to a different format for peak aggregation.
- **O(log n) historical proofs**: The prevblock field in each mini-block header is also an MMR root over all prior blocks, replacing the linked-list structure of traditional blockchains. Proving any historical state transition requires O(log n) hashes instead of O(n) sequential traversal.

```
100 commits  -->  MMR  -->  3 peaks
3 peaks      -->  MMR  -->  2 peaks
2 peaks      -->  MMR  -->  1 root (commitRoot)

5 commitRoots -->  MMR -->  2 peaks
2 peaks       -->  MMR -->  1 root (batchRoot)
```

#### 3.2.3 Attack Scenario: Layer 2 Removed

Without the MMR accumulator, committed orders exist as individual data entries with no cryptographic binding to the complete set.

- **Scenario**: A miner wins PoW access and updates the auction cell. Without an MMR root committing to all received orders, the miner includes 18 of 20 pending commits but excludes 2 that would move the clearing price unfavorably for the miner's own position.
- **Impact**: Selective exclusion biases the clearing price. The miner effectively censors specific orders without leaving verifiable evidence that those orders existed at the time of the state transition.
- **Why PoW alone is insufficient**: The PoW lock prevents free reordering but does not constrain what the PoW winner includes. PoW determines WHO updates the cell. The MMR constrains WHAT the update must contain.

#### 3.2.4 Key Property

**The MMR provides a cryptographic commitment to completeness.** Once an order is appended to the MMR, its inclusion (or absence) is provable. The type script can verify that the MMR root in the output cell is a valid extension of the MMR root in the input cell.

---

### 3.3 Layer 3: Forced Inclusion

**Attack vector addressed**: Censorship. Even with an MMR accumulator, if the miner controls which orders enter the MMR in the first place, they can censor orders before accumulation.

#### 3.3.1 Mechanism

Users do not submit their commits directly to the shared auction cell. Instead, each user posts their commit to their own individual cell -- a personal commit cell with no contention (only the user can write to their own cell). The commit cell's type script (`commit-type`) validates the commit format (valid hash, sufficient deposit).

The miner who wins PoW access to the shared auction cell must aggregate ALL pending commit cells into the MMR. The auction cell's type script (`batch-auction-type`) enforces this:

1. It scans for all live commit cells matching the current batch ID.
2. It verifies that every live commit cell is consumed as an input to the aggregation transaction.
3. It verifies that the output MMR root includes all consumed commit cells as new leaves.

The miner is a **compensated aggregator with zero discretion**. They are paid (via PoW reward or transaction fees) for performing the aggregation, but the type script structurally prevents them from excluding any valid commit. Censorship is not economically disincentivized -- it is logically impossible. A transaction that excludes a valid commit cell fails type script validation and is rejected by the network.

#### 3.3.2 User-Posted Cells: No Contention by Construction

The key insight is that commit cells are owned by individual users. There is no contention for writing a commit cell because only one user writes to it. The contention problem is isolated to the shared auction cell, where it is resolved by the PoW lock. Users never compete with each other for write access -- they compete only indirectly through the PoW miners who aggregate their commits.

#### 3.3.3 Attack Scenario: Layer 3 Removed

Without forced inclusion, the miner has discretion over which orders enter the MMR.

- **Scenario**: A miner observes that 5 large sell orders are pending as commit cells. The miner holds a long position. By excluding these 5 sells from the aggregation, the clearing price will be higher. The miner aggregates only the buy orders and smaller sells, producing a valid MMR root over the included set.
- **Impact**: The excluded sellers are censored. Their orders never enter the batch. The clearing price is manipulated upward.
- **Why MMR alone is insufficient**: The MMR proves that included orders were not tampered with, but it cannot prove that excluded orders should have been included. Without forced inclusion, the MMR is a faithful record of a censored set.

#### 3.3.4 Key Property

**Censorship resistance by construction, not incentive.** The type script makes it logically impossible to produce a valid state transition that excludes a live commit cell. No economic analysis is needed -- the constraint is enforced by the verification logic itself.

---

### 3.4 Layer 4: Fisher-Yates Shuffle

**Attack vector addressed**: Execution order manipulation within a batch. Even with all orders included at the same price, the execution sequence can matter if there are partial fills, liquidity effects, or rounding.

#### 3.4.1 Mechanism

After all orders in a batch are revealed, the settlement transaction determines execution order using a Fisher-Yates shuffle seeded by the XOR of all user-provided secrets.

```
seed = secret_1 XOR secret_2 XOR ... XOR secret_n
shuffled_indices = fisher_yates(order_indices, seed)
```

Each user provides a secret during the commit phase (hashed into their commitment). During the reveal phase, they reveal the secret. The XOR of all secrets produces a seed that no single party can predict or control without knowing every other user's secret in advance.

Fisher-Yates is a well-studied algorithm that produces a uniformly random permutation given a uniformly random seed. The security property is:

- **No single party controls the seed**: Changing your own secret changes the seed, but you cannot predict what the new seed will be without knowing all other secrets.
- **Deterministic given the seed**: Every verifier can independently reproduce the shuffle from the revealed secrets, ensuring settlement is verifiable.
- **Unbiased**: Every permutation is equally likely under the assumption that at least one participant's secret is unknown to the attacker.

#### 3.4.2 Partial Fill Ordering

In batches where liquidity is insufficient to fill all orders, the execution order determines which orders are filled and which are partially filled or unfilled. Without the shuffle, an attacker who controls execution order could ensure their own orders are filled first, leaving other participants with partial fills or slippage.

The Fisher-Yates shuffle ensures that no party can position their order advantageously within the batch. The expected fill fraction for any order is determined by its size relative to available liquidity, not by its position in the execution sequence.

#### 3.4.3 Attack Scenario: Layer 4 Removed

Without the shuffle, execution order defaults to some deterministic sequence (e.g., order of commitment, lexicographic order of commit hashes).

- **Scenario**: Without shuffling, orders execute in commit-time order. An attacker who controls the PoW miner knows the commit order (they aggregated the commits). In a partial-fill scenario, the attacker places their own order first in the aggregation sequence, ensuring it is fully filled before liquidity is exhausted.
- **Impact**: The attacker receives preferential fills. Other users receive partial fills or are excluded entirely. This is a form of MEV extraction even with uniform pricing.
- **Why uniform pricing alone is insufficient**: Uniform clearing price eliminates price-based MEV, but fill-priority-based MEV remains if execution order is predictable and manipulable.

#### 3.4.4 Key Property

**Execution order is deterministic (verifiable) but unpredictable (unmanipulable).** The seed is a function of all participants' secrets, so no subset of participants can predict or control the permutation.

---

### 3.5 Layer 5: Uniform Clearing Price

**Attack vector addressed**: Price discrimination. Even if ordering is random and inclusion is forced, an attacker could extract value if different orders execute at different prices.

#### 3.5.1 Mechanism

All orders in a batch settle at a single uniform clearing price. The clearing price is computed as the price that maximizes matched volume -- the intersection of the aggregate supply and demand curves formed by all revealed orders in the batch.

```
clearing_price = argmax_p { min(demand(p), supply(p)) }
```

Every buy order at or above the clearing price is filled. Every sell order at or below the clearing price is filled. Marginal orders (at exactly the clearing price) may be partially filled pro-rata.

#### 3.5.2 Why Uniform Pricing Eliminates Sandwich Attacks

A sandwich attack requires three conditions:
1. The attacker observes a pending order (violated by commit-reveal -- orders are hidden).
2. The attacker can execute before and after the victim (violated by Fisher-Yates shuffle -- ordering is random).
3. The attacker profits from the price difference between their transactions and the victim's (violated by uniform pricing -- there is no price difference).

Uniform clearing price eliminates condition 3 independently of conditions 1 and 2. Even in a hypothetical scenario where an attacker could see orders and control execution sequence, the uniform price means their buy executes at the same price as their sell. There is no spread to capture.

#### 3.5.3 Attack Scenario: Layer 5 Removed

Without uniform pricing, orders execute at marginal prices determined by their position in the execution sequence.

- **Scenario**: Orders execute sequentially against a constant-product AMM. The first buy moves the price up. The second buy moves it up further. The attacker places a buy first (before the price moves) and a sell last (after all buys have moved the price up). The attacker captures the price impact of intermediate orders.
- **Impact**: This is a classic sandwich attack. The attacker profits from other users' price impact, and victims receive worse execution than the fair market price.
- **Why the shuffle is insufficient**: The shuffle randomizes order, which makes sandwich attacks probabilistic rather than deterministic, but does not eliminate them. An attacker with multiple orders in the batch still has a nonzero probability of achieving a favorable ordering. Uniform pricing makes the probability of profit zero regardless of ordering.

#### 3.5.4 Key Property

**Ordering becomes irrelevant.** When every order executes at the same price, there is no informational or positional advantage to being first, last, or anywhere in between. This is the terminal defense -- it makes all ordering-based MEV extraction strategies produce zero expected profit.

---

## 4. Composition Analysis: Defense-in-Depth

### 4.1 Why All Five Layers Are Necessary

The five layers are not redundant. Each addresses a distinct attack vector, and removing any single layer opens a specific exploit path. The following table summarizes the defense matrix:

| Attack Vector | Primary Defense | What Fails If Removed |
|---------------|----------------|----------------------|
| Free reordering / speed races | Layer 1: PoW Lock | Miners become centralized sequencers |
| Selective order inclusion | Layer 2: MMR Accumulation | Miners cherry-pick favorable order sets |
| Order censorship | Layer 3: Forced Inclusion | Miners exclude orders pre-accumulation |
| Execution order manipulation | Layer 4: Fisher-Yates Shuffle | Commit-order or miner-determined sequence enables fill-priority MEV |
| Price discrimination / sandwiches | Layer 5: Uniform Clearing Price | Sequential execution against AMM enables sandwich extraction |

### 4.2 Layer Interaction Map

The layers are not independent -- they compose to strengthen each other:

```
Layer 1 (PoW Lock)
  |
  v  Controls WHO updates the auction cell
Layer 2 (MMR Accumulation)
  |
  v  Constrains WHAT the update must contain (append-only, no removal)
Layer 3 (Forced Inclusion)
  |
  v  Ensures ALL valid commits enter the MMR (zero miner discretion)
Layer 4 (Fisher-Yates Shuffle)
  |
  v  Determines execution ORDER (unpredictable, deterministic)
Layer 5 (Uniform Clearing Price)
  |
  v  Makes ordering IRRELEVANT (all orders at same price)
```

The flow is a progressive narrowing of attacker capability:

1. The attacker cannot cheaply gain write access (PoW cost floor).
2. If they gain write access, they cannot selectively include orders (MMR binding).
3. If they could somehow bypass the MMR, they still cannot exclude valid commits (forced inclusion).
4. If they somehow control the order set, they cannot control execution sequence (shuffle).
5. If they somehow control the sequence, they cannot extract value from ordering (uniform price).

Each layer makes the next layer's failure mode less exploitable, and each layer independently closes an attack vector that the other layers do not address.

### 4.3 Formal Attack Surface Reduction

Define the attacker's MEV capability set as:

```
MEV = f(ordering_control, inclusion_control, sequence_control, price_control)
```

| Layers Present | ordering_control | inclusion_control | sequence_control | price_control | MEV |
|:---:|:---:|:---:|:---:|:---:|:---:|
| None | Full | Full | Full | Full | Maximum |
| L1 | Cost-bounded | Full | Full | Full | Reduced |
| L1+L2 | Cost-bounded | Committed | Full | Full | Reduced |
| L1+L2+L3 | Cost-bounded | Zero | Full | Full | Reduced |
| L1+L2+L3+L4 | Cost-bounded | Zero | Zero | Full | Reduced |
| L1+L2+L3+L4+L5 | Cost-bounded | Zero | Zero | Zero | **Zero** |

MEV reaches zero only when all five layers are present. Removing any single layer leaves at least one control variable nonzero.

---

## 5. Comparison with EVM-Based MEV Defenses

### 5.1 Flashbots MEV-Share

**Mechanism**: Searchers submit MEV bundles to a centralized block builder (Flashbots). MEV profits are shared between the searcher and the user whose transaction was "MEV'd."

**Limitations**:
- Requires trust in the block builder (centralized intermediary).
- MEV is redistributed, not eliminated. Users still receive worse execution than a MEV-free market.
- The builder has full visibility into pending transactions and bundles.

**CKB comparison**: VibeSwap's five-layer stack eliminates MEV rather than redistributing it. There is no centralized builder. The PoW lock replaces the builder's role with decentralized leader selection.

### 5.2 Threshold Encryption (e.g., Shutter Network)

**Mechanism**: Transactions are encrypted with a threshold key. A committee of keyholders must collaborate to decrypt transactions after they are sequenced but before they are executed. Sequencers cannot front-run because they cannot read encrypted transactions.

**Limitations**:
- Requires a threshold encryption committee (trusted third party with liveness requirements).
- Committee collusion or key compromise exposes all pending transactions.
- Adds latency (decryption round) and complexity (key management, resharing).
- Does not address fill-priority MEV or price discrimination.

**CKB comparison**: VibeSwap's commit-reveal achieves transaction hiding without threshold encryption. Users commit hashes (no encryption committee needed) and reveal secrets themselves. The hiding is self-sovereign -- each user controls their own secret. No committee liveness requirement. No key compromise risk.

### 5.3 Private Mempools (e.g., MEV Blocker)

**Mechanism**: Users submit transactions to a private mempool operated by a trusted party. The operator sequences transactions without revealing them to searchers.

**Limitations**:
- The operator IS the trusted party. They could front-run or sell order flow.
- Single point of failure and censorship.
- Does not address MEV by the operator themselves.

**CKB comparison**: Forced inclusion on CKB means there is no operator with censorship or ordering discretion. The miner aggregates commit cells, but the type script enforces completeness. The miner is a compensated aggregator, not a trusted sequencer.

### 5.4 Summary Comparison

| Property | Flashbots | Threshold Enc. | Private Mempool | VibeSwap on CKB |
|----------|-----------|----------------|-----------------|------------------|
| MEV eliminated (not just redistributed) | No | Partial | No | **Yes** |
| No trusted third party | No | No | No | **Yes** |
| No committee/liveness requirement | Yes | No | N/A | **Yes** |
| Censorship resistant by construction | No | Partial | No | **Yes** |
| Ordering irrelevance | No | No | No | **Yes** |
| Self-sovereign hiding | No | No | No | **Yes** |
| Cost-floor on ordering manipulation | No | No | No | **Yes** |

The fundamental difference is structural versus economic. EVM-based defenses rely on economic incentives (profit sharing), trusted intermediaries (builders, committees, operators), or cryptographic assumptions (threshold schemes). VibeSwap on CKB achieves MEV elimination through structural impossibility enforced by CKB's verification model -- type scripts that reject invalid state transitions, lock scripts that enforce PoW cost, and a cell model that separates user commits from shared state.

---

## 6. The Knowledge Primitive

> *Defense-in-depth is not redundancy -- each layer addresses a distinct attack vector. The composition is the innovation, not any single layer.*

This principle generalizes beyond MEV defense. In security engineering, layered defenses are often described as "redundant" -- multiple barriers performing the same function so that if one fails, others catch the attack. This is a mischaracterization when applied to the five-layer stack.

Redundancy means layers are interchangeable. Defense-in-depth means layers are complementary. The PoW lock cannot replace forced inclusion. The shuffle cannot replace uniform pricing. Each layer closes a different door. The composition closes all doors simultaneously.

This distinction matters for system design: adding a sixth layer that duplicates an existing layer's function adds complexity without security. Adding a layer that addresses a new attack vector compounds the defense. The design criterion is: **does this layer close a door that is currently open?** If yes, it is necessary. If no, it is bloat.

---

## 7. Implementation on CKB

### 7.1 Script Architecture

```
Auction Cell:
  Lock Script:  pow-lock        (Layer 1)
  Type Script:  batch-auction-type  (Layers 2, 3, 4, 5)
  Data:         MMR root, batch state, difficulty, phase

Commit Cell (per user):
  Lock Script:  user's standard lock
  Type Script:  commit-type
  Data:         hash(order || secret), deposit amount, batch ID
```

The `pow-lock` script handles Layer 1 verification. The `batch-auction-type` script handles Layers 2 through 5:

- **Layer 2**: Verifies MMR root updates are valid append operations.
- **Layer 3**: Verifies all live commit cells for the current batch are consumed in aggregation transactions.
- **Layer 4**: Verifies the Fisher-Yates shuffle was performed correctly with the XOR of revealed secrets.
- **Layer 5**: Verifies the clearing price calculation and that all fills use the uniform price.

### 7.2 Transaction Flow

**Phase 1 -- Commit (8 seconds)**:
1. Each user creates a commit cell containing `hash(order || secret)` and a deposit.
2. Commit cells are posted to each user's own address (no contention).
3. PoW miners compete to aggregate commit cells into the shared auction cell.
4. Each aggregation transaction consumes pending commit cells and extends the MMR.

**Phase 2 -- Reveal (2 seconds)**:
1. Users reveal their orders and secrets by posting reveal cells.
2. PoW miners aggregate reveals into the auction cell.
3. Type script validates that each reveal matches its corresponding commit hash.
4. Invalid reveals trigger 50% deposit slashing.

**Phase 3 -- Settlement**:
1. A miner submits the settlement transaction.
2. Type script computes `seed = XOR(all revealed secrets)`.
3. Type script performs Fisher-Yates shuffle on order indices.
4. Type script computes the uniform clearing price.
5. Type script verifies all fills are at the clearing price.
6. Output cells distribute tokens and remaining deposits to participants.

### 7.3 Difficulty Calibration

The PoW difficulty on auction cells must balance two constraints:

- **High enough** that the PoW cost exceeds MEV extraction value, maintaining the cost floor.
- **Low enough** that legitimate aggregation transactions are economically viable within the batch window.

The target is calibrated so that state transitions occur frequently enough to include all user commits within the 8-second commit window. For high-volume pairs, difficulty rises naturally as more miners compete for the more valuable aggregation rights. For low-volume pairs, difficulty stays at the minimum, and aggregation is nearly free.

### 7.4 Concurrency

Multiple auction cells run concurrently -- one per trading pair. Each is an independent PoW mini-chain settled on CKB L1. They share no state and do not contend with each other. The system scales horizontally: adding a new trading pair creates a new auction cell with its own independent PoW chain and difficulty adjustment.

---

## 8. Limitations and Open Questions

**Geographic PoW advantage.** Miners with lower-latency connections to CKB nodes may have a slight advantage in submitting PoW solutions first. This is a known property of all PoW systems and is mitigated by difficulty adjustment -- the advantage is absorbed into the equilibrium difficulty level.

**PoW energy cost.** The per-cell PoW consumes energy proportional to the difficulty level. For high-volume pairs, this energy cost is a real externality. Future work may explore replacing SHA-256 PoW with useful computation (e.g., verifiable delay functions) while preserving the cost-floor property.

**Batch timing on PoW chains.** Fixed 8+2 second batch windows interact with CKB's variable block times (target ~16-24 seconds under NC-Max). Batches may span multiple CKB blocks, and the relationship between batch boundaries and block boundaries requires careful handling to prevent cross-batch information leakage.

**Secret withholding.** If a user commits but does not reveal their secret, the XOR-based shuffle seed is computed over the remaining revealed secrets. The non-revealing user loses their deposit (50% slash), but the batch proceeds. The security property degrades gracefully: the shuffle remains unpredictable as long as at least one honest participant reveals a secret unknown to the attacker.

**MMR proof size.** Recursive MMR proofs are O(log n) but with a larger constant factor than standard Merkle proofs due to the recursive structure. For very large batches (>10,000 orders), proof verification time in CKB-VM may become a constraint. This can be mitigated by batching commits across multiple aggregation transactions rather than accumulating all commits in a single state transition.

---

## 9. Conclusion

MEV defense on UTXO-based blockchains requires fundamentally different strategies than on account-based chains. CKB's cell model, PoW consensus, and lock/type script separation enable a five-layer defense stack that achieves MEV elimination through structural impossibility rather than economic incentives or trusted intermediaries.

The five layers -- PoW locking, MMR accumulation, forced inclusion, Fisher-Yates shuffle, and uniform clearing price -- each address a distinct attack vector. No single layer is sufficient. No layer is redundant. The composition creates defense-in-depth where an attacker must simultaneously break all five layers to extract any MEV, and each layer's failure mode is independently mitigated by the others.

This architecture is not portable to account-based chains. The lock/type separation, the cell-level contention model, and the PoW consensus are CKB-specific properties that enable guarantees impossible on Ethereum or its L2s. VibeSwap on CKB is not a port of an EVM DEX -- it is a fundamentally stronger design that leverages CKB's unique architecture to achieve what account-based chains cannot: MEV elimination without trust.

---

## Acknowledgments

Matt (@matt-nervos) for the PoW shared state and recursive MMR proposals that form Layers 1-3 of this stack. @xxuejie for CKB script architecture guidance. @nirenzang (Ren) for the original ticket-based contention resolution that motivated the PoW alternative. @TabulaRasa for the forced inclusion mechanism design insight.

Reference implementation: [EfficientMMRinEVM](https://github.com/matt-nervos/EfficientMMRinEVM)

---

## References

1. Daian, P., Goldfeder, S., Kell, T., et al. "Flash Boys 2.0: Frontrunning in Decentralized Exchanges." IEEE S&P 2020.
2. Nervos CKB RFC: "CKB Transaction Structure." https://github.com/nervosnetwork/rfcs
3. Nervos CKB RFC: "NC-Max Consensus Protocol." https://github.com/nervosnetwork/rfcs
4. Knuth, D. "The Art of Computer Programming, Volume 2: Seminumerical Algorithms." Section 3.4.2: Random Sampling and Shuffling.
5. Todd, P. "Merkle Mountain Ranges." https://github.com/opentimestamps/opentimestamps-server
6. Flashbots. "MEV-Share: Programmable Privacy." https://docs.flashbots.net
7. Breidenbach, L., Daian, P., Juels, A., et al. "Chainlink 2.0: Next Steps in the Evolution of Decentralized Oracle Networks." 2021.
8. Buterin, V. "Proposer/Builder Separation (PBS)." Ethereum Research, 2021.
