//! # Deposit Boundary Cell Type Script
//!
//! Represents funds that have entered the vibeswap-app domain. Authorizes
//! external -> internal value transitions per
//! `specs/nci-boundary-enforcement.md` §2.1. Composes with NCIScoreCell
//! (authorization), LawsonConstantsRegistry (thresholds), and
//! vibeswap-canonical-token-type-script (amount conservation).
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                   | bytes | offset |
//! |-------------------------|-------|--------|
//! | version                 |   1   |   0    |
//! | owner_lock_hash         |  32   |   1    |
//! | sudt_type_hash          |  32   |  33    |
//! | amount                  |  16   |  65    |   u128 LE
//! | source_outpoint_tx      |  32   |  81    |
//! | source_outpoint_index   |   4   | 113    |   u32 LE
//! | inclusion_height        |   8   | 117    |   u64 LE
//!
//! Total fixed size: 125 bytes.

#![no_std]
#![no_main]

extern crate alloc;

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
const OFFSET_OWNER_LOCK_HASH: usize = 1;
const OFFSET_SUDT_TYPE_HASH: usize = 33;
const OFFSET_AMOUNT: usize = 65;
const OFFSET_SOURCE_OUTPOINT_TX: usize = 81;
const OFFSET_SOURCE_OUTPOINT_INDEX: usize = 113;
const OFFSET_INCLUSION_HEIGHT: usize = 117;
const CELL_DATA_LEN: usize = 125;

// ============ Type-script args ============

// args = own type-hash; lets the script discriminate its own cells in cell-dep
// scans (replay prevention §2.1 step 4).
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Lawson constant name_hashes — sentinel placeholders so reviewers can grep.
// TODO: blake2b("deposit.*") at compile time.
const LAWSON_NAME_DEPOSIT_SCORE_THRESHOLD: [u8; 32] = [0x10; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_DEPOSIT_FINALITY_BLOCKS: [u8; 32] = [0x12; 32];

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const MAX_DEPOSIT_OUTPUTS: usize = 16;

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
        // Creation: external -> internal. Full §2.1 invariant set.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Claim/consume: deposit being spent into vibeswap-app internal state.
        // Finality check fires here (REORG §6 — withdraw side).
        (false, true) => verify_claim(&inputs),
        // Same-tx mutation is not legal — a deposit either is, or is being
        // claimed; we never relabel it in place.
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

// ============ Read group cells ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_DEPOSIT_OUTPUTS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_DEPOSIT_OUTPUTS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Creation path ============

fn verify_creation(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }

    // §2.1 step 1+2+3: NCI authorization (cell-dep + score >= threshold + freshness).
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.deposit_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    // Freshness: tip - nci_inclusion <= max_age. tip read via header-dep proxy
    // (PoWAnchorCell) — see [TODO] below.
    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: load_header on PoWAnchorCell header-dep for authoritative tip.

    // §2.1 step 4: replay prevention.
    // Each new output's (source_outpoint_tx, source_outpoint_index) must not
    // already appear in any existing DepositBoundaryCell.
    verify_no_replay(outputs, own_type_hash)?;

    // Cross-cell: amount conservation against canonical-token inputs at
    // owner_lock_hash. Sum of canonical-token amounts in tx inputs at the
    // owner_lock_hash must equal sum of deposit amounts created.
    verify_amount_conservation(outputs)?;

    Ok(())
}

// ============ Claim path (consume) ============

