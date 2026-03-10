#!/usr/bin/env python
"""
Session Blockchain — Jarvis × Will
Hash-linked chain of every prompt-response pair across all code sessions.
Each block is SHA-256 linked to the previous. Tamper-evident. Searchable. Permanent.

Usage:
    python chain.py append --session 053 --prompt "..." --response "..." [--artifacts "file1,file2"] [--tags "tag1,tag2"]
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
GENESIS_MESSAGE = "In the era before the Avatar, we bent not the elements, but the energy within ourselves."

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
        "tags": ["genesis", "alignment"],
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


# ============ Verification ============

def verify_chain(chain: list) -> tuple[bool, str]:
    """Verify entire chain integrity. Returns (valid, message)."""
    if not chain:
        return False, "Chain is empty"

    # Verify genesis
    if chain[0]["prev_hash"] != "0" * 64:
        return False, "Genesis block has invalid prev_hash"

    expected_hash = compute_hash(chain[0])
    if chain[0]["hash"] != expected_hash:
        return False, f"Genesis block hash mismatch: stored={chain[0]['hash']}, computed={expected_hash}"

    # Verify each subsequent block
    for i in range(1, len(chain)):
        block = chain[i]
        prev = chain[i - 1]

        # Index sequential
        if block["index"] != prev["index"] + 1:
            return False, f"Block {i}: index gap ({prev['index']} -> {block['index']})"

        # Hash link
        if block["prev_hash"] != prev["hash"]:
            return False, f"Block {i}: prev_hash mismatch (expected {prev['hash'][:16]}..., got {block['prev_hash'][:16]}...)"

        # Self-hash
        expected = compute_hash(block)
        if block["hash"] != expected:
            return False, f"Block {i}: hash mismatch (stored={block['hash'][:16]}..., computed={expected[:16]}...)"

    return True, f"Chain valid. {len(chain)} blocks verified."


# ============ Export ============

def export_markdown(chain: list) -> str:
    """Export chain as human-readable markdown."""
    lines = [
        "# Session Blockchain — Jarvis × Will",
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
        artifacts_str = ", ".join(block["artifacts"]) if block["artifacts"] else "—"
        tags_str = ", ".join(f"`{t}`" for t in block["tags"]) if block["tags"] else "—"

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
        # Parse args
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

        # Auto-export markdown
        md = export_markdown(chain)
        with open(CHAIN_MD, "w", encoding="utf-8") as f:
            f.write(md)

        print(f"Block {block['index']} appended. Hash: {block['hash'][:16]}...")
        print(f"Chain length: {len(chain)}")

    elif cmd == "verify":
        valid, msg = verify_chain(chain)
        print(msg)
        sys.exit(0 if valid else 1)

    elif cmd == "view":
        n = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].startswith("--last") is False else None
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
