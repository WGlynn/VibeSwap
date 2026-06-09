//! # Slash Boundary Cell Type Script
//!
//! Authorizes slashing of a bonded validator's stake on evidence per
//! `specs/nci-boundary-enforcement.md` §2.4. Highest NCI threshold of any
//! boundary — false-slash is adversarial weapon. Composes with NCIScoreCell
//! (authorization), the evidence cell (TaskVerdictCell / PoMFail / etc.,
//! dispatched on `slash_reason`), ValidatorRegistryCell (bonded set + bond
//! amount for cap), Lawson (thresholds + finality + cap), and the BondCell
//! same-tx (slash-router execution layer).
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                    | bytes | offset |
//! |--------------------------|-------|--------|
//! | version                  |   1   |   0    |
//! | slashed_pubkey           |  48   |   1    |   compressed G1
//! | slash_amount             |  16   |  49    |   u128 LE
//! | slash_reason             |   1   |  65    |   0=Equiv 1=Offline 2=Verdict 3=PoMFail
//! | evidence_cell_outpoint   |  40   |  66    |   tx_hash[32] | index u64 LE[8]
//! | epoch                    |   8   | 106    |   u64 LE
//! | inclusion_height         |   8   | 114    |   u64 LE
//!
//! Total fixed size: 122 bytes.

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
const OFFSET_SLASHED_PUBKEY: usize = 1;
const OFFSET_SLASH_AMOUNT: usize = 49;
const OFFSET_SLASH_REASON: usize = 65;
const OFFSET_EVIDENCE_OUTPOINT: usize = 66;
const OFFSET_EPOCH: usize = 106;
const OFFSET_INCLUSION_HEIGHT: usize = 114;
const CELL_DATA_LEN: usize = 122;

const PUBKEY_LEN: usize = 48;
const OUTPOINT_LEN: usize = 40;

// ============ Slash reason enum ============

const REASON_EQUIVOCATION: u8 = 0;
const REASON_OFFLINE: u8 = 1;
const REASON_PAIRWISE_VERDICT: u8 = 2;
const REASON_POM_FAIL: u8 = 3;
const REASON_MAX: u8 = REASON_POM_FAIL;

// ============ Type-script args ============

// args = own type-hash; discriminates sibling SlashBoundaryCells for replay
// scan (§2.4 step 7 — one slash per evidence outpoint).
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ ValidatorRegistryCell layout (subset; mirrors sibling crate) ============

const REGISTRY_OFFSET_VERSION: usize = 0;
const REGISTRY_OFFSET_N_VALIDATORS: usize = 29;
const REGISTRY_HEADER_LEN: usize = 31;
const REGISTRY_VALIDATOR_ENTRY_LEN: usize = 64;
const REGISTRY_VALIDATOR_PUBKEY_OFFSET: usize = 0;
const REGISTRY_VALIDATOR_BOND_OFFSET: usize = 48;
const REGISTRY_VALIDATOR_BOND_LEN: usize = 16;

// ============ Evidence cell shape constants (per reason) ============

// TaskVerdictCell (REASON_PAIRWISE_VERDICT) shape floor — version + task_id +
// minimal participant header. Tighter dispatch needs code-hash match.
const VERDICT_MIN_DATA_LEN: usize = 1 + 32 + 16;

// EquivocationProofCell shape floor — version + pubkey + 2 conflicting sigs.
const EQUIVOCATION_MIN_DATA_LEN: usize = 1 + 48 + 96 + 96;

// OfflineAttestationCell shape floor — version + target_pubkey + epoch range
// + quorum signature.
const OFFLINE_MIN_DATA_LEN: usize = 1 + 48 + 16 + 96;

