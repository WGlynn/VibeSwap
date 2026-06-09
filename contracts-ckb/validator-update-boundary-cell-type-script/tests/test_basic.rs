//! Reviewable test-spec stub for `validator-update-boundary-cell-type-script`.
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

const CELL_DATA_LEN: usize = 146;

const CHANGE_TYPE_ADD: u8 = 0;
const CHANGE_TYPE_REMOVE: u8 = 1;
const CHANGE_TYPE_STAKE_UPDATE: u8 = 2;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/validator-update-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_update_data(
    epoch: u64,
    prev_registry_outpoint: [u8; 40],
    new_registry_outpoint: [u8; 40],
    change_type: u8,
    affected_pubkey: [u8; 48],
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&epoch.to_le_bytes());
    data.extend_from_slice(&prev_registry_outpoint);
    data.extend_from_slice(&new_registry_outpoint);
    data.push(change_type);
    data.extend_from_slice(&affected_pubkey);
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: add a validator. NCI score above threshold, fresh, registry
/// pair present with monotonic epoch, delta matches change_type.
#[test]
fn test_add_validator_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] validator-update-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic compiled + reviewable."
        );
        return;
    }
    let _ = build_update_data(7, [0xAA; 40], [0xBB; 40], CHANGE_TYPE_ADD, [0x11; 48], 100);
}

/// Missing NCI cell-dep. Expected: error 50 (NciScoreCellDepMissing).
#[test]
fn test_missing_nci_cell_dep_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] missing-NCI test reviewable, binary absent.");
        return;
    }
}

/// Score below threshold. Expected: error 51 (NciScoreBelowThreshold).
#[test]
fn test_score_below_threshold_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] score-below-threshold test reviewable, binary absent.");
        return;
    }
}

/// Stale NCI. Expected: error 52 (NciScoreStale).
#[test]
fn test_stale_nci_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] stale-NCI test reviewable, binary absent.");
        return;
    }
}

/// Registry epoch non-monotonic (new <= prev). Expected: error 73 (RegistryEpochNotMonotonic).
#[test]
fn test_registry_epoch_not_monotonic_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] registry-epoch-non-monotonic test reviewable, binary absent.");
        return;
    }
}

/// add declared but |new| != |prev| + 1. Expected: error 80 (ChangeShapeMismatch).
#[test]
fn test_add_count_mismatch_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] add-count-mismatch test reviewable, binary absent.");
        return;
    }
}

/// remove declared but affected_pubkey not in prev. Expected: error 81 (AffectedPubkeyAbsentInDelta).
#[test]
fn test_remove_pubkey_absent_in_prev_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] remove-pubkey-absent test reviewable, binary absent.");
        return;
    }
}

/// add declared but affected_pubkey already in prev. Expected: error 82 (AffectedPubkeyPresentInDelta).
#[test]
fn test_add_pubkey_already_in_prev_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] add-pubkey-already-in-prev test reviewable, binary absent.");
        return;
    }
}

/// stake_update declared but |new| != |prev|. Expected: error 80 (ChangeShapeMismatch).
#[test]
fn test_stake_update_count_changed_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] stake-update-count-changed test reviewable, binary absent.");
        return;
    }
}

/// Consume before finality: tip - inclusion_height < 24. Expected: error 90 (BoundaryNotYetFinal).
#[test]
fn test_consume_before_finality_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] consume-before-finality test reviewable, binary absent.");
        return;
    }
}
