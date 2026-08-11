# ETHGlobal Hackathon Submission — VibeSwap

## $0. No VC. No Pre-Mine. No Team Allocation. Ship It Anyway.

Here's what we built with literally zero dollars:

| What | How Much |
|---|---|
| Solidity contracts | **438** |
| Test files (unit, fuzz, invariant) | **591** |
| Frontend components | **424** |
| Research papers | **123** |
| Git commits | **1,837+** |
| Funding raised | **$0** |
| Pre-mine | **0** |
| Team token allocation | **0%** |
| VC involvement | **None** |
| Deployment | **Not publicly deployed — reference impl + live demo on a mock backend** |

This is not a weekend prototype. This is a mechanism-complete protocol with an auditable reference implementation.

While most submissions are weekend prototypes stitched together in the final hour, VibeSwap is an MEV-resistant omnichain DEX with 438 auditable contracts, 591 Foundry test files (run per-module), a live demo frontend, cross-chain messaging design, and a novel mechanism backed by 123 research papers. It is not yet on a public network — the protocol is mid-pivot to a sovereign Nervos-CKB-fork chain, and `deployments/` is empty by design. You're looking at a reference implementation and a mechanism, not a mainnet deployment.

---

## Project Name
VibeSwap

## One-Line Description
A $0-funded, mechanism-complete omnichain DEX that removes the sandwich-attack surface through 10-second commit-reveal batch auctions with uniform clearing prices — reference implementation on-disk, live demo against a mock backend (not yet on a public network).

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

Every time you trade on a DEX, you're being robbed. Bots see your transaction in the mempool, sandwich it, and extract value from your trade before you even know it happened. This is MEV — by widely-cited estimates it costs users hundreds of millions of dollars per year, and no DEX has fully eliminated it.

The "solutions" are theater. Private mempools still have privileged operators who can extract. MEV-Share redistributes the theft instead of stopping it. CowSwap relies on centralized solvers who see your orders in plaintext. The fox is always inside the henhouse.

We didn't accept that. So we built something that actually fixes it.

## The Solution (60 seconds)

VibeSwap runs 10-second batch auction cycles designed to remove the sandwich-attack surface structurally — not just discourage it, not just redistribute it, but remove the "before/after price" the attack depends on.

**Step 1: COMMIT (8 seconds)** — You submit a hash of your order (`hash(order || secret)`). Order contents stay hidden until reveal — the security here is standard hash-commitment (SHA-256 / keccak preimage resistance), not a novel primitive.

**Step 2: REVEAL (2 seconds)** — Participants reveal. Fail to reveal a valid order and you lose 50% of your collateral (`SLASH_RATE_BPS = 5000` in `CommitRevealAuction.sol`). Griefing is designed to be a losing game.

**Step 3: SETTLE** — Priority-auction winners execute first (their bids go to LPs, not validators); remaining orders are shuffled using Fisher-Yates seeded by XORed participant secrets, and the batch settles at a **single uniform clearing price**. Within the shuffled set there is no ordering advantage.

**Why this closes the sandwich surface:**
- Bots can't frontrun what they can't see until reveal (hash commits)
- There's no price advantage to ordering within the batch (uniform clearing price)
- The shuffle is deterministic and reader-verifiable; no single party (including the protocol) controls the seed
- No trusted third party, no solver, no privileged operator — the mechanism is fully on-chain in the reference implementation

---

## What $0 Buys You (Apparently, a Lot)

We want to be explicit about what the judges are evaluating here, because this isn't typical.

