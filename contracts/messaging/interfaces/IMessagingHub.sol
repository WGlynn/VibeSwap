// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAttestationVerifier} from "./IAttestationVerifier.sol";
import {ISupplyAccountant} from "./ISupplyAccountant.sol";
import {IMessagingValidatorRegistry} from "./IMessagingValidatorRegistry.sol";

/**
 * @title IMessagingHub
 * @notice Per-chain orchestrator for the post-LayerZero canonical messaging layer.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §6
 *
 *         The hub is the integration point between the four other components:
 *
 *           VibeSwapCanonicalToken   -- mints/burns user tokens
 *                  ↓ ↑
 *           MessagingHub             -- this contract: orchestrates flow + accounts
 *                  ↓ ↑                    ↓ ↑                    ↓ ↑
 *           SupplyAccountant      AttestationVerifier      ValidatorRegistry
 *           (bookkeeping)         (BLS check)              (set membership)
 *
 *         Three primary user-facing flows:
 *
 *           initiateBurn()   — source-chain side; called by canonical token
 *           receiveAttestation() — destination-chain side; verifies + mints
 *           recoverBurn()    — liveness fallback if attestation never arrives
 *
 *         And one validator-facing flow:
 *
 *           confirmDelivery() — source-chain receipt that destination minted,
 *                               clears outboundBurned and rewards validators
 *
 *         Replay protection is layered:
 *           1. NonceRegistry — per-(srcChain, dstChain) monotonic, consumed once
 *           2. AttestationVerifier.consume() — verified-message replay check
 *           3. SupplyAccountant invariant — cross-chain supply violation revert
 */
interface IMessagingHub {
    // ============ Structs ============

    /// @notice State of an in-flight outbound burn (this chain → destination).
    struct OutboundBurn {
        address token;
        address sender;
        address recipient;
        uint64  dstChainId;
        uint64  initiatedAt;
        uint256 amount;
        uint256 nonce;
        bool    confirmed;     // Set when AttestationFinalized arrives back here.
        bool    reversed;      // Set on a successful recoverBurn.
    }

    /// @notice Configuration for a supported destination/source chain.
    struct ChainConfig {
        uint64  chainId;
        bool    enabledOutbound;       // Can users initiate burns toward this chain?
        bool    enabledInbound;        // Can attestations from this chain be consumed?
        uint64  livenessTimeout;       // Seconds before recoverBurn() unlocks
        uint64  softFinalityConfirmations; // k-confirmations under softFinalityThreshold
        uint256 softFinalityThreshold;     // Per-burn amount cutoff for relaxed finality
        uint64  hardFinalityConfirmations; // k-confirmations above the threshold
    }

    // ============ Events ============

    event BurnInitiated(
        address indexed token,
        address indexed sender,
        uint64 indexed dstChainId,
        uint256 nonce,
        address recipient,
        uint256 amount,
        bytes32 sourceBlockHash
    );

    event AttestationConsumed(
        address indexed token,
        uint64 indexed sourceChainId,
        uint256 indexed nonce,
        address recipient,
        uint256 amount,
        address aggregator
    );

    event DeliveryConfirmed(
        address indexed token,
        uint64 indexed dstChainId,
        uint256 indexed nonce
    );

    event BurnRecovered(
        address indexed token,
        address indexed user,
        uint64 indexed dstChainId,
        uint256 nonce,
        uint256 amount
    );

    event ChainConfigured(uint64 indexed chainId, ChainConfig config);

    // ============ Errors ============

    error UnauthorizedCaller();
    error UnknownChain(uint64 chainId);
    error ChainOutboundDisabled(uint64 chainId);
    error ChainInboundDisabled(uint64 chainId);
    error UnknownToken(address token);
    error AmountZero();
    error RecipientZero();
    error NonceAlreadyConsumed(uint64 chainId, uint256 nonce);
    error LivenessTimeoutNotReached(uint64 secondsRemaining);
    error AttestationAlreadyFinalized(uint256 nonce);
    error BurnAlreadyConfirmed(uint256 nonce);
    error BurnAlreadyReversed(uint256 nonce);
    error InsufficientFinality(uint64 actual, uint64 required);

    // ============ Source-side flow ============

    /// @notice Called by VibeSwapCanonicalToken.burn() after burning user tokens.
    /// @dev Records the outbound burn in the SupplyAccountant, assigns a nonce,
    ///      emits BurnInitiated. Token has already been burned by the time this
    ///      runs — the hub trusts its caller (gated to canonical token role).
    function initiateBurn(
        address token,
        address sender,
        uint64 dstChainId,
        address recipient,
        uint256 amount
    ) external returns (uint256 nonce);

    /// @notice Called by validators after observing the destination mint.
    /// @dev The aggregator on the destination side, after consuming the
    ///      attestation, signs a delivery receipt that the source-chain
    ///      hub verifies here. Clears outboundBurned and triggers Shapley
    ///      reward distribution to the participating signers.
    function confirmDelivery(
        IAttestationVerifier.AttestationMessage calldata message,
        IAttestationVerifier.AttestationProof calldata deliveryProof
    ) external;

    // ============ Destination-side flow ============

    /// @notice Verify an attestation and mint canonical tokens to the recipient.
    /// @dev Permissionless: anyone can submit; the aggregator earns the reward
    ///      bonus if they're inside the aggregatorWindow.
    ///
    ///      Order of operations (atomic):
    ///        1. AttestationVerifier.verify() — pure check
    ///        2. NonceRegistry replay check (revert on duplicate)
    ///        3. SupplyAccountant.recordInboundMint() — supply invariant check
    ///        4. AttestationVerifier.consume() — mark as used
    ///        5. VibeSwapCanonicalToken.mint() — actual mint
    ///        6. emit AttestationConsumed
    function receiveAttestation(
        IAttestationVerifier.AttestationMessage calldata message,
        IAttestationVerifier.AttestationProof calldata proof
    ) external;

    // ============ Liveness fallback ============

    /// @notice Reverse a stuck burn after the liveness window has elapsed.
    /// @dev Re-mints to the original sender on the source chain. The reversed
    ///      nonce is permanently locked — even if a late attestation arrives,
    ///      the destination-side receiveAttestation will revert via the
    ///      duplicate-mint supply invariant.
    ///
    ///      Triggers PoM-slashing against the validator set epoch active at
    ///      initiation time (liveness failure offense).
    function recoverBurn(uint256 nonce) external;

    // ============ Admin / configuration ============

    /// @notice Configure a supported chain. Governance-only.
    function configureChain(uint64 chainId, ChainConfig calldata config) external;

    /// @notice Register a canonical token. Governance-only.
    function registerToken(address token) external;

    // ============ Views ============

    function nextOutboundNonce(uint64 dstChainId) external view returns (uint256);
    function getOutboundBurn(uint256 nonce) external view returns (OutboundBurn memory);

    function chainConfig(uint64 chainId) external view returns (ChainConfig memory);
    function isTokenRegistered(address token) external view returns (bool);

    function verifier() external view returns (IAttestationVerifier);
    function accountant() external view returns (ISupplyAccountant);
    function validatorRegistry() external view returns (IMessagingValidatorRegistry);
}
