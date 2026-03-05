#!/bin/bash
# ============ VibeSwap Code Mirror — Push to All Remotes ============
#
# Pushes to every configured remote for code survival.
# Currently: GitHub (origin + stealth), GitLab (gitlab), Codeberg (codeberg)
#
# Usage: ./scripts/mirror-push.sh [branch]
# Default branch: master
#
# Setup (one-time):
#   git remote add gitlab  https://gitlab.com/wglynn/vibeswap.git
#   git remote add codeberg https://codeberg.org/wglynn/vibeswap.git
#
# These commands are idempotent — safe to re-run.
# ============

BRANCH="${1:-master}"
FAILED=0
PUSHED=0

echo "=== VibeSwap Mirror Push ==="
echo "Branch: $BRANCH"
echo ""

for remote in $(git remote); do
  echo -n "  Pushing to $remote... "
  if git push "$remote" "$BRANCH" 2>/dev/null; then
    echo "OK"
    ((PUSHED++))
  else
    echo "FAILED (remote may not exist yet)"
    ((FAILED++))
  fi
done

echo ""
echo "=== Results: $PUSHED pushed, $FAILED failed ==="

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "To add missing remotes:"
  echo "  git remote add gitlab  https://gitlab.com/YOUR_USER/vibeswap.git"
  echo "  git remote add codeberg https://codeberg.org/YOUR_USER/vibeswap.git"
fi
