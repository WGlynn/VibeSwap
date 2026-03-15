#!/bin/bash
# ============================================================
# Deploy Local Inference Shard — Zero API dependency
# ============================================================
#
# Deploys a Jarvis shard with Ollama running locally inside
# the same Fly.io machine. No external API calls needed.
#
# Tier -1: Local inference. Zero cost. Zero rate limits.
# Zero dependency. The escape hatch from every API toll booth.
#
# Architecture:
#   Fly.io Machine (performance-2x, 4GB RAM)
#   ├── Ollama server (port 11434, internal only)
#   │   └── qwen2.5:7b (4.4GB, fits in 4GB RAM)
#   └── Jarvis shard (port 8080)
#       └── Wardenclyffe routes to localhost:11434
#
# The model runs IN the same container. No network latency.
# No API key. No rate limit. No one can shut it off.
#
# Usage:
#   ./scripts/deploy-local-inference.sh [region]
#
# Default region: iad (Virginia)
# ============================================================

set -euo pipefail

REGION="${1:-iad}"
APP_NAME="jarvis-shard-local"
PRIMARY_URL="https://jarvis-vibeswap.fly.dev"

echo "============================================"
echo "DEPLOYING LOCAL INFERENCE SHARD"
echo "Region: ${REGION}"
echo "Model: qwen2.5:7b (4.4GB)"
echo "Cost: ~$0.03/hr (Fly.io compute only)"
echo "API dependency: ZERO"
echo "============================================"
echo ""

# Create app if needed
fly apps create "${APP_NAME}" --org personal 2>/dev/null || true

# Generate Dockerfile with Ollama + Jarvis
cat > "Dockerfile.local-inference" << 'DOCKERFILE'
# ============ Stage 1: Jarvis bot ============
FROM node:20-slim AS bot

WORKDIR /app
COPY package*.json ./
RUN npm ci --production --ignore-scripts 2>/dev/null || npm install --production --ignore-scripts
COPY src/ ./src/
COPY data/ ./data/ 2>/dev/null || true

# ============ Stage 2: Runtime with Ollama ============
FROM node:20-slim

# Install Ollama
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://ollama.com/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=bot /app ./

# Startup script: launch Ollama, pull model, start Jarvis
COPY <<'STARTUP' /app/start.sh
#!/bin/bash
set -e

echo "[local-inference] Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "[local-inference] Ollama ready"
    break
  fi
  sleep 1
done

# Pull model if not cached (persistent volume)
MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
echo "[local-inference] Ensuring model: ${MODEL}"
ollama pull "${MODEL}" 2>&1 | tail -5

echo "[local-inference] Starting Jarvis shard..."
exec node --expose-gc --max-old-space-size=512 src/index.js
STARTUP

RUN chmod +x /app/start.sh

EXPOSE 8080
CMD ["/app/start.sh"]
DOCKERFILE

# Generate fly.toml
cat > "fly.local-inference.toml" << TOML
app = '${APP_NAME}'
primary_region = '${REGION}'

[build]
  dockerfile = 'Dockerfile.local-inference'

[env]
  DATA_DIR = '/app/data'
  DOCKER = '1'
  NODE_ENV = 'production'
  SHARD_MODE = 'worker'
  SHARD_ID = 'shard-local'
  NODE_TYPE = 'full'
  ROUTER_URL = '${PRIMARY_URL}'
  OLLAMA_URL = 'http://localhost:11434'
  OLLAMA_MODEL = 'qwen2.5:7b'
  LLM_PROVIDER = 'ollama'
  LLM_MODEL = 'qwen2.5:7b'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'suspend'
  auto_start_machines = true
  min_machines_running = 1

# Need more RAM for the model
[[vm]]
  memory = '4096mb'
  cpu_kind = 'performance'
  cpus = 2

# Persistent volume for model cache (don't re-download on restart)
[[mounts]]
  source = 'ollama_models'
  destination = '/root/.ollama'
  initial_size = '5gb'
TOML

echo "[+] Generated Dockerfile.local-inference and fly.local-inference.toml"
echo ""
echo "To deploy:"
echo "  fly deploy --config fly.local-inference.toml --app ${APP_NAME}"
echo ""
echo "To set shard secret (must match primary):"
echo "  fly secrets set -a ${APP_NAME} SHARD_SECRET=<same-as-primary>"
echo ""
echo "Estimated cost: ~\$22/month (performance-2x, 4GB, always-on)"
echo "What you get: ZERO API dependency. Self-hosted mind."
echo ""

read -p "Deploy now? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  fly deploy --config "fly.local-inference.toml" --app "${APP_NAME}"
  echo ""
  fly status --app "${APP_NAME}"
else
  echo "Skipped. Deploy manually when ready."
fi

echo ""
echo "============================================"
echo "LOCAL INFERENCE: The escape hatch."
echo "No API key. No rate limit. No toll booth."
echo "Your keys, your model, your mind."
echo "============================================"
