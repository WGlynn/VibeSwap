# Session 044e — Autonomous Hardening Pass + Ops

**Date**: 2026-03-07
**Duration**: ~40 min
**Model**: Claude Opus 4.6
**Mode**: Autonomous (standing orders: "autopilots improvements forever")

## Summary

Fifth continuation of the autonomous hardening sweep. Fixed critical consensus proposal accumulation bug (proposals from rogue shards flooding single-shard instance). Deployed Jarvis to Fly.io, cleared stale proposals, then continued systematic hardening across remaining unaudited files.

## Completed Work

### Critical Fix: Consensus Proposal Accumulation
- **Root cause**: `TOTAL_SHARDS=5` env but only 1 machine running. 4 other shard apps (shard-1, shard-2, shard-eu, shard-ollama) sending proposals to main instance.
- **Symptom**: `pendingProposals` Map growing unbounded (101+ entries in 75 seconds)
- **Fix 1**: Set `TOTAL_SHARDS=1` on main instance
- **Fix 2**: Guard `handleProposal()`, `handlePrevote()`, `handlePrecommit()` — reject incoming messages when `consensusEnabled` is false
- **Fix 3**: Content-hash dedup on retry queue (was using unique proposal IDs)
- **Fix 4**: Persist empty journal when retry queue drains
- **Fix 5**: Dedup recovered journal entries on startup
- Result: `pending: 0` stable across all health checks

### Bounded Data Structures — Round 2
- **autonomous.js**: Cap chatActivity Map at 10K entries, 7-day stale eviction
- **knowledge-chain.js**: Cap pendingChanges at 5K entries with 80% trim
- **web-api.js**: Cap rateBuckets at 10K IPs (prevents IP rotation DoS)
- **tools-catchup.js**: Cap lastSeen Map at 10K entries
- **tools-xp.js**: Cap actionCooldowns Map at 10K entries
- **claude.js**: Hard cap lastResponses Map at 5K entries

### Buffer & Concurrency Safety
- **limni.js**: Cap tradeLog (5K) and alerts (2K) buffers. Add concurrency guard to monitor loop (prevents overlapping async ticks via `monitorRunning` flag)
- **sticker.js**: Add depth limit (5) + guard against no font size reduction in recursive `wrapText()`
- **group-context.js**: Store cleanup interval ref, export `stopGroupContext()`, wire into shutdown sequence

### API Response Validation
- **fetchJSON() in 3 files**: Add `resp.ok` check before `.json()` in shared helpers (tools-engagement, tools-catchup, tools-alpha — used 20+ times)
- **tools-derivatives.js**: Add `resp.ok` check in CoinGecko fallback paths
- **tools-news.js**: Add `resp.ok` to HackerNews top stories + individual story fetches. Switch to null-return on failure instead of crashing Promise.all()

### Error Visibility
- **autonomous.js**: Log market check failures instead of silent swallow
- **intelligence.js**: Log self-evaluation errors instead of silent `.catch(() => {})`

## Commits

| Hash | Description | Files | Delta |
|------|-------------|-------|-------|
| `fa30d16` | Fix consensus proposal accumulation in single-shard mode | 1 | +18/-6 |
| `415419f` | Bound unbounded data structures + shutdown hygiene | 5 | +42/-3 |
| `240fe82` | Recursion safety, buffer caps, concurrency guards | 4 | +26/-7 |
| `ef6371d` | Add resp.ok checks to all fetchJSON helpers and API calls | 6 | +30/-4 |

## Test Results

114/114 passing (verified 4 times during session)

## Health Checks

7 health checks performed during session — all passed:
- `status: ok` | `pending: 0` | provider switching between `claude` and `deepseek` (Wardenclyffe working)
- Max uptime observed: 527s between deploys
- 4 deploys to Fly.io, all successful with health checks passing

## Files Modified (16 total)

- `jarvis-bot/src/consensus.js` — Content-hash dedup, single-shard guards, journal cleanup
- `jarvis-bot/src/autonomous.js` — chatActivity cap, market check error logging
- `jarvis-bot/src/knowledge-chain.js` — pendingChanges cap
- `jarvis-bot/src/web-api.js` — Rate limiter IP cap
- `jarvis-bot/src/group-context.js` — Stored interval, stopGroupContext()
- `jarvis-bot/src/index.js` — Wire stopGroupContext into shutdown
- `jarvis-bot/src/intelligence.js` — Score log error visibility
- `jarvis-bot/src/sticker.js` — Recursive depth limit
- `jarvis-bot/src/limni.js` — Buffer caps, monitor concurrency guard
- `jarvis-bot/src/claude.js` — lastResponses hard cap
- `jarvis-bot/src/tools-engagement.js` — fetchJSON resp.ok
- `jarvis-bot/src/tools-catchup.js` — fetchJSON resp.ok, lastSeen cap
- `jarvis-bot/src/tools-alpha.js` — fetchJSON resp.ok
- `jarvis-bot/src/tools-derivatives.js` — CoinGecko fallback resp.ok
- `jarvis-bot/src/tools-news.js` — HN resp.ok, Promise.all resilience
- `jarvis-bot/src/tools-xp.js` — actionCooldowns cap

## Ops Actions

- Set `TOTAL_SHARDS=1` on Fly.io (was misconfigured as 5)
- Cleared 43 stale duplicate SOCIAL-030 proposals from journal
- 5 other shard apps left running per Will's instruction
- 4 successful deploys to production

## Logic Primitives Extracted

1. **Content-Hash Dedup**: Use content hashes (not unique IDs) for dedup in retry queues. Every retry creates a new unique ID, but the content is identical.
2. **Guard at Boundaries**: When a system can receive external messages (consensus proposals), always check if the subsystem is enabled before processing. Disabled subsystems should reject, not accumulate.
3. **Drain Persistence**: When a queue drains to empty, persist the empty state. Otherwise stale data remains on disk and gets recovered on restart.

## Metrics

- Survey false positive rate: ~50% (limni timeouts, claude circuit breakers, group-context bounds all already handled)
- Real fixes applied: 20 across 16 files
- Zero regressions introduced
- Cumulative hardening across sessions 044a-044e: ~75 fixes, 0 test failures
- Health checks: 7/7 passing
