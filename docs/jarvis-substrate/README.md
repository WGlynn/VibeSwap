# JARVIS Substrate Mirror

This directory mirrors substrate-layer documentation from [`WGlynn/JARVIS`](https://github.com/WGlynn/JARVIS). It is a *cross-mirror*, not the canonical source — the originals live in JARVIS's layered substrate dirs (`01-hooks/`, `02-persistence/`, etc.).

## Why mirror

Three reasons:

1. **Substrate context lives where the work happens.** A reader reviewing a VibeSwap commit shouldn't need to clone a separate repo to understand the substrate's discipline rules. The mirror puts the relevant substrate docs in the same git history as the code that uses them.

2. **Shard interop.** Multiple agents / sessions / future-readers operating on VibeSwap should see consistent substrate state. The mirror is the consistency surface for cross-shard coordination.

3. **Commit-graph consistency.** Every meaningful substrate doc should land in every project repo it operates under. The mirror makes that explicit.

## What's mirrored

| File | Source | What it covers |
|------|--------|----------------|
| `01-hooks_autopilot-permission-bypass.md` | JARVIS/01-hooks/ | hook that suppresses permission prompts when ~/.claude/.autopilot-active is set |
| `02-persistence_write-ahead-log-discipline.md` | JARVIS/02-persistence/ | WAL.md as cognitive-state atomic-commit boundary |
| `03-anti-hallucination_on-chain-reasoning-verification.md` | JARVIS/03-anti-hallucination/ | Layer 3 extended from write-time to action-time verification |
| `04-discipline_capture-on-same-turn.md` | JARVIS/04-discipline/ | discipline timing rule for primitive capture |
| `05-meta-protocols_augmented-dev-loops.md` | JARVIS/05-meta-protocols/ | AMD applied to the dev process itself |
| `06-agent-overlay_autonomous-run-orchestration.md` | JARVIS/06-agent-overlay/ | 5-piece stack for multi-hour autonomous work bursts |
| `07-stateful-applications_reasoning-verification-as-application.md` | JARVIS/07-stateful-applications/ | reasoning verification framed as Layer 7 application |
| `08-filesystem-as-substrate_autonomous-run-as-filesystem-event.md` | JARVIS/08-filesystem-as-substrate/ | 300-commit run as OSCH stress test |
| `papers/closing-the-cognitive-airgap.md` | JARVIS/papers/ | companion to airgap-problem-onepager covering cognitive direction |
| `papers/bidirectional-reification.md` | JARVIS/papers/ | methodology paper on word ↔ code as orthogonal modes of creation |

## Sync discipline

When a new substrate doc lands in JARVIS, its mirror lands here on the same loop turn (per `[F·bidirectional-reification]`). Each mirror is its own atomic commit, dual-pushed to `origin` AND `backup` per `[R·backup-remote-pattern]`.

A mirror is NOT a copy with edits. The text is identical to the JARVIS source. If the source changes, the mirror updates. If the mirror needs adjustment for a VibeSwap-specific reason, that adjustment lands as a follow-on commit with explicit reasoning in the message.

## Why this directory and not `docs/architecture/` or `docs/concepts/`

Architecture and concept docs in those directories are *VibeSwap's own* artifacts — first-class to this codebase. JARVIS substrate docs are *infrastructure* this codebase operates under. Keeping them in a sibling directory marks the distinction: a future reader looking for "what is VibeSwap?" reads architecture/; a reader looking for "what discipline produced VibeSwap?" reads jarvis-substrate/.

## Origin

2026-05-06 autonomous run. Will: *"let's have commits for the WAL and other persistence hooks applied to the vibeswap github as well for the same reasons"* — A: more commits on the GitHub graph, B: consistency + shard interop. Mirror sync executed for 5 substrate-layer docs + 2 papers across the run; this README written as the consolidating index.
