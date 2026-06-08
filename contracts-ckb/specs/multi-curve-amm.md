# Multi-Curve AMM — CKB Cell Spec

**Spec layer**: extends `contracts/amm/VibeAMM.sol` per-pool curve selection
**Port classification**: BUILD-NEW + REINTERPRET
**Status**: Spec draft. Extension 4a of the match-or-beat-CoW plan.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Lets each pool choose its bonding curve at creation. Three curve options:

- **Constant Product (x · y = k)**: the default. Same as Uniswap V2 and the current VibeAMM design. Best for uncorrelated pairs.
- **Concentrated Liquidity**: discrete-tick model in the Uniswap V3 style. Best for tight pairs where capital efficiency matters and LPs are willing to actively manage range.
- **StableSwap**: the Curve V1 invariant for assets that should trade ~1:1. Best for stable-stable pairs (USDC/USDT/DAI), wrapped-asset pairs (wBTC/renBTC), or like-asset pairs (stETH/ETH).

Curve selection is immutable once the pool is created. A pool genesis transaction specifies the curve and its parameters (e.g., StableSwap's amplification coefficient A, or concentrated liquidity's tick spacing).

The structural property: a pool's depth at the relevant price range matches the geometric expectations of the asset pair. CoW Protocol can route through external Curve and UniV3 pools to access these characteristics; we provide them natively.

## Cell architecture

Each pool's PoolCell gains a `curve_kind` field plus curve-specific parameter fields. The PoolTypeScript dispatches to the appropriate invariant check based on `curve_kind`.

**No new cell types.** What changes:

- PoolCell.curve_kind: enum tag
- PoolCell.curve_params: variable-size struct, layout depends on curve_kind
- For concentrated liquidity: additional TickCells holding per-tick liquidity data, referenced by the PoolCell

## Curve kinds

### Constant Product (curve_kind = 0)

**Invariant**: `reserve_a * reserve_b == k`, k preserved minus fees.

**curve_params**: empty (no parameters needed).

**Use cases**: ETH/USDC, ETH/BTC, any uncorrelated or weakly-correlated pair.

**Type-script verification**: identical to the original VibeAMM spec.

### Concentrated Liquidity (curve_kind = 1)

**Invariant**: piecewise constant-product within active tick range; out-of-range LP positions don't contribute to current liquidity.

**curve_params**:
- `tick_spacing: u32` (in basis points; e.g., 10 for 0.1% ticks, 60 for 0.6%)
- `fee_tier_bps: u16` (5 / 30 / 100 typical)
- `current_tick: i32`
- `current_sqrt_price: u128`
- `active_liquidity: u128`

**TickCells**: separate cells, one per non-empty tick boundary. Each holds:
- `tick_index: i32`
- `liquidity_net: i128` (signed; positive crossing left-to-right adds liquidity)
- `liquidity_gross: u128`
- `fee_growth_outside: u128`
- `pool_outpoint: OutPoint` (which pool this tick belongs to)

**LP position**: a VibeLPCell with extended data
- `tick_lower: i32`
- `tick_upper: i32`
- `liquidity_amount: u128`
- `fee_growth_inside_last: u128` (snapshot at last mint/burn for fee accounting)

**Type-script verification**:
- A swap that crosses a tick boundary updates the active_liquidity using the tick's `liquidity_net`
- The sqrt_price moves continuously within a tick range and discretely at boundaries
- Within-tick swap math uses the Uniswap V3 formulas: `Δy = L · Δsqrt(P)` and `Δx = L · Δ(1/sqrt(P))`
- Position mint adds the position's liquidity to its tick range
- Position burn removes liquidity and computes fees earned

**Cycle budget caveat**: the swap type-script must traverse all ticks crossed by the trade. A swap that crosses 10 ticks does 10 sub-iterations. This is bounded by the swap size and the pool's tick density. For typical batches, well within CKB-VM cycle budget. For extreme swaps, the type-script can cap tick-crossings and require the trader to split.

### StableSwap (curve_kind = 2)

**Invariant**: `(A · n^n · Σx) + D = (A · D · n^n) + (D^(n+1) / (n^n · Πx))`, where:
- n is the number of assets in the pool (typically 2, can be 3+ for triple-stable pools)
- A is the amplification coefficient (typically 50-200)
- D is the invariant value (sum of balances when prices balanced)
- xᵢ are the per-asset balances

**curve_params**:
- `amplification: u64` (A coefficient)
- `asset_count: u8` (n; 2 for pairs, 3+ for multi-asset pools)
- `precision_multipliers: Vec<u64>` (per-asset decimal normalization)

**Type-script verification**:
- D is computed via Newton-Raphson iteration to specified precision (~5-10 iterations)
- A swap computes the new balance of the output asset by solving the invariant equation iteratively
- The newton iteration is deterministic; bounded iteration count via Lawson constants registry
- LP add/remove follows the standard Curve V1 formulas

**Cycle budget**: Newton-Raphson iteration is bounded (~10 iterations max) and each iteration is O(n) where n = asset count. For 2-asset pools, well within budget. For 3-asset pools, still tractable. Cap asset_count ≤ 4 to keep cycle cost bounded.

## Pool creation

**Pool creation transaction**: extends the existing VibeAMM pool-creation pattern.

