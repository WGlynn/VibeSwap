// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeAppStore — DeFi Lego App Marketplace Interface
 * @notice Compose protocol modules into custom setups without code.
 */
interface IVibeAppStore {
    /// @notice Install an app configuration
    function installApp(uint256 configId, bytes[] calldata customParams) external payable returns (uint256 setupId);

    /// @notice Get app details
    function configs(uint256 configId) external view returns (
        uint256 configId_,
        address creator,
        string memory name,
        string memory description,
        uint256 installCount,
        uint256 rating,
        uint256 ratingCount,
        uint256 price,
        uint256 createdAt,
        bool active,
        bool verified
    );

    /// @notice Get user's installed setups
    function getUserSetups(address user) external view returns (uint256[] memory);

    /// @notice Get featured apps
    function getFeaturedApps() external view returns (uint256[] memory);
}
