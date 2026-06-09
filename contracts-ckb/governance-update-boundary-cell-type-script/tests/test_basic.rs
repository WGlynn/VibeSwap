//! Reviewable test-spec stub for `governance-update-boundary-cell-type-script`.
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

const CELL_DATA_LEN: usize = 129;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/governance-update-boundary-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

fn build_update_data(
    epoch: u64,
    prev_lawson_outpoint: [u8; 40],
    new_lawson_outpoint: [u8; 40],
    decision_id: [u8; 32],
    inclusion_height: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(CELL_DATA_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&epoch.to_le_bytes());
    data.extend_from_slice(&prev_lawson_outpoint);
    data.extend_from_slice(&new_lawson_outpoint);
    data.extend_from_slice(&decision_id);
    data.extend_from_slice(&inclusion_height.to_le_bytes());
    data
}

/// Happy path: in-bounds proposed payload, score above threshold, fresh,
/// Lawson pair present, every cross-constraint holds.
#[test]
fn test_in_bounds_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[SKIP] governance-update-boundary-cell-type-script binary absent. \
             Run `capsule build --release` first. Test logic compiled + reviewable."
        );
        return;
    }
    let _ = build_update_data(7, [0xAA; 40], [0xBB; 40], [0xCC; 32], 100);
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

/// Missing ConstitutionalBoundsCell cell-dep — the dual-layer is broken.
/// Expected: error 80 (ConstitutionalBoundsCellDepMissing).
#[test]
fn test_missing_bounds_celldep_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] missing-bounds test reviewable, binary absent.");
        return;
    }
}

/// Proposed value outside [min,max] for a named constant.
/// Expected: error 82 (ConstantValueOutOfBounds).
#[test]
fn test_value_out_of_bounds_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] value-out-of-bounds test reviewable, binary absent.");
        return;
    }
}

/// Proposed alpha outside [alpha_min,alpha_max].
/// Expected: error 83 (ConstantAlphaOutOfBounds).
#[test]
fn test_alpha_out_of_bounds_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] alpha-out-of-bounds test reviewable, binary absent.");
        return;
    }
}

/// Attacker proposes pow_bps + pos_bps >= pom_bps (dissolves 3-pillar mix).
/// SUM_LT cross-constraint must reject.
/// Expected: error 85 (CrossConstraintViolated).
#[test]
fn test_sum_lt_cross_constraint_violated_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] SUM_LT-violation test reviewable, binary absent.");
        return;
    }
}

/// Lawson epoch proxy non-monotonic (new <= prev).
/// Expected: error 73 (LawsonEpochNotMonotonic).
#[test]
fn test_lawson_epoch_not_monotonic_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] Lawson-non-monotonic test reviewable, binary absent.");
        return;
    }
}

/// Consume before finality: tip - inclusion_height < 24.
/// Expected: error 90 (BoundaryNotYetFinal).
#[test]
fn test_consume_before_finality_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] consume-before-finality test reviewable, binary absent.");
        return;
    }
}

/// 51%-NCI-collusion negative: even with score >= threshold, an out-of-bounds
/// payload is rejected at the constitutional layer.
/// Expected: error 82 (ConstantValueOutOfBounds) OR 85 (CrossConstraintViolated).
#[test]
fn test_dual_layer_defeats_51pct_collusion_skips_without_binary() {
    if load_script_binary().is_empty() {
        eprintln!("[SKIP] dual-layer-defeats-collusion test reviewable, binary absent.");
        return;
    }
}
