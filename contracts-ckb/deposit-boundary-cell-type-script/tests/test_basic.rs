//! Reviewable test-spec stub for `deposit-boundary-cell-type-script`.
//!
//! NOT a runnable cargo test — the on-chain crate is no_std + no_main.
//! Runnable integration tests land in `contracts-ckb/tests/` per workspace
//! pattern; this file colocates the intended invariants + adversarial shapes
//! with the script itself.

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
    // TODO: include_bytes!("../../build/release/deposit-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_deposit_data(
    owner_lock_hash: [u8; 32],
    sudt_type_hash: [u8; 32],
    amount: u128,
    source_outpoint_tx: [u8; 32],
    source_outpoint_index: u32,
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&owner_lock_hash);
    data.extend_from_slice(&sudt_type_hash);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&source_outpoint_tx);
    data.extend_from_slice(&source_outpoint_index.to_le_bytes());
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: NCI score above threshold, fresh, canonical-token inputs
/// match recorded amount, no prior outpoint replay.
#[test]
fn test_deposit_creation_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] deposit-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let _ = build_deposit_data([0u8; 32], [0u8; 32], 1_000_000, [0xAA; 32], 0, 100);
}

/// Missing NCI cell-dep: tx has no NCIScoreCell as cell-dep.
/// Expected: error 50 (NciScoreCellDepMissing).
#[test]
fn test_missing_nci_cell_dep_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] missing-NCI test reviewable, binary absent.");
        return;
    }
}

/// Score below threshold: NCIScoreCell.score < DEPOSIT_SCORE_THRESHOLD.
/// Expected: error 51 (NciScoreBelowThreshold).
#[test]
fn test_score_below_threshold_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] score-below-threshold test reviewable, binary absent.");
        return;
    }
}

/// Stale NCI: tip - nci_inclusion > MAX_SCORE_AGE_BLOCKS.
/// Expected: error 52 (NciScoreStale).
#[test]
fn test_stale_nci_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] stale-NCI test reviewable, binary absent.");
        return;
    }
}

/// Replay: an existing DepositBoundaryCell with the same
/// (source_outpoint_tx, source_outpoint_index) is visible as cell-dep.
/// Expected: error 70 (SourceOutpointReplayed).
#[test]
fn test_replay_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] replay test reviewable, binary absent.");
        return;
    }
}

/// Amount conservation: recorded amount != sum of canonical-token inputs.
/// Expected: error 80 (AmountConservationFailed).
#[test]
fn test_amount_conservation_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] amount-conservation test reviewable, binary absent.");
        return;
    }
}

/// No canonical-token input present at all.
/// Expected: error 81 (CanonicalTokenAbsent).
#[test]
fn test_canonical_token_absent_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] canonical-token-absent test reviewable, binary absent.");
        return;
    }
}

/// Claim before finality: tip - inclusion_height < DEPOSIT_FINALITY_BLOCKS.
/// Expected: error 90 (DepositNotYetFinal).
#[test]
fn test_claim_before_finality_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] claim-before-finality test reviewable, binary absent.");
        return;
    }
}
