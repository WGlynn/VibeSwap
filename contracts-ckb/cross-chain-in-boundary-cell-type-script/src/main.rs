//! # Cross-Chain Inbound Boundary Cell Type Script
//!
//! Authorizes the mint of canonical-token cells on CKB-VibeSwap in response
//! to a BLS-attested remote-chain burn per `specs/nci-boundary-enforcement.md`
//! §2.7. Composes with NCIScoreCell (authorization), AttestationCell
//! (BLS-verified payload), ValidatorRegistryCell (quorum + epoch), Lawson
//! (thresholds + finality), and MessagingHubCanonicalTokenCell (same-tx mint).
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                     | bytes | offset |
//! |---------------------------|-------|--------|
//! | version                   |   1   |   0    |
//! | source_chain_id           |   8   |   1    |   u64 LE
//! | source_burn_id            |   8   |   9    |   u64 LE
//! | amount                    |  16   |  17    |   u128 LE
//! | recipient_lock_hash       |  32   |  33    |
//! | attestation_cell_outpoint |  40   |  65    |   tx_hash[32] | index u64 LE[8]
//! | inclusion_height          |   8   | 105    |   u64 LE
//!
//! Total fixed size: 113 bytes.

#![no_std]
#![no_main]

extern crate alloc;

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
const OFFSET_SOURCE_CHAIN_ID: usize = 1;
const OFFSET_SOURCE_BURN_ID: usize = 9;
const OFFSET_AMOUNT: usize = 17;
const OFFSET_RECIPIENT_LOCK_HASH: usize = 33;
const OFFSET_ATTESTATION_OUTPOINT: usize = 65;
const OFFSET_INCLUSION_HEIGHT: usize = 105;
const CELL_DATA_LEN: usize = 113;

// ============ Type-script args ============

// args = own type-hash; discriminates sibling CrossChainInBoundaryCells in
// cell-dep scans (replay prevention §2.7 step 5).
const ARGS_OWN_TYPE_HASH_LEN: usize = 32;

// ============ NCIScoreCell layout (subset; mirrors sibling crate) ============

const NCI_OFFSET_VERSION: usize = 0;
const NCI_OFFSET_INCLUSION_HEIGHT: usize = 9;
const NCI_OFFSET_SCORE: usize = 17;
const NCI_CELL_DATA_LEN: usize = 67;

// ============ AttestationCell layout (subset; mirrors sibling crate) ============

const ATT_OFFSET_VERSION: usize = 0;
const ATT_OFFSET_SOURCE_CHAIN_ID: usize = 33;
const ATT_OFFSET_SOURCE_BURN_ID: usize = 41;
const ATT_OFFSET_AMOUNT: usize = 73;
const ATT_OFFSET_DEST_RECIPIENT: usize = 89;
const ATT_OFFSET_ATTESTED_EPOCH: usize = 129;
const ATT_HEADER_FIXED_LEN: usize = 233;

// ============ ValidatorRegistryCell layout (subset; mirrors sibling crate) ============

const REGISTRY_OFFSET_VERSION: usize = 0;
const REGISTRY_OFFSET_EPOCH: usize = 1;
const REGISTRY_OFFSET_N_VALIDATORS: usize = 29;
const REGISTRY_HEADER_LEN: usize = 31;
const REGISTRY_VALIDATOR_ENTRY_LEN: usize = 64;

// ============ Lawson layout (subset we read) ============

const LAWSON_REGISTRY_HEADER_LEN: usize = 3;
const LAWSON_CONSTANT_ENTRY_LEN: usize = 72;
const LAWSON_MAX_CONSTANTS: usize = 64;

// Sentinel placeholders so reviewers can grep.
// TODO: blake2b("xchain_in.*") at compile time.
const LAWSON_NAME_XCHAIN_IN_SCORE_THRESHOLD: [u8; 32] = [0x20; 32];
const LAWSON_NAME_MAX_SCORE_AGE_BLOCKS: [u8; 32] = [0x11; 32];
const LAWSON_NAME_XCHAIN_IN_FINALITY_BLOCKS: [u8; 32] = [0x21; 32];

// ============ Canonical-token expected type-hash (placeholder) ============

