#!/bin/bash
# ============ Deploy JARVIS Mind Mesh Constellation ============
# Usage: ./deploy-constellation.sh <phase> [--dry-run]
#
# Phases:
#   1 = Core (4 shards: primary + 3 consensus validators)
#   2 = Core + Domain (16 shards: + 12 specialized knowledge)
#   3 = Core + Domain + Community (32 shards: + 16 per-group)
#   4 = Full constellation (64 shards: + 16 agent-economy + 16 frontier)
#
# Prerequisites:
#   - flyctl installed and authenticated
#   - Primary shard running at jarvis-vibeswap.fly.dev
#   - jq installed for manifest parsing
#   - Secrets set on primary (will be cloned to new shards)

set -e

PHASE="${1:-1}"
DRY_RUN="${2:-}"
MANIFEST="shard-manifest.json"
PRIMARY_URL="https://jarvis-vibeswap.fly.dev"
PRIMARY_APP="jarvis-vibeswap"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     JARVIS MIND MESH — CONSTELLATION     ║${NC}"
echo -e "${CYAN}║           Phase $PHASE Deployment              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

if [ ! -f "$MANIFEST" ]; then
    echo -e "${RED}ERROR: $MANIFEST not found. Run from jarvis-bot/ directory.${NC}"
    exit 1
fi

# Determine which tiers to deploy based on phase
case $PHASE in
    1) TIERS=("core") ;;
    2) TIERS=("core" "domain") ;;
    3) TIERS=("core" "domain" "community") ;;
    4) TIERS=("core" "domain" "community" "agent-economy" "frontier") ;;
    *) echo -e "${RED}Invalid phase. Use 1-4.${NC}"; exit 1 ;;
esac

# Count total shards for this phase
TOTAL=0
for tier in "${TIERS[@]}"; do
    count=$(jq -r ".tiers.\"$tier\".count" "$MANIFEST")
    TOTAL=$((TOTAL + count))
done

echo -e "${YELLOW}Deploying $TOTAL shards across tiers: ${TIERS[*]}${NC}"
echo ""

# Get secrets from primary (for cloning to new shards)
echo -e "${CYAN}[0/3] Fetching secrets from primary...${NC}"
if [ "$DRY_RUN" != "--dry-run" ]; then
    SECRETS=$(fly secrets list --app "$PRIMARY_APP" --json 2>/dev/null || echo "[]")
    echo -e "${GREEN}  Found $(echo "$SECRETS" | jq length) secrets${NC}"
else
    echo -e "${YELLOW}  [DRY RUN] Would fetch secrets from $PRIMARY_APP${NC}"
fi

# Deploy each tier
DEPLOYED=0
FAILED=0

for tier in "${TIERS[@]}"; do
    echo ""
    echo -e "${CYAN}━━━ Tier: $tier ━━━${NC}"

    count=$(jq -r ".tiers.\"$tier\".count" "$MANIFEST")

    for i in $(seq 0 $((count - 1))); do
        shard_id=$(jq -r ".tiers.\"$tier\".shards[$i].id" "$MANIFEST")
        spec=$(jq -r ".tiers.\"$tier\".shards[$i].spec" "$MANIFEST")
        desc=$(jq -r ".tiers.\"$tier\".shards[$i].desc // empty" "$MANIFEST")
        region=$(jq -r ".tiers.\"$tier\".shards[$i].region // \"iad\"" "$MANIFEST")

        # Skip primary (shard-0) — already running
        if [ "$shard_id" = "shard-0" ]; then
            echo -e "  ${GREEN}✓ $shard_id ($spec) — already running as primary${NC}"
            DEPLOYED=$((DEPLOYED + 1))
            continue
        fi

        app_name="jarvis-${shard_id}"

        echo -e "  ${YELLOW}→ Deploying $shard_id ($spec) to $region...${NC}"
        if [ -n "$desc" ]; then
            echo -e "    ${NC}$desc${NC}"
        fi

        if [ "$DRY_RUN" = "--dry-run" ]; then
            echo -e "    ${YELLOW}[DRY RUN] Would create $app_name in $region${NC}"
            DEPLOYED=$((DEPLOYED + 1))
            continue
        fi

        # Generate fly.toml for this shard
        cat > "fly-${app_name}.toml" << EOF
app = '$app_name'
primary_region = '$region'

[build]
  dockerfile = 'Dockerfile'

[env]
  DATA_DIR = '/app/data'
  DOCKER = '1'
  ENCRYPTION_ENABLED = 'true'
  MEMORY_DIR = '/app/memory'
  NODE_ENV = 'production'
  VIBESWAP_REPO = '/repo'
  SHARD_ID = '$shard_id'
  SHARD_SPEC = '$spec'
  TOTAL_SHARDS = '$TOTAL'
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

        # Create app
        fly apps create "$app_name" 2>/dev/null || true

        # Create volume
        fly volumes create jarvis_data --app "$app_name" --region "$region" --size 1 2>/dev/null || true

        # Clone secrets from primary
        fly secrets import --app "$app_name" < <(fly secrets list --app "$PRIMARY_APP" --json | jq -r '.[] | "\(.Name)=\(.Digest)"') 2>/dev/null || true

        # Deploy
        if fly deploy --config "fly-${app_name}.toml" --remote-only 2>/dev/null; then
            echo -e "    ${GREEN}✓ $shard_id deployed successfully${NC}"
            DEPLOYED=$((DEPLOYED + 1))
        else
            echo -e "    ${RED}✗ $shard_id failed to deploy${NC}"
            FAILED=$((FAILED + 1))
        fi
    done
done

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           DEPLOYMENT COMPLETE            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo -e "  ${GREEN}Deployed: $DEPLOYED${NC}"
echo -e "  ${RED}Failed:   $FAILED${NC}"
echo -e "  Total:    $TOTAL"
echo ""
echo -e "  ${CYAN}Monitor: https://jarvis-vibeswap.fly.dev/router/status${NC}"
echo -e "  ${CYAN}Health:  curl -s https://jarvis-vibeswap.fly.dev/health | jq${NC}"
