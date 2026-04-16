# TRP Runner Protocol

**Version**: 3.0
**Date**: 2026-04-02
**Purpose**: Execute TRP as a full circle — diagnose AND cure — without crashing the context window. v3.0 adds the efficiency recursion: the protocol optimizes itself each round.

---

## Problem

TRP invocation loads: CKB (~1000 lines) + MEMORY.md (~200 lines) + SESSION_STATE + WAL + TRP spec (217 lines) + 4 loop docs (~200 lines) + target code + actual recursive operations = context overflow = crash.

## Solution: 4 Mitigations

### Mitigation 1: Staggered Loading

Never load all TRP context at once. The main context is a **coordinator**, not an executor.

**Stage 0 — Preflight** (coordinator only):
- Read THIS file (TRP_RUNNER.md) — you're already here
- Read `docs/trp/efficiency-heatmap.md` — the heat map
- `git diff <last_audited_commit>..<HEAD> -- contracts/` — detect changed files
- Promote COLD contracts with changes to WARM (update heat map)
- Identify the TARGET (HOT/WARM contracts only — skip COLD)
- Run context guard (Mitigation 2)

**Stage 1 — Target Acquisition** (coordinator only):
- Read ONLY the target code (the contract/module being improved)
- Do NOT read CKB, do NOT read full TRP spec, do NOT read loop docs
- Summarize target in <10 lines: what it does, key functions, known issues

**Stage 2 — Loop Dispatch** (subagents — Mitigation 4 + 5):
- Consult heat map for agent tier: HOT=opus, WARM=sonnet, cleanup=haiku
- Dispatch each loop to its own subagent at the assigned tier
- Each subagent loads ONLY what its loop needs (see Sharding Matrix below)
- Max 2 concurrent subagents (Wardenclyffe rate limit constraint)
- Coordinator waits for results

**Stage 3 — Cure** (coordinator + subagents):
- Prioritize findings from R1 + R2 by severity (CRITICAL → HIGH → MEDIUM)
- Fix the top findings **in this cycle** — patch code, correct NatSpec, close knowledge gaps
- R3's tests verify fixes hold (run existing + new tests against patched code)
- Findings that can't be fixed this cycle (too large, needs design decision, blocked) stay as open items with a reason
- The goal: the open items list should **shrink** each cycle, not grow

**Stage 4 — Integration + Efficiency Meta-Loop** (coordinator only):
- Collect all results (discovery + cures)
- Write findings to SESSION_STATE
- Update memory if non-obvious knowledge discovered
- Score the cycle — scoring now counts **closed** findings, not just found ones
- A cycle that finds 10 issues and fixes 8 scores higher than one that finds 20 and fixes 0
- **Efficiency meta-loop (v3.0)**:
  1. Record metrics: agents spawned, tiers used, findings/agent yield, contracts skipped
  2. Update heat map: promote/demote contracts based on this round's results
  3. Compare yield to previous round — if declining, narrow scope for next round
  4. If a contract produced 0 new findings for 2 consecutive rounds, demote it
  5. Log efficiency block in round summary (see template below)

### Mitigation 2: Context Guard (50% Rule)

**Before ANY TRP invocation, the coordinator MUST check:**

```
IF session has already consumed significant context (long conversation, many tool calls,
   large files read, multiple agent results received):
   → REFUSE TRP. Tell Will: "Context too hot. Reboot first, then invoke TRP in fresh session."

IF session is fresh (just started, minimal prior conversation):
   → PROCEED with TRP Runner.
```

**Heuristic**: If you've already had >10 back-and-forth exchanges or read >5 large files in this session, you're past 50%. Don't run TRP — reboot.

**Exception**: If Will says "run it anyway" — proceed but warn that quality may degrade.

### Mitigation 3: Minimal Boot Path

When Will says "recursion protocol" or "TRP" at session start, use this boot instead of full session start:

```
TRP MINIMAL BOOT:
1. Check WAL.md               → crash recovery only if ACTIVE
2. Read TRP_RUNNER.md          → this file (the runner, not the full spec)
3. Identify target             → what are we improving?
4. Skip CKB                    → not needed for TRP execution
5. Skip full MEMORY.md read    → only load if a loop needs specific memory
6. Skip SESSION_STATE deep read → just note parent hash
7. Go directly to Stage 1
```

