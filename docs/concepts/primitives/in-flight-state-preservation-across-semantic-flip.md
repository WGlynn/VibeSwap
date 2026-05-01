# In-Flight State Preservation Across Semantic Flip

**Status**: shipped (cycle C39)
**First instance**: `CircuitBreaker._initializeC39SecurityDefaults()` migration
**Convergence with**: `classification-default-with-explicit-override.md`, `two-layer-migration-idempotency.md`

## The pattern

A code change flips the semantic meaning of an existing storage slot. Pre-change, slot value `S` meant `M_old`; post-change, the same value `S` means `M_new`. If any process is *currently mid-flight* and started under `M_old`, it must complete under `M_old` semantics — otherwise the flip silently changes the rules of an in-flight operation.

The migration must:

1. Detect "currently mid-flight" by reading state predicates that distinguish active from quiescent.
2. For each in-flight key, *pin the override* to the OLD interpretation, so the flip leaves it alone.
3. Mark the migration as run, so it does not double-pin on a subsequent re-entry.

New operations started after the migration get the new semantics. In-flight operations finish on their original contract.

```solidity
function migrateSemantics() internal {
    if (migrationRan) return;
    for (each key K in critical-set) {
        if (isInFlight(K) && !overrideSet(K)) {
            // Pin to OLD interpretation for the duration of this flight
            overrideValue[K] = OLD_VALUE;
            overrideSet[K] = true;
            emit InFlightPinned(K);
        }
    }
    migrationRan = true;
}
```

## Why it works

The flip is safe only at quiescent points (between operations). For any state machine, "quiescent" is identifiable in the storage layout — a `tripped` flag, a non-empty queue, an active timer. The migration walks the in-flight set ONCE and converts each in-flight entry into an explicit pin under the old semantics.

The pin is structural protection: from this point forward, the resolver function (see [`classification-default-with-explicit-override.md`](./classification-default-with-explicit-override.md)) sees `overrideSet = true` and consults the old value. The new classification default applies only to keys that were quiescent at migration time AND any keys created post-migration.

This is conceptually identical to copy-on-write semantics for software upgrades: the upgrade reads "snapshot before flip" for any in-flight transaction, "current state" for any new transaction.

## Concrete example

From `contracts/core/CircuitBreaker.sol`:

```solidity
/// @dev   Without this migration, an existing pre-C39 proxy whose LOSS_BREAKER
///        is currently tripped would see `_isAttestedResumeRequired` flip from
///        false to true on the next read — pinning the breaker tripped past
///        cooldown until attestors arrive. We pin the override to false on
///        ALREADY-TRIPPED security breakers with no override set, which keeps
///        the in-flight trip on its original wall-clock path. New trips after
///        this point fall through to the C39 default-on classification.
function _initializeC39SecurityDefaults() internal {
    if (c39SecurityDefaultsInitialized) return;

    bytes32[2] memory securityBreakers = [LOSS_BREAKER, TRUE_PRICE_BREAKER];
    for (uint256 i = 0; i < securityBreakers.length; i++) {
        bytes32 bType = securityBreakers[i];
        // Only pin on IN-FLIGHT tripped breakers without an existing override.
        // Untripped breakers fall through to the new classification default.
        if (breakerStates[bType].tripped && !attestedResumeOverridden[bType]) {
            requiresAttestedResume[bType] = false;       // pin to OLD semantics
            attestedResumeOverridden[bType] = true;      // mark as overridden
        }
    }

    c39SecurityDefaultsInitialized = true;
}
```

A breaker that was tripped pre-C39 finishes its trip under C43-era wall-clock semantics. A breaker that trips post-migration falls through to the C39 default-on classification (attestors required to resume).

## When to use

- A code change flips the meaning of an existing storage slot.
- The protocol has *state machines with intermediate states* — operations that span multiple transactions.
- An in-flight operation experiencing a mid-life rule change would produce surprising or unsafe behavior.

## When NOT to use

- The change is purely additive — new fields, new code paths, no slot-meaning flip. No migration needed.
- The protocol has no in-flight operations (every transaction completes atomically). No mid-flight state to preserve.
- The flip is intentional and applies retroactively (e.g., a protocol-wide parameter tune that should affect everything immediately). Don't pin; just flip.

## Related primitives

- [`classification-default-with-explicit-override.md`](./classification-default-with-explicit-override.md) — the override-flag pattern that makes this migration possible. Without an override mechanism, you cannot pin in-flight state without iterating.
- [`two-layer-migration-idempotency.md`](./two-layer-migration-idempotency.md) — the migration must be idempotent so re-entries do not re-pin.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — for slot-flips that increase security tightness, this primitive plus fail-closed gives the safe-upgrade combination.
