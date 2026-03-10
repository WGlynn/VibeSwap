# CKB DeFi Primitives: What the Cell Model Makes Native

**Authors**: W. Glynn, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research

---

## Abstract

The Nervos CKB Cell model is often described as "harder to build DeFi on" compared to EVM's account model. We argue the opposite: CKB enables a class of DeFi primitives that are native to its architecture but difficult, expensive, or impossible on account-based chains. This paper catalogs seven such primitives -- native HTLC via cells, multi-asset cells, type script validation for arbitrary token standards, data-rich cells for on-chain order books, cross-chain atomic swaps via CKB light clients, PoW-gated shared state, and self-custodial LP positions. For each primitive, we describe the mechanism, provide the CKB implementation pattern, and compare against the EVM equivalent. VibeSwap's CKB deployment uses all seven, demonstrating that the Cell model is not a constraint on DeFi but an enabler of DeFi designs that account-based chains cannot support.

---

## 1. Native HTLC via Cells

### 1.1 The Primitive

A Hash Time-Locked Contract (HTLC) is the foundation of trustless cross-chain swaps. Party A locks funds with a hash lock (requiring preimage knowledge) and a time lock (allowing refund after timeout). Party B claims by revealing the preimage, or A reclaims after the timeout.

### 1.2 CKB Implementation

On CKB, an HTLC is a lock script on a cell:

```
Lock Script:
  code_hash: htlc_lock_code_hash
  args: recipient_lock_hash || sender_lock_hash || payment_hash || timeout_block
```

The lock script checks two conditions:
1. If the witness contains a preimage whose SHA-256 matches `payment_hash` and the transaction is signed by `recipient_lock_hash`, allow consumption.
2. If the current block number exceeds `timeout_block` and the transaction is signed by `sender_lock_hash`, allow refund.

This is a single cell with a single lock script. No contract deployment. No state management. No re-entrancy concerns. The HTLC exists as long as the cell exists, and is consumed atomically when claimed or refunded.

### 1.3 EVM Comparison

On Ethereum, HTLCs require deploying a smart contract that stores the hash lock, time lock, and participants in storage slots. The contract must be funded with a separate transaction. Claiming requires a transaction that calls `claim(preimage)`, which reads storage, verifies the hash, and transfers funds. The contract persists as dead state after completion. Gas costs scale with storage reads and writes. Re-entrancy guards are required.

**CKB advantage**: Zero-overhead HTLC with no contract deployment, no persistent state, and no re-entrancy surface. The HTLC is born as a cell and dies when consumed. The blockchain does not retain dead state.

---

## 2. Multi-Asset Cells

### 2.1 The Primitive

A single CKB cell can contain native CKB capacity, one or more xUDT (User Defined Token) balances in its data field, and arbitrary additional data. The cell is a container for heterogeneous state.

### 2.2 CKB Implementation

VibeSwap's LP position cells demonstrate this:

```
Cell:
  capacity: 300 CKB
  lock: user's lock script
  type: lp-position-type
  data: [
    lp_amount:    u128,    // LP token balance
    entry_price:  u128,    // TWAP at deposit time
    pool_id:      [u8;32], // Which pool
    deposit_block: u64     // When deposited
  ]
```

A single cell contains the LP balance, the reference price for impermanent loss calculation, the pool identifier, and the deposit timestamp. All are read and written atomically. There is no separate ERC-20 balance mapping, no separate metadata contract, and no cross-contract call to check the deposit block.

### 2.3 EVM Comparison

On Ethereum, an LP position typically involves:
- An ERC-20 LP token contract (separate deployment, separate state)
- A staking contract that records the deposit block (another deployment, another state)
- A price oracle query to get entry price (cross-contract call)
- Three separate storage reads across three contracts to reconstruct a user's position

**CKB advantage**: A single cell encapsulates the entire LP position. Reading it requires one cell lookup, not three contract calls. Updating it is one cell transition. The composability is structural, not contractual.

---

## 3. Type Script Validation for Arbitrary Token Standards

### 3.1 The Primitive

CKB's type script is validation logic that runs when a cell is created or consumed. Unlike EVM contracts (which define both state and logic), type scripts are pure validation -- they accept or reject a transaction but do not store state themselves. This makes them composable: any cell can use any type script as long as it satisfies the validation rules.

