//! # Cross-Chain Out Boundary Cell Type Script
//!
//! Authorizes outbound canonical-token burn-and-mint emission per
//! `specs/nci-boundary-enforcement.md` §2.8. Same-tx companion to
//! `messaging-hub-burn-receipt-cell-type-script` and the
//! canonical-token-cell burn invariant.
//!
//! ## Cell-data layout (Molecule fixed-struct, little-endian)
//!
//! | field                     | bytes | offset |
//! |---------------------------|-------|--------|
//! | version                   |   1   |   0    |
//! | dest_chain_id             |   8   |   1    |   u64 LE
//! | dest_recipient_lock_hash  |  32   |   9    |
//! | amount                    |  16   |  41    |   u128 LE
//! | burn_id                   |   8   |  57    |   u64 LE; unique per burn
//! | inclusion_height          |   8   |  65    |   u64 LE
//!
//! Total fixed size: 73 bytes.

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
const OFFSET_DEST_CHAIN_ID: usize = 1;
const OFFSET_DEST_RECIPIENT_LOCK_HASH: usize = 9;
const OFFSET_AMOUNT: usize = 41;
const OFFSET_BURN_ID: usize = 57;
const OFFSET_INCLUSION_HEIGHT: usize = 65;
const CELL_DATA_LEN: usize = 73;

// ============ Type-script args ============

// args = own type-hash; discriminates sibling CrossChainOutBoundaryCells in
// cell-dep scans for §2.8 burn_id replay prevention.
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
// TODO: blake2b("xchain_out.*") at compile time.
const LAWSON_NAME_XCHAIN_OUT_SCORE_THRESHOLD: [u8; 32] = [0x30; 32];
const LAWSON_NAME_XCHAIN_OUT_MAX_SCORE_AGE: [u8; 32] = [0x31; 32];
const LAWSON_NAME_XCHAIN_OUT_FINALITY_BLOCKS: [u8; 32] = [0x32; 32];
// Variadic supported-dest-chains list: stored as a single Lawson entry whose
// 16-byte "value" is the count, with the chain-id array packed in a tail.
// TODO: switch to a dedicated registry cell once cross-chain catalog grows.
const LAWSON_NAME_SUPPORTED_DEST_CHAINS: [u8; 32] = [0x33; 32];

// ============ Burn-receipt companion layout (mirrors burn-receipt crate) ============

const BR_OFFSET_VERSION: usize = 0;
const BR_OFFSET_BURN_ID_HASH: usize = 1;
const BR_OFFSET_BURNER_LOCK_HASH: usize = 33;
const BR_OFFSET_AMOUNT: usize = 65;
const BR_OFFSET_DEST_CHAIN_ID: usize = 81;
const BR_OFFSET_SOURCE_CHAIN_ID: usize = 89;
const BR_OFFSET_BURN_BLOCK_HEIGHT: usize = 97;
const BR_OFFSET_DEST_RECIPIENT: usize = 105;
const BR_MIN_CELL_LEN: usize = BR_OFFSET_DEST_RECIPIENT;

// Messaging-hub canonical-token layout — burn observed as net-decrease in
// these cells across the tx (sibling crate's direction model).
const MHCT_OFFSET_VERSION: usize = 0;
const MHCT_OFFSET_AMOUNT: usize = 1;
const MHCT_MIN_LEN: usize = 32;

// ============ Heapless caps ============

const LAWSON_BLOB_CAP: usize = 8192;
const NCI_BLOB_CAP: usize = 256;
const MAX_OUT_OUTPUTS: usize = 16;
const MAX_SUPPORTED_DEST_CHAINS: usize = 32;

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
        // Emission: burn-and-mint outbound. Full §2.8 invariant set.
        (true, false) => verify_emission(&outputs, &own_type_hash),
        // Archival: receipt-side has consumed its commitment; the boundary
        // cell can be reaped after finality elapses.
        (false, true) => verify_archive(&inputs),
        // In-place mutation forbidden — emissions are immutable evidence.
        (false, false) => Err(Error::CellMultiplicityMismatch),
    }
}

// ============ Read group cells ============

fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, MAX_OUT_OUTPUTS>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, MAX_OUT_OUTPUTS> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Emission path ============