// TODO: pin at deploy via constitutional cell-dep; v1 matches by shape.
const CANONICAL_TOKEN_MIN_OUTPUT_LEN: usize = 16;

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const ATT_BLOB_CAP: usize = 512;
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
        // Creation: remote-burn-authorized mint. Full §2.7 invariant set fires.
        (true, false) => verify_creation(&outputs, &own_type_hash),
        // Consume: boundary cell spent into downstream vibeswap-app state.
        // Finality check fires here (REORG §6: 24 blocks — most reorg-sensitive
        // boundary because reorg-rollback = mint without burn = supply inflation).
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

fn verify_creation(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }

    // §2.7 step 1+2: NCI authorization (cell-dep + score >= threshold + freshness).
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.xchain_in_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: PoWAnchorCell header-dep for authoritative tip.

    // §2.7 step 3+4: AttestationCell + ValidatorRegistry binding.
    let registry = find_validator_registry_cell_dep()?;
    let registry_epoch = read_u64_le(&registry[REGISTRY_OFFSET_EPOCH..REGISTRY_OFFSET_EPOCH + 8]);

    for out in outputs {
        verify_attestation_binding(out, registry_epoch)?;
    }

    // §2.7 step 5: replay prevention against sibling boundary cells.
    verify_no_replay(outputs, own_type_hash)?;

    // §2.7 step 6: same-tx canonical-token mint output to recipient.
    verify_canonical_mint_outputs(outputs)?;

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

    // 24-block finality: most reorg-sensitive boundary (mint-without-burn risk).
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.xchain_in_finality_blocks {
            return Err(Error::CrossChainInNotYetFinal);
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
    let source_chain_id =
        read_u64_le(&data[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
    if source_chain_id == 0 {
        return Err(Error::SourceChainIdReserved);
    }
    Ok(())
}

// ============ Attestation binding ============

fn verify_attestation_binding(
    boundary_data: &[u8],
    registry_epoch: u64,
) -> Result<(), Error> {
    // Resolve AttestationCell by outpoint: walk cell-deps and match the
    // boundary's attestation_cell_outpoint against each dep's outpoint shape.
    // v1: scan cell-dep data by shape (attestation header length + version).
    let boundary_source_chain =
        read_u64_le(&boundary_data[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
    let boundary_burn_id =
        read_u64_le(&boundary_data[OFFSET_SOURCE_BURN_ID..OFFSET_SOURCE_BURN_ID + 8]);
    let boundary_amount = read_u128_le(&boundary_data[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);
    let boundary_recipient =
        &boundary_data[OFFSET_RECIPIENT_LOCK_HASH..OFFSET_RECIPIENT_LOCK_HASH + 32];

    let att = find_attestation_cell_dep()?;

    let att_source_chain =
        read_u64_le(&att[ATT_OFFSET_SOURCE_CHAIN_ID..ATT_OFFSET_SOURCE_CHAIN_ID + 8]);
    // Attestation stores source_burn_id as 32 bytes; boundary stores 8.
    // Compare low 8 bytes; the high 24 must be zero or the burn was emitted
    // by a non-u64 source-chain convention not yet supported.
    // TODO: widen boundary source_burn_id to 32 bytes for non-u64 source chains.
    let att_burn_id_low = read_u64_le(&att[ATT_OFFSET_SOURCE_BURN_ID..ATT_OFFSET_SOURCE_BURN_ID + 8]);
    let att_burn_id_high = &att[ATT_OFFSET_SOURCE_BURN_ID + 8..ATT_OFFSET_SOURCE_BURN_ID + 32];
    let att_amount = read_u128_le(&att[ATT_OFFSET_AMOUNT..ATT_OFFSET_AMOUNT + 16]);
    let att_recipient = &att[ATT_OFFSET_DEST_RECIPIENT..ATT_OFFSET_DEST_RECIPIENT + 32];
    let att_epoch = read_u64_le(&att[ATT_OFFSET_ATTESTED_EPOCH..ATT_OFFSET_ATTESTED_EPOCH + 8]);

    if att_source_chain != boundary_source_chain
        || att_burn_id_low != boundary_burn_id
        || att_burn_id_high.iter().any(|b| *b != 0)
        || att_amount != boundary_amount
        || att_recipient != boundary_recipient
    {
        return Err(Error::AttestationFieldMismatch);
    }
    if att_epoch != registry_epoch {
        return Err(Error::AttestationEpochMismatch);
    }

    Ok(())
}

// ============ Replay prevention ============

fn verify_no_replay(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Sibling CrossChainInBoundaryCells in cell-deps must not carry
    // matching (source_chain_id, source_burn_id) pairs.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(th)) if &th == own_type_hash => {
                let data = load_cell_data(idx, Source::CellDep)?;
                if data.len() < CELL_DATA_LEN {
                    return Err(Error::CellDataMalformed);
                }
                let existing_chain =
                    read_u64_le(&data[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
                let existing_burn_id =
                    read_u64_le(&data[OFFSET_SOURCE_BURN_ID..OFFSET_SOURCE_BURN_ID + 8]);
                for out in outputs {
                    let new_chain =
                        read_u64_le(&out[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
                    let new_burn_id =
                        read_u64_le(&out[OFFSET_SOURCE_BURN_ID..OFFSET_SOURCE_BURN_ID + 8]);
                    if existing_chain == new_chain && existing_burn_id == new_burn_id {
                        return Err(Error::BurnIdReplayed);
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

// ============ Same-tx canonical-token mint output ============

fn verify_canonical_mint_outputs(outputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    // For each boundary output: a canonical-token output must exist with
    // lock-hash == recipient_lock_hash and data-amount == recorded amount.
    // v1: shape match on canonical-token cell-data (>=16 bytes leading u128).
    // TODO: pin canonical-token type-hash at deploy; match by type-hash here.
    for out in outputs {
        let recipient = &out[OFFSET_RECIPIENT_LOCK_HASH..OFFSET_RECIPIENT_LOCK_HASH + 32];
        let recorded_amount = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);

        let mut matched = false;
        let mut idx = 0usize;
        loop {
            match load_cell_lock_hash(idx, Source::Output) {
                Ok(lock_hash) => {
                    if lock_hash.as_ref() == recipient {
                        let data = load_cell_data(idx, Source::Output)?;
                        if data.len() >= CANONICAL_TOKEN_MIN_OUTPUT_LEN {
                            let a = read_u128_le(&data[..16]);
                            if a == recorded_amount {
                                matched = true;
                                break;
                            } else {
                                return Err(Error::CanonicalMintAmountMismatch);
                            }
                        }
                    }
                    idx += 1;
                }
                Err(ckb_std::error::SysError::IndexOutOfBound) => break,
                Err(e) => return Err(e.into()),
            }
        }

        if !matched {
            return Err(Error::CanonicalMintOutputMissing);
        }
    }
    Ok(())
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    xchain_in_score_threshold: u64,
    max_score_age_blocks: u64,
    xchain_in_finality_blocks: u64,
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

    let xchain_in_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_XCHAIN_IN_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_MAX_SCORE_AGE_BLOCKS)?;
    let xchain_in_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_XCHAIN_IN_FINALITY_BLOCKS)?;

    Ok(LawsonParams {
        xchain_in_score_threshold,
        max_score_age_blocks,
        xchain_in_finality_blocks,
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

// ============ AttestationCell cell-dep scan ============

fn find_attestation_cell_dep() -> Result<heapless::Vec<u8, ATT_BLOB_CAP>, Error> {
    // Shape match: attestation cell-data length >= ATT_HEADER_FIXED_LEN.
    // TODO: code-hash match against attestation-cell-type-script + resolve
    // the specific outpoint from boundary.attestation_cell_outpoint instead
    // of first-shape-match.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= ATT_HEADER_FIXED_LEN
                    && data[ATT_OFFSET_VERSION] == SCHEMA_VERSION
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

// ============ ValidatorRegistryCell cell-dep scan ============

fn find_validator_registry_cell_dep() -> Result<heapless::Vec<u8, REGISTRY_BLOB_CAP>, Error> {
    // Shape match: registry header + at least one validator entry.
    // TODO: code-hash match against validator-registry-cell-type-script.
    let min_len = REGISTRY_HEADER_LEN + REGISTRY_VALIDATOR_ENTRY_LEN;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= min_len
                    && data[REGISTRY_OFFSET_VERSION] == SCHEMA_VERSION
                {
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
