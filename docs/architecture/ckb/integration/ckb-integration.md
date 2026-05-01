# VibeSwap CKB Integration — Cell Model Architecture

## Overview

VibeSwap on Nervos CKB is not a bytecode translation — it's a fundamental architecture adaptation that leverages CKB's UTXO Cell Model to create a **five-layer MEV defense** that is structurally impossible on account-based chains like Ethereum.

## Five-Layer MEV Defense

| Layer | Mechanism | CKB Implementation |
|-------|-----------|-------------------|
| 1. Infrastructure | PoW-gated write access | Lock script on shared cells |
| 2. Accumulation | Recursive MMR | MMR peaks in auction cell data |
| 3. Compliance | Protocol-enforced filtering | ComplianceRegistry as cell_dep |
| 4. Ordering | Fisher-Yates shuffle | Type script validates shuffle seed |
| 5. Pricing | Uniform clearing price | Type script validates pricing math |

**Layer 1 is unique to CKB** — it provides MEV resistance at the infrastructure level. On Ethereum, anyone can write to shared state for the cost of gas. On CKB, writing to shared state requires solving a PoW challenge, making MEV extraction economically unviable.

## Cell Architecture

### Shared State Cells (PoW-Gated)
- **Auction Cell**: Per trading pair, tracks batch auction lifecycle
- **Pool Cell**: Per trading pair AMM, tracks reserves and TWAP

### Per-User Cells (No Contention)
- **Commit Cell**: User's hidden order commitment
- **LP Position Cell**: User's liquidity position

### Singleton Cells (Read-Only Dependencies)
- **Compliance Cell**: Blocked address Merkle roots
- **Config Cell**: Protocol parameters
- **Oracle Cell**: Price feeds

## Forced Inclusion Protocol

The most critical design element — prevents miner censorship:

1. User creates CommitCell independently (zero contention)
2. Miner finds PoW nonce for AuctionCell
3. Miner MUST include ALL pending CommitCells (filtered by compliance)
4. Type script verifies completeness — rejects incomplete aggregation
5. Miner = compensated aggregator with ZERO discretion

## Porting Map

| Solidity | CKB Script | Changes |
|----------|-----------|---------|
| CommitRevealAuction.sol | batch-auction-type | State machine → cell transitions |
| VibeAMM.sol | amm-pool-type | Pool struct → cell data |
| VibeSwapCore.sol | Merged into batch-auction-type | Atomic CKB tx |
| CircuitBreaker.sol | Config cell_dep + type script checks | Abstract → config reads |
| ComplianceRegistry.sol | compliance-type + Merkle proofs | mapping → Merkle root |
| DeterministicShuffle.sol | vibeswap-math::shuffle | Direct port |
| BatchMath.sol | vibeswap-math::batch_math | Direct port |
| ProofOfWorkLib.sol | vibeswap-pow | Split: lock + type |
| TWAPOracle.sol | vibeswap-math::twap | Direct port |

## Directory Structure

```
ckb/
├── Cargo.toml                          # Workspace root
├── schemas/cells.mol                   # Molecule serialization schemas
├── lib/
│   ├── vibeswap-math/src/lib.rs       # BatchMath, Shuffle, TWAP
│   ├── mmr/src/lib.rs                 # Recursive MMR
│   ├── pow/src/lib.rs                 # PoW verification + difficulty
│   └── types/src/lib.rs               # Shared types
├── scripts/
│   ├── pow-lock/src/main.rs           # PoW lock script
│   ├── batch-auction-type/src/main.rs # Core auction state machine
│   ├── commit-type/src/main.rs        # Commit cell validation
│   ├── amm-pool-type/src/main.rs      # AMM pool validation
│   ├── lp-position-type/src/main.rs   # LP position tracking
│   ├── compliance-type/src/main.rs    # Compliance registry
│   ├── config-type/src/main.rs        # Protocol config
│   └── oracle-type/src/main.rs        # Oracle price feeds
├── sdk/
│   ├── src/lib.rs                     # Transaction builder
│   └── src/miner.rs                   # PoW mining client
└── tests/                             # Integration + adversarial tests
```

## Key Design Decisions

1. **PoW over Operator**: Permissionless, self-adjusting, no centralization
2. **Forced Inclusion**: Zero miner discretion, structural censorship resistance
3. **Recursive MMR**: O(log n) historical proofs, Bitcoin SPV compatible
4. **Merged Orchestrator**: Single atomic tx replaces cross-contract calls
5. **Merkle Compliance**: O(1) storage, O(log n) verification per address
6. **Epoch-Based Timing**: CKB block numbers for phase transitions
