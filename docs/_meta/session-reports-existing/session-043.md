# Session 043 — Telemetry, Reward Cycle, Activity Persistence

**Date**: 2026-03-07 (continued autopilot)
**Duration**: Autopilot (Will AFK)
**Shard**: Claude Code (desktop)

---

## Summary

Added combined telemetry command, completed the MI cell reward/learn cycle for bandit strategy cells, and added autonomous chat activity persistence to survive restarts.

---

## Completed Work

### 1. Combined Telemetry Command (`/telemetry`)
- Shows MI cell stats, provider health, and performance ranking in one view
- Imported `getProviderPerformanceStats` for EMA-based provider latency/success
- Each cell shows: state, identity, invocations, errors
- Each provider shows: latency EMA, success rate, performance score

### 2. MI Cell Reward/Learn Cycle
- Fixed `choose()` to use bandit selection for ALL non-fixed strategies (thompson, epsilon_greedy, ucb1)
- Previously only triggered for `strategy === 'contextual_bandit'` — now works with actual manifest strategies
- Fixed `learn()` same way — all bandit strategies update weights
- Added reward metrics tracking: totalRewards, avgReward, per-signal counts
- Added auto-reward in `invoke()`: success = 0.5 + latency bonus, error = 0.0
- Latency reward: `1/(1 + ms/5000)` — faster responses get higher reward
- Added `invocations` counter to global telemetry
- Added `avgLatencyMs` metric per cell

### 3. Autonomous Chat Activity Persistence
- Added `loadChatActivity()` — restores chatActivity map + targetChats + lastAutonomousPost from disk
- Added `flushAutonomous()` — saves to `data/chat-activity.json`
- Integrated into index.js: load before initAutonomous, flush in periodic cycle + both shutdown handlers
- Added `chat-activity.json` to git backup file list
- Prevents autonomous engagement timing from resetting on restart

---

## Files Modified

| File | Action | Changes |
|------|--------|---------|
| `src/index.js` | MODIFY | +40 lines (telemetry command, provider perf import, autonomous flush integration) |
| `src/mi-host.js` | MODIFY | +30 lines (reward cycle, learn fix, invoke auto-reward, telemetry counter) |
| `src/autonomous.js` | MODIFY | +60 lines (loadChatActivity, flushAutonomous, persistence imports) |
| `src/git.js` | MODIFY | +1 line (chat-activity.json in backup list) |

---

## Architecture — Cell Reward Cycle

```
Client invokes capability
    ↓
cell.invoke(capName, input)
    ↓ (start timer)
handler(input) → result
    ↓ (success)
reward = 0.5 + 0.5/(1 + latencyMs/5000)
cell.learn(reward, 'invoke_success')
    ↓
EMA weight update for current identity
    ↓
Normalized weights used in next choose()
    ↓ (on error)
cell.learn(0.0, 'invoke_error')
```

---

## Metrics

- **Files modified**: 4
- **New code**: ~130 lines
- **New commands**: 1 (/telemetry)
- **Tests**: 46 passing (unchanged)
