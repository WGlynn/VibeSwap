# Off-Circulation Registry

**Status**: stub — full one-pager coming in V0.6.

## Teaser

Whitelist-based aggregator of token balances held by external staking/collateral contracts that a token's canonical `totalOccupied` / `offCirculation` counter misses. Avoids invasive cross-contract refactoring when tokens reach contracts via standard `transferFrom` rather than a dedicated lock path.

**Where it lives**: `contracts/monetary/CKBNativeToken.sol` (registry) + `contracts/consensus/SecondaryIssuanceController.sol` (consumer). Primitive extracted Cycle 8 (commit `a1f73675`). See `memory/primitive_off-circulation-registry.md`.

**When to use**: any token-emission / supply-split calculation where "how much is in active circulation" matters and some holders are external contracts the core token wasn't designed to know about.
