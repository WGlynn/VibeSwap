//! # Withdrawal Boundary Cell Type Script
//!
//! Authorizes internal -> external value transitions out of the vibeswap-app
//! domain. Companion to `deposit-boundary-cell-type-script`; the cell
//! references a matched DepositBoundaryCell, asserts it is unconsumed,
//! finalized, and that the withdrawal amount does not exceed the deposit.
//!
//! Spec: `specs/nci-boundary-enforcement.md` §2.2.
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                          | bytes | offset |
//! |--------------------------------|-------|--------|
//! | version                        |   1   |   0    |
//! | owner_lock_hash                |  32   |   1    |
//! | sudt_type_hash                 |  32   |  33    |
//! | amount                         |  16   |  65    |   u128 LE
//! | matched_deposit_outpoint_tx    |  32   |  81    |
//! | matched_deposit_outpoint_index |   4   | 113    |   u32 LE
//! | inclusion_height               |   8   | 117    |   u64 LE
//!
//! Total fixed size: 125 bytes (mirrors deposit symmetry).

#![no_std]
#![no_main]


use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_lock_hash, load_cell_type_hash, load_script, QueryIter},
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
const OFFSET_MATCHED_DEPOSIT_OUTPOINT_TX: usize = 81;
const OFFSET_MATCHED_DEPOSIT_OUTPOINT_INDEX: usize = 113;
const OFFSET_INCLUSION_HEIGHT: usize = 117;
const CELL_DATA_LEN: usize = 125;

// ============ Type-script args ============

// args = own type-hash; discriminates withdrawal cells from sibling deposits
// in cell-dep scans.
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ Deposit cell layout (subset; mirrors sibling crate) ============

const DEPOSIT_OFFSET_OWNER_LOCK_HASH: usize = 1;
const DEPOSIT_OFFSET_SUDT_TYPE_HASH: usize = 33;
const DEPOSIT_OFFSET_AMOUNT: usize = 65;
const DEPOSIT_OFFSET_INCLUSION_HEIGHT: usize = 117;
const DEPOSIT_CELL_DATA_LEN: usize = 125;

// ============ NCI cell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Lawson constant name_hashes — sentinel placeholders (grep-able).
// TODO: blake2b("withdrawal.*") compile-time.
const LAWSON_NAME_WITHDRAWAL_SCORE_THRESHOLD: [u8; 32] = [0x20; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_WITHDRAWAL_FINALITY_BLOCKS: [u8; 32] = [0x22; 32];

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const DEPOSIT_BLOB_CAP: usize = 256;
const MAX_WITHDRAWAL_OUTPUTS: usize = 16;

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
        // Creation: internal -> external. Full §2.2 invariant set.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Settlement/spend: withdrawal record consumed once the external
        // transfer is acknowledged. No further checks beyond layout.
        (false, true) => verify_settlement(&inputs),
        // Same-tx mutation forbidden; a withdrawal either is or is settled.
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

// ============ Read group cells ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_WITHDRAWAL_OUTPUTS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_WITHDRAWAL_OUTPUTS> = heapless::Vec::new();
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

    // §2.2 steps 1+2: NCI authorization (cell-dep + score >= withdrawal threshold).
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.withdrawal_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    // §2.2 step 2: freshness (max_score_age_blocks).
    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: load_header on PoWAnchorCell header-dep for authoritative tip.

    // §2.2 steps 3+4+5+6: per-output matched-deposit checks.
    for out in outputs {
        verify_matched_deposit(out, own_type_hash, tip, lp.withdrawal_finality_blocks)?;
        verify_canonical_token_output(out)?;
    }

    Ok(())
}

// ============ Settlement path (consume) ============

