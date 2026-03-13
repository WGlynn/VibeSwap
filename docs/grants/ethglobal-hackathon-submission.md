# ETHGlobal Hackathon Submission — VibeSwap

## Project Name
VibeSwap

## One-Line Description
An omnichain DEX that makes frontrunning impossible through 10-second commit-reveal batch auctions with uniform clearing prices.

## Tracks / Sponsors
- [x] DeFi
- [x] MEV / Transaction Ordering
- [x] Cross-Chain / Interoperability
- [x] Public Goods
- [x] Best Use of LayerZero
- [x] Base / Coinbase
- [x] Best Smart Contract Project
- [ ] [SELECT APPLICABLE SPONSOR TRACKS]

---

## The Problem (30 seconds)

Every time you trade on a DEX, there's a hidden tax. Bots see your transaction in the mempool, place orders before and after yours, and extract value from your trade. This is called MEV — it costs users $600M+ per year and there is no DEX that eliminates it.

**Current "solutions" don't solve it.** Private mempools still have privileged operators. MEV-Share redistributes extraction instead of removing it. Batch auction DEXs like CowSwap still rely on centralized solvers.

## The Solution (60 seconds)

VibeSwap runs 10-second batch auction cycles:

**Step 1: COMMIT (8 seconds)** — You submit an encrypted hash of your order. No one — not bots, not validators, not even VibeSwap — can see what you're trading.

**Step 2: REVEAL (2 seconds)** — Everyone reveals their orders simultaneously. If you don't reveal, you lose 50% of your collateral (anti-griefing).

**Step 3: SETTLE** — All orders are shuffled using a deterministic algorithm (Fisher-Yates, seeded by XORed participant secrets) and executed at a single uniform clearing price.

**Why this kills MEV:**
- Bots can't frontrun what they can't see (encrypted commits)
- There's no price advantage to ordering (everyone gets the same price)
- The shuffle is verifiable and deterministic (no manipulation)

## Technical Architecture (For Judges)

### Smart Contracts (Solidity 0.8.20)
```
CommitRevealAuction.sol  — Core batch auction engine
  ├── commit(bytes32 hash) — Submit encrypted order hash + collateral
  ├── reveal(Order order, bytes32 secret) — Reveal order, verify hash
  └── settle() — Compute clearing price, execute all trades

VibeAMM.sol              — Constant product AMM (x*y=k) for price reference
VibeSwapCore.sol          — Orchestrator connecting auction + AMM + rewards
ShapleyDistributor.sol    — Game-theory LP reward distribution
CrossChainRouter.sol      — LayerZero V2 OApp for cross-chain swaps
CircuitBreaker.sol        — Safety limits (volume, price, withdrawal)
```

### Key Technical Decisions
1. **On-chain commit-reveal** (not off-chain order books) — fully decentralized, no trusted solver
2. **Fisher-Yates shuffle with XORed secrets** — each participant contributes entropy, preventing any single party from controlling execution order
3. **Uniform clearing price** — computed by intersecting aggregate supply and demand curves; mathematically guarantees no ordering advantage
4. **50% slashing for invalid reveals** — game-theoretic griefing prevention; the expected cost of griefing exceeds the expected benefit
5. **EOA-only commits** — prevents flash loan-funded manipulation of batch auctions

### Security Stack
- OpenZeppelin v5.0.1 (UUPS upgradeable proxies)
- Reentrancy guards on all state-changing functions
- TWAP oracle validation (max 5% deviation from reference price)
- Rate limiting (1M tokens/hour/user)
- Circuit breakers with configurable volume/price/withdrawal thresholds

### Cross-Chain (LayerZero V2)
- `CrossChainRouter.sol` implements OApp interface
- Cross-chain commits: encrypted order hashes relayed via `_lzSend()`
- Cross-chain settlement: clearing prices synchronized across chains
- Zero protocol fees on bridge transfers

### Frontend
- React 18, Vite 5, Tailwind CSS, ethers.js v6
- 170+ pages: swap, bridge, pools, governance, analytics, portfolio
- Dual wallet support: MetaMask/Coinbase Wallet + WebAuthn passkeys
- Mobile-responsive

