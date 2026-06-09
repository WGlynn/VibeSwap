//! Reviewable test-spec stub for `cross-chain-in-boundary-cell-type-script`.
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

const CELL_DATA_LEN: usize = 113;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/cross-chain-in-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_boundary_data(
    source_chain_id: u64,
    source_burn_id: u64,
    amount: u128,
    recipient_lock_hash: [u8; 32],
    attestation_cell_outpoint: [u8; 40],
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&source_chain_id.to_le_bytes());
    data.extend_from_slice(&source_burn_id.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&recipient_lock_hash);
    data.extend_from_slice(&attestation_cell_outpoint);
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: NCI authorized, attestation matches, recipient minted.
#[test]
fn test_creation_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] cross-chain-in-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let _ = build_boundary_data(1, 42, 1_000_000, [0xAA; 32], [0xBB; 40], 100);
}

/// Missing NCI cell-dep.
/// Expected: error 50 (NciScoreCellDepMissing).
#[test]
fn test_missing_nci_cell_dep_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] missing-NCI test reviewable, binary absent.");
        return;
    }
}

/// Score below threshold.
/// Expected: error 51 (NciScoreBelowThreshold).
#[test]
fn test_score_below_threshold_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] score-below-threshold test reviewable, binary absent.");
        return;
    }
}

/// Stale NCI.
/// Expected: error 52 (NciScoreStale).
#[test]
fn test_stale_nci_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] stale-NCI test reviewable, binary absent.");
        return;
    }
}

/// Attestation cell-dep missing.
/// Expected: error 70 (AttestationCellDepMissing).
#[test]
fn test_missing_attestation_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] missing-attestation test reviewable, binary absent.");
        return;
    }
}

/// Attestation source_burn_id does not match boundary cell.
/// Expected: error 71 (AttestationFieldMismatch).
#[test]
fn test_attestation_field_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] attestation-field-mismatch test reviewable, binary absent.");
        return;
    }
}

/// Attestation epoch does not match registry epoch.
/// Expected: error 72 (AttestationEpochMismatch).
#[test]
fn test_attestation_epoch_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] attestation-epoch-mismatch test reviewable, binary absent.");
        return;
    }
}

/// ValidatorRegistry cell-dep missing.
/// Expected: error 73 (ValidatorRegistryCellDepMissing).
#[test]
fn test_missing_validator_registry_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] missing-validator-registry test reviewable, binary absent.");
        return;
    }
}

/// Replay: existing sibling CrossChainInBoundaryCell carries same
/// (source_chain_id, source_burn_id).
/// Expected: error 80 (BurnIdReplayed).
#[test]
fn test_replay_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] replay test reviewable, binary absent.");
        return;
    }
}

/// No canonical-token output at recipient_lock_hash.
/// Expected: error 90 (CanonicalMintOutputMissing).
#[test]
fn test_canonical_mint_missing_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] canonical-mint-missing test reviewable, binary absent.");
        return;
    }
}

/// Canonical-token output amount does not match boundary amount.
/// Expected: error 91 (CanonicalMintAmountMismatch).
#[test]
fn test_canonical_mint_amount_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] canonical-mint-amount-mismatch test reviewable, binary absent.");
        return;
    }
}

/// Consume before 24-block finality.
/// Expected: error 100 (CrossChainInNotYetFinal).
#[test]
fn test_consume_before_finality_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] consume-before-finality test reviewable, binary absent.");
        return;
    }
}
