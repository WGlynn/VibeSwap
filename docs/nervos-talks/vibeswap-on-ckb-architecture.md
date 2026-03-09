# VibeSwap on CKB: Technical Architecture

**Authors**: W. Glynn, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research

---

## Abstract

VibeSwap is an omnichain DEX that eliminates Maximal Extractable Value (MEV) through commit-reveal batch auctions with uniform clearing prices. This paper describes the technical architecture of VibeSwap's deployment on Nervos CKB, a UTXO-extended blockchain with RISC-V programmability. We detail how the commit-reveal batch auction mechanism maps to CKB's Cell model, why the UTXO paradigm provides structural advantages for MEV resistance that account-based chains cannot replicate, and how CKB's RISC-V virtual machine enables verifiable execution of the Fisher-Yates shuffle over XORed user secrets. The implementation comprises 15 Rust crates, 9 on-chain scripts compiled to RISC-V binaries, a transaction-building SDK, a PoW mining client, and 190 passing tests including adversarial scenarios.

---

## 1. Cell Model Mapping

### 1.1 From EVM State to CKB Cells

On Ethereum, VibeSwap's `CommitRevealAuction.sol` maintains a single contract with storage slots for batch state, a mapping of user commits, and the accumulated XOR seed. Any address can call any function, paying gas for shared state access. On CKB, this monolithic contract decomposes into discrete cells, each with independent ownership and validation rules.

The architecture uses three cell categories:

**Shared State Cells (PoW-gated):**
- Auction Cell: one per trading pair, tracks batch lifecycle (phase, batch_id, MMR root, clearing price, difficulty target)
- Pool Cell: one per trading pair, tracks AMM reserves, TWAP accumulator, k-invariant

**Per-User Cells (zero contention):**
- Commit Cell: user's hidden order commitment, created independently
- LP Position Cell: user's liquidity position with entry price for IL tracking

**Singleton Cells (read-only dependencies):**
- Config Cell: protocol parameters (commit window, reveal window, slashing rate, circuit breaker thresholds)
- Compliance Cell: Merkle roots for blocked addresses and jurisdiction rules
- Oracle Cell: price feeds with confidence scores and source hashes

```
                    CKB Cell Architecture
  ============================================================

  SHARED STATE (PoW-Gated)         PER-USER (No Contention)
  +---------------------------+    +---------------------+
  | Auction Cell              |    | Commit Cell (Alice)  |
  | - phase: COMMIT           |    | - order_hash: 0xA3.. |
  | - batch_id: 42            |    | - batch_id: 42       |
  | - commit_mmr_root: 0x7F.. |    | - deposit: 100 CKB   |
  | - difficulty: 0x000F..    |    +---------------------+
  | - pair_id: ETH/CKB        |
  | [Lock: pow-lock]          |    +---------------------+
  | [Type: batch-auction-type] |    | Commit Cell (Bob)    |
  +---------------------------+    | - order_hash: 0xB7.. |
                                   | - batch_id: 42       |
  +---------------------------+    | - deposit: 200 CKB   |
  | Pool Cell                 |    +---------------------+
  | - reserve0: 1,000,000     |
  | - reserve1: 2,000,000     |    SINGLETONS (cell_dep)
  | - total_lp: 1,414,213     |    +---------------------+
  | - fee: 5 bps              |    | Config Cell          |
  | [Lock: pow-lock]          |    | - commit_window: 40  |
  | [Type: amm-pool-type]     |    | - slash_rate: 50%    |
  +---------------------------+    +---------------------+
```

### 1.2 State Machine as Cell Transitions

On Ethereum, the auction state machine operates through function calls that mutate contract storage. On CKB, each state transition is a transaction that consumes the current cell and produces a new cell with updated data. The type script validates that the transition is legitimate.

The batch lifecycle proceeds as:

