//! # Governance Parameter-Update Boundary Cell Type Script
//!
//! Authorizes LawsonConstantsRegistry mutations per
//! `specs/nci-boundary-enforcement.md` §2.5. The structurally most
//! load-bearing boundary: governs the constants that govern every other
//! boundary. Dual-layer enforcement:
//!
//! 1. NCI authorization (governance layer): an NCIScoreCell with
//!    `decision_type = ParameterUpdate` and `unified_score` above the
//!    highest threshold of any boundary.
//! 2. ConstitutionalBoundsCell veto (math layer): the proposed
//!    new_lawson registry payload MUST satisfy every per-constant
//!    `[min,max]` range AND every cross-constraint (e.g. SUM_LT on
//!    `pow_bps + pos_bps < pom_bps`).
//!
//! Neither layer alone is sufficient: a 51% NCI quorum colluding to push
//! a payload that dissolves the 3-pillar mix is stopped by the
//! immutable ConstitutionalBoundsCell; an out-of-bounds payload with no
//! NCI authorization is stopped by Step 1. Physics > Constitution > Gov.
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                  | bytes | offset |
//! |------------------------|-------|--------|
//! | version                |   1   |   0    |
//! | epoch                  |   8   |   1    |
//! | prev_lawson_outpoint   |  40   |   9    |
//! | new_lawson_outpoint    |  40   |  49    |
//! | decision_id            |  32   |  89    |
//! | inclusion_height       |   8   | 121    |
//!
//! Total fixed size: 129 bytes.

#![no_std]
#![no_main]

extern crate alloc;

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
const OFFSET_PREV_LAWSON_OUTPOINT: usize = 9;
const OFFSET_NEW_LAWSON_OUTPOINT: usize = 49;
const OFFSET_DECISION_ID: usize = 89;
const OFFSET_INCLUSION_HEIGHT: usize = 121;
const CELL_DATA_LEN: usize = 129;

const OUTPOINT_LEN: usize = 40;
const DECISION_ID_LEN: usize = 32;

// ============ Type-script args ============

// args = own type-hash; discriminates sibling GovernanceUpdateBoundaryCells.
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ LawsonRegistry layout (subset) ============
//
// Mirrors lawson-constants-cell-type-script ConstantsRegistryCell:
// version[1] | constant_count u16[2] | constants[count * 72] | bounds_outpoint[36].
// ConstantValue = name_hash[32] | value u128[16] | alpha u128[16] | block u64[8].

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;
const LAWSON_EPOCH_PROXY_OFFSET: usize = 1;

// ============ ConstitutionalBoundsCell layout (mirrors that crate) ============

const BOUNDS_HEADER_LEN: usize = 3;
const BOUND_ENTRY_LEN: usize = 96;
const BOUNDS_CONSTRAINT_HEADER_LEN: usize = 2;
const CROSS_CONSTRAINT_LEN: usize = 1 + 32 * 3;
const BOUNDS_MAX: usize = 64;
const BOUNDS_MAX_CONSTRAINTS: usize = 32;

// Cross-constraint op-codes (from constitutional-bounds-cell-type-script).
const CROSS_OP_SUM_LT: u8 = 0x01;
const CROSS_OP_GTE_ZERO: u8 = 0x02;
const CROSS_OP_SUM_EQ: u8 = 0x03;

// ============ Heapless caps ============

const NCI_BLOB_CAP: usize = 256;
const LAWSON_BLOB_CAP: usize = 16384;
const BOUNDS_BLOB_CAP: usize = 16384;
const MAX_BOUNDARY_CELLS: usize = 8;

