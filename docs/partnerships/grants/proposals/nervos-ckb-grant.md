# Nervos CKB Grant Application — VibeSwap

## Project Name
VibeSwap CKB — UTXO-Native MEV-Free DEX for Nervos Network

## Category
DeFi / DEX / Cross-Chain Infrastructure

---

## The $0 Story

VibeSwap exists because we didn't wait for permission.

With zero funding, no VC, no pre-mine, and no team allocation, we built:

- **351 smart contracts** — commit-reveal batch auctions, constant product AMM, circuit breakers, Shapley reward distribution, cross-chain routing, TWAP oracles, insurance pools, treasury stabilization
- **374 test files** — unit, fuzz, and invariant testing across the entire contract suite
- **336 frontend components** — React 18, Vite 5, Tailwind CSS, ethers.js v6, WebAuthn device wallets, dual wallet architecture
- **44 research papers** — whitepapers, mechanism design papers, game theory catalogues, protocol specifications
- **1,837+ commits** — continuous, methodical, no shortcuts
- **Live on Base mainnet** — not a testnet demo, not a pitch deck, a deployed protocol
- **Python Kalman filter oracle** — real-time price discovery with noise reduction
- **LayerZero V2 integration** — omnichain messaging already operational

All of this was built by a solo founder and an AI co-engineer. No team of 30. No $10M seed round. No "we'll build it after we raise." We built it first.

**This grant isn't asking you to fund a promise. It's asking you to accelerate a proof.**

---

## 1. What We Built With $0

### The Core Mechanism

VibeSwap eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Every 10 seconds:

1. **Commit Phase (8s):** Users submit `hash(order || secret)` with collateral deposit. Orders are opaque — no one can see or front-run them.
2. **Reveal Phase (2s):** Users reveal order details and secrets. Invalid reveals get 50% slashed.
3. **Settlement:** A Fisher-Yates shuffle using XORed user secrets determines processing order. All orders in a batch settle at a single uniform clearing price.

This isn't theoretical. It's deployed. It works. The mechanism design has been validated through hundreds of fuzz tests and invariant checks across 351 contracts.

### Security That Didn't Cut Corners

Even at $0, we didn't compromise on security:
- Flash loan protection (EOA-only commits)
- TWAP validation (max 5% deviation from oracle)
- Rate limiting (100K tokens/hour/user)
- Circuit breakers (volume, price, and withdrawal thresholds)
- 50% slashing for invalid reveals
- Full fuzz and invariant test suites

### The Full Stack

This isn't a contract repo with a README. It's a complete protocol:
- **Contracts:** Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1 (UUPS upgradeable proxies)
- **Frontend:** 336 components — swap interface, bridge page, governance, portfolio, wallet management
- **Oracle:** Python Kalman filter for true price discovery
- **Cross-chain:** LayerZero V2 OApp protocol, already handling omnichain messaging
- **Governance:** DAO treasury, treasury stabilizer, Shapley-based reward distribution
- **Incentives:** Impermanent loss protection, loyalty rewards, game-theoretic fee distribution

---

## 2. Why CKB — The UTXO Thesis

We built VibeSwap on EVM first because that's where the users are. But here's what we discovered while building: **the EVM account model fights our mechanism at every turn.**

Commit-reveal batch auctions want isolated state. The EVM gives you shared contract storage. Batch settlement wants atomicity. The EVM gives you re-entrancy risks and sequential storage writes. Parallel validation is natural for independent orders. The EVM forces sequential execution.

CKB's Cell model doesn't just support our mechanism — it was *designed* for it.

### CKB Advantages for Batch Auctions

| Property | EVM (Account Model) | CKB (Cell Model) |
|---|---|---|
| Commit isolation | Stored in contract storage (shared state) | Each commit is an independent Cell (isolated) |
| Atomic settlement | Multiple storage writes (re-entrancy risk) | Single transaction consumes all Cells (atomic) |
| Parallelism | Sequential execution within block | Independent Cells can be validated in parallel |
| State rent | No expiry (state bloat) | Cells require CKBytes (natural cleanup) |
| Determinism | Floating point risks in complex math | Integer math on RISC-V VM (fully deterministic) |

