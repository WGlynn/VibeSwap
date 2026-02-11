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

# Pre-flight checks
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

# 4. Check SSL certs
if [ ! -f docker/nginx/ssl/cert.pem ] || [ ! -f docker/nginx/ssl/key.pem ]; then
    echo -e "${YELLOW}  SSL certs not found in docker/nginx/ssl/ - using HTTP only${NC}"
    echo -e "${YELLOW}  For production, add cert.pem and key.pem${NC}"
fi

# Build
echo -e "\n${YELLOW}Building Docker images...${NC}"
docker compose build --no-cache

# Deploy
echo -e "\n${YELLOW}Starting services...${NC}"
docker compose up -d

# Health check
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Check health
BACKEND_HEALTH=$(curl -sf http://localhost:3001/api/health/live 2>/dev/null || echo "failed")
if echo "$BACKEND_HEALTH" | grep -q "alive"; then
    echo -e "${GREEN}  Backend: Healthy${NC}"
else
    echo -e "${RED}  Backend: Unhealthy${NC}"
fi

FRONTEND_HEALTH=$(curl -sf http://localhost:80/ 2>/dev/null || echo "failed")
if [ "$FRONTEND_HEALTH" != "failed" ]; then
    echo -e "${GREEN}  Frontend: Healthy${NC}"
else
    echo -e "${YELLOW}  Frontend: Checking...${NC}"
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
