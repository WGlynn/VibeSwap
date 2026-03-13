#!/bin/bash
# ============================================================
# Quick Actions — Lazy shortcuts for common BD tasks
# ============================================================
#
# Usage: ./scripts/quick-actions.sh <action>
#
# Actions:
#   today        — What to do today (from content calendar)
#   tweet        — Pick a random tweet, copy to clipboard
#   stats        — Show live stats
#   digest       — Generate weekly digest
#   digest-tg    — Generate Telegram-formatted digest
#   digest-tweet — Generate tweet thread digest
#   grants       — Show grant tracker status
#   ship         — Build + commit + push
#   ship-deploy  — Build + commit + push + deploy
#   outreach     — List all outreach templates
#   new-tweet    — Template for writing a new tweet
#
# Pro tip: alias these in your .bashrc:
#   alias vt='./scripts/quick-actions.sh tweet'
#   alias vs='./scripts/quick-actions.sh stats'
#   alias vd='./scripts/quick-actions.sh digest'
#   alias vship='./scripts/quick-actions.sh ship'
#
# ============================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "${1:-help}" in
  today)
    node scripts/bd-toolkit.js calendar
    ;;
  tweet)
    node scripts/bd-toolkit.js tweet random
    ;;
  stats)
    node scripts/bd-toolkit.js stats
    ;;
  digest)
    node scripts/weekly-digest.js
    ;;
  digest-tg)
    node scripts/weekly-digest.js --telegram
    ;;
  digest-tweet)
    node scripts/weekly-digest.js --tweet
    ;;
  grants)
    echo ""
    cat docs/grants/TRACKER.md
    echo ""
    echo "Generate an application: node scripts/bd-toolkit.js grant <name>"
    ;;
  ship)
    bash scripts/ship.sh "${2:-}"
    ;;
  ship-deploy)
    bash scripts/ship.sh --deploy "${2:-}"
    ;;
  outreach)
    node scripts/bd-toolkit.js outreach
    ;;
  new-tweet)
    # Count existing tweets in each category to suggest next number
    echo ""
    echo "=== New Tweet Template ==="
    echo ""
    for dir in "tweet repo"/*/; do
      category=$(basename "$dir")
      count=$(ls "$dir"*.md 2>/dev/null | wc -l | tr -d ' ')
      next=$((count + 1))
      printf "  %-20s %2d tweets  →  next: %02d-<name>.md\n" "$category" "$count" "$next"
    done
    echo ""
    echo "Create: echo 'Your tweet text' > 'tweet repo/<category>/<number>-<name>.md'"
    ;;
  help|*)
    echo ""
    echo "VibeSwap Quick Actions — for lazy builders"
    echo ""
    echo "  today        What to do today"
    echo "  tweet        Random tweet to post"
    echo "  stats        Live project stats"
    echo "  digest       Weekly summary"
    echo "  digest-tg    Telegram-formatted digest"
    echo "  digest-tweet Tweet thread digest"
    echo "  grants       Grant tracker"
    echo "  ship         Build + commit + push"
    echo "  ship-deploy  Build + commit + push + deploy"
    echo "  outreach     Email templates"
    echo "  new-tweet    Start a new tweet"
    echo ""
    echo "Aliases for .bashrc:"
    echo "  alias vt='$ROOT/scripts/quick-actions.sh tweet'"
    echo "  alias vs='$ROOT/scripts/quick-actions.sh stats'"
    echo "  alias vship='$ROOT/scripts/quick-actions.sh ship'"
    echo ""
    ;;
esac
