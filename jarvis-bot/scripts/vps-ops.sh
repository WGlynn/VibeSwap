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
    echo ""
    ;;
esac
