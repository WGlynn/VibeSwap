# Recursion 3: Capability Bootstrapping

**Type**: Turing recursion
**One-liner**: The builder builds better tools for building. What was impossible yesterday is routine today.

---

## What It Does

When you notice you're doing something manually, automate it. When you notice a gap in your testing, build a tool that fills it. When that tool reveals new gaps, build better tools. The toolchain grows with each cycle, and each tool makes the next tool easier to build.

## How It's Recursive

```
capability(n) = improve(capability(n-1), tools_built(session_n))
```

The builder's capability at step N depends on the tools built in step N-1. Those tools were built USING the capability from step N-2. It's turtles all the way down — each layer of capability enables the next.

## What Makes It NOT Just "Writing Code"

Writing code is linear: you write it, it runs, done.
Capability bootstrapping is recursive: the code you write THIS session makes NEXT session's code better, which makes the session AFTER that even better.

The coverage matrix didn't exist before this session. Now it shows exactly where to look next. The adversarial search didn't exist — now it runs autonomously. The reference model didn't exist — now it catches rounding bugs the fuzzer can't find.

## Evidence (Single Session)

7 tools built in one session, each enabling the next:

| # | Tool | What It Enabled |
|---|------|-----------------|
| 1 | Reference model | Exact arithmetic comparison (foundation for everything) |
| 2 | Vector generator | Automated cross-language test data |
| 3 | Replay tests | Solidity consumes Python's output (cross-layer bridge) |
| 4 | Conservation tests | End-to-end value tracking |
| 5 | Adversarial search | Autonomous bug discovery (used tools 1-2) |
| 6 | Coverage matrix | Shows where to build next (meta-tool) |
| 7 | Test runner | Single command for all layers (integration tool) |

Tool 5 couldn't exist without Tool 1. Tool 6 couldn't be useful without Tools 1-5 populating it. Tool 7 integrates all of them. Recursive.

## Implementation

1. When you do something manually more than twice, automate it
2. When a pattern works, formalize it as a protocol
3. Build tools that produce inputs for other tools (pipelines)
4. Track coverage: what's tested, what's not, what's the highest-value gap
5. The coverage gaps ARE the roadmap for the next tool

---

## See Also

- [TRP Core Spec](../../concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md) — Full protocol specification
- [Loop 0: Token Density](loop-0-token-density.md) | [Loop 1: Adversarial](loop-1-adversarial-verification.md) | [Loop 2: Knowledge](loop-2-common-knowledge.md)
- [TRP Runner Protocol](TRP_RUNNER.md) — Execution protocol (built by this loop)
- [Efficiency Heat Map](efficiency-heatmap.md) — Heat map tool (built by this loop)
