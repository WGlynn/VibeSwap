#!/bin/bash
# ============ VibeSwap Sepolia Deployment — Saturday Go-Live ============
#
# One-shot deployment script for Sepolia testnet.
# Deploys all contracts, verifies, and outputs frontend config.
#
# Prerequisites:
#   1. Set PRIVATE_KEY in .env (with Sepolia ETH)
#   2. Set SEPOLIA_RPC_URL in .env (Alchemy/Infura)
#   3. Optionally set ETHERSCAN_API_KEY for verification
#
# Usage:
#   chmod +x script/deploy-sepolia.sh
#   ./script/deploy-sepolia.sh
#
# Output:
#   - Contract addresses in console
#   - frontend/.env.sepolia with all addresses
#   - deployments/sepolia-<timestamp>.json artifact

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FORGE="${HOME}/.foundry/bin/forge"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEPLOY_DIR="${PROJECT_DIR}/deployments"

echo ""
echo "============================================"
echo "   VibeSwap Sepolia Deployment"
echo "   $(date)"
echo "============================================"
echo ""

# ============ Preflight Checks ============

# Check forge exists
if [ ! -f "$FORGE" ]; then
    echo "ERROR: forge not found at $FORGE"
    echo "Install: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    exit 1
fi

# Check .env exists
if [ ! -f "${PROJECT_DIR}/.env" ]; then
    echo "ERROR: .env file not found"
    echo "Copy .env to project root and set PRIVATE_KEY + SEPOLIA_RPC_URL"
    exit 1
fi

# Source .env
set -a
source "${PROJECT_DIR}/.env"
set +a

# Validate required vars
if [ -z "$PRIVATE_KEY" ]; then
    echo "ERROR: PRIVATE_KEY not set in .env"
    exit 1
fi

if [ -z "$SEPOLIA_RPC_URL" ] || [ "$SEPOLIA_RPC_URL" = "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" ]; then
    echo "ERROR: SEPOLIA_RPC_URL not set (or still placeholder)"
    exit 1
fi

echo "Preflight checks passed."
echo "  RPC: ${SEPOLIA_RPC_URL:0:40}..."
echo ""

# ============ Step 1: Compile ============

echo "Step 1: Compiling contracts..."
cd "$PROJECT_DIR"
$FORGE build --quiet
echo "  Compilation successful."
echo ""

# ============ Step 2: Deploy ============

echo "Step 2: Deploying to Sepolia..."
echo "  This will broadcast transactions and cost ETH."
echo ""

# Run deployment, capture output
DEPLOY_OUTPUT=$($FORGE script script/DeployProduction.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    --slow \
    -vvv 2>&1) || {
    echo "DEPLOYMENT FAILED!"
    echo "$DEPLOY_OUTPUT"
    exit 1
}

echo "$DEPLOY_OUTPUT"

# ============ Step 3: Extract Addresses ============

echo ""
echo "Step 3: Extracting deployed addresses..."

