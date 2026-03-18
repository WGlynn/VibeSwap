#!/bin/bash
# VibeSwap Violation Checker — Zero Tolerance Mode
# Run: bash scripts/violation-check.sh
# Or wire into pre-commit hook for automatic enforcement
#
# Checks staged files (or all files with --all) for known violations
# of core VibeSwap principles.

set -e

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

VIOLATIONS=0
WARNINGS=0

check() {
    local severity="$1"
    local description="$2"
    local pattern="$3"
    local exclude_pattern="$4"
    local files="$5"

    if [ -z "$files" ]; then
        return
    fi

    local results
    if [ -n "$exclude_pattern" ]; then
        results=$(echo "$files" | xargs grep -lin "$pattern" 2>/dev/null | xargs grep -liL "$exclude_pattern" 2>/dev/null || true)
    else
        results=$(echo "$files" | xargs grep -lin "$pattern" 2>/dev/null || true)
    fi

    if [ -n "$results" ]; then
        if [ "$severity" = "VIOLATION" ]; then
            echo -e "${RED}[VIOLATION]${NC} $description"
            VIOLATIONS=$((VIOLATIONS + 1))
        else
            echo -e "${YELLOW}[WARNING]${NC} $description"
            WARNINGS=$((WARNINGS + 1))
        fi
        echo "$results" | while read -r f; do
            echo "  -> $f"
            grep -n "$pattern" "$f" 2>/dev/null | head -3 | sed 's/^/     /'
        done
        echo ""
    fi
}

echo "========================================"
echo "  VibeSwap Violation Checker v1.0"
echo "  Zero Tolerance Mode"
echo "========================================"
echo ""

# Determine which files to check
if [ "$1" = "--all" ]; then
    FILES=$(find . \( -name "*.md" -o -name "*.jsx" -o -name "*.js" -o -name "*.sol" \) | grep -v node_modules | grep -v .git | grep -v "/dist/" | grep -v "/build/" | grep -v ".min.js" | grep -v "zero-tolerance-audit-post")
elif [ "$1" = "--staged" ]; then
    FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(md|jsx|js|sol)$' || true)
else
    # Default: check all tracked files
    FILES=$(git ls-files "*.md" "*.jsx" "*.js" "*.sol" | grep -v node_modules | grep -v "/dist/" | grep -v "dist/" | grep -v build/ | grep -v ".min.js" | grep -v "zero-tolerance-audit-post")
fi

if [ -z "$FILES" ]; then
    echo -e "${GREEN}No files to check.${NC}"
    exit 0
fi

echo "Checking $(echo "$FILES" | wc -l | tr -d ' ') files..."
echo ""

# ============ P-000: ZERO PROTOCOL FEES ============
echo "--- P-000: Zero Protocol Fee Principle ---"

# "protocol fee" in POSITIVE context (excludes lines with "0%", "zero", "no protocol fee", "PROTOCOL_FEE_SHARE.*0")
# Line-level check: find lines with "protocol fee" that DON'T contain negation
PROTO_FEE_FILES=$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v CHANGELOG | grep -v violation-check | grep -v node_modules)
if [ -n "$PROTO_FEE_FILES" ]; then
    PROTO_HITS=$(echo "$PROTO_FEE_FILES" | xargs grep -in "protocol fee" 2>/dev/null | grep -iv "0%.*protocol fee\|zero protocol fee\|no protocol fee\|protocol fee.*0%\|protocol fee.*zero\|protocol fees are zero\|PROTOCOL_FEE_SHARE.*0\|protocol fee.*free\|without protocol fee\|eliminate.*protocol fee\|violation-check\|not a.*protocol fee\|isn't.*protocol fee\|protocol fee.*\\\$0\|protocol fee.*value={0}\|extract.*protocol fee\|through protocol fee\|session-report\|SECURITY_AUDIT\|weaker than a protocol fee\|stronger.*protocol fee\|protocol fee structures\|non-swap.*protocol fee\|protocol fee.*non-swap\|protocol fee distributor\|label=.*Protocol Fee\|l=.*Protocol Fee\|title=.*Protocol Fee\|Protocol Fee Comparison\|Protocol Fee Notice\|actual protocol fee\|context-fallback\|Real yield.*protocol fee\|protocol fee.*NOT\|protocolFee.*0\|protocol fee.*value.*0\|label.*protocol fee.*value.*0\|>Protocol Fee<\|>Protocol Fees<\|\"Protocol Fee\"\|'Protocol Fee'" || true)
    if [ -n "$PROTO_HITS" ]; then
        echo -e "${RED}[VIOLATION]${NC} Lines referencing 'protocol fee' in positive context"
        VIOLATIONS=$((VIOLATIONS + 1))
        echo "$PROTO_HITS" | head -20 | sed 's/^/  -> /'
        REMAINING=$(echo "$PROTO_HITS" | wc -l)
        if [ "$REMAINING" -gt 20 ]; then
            echo "  ... and $((REMAINING - 20)) more"
        fi
        echo ""
    fi
