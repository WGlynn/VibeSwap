// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/NakamotoConsensusInfinity.sol";

/// @title NCI composition invariants
/// @notice Separation-of-powers composition invariants for NCI's 3-power weighting, asserted
///         on-chain against the deployed weighting constants. They guard the property that no
///         single dimension can finalize alone ("60% PoM is only dangerous if it's a 60% vote")
///         and auto-catch drift if the BPS constants are ever changed.
/// @dev Reads `public constant`s off the bare implementation — no initialize/proxy/mocks
///      needed, since constants are independent of contract state.
contract NCICompositionInvariantsTest is Test {
    NakamotoConsensusInfinity internal nci;

    function setUp() public {
        nci = new NakamotoConsensusInfinity();
    }

    /// Separation of powers: the three dimension weights partition the whole (sum to BPS).
    function test_weights_partition_to_whole() public view {
        assertEq(
            nci.POW_WEIGHT_BPS() + nci.POS_WEIGHT_BPS() + nci.POM_WEIGHT_BPS(),
            nci.BPS(),
            "PoW + PoS + PoM must sum to 100% (one instrument per function)"
        );
    }

    /// L12 / C1: no single dimension's weight reaches the finalization threshold, so no single
    /// dimension can finalize alone. The 2/3 bar keeps even the largest (PoM, 60%) below it.
    function test_no_single_dimension_reaches_threshold() public view {
        uint256 t = nci.FINALIZATION_THRESHOLD_BPS();
        assertLt(nci.POM_WEIGHT_BPS(), t, "PoM (largest) must sit below the finalize bar");
        assertLt(nci.POS_WEIGHT_BPS(), t, "PoS below the bar");
        assertLt(nci.POW_WEIGHT_BPS(), t, "PoW below the bar");
    }

    /// The threshold is a supermajority, not a simple majority — that is what raises the bar
    /// above any single dimension's ceiling (a 50% bar would let PoM's 60% capture alone).
    function test_threshold_is_supermajority() public view {
        assertGt(nci.FINALIZATION_THRESHOLD_BPS(), nci.BPS() / 2, "threshold must exceed 50%");
    }

    /// AND-at-the-margin: capturing finalization needs the largest dimension PLUS a sliver of a
    /// second one — exactly (threshold - PoM) of extra weight. Documents the coalition gap that
    /// makes single-dimension dominance insufficient.
    function test_capture_needs_pom_plus_second_dimension() public view {
        uint256 t = nci.FINALIZATION_THRESHOLD_BPS();
        uint256 pom = nci.POM_WEIGHT_BPS();
        assertGt(t, pom, "PoM alone is short of the bar");
        uint256 gap = t - pom; // the second-dimension sliver required to reach the bar
        assertLe(gap, nci.POS_WEIGHT_BPS(), "the gap is coverable only by a second dimension (coalition, not solo)");
    }
}
