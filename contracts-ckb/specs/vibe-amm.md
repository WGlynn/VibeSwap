# VibeAMM — CKB Cell Spec

**Spec layer**: `contracts/amm/VibeAMM.sol`
**Port classification**: REINTERPRET
**Status**: Spec draft. No implementation cells yet.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Constant-product AMM (x · y = k) that holds the trading reserves for each pool. Most swap volume flows through it as batched settlement from CommitRevealAuction, with uniform clearing prices computed in the batch settlement type-script. The AMM also supports direct LP arbitrage swaps and liquidity provision and withdrawal. TWAP validation, circuit breakers, Fibonacci-scaled throughput limits, and fee distribution all live in the pool's type-script.

The structural property is that no one can change the reserves except via a transaction that satisfies the invariant. The invariant is enforced by the substrate, not by application-layer access control. There is no admin role for routine operations.

## Cell architecture

One PoolCell per trading pair holds the live state. Liquidity provider shares live as VibeLPCells. Swaps consume the PoolCell and re-create it with updated reserves. Adds and removes consume the PoolCell and adjust both reserves and the LP-share supply tracker.

**PoolCell.** The single source of truth for a pool's state. Holds reserve amounts for both sides of the pair, the LP total supply, the fee rate, the TWAP oracle state (ring buffer of recent observations), and the circuit breaker state. Lock-script is permissionless: anyone can submit a transaction that updates the pool, the type-script enforces that the update is valid. The cell's outpoint serves as the pool ID.

**VibeLPCell.** sUDT-shaped cell representing a holder's share of a specific pool. The type-script is parameterized by the PoolCell's identity. Standard sUDT-style conservation and balance semantics. Holders can transfer freely (LP shares are tradeable). Burning a VibeLPCell during a remove-liquidity transaction releases the corresponding pro-rata share of pool reserves.

**TwapObservationCell** (optional). For pools where the TWAP ring buffer doesn't fit in the PoolCell's data budget, observations spill into a sidecar cell that the PoolCell references via cell-dep. The PoolCell still contains the active aggregation state.

**CircuitBreakerCell** (optional). For pools where the circuit breaker state needs to be observable cross-pool (volume breakers can apply across pools), a separate breaker-state cell aggregates triggers. Most pools won't need this.

## Per-cell specifications

### PoolCell

**Data layout** (cell-data):
- `version: u8`
- `token_a_type_hash: [u8; 32]`
- `token_b_type_hash: [u8; 32]`
- `reserve_a: u128`
- `reserve_b: u128`
- `lp_total_supply: u128`
- `fee_rate_bps: u16` (default 5 for 0.05%)
- `protocol_fee_share_bps: u16` (default 0, max 2500)
- `twap_state: TwapState` (8-slot ring buffer)
- `breaker_state: BreakerState` (volume tracker, price tracker, withdrawal tracker)
- `min_liquidity_locked: u64` (10000, by construction at pool creation)
- `created_at_block: u64`
- `last_swap_block: u64`

**Lock-script**: Permissionless. The default-empty script (always returns success). All authorization for changes lives in the type-script.

**Type-script invariants** (universal):
- The output PoolCell preserves `token_a_type_hash`, `token_b_type_hash`, `fee_rate_bps`, `protocol_fee_share_bps`, `created_at_block` from input
- `reserve_a > 0` and `reserve_b > 0` (no zero-side pool)
- `reserve_a * reserve_b >= input.reserve_a * input.reserve_b * (10000 - max_fee_drop_bps) / 10000` (k preserved minus accumulated fees; exact form depends on operation)
- TWAP state advances correctly based on the operation
- Circuit breaker state is checked and updated

**Type-script invariants** (per operation):

*Swap*: A single token-in input, single token-out output (or batch settlement reference).
- `amount_in / reserve_in ≤ MAX_TRADE_SIZE_BPS / 10000`
- `amount_out ≤ reserve_out * MAX_RESERVE_DRAIN_PERCENT / 100`
- Constant-product formula holds: `(reserve_in + amount_in_post_fee) * (reserve_out - amount_out) == reserve_in * reserve_out`
- Resulting `reserve_in_new / reserve_out_new` does not deviate from TWAP by more than MAX_PRICE_DEVIATION_BPS
- Per-user Fibonacci damping applies if user has hit damping bands in the rolling window

*Add liquidity*: Two token inputs (proportional), one VibeLPCell output minted.
- `dA / reserve_a == dB / reserve_b` (proportional add) OR first-add: any ratio, mint = sqrt(dA * dB) - MINIMUM_LIQUIDITY
- LP shares minted = `min(dA * lp_total_supply / reserve_a, dB * lp_total_supply / reserve_b)` for subsequent adds
- `lp_total_supply` increases by minted amount
- First add locks MINIMUM_LIQUIDITY shares to the zero address (mint to a burn-cell)

