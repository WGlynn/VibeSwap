#!/usr/bin/env python3
r"""
Proposal Scraper — Stop hook that persists option/alternative blocks from assistant
responses to PROPOSALS.md. Survives session crashes and API deaths.

Problem: When Claude proposes options (Option A/B/C, numbered alternatives) and the
session crashes before the user decides, the options exist only in the chat transcript.
LLMs are non-deterministic, so a rerun generates different options — the original
"lottery ticket" is lost.

Fix: After each assistant turn, inspect the last message for proposal-shaped content.
If found, append to PROPOSALS.md (project-scoped if cwd is under a project with
.claude/, else global).

Detection heuristics (ANY hit):
  - Markdown bold option headers:   **Option A**, **Option B**, ...
  - Cycle-style option IDs:         **C11-A**, **C11-D**, ...
  - Numbered proposal lists:        2+ lines matching `^\d\.\s+\*\*`
  - Prose-style option markers:     "Option A:", "Option B:", ...

Wired in settings.json as a Stop hook AFTER api-death-shield stop handler.
Non-blocking: errors log to scraper.log and return cleanly.

Configuration via environment variables:
  JARVIS_CLAUDE_DIR — Claude Code config dir (default: ~/.claude)
"""

import sys
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

CHAIN_DIR = Path(__file__).parent
SHIELD_DIR = CHAIN_DIR / "shield"
LOG_FILE = SHIELD_DIR / "proposal-scraper.log"

CLAUDE_DIR = Path(os.environ.get("JARVIS_CLAUDE_DIR", Path.home() / ".claude"))
GLOBAL_PROPOSALS = CLAUDE_DIR / "PROPOSALS.md"

STRONG_PROPOSAL_PATTERNS = [
    re.compile(r"\*\*Option [A-Z]\*\*"),
    re.compile(r"\*\*C\d+-[A-Z]\*\*"),
    re.compile(r"\bOption [A-Z]:"),
]

NUMBERED_PATTERN = re.compile(r"^\s*\d\.\s+\*\*[^*]+\*\*", re.MULTILINE)

PROPOSAL_KEYWORDS = re.compile(
    r"\b(?:options?|propos(?:e|ed|al|als)|alternatives?|pick\s+(?:one|from)|"
    r"which\s+(?:of|one|do\s+you)|choose\s+(?:one|from|between)|"
    r"approve\s*/?\s*adjust|which\s+one)\b",
    re.I,
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def log(msg):
    try:
        SHIELD_DIR.mkdir(exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{now_iso()}] {msg}\n")
    except Exception:
        pass


def read_stdin():
    try:
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    except Exception:
        pass
    return {}


def find_transcript_path(ctx):
    """Locate the JSONL transcript for the current session."""
    tp = ctx.get("transcript_path") or ctx.get("transcriptPath")
    if tp and Path(tp).exists():
        return Path(tp)

    sid = ctx.get("session_id") or ctx.get("sessionId")
    if sid:
        cwd = Path(ctx.get("cwd") or os.getcwd())
        slug = str(cwd).replace(":", "").replace("\\", "-").replace("/", "-").lstrip("-")
        candidate = CLAUDE_DIR / "projects" / slug / f"{sid}.jsonl"
        if candidate.exists():
            return candidate

    return None


def extract_last_assistant_text(transcript_path):
    try:
        last_text = None
        with open(transcript_path, encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                msg = row.get("message", {})
                if msg.get("role") != "assistant":
                    continue
                content = msg.get("content")
                if isinstance(content, list):
                    chunks = [c.get("text", "") for c in content if c.get("type") == "text"]
                    joined = "\n".join(c for c in chunks if c)
                    if joined.strip():
                        last_text = joined
                elif isinstance(content, str) and content.strip():
                    last_text = content
        return last_text
    except Exception as e:
        log(f"Transcript read error: {e}")
        return None


CODE_SPAN_PATTERN = re.compile(r"```.*?```|`[^`\n]+`", re.DOTALL)


def _strip_code_spans(text):
    return CODE_SPAN_PATTERN.sub(" ", text)


def looks_like_proposal(text):
    """Detect whether `text` contains a decision-slate proposal block."""
    if not text:
        return False
    stripped = _strip_code_spans(text)
    for p in STRONG_PROPOSAL_PATTERNS:
        if p.search(stripped):
            return True
    if len(NUMBERED_PATTERN.findall(stripped)) >= 2 and PROPOSAL_KEYWORDS.search(stripped):
        return True
    return False


def choose_proposals_file(ctx):
    """Prefer project-local PROPOSALS.md; fall back to global."""
    cwd = Path(ctx.get("cwd") or os.getcwd())
    for candidate in [cwd] + list(cwd.parents):
        if (candidate / ".claude").is_dir():
            return candidate / ".claude" / "PROPOSALS.md"
    return GLOBAL_PROPOSALS


def ensure_header(path):
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# Proposals Ledger\n\n"
        "Canonical store for options/alternatives proposed for decision. "
        "Survives session crashes.\n"
        "Auto-appended by `.claude/session-chain/proposal-scraper.py`.\n\n---\n",
        encoding="utf-8",
    )


def already_persisted(path, text, sid):
    if not path.exists():
        return False
    try:
        existing = path.read_text(encoding="utf-8")
        first_line = text.strip().split("\n", 1)[0][:100]
        return (sid in existing) and (first_line in existing)
    except Exception:
        return False


def append_proposal(path, text, ctx):
    sid = ctx.get("session_id") or ctx.get("sessionId") or "unknown"
    ts = now_iso()
    topic_match = re.search(r"^#+\s+(.+)$|^\*\*([^*]+)\*\*", text, re.MULTILINE)
    topic = (topic_match.group(1) or topic_match.group(2) or "Proposal") if topic_match else "Proposal"
    topic = topic.strip()[:80]

    if already_persisted(path, text, sid):
        log(f"Skip (already persisted): {topic}")
        return

    ensure_header(path)
    entry = (
        f"\n## {topic} - {ts}\n"
        f"**Session**: `{sid}`\n"
        f"**Status**: proposed\n\n"
        f"{text.strip()}\n\n---\n"
    )
    with open(path, "a", encoding="utf-8") as f:
        f.write(entry)
    log(f"Appended proposal to {path}: {topic}")


def main():
    ctx = read_stdin()
    transcript = find_transcript_path(ctx)
    if not transcript:
        return

    text = extract_last_assistant_text(transcript)
    if not looks_like_proposal(text):
        return

    path = choose_proposals_file(ctx)
    try:
        append_proposal(path, text, ctx)
    except Exception as e:
        log(f"Append error: {e}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"FATAL: {type(e).__name__}: {e}")
