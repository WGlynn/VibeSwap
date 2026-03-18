// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal interface for ComplianceRegistry checks
interface IStealthComplianceRegistry {
    function isInGoodStanding(address user) external view returns (bool);
}

/**
 * @title StealthAddress
 * @notice Monero-inspired stealth address system for private transactions on EVM
 * @dev Senders can send funds to recipients without anyone on-chain being able to link
 *      sender to recipient. The heavy crypto (ECDH, key derivation) happens off-chain.
 *      This contract handles on-chain registry, fund custody, and announcement log.
 *
 *      Flow:
 *      1. Recipient publishes stealth meta-address (spending + viewing public keys)
 *      2. Sender derives one-time stealth address off-chain using ECDH
 *      3. Sender sends funds to stealth address via this contract + publishes announcement
 *      4. Recipient scans announcements using viewing key, derives matching private key
 *      5. Recipient withdraws from the stealth address
 */
contract StealthAddress is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Custom Errors ============

    error InvalidPubKeyLength();
    error MetaAddressAlreadyRegistered();
    error MetaAddressNotRegistered();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error ComplianceCheckFailed();
    error IndexOutOfBounds();

    // ============ Structs ============

    struct StealthMetaAddress {
        address owner;
        bytes spendingPubKey;       // Public key for spending (33 bytes compressed)
        bytes viewingPubKey;        // Public key for viewing (33 bytes compressed)
        uint256 registeredAt;
    }

    struct StealthAnnouncement {
        address stealthAddress;     // The one-time address funds were sent to
        bytes ephemeralPubKey;      // Sender's ephemeral public key
        bytes32 viewTag;            // First 32 bytes of shared secret (for fast scanning)
        address token;              // address(0) for ETH, ERC20 address otherwise
        uint256 amount;
        uint256 timestamp;
    }

    // ============ Constants ============

    uint256 private constant COMPRESSED_PUBKEY_LENGTH = 33;

    // ============ State Variables ============

    /// @notice Stealth meta-address registry: owner => meta-address
    mapping(address => StealthMetaAddress) private _metaAddresses;

    /// @notice Stealth address balances: stealthAddress => token => amount
    /// @dev token address(0) represents ETH
    mapping(address => mapping(address => uint256)) private _stealthBalances;

    /// @notice Chronological log of all stealth announcements
    StealthAnnouncement[] private _announcements;

    /// @notice Optional compliance registry (address(0) = no compliance checks)
    IStealthComplianceRegistry public complianceRegistry;

    /// @notice Gap for future upgrades
    uint256[46] private __gap;

    // ============ Events ============

    event StealthMetaAddressRegistered(
        address indexed owner,
        bytes spendingPubKey,
        bytes viewingPubKey
    );

    event StealthMetaAddressUpdated(
        address indexed owner,
        bytes spendingPubKey,
        bytes viewingPubKey
    );

    event StealthPayment(
        address indexed stealthAddress,
        bytes ephemeralPubKey,
        bytes32 indexed viewTag,
        address indexed token,
        uint256 amount
    );

    event StealthWithdrawal(
        address indexed stealthAddress,
        address indexed token,
        uint256 amount,
        address indexed recipient
    );

    event ComplianceRegistryUpdated(address indexed registry);

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the stealth address contract
     * @param _owner Contract owner (can set compliance registry)
     * @param _complianceRegistry Optional compliance registry (address(0) to disable)
     */
    function initialize(
        address _owner,
        address _complianceRegistry
    ) external initializer {
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        if (_complianceRegistry != address(0)) {
            complianceRegistry = IStealthComplianceRegistry(_complianceRegistry);
        }
    }

    // ============ Registration ============

    /**
     * @notice Register a stealth meta-address (spending key + viewing key)
     * @dev Keys are 33-byte compressed secp256k1 public keys
     * @param spendingPubKey Compressed public key for spending authorization
     * @param viewingPubKey Compressed public key for scanning announcements
     */
    function registerStealthMeta(
        bytes calldata spendingPubKey,
        bytes calldata viewingPubKey
    ) external {
        if (spendingPubKey.length != COMPRESSED_PUBKEY_LENGTH) revert InvalidPubKeyLength();
        if (viewingPubKey.length != COMPRESSED_PUBKEY_LENGTH) revert InvalidPubKeyLength();

        _checkCompliance(msg.sender);

        bool isUpdate = _metaAddresses[msg.sender].registeredAt != 0;

        _metaAddresses[msg.sender] = StealthMetaAddress({
            owner: msg.sender,
            spendingPubKey: spendingPubKey,
            viewingPubKey: viewingPubKey,
            registeredAt: block.timestamp
        });

        if (isUpdate) {
            emit StealthMetaAddressUpdated(msg.sender, spendingPubKey, viewingPubKey);
        } else {
            emit StealthMetaAddressRegistered(msg.sender, spendingPubKey, viewingPubKey);
        }
    }

    // ============ Sending ============

    /**
     * @notice Send ETH to a stealth address
     * @dev Sender computes the stealth address off-chain via ECDH with recipient's meta-address
     * @param stealthAddress The one-time stealth address derived off-chain
     * @param ephemeralPubKey Sender's ephemeral public key (for recipient to derive shared secret)
     * @param viewTag First 32 bytes of shared secret hash (for fast announcement scanning)
     */
    function sendStealth(
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes32 viewTag
    ) external payable nonReentrant {
        if (stealthAddress == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();
        if (ephemeralPubKey.length != COMPRESSED_PUBKEY_LENGTH) revert InvalidPubKeyLength();

        _checkCompliance(msg.sender);

        _stealthBalances[stealthAddress][address(0)] += msg.value;

        _announcements.push(StealthAnnouncement({
            stealthAddress: stealthAddress,
            ephemeralPubKey: ephemeralPubKey,
            viewTag: viewTag,
            token: address(0),
            amount: msg.value,
            timestamp: block.timestamp
        }));

        emit StealthPayment(stealthAddress, ephemeralPubKey, viewTag, address(0), msg.value);
    }

    /**
     * @notice Send ERC20 tokens to a stealth address
     * @dev Sender computes the stealth address off-chain via ECDH with recipient's meta-address
     * @param token ERC20 token address
     * @param amount Amount of tokens to send
     * @param stealthAddress The one-time stealth address derived off-chain
     * @param ephemeralPubKey Sender's ephemeral public key
     * @param viewTag First 32 bytes of shared secret hash (for fast announcement scanning)
     */
    function sendStealthToken(
        address token,
        uint256 amount,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes32 viewTag
    ) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (stealthAddress == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (ephemeralPubKey.length != COMPRESSED_PUBKEY_LENGTH) revert InvalidPubKeyLength();

        _checkCompliance(msg.sender);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        _stealthBalances[stealthAddress][token] += amount;

        _announcements.push(StealthAnnouncement({
            stealthAddress: stealthAddress,
            ephemeralPubKey: ephemeralPubKey,
            viewTag: viewTag,
            token: token,
            amount: amount,
            timestamp: block.timestamp
        }));

        emit StealthPayment(stealthAddress, ephemeralPubKey, viewTag, token, amount);
    }

    // ============ Withdrawal ============

    /**
     * @notice Withdraw funds from a stealth address
     * @dev msg.sender must be the stealth address itself (recipient derived the private key off-chain)
     * @param stealthAddress The stealth address to withdraw from (must equal msg.sender)
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to withdraw
     * @param recipient Destination address for withdrawn funds
     */
    function withdrawFromStealth(
        address stealthAddress,
        address token,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        if (msg.sender != stealthAddress) revert ZeroAddress();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (_stealthBalances[stealthAddress][token] < amount) revert InsufficientBalance();

        _stealthBalances[stealthAddress][token] -= amount;

        if (token == address(0)) {
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit StealthWithdrawal(stealthAddress, token, amount, recipient);
    }

    // ============ View Functions ============

    /**
     * @notice Get a user's stealth meta-address
     * @param owner The address that registered the meta-address
     * @return The stealth meta-address struct
     */
    function getStealthMeta(address owner) external view returns (StealthMetaAddress memory) {
        if (_metaAddresses[owner].registeredAt == 0) revert MetaAddressNotRegistered();
        return _metaAddresses[owner];
    }

    /**
     * @notice Get paginated stealth announcements
     * @param fromIndex Starting index in the announcement log
     * @param count Number of announcements to return
     * @return Array of stealth announcements
     */
    function getAnnouncements(
        uint256 fromIndex,
        uint256 count
    ) external view returns (StealthAnnouncement[] memory) {
        uint256 total = _announcements.length;
        if (fromIndex >= total) {
            return new StealthAnnouncement[](0);
        }

        uint256 end = fromIndex + count;
        if (end > total) {
            end = total;
        }

        uint256 resultCount = end - fromIndex;
        StealthAnnouncement[] memory result = new StealthAnnouncement[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            result[i] = _announcements[fromIndex + i];
        }
        return result;
    }

    /**
     * @notice Get total number of stealth announcements
     * @return Total announcement count
     */
    function announcementCount() external view returns (uint256) {
        return _announcements.length;
    }

    /**
     * @notice Get the balance held for a stealth address
     * @param stealthAddress The stealth address
     * @param token Token address (address(0) for ETH)
     * @return Balance amount
     */
    function stealthBalance(
        address stealthAddress,
        address token
    ) external view returns (uint256) {
        return _stealthBalances[stealthAddress][token];
    }

    /**
     * @notice Check if an address has a registered stealth meta-address
     * @param owner Address to check
     * @return True if registered
     */
    function isRegistered(address owner) external view returns (bool) {
        return _metaAddresses[owner].registeredAt != 0;
    }

    // ============ Admin ============

    /**
     * @notice Update the compliance registry
     * @param _complianceRegistry New compliance registry address (address(0) to disable)
     */
    function setComplianceRegistry(address _complianceRegistry) external onlyOwner {
        complianceRegistry = IStealthComplianceRegistry(_complianceRegistry);
        emit ComplianceRegistryUpdated(_complianceRegistry);
    }

    // ============ Internal ============

    /**
     * @notice Check compliance if registry is set
     * @param user Address to check
     */
    function _checkCompliance(address user) internal view {
        if (address(complianceRegistry) != address(0)) {
            if (!complianceRegistry.isInGoodStanding(user)) revert ComplianceCheckFailed();
        }
    }

    /**
     * @notice Authorize UUPS upgrade (owner only)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
