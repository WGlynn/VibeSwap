# Autopilot Bypass Hook

**Status**: live (installed 2026-05-06)
**Location**: `~/.claude/hooks/autopilot-allow.py`
**Toggle**: presence/absence of `~/.claude/.autopilot-active` flag file

---

## Purpose

Suppresses the user-facing permission-prompt during declared autonomous runs. When enabled, every tool call is auto-approved at the permission layer; integrity gates (HIERO, substance, NDA, partner-facing) still run their checks and can still block via `{"continue": false}`.

The hook *only* skips the approval prompt — it does not bypass safety gates.

## Why this exists

Permission prompts during a 300-commit autonomous run break flow. Each prompt requires user attention, and on autopilot they are pure friction — Will has already declared intent to run autonomously over a defined scope, so per-tool approval is redundant.

The hook codifies what `[F·autonomous-production-default]` and `[F·diagnose-on-stop]` describe at the discipline layer: during a declared autonomous run, friction at the per-tool level should be removed; observation moves to the cycle/session boundary instead.

## Mechanism

`autopilot-allow.py` is a PreToolUse hook with no matcher (applies to every tool call). On stdin it receives the standard hook input JSON; it ignores the contents.

- If `~/.claude/.autopilot-active` does NOT exist: hook prints nothing, exits 0. Other PreToolUse hooks and the default permission system handle the call normally.
- If the flag DOES exist: hook prints `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "autopilot mode active (~/.claude/.autopilot-active flag set)"}, "suppressOutput": true}` and exits 0. The harness reads the `permissionDecision` and skips the approval prompt for that tool call.

## Toggle

```bash
# Enable autopilot bypass:
touch ~/.claude/.autopilot-active

# Disable:
rm ~/.claude/.autopilot-active

# Check status:
ls ~/.claude/.autopilot-active 2>/dev/null && echo "ON" || echo "OFF"
```

The flag file approach beats env var because it can be toggled mid-session without shell restart. It also persists across sessions until removed (intentional — autopilot is sticky until explicitly turned off).

## Activation in current session

The settings watcher only picks up changes in `.claude/` that existed at session start. After installing the hook for the first time:
- Open `/hooks` once to reload settings, OR
- Restart Claude Code.

Subsequent sessions pick up the hook automatically.

## What this does NOT bypass

- HIERO compression gate (`hiero-gate.py`) — memory writes still must pass density check
- Substance gate (`partner-facing-substance-gate.py`) — partner-facing writes still scanned
- NDA gate (`nda-eridu-gate.py`) — git operations still scanned for protected material
- Strategic-framing filter (`strategic-framing-filter.py`) — external-audience writes still checked
- Partner-facing additive-framing gate (`partner-facing-additive-gate.py`) — pushes still scanned

These gates run AFTER the autopilot-allow hook. The autopilot-allow hook says "yes, run this tool" at the permission layer; the gates can still say "no, this content fails integrity" at the content layer. The two are orthogonal.

## Sibling primitives

- `[F·autonomous-production-default]` — discipline layer; ack-without-follow-on is the failure mode this hook makes irrelevant
- `[F·diagnose-on-stop]` — Stop-event interrogation hook (proposed, not yet installed) — fires on every stop during autonomous run
- `[P·always-equals-gate]` — "always X" / "never Y" should be hooks, not memory; this is a concrete instance

## Origin

2026-05-06 mid-run, Will: *"we need a hook to bypass these. on autopilot they are a nuisance."* Hook designed and installed during the 300-commit reification run. Pipe-tested with flag-off (no output, defer) and flag-on (allow output). Settings.json updated; live next session.
