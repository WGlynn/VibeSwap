# Autonomous Run Orchestration

> Single-thread orchestration of multi-hour autonomous work bursts.

The agent overlay (Layer 6) handles subagent spawning, mitosis, and tool composition. A subset of that work is *autonomous run orchestration*: long-horizon work bursts where the user hands off direction-setting and expects the system to keep producing without per-step approval.

This doc covers the orchestration patterns that make autonomous runs reliable.

## What "autonomous run" means

An autonomous run is a session where the user has:
1. Declared a multi-step intention (e.g., "300 commits", "implement X end-to-end", "reify the GH#18 dialogue").
2. Granted forward execution authority (no per-step approval).
3. Expected the system to keep producing until the goal is met or until they explicitly stop.

The user is monitoring at boundary granularity (every 30+ minutes), not per-tool. The orchestration must therefore handle:
- Tool-level approvals without prompting.
- Stop-events without idling.
- Discipline gates without manual reload.
- Persistence (commits, pushes) without micromanagement.

## The orchestration stack

### Permission layer (Layer 1 hooks)

`autopilot-allow.py` (Layer 1) suppresses per-tool permission prompts when `~/.claude/.autopilot-active` is set. Other PreToolUse gates (HIERO, substance, NDA) still run their integrity checks. The user-facing approval surface goes to zero; the integrity surface stays intact.

### Stop discipline (Layer 4 + memory)

`[F·diagnose-on-stop]` is the discipline rule: every stop event during an autonomous run is interrogated for failure-mode gaps. The proposed Stop hook fires "why did you stop?" forcing resume-or-justify. No silent idling; no treating an inbound interrupt as "task complete."

### Atomic-commit-pacing (memory primitive)

`[F·atomic-commit-pacing]` is the discipline rule: one logical change per commit, pushed immediately, never batched. Granularity heuristic encoded: file + index entry = 1 commit, file + companion (test or doc) = 1 commit, README updates ride with referenced file. WAL/SESSION_STATE updates as standalone commits at checkpoint cadence.

### Dual-push pattern (memory reference)

`[R·backup-remote-pattern]` is the operational rule: every push hits BOTH `origin` and `backup`. Same command, sequential (`origin && backup`), atomic. Doubles the commit-graph signal, provides cross-remote redundancy, supports shard interop.

### Substrate-mirror sync

When a primitive or doc is shipped in one repo (e.g., a JARVIS substrate-layer doc), it cross-mirrors into the relevant project repos. Each mirror is its own atomic commit with its own dual-push. The substrate's primary location is the JARVIS repo; mirrors give project repos the substrate context as a first-class artifact.

## Why this is one layer, not five

Each piece (permission bypass, stop discipline, commit pacing, dual-push, substrate mirror) is small. Together, they handle the operational shape of autonomous runs: friction at the tool level → zero, drift at the session level → caught, commits → atomic and dual-pushed, substrate context → present in every repo that operates under it.

A run without any of these has visible failure modes:
- Without autopilot-allow: prompts every 30 seconds; user is dragged back into per-tool attention.
- Without diagnose-on-stop: silent idle after every inbound interrupt; declared run never finishes.
- Without atomic-commit-pacing: batched commits that hide drift; retrospective rows useless.
- Without dual-push: GitHub graph misses half the work; backup repos drift; recovery story degrades.
- Without substrate-mirror: project-repo readers lack context; substrate's existence invisible.

A run with all five is operationally smooth at the session-boundary granularity the user expects.

## The bootstrap on this orchestration

The 2026-05-06 GH#18 reification + 300-commit run was the first run under the full stack. Each piece either shipped during the run (autopilot-allow hook installed mid-run; backup repos created mid-run; dual-push pattern saved as primitive; substrate mirror executed for 7 docs mid-run) or was already in place (atomic-commit-pacing as memory primitive saved on the same run). The discipline that captured the run also captured itself.

This is the recursive demonstration: autonomous runs need orchestration, and the orchestration can be shipped inside an autonomous run. Future runs inherit each piece without reconstruction.

## Anti-pattern: heroic mode

The wrong move on a long autonomous run is "I'll keep pushing without writing the discipline down because I'm in flow." Three failure modes:
- Future-you cannot reconstruct what worked. The run was successful but the practice didn't compound.
- Other agents (subagents, future sessions) cannot benefit. The discipline is single-instance.
- Drift is silent. Whatever broke during the run isn't surfaced as a primitive; it'll break again.

The discipline IS the work. A run that produces 300 commits without producing primitives is a run that didn't compound.

## Composition with the rest of Layer 6

Autonomous run orchestration uses Layer 6's spawning primitives (subagent mitosis cap=5, specialized types) sparingly during a run — most of the work is direct-tool (Edit, Write, Bash). Subagents enter when:
- A research question requires breadth Explore can absorb.
- A subtask is independent enough that parallel execution earns the spawn cost.
- The main thread's context is approaching limits and a focused subagent can offload.

For most reification work (writing a spec, shipping an interface, mirroring a doc), direct-tool is faster. The orchestration is *about* the autonomous run as a whole, not about every individual atomic unit within it.

## Origin

2026-05-06 GH#18 reification + 300-commit run. The orchestration stack was articulated piecewise as failure modes surfaced during the run. By commit ~50, the discipline was complete enough to be documented; this doc was written at commit ~60 and committed to all three repo pairs (origin + backup) on its own atomic commit.
