#!/usr/bin/env bash
# TRP Regression Detection
# Runs security-critical test suites to verify TRP fixes still hold.
# Maps test files to the TRP findings they cover.
#
# Usage: ./scripts/trp-regression.sh [--quick|--full]
#   --quick: run only CRITICAL/HIGH coverage tests (default)
#   --full:  run all TRP-related test suites

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:---quick}"

# Pre-flight checks
command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found in PATH"; exit 1; }

# Cleanup temp files on exit
trap 'rm -f "$REPO_ROOT/.trp-regression-err" "$REPO_ROOT/.trp-regression-out"' EXIT

echo "=== TRP Regression Detection ==="
echo "Mode: $MODE"
echo ""

# Map TRP findings to their test coverage
# Format: test_file:finding_ids:severity
declare -a CRITICAL_TESTS=(
    "test/CommitRevealAuction.t.sol:F01,F02,F04,F07,R1-F02:HIGH"
    "test/CommitRevealAuction.advanced.t.sol:AMM-01,F06:CRITICAL"
    "test/VibeAMM.t.sol:AMM-01,AMM-03,F06,F03:CRITICAL"
    "test/VibeAMMLite.t.sol:AMM-05,AMM-06,CB-06:MEDIUM"
    "test/ShapleyDistributor.t.sol:F08,F02,N03,N06:CRITICAL"
    "test/CrossChainRouter.t.sol:NEW-01,NEW-02,NEW-03,NEW-05,NEW-07,NEW-10,H-01,H-02,H-03:CRITICAL"
    "test/CircuitBreaker.t.sol:CB-01,CB-03,CB-05,CB-07:HIGH"
)

declare -a MEDIUM_TESTS=(
    "test/VibeAMMSecurity.t.sol:TWAP-drift,flash-loan:MEDIUM"
    "test/VibeAMMTWAPDrift.t.sol:AMM-05:MEDIUM"
)

# Select test set based on mode
if [ "$MODE" = "--full" ]; then
    ALL_TESTS=("${CRITICAL_TESTS[@]}" "${MEDIUM_TESTS[@]}")
else
    ALL_TESTS=("${CRITICAL_TESTS[@]}")
fi

PASS=0
FAIL=0
SKIP=0
RESULTS=()

for entry in "${ALL_TESTS[@]}"; do
    IFS=':' read -r test_file findings severity <<< "$entry"
    full_path="$REPO_ROOT/$test_file"

    if [ ! -f "$full_path" ]; then
        echo "  SKIP  $test_file (not found)"
        SKIP=$((SKIP + 1))
        RESULTS+=("SKIP|$test_file|$findings|$severity|File not found")
        continue
    fi

    echo -n "  RUN   $test_file [$severity: $findings] ... "

    # Run the test with targeted match
    test_name=$(basename "$test_file" .t.sol)
    if forge test --match-path "$test_file" --no-match-test "DISABLED" -q 2>"$REPO_ROOT/.trp-regression-err" 1>"$REPO_ROOT/.trp-regression-out"; then
        # Count passing tests from output
        count=$(grep -oP '\d+ tests?' "$REPO_ROOT/.trp-regression-out" | head -1 || echo "? tests")
        echo "PASS ($count)"
        PASS=$((PASS + 1))
        RESULTS+=("PASS|$test_file|$findings|$severity|$count")
    else
        echo "FAIL"
        # Show failure summary
        tail -5 "$REPO_ROOT/.trp-regression-err" 2>/dev/null | head -3 | sed 's/^/         /'
        FAIL=$((FAIL + 1))
        RESULTS+=("FAIL|$test_file|$findings|$severity|See error output")
    fi
done

# Temp files cleaned by EXIT trap

echo ""
echo "=== Results ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP"
echo "  Total: $((PASS + FAIL + SKIP))"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "=== REGRESSIONS DETECTED ==="
    for r in "${RESULTS[@]}"; do
        IFS='|' read -r status file findings severity note <<< "$r"
        if [ "$status" = "FAIL" ]; then
            echo "  [$severity] $file"
            echo "    Covers: $findings"
            echo "    $note"
        fi
    done
    echo ""
    echo "ACTION: Fix regressions before proceeding with TRP."
    exit 1
else
    echo "All security-critical TRP fixes verified. No regressions."
    exit 0
fi
