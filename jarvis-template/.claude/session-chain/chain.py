#!/usr/bin/env python
"""
Session Chain — hash-linked chain of every prompt-response pair across sessions.
Each block is SHA-256 linked to the previous. Tamper-evident. Searchable. Permanent.

Sub-blocks (checkpoints) capture work-in-progress so crashes don't lose context.
They merge into the final block on finalize, but survive independently if interrupted.

Usage:
    python chain.py append --session 053 --prompt "..." --response "..." [--artifacts "file1,file2"] [--tags "tag1,tag2"]
    python chain.py checkpoint --task "refactor" --progress "split foo into helpers" [--files "file1,file2"]
    python chain.py finalize --prompt "..." --response "..." [--tags "tag1,tag2"]
    python chain.py pending
    python chain.py verify
    python chain.py view [--last N]
    python chain.py search "keyword"
    python chain.py stats
    python chain.py export-md
"""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone

# ============ Config ============

CHAIN_DIR = os.path.dirname(os.path.abspath(__file__))
CHAIN_FILE = os.path.join(CHAIN_DIR, "chain.json")
CHAIN_MD = os.path.join(CHAIN_DIR, "chain.md")
PENDING_FILE = os.path.join(CHAIN_DIR, "pending.json")
GENESIS_MESSAGE = "Genesis block for the session chain."

# ============ Block Operations ============

