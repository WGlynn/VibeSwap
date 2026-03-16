#!/bin/bash
# ============================================================
# Mind Mesh Health Check — All nodes at a glance
# ============================================================
# Run this to see the full mesh state instantly.
# Claude Code should run this at session start and when debugging.
#
# Usage: bash jarvis-bot/scripts/mesh-health.sh
# ============================================================

echo "============================================"
echo "MIND MESH HEALTH CHECK"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# Check each node
for node in "jarvis-vibeswap:PRIMARY" "jarvis-degen:DIABOLICAL"; do
  app="${node%%:*}"
  label="${node##*:}"

  health=$(curl -sf --max-time 5 "https://${app}.fly.dev/web/health" 2>/dev/null)
  if [ -n "$health" ]; then
    status=$(echo "$health" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    uptime=$(echo "$health" | grep -o '"uptime":[0-9]*' | cut -d: -f2)
    if [ -n "$uptime" ]; then
      hours=$((uptime / 3600))
      mins=$(( (uptime % 3600) / 60 ))
      upstr="${hours}h ${mins}m"
    else
      upstr="unknown"
    fi
    echo "  [OK] ${label} (${app}) — status: ${status}, uptime: ${upstr}"
  else
    echo "  [DOWN] ${label} (${app}) — unreachable"
  fi
done

echo ""

# Check Wardenclyffe (provider cascade) on primary
echo "WARDENCLYFFE:"
warden=$(curl -sf --max-time 5 "https://jarvis-vibeswap.fly.dev/web/wardenclyffe" 2>/dev/null)
if [ -n "$warden" ]; then
  provider=$(echo "$warden" | grep -o '"activeProvider":"[^"]*"' | cut -d'"' -f4)
  model=$(echo "$warden" | grep -o '"activeModel":"[^"]*"' | cut -d'"' -f4)
  echo "  Provider: ${provider} (${model})"
else
  echo "  Unreachable"
fi

echo ""

# Check mesh connectivity
echo "MESH:"
mesh=$(curl -sf --max-time 5 "https://jarvis-vibeswap.fly.dev/web/mesh" 2>/dev/null)
if [ -n "$mesh" ]; then
  status=$(echo "$mesh" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  Status: ${status}"
else
  echo "  Unreachable"
fi

echo ""
echo "============================================"
