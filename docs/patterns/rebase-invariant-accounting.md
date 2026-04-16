# Rebase-Invariant Accounting

**Status**: stub — full one-pager coming in V0.6.

## Teaser

When a protocol's backing check or rate limit is denominated in external (post-rebase) token units, monetary policy silently shifts the denominator. Backing checks drift, rate limits become wrong across time. Fix: anchor accounting in **internal** (pre-rebase) units, exposed by the token via a dedicated view (e.g., `internalBalanceOf`). External amounts are display-only; gates read internal.

**Where it lives**: `contracts/monetary/JarvisComputeVault.sol` (backing in internal JUL units) + `contracts/monetary/JULBridge.sol` (rate limit in internal units). Primitive extracted Cycle 8 Phases 8.3/8.4. See `memory/primitive_rebase-invariant-accounting.md`.

**When to use**: any rebasing or elastic-supply token integration where something is measured and compared across time.
