# vibe-amm-cell-type-script

CKB type-script for VibeAMM. REINTERPRET port of `contracts/amm/VibeAMM.sol`.

## What this is

Single binary, three roles dispatched on `type_script.args[0]`:

- `0x01` **PoolCell** — x*y=k state, TWAP ring (8 slots), volume-breaker counter.
- `0x02` **VibeLPCell** — sUDT-shaped LP-share token; parameterized by pool outpoint.
- `0x03` **TwapObservationCell** — optional ring-buffer sidecar for pools whose
  ring doesn't fit in the PoolCell data budget.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against deployed lawson / circuit-breaker / canonical-
  token binaries. Inline TODOs mark each gap.
- **Not machine-verified on this box.** Same capsule / toolchain blockers as
  sibling crates — the source compiles in review but no capsule binary
  emitted, no VM-driven test executed. Math is enforced in `verify()`; the
  binding "this dep IS the breaker / lawson / pool" is shape-only.
- **Not the breaker authority.** `circuit-breaker-cell-type-script` enforces
  trip / attest / cooldown / finalize. This crate cell-deps the BreakerCell
  and rejects any swap when state != Clear (shape-only gate).
- **Not the canonical-token authority.** sUDT conservation lives in
  `vibeswap-canonical-token-type-script`. The pool reads reserve sUDT type
  hashes for matching only.
- **Not the Fibonacci-damping cell.** Spec calls for a per-user sidecar
  cell consulted on direct swaps; deferred to a separate crate.
- **Not the batch-settlement path.** CommitRevealAuction settlement
  transactions exercise a different verification branch (cumulative net
  flow against matched orders); deferred — the EmptyTransition error fires
  on any pool transition that isn't pure swap / add / remove.

## Cell-data layouts

### PoolCell (358 bytes fixed)

| field                       | bytes | offset |
|-----------------------------|-------|--------|
| version                     |   1   |    0   |
| token_a_type_hash           |  32   |    1   |
| token_b_type_hash           |  32   |   33   |
| reserve_a (u128 LE)         |  16   |   65   |
| reserve_b (u128 LE)         |  16   |   81   |
| lp_total_supply (u128 LE)   |  16   |   97   |
| fee_rate_bps (u16 LE)       |   2   |  113   |
| protocol_fee_share_bps (u16)|   2   |  115   |
| min_liquidity_locked (u64)  |   8   |  117   |
| created_at_block (u64)      |   8   |  125   |
| last_swap_block (u64)       |   8   |  133   |
| twap_ring (8 * 24 bytes)    | 192   |  141   |
| twap_head_index (u8)        |   1   |  333   |
| breaker_volume_counter      |  16   |  334   |
| breaker_window_start (u64)  |   8   |  350   |

Each TWAP slot = `price (u128 LE) || timestamp (u64 LE)`.

### VibeLPCell (53 bytes fixed)

| field                       | bytes | offset |
|-----------------------------|-------|--------|
| version                     |   1   |    0   |
| pool_outpoint_tx            |  32   |    1   |
| pool_outpoint_index (u32 LE)|   4   |   33   |
| amount (u128 LE)            |  16   |   37   |

### TwapObservationCell (81 bytes fixed)

| field                       | bytes | offset |
|-----------------------------|-------|--------|
| version                     |   1   |    0   |
| pool_outpoint_tx            |  32   |    1   |
| pool_outpoint_index (u32 LE)|   4   |   33   |
| observation_index (u32 LE)  |   4   |   37   |
| price (u128 LE)             |  16   |   41   |
| cumulative (u128 LE)        |  16   |   57   |
| timestamp (u64 LE)          |   8   |   73   |

## Type-script args

`args[0]` = RoleTag (1 byte). For LP / TWAP roles, remaining args encode
the pool-outpoint binding (CYCLE5: explicit serialization to be pinned).

## Invariants enforced

### PoolCell

1. **Identity preservation**: token_a_type_hash, token_b_type_hash,
   fee_rate_bps, protocol_fee_share_bps, created_at_block, min_liquidity_locked
   are immutable across every transition.
2. **No zero-side reserves**: reserve_a > 0 and reserve_b > 0 on every output.
3. **Constant product on swap**: `(reserve_in + amount_in_post_fee) *
   (reserve_out - amount_out) >= reserve_in * reserve_out`.
4. **Trade-size cap**: `amount_in / reserve_in <= MAX_TRADE_SIZE_BPS / 10_000`.
5. **Reserve-drain cap**: `amount_out / reserve_out <= MAX_RESERVE_DRAIN_PERCENT / 100`.
6. **Fee accounting**: `amount_in_post_fee = amount_in * (10_000 - fee_bps) / 10_000`.
7. **TWAP deviation**: post-swap spot vs head-slot TWAP price; band
   gated by `MAX_PRICE_DEVIATION_BPS`. (v1: cross-multiplication; production
   needs fixed-point price representation — open spec question.)
8. **TWAP head advance**: head moves by `+1 mod 8` (single-swap) or stays
   (batch settle). Head-slot timestamp monotone.
