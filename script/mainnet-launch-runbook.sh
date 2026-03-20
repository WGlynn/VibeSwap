#!/bin/bash
# ============ VibeSwap Mainnet Launch Runbook ============
#
# Prerequisites:
#   - 0.01 ETH on Base in deployer wallet: 0x095C0075068791E7FD0A2b2A578f387326B4e8cc
#   - .env has PRIVATE_KEY, BASE_RPC_URL, BASESCAN_API_KEY
#
# Already deployed (Base mainnet):
#   VIBE_TOKEN=0x56C35BA2c026F7a4ADBe48d55b44652f959279ae
#   SHAPLEY_DISTRIBUTOR=0x290bC683F242761D513078451154F6BbE1EE18B1
#   EMISSION_CONTROLLER=0xCdB73048A67F0dE31777E6966Cd92FAaCDb0Fc55
#
# This script executes in order:
#   1. Call drip() — mints ~467K accrued VIBE
#   2. Deploy identity layer (SoulboundIdentity, ContributionDAG, etc.)
#   3. Wire authorizations
#   4. Create first contribution game
#   5. Verify everything
#
# Run: ./script/mainnet-launch-runbook.sh
# ============

set -e  # Exit on any error

FORGE="${FORGE:-forge}"
CAST="${CAST:-cast}"

# Try to find binaries
if command -v /c/Users/Will/.foundry/bin/forge &>/dev/null; then
  FORGE="/c/Users/Will/.foundry/bin/forge"
  CAST="/c/Users/Will/.foundry/bin/cast"
fi

# Load env
source .env

echo "============================================"
echo "  VibeSwap Mainnet Launch Runbook"
echo "============================================"
echo ""
echo "Deployer: $(${CAST} wallet address --private-key $PRIVATE_KEY 2>/dev/null)"
echo "Chain: Base Mainnet"
echo ""

# ============ Step 0: Pre-flight checks ============
echo "Step 0: Pre-flight checks..."

DEPLOYER=$(${CAST} wallet address --private-key $PRIVATE_KEY 2>/dev/null)
BALANCE=$(${CAST} balance $DEPLOYER --rpc-url $BASE_RPC_URL 2>/dev/null)
echo "  Deployer balance: $BALANCE wei"

if [ "$BALANCE" = "0" ]; then
  echo "  ERROR: Deployer has 0 ETH. Fund $DEPLOYER with at least 0.01 ETH on Base."
  exit 1
fi

echo "  VIBE_TOKEN: $VIBE_TOKEN"
echo "  EMISSION_CONTROLLER: $EMISSION_CONTROLLER"
echo "  SHAPLEY_DISTRIBUTOR: $SHAPLEY_DISTRIBUTOR"
echo "  Pre-flight OK"
echo ""

# ============ Step 1: Call drip() ============
echo "Step 1: Calling EmissionController.drip() — minting accrued VIBE..."

${CAST} send $EMISSION_CONTROLLER "drip()" \
  --private-key $PRIVATE_KEY \
  --rpc-url $BASE_RPC_URL

echo "  drip() called. Checking emission state..."

EMISSION_INFO=$(${CAST} call $EMISSION_CONTROLLER \
  "getEmissionInfo()(uint256,uint256,uint256,uint256,uint256,uint256)" \
  --rpc-url $BASE_RPC_URL 2>/dev/null)

echo "  Emission info: $EMISSION_INFO"
echo "  Step 1 DONE"
echo ""

# ============ Step 2: Deploy Identity Layer ============
echo "Step 2: Deploying identity layer..."

${FORGE} script script/DeployIdentity.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --verify \
  -vvv

echo "  Step 2 DONE — check output above for contract addresses"
echo "  UPDATE .env with the new addresses before continuing"
echo ""
echo "  Press Enter after updating .env with identity addresses..."
read -r

# Reload env with new addresses
source .env

# ============ Step 3: Wire Authorizations ============
echo "Step 3: Wiring authorizations..."

# Authorize Jarvis bot wallet as drainer on EmissionController
# (so reward-batcher can create contribution games)
JARVIS_WALLET="0x51Ec19638455b1eA2fCf299e17cb9862FE0b12A4"

echo "  Authorizing Jarvis bot wallet ($JARVIS_WALLET) as drainer..."
${CAST} send $EMISSION_CONTROLLER \
  "setAuthorizedDrainer(address,bool)" $JARVIS_WALLET true \
  --private-key $PRIVATE_KEY \
  --rpc-url $BASE_RPC_URL

echo "  Authorizations wired"
echo "  Step 3 DONE"
echo ""

# ============ Step 4: First Contribution Game ============
echo "Step 4: Creating first contribution game..."
echo "  This is a symbolic first game — the genesis contribution."
echo "  Future games are created automatically by reward-batcher."
echo ""

# Call drip() again to ensure pool has VIBE
${CAST} send $EMISSION_CONTROLLER "drip()" \
  --private-key $PRIVATE_KEY \
  --rpc-url $BASE_RPC_URL

echo "  Pool topped up. First game will be created by the TG bot's"
echo "  /batch_rewards command when community members have linked wallets."
echo "  Step 4 DONE"
echo ""

# ============ Step 5: Verification ============
echo "Step 5: Verification..."

echo "  VIBE total supply:"
${CAST} call $VIBE_TOKEN "totalSupply()(uint256)" --rpc-url $BASE_RPC_URL

echo "  VIBE in EmissionController:"
${CAST} call $VIBE_TOKEN "balanceOf(address)(uint256)" $EMISSION_CONTROLLER --rpc-url $BASE_RPC_URL

echo "  VIBE in ShapleyDistributor:"
${CAST} call $VIBE_TOKEN "balanceOf(address)(uint256)" $SHAPLEY_DISTRIBUTOR --rpc-url $BASE_RPC_URL

echo "  Jarvis is authorized drainer:"
${CAST} call $EMISSION_CONTROLLER "authorizedDrainers(address)(bool)" $JARVIS_WALLET --rpc-url $BASE_RPC_URL

echo ""
echo "============================================"
echo "  LAUNCH COMPLETE"
echo "============================================"
echo ""
echo "  VIBE tokens are flowing."
echo "  Identity layer is deployed."
echo "  Jarvis can create contribution games."
echo ""
echo "  Next:"
echo "  1. Community members /linkwallet 0xAddr in TG"
echo "  2. Will runs /batch_rewards to create first game"
echo "  3. Community claims VIBE via ShapleyDistributor"
echo ""
echo "  The Gilded Age ends here."
echo "============================================"
