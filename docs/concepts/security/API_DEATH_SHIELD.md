# API Death Shield

**Status**: Live. PreToolUse hook at `~/.claude/hooks/api-death-shield.py`.
**Audience**: First-encounter OK. Step-by-step scenario walk.
**Primitive**: [`memory/primitive_api-death-shield.md`](../memory/primitive_api-death-shield.md) <!-- FIXME: ../memory/primitive_api-death-shield.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
**Instance of**: [Stateful Overlay](../cross-chain/STATEFUL_OVERLAY.md).

---

## A scenario you've experienced

You're pairing with an AI assistant on a complex task. 45 minutes in, you've built substantial context. Then —

Network blip. API returns 500. Your session ends.

You reconnect, start a new session. The AI greets you: "Hi! How can I help?"

It has NO memory of what you were doing. You have to re-explain the whole 45 minutes of context. Some decisions you'd made, the AI doesn't know about. You realize later it made different assumptions in the new session.

**This is the loss that happens every time an LLM session dies.**

## The fix — API Death Shield

The Shield is a hook that persists session state before every risky operation. If the session dies, the next session can RESUME from the last checkpoint.

```
Session dies → state saved at last checkpoint →
New session starts → reads checkpoint →
Continues from where prior left off.
```

Session-death becomes a SOFT failure, not terminal.

## Walk through a session-death scenario

Let me trace this end-to-end with concrete events.

### 10:00 AM — Session starts

You ask the AI to refactor a contract. You've just committed some changes.

### 10:15 AM — Mid-task

The AI has:
- Read 5 files.
- Made 3 edits.
- Run tests.
- Identified 2 more issues to fix.

