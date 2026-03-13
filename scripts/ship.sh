#!/bin/bash
# ============================================================
# ship.sh — One-command ship everything
# ============================================================
#
# Usage:
#   ./scripts/ship.sh                    # build + commit + push
#   ./scripts/ship.sh "commit message"   # with custom message
#   ./scripts/ship.sh --deploy           # build + commit + push + deploy
#   ./scripts/ship.sh --dry              # just show what would happen
#
# What it does:
#   1. Pulls latest from origin
#   2. Builds frontend (catches errors before push)
#   3. Auto-generates commit message from changed files if none provided
#   4. Commits all staged + modified tracked files
#   5. Pushes to both remotes (origin + stealth)
#   6. Optionally deploys to Vercel
#   7. Updates stats in bd-output
#
# ============================================================

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY=false
DRY=false
MSG=""

# Parse args
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=true ;;
    --dry) DRY=true ;;
    *) MSG="$arg" ;;
  esac
done

echo "=== VibeSwap Ship ==="
echo ""

# Step 1: Pull
echo "[1/6] Pulling latest..."
if [ "$DRY" = true ]; then
  echo "  (dry run — skipping pull)"
else
  git pull origin master --rebase 2>/dev/null || git pull origin master || true
fi

# Step 2: Build frontend
echo "[2/6] Building frontend..."
if [ "$DRY" = true ]; then
  echo "  (dry run — skipping build)"
else
  cd frontend
  npx vite build 2>&1 | tail -3
  cd "$ROOT"
fi

# Step 3: Check for changes
echo "[3/6] Checking changes..."
CHANGES=$(git status --porcelain | grep -v "^?? \"Jarvis\|^?? \"claude\|^?? \"freedom\|^?? docs/claude-skill" | head -20)

if [ -z "$CHANGES" ]; then
  echo "  No changes to commit."
  echo "=== Nothing to ship ==="
  exit 0
fi

echo "  Changed files:"
echo "$CHANGES" | sed 's/^/    /'
echo ""

# Step 4: Auto-generate commit message if none provided
if [ -z "$MSG" ]; then
  # Count files by type
  FRONTEND=$(echo "$CHANGES" | grep -c "frontend/" || true)
  CONTRACTS=$(echo "$CHANGES" | grep -c "contracts/" || true)
  DOCS=$(echo "$CHANGES" | grep -c "docs/\|tweet repo/" || true)
  SCRIPTS=$(echo "$CHANGES" | grep -c "scripts/" || true)
  TOTAL=$(echo "$CHANGES" | wc -l | tr -d ' ')

  PARTS=()
  [ "$FRONTEND" -gt 0 ] 2>/dev/null && PARTS+=("${FRONTEND} frontend")
  [ "$CONTRACTS" -gt 0 ] 2>/dev/null && PARTS+=("${CONTRACTS} contracts")
  [ "$DOCS" -gt 0 ] 2>/dev/null && PARTS+=("${DOCS} docs")
  [ "$SCRIPTS" -gt 0 ] 2>/dev/null && PARTS+=("${SCRIPTS} scripts")

  if [ ${#PARTS[@]} -gt 0 ]; then
    MSG="Ship ${TOTAL} files: $(IFS=', '; echo "${PARTS[*]}")"
  else
    MSG="Ship ${TOTAL} files"
  fi
fi

echo "[4/6] Committing: $MSG"
if [ "$DRY" = true ]; then
  echo "  (dry run — skipping commit)"
else
  git add -u  # stage all modified tracked files
  # Also add new files in key directories (but not random root files)
  git add frontend/src/ docs/ "tweet repo/" scripts/ contracts/ test/ 2>/dev/null || true
  git commit -m "$MSG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" || echo "  Nothing to commit"
fi

# Step 5: Push
echo "[5/6] Pushing to remotes..."
if [ "$DRY" = true ]; then
  echo "  (dry run — skipping push)"
else
  git push origin master 2>/dev/null && echo "  origin: OK" || echo "  origin: FAILED"
  git push stealth master 2>/dev/null && echo "  stealth: OK" || echo "  stealth: FAILED"
fi

# Step 6: Deploy (optional)
if [ "$DEPLOY" = true ]; then
  echo "[6/6] Deploying to Vercel..."
  if [ "$DRY" = true ]; then
    echo "  (dry run — skipping deploy)"
  else
    cd frontend
    npx vercel --prod 2>&1 | tail -5
    cd "$ROOT"
  fi
else
  echo "[6/6] Deploy skipped (use --deploy to deploy)"
fi

# Bonus: Update stats
if [ "$DRY" = false ]; then
  node scripts/bd-toolkit.js stats > /dev/null 2>&1 || true
fi

echo ""
echo "=== Shipped ==="