# Parse addresses from forge output
CORE=$(echo "$DEPLOY_OUTPUT" | grep "VIBESWAP_CORE=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
AUCTION=$(echo "$DEPLOY_OUTPUT" | grep "VIBESWAP_AUCTION=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
AMM=$(echo "$DEPLOY_OUTPUT" | grep "VIBESWAP_AMM=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
TREASURY=$(echo "$DEPLOY_OUTPUT" | grep "VIBESWAP_TREASURY=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
ROUTER=$(echo "$DEPLOY_OUTPUT" | grep "VIBESWAP_ROUTER=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
ORACLE=$(echo "$DEPLOY_OUTPUT" | grep "TRUE_PRICE_ORACLE_ADDRESS=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
REGISTRY=$(echo "$DEPLOY_OUTPUT" | grep "STABLECOIN_REGISTRY_ADDRESS=" | grep -oP '0x[a-fA-F0-9]{40}' | head -1)

# Validate we got addresses
if [ -z "$CORE" ] || [ -z "$AUCTION" ] || [ -z "$AMM" ]; then
    echo "WARNING: Could not auto-extract all addresses from output."
    echo "Check the deployment output above and manually extract addresses."
    echo ""
    echo "If addresses are visible above, you can manually create frontend/.env.sepolia"
    echo "using the template at frontend/.env.example"
fi

echo "  VibeSwapCore:  $CORE"
echo "  Auction:       $AUCTION"
echo "  AMM:           $AMM"
echo "  Treasury:      $TREASURY"
echo "  Router:        $ROUTER"
echo "  Oracle:        $ORACLE"
echo "  Registry:      $REGISTRY"

# ============ Step 4: Save Artifacts ============

echo ""
echo "Step 4: Saving deployment artifacts..."

mkdir -p "$DEPLOY_DIR"

# Save JSON artifact
cat > "${DEPLOY_DIR}/sepolia-${TIMESTAMP}.json" << ARTIFACT
{
  "network": "sepolia",
  "chainId": 11155111,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contracts": {
    "vibeSwapCore": "${CORE}",
    "auction": "${AUCTION}",
    "amm": "${AMM}",
    "treasury": "${TREASURY}",
    "router": "${ROUTER}",
    "truePriceOracle": "${ORACLE}",
    "stablecoinRegistry": "${REGISTRY}"
  }
}
ARTIFACT

echo "  Saved: deployments/sepolia-${TIMESTAMP}.json"

# ============ Step 5: Generate Frontend .env ============

echo ""
echo "Step 5: Generating frontend config..."

cat > "${PROJECT_DIR}/frontend/.env.sepolia" << ENVFILE
# VibeSwap Sepolia Testnet — Auto-generated $(date)
# Copy to frontend/.env to activate

VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id

# Sepolia RPC
VITE_SEPOLIA_RPC_URL=${SEPOLIA_RPC_URL}

# Deployed contract addresses (Sepolia — chain ID 11155111)
VITE_SEPOLIA_VIBESWAP_CORE=${CORE}
VITE_SEPOLIA_VIBE_AMM=${AMM}
VITE_SEPOLIA_AUCTION=${AUCTION}
VITE_SEPOLIA_TREASURY=${TREASURY}
VITE_SEPOLIA_ROUTER=${ROUTER}

# Feature flags
VITE_PRODUCTION_MODE=true
VITE_ENABLE_MAINNET=false
VITE_DISABLE_TESTNETS=false
ENVFILE

echo "  Saved: frontend/.env.sepolia"
echo ""
echo "  To activate: cp frontend/.env.sepolia frontend/.env"

# ============ Step 6: Update constants.js testnet addresses ============

echo ""
echo "Step 6: Updating frontend constants..."

if [ -n "$CORE" ] && [ -n "$AUCTION" ] && [ -n "$AMM" ] && [ -n "$TREASURY" ] && [ -n "$ROUTER" ]; then
    # Patch the Sepolia section in constants.js
    sed -i.bak \
        -e "/11155111: {/,/}/s|vibeSwapCore: '0x0*'|vibeSwapCore: '${CORE}'|" \
        -e "/11155111: {/,/}/s|auction: '0x0*'|auction: '${AUCTION}'|" \
        -e "/11155111: {/,/}/s|amm: '0x0*'|amm: '${AMM}'|" \
        -e "/11155111: {/,/}/s|treasury: '0x0*'|treasury: '${TREASURY}'|" \
        -e "/11155111: {/,/}/s|router: '0x0*'|router: '${ROUTER}'|" \
        "${PROJECT_DIR}/frontend/src/utils/constants.js"
    echo "  Updated Sepolia addresses in constants.js"
    echo "  Backup: constants.js.bak"
else
    echo "  SKIPPED: Could not extract all addresses."
    echo "  Manually update frontend/src/utils/constants.js with deployed addresses."
fi

# ============ Step 7: Verify (optional) ============

if [ -n "$ETHERSCAN_API_KEY" ]; then
    echo ""
    echo "Step 7: Verifying contracts on Etherscan..."
    $FORGE verify-contract "$CORE" VibeSwapCore \
        --chain-id 11155111 \
        --etherscan-api-key "$ETHERSCAN_API_KEY" \
        --watch 2>/dev/null || echo "  Core verification submitted (may take a few minutes)"
    echo "  Note: Proxy verification may need manual setup on Etherscan"
else
    echo ""
    echo "Step 7: SKIPPED — Set ETHERSCAN_API_KEY in .env for auto-verification"
fi

# ============ Done ============

echo ""
echo "============================================"
echo "   DEPLOYMENT COMPLETE"
echo "============================================"
echo ""
echo "Deployed addresses:"
echo "  VibeSwapCore:           ${CORE}"
echo "  CommitRevealAuction:    ${AUCTION}"
echo "  VibeAMM:                ${AMM}"
echo "  DAOTreasury:            ${TREASURY}"
echo "  CrossChainRouter:       ${ROUTER}"
echo "  TruePriceOracle:        ${ORACLE}"
echo "  StablecoinFlowRegistry: ${REGISTRY}"
echo ""
echo "Artifacts:"
echo "  deployments/sepolia-${TIMESTAMP}.json"
echo "  frontend/.env.sepolia"
echo ""
echo "Next steps:"
echo "  1. cp frontend/.env.sepolia frontend/.env"
echo "  2. cd frontend && npm run build && npx vercel --prod"
echo "  3. Test at https://frontend-jade-five-87.vercel.app"
echo ""
echo "Explorer: https://sepolia.etherscan.io/address/${CORE}"
echo ""
