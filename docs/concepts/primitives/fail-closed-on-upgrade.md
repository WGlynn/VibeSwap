# Fail-Closed on Upgrade as Security Default

**Status**: shipped (cycles C39, C45, C47)
**First instance**: `SoulboundIdentity.lineageBindingEnabled`, `CircuitBreaker.c39SecurityDefaultsInitialized`, `ClawbackRegistry.contestParamsInitialized`
**Convergence with**: `bootstrap-cycle-dissolution-via-post-mint-lock.md`, `two-layer-migration-idempotency.md`

## The pattern

A new feature is added in an upgrade. The feature is *security-relevant* — its defaults affect what the protocol allows by default. The naive shape — "feature on with weak defaults" — turns the upgrade into a vulnerability window where security-relevant capabilities run with un-tuned parameters. The fail-closed shape inverts:

```solidity
bool public featureInitialized;  // zero-default = "not initialized"

// Feature gate: revert until initialized
function useFeature(...) external {
    if (!featureInitialized) revert FeatureNotInitialized();
    // ...
}

// Initialization is the explicit upgrade step
function initializeFeatureV2(...) external reinitializer(2) {
    // ... wire parameters
    featureInitialized = true;
    emit FeatureInitialized();
}
```

Pre-upgrade: feature does not exist; reverts. Post-upgrade-but-pre-init: feature reverts ("not initialized"). Post-init: feature is on. The upgrade is *atomic with parameter wiring* if the implementation is shipped via `upgradeToAndCall(newImpl, abi.encodeCall(initializeFeatureV2, (...)))`. Otherwise there is a window where the feature is unavailable but no security gap exists.

## Why it works

The zero-value of a freshly-allocated storage slot ("false", 0, address(0)) is the *default state* on any upgraded proxy. Old proxies inherit this default automatically. If the security-relevant interpretation of "false" is "feature off", the upgrade is safe-by-default. If the interpretation were "feature on with default values", the upgrade would silently activate untested behavior.

The asymmetry is structural: "off" is recoverable (call the initializer), "on with weak defaults" is not (the security gap may already have been exploited). Fail-closed defaults extend the principle of secure-by-default to the upgrade path itself.

## Concrete example

From `contracts/identity/SoulboundIdentity.sol`:

```solidity
/// @notice Post-upgrade initialization gate (per primitive_post-upgrade-initialization-gate).
///         Fresh deploys set this true via initialize(). Upgraded proxies must call
///         initializeV2(attestor) (reinitializer(2)) to enable lineage binding.
///         When false, bindSourceLineage() reverts — fail-closed posture.
bool public lineageBindingEnabled;
```

From `contracts/core/CircuitBreaker.sol`:

```solidity
/// @notice C39 migration completion flag. Per `primitive_post-upgrade-initialization-gate`:
///         the zero-value of this slot ("false") semantically means "C39 migration
///         has not run on this proxy".
bool public c39SecurityDefaultsInitialized;
```

From `contracts/compliance/ClawbackRegistry.sol`:

```solidity
/// @notice C47 reinitializer version sentinel. Allows post-upgrade
///         initialization of contest parameters (initializeContestV1).
bool public contestParamsInitialized;

// Contest entry-points revert with ContestParamsNotInitialized() if the flag
// is false on a contract that was upgraded but not yet initialized.
```

Three independent cycles, same shape: a boolean whose zero-value means "not yet initialized" and whose true-value is set only by a `reinitializer(N)` initializer that wires all parameters atomically.

## When to use

- Adding a new feature in a UUPS / Transparent proxy upgrade.
- The feature has security-relevant defaults: thresholds, gates, classification rules.
- An attacker could exploit the upgrade window if the feature were on with weak defaults.
- Initialization parameters cannot be derived deterministically from prior state — they require explicit governance choice.

## When NOT to use

- Non-upgradeable contracts. There is no "upgrade window"; constructor handles all initialization.
- The feature has no security-relevant defaults (e.g., a new view function, a logging-only event). Fail-closed adds friction with no benefit.
- The feature MUST be active immediately on upgrade (e.g., a critical patch). Then ship the upgrade as `upgradeToAndCall(newImpl, abi.encodeCall(initialize, (...)))` so init runs atomically; the gate is still useful as a sentinel even if the gap window is zero.

## Related primitives

- [`bootstrap-cycle-dissolution-via-post-mint-lock.md`](./bootstrap-cycle-dissolution-via-post-mint-lock.md) — sibling: pre-binding, the contract is in a permissive default. Fail-closed flips this for security-relevant flags.
- [`two-layer-migration-idempotency.md`](./two-layer-migration-idempotency.md) — combines fail-closed with idempotency for safe re-entry of the initializer.
- [`one-way-graduation-flag.md`](./one-way-graduation-flag.md) — graduation flags are themselves fail-closed (default off → explicit graduation).
