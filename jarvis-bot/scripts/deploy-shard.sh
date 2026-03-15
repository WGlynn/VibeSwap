#!/bin/bash
# ============================================================
# Deploy a new Jarvis Shard — Linear Compute Scaling
# ============================================================
#
# Each shard is a full-clone agent with its own:
#   - Free-tier API keys (Groq, Cerebras, Mistral, etc.)
#   - Context window and conversation memory
#   - Connection to the Mind Mesh
#
# N shards = N × free tier limits. Compute scales linearly.
# This is the scaling mechanism that dissolves API dependency.
#
# Usage:
#   ./scripts/deploy-shard.sh <shard-name> [region]
#
# Example:
#   ./scripts/deploy-shard.sh shard-eu fra   # Frankfurt
#   ./scripts/deploy-shard.sh shard-asia nrt # Tokyo
#   ./scripts/deploy-shard.sh shard-us-west lax # Los Angeles
#
# Prerequisites:
#   - flyctl installed and authenticated
#   - Primary jarvis-vibeswap app running (router)
#
# The shard registers with the primary's router automatically.
# No manual configuration needed after deploy.
# ============================================================

set -euo pipefail

SHARD_NAME="${1:?Usage: deploy-shard.sh <shard-name> [region]}"
REGION="${2:-iad}"
PRIMARY_APP="jarvis-vibeswap"
PRIMARY_URL="https://jarvis-vibeswap.fly.dev"

echo "============================================"
echo "Deploying Jarvis Shard: ${SHARD_NAME}"
echo "Region: ${REGION}"
echo "Router: ${PRIMARY_URL}"
echo "============================================"
echo ""

# Check if app already exists
if fly apps list 2>/dev/null | grep -q "^${SHARD_NAME} "; then
  echo "[!] App ${SHARD_NAME} already exists. Updating..."
  FLY_APP="${SHARD_NAME}"
else
  echo "[+] Creating new Fly.io app: ${SHARD_NAME}"
  fly apps create "${SHARD_NAME}" --org personal 2>/dev/null || true
  FLY_APP="${SHARD_NAME}"
fi

# Generate shard-specific fly.toml
SHARD_TOML="fly.${SHARD_NAME}.toml"
cat > "${SHARD_TOML}" << TOML
app = '${SHARD_NAME}'
primary_region = '${REGION}'

[build]
  dockerfile = 'Dockerfile'

[env]
  DATA_DIR = '/app/data'
  DOCKER = '1'
  ENCRYPTION_ENABLED = 'true'
  MEMORY_DIR = '/app/memory'
  NODE_ENV = 'production'
  VIBESWAP_REPO = '/repo'
  SHARD_MODE = 'worker'
  SHARD_ID = '${SHARD_NAME}'
  NODE_TYPE = 'light'
  ROUTER_URL = '${PRIMARY_URL}'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'suspend'
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  memory = '512mb'
  cpu_kind = 'shared'
  cpus = 1
TOML

echo "[+] Generated ${SHARD_TOML}"

# Prompt for free-tier API keys
echo ""
echo "============================================"
echo "FREE-TIER API KEYS FOR ${SHARD_NAME}"
echo "============================================"
echo "Each shard needs its OWN free-tier keys."
echo "Sign up at these providers (all free):"
echo ""
echo "  Cerebras:    https://cloud.cerebras.ai"
echo "  Groq:        https://console.groq.com"
echo "  Mistral:     https://console.mistral.ai"
echo "  OpenRouter:  https://openrouter.ai"
echo "  Together:    https://api.together.xyz"
echo "  SambaNova:   https://cloud.sambanova.ai"
echo ""
echo "Set secrets with:"
echo "  fly secrets set -a ${SHARD_NAME} \\"
echo "    CEREBRAS_API_KEY=csk-xxx \\"
echo "    GROQ_API_KEY=gsk_xxx \\"
echo "    MISTRAL_API_KEY=xxx \\"
echo "    OPENROUTER_API_KEY=sk-or-xxx \\"
echo "    TOGETHER_API_KEY=xxx \\"
echo "    SHARD_SECRET=<same-as-primary>"
echo ""

# Check if we should deploy now
read -p "Deploy now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "[+] Deploying ${SHARD_NAME} to ${REGION}..."
  fly deploy --config "${SHARD_TOML}" --app "${SHARD_NAME}" --region "${REGION}"
  echo ""
  echo "[+] Shard ${SHARD_NAME} deployed!"
  echo "[+] It will auto-register with the router at ${PRIMARY_URL}"
  echo ""
  fly status --app "${SHARD_NAME}"
else
  echo "[i] Skipped deploy. Run manually with:"
  echo "    fly deploy --config ${SHARD_TOML} --app ${SHARD_NAME}"
fi

# Cleanup
echo ""
echo "============================================"
echo "SCALING STATUS"
echo "============================================"
echo "Primary: ${PRIMARY_APP} (router + full node)"
echo "New shard: ${SHARD_NAME} (${REGION})"
echo ""
echo "Each shard multiplies free-tier compute."
echo "N shards = N × rate limits."
echo "The network doesn't share limits — it MULTIPLIES them."
echo "============================================"
