// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeRegistry — Protocol Contract Registry
 * @notice Central registry for all VSOS contract addresses.
 *         Enables upgradeable contract discovery and versioning.
 *         All VSOS contracts can look up each other via this registry.
 */
contract VibeRegistry is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct ContractRecord {
        string name;
        address implementation;
        address proxy;
        uint256 version;
        uint256 registeredAt;
        uint256 updatedAt;
        bool active;
        string category;          // "core", "financial", "mechanism", etc.
    }

    // ============ State ============

    /// @notice Contract records by name hash
    mapping(bytes32 => ContractRecord) public contracts;
    bytes32[] public contractKeys;

    /// @notice Version history: nameHash => version => address
    mapping(bytes32 => mapping(uint256 => address)) public versionHistory;

    /// @notice Category index: category => nameHashes
    mapping(string => bytes32[]) public categoryIndex;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ContractRegistered(string name, address implementation, address proxy, string category);
    event ContractUpdated(string name, address newImplementation, uint256 newVersion);
    event ContractDeactivated(string name);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Registry ============

    function register(
        string calldata name,
        address implementation,
        address proxy,
        string calldata category
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(name));
        require(!contracts[key].active, "Already registered");

        contracts[key] = ContractRecord({
            name: name,
            implementation: implementation,
            proxy: proxy,
            version: 1,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            active: true,
            category: category
        });

        contractKeys.push(key);
        categoryIndex[category].push(key);
        versionHistory[key][1] = implementation;

        emit ContractRegistered(name, implementation, proxy, category);
    }

    function update(
        string calldata name,
        address newImplementation
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(name));
        ContractRecord storage record = contracts[key];
        require(record.active, "Not registered");

        record.version++;
        record.implementation = newImplementation;
        record.updatedAt = block.timestamp;

        versionHistory[key][record.version] = newImplementation;

        emit ContractUpdated(name, newImplementation, record.version);
    }

    function deactivate(string calldata name) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(name));
        contracts[key].active = false;
        emit ContractDeactivated(name);
    }

    // ============ View ============

    function getAddress(string calldata name) external view returns (address) {
        bytes32 key = keccak256(abi.encodePacked(name));
        return contracts[key].proxy != address(0) ? contracts[key].proxy : contracts[key].implementation;
    }

    function getImplementation(string calldata name) external view returns (address) {
        return contracts[keccak256(abi.encodePacked(name))].implementation;
    }

    function getVersion(string calldata name) external view returns (uint256) {
        return contracts[keccak256(abi.encodePacked(name))].version;
    }

    function getContractCount() external view returns (uint256) {
        return contractKeys.length;
    }

    function getCategoryContracts(string calldata category) external view returns (bytes32[] memory) {
        return categoryIndex[category];
    }

    function getVersionHistory(string calldata name, uint256 version) external view returns (address) {
        return versionHistory[keccak256(abi.encodePacked(name))][version];
    }
}
