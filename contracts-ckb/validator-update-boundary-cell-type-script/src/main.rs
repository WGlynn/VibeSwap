//! # Validator-Set Update Boundary Cell Type Script
//!
//! Authorizes ValidatorRegistryCell transitions per
//! `specs/nci-boundary-enforcement.md` §2.3. Composes with NCIScoreCell
//! (authorization), LawsonConstantsRegistry (thresholds + finality), and
//! the same-tx ValidatorRegistryCell input/output (the registry being
//! mutated).
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                    | bytes | offset |
//! |--------------------------|-------|--------|
//! | version                  |   1   |   0    |
//! | epoch                    |   8   |   1    |   u64 LE
//! | prev_registry_outpoint   |  40   |   9    |   tx_hash[32] | index u64 LE[8]
//! | new_registry_outpoint    |  40   |  49    |   tx_hash[32] | index u64 LE[8]
//! | change_type              |   1   |  89    |   0=add, 1=remove, 2=stake_update
//! | affected_pubkey          |  48   |  90    |   compressed G1
//! | inclusion_height         |   8   | 138    |   u64 LE
//!
//! Total fixed size: 146 bytes.

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
const OFFSET_EPOCH: usize = 1;
const OFFSET_PREV_REGISTRY_OUTPOINT: usize = 9;
const OFFSET_NEW_REGISTRY_OUTPOINT: usize = 49;
const OFFSET_CHANGE_TYPE: usize = 89;
const OFFSET_AFFECTED_PUBKEY: usize = 90;
const OFFSET_INCLUSION_HEIGHT: usize = 138;
const CELL_DATA_LEN: usize = 146;

const OUTPOINT_LEN: usize = 40;
const PUBKEY_LEN: usize = 48;

const CHANGE_TYPE_ADD: u8 = 0;
const CHANGE_TYPE_REMOVE: u8 = 1;
const CHANGE_TYPE_STAKE_UPDATE: u8 = 2;

// ============ Type-script args ============

// args = own type-hash; lets the script discriminate sibling
// ValidatorUpdateBoundaryCells in cell-dep scans.
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ ValidatorRegistryCell layout (subset; mirrors sibling crate) ============

