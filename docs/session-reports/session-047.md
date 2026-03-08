# Session 047 — Turing-Passability + Passive Attribution + Relay System

**Date**: 2026-03-08
**Focus**: Make JARVIS more human-like, extend passive attribution DAG, new API endpoints

## Summary

Comprehensive Turing-passability upgrade across JARVIS's intelligence layer. Replaced rule-based prompts with few-shot examples, added rapport tracking for adaptive formality, built passive norm learning from group conversations, added naturalness scoring, natural typing delays, and fixed multiple bugs. Extended passive attribution to 18+ platforms. Added new monitoring API endpoints.

## Completed Work

### Turing-Passability Improvements (7 Changes)
1. **Example-based triage prompt** — Replaced abstract rules with concrete JSON examples. Haiku responds better to few-shot than rule lists.
2. **Rapport tracking** — In-memory Map tracks interaction count per user. Adjusts formality: stranger → acquaintance → regular → close.
3. **Humanized confidence threshold** — Random range (0.03–0.07) instead of fixed 0.05. Avoids robotic cutoffs.
4. **Editorial judgment quality review** — Rewrote quality gate prompt to gut-check editorial style.
5. **Passive norm learning** — Heuristic analysis of 50-message rolling buffer every 30 min. Zero LLM cost.
6. **Naturalness scoring** — 5th self-evaluation criterion: "does it sound like a real person?" Composite now averages 5 dimensions.
7. **Natural typing delay** — 1-4s variable delay before proactive responses based on length + randomness.

### Attribution Graph Extensions
- Added platform detection: LinkedIn, Stack Overflow, Notion, Discord, Google Docs, HackMD
- Added URL-based author extraction for LinkedIn (in/username), SO (users/id/name), Notion
- Added JSON-LD structured data parsing to web-reader (most reliable author source)
- Added rel="author" link pattern detection
- Total platforms covered: 18+

### New API Endpoints
- `GET /web/intelligence` — engagement stats, rapport count, 7-day score trends with naturalness
- `GET /web/wardenclyffe` — LLM cascade performance: per-provider latency, success rates, active model

### Bug Fixes
- **`classifyComplexity` async bug** — Replaced `await import('./persona.js')` inside sync function with top-level static import.
- **Stats function referencing old constants** — Updated to use dynamic persona-driven functions.

### Infrastructure
- **2 Fly.io deployments** — both healthy, all new features live.

## Files Modified

- `jarvis-bot/src/llm-provider.js` — Fixed async bug, static persona import
- `jarvis-bot/src/intelligence.js` — Rapport, examples, norms, naturalness, humanized thresholds
- `jarvis-bot/src/index.js` — Norm integration, typing delay
- `jarvis-bot/src/web-api.js` — Two new endpoints, additional imports
- `jarvis-bot/src/passive-attribution.js` — 6 new platforms, SO/LinkedIn/Notion author extraction
- `jarvis-bot/src/web-reader.js` — JSON-LD + rel=author parsing

## Decisions

- Rapport tracking is in-memory only (resets on restart) — acceptable since it rebuilds quickly
- Norm learning uses pure heuristics, not LLM — zero-cost
- Naturalness backwards-compatible: old scores default to 5/10 in composite calculation

## Metrics

- 9 commits pushed to both remotes
- 2 Fly.io deployments
- ~200+ lines added across 6 files

## Logic Primitives Extracted

- **Few-Shot > Rules**: LLMs respond more naturally to concrete examples than abstract rules
- **Rapport-as-State**: Track interaction frequency to modulate formality
- **Stochastic Thresholds**: Slight randomness in decision boundaries = more human-like
- **Naturalness-as-Metric**: If you want to pass the Turing test, you need to measure it
- **JSON-LD First**: Structured data is more reliable than regex HTML scraping for metadata
