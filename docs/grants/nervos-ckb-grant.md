# Nervos CKB Grant Application — VibeSwap

## Project Name
VibeSwap CKB — UTXO-Native MEV-Free DEX for Nervos Network

## Category
DeFi / DEX / Cross-Chain Infrastructure

---

## 1. Project Summary

VibeSwap is an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. We are building a native CKB integration that brings VibeSwap's fair trading mechanism to the Nervos ecosystem, leveraging CKB's UTXO model, Cell model, and programmable lock/type scripts to implement batch auctions with properties not achievable on account-based chains.

The CKB integration includes a Rust SDK for interacting with VibeSwap's on-chain logic, cross-chain connectivity between CKB and EVM chains via LayerZero, and novel use of CKB's Cell model for commit-reveal order management. This brings production-grade DeFi infrastructure to Nervos while exploring UTXO-based DEX design — a significantly underexplored area in DeFi research.

## 2. Problem Statement

### CKB DeFi Gap
Nervos CKB has a powerful and unique programming model (Cells, lock scripts, type scripts, RISC-V VM) but limited DeFi infrastructure compared to EVM chains. The few DEXs that exist on CKB do not address MEV, and the UTXO model's unique properties for fair exchange have not been fully explored.

### UTXO-Based MEV
While CKB's UTXO model provides some natural MEV resistance (transactions are more isolated than account-based models), MEV is still possible through:
- Transaction ordering within blocks
- Front-running of Cell consumption
- Aggregator-level manipulation

A purpose-built commit-reveal mechanism on CKB can eliminate these vectors while leveraging UTXO properties that EVM chains lack.

### Cross-Chain Isolation
CKB's DeFi ecosystem is largely isolated from EVM liquidity. Users must bridge manually, and there is no mechanism for fair cross-chain swaps between CKB and EVM chains.

## 3. Solution: VibeSwap on CKB

### 3.1 Cell-Based Commit-Reveal Auctions

CKB's Cell model maps naturally to commit-reveal batch auctions:

```
COMMIT PHASE:
  User creates a Commit Cell:
    - Lock script: VibeSwap commit lock (requires valid reveal to spend)
    - Type script: CommitReveal type (validates auction participation)
    - Data: hash(order_details || user_secret) + collateral CKBytes
    - The Cell exists as an opaque commitment — no order details visible

REVEAL PHASE:
  User spends Commit Cell → creates Reveal Cell:
    - Data: order_details + user_secret (plaintext)
    - Type script validates: hash matches original commitment
    - Invalid reveal → slashing Cell consumes 50% collateral

SETTLEMENT:
  Aggregator transaction consumes all Reveal Cells:
    - Computes uniform clearing price
    - Creates Output Cells distributing tokens at clearing price
    - Settlement is atomic — all-or-nothing in a single transaction
```

### 3.2 UTXO Advantages for Batch Auctions

| Property | EVM (Account Model) | CKB (Cell Model) |
|---|---|---|
| Commit isolation | Stored in contract storage (shared state) | Each commit is an independent Cell (isolated) |
| Atomic settlement | Multiple storage writes (re-entrancy risk) | Single transaction consumes all Cells (atomic) |
| Parallelism | Sequential execution within block | Independent Cells can be validated in parallel |
| State rent | No expiry (state bloat) | Cells require CKBytes (natural cleanup) |
| Determinism | Floating point risks in complex math | Integer math on RISC-V VM (fully deterministic) |

### 3.3 Rust SDK

The VibeSwap CKB SDK (Rust) provides:

```rust
// vibeswap-sdk/src/lib.rs
pub struct VibeSwapClient {
    ckb_client: CkbRpcClient,
    // ...
}

impl VibeSwapClient {
    /// Create a commit Cell for a batch auction
    pub async fn commit_order(&self, order: &Order, secret: &[u8; 32]) -> Result<TxHash>;

    /// Reveal a previously committed order
    pub async fn reveal_order(&self, commit_outpoint: &OutPoint, order: &Order, secret: &[u8; 32]) -> Result<TxHash>;

    /// Query current batch auction state
    pub async fn get_auction_state(&self, pair: &TradingPair) -> Result<AuctionState>;

    /// Aggregate and settle a batch (for aggregators)
    pub async fn settle_batch(&self, auction_id: u64) -> Result<TxHash>;
}
```

### 3.4 Cross-Chain: CKB <-> EVM

VibeSwap already uses LayerZero V2 for EVM cross-chain messaging. The CKB integration adds a bridge relay that:
1. Monitors CKB commit Cells and relays hashes to EVM batch auctions
2. Relays EVM settlement results back to CKB for Cell distribution
3. Enables swaps between CKB-native assets (CKB, sUDT tokens) and EVM tokens

## 4. Technical Architecture