The last point is critical. Financial computation on EVM requires constant vigilance against floating point non-determinism. CKB's RISC-V VM with integer-only arithmetic gives us deterministic settlement by default — no workarounds, no precision loss, no rounding attack vectors.

This isn't a pivot. This is the mechanism finding its natural home.

---

## 3. Problem Statement

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

---

## 4. Solution: VibeSwap on CKB

### 4.1 Cell-Based Commit-Reveal Auctions

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

On EVM, this requires careful reentrancy guards and gas optimization across shared storage. On CKB, **it's the natural transaction model.** Each commit is its own Cell. Settlement is a single atomic transaction that consumes inputs and produces outputs. No shared state, no re-entrancy, no sequential bottleneck.

### 4.2 Rust SDK

The VibeSwap CKB SDK (Rust) provides a complete interaction layer:

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

This SDK is not just for VibeSwap — it establishes reusable patterns for any DeFi protocol building commit-reveal mechanisms on CKB.

### 4.3 Cross-Chain: CKB <-> EVM

VibeSwap already uses LayerZero V2 for EVM cross-chain messaging. The CKB integration adds a bridge relay that:
1. Monitors CKB commit Cells and relays hashes to EVM batch auctions
2. Relays EVM settlement results back to CKB for Cell distribution
3. Enables swaps between CKB-native assets (CKB, sUDT tokens) and EVM tokens

This connects CKB's DeFi ecosystem directly to EVM liquidity — something no existing CKB DEX offers.

---

## 5. Technical Architecture

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

### What Already Exists (Built With $0)
- **351 Solidity smart contracts** — full test suite (unit, fuzz, invariant)
- **336 frontend components** — React 18, Vite 5, Tailwind CSS
- **Python Kalman filter oracle** — price discovery
- **LayerZero V2 cross-chain** — OApp protocol, operational
- **Live on Base mainnet** — deployed, not theoretical

---

## 6. What $90K Would Unlock

We've proven we can build. This funding doesn't start the work — it accelerates what's already moving.

### Milestone 1: CKB Lock/Type Scripts (Months 1-3) — $20,000

The commit-reveal mechanism is designed and battle-tested on EVM. This milestone ports it to CKB's native execution environment.

- Implement commit lock script (RISC-V, Rust-compiled)
- Implement reveal lock script with hash verification
- Implement settlement type script with uniform clearing price logic (integer-only `mul_div` patterns)
- Deploy to CKB testnet
- **Deliverable:** Deployed scripts on testnet, unit tests, documentation
- **Why this works:** The mechanism design is done. The edge cases are found. The fuzz tests exist. We're translating proven logic to a better substrate, not designing from scratch.

### Milestone 2: Rust SDK (Months 3-5) — $15,000

A published, production-quality Rust crate for interacting with VibeSwap on CKB.

- Complete `vibeswap-sdk` crate with full CKB interaction layer
- Order creation, commitment, reveal, and settlement APIs
- Cell indexer integration for auction state queries
- Published to crates.io
- **Deliverable:** Published SDK, API documentation, example applications
- **Why this works:** We've already built the equivalent interaction layer in JavaScript (ethers.js v6) and Python. The API surface is defined. This is implementation, not exploration.

### Milestone 3: Cross-Chain Bridge (Months 5-8) — $25,000

Connect CKB to VibeSwap's existing omnichain infrastructure.

- Bridge relay service connecting CKB Cells to EVM batch auctions
- CKB-to-EVM and EVM-to-CKB swap flows
- sUDT token support
- End-to-end testing on testnet (CKB testnet + EVM testnet)
- **Deliverable:** Working cross-chain swaps, bridge relay service, test results
- **Why this works:** LayerZero V2 integration is already operational on the EVM side. The CrossChainRouter contract exists and is tested. This milestone extends an existing bridge, not building one from nothing.

### Milestone 4: Mainnet & Ecosystem (Months 8-10) — $15,000

Ship it.

