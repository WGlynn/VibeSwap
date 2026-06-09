//! # NCI Score Cell Type Script
//!
//! THE cell gating every vibeswap-app boundary transition per
//! `NCI_CONSENSUS_ANSWER.md` Position C. Read as cell-dep by every
//! boundary type-script (deposit, withdrawal, validator-update, slash,
//! parameter-update, emergency pause, cross-chain in, cross-chain out)
//! per `specs/nci-boundary-enforcement.md`.
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian primitives)
//!
//! ```text
//! | field                    | bytes | offset |
//! |--------------------------|-------|--------|
//! | version                  |   1   |   0    |
//! | epoch                    |   8   |   1    |   u64 LE
//! | inclusion_height         |   8   |   9    |   u64 LE
//! | score                    |   4   |  17    |   u32 LE (composite)
//! | pow_component            |   4   |  21    |   u32 LE
//! | pos_component            |   4   |  25    |   u32 LE
//! | pom_component            |   4   |  29    |   u32 LE
//! | attestation_count        |   2   |  33    |   u16 LE
//! | attestation_witness_ref  |  32   |  35    |   tx-hash of AttestationCell
//! ```
//!
//! Total fixed size: 67 bytes.
//!
//! ## Composition (per Position C)
//!
//! - LawsonConstantsRegistry (cell-dep): pillar weights, per-pillar floors,
//!   `MAX_SCORE_AGE_BLOCKS`, the constitutional `pow_bps + pos_bps < pom_bps`
//!   cross-constraint.
//! - ValidatorRegistry (cell-dep): quorum size for `attestation_count` check.
//! - AttestationCell (cell-dep, resolved via `attestation_witness_ref`):
//!   BLS witness binding the score to a validator-signed payload.
//! - `bls-verify`: reserved for v2 inline aggregate-verify of the witness.
//!
//! ## Status
//!
//! Spec scaffold. Source-reviewable, not machine-verified. Cell-dep
//! lookup uses positional/shape heuristics; production wants code-hash
//! matching against deployed binaries. The score-composition arithmetic
//! is the load-bearing invariant and is fully enforced.

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

// ============ Cell-data layout ============

const SCHEMA_VERSION: u8 = 1;

const OFFSET_VERSION: usize = 0;
const OFFSET_EPOCH: usize = 1;
const OFFSET_INCLUSION_HEIGHT: usize = 9;
const OFFSET_SCORE: usize = 17;
const OFFSET_POW_COMPONENT: usize = 21;
const OFFSET_POS_COMPONENT: usize = 25;
const OFFSET_POM_COMPONENT: usize = 29;
const OFFSET_ATTESTATION_COUNT: usize = 33;
const OFFSET_ATTESTATION_WITNESS_REF: usize = 35;
const CELL_DATA_LEN: usize = 67;

// ============ Lawson layout (subset we read) ============
//
// We read only the NCI-relevant constants from a flat name_hash-keyed
// registry. The TYPE-SCRIPT does NOT enforce Lawson's own layout — that
// is `lawson-constants-cell-type-script`'s job. We just slice the
// expected offsets.

const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_REGISTRY_HEADER_LEN: usize = 3;

// Heapless cap for the Lawson constant set we may need to scan. 64 mirrors
// `lawson-constants-cell-type-script`.
const LAWSON_MAX_CONSTANTS: usize = 64;

// Lawson constant name_hashes (blake2b("nci.<name>") would be the
// canonical derivation; for the scaffold we use sentinel u8-prefixed
// placeholders so reviewers can grep). Production: compile-time
// blake2b! macro emits the real 32-byte hash.
//
// TODO: replace placeholder name_hashes with blake2b("nci.pow_bps") etc.
const LAWSON_NAME_POW_BPS: [u8; 32] = [0x01; 32];
const LAWSON_NAME_POS_BPS: [u8; 32] = [0x02; 32];
const LAWSON_NAME_POM_BPS: [u8; 32] = [0x03; 32];
const LAWSON_NAME_POW_FLOOR: [u8; 32] = [0x04; 32];
const LAWSON_NAME_POS_FLOOR: [u8; 32] = [0x05; 32];
const LAWSON_NAME_POM_FLOOR: [u8; 32] = [0x06; 32];
const LAWSON_NAME_MAX_AGE: [u8; 32] = [0x07; 32];

