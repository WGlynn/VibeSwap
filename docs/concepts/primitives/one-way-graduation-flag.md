# One-Way Graduation Flag

**Status**: shipped (cycle C42)
**First instance**: `ShapleyDistributor.disableOwnerSetter()` graduating Grade C → Grade B
**Convergence with**: `bootstrap-cycle-dissolution-via-post-mint-lock.md`

## The pattern

A contract ships with an owner-trusted bootstrap path (Grade C disintermediation) that is structurally weaker than the eventual fully-permissionless or attestor-gated path (Grade B / A). Rather than migrating the contract to remove the bootstrap path, ship a **one-way boolean flag** that, once flipped, makes the bootstrap path inert. The flag has no un-flip — it is a monotonic graduation, not a toggle.

```solidity
bool public ownerSetterDisabled;

function bootstrapPath(...) external onlyOwner {
    if (ownerSetterDisabled) revert PathDisabled();
    // ... bootstrap-trust mutation
}

function disableOwnerSetter() external onlyOwner {
    if (ownerSetterDisabled) revert OwnerSetterAlreadyDisabled();
    ownerSetterDisabled = true;
    emit OwnerSetterDisabled();
}
```

The cost is one storage slot and one external function. The benefit is graceful decommission of a bootstrap path without contract migration, without changing the disintermediation grade of currently-running pools, and with a single on-chain event marking the graduation moment.

## Why it works

Graduation usually requires migration: a new contract address, a state-transfer plan, a coordinated user-redirect. Here, both paths exist simultaneously in the same code. Pre-graduation, the bootstrap path serves traffic. Post-graduation, the bootstrap path reverts and the alternative (commit-reveal, attestor-gated, etc.) is the only writable surface.

One-way ensures the graduation is observable forever and irreversible. An auditor querying `ownerSetterDisabled` sees a single bit that says "this contract is graduated"; that bit cannot lie, cannot regress, and is not coupled to off-chain governance trust. It's a structural commitment that future governance — even compromised governance — cannot undo.

## Concrete example

From `contracts/incentives/ShapleyDistributor.sol`:

```solidity
/// @notice One-way flag: once set to true via `disableOwnerSetter`, the
///         legacy `setNoveltyMultiplier` path becomes inert. Graduates the
///         contract from owner-trusted (Grade C) to keeper-attested (Grade B).
bool public ownerSetterDisabled;

/// @notice One-way flip: disable the legacy owner-only `setNoveltyMultiplier`
///         path. After this call, only the keeper-attested commit-reveal path
///         can write multipliers.
/// @dev Irreversible by design. This is the contract's bootstrap → mature
///      transition for novelty-multiplier authority.
function disableOwnerSetter() external onlyOwner {
    if (ownerSetterDisabled) revert OwnerSetterAlreadyDisabled();
    ownerSetterDisabled = true;
    emit OwnerSetterDisabled();
}
```

The `setNoveltyMultiplier` legacy path checks the flag and reverts post-graduation. The keeper-attested commit-reveal path runs independently and is unaffected.

## When to use

- Bootstrap-trust path (owner setter, multisig-gated mutation, oracle-fed value) needs to be retired in favor of a structurally-stronger replacement.
- Both paths can coexist in the same contract.
- The graduation moment matters for legitimacy — auditors and integrators want a clear on-chain record.
- Cost of contract migration (proxy upgrade with state transfer, user redirect) is high relative to the value of removing the bootstrap path.

## When NOT to use

- The bootstrap path's storage layout conflicts with the mature path. Migration may be cheaper.
- The contract is non-upgradeable AND deployment is cheap. A new clean contract is honest about what it is.
- The bootstrap path needs to remain available for emergency use (e.g., guardian pause). One-way removal precludes that — keep it as a regular toggle with strong governance guardrails.

## Related primitives

- [`bootstrap-cycle-dissolution-via-post-mint-lock.md`](./bootstrap-cycle-dissolution-via-post-mint-lock.md) — sibling pattern: a one-way setter that points at a peer contract, dissolving a construction-time circular dependency.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — when adding the graduation flag to an upgradeable contract, the post-upgrade default should be "graduated" rather than "bootstrap" if security depends on it.
