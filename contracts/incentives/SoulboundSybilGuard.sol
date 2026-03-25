// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISybilGuard.sol";

/**
 * @title SoulboundSybilGuard
 * @notice Adapter: SoulboundIdentity → ISybilGuard interface.
 * @dev Wraps SoulboundIdentity.hasIdentity() to protect ShapleyDistributor's
 *      Lawson Floor from sybil splitting attacks.
 *
 *      Found by adversarial search (Layer 3, session 2026-03-25):
 *      200/200 rounds showed profitable sybil splitting of the 1% floor.
 *      This adapter closes the gap.
 */

interface ISoulboundIdentity {
    function hasIdentity(address addr) external view returns (bool);
}

contract SoulboundSybilGuard is ISybilGuard {
    ISoulboundIdentity public immutable identity;

    constructor(address _identity) {
        require(_identity != address(0), "Zero address");
        identity = ISoulboundIdentity(_identity);
    }

    /// @inheritdoc ISybilGuard
    function isUniqueIdentity(address addr) external view override returns (bool) {
        return identity.hasIdentity(addr);
    }
}