Inputs: creator's tokenA cell, creator's tokenB cell, capacity for the new PoolCell + initial VibeLPCell + (if concentrated) initial TickCells.

Outputs:
- PoolCell with chosen curve_kind and curve_params
- Initial VibeLPCell to creator (with MINIMUM_LIQUIDITY locked to burn-cell)
- For concentrated liquidity: the first LP position's tick boundary cells

Curve selection is checked at creation:
- Constant product: no additional checks
- Concentrated: tick_spacing must be in {1, 10, 30, 60, 200} (whitelisted values)
- StableSwap: amplification must be in [10, 1000]; precision_multipliers must match the token decimal configs

## Composition with existing mechanisms

**Cycle resolver (Extension 1)**: cycles are detected on the intent graph regardless of curve kind. Cycle netting doesn't touch the pool; residuals do. Residuals route through the pool using the pool's curve.

**CommitRevealAuction batch settlement**: the uniform clearing price computation depends on the pool's curve. For constant product, the formula is the standard one. For concentrated, the formula uses the active liquidity at the current sqrt_price. For StableSwap, the formula uses the invariant solver.

**Shapley fee distribution**: fees flow to the LP positions that earned them. For constant product, all LPs share pro-rata of stake. For concentrated, only in-range LPs earn fees on a swap. For StableSwap, all LPs share pro-rata (the curve is non-positional).

## Type-script invariants (universal across curve kinds)

In addition to the curve-specific invariants:

- Token conservation: `Σ inputs == Σ outputs` for each token in the pool, plus accumulated fees
- LP supply conservation: minted LP units match the position-add math; burned LP units match position-remove math
- Per-curve, the invariant holds to specified precision (exact for constant product; within rounding tolerance for StableSwap)
- TWAP state advances per swap (curve-agnostic; computed from the realized exchange rate)
- Circuit breaker state advances per swap (curve-agnostic)
- Fibonacci rate-limit damping consultation (curve-agnostic)

## Property preservation

**Capital efficiency**: concentrated liquidity gives stable-pair LPs the same depth-per-dollar that UniV3 gives. CoW routes through UniV3; we have it natively.

**Stable-pair pricing**: StableSwap's invariant means stable-pair swaps experience near-zero slippage at peg. CoW routes through Curve for this; we have it natively.

**Curve selection at pool genesis is immutable**: a pool's curve can't be changed by governance. New pools can be created with different curves on the same pair (e.g., a constant-product ETH/USDC pool and a concentrated ETH/USDC pool coexist). LPs and traders choose which.

**Migration path**: traders can swap between identical-pair pools of different curves via standard multi-hop routing (handled in the composable-resolution-paths spec, Extension 3).

## Upstream pulls

**From Nervos CKB**: `ckb-std` syscalls, hashing, cell inspection.

**From sUDT/xUDT**: token reserves.

**From Uniswap V3 spec**: tick-based concentrated liquidity formulas (CC0 / public-domain references).

**From Curve V1 spec**: stable-swap invariant + Newton-Raphson solver pattern (papers/spec are public; implementations are MIT or compatible).

**From the existing VibeAMM spec (`vibe-amm.md`)**: the PoolCell base, VibeLPCell base, TWAP/breaker/Fibonacci composition.

## Build new

**`vibeswap-ckb-pool-type-script-multi-curve`**: extension of the existing PoolTypeScript with curve dispatch. Per-curve modules:
- `curve_constant_product`: trivial.
- `curve_concentrated_liquidity`: tick traversal, sqrt-price math, position accounting.
- `curve_stableswap`: D solver, swap solver, amplification coefficient handling.

**`vibeswap-ckb-tick-type-script`**: new crate. TickCell creation, update, deletion as part of LP position management.

**`vibeswap-ckb-fixed-point`**: shared fixed-point math (q64.64 or similar) for sqrt-price + invariant computations. Used across concentrated liquidity and StableSwap.

## Open questions

- **Fixed-point precision**: q64.64 (Uniswap V3 style) vs higher precision. Choose based on CKB-VM word-size and worst-case rounding error analysis.
- **Newton-Raphson iteration cap**: too low = imprecise; too high = cycle cost. Empirically 8-10 iterations is sufficient for most StableSwap configs. Calibrate against test vectors.
- **Concentrated liquidity tick density**: high tick density = capital efficiency but more tick-crossings per swap. Cap pool's `max_ticks_per_swap` via Lawson constants. Trader needs to know if their swap will hit the cap.
- **Cross-curve arbitrage**: identical pairs in constant-product vs concentrated pools will drift. Arbitrageurs converge them. This is healthy; document for LP-side expectations.

## Cross-references

- Parent spec: `vibeswap/contracts-ckb/specs/vibe-amm.md`
- Sibling specs (this batch): `cross-pool-lp.md`, `thin-pool-fee-subsidy.md`
- Composes with: `batch-cycle-resolver.md` (residual-only hits the pool), `composable-resolution-paths.md` (multi-curve routing as Path B)
- Plan doc: `Desktop/vibeswap-match-or-beat-cow-mechanism-plan-2026-06-08.md` (Extension 4a)
- Lawson constants: per-curve parameters bounded
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·substrate-geometry-match]` (StableSwap matches stable-pair geometry; concentrated matches tight-range geometry)
