# Session 039 — Autopilot: MI Runtime, Proto-AI Kernel, Circuit Breakers

**Date**: 2026-03-07 (continued from Session 038)
**Duration**: Autopilot (Will AFK)
**Shard**: Claude Code (desktop)

---

## Summary

Autopilot session focused on building Jarvis's mind infrastructure. Implemented the MI Host SDK (cell lifecycle runtime), contextual bandit proto-AI kernel, Wardenclyffe circuit breaker pattern, and mapped existing tools to MI manifests. This session transforms the MI manifest spec from Session 038 into an executable runtime.

---

## Completed Work

### 1. MI Host SDK — Cell Lifecycle Runtime
- **Created** `src/mi-host.js` (~400 lines)
- Full cell lifecycle: sense → choose → act → learn → commit
- `CellInstance` class with runtime state, strategy weights, telemetry
- Signal bus: emit/subscribe with FIFO queue, 50-signal batch processing
- Capability invocation with automatic best-cell selection (lowest error rate, highest confidence)
- Tool system bridge: `generateToolDefinitions()` creates Claude-compatible tool objects from manifests
- `handleMIToolCall()` dispatches `mi_*` tool names to cell capability handlers
- Lifecycle check interval: periodic identity reconsideration based on dwell time + trigger conditions
- `/mi_status` command support via `getMIStatusString()`

### 2. Contextual Bandit Proto-AI Kernel
- **Created** `src/mi-bandit.js` (~400 lines)
- Three bandit implementations:
  - **EpsilonGreedyBandit**: Simple, effective, decaying exploration rate
  - **ThompsonBandit**: Beta distribution sampling, models uncertainty explicitly
  - **UCB1Bandit**: Deterministic upper confidence bound, systematic exploration
- Factory: `createBandit(type, arms, opts)` + `deserializeBandit(data)` for persistence
- Pure-JS statistical primitives: Beta sampling (Marsaglia-Tsang gamma), Box-Muller normal
- **StigmergyBoard**: In-memory pheromone board for indirect cell coordination
  - deposit/query/queryPrefix with TTL-driven decay
  - Serializable for cross-session persistence
  - Capacity-bounded (default 1000 entries)

### 3. Wardenclyffe Circuit Breaker Pattern
- **Modified** `src/llm-provider.js` (~180 lines added)
- `CircuitState` class with three states: CLOSED → OPEN → HALF_OPEN
- Per-provider sliding window error rate tracking (60s window)
- Automatic disable at 50% error rate (minimum 3 requests)
- Exponential backoff for re-enablement (30s → 60s → 120s → ... → 10min max)
- Half-open probe: allow 1 request to test recovery
- Integrated into `llmChat()`: skip open-circuit providers, record success/failure on every call
- Fallback cascade now skips providers with open circuits
- New exports: `getProviderHealth()`, `getProviderHealthString()`

### 4. Tool-to-MI Manifest Mapping (7 cells total)
- **Created** `cells/market-data.mi.json` — 8 capabilities (getPrice, getTrending, getChart, etc.)
- **Created** `cells/defi-analytics.mi.json` — 6 capabilities (getTVL, getYields, getDexVolume, etc.)
- **Created** `cells/knowledge-learner.mi.json` — 2 capabilities (learnFact, recallKnowledge)
- **Created** `cells/utility-tools.mi.json` — 5 capabilities (weather, wiki, translate, calculate, time)
- **Created** `cells/community-engagement.mi.json` — 5 capabilities (coinFlip, dice, trivia, GM, leaderboard)
- (Previously: price-feed.mi.json, rug-check.mi.json)
- Total: 7 MI cells, 28 capabilities mapped

---

## Files Created/Modified

| File | Action | Lines |
|------|--------|-------|
| `src/mi-host.js` | CREATE | ~400 |
| `src/mi-bandit.js` | CREATE | ~400 |
| `src/llm-provider.js` | MODIFY | +180 (circuit breaker) |
| `cells/market-data.mi.json` | CREATE | ~75 |
| `cells/defi-analytics.mi.json` | CREATE | ~65 |
| `cells/knowledge-learner.mi.json` | CREATE | ~55 |
| `cells/utility-tools.mi.json` | CREATE | ~55 |
| `cells/community-engagement.mi.json` | CREATE | ~60 |

---

## Architecture Decisions

1. **Three bandit types**: Different use cases need different exploration strategies. Epsilon-greedy for simple cases, Thompson for uncertain environments, UCB1 for deterministic scheduling.
2. **Stigmergy over direct messaging**: Cells coordinate via pheromone board (indirect) rather than direct RPC — more resilient, no coupling.
3. **Circuit breaker per provider, not global**: Each provider has independent health tracking. One provider dying shouldn't affect others' health scores.
4. **Tool bridge pattern**: MI cells generate Claude-compatible tool definitions (`mi_{cellId}_{capName}`), so the existing tool loop can dispatch to MI cells without refactoring.

---

## Logic Primitives Extracted

1. **Circuit Breaker State Machine**: CLOSED (normal) → OPEN (disabled, backoff timer) → HALF_OPEN (probe 1 request) → CLOSED (if probe succeeds) or OPEN (if probe fails, increased backoff)
2. **Epsilon Decay**: Start exploring broadly, narrow over time. `epsilon = max(min, epsilon * decay)` — simple, effective.
3. **Beta Distribution as Uncertainty**: Alpha/beta parameters encode success/failure counts. More data = narrower distribution = less exploration. Perfect for bandit problems.
4. **Membrane-as-Interface**: The manifest IS the cell's intelligence boundary. Everything inside is implementation detail. Everything outside is signal exchange.

---

## Metrics

- **Files created**: 7
- **Files modified**: 1
- **New code**: ~1,290 lines
- **MI cells total**: 7 (28 capabilities)
- **Bandit implementations**: 3
- **Circuit breaker integration points**: 5 (route check, success recording, failure recording, fallback skip, fallback failure)
