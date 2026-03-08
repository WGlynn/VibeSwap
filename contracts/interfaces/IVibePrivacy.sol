// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibePrivacy — Unified Privacy Interface for VSOS
 * @notice Backed by StealthAddress (Monero-inspired).
 *         Private transactions on EVM without sacrificing composability.
 */
interface IVibePrivacy {
    /// @notice Register stealth meta-address for receiving private payments
    function registerStealthMeta(bytes calldata spendingPubKey, bytes calldata viewingPubKey) external;

    /// @notice Send ETH to a stealth address
    function sendStealth(address stealthAddress, bytes calldata ephemeralPubKey, bytes32 viewTag) external payable;

    /// @notice Send ERC20 to a stealth address
    function sendStealthToken(address token, uint256 amount, address stealthAddress, bytes calldata ephemeralPubKey, bytes32 viewTag) external;

    /// @notice Get stealth meta-address for a user
    function getStealthMeta(address owner) external view returns (bytes memory spendingPubKey, bytes memory viewingPubKey);

    /// @notice Get announcement count for scanning
    function announcementCount() external view returns (uint256);
}
