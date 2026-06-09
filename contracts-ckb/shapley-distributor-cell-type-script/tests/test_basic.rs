//! Reviewable test-spec stub for `shapley-distributor-cell-type-script`.
//!
//! NOT a runnable cargo test — the on-chain crate is no_std + no_main.
//! Runnable integration tests land in `contracts-ckb/tests/` per workspace
//! pattern; this file colocates the intended invariants + adversarial shapes
//! with the script itself.

#![cfg(any())]

use ckb_testtool::ckb_types::bytes::Bytes;

const SCHEMA_VERSION: u8 = 1;
const MAX_CYCLES: u64 = 100_000_000;

fn load_script_binary() -> &'static [u8] {
    // TODO: include_bytes!("../../build/release/shapley-distributor-cell-type-script")
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

// ============ ContributionEventCell builders ============

fn build_event_data(
    event_type: u8,
    vfk: u8,
    event_id: [u8; 32],
    total_value: u128,
    era: u64,
    participants: &[([u8; 32], u128, u8)],
) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(SCHEMA_VERSION);
    data.push(event_type);
    data.push(vfk);
    data.extend_from_slice(&event_id);
    data.extend_from_slice(&[0u8; 32]); // source_outpoint_tx
    data.extend_from_slice(&0u32.to_le_bytes()); // source_outpoint_index
    data.extend_from_slice(&total_value.to_le_bytes());
    data.extend_from_slice(&[0u8; 32]); // value_token_type_hash
    data.extend_from_slice(&era.to_le_bytes());
    data.extend_from_slice(&100u64.to_le_bytes()); // created_at_block
    data.extend_from_slice(&(participants.len() as u16).to_le_bytes());
    for (lh, cv, ct) in participants {
        data.extend_from_slice(lh);
        data.extend_from_slice(&cv.to_le_bytes());
        data.push(*ct);
    }
    data
}

fn build_distribution_data(
    event_id: [u8; 32],
    payload_hash: [u8; 32],
    distributions: &[([u8; 32], u128)],
) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&event_id);
    data.extend_from_slice(&payload_hash);
    data.extend_from_slice(&(distributions.len() as u16).to_le_bytes());
    for (lh, share) in distributions {
        data.extend_from_slice(lh);
        data.extend_from_slice(&share.to_le_bytes());
    }
    data
}

// ============ Axiom #1 — Efficiency ============

/// Happy path: Σ shapley_share == event.total_value with proportional kind.
#[test]
fn test_efficiency_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] shapley-distributor binary absent. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }
    let event_id = [0xEE; 32];
    let participants = &[
        ([0x01; 32], 100u128, 0u8),
        ([0x02; 32], 200u128, 0u8),
        ([0x03; 32], 700u128, 0u8),
    ];
    let _event = build_event_data(0x01, 0x01, event_id, 1000, 0, participants);
    let _dist = build_distribution_data(
        event_id,
        [0xAA; 32],
        &[
            ([0x01; 32], 100u128),
            ([0x02; 32], 200u128),
            ([0x03; 32], 700u128),
        ],
    );
}

/// Adversarial: distribution sums to > total_value (inflation attempt).
/// Expected: error 50 (AxiomEfficiencyViolated).
#[test]
fn test_efficiency_overflow_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] efficiency-overflow test reviewable, binary absent.");
        return;
    }
}

/// Adversarial: distribution sums to < total_value (deflation / capture attempt).
/// Expected: error 50 (AxiomEfficiencyViolated).
#[test]
fn test_efficiency_underflow_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] efficiency-underflow test reviewable, binary absent.");
        return;
    }
}

// ============ Axiom #2 — Symmetry ============

/// Two participants with identical (cv, ctype) ⇒ identical share required.
/// Expected: error 51 (AxiomSymmetryViolated) when shares differ.
#[test]
fn test_symmetry_violation_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] symmetry test reviewable, binary absent.");
        return;
    }
}

// ============ Axiom #3 — Null-Player ============

