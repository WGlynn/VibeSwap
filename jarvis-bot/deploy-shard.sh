#!/bin/bash
# ============ Deploy a New JARVIS Shard ============
# Usage: ./deploy-shard.sh <shard-name> <region>
# Example: ./deploy-shard.sh jarvis-shard-1 lax
#
# This creates a new Fly.io app with its own volume, sharing
# the same Telegram bot token but with a unique shard ID.
# The shard registers with the primary and participates in CRPC.
#
# Prerequisites:
#   - flyctl installed and authenticated
#   - Primary shard running at jarvis-vibeswap.fly.dev
#   - Environment secrets set (see below)

set -e

SHARD_NAME="${1:-jarvis-shard-1}"
REGION="${2:-lax}"
PRIMARY_URL="https://jarvis-vibeswap.fly.dev"

echo "=== Deploying JARVIS Shard: $SHARD_NAME ==="
echo "Region: $REGION"
echo "Primary: $PRIMARY_URL"
echo ""

# 1. Create the app
echo "[1/5] Creating Fly app..."
fly apps create "$SHARD_NAME" || echo "App may already exist, continuing..."

# 2. Create volume for persistent data
echo "[2/5] Creating volume..."
fly volumes create jarvis_data --app "$SHARD_NAME" --region "$REGION" --size 1 || echo "Volume may already exist"

# 3. Generate fly.toml for shard
cat > "fly-${SHARD_NAME}.toml" << EOF
app = '$SHARD_NAME'
primary_region = '$REGION'

[build]
  dockerfile = 'Dockerfile'

[env]
  DATA_DIR = '/app/data'
  DOCKER = '1'
  ENCRYPTION_ENABLED = 'true'
  MEMORY_DIR = '/app/memory'
  NODE_ENV = 'production'
  VIBESWAP_REPO = '/repo'
  SHARD_ID = '$SHARD_NAME'
  TOTAL_SHARDS = '2'
  ROUTER_URL = '$PRIMARY_URL'
  SHARD_ROLE = 'worker'

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
    interval = '10s'
    timeout = '5s'
    grace_period = '120s'
    path = '/health'

[[restart]]
  policy = 'always'
  max_retries = 10

[[vm]]
  size = 'shared-cpu-1x'
  memory = '512mb'
EOF

# 4. Copy secrets from primary (user must have set these)
echo "[4/5] Setting secrets..."
echo "You need to set these secrets for $SHARD_NAME:"
echo "  fly secrets set --app $SHARD_NAME \\"
echo "    TELEGRAM_BOT_TOKEN=<your-token> \\"
echo "    ANTHROPIC_API_KEY=<your-key> \\"
echo "    CLAUDE_CODE_API_SECRET=<your-secret> \\"
echo "    ENCRYPTION_KEY=<your-key>"
echo ""
echo "Copy them from the primary with:"
echo "  fly secrets list --app jarvis-vibeswap"
echo ""

# 5. Deploy
echo "[5/5] Deploying shard..."
fly deploy --config "fly-${SHARD_NAME}.toml" --remote-only

echo ""
echo "=== Shard $SHARD_NAME deployed! ==="
echo "Health: https://${SHARD_NAME}.fly.dev/health"
echo "Nyx:    https://${SHARD_NAME}.fly.dev/nyx"
echo ""
echo "To verify: curl -s https://${SHARD_NAME}.fly.dev/health | python3 -m json.tool"