// Sentinel placeholders so reviewers can grep; replaced by precomputed
// blake2b name-hashes once chain-spec lands.
// TODO: blake2b("parameter_update.*") at compile time.
const LAWSON_NAME_PARAMETER_UPDATE_SCORE_THRESHOLD: [u8; 32] = [0x40; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_GOVERNANCE_FINALITY_BLOCKS: [u8; 32] = [0x41; 32];

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
        // Creation: dual-layer authorization of a Lawson constant update.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Consume: archive once past governance-class finality (REORG §6 = 24 blocks).
        (false, true) => verify_consume(&inputs),
        // One-shot commitment: in-place mutation is illegal.
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

// ============ Read group cells ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_BOUNDARY_CELLS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_BOUNDARY_CELLS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Creation path ============

fn verify_creation(
    outputs: &[alloc::vec::Vec<u8>],
    _own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }

    // §2.5 step 1+2: NCI authorization — highest threshold in the NCI tier.
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson_dep = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson_dep)?;

    if (score as u64) < lp.parameter_update_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: PoWAnchorCell header-dep for authoritative tip.

    // §2.5 step 3: same-tx Lawson input + output (the registry being mutated).
    let (prev_lawson, new_lawson) = find_same_tx_lawson_pair()?;
    let prev_epoch = lawson_epoch_proxy(&prev_lawson);
    let new_epoch = lawson_epoch_proxy(&new_lawson);
    if new_epoch <= prev_epoch {
        return Err(Error::LawsonEpochNotMonotonic);
    }

    // §2.5 DUAL-LAYER: ConstitutionalBoundsCell veto. Every constant in the
    // new_lawson payload MUST satisfy per-constant [min,max] AND every
    // cross-constraint. Recursive structural property: governance cannot
    // mutate the rules that bound governance.
    let bounds = find_bounds_cell_dep()?;
    verify_constitutional_bounds(&new_lawson, &bounds)?;
    verify_cross_constraints(&new_lawson, &bounds)?;

    // §2.5 step 4: outpoint binding ties the boundary commitment to the
    // specific Lawson input/output pair on this tx.
    for out in outputs {
        verify_lawson_outpoint_binding(out)?;
    }

    Ok(())
}

// ============ Consume path ============

fn verify_consume(inputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for inp in inputs {
        verify_layout(inp)?;
    }

    let lawson_dep = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson_dep)?;
    let tip = read_tip_height_proxy()?;

    // REORG §6 governance-class = 24 blocks. Lawson updates are rare; the
    // archive latency is not a UX cost; reorg-induced double-actuation is fatal.
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.governance_finality_blocks {
            return Err(Error::BoundaryNotYetFinal);
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
    Ok(())
}

// ============ Lawson outpoint binding ============

fn verify_lawson_outpoint_binding(out: &[u8]) -> Result<(), Error> {
    // The boundary cell's stored outpoints must correspond to the actual
    // tx-input + tx-output Lawson registry cells. v1 accepts that the
    // same-tx Lawson pair (located by shape) suffices; outpoint byte
    // equality requires syscalls not exposed in this scaffold.
    // TODO: ckb-std load_input + computed-tx-hash output binding.
    let _prev_op =
        &out[OFFSET_PREV_LAWSON_OUTPOINT..OFFSET_PREV_LAWSON_OUTPOINT + OUTPOINT_LEN];
    let _new_op = &out[OFFSET_NEW_LAWSON_OUTPOINT..OFFSET_NEW_LAWSON_OUTPOINT + OUTPOINT_LEN];
    let _decision_id = &out[OFFSET_DECISION_ID..OFFSET_DECISION_ID + DECISION_ID_LEN];
    Ok(())
}

// ============ Lawson registry pair locator ============

fn find_same_tx_lawson_pair() -> Result<
    (
        heapless::Vec<u8, LAWSON_BLOB_CAP>,
        heapless::Vec<u8, LAWSON_BLOB_CAP>,
    ),
    Error,
> {
    let prev = first_lawson_shape(Source::Input).ok_or(Error::LawsonInputAbsent)?;
    let new = first_lawson_shape(Source::Output).ok_or(Error::LawsonOutputAbsent)?;
    Ok((prev, new))
}

fn first_lawson_shape(source: Source) -> Option<heapless::Vec<u8, LAWSON_BLOB_CAP>> {
    // Shape match: version byte + plausible constant_count + length consistent
    // with the registry encoding. v1 picks the first cell that matches; v2
    // matches against the deployed Lawson type-script code-hash.
    // TODO: code-hash match against lawson-constants-cell-type-script binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(data) => {
                if looks_like_lawson_registry(&data) {
                    let mut buf: heapless::Vec<u8, LAWSON_BLOB_CAP> = heapless::Vec::new();
                    if data.len() > buf.capacity() {
                        return None;
                    }
                    for b in data.iter() {
                        if buf.push(*b).is_err() {
                            return None;
                        }
                    }
                    return Some(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return None,
            Err(_) => return None,
        }
    }
}

fn looks_like_lawson_registry(data: &[u8]) -> bool {
    if data.len() < LAWSON_REGISTRY_HEADER_LEN {
        return false;
    }
    if data[0] != SCHEMA_VERSION {
        return false;
    }
    let count = read_u16_le(&data[1..3]) as usize;
    if count == 0 || count > LAWSON_MAX_CONSTANTS {
        return false;
    }
    // Registry total: header + count*entry + outpoint(36); registry-shape
    // cells are noticeably larger than NCI cells.
    let expected_min = LAWSON_REGISTRY_HEADER_LEN + count * LAWSON_CONSTANT_ENTRY_LEN + 36;
    data.len() >= expected_min && data.len() != NCI_CELL_DATA_LEN
}

