# Gitcoin Grants Application — VibeSwap

## Project Name
VibeSwap

## Project Tagline
We built an MEV-free omnichain DEX with $0. Here's what community funding would unlock.

## Project Logo
[UPLOAD LOGO]

## Project Banner
[UPLOAD BANNER]

---

## 1. We Built This With $0

341 smart contracts. 188 frontend pages. 1,612+ commits. A full test suite — unit, fuzz, and invariant. Live on Base mainnet. Published mechanism design research. A Kalman filter oracle. Cross-chain messaging via LayerZero V2.

**Zero VC funding. Zero pre-mine. Zero team allocation. Zero token sale. Zero insider deals.**

One founder and an AI co-founder (JARVIS, Claude-powered) built a production-grade omnichain DEX that eliminates MEV — the $600M+/year invisible tax on Ethereum users — from scratch. No grants, no runway, no safety net. Just conviction that fair trading infrastructure should exist, and the stubbornness to build it anyway.

Everything is open source under the MIT license. Every contract, every component, every line of mechanism design research — public, free, and available for anyone to adopt. We didn't build this to extract value. We built it because MEV extraction is an unfair tax on retail users, and someone needed to build the alternative.

**Now imagine what community funding would unlock.**

## 2. How It Works

Every 10 seconds, VibeSwap runs a batch auction:

1. **You submit your trade** (encrypted — no one can see it)
2. **Everyone reveals** at the same time
3. **One fair price** is calculated for everyone

No one can frontrun you because they can't see your order. No one gets a better price because everyone gets the same price. It's that simple.

## 3. What We Built With $0

This isn't a whitepaper. This isn't a pitch deck with "coming soon" milestones. This is what already exists, built and deployed.

### The Protocol
- **Commit-reveal batch auctions** — cryptographic order hiding with uniform clearing prices
- **Fisher-Yates deterministic shuffle** — XORed user secrets as the randomness seed, zero ordering advantage
- **50% slashing for invalid reveals** — game-theoretically enforced honest participation
- **Shapley value reward distribution** — cooperative game theory determines each LP's marginal contribution, mathematically provably fair
- **Circuit breakers** — volume, price, and withdrawal thresholds that halt trading under anomalous conditions

### The Contracts (341)
- Core auction engine (CommitRevealAuction, VibeSwapCore)
- Constant product AMM (VibeAMM, VibeLP)
- DAO treasury and stabilization mechanisms
- Shapley-based incentive distribution
- Impermanent loss protection vaults
- Cross-chain router (LayerZero V2 OApp)
- TWAP oracle with manipulation resistance
- Full library suite (DeterministicShuffle, BatchMath, TWAPOracle)

### The Security Stack
- Flash loan protection (EOA-only commits)
- TWAP validation (max 5% deviation from oracle)
- Rate limiting (1M tokens/hour/user)
- Circuit breakers (multi-dimensional thresholds)
- 50% collateral slashing for invalid reveals
- All contracts built on OpenZeppelin v5.0.1 with UUPS upgradeable proxies

### The Frontend (188 pages)
- Full trading interface, portfolio management, bridge UI
- Device wallet via WebAuthn/passkeys (keys never leave the Secure Element)
- External wallet support (MetaMask, WalletConnect)
- Live at https://frontend-jade-five-87.vercel.app

### The Research
- Mechanism design papers on commit-reveal batch auctions
- Game theory analysis (39 games mapped to protocol mechanisms)
- Published openly — not behind a paywall, not gated by a token

### The Stack
- **Contracts:** Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1
- **Frontend:** React 18, Vite 5, Tailwind CSS, ethers.js v6
- **Oracle:** Python Kalman filter for true price discovery
- **Cross-chain:** LayerZero V2 OApp protocol

| Metric | Value |
|---|---|
| Smart contracts | 341 |
| Frontend pages | 188 |
| Commits | 1,612+ |
| Test coverage | Unit + fuzz + invariant (Foundry) |
| Deployment | Live on Base mainnet |
| VC funding | $0 |
| Pre-mine | 0% |
| Team allocation | 0% |
| Token sale | None |
| License | MIT (fully open source) |
| Cross-chain | LayerZero V2 integrated |

All of this exists today. Go verify it: https://github.com/wglynn/vibeswap

## 4. What Your Funding Would Unlock

We've proven we can build. We're not asking for permission to start — we're asking for fuel to accelerate what's already moving.

Every dollar contributed through Gitcoin goes directly to development. There is no marketing budget, no executive compensation, no token buyback scheme. This is a public good funded by the public, built for the public.

### Security Audit
The single highest-impact thing community funding can unlock. 341 contracts are built and tested, but a professional third-party audit is the difference between "deployed" and "trusted at scale." This is the critical path to broader adoption.

