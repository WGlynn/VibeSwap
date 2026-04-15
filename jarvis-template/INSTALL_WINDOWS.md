# Install on Windows (Git Bash)

Tested on Windows 10/11 with Git for Windows (Git Bash) and Python 3.10+.

## Prerequisites

- **Git for Windows** — https://git-scm.com/download/win (gives you Git Bash)
- **Python 3.10+** — https://python.org — during install, check "Add Python to PATH"
- **Claude Code** — https://docs.anthropic.com/claude-code

Verify from Git Bash:
```bash
git --version
python --version   # if this fails, try: python3 --version  OR: py --version
claude --version
```

If `python` isn't found but `py` is, use `py` in settings.json commands instead of `python`.

## Install

```bash
# 1. Clone the template (full repo — we'll only use jarvis-template/)
cd ~
git clone https://github.com/WGlynn/VibeSwap.git

# 2. Create or navigate to your project
cd /c/Users/YourName/your-project    # adjust path

# 3. Copy the .claude directory into your project
cp -r ~/VibeSwap/jarvis-template/.claude ./

# 4. Activate settings (copies the example to the live name)
cp .claude/settings.json.example .claude/settings.json

# 5. (Optional but recommended) Install anthropic SDK for replay-proposal.py
pip install anthropic
```

## Configure

Edit `.claude/CLAUDE.md` — find the placeholders (`[YOUR PROJECT NAME]`, tech stack, directory structure, commands) and fill them in.

Edit `.claude/settings.json` — if `python` doesn't work in your terminal, replace all `"command": "python ..."` entries with `py ...` or `python3 ...`.

## Verify

```bash
# Chain initializes on first call — should print "Blocks: 1" or similar
python .claude/session-chain/chain.py stats

# API death shield self-test
python .claude/session-chain/api-death-shield.py check-crashes
# Expected: "No crash markers found."
```

## Launch

```bash
cd /c/Users/YourName/your-project
claude
```

On boot, Claude will read `.claude/CLAUDE.md`, walk the protocol chain, and check `SESSION_STATE.md` + `WAL.md` for crash recovery state.

## Optional: background sync daemon

Auto-commits the session chain to git every 5 minutes. Keeps your chain synced across machines if you push to a remote.

In a **separate** Git Bash window (so it stays alive when you close your working one):
```bash
cd /c/Users/YourName/your-project
bash .claude/session-chain/sync-daemon.sh
```

Stop it with `Ctrl+C` in that window, or from any window:
```bash
kill $(cat .claude/session-chain/.sync-daemon.pid)
```

## Windows gotchas

- **Line endings**: Git on Windows may auto-convert LF→CRLF on checkout. Python doesn't care, but Bash shebangs do. Always invoke scripts explicitly (`bash sync-daemon.sh`, not `./sync-daemon.sh`).
- **Background processes in Git Bash**: `&` backgrounding works but the process dies when you close the terminal. Use a separate dedicated window for the sync daemon, OR use Task Scheduler for true daemonization.
- **Python PATH**: if `python` isn't on PATH but Python is installed, find it with `py -0p` and add the directory to your `~/.bashrc`:
  ```bash
  echo 'export PATH="/c/Python310:/c/Python310/Scripts:$PATH"' >> ~/.bashrc
  source ~/.bashrc
  ```
- **Hook commands**: Claude Code runs them via subprocess from the project's cwd. The scripts default to `cwd` for `JARVIS_PROJECT_DIR`, so this works without extra config as long as you launch `claude` from your project root.
- **PYTHONIOENCODING**: if you see unicode errors in hook output, add to settings.json env:
  ```json
  "env": { "PYTHONIOENCODING": "utf-8" }
  ```

## Override the git remote/branch

Default: `origin main`. If your project uses a different remote or branch, set in `.claude/settings.json`:

```json
"env": {
  "JARVIS_GIT_REMOTE": "upstream",
  "JARVIS_GIT_BRANCH": "master"
}
```

## Minimum viable setup

If the full template is overwhelming, you only strictly need:

1. `.claude/CLAUDE.md` — protocol chain + project details
2. `.claude/SESSION_STATE.md` — session continuity
3. `.claude/WAL.md` — crash recovery log
4. `.claude/memory/MEMORY.md` — memory index

Skip the session-chain scripts entirely. Add them later once you've felt the pain of losing state to an API 500.

## Uninstall

```bash
rm -rf .claude/session-chain/
rm .claude/settings.json
```

The other files (CLAUDE.md, SESSION_STATE.md, WAL.md, memory/) are just markdown — leave them or delete as you prefer.