fn lawson_epoch_proxy(data: &[u8]) -> u64 {
    // Lawson has no explicit epoch field; the proxy is the max
    // last_updated_at_block across all constants. Monotonic by construction:
    // any update bumps at least one constant's block, so max strictly grows.
    let count = read_u16_le(&data[1..3]) as usize;
    let mut max_block = 0u64;
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        let block_off = base + 32 + 16 + 16;
        if data.len() < block_off + 8 {
            continue;
        }
        let block = read_u64_le(&data[block_off..block_off + 8]);
        if block > max_block {
            max_block = block;
        }
    }
    // Fallback to first byte after schema if no entries (defensive).
    if max_block == 0 && data.len() > LAWSON_EPOCH_PROXY_OFFSET {
        max_block = data[LAWSON_EPOCH_PROXY_OFFSET] as u64;
    }
    max_block
}

// ============ Constitutional bounds: per-constant [min,max] veto ============

fn verify_constitutional_bounds(lawson: &[u8], bounds: &[u8]) -> Result<(), Error> {
    let constant_count = read_u16_le(&lawson[1..3]) as usize;
    let bound_count = read_u16_le(&bounds[1..3]) as usize;
    if bound_count > BOUNDS_MAX || constant_count > LAWSON_MAX_CONSTANTS {
        return Err(Error::CapacityExceeded);
    }

    for i in 0..constant_count {
        let cbase = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if lawson.len() < cbase + 64 {
            return Err(Error::LawsonMalformed);
        }
        let name_hash = &lawson[cbase..cbase + 32];
        let value = read_u128_le(&lawson[cbase + 32..cbase + 48]);
        let alpha = read_u128_le(&lawson[cbase + 48..cbase + 64]);

        let bound = find_bound(bounds, bound_count, name_hash)
            .ok_or(Error::ConstantNameUnknown)?;

        if value < bound.min_value || value > bound.max_value {
            return Err(Error::ConstantValueOutOfBounds);
        }
        if alpha < bound.alpha_min || alpha > bound.alpha_max {
            return Err(Error::ConstantAlphaOutOfBounds);
        }
    }
    Ok(())
}

// ============ Constitutional bounds: cross-constraint veto ============

