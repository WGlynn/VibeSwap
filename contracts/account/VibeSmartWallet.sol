// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/IVibeSmartWallet.sol";

/**
 * @title VibeSmartWallet
 * @notice ERC-4337 compliant smart contract wallet with session keys.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Designed for VibeSwap's "abstract crypto away" UX:
 *        - Device wallet (WebAuthn) key → registered as session key
 *        - Session keys are time-limited, function-scoped, spending-capped
 *        - Batched transactions for atomic multi-step operations
 *        - Social recovery via WalletRecovery/AGIResistantRecovery
 *
 *      ERC-4337 flow:
 *        1. User (or device wallet) signs a UserOperation off-chain
 *        2. Bundler submits to canonical EntryPoint
 *        3. EntryPoint calls validateUserOp() on this wallet
 *        4. If valid, EntryPoint calls execute()/executeBatch()
 *
 *      Signature validation:
 *        - Owner signature: full access to all functions
 *        - Session key signature: scoped access (selectors + spending limit)
 *        - Both use ECDSA over EIP-191 personal message hash
 *
 *      Non-upgradeable: wallet code is immutable once deployed.
 *      Deployed via VibeWalletFactory (CREATE2 for deterministic addresses).
 */
contract VibeSmartWallet is IVibeSmartWallet {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    /// @dev ERC-4337 validation success (packed: validAfter=0, validUntil=0, authorizer=0)
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    /// @dev ERC-4337 validation failure
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    // ============ State ============

    address private _owner;
    address private _entryPoint;
    address private _recoveryAddress;
    uint256 private _nonce;
    bool private _initialized;

    /// @dev Session key registry
    mapping(address => SessionKey) private _sessionKeys;
    /// @dev Session key → selector → allowed
    mapping(address => mapping(bytes4 => bool)) private _allowedSelectors;
    /// @dev Session key has ANY selectors set (if false, all selectors allowed)
    mapping(address => bool) private _hasSelectorRestrictions;

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotOwner();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != _entryPoint) revert NotEntryPoint();
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        if (msg.sender != _owner && msg.sender != _entryPoint) revert NotOwnerOrEntryPoint();
        _;
    }

    // ============ Initialization ============

    /**
     * @notice Initialize the wallet. Can only be called once.
     * @param initialOwner The wallet owner (EOA)
     * @param initialEntryPoint The canonical ERC-4337 EntryPoint address
     */
    function initialize(address initialOwner, address initialEntryPoint) external {
        if (_initialized) revert AlreadyInitialized();
        if (initialOwner == address(0)) revert ZeroAddress();
        if (initialEntryPoint == address(0)) revert ZeroAddress();

        _owner = initialOwner;
        _entryPoint = initialEntryPoint;
        _initialized = true;

        emit WalletInitialized(initialOwner, initialEntryPoint);
    }

    // ============ Execution Functions ============

    /**
     * @notice Execute a single call. Only owner or EntryPoint.
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyOwnerOrEntryPoint {
        _call(target, value, data);
        emit Executed(target, value, data);
    }

    /**
     * @notice Execute multiple calls atomically. Only owner or EntryPoint.
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyOwnerOrEntryPoint {
        if (targets.length != values.length || values.length != datas.length) {
            revert CallFailed();
        }

        for (uint256 i = 0; i < targets.length; i++) {
            _call(targets[i], values[i], datas[i]);
        }

        emit BatchExecuted(targets.length);
    }

    // ============ Session Key Functions ============

    /**
     * @notice Add a session key with time bounds, spending limit, and allowed selectors.
     * @param key The session key address (device-derived keypair)
     * @param validAfter Earliest valid timestamp
     * @param validUntil Expiry timestamp
     * @param spendingLimit Max wei per individual call (0 = unlimited)
     * @param allowedSelectors Function selectors this key can call (empty = all)
     */
    function addSessionKey(
        address key,
        uint40 validAfter,
        uint40 validUntil,
        uint128 spendingLimit,
        bytes4[] calldata allowedSelectors
    ) external onlyOwner {
        if (key == address(0)) revert ZeroAddress();
        if (_sessionKeys[key].active) revert SessionKeyAlreadyExists();

        _sessionKeys[key] = SessionKey({
            validAfter: validAfter,
            validUntil: validUntil,
            spendingLimit: spendingLimit,
            active: true
        });

        if (allowedSelectors.length > 0) {
            _hasSelectorRestrictions[key] = true;
            for (uint256 i = 0; i < allowedSelectors.length; i++) {
                _allowedSelectors[key][allowedSelectors[i]] = true;
                emit AllowedSelectorAdded(key, allowedSelectors[i]);
            }
        }

        emit SessionKeyAdded(key, validUntil);
    }

    /**
     * @notice Revoke a session key immediately.
     */
    function revokeSessionKey(address key) external onlyOwner {
        if (!_sessionKeys[key].active) revert SessionKeyNotFound();

        _sessionKeys[key].active = false;
        emit SessionKeyRevoked(key);
    }

    // ============ Recovery Functions ============

    /**
     * @notice Set the recovery address (WalletRecovery or guardian).
     */
    function setRecoveryAddress(address recovery) external onlyOwner {
        _recoveryAddress = recovery;
        emit RecoveryAddressSet(recovery);
    }

    /**
     * @notice Execute recovery — transfer ownership. Only recovery address.
     */
    function executeRecovery(address newOwner) external {
        if (msg.sender != _recoveryAddress) revert NotRecoveryAddress();
        if (newOwner == address(0)) revert ZeroAddress();

        address oldOwner = _owner;
        _owner = newOwner;

        emit RecoveryExecuted(oldOwner, newOwner);
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // ============ ERC-4337 Validation ============

    /**
     * @notice Validate a UserOperation signature.
     * @dev Called by the canonical EntryPoint before execution.
     *      Supports both owner signatures and session key signatures.
     *
     * @param userOp The UserOperation to validate
     * @param userOpHash Hash of the UserOperation (signed by user)
     * @param missingAccountFunds Gas funds to send to EntryPoint if needed
     * @return validationData 0 for success, 1 for failure (ERC-4337 spec)
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        // Validate nonce
        if (userOp.nonce != _nonce) revert InvalidNonce();
        _nonce++;

        // Recover signer from signature
        address signer = userOpHash.toEthSignedMessageHash().recover(userOp.signature);

        // Check if signer is owner → full access
        if (signer == _owner) {
            // Prefund EntryPoint if needed
            if (missingAccountFunds > 0) {
                _prefund(missingAccountFunds);
            }
            return SIG_VALIDATION_SUCCESS;
        }

        // Check if signer is valid session key
        SessionKey storage sk = _sessionKeys[signer];
        if (!sk.active) return SIG_VALIDATION_FAILED;
        if (block.timestamp < sk.validAfter) return SIG_VALIDATION_FAILED;
        if (block.timestamp > sk.validUntil) return SIG_VALIDATION_FAILED;

        // Check session key restrictions on the inner call
        if (_validateSessionKeyScope(signer, sk, userOp.callData) != SIG_VALIDATION_SUCCESS) {
            return SIG_VALIDATION_FAILED;
        }

        // Prefund EntryPoint if needed
        if (missingAccountFunds > 0) {
            _prefund(missingAccountFunds);
        }

        return SIG_VALIDATION_SUCCESS;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the EntryPoint address. Only owner.
     */
    function updateEntryPoint(address newEntryPoint) external onlyOwner {
        if (newEntryPoint == address(0)) revert ZeroAddress();
        _entryPoint = newEntryPoint;
        emit EntryPointUpdated(newEntryPoint);
    }

    // ============ View Functions ============

    function owner() external view returns (address) {
        return _owner;
    }

    function entryPoint() external view returns (address) {
        return _entryPoint;
    }

    function recoveryAddress() external view returns (address) {
        return _recoveryAddress;
    }

    function getNonce() external view returns (uint256) {
        return _nonce;
    }

    function getSessionKey(address key) external view returns (SessionKey memory) {
        return _sessionKeys[key];
    }

    function isSessionKeyActive(address key) external view returns (bool) {
        SessionKey storage sk = _sessionKeys[key];
        return sk.active && block.timestamp >= sk.validAfter && block.timestamp <= sk.validUntil;
    }

    function isAllowedSelector(address key, bytes4 selector) external view returns (bool) {
        if (!_hasSelectorRestrictions[key]) return true; // no restrictions = all allowed
        return _allowedSelectors[key][selector];
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ Internal ============

    function _call(address target, uint256 value, bytes calldata data) internal {
        (bool success,) = target.call{value: value}(data);
        if (!success) revert CallFailed();
    }

    function _prefund(uint256 amount) internal {
        (bool success,) = _entryPoint.call{value: amount}("");
        if (!success) revert CallFailed();
    }

    /**
     * @dev Validate session key scope against the callData.
     *      Checks spending limit and selector restrictions on inner execute() calls.
     */
    function _validateSessionKeyScope(
        address signer,
        SessionKey storage sk,
        bytes calldata callData
    ) internal view returns (uint256) {
        if (callData.length < 4) return SIG_VALIDATION_SUCCESS;

        bytes4 outerSelector = bytes4(callData[:4]);

        // Only inspect execute() calls for inner restrictions
        if (outerSelector != this.execute.selector || callData.length < 100) {
            return SIG_VALIDATION_SUCCESS;
        }

        // Decode execute(target, value, data) params
        (,uint256 callValue, bytes memory innerData) = abi.decode(
            callData[4:], (address, uint256, bytes)
        );

        // Spending limit check
        if (sk.spendingLimit > 0 && callValue > sk.spendingLimit) {
            return SIG_VALIDATION_FAILED;
        }

        // Selector restriction check
        if (_hasSelectorRestrictions[signer] && innerData.length >= 4) {
            bytes4 innerSelector;
            assembly {
                innerSelector := mload(add(innerData, 32))
            }
            if (!_allowedSelectors[signer][innerSelector]) {
                return SIG_VALIDATION_FAILED;
            }
        }

        return SIG_VALIDATION_SUCCESS;
    }
}
