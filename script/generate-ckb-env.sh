#!/bin/bash
# ============================================
# Generate CKB Frontend Environment Variables
# ============================================
# Reads ckb/deploy.json and outputs VITE_CKB_* variables
# for the frontend .env file.
#
# Usage:
#   ./script/generate-ckb-env.sh                    # Print to stdout
#   ./script/generate-ckb-env.sh >> frontend/.env    # Append to .env

set -euo pipefail

DEPLOY_JSON="${1:-ckb/deploy.json}"
NETWORK="${2:-devnet}"

if [ ! -f "$DEPLOY_JSON" ]; then
    echo "Error: $DEPLOY_JSON not found. Run 'make deploy-info' in ckb/ first." >&2
    exit 1
fi

# Use Node.js to parse JSON (guaranteed available since we use npm/vite)
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$DEPLOY_JSON', 'utf8'));
const network = '$NETWORK';

console.log('# ============================================');
console.log('# CKB Configuration (auto-generated from deploy.json)');
console.log('# Network: ' + network);
console.log('# Generated: ' + new Date().toISOString());
console.log('# ============================================');
console.log('');

// RPC URLs
if (network === 'mainnet') {
    console.log('VITE_CKB_RPC_URL=https://mainnet.ckbapp.dev/rpc');
    console.log('VITE_CKB_INDEXER_URL=https://mainnet.ckbapp.dev/indexer');
} else if (network === 'testnet') {
    console.log('VITE_CKB_TESTNET_RPC_URL=https://testnet.ckbapp.dev/rpc');
    console.log('VITE_CKB_TESTNET_INDEXER_URL=https://testnet.ckbapp.dev/indexer');
} else {
    console.log('VITE_CKB_RPC_URL=http://localhost:8114');
    console.log('VITE_CKB_INDEXER_URL=http://localhost:8116');
}
console.log('');

// Script code hashes
const scriptMap = {
    'pow-lock': 'VITE_CKB_POW_LOCK_CODE_HASH',
    'batch-auction-type': 'VITE_CKB_BATCH_AUCTION_CODE_HASH',
    'commit-type': 'VITE_CKB_COMMIT_TYPE_CODE_HASH',
    'amm-pool-type': 'VITE_CKB_AMM_POOL_CODE_HASH',
    'lp-position-type': 'VITE_CKB_LP_POSITION_CODE_HASH',
    'compliance-type': 'VITE_CKB_COMPLIANCE_CODE_HASH',
    'config-type': 'VITE_CKB_CONFIG_CODE_HASH',
    'oracle-type': 'VITE_CKB_ORACLE_CODE_HASH',
};

for (const [scriptName, envVar] of Object.entries(scriptMap)) {
    const hash = data.scripts?.[scriptName]?.code_hash;
    if (hash) {
        console.log(envVar + '=' + hash);
    } else {
        console.log('# ' + envVar + '= (not found)');
    }
}

console.log('');
console.log('# Token type hashes (fill after xUDT deployment)');
console.log('VITE_CKB_DCKB_TYPE_HASH=');
"