```
  Batch Lifecycle (Cell Transitions)
  ============================================================

  [Auction Cell: COMMIT, batch=N]
         |
         | (miner aggregates commits, proves PoW)
         v
  [Auction Cell: COMMIT, batch=N, count=20]
         |
         | (phase timer expires → 40 blocks)
         v
  [Auction Cell: REVEAL, batch=N]
         |
         | (miner aggregates reveals, XORs secrets)
         v
  [Auction Cell: SETTLING, batch=N, seed=0xA7..]
         |
         | (miner executes shuffle + clearing price)
         v
  [Auction Cell: SETTLED, batch=N, price=2003.14]
         |
         | (new batch begins)
         v
  [Auction Cell: COMMIT, batch=N+1]
```

Each transition is validated by `batch-auction-type`, the type script compiled to RISC-V. It verifies: correct phase progression, valid commit hash format, matching reveal-to-commit hashes, correct Fisher-Yates shuffle output, and correct uniform clearing price calculation.

### 1.3 Lock/Type Separation

CKB's dual-script architecture cleanly separates authorization (who can update) from validation (what the update does):

- **Lock Script (`pow-lock`)**: Verifies that the transaction submitter has solved a SHA-256 proof-of-work puzzle at the required difficulty. This controls write access to shared cells. Args contain the pair_id and minimum difficulty.
- **Type Script (`batch-auction-type`)**: Validates that the state transition follows auction rules. It has no awareness of how the writer earned access.

This separation is fundamental. On Ethereum, access control and business logic are entangled in the same contract. If you can call the function, you can execute the logic. On CKB, earning the right to write (PoW) and the correctness of the write (type script) are independently verifiable.

---

## 2. UTXO vs Account Model for MEV Resistance

### 2.1 The Account Model Weakness

On Ethereum, contract storage is globally readable. When a user calls `commitOrder(hash)`, the transaction enters the public mempool. A MEV searcher can observe this transaction, decode its parameters, and submit a front-running transaction with higher gas. The victim's order is sandwiched. This is a direct consequence of account model properties: any address can read any storage slot, and transaction ordering is determined by gas price.

Even with encrypted mempools (threshold encryption, commit-reveal at the network level), the account model's shared mutable state means that the act of revealing creates a new MEV window. The validator processing reveals can reorder them.

### 2.2 The UTXO Model Advantage

CKB's Cell model inverts these properties:

**No shared mutable state.** A cell can only be consumed once. Two transactions cannot read-then-write the same cell. This means a front-runner cannot observe your commit and modify the auction state before your commit is included -- because modifying the auction state requires consuming the cell your commit targets, causing one of the two transactions to fail.

**Atomic cell consumption.** Either a transaction consumes its inputs and produces its outputs, or it fails entirely. There is no partial execution. A miner cannot insert a transaction between your commit and the auction update because they are the same transaction (the miner aggregates commits into the auction cell in a single atomic operation).

**Per-user state isolation.** Commit cells are created by individual users in their own transactions. There is zero contention. Nobody needs to compete for access to create a commit -- they just create their own cell. The contention point is the shared auction cell, and that is resolved by PoW, not by gas bidding.

### 2.3 Quantitative Comparison

| Property | EVM (Ethereum) | CKB (Cell Model) |
|---|---|---|
| State visibility | Global (anyone reads any slot) | Per-cell (explicit consumption) |
| Write access | Gas auction (speed + money) | PoW puzzle (computation only) |
| Transaction atomicity | Per-call (composable but exploitable) | Per-cell-set (atomic consumption) |
| Mempool exposure | Full (all params visible) | Commits are hashes (opaque by default) |
| Front-running surface | Entire mempool window | None (cell consumed atomically) |

---

## 3. RISC-V and Verifiable Shuffle

### 3.1 Why RISC-V Matters

CKB's virtual machine is CKB-VM, a RISC-V interpreter. Unlike the EVM's 256-bit stack machine with gas metering, RISC-V is a real CPU instruction set. This has three consequences for VibeSwap:

1. **No gas estimation errors.** Complex operations like Fisher-Yates shuffle over large batches have predictable execution costs. There are no surprises from EVM opcodes with variable gas costs.

2. **Standard cryptographic primitives.** SHA-256, the hash function used for PoW challenges, shuffle seed generation, and MMR construction, executes as native RISC-V instructions. No need for precompiles or EVM assembly tricks.

