#!/usr/bin/env python3
"""
Jarvis CLI — standalone runner for free/local LLMs (Ollama, Groq, OpenAI).

No Claude Code subscription needed. Runs in any terminal.

Reads the same .claude/ directory structure:
  - CLAUDE.md              → system prompt
  - memory/MEMORY.md       → behavioral index
  - memory/primitive_*.md  → load-bearing rules injected into system prompt
  - memory/feedback_*.md   → behavioral feedback injected into system prompt
  - SESSION_STATE.md       → continuation context on boot
  - WAL.md                 → crash detection + recovery hint
  - session-chain/         → persistent conversation log
  - PROPOSALS.md           → captured decision slates

Usage:
  python jarvis-cli.py                                    # ollama, llama3.2 (default)
  python jarvis-cli.py --backend ollama --model qwen2.5   # ollama, any model
  python jarvis-cli.py --backend groq --model llama-3.3-70b-versatile   # requires GROQ_API_KEY
  python jarvis-cli.py --backend openai --model gpt-4o-mini             # requires OPENAI_API_KEY

Requirements:
  pip install requests              # always needed (for Ollama)
  pip install groq                  # if using Groq
  pip install openai                # if using OpenAI

Ollama install: https://ollama.com — then `ollama pull llama3.2` and `ollama serve`

Type /help at the prompt for commands.
"""

import argparse
import atexit
import json
import os
import signal
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# ============ Config ============

PROJECT_DIR = Path(os.environ.get("JARVIS_PROJECT_DIR", os.getcwd()))
CLAUDE_DIR = PROJECT_DIR / ".claude"
MEMORY_DIR = CLAUDE_DIR / "memory"
CHAIN_DIR = CLAUDE_DIR / "session-chain"
CHAIN_PY = CHAIN_DIR / "chain.py"
SESSION_STATE = CLAUDE_DIR / "SESSION_STATE.md"
WAL = CLAUDE_DIR / "WAL.md"
PROPOSALS = CLAUDE_DIR / "PROPOSALS.md"
CLAUDE_MD = CLAUDE_DIR / "CLAUDE.md"

SESSION_ID = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + str(uuid.uuid4())[:8]

# ============ Utilities ============

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def read_file(path, default=""):
    try:
        return Path(path).read_text(encoding="utf-8")
    except Exception:
        return default


def append_file(path, content):
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        print(f"[warn] append to {path} failed: {e}", file=sys.stderr)


# ============ Boot: assemble system prompt ============

def load_memory_files():
    """Load all primitive_* and feedback_* memory files into context."""
    chunks = []
    if not MEMORY_DIR.exists():
        return ""

    for pattern in ["primitive_*.md", "feedback_*.md"]:
        for f in sorted(MEMORY_DIR.glob(pattern)):
            try:
                content = f.read_text(encoding="utf-8")
                chunks.append(f"### {f.stem}\n\n{content}\n")
            except Exception:
                continue
    return "\n".join(chunks)


def check_wal_active():
    """Return the ACTIVE section from WAL if present, else None."""
    wal = read_file(WAL)
    if "ACTIVE" in wal:
        # Grab last 20 lines as context
        lines = wal.strip().split("\n")
        return "\n".join(lines[-20:])
    return None


def build_system_prompt(claude_md):
    """Assemble the full system prompt from CLAUDE.md + memory."""
    parts = [
        "You are Jarvis, a recursive-self-improving collaborator system running on a local or free LLM.",
        "",
        "The model is stateless. The harness is not. Every exchange is persisted to the session chain.",
        "Read the memory files below — they encode load-bearing primitives earned through specific failures.",
        "Follow them. Don't apologize for them. Don't explain them unless asked.",
        "",
        "## Project CLAUDE.md",
        "",
        claude_md or "(no CLAUDE.md found — running with defaults)",
        "",
        "## Memory (load-bearing rules)",
        "",
        load_memory_files() or "(no memory files loaded)",
        "",
        "## Session context",
        "",
        f"Session ID: {SESSION_ID}",
        f"Time: {now_iso()}",
        "",
        "## Response guidelines",
        "",
        "- Talk like a person. No 'I'd be happy to help!', no 'Certainly!', no trailing 'Let me know if...'",
        "- Cite file:line for claims about code. Never hallucinate paths.",
        "- If you state options for the user to pick, present them as **Option A / Option B / Option C** so the system can capture them.",
        "- If you verbally commit to a behavior or fact, ALSO write it to memory/feedback_*.md — otherwise it's theater.",
        "- Short questions get short answers.",
    ]
    return "\n".join(parts)


# ============ Backends ============

class Backend:
    def chat(self, system, messages):
        raise NotImplementedError


