# Session Chain

Client-side scripts that give Claude Code stateful persistence independent of API liveness. Wire them up in `.claude/settings.json` (see `settings.json.example` in the parent dir).

## What's here

| Script | Purpose | Hooks |
|--------|---------|-------|
| `chain.py` | Hash-linked chain of prompt-response blocks with sub-block checkpoints | Manual / CLI |
| `api-death-shield.py` | Crash recovery — fires on API errors, writes crash markers, auto-commits dirty files | `StopFailure`, `UserPromptSubmit`, `Stop`, `PreCompact` |
| `auto-checkpoint.py` | Creates chain checkpoints after every state-changing tool call | `PostToolUse` |
| `proposal-scraper.py` | Detects option/alternative blocks in assistant responses and persists to `PROPOSALS.md` | `Stop` |
| `replay-proposal.py` | Re-run a captured session N times via Anthropic SDK to recover/multiply lost proposals | Manual / CLI |
| `sync-daemon.sh` | Background auto-sync of chain to git every 5 min | Background process |

## Install

1. Copy this directory to `.claude/session-chain/` in your project.
2. Copy `../.claude/settings.json.example` to `.claude/settings.json`.
3. (Optional) Install the Anthropic SDK for `replay-proposal.py`: `pip install anthropic`
4. (Optional) Start the sync daemon: `bash .claude/session-chain/sync-daemon.sh &`

## Configuration

Scripts read environment variables at runtime. Override in `settings.json`'s `env` block or your shell:

| Variable | Default | Purpose |
|----------|---------|---------|
| `JARVIS_PROJECT_DIR` | `cwd` | Project root for git operations |
| `JARVIS_CLAUDE_DIR` | `~/.claude` | Claude Code config dir (transcripts, global PROPOSALS.md) |
| `JARVIS_GIT_REMOTE` | `origin` | Remote for auto-push |
| `JARVIS_GIT_BRANCH` | `main` | Branch for auto-push |
| `JARVIS_SYNC_INTERVAL` | `300` | Sync daemon interval in seconds |

## The core insight

The LLM is stateless. The harness doesn't have to be. Every script here solves one specific substrate gap:

- **chain.py** — no persistent conversation log → externalized hash-linked blocks
- **api-death-shield.py** — API crashes lose state → client-side hooks fire even when the API is dead
- **auto-checkpoint.py** — mid-task crash loses context → every tool call creates a checkpoint
- **proposal-scraper.py** — options only exist in chat → regex-extract them to `PROPOSALS.md`
- **replay-proposal.py** — non-deterministic regeneration loses the original → re-sample N times and cluster

See `DOCUMENTATION/JARVIS.md` at the repo root for the complete system.

## Debug

Logs land in `.claude/session-chain/shield/`:
- `shield.log` — api-death-shield events
- `proposal-scraper.log` — scraper activity
- `heartbeat.json` — last-known-good state
- `crashes/` — crash markers for recovery

Check for unprocessed crashes: `python .claude/session-chain/api-death-shield.py check-crashes`

Recovery report: `python .claude/session-chain/api-death-shield.py report`