3. **Mature toolchain.** The Rust compiler targets `riscv64imac-unknown-none-elf` directly. VibeSwap's math library (`vibeswap-math`) compiles identically for tests on x86 and for deployment on CKB. Bit-for-bit parity is verified by `math_parity` tests.

### 3.2 Fisher-Yates Over XORed Secrets

The shuffle mechanism is critical to batch fairness. After all users reveal their orders and secrets, the execution order must be random but deterministic (anyone can verify it).

The implementation in `vibeswap-math::shuffle`:

1. **Seed generation**: XOR all user secrets, then hash with SHA-256 and the batch length. Optionally include block entropy from a future block for protection against last-revealer manipulation.

2. **Fisher-Yates shuffle**: Starting from index `n-1` down to `1`, hash the current seed with the index to produce a random value, compute `j = hash mod (i+1)`, and swap positions `i` and `j`. This produces a uniform random permutation.

3. **On-chain verification**: The type script receives the claimed shuffle indices in the settlement transaction witness, recomputes the shuffle from the XOR seed stored in the auction cell, and rejects the transaction if they don't match. This is a pure function -- given the same seed, any RISC-V execution produces the same output.

```
  Shuffle Verification (Type Script)
  ============================================================

  Input:  AuctionCell { xor_seed: 0xA7B3..., commit_count: 20 }
  Witness: [claimed_indices: [7, 13, 2, 19, 0, ...]]

  Type script computes:
    expected = fisher_yates_shuffle(20, xor_seed)

  If claimed_indices != expected → REJECT TRANSACTION
  If claimed_indices == expected → ACCEPT
```

The RISC-V target ensures this verification executes correctly regardless of batch size, with no EVM stack depth limits or gas ceiling concerns.

---

## 4. Codebase Structure

The CKB implementation is a Rust workspace with 15 crates:

```
ckb/
├── Cargo.toml                          # Workspace: 15 members
├── schemas/cells.mol                   # Molecule serialization schemas
├── lib/
│   ├── vibeswap-math/                  # BatchMath, Shuffle, TWAP (994 lines)
│   ├── mmr/                            # Recursive MMR accumulator (579 lines)
│   ├── pow/                            # PoW verification + difficulty (451 lines)
│   └── types/                          # Shared cell types (871 lines)
├── scripts/
│   ├── pow-lock/                       # PoW lock script (RISC-V binary)
│   ├── batch-auction-type/             # Auction state machine
│   ├── commit-type/                    # Commit cell validation
│   ├── amm-pool-type/                  # AMM pool validation
│   ├── lp-position-type/               # LP position tracking
│   ├── compliance-type/                # Compliance registry
│   ├── config-type/                    # Protocol config
│   ├── oracle-type/                    # Price feeds
│   └── knowledge-type/                 # Knowledge cells
├── sdk/                                # Transaction builder + miner
├── deploy/                             # Deployment tooling
└── tests/                              # Integration, adversarial, fuzz, math parity
```

All 9 scripts compile to RISC-V via `riscv64imac-unknown-none-elf` with `no_std` (no standard library). The `opt-level = "s"` profile minimizes binary size for on-chain deployment. Overflow checks remain enabled (`overflow-checks = true`) for safety.

---

## 5. Key Contributions

1. **Complete Cell Model mapping** of commit-reveal batch auctions, decomposing monolithic EVM state into shared, per-user, and singleton cells with independent access control.

2. **Lock/type separation** that cleanly isolates PoW-based write access from auction logic validation, creating independent and composable security layers.

3. **RISC-V verifiable shuffle** where the Fisher-Yates permutation over XORed user secrets is computed and verified entirely on-chain in CKB-VM, with bit-for-bit parity to the x86 test suite.

4. **Production-ready implementation**: 15 Rust crates, 9 RISC-V binaries, Molecule serialization schemas, a transaction-building SDK with 9 operation types, a PoW mining client, and 190 passing tests including adversarial scenarios.

5. **Structural MEV elimination** through the combination of UTXO atomicity, PoW write gating, commit opacity, and uniform clearing -- properties that emerge from CKB's architecture rather than being bolted on.

---

*VibeSwap is open source. Technical questions and collaboration proposals are welcome.*