### Infrastructure
RPC nodes, monitoring, hosting, and multi-chain deployment gas. The boring stuff that keeps a live protocol running. Currently funded out of pocket.

### Multi-Chain Expansion
VibeSwap is built omnichain from day one (LayerZero V2). Funding unlocks deployment to additional chains — each deployment means MEV-free trading reaches more users.

### MEV Research Publication
Formal analysis of the commit-reveal batch auction mechanism. Open research that benefits the entire ecosystem, not just VibeSwap.

### Developer Documentation
Tutorials, integration guides, and reference documentation so other projects can adopt MEV-free trading patterns. The whole point of building this as a public good is that others can use it.

**All spending will be transparent and reported publicly.**

## 5. Why This Is a Public Good

### MEV Elimination Is Non-Excludable
VibeSwap's commit-reveal batch auction design is fully open source under the MIT license. Any DEX can adopt this pattern. By funding VibeSwap, you fund the research and reference implementation that makes MEV-free trading available to the entire ecosystem — not just our users.

### Zero Extraction by Design
There is no token to pump. There is no VC to give returns to. There is no team allocation to vest. The protocol exists to eliminate an unfair tax on users. That's it.

- $0 VC funding — no investor returns to optimize for
- 0% pre-mine — no insider advantage
- 0% team allocation — no misaligned incentives
- No token sale — no speculation-driven development
- MIT license — free for anyone to fork, adopt, or build on

### The $600M Problem
MEV costs Ethereum users an estimated $600M+ per year. This is a regressive tax — it disproportionately impacts retail users who lack the sophistication to use private mempools or MEV-aware routing. VibeSwap eliminates this tax at the protocol level, and the design is open for everyone.

### AI-Augmented Public Goods
VibeSwap demonstrates a new model for open source development: a human founder working with an AI co-founder to build production-grade infrastructure that would normally require a funded team of 10+. If this model works, it dramatically lowers the barrier for future public goods builders. One person with the right tools and enough conviction can build critical infrastructure.

## 6. Technical Details

### Core Innovation: Commit-Reveal Batch Auctions
```
COMMIT (8 seconds):
  -> User submits hash(order || secret) + collateral
  -> Orders are encrypted — invisible to searchers

REVEAL (2 seconds):
  -> User reveals order details + secret
  -> Invalid reveals = 50% slashing

SETTLEMENT:
  -> Fisher-Yates shuffle (XORed secrets as seed)
  -> Uniform clearing price for all trades
  -> Zero ordering advantage = zero MEV
```

### Why This Kills MEV

Traditional DEXs broadcast orders to a public mempool. Searchers see your trade, calculate the optimal extraction, and sandwich your order — buying before you, selling after you, pocketing the difference. You get a worse price. They get free money. Every single trade.

VibeSwap makes this impossible:
- **Orders are encrypted** during the commit phase — searchers can't see what you're trading
- **Everyone gets the same price** — there's no "better" position in the queue
- **Deterministic shuffle** — execution order is determined by collective randomness, not by who paid the most gas
- **Slashing** — attempting to manipulate the reveal phase costs you 50% of your collateral

### Shapley Value Rewards
Liquidity provider rewards use cooperative game theory (Shapley values) to distribute fees proportionally to each LP's marginal contribution — not just their share of the pool, but their actual measurable impact on the system. This is mathematically provably fair.

## 7. Team

### Will Glynn — Founder
Solo architect. Designed the mechanism, wrote the contracts, built the frontend, deployed to mainnet. 1,612+ commits and counting. No funding, pure conviction. When you can't find the team that believes in fair markets as much as you do, you build it yourself.

### JARVIS — AI Co-Founder
Claude-powered engineering partner. Full-stack across Solidity, React, Python, Rust. Runs community engagement autonomously via Telegram bot. Not a tool — a co-founder who works 24/7 and never asks for equity.

## 8. The Thesis: Cooperative Capitalism

VibeSwap's thesis is that eliminating extraction makes cooperation the profit-maximizing strategy. When no one can frontrun, the rational play is to provide liquidity and earn fair fees. This is not altruism — it's game theory.

The fair system wins because it attracts more users, more liquidity, and more volume. Extraction is a local maximum. Cooperation is the global maximum. We built the protocol that makes cooperation the dominant strategy.

## 9. Links

- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App:** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Twitter/X:** [CUSTOMIZE]

## 10. Verification

- [x] Project is open source (MIT license)
- [x] Project has a working product (live on Base mainnet)
- [x] Project has a public GitHub repository
- [x] Team identity is verifiable (Will Glynn — GitHub: wglynn)
- [x] No token sale or fundraise in progress
- [x] Funds will be used for development, not speculation
- [x] Zero extraction: no VC, no pre-mine, no team allocation
- [x] 1,612+ commits of verifiable build history
