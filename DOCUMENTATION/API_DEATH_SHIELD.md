# API Death Shield

**Status**: Live. PreToolUse hook at `~/.claude/hooks/`.
**Primitive**: [`memory/primitive_api-death-shield.md`](../memory/primitive_api-death-shield.md)
**Instance of**: [Stateful Overlay](./STATEFUL_OVERLAY.md).

---

## What it does

Persists session state to disk before every Claude API call. If the API kills the session mid-work, the next session can recover from the last checkpoint without re-deriving context.

## The failure mode it closes

LLM API sessions can die for many reasons:
- Network blip mid-response.
- Token-budget hit forcing a compression that drops load-bearing context.
- Backend error returning 500 mid-stream.
- Session timeout after long idle.
- Client-side crash during a complex multi-tool sequence.

Without the overlay, each death means starting from scratch on the next session — re-reading SESSION_STATE, re-orienting against the current working tree, re-establishing the in-flight task context. This is expensive and error-prone (easy to miss a partial change the prior session made).

With the overlay, the death is a soft-failure: state is already on disk at last checkpoint; new session reads and continues.

## The deeper observation

Every LLM session is a process with a mortality profile, and every process with a mortality profile admits a state-persistence pattern. Operating systems solved this in the 1970s with checkpoint/restart; databases with WAL; distributed systems with snapshot/restore; long-running batch jobs with checkpoint files.

The [Stateful Overlay](./STATEFUL_OVERLAY.md) applied to LLM cognition yields the API Death Shield. The pattern is: externalize idempotent state; capture at well-defined boundaries; restore on session start. Generic pattern, specific instantiation.

## Implementation

The hook fires on PreToolUse (and optionally PostToolUse for expensive tools):

```python
# Pseudocode — actual hook at ~/.claude/hooks/api-death-shield.py
def pre_tool_use(tool_name, tool_input):
    session_state = {
        'last_tool': tool_name,
        'working_tree_sha': git_head(),
        'in_flight_task': read_taskstate(),
        'pending_writes': enumerate_unwritten_edits(),
    }
    write_atomic('.claude/SHIELD_CHECKPOINT.json', session_state)
```

On session start, a restore-check looks for the checkpoint:

```python
def on_session_start():
    if exists('.claude/SHIELD_CHECKPOINT.json'):
        state = read('.claude/SHIELD_CHECKPOINT.json')
        if state['working_tree_sha'] != git_head():
            # Tree moved — new work happened outside this shield
            log_divergence(state)
        else:
            # Clean resume — pick up where we left off
            inject_context(state)
```

## Why idempotent matters

If the shield is applied twice (pre-tool on a tool call that then fails + pre-tool on the retry), it must be safe:

- The checkpoint file is overwritten atomically; double-write = single final write.
- The restore path is tolerant to stale checkpoints (detects via SHA comparison).
- The task state is derived from canonical sources (TaskList, git log), not mirrored.

Idempotence is a hard requirement because failure modes are arbitrary — the shield has to survive partial writes, torn writes, and race conditions without corrupting the session.

## Relationship to the broader persistence stack

API Death Shield is one layer of the broader [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md):

| Tier | Mechanism | Target |
|---|---|---|
| 0 | API Death Shield | Single-session survival |
| 1 | Git repo at `memory/` | Cross-session memory |
| 2 | AES-256-GCM + 3-of-5 Shamir capsule | Catastrophic loss |
| 3 | Portable skill export | Cross-substrate portability |
| 4 | Backend-agnostic mind-runner | Model-provider independence |
| 5 | Recovery procedures for share-holders | Social redundancy |

Each tier closes a different failure mode. API Death Shield is the innermost, most frequently-fired tier.

## Related failure modes the shield does NOT close

- Malicious prompt injection mid-session → scope-confined; shield does not detect.
- Memory contamination (a prior session wrote stale state) → requires manual audit.
- Model-version drift (old model's state semantics) → requires version tagging (deferred).

The shield closes *ambient infrastructure death*. Other failure modes need other overlays.

## Relationship to SHIELD-PERSIST-LEAK

SHIELD-PERSIST-LEAK is a sibling defense — same "shield" naming because both are PreToolUse hooks at the git-commit boundary. API Death Shield persists state; SHIELD-PERSIST-LEAK prevents NDA-contaminated state from reaching a public remote. Different purposes; same pattern (externalized idempotent overlay at a substrate boundary).

## One-line summary

*Persist session state at well-defined boundaries so API-induced session death degrades to soft-failure — continuity via externalized checkpoints, not in-memory context.*
