#!/usr/bin/env python3
"""
Auto-checkpoint hook for Claude Code — v3 (self-healing).

Fires on PostToolUse for state-changing tools (Edit, Write, Bash).
Reads tool context from stdin, creates a session chain checkpoint.

v3 improvements over v2:
- Detects session boundaries — finalizes stale checkpoints from dead sessions
- Lower auto-finalize threshold (5 instead of 10)
- Git sync after every finalization — no more stale chains
- Session ID tracking — knows when a new session starts

Wired via settings.json hooks:
  "PostToolUse": [{ "matcher": "Edit|Write|Bash", ... }]
"""

import sys
import json
import os
from pathlib import Path

CHAIN_DIR = Path(__file__).parent
sys.path.insert(0, str(CHAIN_DIR))
from chain import (
    add_checkpoint, append_block, load_index, collect_pending,
    get_session_id, get_current_session, set_current_session,
    git_sync, finalize, heal,
)

# Only checkpoint on tools that actually change state
STATE_CHANGING_TOOLS = {'Edit', 'Write', 'Bash', 'NotebookEdit'}

# Skip noisy bash commands that don't change state
READ_ONLY_PATTERNS = [
    'git status', 'git log', 'git diff', 'git show', 'git branch',
    'git remote', 'git fetch', 'git tag',
    'ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'which', 'where',
    'python --version', 'node --version', 'npm --version',
    'cargo --version', 'forge --version', 'rustc --version',
    'python -c', 'type ', 'file ',
]

# Auto-finalize threshold: after N checkpoints, merge into a block
AUTO_FINALIZE_THRESHOLD = 5

# Sync to git after every N finalizations (not every checkpoint — too noisy)
SYNC_AFTER_FINALIZE = True


def is_read_only_bash(command):
    """Check if a bash command is read-only (shouldn't trigger checkpoint)."""
    if not command:
        return True
    cmd = command.strip().lower()
    for ro in READ_ONLY_PATTERNS:
        if cmd.startswith(ro.lower()):
            return True
    # chain.py commands are meta — don't checkpoint the chain checkpointing itself
    if 'chain.py' in cmd or 'auto-checkpoint' in cmd:
        return True
    return False


def extract_description(tool_name, tool_input):
    """Build a human-readable checkpoint description from tool context."""
    if tool_name == 'Edit':
        fp = tool_input.get('file_path', '?')
        short = Path(fp).name if fp else '?'
        old = (tool_input.get('old_string', '') or '')[:40]
        return f"Edit {short}: {old}..."

    elif tool_name == 'Write':
        fp = tool_input.get('file_path', '?')
        short = Path(fp).name if fp else '?'
        size = len(tool_input.get('content', ''))
        return f"Write {short} ({size} chars)"

    elif tool_name == 'Bash':
        cmd = (tool_input.get('command', '') or '')[:80]
        return f"Bash: {cmd}"

    elif tool_name == 'NotebookEdit':
        return f"NotebookEdit: cell operation"

    return f"{tool_name}: action"


def handle_session_boundary():
    """
    Detect if we're in a new session. If so, finalize stale checkpoints
    from the previous session and sync to git.

    This is the self-healing mechanism — when a session dies without
    finalizing, the next session picks up the pieces.
    """
    current_sid = get_session_id()
    stored_sid, _ = get_current_session()

    if stored_sid is None:
        # First ever run — just set session
        set_current_session(current_sid)
        return

    if stored_sid != current_sid:
        # New session detected — finalize stale checkpoints from dead session
        pending = collect_pending()
        if pending:
            finalize(tag="RECOVERED")
            if SYNC_AFTER_FINALIZE:
                git_sync(quiet=True)
        set_current_session(current_sid)


def main():
    try:
        # Read hook context from stdin
        raw = sys.stdin.read()
        if not raw.strip():
            return

        ctx = json.loads(raw)
        tool_name = ctx.get('tool_name', '')
        tool_input = ctx.get('tool_input', {})

        # Filter: only state-changing tools
        if tool_name not in STATE_CHANGING_TOOLS:
            return

        # Filter: skip read-only bash commands
        if tool_name == 'Bash' and is_read_only_bash(tool_input.get('command', '')):
            return

        # Self-heal: detect session boundary and finalize stale checkpoints
        handle_session_boundary()

        # Create checkpoint
        desc = extract_description(tool_name, tool_input)
        add_checkpoint(desc)

        # Auto-finalize if we hit the threshold
        pending = collect_pending()
        if len(pending) >= AUTO_FINALIZE_THRESHOLD:
            summaries = [cp['description'][:30] for cp in pending[-3:]]
            summary = '; '.join(summaries)
            append_block(
                f"[AUTO] {summary}",
                f"{len(pending)} checkpoints auto-finalized"
            )
            if SYNC_AFTER_FINALIZE:
                git_sync(quiet=True)

    except Exception:
        # Never crash the hook — silent failure is better than blocking Claude
        pass


if __name__ == '__main__':
    main()
