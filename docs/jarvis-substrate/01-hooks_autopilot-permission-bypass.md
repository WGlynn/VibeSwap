# Autopilot Permission Bypass

> A hook that suppresses permission prompts during declared autonomous runs without bypassing safety gates.

## The problem

Claude Code's permission system prompts the user for approval on each tool call by default. Allowlists in `settings.json` (`Bash(*)`, `Edit(*)`, `Write(*)`) reduce this for known-safe tools, but PreToolUse hooks (HIERO, substance gate, NDA gate, partner-facing additive) can still block tool calls based on integrity checks. During declared autonomous runs — e.g., a 300-commit reification burst — every prompt is friction. The user is monitoring the run at session-boundary granularity, not per-tool.

The naive solution is to disable the gates entirely. This is wrong: the gates encode load-bearing properties (HIERO compression, terminology integrity, NDA scope). Disabling them risks shipping bad artifacts.

The right solution: separate the *permission prompt* from the *integrity gate*. Suppress the prompt when autopilot is declared; let the integrity gates still run.

## The hook

`~/.claude/hooks/autopilot-allow.py`:

```python
#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

FLAG = Path.home() / ".claude" / ".autopilot-active"

def main() -> int:
    try:
        sys.stdin.read()
    except Exception:
        pass

    if not FLAG.exists():
        # Autopilot off — defer to other gates / default permissions.
        return 0

    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "autopilot mode active",
        },
        "suppressOutput": True,
    }
    print(json.dumps(out))
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Configured in `settings.json` as the FIRST PreToolUse hook with no matcher (applies to every tool call):

```json
"PreToolUse": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "python ~/.claude/hooks/autopilot-allow.py",
        "timeout": 3
      }
    ]
  },
  ... existing matcher-scoped hooks (HIERO, substance, NDA) ...
]
```

## What it does

- If `~/.claude/.autopilot-active` flag file exists: emits `permissionDecision: "allow"` for the tool call, suppressing the user-facing approval prompt.
- If the flag does not exist: prints nothing, exits 0 — defers to other PreToolUse hooks and the default permission system.

The hook *only* affects the permission decision. Other PreToolUse hooks still run their integrity checks and can still block via `{"continue": false}`. HIERO still rejects prose-style memory writes. Substance gate still catches terminology mismatches. NDA gate still scans for protected material in git operations.

## Toggle

```bash
# Enable autopilot bypass (subsequent tool calls auto-approved at permission layer):
touch ~/.claude/.autopilot-active

# Disable:
rm ~/.claude/.autopilot-active

# Check status:
ls ~/.claude/.autopilot-active 2>/dev/null && echo "ON" || echo "OFF"
```

The flag file beats an env var because it can be toggled mid-session without restart. It also persists across sessions until removed (intentional — autopilot is sticky until explicitly turned off).

## Why opt-in

Mandatory autopilot would defeat the user-attention property when the user *wants* attention. The flag file is opt-in: the user enables it when they're declaring an autonomous run, disables it when they want per-tool attention back. Discipline-driven, not always-on.

A user who never enables the flag has the same experience as before. A user mid-run has no friction at the permission layer. Same hook chain serves both.

## What this DOES NOT bypass

| Gate | What it checks | Affected? |
|------|----------------|-----------|
| HIERO compression | Memory writes use operator-density, not prose | NO — still runs |
| Substance gate | Terminology context-disambiguator match | NO — still runs |
| NDA gate | Protected material in git operations | NO — still runs |
| Strategic-framing filter | External-audience write integrity | NO — still runs |
| Partner-facing additive | Retrospective leaks in commits | NO — still runs |

These gates run AFTER autopilot-allow in the PreToolUse chain. autopilot-allow says "yes, run this tool" at the permission layer; the gates can still say "no, this content fails integrity" at the content layer. Two orthogonal decisions.

## Composition with `[F·diagnose-on-stop]`

`[F·diagnose-on-stop]` is the sibling memory primitive: every stop event during an autonomous run requires diagnosis ("why did you stop?"). Together:

- autopilot-allow removes per-tool friction (forward direction).
- diagnose-on-stop catches every-stop-event for failure-mode gap diagnosis (boundary direction).

A robust autonomous loop uses both. autopilot-allow handles tool-level approval automation; diagnose-on-stop handles boundary-level discipline observation. Different surfaces, same goal: keep the run going while preserving the ability to learn from how it stops.

## Implementation note

The hook needs to be the FIRST PreToolUse entry in `settings.json` so it runs before the matcher-scoped gates. Order matters: a permission decision emitted by an earlier hook is binding; later hooks can still emit `{"continue": false}` to block on content grounds, but the permission prompt itself has already been suppressed.

The settings watcher only picks up changes in `.claude/` that existed at session start. After installing the hook for the first time:
- Open `/hooks` once to reload settings, OR
- Restart Claude Code.

Subsequent sessions pick up the hook automatically.

## Why this fits Layer 1

Hooks at Layer 1 are deterministic, regex/file-shape decisions, no LLM. autopilot-allow checks a single condition (file existence) and emits a single decision. No probabilistic judgment, no model call. Same shape as the rest of the layer — a deterministic rule that fires regardless of session context.

The novelty isn't the mechanism — it's the application. Most Layer 1 hooks block tool calls; autopilot-allow allows them. Both shapes are valid; the architecture supports either polarity.

## Origin

2026-05-06 mid-run, the user declared a 300-commit autonomous reification run. Permission prompts fired multiple times, friction surfaced. The user said: *"we need a hook to bypass these. on autopilot they are a nuisance."* Hook designed, pipe-tested (flag-off → no output, flag-on → allow output), JSON validated, settings updated. Live next session.
