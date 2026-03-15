#!/bin/bash
# ============================================================
# Safe Deploy — Disposable deployer key, zero residual exposure
# ============================================================
#
# Every deploy uses a FRESH wallet:
#   1. Generate new deployer wallet
#   2. Show address — you fund it with exact gas needed
#   3. Run the forge deploy script
#   4. Show remaining balance — drain it back to cold wallet
#   5. Key is burned — never reused
#
# The deployer is an ignition key, not a vault.
# No key persists between deploys. No funds sit idle.
#
# Usage:
#   ./script/safe-deploy.sh Deploy.s.sol                    # Base mainnet
#   ./script/safe-deploy.sh DeployTokenomics.s.sol sepolia  # Testnet
#   ./script/safe-deploy.sh Deploy.s.sol base --verify      # With verification
#
# Prerequisites:
#   - foundry (forge) installed
#   - node.js + ethers available (via frontend/node_modules)
#   - RPC URLs set in .env (BASE_RPC_URL, SEPOLIA_RPC_URL)
# ============================================================

set -euo pipefail

SCRIPT="${1:?Usage: safe-deploy.sh <Script.s.sol> [network] [--verify]}"
NETWORK="${2:-base}"
VERIFY="${3:-}"
ENV_FILE=".env"
COLD_WALLET_FILE=".cold-wallet"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}VIBESWAP SAFE DEPLOY${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ============ Step 0: Load cold wallet address ============
if [ -f "$COLD_WALLET_FILE" ]; then
  COLD_WALLET=$(cat "$COLD_WALLET_FILE" | tr -d '[:space:]')
  echo -e "${GREEN}Cold wallet:${NC} $COLD_WALLET"
else
  echo -e "${YELLOW}No cold wallet configured.${NC}"
  echo -e "Enter your cold wallet address (for returning leftover gas):"
  read -r COLD_WALLET
  if [[ "$COLD_WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "$COLD_WALLET" > "$COLD_WALLET_FILE"
    echo -e "${GREEN}Saved to ${COLD_WALLET_FILE}${NC}"
  else
    echo -e "${RED}Invalid address. Continuing without cold wallet.${NC}"
    COLD_WALLET=""
  fi
fi
echo ""

# ============ Step 1: Generate fresh deployer ============
echo -e "${CYAN}[1/5] Generating fresh deployer wallet...${NC}"

WALLET_JSON=$(cd frontend && node -e "
const { ethers } = require('ethers');
const w = ethers.Wallet.createRandom();
console.log(JSON.stringify({
  address: w.address,
  privateKey: w.privateKey,
  mnemonic: w.mnemonic.phrase
}));
")

DEPLOY_ADDRESS=$(echo "$WALLET_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).address)" 2>/dev/null || echo "$WALLET_JSON" | grep -o '"address":"[^"]*"' | cut -d'"' -f4)
DEPLOY_KEY=$(echo "$WALLET_JSON" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)
DEPLOY_MNEMONIC=$(echo "$WALLET_JSON" | grep -o '"mnemonic":"[^"]*"' | cut -d'"' -f4)

echo -e "${GREEN}Deployer address:${NC} $DEPLOY_ADDRESS"
echo -e "${YELLOW}Mnemonic (write down offline, then clear terminal):${NC}"
echo -e "  $DEPLOY_MNEMONIC"
echo ""

# ============ Step 2: Determine RPC URL ============
source "$ENV_FILE" 2>/dev/null || true

case "$NETWORK" in
  base|mainnet)
    RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
    CHAIN_NAME="Base Mainnet"
    VERIFY_FLAG=""
    if [ "$VERIFY" = "--verify" ]; then
      VERIFY_FLAG="--verify --etherscan-api-key ${BASESCAN_API_KEY:-}"
    fi
    ;;
  sepolia)
    RPC_URL="${SEPOLIA_RPC_URL:-https://eth-sepolia.g.alchemy.com/v2/demo}"
    CHAIN_NAME="Sepolia Testnet"
    VERIFY_FLAG=""
    ;;
  *)
    echo -e "${RED}Unknown network: $NETWORK${NC}"
    exit 1
    ;;
esac

echo -e "${CYAN}[2/5] Network: ${CHAIN_NAME}${NC}"
echo -e "  RPC: $RPC_URL"
echo ""

# ============ Step 3: Wait for funding ============
echo -e "${YELLOW}[3/5] Fund the deployer with EXACT gas needed:${NC}"
echo -e "  ${GREEN}Address: $DEPLOY_ADDRESS${NC}"
echo -e "  Network: $CHAIN_NAME"
echo ""
echo -e "  Typical gas costs:"
echo -e "    Single contract:  ~0.001 ETH"
echo -e "    Full suite:       ~0.01 ETH"
echo -e "    With verification: ~0.015 ETH"
echo ""

while true; do
  read -p "Press Enter once funded (or 'q' to abort)... " -r input
  if [ "$input" = "q" ]; then
    echo -e "${RED}Aborted. Key discarded.${NC}"
    exit 1
  fi

  # Check balance
  BALANCE=$(cd frontend && node -e "
const { ethers } = require('ethers');
const p = new ethers.JsonRpcProvider('$RPC_URL');
p.getBalance('$DEPLOY_ADDRESS').then(b => console.log(ethers.formatEther(b)));
" 2>/dev/null || echo "0")

  echo -e "  Balance: ${GREEN}$BALANCE ETH${NC}"

  if [ "$BALANCE" != "0" ] && [ "$BALANCE" != "0.0" ]; then
    break
  fi
  echo -e "  ${YELLOW}No balance detected. Fund and try again.${NC}"
done

echo ""

# ============ Step 4: Deploy ============
echo -e "${CYAN}[4/5] Deploying ${SCRIPT} to ${CHAIN_NAME}...${NC}"
echo ""

# Write temporary private key to env (will be overwritten after)
ORIGINAL_KEY=$(grep "^PRIVATE_KEY=" "$ENV_FILE" | cut -d= -f2 || echo "")
sed -i "s|^PRIVATE_KEY=.*|PRIVATE_KEY=$DEPLOY_KEY|" "$ENV_FILE"

# Run forge deploy
DEPLOY_CMD="forge script script/${SCRIPT} --rpc-url $RPC_URL --broadcast ${VERIFY_FLAG}"
echo -e "  $ $DEPLOY_CMD"
echo ""

if eval "$DEPLOY_CMD"; then
  echo ""
  echo -e "${GREEN}Deploy successful!${NC}"
else
  echo ""
  echo -e "${RED}Deploy FAILED. Check output above.${NC}"
fi

# ============ Step 5: Cleanup ============
echo ""
echo -e "${CYAN}[5/5] Cleanup — drain remaining gas${NC}"

# Check remaining balance
REMAINING=$(cd frontend && node -e "
const { ethers } = require('ethers');
const p = new ethers.JsonRpcProvider('$RPC_URL');
p.getBalance('$DEPLOY_ADDRESS').then(b => console.log(ethers.formatEther(b)));
" 2>/dev/null || echo "0")

echo -e "  Remaining balance: ${YELLOW}$REMAINING ETH${NC}"

if [ -n "$COLD_WALLET" ] && [ "$REMAINING" != "0" ] && [ "$REMAINING" != "0.0" ]; then
  echo ""
  echo -e "  ${YELLOW}Drain remaining gas to cold wallet?${NC}"
  echo -e "  From: $DEPLOY_ADDRESS"
  echo -e "  To:   $COLD_WALLET"
  read -p "  Drain? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd frontend && node -e "
const { ethers } = require('ethers');
async function drain() {
  const p = new ethers.JsonRpcProvider('$RPC_URL');
  const w = new ethers.Wallet('$DEPLOY_KEY', p);
  const balance = await p.getBalance('$DEPLOY_ADDRESS');
  const gasPrice = (await p.getFeeData()).gasPrice;
  const gasLimit = 21000n;
  const gasCost = gasPrice * gasLimit;
  const sendAmount = balance - gasCost;
  if (sendAmount <= 0n) { console.log('Balance too low to drain'); return; }
  const tx = await w.sendTransaction({ to: '$COLD_WALLET', value: sendAmount, gasLimit });
  console.log('Drain tx:', tx.hash);
  await tx.wait();
  console.log('Drained successfully');
}
drain().catch(e => console.error('Drain failed:', e.message));
" 2>/dev/null
  fi
fi

# Restore original key or clear it
if [ -n "$ORIGINAL_KEY" ]; then
  sed -i "s|^PRIVATE_KEY=.*|PRIVATE_KEY=$ORIGINAL_KEY|" "$ENV_FILE"
else
  sed -i "s|^PRIVATE_KEY=.*|PRIVATE_KEY=|" "$ENV_FILE"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}DEPLOY COMPLETE${NC}"
echo -e "${GREEN}============================================${NC}"
echo -e "  Deployer: $DEPLOY_ADDRESS"
echo -e "  Network:  $CHAIN_NAME"
echo -e "  Script:   $SCRIPT"
echo -e "  Key status: ${GREEN}DISCARDED${NC} (not saved anywhere)"
echo -e ""
echo -e "  ${YELLOW}The deployer key is gone. This is correct.${NC}"
echo -e "  ${YELLOW}If you need to upgrade, run safe-deploy.sh again.${NC}"
echo -e "${GREEN}============================================${NC}"
