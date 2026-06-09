//! Reviewable test-spec stub for `slash-boundary-cell-type-script`.
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

const CELL_DATA_LEN: usize = 122;

const REASON_EQUIVOCATION: u8 = 0;
const REASON_OFFLINE: u8 = 1;
const REASON_PAIRWISE_VERDICT: u8 = 2;
const REASON_POM_FAIL: u8 = 3;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/slash-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_slash_data(
    slashed_pubkey: [u8; 48],
    slash_amount: u128,
    slash_reason: u8,
    evidence_cell_outpoint: [u8; 40],
    epoch: u64,
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&slashed_pubkey);
    data.extend_from_slice(&slash_amount.to_le_bytes());
    data.push(slash_reason);
    data.extend_from_slice(&evidence_cell_outpoint);
    data.extend_from_slice(&epoch.to_le_bytes());
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: NCI above strictest threshold, evidence matches reason,
/// validator bonded, amount <= cap.
#[test]
fn test_creation_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] slash-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let _ = build_slash_data(
        [0xAA; 48],
        500_000,
        REASON_PAIRWISE_VERDICT,
        [0xBB; 40],
        7,
        100,
    );
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

/// Score below the SLASH threshold (highest of all boundaries).
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

/// Evidence cell-dep missing entirely.
/// Expected: error 70 (EvidenceCellDepMissing).
#[test]
fn test_missing_evidence_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] missing-evidence test reviewable, binary absent.");
        return;
    }
}

/// Evidence shape too small for declared reason (e.g. equivocation reason
/// with only verdict-sized evidence).
/// Expected: error 71 (EvidenceShapeMismatch).
#[test]
fn test_evidence_shape_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] evidence-shape-mismatch test reviewable, binary absent.");
        return;
    }
}

/// Evidence pubkey does not match slashed_pubkey for pubkey-bound reasons.
/// Expected: error 72 (EvidenceReasonMismatch).
#[test]
fn test_evidence_reason_mismatch_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] evidence-reason-mismatch test reviewable, binary absent.");
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

/// slashed_pubkey not in the bonded set.
/// Expected: error 74 (ValidatorNotBonded).
#[test]
fn test_validator_not_bonded_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] validator-not-bonded test reviewable, binary absent.");
        return;
    }
}

/// slash_amount > bond * losing_share_bps / 10000.
/// Expected: error 80 (SlashAmountExceedsCap).
#[test]
fn test_slash_amount_exceeds_cap_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] slash-cap test reviewable, binary absent.");
        return;
    }
}

/// Lawson losing_share_bps escaped the [5000, 8000] constitutional bounds.
/// Expected: error 81 (SlashCapMalformed).
#[test]
fn test_slash_cap_malformed_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] cap-malformed test reviewable, binary absent.");
        return;
    }
}

/// Replay: existing sibling SlashBoundaryCell carries same
/// evidence_cell_outpoint — double-slash on the same evidence.
/// Expected: error 90 (EvidenceOutpointReplayed).
#[test]
fn test_replay_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] replay test reviewable, binary absent.");
        return;
    }
}

/// Consume before 100-block finality — deepest threshold of any boundary.
/// Expected: error 100 (SlashNotYetFinal).
#[test]
fn test_consume_before_finality_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] consume-before-finality test reviewable, binary absent.");
        return;
    }
}

/// Unknown slash_reason byte.
/// Expected: error 36 (SlashReasonUnknown).
#[test]
fn test_unknown_slash_reason_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] unknown-reason test reviewable, binary absent.");
        return;
    }
}

/// slash_amount == 0.
/// Expected: error 37 (SlashAmountZero).
#[test]
fn test_zero_slash_amount_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] zero-amount test reviewable, binary absent.");
        return;
    }
}
