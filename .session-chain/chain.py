#!/usr/bin/env python3
"""
Session Chain v3 — Hash-linked cognitive state persistence.

DESIGN (learned from v1+v2 failure):
- Blocks are JSON files, not in-memory
- Each block references parent hash → tamper-evident chain
- Sub-blocks (checkpoints) survive crashes
- Index file for fast lookup without loading entire chain
- Auto-sync to git after finalization (both remotes)
- Session boundary detection — stale checkpoints auto-finalize on new session

Usage:
    python chain.py append "prompt summary" "response summary"
    python chain.py checkpoint "work in progress description"
    python chain.py finalize                    # merge sub-blocks into main block
    python chain.py pending                     # view in-progress checkpoints
    python chain.py status                      # chain stats
    python chain.py last [n]                    # last N blocks
    python chain.py sync                        # commit + push to both remotes
    python chain.py heal                        # finalize stale + sync
"""

import sys
import json
import hashlib
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

CHAIN_DIR = Path(__file__).parent
BLOCKS_DIR = CHAIN_DIR / "blocks"
PENDING_DIR = CHAIN_DIR / "pending"
INDEX_FILE = CHAIN_DIR / "index.json"
SESSION_FILE = CHAIN_DIR / ".current_session"

# Git repo root (session-chain lives inside .claude which is inside the home dir)
# We need to find the vibeswap repo for git operations
VIBESWAP_DIR = Path("C:/Users/Will/vibeswap")


def ensure_dirs():
    BLOCKS_DIR.mkdir(exist_ok=True)
    PENDING_DIR.mkdir(exist_ok=True)


def load_index():
    if INDEX_FILE.exists():
        return json.loads(INDEX_FILE.read_text())
    return {"blocks": [], "head": None, "created": now_iso()}


def save_index(index):
    INDEX_FILE.write_text(json.dumps(index, indent=2))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def now_date():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def compute_hash(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:16]


# ============ Session Tracking ============

def get_session_id():
    """Generate a session ID from PID + date. Different session = different ID."""
    # Use CLAUDE_SESSION env var if set, otherwise PID + date
    env_session = os.environ.get("CLAUDE_SESSION_ID", "")
    if env_session:
        return env_session
    # Fallback: parent PID (Claude Code process) + date
    ppid = os.getppid()
    return f"{ppid}-{now_date()}"


def get_current_session():
    """Read the stored session ID."""
    if SESSION_FILE.exists():
        try:
            data = json.loads(SESSION_FILE.read_text())
            return data.get("session_id"), data.get("started")
        except (json.JSONDecodeError, KeyError):
            pass
    return None, None


def set_current_session(session_id):
    """Write the current session ID."""
    SESSION_FILE.write_text(json.dumps({
        "session_id": session_id,
        "started": now_iso(),
    }))


def is_new_session():
    """Check if we're in a different session than the last checkpoint."""
    current = get_session_id()
    stored, _ = get_current_session()
    return stored is not None and stored != current


# ============ Core Chain Operations ============

def append_block(prompt_summary, response_summary):
    ensure_dirs()
    index = load_index()

    block = {
        "id": len(index["blocks"]),
        "parent": index["head"],
        "timestamp": now_iso(),
        "prompt": prompt_summary,
        "response": response_summary,
        "checkpoints": collect_pending(),
    }
    block["hash"] = compute_hash(block)

    # Write block file
    block_file = BLOCKS_DIR / f"block-{block['id']:04d}.json"
    block_file.write_text(json.dumps(block, indent=2))

    # Update index
    index["blocks"].append({
        "id": block["id"],
        "hash": block["hash"],
        "timestamp": block["timestamp"],
        "prompt": prompt_summary[:80],
    })
    index["head"] = block["hash"]
    save_index(index)

    # Clear pending
    clear_pending()

    print(f"Block #{block['id']} committed: {block['hash']}")
    return block


def add_checkpoint(description):
    ensure_dirs()
    cp = {
        "timestamp": now_iso(),
        "description": description,
        "hash": compute_hash({"ts": now_iso(), "desc": description}),
    }
    cp_file = PENDING_DIR / f"cp-{datetime.now(timezone.utc).strftime('%H%M%S%f')}.json"
    cp_file.write_text(json.dumps(cp, indent=2))
    print(f"Checkpoint: {cp['hash'][:8]} — {description[:60]}")
    return cp


def collect_pending():
    cps = []
    if PENDING_DIR.exists():
        for f in sorted(PENDING_DIR.glob("cp-*.json")):
            try:
                cps.append(json.loads(f.read_text()))
            except Exception:
                pass
    return cps