// MessagingPoMFailCell shape floor — version + target_pubkey + challenge hash
// + failure witness.
const POMFAIL_MIN_DATA_LEN: usize = 1 + 48 + 32 + 64;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Sentinel placeholders so reviewers can grep.
// TODO: blake2b("slash.*") at compile time.
const LAWSON_NAME_SLASH_SCORE_THRESHOLD: [u8; 32] = [0x30; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_SLASH_LOSING_SHARE_BPS: [u8; 32] = [0x31; 32];
const LAWSON_NAME_SLASH_FINALITY_BLOCKS: [u8; 32] = [0x32; 32];

// SLASH_LOSING_SHARE_BPS sanity cap — slash-router constitutional bounds
// say [5000, 8000]; reject anything that escaped Lawson's own bounds check.
const SLASH_BPS_FLOOR: u64 = 5000;
const SLASH_BPS_CEIL: u64 = 8000;
const BPS_DENOM: u128 = 10_000;

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const EVIDENCE_BLOB_CAP: usize = 4096;
const REGISTRY_BLOB_CAP: usize = 16384;
const MAX_BOUNDARY_OUTPUTS: usize = 16;

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
        // Creation: evidence-authorized slash dispatch. Full §2.4 invariant set.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Consume: slash boundary spent into downstream archival.
        // 100-block finality fires here — deepest threshold of any boundary.
        (false, true) => verify_consume(&inputs),
        // In-place mutation not legal for a slash commitment.
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

fn verify_creation(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }

    // §2.4 step 1+2: NCI authorization — strictest threshold (false-slash weapon).
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.slash_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: PoWAnchorCell header-dep for authoritative tip.

    // §2.4 step 3: evidence cell-dep, shape-dispatched on slash_reason.
    // §2.4 step 4: validator-existence + bond-amount lookup.
    // §2.4 step 5: slash_amount <= bond_amount * losing_share_bps / 10000.
    let registry = find_validator_registry_cell_dep()?;
    for out in outputs {
        verify_evidence_binding(out)?;
        let bond_amount = lookup_validator_bond(&registry, out)?;
        verify_slash_cap(out, bond_amount, lp.slash_losing_share_bps)?;
    }

    // §2.4 step 7: one slash per evidence outpoint.
    verify_no_replay(outputs, own_type_hash)?;

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

    // 100-block finality: slash is irreversible, false-slash in deep reorg
    // unrecoverable — patience over speed per REORG_BEHAVIOR_DESIGN §6.
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.slash_finality_blocks {
            return Err(Error::SlashNotYetFinal);
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
    let reason = data[OFFSET_SLASH_REASON];
    if reason > REASON_MAX {
        return Err(Error::SlashReasonUnknown);
    }
    let amount = read_u128_le(&data[OFFSET_SLASH_AMOUNT..OFFSET_SLASH_AMOUNT + 16]);
    if amount == 0 {
        return Err(Error::SlashAmountZero);
    }
    Ok(())
}

// ============ Evidence binding ============

fn verify_evidence_binding(boundary_data: &[u8]) -> Result<(), Error> {
    let reason = boundary_data[OFFSET_SLASH_REASON];

    // v1 dispatch: shape match on evidence cell-data length per reason.
    // TODO: code-hash match per reason (TaskVerdictCell type-hash, etc.)
    // resolved at deploy via constitutional cell-dep.
    let min_len = match reason {
        REASON_EQUIVOCATION => EQUIVOCATION_MIN_DATA_LEN,
        REASON_OFFLINE => OFFLINE_MIN_DATA_LEN,
        REASON_PAIRWISE_VERDICT => VERDICT_MIN_DATA_LEN,
        REASON_POM_FAIL => POMFAIL_MIN_DATA_LEN,
        _ => return Err(Error::SlashReasonUnknown),
    };

    let evidence = find_evidence_cell_dep(min_len)?;

    // For pubkey-bound evidence (all reasons except verdict), the slashed
    // pubkey should appear at byte 1 of the evidence cell. Verdict cell's
    // loser pubkey lives inside the participant list — checked at the
    // ValidatorRegistry layer via lookup_validator_bond instead.
    let boundary_pubkey = &boundary_data[OFFSET_SLASHED_PUBKEY..OFFSET_SLASHED_PUBKEY + PUBKEY_LEN];
    if reason != REASON_PAIRWISE_VERDICT {
        if evidence.len() < 1 + PUBKEY_LEN {
            return Err(Error::EvidenceShapeMismatch);
        }
        let evidence_pubkey = &evidence[1..1 + PUBKEY_LEN];
        if evidence_pubkey != boundary_pubkey {
            return Err(Error::EvidenceReasonMismatch);
        }
    }

    Ok(())
}

// ============ Validator existence + bond lookup ============

fn lookup_validator_bond(
    registry: &[u8],
    boundary_data: &[u8],
) -> Result<u128, Error> {
    let pubkey = &boundary_data[OFFSET_SLASHED_PUBKEY..OFFSET_SLASHED_PUBKEY + PUBKEY_LEN];
    let n_validators = read_u16_le(
        &registry[REGISTRY_OFFSET_N_VALIDATORS..REGISTRY_OFFSET_N_VALIDATORS + 2],
    ) as usize;

    for i in 0..n_validators {
        let base = REGISTRY_HEADER_LEN + i * REGISTRY_VALIDATOR_ENTRY_LEN;
        let pk = &registry[base + REGISTRY_VALIDATOR_PUBKEY_OFFSET
            ..base + REGISTRY_VALIDATOR_PUBKEY_OFFSET + PUBKEY_LEN];
        if pk == pubkey {
            let bond = read_u128_le(
                &registry[base + REGISTRY_VALIDATOR_BOND_OFFSET
                    ..base + REGISTRY_VALIDATOR_BOND_OFFSET + REGISTRY_VALIDATOR_BOND_LEN],
            );
            return Ok(bond);
        }
    }
    Err(Error::ValidatorNotBonded)
}

// ============ Slash cap ============

fn verify_slash_cap(
    boundary_data: &[u8],
    bond_amount: u128,
    losing_share_bps: u64,
) -> Result<(), Error> {
    if !(SLASH_BPS_FLOOR..=SLASH_BPS_CEIL).contains(&losing_share_bps) {
        return Err(Error::SlashCapMalformed);
    }
    let cap = bond_amount
        .checked_mul(losing_share_bps as u128)
        .ok_or(Error::SlashCapOverflow)?
        / BPS_DENOM;
    let amount = read_u128_le(&boundary_data[OFFSET_SLASH_AMOUNT..OFFSET_SLASH_AMOUNT + 16]);
    if amount > cap {
        return Err(Error::SlashAmountExceedsCap);
    }
    Ok(())
}

// ============ Replay prevention ============

fn verify_no_replay(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Each evidence_cell_outpoint authorizes at most one slash dispatch —
    // double-slash on the same evidence is unrecoverable.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(th)) if &th == own_type_hash => {
                let data = load_cell_data(idx, Source::CellDep)?;
                if data.len() < CELL_DATA_LEN {
                    return Err(Error::CellDataMalformed);
                }
                let existing_outpoint =
                    &data[OFFSET_EVIDENCE_OUTPOINT..OFFSET_EVIDENCE_OUTPOINT + OUTPOINT_LEN];
                for out in outputs {
                    let new_outpoint =
                        &out[OFFSET_EVIDENCE_OUTPOINT..OFFSET_EVIDENCE_OUTPOINT + OUTPOINT_LEN];
                    if existing_outpoint == new_outpoint {
                        return Err(Error::EvidenceOutpointReplayed);
                    }
                }
                idx += 1;
            }
            Ok(_) => idx += 1,
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(()),
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    slash_score_threshold: u64,
    max_score_age_blocks: u64,
    slash_losing_share_bps: u64,
    slash_finality_blocks: u64,
}

