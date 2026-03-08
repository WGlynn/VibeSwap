#!/bin/bash
# ============ Deploy All JARVIS Mind Network Shards ============
#
# Network topology (8 nodes):
#   PRIMARY:  jarvis-vibeswap        (iad) — Claude Sonnet, Telegram bot
#   SHARD-1:  jarvis-shard-1         (iad) — Claude Sonnet, worker
#   SHARD-2:  jarvis-shard-2         (iad) — Claude Sonnet, worker
#   DEGEN:    jarvis-degen           (iad) — Claude Sonnet, Diablo persona
#   EU:       jarvis-shard-eu        (lhr) — Gemini 2.0 Flash (free)
#   AP:       jarvis-shard-ap        (nrt) — DeepSeek Chat
#   SA:       jarvis-shard-sa        (gru) — Cerebras Llama 3.3 70B (free)
#   ARCHIVE:  jarvis-shard-archive   (iad) — Groq Llama 3.3 70B (free)
#
# Free-tier providers: Gemini, Cerebras, Groq = zero marginal cost
# Paid providers: Claude (primary), DeepSeek (cheap)
#
# Usage:
#   bash scripts/deploy-all-shards.sh [shard-name]
#   bash scripts/deploy-all-shards.sh          # deploy all
#   bash scripts/deploy-all-shards.sh ap       # deploy just AP shard
# ============

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Check fly CLI
command -v fly >/dev/null 2>&1 || fail "flyctl not installed. Install: https://fly.io/docs/flyctl/install/"

deploy_shard() {
  local config="$1"
  local name="$2"

  if [ ! -f "$BOT_DIR/$config" ]; then
    warn "Config not found: $config — skipping"
    return
  fi

  info "Deploying $name ($config)..."
  cd "$BOT_DIR"
  fly deploy --config "$config" --yes 2>&1 | tail -5
  info "$name deployed successfully"
  echo ""
}

TARGET="${1:-all}"

case "$TARGET" in
  primary)
    deploy_shard "fly.toml" "PRIMARY"
    ;;
  1|shard-1)
    deploy_shard "fly-shard-1.toml" "SHARD-1"
    ;;
  2|shard-2)
    deploy_shard "fly-shard-2.toml" "SHARD-2"
    ;;
  degen)
    deploy_shard "fly-degen.toml" "DEGEN"
    ;;
  eu)
    deploy_shard "fly-shard-eu.toml" "EU (London)"
    ;;
  ap)
    deploy_shard "fly-shard-ap.toml" "AP (Tokyo)"
    ;;
  sa)
    deploy_shard "fly-shard-sa.toml" "SA (Sao Paulo)"
    ;;
  archive)
    deploy_shard "fly-shard-archive.toml" "ARCHIVE"
    ;;
  all)
    info "Deploying full JARVIS Mind Network (8 nodes)..."
    echo ""
    deploy_shard "fly.toml" "PRIMARY"
    deploy_shard "fly-shard-1.toml" "SHARD-1"
    deploy_shard "fly-shard-2.toml" "SHARD-2"
    deploy_shard "fly-degen.toml" "DEGEN"
    deploy_shard "fly-shard-eu.toml" "EU (London)"
    deploy_shard "fly-shard-ap.toml" "AP (Tokyo)"
    deploy_shard "fly-shard-sa.toml" "SA (Sao Paulo)"
    deploy_shard "fly-shard-archive.toml" "ARCHIVE"
    info "All shards deployed! Network: 8 nodes across 4 continents."
    ;;
  status)
    info "Checking network status..."
    for app in jarvis-vibeswap jarvis-shard-1 jarvis-shard-2 jarvis-degen jarvis-shard-eu jarvis-shard-ap jarvis-shard-sa jarvis-shard-archive; do
      status=$(fly status --app "$app" 2>/dev/null | grep -E "running|stopped|failed" | head -1 || echo "not deployed")
      echo "  $app: $status"
    done
    ;;
  *)
    fail "Unknown shard: $TARGET. Options: primary, 1, 2, degen, eu, ap, sa, archive, all, status"
    ;;
esac
