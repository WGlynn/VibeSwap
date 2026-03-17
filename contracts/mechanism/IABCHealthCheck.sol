// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IABCHealthCheck
 * @notice Minimal interface for AugmentedBondingCurve health verification.
 *         Used by ShapleyDistributor to enforce conservation invariant
 *         before distributing rewards. P-000: Fairness Above All.
 */
interface IABCHealthCheck {
    /// @notice Check if the bonding curve invariant is within healthy bounds
    /// @return healthy Whether V(R,S) ≈ V₀ within tolerance
    /// @return driftBps Current drift from V₀ in basis points
    function isHealthy() external view returns (bool healthy, uint256 driftBps);

    /// @notice Whether the curve has been initialized and is open for business
    function isOpen() external view returns (bool);
}
