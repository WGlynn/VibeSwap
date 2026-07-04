// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProofOfMindReputation
 * @notice The consumer-facing read surface for Proof of Mind: portable, on-chain reputation any
 *         protocol can import to gate or weight by a contributor's math-derived standing, WITHOUT
 *         running Merkle verification itself and WITHOUT trusting the producer.
 *
 *         Proof of Mind is the product; the export hub (IPoMExportHub) is the machinery and Noesis
 *         is the reference chain that produces the scores. This interface is the second value prop
 *         of the primitive made concrete: reputation earned on one substrate, read on another.
 *
 *         Reputation is keyed by the SOULBOUND contributor id (`keccak256(type_script.args)`), the
 *         same identifier the scores tree commits. Binding that id to an EVM address is the
 *         consumer's identity-bridge responsibility (the same open item the MindCoin founding doc
 *         names): a consumer that authenticates "address X controls contributor id C" can then read
 *         X's reputation as `reputationOf(C)`. This interface deliberately does NOT self-bind an
 *         address to an id, because an unauthenticated binding would be reputation theft.
 *
 *         Freshness model: a recorded reputation is a VERIFIED LOWER BOUND as of `asOfNonce`. A
 *         contributor's cumulative PoM value is monotone non-decreasing across finalized standings
 *         (v1 pins the reduction parameters), so a cached value can only lag, never overstate.
 *         Gating on it is therefore fail-safe (it may under-grant a contributor who has earned more
 *         since their last proof, never over-grant). Re-post a proof against the current standing to
 *         refresh, or use `verifyLive` for an as-of-now check with a caller-supplied proof.
 */
interface IProofOfMindReputation {
    /// @param value      the verified cumulative PoM value.
    /// @param asOfNonce  the standing nonce (meta-block height) the value was verified against.
    struct Reputation {
        uint256 value;
        uint256 asOfNonce;
    }

    /// @notice A contributor's reputation was verified against the live standing and cached.
    event ReputationRecorded(bytes32 indexed contributor, uint256 value, uint256 indexed asOfNonce);

    error InvalidReputationProof();

    /// @notice Verify a `(contributor, value)` leaf against the CURRENT standing's scores root and
    ///         cache it. Permissionless: a valid proof is a public fact, and the cache only ever
    ///         reflects a value the finalized standing actually commits.
    function recordReputation(bytes32 contributor, uint256 value, bytes32[] calldata proof) external;

    /// @notice The last verified reputation for a contributor (a monotone lower bound on current).
    function reputationOf(bytes32 contributor) external view returns (uint256 value, uint256 asOfNonce);

    /// @notice True iff the contributor's last recorded reputation is >= `threshold`. The common
    ///         gate: allowlist / weight / sybil-resistance keyed by earned mind, not bought tokens.
    function hasReputationAtLeast(bytes32 contributor, uint256 threshold) external view returns (bool);

    /// @notice Pure as-of-now check against the current standing with a caller-supplied proof. No
    ///         caching, no state write. Use when you need the absolute-current value, not a cache.
    function verifyLive(bytes32 contributor, uint256 value, bytes32[] calldata proof)
        external
        view
        returns (bool);

    /// @notice The export hub this oracle reads standings from.
    function hub() external view returns (address);
}
