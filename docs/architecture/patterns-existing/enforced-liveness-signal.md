# Enforced Liveness Signal

**Status**: stub — full one-pager coming in V0.6.

## Teaser

If a contract defines `HEARTBEAT_INTERVAL`, `GRACE_PERIOD`, `STALE_THRESHOLD` constants, some on-chain path MUST consume them — to gate rewards, allow permissionless eviction, or disable actions for stale participants. Unused liveness constants are security theater. Operators who go silent after committing to a claim should not keep earning.

**Where it lives**: `contracts/consensus/ShardOperatorRegistry.sol` — `_isStale()` + `deactivateStaleShard()` pair. Operators who stop heartbeating past `HEARTBEAT_GRACE` can be permissionlessly evicted by anyone; their stake is returned (no slash — this is eviction, not fraud) but their weight is removed from the active pool. Primitive extracted Cycle 10 (`C10-AUDIT-2`, commit `01530cd8`). See `memory/primitive_enforced-liveness-signal.md`.

**When to use**: any protocol where (a) participants earn ongoing rewards and (b) going offline without formally exiting should have a cost. Liveness signals only work if the protocol enforces them.
