//! # Emergency Pause Boundary Cell Type Script
//!
//! Discretionary trip and attested resume of `BreakerCell` per
//! `specs/nci-boundary-enforcement.md` §2.6. Composes with NCIScoreCell
//! (authorization), BreakerCell (target), Lawson (thresholds + finality),
//! and ValidatorRegistry (attester identity for asymmetric quorum).
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                 | bytes | offset |
//! |-----------------------|-------|--------|
//! | version               |   1   |   0    |
//! | action                |   1   |   1    |   0 = trip, 1 = resume
//! | scope                 |   1   |   2    |   0 = global, 1 = pool, 2 = domain
//! | breaker_cell_outpoint |  40   |   3    |   tx_hash[32] | index u64 LE[8]
//! | epoch                 |   8   |  43    |   u64 LE
//! | inclusion_height      |   8   |  51    |   u64 LE
//!
//! Total fixed size: 59 bytes.

#![no_std]
#![no_main]


use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_type_hash, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Cell-data layout ============

const SCHEMA_VERSION: u8 = 1;

const OFFSET_VERSION: usize = 0;
const OFFSET_ACTION: usize = 1;
const OFFSET_SCOPE: usize = 2;
const OFFSET_BREAKER_OUTPOINT: usize = 3;
const OFFSET_EPOCH: usize = 43;
const OFFSET_INCLUSION_HEIGHT: usize = 51;
const CELL_DATA_LEN: usize = 59;

const BREAKER_OUTPOINT_LEN: usize = 40;

// ============ Action / scope discriminants ============

const ACTION_TRIP: u8 = 0x00;
const ACTION_RESUME: u8 = 0x01;

const SCOPE_GLOBAL: u8 = 0x00;
const SCOPE_PER_POOL: u8 = 0x01;
const SCOPE_PER_DOMAIN: u8 = 0x02;

// ============ Type-script args ============

const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ BreakerCell layout (mirrors circuit-breaker-cell-type-script) ============

const BREAKER_VERSION_OFFSET: usize = 0;
const BREAKER_ID_OFFSET: usize = 1;
const BREAKER_STATE_OFFSET: usize = 114;
const BREAKER_TRIPPED_AT_OFFSET: usize = 115;
const BREAKER_QUORUM_OFFSET: usize = 131;
const BREAKER_CELL_LEN: usize = 133;

const BREAKER_STATE_CLEAR: u8 = 0x01;
const BREAKER_STATE_TRIPPED: u8 = 0x02;
const BREAKER_STATE_RESUMING: u8 = 0x03;

// ============ BreakerAttestationCell layout (subset; mirrors sibling crate) ============

const ATT_OFFSET_VERSION: usize = 0;
const ATT_OFFSET_BREAKER_ID: usize = 1;
const ATT_OFFSET_BITMAP_LEN: usize = 137;
const ATT_OFFSET_BITMAP: usize = 139;
const ATT_MIN_LEN: usize = 139;

// ============ ValidatorRegistryCell layout (subset; mirrors sibling crate) ============

