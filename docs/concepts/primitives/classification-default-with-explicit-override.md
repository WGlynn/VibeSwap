# Classification-Default with Explicit-Override

**Status**: shipped (cycle C39)
**First instance**: `CircuitBreaker.sol` C39 default-on attested-resume migration
**Convergence with**: `in-flight-state-preservation-across-semantic-flip.md`, `fail-closed-on-upgrade.md`

## The pattern

A boolean shipped earlier as raw opt-in (`bool flag[key]`) needs to graduate so that a SUBSET of keys defaults to true while preserving governance's right to flip any key explicitly. The right shape is **not** to mutate the raw slot's semantics, but to add a **sibling override-flag** and route reads through a function that resolves:

```
effective(key) = override_set(key) ? override_value(key) : classify(key)
```

The raw slot is no longer the answer — it's an *override-value* that is only consulted when the override-flag is set. New keys flow through the classification function. Governance sets the flag (with either value) to pin a specific key.

## Why it works

Three properties drop out for free:

1. **Backwards compatibility for explicit governance choices.** Anyone who set the raw flag pre-migration retains their pin, because the migration sets `override_set = true` for them.
2. **Forward authority of classification.** Any key never touched by governance gets the classification default, and that default can be changed in-protocol without touching every key.
3. **Symmetric override.** Governance can pin a key to *false* even when the classifier says true. The override is a true override, not a one-way upgrade. This matters when classification is wrong for a particular operational reality.

The alternative — mutating the raw slot's meaning ("now `false` means default-on for security keys") — is a semantic flip that breaks any reader still consulting the raw slot directly. Sibling-flag indirection costs one extra `SLOAD` and dissolves the flip.

## Concrete example

From `contracts/core/CircuitBreaker.sol` (C39 implementation):

```solidity
// Raw value (pre-existing, override semantics under C39)
mapping(bytes32 => bool) public requiresAttestedResume;

// Override-set flag (new in C39)
mapping(bytes32 => bool) public attestedResumeOverridden;

// Effective answer
function _isAttestedResumeRequired(bytes32 bType) internal view returns (bool) {
    if (attestedResumeOverridden[bType]) {
        return requiresAttestedResume[bType];
    }
    return _isSecurityLoadBearing(bType); // classification default
}

// Setter pins the override regardless of value
function setAttestedResumeRequired(bytes32 bType, bool required) external onlyOwner {
    requiresAttestedResume[bType] = required;
    attestedResumeOverridden[bType] = true; // any explicit call sets the flag
}
```

Note the setter sets `attestedResumeOverridden = true` even when the value being written agrees with the classification default. That is intentional: a governance call is a *commitment to the chosen value*, immune to future classifier drift.

## When to use

- A boolean was shipped opt-in and you want to flip a curated subset to default-on, without breaking explicit governance choices.
- Classification logic (which keys default-on) may evolve, and you want classifier changes to propagate to non-overridden keys automatically.
- The space of keys is open-ended (new keys minted post-migration must inherit the current classification default).

## When NOT to use

- The space of keys is closed and small — write the migration as a per-key explicit pin and skip the classifier.
- The "classification" is just one bit (one global default). Use a single global default-flag plus a per-key override; the classifier function is overkill.
- You need the raw slot to remain authoritative for legacy readers. The pattern requires all consumers to migrate to the resolver function.

## Related primitives

- [`in-flight-state-preservation-across-semantic-flip.md`](./in-flight-state-preservation-across-semantic-flip.md) — how the C39 migration preserves in-flight state when the resolver semantics change mid-life.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — corollary for security-relevant flags: classification default is the fail-closed direction.