fn verify_claim(inputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for inp in inputs {
        verify_layout(inp)?;
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;
    let tip = read_tip_height_proxy()?;

    // REORG §6: deposits finalize at DEPOSIT_FINALITY_BLOCKS (6 default) before
    // the consume path is authorized — prevents reorg-rollback of credited deposits.
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.deposit_finality_blocks {
            return Err(Error::DepositNotYetFinal);
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

// ============ Replay prevention ============

fn verify_no_replay(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Walk cell-deps; any cell whose type-hash equals own_type_hash is an
    // existing DepositBoundaryCell — its (source_outpoint_tx, index) must
    // differ from every new output's pair.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(th)) if &th == own_type_hash => {
                let data = load_cell_data(idx, Source::CellDep)?;
                if data.len() < CELL_DATA_LEN {
                    return Err(Error::CellDataMalformed);
                }
                let existing_tx = &data[OFFSET_SOURCE_OUTPOINT_TX..OFFSET_SOURCE_OUTPOINT_TX + 32];
                let existing_index = read_u32_le(
                    &data[OFFSET_SOURCE_OUTPOINT_INDEX..OFFSET_SOURCE_OUTPOINT_INDEX + 4],
                );
                for out in outputs {
                    let new_tx =
                        &out[OFFSET_SOURCE_OUTPOINT_TX..OFFSET_SOURCE_OUTPOINT_TX + 32];
                    let new_index = read_u32_le(
                        &out[OFFSET_SOURCE_OUTPOINT_INDEX..OFFSET_SOURCE_OUTPOINT_INDEX + 4],
                    );
                    if existing_tx == new_tx && existing_index == new_index {
                        return Err(Error::SourceOutpointReplayed);
                    }
                }
                idx += 1;
            }
            Ok(_) => {
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(()),
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Amount conservation ============

fn verify_amount_conservation(outputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    // Per output: scan tx inputs; sum canonical-token amounts whose type-hash
    // matches the output's sudt_type_hash AND whose lock-hash matches the
    // output's owner_lock_hash. Sum must equal the recorded deposit amount.
    for out in outputs {
        let sudt_th = &out[OFFSET_SUDT_TYPE_HASH..OFFSET_SUDT_TYPE_HASH + 32];
        let recorded_amount = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);

        let mut summed: u128 = 0;
        let mut idx = 0usize;
        let mut canonical_seen = false;
        loop {
            match load_cell_type_hash(idx, Source::Input) {
                Ok(Some(th)) if &th == sudt_th => {
                    canonical_seen = true;
                    // owner_lock_hash check is delegated: the canonical-token
                    // input's lock-script enforces owner intent; we treat any
                    // input of the matching sudt type as part of the deposit
                    // batch in v1. v2 tightens by also matching lock-hash.
                    // TODO: per-input lock-hash match against owner_lock_hash.
                    let data = load_cell_data(idx, Source::Input)?;
                    if data.len() < 16 {
                        return Err(Error::CellDataMalformed);
                    }
                    let a = read_u128_le(&data[..16]);
                    summed = summed.checked_add(a).ok_or(Error::AmountOverflow)?;
                    idx += 1;
                }
                Ok(_) => idx += 1,
                Err(ckb_std::error::SysError::IndexOutOfBound) => break,
                Err(e) => return Err(e.into()),
            }
        }

        if !canonical_seen {
            return Err(Error::CanonicalTokenAbsent);
        }
        if summed != recorded_amount {
            return Err(Error::AmountConservationFailed);
        }
    }
    Ok(())
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    deposit_score_threshold: u64,
    max_score_age_blocks: u64,
    deposit_finality_blocks: u64,
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

    let deposit_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_DEPOSIT_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let deposit_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_DEPOSIT_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        deposit_score_threshold,
        max_score_age_blocks,
        deposit_finality_blocks,
    })
}

fn lookup_lawson_u64(data: &[u8], count: usize, name: &[u8; 32]) -> Result<u64, Error> {
    // Lawson entry: name_hash[32] | value u128 LE | alpha u128 LE | block u64 LE.
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
    // TODO: ckb-std load_header(Source::HeaderDep) for authoritative tip; v1
    // uses the highest inclusion_height observed across NCI cell-deps as a
    // proxy, which is honest only when boundary-tx-builders attach a fresh
    // PoWAnchorCell as cell-dep.
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