const REGISTRY_OFFSET_VERSION: usize = 0;
const REGISTRY_OFFSET_N_VALIDATORS: usize = 29;
const REGISTRY_HEADER_LEN: usize = 31;
const REGISTRY_VALIDATOR_ENTRY_LEN: usize = 64;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Sentinel placeholders so reviewers can grep.
// TODO: blake2b("emergency_pause.*") at compile time.
const LAWSON_NAME_EMERGENCY_TRIP_SCORE_THRESHOLD: [u8; 32] = [0x30; 32];
const LAWSON_NAME_EMERGENCY_RESUME_SCORE_THRESHOLD: [u8; 32] = [0x31; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_EMERGENCY_RESUME_FINALITY_BLOCKS: [u8; 32] = [0x32; 32];

// Asymmetric attester floors. Trip = 3 (NCI minimum-validator-rotation);
// resume = unanimous (caller resolves N from ValidatorRegistry.n_validators).
const TRIP_ATTESTER_FLOOR: u32 = 3;

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const BREAKER_BLOB_CAP: usize = 256;
const ATT_BLOB_CAP: usize = 512;
const REGISTRY_BLOB_CAP: usize = 16384;
const MAX_BOUNDARY_OUTPUTS: usize = 8;

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.len() != ARGS_OWN_TYPE_HASH_LEN {
        return Err(Error::ScriptArgsMalformed);
    }
    let mut own_type_hash = [0u8; ARGS_OWN_TYPE_HASH_LEN];
    own_type_hash.copy_from_slice(args_bytes);

    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    match (inputs.is_empty(), outputs.is_empty()) {
        (true, true) => Err(Error::EmptyTransition),
        // Creation: emergency pause/resume command issued.
        (true, false) => verify_creation(&outputs),
        // Consume: boundary spent into downstream archival or proof-of-action.
        // Finality matters here for the resume path only — REORG §6 gives trip 0
        // (security-priority) and resume 24 (false-resume cost).
        (false, true) => verify_consume(&inputs),
        // In-place mutation is not legal for a boundary commitment.
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

// ============ Read group cells ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_BOUNDARY_OUTPUTS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_BOUNDARY_OUTPUTS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Creation path ============

fn verify_creation(outputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }

    // Common Skeleton step 1+2: NCI cell-dep + score + freshness.
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]) as u64;
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: PoWAnchorCell header-dep for authoritative tip.

    // Resolve the same-tx BreakerCell shape once; every output binds to it.
    // Same-tx because the action's target state must be reflected in the
    // BreakerCell output produced by this transaction.
    let breaker_in = find_breaker_cell(Source::Input)?;
    let breaker_out = find_breaker_cell(Source::Output)?;

    for out in outputs {
        let action = out[OFFSET_ACTION];
        // Asymmetric score threshold: trip = lower floor; resume = higher.
        // Spec §2.6: RESUME_SCORE_THRESHOLD > TRIP_SCORE_THRESHOLD because
        // false-resume after exploit costs more than false-trip.
        match action {
            ACTION_TRIP => {
                if score < lp.emergency_trip_score_threshold {
                    return Err(Error::NciScoreBelowTripThreshold);
                }
            }
            ACTION_RESUME => {
                if score < lp.emergency_resume_score_threshold {
                    return Err(Error::NciScoreBelowResumeThreshold);
                }
            }
            _ => return Err(Error::ActionDiscriminantUnknown),
        }

        verify_breaker_binding(out, &breaker_in, &breaker_out, action)?;
    }

    Ok(())
}

// ============ Consume path ============

