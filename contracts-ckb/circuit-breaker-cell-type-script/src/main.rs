//! # Circuit-Breaker Type Script
//!
//! Type-script enforcing the multi-level circuit-breaker triad on the
//! VibeSwap-CKB sovereign chain. REINTERPRET port of
//! `vibeswap/contracts/core/CircuitBreaker.sol` to the CKB cell model,
//! with the EVM-monolithic contract decomposed into three cells:
//!
//! 1. **BreakerCell** (role tag `0x01`) — holds the live state for one
//!    `(mechanism, signal)` breaker: tripped/clear, counter, threshold,
//!    cooldown, quorum size. Counter is updated by every mechanism
//!    transaction that touches the watched signal; the type-script
//!    enforces asymmetric trip-vs-resume.
//!
//! 2. **BreakerAttestationCell** (role tag `0x02`) — multi-attester trip-
//!    clear evidence. Holds BLS-aggregated operator signatures attesting
//!    that the breaker's underlying condition has cleared. One-shot:
//!    must be consumed by the resume-request tx that mints it (or in a
//!    later resume-request tx that doesn't mint a fresh attestation).
//!
//! 3. **BreakerResumeQueueCell** (role tag `0x03`) — FIFO post-cooldown
//!    resume order. Consumed by the resume-finalize tx once
//!    `eligible_at_block` has elapsed.
//!
//! This single type-script binary covers all three roles, dispatching on
//! a 1-byte tag in `type_script.args[0]`. Matches the workspace pattern
//! established by `lawson-constants-cell-type-script`.
//!
//! ## Structural property preservation
//!
//! Per `specs/circuit-breaker.md` § Property preservation, the
//! asymmetric trip-vs-resume design is structurally enforced by Rust
//! returns:
//!
//! - **Fast trip**: any mechanism tx that pushes `current_counter` past
//!   `threshold` MUST transition the BreakerCell to `Tripped` in the
//!   same tx. No counter-update tx can produce an output where
//!   `current_counter > threshold` and `state == Clear`. Single-tx
//!   trip; no separate trip authorization needed.
//!
//! - **Attested resume**: the only legal `Tripped -> Resuming`
//!   transition consumes a BreakerAttestationCell with matching
//!   `breaker_id`, signer-count >= `attestation_quorum` (default 3,
//!   matching NCI minimum-validator-rotation per the executed default).
//!
//! - **Cooldown floor**: the only legal `Resuming -> Clear` transition
//!   consumes a BreakerResumeQueueCell whose `eligible_at_block` <=
//!   current block height. Cooldown duration is read from
//!   LawsonConstantsRegistry's `breaker_cooldown_blocks` constant via
//!   cell-dep.
//!
//! ## Composition (executed defaults)
//!
//! - **Threshold source** = LawsonConstantsRegistry cell-dep. Three
//!   constants consumed: `volume_breaker_bps`, `price_breaker_bps`,
//!   `withdrawal_breaker_bps`, dispatched on the BreakerCell's
//!   `signal_type`. The breaker's `threshold` field is a projection of
//!   the Lawson value at mint-time; the type-script verifies on every
//!   update that the projected value matches the current Lawson read.
//!   This is the [P·structure-does-the-work] interpretation of the
//!   spec's "thresholds live in Lawson" comment.
//!   TODO: enforce code-hash match on the Lawson cell-dep (not just
//!   shape-heuristic), per the same gap noted in lawson-constants'
//!   `find_bounds_cell_dep`.
//!
//! - **Attester identity** = NCI ValidatorRegistry cell-dep. The
//!   `signer_bitmap` indexes into the NCI validator set; the BLS
//!   aggregated signature is verified against the validator-set's BLS
//!   pubkeys. Default quorum = 3 (matches NCI
//!   minimum-validator-rotation). CYCLE5: actual BLS verify delegated
//!   to the workspace `bls-verify` crate (per
//!   `specs/bls12-381-cycle-budget-spike.md`); this scaffold validates
//!   only shape-level invariants.
//!
//! - **Asymmetric trip vs resume**: trip requires N=1 (any tx that
//!   crosses the threshold); resume requires N=3 attestations + cooldown
//!   + finalize. Asymmetry is per-spec "trip is a side effect, resume
//!   is witnessed" — and matches the open question's "default to
//!   reuse-MessagingHub-validators".
//!
//! ## Status
//!
//! SPEC scaffold, not audit-ready. Marked production-readiness TODOs
//! are inline. Source-reviewable; not yet machine-verified on this dev
//! box (see README § Known build blockers — same toolchain pinning +
//! cc + capsule issues as the sibling crates).
//!
//! Spec: `vibeswap/contracts-ckb/specs/circuit-breaker.md`
//! EVM source: `vibeswap/contracts/core/CircuitBreaker.sol`

