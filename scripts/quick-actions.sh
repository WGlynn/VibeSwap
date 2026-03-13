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
  daily)
    node scripts/bd-toolkit.js today
    ;;
  blast)
    node scripts/bd-toolkit.js social-blast
    ;;
  grant-status)
    node scripts/bd-toolkit.js grant-status
    ;;
  help|*)
    echo ""
    echo "VibeSwap Quick Actions — for lazy builders"
    echo ""
    echo "  === START HERE ==="
    echo "  daily        Your daily package (tasks + tweet + stats)"
    echo "  blast        Generate ALL social content at once"
    echo ""
    echo "  === CONTENT ==="
    echo "  today        What to do today (calendar)"
    echo "  tweet        Random tweet to post"
    echo "  digest       Weekly summary"
    echo "  digest-tg    Telegram-formatted digest"
    echo "  digest-tweet Tweet thread digest"
    echo "  new-tweet    Start a new tweet"
    echo ""
    echo "  === BD ==="
    echo "  stats        Live project stats"
    echo "  grants       Grant tracker document"
    echo "  grant-status At-a-glance grant status"
    echo "  outreach     Email templates"
    echo ""
    echo "  === SHIP ==="
    echo "  ship         Build + commit + push"
    echo "  ship-deploy  Build + commit + push + deploy"
    echo ""
    echo "Aliases for .bashrc:"
    echo "  alias vd='$ROOT/scripts/quick-actions.sh daily'"
    echo "  alias vb='$ROOT/scripts/quick-actions.sh blast'"
    echo "  alias vt='$ROOT/scripts/quick-actions.sh tweet'"
    echo "  alias vs='$ROOT/scripts/quick-actions.sh stats'"
    echo "  alias vship='$ROOT/scripts/quick-actions.sh ship'"
    echo ""
    ;;
esac
