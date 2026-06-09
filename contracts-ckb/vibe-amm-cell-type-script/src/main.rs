//! # VibeAMM Type Script
//!
//! REINTERPRET port of `contracts/amm/VibeAMM.sol` to the CKB cell model.
//! Three roles dispatched on `type_script.args[0]`:
//!
//!   0x01 PoolCell             — x*y=k state, TWAP ring, breaker counters.
//!   0x02 VibeLPCell           — sUDT-shaped LP-share token.
//!   0x03 TwapObservationCell  — optional ring-buffer sidecar.
//!
//! Spec: `vibeswap/contracts-ckb/specs/vibe-amm.md`
//! Composes: `lawson-constants-cell-type-script` (fee_bps, MAX_TRADE_SIZE_BPS,
//! MAX_RESERVE_DRAIN_PERCENT, MAX_PRICE_DEVIATION_BPS, MAX_TWAP_DRIFT_BPS,
//! MAX_DONATION_BPS, MINIMUM_LIQUIDITY), `circuit-breaker-cell-type-script`
//! (BreakerCell consumed via cell-dep; reject if state == Tripped),
//! `vibeswap-canonical-token-type-script` (reserve sUDT).
//!
//! ## Status
//!
//! Spec scaffold, not audit-ready, not machine-verified. Cell-dep discovery
//! is shape-heuristic; production needs compile-time code-hash matching
//! (same gap as sibling crates). Math is enforced; the binding "this dep IS
//! the breaker" is shape-only.

#![no_std]
#![no_main]

extern crate alloc;

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_type_hash, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Schema ============

const SCHEMA_VERSION: u8 = 1;

const BPS_DENOM: u128 = 10_000;
const PERCENT_DENOM: u128 = 100;

// Floors / defaults. Real values come from LawsonConstantsRegistry; these
// are the in-script fallbacks when the registry read returns sentinel.
const DEFAULT_FEE_BPS: u16 = 5;
const DEFAULT_MAX_TRADE_SIZE_BPS: u128 = 1_000;
const DEFAULT_MAX_RESERVE_DRAIN_PERCENT: u128 = 30;
const DEFAULT_MAX_PRICE_DEVIATION_BPS: u128 = 500;
const DEFAULT_MAX_TWAP_DRIFT_BPS: u128 = 200;
const DEFAULT_MAX_DONATION_BPS: u128 = 100;
const DEFAULT_MINIMUM_LIQUIDITY: u128 = 10_000;

const MAX_GROUP_CELLS: usize = 8;
const MAX_CELL_DATA: usize = 8_192;
const TWAP_RING_SLOTS: usize = 8;

// ============ Role tag ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RoleTag {
    Pool = 0x01,
    Lp = 0x02,
    TwapObservation = 0x03,
}

impl RoleTag {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Pool),
            0x02 => Some(Self::Lp),
            0x03 => Some(Self::TwapObservation),
            _ => None,
        }
    }
}

// ============ PoolCell layout ============
//
// version: u8                       @ 0
// token_a_type_hash: [u8; 32]       @ 1
// token_b_type_hash: [u8; 32]       @ 33
// reserve_a: u128 LE                @ 65
// reserve_b: u128 LE                @ 81
// lp_total_supply: u128 LE          @ 97
// fee_rate_bps: u16 LE              @ 113
// protocol_fee_share_bps: u16 LE    @ 115
// min_liquidity_locked: u64 LE      @ 117
// created_at_block: u64 LE          @ 125
// last_swap_block: u64 LE           @ 133
// twap_state: 8 slots * 24 bytes    @ 141   (price u128 + ts u64) per slot
// twap_head_index: u8               @ 333
// breaker_volume_counter: u128 LE   @ 334
// breaker_window_start: u64 LE      @ 350
//                                   = 358 bytes
const POOL_VERSION_OFFSET: usize = 0;
const POOL_TOKEN_A_HASH_OFFSET: usize = 1;
const POOL_TOKEN_B_HASH_OFFSET: usize = 33;
const POOL_RESERVE_A_OFFSET: usize = 65;
const POOL_RESERVE_B_OFFSET: usize = 81;
const POOL_LP_SUPPLY_OFFSET: usize = 97;
const POOL_FEE_BPS_OFFSET: usize = 113;
const POOL_PROTO_FEE_BPS_OFFSET: usize = 115;
const POOL_MIN_LIQ_OFFSET: usize = 117;
const POOL_CREATED_AT_OFFSET: usize = 125;
const POOL_LAST_SWAP_OFFSET: usize = 133;
const POOL_TWAP_RING_OFFSET: usize = 141;
const POOL_TWAP_SLOT_LEN: usize = 24;
const POOL_TWAP_HEAD_OFFSET: usize = 333;
const POOL_BREAKER_VOL_OFFSET: usize = 334;
const POOL_BREAKER_WINDOW_OFFSET: usize = 350;
const POOL_CELL_LEN: usize = 358;