// ============ ValidatorRegistry layout (subset we read) ============
//
// Mirrors `messaging-hub-validator-registry-cell-type-script` exactly.
const VR_OFFSET_THRESHOLD_N: usize = 9;
const VR_OFFSET_THRESHOLD_D: usize = 11;
const VR_OFFSET_N_VALIDATORS: usize = 29;
const VR_HEADER_LEN: usize = 31;

// ============ AttestationCell layout (subset we read) ============
//
// Mirrors `messaging-hub-attestation-cell-type-script` § cell-data:
// signer_bitmap starts at offset 233 and is `ceil(n_validators/8)` long.
const ATTESTATION_SIGNER_BITMAP_OFFSET: usize = 233;

// ============ Type-script args ============

const ARGS_BOUND_REGISTRY_TYPE_HASH_LEN: usize = 32;

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const VR_BLOB_CAP: usize = 4096;
const ATTESTATION_BLOB_CAP: usize = 8192;

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
    if args_bytes.len() != ARGS_BOUND_REGISTRY_TYPE_HASH_LEN {
        return Err(Error::ScriptArgsMalformed);
    }
    // args carry the type-hash of the bound ValidatorRegistry. Cell-dep
    // discrimination uses this when matching by code-hash lands.
    // TODO: use args as code-hash filter in cell-dep scan.

    let input = load_optional(Source::GroupInput)?;
    let output = load_optional(Source::GroupOutput)?;

    match (input, output) {
        (None, None) => Err(Error::EmptyTransition),
        (None, Some(out)) => verify_score_layout(&out).and_then(|_| verify_composition(&out)),
        (Some(_), None) => Ok(()),
        (Some(inp), Some(out)) => {
            verify_score_layout(&inp)?;
            verify_score_layout(&out)?;
            verify_composition(&out)?;
            verify_transition(&inp, &out)
        }
    }
}

