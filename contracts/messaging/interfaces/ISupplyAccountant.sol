// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISupplyAccountant
 * @notice Per-chain bookkeeping contract for the cross-chain total-supply invariant.
 *
 *         Spec: docs/research/papers/post-layerzero-canonical-messaging.md §4, §6.3
 *
 *         For any VibeSwap-canonical token T, this contract tracks the three
 *         columns required to verify the global invariant on this chain:
 *
 *           localSupply(T)        — mirror of the ERC20 totalSupply on this chain
 *           outboundBurned(T,d)   — burns initiated locally for destination d that
 *                                   have not yet been confirmed minted on d
 *           inboundConsumed(T,s)  — mints performed on this chain against burns
 *                                   originating on source s
 *
 *         The chain-local invariant (checked every VibeSwap batch via the
 *         BatchInvariantVerification primitive):
 *
 *           localSupply(T) + Σ_d outboundBurned(T,d)
 *               = receivedFromGenesis(T) - sentToGenesis(T)
 *                 + Σ_s inboundConsumed(T,s)
 *                 - Σ_d outboundConfirmed(T,d)
 *
 *         Violations revert the entire batch and roll back the offending
 *         burn/mint, the same way auction-side invariant violations roll back
 *         settlement.
 *
 *         Trusted writers: MessagingHub and VibeSwapCanonicalToken on this chain.
 *         All other callers are read-only.
 */
interface ISupplyAccountant {
    // ============ Events ============

    event LocalSupplyChanged(address indexed token, uint256 newLocalSupply);
    event OutboundBurnRecorded(
        address indexed token,
        uint64 indexed dstChainId,
        uint256 indexed nonce,
        uint256 amount
    );
    event OutboundBurnConfirmed(
        address indexed token,
        uint64 indexed dstChainId,
        uint256 indexed nonce
    );
    event OutboundBurnReversed(
        address indexed token,
        uint64 indexed dstChainId,
        uint256 indexed nonce,
        uint256 amount
    );
    event InboundMintRecorded(
        address indexed token,
        uint64 indexed sourceChainId,
        uint256 indexed nonce,
        uint256 amount
    );
    event InvariantViolation(
        address indexed token,
        bytes32 invariantTag,
        int256 delta
    );

    // ============ Errors ============

    error UnauthorizedWriter();
    error UnknownToken(address token);
    error DuplicateNonce(uint64 chainId, uint256 nonce);
    error UnknownNonce(uint64 chainId, uint256 nonce);
    error NegativeOutbound(address token, uint64 dstChainId);
    error InvariantBroken(address token, bytes32 tag);

    // ============ Writers (hub-only) ============

    /// @notice Record a local outbound burn pending attestation on the destination.
    function recordOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce,
        uint256 amount
    ) external;

    /// @notice Mark an outbound burn as confirmed (destination has minted).
    /// @dev Called when the source chain receives an AttestationFinalized message.
    function confirmOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce
    ) external;

    /// @notice Reverse an outbound burn after a successful recoverBurn() flow.
    /// @dev outboundBurned -= amt; the canonical token is then reissued to the
    ///      original sender.
    function reverseOutboundBurn(
        address token,
        uint64 dstChainId,
        uint256 nonce
    ) external returns (uint256 amount);

    /// @notice Record an inbound mint from a source-chain burn.
    function recordInboundMint(
        address token,
        uint64 sourceChainId,
        uint256 nonce,
        uint256 amount
    ) external;

    /// @notice Sync the localSupply mirror after a token mint/burn.
    /// @dev Called by the canonical token contract on every mutation.
    function syncLocalSupply(address token, uint256 newLocalSupply) external;

    // ============ Invariant check ============

    /// @notice Verify the chain-local invariant for `token` at the current block.
    /// @return ok True if invariant holds.
    /// @return tag Identifier of the specific sub-invariant that failed (if !ok).
    function checkInvariant(address token)
        external
        view
        returns (bool ok, bytes32 tag);

    /// @notice Batch-level invariant check across all registered canonical tokens.
    /// @dev Called from VibeSwapCore at batch settlement. Reverts on violation.
    function checkBatchInvariants() external view;

    // ============ Views ============

    function localSupply(address token) external view returns (uint256);

    function outboundBurned(address token, uint64 dstChainId)
        external
        view
        returns (uint256);

    function inboundConsumed(address token, uint64 sourceChainId)
        external
        view
        returns (uint256);

    /// @notice Total tokens transferred in from every supported source chain.
    function totalInbound(address token) external view returns (uint256);

    /// @notice Total tokens transferred out to every supported destination chain.
    function totalOutbound(address token) external view returns (uint256);

    /// @notice Whether a source/destination nonce has been observed (replay check).
    function nonceConsumed(uint64 chainId, uint256 nonce)
        external
        view
        returns (bool);
}
