#!/bin/bash
# Jarvis Template — one-shot installer for Git Bash on Windows / bash on macOS+Linux.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/WGlynn/VibeSwap/master/jarvis-template/install.sh | bash
#   curl -sSL https://raw.githubusercontent.com/WGlynn/VibeSwap/master/jarvis-template/install.sh | bash -s -- /path/to/project
#
# Idempotent: safe to run twice. Won't overwrite existing files.

set -e

TARGET_DIR="${1:-$PWD}"
CLONE_DIR="$HOME/.jarvis-template-cache"
BRANCH="master"

echo ""
echo "=== Jarvis Template Installer ==="
echo "Target: $TARGET_DIR"
echo ""

# Check prereqs
command -v git >/dev/null 2>&1 || { echo "ERROR: git not found"; exit 1; }

PYTHON_CMD=""
for cmd in python python3 py; do
    if command -v "$cmd" >/dev/null 2>&1; then
        PYTHON_CMD="$cmd"
        break
    fi
done
if [ -z "$PYTHON_CMD" ]; then
    echo "ERROR: python not found (tried: python, python3, py)"
    echo "Install from https://python.org and check 'Add to PATH' during install"
    exit 1
fi
echo "Python: $PYTHON_CMD ($($PYTHON_CMD --version))"

# Fetch or update the template
if [ -d "$CLONE_DIR/.git" ]; then
    echo "Updating existing clone..."
    git -C "$CLONE_DIR" fetch origin "$BRANCH" --quiet
    git -C "$CLONE_DIR" reset --hard "origin/$BRANCH" --quiet
else
    echo "Cloning template..."
    git clone --depth 1 --branch "$BRANCH" https://github.com/WGlynn/VibeSwap.git "$CLONE_DIR" --quiet
fi

# Ensure target dir exists
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

# Copy .claude (non-destructive — merge, don't overwrite)
if [ -d .claude ]; then
    echo ".claude/ already exists — merging new files only, not overwriting yours"
    cp -rn "$CLONE_DIR/jarvis-template/.claude/"* .claude/ 2>/dev/null || true
    # session-chain scripts ARE safe to overwrite (code, not state)
    cp -r "$CLONE_DIR/jarvis-template/.claude/session-chain" .claude/
else
    echo "Installing .claude/..."
    cp -r "$CLONE_DIR/jarvis-template/.claude" .claude
fi

# Activate settings.json (only if missing — don't clobber existing)
if [ ! -f .claude/settings.json ]; then
    cp .claude/settings.json.example .claude/settings.json
    echo "Activated .claude/settings.json"
else
    echo ".claude/settings.json already exists — not overwriting"
fi

# If python command is not 'python', patch settings.json
if [ "$PYTHON_CMD" != "python" ] && [ -f .claude/settings.json ]; then
    if grep -q '"command": "python ' .claude/settings.json; then
        echo "Patching settings.json to use '$PYTHON_CMD' instead of 'python'..."
        sed -i.bak "s/\"command\": \"python /\"command\": \"$PYTHON_CMD /g" .claude/settings.json
        rm -f .claude/settings.json.bak
    fi
fi

# Initialize the chain
echo ""
echo "Initializing session chain..."
"$PYTHON_CMD" .claude/session-chain/chain.py stats || true

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Edit .claude/CLAUDE.md to fill in your project details"
echo "  2. Run: claude"
echo ""
echo "Optional:"
echo "  - pip install anthropic    # enables replay-proposal.py"
echo "  - bash .claude/session-chain/sync-daemon.sh &   # auto-sync chain to git"
echo ""
echo "Docs: https://github.com/WGlynn/VibeSwap/blob/master/jarvis-template/INSTALL_WINDOWS.md"
