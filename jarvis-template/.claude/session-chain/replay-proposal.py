#!/usr/bin/env python3
"""
Replay Proposal — Non-deterministic proposal replay via Anthropic SDK.

Philosophy: Instead of mourning a lost "lottery ticket" when a session crashes
mid-proposal, print more tickets. Non-determinism becomes a feature: run the same
captured input N times, cluster outputs, surface stable-across-runs (signal) and
unique-to-one-run (creative flukes worth considering) separately.

Usage:
  python replay-proposal.py <session-id> [--turns N] [--samples K] [--temperature T]
  python replay-proposal.py 5ba12ced-49bc-424a-9145-a73ee63cbeb6 --samples 5

What it does:
  1. Read the JSONL transcript for <session-id>.
  2. Slice to the last --turns user+assistant messages (default: full session).
  3. Strip the last assistant message (the one that was generated / lost).
  4. Fire K parallel API calls with the captured messages + system prompt.
  5. Print all K outputs side-by-side, with simple stability marking
     (lines appearing in >=ceil(K/2) outputs marked [STABLE], unique marked [UNIQUE]).

Requires: ANTHROPIC_API_KEY in environment, `pip install anthropic`.

Where it fits: #4 in the crash-recovery stack (the other three being the self-
discipline primitive, the Stop-hook scraper, and transcript mining of past runs).
This one is for when you want *more* options than the original session produced —
or when the original options were mediocre and you want a fresh sample.

Configuration via environment variables:
  JARVIS_CLAUDE_DIR — Claude Code config dir (default: ~/.claude)
"""

import sys
import json
import os
import argparse
from pathlib import Path
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

CLAUDE_DIR = Path(os.environ.get("JARVIS_CLAUDE_DIR", Path.home() / ".claude"))
PROJECTS_ROOT = CLAUDE_DIR / "projects"


def find_transcript(session_id):
    for p in PROJECTS_ROOT.rglob(f"{session_id}.jsonl"):
        return p
    return None


def load_messages(transcript_path, keep_last_n_turns=None):
    """Return (system_prompt, messages_list) suitable for Anthropic SDK."""
    system_prompt = None
    messages = []
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except Exception:
                continue
            msg = row.get("message", {})
            role = msg.get("role")
            content = msg.get("content")
            if role == "system" and not system_prompt:
                if isinstance(content, str):
                    system_prompt = content
                elif isinstance(content, list):
                    system_prompt = "\n".join(
                        c.get("text", "") for c in content if c.get("type") == "text"
                    )
                continue
            if role in ("user", "assistant"):
                if isinstance(content, list):
                    text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
                    text = "\n".join(t for t in text_parts if t)
                elif isinstance(content, str):
                    text = content
                else:
                    continue
                if text.strip():
                    messages.append({"role": role, "content": text})

    if messages and messages[-1]["role"] == "assistant":
        messages.pop()

    if keep_last_n_turns:
        messages = messages[-keep_last_n_turns * 2:]

    return system_prompt, messages


def call_once(client, system_prompt, messages, model, temperature, max_tokens, idx):
    kwargs = dict(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,
    )
    if system_prompt:
        kwargs["system"] = system_prompt
    resp = client.messages.create(**kwargs)
    text = "".join(b.text for b in resp.content if hasattr(b, "text"))
    return idx, text


def stability_mark(samples):
    """Split each sample's lines into STABLE (in >=half) vs UNIQUE (only this one)."""
    K = len(samples)
    threshold = (K + 1) // 2
    line_counts = Counter()
    for s in samples:
        for line in {l.strip() for l in s.splitlines() if l.strip()}:
            line_counts[line] += 1
    marked = []
    for s in samples:
        out = []
        for line in s.splitlines():
            stripped = line.strip()
            if not stripped:
                out.append(line)
                continue
            c = line_counts[stripped]
            if c >= threshold:
                out.append(f"[STABLE x{c}] {line}")
            elif c == 1:
                out.append(f"[UNIQUE]    {line}")
            else:
                out.append(f"[x{c}]       {line}")
        marked.append("\n".join(out))
    return marked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session_id")
    ap.add_argument("--turns", type=int, default=None, help="keep last N user+assistant turn pairs")
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--model", default="claude-opus-4-5")
    ap.add_argument("--max-tokens", type=int, default=2000)
    ap.add_argument("--no-stability-mark", action="store_true")
    args = ap.parse_args()

    transcript = find_transcript(args.session_id)
    if not transcript:
        print(f"No transcript found for session {args.session_id}", file=sys.stderr)
        sys.exit(1)

    system_prompt, messages = load_messages(transcript, args.turns)
    if not messages:
        print("No replayable messages in transcript", file=sys.stderr)
        sys.exit(1)

    print(f"# Replay: {args.session_id}")
    print(f"# {len(messages)} messages (last user: {messages[-1]['role']})")
    print(f"# K={args.samples}, T={args.temperature}, model={args.model}\n")

    try:
        import anthropic
    except ImportError:
        print("ERROR: pip install anthropic", file=sys.stderr)
        sys.exit(2)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(2)

    client = anthropic.Anthropic()
    samples = [None] * args.samples
    with ThreadPoolExecutor(max_workers=args.samples) as ex:
        futs = [
            ex.submit(call_once, client, system_prompt, messages,
                      args.model, args.temperature, args.max_tokens, i)
            for i in range(args.samples)
        ]
        for f in as_completed(futs):
            idx, text = f.result()
            samples[idx] = text

    marked = samples if args.no_stability_mark else stability_mark(samples)
    for i, s in enumerate(marked):
        print(f"\n{'=' * 20} SAMPLE {i + 1}/{args.samples} {'=' * 20}\n")
        print(s)


if __name__ == "__main__":
    main()