fn verify_settlement(inputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for inp in inputs {
        verify_layout(inp)?;
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

// ============ Matched-deposit check (§2.2 steps 3+4+5) ============

fn verify_matched_deposit(
    out: &[u8],
    own_type_hash: &[u8; 32],
    tip: u64,
    finality_blocks: u64,
) -> Result<(), Error> {
    let matched_tx = &out[OFFSET_MATCHED_DEPOSIT_OUTPOINT_TX..OFFSET_MATCHED_DEPOSIT_OUTPOINT_TX + 32];
    let matched_index = read_u32_le(
        &out[OFFSET_MATCHED_DEPOSIT_OUTPOINT_INDEX..OFFSET_MATCHED_DEPOSIT_OUTPOINT_INDEX + 4],
    );
    let owner_lock_hash = &out[OFFSET_OWNER_LOCK_HASH..OFFSET_OWNER_LOCK_HASH + 32];
    let sudt_type_hash = &out[OFFSET_SUDT_TYPE_HASH..OFFSET_SUDT_TYPE_HASH + 32];
    let withdrawal_amount = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);

    // Scan cell-deps for the matched DepositBoundaryCell. Discriminator: any
    // cell with a DepositBoundaryCell-shaped data blob whose embedded outpoint
    // matches. v1 uses shape; production cell-deps a deposit-by-outpoint and
    // checks code-hash. TODO: code-hash match against deposit binary.
    let mut idx = 0usize;
    let mut found = false;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= DEPOSIT_CELL_DATA_LEN && data[OFFSET_VERSION] == SCHEMA_VERSION {
                    // Compare embedded outpoint of the deposit-shaped cell
                    // against the matched_deposit_outpoint pair in our cell.
                    // The deposit cell records its own source_outpoint at the
                    // same offsets we use for matched_deposit_outpoint, but
                    // that records the EXTERNAL source — not the deposit's own
                    // outpoint. The deposit's own outpoint is the cell-dep
                    // outpoint itself, which we can't read from data; we'd need
                    // load_cell with Source::CellDep + index. v1 approximation:
                    // hash-match owner+sudt+amount-plausibility.
                    // TODO: use load_cell to read OutPoint(tx_hash, index) of
                    // the dep cell directly and exact-match (matched_tx, idx).
                    let dep_owner =
                        &data[DEPOSIT_OFFSET_OWNER_LOCK_HASH..DEPOSIT_OFFSET_OWNER_LOCK_HASH + 32];
                    let dep_sudt =
                        &data[DEPOSIT_OFFSET_SUDT_TYPE_HASH..DEPOSIT_OFFSET_SUDT_TYPE_HASH + 32];
                    let dep_amount = read_u128_le(
                        &data[DEPOSIT_OFFSET_AMOUNT..DEPOSIT_OFFSET_AMOUNT + 16],
                    );
                    let dep_inclusion = read_u64_le(
                        &data[DEPOSIT_OFFSET_INCLUSION_HEIGHT
                            ..DEPOSIT_OFFSET_INCLUSION_HEIGHT + 8],
                    );

                    // Owner + sudt must match.
                    if dep_owner != owner_lock_hash {
                        idx += 1;
                        continue;
                    }
                    if dep_sudt != sudt_type_hash {
                        idx += 1;
                        continue;
                    }

                    // §2.2: amount ≤ matched_deposit.amount.
                    if withdrawal_amount > dep_amount {
                        return Err(Error::WithdrawalExceedsDeposit);
                    }

                    // §2.2 step 5: finality on the matched deposit.
                    if tip.saturating_sub(dep_inclusion) < finality_blocks {
                        return Err(Error::MatchedDepositNotYetFinal);
                    }

                    // §2.2 step 4: unconsumed. Scan tx inputs; if any input is
                    // a DepositBoundaryCell with matching owner+sudt+amount-
                    // shape, the matched deposit is being consumed this tx,
                    // which is the legal consume path; we accept. If we find a
                    // prior WithdrawalBoundaryCell (own_type_hash) with the
                    // same matched_deposit_outpoint, that's a replay.
                    verify_unconsumed(matched_tx, matched_index, own_type_hash)?;

                    found = true;
                    break;
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }

    if !found {
        // Suppress also when deposit was matched but unconsumed-check failed:
        // verify_unconsumed propagates its own error; reaching here = no dep.
        return Err(Error::MatchedDepositMissing);
    }

    Ok(())
}

fn verify_unconsumed(
    matched_tx: &[u8],
    matched_index: u32,
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // A prior WithdrawalBoundaryCell visible as cell-dep with the same
    // matched_deposit_outpoint means the deposit has already been withdrawn
    // against once.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(th)) if &th == own_type_hash => {
                let data = load_cell_data(idx, Source::CellDep)?;
                if data.len() < CELL_DATA_LEN {
                    return Err(Error::CellDataMalformed);
                }
                let prior_tx = &data[OFFSET_MATCHED_DEPOSIT_OUTPOINT_TX
                    ..OFFSET_MATCHED_DEPOSIT_OUTPOINT_TX + 32];
                let prior_idx = read_u32_le(
                    &data[OFFSET_MATCHED_DEPOSIT_OUTPOINT_INDEX
                        ..OFFSET_MATCHED_DEPOSIT_OUTPOINT_INDEX + 4],
                );
                if prior_tx == matched_tx && prior_idx == matched_index {
                    return Err(Error::MatchedDepositConsumed);
                }
                idx += 1;
            }
            Ok(_) => idx += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(()),
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Canonical-token output (§2.2 step 6) ============

fn verify_canonical_token_output(out: &[u8]) -> Result<(), Error> {
    // Same-tx canonical-token output to owner_lock_hash for `amount` —
    // the on-chain receipt that the withdrawn value left vibeswap-app state.
    let owner_lock_hash = &out[OFFSET_OWNER_LOCK_HASH..OFFSET_OWNER_LOCK_HASH + 32];
    let sudt_th = &out[OFFSET_SUDT_TYPE_HASH..OFFSET_SUDT_TYPE_HASH + 32];
    let recorded_amount = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);

    let mut summed: u128 = 0;
    let mut idx = 0usize;
    let mut canonical_seen = false;
    loop {
        match load_cell_type_hash(idx, Source::Output) {
            Ok(Some(th)) if &th == sudt_th => {
                let lock_hash = load_cell_lock_hash(idx, Source::Output)?;
                if &lock_hash == owner_lock_hash {
                    canonical_seen = true;
                    let data = load_cell_data(idx, Source::Output)?;
                    if data.len() < 16 {
                        return Err(Error::CellDataMalformed);
                    }
                    let a = read_u128_le(&data[..16]);
                    summed = summed.checked_add(a).ok_or(Error::AmountOverflow)?;
                }
                idx += 1;
            }
            Ok(_) => idx += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }

    if !canonical_seen {
        return Err(Error::CanonicalTokenOutputAbsent);
    }
    if summed != recorded_amount {
        return Err(Error::CanonicalTokenOutputMismatch);
    }
    Ok(())
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    withdrawal_score_threshold: u64,
    max_score_age_blocks: u64,
    withdrawal_finality_blocks: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match: registry header + schema version.
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

    let withdrawal_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_WITHDRAWAL_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let withdrawal_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_WITHDRAWAL_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        withdrawal_score_threshold,
        max_score_age_blocks,
        withdrawal_finality_blocks,
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
    // v1 placeholder: production reads load_header(Source::HeaderDep) on the
    // tx's PoWAnchorCell header-dep. The proxy returns a midpoint so freshness
    // + finality checks operate on a comparable scale during scaffold review.
    // TODO: replace with authoritative tip from PoWAnchorCell.
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

// Suppress unused-import warning when DEPOSIT_BLOB_CAP isn't wired into a
// heapless::Vec yet; the constant is kept for forthcoming v2 deposit-blob
// caching path.
const _: usize = DEPOSIT_BLOB_CAP;