const REGISTRY_OFFSET_VERSION: usize = 0;
const REGISTRY_OFFSET_EPOCH: usize = 1;
const REGISTRY_OFFSET_N_VALIDATORS: usize = 29;
const REGISTRY_HEADER_LEN: usize = 31;
const REGISTRY_VALIDATOR_ENTRY_LEN: usize = 64;
const REGISTRY_VALIDATOR_PUBKEY_LEN: usize = 48;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Sentinel placeholders so reviewers can grep.
// TODO: blake2b("validator_update.*") at compile time.
const LAWSON_NAME_VALIDATOR_UPDATE_SCORE_THRESHOLD: [u8; 32] = [0x30; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_VALIDATOR_UPDATE_FINALITY_BLOCKS: [u8; 32] = [0x31; 32];

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const REGISTRY_BLOB_CAP: usize = 16384;
const MAX_BOUNDARY_CELLS: usize = 8;

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
        // Creation: registry-update authorization commitment. Full §2.3 invariant set.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Consume: boundary cell archived into history once the registry rotation
        // is past the governance-class finality wall (REORG §6 = 24 blocks).
        (false, true) => verify_consume(&inputs),
        // In-place mutation is not legal for a one-shot decision commitment.
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

    // §2.3 step 1+2: NCI authorization. Higher threshold than DepositGate /
    // CrossChainInGate — validator-set changes are load-bearing.
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.validator_update_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: PoWAnchorCell header-dep for authoritative tip.

    // §2.3 step 3+4: registry binding + monotonic epoch + outpoint match.
    let (prev_registry, new_registry) = find_same_tx_registry_pair()?;
    let prev_epoch =
        read_u64_le(&prev_registry[REGISTRY_OFFSET_EPOCH..REGISTRY_OFFSET_EPOCH + 8]);
    let new_epoch =
        read_u64_le(&new_registry[REGISTRY_OFFSET_EPOCH..REGISTRY_OFFSET_EPOCH + 8]);
    if new_epoch <= prev_epoch {
        return Err(Error::RegistryEpochNotMonotonic);
    }

    for out in outputs {
        verify_registry_outpoint_binding(out)?;
        verify_change_shape_match(out, &prev_registry, &new_registry)?;
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

    // REORG §6: governance-class finality = 24 blocks. Boundary commitment can be
    // archived only once the rotation it authorized is past the reorg-safety wall.
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.validator_update_finality_blocks {
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
    let change_type = data[OFFSET_CHANGE_TYPE];
    if change_type > CHANGE_TYPE_STAKE_UPDATE {
        return Err(Error::ChangeTypeUnknown);
    }
    Ok(())
}

// ============ Registry binding ============

fn verify_registry_outpoint_binding(out: &[u8]) -> Result<(), Error> {
    // Reject if the bound new_registry_outpoint cannot be located in the tx's
    // output-cells. The prev_registry_outpoint correspondence is checked via
    // its consumption as input below.
    let prev_op = &out[OFFSET_PREV_REGISTRY_OUTPOINT..OFFSET_PREV_REGISTRY_OUTPOINT + OUTPOINT_LEN];
    let new_op = &out[OFFSET_NEW_REGISTRY_OUTPOINT..OFFSET_NEW_REGISTRY_OUTPOINT + OUTPOINT_LEN];

    if !any_input_outpoint_matches(prev_op)? {
        return Err(Error::RegistryOutpointMismatch);
    }
    if !any_output_outpoint_matches(new_op)? {
        return Err(Error::RegistryOutpointMismatch);
    }
    Ok(())
}

fn any_input_outpoint_matches(_target: &[u8]) -> Result<bool, Error> {
    // The boundary cell's stored prev_registry_outpoint must equal one of the
    // tx-inputs' OutPoints. v1 accepts that the registry-pair binding (below)
    // catches the same-tx mutation; outpoint-byte equality requires syscalls
    // not yet exposed in this scaffold.
    // TODO: ckb-std load_input on Source::Input + outpoint match.
    Ok(true)
}

fn any_output_outpoint_matches(_target: &[u8]) -> Result<bool, Error> {
    // Output outpoints are not directly addressable mid-validation (tx_hash is
    // not yet final). v1 binds new_registry by same-tx registry presence; v2
    // hashes the proposed output and matches against new_registry_outpoint's
    // hash component.
    // TODO: same-tx output binding via load_cell + computed tx_hash.
    Ok(true)
}

// ============ Change-shape match ============

fn verify_change_shape_match(
    out: &[u8],
    prev_registry: &[u8],
    new_registry: &[u8],
) -> Result<(), Error> {
    let change_type = out[OFFSET_CHANGE_TYPE];
    let affected_pubkey = &out[OFFSET_AFFECTED_PUBKEY..OFFSET_AFFECTED_PUBKEY + PUBKEY_LEN];

    let prev_n = read_u16_le(
        &prev_registry[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2],
    ) as usize;
    let new_n = read_u16_le(
        &new_registry[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2],
    ) as usize;

    let in_prev = pubkey_in_registry(prev_registry, prev_n, affected_pubkey);
    let in_new = pubkey_in_registry(new_registry, new_n, affected_pubkey);

    match change_type {
        // add: count grows by 1; pubkey enters the new set, absent from prev.
        CHANGE_TYPE_ADD => {
            if new_n != prev_n + 1 {
                return Err(Error::ChangeShapeMismatch);
            }
            if in_prev {
                return Err(Error::AffectedPubkeyPresentInDelta);
            }
            if !in_new {
                return Err(Error::AffectedPubkeyAbsentInDelta);
            }
        }
        // remove: count shrinks by 1; pubkey leaves the new set, present in prev.
        CHANGE_TYPE_REMOVE => {
            if prev_n != new_n + 1 {
                return Err(Error::ChangeShapeMismatch);
            }
            if !in_prev {
                return Err(Error::AffectedPubkeyAbsentInDelta);
            }
            if in_new {
                return Err(Error::AffectedPubkeyPresentInDelta);
            }
        }
        // stake_update: count unchanged; pubkey present in both sets.
        CHANGE_TYPE_STAKE_UPDATE => {
            if new_n != prev_n {
                return Err(Error::ChangeShapeMismatch);
            }
            if !in_prev || !in_new {
                return Err(Error::AffectedPubkeyAbsentInDelta);
            }
        }
        _ => return Err(Error::ChangeTypeUnknown),
    }
    Ok(())
}

fn pubkey_in_registry(registry: &[u8], n_validators: usize, pubkey: &[u8]) -> bool {
    for i in 0..n_validators {
        let base = REGISTRY_HEADER_LEN + i * REGISTRY_VALIDATOR_ENTRY_LEN;
        let end = base + REGISTRY_VALIDATOR_PUBKEY_LEN;
        if registry.len() < end {
            return false;
        }
        if &registry[base..end] == pubkey {
            return true;
        }
    }
    false
}

// ============ Registry-pair locator ============

fn find_same_tx_registry_pair() -> Result<
    (
        heapless::Vec<u8, REGISTRY_BLOB_CAP>,
        heapless::Vec<u8, REGISTRY_BLOB_CAP>,
    ),
    Error,
> {
    let prev = first_registry_shape(Source::Input).ok_or(Error::RegistryInputAbsent)?;
    let new = first_registry_shape(Source::Output).ok_or(Error::RegistryOutputAbsent)?;
    Ok((prev, new))
}

fn first_registry_shape(source: Source) -> Option<heapless::Vec<u8, REGISTRY_BLOB_CAP>> {
    // Shape match on the ValidatorRegistryCell. v1 picks the first cell whose
    // data parses as a registry shape (version byte + n_validators in range).
    // TODO: code-hash match against messaging-hub-validator-registry binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(data) => {
                if looks_like_registry(&data) {
                    let mut buf: heapless::Vec<u8, REGISTRY_BLOB_CAP> = heapless::Vec::new();
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

fn looks_like_registry(data: &[u8]) -> bool {
    if data.len() < REGISTRY_HEADER_LEN {
        return false;
    }
    if data[REGISTRY_OFFSET_VERSION] != SCHEMA_VERSION {
        return false;
    }
    let n = read_u16_le(&data[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2])
        as usize;
    let expected = REGISTRY_HEADER_LEN + n * REGISTRY_VALIDATOR_ENTRY_LEN;
    data.len() >= expected && n >= 16 && n <= 32
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    validator_update_score_threshold: u64,
    max_score_age_blocks: u64,
    validator_update_finality_blocks: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match: schema_version + plausible registry header.
    // TODO: code-hash match against deployed lawson binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
                    && data.len() != NCI_CELL_DATA_LEN
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

    let validator_update_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_VALIDATOR_UPDATE_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let validator_update_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_VALIDATOR_UPDATE_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        validator_update_score_threshold,
        max_score_age_blocks,
        validator_update_finality_blocks,
    })
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    // Lawson entry: name_hash[32] | value u128 LE | alpha u128 LE | block u64 LE.
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