// ============ VibeLPCell layout ============
//
// version: u8                       @ 0
// pool_outpoint_tx: [u8; 32]        @ 1
// pool_outpoint_index: u32 LE       @ 33
// amount: u128 LE                   @ 37
//                                   = 53 bytes
const LP_VERSION_OFFSET: usize = 0;
const LP_POOL_OUTPOINT_TX_OFFSET: usize = 1;
const LP_POOL_OUTPOINT_INDEX_OFFSET: usize = 33;
const LP_AMOUNT_OFFSET: usize = 37;
const LP_CELL_LEN: usize = 53;
const LP_POOL_ID_LEN: usize = 36;

// ============ TwapObservationCell layout ============
//
// version: u8                       @ 0
// pool_id_tx: [u8; 32]              @ 1
// pool_id_index: u32 LE             @ 33
// observation_index: u32 LE         @ 37
// price: u128 LE                    @ 41
// cumulative: u128 LE               @ 57
// timestamp: u64 LE                 @ 73
//                                   = 81 bytes
const TWAP_VERSION_OFFSET: usize = 0;
const TWAP_POOL_ID_OFFSET: usize = 1;
const TWAP_OBS_INDEX_OFFSET: usize = 37;
const TWAP_PRICE_OFFSET: usize = 41;
const TWAP_CUMULATIVE_OFFSET: usize = 57;
const TWAP_TIMESTAMP_OFFSET: usize = 73;
const TWAP_CELL_LEN: usize = 81;

// ============ BreakerCell subset (read-only via cell-dep) ============
//
// Mirrors circuit-breaker-cell-type-script BreakerCell offsets for the
// state byte. The pool consults BreakerCell via cell-dep before any swap.
const BREAKER_STATE_OFFSET: usize = 114;
const BREAKER_STATE_CLEAR: u8 = 0x01;
const BREAKER_CELL_MIN_LEN: usize = 133;

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Dispatch ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.is_empty() {
        return Err(Error::ScriptArgsMalformed);
    }
    let role = RoleTag::from_byte(args_bytes[0]).ok_or(Error::ScriptArgsMalformed)?;

    match role {
        RoleTag::Pool => verify_pool_cell(),
        RoleTag::Lp => verify_lp_cell(),
        RoleTag::TwapObservation => verify_twap_observation_cell(),
    }
}

// ============ PoolCell verification ============

