# Running Total Pattern

**Status**: stub — full one-pager coming in V0.6.

## Teaser

Unbounded `for` loops over participant lists are gas-DoS vectors. Replace them with O(1) running-total aggregates maintained incrementally on each state change. Adds one storage slot; removes gas-scaling failure modes.

**Where it lives**: `contracts/consensus/NakamotoConsensusInfinity.sol` (`totalActiveWeight` aggregate). Primitive extracted Cycle 4. See `memory/primitive_running-total-pattern.md`.

**When to use**: any function that reads a running aggregate computed from an iterable set of state entries. If the set can grow unboundedly, the naive loop will eventually break.
