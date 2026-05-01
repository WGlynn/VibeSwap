# Post-Upgrade Initialization Gate

**Status**: stub — full one-pager coming in V0.6.

## Teaser

Any new storage slot introduced by a UUPS upgrade whose zero-value semantics diverge from contract assumptions needs a `reinitializer(N)` packaged into `upgradeToAndCall`, gated by a completion flag. Human-triggered post-upgrade scripts are a vulnerability window: a forgotten setter leaves security disabled on the first post-upgrade block.

**Where it lives**: `contracts/monetary/JarvisComputeVault.sol` (`migrateToInternalBacking` reinitializer + `backingMigrationComplete` flag). Primitive extracted Cycle 9 (commit `8af15911`). See `memory/primitive_post-upgrade-initialization-gate.md`.

**When to use**: every UUPS upgrade that adds storage. Audit test: "what happens on the first block after upgrade if nobody has called the setter yet?" If the answer is "security is weaker than intended," you need the gate.
