// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeSwapCanonicalToken
 * @notice Interface for VibeSwap-canonical tokens — assets where VibeSwap is the
 *         issuer of record on every supported chain, with identical bytecode and
 *         identical name/symbol/decimals everywhere.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §5
 *
 *         The canonical-issuer model means:
 *           - Total supply is fixed at genesis on Ethereum (or modified only via
 *             explicit on-chain governance on the genesis chain).
 *           - Other chains can mint only against burns observed elsewhere (proven
 *             by attestations from the messaging-validator network).
 *           - The cross-chain total-supply invariant Σ supply(c) = TOTAL is the
 *             load-bearing correctness property — checkable per-batch.
 *
 *         Authority model:
 *           - mint() is gated to MESSAGING_HUB_ROLE
 *           - burn() is user-callable; it triggers a cross-chain burn-and-mint
 *             flow via the MessagingHub
 *
 *         Local supply mirrors:
 *           - localSupply tracks ERC20 totalSupply
 *           - The SupplyAccountant adds outboundBurned + inboundConsumed columns
 *             so the global invariant can be verified per batch
 */
interface IVibeSwapCanonicalToken {
    // ============ Events ============

    /// @notice Emitted on a cross-chain mint (destination side).
    event CanonicalMint(
        address indexed to,
        uint256 amount,
        uint64 indexed sourceChainId,
        uint256 indexed sourceNonce
    );

    /// @notice Emitted on a cross-chain burn (source side).
    event CanonicalBurn(
        address indexed from,
        uint256 amount,
        uint64 indexed dstChainId,
        address recipient,
        uint256 indexed nonce
    );

    /// @notice Emitted when a burn is reversed via recoverBurn() liveness fallback.
    event CanonicalReissue(
        address indexed to,
        uint256 amount,
        uint256 indexed reversedNonce
    );

    // ============ Errors ============

    error UnauthorizedMinter();
    error MessagingHubUnset();
    error AmountZero();
    error RecipientZero();
    error UnsupportedDestination(uint64 dstChainId);

    // ============ Mint / Burn ============

    /// @notice Mint canonical tokens against an attested burn from another chain.
    /// @dev Must only succeed if called by the active MessagingHub. The hub itself
    ///      verifies the attestation and consumes the source nonce before invoking
    ///      this function — i.e., this method trusts its caller, not raw input.
    /// @param to            Recipient on this chain.
    /// @param amount        Amount to mint (matches the source-chain burn).
    /// @param sourceChainId Chain ID where the originating burn occurred.
    /// @param sourceNonce   Nonce of the burn on its source chain (for emit linking).
    function mint(
        address to,
        uint256 amount,
        uint64 sourceChainId,
        uint256 sourceNonce
    ) external;

    /// @notice Burn caller's tokens to initiate a cross-chain transfer.
    /// @dev Burns first, then calls MessagingHub.initiateBurn() in the same tx.
    ///      The hub is responsible for nonce assignment and supply accounting.
    /// @param amount     Amount to burn.
    /// @param dstChainId Destination chain that will mint.
    /// @param recipient  Address that will receive on the destination chain.
    /// @return nonce Nonce assigned to this burn by the MessagingHub.
    function burn(
        uint256 amount,
        uint64 dstChainId,
        address recipient
    ) external returns (uint256 nonce);

    /// @notice Re-mint tokens to a user whose burn never had its attestation finalized.
    /// @dev Called only by the MessagingHub during a recoverBurn() flow, after the
    ///      hub has confirmed no destination consumed the nonce within the liveness
    ///      window. Bypasses the standard mint() path because no attestation exists.
    function reissue(
        address to,
        uint256 amount,
        uint256 reversedNonce
    ) external;

    // ============ Views ============

    /// @notice Address of the MessagingHub authorized to mint/reissue this token.
    function messagingHub() external view returns (address);

    /// @notice Whether a destination chain ID is currently supported for outbound burns.
    /// @dev Inbound mints are not gated by this — any chain that the hub trusts as
    ///      a source can mint to this chain.
    function isDestinationSupported(uint64 dstChainId) external view returns (bool);
}
