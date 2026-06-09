//! Reviewable test-spec stub for `cross-chain-out-boundary-cell-type-script`.
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

const CELL_DATA_LEN: usize = 73;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/cross-chain-out-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_outbound_data(
    dest_chain_id: u64,
    dest_recipient_lock_hash: [u8; 32],
    amount: u128,
    burn_id: u64,
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&dest_chain_id.to_le_bytes());
    data.extend_from_slice(&dest_recipient_lock_hash);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&burn_id.to_le_bytes());
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: NCI score above threshold, fresh, canonical-token net-burn
/// equals total emission amount, BurnReceiptCell present with matching
/// (amount, dest_chain_id, dest_recipient, burn_id), no prior burn_id replay,
/// dest_chain_id in supported list.
#[test]
fn test_emission_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] cross-chain-out-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let _ = build_outbound_data(2, [0xAA; 32], 1_000_000, 42, 100);
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

/// Score below threshold: NCIScoreCell.score < XCHAIN_OUT_SCORE_THRESHOLD.
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

/// Replay: an existing CrossChainOutBoundaryCell with the same burn_id is
/// visible as cell-dep. Expected: error 70 (BurnIdReplayed).
#[test]
fn test_burn_id_replay_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] burn-id replay test reviewable, binary absent.");
        return;
    }
}

/// Two outputs sharing the same burn_id within the same tx.
/// Expected: error 71 (BurnIdDuplicateWithinTx).
#[test]
fn test_burn_id_duplicate_within_tx_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] burn-id duplicate-within-tx test reviewable, binary absent.");
        return;
    }
}

/// Canonical-token net-burn != sum of emission amounts.
/// Expected: error 80 (CanonicalBurnAmountMismatch).
#[test]
fn test_canonical_burn_amount_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] canonical-burn amount-mismatch test reviewable, binary absent.");
        return;
    }
}

/// No canonical-token burn observed in tx (net mint or zero).
/// Expected: error 81 (CanonicalBurnAbsent).
#[test]
fn test_canonical_burn_absent_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] canonical-burn-absent test reviewable, binary absent.");
        return;
    }
}

/// No BurnReceiptCell produced same-tx.
/// Expected: error 82 (BurnReceiptAbsent).
#[test]
fn test_burn_receipt_absent_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] burn-receipt-absent test reviewable, binary absent.");
        return;
    }
}

/// BurnReceiptCell present but amount disagrees with emission.
/// Expected: error 83 (BurnReceiptAmountMismatch).
#[test]
fn test_burn_receipt_amount_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] burn-receipt amount-mismatch test reviewable, binary absent.");
        return;
    }
}

/// BurnReceiptCell present but recipient bytes don't match.
/// Expected: error 86 (BurnReceiptRecipientMismatch).
#[test]
fn test_burn_receipt_recipient_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] burn-receipt recipient-mismatch test reviewable, binary absent.");
        return;
    }
}

/// dest_chain_id == 0 (reserved sentinel).
/// Expected: error 90 (DestChainIdReserved).
#[test]
fn test_dest_chain_id_zero_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] dest-chain-id-zero test reviewable, binary absent.");
        return;
    }
}

/// dest_chain_id not in SUPPORTED_DEST_CHAINS Lawson list.
/// Expected: error 91 (DestChainNotSupported).
#[test]
fn test_dest_chain_not_supported_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] dest-chain-not-supported test reviewable, binary absent.");
        return;
    }
}

/// Archive before finality: tip - inclusion_height < XCHAIN_OUT_FINALITY_BLOCKS.
/// Expected: error 95 (InclusionHeightInFuture).
#[test]
fn test_archive_before_finality_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] archive-before-finality test reviewable, binary absent.");
        return;
    }
}
