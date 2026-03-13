# PoW Shared State and VibeSwap: Solving Cell Contention with Recursive MMR

**Authors**: W. Glynn, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research
**Acknowledgments**: Matt (PoW shared state proposal, recursive MMR design)

---

## Abstract

CKB's Cell model provides strong isolation guarantees but introduces a challenge for applications that require shared mutable state: cell contention. When multiple parties need to update the same cell simultaneously, competing transactions race to consume it, and all but one fail. This paper describes how VibeSwap leverages Matt's PoW shared state proposal and recursive Merkle Mountain Range (MMR) data structure to resolve cell contention for batch auctions on CKB. We detail the contention problem, the PoW-gated solution, the role of recursive MMR in commit accumulation, the forced inclusion protocol that prevents miner censorship, and the economic equilibrium that emerges from self-adjusting difficulty. The combined system transforms cell contention from an obstacle into an anti-MEV feature.

---

## 1. The Contention Problem

### 1.1 Why Shared State Is Hard on CKB

VibeSwap's batch auction requires shared state by definition. During the commit phase, multiple users submit order commitments to the same auction. During the reveal phase, multiple users reveal against the same state. During settlement, the full order set is processed against the pool.

On an account-based chain, this is trivial -- multiple transactions read and write to the same storage slots within a block. On CKB, a cell can only be consumed once per transaction. If twenty users try to commit to the same auction cell in the same block, nineteen of them fail with "dead cell" errors.

### 1.2 The Centralized Operator Trap

The obvious solution is a centralized operator who sequences commits. Users send commits to the operator, the operator batches them into a single transaction, and the contention disappears.

But for a commit-reveal DEX, this is fatal. The operator sees all commits before they are included on-chain. The commit is `hash(order || secret)`, which hides the order parameters. But the operator can observe patterns: timing, amounts deposited, which trading pairs are targeted. The operator becomes an information-privileged party -- precisely the kind of actor commit-reveal is designed to eliminate.

### 1.3 Matt's Solution: PoW as Leader Election

Matt proposed applying Nakamoto consensus principles to cell write access. Instead of a centralized operator issuing "tickets" for who gets to update the cell, anyone can earn write access by solving a proof-of-work puzzle. The PoW lock script verifies the proof. Difficulty adjusts based on transition frequency.

This is the same mechanism that secures Bitcoin, applied at the application level. No single party controls access. No single party has information privilege. The cost of access is computational work, distributed across all participants.

---

## 2. Architecture

### 2.1 Layer Separation

The design cleanly separates four concerns:

```
  Layer Stack
  ============================================================

  +-----------------------------------------+
  | Layer 4: PRICING                        |
  | Uniform clearing price calculation      |
  | (Type script: batch-auction-type)       |
  +-----------------------------------------+
  | Layer 3: ORDERING                       |
  | Fisher-Yates shuffle over XORed secrets |
  | (Type script: batch-auction-type)       |
  +-----------------------------------------+
  | Layer 2: ACCUMULATION                   |
  | Recursive MMR for commit history        |
  | (Type script: batch-auction-type)       |
  +-----------------------------------------+
  | Layer 1: ACCESS CONTROL                 |
  | PoW-gated write access                  |
  | (Lock script: pow-lock)                 |
  +-----------------------------------------+
```

Layer 1 is pure lock script -- it only controls who can update the cell. Layers 2-4 are type script -- they only control what the update does. This separation means that upgrading the auction logic (type script) does not require changing the access control mechanism (lock script), and vice versa.

### 2.2 PoW Lock Script

The `pow-lock` script in VibeSwap's codebase:

**Args**: `pair_id (32 bytes) || min_difficulty (1 byte)`

**Verification logic**:
1. Read the PoW proof from the transaction witness: `challenge (32 bytes) || nonce (32 bytes)`
2. Compute `hash = SHA-256(challenge || nonce)`
3. Count leading zero bits of hash
4. Verify leading zero bits >= difficulty target stored in the cell data
5. Verify challenge matches `SHA-256(pair_id || batch_id || prev_state_hash)` from the input cell