```
┌─────────────────────────────────────────────┐
│                VibeSwap CKB                  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Commit   │  │ Reveal   │  │ Settlement│ │
│  │ Lock     │  │ Lock     │  │ Type      │ │
│  │ Script   │  │ Script   │  │ Script    │ │
│  └──────────┘  └──────────┘  └───────────┘ │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │         Rust SDK (vibeswap-sdk)       │   │
│  │  Order management, Cell construction, │   │
│  │  batch aggregation, RPC client        │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │         Bridge Relay Service          │   │
│  │  CKB Cell monitor → LayerZero relay   │   │
│  │  EVM settlement → CKB distribution    │   │
│  └──────────────────────────────────────┘   │
│                                              │
└──────────────────┬──────────────────────────┘
                   │ LayerZero V2
                   │
┌──────────────────┴──────────────────────────┐
│              VibeSwap EVM                    │
│  (Base, Ethereum, Arbitrum, etc.)            │
│  CommitRevealAuction.sol + CrossChainRouter  │
└─────────────────────────────────────────────┘
```

### Existing Codebase
- **200+ Solidity smart contracts** — full test suite (unit, fuzz, invariant)
- **170+ frontend pages** — React 18, Vite 5, Tailwind CSS
- **Python Kalman filter oracle** — price discovery
- **LayerZero V2 cross-chain** — OApp protocol
- **Live on Base mainnet**

## 5. Team

**Will Glynn** — Founder & Mechanism Designer
- Solo architect of VibeSwap (200+ contracts, full stack)
- Active engagement with Nervos community (forum posts, CKB research)
- Mechanism design papers on cooperative capitalism and Shapley rewards
- GitHub: https://github.com/wglynn

**JARVIS** — AI Co-Founder (Claude-powered)
- Full-stack engineering: Solidity, React, Python, Rust
- CKB SDK development (Rust)
- Autonomous community management via Telegram bot

## 6. Milestones

### Milestone 1: CKB Lock/Type Scripts (Months 1-3)
- Implement commit lock script (RISC-V, Rust-compiled)
- Implement reveal lock script with hash verification
- Implement settlement type script with uniform clearing price logic
- Deploy to CKB testnet
- **Deliverable:** Deployed scripts on testnet, unit tests, documentation
- **Budget:** $20,000

### Milestone 2: Rust SDK (Months 3-5)
- Complete `vibeswap-sdk` crate with full CKB interaction layer
- Order creation, commitment, reveal, and settlement APIs
- Cell indexer integration for auction state queries
- Published to crates.io
- **Deliverable:** Published SDK, API documentation, example applications
- **Budget:** $15,000

### Milestone 3: Cross-Chain Bridge (Months 5-8)
- Bridge relay service connecting CKB Cells to EVM batch auctions
- CKB-to-EVM and EVM-to-CKB swap flows
- sUDT token support
- End-to-end testing on testnet (CKB testnet + EVM testnet)
- **Deliverable:** Working cross-chain swaps, bridge relay service, test results
- **Budget:** $25,000

### Milestone 4: Mainnet & Ecosystem (Months 8-10)
- Security review of CKB scripts
- CKB mainnet deployment
- Frontend integration: CKB chain selector, CKB wallet support
- Documentation and tutorials for CKB developers
- **Deliverable:** Live on CKB mainnet, frontend integration, dev docs
- **Budget:** $15,000

## 7. Budget Summary

| Category | Amount |
|---|---|
| CKB script development (Rust/RISC-V) | $20,000 |
| Rust SDK development | $15,000 |
| Cross-chain bridge development | $25,000 |
| Mainnet deployment & integration | $15,000 |
| Infrastructure (CKB nodes, indexer, relay) | $5,000 |
| Security review | $10,000 |
| **Total** | **$90,000** |

## 8. Value to CKB Ecosystem

1. **First MEV-free DEX on CKB** — production-grade DeFi infrastructure that leverages CKB's unique Cell model.
2. **Cross-chain liquidity** — connects CKB to EVM liquidity via LayerZero, reducing the isolation that has limited CKB DeFi adoption.
3. **UTXO-based DEX research** — formal analysis of Cell model advantages for batch auctions, publishable as research contribution.
4. **Open source Rust SDK** — reusable CKB interaction patterns for other DeFi projects building on Nervos.
5. **Developer onboarding** — VibeSwap's documentation and SDK lower the barrier for new developers building DeFi on CKB.
6. **Integer math determinism** — validates and showcases CKB's RISC-V VM advantages for financial computation (no floating point non-determinism).

## 9. CKB-Specific Design Decisions

- **State rent alignment:** Commit Cells require CKBytes, naturally incentivizing timely reveals and preventing state bloat
- **Integer-only math:** All pricing and settlement logic uses integer arithmetic with `mul_div` patterns — leveraging CKB's deterministic RISC-V VM
- **Cell-level isolation:** Each order is an independent Cell, enabling parallel validation and natural transaction isolation
- **sUDT integration:** Native support for CKB's standard token format

## 10. Links

- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App (EVM):** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Nervos Forum Post:** [LINK TO FORUM POST]
- **Contact:** Will Glynn — [YOUR EMAIL]
