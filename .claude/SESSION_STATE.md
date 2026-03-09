# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2026-03-09 (Desktop - Claude Code Opus 4.6, Session 052)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- **SOVEREIGN AUTONOMY LAYER DEPLOYED** — wallet.js, social.js, proactive.js live on Fly.io
- **Dr. Nadal Visit**: Psychiatrist + husband checking Vercel site. Chat is FREE, warm, no token gates.
- **System prompt deployed**: JARVIS personality rewrite — warm, present, adaptive. Subtle work-curiosity nudge.
- **Provider cascade live**: DeepSeek (cheap) → Anthropic Haiku (fallback) on Vercel `/api/chat`
- **Prices oracle live**: `/api/prices` — CoinGecko + Chainlink cross-validation on Base mainnet
- **Fly.io DEPLOYED** — task queue, access changes, AND autonomy layer all live

## Autonomy Layer (DEPLOYED — Fly.io)
**wallet.js**: EOA management, AES-256-GCM encryption, $50/day limit, whitelist-only, 4 chains (Base/ETH/Arb/OP)
- `/wallet create <passphrase>` to generate — NO WALLET EXISTS YET (Will must create)
- LLM tools: wallet_info, wallet_send, wallet_sign

**social.js**: Outbound X/Twitter, Discord, GitHub presence
- Credentials from env vars (TWITTER_BEARER_TOKEN, DISCORD_WEBHOOK_URL, GITHUB_TOKEN)
- Currently: NONE configured — Will needs to set env vars on Fly.io
- LLM tools: social_post, social_status, social_queue

**proactive.js**: Autonomous scheduled actions — master switch OFF by default
- Actions: market_pulse (6h), build_update (24h), thought_piece (12h), monitor_mentions (4h)
- `/proactive enable` to activate — requires social credentials first
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
