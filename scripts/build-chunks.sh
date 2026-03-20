#!/bin/bash
# ============ Chunked Build — Compile by directory to avoid OOM ============
#
# Foundry compiles ALL .sol files it finds. On machines with <8GB RAM,
# 667 files causes solc to OOM (std::bad_alloc).
#
# This script compiles contracts directory by directory, catching errors
# per-chunk instead of losing the entire build to one crash.
#
# Usage: ./scripts/build-chunks.sh
# ============

FORGE="${FORGE:-forge}"
if command -v /c/Users/Will/.foundry/bin/forge &>/dev/null; then
  FORGE="/c/Users/Will/.foundry/bin/forge"
fi

echo "============ VibeSwap Chunked Build ============"
echo ""

FAILED=0
PASSED=0
ERRORS=""

# Contract directories to compile individually
DIRS=(
  "contracts/core"
  "contracts/amm"
  "contracts/governance"
  "contracts/incentives"
  "contracts/identity"
  "contracts/messaging"
  "contracts/monetary"
  "contracts/oracles"
  "contracts/oracle"
  "contracts/financial"
  "contracts/hooks"
  "contracts/compliance"
  "contracts/quantum"
  "contracts/libraries"
)

for dir in "${DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    continue
  fi

  count=$(find "$dir" -maxdepth 1 -name "*.sol" 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    continue
  fi

  echo -n "  Building $dir ($count files)... "

  # Compile only this directory's files by using --match-path
  OUTPUT=$($FORGE build --match-path "$dir/*.sol" 2>&1)
  EXIT=$?

  if [ $EXIT -eq 0 ]; then
    echo "OK"
    PASSED=$((PASSED + 1))
  else
    echo "FAILED"
    FAILED=$((FAILED + 1))
    ERRORS="$ERRORS\n--- $dir ---\n$(echo "$OUTPUT" | grep -E "Error|error" | head -5)\n"
  fi
done

echo ""
echo "============ Results ============"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Errors:"
  echo -e "$ERRORS"
  exit 1
fi

echo ""
echo "All chunks compiled successfully."
