# Pair-Keyed Historical Anchor

**Status**: shipped (cycle Strengthen #3)
**First instance**: `ContributionDAG.lastHandshakeAt`
**Convergence with**: `revert-wipes-counter-non-reverting-twin.md`, `observability-before-tuning.md`

## The pattern

A relationship between two addresses (`A`, `B`) has lifecycle events — formed, refreshed, revoked. You want to read the *last-event timestamp* for any unordered pair `{A, B}` in O(1), and you want that timestamp to survive the underlying relationship being revoked or reset (so off-chain analytics can compute hit-rates over arbitrary time windows).

The shape: a single mapping keyed by a **canonical pair-hash**:

```solidity
function _pairKey(address a, address b) internal pure returns (bytes32) {
    return a < b
        ? keccak256(abi.encodePacked(a, b))
        : keccak256(abi.encodePacked(b, a));
}

mapping(bytes32 => uint256) public lastEventAt;

// Update on each event
function _recordEvent(address a, address b) internal {
    lastEventAt[_pairKey(a, b)] = block.timestamp;
}
```

The key is canonical — `_pairKey(A, B) == _pairKey(B, A)` — because we sort the addresses before hashing. The value is *just the timestamp*, not the relationship itself, so it survives any cleanup of the underlying relationship.

## Why it works

Relationships are often stored bidirectionally (`vouches[A][B]`, `vouches[B][A]`) or unidirectionally (`vouches[A][B]` only). For analytics that ask "when did A and B last interact?", neither shape gives a clean read: bidirectional doubles writes, unidirectional requires the analyst to know which direction was the source.

The pair-key dissolves the question: the analyst hashes `{A, B}` and reads. The hash is symmetric, so direction does not matter. The timestamp is decoupled from the relationship state, so revoking the vouch does not erase the historical record.

The pattern is essentially a *sparse symmetric matrix lookup*, where the key encodes the pair and the value is the metric. It generalizes beyond timestamps to any per-pair metric (vouch-count, dispute-count, etc.) by storing a struct instead of `uint256`.

## Concrete example

From `contracts/identity/ContributionDAG.sol`:

```solidity
/// @notice O(1) per-pair last-handshake timestamp. Keyed by _handshakeKey.
///         0 if never handshaken; otherwise unix-ts of most recent confirmation.
mapping(bytes32 => uint256) public lastHandshakeAt;

/// @notice M-09 DISSOLVED: O(1) handshake lookup via mapping.
function _handshakeKey(address a, address b) internal pure returns (bytes32) {
    return a < b
        ? keccak256(abi.encodePacked(a, b))
        : keccak256(abi.encodePacked(b, a));
}

// Updated whenever a handshake confirms (in both addVouch and tryAddVouch):
lastHandshakeAt[_handshakeKey(msg.sender, to)] = block.timestamp;
```

A pair that handshakes, then revokes the vouch, then handshakes again will see `lastHandshakeAt` updated on each handshake event. An off-chain index can compute "time since last handshake" for any pair in one storage read.

## When to use

- You need O(1) lookup of a per-pair metric.
- The metric should survive cleanup of the underlying relationship (or the relationship is otherwise asymmetric in storage).
- Direction does not matter for the metric — both `(A, B)` and `(B, A)` should return the same value.

## When NOT to use

- Direction matters. Use a directional mapping `mapping(address => mapping(address => T))` instead.
- The metric is intrinsic to the relationship and disappears with it (e.g., the active vouch's content). Store on the relationship itself.
- The pair count is small and bounded (e.g., a 2-of-3 multisig). A struct field on the entity is cheaper than a mapping.

## Related primitives

- [`revert-wipes-counter-non-reverting-twin.md`](./revert-wipes-counter-non-reverting-twin.md) — sibling primitive shipped in the same observability cycle.
- [`observability-before-tuning.md`](./observability-before-tuning.md) — the meta-rule motivating the metric-shipping cycle this primitive belongs to.