### Oracle
- Python Kalman filter for true price discovery
- Independent of on-chain price manipulation
- TWAP validation prevents stale/manipulated prices from affecting settlement

## What We Built (Scope)

| Component | Count | Stack |
|---|---|---|
| Smart contracts | 200+ | Solidity 0.8.20, Foundry, OZ v5 |
| Frontend pages | 170+ | React 18, Vite 5, Tailwind |
| Test suite | Full | Unit, fuzz, invariant (Foundry) |
| Cross-chain | LayerZero V2 | OApp protocol |
| Oracle | Kalman filter | Python 3.9+ |
| Deployment | Live | Base mainnet + Vercel |

## Demo

**Live URL:** https://frontend-jade-five-87.vercel.app

### Demo Flow
1. Visit the app, connect wallet (MetaMask or WebAuthn passkey)
2. Navigate to Swap page
3. Select token pair (e.g., ETH/USDC)
4. Enter amount, click "Swap"
5. Order is committed (encrypted hash on-chain)
6. After 8 seconds, order auto-reveals
7. Settlement executes at uniform clearing price
8. Transaction complete — zero MEV extracted

### What to Look For
- The commit transaction contains only a hash — order details are invisible
- The clearing price is identical for all participants in the batch
- The settlement transaction shows the Fisher-Yates shuffle output
- Cross-chain: try the Bridge page (0% protocol fees, LayerZero V2)

## Innovation

### What's New
1. **Practical commit-reveal batch auctions on EVM** — 10-second cycles that are fast enough for real trading while maintaining MEV resistance
2. **Participant-seeded shuffle** — XORed secrets create a deterministic but unmanipulable execution order (no single party controls randomness)
3. **Shapley value LP rewards** — first DEX to use cooperative game theory for provably fair reward distribution
4. **AI co-founder model** — JARVIS (Claude-powered) is a credited co-founder, not a tool; demonstrates AI-augmented development at production scale
5. **Cooperative capitalism** — game-theoretic proof that eliminating extraction makes cooperation the dominant strategy

### What's Different from CowSwap / Other Batch Auction DEXs
- **No solvers** — fully on-chain settlement, no trusted intermediary
- **Encrypted commits** — CowSwap orders are visible to solvers; VibeSwap orders are invisible to everyone
- **Uniform clearing price** — CowSwap uses solver-determined prices; VibeSwap uses mathematically derived clearing prices
- **Omnichain** — cross-chain batch auctions via LayerZero V2

## Team

**Will Glynn** — Founder & Mechanism Designer
Built the entire protocol solo (200+ contracts, 170+ pages, full test suite). Zero VC, zero pre-mine, zero team allocation. Pure conviction.

**JARVIS** — AI Co-Founder (Claude-powered)
Full-stack engineering partner across Solidity, React, Python, and Rust. Autonomous Telegram community management. Not a chatbot — a co-founder.

## Built With
- Solidity 0.8.20
- Foundry (forge, cast, anvil)
- OpenZeppelin v5.0.1
- LayerZero V2 (OApp protocol)
- React 18
- Vite 5
- Tailwind CSS
- ethers.js v6
- Python 3.9+
- Rust (CKB SDK, in progress)

## Links
- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App:** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Video Demo:** [RECORD AND UPLOAD]

## Prizes Targeting

### Best DeFi Project
VibeSwap is a full-stack DEX with 200+ contracts that solves DeFi's biggest unsolved problem (MEV) through a novel mechanism design.

### Best Use of LayerZero
Cross-chain batch auction coordination is a novel OApp pattern — encrypted order relaying and unified settlement across chains.

### Best on Base
Live on Base mainnet. MEV-free trading as a differentiator for the Base ecosystem.

### Public Goods
Fully open source (MIT), zero extraction (no VC/pre-mine/team allocation), reference implementation for MEV-free trading.

### Most Innovative
Commit-reveal batch auctions + Shapley value rewards + AI co-founder = three innovations in one project.