class OllamaBackend(Backend):
    def __init__(self, model="llama3.2", host="http://localhost:11434"):
        import requests
        self.requests = requests
        self.model = model
        self.host = host

    def chat(self, system, messages):
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}] + messages,
            "stream": False,
        }
        r = self.requests.post(f"{self.host}/api/chat", json=payload, timeout=300)
        r.raise_for_status()
        data = r.json()
        return data["message"]["content"]


class GroqBackend(Backend):
    def __init__(self, model="llama-3.3-70b-versatile"):
        try:
            from groq import Groq
        except ImportError:
            print("ERROR: pip install groq", file=sys.stderr)
            sys.exit(2)
        if not os.environ.get("GROQ_API_KEY"):
            print("ERROR: GROQ_API_KEY not set. Get one at console.groq.com.", file=sys.stderr)
            sys.exit(2)
        self.client = Groq()
        self.model = model

    def chat(self, system, messages):
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}] + messages,
        )
        return resp.choices[0].message.content


class OpenAIBackend(Backend):
    def __init__(self, model="gpt-4o-mini"):
        try:
            from openai import OpenAI
        except ImportError:
            print("ERROR: pip install openai", file=sys.stderr)
            sys.exit(2)
        if not os.environ.get("OPENAI_API_KEY"):
            print("ERROR: OPENAI_API_KEY not set.", file=sys.stderr)
            sys.exit(2)
        self.client = OpenAI()
        self.model = model

    def chat(self, system, messages):
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}] + messages,
        )
        return resp.choices[0].message.content


def get_backend(name, model):
    defaults = {"ollama": "llama3.2", "groq": "llama-3.3-70b-versatile", "openai": "gpt-4o-mini"}
    model = model or defaults.get(name, "llama3.2")
    if name == "ollama":
        return OllamaBackend(model)
    elif name == "groq":
        return GroqBackend(model)
    elif name == "openai":
        return OpenAIBackend(model)
    else:
        print(f"Unknown backend: {name}", file=sys.stderr)
        sys.exit(1)


# ============ Chain persistence ============

def chain_append(prompt, response, tags=None):
    """Append a block to the session chain via chain.py CLI."""
    if not CHAIN_PY.exists():
        return
    try:
        args = [
            sys.executable, str(CHAIN_PY), "append",
            "--session", SESSION_ID,
            "--prompt", prompt[:4000],
            "--response", response[:8000],
        ]
        if tags:
            args.extend(["--tags", ",".join(tags)])
        subprocess.run(args, timeout=15, capture_output=True)
    except Exception as e:
        print(f"[warn] chain append failed: {e}", file=sys.stderr)


# ============ Proposal detection ============

def detect_and_persist_proposals(response):
    """Capture decision slates to PROPOSALS.md. Same heuristics as proposal-scraper.py."""
    import re
    strong = [
        re.compile(r"\*\*Option [A-Z]\*\*"),
        re.compile(r"\bOption [A-Z]:"),
    ]
    numbered = re.compile(r"^\s*\d\.\s+\*\*[^*]+\*\*", re.MULTILINE)
    keywords = re.compile(
        r"\b(?:options?|propose|alternatives?|pick\s+one|which\s+do\s+you|choose)\b", re.I)

    # Strip code spans
    stripped = re.sub(r"```.*?```|`[^`\n]+`", " ", response, flags=re.DOTALL)
    hit = any(p.search(stripped) for p in strong) or (
        len(numbered.findall(stripped)) >= 2 and keywords.search(stripped))

    if not hit:
        return

    ts = now_iso()
    topic_match = re.search(r"^#+\s+(.+)$|^\*\*([^*]+)\*\*", response, re.MULTILINE)
    topic = (topic_match.group(1) or topic_match.group(2) or "Proposal") if topic_match else "Proposal"
    topic = topic.strip()[:80]

    entry = (
        f"\n## {topic} - {ts}\n"
        f"**Session**: `{SESSION_ID}`\n"
        f"**Status**: proposed\n\n"
        f"{response.strip()}\n\n---\n"
    )

    if not PROPOSALS.exists():
        PROPOSALS.write_text("# Proposals Ledger\n\n", encoding="utf-8")
    append_file(PROPOSALS, entry)
    print(f"[jarvis] Captured proposal: {topic}", file=sys.stderr)


# ============ WAL + SESSION_STATE ============

def wal_append(msg, status="ACTIVE"):
    append_file(WAL, f"\n## {now_iso()} - {status}\n{msg}\n")


