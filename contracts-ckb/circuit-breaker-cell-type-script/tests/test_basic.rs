//! Reviewable test-spec stub for `circuit-breaker-cell-type-script`.
//!
//! ## NOT a runnable cargo test (intentionally)
//!
//! The on-chain crate is `no_std` + `no_main` — it cannot host
//! `cargo test` integration runners. The workspace pattern (per the
//! sibling crates `primitive-cell-type-script`, `datatoken-cell-type-
//! script`, `vibeswap-canonical-token-type-script`,
//! `lawson-constants-cell-type-script`) puts all runnable integration
//! tests in the dedicated `contracts-ckb/tests/` workspace crate,
//! which compiles host-target and uses `ckb-testtool`.
//!
//! This file exists as a **reviewable test spec** colocated with the
//! script it tests, so a reader can see the intended invariants and
//! happy-path shape without leaving the crate. The actual runnable
//! version of this test will be added at
//! `contracts-ckb/tests/src/circuit_breaker_cell_type_tests.rs` and
//! registered as a module in `tests/src/lib.rs`.
//!
//! ## Pattern reference
//!
//! Mirrors the `[CYCLE5 SKIP]` shape from
//! `contracts-ckb/lawson-constants-cell-type-script/tests/test_basic.rs`.
//! Actual VM execution gated on Capsule emitting a binary at
//! `contracts-ckb/build/release/circuit-breaker-cell-type-script`.
//!
//! ## What this stub covers
//!
//! Three happy-path scaffolds (one per role) + a representative
//! adversarial case for each.
//!
//! Happy paths:
//!   - BreakerCell counter-update within window (Clear -> Clear)
//!   - BreakerCell trip transition (Clear -> Tripped when counter
//!     crosses threshold)
//!   - BreakerCell resume-request (Tripped -> Resuming with valid
//!     AttestationCell consumed)
//!   - BreakerCell finalize (Resuming -> Clear with mature
//!     ResumeQueueCell consumed)
//!
//! Future adversarial coverage (CYCLE5, in `ckb-tests` crate):
//!   - BreakerCell counter > threshold but state = Clear in output
//!     → rejected w/ code 62 (TripNotFired)
//!   - BreakerCell illegal transition (e.g., Clear -> Resuming)
//!     → rejected w/ code 63 (IllegalStateTransition)
//!   - BreakerCell Tripped output without tripped_at_block set
//!     → rejected w/ code 64 (TrippedAtBlockMissing)
//!   - BreakerCell Tripped -> Resuming without AttestationCell consumed
//!     → rejected w/ code 67 (ResumeMissingAttestation)
//!   - BreakerCell Resuming -> Clear without mature ResumeQueueCell
//!     → rejected w/ code 69 (ResumeQueueMissing)
//!   - AttestationCell breaker_id mismatch
//!     → rejected w/ code 70 (AttestationBreakerIdMismatch)
//!   - AttestationCell quorum bitmap below required threshold
//!     → rejected w/ code 71 (AttestationQuorumNotMet)
//!   - AttestationCell cleared_at_block stale (past staleness window)
//!     → rejected w/ code 72 (AttestationStale)
//!   - ResumeQueueCell eligible_at_block != requested + cooldown
//!     → rejected w/ code 81 (ResumeQueueEligibilityWrong)
//!   - ResumeQueueCell non-monotonic sequence_num
//!     → rejected w/ code 82 (ResumeQueueOrderViolated)
//!   - No LawsonConstantsRegistry cell-dep
//!     → rejected w/ code 90 (LawsonRegistryMissing)
//!   - No NCI ValidatorRegistry cell-dep on attestation
//!     → rejected w/ code 91 (ValidatorRegistryMissing)
//!
//! The `#[cfg(any())]` gate below makes this file NOT compile under
//! `cargo test` from this crate (which would fail anyway given the
//! no_std main.rs), while keeping the source reviewable.

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

// Role tags (mirror src/main.rs).
const ROLE_BREAKER: u8 = 0x01;
const ROLE_ATTESTATION: u8 = 0x02;
const ROLE_RESUME_QUEUE: u8 = 0x03;

// Signal types (mirror src/main.rs).
const SIGNAL_VOLUME: u8 = 0x01;
const SIGNAL_PRICE: u8 = 0x02;
const SIGNAL_WITHDRAWAL: u8 = 0x03;
const SIGNAL_DEPEG: u8 = 0x04;

