# VibeSwap on Nervos: A Proposal for MEV-Resistant Decentralized Exchange Infrastructure

**Community Proposal for VibeSwap Integration with Nervos Network (CKB)**

---

## Dear Nervos Community,

We are excited to present VibeSwap—an omnichain decentralized exchange protocol that we believe represents a natural evolution for the Nervos ecosystem. After studying Nervos's architecture extensively, we've found remarkable alignment between our security philosophy and Nervos's foundational design principles.

More importantly, we've realized something that strengthens this proposal significantly: **VibeSwap's batch auction model isn't just MEV protection—it's architecturally optimal for UTXO-based chains like CKB.** Our design solves the state contention problem that plagues other DEX implementations on UTXO models.

We respectfully submit this proposal to adapt VibeSwap to run natively on CKB, with L1 serving as the verification layer and an L2 coordinator handling batch aggregation—exactly as Nervos intended.

---

## Executive Summary

VibeSwap is a **commit-reveal batch auction DEX** that eliminates Maximal Extractable Value (MEV) through cryptographic ordering and uniform price clearing. Rather than continuous execution where arbitrageurs profit from transaction ordering, VibeSwap settles all trades in discrete batches at a single fair price—making frontrunning and sandwich attacks mathematically impossible.

We propose a **layered architecture**:
- **L2 Batch Coordinator**: Aggregates orders, computes clearing prices, constructs settlement transactions
- **L1 CKB Verification**: Validates all state transitions, enforces protocol rules, provides settlement finality

This design leverages CKB's "Universal Verification Layer" philosophy while solving the UTXO contention problem that makes naive DEX implementations impractical.

---

## A Paradigm Shift in Price Discovery

### The Problem with Continuous Execution

Traditional DEXs like Uniswap operate on continuous execution: each trade immediately affects price, creating a race where milliseconds determine profit. This model has a fundamental flaw—**whoever controls transaction ordering controls value extraction**. MEV has extracted over $1.5 billion from users since 2020, representing a hidden tax on every trade.

### VibeSwap's Solution: Asynchronous Batch Auctions

VibeSwap introduces **discrete-time price discovery**:

```
┌─────────────────────────────────────────────────────────────┐
│                    10-Second Batch Cycle                     │
├─────────────────────────────────────┬───────────────────────┤
│         Commit Phase (8s)           │   Reveal Phase (2s)   │
│                                     │                       │
│  Users submit: hash(order||secret)  │  Users reveal orders  │
│  Order details remain hidden        │  + optional priority  │
│  No one knows market direction      │    bids for LPs       │
└─────────────────────────────────────┴───────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Settlement                              │
│                                                              │
│  1. All secrets XORed → deterministic shuffle seed          │
│  2. Fisher-Yates shuffle with combined randomness           │
│  3. ALL orders execute at SINGLE clearing price             │
│  4. Priority bid proceeds → distributed to LPs              │
└─────────────────────────────────────────────────────────────┘
```

**The result**: No transaction can be frontrun because order contents are hidden during commitment. No sandwich attacks are possible because all trades clear at the same price. Priority is determined by cryptographic fairness, not validator collusion.

This represents a **paradigm shift** from "fastest wins" to "fairest wins."

---

## Why Batch Auctions Are Optimal for UTXO Chains

### The State Contention Problem

UTXO-based models like CKB's Cell model have a fundamental constraint: **a cell can only be consumed once per block**. For DEXs, this creates a serious problem:

```
Traditional DEX on UTXO (The Problem):
──────────────────────────────────────

    Trade 1 ──┐
    Trade 2 ──┼──► ALL compete to consume same pool cell
    Trade 3 ──┤
    Trade N ──┘
                        │
                        ▼
              Only ONE succeeds per block
              N-1 transactions FAIL

    Result: Unusable throughput for any popular trading pair
```

An AMM pool is shared state—every trader wants to swap against the same liquidity. In a naive UTXO implementation, only one trade can succeed per block because consuming the pool cell invalidates all other pending transactions.

### How VibeSwap Solves This

VibeSwap's batch model **eliminates contention by design**:

