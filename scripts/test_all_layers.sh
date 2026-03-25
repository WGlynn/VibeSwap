#!/bin/bash
# Run all three testing layers in sequence.
# Usage: ./scripts/test_all_layers.sh
#
# Layer 1: Solidity (Foundry) — axiom tests, invariants, fuzz, replay
# Layer 2: Python reference model — exact arithmetic comparison
# Layer 3: Python adversarial search — guided exploration for deviations

set -e

FORGE="${HOME}/.foundry/bin/forge.exe"
PYTHON="python"

echo "=============================================="
echo "  VIBESWAP THREE-LAYER TEST SUITE"
echo "=============================================="
echo ""

# ============ Layer 2: Python Reference Model ============
echo "--- Layer 2: Python Reference Model ---"
$PYTHON -m pytest oracle/tests/test_shapley_reference.py -v --tb=short
echo ""

# ============ Layer 3: Python Adversarial Search ============
echo "--- Layer 3: Adversarial Search ---"
$PYTHON -m pytest oracle/tests/test_adversarial_search.py -v --tb=short
echo ""

# ============ Layer 1: Solidity (Foundry) ============
echo "--- Layer 1: Solidity Cross-Layer Tests ---"
echo "(Compiling 445+ Solidity files, this takes a few minutes...)"
$FORGE test --match-contract "ShapleyReplayTest|ConservationInvariantTest" -vvv || true
echo ""

# ============ Summary ============
echo "=============================================="
echo "  SUMMARY"
echo "=============================================="
echo "Layer 2 (Python reference): see above"
echo "Layer 3 (Adversarial search): see above"
echo "Layer 1 (Solidity replay): see above"
echo ""
echo "For full Solidity test suite: $FORGE test -vvv"
echo "For vector regeneration: $PYTHON -m oracle.backtest.generate_vectors"
echo "For full adversarial report: $PYTHON -m oracle.backtest.adversarial_search"
echo "=============================================="