### 3.2 CKB Implementation

VibeSwap supports any xUDT-compatible token without modification. The AMM pool type script validates:
- Token conservation (inputs token amounts equal outputs token amounts minus fees)
- k-invariant maintenance (reserve0 * reserve1 >= k_last)
- TWAP accumulator update

It references token cells by their type script hash, not by a hardcoded ERC-20 address. A new token standard that conforms to xUDT's data layout works with VibeSwap immediately. No governance vote. No whitelist. No proxy upgrade.

### 3.3 EVM Comparison

On Ethereum, a DEX must integrate specific token standards. ERC-20 tokens work. ERC-777 tokens introduced re-entrancy vectors that caused Uniswap V1 exploits. Fee-on-transfer tokens break constant product invariant assumptions. Rebasing tokens require wrapper contracts. Each non-standard token requires explicit integration.

**CKB advantage**: Type script validation is orthogonal to the cell's content. VibeSwap's pool validates token conservation via cell data arithmetic, not by calling external token contracts. A token's type script validates its own rules; VibeSwap's type script validates AMM rules. Neither needs to know about the other.

---

## 4. Data-Rich Cells for On-Chain Order Books

### 4.1 The Primitive

CKB cells can store arbitrary data in their data field. The cost is proportional to the data size (1 CKB per byte of state occupation). This creates an economic model for on-chain data storage that is bounded by token economics, not gas per operation.

### 4.2 CKB Implementation

VibeSwap's auction cell stores the entire batch state in 217 bytes:

```
AuctionCellData (217 bytes):
  phase:              1 byte
  batch_id:           8 bytes
  commit_mmr_root:    32 bytes   // Root of all commits
  commit_count:       4 bytes
  reveal_count:       4 bytes
  xor_seed:           32 bytes   // Accumulated XOR of secrets
  clearing_price:     16 bytes   // u128 with 18 decimals
  fillable_volume:    16 bytes
  difficulty_target:  32 bytes   // Current PoW difficulty
  prev_state_hash:    32 bytes   // Header chain linking
  phase_start_block:  8 bytes
  pair_id:            32 bytes
```