Current state:
- Working tree SHA: `abc123...`
- Last tool used: Edit
- In-flight tasks: [fix issue #3, fix issue #4]

### 10:16 AM — PreToolUse hook fires

Before the AI calls the next Edit tool, the Shield hook runs. It captures:

```json
{
  "timestamp": "2026-04-22T10:16:32Z",
  "session_id": "abc-def-123",
  "working_tree_sha": "abc123...",
  "last_tool": "Edit",
  "in_flight_task": "fix issue #3 (modifying ShardOperatorRegistry.sol)",
  "pending_writes": ["file1.sol", "file2.sol"]
}
```

Writes atomically to `.claude/SHIELD_CHECKPOINT.json`.

### 10:17 AM — Network blip. Session ends.

You don't know yet. The AI does have a brief connection but then loses it.

### 10:20 AM — You reconnect

New session. You type "continue."

### 10:20:01 AM — OnSessionStart hook runs

The Shield's session-start hook reads `.claude/SHIELD_CHECKPOINT.json`. It finds the checkpoint from 10:16.

It verifies:
- Working tree SHA matches current state? If yes: clean resume possible.
- Previous session was interrupted mid-tool? Yes.

### 10:20:02 AM — Context injection

Shield injects into the new session:

```
Previous session ended mid-task. Resuming from:
- Working tree: abc123... (verified unchanged)
- Last action: Edit on ShardOperatorRegistry.sol
- In-flight: fix issue #3

Please continue where the previous session left off.
```

### 10:20:03 AM — AI resumes

The AI now has context. "Got it. I was fixing issue #3. Let me continue by re-reading ShardOperatorRegistry.sol and applying the next edit."

No re-explaining. No context loss. Session-death was a soft failure; you lost 3 minutes, not 45.

## Why idempotent matters

The Shield can be applied twice in rapid succession (e.g., tool call retries after partial failure). It must be idempotent.

If not idempotent:
- Retries create duplicate checkpoints.
- Partial failures create inconsistent state.
- Restore logic gets confused.

How it's idempotent:
- Atomic file writes (same content twice = same final content).
- Restore tolerates stale checkpoints (detects via SHA comparison).
- Task state derived from canonical sources (TaskList, git log) not mirrored.

## Why externalized matters

Could we just fix the LLM to have persistent memory?

No, in practice:
- The LLM is a product we don't control.
- LLM session-lifecycle is on the provider's side.
- Fighting the LLM's memory model is harder than externalizing.

Externalizing means the checkpoint lives OUTSIDE the LLM's context. Any LLM can read it on startup. Cross-LLM compatibility is free.

## What the Shield does NOT catch

Honest limits:

### Limit 1 — State modifications between checkpoints

The Shield checkpoints before tool calls. State modifications during a tool call (e.g., the tool itself modifies state) are captured only at the NEXT tool call's checkpoint.

If the session dies mid-tool, the checkpoint is from BEFORE that tool started. The tool's modifications might be partial.

Mitigation: tools should themselves be idempotent. If re-run from pre-tool state, they should produce the same result.

### Limit 2 — External state

Shield persists LLM conversation state. External state (contract deployments, file system outside `.claude/`, remote services) isn't captured.

If the session dies after modifying remote state, the next session knows what the LLM wanted to do but must verify what actually happened.

### Limit 3 — Malicious prompt injection mid-session

If a hostile input corrupts state before the next checkpoint, the checkpoint itself may be corrupted. Shield doesn't detect mid-session attacks.

Separate mitigation: input validation + shield combined.

## The broader persistence stack

Shield is Tier 0 of the [Mind Persistence Mission](../ai-native/MIND_PERSISTENCE_MISSION.md) — the innermost tier, most frequently fired.

| Tier | Mechanism | Target failure |
|---|---|---|
| 0 | API Death Shield | Single-session survival |
| 1 | Git repo memory | Cross-session memory |
| 2 | Encrypted capsules + Shamir | Catastrophic loss |
| 3 | Portable skill export | Cross-substrate portability |
| 4 | Backend-agnostic mind-runner | Model-provider independence |
| 5 | Recovery procedures | Social redundancy |

Each tier catches a different failure mode. API Death Shield is the first line of defense.

## Implementation sketch

Hook at `~/.claude/hooks/api-death-shield.py`:

```python
def pre_tool_use(tool_name, tool_input):
    session_state = {
        'timestamp': datetime.utcnow().isoformat(),
        'last_tool': tool_name,
        'working_tree_sha': get_git_head(),
        'in_flight_task': read_task_state(),
        'pending_writes': enumerate_pending_edits(),
    }
    write_atomic('.claude/SHIELD_CHECKPOINT.json', session_state)
```

Session start handler:

```python
def on_session_start():
    if not exists('.claude/SHIELD_CHECKPOINT.json'):
        return
    state = read_json('.claude/SHIELD_CHECKPOINT.json')
    if state['working_tree_sha'] != get_git_head():
        log_divergence(state)
        return  # stale checkpoint; don't apply
    inject_context(state)
```

## What AHP is NOT

Don't confuse API Death Shield with:

- **Memory files (Tier 1)**: those are long-term; Shield is session-bounded.
- **Recording of completed work**: Shield captures WORK-IN-PROGRESS; completed work is in git.
- **A debugger**: Shield doesn't let you inspect arbitrary past states.

Shield is specifically: "did a session die mid-work? if so, resume."

## Relationship to other primitives

- **Instance of**: [Stateful Overlay](../cross-chain/STATEFUL_OVERLAY.md) — externalized idempotent checkpoint.
- **Instance of**: [Universal-Coverage → Hook](../memory/primitive_universal-coverage-hook.md) — firing at a tool-call boundary for universal coverage. <!-- FIXME: ../memory/primitive_universal-coverage-hook.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
- **Part of**: [Mind Persistence Mission](../ai-native/MIND_PERSISTENCE_MISSION.md) — Tier 0.

## For users

If you're running Claude Code: verify Shield is installed.

```bash
ls ~/.claude/hooks/api-death-shield.py
```

If missing, install:
```bash
cp ~/.claude/skills/api-death-shield/hook.py ~/.claude/hooks/api-death-shield.py
```

Reload. Subsequent sessions have session-death protection.

## One-line summary

*API Death Shield persists session state before each risky tool call. When sessions die mid-work, next session resumes from the checkpoint. Walked scenario (10:00 → 10:17 die → 10:20 resume) shows 3-minute loss instead of 45-minute re-explanation. Externalized idempotent overlay pattern applied at LLM-session-boundary. Tier 0 of Mind Persistence Mission; first-fired line of defense.*
