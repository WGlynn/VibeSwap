#!/bin/bash
set -euo pipefail

# ============================================
# VibeSwap Production Deployment Script
# ============================================

echo "============================================"
echo "  VibeSwap Production Deployment"
echo "============================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Flags
ALLOW_HTTP=false
for arg in "$@"; do
  case "$arg" in
    --allow-http) ALLOW_HTTP=true ;;
  esac
done

# ============ Rollback Support ============
PREV_CONTAINERS=""

rollback() {
  echo -e "\n${RED}Deployment failed! Rolling back...${NC}"
  docker compose down 2>/dev/null || true
  if [ -n "$PREV_CONTAINERS" ]; then
    echo -e "${YELLOW}Restoring previous containers...${NC}"
    for container in $PREV_CONTAINERS; do
      docker start "$container" 2>/dev/null || true
    done
    echo -e "${GREEN}Rollback complete.${NC}"
  else
    echo -e "${YELLOW}No previous containers to restore.${NC}"
  fi
  exit 1
}

# ============ Pre-flight Checks ============
echo -e "\n${YELLOW}Running pre-flight checks...${NC}"

# 1. Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}  Docker: OK${NC}"

# 2. Check docker compose
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose is not available${NC}"
    exit 1
fi
echo -e "${GREEN}  Docker Compose: OK${NC}"

# 3. Check env files
if [ ! -f backend/.env ]; then
    echo -e "${RED}  backend/.env not found. Copy from backend/.env.example${NC}"
    exit 1
fi
echo -e "${GREEN}  Backend .env: OK${NC}"

# 4. Check SSL certs (required unless --allow-http)
if [ ! -f docker/nginx/ssl/cert.pem ] || [ ! -f docker/nginx/ssl/key.pem ]; then
    if [ "$ALLOW_HTTP" = true ]; then
        echo -e "${YELLOW}  SSL certs not found — running HTTP-only (--allow-http)${NC}"
    else
        echo -e "${RED}  SSL certs not found in docker/nginx/ssl/${NC}"
        echo -e "${RED}  Production requires cert.pem and key.pem${NC}"
        echo -e "${RED}  Use --allow-http to explicitly opt in to HTTP-only (dev/staging only)${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}  SSL certs: OK${NC}"
fi

# ============ Save Current State for Rollback ============
PREV_CONTAINERS=$(docker compose ps -q 2>/dev/null || true)

# ============ Build ============
echo -e "\n${YELLOW}Building Docker images...${NC}"
docker compose build --no-cache

# ============ Deploy ============
echo -e "\n${YELLOW}Starting services...${NC}"
docker compose up -d

# ============ Health Check (with timeout) ============
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
HEALTH_TIMEOUT=60
HEALTH_INTERVAL=5
ELAPSED=0

while [ "$ELAPSED" -lt "$HEALTH_TIMEOUT" ]; do
  sleep "$HEALTH_INTERVAL"
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))

  BACKEND_HEALTH=$(curl -sf http://localhost:3001/api/health/live 2>/dev/null || echo "failed")
  if echo "$BACKEND_HEALTH" | grep -q "alive"; then
    echo -e "${GREEN}  Backend: Healthy (${ELAPSED}s)${NC}"
    break
  fi

  echo -e "${YELLOW}  Backend: Not ready yet (${ELAPSED}s/${HEALTH_TIMEOUT}s)...${NC}"
done

# Final health verification
BACKEND_HEALTH=$(curl -sf http://localhost:3001/api/health/live 2>/dev/null || echo "failed")
if ! echo "$BACKEND_HEALTH" | grep -q "alive"; then
    echo -e "${RED}  Backend: Failed health check after ${HEALTH_TIMEOUT}s${NC}"
    rollback
fi

FRONTEND_HEALTH=$(curl -sf http://localhost:80/ 2>/dev/null || echo "failed")
if [ "$FRONTEND_HEALTH" != "failed" ]; then
    echo -e "${GREEN}  Frontend: Healthy${NC}"
else
    echo -e "${YELLOW}  Frontend: Not responding (may need more time or check logs)${NC}"
fi

echo -e "\n${GREEN}============================================${NC}"
echo -e "${GREEN}  Deployment complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Services:"
echo "  Frontend:  http://localhost:80"
echo "  Backend:   http://localhost:3001"
echo "  WebSocket: ws://localhost:3001/ws"
echo "  Health:    http://localhost:3001/api/health"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f        # View logs"
echo "  docker compose ps             # Check status"
echo "  docker compose down           # Stop all"
echo "  docker compose restart        # Restart all"