The challenge derivation ensures that each PoW proof is specific to the current cell state. A proof mined for batch N cannot be reused for batch N+1. A proof for one trading pair cannot be used for another.

### 2.3 Difficulty Adjustment

VibeSwap's difficulty adjustment follows Bitcoin's approach:

- **Target**: 5 blocks between state transitions (~1 second at CKB's block time)
- **Adjustment window**: Every 10 transitions
- **Maximum adjustment**: 4x increase or 1/4 decrease per epoch
- **Minimum difficulty**: 16 bits (65,536 expected hashes)

```
  Difficulty Self-Regulation
  ============================================================

  High-volume pair (ETH/CKB):
    Many miners compete → transitions happen fast →
    difficulty increases → hash cost rises →
    marginal miners exit → equilibrium

  Low-volume pair (MEME/CKB):
    Few miners → transitions slow →
    difficulty decreases → hash cost drops →
    opportunistic miners enter → equilibrium

  The market finds the balance. No governance needed.
```

---

## 3. Recursive MMR for Commit Accumulation

### 3.1 Why MMR

During each batch, the miner aggregates user commits into the auction cell. The MMR accumulates these commits as an append-only structure with O(log n) proof generation for any historical commit.

Properties that matter for VibeSwap:
- **Append-only**: Commits cannot be removed or reordered after inclusion
- **O(log n) proofs**: Any user can independently verify their commit was included
- **O(1) append**: Adding a commit is constant-time amortized
- **Compact roots**: Peak count equals the number of 1-bits in the leaf count (binary representation)

### 3.2 MMR in the Auction Cell

The auction cell stores only the MMR root (`commit_mmr_root`, 32 bytes). The full MMR data can be reconstructed from the transaction history. Each aggregation transaction:

1. Reads the current MMR root from the auction cell
2. Appends new commits to the MMR
3. Computes the new root
4. Writes the new root to the output cell
5. Type script validates that the new root is consistent with the appended commits

```
  MMR Accumulation (7 commits = 3 peaks)
  ============================================================

          Peak 2 (height 2)       Peak 1    Peak 0
             /        \              |         |
           /    \    /    \          |         |
          C0   C1   C2   C3        C4   C5   C6

  leaf_count = 7 = 0b111 → 3 peaks (three 1-bits)
  root = SHA-256(peak0 || peak1 || peak2 || leaf_count)
```

### 3.3 Recursive Compression (Matt's Innovation)

Matt's recursive MMR takes the standard MMR and adds a recursive step: peaks of the inner MMR are themselves fed into an outer MMR. This continues until a single root remains.

For VibeSwap, this is used for cross-batch historical proofs. Each batch produces an MMR root. Those roots are accumulated into a higher-level MMR, providing O(log n) proofs for any commit in any historical batch. A light client can verify that a specific trade occurred in a specific batch without downloading the full chain history.

```
  Recursive MMR (5 batches)
  ============================================================

  Batch 0: 100 commits → MMR → root_0
  Batch 1: 150 commits → MMR → root_1
  Batch 2:  80 commits → MMR → root_2
  Batch 3: 200 commits → MMR → root_3
  Batch 4: 120 commits → MMR → root_4

  History MMR:
    root_0, root_1, root_2, root_3, root_4 → MMR → history_root

  Proof of any commit in any batch:
    inner proof (commit in batch MMR) + outer proof (batch root in history MMR)
    = O(log commits_in_batch) + O(log batch_count)
```

---

## 4. Forced Inclusion Protocol

### 4.1 The Miner Censorship Problem

Without forced inclusion, a miner who earns PoW access to the auction cell has discretion over which commits to include. A rational miner might exclude competing traders, include only their own orders, or demand side payments for inclusion.

### 4.2 The Solution: Protocol-Enforced Completeness

VibeSwap's forced inclusion protocol:

1. Users create commit cells independently (zero contention, no miner involvement)
2. The miner scans the chain for all pending commit cells matching the auction's pair_id and batch_id
3. The miner builds an aggregation transaction consuming all pending commit cells plus the auction cell
4. The type script (`batch-auction-type`) verifies completeness:
   - All commit cells with matching pair_id and batch_id that exist on-chain must be consumed
   - Compliance filtering (blocked addresses) is the only allowed exception
   - The compliance filter is itself verified against the compliance cell's Merkle root
5. If any valid pending commit is omitted, the type script rejects the transaction

The miner is a compensated aggregator with zero discretion. They earn the mining reward for their PoW work, but they cannot choose which orders to include.

### 4.3 Economic Implications

```
  Miner Incentive Structure
  ============================================================

  Revenue:
    + Base mining reward (proportional to difficulty)
    + Aggregation reward (proportional to commits included)

  Cost:
    - Hash power for PoW
    - Transaction size (more commits = larger tx)

  Discretion:
    Zero. All valid commits must be included.
    Compliance filtering enforced by protocol, not miner judgment.

  Result:
    Mining is profitable when commits are pending.
    More commits → higher reward → more miners → higher difficulty.
    Fewer commits → lower reward → fewer miners → lower difficulty.
    Self-regulating, no governance intervention.
```

---

## 5. Contention Resolution Economics

### 5.1 The Equilibrium

Cell contention is resolved by PoW competition. The economic equilibrium emerges naturally:

- **Supply of write access**: One update per PoW solution
- **Demand for write access**: Proportional to pending commits (trading activity)
- **Price of write access**: Hash power cost at current difficulty
- **Adjusting variable**: Difficulty (which self-adjusts based on transition frequency)

When trading activity increases, more commits accumulate, increasing the value of each aggregation. More miners compete, transitions happen faster, difficulty rises. The hash cost of write access increases until marginal miners exit. The system stabilizes with difficulty proportional to trading value.

### 5.2 CKB's Unique Advantage

This economic equilibrium is only possible because CKB uses PoW at the L1 level. The application-level PoW reuses the same SHA-256 algorithm. Bitcoin mining hardware can participate in VibeSwap mining, creating a deep pool of hash power that makes the system secure from day one. A dedicated attacker cannot easily assemble more hash power than the combined SHA-256 mining ecosystem.

---

## 6. Key Contributions

1. **Detailed implementation** of Matt's PoW shared state proposal within VibeSwap's batch auction architecture, including difficulty adjustment parameters, challenge derivation, and economic incentive analysis.

2. **Recursive MMR integration** for both intra-batch commit accumulation and cross-batch historical proof generation, with O(log n) verification at both levels.

3. **Forced inclusion protocol** with protocol-enforced completeness verification, eliminating miner censorship as a structural property rather than an economic deterrent.

4. **Self-regulating economic model** where difficulty adjustment creates an autonomous market for write access, scaling mining incentives with trading activity without governance intervention.

5. **Transformation of cell contention** from an obstacle (multiple users failing to update the same cell) into a feature (PoW competition for write access provides MEV resistance that account-based chains cannot achieve).

---

## Discussion

Some questions for the community:

1. **What are the optimal difficulty adjustment parameters for CKB's block time?** We target 5 blocks between state transitions with a 10-transition adjustment window and 4x maximum adjustment. Are there CKB-specific considerations (uncle rate, propagation delay, NC-Max dynamics) that suggest different parameters?

2. **Can PoW-gated shared state be applied to CKB governance?** Proposal submission, voting, and parameter changes all involve shared state contention. Would PoW access control provide better censorship resistance than the current governance patterns on CKB?

3. **How should the miner reward structure evolve as trading volume scales?** Our model uses base reward plus per-commit aggregation reward. Should rewards incorporate CKB's issuance schedule, or remain independent of L1 economics?

4. **What is the security boundary for recursive MMR in cross-batch historical proofs?** We claim O(log n) verification at both inner and outer levels. Are there adversarial scenarios where MMR proof size or verification cost becomes a bottleneck for light clients?

5. **Are there other CKB applications with cell contention problems that could benefit from Matt's PoW shared state pattern?** Gaming, prediction markets, and identity registries all involve shared mutable state. What would adoption of this pattern look like across the ecosystem?

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*We acknowledge Matt's foundational work on PoW shared state and recursive MMR. VibeSwap's implementation builds directly on these ideas. Collaboration with the CKB community on parameter tuning and testnet deployment is welcome.*