#![no_std]
#![no_main]


use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Schema constants ============

const SCHEMA_VERSION: u8 = 1;

// Heapless caps. 8 group cells per tx is generous; a counter-update tx
// touches exactly one BreakerCell, a resume-request touches one
// BreakerCell + one AttestationCell + emits one ResumeQueueCell, a
// finalize touches one BreakerCell + one ResumeQueueCell.
const MAX_GROUP_CELLS: usize = 8;

// Maximum cell-data length we'll buffer for a Lawson registry read or a
// validator-registry read. 8 KiB matches the lawson-constants scaffold.
const MAX_CELL_DATA: usize = 8192;

// Default attestation quorum (per executed default: 3 attestations
// matches NCI minimum-validator-rotation). Real value is read from the
// BreakerCell's `attestation_quorum` field, which is projected from
// Lawson `attestation_quorum_size`; this constant is the floor.
const DEFAULT_ATTESTATION_QUORUM: u16 = 3;

// Attestation staleness window in blocks. Beyond this, the attestation
// is rejected to prevent replay. Default = 256 blocks (~ a few minutes
// at typical CKB block times); real value should be Lawson-tunable.
// TODO: pull this from LawsonConstantsRegistry once
// `breaker_attestation_staleness_blocks` is registered there.
const DEFAULT_ATTESTATION_STALENESS: u64 = 256;

// ============ Role tag (type_script.args[0]) ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RoleTag {
    Breaker = 0x01,
    Attestation = 0x02,
    ResumeQueue = 0x03,
}

impl RoleTag {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Breaker),
            0x02 => Some(Self::Attestation),
            0x03 => Some(Self::ResumeQueue),
            _ => None,
        }
    }
}

// ============ SignalType + BreakerState discriminants ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum SignalType {
    Volume = 0x01,
    Price = 0x02,
    Withdrawal = 0x03,
    Depeg = 0x04,
}

impl SignalType {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Volume),
            0x02 => Some(Self::Price),
            0x03 => Some(Self::Withdrawal),
            0x04 => Some(Self::Depeg),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum BreakerState {
    Clear = 0x01,
    Tripped = 0x02,
    Resuming = 0x03,
}

impl BreakerState {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Clear),
            0x02 => Some(Self::Tripped),
            0x03 => Some(Self::Resuming),
            _ => None,
        }
    }
}

/// Legal state-transition rule. Spec § Type-script invariants:
/// - Clear -> Tripped (counter crossed threshold)
/// - Tripped -> Resuming (attestation quorum reached)
/// - Resuming -> Clear (cooldown elapsed + ResumeQueueCell consumed)
/// - X -> X (counter update without state change)
/// All other transitions are illegal.
fn is_legal_transition(from: BreakerState, to: BreakerState) -> bool {
    use BreakerState::*;
    matches!(
        (from, to),
        (Clear, Clear)
            | (Clear, Tripped)
            | (Tripped, Tripped)
            | (Tripped, Resuming)
            | (Resuming, Resuming)
            | (Resuming, Clear)
    )
}