*Remove liquidity*: One VibeLPCell input burned, two token outputs.
- `dA = lp_burned * reserve_a / lp_total_supply`
- `dB = lp_burned * reserve_b / lp_total_supply`
- `lp_total_supply` decreases by burned amount
- Withdrawal circuit breaker check: if (`lp_burned / lp_total_supply > breaker_threshold`) AND (cumulative withdrawals in window exceed threshold), fail unless the share is below SMALL_WITHDRAWAL_BPS_THRESHOLD

*Batch settle*: Triggered by a BatchSettlementCell from CommitRevealAuction.
- The settlement transaction consumes both the PoolCell and the relevant RevealCells
- The PoolCell type-script verifies that the cumulative net flow into the pool from the batch is consistent with the matched orders in the BatchSettlementCell
- TWAP and breaker state advance from the cumulative batch, not per-order
- Single-transaction settlement preserves x·y=k across all orders in the batch

### VibeLPCell

**Data layout** (cell-data):
- `version: u8`
- `pool_id: OutPoint` (the genesis PoolCell that created this LP class)
- `amount: u128`

**Lock-script**: Owner lock (Omnilock or secp256k1). Holders authorize their own transfers.

**Type-script invariants**:
- Token conservation across the transaction: sum of input amounts for the same pool_id equals sum of output amounts
- During mint (add liquidity): output amount exists in conjunction with the PoolCell adjustment; the burn-cell receives MINIMUM_LIQUIDITY on first add
- During burn (remove liquidity): input amount is correctly debited from supply tracker
- pool_id is preserved across transfers

### Burn cell (MINIMUM_LIQUIDITY lock)

A VibeLPCell with a lock-script that is provably unspendable. The standard pattern is a lock-script that always fails, identified by a known type-hash. The first add-liquidity transaction for a pool mints MINIMUM_LIQUIDITY shares into this lock. Mirror of Uniswap V2's "address(0) mint."

## Transaction shapes

**Create pool**: One caller transaction.
- Inputs: caller's tokenA cell, caller's tokenB cell, capacity for the new PoolCell
- Outputs: new PoolCell with reserves initialized, new VibeLPCell to caller with `sqrt(dA * dB) - MINIMUM_LIQUIDITY` shares, burn-cell VibeLPCell with MINIMUM_LIQUIDITY shares
- Type-script verifies pool genesis conditions and proportional initialization

**Add liquidity**: One LP transaction.
- Inputs: PoolCell, LP's tokenA cell, LP's tokenB cell
- Outputs: updated PoolCell, new VibeLPCell to LP
- Type-script verifies proportional add and correct LP mint amount

**Remove liquidity**: One LP transaction.
- Inputs: PoolCell, LP's VibeLPCell
- Outputs: updated PoolCell, LP's tokenA cell with `dA` worth, LP's tokenB cell with `dB` worth
- Type-script verifies pro-rata withdrawal and circuit breaker conditions

**Direct swap**: One trader transaction (less common; most swaps go through CommitRevealAuction).
- Inputs: PoolCell, trader's tokenIn cell
- Outputs: updated PoolCell, trader's tokenOut cell
- Type-script verifies x·y=k preservation, MAX_TRADE_SIZE, MAX_RESERVE_DRAIN, TWAP deviation
- Note: direct swaps are vulnerable to the MEV that batch settlement dissolves. Users with non-arbitrage intent should route through CommitRevealAuction.

**Batch settle from CommitRevealAuction**: One settlement transaction.
- Inputs: PoolCell, all RevealCells for the batch (matched to this pool)
- Outputs: updated PoolCell, BatchSettlementCell, per-order trade-output cells routing tokens to recipients
- Both the PoolTypeScript and the BatchSettlementTypeScript verify their respective halves of the settlement correctness

## Property preservation

**x·y=k invariance**: The type-script enforces the constant-product formula on every operation. The substrate guarantees that the only way to change reserves is via an authorized transition. There is no admin override for changing reserves directly.

**TWAP validation**: Each swap or batch settlement updates the TWAP ring buffer. Resulting price must not deviate from the TWAP by more than MAX_PRICE_DEVIATION_BPS. Two-window drift check (MAX_TWAP_DRIFT_BPS per window) catches gradual manipulation walks across multiple windows.

**Circuit breakers**: Volume, price, and withdrawal breakers all live in the PoolCell's breaker_state. Each operation updates the relevant counter and fails if the breaker threshold is hit. Resume requires an attestation (per [P·circuit-breaker-attested-resume]) which on CKB is a separate cell with its own type-script gating the breaker reset.

**Fibonacci-scaled throughput**: Per-user damping along 23.6/38.2/50/61.8% bands over a rolling window, with cooldown = window × 1/φ. On CKB this is a per-user sidecar cell that records cumulative swap volume against time-stamps. The pool's type-script consults this cell via cell-dep during direct swaps.

