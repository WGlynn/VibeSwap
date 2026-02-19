# Matt's PoW Shared State + Recursive MMR Proposal

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Source: Matt's CKB forum post + Telegram messages, saved Session 18 (Feb 17, 2026)
Context: Solving cell contention on Nervos CKB for DeFi applications including VibeSwap

---

## The Problem: Cell Contention

On CKB's UTXO model, application state lives in cells. When multiple parties need to update the same cell (DEX order book, liquidity pool, shared registry), competing transactions race to consume it. Most fail. Network fills with noise.

Centralized operator issuing "tickets" for write access works but reintroduces single point of control.

---

## Solution: PoW-Gated Shared State

Bitcoin showed that proof of work is a general solution for leaderless leader selection. Apply the same principle to cell write access on CKB.

### Implementation
- **Lock script**: PoW check + difficulty adjustment at every state transition
- **Type script**: Application logic (completely separate from access control)
- Contract logic enforced by chain. Access to update cell(s) controlled by PoW.
- Reuses Bitcoin block header format — SHA256 so existing Bitcoin hardware works
- Each state transition commits to the hash chain of prior transitions (mini-blockchain)

### Key Properties
- Multiple systems can run concurrently (independent mini-blockchains per shared cell)
- Griefing is self-punishing (attacker burns real hash power for no economic gain)
- Difficulty adjustment via header_deps + inclusion proofs of previous 2 state transitions
- Light clients can subscribe to systems independently

### Credit
- @xxuejie — raised "how to bring shared state to CKB"
- @nirenzang (Ren) — idea of operator fairly issuing tickets
- @TabulaRasa — "Nakamoto consensus solved L1 money consensus, this solves L2 tx ordering execution consensus"

---

## Data Structure: Recursive Merkle Mountain Ranges

MMRs are append-only accumulators. Only require storing tree roots (log n of element count). Topology contained in binary representation of element count.

### Standard MMR
- Append leaves, peaks form automatically
- Peaks = log2(n) hashes at the top
- Naive root = hash of concatenated peaks

### Matt's Recursive MMR Innovation
- Instead of hashing peaks together naively, recurse peaks into ANOTHER MMR
- Repeat until single root remains
- Then restart the process — endless hierarchy of MMRs inside a single MMR
- Relatively efficient proofs despite added complexity
- Each MMR described by size of its element set — straightforward to implement

### Example (100 tx per block, 5 blocks)
```
100 transactions → MMR → 3 peaks
3 peaks → MMR → 2 peaks
2 peaks → MMR → 1 root (txRoot)

5 txRoots → MMR → 2 peaks
2 peaks → MMR → 1 root (blockRoot)
```

### Replace BOTH Header Fields
- Replace tx Merkle root with MMR root (like Bitcoin's tx root)
- ALSO replace prevblock field with recursive MMR
- Standard blockchain = linked list → O(n) to prove historical state
- MMR of blocks = O(log n) proofs for any historical mini-block
- Linked list simplicity + hierarchical proof efficiency
- Overhead: O(log n) peak storage instead of O(1) for single prev hash — worth it

Reference implementation: https://github.com/matt-nervos/EfficientMMRinEVM

---

## Miner Discretion Question

### The Tension
If order data kept off-chain until mini-block is mined, miner has discretion over what to include (censorship risk).

### Three Approaches
1. **Off-chain data, miner discretion** — simplest, weakest. Miner can censor (but can't front-run hashed commits)
2. **Forced inclusion** (strongest) — users post data to their own cells (no contention), miner aggregates into shared cell, type script enforces completeness. Miner = compensated aggregator with zero discretion. Censorship structurally impossible.
3. **Hybrid** — some data off-chain, some forced on-chain

Matt's lean: "It's also possible to force what they mine based on what users have contributed to the chain. Maybe all possibilities are workable."

JARVIS recommendation: Forced inclusion is strongest design.

---

## Mapping to VibeSwap on CKB

| Layer | Mechanism | What it solves |
|-------|-----------|----------------|
| Infrastructure ordering | Matt's PoW | Who gets write access to the auction cell |
| Commit accumulation | Recursive MMR | Efficient append-only storage + compact proofs |
| Application ordering | VibeSwap Fisher-Yates shuffle | Fairness within the batch |
| Pricing | VibeSwap uniform clearing | Everyone gets same price, no sandwich attacks |

These are different problems at different layers. Both needed on CKB. Neither replaces the other.
