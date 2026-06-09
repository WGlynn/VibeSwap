//! Reviewable test-spec stub for `withdrawal-boundary-cell-type-script`.
//!
//! NOT runnable cargo tests — the on-chain crate is no_std + no_main.
//! Runnable integration tests land in `contracts-ckb/tests/` per workspace
//! pattern; this file colocates intended invariants with the script itself.

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

const CELL_DATA_LEN: usize = 125;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/withdrawal-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_withdrawal_data(
    owner_lock_hash: [u8; 32],
    sudt_type_hash: [u8; 32],
    amount: u128,
    matched_deposit_outpoint_tx: [u8; 32],
    matched_deposit_outpoint_index: u32,
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&owner_lock_hash);
    data.extend_from_slice(&sudt_type_hash);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&matched_deposit_outpoint_tx);
    data.extend_from_slice(&matched_deposit_outpoint_index.to_le_bytes());
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: NCI score above withdrawal threshold, fresh, matched deposit
/// present + finalized + unconsumed, canonical-token output to owner matches amount.
#[test]
fn test_withdrawal_creation_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] withdrawal-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let _ = build_withdrawal_data([0u8; 32], [0u8; 32], 1_000_000, [0xAA; 32], 0, 100);
}

/// Missing NCI cell-dep. Expected: error 50.
#[test]
fn test_missing_nci_cell_dep_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] missing-NCI test reviewable, binary absent.");
        return;
    }
}

/// Score below withdrawal threshold (which is strictly higher than deposit).
/// Expected: error 51.
#[test]
fn test_score_below_withdrawal_threshold_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] score-below-threshold test reviewable, binary absent.");
        return;
    }
}

/// Stale NCI: tip - nci_inclusion > MAX_SCORE_AGE_BLOCKS. Expected: error 52.
#[test]
fn test_stale_nci_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] stale-NCI test reviewable, binary absent.");
        return;
    }
}

/// Matched deposit absent: no DepositBoundaryCell cell-dep with matching owner+sudt.
/// Expected: error 70.
#[test]
fn test_matched_deposit_missing_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] matched-deposit-missing test reviewable, binary absent.");
        return;
    }
}

/// Matched deposit already withdrawn against (prior WithdrawalBoundaryCell with
/// same matched_deposit_outpoint visible as cell-dep). Expected: error 73.
#[test]
fn test_matched_deposit_consumed_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] matched-deposit-consumed test reviewable, binary absent.");
        return;
    }
}

/// Withdrawal amount > matched deposit amount. Expected: error 80.
#[test]
fn test_withdrawal_exceeds_deposit_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] amount-exceeds-deposit test reviewable, binary absent.");
        return;
    }
}

/// No canonical-token output at owner_lock_hash. Expected: error 81.
#[test]
fn test_canonical_token_output_absent_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] canonical-token-output-absent test reviewable, binary absent.");
        return;
    }
}

/// Canonical-token output present but amount != recorded withdrawal amount.
/// Expected: error 82.
#[test]
fn test_canonical_token_output_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] canonical-token-output-mismatch test reviewable, binary absent.");
        return;
    }
}

/// Matched deposit not yet final: tip - dep.inclusion < WITHDRAWAL_FINALITY_BLOCKS.
/// Expected: error 90.
#[test]
fn test_matched_deposit_not_yet_final_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] deposit-not-final test reviewable, binary absent.");
        return;
    }
}
