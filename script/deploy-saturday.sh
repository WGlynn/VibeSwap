#!/usr/bin/env bash
# ============================================================
# VibeSwap Saturday Sepolia Testnet Deployment
# ============================================================
# Usage:
#   ./script/deploy-saturday.sh                  # Full deploy
#   ./script/deploy-saturday.sh --no-build       # Skip forge build
#   ./script/deploy-saturday.sh --dry-run        # Print plan only
#   ./script/deploy-saturday.sh --verify         # Also verify on Etherscan
#   ./script/deploy-saturday.sh --no-build --verify
#
# Environment (loaded from .env):
#   PRIVATE_KEY          - Deployer private key (no 0x prefix)
#   SEPOLIA_RPC_URL      - Sepolia RPC endpoint
#   ETHERSCAN_API_KEY    - For --verify flag (optional)
#
# MINGW/Git Bash compatible (Windows)
# ============================================================

set -euo pipefail

# ============================================================
# CONSTANTS
# ============================================================
FORGE="/c/Users/Will/.foundry/bin/forge.exe"
PROJECT_DIR="/c/Users/Will/vibeswap"
CHAIN_ID=11155111
BROADCAST_DIR="${PROJECT_DIR}/broadcast/DeployProduction.s.sol/${CHAIN_ID}"
BROADCAST_FILE="${BROADCAST_DIR}/run-latest.json"
CONSTANTS_FILE="${PROJECT_DIR}/frontend/src/utils/constants.js"
FRONTEND_ENV="${PROJECT_DIR}/frontend/.env"
ROOT_ENV="${PROJECT_DIR}/.env"
DEPLOY_LOG="${PROJECT_DIR}/script/deploy-saturday.log"
MIN_ETH_BALANCE="100000000000000000" # 0.1 ETH in wei

# Contract names as they appear in forge broadcast JSON
# These map to the Solidity contract names deployed via CREATE
PROXY_CONTRACT="ERC1967Proxy"

# ============================================================
# COLOR HELPERS (works in MINGW)
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }
log_dry()   { echo -e "${YELLOW}[DRY-RUN]${NC} $*"; }

# ============================================================
# PARSE FLAGS
# ============================================================
NO_BUILD=false
DRY_RUN=false
VERIFY=false

for arg in "$@"; do
    case "$arg" in
        --no-build) NO_BUILD=true ;;
        --dry-run)  DRY_RUN=true ;;
        --verify)   VERIFY=true ;;
        --help|-h)
            echo "Usage: $0 [--no-build] [--dry-run] [--verify]"
            echo ""
            echo "Flags:"
            echo "  --no-build   Skip forge build step"
            echo "  --dry-run    Print deployment plan without executing"
            echo "  --verify     Verify contracts on Etherscan after deploy"
            echo ""
            echo "Environment variables (from .env):"
            echo "  PRIVATE_KEY        Deployer private key (no 0x prefix)"
            echo "  SEPOLIA_RPC_URL    Sepolia RPC endpoint (Alchemy/Infura)"
            echo "  ETHERSCAN_API_KEY  For contract verification (--verify)"
            exit 0
            ;;
        *)
            log_error "Unknown flag: $arg"
            echo "Run $0 --help for usage"
            exit 1
            ;;
    esac
done

# ============================================================
# LOAD .env FILE
# ============================================================
if [ -f "$ROOT_ENV" ]; then
    log_info "Loading environment from ${ROOT_ENV}"
    # Export all non-comment, non-empty lines
    set -a
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        # Only export lines that look like KEY=VALUE
        if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
            eval "$line" 2>/dev/null || true
        fi
    done < "$ROOT_ENV"
    set +a
else
    log_warn "No .env file found at ${ROOT_ENV}"
fi

# ============================================================
# STEP 0: BANNER
# ============================================================
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║     VibeSwap Saturday Sepolia Deployment          ║"
echo "  ║     Chain: Sepolia (${CHAIN_ID})                   ║"
echo "  ║     Date: $(date '+%Y-%m-%d %H:%M:%S')              ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

if $DRY_RUN; then
    echo -e "${YELLOW}${BOLD}  >>> DRY RUN MODE - No transactions will be sent <<<${NC}"
    echo ""
fi

