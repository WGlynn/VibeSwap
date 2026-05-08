// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IVibeSwapCanonicalToken} from "./interfaces/IVibeSwapCanonicalToken.sol";
import {IMessagingHub} from "./interfaces/IMessagingHub.sol";

/**
 * @title VibeSwapCanonicalToken
 * @notice ERC20 token issued canonically by VibeSwap on every supported chain.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §5
 *         Interface: contracts/messaging/interfaces/IVibeSwapCanonicalToken.sol
 *
 *         Behavior:
 *           - mint() and reissue() are gated to MESSAGING_HUB_ROLE — the
 *             active hub for this chain is the only legitimate mint authority.
 *           - burn() is user-callable; it burns the caller's balance and
 *             dispatches to the hub for nonce assignment + cross-chain emit.
 *           - Identical bytecode + name/symbol/decimals across chains by
 *             design — verifiable via on-chain hash check at validator
 *             onboarding (see MessagingValidatorRegistry).
 *
 *         Genesis chain (Ethereum) seeds the initial supply via
 *         genesisMint(), gated to GENESIS_MINTER_ROLE. Other chains never
 *         have GENESIS_MINTER_ROLE assigned and can only ever mint via
 *         attested cross-chain burns.
 */
contract VibeSwapCanonicalToken is
    IVibeSwapCanonicalToken,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // ============ Roles ============

    bytes32 public constant MESSAGING_HUB_ROLE = keccak256("MESSAGING_HUB_ROLE");
    bytes32 public constant GENESIS_MINTER_ROLE = keccak256("GENESIS_MINTER_ROLE");
    bytes32 public constant DESTINATION_MANAGER_ROLE = keccak256("DESTINATION_MANAGER_ROLE");

    // ============ Storage ============

    address public messagingHubAddress;

    /// @notice Whether outbound burns to a given destination chain are enabled.
    /// @dev Inbound mints are not gated by this — the hub trusts source chains
    ///      via its ChainConfig.enabledInbound flag, not via the token.
    mapping(uint64 => bool) internal destinationEnabled;

    /// @dev Reserved storage gap for upgrade safety.
    uint256[48] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address admin,
        address hub
    ) external initializer {
        __ERC20_init(name_, symbol_);
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DESTINATION_MANAGER_ROLE, admin);

        if (hub != address(0)) {
            messagingHubAddress = hub;
            _grantRole(MESSAGING_HUB_ROLE, hub);
        }
    }

    // ============ Mint / Burn ============

    /// @inheritdoc IVibeSwapCanonicalToken
    function mint(
        address to,
        uint256 amount,
        uint64 sourceChainId,
        uint256 sourceNonce
    ) external {
        if (!hasRole(MESSAGING_HUB_ROLE, msg.sender)) revert UnauthorizedMinter();
        if (to == address(0)) revert RecipientZero();
        if (amount == 0) revert AmountZero();

        _mint(to, amount);
        emit CanonicalMint(to, amount, sourceChainId, sourceNonce);
    }

    /// @inheritdoc IVibeSwapCanonicalToken
    function burn(
        uint256 amount,
        uint64 dstChainId,
        address recipient
    ) external returns (uint256 nonce) {
        if (messagingHubAddress == address(0)) revert MessagingHubUnset();
        if (amount == 0) revert AmountZero();
        if (recipient == address(0)) revert RecipientZero();
        if (!destinationEnabled[dstChainId]) revert UnsupportedDestination(dstChainId);

        _burn(msg.sender, amount);

        nonce = IMessagingHub(messagingHubAddress).initiateBurn(
            address(this),
            msg.sender,
            dstChainId,
            recipient,
            amount
        );

        emit CanonicalBurn(msg.sender, amount, dstChainId, recipient, nonce);
    }

    /// @inheritdoc IVibeSwapCanonicalToken
    function reissue(
        address to,
        uint256 amount,
        uint256 reversedNonce
    ) external {
        if (!hasRole(MESSAGING_HUB_ROLE, msg.sender)) revert UnauthorizedMinter();
        if (to == address(0)) revert RecipientZero();
        if (amount == 0) revert AmountZero();

        _mint(to, amount);
        emit CanonicalReissue(to, amount, reversedNonce);
    }

    /// @notice Genesis-chain initial supply mint. Other chains never call this.
    function genesisMint(address to, uint256 amount) external {
        if (!hasRole(GENESIS_MINTER_ROLE, msg.sender)) revert UnauthorizedMinter();
        if (amount == 0) revert AmountZero();
        _mint(to, amount);
    }

    // ============ Admin ============

    function setMessagingHub(address hub) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Revoke from old, grant to new. Idempotent.
        if (messagingHubAddress != address(0)) {
            _revokeRole(MESSAGING_HUB_ROLE, messagingHubAddress);
        }
        messagingHubAddress = hub;
        if (hub != address(0)) {
            _grantRole(MESSAGING_HUB_ROLE, hub);
        }
    }

    function setDestinationEnabled(uint64 dstChainId, bool enabled)
        external
        onlyRole(DESTINATION_MANAGER_ROLE)
    {
        destinationEnabled[dstChainId] = enabled;
    }

    // ============ Views ============

    /// @inheritdoc IVibeSwapCanonicalToken
    function messagingHub() external view returns (address) {
        return messagingHubAddress;
    }

    /// @inheritdoc IVibeSwapCanonicalToken
    function isDestinationSupported(uint64 dstChainId) external view returns (bool) {
        return destinationEnabled[dstChainId];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
