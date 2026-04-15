#!/usr/bin/env python3
"""
Auto-checkpoint hook for Claude Code.

Fires on PostToolUse for state-changing tools (Edit, Write, Bash, NotebookEdit).
Reads tool context from stdin, creates a session chain checkpoint via chain.py CLI.

Wired via settings.json:
  "PostToolUse": [{ "matcher": "Edit|Write|Bash|NotebookEdit", ... }]
"""

import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime, timezone

CHAIN_DIR = Path(__file__).parent
CHAIN_PY = CHAIN_DIR / "chain.py"
LOG_FILE = CHAIN_DIR / "auto-checkpoint.log"

STATE_CHANGING_TOOLS = {"Edit", "Write", "Bash", "NotebookEdit"}

# Skip noisy bash commands that don't change state
READ_ONLY_PATTERNS = [
    "git status", "git log", "git diff", "git show", "git branch",
    "git remote", "git fetch", "git tag",
    "ls", "cat", "head", "tail", "echo", "pwd", "which", "where",
    "python --version", "node --version", "npm --version",
    "cargo --version", "forge --version", "rustc --version",
    "python -c", "type ", "file ",
]


def log(msg):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def is_read_only_bash(command):
    """Check if a bash command is read-only (shouldn't trigger checkpoint)."""
    if not command:
        return True
    cmd = command.strip().lower()
    for ro in READ_ONLY_PATTERNS:
        if cmd.startswith(ro.lower()):
            return True
    if "chain.py" in cmd or "auto-checkpoint" in cmd:
        return True
    return False


def extract_description(tool_name, tool_input):
    """Build a human-readable checkpoint description from tool context."""
    if tool_name == "Edit":
        fp = tool_input.get("file_path", "?")
        short = Path(fp).name if fp else "?"
        old = (tool_input.get("old_string", "") or "")[:40]
        return (f"Edit {short}: {old}...", [fp] if fp != "?" else [])

    elif tool_name == "Write":
        fp = tool_input.get("file_path", "?")
        short = Path(fp).name if fp else "?"
        size = len(tool_input.get("content", ""))
        return (f"Write {short} ({size} chars)", [fp] if fp != "?" else [])

    elif tool_name == "Bash":
        cmd = (tool_input.get("command", "") or "")[:80]
        return (f"Bash: {cmd}", [])

    elif tool_name == "NotebookEdit":
        return ("NotebookEdit: cell operation", [])

    return (f"{tool_name}: action", [])


def checkpoint(task, progress, files=None):
    """Call chain.py to record a checkpoint."""
    try:
        args = [
            sys.executable, str(CHAIN_PY), "checkpoint",
            "--task", task[:100],
            "--progress", progress[:200],
        ]
        if files:
            args.extend(["--files", ",".join(f[:200] for f in files)])
        subprocess.run(args, timeout=10, capture_output=True)
    except Exception as e:
        log(f"Checkpoint error: {e}")


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return

        ctx = json.loads(raw)
        tool_name = ctx.get("tool_name", "")
        tool_input = ctx.get("tool_input", {})

        if tool_name not in STATE_CHANGING_TOOLS:
            return

        if tool_name == "Bash" and is_read_only_bash(tool_input.get("command", "")):
            return

        desc, files = extract_description(tool_name, tool_input)
        checkpoint(tool_name, desc, files)

    except Exception as e:
        log(f"ERROR: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
