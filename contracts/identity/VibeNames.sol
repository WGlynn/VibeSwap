// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeNames
 * @notice ENS-compatible naming system for the VSOS ecosystem (.vibe TLD).
 *         One-time registration fee, no rent-seeking renewals.
 *         Once registered, a name is yours forever.
 * @dev Registration fee scales by name length:
 *      3 chars = 0.1 ETH, 4 chars = 0.01 ETH, 5+ chars = 0.001 ETH.
 *      Fees are forwarded to the protocol treasury.
 */
contract VibeNames is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Structs ============

    struct NameRecord {
        address owner;
        address resolvedAddress;
        uint256 registeredAt;
        string avatar;
    }

    // ============ Constants ============

    uint256 public constant FEE_3_CHAR = 0.1 ether;
    uint256 public constant FEE_4_CHAR = 0.01 ether;
    uint256 public constant FEE_5_PLUS = 0.001 ether;
    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 64;

    // ============ State ============

    /// @notice name hash => NameRecord (text records stored separately due to nested mapping)
    mapping(bytes32 => NameRecord) private _records;

    /// @notice name hash => key => value (text records)
    mapping(bytes32 => mapping(string => string)) private _textRecords;

    /// @notice address => name (for reverse resolution)
    mapping(address => string) private _reverseRecords;

    /// @notice Protocol treasury that receives registration fees
    address public treasury;

    // ============ Events ============

    event NameRegistered(string indexed nameHash, string name, address indexed owner, address resolvedAddress);
    event AddressChanged(string indexed nameHash, string name, address indexed newAddress);
    event TextRecordSet(string indexed nameHash, string name, string key, string value);
    event AvatarSet(string indexed nameHash, string name, string avatar);
    event NameTransferred(string indexed nameHash, string name, address indexed from, address indexed to);

    // ============ Errors ============

    error NameTooShort();
    error NameTooLong();
    error NameNotAvailable();
    error InsufficientFee(uint256 required, uint256 sent);
    error NotNameOwner();
    error InvalidAddress();
    error InvalidName();
    error TreasuryNotSet();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _treasury) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    // ============ Registration ============

    /**
     * @notice Register a name.vibe with a one-time fee. No renewals ever.
     * @param name The name to register (without .vibe suffix)
     * @param resolvedAddress The address this name should resolve to
     */
    function register(string calldata name, address resolvedAddress) external payable nonReentrant {
        _validateName(name);
        if (resolvedAddress == address(0)) revert InvalidAddress();

        bytes32 nameHash = _nameHash(name);
        if (_records[nameHash].owner != address(0)) revert NameNotAvailable();

        uint256 fee = getRegistrationFee(name);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        _records[nameHash] = NameRecord({
            owner: msg.sender,
            resolvedAddress: resolvedAddress,
            registeredAt: block.timestamp,
            avatar: ""
        });

        _reverseRecords[resolvedAddress] = name;

        // Forward fee to treasury
        if (treasury == address(0)) revert TreasuryNotSet();
        (bool sent, ) = treasury.call{value: fee}("");
        require(sent, "Fee transfer failed");

        // Refund excess
        uint256 excess = msg.value - fee;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}("");
            require(refunded, "Refund failed");
        }

        emit NameRegistered(name, name, msg.sender, resolvedAddress);
    }

    // ============ Owner Functions ============

    /**
     * @notice Update the address a name resolves to
     * @param name The name to update
     * @param newAddress The new resolved address
     */
    function setAddress(string calldata name, address newAddress) external {
        if (newAddress == address(0)) revert InvalidAddress();
        bytes32 nameHash = _nameHash(name);
        if (_records[nameHash].owner != msg.sender) revert NotNameOwner();

        // Clear old reverse record
        address oldAddress = _records[nameHash].resolvedAddress;
        if (bytes(_reverseRecords[oldAddress]).length > 0) {
            delete _reverseRecords[oldAddress];
        }

        _records[nameHash].resolvedAddress = newAddress;
        _reverseRecords[newAddress] = name;

        emit AddressChanged(name, name, newAddress);
    }

    /**
     * @notice Set a text record for a name
     * @param name The name to update
     * @param key The text record key (e.g., "email", "url", "com.twitter")
     * @param value The text record value
     */
    function setTextRecord(string calldata name, string calldata key, string calldata value) external {
        bytes32 nameHash = _nameHash(name);
        if (_records[nameHash].owner != msg.sender) revert NotNameOwner();

        _textRecords[nameHash][key] = value;

        emit TextRecordSet(name, name, key, value);
    }

    /**
     * @notice Set the avatar URI for a name
     * @param name The name to update
     * @param avatar The avatar URI (e.g., IPFS hash)
     */
    function setAvatar(string calldata name, string calldata avatar) external {
        bytes32 nameHash = _nameHash(name);
        if (_records[nameHash].owner != msg.sender) revert NotNameOwner();

        _records[nameHash].avatar = avatar;

        emit AvatarSet(name, name, avatar);
    }

    /**
     * @notice Transfer ownership of a name to a new address
     * @param name The name to transfer
     * @param newOwner The new owner address
     */
    function transfer(string calldata name, address newOwner) external {
        if (newOwner == address(0)) revert InvalidAddress();
        bytes32 nameHash = _nameHash(name);
        if (_records[nameHash].owner != msg.sender) revert NotNameOwner();

        address oldOwner = _records[nameHash].owner;
        _records[nameHash].owner = newOwner;

        emit NameTransferred(name, name, oldOwner, newOwner);
    }

    // ============ Resolution ============

    /**
     * @notice Resolve a name to its address
     * @param name The name to resolve
     * @return The resolved address (address(0) if not registered)
     */
    function resolve(string calldata name) external view returns (address) {
        return _records[_nameHash(name)].resolvedAddress;
    }

    /**
     * @notice Reverse resolve an address to its primary name
     * @param addr The address to look up
     * @return The associated name (empty string if none)
     */
    function reverseResolve(address addr) external view returns (string memory) {
        return _reverseRecords[addr];
    }

    /**
     * @notice Get a text record for a name
     * @param name The name to query
     * @param key The text record key
     * @return The text record value
     */
    function getTextRecord(string calldata name, string calldata key) external view returns (string memory) {
        return _textRecords[_nameHash(name)][key];
    }

    /**
     * @notice Check if a name is available for registration
     * @param name The name to check
     * @return True if the name can be registered
     */
    function isAvailable(string calldata name) external view returns (bool) {
        return _records[_nameHash(name)].owner == address(0);
    }

    // ============ Fee Calculation ============

    /**
     * @notice Get the registration fee for a name based on its length
     * @param name The name to price
     * @return The fee in wei
     */
    function getRegistrationFee(string calldata name) public pure returns (uint256) {
        uint256 len = bytes(name).length;
        if (len == 3) return FEE_3_CHAR;
        if (len == 4) return FEE_4_CHAR;
        return FEE_5_PLUS;
    }

    /**
     * @notice Get the full record for a name
     * @param name The name to query
     * @return owner The name owner
     * @return resolvedAddress The resolved address
     * @return registeredAt Registration timestamp
     * @return avatar The avatar URI
     */
    function getRecord(string calldata name) external view returns (
        address owner,
        address resolvedAddress,
        uint256 registeredAt,
        string memory avatar
    ) {
        NameRecord storage record = _records[_nameHash(name)];
        return (record.owner, record.resolvedAddress, record.registeredAt, record.avatar);
    }

    // ============ Admin ============

    /**
     * @notice Update the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    // ============ Internal ============

    function _nameHash(string calldata name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(name));
    }

    function _validateName(string calldata name) internal pure {
        uint256 len = bytes(name).length;
        if (len < MIN_NAME_LENGTH) revert NameTooShort();
        if (len > MAX_NAME_LENGTH) revert NameTooLong();

        // Only allow lowercase alphanumeric and hyphens
        bytes memory nameBytes = bytes(name);
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = nameBytes[i];
            bool isLower = (c >= 0x61 && c <= 0x7A);  // a-z
            bool isDigit = (c >= 0x30 && c <= 0x39);   // 0-9
            bool isHyphen = (c == 0x2D);                // -
            if (!isLower && !isDigit && !isHyphen) revert InvalidName();
        }

        // Cannot start or end with hyphen
        if (nameBytes[0] == 0x2D || nameBytes[len - 1] == 0x2D) revert InvalidName();
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
