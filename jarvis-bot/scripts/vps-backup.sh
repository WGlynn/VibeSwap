#!/bin/bash
# ============ JARVIS VPS Backup Script ============
# Backs up persistent data via git commit + push.
# Runs as cron job every 6 hours (set up by vps-deploy.sh).
#
# What gets backed up:
#   - Bot data files (users, interactions, contributions, etc.)
#   - Shard learnings JSONL
#   - Memory files
#   - Knowledge chain state
#
# Strategy: Git-backed (same as Fly.io). Data symlinked into repo.
# ============

set -euo pipefail

DEPLOY_DIR="${JARVIS_HOME:-/home/jarvis}/vibeswap"
BOT_DIR="$DEPLOY_DIR/jarvis-bot"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "[$TIMESTAMP] JARVIS backup starting..."

# ============ 1. Copy live data from Docker volume ============
# The primary shard's data is in a Docker volume. Copy it out.
CONTAINER="jarvis-shard-0"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "  Copying data from $CONTAINER..."
    docker cp "$CONTAINER:/app/data/." "$BOT_DIR/data/" 2>/dev/null || true
else
    echo "  Warning: $CONTAINER not running — skipping data copy."
fi

# ============ 2. Git backup ============
cd "$DEPLOY_DIR"

# Stage data files
git add -A jarvis-bot/data/ 2>/dev/null || true
git add -A .claude/shard_learnings.jsonl 2>/dev/null || true

# Check if there are changes
if git diff --cached --quiet; then
    echo "  No changes to backup."
    exit 0
fi

# Commit
git commit -m "backup: automated VPS data snapshot $TIMESTAMP" 2>/dev/null || {
    echo "  Nothing to commit."
    exit 0
}

# Push to both remotes
git push origin master 2>/dev/null && echo "  Pushed to origin." || echo "  Push to origin failed."
git push stealth master 2>/dev/null && echo "  Pushed to stealth." || echo "  Push to stealth failed."

echo "[$TIMESTAMP] Backup complete."
