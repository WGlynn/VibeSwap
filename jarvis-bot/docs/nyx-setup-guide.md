# Nyx Setup Guide — Pantheon Command Center

## What Is Nyx?

Nyx is your personal AI coordinator — a web-based command center that manages a hierarchy of Greek god AI agents. Talk to Nyx, she routes your questions to the right specialist. Browse files, edit code, run terminal commands, all from one interface.

**Endpoints:**
- `GET /nyx` — Login page / command center UI
- `POST /nyx/api/chat` — Talk to any god
- `GET /nyx/api/files` — Browse repo files
- `POST /nyx/api/exec` — Run shell commands

---

## Quick Start (Local)

### 1. Set Environment Variables

Add to your `.env` in `jarvis-bot/`:

```bash
# Required — this is the password to access Nyx
CLAUDE_CODE_API_SECRET=your-secret-here

# Required — Anthropic API key for god conversations
ANTHROPIC_API_KEY=sk-ant-...

# Optional — model for Pantheon (defaults to claude-sonnet-4-5)
PANTHEON_MODEL=claude-sonnet-4-5-20250929

# Optional — free local inference instead of Claude
# OLLAMA_URL=http://localhost:11434
# PANTHEON_MODEL=qwen2.5:7b
```

### 2. Install & Run

```bash
cd jarvis-bot
npm install
npm run dev
```

The bot starts on the port defined in your config (default 8080 for health/Nyx).

### 3. Open Nyx

Go to `http://localhost:8080/nyx` in your browser.

Enter your `CLAUDE_CODE_API_SECRET` when prompted.

---

## The Interface

### Left Panel — Chat
- **Agent Selector**: Pick which god to talk to (default: Nyx orchestrates automatically)
- **Chat**: Type your message. Nyx classifies intent and routes:
  - Conversational → Nyx answers directly
  - Domain-specific → Routes to the right god (Poseidon for trading, Hephaestus for building, etc.)
  - Multi-domain → Parallel delegation to multiple gods, then Nyx synthesizes
  - Status → Shows Pantheon overview

### Right Panel — Tabs
- **Pantheon**: Hierarchy view with all gods, tiers, Merkle hashes
- **Files**: Browse the repo, click to open in editor
- **Editor**: Edit and save files directly
- **Terminal**: Run shell commands in the repo directory
- **Activity**: Real-time feed of orchestration events (classify, route, delegate, synthesize)

---

## The Hierarchy

```
NYX (Tier 0 — Root, Orchestrator)
├── POSEIDON (Tier 1 — Finance, trading, liquidity)
│   └── PROTEUS (Tier 2 — Adaptive strategy, regime detection)
├── ATHENA (Tier 1 — Architecture, planning, code review)
├── HEPHAESTUS (Tier 1 — Building, implementation, DevOps)
├── HERMES (Tier 1 — Communication, APIs, integration)
│   └── ANANSI (Tier 2 — Social media, community, storytelling)
├── APOLLO (Tier 1 — Analytics, data science, monitoring)
│   └── ARTEMIS (Tier 2 — Security, threat detection, audit)
```

**Talk to a specific god:** Type `@poseidon what's the market doing?` or select from the dropdown.

---

## Deploy to Fly.io

If the bot is already on Fly.io:

```bash
# Set the secret
flyctl secrets set CLAUDE_CODE_API_SECRET=your-secret-here

# Deploy
flyctl deploy
```

Then access `https://your-app.fly.dev/nyx`

---

## CKB (Common Knowledge Base)

Nyx loads the CKB (`identities/nyx-ckb.md`) into her system prompt on every chat. This contains:

- Your identity, projects, and team context (Tiers 0-2)
- The Ten Covenants + security axioms (Tier 3)
- Architecture patterns from all your repos (Tier 4)
- Full project details: Limni, CKS, Trenchbot, Profitia, VibeSwap (Tier 5)
- Your coding conventions and patterns (Tier 6)
- Your workflow preferences (Tier 7)
- Memory and communication protocols (Tiers 8-9)
- Session protocols and meta-cognition (Tiers 10-11)

To update the CKB: edit `src/identities/nyx-ckb.md` and redeploy. It auto-seeds to the data volume on startup.

---

## Key Commands

| What | How |
|------|-----|
| Talk to Nyx | Just type normally |
| Talk to a god | `@poseidon ...` or select from dropdown |
| Get status | "status" or "pantheon" |
| Run a command | Terminal tab → type command |
| Edit a file | Files tab → click file → Editor tab |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Unauthorized" | Check `CLAUDE_CODE_API_SECRET` is set and matches |
| "No identity file" | Run the bot once — it auto-seeds from `src/identities/` |
| God says nonsense | Check `ANTHROPIC_API_KEY` is valid, or switch to Ollama |
| Slow responses | Use Ollama locally (`OLLAMA_URL=http://localhost:11434`) for free, fast inference |
| Can't access on Fly.io | Make sure the health server port is exposed in `fly.toml` |

---

*"Even Zeus feared Nyx. Not because she was loud, but because she was everywhere."*
