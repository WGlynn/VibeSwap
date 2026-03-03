#!/usr/bin/env bash
# ============ JARVIS Mind Network — One-Command Shard Deployment ============
#
# Deploys a new worker shard to the JARVIS Mind Network on Fly.io.
# Worker shards participate in BFT consensus, CRPC pairwise comparison,
# and the Proof-of-Mind knowledge chain — no Telegram token needed.
#
# Usage:
#   bash scripts/join-network.sh
#
# Requirements:
#   - flyctl installed (https://fly.io/docs/flyctl/install/)
#   - Anthropic API key
#   - Fly.io account (fly auth login)
#
# What this creates:
#   - A Fly.io app (jarvis-shard-<name>)
#   - A 1GB persistent volume for knowledge storage
#   - Environment secrets (API key, shard identity)
#   - Deploys the worker shard image
#
# The shard will:
#   - Register with the primary shard's router on boot
#   - Send heartbeats every 30 seconds
#   - Participate in BFT consensus voting
#   - Process CRPC pairwise comparisons
#   - Sync knowledge chain epochs
# ============

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "=============================================="
echo "  JARVIS Mind Network — Shard Deployment"
echo "  Decentralized AI Consensus Infrastructure"
echo "=============================================="
echo -e "${NC}"

# Check prerequisites
if ! command -v fly &> /dev/null; then
  echo -e "${RED}Error: flyctl not installed.${NC}"
  echo "Install: curl -L https://fly.io/install.sh | sh"
  exit 1
fi

if ! fly auth whoami &> /dev/null; then
  echo -e "${YELLOW}Not logged in to Fly.io. Running 'fly auth login'...${NC}"
  fly auth login
fi

# Gather inputs
echo ""
read -p "Shard name (e.g., alpha, bravo, node-42): " SHARD_NAME
if [ -z "$SHARD_NAME" ]; then
  echo -e "${RED}Shard name is required.${NC}"
  exit 1
fi

APP_NAME="jarvis-shard-${SHARD_NAME}"
SHARD_ID="shard-${SHARD_NAME}"

echo ""
echo "Node type determines storage behavior:"
echo "  light   — Prune aggressively, cheapest. Good for consensus quorum."
echo "  full    — Retain full history, 30% storage discount. Preferred for failover."
echo "  archive — Pure storage node, 50% discount. Min 3 needed for network survival."
echo ""
read -p "Node type [light/full/archive] (default: full): " NODE_TYPE
NODE_TYPE="${NODE_TYPE:-full}"

echo ""
echo "LLM Provider — each shard runs its own model:"
echo "  1. claude    — Anthropic API (needs ANTHROPIC_API_KEY)"
echo "  2. openai    — OpenAI API (needs OPENAI_API_KEY)"
echo "  3. gemini    — Google Gemini (needs GEMINI_API_KEY, free tier available)"
echo "  4. ollama    — Local model via Ollama (FREE, no API key)"
echo "  5. deepseek  — DeepSeek API (needs DEEPSEEK_API_KEY, cheapest cloud option)"
echo ""
read -p "LLM provider [claude/openai/gemini/ollama/deepseek] (default: claude): " LLM_PROVIDER
LLM_PROVIDER="${LLM_PROVIDER:-claude}"

# Get API key based on provider
API_KEY=""
API_KEY_NAME=""
LLM_MODEL=""

case "$LLM_PROVIDER" in
  claude)
    read -p "Anthropic API key (sk-ant-...): " API_KEY
    API_KEY_NAME="ANTHROPIC_API_KEY"
    read -p "Model (default: claude-sonnet-4-5-20250929): " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-claude-sonnet-4-5-20250929}"
    ;;
  openai)
    read -p "OpenAI API key (sk-...): " API_KEY
    API_KEY_NAME="OPENAI_API_KEY"
    read -p "Model (default: gpt-4o): " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-gpt-4o}"
    ;;
  gemini)
    read -p "Gemini API key: " API_KEY
    API_KEY_NAME="GEMINI_API_KEY"
    read -p "Model (default: gemini-2.0-flash): " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-gemini-2.0-flash}"
    ;;
  ollama)
    echo -e "${GREEN}Ollama runs locally — no API key needed!${NC}"
    echo "Note: You'll need Ollama running with a model pulled."
    read -p "Model (default: llama3.1): " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-llama3.1}"
    read -p "Ollama URL (default: http://localhost:11434): " OLLAMA_URL
    OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
    ;;
  deepseek)
    read -p "DeepSeek API key (sk-...): " API_KEY
    API_KEY_NAME="DEEPSEEK_API_KEY"
    read -p "Model (default: deepseek-chat): " LLM_MODEL
    LLM_MODEL="${LLM_MODEL:-deepseek-chat}"
    ;;
  *)
    echo -e "${RED}Unknown provider: ${LLM_PROVIDER}${NC}"
    exit 1
    ;;