/// cv == 0 with non-zero share ⇒ rejected.
/// Expected: error 52 (AxiomNullPlayerViolated).
#[test]
fn test_null_player_violation_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] null-player test reviewable, binary absent.");
        return;
    }
}

/// Sybil-flagged participant with positive cv in event creation ⇒ rejected.
/// Expected: error 45 (SybilParticipantPresent).
#[test]
fn test_sybil_participant_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] sybil-filter test reviewable, binary absent.");
        return;
    }
}

// ============ Axiom #5 — Pairwise-Proportionality (Goodhart defense) ============

/// Proportional kind: pairwise ratio s_i/s_j must equal w_i/w_j within ε.
/// Cross-mult form: |s_i·w_j − s_j·w_i| ≤ ε·max(s_i·w_j, s_j·w_i).
/// Happy path: shares scale exactly with cv.
#[test]
fn test_pairwise_proportional_happy_path_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] pairwise-happy test reviewable, binary absent.");
        return;
    }
}

/// Adversarial: distributor shifts share from high-cv to low-cv participant
/// preserving Σ but breaking ratio. Goodhart manipulation.
/// Expected: error 54 (AxiomPairwiseProportionalityViolated).
#[test]
fn test_pairwise_ratio_manipulation_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] pairwise-manipulation test reviewable, binary absent.");
        return;
    }
}

// ============ Time Neutrality (FEE_DISTRIBUTION) ============

/// FEE event with era_at_creation != 0 ⇒ rejected.
/// Expected: error 55 (AxiomTimeNeutralityViolated).
#[test]
fn test_fee_event_era_nonzero_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] time-neutrality test reviewable, binary absent.");
        return;
    }
}

// ============ EmissionScheduleCell ============

/// Era transition: next_genesis must equal prev_genesis * halving_bps / 10000.
/// Adversarial: next_genesis higher than prev * halving ⇒ rejected.
/// Expected: error 63 (HalvingArithmeticInvalid).
#[test]
fn test_halving_arithmetic_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] halving test reviewable, binary absent.");
        return;
    }
}

/// Era jump (next_era != prev_era + 1) ⇒ rejected.
/// Expected: error 62 (EraTransitionPremature).
#[test]
fn test_era_skip_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] era-skip test reviewable, binary absent.");
        return;
    }
}

// ============ RewardClaimCell ============

/// Two claim cells with identical (event_id, lock_hash) in one tx ⇒ rejected.
/// Expected: error 72 (ClaimDuplicate).
#[test]
fn test_duplicate_claim_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] duplicate-claim test reviewable, binary absent.");
        return;
    }
}

/// Claim amount > distribution row's shapley_share ⇒ rejected.
/// Expected: error 70 (ClaimAmountExceedsDistribution).
#[test]
fn test_claim_overdraw_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] claim-overdraw test reviewable, binary absent.");
        return;
    }
}

/// Claim for lock_hash not in the distribution ⇒ rejected.
/// Expected: error 71 (ClaimDistributionLinkBroken).
#[test]
fn test_claim_lock_hash_unlisted_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] claim-unlisted test reviewable, binary absent.");
        return;
    }
}

// ============ Shape / sorting ============

/// Participants not sorted ascending by lock_hash ⇒ rejected.
/// Expected: error 41 (DuplicateParticipantLockHash) — sorted-strict implies no dup.
#[test]
fn test_unsorted_participants_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] unsorted-participants test reviewable, binary absent.");
        return;
    }
}

/// Distribution lock_hash set ≠ event participant lock_hash set ⇒ rejected.
/// Expected: error 57 (DistributionLockHashSetMismatch).
#[test]
fn test_distribution_set_mismatch_rejected_skips_without_binary() {
    let script_bin = Bytes::from(load_script_binary().to_vec());
    if script_bin.is_empty() {
        eprintln!("[CYCLE5 SKIP] set-mismatch test reviewable, binary absent.");
        return;
    }
}