def session_state_write(current_task, open_threads=None, blockers=None, next_action=None):
    content = [
        "# Session State",
        "",
        f"**Last updated**: {now_iso()}",
        f"**Session ID**: {SESSION_ID}",
        "",
        "## Current task",
        current_task or "(none)",
        "",
        "## Open threads",
    ]
    if open_threads:
        content.extend(f"- {t}" for t in open_threads)
    else:
        content.append("(none)")
    content.extend(["", "## Blockers", blockers or "None.", "", "## Next action", next_action or "(continue)"])
    SESSION_STATE.write_text("\n".join(content), encoding="utf-8")


# ============ Crash recovery ============

def graceful_exit(reason="Clean exit"):
    wal_append(f"Session {SESSION_ID} ended: {reason}", status="CLEAN")
    print(f"\n[jarvis] {reason}", file=sys.stderr)


atexit.register(graceful_exit)


def signal_handler(signum, frame):
    wal_append(f"Session {SESSION_ID} interrupted by signal {signum}", status="INTERRUPTED")
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ============ Main loop ============

def main():
    ap = argparse.ArgumentParser(description="Jarvis CLI — stateful LLM wrapper.")
    ap.add_argument("--backend", default="ollama", choices=["ollama", "groq", "openai"])
    ap.add_argument("--model", default=None, help="model name (defaults per backend)")
    ap.add_argument("--host", default=None, help="custom host (Ollama only)")
    args = ap.parse_args()

    # Ensure .claude/ exists
    if not CLAUDE_DIR.exists():
        print(f"ERROR: no .claude/ dir at {PROJECT_DIR}", file=sys.stderr)
        print("Run: curl -sSL https://raw.githubusercontent.com/WGlynn/VibeSwap/master/jarvis-template/install.sh | bash", file=sys.stderr)
        sys.exit(1)

    # Boot checks
    wal_active = check_wal_active()
    if wal_active:
        print("[jarvis] WAL indicates unfinished prior session:", file=sys.stderr)
        print(wal_active, file=sys.stderr)
        print("", file=sys.stderr)

    session_state = read_file(SESSION_STATE, default="")
    claude_md = read_file(CLAUDE_MD, default="")

    backend = get_backend(args.backend, args.model)
    system = build_system_prompt(claude_md)

    wal_append(f"Session {SESSION_ID} started. Backend: {args.backend}, model: {backend.model}")

    print(f"[jarvis] Session {SESSION_ID} | backend: {args.backend} | model: {backend.model}", file=sys.stderr)
    print("[jarvis] Type /help for commands, Ctrl+C to exit.", file=sys.stderr)

    # Prime the conversation with SESSION_STATE if present
    messages = []
    if session_state.strip():
        messages.append({
            "role": "user",
            "content": f"[Boot context — last session state]\n\n{session_state}\n\n[End boot context]",
        })
        messages.append({
            "role": "assistant",
            "content": "Read. Continuing from the last open threads. What do you need?",
        })

    while True:
        try:
            user_input = input("\n> ").strip()
        except EOFError:
            break
        if not user_input:
            continue

        # Slash commands
        if user_input.startswith("/"):
            if user_input == "/help":
                print("/help     — this message")
                print("/state    — show current session state")
                print("/wal      — show last 20 WAL lines")
                print("/memory   — list memory files")
                print("/chain    — show chain stats")
                print("/clear    — reset conversation history (keeps state files)")
                print("/exit     — save and exit")
                continue
            elif user_input == "/state":
                print(read_file(SESSION_STATE))
                continue
            elif user_input == "/wal":
                wal = read_file(WAL)
                print("\n".join(wal.strip().split("\n")[-20:]))
                continue
            elif user_input == "/memory":
                for f in sorted(MEMORY_DIR.glob("*.md")):
                    print(f"  {f.name}")
                continue
            elif user_input == "/chain":
                subprocess.run([sys.executable, str(CHAIN_PY), "stats"])
                continue
            elif user_input == "/clear":
                messages = []
                print("[jarvis] Conversation history cleared.")
                continue
            elif user_input == "/exit":
                break
            else:
                print(f"Unknown command: {user_input}")
                continue

        messages.append({"role": "user", "content": user_input})

        try:
            response = backend.chat(system, messages)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[jarvis] Backend error: {e}", file=sys.stderr)
            wal_append(f"Backend error: {e}", status="ERROR")
            continue

        print(f"\n{response}")
        messages.append({"role": "assistant", "content": response})

        # Persist
        chain_append(user_input, response)
        detect_and_persist_proposals(response)

        # Update session state (simple — just record last exchange)
        session_state_write(
            current_task="Interactive Jarvis CLI session",
            open_threads=[f"Last user: {user_input[:100]}"],
            next_action="Awaiting next prompt",
        )


if __name__ == "__main__":
    main()