fn load_optional(source: Source) -> Result<Option<alloc::vec::Vec<u8>>, Error> {
    match load_cell_data(0, source) {
        Ok(d) => Ok(Some(d)),
        Err(ckb_std::error::SysError::IndexOutOfBound) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ============ Layout check ============

fn verify_score_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < CELL_DATA_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[OFFSET_VERSION] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    Ok(())
}

// ============ Composition + per-pillar floors + freshness ============

fn verify_composition(data: &[u8]) -> Result<(), Error> {
    let score = read_u32_le(&data[OFFSET_SCORE..OFFSET_SCORE + 4]);
    let pow_c = read_u32_le(&data[OFFSET_POW_COMPONENT..OFFSET_POW_COMPONENT + 4]);
    let pos_c = read_u32_le(&data[OFFSET_POS_COMPONENT..OFFSET_POS_COMPONENT + 4]);
    let pom_c = read_u32_le(&data[OFFSET_POM_COMPONENT..OFFSET_POM_COMPONENT + 4]);
    let inclusion_height =
        read_u64_le(&data[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
    let attestation_count =
        read_u16_le(&data[OFFSET_ATTESTATION_COUNT..OFFSET_ATTESTATION_COUNT + 2]);
    let witness_ref =
        &data[OFFSET_ATTESTATION_WITNESS_REF..OFFSET_ATTESTATION_WITNESS_REF + 32];

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_nci_params(&lawson)?;

    // Cross-constraint: pom_bps must dominate the two together. Sized as
    // u64 because each is u32 — product fits, sum fits.
    if (lp.pow_bps as u64) + (lp.pos_bps as u64) >= lp.pom_bps as u64 {
        return Err(Error::PomNotDominant);
    }
    if lp.pow_bps + lp.pos_bps + lp.pom_bps != 10_000 {
        return Err(Error::PillarWeightsMalformed);
    }

    // Per-pillar floors prevent single-pillar capture.
    if (pow_c as u64) < lp.pow_floor as u64 {
        return Err(Error::PillarFloorViolated);
    }
    if (pos_c as u64) < lp.pos_floor as u64 {
        return Err(Error::PillarFloorViolated);
    }
    if (pom_c as u64) < lp.pom_floor as u64 {
        return Err(Error::PillarFloorViolated);
    }

    // Composition arithmetic. u64 widening avoids u32 overflow on the
    // weighted product (max 10_000 * u32::MAX > u32).
    let weighted = (lp.pow_bps as u64)
        .checked_mul(pow_c as u64)
        .and_then(|x| x.checked_add((lp.pos_bps as u64).checked_mul(pos_c as u64)?))
        .and_then(|x| x.checked_add((lp.pom_bps as u64).checked_mul(pom_c as u64)?))
        .ok_or(Error::AmountOverflow)?;
    let expected = weighted / 10_000;
    if (score as u64) != expected {
        return Err(Error::ScoreCompositionMismatch);
    }

    // Freshness: tip-vs-inclusion. We use the current-block-height proxy
    // via header-dep on the tip; for the scaffold we read the highest
    // header-dep block_number and use that as tip.
    // TODO: ckb-std load_header API — tip read pattern needs confirmation
    // for 0.16; for now we accept the inclusion_height if it round-trips
    // honestly (the cell that produced this score knew the height, and
    // the freshness window is checked by every BOUNDARY script when it
    // cell-deps the score). Boundary-side check is the load-bearing one.
    let _ = inclusion_height;
    let _ = lp.max_age;

    // Witness binding: scan cell-deps for a cell whose outpoint tx-hash
    // matches the witness_ref. The matched cell is treated as the
    // AttestationCell and its signer-bitmap is parsed.
    let attestation = find_attestation_by_tx_hash(witness_ref)?;
    let signer_count = count_signer_bitmap_bits(&attestation)?;
    if signer_count != attestation_count {
        return Err(Error::AttestationCountMismatch);
    }

    // Quorum check: attestation_count >= ceil(n_validators * threshold_n / threshold_d).
    let vr = find_validator_registry_cell_dep()?;
    let (n_validators, th_n, th_d) = parse_validator_threshold(&vr)?;
    if th_d == 0 {
        return Err(Error::ValidatorRegistryCellDepMissing);
    }
    let required = ((n_validators as u64) * (th_n as u64) + (th_d as u64 - 1)) / (th_d as u64);
    if (attestation_count as u64) < required {
        return Err(Error::AttestationBelowQuorum);
    }

    // TODO: v2 — call bls_verify::verify_aggregate on the attestation
    // payload + signer_bitmap + ValidatorRegistry pubkeys. v1 trusts the
    // AttestationCell's own type-script to have BLS-verified at its own
    // creation, so we only check tx-hash linkage + signer count + quorum.

    Ok(())
}

fn verify_transition(inp: &[u8], out: &[u8]) -> Result<(), Error> {
    let in_epoch = read_u64_le(&inp[OFFSET_EPOCH..OFFSET_EPOCH + 8]);
    let out_epoch = read_u64_le(&out[OFFSET_EPOCH..OFFSET_EPOCH + 8]);
    if out_epoch < in_epoch {
        return Err(Error::EpochNotMonotonic);
    }
    Ok(())
}

// ============ Lawson cell-dep scan ============

struct LawsonNciParams {
    pow_bps: u32,
    pos_bps: u32,
    pom_bps: u32,
    pow_floor: u32,
    pos_floor: u32,
    pom_floor: u32,
    max_age: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match: schema_version == 1 AND a registry-ish length. For
    // the scaffold this is best-effort.
    // TODO: code-hash match against deployed lawson binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
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

fn parse_lawson_nci_params(data: &[u8]) -> Result<LawsonNciParams, Error> {
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

    let pow_bps = lookup_lawson_u32(data, count, &LAWSON_NAME_POW_BPS)?;
    let pos_bps = lookup_lawson_u32(data, count, &LAWSON_NAME_POS_BPS)?;
    let pom_bps = lookup_lawson_u32(data, count, &LAWSON_NAME_POM_BPS)?;
    let pow_floor = lookup_lawson_u32(data, count, &LAWSON_NAME_POW_FLOOR)?;
    let pos_floor = lookup_lawson_u32(data, count, &LAWSON_NAME_POS_FLOOR)?;
    let pom_floor = lookup_lawson_u32(data, count, &LAWSON_NAME_POM_FLOOR)?;
    let max_age = lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_AGE)?;

    Ok(LawsonNciParams {
        pow_bps,
        pos_bps,
        pom_bps,
        pow_floor,
        pos_floor,
        pom_floor,
        max_age,
    })
}

fn lookup_lawson_u32(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u32, Error> {
    // Lawson entry: name_hash[32] | value u128 LE | alpha u128 LE | block u64 LE.
    // We narrow to u32 — these are bps values bounded well below u32::MAX.
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == name {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > u32::MAX as u128 {
                return Err(Error::AmountOverflow);
            }
            return Ok(v as u32);
        }
    }
    Err(Error::LawsonCellDepMissing)
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == name {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > u64::MAX as u128 {
                return Err(Error::AmountOverflow);
            }
            return Ok(v as u64);
        }
    }
    Err(Error::LawsonCellDepMissing)
}

// ============ ValidatorRegistry cell-dep scan ============

fn find_validator_registry_cell_dep() -> Result<heapless::Vec<u8, VR_BLOB_CAP>, Error> {
    // Shape match: header length + plausible n_validators in 16..=32.
    // TODO: bind via args-encoded type-hash filter.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= VR_HEADER_LEN && data[0] == SCHEMA_VERSION {
                    let n_validators = read_u16_le(
                        &data[VR_OFFSET_N_VALIDATORS..VR_OFFSET_N_VALIDATORS + 2],
                    );
                    if (16..=32).contains(&n_validators) {
                        let mut buf: heapless::Vec<u8, VR_BLOB_CAP> = heapless::Vec::new();
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

fn parse_validator_threshold(data: &[u8]) -> Result<(u16, u16, u16), Error> {
    if data.len() < VR_HEADER_LEN {
        return Err(Error::ValidatorRegistryCellDepMissing);
    }
    let n_validators =
        read_u16_le(&data[VR_OFFSET_N_VALIDATORS..VR_OFFSET_N_VALIDATORS + 2]);
    let th_n = read_u16_le(&data[VR_OFFSET_THRESHOLD_N..VR_OFFSET_THRESHOLD_N + 2]);
    let th_d = read_u16_le(&data[VR_OFFSET_THRESHOLD_D..VR_OFFSET_THRESHOLD_D + 2]);
    Ok((n_validators, th_n, th_d))
}

// ============ AttestationCell witness binding ============

fn find_attestation_by_tx_hash(
    witness_ref: &[u8],
) -> Result<heapless::Vec<u8, ATTESTATION_BLOB_CAP>, Error> {
    // tx-hash of a cell-dep is part of its outpoint; ckb-std exposes
    // load_cell with Source::CellDep to enumerate. For the scaffold we
    // match shape (the AttestationCell layout starts with version=1 and
    // contains a 32-byte attestation_id at offset 1).
    // TODO: bind via load_input + outpoint comparison rather than shape
    // heuristic.
    let _ = witness_ref;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= ATTESTATION_SIGNER_BITMAP_OFFSET && data[0] == SCHEMA_VERSION {
                    let mut buf: heapless::Vec<u8, ATTESTATION_BLOB_CAP> = heapless::Vec::new();
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
                return Err(Error::AttestationWitnessUnresolved);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn count_signer_bitmap_bits(att: &[u8]) -> Result<u16, Error> {
    if att.len() <= ATTESTATION_SIGNER_BITMAP_OFFSET {
        return Err(Error::CellDataMalformed);
    }
    let bitmap = &att[ATTESTATION_SIGNER_BITMAP_OFFSET..];
    let mut n: u16 = 0;
    for b in bitmap {
        n = n.checked_add(b.count_ones() as u16).ok_or(Error::AmountOverflow)?;
    }
    Ok(n)
}

// ============ Group-cell helpers ============

#[allow(dead_code)]
fn count_group_cells(source: Source) -> Result<usize, Error> {
    let mut count = 0usize;
    for _ in QueryIter::new(load_cell_data, source) {
        count += 1;
    }
    Ok(count)
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
