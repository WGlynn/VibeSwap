#!/usr/bin/env python3
"""
API Death Shield — Conversation state persistence independent of AI liveness.

Problem: When the LLM API throws errors, the AI can't write state. All existing
crash recovery (WAL, session-state gate, auto-checkpoint) requires the AI to be alive
to write. This script runs CLIENT-SIDE via hooks — it fires even when the API is dead.

Events handled:
  stop-failure   → StopFailure hook: API error killed the turn. Auto-commit dirty
                   files, write crash marker, finalize chain. THE CRITICAL PATH.
  user-prompt    → UserPromptSubmit hook: Log every user message. Preserves the
                   human side of conversation when API dies mid-response.
  stop           → Stop hook: Heartbeat after each successful response. Tracks
                   last-known-good state.
  pre-compact    → PreCompact hook: Sync chain before context compression.

Usage in settings.json:
  "StopFailure":       [{"hooks": [{"type": "command", "command": "python .../api-death-shield.py stop-failure"}]}]
  "UserPromptSubmit":  [{"hooks": [{"type": "command", "command": "python .../api-death-shield.py user-prompt"}]}]
  "Stop":              [{"hooks": [{"type": "command", "command": "python .../api-death-shield.py stop"}]}]
  "PreCompact":        [{"hooks": [{"type": "command", "command": "python .../api-death-shield.py pre-compact"}]}]

Configuration via environment variables:
  JARVIS_PROJECT_DIR — project root (default: current working directory)
  JARVIS_GIT_REMOTE  — remote name for auto-push (default: origin)
  JARVIS_GIT_BRANCH  — branch for auto-push (default: main)
"""

import sys
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

CHAIN_DIR = Path(__file__).parent
PROJECT_DIR = Path(os.environ.get("JARVIS_PROJECT_DIR", os.getcwd()))
GIT_REMOTE = os.environ.get("JARVIS_GIT_REMOTE", "origin")
GIT_BRANCH = os.environ.get("JARVIS_GIT_BRANCH", "main")
SHIELD_DIR = CHAIN_DIR / "shield"
CONVERSATION_LOG = SHIELD_DIR / "conversation.log"
HEARTBEAT_FILE = SHIELD_DIR / "heartbeat.json"
CRASH_MARKERS_DIR = SHIELD_DIR / "crashes"
LOG_FILE = SHIELD_DIR / "shield.log"

MAX_LOG_SIZE = 500_000


def ensure_dirs():
    SHIELD_DIR.mkdir(exist_ok=True)
    CRASH_MARKERS_DIR.mkdir(exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def log(msg):
    """Append to shield log. Never crash."""
    try:
        ensure_dirs()
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{now_iso()}] {msg}\n")
    except Exception:
        pass


def read_stdin():
    """Read hook context from stdin. Returns dict or empty dict."""
    try:
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    except Exception:
        pass
    return {}


def rotate_log_if_needed():
    """Rotate conversation log if it exceeds MAX_LOG_SIZE."""
    try:
        if CONVERSATION_LOG.exists() and CONVERSATION_LOG.stat().st_size > MAX_LOG_SIZE:
            archive = SHIELD_DIR / f"conversation-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.log"
            CONVERSATION_LOG.rename(archive)
            log(f"Rotated conversation log -> {archive.name}")
    except Exception as e:
        log(f"Log rotation error: {e}")


def git_auto_commit(reason):
    """Auto-commit any dirty files in the project repo. Returns True if committed."""
    try:
        def run_git(*args):
            return subprocess.run(
                ["git"] + list(args),
                cwd=str(PROJECT_DIR),
                capture_output=True,
                text=True,
                timeout=15,
            )

        status = run_git("status", "--porcelain")
        if not status.stdout.strip():
            return False

        run_git("add", "-u")
        for f in [".claude/SESSION_STATE.md", ".claude/WAL.md", ".claude/session-chain"]:
            run_git("add", f)

        msg = f"[SHIELD] {reason}\n\nAuto-committed by API Death Shield on {now_iso()}"
        result = run_git("commit", "-m", msg)

        if result.returncode == 0:
            run_git("push", GIT_REMOTE, GIT_BRANCH)
            log(f"Auto-committed: {reason}")
            return True
        else:
            log(f"Commit failed: {result.stderr.strip()[:100]}")
            return False

    except subprocess.TimeoutExpired:
        log("Git auto-commit timed out")
        return False
    except Exception as e:
        log(f"Git auto-commit error: {e}")
        return False


def write_crash_marker(error_info):
    """Write a crash marker file for the next session to find."""
    try:
        ensure_dirs()
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        marker = CRASH_MARKERS_DIR / f"crash-{ts}.json"
        marker.write_text(json.dumps({
            "timestamp": now_iso(),
            "error": error_info,
            "last_heartbeat": read_heartbeat(),
            "git_status": get_git_status(),
        }, indent=2))
        log(f"Crash marker written: {marker.name}")
        return marker
    except Exception as e:
        log(f"Crash marker error: {e}")
        return None


def read_heartbeat():
    try:
        if HEARTBEAT_FILE.exists():
            return json.loads(HEARTBEAT_FILE.read_text())
    except Exception:
        pass
    return None


