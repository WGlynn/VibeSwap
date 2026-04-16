# Saturating Accounting Math

**Status**: stub — full one-pager coming in V0.6.

## Teaser

For state-mutation paths that MUST succeed (e.g., operator exit returning stake), replace silent-revert subtraction with saturating math: `x >= y ? x - y : 0`. Guards against any future state drift that would otherwise revert the transaction and strand users. Defense-in-depth, not a logic change in well-formed cases.

**Where it lives**: `contracts/consensus/ShardOperatorRegistry.sol` (`totalCellsServed` saturation in both deactivate paths). Primitive extracted Cycle 11 Batch B (commit `117f3631`). See `memory/project_full-stack-rsi.md` (C11-AUDIT-7).

**When to use**: any counter-decrement on a function whose failure would strand users. Don't saturate on counter-increment (that's a real bug you want to see).
