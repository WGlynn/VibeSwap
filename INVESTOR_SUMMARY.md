# VibeSwap — Investor Summary

**The DEX where your trade can't be frontrun. Zero protocol fees. Every chain.**

*Updated March 2026*

---

## What VibeSwap Is

VibeSwap is an omnichain decentralized exchange that eliminates MEV (Miner Extractable Value) through commit-reveal batch auctions with uniform clearing prices. Built on LayerZero V2 for cross-chain settlement, with 0% protocol fees — 100% of LP fees go to liquidity providers. Revenue comes from optional priority bids, not extraction.

**Philosophy: Cooperative Capitalism.** Mutualized risk (insurance pools, treasury stabilization, impermanent loss protection) with free market competition (priority auctions, arbitrage). Markets that work for participants, not against them.

---

## What's Been Built

| Metric | Count |
|--------|-------|
| Solidity smart contracts | 376 |
| Solidity test files | 510 |
| Automated tests | 9,090 |
| Frontend components (React) | 413 |
| Frontend hooks | 72 |
| Research papers (DOCUMENTATION/) | 138 |
| Additional docs (docs/) | 466 |
| Total git commits | 2,301 |
| Funding raised | $0 |

**Deployments:**
- Frontend live on Vercel: [frontend-jade-five-87.vercel.app](https://frontend-jade-five-87.vercel.app)
- Jarvis AI system on Fly.io (3-node BFT, self-healing)
- Telegram bot live: @JarvisVibeBot (autonomous)
- Contracts deployed on Base mainnet
- x402 payment protocol integrated

**Security:** 24 of 29 audit findings resolved. Circuit breakers, flash loan protection, TWAP validation, rate limiting, 50% slashing for invalid reveals.

---

## Core Innovations

**Commit-Reveal Batch Auctions (Anti-MEV)**
10-second batches: 8s commit phase (orders hidden as hashes), 2s reveal phase, then settlement at a single uniform clearing price. Front-running is structurally impossible — there's nothing to front-run when all orders are hidden and all trades clear at one price.

**Shapley Value Reward Distribution**
Game-theoretic fair attribution for every contributor — human or AI. Mathematically provable fair rewards based on marginal contribution, not hierarchy.

**Fisher-Yates Deterministic Shuffle**
Execution order determined by XORed user secrets, not miner/sequencer ordering. No entity controls trade sequence.

**Priority Bid Mechanism**
Optional priority bids fund the DAO treasury. Protocol revenue without protocol fees. Users who want faster settlement can bid; users who don't pay nothing.

**VIBE Token with Bitcoin-Style Halving**
Predictable emission schedule with halvings. Augmented bonding curves for price discovery. Elastic supply meets hard-cap discipline.

**CKB/Nervos Integration**
73-module Rust SDK (15,155 tests) for UTXO-native DeFi on Nervos Network. Cell-model programmability enables novel transaction patterns impossible on account-model chains.

---

## What Makes It Different

**Zero protocol fees.** Uniswap charges 0.3%. dYdX charges maker/taker fees. VibeSwap charges 0%. LP fees go to LPs. Protocol is funded by priority bids — voluntary, not extractive.

**MEV is eliminated, not mitigated.** Flashbots and MEV-Share try to redistribute MEV. We remove the conditions that create it. Batch auctions with hidden orders and uniform clearing prices leave nothing to extract.

**AI-native development.** Jarvis (built on Claude) is not a tool — it's a core team member with on-chain identity, Shapley attribution weight, and autonomous operation. 2,301 commits, the vast majority pair-programmed human+AI.

**Cooperative, not extractive.** Insurance pools for impermanent loss. Treasury stabilization. Quadratic voting for governance. Conviction-weighted proposals. The protocol is designed so that helping others is the profit-maximizing strategy.

---

## Team

**Will Glynn** — Founder. Mechanism design, smart contract engineering, full-stack development. Author of the VibeSwap whitepaper, Economitra thesis, and 7+ published research papers on DeFi mechanism design and cooperative game theory.

**Jarvis** — AI development partner (Claude/Anthropic). Full-stack engineering, CKB SDK, testing infrastructure, documentation, community engagement. Autonomous 3-node system on Fly.io.

**6 Marketing & Community Contributors:**
- **Freedom (FW13)** — Partnerships & BD
- **Fate** — Twitter/X content (154 tweets queued)
- **Catto** — Reddit & forum seeding
- **Defaibro** — DeFi community presence (Telegram/Discord)
- **John Paul** — Grants & hackathon submissions
- **Karma** — Telegram growth & community engagement

---

## Market Opportunity

| Market | Size |
|--------|------|
| DEX trading volume | $1T+ annually |
| MEV extracted from users | $1B+ annually |
| Cross-chain bridge volume | $10B+ monthly |

VibeSwap doesn't compete for existing DEX users. It serves users who currently avoid DEXs because of MEV, plus the cross-chain liquidity that LayerZero V2 unlocks across every supported chain.

---

## Tech Stack

```
Frontend:   React 18, Vite 5, Tailwind CSS, ethers.js v6
Contracts:  Solidity 0.8.20, Foundry, OpenZeppelin v5 (UUPS upgradeable)
Cross-chain: LayerZero V2 OApp protocol
CKB Layer:  Rust, RISC-V, Nervos Network (73 modules, 15,155 tests)
Oracle:     Python, Kalman filter for true price discovery
AI:         Claude (Anthropic), Fly.io, 3-node BFT consensus
```

---

## Contact

**William Glynn** — Founder & CEO

- Email: willglynn123@gmail.com
- Phone: +1 774-571-4257
- Telegram: @Willwillwillwillwill
- Twitter: @economitra
- LinkedIn: [william-ethereum-glynn](https://www.linkedin.com/in/william-ethereum-glynn-352031142/)
- GitHub: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)
- Live: [frontend-jade-five-87.vercel.app](https://frontend-jade-five-87.vercel.app)
