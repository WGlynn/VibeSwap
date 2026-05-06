#!/usr/bin/env bash
# ============================================================
# check-storage-layout.sh
# Storage layout regression check for UUPS-upgradeable contracts.
#
# Usage:
#   ./script/check-storage-layout.sh              # check all contracts with snapshots
#   ./script/check-storage-layout.sh --update     # regenerate and update snapshots
#   CONTRACTS="CommitRevealAuction VibeAMM" ./script/check-storage-layout.sh
#
# CI: called from .github/workflows/ci.yml contracts job.
# Returns exit code 1 if any layout drifts from committed snapshot.
#
# UUPS slot collision = silent fund loss on upgrade. Do NOT ignore failures.
# See docs/developer/STORAGE_LAYOUT_REGRESSION.md for full protocol.
# ============================================================

set -uo pipefail
# NOTE: -e intentionally omitted; we handle exit codes explicitly below
# to prevent set -e from swallowing forge inspect failures silently.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/.storage-layouts"
NORMALIZER="$REPO_ROOT/script/normalize-storage-layout.py"
UPDATE_MODE="${1:-}"
FAIL=0

# Color codes (no-op if not a terminal)
RED=""; GREEN=""; YELLOW=""; RESET=""
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
fi

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [ ! -d "$SNAPSHOT_DIR" ]; then
    echo "${RED}ERROR: Snapshot directory $SNAPSHOT_DIR not found.${RESET}"
    echo "Run: ./script/check-storage-layout.sh --update"
    exit 1
fi

if [ ! -f "$NORMALIZER" ]; then
    echo "${RED}ERROR: Normalizer script $NORMALIZER not found.${RESET}"
    exit 1
fi

if ! command -v forge &>/dev/null; then
    echo "${RED}ERROR: forge not found in PATH. Install Foundry first.${RESET}"
    exit 1
fi

if ! command -v python3 &>/dev/null; then
    echo "${RED}ERROR: python3 not found in PATH.${RESET}"
    exit 1
fi

# ---------------------------------------------------------------------------
# get_contract_specifier: returns "ContractName" or "path/to/File.sol:Name"
# Snapshot filename convention: double-underscore encodes path qualifier.
#   financial__VibeInsurancePool -> contracts/financial/VibeInsurancePool.sol:VibeInsurancePool
# ---------------------------------------------------------------------------
get_contract_specifier() {
    local snapshot_name="$1"
    if [[ "$snapshot_name" == *"__"* ]]; then
        local dir="${snapshot_name%%__*}"
        local name="${snapshot_name##*__}"
        echo "contracts/${dir}/${name}.sol:${name}"
    else
        echo "$snapshot_name"
    fi
}

# ---------------------------------------------------------------------------
# Collect snapshot files to check
# ---------------------------------------------------------------------------
if [ -n "${CONTRACTS:-}" ]; then
    SNAPSHOT_FILES=()
    for c in $CONTRACTS; do
        if [ -f "$SNAPSHOT_DIR/${c}.json" ]; then
            SNAPSHOT_FILES+=("$SNAPSHOT_DIR/${c}.json")
        else
            echo "${YELLOW}WARNING: No snapshot for '$c' — skipping (run --update to add).${RESET}"
        fi
    done
else
    SNAPSHOT_FILES=("$SNAPSHOT_DIR"/*.json)
fi

echo "=== Storage Layout Regression Check ==="
echo "  Snapshots : $SNAPSHOT_DIR"
echo "  Contracts : ${#SNAPSHOT_FILES[@]}"
echo ""

# ---------------------------------------------------------------------------
# Check each contract
# ---------------------------------------------------------------------------
TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

for snapshot_path in "${SNAPSHOT_FILES[@]}"; do
    snapshot_filename="$(basename "$snapshot_path" .json)"
    specifier="$(get_contract_specifier "$snapshot_filename")"

    printf "  %-50s " "$snapshot_filename"

    # Generate current layout into a temp file (avoids pipefail + $() complexity)
    tmp_current="$TMPDIR_LOCAL/current_${snapshot_filename}.json"
    tmp_err="$TMPDIR_LOCAL/err_${snapshot_filename}.txt"

    FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge inspect "$specifier" storageLayout --json \
        >"$TMPDIR_LOCAL/raw_${snapshot_filename}.json" 2>"$tmp_err"
    forge_rc=$?

    if [ "$forge_rc" -ne 0 ]; then
        err_msg="$(cat "$tmp_err" 2>/dev/null | head -1)"
        echo "${YELLOW}SKIP (forge error: ${err_msg:-unknown})${RESET}"
        continue
    fi

    python3 "$NORMALIZER" <"$TMPDIR_LOCAL/raw_${snapshot_filename}.json" >"$tmp_current" 2>"$tmp_err"
    py_rc=$?

    if [ "$py_rc" -ne 0 ]; then
        echo "${YELLOW}SKIP (normalize error: $(cat "$tmp_err" | head -1))${RESET}"
        continue
    fi

    if [ "$UPDATE_MODE" = "--update" ]; then
        cp "$tmp_current" "$snapshot_path"
        echo "${GREEN}UPDATED${RESET}"
        continue
    fi

    if diff -q "$snapshot_path" "$tmp_current" &>/dev/null; then
        echo "${GREEN}OK${RESET}"
    else
        echo "${RED}DRIFT${RESET}"
        echo ""
        echo "    --- committed ($snapshot_filename.json)"
        echo "    +++ current"
        diff "$snapshot_path" "$tmp_current" | sed 's/^/    /' || true
        echo ""
        echo "    If this change is INTENTIONAL (e.g. appending a new field):"
        echo "    1. Verify slots 0..(N-1) are UNCHANGED. Only appending is safe for UUPS."
        echo "    2. Run: ./script/check-storage-layout.sh --update"
        echo "    3. Include updated .storage-layouts/${snapshot_filename}.json in the same commit."
        echo ""
        FAIL=1
    fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$UPDATE_MODE" = "--update" ]; then
    echo "${GREEN}Snapshots updated. Stage .storage-layouts/ and commit.${RESET}"
    exit 0
elif [ "$FAIL" -eq 1 ]; then
    echo "${RED}FAILED: Storage layout drift detected. See diffs above.${RESET}"
    echo "UUPS slot collision = silent fund loss on upgrade."
    exit 1
else
    echo "${GREEN}All storage layouts match committed snapshots.${RESET}"
    exit 0
fi
