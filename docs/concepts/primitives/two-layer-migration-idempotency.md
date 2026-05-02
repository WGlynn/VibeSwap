# Two-Layer Migration Idempotency

**Status**: shipped (cycles C39, C45)
**First instance**: `CircuitBreaker._initializeC39SecurityDefaults` + `VibeAMM.initializeC39Migration`; `SoulboundIdentity.initializeV2`
**Convergence with**: `fail-closed-on-upgrade.md`, `one-way-graduation-flag.md`

## The pattern

A UUPS-upgradeable contract needs a one-shot migration: wire new state, set a feature flag, preserve in-flight invariants. There are two natural places idempotency must hold:

1. **At the entrypoint** (the `external` initializer function), so duplicate upgrade transactions are rejected.
2. **At the helper** (the `internal` worker the entrypoint calls), so any `initialize()` / `reinitializer(N)` overload that calls the helper does not double-mutate state.

Solving only one layer leaves a hole. The two-layer shape combines them:

```solidity
// Layer 1: helper-internal completion flag — defends ANY caller path.
bool public migrationInitialized;

function _initializeMigration() internal {
    if (migrationInitialized) return;          // idempotent, silent
    // ... do the migration work ...
    migrationInitialized = true;
}

// Layer 2: reinitializer(N) — defends the entrypoint against duplicate upgrades.
function initializeMigration() external reinitializer(2) onlyOwner {
    _initializeMigration();
}

// Fresh-deploy initializer also calls the helper (safe — flag idempotency wins).
function initialize(...) external initializer {
    // ... fresh-deploy state ...
    _initializeMigration();                    // claims the slot for upgraders too
}
```

`reinitializer(N)` (OpenZeppelin's `Initializable`) ensures the **upgrade entrypoint** can run at most once per proxy at version N. The helper-internal flag ensures the **migration logic** cannot double-fire even if a sibling initializer at version M ≠ N also calls the helper. Together they cover both fresh-deploy → upgrade and upgrade → re-upgrade transitions cleanly.

## Why it works

OpenZeppelin's `reinitializer(N)` modifier increments an internal `_initialized` slot. It guarantees the modified function runs at most once at version N, but it makes no guarantee about the *body* of that function — if the body calls a helper and that helper is also called from another initializer (e.g., fresh-deploy `initialize()`), the helper might run multiple times across the proxy's lifetime in legitimate ways.

The helper-internal flag fixes that: the helper records "I have run on this proxy" in its own storage slot. Any subsequent call — from a future `reinitializer(M)`, from a defensive owner-triggered re-run, from a sibling initializer chain — short-circuits to a no-op. The two layers are *orthogonal*: one defends transactions, the other defends state mutations.

The shape also lets the migration helper be invoked from the **fresh-deploy** initializer. Fresh deploys have no in-flight state to preserve, so the helper's body is effectively a no-op (no tripped breakers to pin, no legacy semantics to preserve), but calling it claims the completion-flag slot. That makes the upgrade-path `reinitializer(2)` an idempotent re-entry on fresh-deploys too, eliminating the dead-code path the audit would otherwise flag.

## Concrete example

From `contracts/core/CircuitBreaker.sol`:

```solidity
/// @notice C39 migration completion flag. Per `primitive_post-upgrade-initialization-gate`:
///         the zero-value of this slot ("false") semantically means "C39 migration
///         has not run on this proxy".
bool public c39SecurityDefaultsInitialized;

function _initializeC39SecurityDefaults() internal {
    if (c39SecurityDefaultsInitialized) return;            // Layer 1: helper idempotent
    // ... pin overrides on in-flight tripped security breakers ...
    c39SecurityDefaultsInitialized = true;
    emit C39SecurityDefaultsInitialized(finalPreserved);
}
```

Inheritor `contracts/amm/VibeAMM.sol` wires both layers:

```solidity
function initialize(...) external initializer {
    // ... fresh-deploy state ...
    _initializeC39SecurityDefaults();                      // claims slot on fresh deploys
}

function initializeC39Migration() external reinitializer(2) onlyOwner {  // Layer 2
    _initializeC39SecurityDefaults();                      // safe re-call via Layer 1
}
```

Same shape in `contracts/identity/SoulboundIdentity.sol`:

```solidity
bool public lineageBindingEnabled;                         // Layer 1 flag

function initializeV2(address _contributionAttestor) external reinitializer(2) onlyOwner {
    require(_contributionAttestor != address(0), "Zero attestor");
    if (lineageBindingEnabled) return;                     // Layer 1 short-circuit
    contributionAttestor = _contributionAttestor;
    lineageBindingEnabled = true;
    emit ContributionAttestorSet(prev, _contributionAttestor);
    emit LineageBindingEnabled();
}
```

In SoulboundIdentity the two layers collapse into a single function, but both invariants still hold: `reinitializer(2)` blocks duplicate upgrade-tx; the `lineageBindingEnabled` early-return blocks state-mutation if a fresh-deploy already enabled binding via `setContributionAttestor`.

## When to use

- UUPS / Transparent proxy with at least one shipped version and a planned upgrade.
- The migration mutates security-relevant state (flags, registry pointers, in-flight invariants).
- The migration helper is — or might become — callable from multiple initializer chains (fresh deploy + multiple `reinitializer(N)` versions).

## When NOT to use

- Non-upgradeable contracts. Constructors run exactly once; both layers are unnecessary.
- The migration is purely additive and re-running it would be a no-op anyway (e.g., setting a constant to its current value). Layer 1 is then redundant; `reinitializer(N)` alone is sufficient.
- The migration MUST be re-runnable across versions (e.g., parameter-update path). That is not a migration; it is an admin function — model it as such with explicit access control.

## Related primitives

- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — sibling: the completion-flag pattern doubles as the fail-closed gate. Until the helper runs, the feature reverts.
- [`one-way-graduation-flag.md`](./one-way-graduation-flag.md) — the completion flag is itself a one-way graduation flag; the migration moves the contract from "pre-feature" to "feature live" and never moves back.
