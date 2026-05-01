# Bootstrap-Cycle Dissolution via Post-Mint Lock

**Status**: shipped (cycle C45)
**First instance**: `SoulboundIdentity` ↔ `ContributionAttestor` lineage binding
**Convergence with**: `one-way-graduation-flag.md`, `fail-closed-on-upgrade.md`

## The pattern

Contract `A` needs `B`-state at construction (e.g., to validate its initial inputs). But `B` needs `A`-state to exist (e.g., it issues claims about `A`'s holders). You cannot `new A(B)` if you also need `new B(A)`. The naive resolution is two-stage deployment with hand-wired addresses, which is brittle and does not survive proxy patterns.

The pattern: `A` admits a **permissive default** at construction (the dependency on `B` is disabled / unset / address-zero), then exposes a **monotonic-lock setter** that wires `B` once `B` exists. The lock is one-way — once `A` is wired to a specific `B`, no future call can rewire it. The dependency-cycle is dissolved temporally: `A`'s identity is created in a "lineage-unbound" state and graduates to a "lineage-bound" state via a single setter call, after which the binding is immutable.

```solidity
// In A's storage:
address public bContract;             // 0 means "unbound, permissive"
mapping(uint256 => bytes32) public lineageHash;  // 0 means "not yet bound"

function bindLineage(uint256 tokenId, bytes32 claimId) external {
    require(bContract != address(0), "B not set");
    require(lineageHash[tokenId] == 0, "already bound");  // monotonic
    bytes32 hash = _deriveFromB(claimId);
    lineageHash[tokenId] = hash;       // one-way write
    emit LineageBound(tokenId, claimId, hash);
}
```

## Why it works

The cycle is not a structural impossibility — it is a *temporal* impossibility. At t=0, both contracts cannot exist with full state. At t=N (after both have deployed and at least one binding has occurred), they can. The post-mint-lock pattern stretches the construction across this temporal gap: `A` is "born" in a partial state, `B` is born referencing `A`'s address, and then `A` claims its `B`-derived state in a separate transaction that is immutable once committed.

Monotonicity is essential. If the setter were reversible, the lineage hash could be rewritten by a malicious owner, defeating the provenance guarantee. One-way means the on-chain record of "who-vouched-for-this-identity-first" is trustless after the lock.

## Concrete example

From `contracts/identity/SoulboundIdentity.sol`:

```solidity
/// @notice ContributionAttestor contract — source of truth for attested contributions.
/// @dev Set in initialize() (fresh deploys) or initializeV2() (upgrade path).
///      address(0) means lineage binding is disabled.
address public contributionAttestor;

/// @notice tokenId => keccak256(abi.encode(contributionAttestor, claimId)) of the
///         first attested ContributionAttestor claim where the holder is contributor.
/// @dev Once set (non-zero), this is immutable for the life of the identity.
mapping(uint256 => bytes32) public tokenLineageHash;

/// @notice tokenId => the original claimId used to derive `tokenLineageHash`.
mapping(uint256 => bytes32) public tokenLineageClaimId;
```

Permissive default: `contributionAttestor = address(0)` at deploy. An identity minted in this window has no lineage hash. Once the attestor is wired and the identity makes its first attested contribution, `bindSourceLineage` writes the lineage hash and the claim ID. The hash is then immutable for the life of that identity.

The bootstrap cycle dissolved: `SoulboundIdentity` exists without `ContributionAttestor`; `ContributionAttestor` then deploys referencing the soulbound contract; identities created post-deploy can bind their lineage.

## When to use

- Two contracts have a circular construction-time dependency.
- The dependency is *for state derivation*, not for runtime authorization on every call. (If `A` needs `B` to authorize every operation, you can't ship a permissive default — see "When NOT to use".)
- Once bound, the relationship is immutable for the lifetime of the bound entity.

## When NOT to use

- The dependency is required on EVERY operation, not just at lifecycle transitions. A permissive default would create a security gap where un-bound entities perform mutations that should require `B`.
- The cycle is structural, not temporal — for example, two contracts that need to atomically reference each other's storage. Use a router or a third coordinator contract.
- The relationship needs to be reassignable (e.g., if `B` itself is upgradeable and the binding should follow). Then the setter must NOT be one-way; consider a delegate-proxy pattern instead.

## Related primitives

- [`one-way-graduation-flag.md`](./one-way-graduation-flag.md) — sibling: a one-way bool that decommissions a path. Both share the monotonic-write geometry.
- [`fail-closed-on-upgrade.md`](./fail-closed-on-upgrade.md) — for upgradeable contracts: post-upgrade, the lineage-bound state should default to "binding required" before any new mints, so unbound identities cannot accumulate.