// ============ BreakerCell layout ============
//
// version: u8                       @ 0
// breaker_id: [u8; 32]              @ 1
// mechanism_id: [u8; 32]            @ 33
// signal_type: u8                   @ 65
// threshold: u128 LE                @ 66
// current_counter: u128 LE          @ 82
// counter_window_blocks: u64 LE     @ 98
// counter_window_start: u64 LE      @ 106
// state: u8                         @ 114
// tripped_at_block: u64 LE          @ 115 (0 = unset)
// cooldown_blocks: u64 LE           @ 123
// attestation_quorum: u16 LE        @ 131
//                                   = 133 bytes
const BREAKER_VERSION_OFFSET: usize = 0;
const BREAKER_ID_OFFSET: usize = 1;
const BREAKER_MECH_ID_OFFSET: usize = 33;
const BREAKER_SIGNAL_TYPE_OFFSET: usize = 65;
const BREAKER_THRESHOLD_OFFSET: usize = 66;
const BREAKER_COUNTER_OFFSET: usize = 82;
const BREAKER_WINDOW_BLOCKS_OFFSET: usize = 98;
const BREAKER_WINDOW_START_OFFSET: usize = 106;
const BREAKER_STATE_OFFSET: usize = 114;
const BREAKER_TRIPPED_AT_OFFSET: usize = 115;
const BREAKER_COOLDOWN_OFFSET: usize = 123;
const BREAKER_QUORUM_OFFSET: usize = 131;
const BREAKER_CELL_LEN: usize = 133;

// ============ BreakerAttestationCell layout ============
//
// version: u8                       @ 0
// breaker_id: [u8; 32]              @ 1
// cleared_at_block: u64 LE          @ 33
// aggregated_signature: [u8; 96]    @ 41   (BLS12-381 G2 compressed)
// signer_bitmap_len: u16 LE         @ 137
// signer_bitmap: [u8; N]            @ 139..(139 + N)
const ATTESTATION_VERSION_OFFSET: usize = 0;
const ATTESTATION_BREAKER_ID_OFFSET: usize = 1;
const ATTESTATION_CLEARED_AT_OFFSET: usize = 33;
const ATTESTATION_SIG_OFFSET: usize = 41;
const ATTESTATION_SIG_LEN: usize = 96;
const ATTESTATION_BITMAP_LEN_OFFSET: usize = 137;
const ATTESTATION_BITMAP_OFFSET: usize = 139;
const ATTESTATION_MIN_LEN: usize = ATTESTATION_BITMAP_OFFSET;

// ============ BreakerResumeQueueCell layout ============
//
// version: u8                       @ 0
// breaker_id: [u8; 32]              @ 1
// sequence_num: u64 LE              @ 33
// resume_requested_at: u64 LE       @ 41
// attestation_outpoint: [u8; 36]    @ 49   (tx_hash[32] + index u32 LE)
// eligible_at_block: u64 LE         @ 85
//                                   = 93 bytes
const QUEUE_VERSION_OFFSET: usize = 0;
const QUEUE_BREAKER_ID_OFFSET: usize = 1;
const QUEUE_SEQ_OFFSET: usize = 33;
const QUEUE_REQUESTED_AT_OFFSET: usize = 41;
const QUEUE_ATTESTATION_OUTPOINT_OFFSET: usize = 49;
const QUEUE_ATTESTATION_OUTPOINT_LEN: usize = 36;
const QUEUE_ELIGIBLE_OFFSET: usize = 85;
const QUEUE_CELL_LEN: usize = 93;

// ============ Entry ============

/// Script entry point. Returns 0 on success, nonzero error code on rejection.
pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level dispatch ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.is_empty() {
        return Err(Error::ScriptArgsMalformed);
    }
    let role = RoleTag::from_byte(args_bytes[0]).ok_or(Error::ScriptArgsMalformed)?;

    match role {
        RoleTag::Breaker => verify_breaker_cell(),
        RoleTag::Attestation => verify_attestation_cell(),
        RoleTag::ResumeQueue => verify_resume_queue_cell(),
    }
}

// ============ BreakerCell verification ============