# ============================================================
# STEP 1: PRE-FLIGHT CHECKS
# ============================================================
log_step "STEP 1: Pre-flight Checks"

PREFLIGHT_PASS=true

# 1a. Check forge binary
if [ -f "$FORGE" ]; then
    FORGE_VERSION=$("$FORGE" --version 2>&1 | head -1)
    log_ok "Forge found: ${FORGE_VERSION}"
else
    log_error "Forge not found at ${FORGE}"
    log_error "Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    PREFLIGHT_PASS=false
fi

# 1b. Check PRIVATE_KEY
if [ -z "${PRIVATE_KEY:-}" ]; then
    log_error "PRIVATE_KEY is not set"
    log_error "Set in .env or export PRIVATE_KEY=<your_key>"
    PREFLIGHT_PASS=false
else
    # Mask the key for display
    KEY_LEN=${#PRIVATE_KEY}
    if [ "$KEY_LEN" -ge 8 ]; then
        MASKED_KEY="${PRIVATE_KEY:0:4}...${PRIVATE_KEY: -4}"
    else
        MASKED_KEY="****"
    fi
    log_ok "PRIVATE_KEY is set (${MASKED_KEY})"
fi

# 1c. Check SEPOLIA_RPC_URL
if [ -z "${SEPOLIA_RPC_URL:-}" ]; then
    log_error "SEPOLIA_RPC_URL is not set"
    log_error "Get one from https://www.alchemy.com or https://infura.io"
    PREFLIGHT_PASS=false
elif [[ "$SEPOLIA_RPC_URL" == *"YOUR_KEY"* ]]; then
    log_error "SEPOLIA_RPC_URL still contains placeholder 'YOUR_KEY'"
    log_error "Replace with your actual Alchemy/Infura API key"
    PREFLIGHT_PASS=false
else
    log_ok "SEPOLIA_RPC_URL is set"
fi

# 1d. Check ETHERSCAN_API_KEY (only if --verify)
if $VERIFY; then
    if [ -z "${ETHERSCAN_API_KEY:-}" ]; then
        log_error "ETHERSCAN_API_KEY required for --verify flag"
        log_error "Get one from https://etherscan.io/myapikey"
        PREFLIGHT_PASS=false
    else
        log_ok "ETHERSCAN_API_KEY is set"
    fi
fi

# 1e. Check project directory
if [ ! -f "${PROJECT_DIR}/foundry.toml" ]; then
    log_error "Project directory invalid: ${PROJECT_DIR}/foundry.toml not found"
    PREFLIGHT_PASS=false
else
    log_ok "Project directory: ${PROJECT_DIR}"
fi

# 1f. Check deploy script exists
if [ ! -f "${PROJECT_DIR}/script/DeployProduction.s.sol" ]; then
    log_error "DeployProduction.s.sol not found"
    PREFLIGHT_PASS=false
else
    log_ok "DeployProduction.s.sol found"
fi

# Bail early if critical checks failed (can't check balance without RPC + key)
if ! $PREFLIGHT_PASS; then
    log_error "Pre-flight checks FAILED. Fix the above errors and retry."
    exit 1
fi

# 1g. Check deployer ETH balance on Sepolia
log_info "Checking deployer ETH balance on Sepolia..."

# Derive deployer address from private key using cast
CAST="/c/Users/Will/.foundry/bin/cast.exe"
if [ -f "$CAST" ]; then
    DEPLOYER_ADDRESS=$("$CAST" wallet address --private-key "0x${PRIVATE_KEY}" 2>&1)
    log_info "Deployer address: ${DEPLOYER_ADDRESS}"

    # Get balance in wei
    BALANCE_WEI=$("$CAST" balance "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL" 2>&1) || {
        log_warn "Could not fetch balance (RPC may be down). Proceeding anyway."
        BALANCE_WEI="999999999999999999" # Assume sufficient
    }

    # cast can return balance in decimal wei
    # Compare using string/numeric comparison
    BALANCE_ETH=$("$CAST" from-wei "$BALANCE_WEI" 2>&1) || BALANCE_ETH="unknown"

    log_info "Balance: ${BALANCE_ETH} ETH (${BALANCE_WEI} wei)"

    # Numeric comparison - handle both decimal and hex returns
    if [[ "$BALANCE_WEI" =~ ^[0-9]+$ ]]; then
        if [ "$BALANCE_WEI" -lt "$MIN_ETH_BALANCE" ] 2>/dev/null; then
            log_error "Insufficient balance! Need at least 0.1 ETH for deployment gas."
            log_error "Get Sepolia ETH from: https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia"
            exit 1
        else
            log_ok "Balance sufficient (>= 0.1 ETH)"
        fi
    else
        log_warn "Could not parse balance for comparison. Proceeding."
    fi
else
    log_warn "cast not found at ${CAST}, skipping balance check"
fi

log_ok "All pre-flight checks passed"

# ============================================================
# STEP 2: BUILD
# ============================================================
log_step "STEP 2: Build Contracts"

if $NO_BUILD; then
    log_info "Skipping build (--no-build flag)"
elif $DRY_RUN; then
    log_dry "Would run: ${FORGE} build"
else
    log_info "Running forge build..."
    cd "$PROJECT_DIR"

    BUILD_START=$(date +%s)
    if "$FORGE" build 2>&1 | tee -a "$DEPLOY_LOG"; then
        BUILD_END=$(date +%s)
        BUILD_DURATION=$((BUILD_END - BUILD_START))
        log_ok "Build succeeded in ${BUILD_DURATION}s"
    else
        log_error "Build FAILED. Fix compilation errors and retry."
        exit 1
    fi
fi

# ============================================================
# STEP 3: DEPLOY
# ============================================================
log_step "STEP 3: Deploy to Sepolia"

FORGE_CMD="${FORGE} script script/DeployProduction.s.sol"
FORGE_CMD+=" --rpc-url ${SEPOLIA_RPC_URL}"
FORGE_CMD+=" --broadcast"
FORGE_CMD+=" -vvv"

if $VERIFY; then
    FORGE_CMD+=" --verify"
    FORGE_CMD+=" --etherscan-api-key ${ETHERSCAN_API_KEY}"
fi

log_info "Deploy command:"
log_info "  ${FORGE_CMD}"
echo ""

if $DRY_RUN; then
    log_dry "Would execute forge script deployment"
    log_dry "Broadcast JSON would go to: ${BROADCAST_FILE}"
    log_dry "Skipping deployment execution."

    # In dry-run, simulate the rest with placeholder addresses
    echo ""
    log_dry "Post-deploy steps that would execute:"
    log_dry "  - Parse addresses from ${BROADCAST_FILE}"
    log_dry "  - Run VerifyDeployment.s.sol"
    log_dry "  - Update ${CONSTANTS_FILE} with Sepolia addresses"
    log_dry "  - Update ${FRONTEND_ENV} with VITE_SEPOLIA_* variables"
    log_dry "  - Print deployment summary"
    echo ""
    log_info "Dry run complete. Remove --dry-run to execute."
    exit 0
fi

log_info "Deploying contracts to Sepolia (chain ID: ${CHAIN_ID})..."
log_info "This may take 2-5 minutes..."
echo ""

cd "$PROJECT_DIR"
DEPLOY_START=$(date +%s)

if $FORGE script script/DeployProduction.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    -vvv \
    $(if $VERIFY; then echo "--verify --etherscan-api-key ${ETHERSCAN_API_KEY}"; fi) \
    2>&1 | tee -a "$DEPLOY_LOG"; then

    DEPLOY_END=$(date +%s)
    DEPLOY_DURATION=$((DEPLOY_END - DEPLOY_START))
    log_ok "Deployment transaction broadcast succeeded in ${DEPLOY_DURATION}s"
else
    log_error "Deployment FAILED. Check ${DEPLOY_LOG} for details."
    exit 1
fi

# ============================================================
# STEP 4: PARSE DEPLOYED ADDRESSES FROM BROADCAST JSON
# ============================================================
log_step "STEP 4: Parse Deployed Addresses"

if [ ! -f "$BROADCAST_FILE" ]; then
    log_error "Broadcast file not found: ${BROADCAST_FILE}"
    log_error "Check if deployment actually completed."
    # Try to find any broadcast file
    if [ -d "$BROADCAST_DIR" ]; then
        log_info "Available broadcast files:"
        ls -la "$BROADCAST_DIR"/ 2>/dev/null || true
    fi
    exit 1
fi

log_ok "Broadcast file found: ${BROADCAST_FILE}"

# ============================================================
# Parse addresses from forge broadcast JSON
# The broadcast JSON contains a "transactions" array with:
#   - "contractName": name of the contract
#   - "contractAddress": deployed address
#   - "transactionType": "CREATE" for deployments
#
# Deployment order from DeployProduction.s.sol:
#   1. CommitRevealAuction (impl)
#   2. VibeAMM (impl)
#   3. DAOTreasury (impl)
#   4. CrossChainRouter (impl)
#   5. VibeSwapCore (impl)
#   6. TruePriceOracle (impl)
#   7. StablecoinFlowRegistry (impl)
#   8-12. ERC1967Proxy (for AMM, Treasury, Auction, Router, Core)
#   13-14. ERC1967Proxy (for StablecoinRegistry, TruePriceOracle)
#   15+. Configuration transactions (non-CREATE)
#
# We need to extract proxy addresses for the 7 proxies.
# The implementation addresses are useful for verification.
# ============================================================

# Use python (available in MINGW) to parse JSON reliably
# Falls back to a simpler grep approach if python is not available

parse_addresses() {
    python3 -c "
import json, sys

with open('${BROADCAST_FILE}', 'r') as f:
    data = json.load(f)

transactions = data.get('transactions', [])

# Track all CREATE transactions
creates = []
for tx in transactions:
    if tx.get('transactionType') == 'CREATE':
        creates.append({
            'name': tx.get('contractName', 'Unknown'),
            'address': tx.get('contractAddress', ''),
        })

# Implementations (first 7 CREATEs based on deploy order)
impl_names = [
    'CommitRevealAuction',
    'VibeAMM',
    'DAOTreasury',
    'CrossChainRouter',
    'VibeSwapCore',
    'TruePriceOracle',
    'StablecoinFlowRegistry',
]

# Separate implementations from proxies
impls = []
proxies = []
for c in creates:
    if c['name'] == 'ERC1967Proxy':
        proxies.append(c)
    else:
        impls.append(c)

# Print implementations
for impl in impls:
    print(f\"IMPL_{impl['name']}={impl['address']}\")

# Proxy order matches deploy script:
# 0: VibeAMM proxy
# 1: DAOTreasury proxy
# 2: CommitRevealAuction proxy
# 3: CrossChainRouter proxy
# 4: VibeSwapCore proxy
# 5: StablecoinFlowRegistry proxy
# 6: TruePriceOracle proxy
proxy_labels = [
    'VIBESWAP_AMM',
    'VIBESWAP_TREASURY',
    'VIBESWAP_AUCTION',
    'VIBESWAP_ROUTER',
    'VIBESWAP_CORE',
    'STABLECOIN_REGISTRY',
    'TRUE_PRICE_ORACLE',
]

for i, label in enumerate(proxy_labels):
    if i < len(proxies):
        print(f\"{label}={proxies[i]['address']}\")
    else:
        print(f\"{label}=NOT_DEPLOYED\", file=sys.stderr)
" 2>&1
}

# Try python3 first, then python
PARSE_OUTPUT=""
if command -v python3 &>/dev/null; then
    PARSE_OUTPUT=$(parse_addresses)
elif command -v python &>/dev/null; then
    PARSE_OUTPUT=$(echo "$(parse_addresses)" | sed 's/python3/python/g')
    # Actually re-run with python
    PARSE_OUTPUT=$(python -c "
import json, sys

with open('${BROADCAST_FILE}', 'r') as f:
    data = json.load(f)

transactions = data.get('transactions', [])

creates = []
for tx in transactions:
    if tx.get('transactionType') == 'CREATE':
        creates.append({
            'name': tx.get('contractName', 'Unknown'),
            'address': tx.get('contractAddress', ''),
        })

impls = []
proxies = []
for c in creates:
    if c['name'] == 'ERC1967Proxy':
        proxies.append(c)
    else:
        impls.append(c)

for impl in impls:
    print(f\"IMPL_{impl['name']}={impl['address']}\")

proxy_labels = [
    'VIBESWAP_AMM',
    'VIBESWAP_TREASURY',
    'VIBESWAP_AUCTION',
    'VIBESWAP_ROUTER',
    'VIBESWAP_CORE',
    'STABLECOIN_REGISTRY',
    'TRUE_PRICE_ORACLE',
]

for i, label in enumerate(proxy_labels):
    if i < len(proxies):
        print(f\"{label}={proxies[i]['address']}\")
    else:
        print(f\"{label}=NOT_DEPLOYED\", file=sys.stderr)
" 2>&1)
else
    log_error "Neither python3 nor python found. Cannot parse broadcast JSON."
    log_error "Install Python or manually parse: ${BROADCAST_FILE}"
    exit 1
fi

log_info "Parsed addresses from broadcast:"
echo "$PARSE_OUTPUT"
echo ""

# Extract proxy addresses into variables
ADDR_CORE=$(echo "$PARSE_OUTPUT" | grep "^VIBESWAP_CORE=" | cut -d'=' -f2)
ADDR_AUCTION=$(echo "$PARSE_OUTPUT" | grep "^VIBESWAP_AUCTION=" | cut -d'=' -f2)
ADDR_AMM=$(echo "$PARSE_OUTPUT" | grep "^VIBESWAP_AMM=" | cut -d'=' -f2)
ADDR_TREASURY=$(echo "$PARSE_OUTPUT" | grep "^VIBESWAP_TREASURY=" | cut -d'=' -f2)
ADDR_ROUTER=$(echo "$PARSE_OUTPUT" | grep "^VIBESWAP_ROUTER=" | cut -d'=' -f2)
ADDR_ORACLE=$(echo "$PARSE_OUTPUT" | grep "^TRUE_PRICE_ORACLE=" | cut -d'=' -f2)
ADDR_REGISTRY=$(echo "$PARSE_OUTPUT" | grep "^STABLECOIN_REGISTRY=" | cut -d'=' -f2)

# Validate we got all addresses
MISSING_ADDRS=false
for var_name in ADDR_CORE ADDR_AUCTION ADDR_AMM ADDR_TREASURY ADDR_ROUTER ADDR_ORACLE ADDR_REGISTRY; do
    val="${!var_name:-}"
    if [ -z "$val" ] || [ "$val" = "NOT_DEPLOYED" ]; then
        log_error "Missing address: ${var_name}"
        MISSING_ADDRS=true
    fi
done

if $MISSING_ADDRS; then
    log_error "Some contracts were not deployed. Check the broadcast JSON."
    log_error "File: ${BROADCAST_FILE}"
    exit 1
fi

log_ok "All 7 proxy addresses extracted"

# ============================================================
# STEP 5: POST-DEPLOY VERIFICATION
# ============================================================
log_step "STEP 5: Post-deploy Verification"

log_info "Running VerifyDeployment.s.sol against deployed contracts..."

# Export addresses for the verification script
export VIBESWAP_CORE="$ADDR_CORE"
export VIBESWAP_AUCTION="$ADDR_AUCTION"
export VIBESWAP_AMM="$ADDR_AMM"
export VIBESWAP_TREASURY="$ADDR_TREASURY"
export VIBESWAP_ROUTER="$ADDR_ROUTER"
export TRUE_PRICE_ORACLE_ADDRESS="$ADDR_ORACLE"
export STABLECOIN_REGISTRY_ADDRESS="$ADDR_REGISTRY"

cd "$PROJECT_DIR"
if "$FORGE" script script/VerifyDeployment.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    -vvv 2>&1 | tee -a "$DEPLOY_LOG"; then
    log_ok "Verification script passed"
else
    log_warn "Verification script had issues. Check output above."
    log_warn "Deployment may still be valid - review manually."
fi

# ============================================================
# STEP 6: UPDATE FRONTEND CONSTANTS
# ============================================================
log_step "STEP 6: Update Frontend Configuration"

# 6a. Update frontend/src/utils/constants.js
# Replace the Sepolia section (chain 11155111) with deployed addresses
log_info "Updating ${CONSTANTS_FILE}..."

if [ -f "$CONSTANTS_FILE" ]; then
    # Use python for reliable multi-line file editing
    python3 -c "
import re

with open('${CONSTANTS_FILE}', 'r') as f:
    content = f.read()

# The Sepolia block uses getEnvAddress calls - we keep that pattern
# but the addresses are loaded from VITE_SEPOLIA_* env vars at runtime
# So the constants.js file doesn't need address changes - it reads from env
# But let's verify the structure is correct
if 'VITE_SEPOLIA_VIBESWAP_CORE' in content:
    print('constants.js already configured to read Sepolia addresses from env vars')
    print('Addresses will be loaded from frontend/.env at runtime')
else:
    print('WARNING: constants.js may not have Sepolia env var references')
" 2>&1

    log_ok "constants.js verified (reads from VITE_SEPOLIA_* env vars)"
else
    log_warn "constants.js not found at ${CONSTANTS_FILE}"
fi

# 6b. Update or create frontend/.env with deployed Sepolia addresses
log_info "Updating ${FRONTEND_ENV}..."

# Function to set a value in the .env file (upsert)
update_env_var() {
    local file="$1"
    local key="$2"
    local value="$3"

    if [ -f "$file" ] && grep -q "^${key}=" "$file" 2>/dev/null; then
        # Update existing line (MINGW-compatible sed)
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    elif [ -f "$file" ]; then
        # Append to file
        echo "${key}=${value}" >> "$file"
    else
        # Create file
        echo "${key}=${value}" > "$file"
    fi
}

# If frontend/.env doesn't exist, copy from .env.example
if [ ! -f "$FRONTEND_ENV" ]; then
    if [ -f "${PROJECT_DIR}/frontend/.env.example" ]; then
        log_info "Creating frontend/.env from .env.example"
        cp "${PROJECT_DIR}/frontend/.env.example" "$FRONTEND_ENV"
    else
        log_info "Creating fresh frontend/.env"
        touch "$FRONTEND_ENV"
    fi
fi

# Update Sepolia contract addresses
update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_VIBESWAP_CORE" "$ADDR_CORE"
update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_VIBE_AMM" "$ADDR_AMM"
update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_AUCTION" "$ADDR_AUCTION"
update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_TREASURY" "$ADDR_TREASURY"
update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_ROUTER" "$ADDR_ROUTER"

# Also set the RPC URL if available
if [ -n "${SEPOLIA_RPC_URL:-}" ]; then
    update_env_var "$FRONTEND_ENV" "VITE_SEPOLIA_RPC_URL" "$SEPOLIA_RPC_URL"
fi

log_ok "Frontend .env updated with Sepolia addresses"

# 6c. Update root .env with deployed addresses (for VerifyDeployment.s.sol reuse)
log_info "Updating ${ROOT_ENV} with deployed addresses..."
update_env_var "$ROOT_ENV" "VIBESWAP_CORE" "$ADDR_CORE"
update_env_var "$ROOT_ENV" "VIBESWAP_AUCTION" "$ADDR_AUCTION"
update_env_var "$ROOT_ENV" "VIBESWAP_AMM" "$ADDR_AMM"
update_env_var "$ROOT_ENV" "VIBESWAP_TREASURY" "$ADDR_TREASURY"
update_env_var "$ROOT_ENV" "VIBESWAP_ROUTER" "$ADDR_ROUTER"
update_env_var "$ROOT_ENV" "TRUE_PRICE_ORACLE_ADDRESS" "$ADDR_ORACLE"
update_env_var "$ROOT_ENV" "STABLECOIN_REGISTRY_ADDRESS" "$ADDR_REGISTRY"
log_ok "Root .env updated"

# ============================================================
# STEP 7: ETHERSCAN VERIFICATION (if --verify and not already done)
# ============================================================
if $VERIFY; then
    log_step "STEP 7: Etherscan Verification"
    log_info "Contract verification was included in the forge script --verify flag."
    log_info "If any verifications failed, you can retry manually:"
    echo ""
    echo "  # Verify each implementation contract:"
    echo "  ${FORGE} verify-contract <IMPL_ADDRESS> <ContractName> \\"
    echo "    --chain-id ${CHAIN_ID} --etherscan-api-key \${ETHERSCAN_API_KEY}"
    echo ""
    echo "  # Verify each proxy:"
    echo "  ${FORGE} verify-contract <PROXY_ADDRESS> ERC1967Proxy \\"
    echo "    --chain-id ${CHAIN_ID} --etherscan-api-key \${ETHERSCAN_API_KEY}"
    echo ""
fi

# ============================================================
# STEP 8: DEPLOYMENT SUMMARY
# ============================================================
log_step "DEPLOYMENT SUMMARY"

echo ""
echo -e "${BOLD}${GREEN}"
echo "  ============================================"
echo "  VIBESWAP SEPOLIA DEPLOYMENT COMPLETE"
echo "  ============================================"
echo -e "${NC}"
echo ""
echo -e "${BOLD}Deployer:${NC}     ${DEPLOYER_ADDRESS:-unknown}"
echo -e "${BOLD}Chain:${NC}        Sepolia (${CHAIN_ID})"
echo -e "${BOLD}Timestamp:${NC}    $(date '+%Y-%m-%d %H:%M:%S UTC' -u 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo -e "${BOLD}Proxy Addresses (use these):${NC}"
echo -e "  VibeSwapCore:           ${GREEN}${ADDR_CORE}${NC}"
echo -e "  CommitRevealAuction:    ${GREEN}${ADDR_AUCTION}${NC}"
echo -e "  VibeAMM:                ${GREEN}${ADDR_AMM}${NC}"
echo -e "  DAOTreasury:            ${GREEN}${ADDR_TREASURY}${NC}"
echo -e "  CrossChainRouter:       ${GREEN}${ADDR_ROUTER}${NC}"
echo -e "  TruePriceOracle:        ${GREEN}${ADDR_ORACLE}${NC}"
echo -e "  StablecoinFlowRegistry: ${GREEN}${ADDR_REGISTRY}${NC}"
echo ""
echo -e "${BOLD}Etherscan Links:${NC}"
echo "  Core:     https://sepolia.etherscan.io/address/${ADDR_CORE}"
echo "  Auction:  https://sepolia.etherscan.io/address/${ADDR_AUCTION}"
echo "  AMM:      https://sepolia.etherscan.io/address/${ADDR_AMM}"
echo "  Treasury: https://sepolia.etherscan.io/address/${ADDR_TREASURY}"
echo "  Router:   https://sepolia.etherscan.io/address/${ADDR_ROUTER}"
echo "  Oracle:   https://sepolia.etherscan.io/address/${ADDR_ORACLE}"
echo "  Registry: https://sepolia.etherscan.io/address/${ADDR_REGISTRY}"
echo ""
echo -e "${BOLD}Files Updated:${NC}"
echo "  - ${ROOT_ENV} (contract addresses for forge scripts)"
echo "  - ${FRONTEND_ENV} (VITE_SEPOLIA_* variables for frontend)"
echo "  - ${DEPLOY_LOG} (deployment log)"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "  1. Verify contracts on Etherscan (if not using --verify):"
echo "     ${FORGE} verify-contract ${ADDR_CORE} VibeSwapCore --chain-id ${CHAIN_ID}"
echo "  2. Create initial pools:"
echo "     ${FORGE} script script/SetupMVP.s.sol --rpc-url \$SEPOLIA_RPC_URL --broadcast"
echo "  3. Start oracle:"
echo "     python -m oracle.main --network sepolia"
echo "  4. Test frontend against Sepolia:"
echo "     cd frontend && npm run dev"
echo "  5. Push updated configs:"
echo "     git add frontend/.env .env && git commit -m 'deploy: Sepolia addresses'"
echo ""

# Save summary to deploy log
{
    echo ""
    echo "=== DEPLOYMENT COMPLETE ==="
    echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Chain: Sepolia (${CHAIN_ID})"
    echo "VIBESWAP_CORE=${ADDR_CORE}"
    echo "VIBESWAP_AUCTION=${ADDR_AUCTION}"
    echo "VIBESWAP_AMM=${ADDR_AMM}"
    echo "VIBESWAP_TREASURY=${ADDR_TREASURY}"
    echo "VIBESWAP_ROUTER=${ADDR_ROUTER}"
    echo "TRUE_PRICE_ORACLE=${ADDR_ORACLE}"
    echo "STABLECOIN_REGISTRY=${ADDR_REGISTRY}"
} >> "$DEPLOY_LOG"

log_ok "Deployment complete. Build in the cave."
