// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title IVibeForwarder
 * @notice Gasless meta-transaction forwarder with relayer management.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Extends OpenZeppelin's ERC2771Forwarder with:
 *           - Relayer registry (permissioned or open)
 *           - JUL tips for relayers per successful forwarding
 *           - Per-user rate limiting (prevents spam via relayer)
 *           - Reputation-gated access (min trust tier to use gasless)
 *
 *         Architecture:
 *           1. User signs EIP-712 ForwardRequest off-chain
 *           2. Relayer submits signed request to VibeForwarder
 *           3. Forwarder validates, appends user address to calldata
 *           4. Target contract uses _msgSender() via ERC2771Context
 *           5. Relayer earns JUL tip for successful forwarding
 *
 *         Target contracts must:
 *           - Inherit OpenZeppelin ERC2771Context
 *           - Set this forwarder as their trustedForwarder
 *           - Use _msgSender() instead of msg.sender
 */
interface IVibeForwarder {
    // ============ Structs ============

    /// @notice Registered relayer
    struct RelayerInfo {
        bool active;              // can forward requests
        uint40 registeredAt;      // registration timestamp
        uint256 totalForwarded;   // lifetime successful forwards
        uint256 totalEarned;      // lifetime JUL earned
    }

    // ============ Events ============

    event RelayerRegistered(address indexed relayer);
    event RelayerDeactivated(address indexed relayer);
    event RelayerReactivated(address indexed relayer);
    event RequestForwarded(address indexed relayer, address indexed from, address indexed to, bool success);
    event BatchForwarded(address indexed relayer, uint256 count, uint256 succeeded);
    event RelayerTipUpdated(uint256 newTip);
    event MinTrustTierUpdated(uint8 newTier);
    event UserRateLimitUpdated(uint32 newLimit);
    event OpenRelayingUpdated(bool open);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event TargetWhitelisted(address indexed target, bool status);

    // ============ Errors ============

    error NotActiveRelayer();
    error AlreadyRegistered();
    error NotRegistered();
    error UserRateLimited();
    error InsufficientTrustTier();
    error TargetNotWhitelisted();
    error ZeroAddress();
    error ZeroAmount();

    // ============ Relayer Functions ============

    function registerRelayer() external;
    function deactivateRelayer() external;

    // ============ Admin Functions ============

    function setRelayerTip(uint256 tip) external;
    function setMinTrustTier(uint8 tier) external;
    function setUserRateLimit(uint32 requestsPerHour) external;
    function setOpenRelaying(bool open) external;
    function setTargetWhitelist(address target, bool status) external;
    function depositJulRewards(uint256 amount) external;

    // ============ View Functions ============

    function getRelayer(address relayer) external view returns (RelayerInfo memory);
    function isActiveRelayer(address relayer) external view returns (bool);
    function relayerTip() external view returns (uint256);
    function minTrustTier() external view returns (uint8);
    function userRateLimit() external view returns (uint32);
    function openRelaying() external view returns (bool);
    function julRewardPool() external view returns (uint256);
    function userRequestCount(address user) external view returns (uint256);
    function isTargetWhitelisted(address target) external view returns (bool);
}