def get_git_status():
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
        return {"dirty_files": len(lines), "files": lines[:10]}
    except Exception:
        return {"dirty_files": -1, "files": []}


def get_git_head():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


# ============ Event Handlers ============

def handle_stop_failure(ctx):
    """API error killed the turn. Save everything we can."""
    log("=== STOP FAILURE DETECTED ===")
    error_info = ctx.get("error", ctx.get("message", "Unknown API error"))
    log(f"Error: {error_info}")

    write_crash_marker(str(error_info)[:500])
    committed = git_auto_commit(f"API error recovery - {str(error_info)[:80]}")

    try:
        ensure_dirs()
        with open(CONVERSATION_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n--- API ERROR at {now_iso()} ---\n")
            f.write(f"Error: {error_info}\n")
            f.write(f"Auto-committed: {committed}\n")
            f.write(f"---\n")
    except Exception:
        pass

    log("=== STOP FAILURE HANDLED ===")


def handle_user_prompt(ctx):
    """Log every user message — conversation recovery backbone."""
    ensure_dirs()
    rotate_log_if_needed()

    prompt = ctx.get("prompt", ctx.get("message", ctx.get("content", "")))
    if not prompt:
        for key in ctx:
            if isinstance(ctx[key], str) and len(ctx[key]) > 5:
                prompt = ctx[key]
                break

    if not prompt:
        return

    try:
        with open(CONVERSATION_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n[{now_iso()}] USER:\n{prompt[:2000]}\n")
    except Exception as e:
        log(f"Conversation log error: {e}")


def handle_stop(ctx):
    """Heartbeat after each successful response."""
    ensure_dirs()
    try:
        heartbeat = {
            "timestamp": now_iso(),
            "turn_count": (read_heartbeat() or {}).get("turn_count", 0) + 1,
            "git_head": get_git_head(),
        }
        HEARTBEAT_FILE.write_text(json.dumps(heartbeat, indent=2))
    except Exception as e:
        log(f"Heartbeat error: {e}")


def handle_pre_compact(ctx):
    """Context is about to be compressed. Flush state."""
    log("PreCompact: flushing state")
    git_auto_commit("Pre-compact state flush")


def check_crashes():
    """List unprocessed crash markers from previous sessions."""
    ensure_dirs()
    crashes = []
    for f in sorted(CRASH_MARKERS_DIR.glob("crash-*.json")):
        try:
            data = json.loads(f.read_text())
            data["_file"] = str(f)
            crashes.append(data)
        except Exception:
            pass
    return crashes


def clear_crashes():
    for f in CRASH_MARKERS_DIR.glob("crash-*.json"):
        try:
            processed = f.with_suffix(".processed")
            f.rename(processed)
        except Exception:
            pass


def recovery_report():
    crashes = check_crashes()
    if not crashes:
        return None

    report = f"# API Death Shield Recovery Report\n\n"
    report += f"**{len(crashes)} crash(es) detected since last clean session.**\n\n"

    for i, crash in enumerate(crashes, 1):
        report += f"## Crash {i}: {crash.get('timestamp', '?')}\n"
        report += f"- Error: {crash.get('error', 'unknown')}\n"
        hb = crash.get("last_heartbeat")
        if hb:
            report += f"- Last heartbeat: {hb.get('timestamp', '?')} (turn {hb.get('turn_count', '?')})\n"
        gs = crash.get("git_status", {})
        if gs.get("dirty_files", 0) > 0:
            report += f"- Dirty files at crash: {gs['dirty_files']}\n"
            for f in gs.get("files", []):
                report += f"  - `{f}`\n"
        report += "\n"

    if CONVERSATION_LOG.exists():
        try:
            lines = CONVERSATION_LOG.read_text(encoding="utf-8").strip().split("\n")
            recent = lines[-20:] if len(lines) > 20 else lines
            report += "## Recent Conversation Log\n```\n"
            report += "\n".join(recent)
            report += "\n```\n"
        except Exception:
            pass

    return report


def main():
    if len(sys.argv) < 2:
        print("Usage: api-death-shield.py <event>")
        print("Events: stop-failure, user-prompt, stop, pre-compact, check-crashes, clear-crashes, report")
        return

    event = sys.argv[1]
    ctx = read_stdin()

    handlers = {
        "stop-failure": handle_stop_failure,
        "user-prompt": handle_user_prompt,
        "stop": handle_stop,
        "pre-compact": handle_pre_compact,
    }

    if event in handlers:
        try:
            handlers[event](ctx)
        except Exception as e:
            log(f"FATAL: {event} handler crashed: {type(e).__name__}: {e}")
    elif event == "check-crashes":
        crashes = check_crashes()
        if crashes:
            print(f"{len(crashes)} unprocessed crash marker(s)")
            for c in crashes:
                print(f"  {c.get('timestamp', '?')}: {c.get('error', '?')[:60]}")
        else:
            print("No crash markers found.")
    elif event == "clear-crashes":
        clear_crashes()
        print("Crash markers cleared.")
    elif event == "report":
        report = recovery_report()
        if report:
            print(report)
        else:
            print("No crashes to report.")
    else:
        print(f"Unknown event: {event}")


if __name__ == "__main__":
    main()
