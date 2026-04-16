# Graceful Distribution Fallback

**Status**: stub — full one-pager coming in V0.6.

## Teaser

Multi-recipient emission or revenue splits must not block the entire distribution if one recipient reverts. Use `try/catch` around each external call; if a recipient fails, reroute its slice to a backstop (insurance pool, protocol treasury) and emit an event for off-chain monitoring. Pair with a minimum-gas floor to prevent 63/64-OOG-grief forcing the catch branch deliberately.

**Where it lives**: `contracts/consensus/SecondaryIssuanceController.sol` (three-way split with try/catch on shardRegistry and daoShelter). Primitive extracted Cycle 7 (`C7-ISS-001`), gas-floor hardening Cycle 11 Batch A (`C11-AUDIT-1`, commit `49e7fa72`). See `memory/primitive_graceful-distribution-fallback.md`.

**When to use**: any on-chain distribution to 2+ independent recipient contracts where an upgrade-path change in one recipient shouldn't brick the emission schedule for the rest.