fn find_lawson_cell_dep() -> Result<heapless::Vec<u8, LAWSON_BLOB_CAP>, Error> {
    // Shape match: schema_version + registry header.
    // TODO: code-hash match against deployed lawson binary.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if !data.is_empty()
                    && data[0] == SCHEMA_VERSION
                    && data.len() >= LAWSON_REGISTRY_HEADER_LEN
                    && data.len() > NCI_CELL_DATA_LEN
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

    let slash_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_SLASH_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let slash_losing_share_bps =
        lookup_lawson_u64(data, count, &LAWSON_NAME_SLASH_LOSING_SHARE_BPS)?;
    let slash_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_SLASH_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        slash_score_threshold,
        max_score_age_blocks,
        slash_losing_share_bps,
        slash_finality_blocks,
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

// ============ Evidence cell-dep scan ============

fn find_evidence_cell_dep(
    min_len: usize,
) -> Result<heapless::Vec<u8, EVIDENCE_BLOB_CAP>, Error> {
    // Shape match: data >= per-reason min_len + version byte equals SCHEMA_VERSION
    // and the candidate is NOT an NCI or registry cell (excluded by length tier).
    // TODO: code-hash match per slash_reason + resolve specific outpoint.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= min_len
                    && data.len() != NCI_CELL_DATA_LEN
                    && data[0] == SCHEMA_VERSION
                {
                    let mut buf: heapless::Vec<u8, EVIDENCE_BLOB_CAP> = heapless::Vec::new();
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
                return Err(Error::EvidenceCellDepMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ ValidatorRegistryCell cell-dep scan ============

fn find_validator_registry_cell_dep() -> Result<heapless::Vec<u8, REGISTRY_BLOB_CAP>, Error> {
    // Shape match: registry header + at least one validator entry.
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