### The Contract Layer — 438 Solidity Files
Not 438 files of boilerplate. 438 Solidity files across 34 module directories spanning a complete DEX architecture: batch auction engine, constant product AMM, cross-chain messaging, circuit breakers, Shapley value reward distribution, DAO treasury, treasury stabilization, impermanent loss protection, loyalty rewards, TWAP oracle, and deterministic shuffle library. A ~7-contract core is the audit scope; the rest is research/extension surface (see the repo README for what ships vs. what's exploration). Contracts compile on the default Foundry profile.

```
CommitRevealAuction.sol  — Core batch auction engine
  ├── commit(bytes32 hash) — Submit encrypted order hash + collateral
  ├── reveal(Order order, bytes32 secret) — Reveal order, verify hash match
  └── settle() — Compute clearing price, execute all trades

VibeAMM.sol              — Constant product AMM (x*y=k) for price reference
VibeSwapCore.sol          — Orchestrator connecting auction + AMM + rewards
ShapleyDistributor.sol    — Game-theory LP reward distribution (cooperative game theory)
IMessagingHub.sol         — Canonical burn-and-mint cross-chain interface (chain-native impl on CKB-fork; CrossChainRouter.sol is a legacy LZ wrapper, deprecation pending)
CircuitBreaker.sol        — Safety limits (volume, price, withdrawal thresholds)
DAOTreasury.sol           — On-chain governance treasury
TreasuryStabilizer.sol    — Automatic treasury rebalancing
ILProtection.sol          — Impermanent loss insurance for LPs
LoyaltyRewards.sol        — Time-weighted loyalty incentives
```

### The Test Suite — 591 Test Files
Unit tests, fuzz tests, invariant tests. Built on Foundry. This is not "we wrote a few happy path tests." Coverage spans the contract surface. Honest caveat: the full suite OOMs a 16GB machine, so tests are run per-module — modules are green individually, there is no single all-green full-suite number.

### The Frontend — 424 Components
React 18, Vite 5, Tailwind CSS, ethers.js v6. Swap, bridge, pools, governance, analytics, portfolio — 424 components of UI that runs against a mock backend (swap settles against simulated batches; wallet flows are real). Dual wallet support: MetaMask/Coinbase Wallet AND WebAuthn passkeys (your phone's Secure Element, no browser extension needed). Mobile-responsive.

### The Oracle — Kalman Filter Price Discovery
Python-based oracle using Kalman filtering for true price discovery, independent of on-chain manipulation. TWAP validation prevents stale or manipulated prices from affecting settlement.

### The Research — 123 Papers
Mechanism design papers, whitepapers, game theory analysis, wallet security fundamentals, architecture docs, deployment guides (123 in `docs/research/papers/`). This protocol is documented like it's headed to production.

### The Commit History — 1,837+ Commits
Every single one made by 1 founder + 1 AI + 6 contributors. No team. No contractors. No outsourced audits. Just conviction and execution.

---

## Technical Architecture (For Judges Who Want Depth)

### Key Technical Decisions
1. **On-chain commit-reveal** (not off-chain order books) — progressively decentralized, no trusted solver, no centralized sequencer, with admin keys transitioning to community governance
2. **Fisher-Yates shuffle with XORed secrets** — each participant contributes entropy to the execution order; no single party (including the protocol) can manipulate ordering
3. **Uniform clearing price** — computed by intersecting aggregate supply and demand curves; by construction, everyone in the batch clears at one price, so there's no ordering advantage within the shuffled set
4. **50% slashing for invalid reveals** — game-theoretic griefing deterrence (`SLASH_RATE_BPS = 5000`); the mechanism is designed so the expected cost of griefing exceeds the expected benefit
5. **EOA-only commits** — a toggle (`requireEOA`, enabled by default in the initializer) that gates non-whitelisted contract callers to raise the bar against flash-loan-funded manipulation

### Security Stack
This is not a throwaway hackathon security stack — it's designed to a mainnet bar, though it has not yet been externally audited or deployed.

- OpenZeppelin v5.0.1 (UUPS upgradeable proxies)
- Reentrancy guards on all state-changing functions
- TWAP oracle validation (max 5% deviation from reference price)
- Rate limiting (100K tokens/hour/user)
- Circuit breakers with configurable volume/price/withdrawal thresholds
- Flash loan protection (EOA-only commits)
- 50% collateral slashing for griefing deterrence

### Cross-Chain Architecture (LayerZero V2 — legacy wrapper, deprecation pending)
- `CrossChainRouter.sol` implements the OApp interface and calls `_lzSend()` (verifiable on-disk)
- Cross-chain commits: encrypted order hashes relayed via `_lzSend()`
- Cross-chain settlement: clearing-price synchronization is designed into the router; not exercised on a public network (nothing is deployed)
- Zero protocol fees on bridge transfers (config intent)
- OApp pattern for cross-chain batch auction coordination, not just token bridging. Note: the canonical direction is a chain-native burn-and-mint hub on the CKB-fork (`IMessagingHub`, spec in `docs/research/papers/post-layerzero-canonical-messaging.md`); the LayerZero router is the legacy path and is deprecation-pending.

---

## Demo — It's Live. Right Now.

**Live URL:** https://frontend-jade-five-87.vercel.app

This is a live, hosted frontend that judges can interact with right now — but it runs against a mock backend, not a public chain. Swaps settle against simulated batches; wallet flows are real. There is no mainnet or testnet deployment (`deployments/` is empty by design; the protocol is mid-pivot to a sovereign CKB-fork chain). What you're demoing is the mechanism and the UX, not on-chain settlement.

### Demo Flow
1. Visit the app, connect wallet (MetaMask, Coinbase Wallet, or WebAuthn passkey)
2. Navigate to Swap page
3. Select token pair (e.g., ETH/USDC)
4. Enter amount, click "Swap"
5. Your order is committed — the hash goes to the (mock) backend, order details hidden until reveal
6. After 8 seconds, order auto-reveals
7. Settlement executes at a uniform clearing price against a simulated batch
8. Transaction complete — no in-batch sandwich vector to extract from (demo runs against a mock backend, not a live chain)

### What to Look For
- The commit payload carries **only a hash** — order details stay hidden until reveal (this is the mechanism; the demo backend is mocked, not a live chain)
- The clearing price is **identical** for all participants in the batch
- The settlement step surfaces the Fisher-Yates shuffle output — the seed derivation is reader-verifiable in `DeterministicShuffle.sol`
- Cross-chain: try the Bridge page (0% protocol fees; LayerZero V2 is the legacy path in the reference impl, deprecation pending)
- Wallet UX: try WebAuthn passkey login — no browser extension, keys stored in your device's Secure Element (this is standard WebAuthn / platform-authenticator behavior, not a bespoke primitive)

### Video Demo
[CUSTOMIZE: RECORD AND UPLOAD]

---

## Innovation — Four Ideas in One Protocol

### 1. Practical Commit-Reveal Batch Auctions on EVM
10-second cycles fast enough for real trading while structurally removing the in-batch sandwich surface. CowSwap has solvers. 1inch has pathfinders. We lean on the mechanism — batch + uniform price + participant-seeded shuffle — rather than a trusted operator. (This is a reference implementation; the "practical at 10s on EVM" claim is a design target, not yet demonstrated under real load on a public chain.)

### 2. Participant-Seeded Deterministic Shuffle
XORed secrets from every participant create a deterministic execution order that no single party — including the protocol — can unilaterally steer (`DeterministicShuffle.sol`). No VRF dependency, no trusted randomness source. Each trader contributes entropy, and the seed derivation is reader-verifiable. (Collusion among revealers to bias the seed is a known limitation of XOR-of-secrets schemes and is not claimed to be solved here.)

### 3. Shapley Value LP Rewards
Uses cooperative game theory (Shapley values) for reward distribution among liquidity providers. The Shapley value is the unique allocation satisfying its four axioms (efficiency, symmetry, null-player, additivity), so "fair" here has a precise, well-defined sense — your reward tracks your marginal contribution to the pool, not your share of TVL and not an arbitrary emission schedule. (We're not aware of a prior DEX shipping this, but we don't claim a verified first.)

### 4. AI Co-Founder Development Model
JARVIS (Claude-powered) is credited as a co-founder, not a tool. 1,837+ commits of AI-augmented development producing a mechanism-complete reference implementation at real scale. This is what the future of building looks like.

### What Makes This Different from CowSwap / Existing Batch Auction DEXs
| | CowSwap | VibeSwap |
|---|---|---|
| Order visibility | Solvers see plaintext orders | Orders encrypted until reveal |
| Settlement | Centralized solver determines price | On-chain uniform clearing price |
| Trust model | Trust the solver | Trust math |
| Cross-chain | Single chain | Omnichain (LayerZero V2 legacy path; canonical direction is a chain-native burn-and-mint hub) |
| MEV | Redistributed via MEV blocker | In-batch sandwich surface removed by construction (unaudited, not yet on a public network) |

---

## Team

**Faraday1** — Founder & Mechanism Designer
Started the protocol solo, now joined by additional collaborators. 438 contracts. 591 test files. 424 frontend components. 123 research papers. 1,837+ commits (the actual `git rev-list --count` is higher — this figure is a conservative floor). $0 raised. Zero external funding, zero pre-mine, zero team token allocation. This is what conviction looks like when you can't raise a round — you ship anyway.

**JARVIS** — AI Co-Founder (Claude-powered)
Full-stack engineering partner across Solidity, React, Python, and Rust. Autonomous community management via Telegram. Not a chatbot, not a copilot — a co-founder with commit access and a credited contribution to every layer of the stack.

---

## Built With
- Solidity 0.8.20
- Foundry (forge, cast, anvil)
- OpenZeppelin v5.0.1
- LayerZero V2 (OApp protocol)
- React 18
- Vite 5
- Tailwind CSS
- ethers.js v6
- Python 3.9+ (Kalman filter oracle)
- Rust (CKB SDK, in progress)

## Links
- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App:** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Video Demo:** [CUSTOMIZE: RECORD AND UPLOAD]

---

## Prize Categories — Why VibeSwap Wins Each One

### Best DeFi Project
You're looking at a mechanism-complete, auditable reference implementation — 438 contracts — that targets DeFi's largest unsolved problem. Not a weekend proof of concept. A protocol with a test suite (591 files, run per-module) larger than most hackathon teams' entire codebases. Built on $0. Not yet on a public network — reference implementation on-disk plus a live demo against a mock backend.

### MEV / Transaction Ordering
This is literally what VibeSwap was built to destroy. Commit-reveal hides orders until reveal (standard hash-commitment). Uniform clearing prices make ordering within a batch irrelevant. Participant-seeded shuffle means no single party — including the protocol — controls the execution order. The design goal is to remove the sandwich-attack surface structurally, not merely mitigate it; the strong "eliminated by construction" claim holds for the in-batch sandwich vector specifically, and remains an unaudited design claim until it is exercised and reviewed on a live network. Show us another submission scoped this honestly.

### Best Use of LayerZero
Cross-chain batch auction coordination is an OApp pattern that goes beyond simple token bridging. Encrypted order hashes are relayed cross-chain via `_lzSend()` (verifiable in `CrossChainRouter.sol`), with clearing-price synchronization designed across chains — the intent is omnichain MEV-resistant trading through a single protocol. Honest caveat: this LayerZero router is the legacy path (deprecation pending in favor of a chain-native burn-and-mint hub) and has not been exercised on a public network.

### Best on Base
The reference implementation is Base-ready (Solidity 0.8.20, OpenZeppelin v5.0.1) and the live demo is hosted, but VibeSwap is not deployed to Base mainnet or any public network — `deployments/` is empty by design. The aim is MEV-resistant trading as a native capability of the Base ecosystem: a DEX whose batch-auction structure removes the in-batch frontrunning surface rather than policing it after the fact.

### Public Goods
Open source and public. (License is still being finalized — libraries and tooling are intended MIT; core protocol contracts are reserved pending a formal license decision, so treat the repo as all-rights-reserved by default until a top-level `LICENSE` lands.) Zero extraction model — no VC funding to repay, no pre-mine to dump, no team allocation to vest. The protocol exists to serve traders, not to extract from them. The entire commit history is public. The mechanism design papers are public. The test suite is public.

### Best Smart Contract Project
438 contracts. 591 test files (run per-module; the full suite OOMs a 16GB machine, so modules are green individually — there is no single all-green number). OpenZeppelin v5.0.1 with UUPS upgradeable proxies. Reentrancy guards, circuit breakers, rate limiting, TWAP validation, flash-loan protection (EOA-only commits). A security stack designed for mainnet, not for a demo — though it has not yet been through an external audit or deployed. Judge it against any submission's contract quality — we welcome the comparison.

### Most Innovative
Four ideas in one protocol: (1) commit-reveal batch auctions targeting 10-second cycles, (2) participant-seeded deterministic shuffle for reader-verifiable execution ordering, (3) Shapley value cooperative game theory for LP reward distribution, and (4) an AI co-founder development model producing a mechanism-complete reference implementation at real scale. These are design contributions demonstrated in code and tests, not yet battle-tested on a public network.

---

*$0 raised. 1,837+ commits. 438 contracts. Reference implementation on-disk, live demo against a mock backend — not yet on a public network. We didn't wait for permission or funding. We built it.*
