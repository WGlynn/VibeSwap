// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./VibeSmartWallet.sol";

/**
 * @title VibeWalletFactory
 * @notice Factory for deploying VibeSmartWallet via CREATE2.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Deterministic addresses: users can compute their wallet address
 *      before deployment using (owner, salt, entryPoint).
 *
 *      The canonical EntryPoint calls createAccount() when processing
 *      a UserOperation for a not-yet-deployed wallet.
 */
contract VibeWalletFactory {
    // ============ Events ============

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 salt);

    // ============ Errors ============

    error ZeroAddress();

    // ============ State ============

    address public immutable entryPoint;

    // ============ Constructor ============

    constructor(address _entryPoint) {
        if (_entryPoint == address(0)) revert ZeroAddress();
        entryPoint = _entryPoint;
    }

    // ============ Factory Functions ============

    /**
     * @notice Deploy a new wallet or return existing one.
     * @param owner The wallet owner
     * @param salt Unique salt for CREATE2
     * @return wallet The wallet address
     */
    function createAccount(
        address owner,
        bytes32 salt
    ) external returns (address wallet) {
        if (owner == address(0)) revert ZeroAddress();

        bytes32 combinedSalt = keccak256(abi.encodePacked(owner, salt));
        address predicted = getAddress(owner, salt);

        // If already deployed, return existing
        if (predicted.code.length > 0) {
            return predicted;
        }

        // Deploy via CREATE2
        VibeSmartWallet newWallet = new VibeSmartWallet{salt: combinedSalt}();
        newWallet.initialize(owner, entryPoint);

        emit WalletCreated(address(newWallet), owner, salt);
        return address(newWallet);
    }

    /**
     * @notice Compute the counterfactual address of a wallet.
     * @param owner The wallet owner
     * @param salt Unique salt
     * @return The deterministic address
     */
    function getAddress(
        address owner,
        bytes32 salt
    ) public view returns (address) {
        bytes32 combinedSalt = keccak256(abi.encodePacked(owner, salt));
        return Create2.computeAddress(
            combinedSalt,
            keccak256(type(VibeSmartWallet).creationCode)
        );
    }
}