- Security review of CKB scripts
- CKB mainnet deployment
- Frontend integration: CKB chain selector, CKB wallet support
- Documentation and tutorials for CKB developers
- **Deliverable:** Live on CKB mainnet, frontend integration, developer documentation
- **Why this works:** We've already done mainnet deployment on Base. The frontend already supports chain selection and dual wallet architectures. Adding CKB is additive, not a rebuild.

---

## 7. Budget — How Every Dollar Accelerates What's Already Working

| Category | Amount | What It Accelerates |
|---|---|---|
| CKB script development (Rust/RISC-V) | $20,000 | Proven mechanism → native CKB implementation |
| Rust SDK development | $15,000 | Existing API surface → published CKB crate |
| Cross-chain bridge development | $25,000 | Operational LayerZero bridge → CKB connectivity |
| Mainnet deployment & integration | $15,000 | Base mainnet experience → CKB mainnet launch |
| Infrastructure (CKB nodes, indexer, relay) | $5,000 | Existing infra → CKB-specific services |
| Security review | $10,000 | Battle-tested contracts → CKB script audit |
| **Total** | **$90,000** | **$0 → deployed, cross-chain, MEV-free DEX on CKB** |

For context: most grant applications at this funding level are asking for money to *start* building. We're asking for money to bring a proven, deployed, tested protocol to a new chain where it fits better than on the chain we built it for.

---

## 8. Team

**Faraday1** — Founder & Mechanism Designer
- Solo architect of VibeSwap — 351 contracts, 336 frontend components, full stack, $0 budget
- Mechanism design papers on cooperative capitalism, Shapley reward distribution, and game-theoretic incentive alignment
- Active engagement with Nervos community
- GitHub: https://github.com/wglynn

**JARVIS** — AI Co-Engineer (Claude-powered)
- Full-stack engineering: Solidity, React, Python, Rust
- CKB SDK development (Rust)
- Autonomous community management via Telegram bot
- 1,837+ commits of continuous collaboration

**6 additional contributors** across trading bots, infrastructure, and community.

We didn't hire 30 engineers. We built a system where 1 founder + 1 AI + 6 contributors produce at the output level of a funded team. The grant doesn't need to cover a large payroll. Every dollar goes to infrastructure, deployment, and security.

---

## 9. Value to CKB Ecosystem

1. **First MEV-free DEX on CKB** — production-grade DeFi infrastructure that leverages CKB's unique Cell model for what it was designed to do.
2. **Cross-chain liquidity** — connects CKB to EVM liquidity via LayerZero, directly addressing the isolation that has limited CKB DeFi adoption.
3. **UTXO-based DEX research** — formal analysis of Cell model advantages for batch auctions, publishable as a research contribution that benefits the entire UTXO ecosystem.
4. **Open source Rust SDK** — reusable CKB interaction patterns for other DeFi projects building on Nervos.
5. **Developer onboarding** — VibeSwap's documentation and SDK lower the barrier for new developers building DeFi on CKB.
6. **Integer math determinism showcase** — validates and demonstrates CKB's RISC-V VM advantages for financial computation. No floating point. No rounding attacks. Deterministic by design.
7. **Proof that CKB is ready for serious DeFi** — a protocol that chose CKB not because of a grant, but because the Cell model is genuinely better for this use case.

---

## 10. CKB-Specific Design Decisions

- **State rent alignment:** Commit Cells require CKBytes, naturally incentivizing timely reveals and preventing state bloat
- **Integer-only math:** All pricing and settlement logic uses integer arithmetic with `mul_div` patterns — leveraging CKB's deterministic RISC-V VM
- **Cell-level isolation:** Each order is an independent Cell, enabling parallel validation and natural transaction isolation
- **sUDT integration:** Native support for CKB's standard token format
- **RISC-V compilation:** Lock and type scripts compiled from Rust to RISC-V, leveraging the mature Rust toolchain for safety guarantees

---

## 11. Links

- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App (EVM):** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Nervos Forum Post:** [CUSTOMIZE]
- **Contact:** Faraday1 — [CUSTOMIZE]

---

*We didn't wait for funding to build VibeSwap. We built it with $0 because the mechanism demanded to exist. Now we're asking for $90K — not to start, but to bring a proven protocol to the chain where it belongs.*
