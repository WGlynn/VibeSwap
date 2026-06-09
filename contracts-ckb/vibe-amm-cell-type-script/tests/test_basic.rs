//! Reviewable test-spec stub for `vibe-amm-cell-type-script`.
//!
//! NOT a runnable cargo test — on-chain crate is no_std + no_main.
//! Runnable integration tests land in `contracts-ckb/tests/` per
//! workspace pattern. Mirrors the `#[cfg(any())]` skip-pattern from
//! sibling crates (circuit-breaker, deposit-boundary, lawson-constants).

#![cfg(any())]

use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

const SCHEMA_VERSION: u8 = 1;
const MAX_CYCLES: u64 = 70_000_000;

const ROLE_POOL: u8 = 0x01;
const ROLE_LP: u8 = 0x02;
const ROLE_TWAP: u8 = 0x03;

const POOL_CELL_LEN: usize = 358;
const LP_CELL_LEN: usize = 53;
const TWAP_CELL_LEN: usize = 81;

fn load_script_binary() -> &'static [u8] {
    // include_bytes!("../../build/release/vibe-amm-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_pool_data(
    token_a_hash: [u8; 32],
    token_b_hash: [u8; 32],
    reserve_a: u128,
    reserve_b: u128,
    lp_supply: u128,
    fee_bps: u16,
    proto_fee_bps: u16,
    min_liq: u64,
    created_at: u64,
    last_swap: u64,
    twap_head: u8,
    breaker_vol_counter: u128,
    breaker_window_start: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(POOL_CELL_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&token_a_hash);
    data.extend_from_slice(&token_b_hash);
    data.extend_from_slice(&reserve_a.to_le_bytes());
    data.extend_from_slice(&reserve_b.to_le_bytes());
    data.extend_from_slice(&lp_supply.to_le_bytes());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    data.extend_from_slice(&proto_fee_bps.to_le_bytes());
    data.extend_from_slice(&min_liq.to_le_bytes());
    data.extend_from_slice(&created_at.to_le_bytes());
    data.extend_from_slice(&last_swap.to_le_bytes());
    // twap ring: 8 slots * (u128 + u64) = 192 bytes of zero by default
    data.extend_from_slice(&[0u8; 192]);
    data.push(twap_head);
    data.extend_from_slice(&breaker_vol_counter.to_le_bytes());
    data.extend_from_slice(&breaker_window_start.to_le_bytes());
    debug_assert_eq!(data.len(), POOL_CELL_LEN);
    data
}

fn build_lp_data(pool_outpoint_tx: [u8; 32], pool_outpoint_index: u32, amount: u128) -> Vec<u8> {
    let mut data = Vec::with_capacity(LP_CELL_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&pool_outpoint_tx);
    data.extend_from_slice(&pool_outpoint_index.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    debug_assert_eq!(data.len(), LP_CELL_LEN);
    data
}

fn build_twap_obs_data(
    pool_outpoint_tx: [u8; 32],
    pool_outpoint_index: u32,
    obs_index: u32,
    price: u128,
    cumulative: u128,
    timestamp: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(TWAP_CELL_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&pool_outpoint_tx);
    data.extend_from_slice(&pool_outpoint_index.to_le_bytes());
    data.extend_from_slice(&obs_index.to_le_bytes());
    data.extend_from_slice(&price.to_le_bytes());
    data.extend_from_slice(&cumulative.to_le_bytes());
    data.extend_from_slice(&timestamp.to_le_bytes());
    debug_assert_eq!(data.len(), TWAP_CELL_LEN);
    data
}

/// Swap happy path: input pool (1000 A, 1000 B), output (1100 A, 909 B)
/// preserves k under 5bps fee, breaker counter advances by 100.
#[test]
fn test_swap_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] vibe-amm binary absent. Swap happy-path logic compiled + reviewable."
        );
        return;
    }
    let _ = build_pool_data(
        [0xAA; 32],
        [0xBB; 32],
        1_000_000,
        1_000_000,
        1_000_000,
        5,
        0,
        10_000,
        100,
        100,
        0,
        0,
        0,
    );
}

/// Constant-product violated: out reserves push k below input k.
/// Expected: error 50 (ConstantProductViolated).
#[test]
fn test_swap_k_violated_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] k-violation test reviewable, binary absent.");
        return;
    }
}

/// Add-liquidity happy: dA/dB proportional, lp_minted matches formula.
#[test]
fn test_add_liquidity_proportional_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] add-liq test reviewable, binary absent.");
        return;
    }
    let _ = build_lp_data([0xCC; 32], 0, 100_000);
}

/// Add-liquidity non-proportional: dA*reserve_b != dB*reserve_a.
/// Expected: error 63 (ProportionalAddViolated).
#[test]
fn test_add_liquidity_non_proportional_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] non-proportional-add reviewable, binary absent.");
        return;
    }
}

/// Remove-liquidity happy: burn lp_n, withdraw pro-rata reserves.
#[test]
fn test_remove_liquidity_pro_rata_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] remove-liq test reviewable, binary absent.");
        return;
    }
}

/// LP-conservation in pure transfer: sum_in == sum_out across same pool_id.
#[test]
fn test_lp_transfer_conservation_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] lp-conservation test reviewable, binary absent.");
        return;
    }
}

/// LP pool_id mutated across transfer.
/// Expected: error 100 (LpPoolIdMutated).
#[test]
fn test_lp_pool_id_mutated_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] lp-pool-id-mutated reviewable, binary absent.");
        return;
    }
}

/// TWAP deviation: post-swap spot > MAX_PRICE_DEVIATION_BPS off TWAP head.
/// Expected: error 70 (TwapDeviationExceeded).
#[test]
fn test_twap_deviation_exceeded_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] twap-deviation reviewable, binary absent.");
        return;
    }
}

/// TWAP ring head doesn't advance.
/// Expected: error 71 (TwapRingBufferMalformed).
#[test]
fn test_twap_head_not_advanced_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] twap-head-stuck reviewable, binary absent.");
        return;
    }
}

/// Breaker-cell tripped in cell-deps blocks any swap.
/// Expected: error 81 (BreakerCellTripped).
#[test]
fn test_swap_blocked_by_tripped_breaker_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] tripped-breaker test reviewable, binary absent.");
        return;
    }
}

/// MAX_TRADE_SIZE exceeded.
/// Expected: error 52 (MaxTradeSizeExceeded).
#[test]
fn test_max_trade_size_exceeded_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] max-trade-size reviewable, binary absent.");
        return;
    }
}

/// TwapObservationCell append: obs_index monotone, timestamp strictly increasing.
#[test]
fn test_twap_obs_append_happy_path_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] twap-obs-append reviewable, binary absent.");
        return;
    }
    let _ = build_twap_obs_data([0xDD; 32], 0, 1, 1_000, 1_000, 200);
}

/// Pool genesis: lp_supply^2 must be <= reserve_a * reserve_b (sqrt floor),
/// MINIMUM_LIQUIDITY locked.
#[test]
fn test_pool_genesis_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] pool-genesis test reviewable, binary absent.");
        return;
    }
}

/// Lawson registry absent from cell-deps.
/// Expected: error 90 (LawsonRegistryMissing).
#[test]
fn test_missing_lawson_cell_dep_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[CYCLE5 SKIP] missing-lawson reviewable, binary absent.");
        return;
    }
}