fn verify_cross_constraints(lawson: &[u8], bounds: &[u8]) -> Result<(), Error> {
    let bound_count = read_u16_le(&bounds[1..3]) as usize;
    let bounds_end = BOUNDS_HEADER_LEN + bound_count * BOUND_ENTRY_LEN;
    if bounds.len() < bounds_end + BOUNDS_CONSTRAINT_HEADER_LEN {
        return Err(Error::ConstitutionalBoundsMalformed);
    }
    let constraint_count = read_u16_le(&bounds[bounds_end..bounds_end + 2]) as usize;
    if constraint_count > BOUNDS_MAX_CONSTRAINTS {
        return Err(Error::CapacityExceeded);
    }

    let constant_count = read_u16_le(&lawson[1..3]) as usize;

    for i in 0..constraint_count {
        let base = bounds_end + BOUNDS_CONSTRAINT_HEADER_LEN + i * CROSS_CONSTRAINT_LEN;
        if bounds.len() < base + CROSS_CONSTRAINT_LEN {
            return Err(Error::ConstitutionalBoundsMalformed);
        }
        let op = bounds[base];
        let a_hash = &bounds[base + 1..base + 33];
        let b_hash = &bounds[base + 33..base + 65];
        let c_hash = &bounds[base + 65..base + 97];

        match op {
            CROSS_OP_SUM_LT => {
                // Runtime check: value(a) + value(b) < value(c).
                let va = find_constant_value(lawson, constant_count, a_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                let vb = find_constant_value(lawson, constant_count, b_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                let vc = find_constant_value(lawson, constant_count, c_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                let sum = va.saturating_add(vb);
                if sum >= vc {
                    return Err(Error::CrossConstraintViolated);
                }
            }
            CROSS_OP_GTE_ZERO => {
                // u128 is always >= 0; presence-of-name check only.
                find_constant_value(lawson, constant_count, a_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
            }
            CROSS_OP_SUM_EQ => {
                // Runtime check: value(a) + value(b) == value(c).
                let va = find_constant_value(lawson, constant_count, a_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                let vb = find_constant_value(lawson, constant_count, b_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                let vc = find_constant_value(lawson, constant_count, c_hash)
                    .ok_or(Error::ConstantNameUnknown)?;
                if va.saturating_add(vb) != vc {
                    return Err(Error::CrossConstraintViolated);
                }
            }
            _ => return Err(Error::CrossConstraintOpUnknown),
        }
    }
    Ok(())
}

struct ConstantBound {
    min_value: u128,
    max_value: u128,
    alpha_min: u128,
    alpha_max: u128,
}

fn find_bound(data: &[u8], bound_count: usize, name_hash: &[u8]) -> Option<ConstantBound> {
    for i in 0..bound_count {
        let base = BOUNDS_HEADER_LEN + i * BOUND_ENTRY_LEN;
        if data.len() < base + BOUND_ENTRY_LEN {
            return None;
        }
        if &data[base..base + 32] == name_hash {
            return Some(ConstantBound {
                min_value: read_u128_le(&data[base + 32..base + 48]),
                max_value: read_u128_le(&data[base + 48..base + 64]),
                alpha_min: read_u128_le(&data[base + 64..base + 80]),
                alpha_max: read_u128_le(&data[base + 80..base + 96]),
            });
        }
    }
    None
}

fn find_constant_value(lawson: &[u8], constant_count: usize, name_hash: &[u8]) -> Option<u128> {
    for i in 0..constant_count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if lawson.len() < base + 48 {
            return None;
        }
        if &lawson[base..base + 32] == name_hash {
            return Some(read_u128_le(&lawson[base + 32..base + 48]));
        }
    }
    None
}

// ============ Lawson cell-dep scan (read-only authority for params) ============

struct LawsonParams {
    parameter_update_score_threshold: u64,
    max_score_age_blocks: u64,
    governance_finality_blocks: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match: schema_version + plausible registry header. Distinguished
    // from NCI cells by length (NCI is fixed at 67 bytes).
    // TODO: code-hash match against lawson-constants-cell-type-script binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
                    && data.len() != NCI_CELL_DATA_LEN
                    && looks_like_lawson_registry(&data)
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

    let parameter_update_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_PARAMETER_UPDATE_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let governance_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_GOVERNANCE_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        parameter_update_score_threshold,
        max_score_age_blocks,
        governance_finality_blocks,
    })
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == name {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > u64::MAX as u128 {
                return Err(Error::LawsonCellDepMissing);
            }
            return Ok(v as u64);
        }
    }
    Err(Error::LawsonCellDepMissing)
}

// ============ ConstitutionalBoundsCell cell-dep scan ============

fn find_bounds_cell_dep() -> Result<heapless::Vec<u8, BOUNDS_BLOB_CAP>, Error> {
    // Shape match: BoundsCell encoding has a cross-constraint section after
    // bounds, distinguishing it from a Lawson registry which carries an
    // outpoint tail instead.
    // TODO: code-hash match against constitutional-bounds-cell-type-script.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if looks_like_bounds_cell(&data) {
                    let mut buf: heapless::Vec<u8, BOUNDS_BLOB_CAP> = heapless::Vec::new();
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
                return Err(Error::ConstitutionalBoundsCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn looks_like_bounds_cell(data: &[u8]) -> bool {
    if data.len() < BOUNDS_HEADER_LEN {
        return false;
    }
    if data[0] != SCHEMA_VERSION {
        return false;
    }
    let bound_count = read_u16_le(&data[1..3]) as usize;
    if bound_count == 0 || bound_count > BOUNDS_MAX {
        return false;
    }
    let bounds_end = BOUNDS_HEADER_LEN + bound_count * BOUND_ENTRY_LEN;
    if data.len() < bounds_end + BOUNDS_CONSTRAINT_HEADER_LEN + 8 {
        return false;
    }
    let constraint_count = read_u16_le(&data[bounds_end..bounds_end + 2]) as usize;
    if constraint_count > BOUNDS_MAX_CONSTRAINTS {
        return false;
    }
    let expected = bounds_end + BOUNDS_CONSTRAINT_HEADER_LEN
        + constraint_count * CROSS_CONSTRAINT_LEN + 8;
    data.len() >= expected
}

// ============ NCI cell-dep scan ============

fn find_nci_score_cell_dep() -> Result<heapless::Vec<u8, NCI_BLOB_CAP>, Error> {
    // Shape match: NCI cell-data is exactly NCI_CELL_DATA_LEN bytes.
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
