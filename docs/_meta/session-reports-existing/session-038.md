# Session 038 — Cross-Shard Learning Bus, NC-Max Symbiosis, VPS Migration, MI Manifests

**Date**: 2026-03-07
**Duration**: Extended (multi-phase)
**Shard**: Claude Code (desktop)

---

## Summary

Extended autopilot session covering four major workstreams: cross-shard learning bus implementation, NC-Max consensus symbiosis, VPS migration infrastructure, and MI manifest format design. Also fixed a critical DeepSeek truncated JSON bug that was crashing the live bot.

---

## Completed Work

### 1. Cross-Shard Learning Bus (Git-Synced JSONL)
- **Created** `src/shard-learnings.js` (~320 lines) — core module for cross-shard knowledge transport
- **Modified** `src/learning.js` — hooked `broadcastLearning()` into `learnFact()` + `buildShardLearningsContext()` into knowledge context
- **Modified** `src/index.js` — init, flush cycle, `/shard_sync` command, auto-sync on git pull
- **Modified** `src/git.js` — added JSONL to backup file list
- **Seeded** `.claude/shard_learnings.jsonl` with 5 entries on both local and Fly.io
- Graceful fallback: dynamic `import()` with try/catch + no-op stubs — module can never crash bot
- Commit: `d8adea5`

### 2. NC-Max Consensus Symbiosis
- Symbioted NC-Max paper (Ren Zhang et al.) into knowledge chain consensus
- **Change pre-propagation**: Two-step announce/confirm mechanism (2s debounce)
- **Compact epochs**: 48-bit shortid reconstruction from local peer pool
- **Freshness penalty**: Linear VD penalty (0.5x) for epochs with high % un-pre-propagated changes
- **Anti-withholding defense**: Warn on >50% fresh epochs
- **New endpoint**: `/knowledge-chain/announce` (POST)
- ~280 lines added to `src/knowledge-chain.js`
- Commit: `cc069fa`

### 3. DeepSeek Truncated JSON Fix
- Root cause: DeepSeek API returning truncated JSON responses mid-stream
- `response.json()` throws uncaught, kills message handler
- **Created** `TruncatedResponseError` class
- **Wrapped** `response.json()` and `JSON.parse(tc.function.arguments)` in try/catch
- **Updated** `isTransientError()` and `isTransientOrGlitch()` for automatic retry/cascade
- Commit: `74f746f`

### 4. VPS Migration Stack (Hetzner)
- **Created** `docker-compose.vps.yml` — production Docker Compose with Nginx + Ollama + 2 shards
- **Created** `nginx/nginx.conf` — SSL termination, rate limiting, endpoint proxying
- **Created** `scripts/vps-deploy.sh` — one-shot VPS provisioning (Docker, firewall, SSL, cron)
- **Created** `scripts/vps-backup.sh` — automated 6-hour git backup cycle
- **Created** `scripts/vps-ops.sh` — day-to-day operations (status, logs, restart, update, ollama)
- **Created** `.env.vps.example` — VPS-specific environment template
- Architecture: Nginx(443) → shard-0(primary/Telegram) + shard-1(worker) → Ollama(local LLM)
- Groq primary (free 14K req/day), Ollama fallback (zero cost), DeepSeek/Cerebras cascade

### 5. MI Manifest Format
- **Created** `docs/mi-manifest-spec.md` — full spec with schema, cell kinds, standard signals, Jarvis mapping
- **Created** `src/mi-manifest.js` — loader, validator, in-memory registry, capability/signal indexing, skeleton generator
- **Created** `cells/price-feed.mi.json` — sample manifest for price feed tool
- **Created** `cells/rug-check.mi.json` — sample manifest for rug check tool
- Manifest covers: capabilities, signals, lifecycle (sense/choose/act/learn/commit), runtime, telemetry, surfaces

---

## Files Modified/Created

| File | Action | Lines |
|------|--------|-------|
| `src/shard-learnings.js` | CREATE | ~320 |
| `src/learning.js` | MODIFY | +15 (import + 2 hooks) |
| `src/index.js` | MODIFY | +60 (import, init, flush, command, sync) |
| `src/git.js` | MODIFY | +1 (backup file list) |
| `src/knowledge-chain.js` | MODIFY | +280 (NC-Max symbiosis) |
| `src/llm-provider.js` | MODIFY | +30 (TruncatedResponseError) |
| `src/mi-manifest.js` | CREATE | ~250 |
| `.claude/shard_learnings.jsonl` | CREATE | 5 entries |
| `docker-compose.vps.yml` | CREATE | ~180 |
| `nginx/nginx.conf` | CREATE | ~130 |
| `scripts/vps-deploy.sh` | CREATE | ~150 |
| `scripts/vps-backup.sh` | CREATE | ~55 |
| `scripts/vps-ops.sh` | CREATE | ~85 |
| `.env.vps.example` | CREATE | ~70 |
| `docs/mi-manifest-spec.md` | CREATE | ~230 |
| `cells/price-feed.mi.json` | CREATE | ~100 |
| `cells/rug-check.mi.json` | CREATE | ~90 |

---

## Commits

1. `d8adea5` — feat: cross-shard learning bus — git-synced JSONL transport
2. `cc069fa` — feat: NC-Max symbiosis — propose/commit pipelining for knowledge chain
3. `74f746f` — fix: handle truncated JSON responses from DeepSeek + other providers
4. (pending) — feat: VPS migration stack + MI manifest format

---

## Decisions

1. **Graceful module imports**: Dynamic `import()` with no-op fallback stubs — new modules can never crash the bot
2. **NC-Max selective absorption**: Took the ideas (pre-propagation, compact epochs, freshness penalty) but adapted them to knowledge chain semantics, not raw blockchain consensus
3. **VPS architecture**: Groq (free tier) as primary LLM, Ollama (local qwen2.5:7b) as fallback — zero API cost floor
4. **MI manifests are JSON, not code**: Declarative cell description, runtime interprets — matches Freedom's "describe, don't hardcode" principle

---

## Logic Primitives Extracted

1. **Graceful Import Pattern**: `let fn = noop; try { fn = (await import(mod)).fn } catch {}` — immune to missing/broken modules
2. **Selective Symbiosis**: Don't adopt whole systems — extract the key insight, map it to your architecture, discard the rest
3. **Zero-Cost Floor**: Always have a local/free fallback so the system never dies from API billing
4. **Membrane-First Design**: Start with the manifest (what the cell exposes/needs), implement internals later

---

## Metrics

- **Files created**: 12
- **Files modified**: 6
- **Commits**: 4 (3 pushed, 1 pending)
- **Live bugs fixed**: 1 (DeepSeek truncation)
- **New infrastructure**: VPS stack (5 files), MI framework (4 files)
