#!/bin/bash
# Session Chain Auto-Sync Daemon
# Commits + pushes chain.json to the remote every 5 minutes.
# Run:  bash sync-daemon.sh &
# Stop: kill $(cat .sync-daemon.pid)
#
# Configuration via environment variables:
#   JARVIS_GIT_REMOTE — remote name (default: origin)
#   JARVIS_GIT_BRANCH — branch name (default: main)
#   JARVIS_SYNC_INTERVAL — sync interval in seconds (default: 300)

CHAIN_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$CHAIN_DIR/../../" && pwd)"
PID_FILE="$CHAIN_DIR/.sync-daemon.pid"
INTERVAL="${JARVIS_SYNC_INTERVAL:-300}"
GIT_REMOTE="${JARVIS_GIT_REMOTE:-origin}"
GIT_BRANCH="${JARVIS_GIT_BRANCH:-main}"

# Guard: only one instance
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Sync daemon already running (PID $OLD_PID)"
        exit 0
    fi
fi

echo $$ > "$PID_FILE"
echo "[sync-daemon] Started (PID $$, interval ${INTERVAL}s)"
echo "[sync-daemon] Chain dir: $CHAIN_DIR"
echo "[sync-daemon] Repo dir: $REPO_DIR"
echo "[sync-daemon] Remote: $GIT_REMOTE/$GIT_BRANCH"

cleanup() {
    rm -f "$PID_FILE"
    echo "[sync-daemon] Stopped"
    exit 0
}
trap cleanup SIGTERM SIGINT

sync_chain() {
    cd "$REPO_DIR" || return 1

    # Check if chain files have changed
    if git diff --quiet .claude/session-chain/chain.json .claude/session-chain/chain.md .claude/session-chain/pending.json 2>/dev/null; then
        UNTRACKED=$(git ls-files --others --exclude-standard .claude/session-chain/ 2>/dev/null)
        if [ -z "$UNTRACKED" ]; then
            return 0
        fi
    fi

    git add .claude/session-chain/chain.json .claude/session-chain/chain.md 2>/dev/null
    git add .claude/session-chain/pending.json 2>/dev/null

    BLOCK_COUNT=$(python .claude/session-chain/chain.py stats 2>/dev/null | head -1 | grep -o '[0-9]*' | head -1)
    TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
    git commit -m "chain: auto-sync ${BLOCK_COUNT:-?} blocks (${TIMESTAMP})" 2>/dev/null

    git push "$GIT_REMOTE" "$GIT_BRANCH" 2>/dev/null

    echo "[sync-daemon] Synced at $TIMESTAMP ($BLOCK_COUNT blocks)"
}

while true; do
    sync_chain
    sleep "$INTERVAL"
done