fn verify_emission(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    for out in outputs {
        verify_layout(out)?;
    }
    verify_burn_ids_distinct_within_tx(outputs)?;

    // §2.8 invariant 1+2: NCI authorization gate.
    let nci = find_nci_score_cell_dep()?;
    let score = read_u32_le(&nci[NCI_OFFSET_SCORE..NCI_OFFSET_SCORE + 4]);
    let nci_inclusion =
        read_u64_le(&nci[NCI_OFFSET_INCLUSION_HEIGHT..NCI_OFFSET_INCLUSION_HEIGHT + 8]);

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;

    if (score as u64) < lp.xchain_out_score_threshold {
        return Err(Error::NciScoreBelowThreshold);
    }

    // Freshness gate.
    let tip = read_tip_height_proxy()?;
    if tip.saturating_sub(nci_inclusion) > lp.max_score_age_blocks {
        return Err(Error::NciScoreStale);
    }
    // TODO: load_header on PoWAnchorCell header-dep for authoritative tip.

    // §2.8 invariant 6: destination-chain sanity against Lawson list.
    for out in outputs {
        let dest = read_u64_le(&out[OFFSET_DEST_CHAIN_ID..OFFSET_DEST_CHAIN_ID + 8]);
        if dest == 0 {
            return Err(Error::DestChainIdReserved);
        }
        if !lp.supported_dest_chains.contains(&dest) {
            return Err(Error::DestChainNotSupported);
        }
    }

    // §2.8 invariant 4: burn_id uniqueness across already-emitted siblings.
    verify_no_replay(outputs, own_type_hash)?;

    // §2.8 invariant 3: same-tx canonical-token burn + matching BurnReceiptCell.
    verify_canonical_burn_and_receipt(outputs)?;

    // Inclusion-height sanity. Future-dated emissions would game finality.
    for out in outputs {
        let h = read_u64_le(&out[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if h > tip {
            return Err(Error::InclusionHeightInFuture);
        }
    }

    Ok(())
}

// ============ Archive path (consume) ============

fn verify_archive(inputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    for inp in inputs {
        verify_layout(inp)?;
    }

    let lawson = find_lawson_cell_dep()?;
    let lp = parse_lawson_params(&lawson)?;
    let tip = read_tip_height_proxy()?;

    // REORG §6: outbound emission is withdrawal-class for finality purposes —
    // archival before finality risks reorg-rollback of a credited burn.
    for inp in inputs {
        let inclusion =
            read_u64_le(&inp[OFFSET_INCLUSION_HEIGHT..OFFSET_INCLUSION_HEIGHT + 8]);
        if tip.saturating_sub(inclusion) < lp.xchain_out_finality_blocks {
            return Err(Error::InclusionHeightInFuture);
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
    let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);
    if amount == 0 {
        return Err(Error::ZeroAmount);
    }
    let burn_id = read_u64_le(&data[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);
    if burn_id == 0 {
        return Err(Error::ZeroBurnId);
    }
    Ok(())
}

// ============ Replay prevention ============

fn verify_burn_ids_distinct_within_tx(outputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    // Catch collisions before scanning cell-deps; cheaper failure.
    for (i, a) in outputs.iter().enumerate() {
        let ai = read_u64_le(&a[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);
        for b in outputs.iter().skip(i + 1) {
            let bi = read_u64_le(&b[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);
            if ai == bi {
                return Err(Error::BurnIdDuplicateWithinTx);
            }
        }
    }
    Ok(())
}

fn verify_no_replay(
    outputs: &[alloc::vec::Vec<u8>],
    own_type_hash: &[u8; 32],
) -> Result<(), Error> {
    // Sibling CrossChainOutBoundaryCells visible as cell-deps assert which
    // burn_ids are already used; any collision is a replay attempt.
    let mut idx = 0usize;
    loop {
        match load_cell_type_hash(idx, Source::CellDep) {
            Ok(Some(th)) if &th == own_type_hash => {
                let data = load_cell_data(idx, Source::CellDep)?;
                if data.len() < CELL_DATA_LEN {
                    return Err(Error::CellDataMalformed);
                }
                let existing_burn_id =
                    read_u64_le(&data[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);
                for out in outputs {
                    let new_burn_id =
                        read_u64_le(&out[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);
                    if existing_burn_id == new_burn_id {
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

// ============ Canonical burn + companion BurnReceiptCell ============

fn verify_canonical_burn_and_receipt(
    outputs: &[alloc::vec::Vec<u8>],
) -> Result<(), Error> {
    // Sum requested emissions, then verify (a) net canonical-token burn in
    // the tx covers it and (b) a same-tx BurnReceiptCell exists per emission
    // with matching (amount, dest_chain_id, dest_recipient_lock_hash) and a
    // burn_id_hash containing this u64 burn_id as its low-8 bytes.
    let mut total_amount: u128 = 0;
    for out in outputs {
        let a = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);
        total_amount = total_amount.checked_add(a).ok_or(Error::AmountOverflow)?;
    }

    let observed_burn = observed_canonical_burn()?;
    if observed_burn == 0 {
        return Err(Error::CanonicalBurnAbsent);
    }
    if observed_burn != total_amount {
        return Err(Error::CanonicalBurnAmountMismatch);
    }

    for out in outputs {
        verify_burn_receipt_match(out)?;
    }

    Ok(())
}

fn observed_canonical_burn() -> Result<u128, Error> {
    // Net-decrease of messaging-hub canonical-token cells across the tx.
    // TODO: filter by canonical-token code-hash once pinned; v1 uses shape.
    let in_sum = sum_canonical_tokens(Source::Input)?;
    let out_sum = sum_canonical_tokens(Source::Output)?;
    if in_sum < out_sum {
        // Net mint, not burn — disallowed at the outbound boundary.
        return Err(Error::CanonicalBurnAbsent);
    }
    Ok(in_sum - out_sum)
}

fn sum_canonical_tokens(source: Source) -> Result<u128, Error> {
    let mut acc: u128 = 0;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(data) => {
                if data.len() >= MHCT_MIN_LEN
                    && data[MHCT_OFFSET_VERSION] == SCHEMA_VERSION
                    && data.len() < BR_MIN_CELL_LEN
                {
                    let a = read_u128_le(
                        &data[MHCT_OFFSET_AMOUNT..MHCT_OFFSET_AMOUNT + 16],
                    );
                    acc = acc.checked_add(a).ok_or(Error::AmountOverflow)?;
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(acc),
            Err(e) => return Err(e.into()),
        }
    }
}

fn verify_burn_receipt_match(out: &[u8]) -> Result<(), Error> {
    let want_amount = read_u128_le(&out[OFFSET_AMOUNT..OFFSET_AMOUNT + 16]);
    let want_dest = read_u64_le(&out[OFFSET_DEST_CHAIN_ID..OFFSET_DEST_CHAIN_ID + 8]);
    let want_recipient =
        &out[OFFSET_DEST_RECIPIENT_LOCK_HASH..OFFSET_DEST_RECIPIENT_LOCK_HASH + 32];
    let want_burn_id_u64 = read_u64_le(&out[OFFSET_BURN_ID..OFFSET_BURN_ID + 8]);

    // BurnReceiptCells are tx outputs (creation-mode in their crate); scan.
    // TODO: filter by burn-receipt code-hash once pinned.
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= BR_MIN_CELL_LEN
                    && data[BR_OFFSET_VERSION] == SCHEMA_VERSION
                {
                    let br_amount =
                        read_u128_le(&data[BR_OFFSET_AMOUNT..BR_OFFSET_AMOUNT + 16]);
                    let br_dest =
                        read_u64_le(&data[BR_OFFSET_DEST_CHAIN_ID..BR_OFFSET_DEST_CHAIN_ID + 8]);
                    let br_burn_id_hash =
                        &data[BR_OFFSET_BURN_ID_HASH..BR_OFFSET_BURN_ID_HASH + 32];
                    // Burn-id binding: our 8-byte burn_id lives in the low
                    // bytes of the receipt's 32-byte burn_id hash preimage.
                    // TODO: tighten to full blake2b(src_chain, sender, nonce).
                    let br_burn_id_u64 = read_u64_le(&br_burn_id_hash[..8]);
                    if br_amount == want_amount
                        && br_dest == want_dest
                        && br_burn_id_u64 == want_burn_id_u64
                    {
                        // Recipient match: the receipt's dest_recipient tail
                        // must start with our 32-byte lock-hash.
                        if data.len() < BR_OFFSET_DEST_RECIPIENT + 32 {
                            return Err(Error::BurnReceiptRecipientMismatch);
                        }
                        let br_recipient = &data
                            [BR_OFFSET_DEST_RECIPIENT..BR_OFFSET_DEST_RECIPIENT + 32];
                        if br_recipient != want_recipient {
                            return Err(Error::BurnReceiptRecipientMismatch);
                        }
                        // Side checks the receipt's own type-script catches
                        // (source_chain_id != 0, etc) are not duplicated.
                        let _ = data[BR_OFFSET_BURNER_LOCK_HASH];
                        let _ = read_u64_le(
                            &data[BR_OFFSET_SOURCE_CHAIN_ID..BR_OFFSET_SOURCE_CHAIN_ID + 8],
                        );
                        let _ = read_u64_le(
                            &data
                                [BR_OFFSET_BURN_BLOCK_HEIGHT..BR_OFFSET_BURN_BLOCK_HEIGHT + 8],
                        );
                        return Ok(());
                    }
                    // Continue: a non-matching candidate may still be a
                    // receipt for another emission in the same tx.
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        }
    }

    // We saw amount-or-dest-conflicting receipts but no full match.
    // Distinguish "no receipt at all" from "wrong receipt" for ops clarity.
    if any_receipt_for_dest(want_dest)? {
        if any_receipt_for_amount(want_amount)? {
            Err(Error::BurnReceiptBurnIdMismatch)
        } else {
            Err(Error::BurnReceiptAmountMismatch)
        }
    } else if any_receipt_present()? {
        Err(Error::BurnReceiptDestChainMismatch)
    } else {
        Err(Error::BurnReceiptAbsent)
    }
}

fn any_receipt_present() -> Result<bool, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= BR_MIN_CELL_LEN
                    && data[BR_OFFSET_VERSION] == SCHEMA_VERSION
                {
                    return Ok(true);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(false),
            Err(e) => return Err(e.into()),
        }
    }
}

fn any_receipt_for_dest(dest: u64) -> Result<bool, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= BR_MIN_CELL_LEN
                    && data[BR_OFFSET_VERSION] == SCHEMA_VERSION
                {
                    let br_dest = read_u64_le(
                        &data[BR_OFFSET_DEST_CHAIN_ID..BR_OFFSET_DEST_CHAIN_ID + 8],
                    );
                    if br_dest == dest {
                        return Ok(true);
                    }
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(false),
            Err(e) => return Err(e.into()),
        }
    }
}

fn any_receipt_for_amount(amount: u128) -> Result<bool, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= BR_MIN_CELL_LEN
                    && data[BR_OFFSET_VERSION] == SCHEMA_VERSION
                {
                    let a = read_u128_le(&data[BR_OFFSET_AMOUNT..BR_OFFSET_AMOUNT + 16]);
                    if a == amount {
                        return Ok(true);
                    }
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(false),
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Lawson cell-dep scan ============

struct LawsonParams {
    xchain_out_score_threshold: u64,
    max_score_age_blocks: u64,
    xchain_out_finality_blocks: u64,
    supported_dest_chains: heapless::Vec<u64, MAX_SUPPORTED_DEST_CHAINS>,
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

    let xchain_out_score_threshold =
        lookup_lawson_u64(data, count, &LAWSON_NAME_XCHAIN_OUT_SCORE_THRESHOLD)?;
    let max_score_age_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_XCHAIN_OUT_MAX_SCORE_AGE)?;
    let xchain_out_finality_blocks =
        lookup_lawson_u64(data, count, &LAWSON_NAME_XCHAIN_OUT_FINALITY_BLOCKS)?;

    let supported_dest_chains = lookup_supported_chains(data, count, expected)?;

    Ok(LawsonParams {
        xchain_out_score_threshold,
        max_score_age_blocks,
        xchain_out_finality_blocks,
        supported_dest_chains,
    })
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

fn lookup_supported_chains(
    data: &[u8],
    count: usize,
    fixed_end: usize,
) -> Result<heapless::Vec<u64, MAX_SUPPORTED_DEST_CHAINS>, Error> {
    // The list lives as a sentinel entry whose "value" is the count and whose
    // u64 chain-ids follow the fixed-section tail. Keeps the schema additive.
    let mut chains: heapless::Vec<u64, MAX_SUPPORTED_DEST_CHAINS> = heapless::Vec::new();

    let mut list_count: Option<u64> = None;
    for i in 0..count {
        let base = LAWSON_REGISTRY_HEADER_LEN + i * LAWSON_CONSTANT_ENTRY_LEN;
        if &data[base..base + 32] == &LAWSON_NAME_SUPPORTED_DEST_CHAINS {
            let v = read_u128_le(&data[base + 32..base + 48]);
            if v > MAX_SUPPORTED_DEST_CHAINS as u128 {
                return Err(Error::CapacityExceeded);
            }
            list_count = Some(v as u64);
            break;
        }
    }
    let n = list_count.ok_or(Error::LawsonCellDepMissing)? as usize;
    if data.len() < fixed_end + n * 8 {
        return Err(Error::LawsonCellDepMissing);
    }
    for i in 0..n {
        let off = fixed_end + i * 8;
        let id = read_u64_le(&data[off..off + 8]);
        chains.push(id).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(chains)
}

// ============ NCI cell-dep scan ============

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

// ============ Tip-height proxy ============

fn read_tip_height_proxy() -> Result<u64, Error> {
    // TODO: load_header(Source::HeaderDep) on PoWAnchorCell for authoritative tip.
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
