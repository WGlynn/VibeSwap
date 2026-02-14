// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeSmartWallet
 * @notice ERC-4337 compliant smart contract wallet with session keys.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Key features:
 *           - Single owner (EOA or SoulboundIdentity holder)
 *           - Session keys: time-limited, function-scoped, spending-capped
 *           - Batched transaction execution
 *           - Social recovery via VibeSwap recovery contracts
 *           - ERC-4337 compatible (validateUserOp for EntryPoint)
 *
 *         Session keys enable device wallets (WebAuthn/passkey) to sign
 *         transactions without exposing the owner key. A session key is:
 *           - Bound to a specific address (device-derived keypair)
 *           - Time-limited (e.g., 24h expiry)
 *           - Function-scoped (only allowed selectors)
 *           - Spending-capped (max value per tx)
 *
 *         Recovery: owner can set a recovery address that can transfer
 *         ownership. Integrates with WalletRecovery/AGIResistantRecovery.
 */
interface IVibeSmartWallet {
    // ============ Structs ============

    /// @notice Session key configuration
    struct SessionKey {
        uint40 validAfter;       // earliest valid timestamp
        uint40 validUntil;       // expiry timestamp
        uint128 spendingLimit;   // max wei per individual call (0 = unlimited)
        bool active;             // can be revoked
    }

    /// @notice Packed UserOperation for ERC-4337 (simplified)
    struct UserOperation {
        address sender;
        uint256 nonce;
        bytes callData;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes signature;
    }

    // ============ Events ============

    event WalletInitialized(address indexed owner, address indexed entryPoint);
    event SessionKeyAdded(address indexed key, uint40 validUntil);
    event SessionKeyRevoked(address indexed key);
    event Executed(address indexed target, uint256 value, bytes data);
    event BatchExecuted(uint256 count);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RecoveryAddressSet(address indexed recovery);
    event RecoveryExecuted(address indexed oldOwner, address indexed newOwner);
    event EntryPointUpdated(address indexed newEntryPoint);
    event AllowedSelectorAdded(address indexed sessionKey, bytes4 selector);

    // ============ Errors ============

    error NotOwner();
    error NotEntryPoint();
    error NotOwnerOrEntryPoint();
    error NotRecoveryAddress();
    error InvalidSignature();
    error SessionKeyExpired();
    error SessionKeyNotActive();
    error SessionKeyNotFound();
    error SelectorNotAllowed();
    error SpendingLimitExceeded();
    error AlreadyInitialized();
    error ZeroAddress();
    error CallFailed();
    error InvalidNonce();
    error SessionKeyAlreadyExists();

    // ============ Execution Functions ============

    function execute(address target, uint256 value, bytes calldata data) external;
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external;

    // ============ Session Key Functions ============

    function addSessionKey(
        address key,
        uint40 validAfter,
        uint40 validUntil,
        uint128 spendingLimit,
        bytes4[] calldata allowedSelectors
    ) external;
    function revokeSessionKey(address key) external;

    // ============ Recovery Functions ============

    function setRecoveryAddress(address recovery) external;
    function executeRecovery(address newOwner) external;

    // ============ ERC-4337 Functions ============

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);

    // ============ Admin Functions ============

    function updateEntryPoint(address newEntryPoint) external;

    // ============ View Functions ============

    function owner() external view returns (address);
    function entryPoint() external view returns (address);
    function recoveryAddress() external view returns (address);
    function getNonce() external view returns (uint256);
    function getSessionKey(address key) external view returns (SessionKey memory);
    function isSessionKeyActive(address key) external view returns (bool);
    function isAllowedSelector(address key, bytes4 selector) external view returns (bool);
}