fn verify_consume(inputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for inp in inputs {
        verify_layout(inp)?;
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;
    let tip = read_tip_height_proxy()?;

    // Trip = 0-block finality (security-priority, immediate). Resume = 24-block
    // (false-resume risk dominant). Consume of a resume action before finality
    // would let an attacker actuate downstream effects from a still-reorgable
    // boundary.
    for inp in inputs {
        let action = inp[OFFSET_ACTION];
        if action == ACTION_RESUME {
            let inclusion =
                read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
            if tip.saturating_sub(inclusion) < lp.emergency_resume_finality_blocks {
                return Err(Error::ResumeNotYetFinal);
            }
        }
    }

    Ok(())
}

// ============ Layout ============

fn verify_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < CELL_DATA_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[OFFSET_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let action = data[OFFSET_ACTION];
    if action != ACTION_TRIP && action != ACTION_RESUME {
        return Err(Error::ActionDiscriminantUnknown);
    }
    let scope = data[OFFSET_SCOPE];
    if scope != SCOPE_GLOBAL && scope != SCOPE_PER_POOL && scope != SCOPE_PER_DOMAIN {
        return Err(Error::ScopeDiscriminantUnknown);
    }
    Ok(())
}

// ============ Breaker binding ============

/// Resolve the BreakerCell input and BreakerCell output that this action
/// gates. Both halves are required: the input proves the action is targeting
/// a live breaker in the correct state; the output proves the same-tx
/// transition reflects the action.
fn verify_breaker_binding(
    boundary_data: &[u8],
    breaker_in: &[u8],
    breaker_out: &[u8],
    action: u8,
) -> Result<(), Error> {
    if breaker_in.len() < BREAKER_CELL_LEN || breaker_out.len() < BREAKER_CELL_LEN {
        return Err(Error::BreakerCellMalformed);
    }

    let in_state = breaker_in[BREAKER_STATE_OFFSET];
    let out_state = breaker_out[BREAKER_STATE_OFFSET];

    // breaker_cell_outpoint is referenced material; the same-tx input is the
    // authoritative resolution. v1 binding is shape + state; v2 should walk
    // Source::Input outpoints and equality-match against boundary's
    // breaker_cell_outpoint bytes.
    // TODO: outpoint equality check against boundary_data[OFFSET_BREAKER_OUTPOINT..].
    let _boundary_outpoint =
        &boundary_data[OFFSET_BREAKER_OUTPOINT..OFFSET_BREAKER_OUTPOINT + BREAKER_OUTPOINT_LEN];

    // BreakerCell identity preserved across input/output (the breaker itself
    // enforces this; we double-check to fail fast on malformed witness).
    if breaker_in[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
        != breaker_out[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
    {
        return Err(Error::BreakerOutputIdMismatch);
    }

    match action {
        ACTION_TRIP => {
            // Trip is only legal against a Clear breaker. Already-tripped is
            // idempotent rejection (spec §2.6 failure mode).
            if in_state != BREAKER_STATE_CLEAR {
                return Err(Error::BreakerAlreadyTripped);
            }
            // Same-tx output must reflect Tripped.
            if out_state != BREAKER_STATE_TRIPPED {
                return Err(Error::BreakerOutputStateMismatch);
            }
            // Tripped output must have tripped_at_block populated; the
            // BreakerCell's own type-script enforces this, but failing fast
            // here surfaces the misuse before downstream cells inspect.
            let tripped_at = read_u64_le(
                &breaker_out[BREAKER_TRIPPED_AT_OFFSET..BREAKER_TRIPPED_AT_OFFSET + 8],
            );
            if tripped_at == 0 {
                return Err(Error::BreakerOutputStateMismatch);
            }
            // Trip path: attestation is OPTIONAL evidence. If presented, it
            // must meet the 3-attester floor and bind to the same breaker.
            if let Some(att) = find_attestation_cell_dep_optional()? {
                verify_attestation_breaker_match(&att, breaker_in)?;
                let signer_count = count_attestation_signers(&att)?;
                if signer_count < TRIP_ATTESTER_FLOOR {
                    return Err(Error::TripAttesterCountInsufficient);
                }
            }
        }
        ACTION_RESUME => {
            // Resume requires Tripped input + attestation present + unanimous.
            if in_state != BREAKER_STATE_TRIPPED {
                return Err(Error::BreakerNotTripped);
            }
            // Same-tx output must reflect Resuming (the BreakerCell triad's
            // Tripped -> Resuming transition; Resuming -> Clear is a separate
            // finalize tx outside this boundary's scope).
            if out_state != BREAKER_STATE_RESUMING {
                return Err(Error::BreakerOutputStateMismatch);
            }

            let att = find_attestation_cell_dep_required()?;
            verify_attestation_breaker_match(&att, breaker_in)?;
            let signer_count = count_attestation_signers(&att)?;

            // Unanimous = signer_count >= n_validators from the same-tx
            // ValidatorRegistry cell-dep. The BreakerCell.attestation_quorum
            // field is the in-cell floor; the registry's n_validators is the
            // unanimity reference.
            let registry = find_validator_registry_cell_dep()?;
            let n_validators = read_u16_le(
                &registry[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2],
            ) as u32;
            if signer_count < n_validators {
                return Err(Error::ResumeAttesterCountInsufficient);
            }

            // BreakerCell's own attestation_quorum is consulted as a sanity
            // floor; an unanimous-of-registry signing should always meet it,
            // but a mismatched registry+breaker pair would surface here.
            let breaker_quorum = read_u16_le(
                &breaker_in[BREAKER_QUORUM_OFFSET..BREAKER_QUORUM_OFFSET + 2],
            ) as u32;
            if signer_count < breaker_quorum {
                return Err(Error::ResumeAttesterCountInsufficient);
            }
        }
        _ => return Err(Error::ActionDiscriminantUnknown),
    }

    Ok(())
}

fn verify_attestation_breaker_match(att: &[u8], breaker: &[u8]) -> Result<(), Error> {
    if att.len() < ATT_MIN_LEN {
        return Err(Error::CellDataMalformed);
    }
    if att[ATT_OFFSET_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    if att[ATT_OFFSET_BREAKER_ID..ATT_OFFSET_BREAKER_ID + 32]
        != breaker[BREAKER_ID_OFFSET..BREAKER_ID_OFFSET + 32]
    {
        return Err(Error::AttestationBreakerIdMismatch);
    }
    Ok(())
}

fn count_attestation_signers(att: &[u8]) -> Result<u32, Error> {
    let bitmap_len =
        read_u16_le(&att[ATT_OFFSET_BITMAP_LEN..ATT_OFFSET_BITMAP_LEN + 2]) as usize;
    if att.len() < ATT_OFFSET_BITMAP + bitmap_len {
        return Err(Error::CellDataMalformed);
    }
    let bitmap = &att[ATT_OFFSET_BITMAP..ATT_OFFSET_BITMAP + bitmap_len];
    Ok(bitmap.iter().map(|b| b.count_ones()).sum())
}

// ============ Cell-dep / cross-source scans ============

fn find_breaker_cell(source: Source) -> Result<heapless::Vec<u8, BREAKER_BLOB_CAP>, Error> {
    // BreakerCell shape: 133 bytes, version 1.
    // TODO: code-hash match against circuit-breaker-cell-type-script with
    // RoleTag::Breaker (0x01) in args[0].
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(data) => {
                if data.len() >= BREAKER_CELL_LEN && data[BREAKER_VERSION_OFFSET] == SCHEMA_VERSION
                {
                    let mut buf: heapless::Vec<u8, BREAKER_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::BreakerCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn find_nci_score_cell_dep() -> Result<heapless::Vec<u8, NCI_BLOB_CAP>, Error> {
    // TODO: code-hash match against nci-score-cell-type-script.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() == NCI_CELL_DATA_LEN && data[NCI_OFFSET_VERSION] == SCHEMA_VERSION {
                    let mut buf: heapless::Vec<u8, NCI_BLOB_CAP> = heapless::Vec::new();
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::NciScoreCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn find_attestation_cell_dep_optional() -> Result<Option<heapless::Vec<u8, ATT_BLOB_CAP>>, Error> {
    match find_attestation_cell_dep_required() {
        Ok(v) => Ok(Some(v)),
        Err(Error::AttestationCellDepMissing) => Ok(None),
        Err(e) => Err(e),
    }
}

fn find_attestation_cell_dep_required() -> Result<heapless::Vec<u8, ATT_BLOB_CAP>, Error> {
    // BreakerAttestationCell shape: header + bitmap.
    // TODO: code-hash match against circuit-breaker-cell-type-script with
    // RoleTag::Attestation (0x02) in args[0].
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= ATT_MIN_LEN
                    && data[ATT_OFFSET_VERSION] == SCHEMA_VERSION
                    && data.len() != NCI_CELL_DATA_LEN
                    && data.len() != BREAKER_CELL_LEN
                {
                    let mut buf: heapless::Vec<u8, ATT_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::AttestationCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn find_validator_registry_cell_dep() -> Result<heapless::Vec<u8, REGISTRY_BLOB_CAP>, Error> {
    // TODO: code-hash match against validator-registry-cell-type-script.
    let min_len = REGISTRY_HEADER_LEN + REGISTRY_VALIDATOR_ENTRY_LEN;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= min_len && data[REGISTRY_OFFSET_VERSION] == SCHEMA_VERSION {
                    let n_validators = read_u16_le(
                        &data[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2],
                    ) as usize;
                    let expected =
                        REGISTRY_HEADER_LEN + n_validators * REGISTRY_VALIDATOR_ENTRY_LEN;
                    if data.len() >= expected && n_validators > 0 {
                        let mut buf: heapless::Vec<u8, REGISTRY_BLOB_CAP> = heapless::Vec::new();
                        if data.len() > buf.capacity() {
                            return Err(Error::CapacityExceeded);
                        }
                        for b in data.iter() {
                            buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                        }
                        return Ok(buf);
                    }
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::ValidatorRegistryCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    emergency_trip_score_threshold: u64,
    emergency_resume_score_threshold: u64,
    max_score_age_blocks: u64,
    emergency_resume_finality_blocks: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // TODO: code-hash match against deployed lawson binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
                    && data.len() > NCI_CELL_DATA_LEN
                    && data.len() != BREAKER_CELL_LEN
                {
                    let mut buf: heapless::Vec<u8, LAWSON_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        buf.push(*b).map_err(|_| Error::CapacityExceeded)?;
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::LawsonCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn parse_lawson_params(data: &[u8]) -> Result<LawsonParams, Error> {
    if data.len() < LAWSON_REGISTRY_HEADER_LEN {
        return Err(Error::LawsonCellDepMissing);
    }
    let count = read_u16_le(&data[1..3]) as usize;
    if count > LAWSON_MAX_CONSTANTS {
        return Err(Error::CapacityExceeded);
    }
    let expected = LAWSON_REGISTRY_HEADER_LEN + count * LAWSON_CONSTANT_ENTRY_LEN;
    if data.len() < expected {
        return Err(Error::LawsonCellDepMissing);
    }

    let emergency_trip_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_EMERGENCY_TRIP_SCORE_THRESHOLD)?;
    let emergency_resume_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_EMERGENCY_RESUME_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let emergency_resume_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_EMERGENCY_RESUME_FINALITY_BLOCKS)?;

    // Asymmetric invariant: resume threshold must exceed trip threshold per
    // spec §2.6 (false-resume after exploit costs more than false-trip).
    // If Lawson is misconfigured, we treat resume_below_trip as a malformed
    // registry rather than silently allowing it.
    if emergency_resume_score_threshold <= emergency_trip_score_threshold {
        return Err(Error::LawsonCellDepMissing);
    }

    Ok(LawsonParams {
        emergency_trip_score_threshold,
        emergency_resume_score_threshold,
        max_score_age_blocks,
        emergency_resume_finality_blocks,
    })
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == name {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > u64::MAX as u128 {
                return Err(Error::CapacityExceeded);
            }
            return Ok(v as u64);
        }
    }
    Err(Error::LawsonCellDepMissing)
}

// Suppress dead-code warnings for the type-hash-discrimination plumbing
// reserved for the v2 code-hash match.
#[allow(dead_code)]
fn _placeholder_typehash_use() {
    let _ = load_cell_type_hash;
}

// ============ Tip-height proxy ============

fn read_tip_height_proxy() -> Result<u64, Error> {
    // TODO: ckb-std load_header(Source::HeaderDep) for authoritative tip.
    Ok(u64::MAX / 2)
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

fn read_u32_le(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
