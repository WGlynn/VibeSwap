# Memory Index

## [GATES] — Behavioral enforcement (always loaded)
- [Anti-Hallucination](primitive_anti-hallucination.md) — 3-test verification before any assertion
- [Verbal-to-Gate](primitive_verbal-to-gate.md) — "noted" without a file write = violation
- [Session State Liveness](primitive_session-state-liveness.md) — write-through, not write-back

## [PROTOCOLS] — Session management
- [50% Context Reboot](feedback_50pct-context-reboot.md) — stop at 50%, not 10%
- [Crash-Resilient Memory](feedback_crash-resilient-memory.md) — save during session, not at end
- [Token Efficiency](feedback_token-efficiency.md) — 12 mandatory efficiency patterns
- [No Promises](feedback_no-promises.md) — no time estimates, no predictions
- [Autopilot Loop](autopilot-loop.md) — BIG/SMALL task rotation

## [SELF-IMPROVEMENT] — Meta-loops
- [Adaptive Immunity](primitive_adaptive-immunity.md) — failure -> gate -> immunity
- [State Observability](primitive_state-observability.md) — track state transitions, not just insights
