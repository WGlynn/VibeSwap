// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISybilGuard
 * @notice Interface for sybil resistance in Shapley distribution.
 * @dev When configured on ShapleyDistributor, prevents the Lawson Floor
 *      sybil attack where splitting into N accounts extracts N * floor
 *      instead of 1 * floor.
 *
 *      Found by adversarial search (Layer 3): 200/200 rounds showed
 *      profitable sybil splitting. This interface is the mitigation.
 *
 *      Primary implementation: SoulboundIdentity.hasIdentity()
 *      Any contract implementing this interface can serve as a guard.
 */
interface ISybilGuard {
    /**
     * @notice Check if an address represents a unique identity.
     * @param addr Address to check
     * @return True if the address has a verified unique identity
     */
    function isUniqueIdentity(address addr) external view returns (bool);
}