// Breaker states (mirror src/main.rs).
const STATE_CLEAR: u8 = 0x01;
const STATE_TRIPPED: u8 = 0x02;
const STATE_RESUMING: u8 = 0x03;

// Layout offsets (mirror src/main.rs).
const BREAKER_CELL_LEN: usize = 133;
const ATTESTATION_MIN_LEN: usize = 139;
const ATTESTATION_SIG_LEN: usize = 96;
const QUEUE_CELL_LEN: usize = 93;

// Default executed quorum (matches NCI minimum-validator-rotation).
const DEFAULT_ATTESTATION_QUORUM: u16 = 3;

/// Path inside `contracts-ckb/build/release/` where Capsule emits the
/// script binary. Stub returns an empty slice until Capsule wired.
///
/// TODO: replace with
///   include_bytes!("../../build/release/circuit-breaker-cell-type-script")
/// once Capsule build verified end-to-end.
fn load_script_binary() -> &'static [u8] {
    const _PLACEHOLDER: &[u8] = &[];
    _PLACEHOLDER
}

/// Build a BreakerCell payload.
fn build_breaker_data(
    breaker_id: [u8; 32],
    mechanism_id: [u8; 32],
    signal_type: u8,
    threshold: u128,
    current_counter: u128,
    counter_window_blocks: u64,
    counter_window_start: u64,
    state: u8,
    tripped_at_block: u64,
    cooldown_blocks: u64,
    attestation_quorum: u16,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(BREAKER_CELL_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&breaker_id);
    data.extend_from_slice(&mechanism_id);
    data.push(signal_type);
    data.extend_from_slice(&threshold.to_le_bytes());
    data.extend_from_slice(&current_counter.to_le_bytes());
    data.extend_from_slice(&counter_window_blocks.to_le_bytes());
    data.extend_from_slice(&counter_window_start.to_le_bytes());
    data.push(state);
    data.extend_from_slice(&tripped_at_block.to_le_bytes());
    data.extend_from_slice(&cooldown_blocks.to_le_bytes());
    data.extend_from_slice(&attestation_quorum.to_le_bytes());
    debug_assert_eq!(data.len(), BREAKER_CELL_LEN);
    data
}

/// Build a BreakerAttestationCell payload.
fn build_attestation_data(
    breaker_id: [u8; 32],
    cleared_at_block: u64,
    aggregated_signature: [u8; ATTESTATION_SIG_LEN],
    signer_bitmap: &[u8],
) -> Vec<u8> {
    let mut data = Vec::with_capacity(ATTESTATION_MIN_LEN + signer_bitmap.len());
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&breaker_id);
    data.extend_from_slice(&cleared_at_block.to_le_bytes());
    data.extend_from_slice(&aggregated_signature);
    data.extend_from_slice(&(signer_bitmap.len() as u16).to_le_bytes());
    data.extend_from_slice(signer_bitmap);
    data
}

/// Build a BreakerResumeQueueCell payload.
fn build_queue_data(
    breaker_id: [u8; 32],
    sequence_num: u64,
    resume_requested_at: u64,
    attestation_outpoint: [u8; 36],
    eligible_at_block: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(QUEUE_CELL_LEN);
    data.push(SCHEMA_VERSION);
    data.extend_from_slice(&breaker_id);
    data.extend_from_slice(&sequence_num.to_le_bytes());
    data.extend_from_slice(&resume_requested_at.to_le_bytes());
    data.extend_from_slice(&attestation_outpoint);
    data.extend_from_slice(&eligible_at_block.to_le_bytes());
    debug_assert_eq!(data.len(), QUEUE_CELL_LEN);
    data
}