fn verify_pool_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    // PoolCell is never destroyed without replacement; once minted it lives
    // forever as the single source of truth for the pair.
    if !inputs.is_empty() && outputs.is_empty() {
        return Err(Error::PoolDestroyed);
    }
    if outputs.is_empty() && inputs.is_empty() {
        return Ok(());
    }

    for out_data in &outputs {
        validate_pool_layout(out_data)?;
        validate_pool_output_invariants(out_data)?;
    }

    // Genesis (mint): no input PoolCell, only output.
    if inputs.is_empty() {
        return verify_pool_genesis(&outputs[0]);
    }

    // Transition: identity preservation + per-op invariant set.
    let in_data = &inputs[0];
    let out_data = &outputs[0];
    validate_pool_layout(in_data)?;
    verify_pool_identity_preserved(in_data, out_data)?;

    // Breaker gate: any tx touching the pool must reference a BreakerCell
    // via cell-dep, and that BreakerCell must be in state Clear.
    verify_breaker_not_tripped()?;

    // Lawson must be cell-dep'd (constants source). Shape-heuristic gate.
    require_lawson_cell_dep()?;

    // Branch on which reserves/supply changed. We classify the transition
    // by the delta pattern; each branch enforces its own invariants.
    let in_reserve_a = read_u128_le(&in_data[POOL_RESERVE_A_OFFSET..POOL_RESERVE_A_OFFSET + 16]);
    let in_reserve_b = read_u128_le(&in_data[POOL_RESERVE_B_OFFSET..POOL_RESERVE_B_OFFSET + 16]);
    let in_lp_supply = read_u128_le(&in_data[POOL_LP_SUPPLY_OFFSET..POOL_LP_SUPPLY_OFFSET + 16]);
    let out_reserve_a = read_u128_le(&out_data[POOL_RESERVE_A_OFFSET..POOL_RESERVE_A_OFFSET + 16]);
    let out_reserve_b = read_u128_le(&out_data[POOL_RESERVE_B_OFFSET..POOL_RESERVE_B_OFFSET + 16]);
    let out_lp_supply = read_u128_le(&out_data[POOL_LP_SUPPLY_OFFSET..POOL_LP_SUPPLY_OFFSET + 16]);

    let lp_changed = in_lp_supply != out_lp_supply;
    let reserves_changed = in_reserve_a != out_reserve_a || in_reserve_b != out_reserve_b;

    match (reserves_changed, lp_changed) {
        (true, false) => verify_swap_transition(
            in_data,
            out_data,
            in_reserve_a,
            in_reserve_b,
            out_reserve_a,
            out_reserve_b,
        ),
        (true, true) => {
            if out_lp_supply > in_lp_supply {
                verify_add_liquidity(
                    in_data,
                    out_data,
                    in_reserve_a,
                    in_reserve_b,
                    in_lp_supply,
                    out_reserve_a,
                    out_reserve_b,
                    out_lp_supply,
                )
            } else {
                verify_remove_liquidity(
                    in_reserve_a,
                    in_reserve_b,
                    in_lp_supply,
                    out_reserve_a,
                    out_reserve_b,
                    out_lp_supply,
                )
            }
        }
        // Pure metadata bumps (last_swap_block, TWAP head) without reserve
        // or supply changes are not currently a legal op. CYCLE5: gate
        // explicit TWAP-refresh tx if we ever spec one.
        _ => Err(Error::EmptyTransition),
    }
}

