// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMessagingValidatorRegistry} from "./IMessagingValidatorRegistry.sol";

/**
 * @title IAttestationVerifier
 * @notice BLS threshold signature verification for cross-chain attestations.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §7.2–7.3
 *
 *         Verification reduces to: did at least t-of-n active validators sign
 *         the canonical attestation message? The aggregator collects partial
 *         BLS signatures off-chain and submits one 96-byte aggregate. The
 *         verifier checks:
 *
 *           1. signers form a valid subset of the active set at `epoch`
 *           2. |signers| >= threshold for that epoch
 *           3. aggregateSignature ↔ aggregatePubkey(signers, epoch) over message
 *
 *         The interface is deliberately swappable: v1 uses BLS12-381;
 *         v2.5+ replaces this with a ZK light-client proof, holding the
 *         same {AttestationMessage in, ok out} shape.
 */
interface IAttestationVerifier {
    // ============ Structs ============

    /// @notice Canonical attestation payload. Hashed and signed by validators.
    /// @dev Field order is part of the signing schema — do not reorder.
    struct AttestationMessage {
        uint64  sourceChainId;     // Chain where the burn occurred
        uint64  dstChainId;        // Chain receiving this attestation
        uint256 nonce;             // Per-(src,dst) monotonic burn nonce
        address sender;            // Original burning user on source
        address recipient;         // Mint recipient on destination
        address token;             // Canonical token address (same on every chain by design)
        uint256 amount;            // Amount burned/minted
        bytes32 sourceBlockHash;   // Block hash of the source-chain block containing the burn
        uint64  sourceBlockNumber; // Convenience for finality checks
    }

    /// @notice Aggregated signature payload.
    struct AttestationProof {
        uint64  epoch;             // Validator-set epoch this signature is valid against
        bytes   aggregateSignature;  // BLS12-381 G2 compressed (96 bytes)
        uint256 signerBitmap;        // Bit i set if validator at index i signed.
                                     // For sets >256 use signerBitmapExt.
        bytes32 signerBitmapExt;     // Hash of the extended signer bitmap (sets > 256).
        bytes   aggregatorSignature; // EIP-191 sig from the submitting aggregator
        address aggregator;          // Aggregator's payout address
    }

    // ============ Events ============

    event AttestationVerified(
        bytes32 indexed messageHash,
        uint64 indexed sourceChainId,
        uint256 indexed nonce,
        uint32 signerCount,
        address aggregator
    );
    event ChallengeRaised(
        bytes32 indexed messageHash,
        uint32 indexed validatorIndex,
        bytes32 conflictingMessageHash
    );

    // ============ Errors ============

    error EpochInactive(uint64 epoch);
    error InsufficientSigners(uint32 signers, uint32 threshold);
    error BLSVerificationFailed();
    error MalformedSignature();
    error MalformedBitmap();
    error InvalidAggregator(address claimedAggregator);
    error AggregatorWindowExpired();
    error AggregatorWindowOpen();
    error MessageReplay(bytes32 messageHash);

    // ============ Verification ============

    /// @notice Verify a complete attestation. Pure cryptographic check — does NOT
    ///         consume nonces, mint tokens, or touch supply state.
    /// @dev Caller (typically MessagingHub) is responsible for nonce consumption
    ///      and follow-on supply accounting.
    /// @return messageHash Canonical hash of `message` (used for emit linking).
    /// @return signerCount Number of active validators that signed.
    function verify(
        AttestationMessage calldata message,
        AttestationProof calldata proof
    ) external view returns (bytes32 messageHash, uint32 signerCount);

    /// @notice Hash an attestation message in canonical form.
    /// @dev Identical hashing across chains — validators sign this hash directly.
    function hashMessage(AttestationMessage calldata message)
        external
        pure
        returns (bytes32);

    /// @notice Compute the threshold required for an epoch.
    function threshold(uint64 epoch) external view returns (uint32);

    /// @notice Whether `messageHash` has already been verified+consumed at this verifier.
    /// @dev Used by the hub for replay protection at the verification layer.
    function isConsumed(bytes32 messageHash) external view returns (bool);

    /// @notice Mark a verified attestation as consumed. Hub-only.
    /// @dev Splitting verify() (view) from consume() (state-mut) lets the hub
    ///      atomically check supply invariants between the two.
    function consume(bytes32 messageHash) external;

    // ============ Aggregator rotation ============

    /// @notice Deterministic aggregator for `(epoch, nonce)`.
    /// @dev Computed via shuffle over the active set. The aggregator wins
    ///      the standard reward; if they fail to submit within
    ///      aggregatorWindow, any validator can take over.
    function expectedAggregator(uint64 epoch, uint256 nonce)
        external
        view
        returns (uint32 validatorIndex);

    /// @notice Whether the aggregator window for (epoch, nonce, deadline) is still open.
    function isAggregatorWindowOpen(uint256 deadline) external view returns (bool);

    /// @notice Length of the aggregator window in seconds.
    function aggregatorWindow() external view returns (uint64);

    // ============ Registry binding ============

    /// @notice Validator registry this verifier reads its set from.
    function registry() external view returns (IMessagingValidatorRegistry);
}
