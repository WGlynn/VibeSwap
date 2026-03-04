# Session 037 — Mining Security Hardening (Post-Power Outage Recovery)

**Date**: 2026-03-03
**Duration**: ~30 min
**Trigger**: Power outage during mining feature work on Telegram Live3

## Summary

Recovered from power outage mid-session. Verified all prior work (Session 036's Shard Miner feature) was committed and pushed. Ran full security audit of the mining subsystem, found critical exploits, and fixed them all.

## Completed Work

### 1. Recovery & State Assessment
- Verified all 3 mining commits from Session 036 were safely pushed to both remotes
- Confirmed Fly.io deployment healthy (v59, health checks passing)
- Identified stale shard `mobile-be7af1738b76ca2c` logging DOWN every 5 min (35+ entries)

### 2. Security Audit — 24 Findings (4 Critical, 8 High, 8 Medium, 4 Low)

Full audit of `mining.js`, `web-api.js`, `miner-worker.js`, and `useMiner.js`.

**Critical findings fixed:**
- **userId fully attacker-controlled** — anyone could credit any account with JUL
- **initData validation optional** — non-Telegram clients bypassed auth entirely
- **Epoch replay race** — replay set cleared before challenge rotated, enabling double-spend
- **validateTelegramInitData fail-open** — returned `true` when bot token missing

### 3. Fixes Implemented (13 total)

| Fix | File | Impact |
|-----|------|--------|
| Mandatory Telegram initData | web-api.js | Closes free-money exploit |
| Extract userId from initData | web-api.js | Prevents userId spoofing |
| 64KB body size limit | web-api.js | Prevents memory exhaustion DoS |
| Fail-closed on missing bot token | web-api.js | No more silent auth bypass |
| Input format validation | web-api.js | Rejects malformed nonce/hash/challenge |
| Epoch replay race fix | mining.js | Challenge rotates before replay set clears |
| Rate limit map cleanup | mining.js | Prevents unbounded memory growth |
| Stale shard auto-eviction | router.js | Shards evicted after 10 missed heartbeats |
| Generation counter | miner-worker.js | Prevents concurrent miningLoop() instances |
| Min difficulty=1 | miner-worker.js | Prevents message flood on difficulty=0 |
| hexToBytes validation | miner-worker.js | Rejects odd-length/invalid hex |
| Hashrate aggregation fix | useMiner.js | Sum per-worker rates, not multiply |
| Double-click guard | useMiner.js | Prevents orphaned worker leak |

## Files Modified

- `jarvis-bot/src/router.js` — stale shard eviction (+21 lines)
- `jarvis-bot/src/web-api.js` — auth hardening, body limit, input validation (+58/-4)
- `jarvis-bot/src/mining.js` — epoch race fix, rate limit cleanup (+14/-1)
- `jarvis-bot/webapp/src/hooks/useMiner.js` — hashrate fix, double-click guard (+22/-8)
- `jarvis-bot/webapp/src/workers/miner-worker.js` — generation counter, validation (+10/-1)

## Test Results

- All changes are runtime-validated (Node.js server-side + Vite webapp client-side)
- Deploy triggered to Fly.io for production verification

## Decisions Made

- **Telegram initData now mandatory** for mining — no more anonymous mining. This is correct because the Mini App is Telegram-only by design.
- **Shard eviction threshold: 10 missed heartbeats (~50 min)** — generous enough for network hiccups, strict enough to prevent log pollution
- **Body size limit: 64KB** — more than enough for any legitimate mining submission (~200 bytes)

## Logic Primitives Extracted

1. **Fail-Closed Authentication**: Default-deny when auth infrastructure is missing. `if (!token) return true` is always wrong for security-critical paths.
2. **Order-of-Operations in State Transitions**: When clearing replay protection + rotating challenges, the new challenge must be active BEFORE the replay set clears. Otherwise there's a window where old proofs can replay.
3. **Generation Counter Pattern**: When async loops can be restarted via message passing, capture a generation number at loop start and check it on every iteration. `generation++` in the start handler kills all previous loops without explicit cancellation.
4. **Bind Identity at the Gate**: Never trust identity from request body. Extract it from the authenticated credential (initData HMAC → user.id) at the API boundary.

## Metrics

- First-try success: 13/13 edits
- Zero compilation errors
- Audit-to-fix time: ~20 min for 13 fixes across 5 files