```
VibeSwap on UTXO (The Solution):
────────────────────────────────

COMMIT PHASE - Zero Contention:
┌─────────────────────────────────────────────────────────┐
│  User 1 ──► Creates own Commitment Cell (independent)   │
│  User 2 ──► Creates own Commitment Cell (independent)   │
│  User 3 ──► Creates own Commitment Cell (independent)   │
│  User N ──► Creates own Commitment Cell (independent)   │
│                                                         │
│  No shared state touched. All succeed in parallel.      │
└─────────────────────────────────────────────────────────┘

REVEAL PHASE - Zero Contention:
┌─────────────────────────────────────────────────────────┐
│  User 1 ──► Reveals to own cell (independent)           │
│  User 2 ──► Reveals to own cell (independent)           │
│  User N ──► Reveals to own cell (independent)           │
│                                                         │
│  Or: Submit reveals directly to L2 coordinator          │
└─────────────────────────────────────────────────────────┘

SETTLEMENT - Single Atomic Transaction:
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ONE transaction consumes:                              │
│    • All N order commitment cells                       │
│    • Pool liquidity cell                                │
│                                                         │
│  ONE transaction creates:                               │
│    • New pool cell (updated reserves)                   │
│    • N user balance cells (trade outputs)               │
│                                                         │
│  N trades = 1 pool cell update (not N!)                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**The key insight**: Users never race for the same cell. They create independent commitment cells, then a single atomic settlement transaction touches shared state once per batch.

| Metric | Traditional DEX on UTXO | VibeSwap on UTXO |
|--------|-------------------------|------------------|
| Trades per block | 1 per pair | Unlimited (batched) |
| Pool cell updates | 1 per trade | 1 per batch |
| Transaction failures | N-1 per N attempts | Near zero |
| State contention | Severe | Eliminated |

**VibeSwap doesn't fight the UTXO model—it leverages it.**

---

## Layered Architecture: L1 Verification, L2 Coordination

CKB is designed as a "Universal Verification Layer"—computation happens off-chain, verification on-chain. We embrace this fully with an explicit L1/L2 split:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L2: BATCH COORDINATOR NETWORK                    │
│                                                                      │
│  Responsibilities:                                                   │
│  ─────────────────                                                   │
│  • Monitor L1 for new commitment cells                              │
│  • Manage batch timing (8s commit window, 2s reveal window)         │
│  • Collect reveal witnesses from users (P2P or direct submission)   │
│  • Compute clearing price off-chain                                 │
│  • Execute deterministic shuffle algorithm                          │
│  • Construct settlement transaction                                 │
│  • Submit settlement to L1 for verification                         │
│                                                                      │
│  Decentralization Options:                                          │
│  ─────────────────────────                                          │
│  • Rotating coordinator set (similar to sequencer rotation)         │
│  • Coordinator auction (bid for right to settle batches)            │
│  • Threshold signature committee                                    │
│  • Single coordinator + fraud proofs (optimistic)                   │
│                                                                      │
│  Trust Assumption: Liveness only (can't steal or manipulate)        │
│  └─► L1 verification catches any invalid settlements                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                   Settlement Transaction
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     L1: CKB VERIFICATION LAYER                       │
│                                                                      │
│  Lock Scripts Verify:                                               │
│  ────────────────────                                               │
│  ✓ Commitment hash matches revealed order (preimage check)          │
│  ✓ Reveal occurred within valid time window                         │
│  ✓ User signature authorizes the order                              │
│  ✓ Deposit amount matches commitment                                │
│                                                                      │
│  Type Scripts Verify:                                               │
│  ────────────────────                                               │
│  ✓ Clearing price satisfies ALL limit orders in batch               │
│  ✓ Deterministic shuffle computed correctly (XOR secrets → seed)    │
│  ✓ Output balances are mathematically correct                       │
│  ✓ Pool invariant maintained (x × y = k)                            │
│  ✓ Protocol fees calculated correctly                               │
│  ✓ No tokens created or destroyed (conservation)                    │
│                                                                      │
│  Security Guarantee:                                                │
│  ───────────────────                                                │
│  L1 doesn't trust L2 computation—it VERIFIES everything.            │
│  Invalid settlement = transaction rejected. Funds safe.             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Concern | Solution |
|---------|----------|
| L2 coordinator goes offline | Users can reclaim commitments after timeout (L1 enforced) |
| L2 submits wrong clearing price | L1 Type Script rejects—mathematically verified |
| L2 manipulates shuffle order | L1 verifies shuffle matches XORed secrets—deterministic |
| L2 steals funds | Impossible—L1 verifies all balance outputs |
| L2 censors specific users | Their commitment cells exist on L1—visible censorship |

**The L2 coordinator has no power to steal or manipulate**—only to delay (liveness). And even liveness failures are bounded by L1 timeout mechanisms.

---

## Stateless Verification: Eliminating Global State Cells

A subtle but important optimization: we make L1 verification **stateless** where possible, avoiding another contention point.

### Problem: Global Batch State Cell

A naive design might have a global "batch controller" cell tracking current phase:

```
❌ BAD: Global Batch State Cell
──────────────────────────────
┌─────────────────────────────┐
│  Global Batch Controller    │  ◄── Every commit/reveal must
│  - current_batch_id: 1234   │      touch this cell
│  - phase: Commit            │      = CONTENTION
│  - phase_end_block: 50000   │
└─────────────────────────────┘
```

### Solution: Self-Describing Commitment Cells

Instead, each commitment cell carries its own timing context:

```
✓ GOOD: Stateless Verification
──────────────────────────────
┌─────────────────────────────────────────────────────────────┐
│  Commitment Cell (self-describing)                          │
│  ─────────────────────────────────                          │
│  Data:                                                      │
│    commitment_hash: bytes32                                 │
│    batch_start_block: u64    ◄── When THIS batch started    │
│    pair_id: bytes32                                         │
│    deposit: u128                                            │
│                                                             │
│  Lock Script Logic:                                         │
│  ──────────────────                                         │
│  // Note: "reference_block" comes from header_deps—CKB      │
│  // doesn't have a "current block" global. Instead, we      │
│  // include a recent block header as a dependency and       │
│  // verify elapsed time against that proven reference.      │
│                                                             │
│  fn can_reveal(cell, reference_block) -> bool {             │
│      let elapsed = reference_block - cell.batch_start_block;│
│      // Reveal window: blocks 8-10 of batch                 │
│      elapsed >= COMMIT_BLOCKS &&                            │
│      elapsed < COMMIT_BLOCKS + REVEAL_BLOCKS                │
│  }                                                          │
│                                                             │
│  fn can_reclaim(cell, reference_block) -> bool {            │
│      let elapsed = reference_block - cell.batch_start_block;│
│      // Reclaim after batch expires (safety valve)          │
│      elapsed >= BATCH_TOTAL_BLOCKS + GRACE_PERIOD           │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘

No global state cell needed for phase tracking!
Each cell knows its own timing. Pure UTXO elegance.
```

### Pool State: Updated Once Per Batch

The only shared state is the liquidity pool cell—and it's only touched once per batch:

```
┌─────────────────────────────────────────────────────────────┐
│  Liquidity Pool Cell                                        │
│  ───────────────────                                        │
│  Data:                                                      │
│    reserve_a: u128          # Token A balance               │
│    reserve_b: u128          # Token B balance               │
│    total_lp_shares: u128    # Outstanding LP tokens         │
│    last_batch_id: u64       # Replay protection             │
│    cumulative_volume: u128  # For fee calculations          │
│                                                             │
│  Type Script: PoolType                                      │
│    ✓ Verifies x × y = k (with fees)                        │
│    ✓ Verifies batch_id increments (no replay)              │
│    ✓ Verifies all input orders are from this batch         │
│                                                             │
│  Contention: ONE update per batch                           │
│  └─► 100 trades in batch = 1 pool update, not 100          │
└─────────────────────────────────────────────────────────────┘
```

---

## Philosophical Alignment with Nervos

We didn't choose Nervos arbitrarily. After evaluating multiple Layer 1 platforms, we found that Nervos's design philosophy mirrors our own at a fundamental level.

### 1. Verification Over Computation

**Nervos's Approach**: CKB is explicitly designed as a "Universal Verification Layer"—computation happens off-chain, while the blockchain focuses on validation. As your documentation states: *"In Nervos CKB, all the states are stored in Cells, all computation is done off-chain, and all the verification work is handled by nodes."*

**VibeSwap's Parallel**: Our L1/L2 architecture embodies identical principles:
- **L2 computes**: Clearing prices, shuffle order, settlement construction
- **L1 verifies**: Hashes match, math is correct, invariants hold

This isn't coincidence—it's convergent design evolution toward the same truth: **blockchains should verify, not compute**.

### 2. Immutable State Transitions

**Nervos's Cell Model**: Cells are immutable. Updates require consuming existing cells and creating new ones with modified data. This consumption model provides strong guarantees about state integrity.

**VibeSwap's Batch Model**: Similarly, our batches are immutable state transitions:
- Each batch is an atomic unit—it either settles completely or not at all
- Orders, once revealed, cannot be modified
- The clearing price, once computed, is final
- Consumed commitment cells → new balance cells

The Cell model's "Live Cell → Dead Cell" lifecycle maps elegantly to our "Pending Order → Executed Order" state machine.

### 3. First-Class Asset Security

**Nervos's Guarantee**: *"All assets—including user-defined tokens and NFTs—are treated as first-class citizens. Token contracts only store operating logic, while asset records are stored in cells controlled directly by users."*

**VibeSwap's Implementation**: We maintain the same separation:
- Users retain custody of assets in their own commitment cells
- Even if L2 coordinator is malicious, funds remain in user-controlled cells
- L1 Lock Scripts ensure only valid settlements can consume order cells
- No "approve unlimited" attack surface

### 4. Parallel Execution

**Nervos's Architecture**: *"In Cell Model, smart contract execution is parallel. Each transaction runs independently in its own virtual machine; multiple virtual machines run simultaneously."*

**VibeSwap's Design**: Our batch auction model is inherently parallelizable:
- Multiple trading pairs run independent batch cycles simultaneously
- ETH/USDC settlement doesn't block BTC/USDC settlement
- Each pair's pool cell is independent—no cross-pair contention
- L2 coordinators can be pair-specific or unified

### 5. Cryptographic Flexibility

**Nervos's Philosophy**: *"Cryptographic primitives aren't hardcoded or baked into the virtual machine like in all other blockchains, making CKB the most flexible and future-proof Layer 1."*

**VibeSwap's Commitment**: Our protocol is signature-scheme agnostic:
- Commitment hashes can use any collision-resistant function
- Order signatures work with any CKB-supported authentication
- Users could choose Schnorr, secp256k1, or post-quantum signatures

On CKB, we could offer **user-selectable cryptography**—traders choose their preferred schemes, all within the same batch.

---

## Technical Implementation Details

### Cell Structures

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ORDER COMMITMENT CELL                           │
├─────────────────────────────────────────────────────────────────────┤
│  Capacity: [deposit in CKBytes]                                     │
│                                                                      │
│  Data (48 bytes):                                                   │
│    commitment_hash: [u8; 32]    # hash(order || secret)             │
│    batch_start_block: u64       # Batch timing anchor               │
│    pair_id_hash: [u8; 8]        # Trading pair identifier           │
│                                                                      │
│  Lock Script: VibeSwapCommitLock                                    │
│    code_hash: [vibeswap_commit_lock_hash]                           │
│    args: [user_pubkey_hash]     # Owner's public key hash           │
│                                                                      │
│    Unlock conditions (OR):                                          │
│      1. Valid reveal witness + in reveal window                     │
│      2. Batch expired + owner signature (reclaim)                   │
│                                                                      │
│  Type Script: VibeSwapOrderType                                     │
│    code_hash: [vibeswap_order_type_hash]                            │
│    args: [pair_id]                                                  │
│                                                                      │
│    Validates:                                                       │
│      • Commitment format is correct                                 │
│      • Deposit meets minimum for pair                               │
│      • batch_start_block is valid batch boundary                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      LIQUIDITY POOL CELL                             │
├─────────────────────────────────────────────────────────────────────┤
│  Capacity: [protocol minimum]                                       │
│                                                                      │
│  Data:                                                              │
│    reserve_a: u128              # Token A reserves                  │
│    reserve_b: u128              # Token B reserves                  │
│    total_lp_shares: u128        # Outstanding LP tokens             │
│    last_batch_id: u64           # Replay protection                 │
│    fee_accumulator: u128        # Unclaimed protocol fees           │
│    twap_accumulator: u256       # Time-weighted price data          │
│    last_update_block: u64       # TWAP timing                       │
│                                                                      │
│  Lock Script: VibeSwapPoolLock                                      │
│    Unlock conditions:                                               │
│      • Valid batch settlement transaction                           │
│      • All Type Script validations pass                             │
│                                                                      │
│  Type Script: VibeSwapPoolType                                      │
│    Validates on consumption:                                        │
│      ✓ x × y = k invariant (with fee adjustment)                   │
│      ✓ batch_id increments by exactly 1                            │
│      ✓ All input orders belong to this batch                       │
│      ✓ Clearing price satisfies all limit orders                   │
│      ✓ Output balances computed correctly                          │
│      ✓ TWAP accumulator updated correctly                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Lock Script: Commit-Reveal Enforcement

```rust
// Pseudo-Rust for CKB-VM RISC-V binary

fn main() -> i8 {
    let script = load_script();
    let args = script.args();  // user_pubkey_hash

    // Load current cell being unlocked
    let cell = load_cell_data(0, Source::GroupInput);
    let commitment = parse_commitment(&cell);

    // Check which unlock path
    let witness = load_witness(0, Source::GroupInput);

    match witness.unlock_type {
        UnlockType::Reveal => verify_reveal(&commitment, &witness, &args),
        UnlockType::Reclaim => verify_reclaim(&commitment, &witness, &args),
    }
}

fn verify_reveal(commitment: &Commitment, witness: &Witness, owner: &[u8]) -> i8 {
    // 1. Verify we're in reveal window
    // Use header_deps to get a provable reference block (CKB has no "current block" global)
    let reference_block = load_header(0, Source::HeaderDep).number();
    let elapsed = reference_block - commitment.batch_start_block;

    if elapsed < COMMIT_BLOCKS || elapsed >= COMMIT_BLOCKS + REVEAL_BLOCKS {
        return ERROR_WRONG_PHASE;
    }

    // 2. Verify revealed order matches commitment
    let revealed_hash = blake2b(&[&witness.order, &witness.secret].concat());
    if revealed_hash != commitment.commitment_hash {
        return ERROR_HASH_MISMATCH;
    }

    // 3. Verify order is well-formed
    if !validate_order_format(&witness.order) {
        return ERROR_INVALID_ORDER;
    }

    // 4. Signature checked by settlement Type Script (aggregated)

    SUCCESS
}

fn verify_reclaim(commitment: &Commitment, witness: &Witness, owner: &[u8]) -> i8 {
    // 1. Verify batch has expired (with grace period)
    let reference_block = load_header(0, Source::HeaderDep).number();
    let elapsed = reference_block - commitment.batch_start_block;

    if elapsed < BATCH_TOTAL_BLOCKS + GRACE_PERIOD {
        return ERROR_BATCH_NOT_EXPIRED;
    }

    // 2. Verify owner signature
    let message = ["RECLAIM", &commitment.commitment_hash].concat();
    if !verify_signature(&message, &witness.signature, owner) {
        return ERROR_INVALID_SIGNATURE;
    }

    SUCCESS
}
```

### Type Script: Batch Settlement Validation

```rust
fn main() -> i8 {
    // This runs once for all cells with this Type Script in the transaction

    // 1. Gather all order inputs
    let orders: Vec<RevealedOrder> = collect_order_inputs();
    if orders.is_empty() {
        return ERROR_NO_ORDERS;
    }

    // 2. Load pool input and output
    let pool_in = load_pool_cell(Source::Input);
    let pool_out = load_pool_cell(Source::Output);

    // 3. Verify batch ID increments
    if pool_out.last_batch_id != pool_in.last_batch_id + 1 {
        return ERROR_INVALID_BATCH_ID;
    }

    // 4. Verify deterministic shuffle
    let combined_secret = orders.iter()
        .map(|o| o.secret)
        .fold([0u8; 32], |acc, s| xor_bytes(&acc, &s));

    let expected_order = fisher_yates_shuffle(&orders, &combined_secret);
    // (Settlement must process in this order for verification)

    // 5. Compute and verify clearing price
    let clearing_price = compute_clearing_price(&orders, &pool_in);

    for order in &orders {
        if !order.limit_price.satisfied_by(clearing_price) {
            return ERROR_LIMIT_NOT_SATISFIED;
        }
    }

    // 6. Verify pool reserves update correctly
    let (expected_reserve_a, expected_reserve_b) =
        apply_batch_to_pool(&pool_in, &orders, clearing_price);

    if pool_out.reserve_a != expected_reserve_a ||
       pool_out.reserve_b != expected_reserve_b {
        return ERROR_INVALID_RESERVES;
    }

    // 7. Verify x * y = k (with fees)
    let k_before = pool_in.reserve_a * pool_in.reserve_b;
    let k_after = pool_out.reserve_a * pool_out.reserve_b;

    if k_after < k_before {  // k can only increase (fees)
        return ERROR_INVARIANT_VIOLATION;
    }

    // 8. Verify output cells for users
    verify_user_outputs(&orders, clearing_price)
}
```

### Leveraging CKB-VM's RISC-V Foundation

Because CKB-VM executes standard RISC-V binaries, we can:

1. **Port our Rust libraries directly** - `DeterministicShuffle`, `BatchMath`, `TruePriceLib` compile to RISC-V
2. **Use audited cryptographic libraries** - Standard Rust crypto crates work natively
3. **Maintain identical security properties** - Same algorithms, same guarantees
4. **Enable formal verification** - RISC-V has mature verification tooling
5. **Optimize with existing tools** - LLVM backend, standard profilers

---

## Security Design Alignment

### Defense in Depth

| Security Layer | Nervos Approach | VibeSwap Implementation |
|----------------|-----------------|-------------------------|
| Consensus | NC-MAX PoW (Bitcoin-derived) | Batch finality inherits CKB consensus |
| State Integrity | Immutable Cells + consumption model | Immutable batches + atomic settlement |
| Asset Safety | User-controlled cells | User-controlled commitment cells until settlement |
| Replay Protection | Cell consumption = one-time use | batch_id increment + cell consumption |
| Cryptographic Agility | Script-defined primitives | Pluggable hash/signature schemes |
| Liveness | PoW block production | L1 timeout reclaim + coordinator rotation |

### L2 Coordinator Security Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COORDINATOR THREAT MODEL                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  What coordinator CAN do:          What coordinator CANNOT do:       │
│  ─────────────────────────         ───────────────────────────       │
│  • Delay batch settlement          • Steal user funds                │
│  • Go offline                      • Manipulate clearing price       │
│  • Refuse to include orders        • Change shuffle ordering         │
│    (visible censorship)            • Forge user signatures           │
│                                    • Violate pool invariant          │
│                                    • Create tokens from nothing      │
│                                                                      │
│  Mitigation for liveness:          Why theft is impossible:          │
│  ─────────────────────────         ─────────────────────────         │
│  • Timeout reclaim on L1           • L1 verifies ALL math            │
│  • Coordinator rotation            • Shuffle seed = XOR of secrets   │
│  • Multiple competing coordinators • Signatures required in witness  │
│  • Fraud proofs for misbehavior    • Type Script checks everything   │
│                                                                      │
│  Trust assumption: LIVENESS ONLY                                     │
│  Security assumption: NONE (fully verified)                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Circuit Breakers

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CIRCUIT BREAKER CELL                              │
├─────────────────────────────────────────────────────────────────────┤
│  Data:                                                              │
│    volume_window: [(block, amount); 6]  # Rolling 1-hour window     │
│    price_history: [(block, price); 10]  # Recent prices             │
│    status: Active | Paused | Cooldown                               │
│    pause_until_block: u64                                           │
│                                                                      │
│  Type Script validates:                                             │
│    • Volume threshold: Pause if > $10M/hour                         │
│    • Price threshold: Pause if > 50% deviation from TWAP            │
│    • Auto-resume after cooldown period                              │
│                                                                      │
│  Settlement MUST include circuit breaker cell                       │
│  └─► Atomic: breaker triggers = settlement fails                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Benefits to the Nervos Ecosystem

### 1. Proof That UTXO DEXs Can Work
VibeSwap demonstrates that the Cell model isn't a limitation for DeFi—it's an advantage when paired with the right architecture. This validates Nervos's design choices.

### 2. MEV-Free Trading Infrastructure
Nervos users deserve trading infrastructure that doesn't extract value from them. VibeSwap ensures every trader gets fair execution.

### 3. Showcase for L1/L2 Design Pattern
Our architecture is a reference implementation of "L1 verification, L2 computation"—exactly what Nervos advocates. Other projects can learn from this pattern.

### 4. RGB++ Synergy
With Nervos's RGB++ protocol enabling Bitcoin asset issuance, VibeSwap provides the natural trading venue—MEV-free BTC/RGB++ token swaps.

### 5. DeFi Ecosystem Foundation
Every DeFi ecosystem needs reliable exchange infrastructure. VibeSwap can serve as the foundation for lending protocols, derivatives, and yield strategies on CKB.

### 6. Cross-Chain Liquidity (Future)
Our LayerZero V2 experience positions us to eventually connect CKB liquidity with other chains, bringing volume and users to Nervos.

---

## Development Roadmap

### Phase 1: Research & Architecture
- Deep dive into CKB-VM cycle optimization
- Formal specification of L1/L2 protocol
- Coordinator decentralization design
- Security model documentation
- Community feedback incorporation

### Phase 2: L1 Script Implementation
- Lock Script: Commit-reveal enforcement
- Type Script: Batch settlement validation
- Type Script: Pool invariant checking
- RISC-V port of cryptographic libraries
- Comprehensive on-chain test suite

### Phase 3: L2 Coordinator
- Basic coordinator implementation
- P2P reveal collection
- Settlement transaction construction
- Coordinator rotation mechanism
- Monitoring and alerting

### Phase 4: Testnet & Audit
- Testnet deployment
- Community testing program
- Independent security audit (L1 scripts)
- Independent security audit (L2 coordinator)
- Performance optimization

### Phase 5: Mainnet Launch
- Phased mainnet rollout
- Initial liquidity bootstrapping
- Documentation and SDK release
- Coordinator decentralization

---

## Our Ask

We're not here for funding. We're here to build open source infrastructure for the betterment of decentralized finance.

What we'd value:

1. **Community Feedback** - Technical review of this architecture, especially from developers experienced with CKB Script optimization

2. **Ecosystem Collaboration** - Introductions to RGB++ teams and other CKB projects for integration discussions

3. **Technical Guidance** - Best practices for CKB-VM cycle optimization, especially for cryptographic operations

4. **Shared Mission** - Partners who believe that fair, MEV-resistant infrastructure should be a public good

All VibeSwap code will be open source. We believe critical financial infrastructure should be transparent, auditable, and owned by no one.

---

## Conclusion

VibeSwap and Nervos share a vision: **infrastructure that serves users, not extracts from them**.

Nervos built a verification layer that respects user sovereignty and embraces the UTXO model's strengths. VibeSwap built an exchange mechanism where batch auctions aren't just MEV protection—they're architecturally optimal for exactly this kind of chain.

We're not trying to force an account-model DEX onto a UTXO chain. We're building a DEX that **belongs** on a UTXO chain. The batch model eliminates state contention. The L1/L2 split honors CKB's verification-layer philosophy. The security model assumes nothing about L2—everything is verified on L1.

We believe fair price discovery is a human right, not a premium feature. MEV-resistant infrastructure should be a public good—open source, transparent, and available to everyone. We're not building a product to extract value. We're building infrastructure to prevent extraction.

This is what DEX infrastructure should look like on Nervos. We look forward to building it together.

---

**Respectfully submitted,**

The VibeSwap Team

---

## References & Further Reading

- [Nervos Network Overview](https://www.nervos.org/knowledge-base/nervos_overview_of_a_layered_blockchain)
- [CKB-VM Introduction](https://medium.com/nervosnetwork/an-introduction-to-ckb-vm-9d95678a7757)
- [Cell Model: A Generalized UTXO](https://medium.com/nervosnetwork/the-cell-model-a-generalized-utxo-model-2da32248b0a0)
- [CKB Script Programming: Validation Model](https://medium.com/nervosnetwork/intro-to-ckb-script-programming-1-validation-model-9a7d84679266)
- [Understanding Nervos Network - Messari](https://messari.io/report/understanding-nervos-network)
- [What is CKB-VM? - Start With Nervos](https://startwithnervos.com/nervos-faq/what-is-the-ckb-vm)
- [VibeSwap Technical Documentation](./docs/VIBESWAP_COMPLETE_MECHANISM_DESIGN.md)
- [VibeSwap Security Mechanism Design](./docs/SECURITY_MECHANISM_DESIGN.md)

---

*This proposal is submitted in the spirit of open collaboration. We welcome all feedback, questions, and suggestions from the Nervos community.*
