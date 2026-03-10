#!/bin/bash
# ============ Cincinnatus Protocol — JARVIS Failover Watchdog ============
#
# Named for Cincinnatus: called to power only when needed, returns to the
# farm the moment the crisis passes. The VPS shard rules only when Fly.io
# cannot, and relinquishes control the instant it recovers.
#
# Monitors Fly.io primary. If it dies, activates VPS hot standby.
# When Fly.io recovers, deactivates VPS shard (hands back to primary).
#
# This removes Will from the loop. The network heals itself.
#
# Install (on VPS):
#   crontab -e
#   * * * * * /root/vibeswap/jarvis-bot/scripts/failover-watchdog.sh >> /var/log/jarvis-failover.log 2>&1
#
# How it works:
#   - Runs every minute via cron
#   - Pings Fly.io health endpoint
#   - Tracks consecutive failures in a state file
#   - After 3 failures (3 min): starts VPS shard-0 (takes over Telegram)
#   - After 3 successes post-failover: stops VPS shard-0 (hands back to Fly.io)
#   - Sends Telegram DM to owner on every state transition
#
# Telegram "last-to-connect wins" behavior:
#   - When VPS shard starts, it connects to Telegram and steals the update stream
#   - When Fly.io recovers and reconnects, it steals it back
#   - The watchdog then stops the VPS shard (clean handoff)
#
# State file: /tmp/jarvis-failover.state
# ============

set -uo pipefail

# ============ Config ============

FLYIO_HEALTH_URL="https://jarvis-vibeswap.fly.dev/health"
STATE_FILE="/tmp/jarvis-failover.state"
COMPOSE_FILE="/root/vibeswap/jarvis-bot/docker-compose.vps.yml"
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
CONTAINER_NAME="jarvis-shard-0"
HEALTH_TIMEOUT=10  # seconds

# Thresholds
FAILOVER_THRESHOLD=3   # 3 consecutive failures → activate VPS
RECOVERY_THRESHOLD=3   # 3 consecutive successes → deactivate VPS

# Telegram notification (direct Bot API, no framework needed)
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
OWNER_ID="${OWNER_USER_ID:-8366932263}"

# ============ State Management ============

# State format: FAIL_COUNT|SUCCESS_COUNT|MODE
# MODE: standby (VPS off, Fly.io handling) | active (VPS on, Fly.io down)
read_state() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    echo "0|0|standby"
  fi
}

write_state() {
  echo "$1|$2|$3" > "$STATE_FILE"
}

# ============ Telegram DM ============

send_dm() {
  local msg="$1"
  if [ -z "$BOT_TOKEN" ]; then
    echo "[failover] No BOT_TOKEN — skipping DM: $msg"
    return
  fi
  # Source .env if token not in environment
  if [ -z "$BOT_TOKEN" ] && [ -f "/root/vibeswap/jarvis-bot/.env" ]; then
    BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /root/vibeswap/jarvis-bot/.env | cut -d= -f2-)
  fi
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${OWNER_ID}" \
    -d "text=${msg}" \
    -d "parse_mode=HTML" \
    > /dev/null 2>&1 || true
}

# ============ Health Check ============

check_flyio_health() {
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" "$FLYIO_HEALTH_URL" 2>/dev/null)
  if [ "$http_code" = "200" ]; then
    return 0  # healthy
  else
    return 1  # unhealthy
  fi
}

# ============ VPS Shard Control ============

is_vps_shard_running() {
  local state
  state=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
  [ "$state" = "true" ]
}

start_vps_shard() {
  echo "[failover] $(date -Iseconds) ACTIVATING VPS hot standby..."
  $COMPOSE_CMD up -d shard-0 2>&1
  echo "[failover] VPS shard-0 started."
}

stop_vps_shard() {
  echo "[failover] $(date -Iseconds) DEACTIVATING VPS hot standby — handing back to Fly.io..."
  $COMPOSE_CMD stop shard-0 2>&1
  echo "[failover] VPS shard-0 stopped."
}

# ============ Main Logic ============

IFS='|' read -r fail_count success_count mode <<< "$(read_state)"

if check_flyio_health; then
  # Fly.io is healthy
  fail_count=0
  success_count=$((success_count + 1))

  if [ "$mode" = "active" ]; then
    # We're in failover mode — check if Fly.io has been stable enough to hand back
    if [ "$success_count" -ge "$RECOVERY_THRESHOLD" ]; then
      echo "[failover] $(date -Iseconds) Fly.io recovered ($RECOVERY_THRESHOLD consecutive successes) — deactivating VPS"
      stop_vps_shard
      mode="standby"
      success_count=0
      send_dm "[CINCINNATUS] Fly.io RECOVERED. VPS standby deactivated. Cincinnatus returns to the farm."
    else
      echo "[failover] $(date -Iseconds) Fly.io healthy but waiting for stability ($success_count/$RECOVERY_THRESHOLD)"
    fi
  fi

else
  # Fly.io is down
  success_count=0
  fail_count=$((fail_count + 1))
  echo "[failover] $(date -Iseconds) Fly.io unreachable ($fail_count/$FAILOVER_THRESHOLD)"

  if [ "$mode" = "standby" ] && [ "$fail_count" -ge "$FAILOVER_THRESHOLD" ]; then
    echo "[failover] $(date -Iseconds) FAILOVER TRIGGERED — activating VPS hot standby"

    if is_vps_shard_running; then
      echo "[failover] VPS shard already running — no action needed"
    else
      start_vps_shard
    fi

    mode="active"
    fail_count=0
    send_dm "[CINCINNATUS] Fly.io DOWN for ${FAILOVER_THRESHOLD}+ minutes. VPS hot standby ACTIVATED. Jarvis is running from VPS."
  fi
fi

write_state "$fail_count" "$success_count" "$mode"