**What gets skipped**: CKB (1000 lines), full memory traversal, alignment primitives, project context.
**What gets loaded**: TRP Runner (this file), target code, loop-specific context (in subagents).

The skipped context isn't lost — it lives in the subagents' context if they need it (they usually don't).

### Mitigation 4: Ergonomic Sharding (Nervos Pattern) — OPTIMIZATION, NOT SAFETY

**Critical insight (2026-03-27)**: Mitigations 1-3 handle crash prevention. Sharding handles PARALLELISM. These are different value propositions. If 1-3 suffice, sharding adds unnecessary tradeoffs — just like how Nervos CKB only uses L1 when verification is necessary and L2 when compute is necessary. Don't use a shared resource when a local one works.

**The principle**: Shard ONLY when parallelism genuinely accelerates the cycle. If the session has capacity, run loops sequentially in the coordinator — it's simpler and the coordinator retains full context of all findings for integration.

**Dispatch Matrix:**

| Loop | Where | Why | Loads |
|------|-------|-----|-------|
| R0 (compress) | **COORDINATOR** | Self-referential — compression optimizes the coordinator's own context. Sharding this makes no sense; you can't compress your desk from someone else's desk. | MEMORY.md, SESSION_STATE |
| R1 (adversarial) | **SUBAGENT (opus)** | Pure compute — run hundreds of attack scenarios, compare outputs, report findings. Coordinator doesn't need to watch. | Target contract, test files, reference model |
| R2 (knowledge) | **HYBRID** | Discovery = subagent (sonnet: scan CKB, find gaps). Verification + integration = coordinator (did we learn something true? write it). | Subagent: CKB + findings. Coordinator: subagent summary. |
| R3 (capability) | **SUBAGENT (opus)** | Pure build — write tools, write tests, produce artifacts. Hand back the finished product. | Target contract, existing tools, coverage gaps |

**Why this is balanced:**
- R0 local: you don't outsource self-improvement of your own workspace
- R1 sharded: adversarial search is embarrassingly parallel and context-hungry
- R2 hybrid: knowledge DISCOVERY is cheap (sonnet scans), knowledge VERIFICATION needs the coordinator's full picture
- R3 sharded: tool building is creative compute, doesn't need alignment context

**Coordinator load**: TRP_RUNNER.md + target summary + R0 context + R2 integration. ~25% of capacity. The heavy compute (R1, R3) is fully offloaded.

### Mitigation 5: Efficiency Recursion (v3.0) — The Builder Builds The Builder

The protocol optimizes its own resource consumption each round. This is R0 applied to TRP itself.

**Heat Map** (`docs/trp/efficiency-heatmap.md`):
- Tracks per-contract audit status: HOT / WARM / COLD
- HOT = open CRITICAL/HIGH or new findings in last 2 rounds → opus
- WARM = open MEDIUM or no new findings for 2 rounds → sonnet
- COLD = clean for 3+ rounds, no code changes → skip entirely
- Contracts auto-promote on code change, auto-demote on clean passes

**Agent Tier Selection**:
```
Discovery (fresh audit, unknown attack surface)  → opus
Verification (re-check known findings)           → sonnet
Cleanup (NatSpec, dead imports, formatting)       → haiku
```

**Scope Pruning**:
- Before dispatch, `git diff` detects which contracts changed since last audit
- COLD contracts with no changes are skipped — logged but not dispatched
- This means round N+1 is always scoped tighter than round N (unless new code lands)

**Yield Tracking**:
- findings_per_agent = new_findings / agents_spawned
- If yield < 2 for a contract, demote it next round
- If yield > 5, that contract is HOT — keep opus on it

**Compounding Effect**: By round 10, the heat map has enough signal to skip 60-70% of the codebase. TRP runs in half the tokens of round 1, freeing API capacity for Jarvis and more rounds per session.

---

## Invocation

When Will says any of:
- "recursion protocol"
- "TRP"
- "run the loops"
- "recursive improvement"

**Jarvis responds:**

```
TRP RUNNER v2.0 — PREFLIGHT
├── Context guard: [PASS/FAIL — if FAIL, suggest reboot]
├── Boot mode: [MINIMAL/already booted]
├── Prior open items: [N findings from last tier — re-verify FIRST]
├── Target: [identified target or ask Will]
├── Loops to run: [R0/R1/R2/R3 or subset]
└── Dispatching [N] shards...
```

Then execute Stages 1-4. Stage 3 (Cure) is mandatory — a TRP round that only diagnoses is a half circle.

---

## Scoring

After each TRP cycle, score on 8 dimensions:

| Dimension | Metric | Score |
|-----------|--------|-------|
| **Survival** | Did the session crash? | PASS/FAIL |
| **R0 (density)** | Bytes saved or context optimized | +/- delta |
| **R1 (adversarial)** | Bugs found / attack surface reduction | count |
| **R2 (knowledge)** | Gaps found / documentation health | count |
| **R3 (capability)** | Tools built or improved | count |
| **R4 (cure)** | Findings fixed this cycle / closure rate | fixed/found ratio |
| **Efficiency** | Findings per agent, tier accuracy, scope reduction | yield + tier breakdown |
| **Integration** | Did loops feed each other? | Y/N + description |

**Overall grade**:
- S: All loops produced findings + integration + closure rate > 50% + efficiency ≥ prior round
- A: 3+ loops productive + some fixes applied + heat map updated
- B: 2 loops productive OR diagnosis-only with no fixes
- C: 1 loop only
- F: Crash

**Key change (v2.0)**: Diagnosis without cure is a half circle.
**Key change (v3.0)**: A round that achieves the same output with fewer agents/tokens outranks one that throws opus at everything. The efficiency dimension rewards scope pruning, tier demotion, and yield improvement. The builder builds the builder.

### Round Summary Efficiency Block (v3.0 — mandatory)

Every round summary must include:

```yaml
efficiency:
  agents_spawned: N
  agent_tiers: { opus: N, sonnet: N, haiku: N }
  contracts_in_scope: N
  contracts_skipped: N (COLD)
  findings_new: N
  findings_closed: N
  closure_rate: N%
  yield: N (findings / agents, or "—" if no agents)
  heat_map_changes: "Contract X: HOT→WARM, Contract Y: COLD→WARM (code changed)"
```

---

## Recovery

If a subagent crashes or times out:
1. Log which loop failed and what it was doing
2. Do NOT retry in same session — that subagent's context is gone
3. Collect results from surviving subagents
4. Score what completed
5. Note failed loop for next session

If coordinator crashes:
- WAL should capture in-flight state (Anti-Amnesia Protocol)
- Subagent results may be lost — this is acceptable, they can be re-run
- Next session: check WAL, see TRP was in-flight, resume from last completed stage

---

## Cycle Continuity

Each TRP cycle MUST start by re-verifying the prior cycle's open items:

1. Read the previous round summary (e.g., `round-summaries/round-16.md`)
2. Check each open item: still present? already fixed by other work? obsolete?
3. Items confirmed still open become **priority targets** for the cure phase
4. Only after prior items are triaged does new discovery begin

This prevents the open items list from growing monotonically. If the same HIGH finding appears in 3 consecutive rounds unfixed, that's a protocol failure — escalate to Will.

## Anti-Patterns

- **DON'T** load the full TRP spec (TRINITY_RECURSION_PROTOCOL.md) during a run. That's reference documentation, not runtime context.
- **DON'T** read all 4 loop docs into the coordinator. Each loop doc goes to its respective subagent only.
- **DON'T** run TRP mid-session after heavy work. Reboot first.
- **DON'T** run all 4 loops sequentially in the main context. That's the old crash pattern.
- **DON'T** load CKB "just in case." If a subagent needs alignment context, it loads it itself.
- **DON'T** end a cycle with only diagnosis. If you found it, fix it. A half circle is not recursion.
- **DON'T** carry forward the same HIGH finding for more than 2 cycles without fixing or escalating.
- **DON'T** use opus for verification rounds. If you're re-checking known findings, sonnet is sufficient.
- **DON'T** audit COLD contracts without checking `git diff` first. No changes = no new findings.
- **DON'T** skip the efficiency block in round summaries. The meta-loop only works with data.
- **DON'T** spawn 3+ concurrent agents. Wardenclyffe rate limit: max 2 subagents at a time.
