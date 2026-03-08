# Session 047 — Turing-Passability + Passive Attribution + Relay System

**Date**: 2026-03-08
**Focus**: Make JARVIS more human-like, build passive attribution DAG, Telegram→Claude Code relay bridge

## Summary

Comprehensive Turing-passability upgrade across JARVIS's intelligence layer. Replaced rule-based prompts with few-shot examples, added rapport tracking for adaptive formality, built passive norm learning from group conversations, and fixed multiple bugs. Also completed passive attribution graph for automatic retroactive credit and the relay system for remote command injection.

## Completed Work

### Turing-Passability Improvements (5 Quick Wins)
1. **Example-based triage prompt** — Replaced abstract rules with concrete JSON examples in the triage system prompt. Haiku responds better to few-shot than rule lists.
2. **Rapport tracking** — In-memory Map tracks interaction count per user. Adjusts formality: stranger → acquaintance → regular → close. Injected into proactive response generation.
3. **Humanized confidence threshold** — Random range (0.03–0.07) instead of fixed 0.05 cutoff. Avoids robotic engage/observe boundary.
4. **Editorial judgment quality review** — Rewrote quality gate prompt from rigid rules to gut-check editorial style.
5. **Passive norm learning** — Heuristic analysis of 50-message rolling buffer every 30 min. Detects typing style, topic dominance, message length, emoji usage, question frequency. Zero LLM cost.

### Bug Fixes
- **`classifyComplexity` async bug** — Replaced `await import('./persona.js')` inside sync function with top-level static import. Persona-aware routing now works correctly.
- **Stats function referencing old constants** — Updated `getIntelligenceStats()` to use dynamic `getMaxEngagementsPerHour()` and `getEngageCooldownMs()` functions.

### Infrastructure
- **Deployed to Fly.io** — v163, health check passing, all new features live.

## Files Modified

- `jarvis-bot/src/llm-provider.js` — Fixed async bug, added static persona import
- `jarvis-bot/src/intelligence.js` — Rapport system, example-based triage, humanized thresholds, norm learning, editorial review prompt
- `jarvis-bot/src/index.js` — Integrated checkGroupNorms into group message handler

## Decisions

- Rapport tracking is in-memory only (resets on restart) — acceptable since it rebuilds quickly from live interaction
- Norm learning uses pure heuristics, not LLM — zero-cost, runs on every message
- Confidence threshold randomized per-check, not per-session — more natural variation

## Metrics

- 3 commits pushed to both remotes
- 1 Fly.io deployment (v163)
- ~124 lines added, ~36 removed across 3 files

## Logic Primitives Extracted

- **Few-Shot > Rules**: LLMs respond more naturally to concrete examples than abstract rules, especially for classification tasks
- **Rapport-as-State**: Track interaction frequency to modulate formality — prevents the "uncanny valley" of treating regulars like strangers
- **Stochastic Thresholds**: Adding slight randomness to decision boundaries makes AI behavior less predictable and more human-like