**No owner role**: VibeAMM's Solidity version is "Phase 1: owner controls all admin." The CKB version starts at Phase 4 (ghost). There is no owner. Fee changes, protocol-share changes, and circuit-breaker resets all go through governance-gated mutation cells. The PoolCell itself has no admin path.

**Donation attack resistance**: MAX_DONATION_BPS limits the imbalance one party can create by sending tokens directly to the pool. On CKB, donations of token cells without a corresponding LP mint are rejected by the type-script if they push imbalance past 1%.

**Minimum liquidity lock**: MINIMUM_LIQUIDITY shares are locked in a provably-unspendable VibeLPCell at pool creation, preventing first-depositor attacks.

## Upstream pulls

**From `ckb-system-scripts`**: secp256k1-blake160 for LP owner locks; dao primitives for treasury fee flow.

**From sUDT**: Token cells for tokenA and tokenB hold the trading reserves. VibeLPCell follows the sUDT pattern with custom type-script for pool-specific conservation.

**From Omnilock**: Trader and LP authorization.

**From `ckb-std`**: All syscalls, witness parsing, cell inspection, blake2b. Both type-scripts (Pool and VibeLP) are `ckb-std`-backed Rust crates.

**From `ckb-merkle-mountain-range`**: For pools that aggregate cross-pool breaker state, an MMR over breaker triggers provides succinct inclusion proofs.

**Reference patterns from Yokaiswap and Spore**: Yokaiswap's L2-AMM design has prior art on pool-as-cell shapes, with the caveat that they run on Godwoken (a CKB L2), not L1 cells. Spore's ownership-cell pattern informs the VibeLPCell shape.

## Build new

**PoolTypeScript**: Rust crate at `contracts-ckb/pool-type-script/`. Largest piece of new code in the AMM stack. Implements x·y=k verification, TWAP update, circuit breaker checks, Fibonacci damping consultation, fee accumulation. Targets RISC-V 64.

**VibeLPTypeScript**: Rust crate at `contracts-ckb/vibe-lp-type-script/`. Modeled on sUDT type-script but parameterized by pool_id. Smaller than PoolTypeScript.

**FibonacciScalingCell + script**: Rust crate at `contracts-ckb/fibonacci-scaling-type-script/`. Tracks per-user swap volume against rolling window and exposes damping band for the PoolTypeScript to consult.

**TwapObservationCell + script** (optional): Rust crate at `contracts-ckb/twap-observation-type-script/`. Used only when the PoolCell data budget can't hold the full ring buffer.

**Burn-cell lock-script**: Already exists in Nervos system scripts. Standard pattern: lock-script hash that maps to a deterministic always-fail program. Pull from upstream.

## Open questions

- **Cycle budget for batch settlement**: A batch with N reveals routed through one pool produces a settlement transaction with one PoolCell update plus N output cells. The PoolTypeScript must verify the cumulative net flow is consistent. Spike needed to estimate cycle cost as N grows.

- **TWAP ring buffer in PoolCell data**: An 8-slot ring buffer with u128 prices and u64 timestamps is 192 bytes. Fits comfortably in cell data. A 64-slot buffer is 1.5 KB and starts pressuring capacity. Decide buffer depth based on TWAP_PERIOD and target update frequency.

- **Cross-pool breakers**: The Solidity version has both per-pool and protocol-wide breakers. CKB-native cross-pool aggregation requires a separate breaker-state cell that all PoolCells reference via cell-dep. Adds complexity. Defer until we have data on whether protocol-wide breakers are load-bearing.

- **Fee distribution and protocol fee**: On every swap, base fees accrue to LP holders implicitly (k grows). Protocol fee share, when set, requires routing capacity to a treasury cell on every swap. This is a recurring transaction overhead. Decide whether to route per-swap or accumulate in the PoolCell and route periodically.

- **TWAP-only direct swaps vs batched preferred**: The Solidity version allows direct swaps freely. For CKB, we may want to gate direct swaps to LP-arbitrage-only (verify the caller is an LP via VibeLPCell ownership) and route all user-intent flow through CommitRevealAuction. This would harden the MEV-resistance but adds a usage constraint. Open design question.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/amm/VibeAMM.sol`, `vibeswap/contracts/amm/VibeLP.sol`
- Solidity helpers: `BatchMath.sol`, `TWAPOracle.sol`, `VWAPOracle.sol`, `TruePriceLib.sol`, `LiquidityProtection.sol`, `FibonacciScaling.sol`, `CircuitBreaker.sol`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·dissolve-attack-surface]`, `[P·fibonacci-rate-limit-scale-invariance]`, `[P·circuit-breaker-attested-resume]`, `[P·TWAP-depeg-detector]`
- Related specs: `commit-reveal-auction.md` (batched swap entry point), `shapley-distributor.md` (pending), `messaging-hub.md` (pending)