fi

# Taker/maker fee (VibeSwap doesn't have this)
# Line-level check to avoid false positives from "MakerDAO" + "fee", "market makers" + "fees", etc.
MAKER_TAKER_FILES=$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v intelligence.js | grep -v violation-check)
if [ -n "$MAKER_TAKER_FILES" ]; then
    MAKER_TAKER_HITS=$(echo "$MAKER_TAKER_FILES" | xargs grep -in "taker fee\|maker fee\|taker/maker\|maker/taker" 2>/dev/null | grep -iv "dYdX\|charges maker\|charges taker\|MakerDAO\|market maker\|maker.*stability\|comparing\|other protocol\|uniswap.*charges\|fee tier\|no.*maker/taker\|no.*taker/maker\|asymmetries\|there are no" || true)
    if [ -n "$MAKER_TAKER_HITS" ]; then
        echo -e "${RED}[VIOLATION]${NC} References taker/maker fees (VibeSwap has no taker/maker distinction)"
        VIOLATIONS=$((VIOLATIONS + 1))
        echo "$MAKER_TAKER_HITS" | head -10 | sed 's/^/  -> /'
        echo ""
    fi
fi

# 0.3% as VibeSwap's fee (that's Uniswap)
check "WARNING" "References 0.3% fee (Uniswap default, VibeSwap is 0.05%)" \
    "0\.3%" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# ============ RATE LIMITING ============
echo "--- Rate Limiting (100K tokens/hour/user) ---"

check "VIOLATION" "Rate limit says 1M instead of 100K" \
    "1M tokens.*hour\|1,000,000 token.*hour\|1M/hr" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js|sol)$')"

# ============ TOKEN SUPPLY ============
echo "--- Token Supply (21M VIBE) ---"

check "WARNING" "References 1B token supply (VIBE is 21M)" \
    "1,000,000,000\|1B.*supply\|billion.*VIBE\|billion.*token" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# ============ MINIMUM_LIQUIDITY ============
echo "--- MINIMUM_LIQUIDITY (10000) ---"

check "VIOLATION" "MINIMUM_LIQUIDITY set to 1000 (should be 10000)" \
    "MINIMUM_LIQUIDITY.*=.*1000[^0]" "" \
    "$(echo "$FILES" | grep -E '\.(sol|rs)$')"

# ============ ADMIN KEY HONESTY ============
echo "--- Admin Key Honesty ---"

check "WARNING" "Claims 'no admin keys' or 'ownerless' (contracts have onlyOwner functions)" \
    "no admin key\|ownerless\|fully decentralized" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# ============ BATCH TIMING ============
echo "--- Batch Timing (8s/2s) ---"

# Line-level check to exclude non-batch contexts (network latency, CKB block time, circuit breaker response)
BATCH_FILES=$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v violation-check)
if [ -n "$BATCH_FILES" ]; then
    BATCH_HITS=$(echo "$BATCH_FILES" | xargs grep -in "800ms\|200ms\|800 ms\|200 ms" 2>/dev/null | grep -iv "latency\|block.*time\|blockTime\|circuit breaker\|response time\|edge\|Fly\.io\|per block\|round.trip" || true)
    if [ -n "$BATCH_HITS" ]; then
        echo -e "${RED}[VIOLATION]${NC} Uses millisecond batch timings (should be 8s/2s)"
        VIOLATIONS=$((VIOLATIONS + 1))
        echo "$BATCH_HITS" | head -10 | sed 's/^/  -> /'
        echo ""
    fi
fi

# ============ STALE STATS ============
echo "--- Stale Stats ---"

check "WARNING" "References old contract count (121 or 130)" \
    "121 contract\|130 contract\|121 smart contract\|130 smart contract" "" \
    "$(echo "$FILES" | grep -E '\.md$')"

check "WARNING" "References old test count (1,700 or 1200)" \
    "1,700.*test\|1200.*test\|1,200.*test" "" \
    "$(echo "$FILES" | grep -E '\.md$')"

check "WARNING" "References old component count (51 components)" \
    "51 component" "" \
    "$(echo "$FILES" | grep -E '\.md$')"

# ============ REVOKED ACCESS ============
echo "--- Revoked Access ---"

