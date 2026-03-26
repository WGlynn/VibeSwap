// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeNameService — .vibe Domain Names On-Chain
 * @notice Human-readable names for wallet addresses.
 *         Send to "will.vibe" instead of 0x742d35...
 *
 * Features:
 * - Register name.vibe domains
 * - Set resolver records (ETH address, content hash, text records)
 * - Reverse resolution (address → name)
 * - Annual renewal (prevents squatting)
 * - Subdomains (team.will.vibe)
 */
contract VibeNameService is OwnableUpgradeable, UUPSUpgradeable {

    struct Domain {
        address owner;
        address resolver;            // Address this name resolves to
        uint256 registeredAt;
        uint256 expiresAt;
        string contentHash;          // IPFS content hash
        mapping(string => string) textRecords;
    }

    // ============ State ============

    mapping(bytes32 => Domain) private domains;
    mapping(address => bytes32) public reverseRecords;
    mapping(bytes32 => mapping(bytes32 => address)) public subdomains;

    uint256 public constant REGISTRATION_FEE = 0.01 ether;
    uint256 public constant RENEWAL_FEE = 0.005 ether;
    uint256 public constant REGISTRATION_PERIOD = 365 days;
    uint256 public constant MIN_NAME_LENGTH = 3;

    uint256 public totalRegistered;
    uint256 public protocolFees;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event NameRegistered(bytes32 indexed nameHash, string name, address owner, uint256 expiresAt);
    event NameRenewed(bytes32 indexed nameHash, uint256 newExpiry);
    event ResolverSet(bytes32 indexed nameHash, address resolver);
    event ReverseRecordSet(address indexed addr, bytes32 nameHash);
    event ContentHashSet(bytes32 indexed nameHash, string contentHash);
    event TextRecordSet(bytes32 indexed nameHash, string key, string value);
    event SubdomainRegistered(bytes32 indexed parent, bytes32 indexed sub, address owner);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Registration ============

    function register(string calldata name) external payable {
        require(bytes(name).length >= MIN_NAME_LENGTH, "Name too short");
        require(msg.value >= REGISTRATION_FEE, "Insufficient fee");

        bytes32 nameHash = keccak256(bytes(name));
        Domain storage d = domains[nameHash];

        // Allow re-registration if expired
        require(d.owner == address(0) || block.timestamp > d.expiresAt, "Name taken");

        d.owner = msg.sender;
        d.resolver = msg.sender;
        d.registeredAt = block.timestamp;
        d.expiresAt = block.timestamp + REGISTRATION_PERIOD;

        totalRegistered++;
        protocolFees += msg.value;

        emit NameRegistered(nameHash, name, msg.sender, d.expiresAt);
    }

    function renew(bytes32 nameHash) external payable {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        require(msg.value >= RENEWAL_FEE, "Insufficient fee");

        d.expiresAt += REGISTRATION_PERIOD;
        protocolFees += msg.value;

        emit NameRenewed(nameHash, d.expiresAt);
    }

    // ============ Resolution ============

    function setResolver(bytes32 nameHash, address resolver) external {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        require(block.timestamp <= d.expiresAt, "Expired");
        d.resolver = resolver;
        emit ResolverSet(nameHash, resolver);
    }

    function setReverseRecord(bytes32 nameHash) external {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        reverseRecords[msg.sender] = nameHash;
        emit ReverseRecordSet(msg.sender, nameHash);
    }

    function setContentHash(bytes32 nameHash, string calldata hash) external {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        d.contentHash = hash;
        emit ContentHashSet(nameHash, hash);
    }

    function setTextRecord(bytes32 nameHash, string calldata key, string calldata value) external {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        d.textRecords[key] = value;
        emit TextRecordSet(nameHash, key, value);
    }

    // ============ Subdomains ============

    function registerSubdomain(bytes32 parentHash, string calldata sub, address owner_) external {
        Domain storage parent = domains[parentHash];
        require(parent.owner == msg.sender, "Not parent owner");
        bytes32 subHash = keccak256(bytes(sub));
        subdomains[parentHash][subHash] = owner_;
        emit SubdomainRegistered(parentHash, subHash, owner_);
    }

    // ============ Transfer ============

    function transfer(bytes32 nameHash, address newOwner) external {
        Domain storage d = domains[nameHash];
        require(d.owner == msg.sender, "Not owner");
        d.owner = newOwner;
    }

    // ============ Views ============

    function resolve(bytes32 nameHash) external view returns (address) {
        Domain storage d = domains[nameHash];
        if (block.timestamp > d.expiresAt) return address(0);
        return d.resolver;
    }

    function resolveName(string calldata name) external view returns (address) {
        bytes32 nameHash = keccak256(bytes(name));
        Domain storage d = domains[nameHash];
        if (block.timestamp > d.expiresAt) return address(0);
        return d.resolver;
    }

    function reverseLookup(address addr) external view returns (bytes32) {
        return reverseRecords[addr];
    }

    function getDomainOwner(bytes32 nameHash) external view returns (address) {
        return domains[nameHash].owner;
    }

    function getDomainExpiry(bytes32 nameHash) external view returns (uint256) {
        return domains[nameHash].expiresAt;
    }

    function isAvailable(string calldata name) external view returns (bool) {
        bytes32 nameHash = keccak256(bytes(name));
        Domain storage d = domains[nameHash];
        return d.owner == address(0) || block.timestamp > d.expiresAt;
    }

    function withdrawFees() external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    receive() external payable {}
}