esac

if [ "$LLM_PROVIDER" != "ollama" ] && [ -z "$API_KEY" ]; then
  echo -e "${RED}API key is required for ${LLM_PROVIDER} provider.${NC}"
  exit 1
fi

echo ""
read -p "Region [iad/lhr/nrt/syd/fra/sjc] (default: iad): " REGION
REGION="${REGION:-iad}"

echo ""
read -p "Primary router URL (default: https://jarvis-vibeswap.fly.dev): " ROUTER_URL
ROUTER_URL="${ROUTER_URL:-https://jarvis-vibeswap.fly.dev}"

# Confirm
echo ""
echo -e "${CYAN}Deployment Summary:${NC}"
echo "  App name:    ${APP_NAME}"
echo "  Shard ID:    ${SHARD_ID}"
echo "  Node type:   ${NODE_TYPE}"
echo "  Provider:    ${LLM_PROVIDER}"
echo "  Model:       ${LLM_MODEL}"
echo "  Region:      ${REGION}"
echo "  Router:      ${ROUTER_URL}"
echo ""
read -p "Deploy? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Cancelled."
  exit 0
fi

# Create app
echo ""
echo -e "${GREEN}Creating Fly.io app: ${APP_NAME}...${NC}"
fly apps create "$APP_NAME" --org personal 2>/dev/null || echo "App already exists, continuing..."

# Create volume
echo -e "${GREEN}Creating 1GB data volume in ${REGION}...${NC}"
fly volumes create jarvis_data --size 1 --region "$REGION" --app "$APP_NAME" --yes 2>/dev/null || echo "Volume already exists, continuing..."

# Set secrets
echo -e "${GREEN}Setting secrets...${NC}"
SECRETS="SHARD_ID=$SHARD_ID"
if [ -n "$API_KEY" ] && [ -n "$API_KEY_NAME" ]; then
  SECRETS="$SECRETS $API_KEY_NAME=$API_KEY"
fi
fly secrets set $SECRETS --app "$APP_NAME"

# Generate fly.toml for this shard
SHARD_TOML="fly-${SHARD_NAME}.toml"
echo -e "${GREEN}Generating ${SHARD_TOML}...${NC}"

cat > "$SHARD_TOML" << EOF
# JARVIS Mind Network — Worker Shard: ${SHARD_NAME}
# Auto-generated by join-network.sh — Provider: ${LLM_PROVIDER}

app = '${APP_NAME}'
primary_region = '${REGION}'

[build]
  image = 'ghcr.io/wglynn/jarvis-shard:latest'

[env]
  DATA_DIR = '/app/data'
  DOCKER = '1'
  ENCRYPTION_ENABLED = 'true'
  NODE_ENV = 'production'
  HEALTH_PORT = '8080'
  SHARD_MODE = 'worker'
  TOTAL_SHARDS = '3'
  NODE_TYPE = '${NODE_TYPE}'
  ROUTER_URL = '${ROUTER_URL}'
  LLM_PROVIDER = '${LLM_PROVIDER}'
  LLM_MODEL = '${LLM_MODEL}'

[[mounts]]
  source = 'jarvis_data'
  destination = '/app/data'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true

[checks]
  [checks.health]
    port = 8080
    type = 'http'
    interval = '1m0s'
    timeout = '10s'
    path = '/health'

[[restart]]
  policy = 'always'
  max_retries = 10

[[vm]]
  size = 'shared-cpu-1x'
  memory = '256mb'
EOF

# Deploy
echo -e "${GREEN}Deploying shard...${NC}"
fly deploy --config "$SHARD_TOML" --app "$APP_NAME"

# Verify
echo ""
echo -e "${GREEN}Verifying health...${NC}"
sleep 5
HEALTH=$(curl -s "https://${APP_NAME}.fly.dev/health" 2>/dev/null || echo '{"status":"pending"}')
echo "Health: $HEALTH"

echo ""
echo -e "${CYAN}=============================================="
echo "  Shard deployed successfully!"
echo ""
echo "  App:       https://${APP_NAME}.fly.dev"
echo "  Health:    https://${APP_NAME}.fly.dev/health"
echo "  Shard ID:  ${SHARD_ID}"
echo "  Node type: ${NODE_TYPE}"
echo ""
echo "  Monitor:"
echo "    fly logs --app ${APP_NAME}"
echo "    fly status --app ${APP_NAME}"
echo ""
echo "  Destroy:"
echo "    fly apps destroy ${APP_NAME}"
echo "=============================================="
echo -e "${NC}"
