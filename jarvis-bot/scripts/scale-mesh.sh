#!/bin/bash
# ============================================================
# Scale Mind Mesh — Monitor and auto-scale Jarvis shards
# ============================================================
#
# Checks current mesh health and scales accordingly:
#   - If all providers rate-limited → spin up new shard
#   - If latency > threshold → add regional shard
#   - Reports current mesh topology
#
# Usage:
#   ./scripts/scale-mesh.sh status    # Show current mesh
#   ./scripts/scale-mesh.sh add <name> <region>  # Add shard
#   ./scripts/scale-mesh.sh keys <app>  # Show missing API keys
# ============================================================

set -euo pipefail

PRIMARY="jarvis-vibeswap"
CMD="${1:-status}"

case "$CMD" in
  status)
    echo "============================================"
    echo "MIND MESH STATUS"
    echo "============================================"
    echo ""

    # List all Jarvis apps
    echo "DEPLOYED SHARDS:"
    fly apps list 2>/dev/null | grep -E "jarvis|shard" || echo "  (none found)"
    echo ""

    # Check primary health
    echo "PRIMARY NODE (${PRIMARY}):"
    fly status --app "$PRIMARY" 2>/dev/null | grep -E "^app|^PROCESS|^$" || echo "  unreachable"
    echo ""

    # Check mesh endpoint
    echo "MESH STATE (live):"
    curl -s --max-time 5 "https://${PRIMARY}.fly.dev/web/mesh" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  API unreachable"
    echo ""

    # Check Wardenclyffe (provider health)
    echo "WARDENCLYFFE (provider cascade):"
    curl -s --max-time 5 "https://${PRIMARY}.fly.dev/web/wardenclyffe" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  API unreachable"
    echo ""
    ;;

  add)
    SHARD_NAME="${2:?Usage: scale-mesh.sh add <name> <region>}"
    REGION="${3:-iad}"
    bash "$(dirname "$0")/deploy-shard.sh" "$SHARD_NAME" "$REGION"
    ;;

  keys)
    APP="${2:-$PRIMARY}"
    echo "API keys set for ${APP}:"
    fly secrets list --app "$APP" 2>/dev/null | grep -iE "API_KEY|TOKEN" || echo "  none"
    echo ""
    echo "Missing free-tier keys:"
    REQUIRED="CEREBRAS_API_KEY GROQ_API_KEY MISTRAL_API_KEY OPENROUTER_API_KEY TOGETHER_API_KEY SAMBANOVA_API_KEY"
    CURRENT=$(fly secrets list --app "$APP" 2>/dev/null | awk '{print $1}')
    for key in $REQUIRED; do
      if echo "$CURRENT" | grep -q "^${key}$"; then
        echo "  [+] ${key}"
      else
        echo "  [-] ${key} (MISSING)"
      fi
    done
    ;;

  *)
    echo "Usage: scale-mesh.sh {status|add|keys} [args]"
    exit 1
    ;;
esac