def compute_hash(block: dict) -> str:
    """SHA-256 of canonical block content (everything except the hash field itself)."""
    canonical = {
        "index": block["index"],
        "timestamp": block["timestamp"],
        "prev_hash": block["prev_hash"],
        "session_id": block["session_id"],
        "prompt": block["prompt"],
        "response": block["response"],
        "artifacts": block["artifacts"],
        "tags": block["tags"],
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_genesis() -> dict:
    """Block 0 — the beginning."""
    block = {
        "index": 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prev_hash": "0" * 64,
        "session_id": "000",
        "prompt": "genesis",
        "response": GENESIS_MESSAGE,
        "artifacts": [],
        "tags": ["genesis"],
    }
    block["hash"] = compute_hash(block)
    return block


def create_block(chain: list, session_id: str, prompt: str, response: str,
                 artifacts: list = None, tags: list = None) -> dict:
    """Create the next block in the chain."""
    prev = chain[-1]
    block = {
        "index": prev["index"] + 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prev_hash": prev["hash"],
        "session_id": session_id,
        "prompt": prompt,
        "response": response,
        "artifacts": artifacts or [],
        "tags": tags or [],
    }
    block["hash"] = compute_hash(block)
    return block


# ============ Chain I/O ============

def load_chain() -> list:
    """Load chain from disk. Creates genesis if file doesn't exist."""
    if not os.path.exists(CHAIN_FILE):
        genesis = create_genesis()
        save_chain([genesis])
        return [genesis]
    with open(CHAIN_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_chain(chain: list):
    """Atomic write — write to temp then rename."""
    tmp = CHAIN_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(chain, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CHAIN_FILE)


# ============ Sub-Block (Checkpoint) Operations ============

def load_pending() -> list:
    """Load pending sub-blocks. Returns empty list if none."""
    if not os.path.exists(PENDING_FILE):
        return []
    with open(PENDING_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_pending(pending: list):
    """Atomic write of pending sub-blocks."""
    tmp = PENDING_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(pending, f, indent=2, ensure_ascii=False)
    os.replace(tmp, PENDING_FILE)


def clear_pending():
    """Remove pending file after finalization."""
    if os.path.exists(PENDING_FILE):
        os.remove(PENDING_FILE)


def create_checkpoint(chain: list, pending: list, task: str, progress: str,
                      files: list = None) -> dict:
    """Create a sub-block checkpoint for work-in-progress.

    Sub-blocks chain off the last main block's hash but also link to prior sub-blocks.
    This creates a recoverable WAL (Write-Ahead Log) for cognitive state.
    """
    parent_hash = chain[-1]["hash"]
    sub_index = len(pending)
    prev_sub_hash = pending[-1]["sub_hash"] if pending else "0" * 64

    sub_block = {
        "sub_index": sub_index,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "parent_block": chain[-1]["index"],
        "parent_hash": parent_hash,
        "prev_sub_hash": prev_sub_hash,
        "task": task,
        "progress": progress,
        "files_touched": files or [],
        "status": "in_progress",
    }

    canonical = {
        "sub_index": sub_block["sub_index"],
        "timestamp": sub_block["timestamp"],
        "parent_hash": sub_block["parent_hash"],
        "prev_sub_hash": sub_block["prev_sub_hash"],
        "task": sub_block["task"],
        "progress": sub_block["progress"],
        "files_touched": sub_block["files_touched"],
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    sub_block["sub_hash"] = hashlib.sha256(raw.encode("utf-8")).hexdigest()

    return sub_block


def finalize_pending(chain: list, pending: list, session_id: str,
                     prompt: str, response: str, tags: list = None) -> dict:
    """Merge all pending sub-blocks into a single main block.

    The sub-block history is preserved in the block's 'checkpoints' field,
    creating an audit trail of work-in-progress that led to this block.
    """
    checkpoint_summary = []
    all_files = []
    for sub in pending:
        checkpoint_summary.append(f"[{sub['timestamp'][:19]}] {sub['task']}: {sub['progress']}")
        all_files.extend(sub.get("files_touched", []))

    all_files = list(dict.fromkeys(all_files))

    merged_response = response
    if checkpoint_summary:
        merged_response += "\n\n--- Checkpoints ---\n" + "\n".join(checkpoint_summary)

    block = create_block(chain, session_id, prompt, merged_response, all_files, tags)
    block["checkpoint_count"] = len(pending)
    block["checkpoint_hashes"] = [s["sub_hash"][:16] for s in pending]

    return block


# ============ Verification ============

def verify_chain(chain: list) -> tuple:
    """Verify entire chain integrity. Returns (valid, message)."""
    if not chain:
        return False, "Chain is empty"

    if chain[0]["prev_hash"] != "0" * 64:
        return False, "Genesis block has invalid prev_hash"

    expected_hash = compute_hash(chain[0])
    if chain[0]["hash"] != expected_hash:
        return False, f"Genesis block hash mismatch: stored={chain[0]['hash']}, computed={expected_hash}"

    for i in range(1, len(chain)):
        block = chain[i]
        prev = chain[i - 1]

        if block["index"] != prev["index"] + 1:
            return False, f"Block {i}: index gap ({prev['index']} -> {block['index']})"

        if block["prev_hash"] != prev["hash"]:
            return False, f"Block {i}: prev_hash mismatch (expected {prev['hash'][:16]}..., got {block['prev_hash'][:16]}...)"

        expected = compute_hash(block)
        if block["hash"] != expected:
            return False, f"Block {i}: hash mismatch (stored={block['hash'][:16]}..., computed={expected[:16]}...)"

    return True, f"Chain valid. {len(chain)} blocks verified."


# ============ Export ============

def export_markdown(chain: list) -> str:
    """Export chain as human-readable markdown."""
    lines = [
        "# Session Chain",
        "",
        f"> Chain length: {len(chain)} blocks | Last verified: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "---",
        "",
    ]

    for block in chain:
        ts = block["timestamp"][:19].replace("T", " ")
        hash_short = block["hash"][:12]
        prev_short = block["prev_hash"][:12]
        artifacts_str = ", ".join(block["artifacts"]) if block["artifacts"] else "-"
        tags_str = ", ".join(f"`{t}`" for t in block["tags"]) if block["tags"] else "-"

        lines.extend([
            f"## Block {block['index']} `{hash_short}...`",
            f"**Session**: {block['session_id']} | **Time**: {ts} UTC | **Prev**: `{prev_short}...`",
            "",
            f"**Prompt**: {block['prompt']}",
            "",
            f"**Response**: {block['response']}",
            "",
            f"**Artifacts**: {artifacts_str}",
            f"**Tags**: {tags_str}",
            "",
            "---",
            "",
        ])

    return "\n".join(lines)


# ============ Search ============

def search_chain(chain: list, keyword: str) -> list:
    """Search blocks by keyword (case-insensitive) across prompt, response, artifacts, tags."""
    kw = keyword.lower()
    results = []
    for block in chain:
        searchable = " ".join([
            block["prompt"],
            block["response"],
            " ".join(block["artifacts"]),
            " ".join(block["tags"]),
            block["session_id"],
        ]).lower()
        if kw in searchable:
            results.append(block)
    return results


# ============ Stats ============

def chain_stats(chain: list) -> str:
    """Summary statistics."""
    if not chain:
        return "Empty chain."

    sessions = set(b["session_id"] for b in chain)
    all_tags = {}
    for b in chain:
        for t in b["tags"]:
            all_tags[t] = all_tags.get(t, 0) + 1

    first_ts = chain[0]["timestamp"][:10]
    last_ts = chain[-1]["timestamp"][:10]
    top_tags = sorted(all_tags.items(), key=lambda x: -x[1])[:10]

    lines = [
        f"Blocks: {len(chain)}",
        f"Sessions: {len(sessions)} ({', '.join(sorted(sessions))})",
        f"Span: {first_ts} -> {last_ts}",
        f"Top tags: {', '.join(f'{t}({c})' for t, c in top_tags)}",
        f"Chain head: {chain[-1]['hash'][:16]}...",
    ]
    return "\n".join(lines)


# ============ CLI ============

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    chain = load_chain()

    if cmd == "append":
        args = {}
        i = 2
        while i < len(sys.argv):
            if sys.argv[i].startswith("--") and i + 1 < len(sys.argv):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1]
                args[key] = val
                i += 2
            else:
                i += 1

        session_id = args.get("session", "???")
        prompt = args.get("prompt", "")
        response = args.get("response", "")
        artifacts = [a.strip() for a in args.get("artifacts", "").split(",") if a.strip()]
        tags = [t.strip() for t in args.get("tags", "").split(",") if t.strip()]

        if not prompt or not response:
            print("ERROR: --prompt and --response are required")
            sys.exit(1)

        block = create_block(chain, session_id, prompt, response, artifacts, tags)
        chain.append(block)
        save_chain(chain)

        md = export_markdown(chain)
        with open(CHAIN_MD, "w", encoding="utf-8") as f:
            f.write(md)

        print(f"Block {block['index']} appended. Hash: {block['hash'][:16]}...")
        print(f"Chain length: {len(chain)}")

    elif cmd == "checkpoint":
        args = {}
        i = 2
        while i < len(sys.argv):
            if sys.argv[i].startswith("--") and i + 1 < len(sys.argv):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1]
                args[key] = val
                i += 2
            else:
                i += 1

        task = args.get("task", "")
        progress = args.get("progress", "")
        files = [f.strip() for f in args.get("files", "").split(",") if f.strip()]

        if not task or not progress:
            print("ERROR: --task and --progress are required")
            sys.exit(1)

        pending = load_pending()
        sub = create_checkpoint(chain, pending, task, progress, files)
        pending.append(sub)
        save_pending(pending)

        print(f"Checkpoint {sub['sub_index']} saved. Sub-hash: {sub['sub_hash'][:16]}...")
        print(f"Parent block: {sub['parent_block']} | Pending checkpoints: {len(pending)}")

    elif cmd == "finalize":
        pending = load_pending()
        if not pending:
            print("No pending checkpoints to finalize. Use 'append' for direct blocks.")
            sys.exit(0)

        args = {}
        i = 2
        while i < len(sys.argv):
            if sys.argv[i].startswith("--") and i + 1 < len(sys.argv):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1]
                args[key] = val
                i += 2
            else:
                i += 1

        session_id = args.get("session", "???")
        prompt = args.get("prompt", "")
        response = args.get("response", "")
        tags = [t.strip() for t in args.get("tags", "").split(",") if t.strip()]

        if not prompt or not response:
            print("ERROR: --prompt and --response are required")
            sys.exit(1)

        block = finalize_pending(chain, pending, session_id, prompt, response, tags)
        chain.append(block)
        save_chain(chain)
        clear_pending()

        md = export_markdown(chain)
        with open(CHAIN_MD, "w", encoding="utf-8") as f:
            f.write(md)

        print(f"Block {block['index']} finalized with {block['checkpoint_count']} checkpoints merged.")
        print(f"Hash: {block['hash'][:16]}... | Chain length: {len(chain)}")

    elif cmd == "pending":
        pending = load_pending()
        if not pending:
            print("No pending checkpoints.")
        else:
            print(f"Pending checkpoints: {len(pending)} (parent block: {pending[0]['parent_block']})\n")
            for sub in pending:
                ts = sub["timestamp"][:19].replace("T", " ")
                print(f"  [{sub['sub_index']}] {ts} | {sub['sub_hash'][:12]}...")
                print(f"      Task: {sub['task']}")
                print(f"      Progress: {sub['progress']}")
                if sub.get("files_touched"):
                    print(f"      Files: {', '.join(sub['files_touched'])}")
                print()

    elif cmd == "verify":
        valid, msg = verify_chain(chain)
        print(msg)
        sys.exit(0 if valid else 1)

    elif cmd == "view":
        n = None
        if "--last" in sys.argv:
            idx = sys.argv.index("--last")
            n = int(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 5
            blocks = chain[-n:]
        else:
            blocks = chain

        for b in blocks:
            ts = b["timestamp"][:19].replace("T", " ")
            print(f"[{b['index']:04d}] {ts} | S{b['session_id']} | {b['hash'][:12]}...")
            print(f"  Q: {b['prompt'][:100]}")
            print(f"  A: {b['response'][:100]}")
            if b["artifacts"]:
                print(f"  Files: {', '.join(b['artifacts'])}")
            print()

    elif cmd == "search":
        if len(sys.argv) < 3:
            print("Usage: chain.py search <keyword>")
            sys.exit(1)
        keyword = " ".join(sys.argv[2:])
        results = search_chain(chain, keyword)
        print(f"Found {len(results)} blocks matching '{keyword}':\n")
        for b in results:
            ts = b["timestamp"][:19].replace("T", " ")
            print(f"[{b['index']:04d}] S{b['session_id']} | {ts} | {b['hash'][:12]}...")
            print(f"  Q: {b['prompt'][:120]}")
            print(f"  A: {b['response'][:120]}")
            print()

    elif cmd == "stats":
        print(chain_stats(chain))

    elif cmd == "export-md":
        md = export_markdown(chain)
        with open(CHAIN_MD, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"Exported {len(chain)} blocks to {CHAIN_MD}")

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
