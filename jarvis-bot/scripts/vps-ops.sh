#!/bin/bash
# ============ JARVIS VPS Operations ============
# Quick commands for day-to-day VPS management.
#
# Usage:
#   ./scripts/vps-ops.sh status     — Health + container status
#   ./scripts/vps-ops.sh logs       — Follow all logs
#   ./scripts/vps-ops.sh restart    — Restart all services
#   ./scripts/vps-ops.sh update     — Pull latest code + rebuild
#   ./scripts/vps-ops.sh ollama     — Ollama model management
#   ./scripts/vps-ops.sh shell      — Shell into primary shard
#   ./scripts/vps-ops.sh backup     — Manual backup now
# ============

set -euo pipefail

COMPOSE="docker compose -f docker-compose.vps.yml"
CMD="${1:-help}"

case "$CMD" in
  status)
    echo "=== Container Status ==="
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep jarvis
    echo ""
    echo "=== Health Check ==="
    curl -s http://localhost:8080/health 2>/dev/null | jq . 2>/dev/null || echo "Health endpoint unreachable"
    echo ""
    echo "=== Resource Usage ==="
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep jarvis
    ;;

  logs)
    SHARD="${2:-}"
    if [ -n "$SHARD" ]; then
      $COMPOSE logs -f "$SHARD"
    else
      $COMPOSE logs -f
    fi
    ;;

  restart)
    echo "Restarting JARVIS stack..."
    $COMPOSE restart
    echo "Done. Checking health in 10s..."
    sleep 10
    curl -s http://localhost:8080/health | jq . 2>/dev/null || echo "Waiting for startup..."
    ;;

  update)
    echo "Pulling latest code..."
    git pull origin master
    echo "Rebuilding containers..."
    $COMPOSE up -d --build
    echo "Done. Checking health in 15s..."
    sleep 15
    curl -s http://localhost:8080/health | jq . 2>/dev/null || echo "Waiting for startup..."
    ;;

  ollama)
    SUBCMD="${2:-list}"
    case "$SUBCMD" in
      list)
        docker exec jarvis-ollama ollama list
        ;;
      pull)
        MODEL="${3:-qwen2.5:7b}"
        echo "Pulling $MODEL..."
        docker exec jarvis-ollama ollama pull "$MODEL"
        ;;
      rm)
        MODEL="${3:?Usage: vps-ops.sh ollama rm MODEL_NAME}"
        docker exec jarvis-ollama ollama rm "$MODEL"
        ;;
      *)
        echo "Usage: vps-ops.sh ollama [list|pull MODEL|rm MODEL]"
        ;;
    esac
    ;;

  shell)
    CONTAINER="${2:-jarvis-shard-0}"
    docker exec -it "$CONTAINER" /bin/bash
    ;;

  backup)
    echo "Running manual backup..."
    bash scripts/vps-backup.sh
    ;;

  failover)
    SUBCMD="${2:-status}"
    case "$SUBCMD" in
      status)
        if [ -f /tmp/jarvis-failover.state ]; then
          IFS='|' read -r fc sc mode < /tmp/jarvis-failover.state
          echo "Failover state: $mode (fails=$fc, successes=$sc)"
        else
          echo "Failover watchdog not initialized (no state file)"
        fi
        echo ""
        echo "Fly.io health:"
        curl -s --max-time 5 https://jarvis-vibeswap.fly.dev/health 2>/dev/null | jq . 2>/dev/null || echo "  UNREACHABLE"
        echo ""
        echo "VPS shard-0:"
        docker inspect -f '{{.State.Status}}' jarvis-shard-0 2>/dev/null || echo "  NOT FOUND"
        ;;
      install)
        echo "Installing failover watchdog cron..."
        chmod +x /root/vibeswap/jarvis-bot/scripts/failover-watchdog.sh
        # Add cron entry if not already present
        (crontab -l 2>/dev/null | grep -v failover-watchdog; echo "* * * * * /root/vibeswap/jarvis-bot/scripts/failover-watchdog.sh >> /var/log/jarvis-failover.log 2>&1") | crontab -
        echo "Installed. Watchdog runs every minute."
        echo "Logs: /var/log/jarvis-failover.log"
        # Ensure VPS shard is stopped (hot standby mode)
        echo "Stopping VPS shard-0 (standby mode)..."
        $COMPOSE stop shard-0 2>/dev/null || true
        echo "Done. VPS shard will auto-activate if Fly.io goes down."
        ;;
      uninstall)
        echo "Removing failover watchdog cron..."
        (crontab -l 2>/dev/null | grep -v failover-watchdog) | crontab -
        rm -f /tmp/jarvis-failover.state
        echo "Removed."
        ;;
      force-activate)
        echo "Force-activating VPS shard..."
        echo "0|0|active" > /tmp/jarvis-failover.state
        $COMPOSE up -d shard-0
        echo "VPS shard-0 is now active."
        ;;
      force-deactivate)
        echo "Force-deactivating VPS shard..."
        echo "0|0|standby" > /tmp/jarvis-failover.state
        $COMPOSE stop shard-0
        echo "VPS shard-0 is now in standby."
        ;;
      *)
        echo "Usage: vps-ops.sh failover [status|install|uninstall|force-activate|force-deactivate]"
        ;;
    esac
    ;;

  help|*)
    echo "JARVIS VPS Operations"
    echo ""
    echo "Usage: ./scripts/vps-ops.sh COMMAND"
    echo ""
    echo "Commands:"
    echo "  status              Health + container status + resource usage"
    echo "  logs [service]      Follow logs (all or specific service)"
    echo "  restart             Restart all services"
    echo "  update              Git pull + rebuild containers"
    echo "  ollama [list|pull|rm]  Manage Ollama models"
    echo "  shell [container]   Shell into container (default: shard-0)"
    echo "  backup              Run manual backup now"
    echo "  failover [cmd]      Failover watchdog management"
    echo "    status            Show failover state + Fly.io/VPS health"
    echo "    install           Install cron watchdog (every minute)"
    echo "    uninstall         Remove cron watchdog"
    echo "    force-activate    Force VPS shard on"
    echo "    force-deactivate  Force VPS shard off"
    echo ""
    ;;
esac
