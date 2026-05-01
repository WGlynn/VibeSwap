# Session 044c — Hardening & Resilience Pass

**Date**: 2026-03-07
**Focus**: Prediction market fix, persona hot-swap, circuit breakers, XP penalties, rate limiting, error logging

## Summary

Continued autonomous improvement session. Fixed a divide-by-zero in prediction markets, made the persona system runtime-swappable, added a tool call circuit breaker to prevent wasting tokens on broken tools, introduced XP penalties/cooldowns, added command-level rate limiting, fixed a memory leak in knowledge-chain pruning, added periodic cleanup for group context windows, and added error logging to 8 silent catch blocks across 6 files.

## Commits (this sub-session)

| Hash | Description |
|------|-------------|
| `54c98e9` | Prediction fix, persona swap, circuit breaker, XP penalties, rate limits, error logging |

## Features Added

### Prediction Market Fix
- **Divide-by-zero guard** — `winnerPool === 0` and `totalPool === 0` edge cases handled
- **Fair rounding** — `Math.floor` for proportional shares, remainder goes to largest bettor (prevents over-distribution)
- **Zero-bet market** — Early return with "No bets placed" message

### Persona Hot-Swap
- `const ACTIVE_PERSONA` → `let activePersona` — mutable at runtime
- New export: `setPersona(id)` — validates ID, returns `{ ok, previous, current, name }`
- `/persona` command — view all personas or swap: `/persona degen`
- `reloadSystemPrompt()` called after swap to rebuild LLM context

### Tool Call Circuit Breaker
- Per-tool consecutive failure tracking in `claude.js`
- After 3 failures → tool disabled for 30s
- Auto-resume after cooldown expires
- `getToolBreakerStats()` export for monitoring
- Wired into `/telemetry` command for visibility
- Pattern-matched failure detection via result prefix (`Failed|Error|Command failed|...`)

### XP Penalties & Cooldowns
- `penalizeXP(userId, action)` — deducts XP (floor at 0), can delevel
- `XP_PENALTIES`: `wrong_prediction: 15`, `misinformation: 10`, `spam_warning: 5`
- Action cooldowns: `/gm` once/day, message XP 5s cooldown, command XP 3s cooldown
- Returns `{ cooledDown: true }` when rate-limited (no XP awarded)

### Command-Level Rate Limiting
- `COMMAND_COOLDOWNS` map with per-command windows
- `isCommandRateLimited(userId, command)` — lightweight sliding window
- Applied to: `/scanner` (10s), `/liquidations` (30s), `/alpha` (15s), `/digest` (60s)
- Stale entry cleanup every 10 minutes

### Bug Fixes
- **peerChangePool iterator** — `keys.next().value` called twice per iteration, skipping every other entry. Fixed with `[...keys()].slice(0, excess)`.
- **Group context memory** — Added periodic cleanup: evict windows with no activity for 24h, runs every 6h
- Fixed `contextDirty` declaration ordering (let hoisting would cause ReferenceError)

### Error Logging
Added `console.warn` to 8 previously silent catch blocks:
- `antispam.js` — flush failure
- `crpc.js` — reputation + completed tasks persistence
- `knowledge-chain.js` — chain persistence + missed epochs
- `threads.js` — flush failure
- `hell.js` — audit log write failure
- `tools-scheduler.js` — price check + gas check failures

## Files Modified

| File | Changes |
|------|---------|
| `jarvis-bot/src/tools-predictions.js` | Divide-by-zero fix, zero-pool guard, fair rounding |
| `jarvis-bot/src/persona.js` | `setPersona()`, mutable `activePersona` |
| `jarvis-bot/src/claude.js` | Tool circuit breaker (58 lines added) |
| `jarvis-bot/src/tools-xp.js` | `penalizeXP()`, action cooldowns, `XP_PENALTIES` |
| `jarvis-bot/src/index.js` | `/persona` command, command rate limits, telemetry breaker stats |
| `jarvis-bot/src/knowledge-chain.js` | peerChangePool fix, persist error logging |
| `jarvis-bot/src/group-context.js` | Periodic cleanup interval, `contextDirty` ordering |
| `jarvis-bot/src/antispam.js` | Flush error logging |
| `jarvis-bot/src/crpc.js` | Persistence error logging |
| `jarvis-bot/src/threads.js` | Flush error logging |
| `jarvis-bot/src/hell.js` | Audit log error logging |
| `jarvis-bot/src/tools-scheduler.js` | Price/gas check error logging |

## Test Suite

| File | Tests | Focus |
|------|-------|-------|
| `mi-bandit.test.js` | 25 | Bandit algorithms + pheromone board |
| `shard-learnings.test.js` | 21 | Broadcast logic, dedup, context builder |
| `mi-manifest.test.js` | 23 | Validation, registry, matching, querying |
| `mi-host.test.js` | 33 | Init, invoke, signals, wildcards, pause/resume, metrics, history |
| `mi-lifecycle.test.js` | 12 | Full cell lifecycle, energy, scoring, pheromones |
| **Total** | **114** | **All passing** |

## Metrics

- Files modified: 12
- Lines added: 286
- Lines removed: 19
- Bug fixes: 3 (prediction div/0, peerChangePool iterator, contextDirty hoisting)
- New features: 5 (persona swap, circuit breaker, XP penalties, command rate limits, context cleanup)
- Error logging improvements: 8 catch blocks across 6 files
- Tests: 114 (all passing, no regressions)
- Commits: 1
- First-try test rate: 100%

## Logic Primitives

1. **Floor + Remainder** — When distributing integer shares proportionally, use `Math.floor` for each share and give the rounding remainder to the largest stakeholder. Prevents over-distribution.
2. **Circuit Breaker Pattern** — Track consecutive failures, not total. Reset on success. Disable after threshold. Auto-resume after cooldown. Simple, effective, no configuration needed.
3. **Cooldown as Rate Limit** — Per-action cooldowns are simpler than sliding windows for preventing farming. Store `lastAwardedAt` per user per action.
4. **Silent Catch = Silent Bug** — Every `catch {}` is a future debugging session. At minimum, `console.warn` the module and error message.
5. **Declaration Order Matters** — `let` declarations are hoisted but NOT initialized. Using before declaration throws ReferenceError. `setInterval` callbacks capture the variable by reference but the interval fires at module init time — order matters.
