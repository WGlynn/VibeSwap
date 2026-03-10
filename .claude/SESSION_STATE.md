# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2026-03-09 (Desktop - Claude Code Opus 4.6, Session 052)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- **Jan Xie (Nervos CKB chief architect) responded to our CKB DeFi Primitives paper** — impressed, caught missing `solver_lock_hash` in PoW challenge (Section 6.2). Paper updated, committed `387ccfb`, pushed to both remotes.
- **SOVEREIGN AUTONOMY LAYER DEPLOYED** — wallet.js, social.js, proactive.js live on Fly.io
- **LIGHT CONTEXT TIER DISABLED** — Jarvis was hallucinating in groups (JUL/JulSwap confusion). Now always sends full 75K context.
- **Dr. Nadal Visit**: Vercel chat is FREE, warm, no token gates. DeepSeek primary, Anthropic fallback.
- **Proactive engine ENABLED** — market pulse, build updates, thought pieces scheduled

## Autonomy Layer (ALL DEPLOYED — Fly.io)
**wallet.js**: EOA `0x51Ec19638455b1eA2fCf299e17cb9862FE0b12A4`
- Passphrase: `vibe-sovereign-mind-2026` (retrieve mnemonic via TG DM: `/wallet mnemonic <passphrase>`)
- $50/day limit, whitelist-only, 4 chains (Base/ETH/Arb/OP), NOT FUNDED YET
- First wallet leaked on stream — regenerated, old mnemonic burned

**social.js**: Twitter + GitHub CONNECTED, Discord PENDING
- Twitter: 5 API keys set as Fly.io secrets
- GitHub: PAT set (WGlynn/VibeSwap repo access)
- Discord: Will doing tomorrow — needs webhook URL

**proactive.js**: ENABLED — 5 actions active
- market_pulse (6h), build_update (24h), thought_piece (12h), monitor_mentions (4h), queue_flush (2h)
- Needs LLM function wired for content generation (currently no llmFn passed)
- `jarvis-bot/src/index.js` — triggerednometry unlimited, tbhxnest REMOVED, task queue init/flush/stop
- `jarvis-bot/src/memory.js` — Rule #10: never say "I'll check" without calling defer_task

## Session 052 Completed Work

### Contracts
- **VibePointsSeason.sol** — Seasonal leaderboard & cross-system points aggregator (37/37 tests, 34 unit + 3 fuzz)

### Vercel Serverless Endpoints
- **`/api/prices`** — Three-source oracle: CoinGecko (primary) + Chainlink (referee on Base mainnet) + TruePriceOracle (future)
  - Chainlink feeds: ETH, BTC, LINK, USDC, DAI via AggregatorV3Interface
  - 1% deviation threshold, auto-override if Chainlink disagrees
  - 30s CoinGecko cache, 60s Chainlink cache, CDN edge caching
- **`/api/chat`** — Provider cascade: DeepSeek-chat → Anthropic Haiku
  - System prompt: JARVIS personality — warm, genuine, adaptive, work-curiosity nudge
  - Zero token gates, zero mining, zero budget limits
  - 30 message history, 4000 chars/msg, 2048 max_tokens

### Jarvis Bot (committed, NOT deployed)
- **Task Queue** (`task-queue.js`): 5 task types, persistent JSON, 30s background processor, 3 retries w/ exponential backoff, auto-reports to originating chat
- **defer_task tool**: LLM can schedule deferred work instead of hallucinating "I'll check later"
- **Access changes**: triggerednometry → UNLIMITED, tbhxnest → REVOKED (all access removed)

### Frontend Fixes
- Removed "Mine JUL for Extra Compute" button from JarvisBubble.jsx
- Removed budget-exceeded amber styling from chat messages
- useJarvis.jsx: VPS failure → auto-fallback to Vercel `/api/chat` (silent, no budget errors shown)

### Key Decisions
- Budget gates temporarily removed for Dr. Nadal visit — will restore when scaling
- tbhxnest fully revoked — "genuine threat to our light"
- triggerednometry (Rodney) gets unlimited compute — building trading bot for VibeSwap
- DeepSeek for casual chat (cheap), Anthropic as safety net only
- Chainlink as referee (cross-validation), not primary oracle

## Access Control (Current)
- **UNLIMITED_USERNAMES**: `['vibeswapofficial', 'triggerednometry']`
- **tbhxnest**: ALL access revoked, references cleaned from codebase
- **Freedom (Freedomwarrior13)**: STAYS — active collaborator, POM consensus design partner

## Infrastructure
- **Vercel**: Deployed 2026-03-09 — `frontend-jade-five-87.vercel.app`
- **Fly.io**: STALE — needs redeploy with task queue + access changes
- **Hetzner VPS**: `46.225.173.213` — Jarvis shard-0, Engram cloud, Cloudflare tunnel
- **DeepSeek API**: Added to Vercel env vars (`DEEPSEEK_API_KEY`)

## Previous Context (Carried Forward)
- BASE MAINNET PHASE 2: LIVE — 11 contracts deployed + verified on Basescan
- 3000+ Solidity tests passing, 0 failures
- CKB: 190 Rust tests, ALL 7 PHASES + RISC-V + SDK COMPLETE
- JARVIS Mind Network: 3-node BFT on Fly.io
- PsiNet × VibeSwap merge: COMPLETE
- 27 research papers (1.2 MB), 71 knowledge primitives
- Git remotes: origin (public) + stealth (private) — push to both
- Voice bridge: `jarvis-bot/voice-bridge.html` (built Session 050, VB-Cable installed)
