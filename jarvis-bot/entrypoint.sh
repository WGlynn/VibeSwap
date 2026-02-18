#!/bin/bash
set -e

echo "============ JARVIS CONTAINER STARTUP ============"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============ Git Setup ============
# Configure git identity for commits (backup operations)
git config --global user.name "JARVIS"
git config --global user.email "jarvis@vibeswap.io"

# If GITHUB_TOKEN is set, configure credential helper for HTTPS auth
if [ -n "$GITHUB_TOKEN" ]; then
    echo "Configuring GitHub authentication..."
    git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

# ============ Clone/Pull Repository ============
REPO_DIR="${VIBESWAP_REPO:-/repo}"
REPO_URL="${GITHUB_REPO_URL:-https://github.com/WGlynn/vibeswap-private.git}"

if [ -d "$REPO_DIR/.git" ]; then
    echo "Repository exists at $REPO_DIR — pulling latest..."
    cd "$REPO_DIR"
    git pull origin master || echo "Pull failed — using existing state"
    cd /app
else
    echo "Cloning repository to $REPO_DIR..."
    git clone "$REPO_URL" "$REPO_DIR" || {
        echo "Clone failed. Jarvis will run with local context only."
        mkdir -p "$REPO_DIR"
    }
fi

# Set up stealth remote if configured
if [ -n "$GITHUB_STEALTH_URL" ]; then
    cd "$REPO_DIR"
    git remote get-url stealth 2>/dev/null || git remote add stealth "$GITHUB_STEALTH_URL"
    cd /app
fi

# ============ Context Files ============
# The memory dir in cloud mode lives inside the repo clone
MEMORY_DIR="${MEMORY_DIR:-/repo/.claude/projects/C--Users-Will/memory}"
export MEMORY_DIR

# Ensure VIBESWAP_REPO points to the clone
export VIBESWAP_REPO="$REPO_DIR"

# ============ Data Directory ============
# /app/data is mounted as a persistent volume in production
# Ensure it exists even if no volume is mounted
mkdir -p /app/data

# If the repo has existing data files, seed them into the data dir (first boot only)
if [ -d "$REPO_DIR/jarvis-bot/data" ]; then
    for f in contributions.json users.json interactions.json moderation.json threads.json spam-log.json; do
        if [ -f "$REPO_DIR/jarvis-bot/data/$f" ] && [ ! -f "/app/data/$f" ]; then
            echo "Seeding $f from repo..."
            cp "$REPO_DIR/jarvis-bot/data/$f" /app/data/
        fi
    done
fi

# Symlink data dir into repo path so git backup sees the live data
if [ -d "$REPO_DIR/jarvis-bot" ]; then
    rm -rf "$REPO_DIR/jarvis-bot/data"
    ln -sf /app/data "$REPO_DIR/jarvis-bot/data"
fi

# ============ Environment Report ============
echo ""
echo "Configuration:"
echo "  VIBESWAP_REPO: $VIBESWAP_REPO"
echo "  MEMORY_DIR:    $MEMORY_DIR"
echo "  DATA_DIR:      /app/data"
echo "  NODE_ENV:      ${NODE_ENV:-production}"
echo "  Model:         ${CLAUDE_MODEL:-claude-sonnet-4-5-20250929}"

# Check context files
CONTEXT_COUNT=0
for f in CLAUDE.md .claude/SESSION_STATE.md .claude/JarvisxWill_CKB.md; do
    if [ -f "$REPO_DIR/$f" ]; then
        CONTEXT_COUNT=$((CONTEXT_COUNT + 1))
    fi
done
echo "  Context files: $CONTEXT_COUNT/3 core files found"
echo ""
echo "============ STARTING JARVIS ============"

# ============ Start Jarvis ============
exec node /app/src/index.js