This 217 bytes of state costs 217 CKB to maintain. The economic cost is known and bounded. The data layout is defined by Molecule schemas (CKB's zero-copy deserialization format), ensuring that any client can parse the cell without ABI decoding.

### 4.3 EVM Comparison

On Ethereum, storing 217 bytes requires ~7 storage slots (32 bytes each). Writing a cold slot costs 20,000 gas. Writing a warm slot costs 5,000 gas. A full auction state update touching all fields costs approximately 100,000 gas minimum (~$5 at 50 gwei, more during congestion). The cost is per-operation, not per-state. Reading is free only for off-chain consumers; on-chain reads cost gas.

**CKB advantage**: State cost is proportional to size, not access frequency. A busy trading pair with 1000 state transitions per hour pays the same storage cost as a quiet pair. On EVM, the busy pair pays 1000x more gas.

---

## 5. Cross-Chain Atomic Swaps via CKB Light Client

### 5.1 The Primitive

CKB's `header_deps` mechanism allows a transaction to reference CKB block headers as dependencies. Combined with CKB's SPV-compatible PoW chain, this enables light client verification of external chain states within CKB transactions.

### 5.2 CKB Implementation

VibeSwap's cross-chain architecture uses the following pattern:

1. User locks tokens on Chain A (Ethereum, via LayerZero)
2. A relay submits the lock proof as a CKB transaction referencing the appropriate block header
3. CKB type script verifies the SPV proof against the header chain
4. Tokens are minted or released on CKB

Because CKB uses PoW (NC-Max), and Bitcoin-format block headers are natively verifiable, the cross-chain bridge inherits Bitcoin-class security assumptions. There is no multisig committee. There is no trusted relay -- anyone can submit proofs, and the type script validates them.

### 5.3 EVM Comparison

On Ethereum, cross-chain bridges require trusted multisig committees (Wormhole, Multichain), optimistic fraud proofs with challenge windows (Optimism), or zero-knowledge proofs (zkBridge). Each introduces either trust assumptions, latency, or computational overhead.

**CKB advantage**: PoW-to-PoW light client verification is the simplest and oldest cross-chain verification mechanism (Bitcoin SPV). CKB supports it natively through `header_deps`. No committee. No fraud proof window. No ZK prover.

---

## 6. PoW-Gated Shared State

### 6.1 The Primitive

Proposed by community member Matt, PoW-gated shared state uses a lock script that verifies a SHA-256 proof-of-work. Any party that finds a valid nonce earns the right to update the cell. Difficulty adjusts based on transition frequency, just like Bitcoin block difficulty.

### 6.2 CKB Implementation

VibeSwap's `pow-lock` script:
- Accepts `pair_id` and `min_difficulty` as args
- Verifies that the witness contains a valid PoW proof: `SHA-256(challenge || nonce)` must have `difficulty` leading zero bits
- Challenge is derived from `SHA-256(pair_id || batch_id || prev_state_hash || solver_lock_hash)` -- unique per cell state and bound to the solver's identity, preventing PoW solution theft via mempool observation (analogous to `coinbase` in mining or `recipient_lock_hash` in HTLC)
- Difficulty adjusts every 10 transitions with a maximum 4x adjustment factor

This creates a self-regulating market for write access. High-value trading pairs attract more miners, increasing difficulty. Low-value pairs have low difficulty, keeping participation costs minimal. The system self-scales without governance intervention.

### 6.3 EVM Comparison

EVM has no equivalent. Shared mutable state is freely accessible to anyone who pays gas. There is no way to make write access require computational proof. The closest analogue -- a contract that verifies a PoW submission -- would still be subject to gas-based ordering: a miner who finds the PoW can be front-run by a validator who sees the PoW submission in the mempool.

**CKB advantage**: PoW-gated shared state is only possible on UTXO chains where cell consumption is atomic. The PoW proof and the state transition are a single atomic operation. By binding the challenge to the `solver_lock_hash`, the PoW solution is non-transferable -- an observer who sees a valid nonce in the mempool cannot replay it because the challenge hash changes with a different solver identity.

---

## 7. Self-Custodial LP Positions

### 7.1 The Primitive

On CKB, LP positions are cells owned by the user's lock script. The user retains full custody. Withdrawing liquidity requires only the user's signature -- there is no contract to approve, no allowance to set, no third-party custodian.

### 7.2 CKB Implementation

VibeSwap's LP position cell:
```
Lock: user's secp256k1 lock script (user controls)
Type: lp-position-type (validates LP rules)
Data: LPPositionCellData { lp_amount, entry_price, pool_id, deposit_block }
```

To withdraw, the user creates a transaction consuming their LP position cell and the pool cell (with PoW proof), receiving their share of reserves. The user's lock script authorizes the withdrawal. No approval transaction. No infinite allowance vulnerability.

### 7.3 EVM Comparison

On Ethereum, LP tokens are ERC-20 balances in a contract's storage. The contract is the custodian. To withdraw, the user calls `removeLiquidity()` on the contract, which reads the user's balance from its own storage and transfers tokens. The user must have previously approved the router contract to spend their LP tokens. This approval pattern has been the source of numerous exploits (infinite approval attacks, approval phishing).

**CKB advantage**: The user's lock script is the only authorization required. No approval flows. No third-party custody. No infinite allowance attack surface.

---

## 8. Key Contributions

1. **Catalog of seven CKB-native DeFi primitives** that are impossible, difficult, or expensive on account-based chains, with concrete implementation patterns from VibeSwap's production codebase.

2. **Economic analysis** demonstrating that CKB's state-cost model (per byte, not per operation) creates predictable and bounded costs for DeFi applications, unlike gas-based models where costs scale with transaction frequency.

3. **Security surface comparison** showing that CKB eliminates entire attack categories (approval phishing, re-entrancy, gas-based front-running) through structural properties rather than defensive coding patterns.

4. **Composability model** where type script validation is orthogonal to cell contents, enabling new token standards to work with existing DeFi protocols without integration work.

---

## Acknowledgments

We thank Jan Xie for identifying the missing beneficiary binding in the PoW-gated shared state challenge (Section 6.2). The original challenge derivation did not include `solver_lock_hash`, which would have left PoW solutions vulnerable to mempool-based theft. This has been corrected.

---

*VibeSwap welcomes collaboration on new CKB DeFi primitives. Our SDK and type scripts are open source.*
