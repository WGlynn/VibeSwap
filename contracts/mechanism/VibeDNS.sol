// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeDNS — Decentralized Name Service
 * @notice ENS alternative — human-readable names for addresses, contracts, and IPFS content.
 *         Integrated with VSOS identity layer (SoulboundIdentity, VibeCode).
 *
 * @dev Features:
 *      - Name registration with annual renewal
 *      - Subdomains (e.g., app.vibeswap.vibe)
 *      - Content resolution (IPFS, Arweave, on-chain)
 *      - Reverse resolution (address → name)
 *      - Transfer and trade names
 */
contract VibeDNS is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant REGISTRATION_PERIOD = 365 days;
    uint256 public constant GRACE_PERIOD = 30 days;

    // ============ Types ============

    struct NameRecord {
        bytes32 nameHash;
        address owner;
        address resolvedAddress;
        bytes32 contentHash;        // IPFS/Arweave content hash
        uint256 registeredAt;
        uint256 expiresAt;
        bool active;
    }

    struct SubdomainRecord {
        bytes32 parentHash;
        bytes32 subHash;
        address owner;
        address resolvedAddress;
        bool active;
    }

    // ============ State ============

    /// @notice Name records: nameHash => NameRecord
    mapping(bytes32 => NameRecord) public names;

    /// @notice Subdomain records: subdomainHash => SubdomainRecord
    mapping(bytes32 => SubdomainRecord) public subdomains;

    /// @notice Reverse resolution: address => nameHash
    mapping(address => bytes32) public reverseRecords;

    /// @notice Registration price per character length tier
    mapping(uint256 => uint256) public registrationPrice;

    /// @notice Total names registered
    uint256 public totalNames;
    uint256 public totalSubdomains;

    /// @notice Revenue collected
    uint256 public totalRevenue;

    // ============ Events ============

    event NameRegistered(bytes32 indexed nameHash, address indexed owner, uint256 expiresAt);
    event NameRenewed(bytes32 indexed nameHash, uint256 newExpiry);
    event NameTransferred(bytes32 indexed nameHash, address indexed from, address indexed to);
    event AddressSet(bytes32 indexed nameHash, address resolvedAddress);
    event ContentSet(bytes32 indexed nameHash, bytes32 contentHash);
    event ReverseRecordSet(address indexed addr, bytes32 indexed nameHash);
    event SubdomainCreated(bytes32 indexed parentHash, bytes32 indexed subHash, address owner);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        // Price tiers: shorter names cost more
        registrationPrice[3] = 0.1 ether;    // 3-char names
        registrationPrice[4] = 0.05 ether;   // 4-char names
        registrationPrice[5] = 0.01 ether;   // 5+ char names
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Registration ============

    function registerName(
        string calldata name,
        address resolveAddr
    ) external payable nonReentrant returns (bytes32) {
        require(bytes(name).length >= MIN_NAME_LENGTH, "Name too short");

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        NameRecord storage record = names[nameHash];

        // Check availability
        require(
            !record.active || block.timestamp > record.expiresAt + GRACE_PERIOD,
            "Name taken"
        );

        // Calculate price
        uint256 price = _getPrice(bytes(name).length);
        require(msg.value >= price, "Insufficient payment");

        uint256 expiry = block.timestamp + REGISTRATION_PERIOD;

        names[nameHash] = NameRecord({
            nameHash: nameHash,
            owner: msg.sender,
            resolvedAddress: resolveAddr,
            contentHash: bytes32(0),
            registeredAt: block.timestamp,
            expiresAt: expiry,
            active: true
        });

        totalNames++;
        totalRevenue += price;

        // Refund excess
        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok, "Refund failed");
        }

        emit NameRegistered(nameHash, msg.sender, expiry);
        return nameHash;
    }

    function renewName(bytes32 nameHash) external payable nonReentrant {
        NameRecord storage record = names[nameHash];
        require(record.active, "Not registered");
        require(record.owner == msg.sender, "Not owner");
        require(block.timestamp <= record.expiresAt + GRACE_PERIOD, "Expired past grace");

        uint256 price = 0.01 ether; // Flat renewal fee
        require(msg.value >= price, "Insufficient payment");

        record.expiresAt += REGISTRATION_PERIOD;
        totalRevenue += price;

        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok, "Refund failed");
        }

        emit NameRenewed(nameHash, record.expiresAt);
    }

    // ============ Resolution ============

    function setAddress(bytes32 nameHash, address addr) external {
        require(_isOwner(nameHash, msg.sender), "Not owner");
        names[nameHash].resolvedAddress = addr;
        emit AddressSet(nameHash, addr);
    }

    function setContent(bytes32 nameHash, bytes32 contentHash) external {
        require(_isOwner(nameHash, msg.sender), "Not owner");
        names[nameHash].contentHash = contentHash;
        emit ContentSet(nameHash, contentHash);
    }

    function setReverseRecord(bytes32 nameHash) external {
        require(_isOwner(nameHash, msg.sender), "Not owner");
        require(names[nameHash].resolvedAddress == msg.sender, "Address mismatch");
        reverseRecords[msg.sender] = nameHash;
        emit ReverseRecordSet(msg.sender, nameHash);
    }

    // ============ Transfer ============

    function transferName(bytes32 nameHash, address to) external {
        require(_isOwner(nameHash, msg.sender), "Not owner");
        require(to != address(0), "Zero address");

        address from = names[nameHash].owner;
        names[nameHash].owner = to;

        emit NameTransferred(nameHash, from, to);
    }

    // ============ Subdomains ============

    function createSubdomain(
        bytes32 parentHash,
        string calldata subName,
        address resolveAddr
    ) external returns (bytes32) {
        require(_isOwner(parentHash, msg.sender), "Not parent owner");

        bytes32 subHash = keccak256(abi.encodePacked(parentHash, subName));

        subdomains[subHash] = SubdomainRecord({
            parentHash: parentHash,
            subHash: subHash,
            owner: msg.sender,
            resolvedAddress: resolveAddr,
            active: true
        });

        totalSubdomains++;
        emit SubdomainCreated(parentHash, subHash, msg.sender);
        return subHash;
    }

    function removeSubdomain(bytes32 subHash) external {
        SubdomainRecord storage sub = subdomains[subHash];
        require(sub.active, "Not active");
        require(
            sub.owner == msg.sender || _isOwner(sub.parentHash, msg.sender),
            "Not authorized"
        );
        sub.active = false;
    }

    // ============ Admin ============

    function setRegistrationPrice(uint256 length, uint256 price) external onlyOwner {
        registrationPrice[length] = price;
    }

    function withdrawRevenue() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "No revenue");
        (bool ok, ) = owner().call{value: bal}("");
        require(ok, "Withdraw failed");
    }

    // ============ Internal ============

    function _isOwner(bytes32 nameHash, address addr) internal view returns (bool) {
        NameRecord storage record = names[nameHash];
        return record.active && record.owner == addr && block.timestamp <= record.expiresAt;
    }

    function _getPrice(uint256 length) internal view returns (uint256) {
        if (length <= 3) return registrationPrice[3];
        if (length <= 4) return registrationPrice[4];
        return registrationPrice[5];
    }

    // ============ View ============

    function resolve(bytes32 nameHash) external view returns (address) {
        NameRecord storage record = names[nameHash];
        if (!record.active || block.timestamp > record.expiresAt) return address(0);
        return record.resolvedAddress;
    }

    function resolveContent(bytes32 nameHash) external view returns (bytes32) {
        NameRecord storage record = names[nameHash];
        if (!record.active || block.timestamp > record.expiresAt) return bytes32(0);
        return record.contentHash;
    }

    function reverseLookup(address addr) external view returns (bytes32) {
        return reverseRecords[addr];
    }

    function isAvailable(bytes32 nameHash) external view returns (bool) {
        NameRecord storage record = names[nameHash];
        return !record.active || block.timestamp > record.expiresAt + GRACE_PERIOD;
    }

    receive() external payable {
        totalRevenue += msg.value;
    }
}