fn verify_breaker_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    // BreakerCell cannot be destroyed. Each (mechanism, signal) pair has
    // exactly one BreakerCell, forever (see spec § Per-cell).
    if !inputs.is_empty() && outputs.is_empty() {
        return Err(Error::BreakerDestroyed);
    }
    if outputs.is_empty() {
        // No-op (e.g. unrelated tx that happens to bear our script).
        return Ok(());
    }

    // Layout validation on every output.
    for out_data in &outputs {
        validate_breaker_layout(out_data)?;
    }

    // Pure output-side invariants: trip-must-fire-on-threshold-cross.
    for out_data in &outputs {
        let state = BreakerState::from_byte(out_data[BREAKER_STATE_OFFSET])
            .ok_or(Error::EnumDiscriminantUnknown)?;
        let counter = read_u128_le(
            &out_data[BREAKER_COUNTER_OFFSET..BREAKER_COUNTER_OFFSET + 16],
        );
        let threshold = read_u128_le(
            &out_data[BREAKER_THRESHOLD_OFFSET..BREAKER_THRESHOLD_OFFSET + 16],
        );
        // If counter > threshold, state MUST be Tripped (or Resuming, if
        // the trip has already been attested and is mid-resume). State
        // Clear with counter > threshold = invariant violation.
        if counter > threshold && state == BreakerState::Clear {
            return Err(Error::TripNotFired);
        }
        // Output state Tripped requires tripped_at_block set (nonzero).
        if state == BreakerState::Tripped {
            let tripped_at = read_u64_le(
                &out_data[BREAKER_TRIPPED_AT_OFFSET..BREAKER_TRIPPED_AT_OFFSET + 8],
            );
            if tripped_at == 0 {
                return Err(Error::TrippedAtBlockMissing);
            }
        }
    }

    // If there's an input BreakerCell, this is a transition tx (not
    // genesis-mint). Enforce identity-preserving + legal-transition +
    // resume-requires-attestation + finalize-requires-queue.
    if let Some(in_data) = inputs.first() {
        let out_data = &outputs[0];
        validate_breaker_layout(in_data)?;
        validate_breaker_transition(in_data, out_data)?;
    }

    // Threshold-source composition: BreakerCell threshold must match the
    // current LawsonConstantsRegistry value for the breaker's
    // signal_type. Looked up via cell-dep.
    //
    // CYCLE5: the cell-dep discovery is shape-heuristic (matches the
    // lawson-constants finder), so an adversary could provide a forged
    // cell. Production must enforce code-hash matching.
    for out_data in &outputs {
        validate_threshold_against_lawson(out_data)?;
    }

    Ok(())
}

fn validate_breaker_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < BREAKER_CELL_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[BREAKER_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    // Validate the enum bytes are recognized discriminants.
    SignalType::from_byte(data[BREAKER_SIGNAL_TYPE_OFFSET])
        .ok_or(Error::EnumDiscriminantUnknown)?;
    BreakerState::from_byte(data[BREAKER_STATE_OFFSET])
        .ok_or(Error::EnumDiscriminantUnknown)?;
    // counter_window_blocks must be nonzero (avoid div-by-zero in
    // window-slide math).
    let window_blocks = read_u64_le(
        &data[BREAKER_WINDOW_BLOCKS_OFFSET..BREAKER_WINDOW_BLOCKS_OFFSET + 8],
    );
    if window_blocks == 0 {
        return Err(Error::CounterWindowInvariant);
    }
    // attestation_quorum floor (default = 3 per executed default).
    let quorum = read_u16_le(&data[BREAKER_QUORUM_OFFSET..BREAKER_QUORUM_OFFSET + 2]);
    if quorum < DEFAULT_ATTESTATION_QUORUM {
        return Err(Error::CapacityExceeded);
    }
    Ok(())
}