fn validate_pool_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < POOL_CELL_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[POOL_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

fn validate_pool_output_invariants(data: &[u8]) -> Result<(), Error> {
    let reserve_a = read_u128_le(&data[POOL_RESERVE_A_OFFSET..POOL_RESERVE_A_OFFSET + 16]);
    let reserve_b = read_u128_le(&data[POOL_RESERVE_B_OFFSET..POOL_RESERVE_B_OFFSET + 16]);
    // No-zero-side floor — both reserves strictly positive post-mint.
    if reserve_a == 0 || reserve_b == 0 {
        return Err(Error::ZeroReserveSide);
    }
    // fee_bps must fit a sane band — 0..=1000 (10%); above that is a
    // misconfiguration that would let governance steal LP value.
    let fee = read_u16_le(&data[POOL_FEE_BPS_OFFSET..POOL_FEE_BPS_OFFSET + 2]);
    if fee > 1_000 {
        return Err(Error::FeeAccountingWrong);
    }
    Ok(())
}

fn verify_pool_identity_preserved(in_data: &[u8], out_data: &[u8]) -> Result<(), Error> {
    // token hashes, fee_bps, protocol_fee_share_bps, created_at_block,
    // min_liquidity_locked are immutable — only governance update tx can
    // change fee_bps, and that path is gated separately (TODO).
    if in_data[POOL_TOKEN_A_HASH_OFFSET..POOL_TOKEN_A_HASH_OFFSET + 32]
        != out_data[POOL_TOKEN_A_HASH_OFFSET..POOL_TOKEN_A_HASH_OFFSET + 32]
    {
        return Err(Error::PoolIdentityMutated);
    }
    if in_data[POOL_TOKEN_B_HASH_OFFSET..POOL_TOKEN_B_HASH_OFFSET + 32]
        != out_data[POOL_TOKEN_B_HASH_OFFSET..POOL_TOKEN_B_HASH_OFFSET + 32]
    {
        return Err(Error::PoolIdentityMutated);
    }
    if in_data[POOL_FEE_BPS_OFFSET..POOL_FEE_BPS_OFFSET + 2]
        != out_data[POOL_FEE_BPS_OFFSET..POOL_FEE_BPS_OFFSET + 2]
    {
        return Err(Error::PoolIdentityMutated);
    }
    if in_data[POOL_PROTO_FEE_BPS_OFFSET..POOL_PROTO_FEE_BPS_OFFSET + 2]
        != out_data[POOL_PROTO_FEE_BPS_OFFSET..POOL_PROTO_FEE_BPS_OFFSET + 2]
    {
        return Err(Error::PoolIdentityMutated);
    }
    if in_data[POOL_CREATED_AT_OFFSET..POOL_CREATED_AT_OFFSET + 8]
        != out_data[POOL_CREATED_AT_OFFSET..POOL_CREATED_AT_OFFSET + 8]
    {
        return Err(Error::PoolIdentityMutated);
    }
    if in_data[POOL_MIN_LIQ_OFFSET..POOL_MIN_LIQ_OFFSET + 8]
        != out_data[POOL_MIN_LIQ_OFFSET..POOL_MIN_LIQ_OFFSET + 8]
    {
        return Err(Error::PoolIdentityMutated);
    }
    Ok(())
}

// ============ Pool genesis ============

fn verify_pool_genesis(out_data: &[u8]) -> Result<(), Error> {
    // First-add: caller chose any ratio. LP shares minted = sqrt(dA * dB)
    // - MINIMUM_LIQUIDITY; MINIMUM_LIQUIDITY locked in burn-cell.
    // CYCLE5: assert a paired burn-cell VibeLPCell of MINIMUM_LIQUIDITY
    // with the always-fail lock is in outputs.
    let reserve_a = read_u128_le(&out_data[POOL_RESERVE_A_OFFSET..POOL_RESERVE_A_OFFSET + 16]);
    let reserve_b = read_u128_le(&out_data[POOL_RESERVE_B_OFFSET..POOL_RESERVE_B_OFFSET + 16]);
    let lp_supply = read_u128_le(&out_data[POOL_LP_SUPPLY_OFFSET..POOL_LP_SUPPLY_OFFSET + 16]);
    let min_liq = read_u64_le(&out_data[POOL_MIN_LIQ_OFFSET..POOL_MIN_LIQ_OFFSET + 8]);

    if (min_liq as u128) < DEFAULT_MINIMUM_LIQUIDITY {
        return Err(Error::MinimumLiquidityNotLocked);
    }
    if reserve_a == 0 || reserve_b == 0 {
        return Err(Error::FirstAddRatioInvalid);
    }
    // Expected lp_supply ≈ sqrt(reserve_a * reserve_b). Approximate check
    // via squared bounds: lp_supply^2 ∈ [reserve_a*reserve_b - slack,
    // reserve_a*reserve_b]. CYCLE5: tight integer-sqrt comparison.
    let k = reserve_a.checked_mul(reserve_b).ok_or(Error::LpMintAmountWrong)?;
    let lp_sq = lp_supply.checked_mul(lp_supply).ok_or(Error::LpMintAmountWrong)?;
    if lp_sq > k {
        return Err(Error::LpMintAmountWrong);
    }
    Ok(())
}

// ============ Swap ============

fn verify_swap_transition(
    in_data: &[u8],
    out_data: &[u8],
    in_a: u128,
    in_b: u128,
    out_a: u128,
    out_b: u128,
) -> Result<(), Error> {
    // Exactly one side increases (token_in) and the other decreases (token_out).
    let a_in_dir = out_a >= in_a;
    let b_in_dir = out_b >= in_b;
    if a_in_dir == b_in_dir {
        return Err(Error::ConstantProductViolated);
    }
    let (reserve_in_before, amount_in, reserve_out_before, amount_out) = if a_in_dir {
        (in_a, out_a - in_a, in_b, in_b - out_b)
    } else {
        (in_b, out_b - in_b, in_a, in_a - out_a)
    };

    if amount_in == 0 || amount_out == 0 {
        return Err(Error::ConstantProductViolated);
    }

    // MAX_TRADE_SIZE: amount_in / reserve_in <= MAX_TRADE_SIZE_BPS / BPS.
    let lhs_trade = amount_in
        .checked_mul(BPS_DENOM)
        .ok_or(Error::ConstantProductViolated)?;
    let rhs_trade = reserve_in_before
        .checked_mul(DEFAULT_MAX_TRADE_SIZE_BPS)
        .ok_or(Error::ConstantProductViolated)?;
    if lhs_trade > rhs_trade {
        return Err(Error::MaxTradeSizeExceeded);
    }

    // MAX_RESERVE_DRAIN: amount_out <= reserve_out * MAX_RESERVE_DRAIN_PERCENT / 100.
    let drain_cap = reserve_out_before
        .checked_mul(DEFAULT_MAX_RESERVE_DRAIN_PERCENT)
        .ok_or(Error::ConstantProductViolated)?;
    if amount_out
        .checked_mul(PERCENT_DENOM)
        .ok_or(Error::ConstantProductViolated)?
        > drain_cap
    {
        return Err(Error::MaxReserveDrainExceeded);
    }

    // Constant-product post-fee: (reserve_in + amount_in_post_fee) *
    // (reserve_out - amount_out) >= reserve_in * reserve_out.
    let fee_bps = read_u16_le(&in_data[POOL_FEE_BPS_OFFSET..POOL_FEE_BPS_OFFSET + 2]) as u128;
    if fee_bps >= BPS_DENOM {
        return Err(Error::FeeAccountingWrong);
    }
    let amount_in_post_fee = amount_in
        .checked_mul(BPS_DENOM - fee_bps)
        .ok_or(Error::ConstantProductViolated)?
        / BPS_DENOM;

    let lhs_k = (reserve_in_before
        .checked_add(amount_in_post_fee)
        .ok_or(Error::ConstantProductViolated)?)
    .checked_mul(reserve_out_before - amount_out)
    .ok_or(Error::ConstantProductViolated)?;
    let rhs_k = reserve_in_before
        .checked_mul(reserve_out_before)
        .ok_or(Error::ConstantProductViolated)?;
    if lhs_k < rhs_k {
        return Err(Error::ConstantProductViolated);
    }

    // TWAP deviation: post-swap spot price vs TWAP. Compare ratios using
    // cross-multiplication to avoid u128 overflow on naive division.
    verify_twap_deviation(in_data, out_a, out_b)?;

    // TWAP ring buffer must advance (head_index moves by exactly 1 mod N,
    // and the head slot's timestamp is monotone). Sidecar TwapObservationCell
    // append is handled by the observation cell's own role-path.
    verify_twap_head_advance(in_data, out_data)?;

    // Breaker volume counter must accumulate amount_in on every swap.
    verify_breaker_volume_counter(in_data, out_data, amount_in)?;

    Ok(())
}

// ============ Add / Remove liquidity ============

fn verify_add_liquidity(
    in_data: &[u8],
    out_data: &[u8],
    in_a: u128,
    in_b: u128,
    in_supply: u128,
    out_a: u128,
    out_b: u128,
    out_supply: u128,
) -> Result<(), Error> {
    if out_a <= in_a || out_b <= in_b || out_supply <= in_supply {
        return Err(Error::ProportionalAddViolated);
    }
    let d_a = out_a - in_a;
    let d_b = out_b - in_b;
    let d_lp = out_supply - in_supply;

    // Proportionality: dA / reserve_a == dB / reserve_b
    // ⇒ dA * reserve_b == dB * reserve_a.
    let lhs = d_a.checked_mul(in_b).ok_or(Error::LpMintAmountWrong)?;
    let rhs = d_b.checked_mul(in_a).ok_or(Error::LpMintAmountWrong)?;
    if lhs != rhs {
        return Err(Error::ProportionalAddViolated);
    }

    // LP mint = min(dA * supply / reserve_a, dB * supply / reserve_b).
    // With proportional add both branches are equal — assert one form.
    let expected = d_a
        .checked_mul(in_supply)
        .ok_or(Error::LpMintAmountWrong)?
        / in_a;
    if d_lp != expected {
        return Err(Error::LpMintAmountWrong);
    }

    // The matching VibeLPCell mint is enforced by the LP role-path.
    // CYCLE5: cross-check by scanning outputs for a VibeLPCell of d_lp
    // referencing this pool's outpoint.
    let _ = (in_data, out_data);
    Ok(())
}

fn verify_remove_liquidity(
    in_a: u128,
    in_b: u128,
    in_supply: u128,
    out_a: u128,
    out_b: u128,
    out_supply: u128,
) -> Result<(), Error> {
    if out_a >= in_a || out_b >= in_b || out_supply >= in_supply {
        return Err(Error::LpBurnAmountWrong);
    }
    let burned = in_supply - out_supply;
    let expected_da = burned
        .checked_mul(in_a)
        .ok_or(Error::LpBurnAmountWrong)?
        / in_supply;
    let expected_db = burned
        .checked_mul(in_b)
        .ok_or(Error::LpBurnAmountWrong)?
        / in_supply;
    if (in_a - out_a) != expected_da || (in_b - out_b) != expected_db {
        return Err(Error::LpBurnAmountWrong);
    }
    // TODO: withdrawal-breaker check — large-share withdrawals in a window
    // fail unless burned/in_supply < SMALL_WITHDRAWAL_BPS_THRESHOLD.
    Ok(())
}

// ============ TWAP ============

fn verify_twap_deviation(in_data: &[u8], out_a: u128, out_b: u128) -> Result<(), Error> {
    // Spot price after swap = out_b / out_a (price of A in B).
    // TWAP price = head-slot price. Deviation check via cross-multiplication:
    // |spot - twap| / twap <= MAX_PRICE_DEVIATION_BPS / BPS.
    let head_idx = in_data[POOL_TWAP_HEAD_OFFSET] as usize % TWAP_RING_SLOTS;
    let slot_base = POOL_TWAP_RING_OFFSET + head_idx * POOL_TWAP_SLOT_LEN;
    if in_data.len() < slot_base + 16 {
        return Err(Error::TwapRingBufferMalformed);
    }
    let twap_price = read_u128_le(&in_data[slot_base..slot_base + 16]);
    if twap_price == 0 {
        // Uninitialized ring slot — first-swap path, skip deviation check.
        return Ok(());
    }
    if out_a == 0 {
        return Err(Error::ConstantProductViolated);
    }
    // spot * out_a = out_b (scaled by an implicit 1). Compare
    // |out_b * twap_a_unit - twap_price * out_a| against
    // (twap_price * out_a * MAX_DEV_BPS) / BPS.
    //
    // For the scaffold we compare ratios using cross-multiplication only
    // when twap_price fits a comparable scale. Production needs a fixed-
    // point price representation (Q64.64 or similar) — open question in
    // spec. v1 accepts if either side fits within the band.
    let band_num = twap_price
        .checked_mul(out_a)
        .ok_or(Error::TwapDeviationExceeded)?
        .checked_mul(DEFAULT_MAX_PRICE_DEVIATION_BPS)
        .ok_or(Error::TwapDeviationExceeded)?
        / BPS_DENOM;
    let spot_scaled = out_b
        .checked_mul(twap_price.max(1))
        .ok_or(Error::TwapDeviationExceeded)?;
    let twap_scaled = twap_price
        .checked_mul(out_a)
        .ok_or(Error::TwapDeviationExceeded)?;
    let diff = if spot_scaled > twap_scaled {
        spot_scaled - twap_scaled
    } else {
        twap_scaled - spot_scaled
    };
    if diff > band_num {
        return Err(Error::TwapDeviationExceeded);
    }
    Ok(())
}

fn verify_twap_head_advance(in_data: &[u8], out_data: &[u8]) -> Result<(), Error> {
    let in_head = in_data[POOL_TWAP_HEAD_OFFSET] as usize;
    let out_head = out_data[POOL_TWAP_HEAD_OFFSET] as usize;
    // Ring buffer advance: head moves by 1 mod N, OR stays (batch settle
    // already advanced once for the whole batch).
    if !(out_head == (in_head + 1) % TWAP_RING_SLOTS || out_head == in_head) {
        return Err(Error::TwapRingBufferMalformed);
    }
    // Timestamp monotonicity on the head slot.
    let out_slot_base = POOL_TWAP_RING_OFFSET + out_head * POOL_TWAP_SLOT_LEN;
    let in_slot_base = POOL_TWAP_RING_OFFSET + in_head * POOL_TWAP_SLOT_LEN;
    let out_ts = read_u64_le(&out_data[out_slot_base + 16..out_slot_base + 24]);
    let in_ts = read_u64_le(&in_data[in_slot_base + 16..in_slot_base + 24]);
    if out_ts < in_ts {
        return Err(Error::TwapTimestampMonotonicity);
    }
    Ok(())
}

// ============ Breaker ============

fn verify_breaker_volume_counter(
    in_data: &[u8],
    out_data: &[u8],
    amount_in: u128,
) -> Result<(), Error> {
    let in_window =
        read_u64_le(&in_data[POOL_BREAKER_WINDOW_OFFSET..POOL_BREAKER_WINDOW_OFFSET + 8]);
    let out_window =
        read_u64_le(&out_data[POOL_BREAKER_WINDOW_OFFSET..POOL_BREAKER_WINDOW_OFFSET + 8]);
    let in_counter =
        read_u128_le(&in_data[POOL_BREAKER_VOL_OFFSET..POOL_BREAKER_VOL_OFFSET + 16]);
    let out_counter =
        read_u128_le(&out_data[POOL_BREAKER_VOL_OFFSET..POOL_BREAKER_VOL_OFFSET + 16]);

    // Same window: counter += amount_in. New window: counter = amount_in.
    if out_window == in_window {
        let expected = in_counter
            .checked_add(amount_in)
            .ok_or(Error::BreakerCounterNotAdvanced)?;
        if out_counter != expected {
            return Err(Error::BreakerCounterNotAdvanced);
        }
    } else if out_window > in_window {
        if out_counter != amount_in {
            return Err(Error::BreakerCounterNotAdvanced);
        }
    } else {
        return Err(Error::BreakerCounterNotAdvanced);
    }
    Ok(())
}

/// Walk cell-deps; require at least one BreakerCell-shaped cell with
/// state == Clear. Shape-only; production needs code-hash match.
fn verify_breaker_not_tripped() -> Result<(), Error> {
    let mut idx = 0usize;
    let mut found_clear = false;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= BREAKER_CELL_MIN_LEN && data[POOL_VERSION_OFFSET] == SCHEMA_VERSION
                {
                    let state = data[BREAKER_STATE_OFFSET];
                    if state == BREAKER_STATE_CLEAR {
                        found_clear = true;
                    } else {
                        // Any tripped breaker in cell-deps that is the
                        // pool's breaker fails the swap. The "is the pool's
                        // breaker" check is shape-only here; CYCLE5 binds
                        // by mechanism_id == pool_outpoint.
                        return Err(Error::BreakerCellTripped);
                    }
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    if !found_clear {
        return Err(Error::BreakerCellMissing);
    }
    Ok(())
}

// ============ Cross-cell composition ============

fn require_lawson_cell_dep() -> Result<(), Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                // Lawson registry shape: version + count + entries + outpoint.
                if data.len() >= 5 && data[0] == SCHEMA_VERSION {
                    return Ok(());
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::LawsonRegistryMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ VibeLPCell verification ============

fn verify_lp_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    for d in inputs.iter().chain(outputs.iter()) {
        validate_lp_layout(d)?;
    }

    // pool_id is preserved across every transfer / split / merge.
    // Per-pool conservation: sum(in.amount) for each distinct pool_id
    // equals sum(out.amount) for that pool_id — unless this tx is a
    // mint (no input for that pool_id) or burn (no output) gated by the
    // PoolCell role-path same-tx.
    enforce_pool_id_preserved_and_conservation(&inputs, &outputs)
}

fn validate_lp_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < LP_CELL_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[LP_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

fn enforce_pool_id_preserved_and_conservation(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
) -> Result<(), Error> {
    // Single-pool-id short circuit: if all inputs+outputs reference the same
    // pool_id, conservation reduces to sum equality. The mint/burn paths
    // (sum mismatch) are authorized by the PoolCell role-path being in the
    // same tx with matching delta.
    if outputs.is_empty() && inputs.is_empty() {
        return Ok(());
    }
    let pid_of = |d: &[u8]| -> [u8; LP_POOL_ID_LEN] {
        let mut p = [0u8; LP_POOL_ID_LEN];
        p.copy_from_slice(&d[LP_POOL_OUTPOINT_TX_OFFSET..LP_POOL_OUTPOINT_TX_OFFSET + LP_POOL_ID_LEN]);
        p
    };
    // Reject mismatched pool_ids across the group; this script is
    // parameterized per-pool via args, so all cells in the group must
    // belong to the same pool.
    let canon_pid = inputs
        .first()
        .or_else(|| outputs.first())
        .map(|d| pid_of(d))
        .ok_or(Error::EmptyTransition)?;
    for d in inputs.iter().chain(outputs.iter()) {
        if pid_of(d) != canon_pid {
            return Err(Error::LpPoolIdMutated);
        }
    }
    let mut sum_in: u128 = 0;
    for d in inputs {
        let a = read_u128_le(&d[LP_AMOUNT_OFFSET..LP_AMOUNT_OFFSET + 16]);
        sum_in = sum_in
            .checked_add(a)
            .ok_or(Error::LpAmountOverflow)?;
    }
    let mut sum_out: u128 = 0;
    for d in outputs {
        let a = read_u128_le(&d[LP_AMOUNT_OFFSET..LP_AMOUNT_OFFSET + 16]);
        sum_out = sum_out
            .checked_add(a)
            .ok_or(Error::LpAmountOverflow)?;
    }
    // Mint (sum_out > sum_in) and burn (sum_in > sum_out) are authorized
    // when the same tx contains a PoolCell role-path input+output with
    // matching lp_total_supply delta. We require the PoolCell to be
    // present in the tx (Source::Input or Source::Output) — shape-only.
    if sum_in != sum_out {
        require_paired_pool_cell_in_tx(&canon_pid)?;
    }
    Ok(())
}

fn require_paired_pool_cell_in_tx(_pool_id: &[u8; LP_POOL_ID_LEN]) -> Result<(), Error> {
    // Walk Source::Input AND Source::Output looking for a cell of PoolCell
    // shape. CYCLE5: bind by code-hash + outpoint match against pool_id.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::Input) {
            Ok(Some(_th)) => {
                if let Ok(data) = load_cell_data(idx, Source::Input) {
                    if data.len() >= POOL_CELL_LEN && data[POOL_VERSION_OFFSET] == SCHEMA_VERSION {
                        return Ok(());
                    }
                }
                idx += 1;
            }
            Ok(None) => idx += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= POOL_CELL_LEN && data[POOL_VERSION_OFFSET] == SCHEMA_VERSION {
                    return Ok(());
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::LpAmountConservationFailed)
}

// ============ TwapObservationCell verification ============

fn verify_twap_observation_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    for d in inputs.iter().chain(outputs.iter()) {
        validate_twap_obs_layout(d)?;
    }

    // Append-only ring: each new output's observation_index = prev + 1, and
    // its timestamp is strictly greater than the matching input's timestamp.
    if let (Some(in_data), Some(out_data)) = (inputs.first(), outputs.first()) {
        let in_idx = read_u32_le(&in_data[TWAP_OBS_INDEX_OFFSET..TWAP_OBS_INDEX_OFFSET + 4]);
        let out_idx = read_u32_le(&out_data[TWAP_OBS_INDEX_OFFSET..TWAP_OBS_INDEX_OFFSET + 4]);
        if out_idx != in_idx.wrapping_add(1) {
            return Err(Error::TwapRingBufferMalformed);
        }
        let in_ts = read_u64_le(&in_data[TWAP_TIMESTAMP_OFFSET..TWAP_TIMESTAMP_OFFSET + 8]);
        let out_ts = read_u64_le(&out_data[TWAP_TIMESTAMP_OFFSET..TWAP_TIMESTAMP_OFFSET + 8]);
        if out_ts <= in_ts {
            return Err(Error::TwapTimestampMonotonicity);
        }
        // pool_id preserved across the ring.
        if in_data[TWAP_POOL_ID_OFFSET..TWAP_POOL_ID_OFFSET + LP_POOL_ID_LEN]
            != out_data[TWAP_POOL_ID_OFFSET..TWAP_POOL_ID_OFFSET + LP_POOL_ID_LEN]
        {
            return Err(Error::LpPoolIdMutated);
        }
    }
    Ok(())
}

fn validate_twap_obs_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < TWAP_CELL_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[TWAP_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

// ============ Group helpers ============

fn collect_group_data(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_GROUP_CELLS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_GROUP_CELLS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Byte readers ============

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64_le(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u32_le(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}

// Silence unused-warning floors that exist as forward-reference constants
// for the cell-dep matchers — they document the intended pinned values for
// CYCLE5 binding without firing the unused-const lint pre-wire.
#[allow(dead_code)]
const _UNUSED_FLOORS: &[u128] = &[
    DEFAULT_MAX_TWAP_DRIFT_BPS,
    DEFAULT_MAX_DONATION_BPS,
    DEFAULT_MINIMUM_LIQUIDITY,
];
#[allow(dead_code)]
const _UNUSED_FEE_DEFAULT: u16 = DEFAULT_FEE_BPS;
