# Generation-Isolated Commit-Reveal

**Status**: shipped (cycles C42, C43)
**First instance**: `ShapleyDistributor.sol` keeper commit-reveal (C42), `CircuitBreaker.sol` attested-resume (C43)
**Convergence with**: `classification-default-with-explicit-override.md`

## The pattern

Commit-reveal flows that repeat across rounds need to invalidate stale commitments from prior rounds without iterating over the attestor / committer set. The fix is a **per-key round counter** that is mixed into commitment hashes AND used as a key dimension on per-attestor reveal storage:

```
commitment = hash(value, salt, address(this), currentRound)
revealRecorded[key][round][attestor] = true
```

Round increments on settlement (or on trip transitions, in the breaker case). Every prior-round commitment is now structurally inaccessible — the verifier won't accept it, because the round it commits to is stale. No iteration. No clear-loop. Old generations are implicitly stale.

## Why it works

The naive approach — clearing `revealedBy[attestor]` for each member of the attestor set on round transition — is O(|attestors|) and DoS-able if the set grows. Generation-counters give O(1) round-rotation: increment the counter, all reads now point to a fresh sub-mapping where every slot is zero. Because the round is also mixed into the commitment hash, replays from old rounds fail at hash-verification, not at reveal-storage check, so the protocol is safe even if a verifier forgets the round-stale check.

This is conceptually identical to monotonic generation-counters in concurrent data structures (CAS counters, ABA prevention). The shape ports cleanly to any per-round reveal protocol.

## Concrete example

From `contracts/core/CircuitBreaker.sol` attested-resume:

```solidity
/// @notice Trip generation per breaker type. Increments on each trip transition;
///         used to scope attestation records to the current trip without iterating
///         the attestor set to clear state on reset.
mapping(bytes32 => uint256) public tripGeneration;

/// @notice Per-generation, per-attestor attestation record.
///         Key: (breakerType, tripGeneration, attestor).
///         Old generations are implicitly stale when generation increments.
mapping(bytes32 => mapping(uint256 => mapping(address => bool))) private _hasAttestedResume;

function attestResume(bytes32 breakerType) external onlyAttestor {
    uint256 gen = tripGeneration[breakerType];
    if (_hasAttestedResume[breakerType][gen][msg.sender]) revert AlreadyAttestedResume();
    _hasAttestedResume[breakerType][gen][msg.sender] = true;
    // ...
}
```

And from `contracts/incentives/ShapleyDistributor.sol`:

```solidity
/// @notice Commitments are scoped to the current revealRound so prior-round
///         commitments cannot replay.
mapping(bytes32 => mapping(address => uint256)) public revealRound;

function computeNoveltyCommitment(
    bytes32 gameId,
    address participant,
    uint256 multiplierBps,
    bytes32 salt
) public view returns (bytes32) {
    uint256 currentRound = revealRound[gameId][participant];
    return keccak256(abi.encode(
        address(this), gameId, participant, multiplierBps, salt, currentRound
    ));
}
```

`address(this)` plus the round counter give two-axis isolation: cross-instance replay and cross-round replay both fail at hash verification.

## When to use

- A commit-reveal protocol that runs in rounds (per-game, per-trip, per-batch).
- Multiple committers per round, where you'd otherwise need to iterate to clear stale state.
- The round transition is rare relative to commit volume, so paying the iteration cost on transition is undesirable.

## When NOT to use

- Single-shot commit-reveal (no rounds). The generation counter is dead weight.
- The committer set is provably tiny (e.g., single committer). Direct clears are simpler.
- Off-chain protocols where storage cost is not the dominant concern. The pattern's value is structural cheapness on chains where SSTORE is expensive.

## Related primitives

- [`classification-default-with-explicit-override.md`](./classification-default-with-explicit-override.md) — sibling pattern for adding a new dimension (override-set) to existing storage without breaking the original semantics.