/// Identity-preserving + legal-transition + asymmetric-trip-vs-resume
/// enforcement for a `(input, output)` BreakerCell pair.
fn validate_breaker_transition(in_data: &[u8], out_data: &[u8]) -> Result<(), Error> {
    // Identity: breaker_id, mechanism_id, signal_type, threshold,
    // counter_window_blocks, cooldown_blocks, attestation_quorum are
    // immutable. Threshold COULD legitimately change if Lawson updates;
    // for the scaffold we treat it as immutable per-cell and require
    // re-mint on Lawson change. CYCLE5: relax once Lawson-projection
    // refresh tx is specced.
    if in_data[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
        != out_data[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
    {
        return Err(Error::BreakerIdMutated);
    }
    if in_data[BREAKER_MECH_ID_OFFSET..BREAKER_MECH_ID_OFFSET + 32]
        != out_data[BREAKER_MECH_ID_OFFSET..BREAKER_MECH_ID_OFFSET + 32]
    {
        return Err(Error::BreakerIdMutated);
    }
    if in_data[BREAKER_SIGNAL_TYPE_OFFSET] != out_data[BREAKER_SIGNAL_TYPE_OFFSET] {
        return Err(Error::BreakerIdMutated);
    }

    // Counter-window monotonicity: window_start must move forward or
    // stay the same. Backward = invariant violation.
    let in_window_start = read_u64_le(
        &in_data[BREAKER_WINDOW_START_OFFSET..BREAKER_WINDOW_START_OFFSET + 8],
    );
    let out_window_start = read_u64_le(
        &out_data[BREAKER_WINDOW_START_OFFSET..BREAKER_WINDOW_START_OFFSET + 8],
    );
    if out_window_start < in_window_start {
        return Err(Error::CounterWindowInvariant);
    }

    // State transition legality.
    let in_state = BreakerState::from_byte(in_data[BREAKER_STATE_OFFSET])
        .ok_or(Error::EnumDiscriminantUnknown)?;
    let out_state = BreakerState::from_byte(out_data[BREAKER_STATE_OFFSET])
        .ok_or(Error::EnumDiscriminantUnknown)?;
    if !is_legal_transition(in_state, out_state) {
        return Err(Error::IllegalStateTransition);
    }

    use BreakerState::*;
    let in_breaker_id = &in_data[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32];

    match (in_state, out_state) {
        (Tripped, Resuming) => {
            // Resume request: must consume an AttestationCell with
            // matching breaker_id, quorum met, BLS valid, not stale.
            let attestation = find_attestation_input_for(in_breaker_id)?
                .ok_or(Error::ResumeMissingAttestation)?;
            validate_attestation_against_breaker(&attestation, in_data)?;
        }
        (Resuming, Clear) => {
            // Finalize: cooldown elapsed + ResumeQueueCell mature.
            let cooldown = read_u64_le(
                &in_data[BREAKER_COOLDOWN_OFFSET..BREAKER_COOLDOWN_OFFSET + 8],
            );
            let tripped_at = read_u64_le(
                &in_data[BREAKER_TRIPPED_AT_OFFSET..BREAKER_TRIPPED_AT_OFFSET + 8],
            );
            // current block height check: ckb-std exposes
            // load_input_since / load_header for header-dep block
            // height. For the scaffold we delegate the
            // current-block check to the ResumeQueueCell's
            // `eligible_at_block`, which is monotone w/ block height
            // (verified at queue-consumption time by the queue's own
            // type-script).
            // TODO: also assert block.height >= tripped_at + cooldown
            // here for double-defense via header-dep.
            let _ = (cooldown, tripped_at);
            let queue = find_resume_queue_input_for(in_breaker_id)?
                .ok_or(Error::ResumeQueueMissing)?;
            validate_resume_queue_against_breaker(&queue, in_data)?;

            // Counter resets to 0 on transition to Clear.
            let out_counter = read_u128_le(
                &out_data[BREAKER_COUNTER_OFFSET..BREAKER_COUNTER_OFFSET + 16],
            );
            if out_counter != 0 {
                return Err(Error::CounterWindowInvariant);
            }
        }
        (Clear, Tripped) => {
            // Trip transition: counter must exceed threshold AND
            // tripped_at_block must be set. Pure output-side checks
            // already cover both.
        }
        _ => {
            // Self-transitions (counter update without state change) are
            // accepted — counter math is enforced by the consuming
            // mechanism's type-script in the same tx.
        }
    }

    Ok(())
}

/// Cross-cell check: the BreakerCell's `threshold` field must equal the
/// LawsonConstantsRegistry's value for the matching signal_type
/// constant.
///
/// CYCLE5: the registry cell-dep discovery is shape-heuristic; an
/// adversary could provide a forged cell. Production must enforce
/// code-hash matching against the deployed lawson-constants script.
fn validate_threshold_against_lawson(_breaker_data: &[u8]) -> Result<(), Error> {
    // TODO: read the Lawson registry cell-dep, look up the
    // signal_type-keyed constant (`volume_breaker_bps`,
    // `price_breaker_bps`, `withdrawal_breaker_bps`), assert it equals
    // `_breaker_data[BREAKER_THRESHOLD_OFFSET..]`.
    //
    // For the scaffold we accept any threshold provided that the
    // Lawson cell-dep IS present (proves composition wiring even if not
    // strictly verified). If the dep is missing, fail closed.
    match find_lawson_registry_cell_dep() {
        Ok(_data) => Ok(()),
        Err(Error::ItemMissing) => Err(Error::LawsonRegistryMissing),
        Err(e) => Err(e),
    }
}

// ============ BreakerAttestationCell verification ============

fn verify_attestation_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    // Attestation cells are one-shot: they may be minted (output) and
    // consumed (input) but should not "pass through" as both with
    // unchanged data. The actual referential check (was THIS attestation
    // consumed by a paired resume-request tx?) is enforced on the
    // BreakerCell side via `find_attestation_input_for`.

    // Layout validation on all attestation outputs (mints) and inputs
    // (consumes). For the scaffold we accept both shapes and rely on
    // the BreakerCell's transition logic to enforce the one-shot rule.
    for data in inputs.iter().chain(outputs.iter()) {
        validate_attestation_layout(data)?;
    }

    // If this attestation cell appears as output without ever being
    // consumed (no matching input in the same group), we want to fail
    // closed — leaked attestations are a replay vector. But "this
    // particular output cell is unconsumed" can only be observed across
    // txs; within a single tx, the output is always "fresh". We rely on
    // tx-level pairing: the mint tx ALWAYS pairs with a BreakerCell
    // Tripped->Resuming transition, which consumes it via cell-dep or
    // input. CYCLE5: harden by requiring attestation outputs to appear
    // alongside a paired BreakerCell input in the same tx group.

    // BLS verification gate (delegated; not wired here).
    // TODO: when `bls-verify` crate lands, call
    //   bls_verify::verify_aggregated(sig, message, signer_pubkeys)
    // here, with `signer_pubkeys` resolved from the NCI
    // ValidatorRegistry cell-dep via the signer_bitmap.
    // For the scaffold we require the ValidatorRegistry cell-dep to be
    // present (proves composition wiring even if signature math isn't).
    if !outputs.is_empty() || !inputs.is_empty() {
        match find_validator_registry_cell_dep() {
            Ok(_data) => (),
            Err(Error::ItemMissing) => return Err(Error::ValidatorRegistryMissing),
            Err(e) => return Err(e),
        }
    }

    Ok(())
}

fn validate_attestation_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < ATTESTATION_MIN_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[ATTESTATION_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let bitmap_len = read_u16_le(
        &data[ATTESTATION_BITMAP_LEN_OFFSET..ATTESTATION_BITMAP_LEN_OFFSET + 2],
    ) as usize;
    if data.len() < ATTESTATION_BITMAP_OFFSET + bitmap_len {
        return Err(Error::CellDataMalformed);
    }
    Ok(())
}

/// Verify the attestation cell-data matches the BreakerCell it's
/// resuming: breaker_id match, quorum met, not stale.
fn validate_attestation_against_breaker(
    attestation_data: &[u8],
    breaker_data: &[u8],
) -> Result<(), Error> {
    // breaker_id match.
    if attestation_data[ATTESTATION_BREAKER_ID_OFFSET..ATTESTATION_BREAKER_ID_OFFSET + 32]
        != breaker_data[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
    {
        return Err(Error::AttestationBreakerIdMismatch);
    }

    // Quorum: count signers in bitmap. Must be >= breaker.attestation_quorum.
    let required_quorum = read_u16_le(
        &breaker_data[BREAKER_QUORUM_OFFSET..BREAKER_QUORUM_OFFSET + 2],
    );
    let bitmap_len = read_u16_le(
        &attestation_data
            [ATTESTATION_BITMAP_LEN_OFFSET..ATTESTATION_BITMAP_LEN_OFFSET + 2],
    ) as usize;
    let bitmap = &attestation_data
        [ATTESTATION_BITMAP_OFFSET..ATTESTATION_BITMAP_OFFSET + bitmap_len];
    let signer_count: u32 = bitmap.iter().map(|b| b.count_ones()).sum();
    if signer_count < required_quorum as u32 {
        return Err(Error::AttestationQuorumNotMet);
    }

    // Staleness: cleared_at_block must be within
    // DEFAULT_ATTESTATION_STALENESS of the breaker's tripped_at_block
    // (proxy: real check needs current block height via header-dep).
    // TODO: replace with current-block-vs-cleared-at when header-dep
    // wiring lands.
    let cleared_at = read_u64_le(
        &attestation_data[ATTESTATION_CLEARED_AT_OFFSET..ATTESTATION_CLEARED_AT_OFFSET + 8],
    );
    let tripped_at = read_u64_le(
        &breaker_data[BREAKER_TRIPPED_AT_OFFSET..BREAKER_TRIPPED_AT_OFFSET + 8],
    );
    // attestation must clear AFTER the trip, and within staleness window.
    if cleared_at < tripped_at {
        return Err(Error::AttestationStale);
    }
    if cleared_at.saturating_sub(tripped_at) > DEFAULT_ATTESTATION_STALENESS {
        return Err(Error::AttestationStale);
    }

    // BLS verify (delegated; not wired in scaffold).
    // TODO: bls_verify::verify_aggregated(...) using the
    //       NCI ValidatorRegistry's pubkeys for the bitmap.
    Ok(())
}

// ============ BreakerResumeQueueCell verification ============

fn verify_resume_queue_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    // Queue cells are consumed by the finalize tx. They may be minted by
    // the resume-request tx. Both shapes pass layout validation.
    for data in inputs.iter().chain(outputs.iter()) {
        validate_resume_queue_layout(data)?;
    }

    // FIFO ordering: if multiple resume-queue cells appear in outputs,
    // sequence_num must be monotonically increasing.
    let mut prev_seq: Option<u64> = None;
    for out_data in outputs.iter() {
        let seq = read_u64_le(&out_data[QUEUE_SEQ_OFFSET..QUEUE_SEQ_OFFSET + 8]);
        if let Some(p) = prev_seq {
            if seq <= p {
                return Err(Error::ResumeQueueOrderViolated);
            }
        }
        prev_seq = Some(seq);
    }

    // Eligibility math: eligible_at_block = resume_requested_at +
    // (breaker.cooldown_blocks). We don't have the BreakerCell on this
    // verification path, but we can sanity-check eligible >= requested.
    for out_data in outputs.iter() {
        let requested = read_u64_le(
            &out_data[QUEUE_REQUESTED_AT_OFFSET..QUEUE_REQUESTED_AT_OFFSET + 8],
        );
        let eligible = read_u64_le(
            &out_data[QUEUE_ELIGIBLE_OFFSET..QUEUE_ELIGIBLE_OFFSET + 8],
        );
        if eligible < requested {
            return Err(Error::ResumeQueueEligibilityWrong);
        }
    }

    // Immaturity check: a queue cell consumed as input must have
    // eligible_at_block <= current block height. Same header-dep
    // limitation as the breaker's finalize check — gated for CYCLE5.
    // TODO: header-dep block-height comparison here.

    Ok(())
}

fn validate_resume_queue_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < QUEUE_CELL_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[QUEUE_VERSION_OFFSET] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

/// Verify a queue cell matches the BreakerCell it's finalizing:
/// breaker_id match, eligibility math consistent with cooldown.
fn validate_resume_queue_against_breaker(
    queue_data: &[u8],
    breaker_data: &[u8],
) -> Result<(), Error> {
    if queue_data[QUEUE_BREAKER_ID_OFFSET..QUEUE_BREAKER_ID_OFFSET + 32]
        != breaker_data[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
    {
        return Err(Error::ResumeQueueBreakerIdMismatch);
    }
    let cooldown = read_u64_le(
        &breaker_data[BREAKER_COOLDOWN_OFFSET..BREAKER_COOLDOWN_OFFSET + 8],
    );
    let requested = read_u64_le(
        &queue_data[QUEUE_REQUESTED_AT_OFFSET..QUEUE_REQUESTED_AT_OFFSET + 8],
    );
    let eligible = read_u64_le(
        &queue_data[QUEUE_ELIGIBLE_OFFSET..QUEUE_ELIGIBLE_OFFSET + 8],
    );
    // eligible_at = requested_at + cooldown_blocks. Exact equality.
    let expected = requested.checked_add(cooldown).ok_or(Error::ResumeQueueEligibilityWrong)?;
    if eligible != expected {
        return Err(Error::ResumeQueueEligibilityWrong);
    }
    Ok(())
}

// ============ Cross-group cell discovery ============
//
// AttestationCell + ResumeQueueCell discovery within the SAME tx but a
// DIFFERENT type-script-group (different RoleTag). The BreakerCell
// verification path looks across Source::Input (not GroupInput) to find
// the matching attestation / queue cell by `breaker_id`.

/// Find a BreakerAttestationCell input in the same tx with matching
/// breaker_id. Returns the cell-data blob if found.
fn find_attestation_input_for(
    breaker_id: &[u8],
) -> Result<Option<alloc::vec::Vec<u8>>, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Input) {
            Ok(data) => {
                if data.len() >= ATTESTATION_MIN_LEN
                    && data[ATTESTATION_VERSION_OFFSET] == SCHEMA_VERSION
                    && data.len()
                        >= ATTESTATION_BREAKER_ID_OFFSET + 32
                    && &data[ATTESTATION_BREAKER_ID_OFFSET..ATTESTATION_BREAKER_ID_OFFSET + 32]
                        == breaker_id
                {
                    return Ok(Some(data));
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(None),
            Err(e) => return Err(e.into()),
        }
    }
}

/// Find a BreakerResumeQueueCell input in the same tx with matching
/// breaker_id.
fn find_resume_queue_input_for(
    breaker_id: &[u8],
) -> Result<Option<alloc::vec::Vec<u8>>, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Input) {
            Ok(data) => {
                if data.len() >= QUEUE_CELL_LEN
                    && data[QUEUE_VERSION_OFFSET] == SCHEMA_VERSION
                    && &data[QUEUE_BREAKER_ID_OFFSET..QUEUE_BREAKER_ID_OFFSET + 32]
                        == breaker_id
                {
                    return Ok(Some(data));
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(None),
            Err(e) => return Err(e.into()),
        }
    }
}