9. **Volume-breaker accumulation**: counter += amount_in within window;
   resets to amount_in on window boundary; window_start is monotone.
10. **Breaker not tripped**: at least one BreakerCell-shaped cell present
    in cell-deps with state == Clear; ANY tripped breaker shape-matching
    cell rejects.
11. **Lawson cell-dep present**: shape-only gate; the actual constant reads
    are TODO (v1 uses in-script floors).
12. **Add liquidity**: `dA * reserve_b == dB * reserve_a`; LP mint =
    `dA * lp_total_supply / reserve_a`.
13. **Remove liquidity**: `dA = burned * reserve_a / lp_total_supply`;
    `dB = burned * reserve_b / lp_total_supply`.
14. **Pool genesis**: `lp_supply^2 <= reserve_a * reserve_b` (sqrt floor);
    `min_liquidity_locked >= MINIMUM_LIQUIDITY`.

### VibeLPCell

1. **pool_id preservation** across the group: all input + output LP cells
   in the group must reference the same pool outpoint.
2. **Amount conservation**: `sum_in == sum_out` for pure transfer.
3. **Mint / burn requires paired PoolCell**: any `sum_in != sum_out`
   transition requires a PoolCell-shaped cell in tx inputs OR outputs
   (shape-only gate; the PoolCell's role-path enforces the matching
   `lp_total_supply` delta).

### TwapObservationCell

1. **Monotone obs_index**: `out.obs_index == in.obs_index + 1`.
2. **Strictly increasing timestamp** across the ring.
3. **pool_id preserved** through ring rotation.

## Composition (executed defaults)

- **lawson-constants-cell-type-script** (cell-dep, mandatory): fee_bps,
  MAX_TRADE_SIZE_BPS, MAX_RESERVE_DRAIN_PERCENT, MAX_PRICE_DEVIATION_BPS,
  MAX_TWAP_DRIFT_BPS, MAX_DONATION_BPS, MINIMUM_LIQUIDITY. v1 reads only
  presence; values come from in-script floors.
- **circuit-breaker-cell-type-script** (cell-dep, mandatory on swap):
  BreakerCell must be in state Clear. Shape-only gate; production binds
  by mechanism_id == pool outpoint.
- **vibeswap-canonical-token-type-script** (same-tx inputs / outputs):
  sUDT reserves. Type-hash matching by `token_a_type_hash` /
  `token_b_type_hash` recorded in PoolCell. (CYCLE5: cross-cell amount
  conservation per side.)

## Status

**Spec scaffold, not audit-ready, not machine-verified on this box.**
Capsule build not wired (same toolchain blockers as sibling crates — see
`contracts-ckb/tests/README.md`). Cell-dep discrimination uses shape
heuristics; production wants compile-time-embedded code-hash matching.
The invariant arithmetic is enforced in source; the binding of cell-deps
to specific deployed scripts is currently shape-only.

## Open questions (from spec § Open questions)

- **TWAP fixed-point**: ratio comparison via cross-multiplication is fragile
  on extreme reserve disparities. Q64.64 or Q96.96 representation pending.
- **Batch settlement path**: not yet specced in this verifier; current
  branching rejects with `EmptyTransition` on transitions that aren't
  pure swap / add / remove.
- **Fibonacci damping**: spec calls for a per-user sidecar consulted on
  direct swaps; not in this crate.
- **Cross-pool breakers**: spec defers a separate aggregated breaker-state
  cell; not in this crate.
- **Direct-swap gating**: spec floats LP-only direct swaps with all
  user-intent routed through CommitRevealAuction; not enforced here.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-35: cell-shape invariants
- 40-42: PoolCell identity / destruction / zero-side
- 50-54: x*y=k / fee / trade-size / drain / donation
- 60-65: LP-supply / proportional-add / first-add
- 70-73: TWAP deviation / ring / monotonicity / drift
- 80-82: breaker missing / tripped / counter
- 90-92: Lawson / canonical-token composition
- 100-102: VibeLPCell pool_id / conservation / overflow

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p vibe-amm-cell-type-script
```

(Capsule not wired on this dev box; same blocker as siblings.)

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub gated by
`#[cfg(any())]`. Runnable integration tests land in
`contracts-ckb/tests/src/vibe_amm_cell_type_tests.rs` once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/vibe-amm.md`
- Circuit-breaker spec: `contracts-ckb/specs/circuit-breaker.md`
- Lawson constants spec: `contracts-ckb/specs/lawson-constants.md`
- EVM source: `contracts/amm/VibeAMM.sol`, `contracts/amm/VibeLP.sol`
- Siblings (composed with):
  - `lawson-constants-cell-type-script/` (constants source)
  - `circuit-breaker-cell-type-script/` (tripped-gate)
  - `vibeswap-canonical-token-type-script/` (reserve sUDT)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·dissolve-attack-surface]`, `[P·TWAP-depeg-detector]`,
  `[P·circuit-breaker-attested-resume]`, `[P·fibonacci-rate-limit-scale-invariance]`.
