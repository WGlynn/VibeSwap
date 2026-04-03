#!/usr/bin/env bash
# TRP Heat Map Auto-Updater
# Reads current heatmap, checks git diff for contract changes since last audit,
# outputs promotion/demotion recommendations.
#
# Usage: ./scripts/trp-heatmap.sh [baseline_commit]
#   baseline_commit: defaults to last TRP commit tag or HEAD~10

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEATMAP="$REPO_ROOT/docs/trp/efficiency-heatmap.md"
CONTRACTS_DIR="$REPO_ROOT/contracts"

# Baseline commit (last audited state)
if [ -n "${1:-}" ]; then
    BASELINE="$1"
else
    BASELINE=$(git -C "$REPO_ROOT" log --oneline -1 --grep="TRP\|trp" --format="%H" 2>/dev/null || true)
    BASELINE="${BASELINE:-HEAD~10}"
fi

echo "=== TRP Heat Map Auto-Updater ==="
echo "Baseline: $(git -C "$REPO_ROOT" log --oneline -1 "$BASELINE" 2>/dev/null || echo "$BASELINE")"
echo "Current:  $(git -C "$REPO_ROOT" log --oneline -1 HEAD)"
echo ""

# Get changed contract files since baseline
echo "=== Changed Contracts Since Baseline ==="
CHANGED=$(git -C "$REPO_ROOT" diff --name-only "$BASELINE"..HEAD -- contracts/ 2>/dev/null | grep '\.sol$' || true)

if [ -z "$CHANGED" ]; then
    echo "No contract changes detected."
    echo ""
    echo "=== Recommendation: All contracts remain at current status ==="
    exit 0
fi

# Group by top-level directory
echo "$CHANGED" | sed 's|contracts/||' | cut -d/ -f1 | sort | uniq -c | sort -rn
echo ""

# Map changed files to known contracts
echo "=== Promotion Recommendations ==="
echo ""

# Core contracts we track
declare -A TRACKED=(
    ["core"]="CommitRevealAuction,VibeSwapCore,CircuitBreaker,BatchSettlement"
    ["amm"]="VibeAMM,VibeLP,VibePoolFactory"
    ["incentives"]="ShapleyDistributor,ILProtection,LoyaltyRewards"
    ["messaging"]="CrossChainRouter"
    ["governance"]="DAOTreasury,TreasuryStabilizer"
    ["financial"]="wBAR,VibeLPNFT,VibeStream,VibeOptions"
    ["oracles"]="ReputationOracle,TWAPOracle"
)

for dir in $(echo "$CHANGED" | sed 's|contracts/||' | cut -d/ -f1 | sort -u); do
    count=$(echo "$CHANGED" | grep "contracts/$dir/" | wc -l)
    contracts="${TRACKED[$dir]:-unknown}"

    if [ "$count" -gt 0 ]; then
        echo "  COLD → WARM: contracts/$dir/ ($count files changed)"
        echo "    Contracts: $contracts"
        echo "    Changed files:"
        echo "$CHANGED" | grep "contracts/$dir/" | sed 's/^/      /'
        echo ""
    fi
done

# Summary
echo "=== Summary ==="
total_changed=$(echo "$CHANGED" | wc -l)
dirs_changed=$(echo "$CHANGED" | sed 's|contracts/||' | cut -d/ -f1 | sort -u | wc -l)
echo "  $total_changed files changed across $dirs_changed directories"
echo "  Run TRP on WARM+ contracts only"
echo ""
echo "=== Current Heatmap Status ==="
grep -E '^\|.*\|.*\|.*\|.*\|' "$HEATMAP" 2>/dev/null | grep -v "Contract\|---" || echo "  (could not parse heatmap)"