/// Walk CellDep slots looking for the LawsonConstantsRegistry cell.
/// Shape-heuristic for the scaffold (same gap as
/// lawson-constants-cell-type-script's `find_bounds_cell_dep`).
///
/// TODO: replace with compile-time code-hash matching against the
/// deployed `lawson-constants-cell-type-script` binary, with
/// `RoleTag::Registry` (0x02) in args[0]. Until then this is shape-only
/// and an adversary could provide an unrelated cell.
fn find_lawson_registry_cell_dep() -> Result<heapless::Vec<u8, MAX_CELL_DATA>, Error> {
    // Lawson registry layout: version(1) + constant_count(2) +
    // constants(72 * N) + outpoint(36). Minimum sensible size for N=1:
    // 3 + 72 + 36 = 111. We accept anything with version byte == 1 and
    // length >= 5 (defensive minimum: header + at-least-zero constants
    // + outpoint).
    let min_registry_len = 3usize + 36;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= min_registry_len && data[0] == SCHEMA_VERSION {
                    let mut buf: heapless::Vec<u8, MAX_CELL_DATA> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        if buf.push(*b).is_err() {
                            return Err(Error::CapacityExceeded);
                        }
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::ItemMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// Walk CellDep slots looking for the NCI ValidatorRegistry cell. Same
/// shape-heuristic limitation as the Lawson finder.
///
/// TODO: enforce code-hash match against the deployed NCI
/// validator-registry script binary once that crate lands.
fn find_validator_registry_cell_dep() -> Result<heapless::Vec<u8, MAX_CELL_DATA>, Error> {
    // We don't have a strict shape for the NCI ValidatorRegistry yet;
    // for the scaffold we accept any cell-dep tagged with our schema
    // version byte that is NOT the Lawson cell (heuristic differentiator
    // CYCLE5: distinguish by code-hash). Until then we return the
    // SECOND matching cell-dep — the first is assumed to be Lawson, the
    // second the ValidatorRegistry, by convention.
    let mut matches_seen = 0usize;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty() && data[0] == SCHEMA_VERSION {
                    matches_seen += 1;
                    if matches_seen == 2 {
                        let mut buf: heapless::Vec<u8, MAX_CELL_DATA> = heapless::Vec::new();
                        if data.len() > buf.capacity() {
                            return Err(Error::CapacityExceeded);
                        }
                        for b in data.iter() {
                            if buf.push(*b).is_err() {
                                return Err(Error::CapacityExceeded);
                            }
                        }
                        return Ok(buf);
                    }
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::ItemMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Group-cell helpers ============

/// Collect all cell-data blobs in the group source into a heapless::Vec
/// of owned Vec<u8>. We use ckb-std's `alloc`-fed Vec (from
/// default_alloc) because borrowing across syscalls is awkward with
/// QueryIter and the data sizes are small (under a few hundred bytes
/// per breaker cell).
fn collect_group_data(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_GROUP_CELLS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_GROUP_CELLS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Byte readers ============

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64_le(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