def clear_pending():
    if PENDING_DIR.exists():
        for f in PENDING_DIR.glob("cp-*.json"):
            f.unlink()


def finalize(tag="WIP"):
    """Merge pending checkpoints into a block."""
    cps = collect_pending()
    if not cps:
        print("Nothing to finalize.")
        return None
    desc = "; ".join(cp["description"][:40] for cp in cps)
    block = append_block(f"[{tag}] {desc[:80]}", f"{len(cps)} checkpoints finalized")
    return block


# ============ Git Sync ============

def git_sync(quiet=False):
    """Commit session-chain changes and push to both remotes."""
    if not VIBESWAP_DIR.exists():
        if not quiet:
            print("Warning: vibeswap dir not found, skipping git sync")
        return False

    chain_rel = os.path.relpath(CHAIN_DIR, VIBESWAP_DIR).replace("\\", "/")

    try:
        def run_git(*args, **kwargs):
            return subprocess.run(
                ["git"] + list(args),
                cwd=str(VIBESWAP_DIR),
                capture_output=True,
                text=True,
                timeout=30,
                **kwargs,
            )

        # Check if session-chain files have changes
        status = run_git("status", "--porcelain", str(CHAIN_DIR))
        if not status.stdout.strip():
            if not quiet:
                print("Session chain: nothing to sync (clean)")
            return True

        # Stage session-chain files only
        run_git("add", str(CHAIN_DIR))

        # Commit
        index = load_index()
        head = index.get("head", "???")[:8]
        n_blocks = len(index.get("blocks", []))
        msg = f"session-chain: sync {n_blocks} blocks (head: {head})"
        result = run_git("commit", "-m", msg)

        if result.returncode != 0:
            if not quiet:
                print(f"Git commit failed: {result.stderr.strip()}")
            return False

        # Push to both remotes (best-effort, don't fail if one is down)
        for remote in ["origin", "stealth"]:
            push = run_git("push", remote, "master")
            if push.returncode != 0 and not quiet:
                print(f"Push to {remote} failed: {push.stderr.strip()[:80]}")

        if not quiet:
            print(f"Session chain synced: {msg}")
        return True

    except subprocess.TimeoutExpired:
        if not quiet:
            print("Git sync timed out")
        return False
    except Exception as e:
        if not quiet:
            print(f"Git sync error: {e}")
        return False


# ============ Heal (stale recovery) ============

def heal(quiet=False):
    """Finalize any stale pending checkpoints and sync to git."""
    cps = collect_pending()
    if cps:
        block = finalize(tag="RECOVERED")
        if block and not quiet:
            print(f"Healed: finalized {len(cps)} stale checkpoints into block #{block['id']}")
    git_sync(quiet=quiet)


# ============ Display ============

def show_pending():
    cps = collect_pending()
    if not cps:
        print("No pending checkpoints.")
        return
    print(f"{len(cps)} pending checkpoint(s):")
    for cp in cps:
        print(f"  [{cp['hash'][:8]}] {cp['timestamp']} — {cp['description']}")


def show_status():
    index = load_index()
    cps = collect_pending()
    sid, started = get_current_session()
    print(f"Session Chain v3")
    print(f"  Blocks: {len(index['blocks'])}")
    print(f"  Head:   {index['head'] or '(genesis)'}")
    print(f"  Pending checkpoints: {len(cps)}")
    print(f"  Created: {index.get('created', 'unknown')}")
    print(f"  Session: {sid or 'none'} (started: {started or 'unknown'})")


def show_last(n=5):
    index = load_index()
    blocks = index["blocks"][-n:]
    if not blocks:
        print("No blocks yet.")
        return
    for b in blocks:
        print(f"  #{b['id']} [{b['hash'][:8]}] {b['timestamp']} — {b['prompt']}")


# ============ CLI ============

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]

    if cmd == "append":
        if len(sys.argv) < 4:
            print("Usage: chain.py append <prompt> <response>")
            return
        append_block(sys.argv[2], sys.argv[3])
    elif cmd == "checkpoint":
        if len(sys.argv) < 3:
            print("Usage: chain.py checkpoint <description>")
            return
        add_checkpoint(sys.argv[2])
    elif cmd == "finalize":
        finalize()
    elif cmd == "pending":
        show_pending()
    elif cmd == "status":
        show_status()
    elif cmd == "last":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        show_last(n)
    elif cmd == "sync":
        git_sync()
    elif cmd == "heal":
        heal()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