check "WARNING" "References tbhxnest (access revoked Session 053)" \
    "tbhxnest" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v MEMORY | grep -v nyx)"

# ============ TOKEN CONFUSION ============
echo "--- Token Confusion (JUL vs VIBE) ---"

# JUL called governance token (VIBE is governance)
check "WARNING" "JUL described as governance token (VIBE is the governance token)" \
    "JUL.*governance\|governance.*JUL\|JUL.*voting\|vote.*JUL" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# Wrong JUL name
check "WARNING" "JUL called 'Julius' or 'Jul Token' (correct name: 'Joule')" \
    "Julius\|Jul Token" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# ============ HALVING SCHEDULE ============
echo "--- Halving Schedule (annual, not 4-year) ---"

# 4-year halvings (should be annual)
check "WARNING" "References 4-year halving (VIBE uses annual halvings)" \
    "4.year.*halving\|four.year.*halving\|halving.*4.year" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$')"

# ============ BRIDGE FEES ============
echo "--- Bridge Fees (0%) ---"

# Bridge fee revenue claims (bridges are 0% fee)
# Line-level check: exclude lines showing zero/free bridge fees, JSX template literals, and USD formatting
BRIDGE_REV_FILES=$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v violation-check)
if [ -n "$BRIDGE_REV_FILES" ]; then
    BRIDGE_REV_HITS=$(echo "$BRIDGE_REV_FILES" | xargs grep -in "bridge.*fee.*revenue\|bridge.*fee.*income" 2>/dev/null | grep -iv "0%\|zero\|free\|no bridge fee" || true)
    if [ -n "$BRIDGE_REV_HITS" ]; then
        echo -e "${RED}[VIOLATION]${NC} Claims bridge fee revenue (bridge fees are 0%)"
        VIOLATIONS=$((VIOLATIONS + 1))
        echo "$BRIDGE_REV_HITS" | head -10 | sed 's/^/  -> /'
        echo ""
    fi
fi

# ============ SECURITY ============
echo "--- Security (hardcoded secrets, eval) ---"

# Hardcoded private keys or API keys
# Line-level check: exclude key prefix validation patterns (keyPrefix: 'sk-ant-')
SECRET_FILES=$(echo "$FILES" | grep -E '\.(js|jsx|py|sol)$' | grep -v violation-check)
if [ -n "$SECRET_FILES" ]; then
    SECRET_HITS=$(echo "$SECRET_FILES" | xargs grep -in "sk-ant-\|sk-proj-\|AKIA[A-Z0-9]" 2>/dev/null | grep -iv "keyPrefix\|prefix.*sk-\|validation\|startsWith\|\.startsWith\|example\|placeholder" || true)
    if [ -n "$SECRET_HITS" ]; then
        echo -e "${RED}[VIOLATION]${NC} Possible hardcoded secret or API key"
        VIOLATIONS=$((VIOLATIONS + 1))
        echo "$SECRET_HITS" | head -10 | sed 's/^/  -> /'
        echo ""
    fi
fi

# eval() or new Function() in production code
check "WARNING" "eval() or new Function() usage (potential code injection)" \
    "eval(\|new Function(" "" \
    "$(echo "$FILES" | grep -E '\.(js|jsx)$' | grep -v node_modules | grep -v dist/ | grep -v test)"

# ============ AUDIT CLAIMS ============
echo "--- Audit Claims ---"

# "Formally verified" without qualification
check "WARNING" "Claims formal verification (project uses fuzz/invariant testing, not formal verification)" \
    "formally verified" "" \
    "$(echo "$FILES" | grep -E '\.md$' | grep -v violation-check)"

# ============ VIBE AIRDROP ============
echo "--- VIBE Airdrop (never airdropped) ---"

# VIBE airdrop claims (VIBE is never airdropped)
check "WARNING" "Claims VIBE is airdropped (VIBE is never airdropped — minted through contribution)" \
    "airdrop.*VIBE\|VIBE.*airdrop" "" \
    "$(echo "$FILES" | grep -E '\.(md|jsx|js)$' | grep -v 'never airdrop\|not airdrop\|Contribution Claim\|earned.*not.*airdrop')"

# ============ RESULTS ============
echo "========================================"
if [ $VIOLATIONS -gt 0 ]; then
    echo -e "${RED}FAILED: $VIOLATIONS violation(s), $WARNINGS warning(s)${NC}"
    echo "Fix violations before committing."
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}PASSED with $WARNINGS warning(s)${NC}"
    echo "Warnings should be reviewed but don't block commits."
    exit 0
else
    echo -e "${GREEN}PASSED: No violations or warnings found.${NC}"
    exit 0
fi