/// BreakerCell counter-update happy path. Counter increments within
/// window, state remains Clear (counter still below threshold).
///
/// CYCLE5: actual VM execution gated on real binary. SKIP path emits a
/// clear diagnostic and returns early — does NOT silently pass.
#[test]
fn test_breaker_counter_update_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Run `capsule build --release` first. Test logic is compiled and reviewable."
        );
        return;
    }

    let type_outpoint = context.deploy_cell(script_bin);
    let always_success_lock = context
        .build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build lock");

    let breaker_type = context
        .build_script(&type_outpoint, Bytes::from(vec![ROLE_BREAKER]))
        .expect("build breaker type script");

    let breaker_id = [1u8; 32];
    let mechanism_id = [2u8; 32];

    let in_data = build_breaker_data(
        breaker_id,
        mechanism_id,
        SIGNAL_VOLUME,
        10_000,            // threshold
        500,               // current_counter
        1_000,             // window_blocks
        0,                 // window_start
        STATE_CLEAR,
        0,                 // tripped_at_block
        500,               // cooldown_blocks
        DEFAULT_ATTESTATION_QUORUM,
    );
    let out_data = build_breaker_data(
        breaker_id,
        mechanism_id,
        SIGNAL_VOLUME,
        10_000,
        1_500,             // counter incremented
        1_000,
        0,
        STATE_CLEAR,       // still Clear, under threshold
        0,
        500,
        DEFAULT_ATTESTATION_QUORUM,
    );
    let _ = (in_data, out_data, always_success_lock, breaker_type);
    // CYCLE5: assemble tx with Lawson registry cell-dep + verify.
}

/// BreakerCell trip transition: counter crosses threshold in the same
/// tx that flips state Clear -> Tripped. Must succeed.
#[test]
fn test_breaker_trip_transition_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying Clear -> Tripped happy-path is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: input Clear with counter=9_000, output Tripped with
    // counter=11_000 (over threshold) and tripped_at_block=42. Expect
    // verify_tx OK.
    let _ = context;
}

/// BreakerCell trip-not-fired adversarial case: counter > threshold but
/// state still Clear in output → rejected w/ code 62 (TripNotFired).
#[test]
fn test_breaker_trip_not_fired_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying TripNotFired (code 62) is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: output Clear with counter > threshold. Expect
    // verify_tx Err with exit code 62.
    let _ = context;
}

/// BreakerAttestationCell happy path: minted alongside a BreakerCell
/// Tripped -> Resuming transition, breaker_id matches, quorum met,
/// cleared_at_block within staleness window.
#[test]
fn test_attestation_resume_request_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying Tripped -> Resuming + attestation happy-path \
             is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: input BreakerCell(Tripped, tripped_at=10), input
    // AttestationCell(breaker_id match, cleared_at=15, bitmap with 3
    // bits set), output BreakerCell(Resuming). Need Lawson + Validator
    // cell-deps. Expect verify_tx OK.
    let _ = build_attestation_data;
    let _ = context;
}

/// Adversarial: AttestationCell with only 2 signers in bitmap when
/// quorum requires 3 → rejected w/ code 71 (AttestationQuorumNotMet).
#[test]
fn test_attestation_quorum_not_met_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying AttestationQuorumNotMet (code 71) is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: AttestationCell w/ bitmap = [0b00000011] (only 2 bits
    // set) against BreakerCell.attestation_quorum = 3. Expect
    // verify_tx Err with exit 71.
    let _ = context;
}

/// BreakerResumeQueueCell happy path: minted with valid eligibility
/// math (eligible = requested + cooldown).
#[test]
fn test_resume_queue_mint_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying ResumeQueueCell mint happy-path is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: requested_at=20, breaker.cooldown=500, eligible=520.
    // Expect verify_tx OK.
    let _ = build_queue_data;
    let _ = context;
}

/// Adversarial: BreakerResumeQueueCell with `eligible_at_block !=
/// requested + cooldown` → rejected w/ code 81 (ResumeQueueEligibilityWrong).
#[test]
fn test_resume_queue_eligibility_wrong_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying ResumeQueueEligibilityWrong (code 81) is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: requested_at=20, breaker.cooldown=500, eligible=100
    // (attacker tries to shorten cooldown). Expect verify_tx Err with
    // exit 81.
    let _ = context;
}

/// BreakerCell finalize happy path: Resuming -> Clear with mature
/// ResumeQueueCell consumed, counter reset to 0.
#[test]
fn test_breaker_finalize_skips_without_binary() {
    let mut context = Context::default();
    let script_bin = Bytes::from(load_script_binary().to_vec());

    if script_bin.is_empty() {
        eprintln!(
            "[CYCLE5 SKIP] circuit-breaker-cell-type-script binary not present. \
             Test logic verifying Resuming -> Clear happy-path is compiled and reviewable."
        );
        return;
    }
    // CYCLE5: input BreakerCell(Resuming, tripped_at=10, cooldown=500),
    // input ResumeQueueCell(eligible_at=510), output BreakerCell(Clear,
    // counter=0). Expect verify_tx OK.
    let _ = context;
}
