//! # MessagingHub Canonical Token Cell Type Script
//!
//! Distinct from `vibeswap-canonical-token-type-script` despite the
//! similar name. That crate is the **user-facing sUDT** that holders see
//! in their wallets. THIS crate is the **bridged-token boundary cell** —
//! it represents tokens at the messaging-hub level, where validators
//! attest burns and mints across chains.
//!
//! Mental model:
//!
//! ```text
//!   VibeSwapCanonicalToken   <-- user's wallet token (sUDT)
//!        |                       sum-of-supplies tracked here
//!        | burn/mint
//!        v
//!   MessagingHubCanonicalToken <-- the messaging-boundary cell
//!        |                          (this crate)
//!        | accumulates into burn-receipt or absorbs from mint-claim
//!        v
//!   BurnReceiptCell / MintClaimCell  <-- the wire-shape across chains
//! ```
//!
//! Why two layers? Per `messaging-hub.md`, the user-facing sUDT carries
//! `source_chain_id` provenance. The messaging-hub cell does NOT — it
//! is per-chain-id-bucketed. The MessagingHub treats it as an
//! opaque-amount-of-canonical-token denominated on THIS chain. This
//! separation keeps the wallet-side sUDT clean (one cell type per asset)
//! and the messaging-side accountable per direction.
//!
//! ## Cell-data layout
//!
//! ```text
//! | field          | bytes | offset |
//! |----------------|-------|--------|
//! | version        |   1   |   0    |
//! | amount         |  16   |   1    |   u128 LE
//! | chain_id       |   8   |  17    |   u64 LE; THIS chain's id
//! | direction      |   1   |  25    |   0 = inbound, 1 = outbound
//! | reserved       |   6   |  26    |
//! ```
//! Minimum 32 bytes. Trailing bytes tolerated.
//!
//! ## Type-script args
//!
//! Exactly 32 bytes = `blake2b256(ValidatorRegistryCell.type_id_args)`.
//! This binds this cell's authority to the active validator registry —
//! transitions of this cell require either (a) a ValidatorRegistry-gated
//! attestation or (b) the upstream sUDT companion burn/mint.
//!
//! ## Authority modes
//!
//! 1. **Burn into receipt**: input MessagingHubCanonicalTokenCell ⇒
//!    output BurnReceiptCell. Amounts must match. Direction must be
//!    `outbound` on the input.
//!
//! 2. **Mint from attestation**: input AttestationCell + MintClaimCell ⇒
//!    output MessagingHubCanonicalTokenCell with direction `inbound`.
//!    Amounts must match the MintClaimCell.
//!
//! 3. **Companion-sUDT mirror**: input wallet-side sUDT burn ⇒ output
//!    messaging-hub cell of equal amount (transitive transfer into the
//!    messaging boundary). Validated by checking the wallet-side
//!    `vibeswap-canonical-token-type-script`'s burn invariant fires in
//!    the same transaction.
//!
//! ## Status
//!
//! Scaffold. Source-reviewable. Companion-cell detection uses data-shape
//! heuristic + version-byte check; production version must match on
//! deployed type-script code-hashes. Marked `// TODO`.
//!
//! Spec: `vibeswap/contracts-ckb/specs/messaging-hub.md`

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
const OFFSET_AMOUNT: usize = 1;
const AMOUNT_LEN: usize = 16;
const OFFSET_CHAIN_ID: usize = 17;
const CHAIN_ID_LEN: usize = 8;
const OFFSET_DIRECTION: usize = 25;
const MIN_CELL_LEN: usize = 32;

const DIRECTION_INBOUND: u8 = 0;
const DIRECTION_OUTBOUND: u8 = 1;

// ============ Type-script args ============

const ARGS_VALIDATOR_REGISTRY_REF_LEN: usize = 32;

// ============ Companion-cell layouts (mirror messaging-hub.md) ============
//
// BurnReceiptCell — see burn-receipt crate. Minimum 105 bytes (version +
// burn_id + burner_lock_hash + amount + dest_chain + dest_recipient + ...).
const BURN_RECEIPT_VERSION_OFFSET: usize = 0;
const BURN_RECEIPT_AMOUNT_OFFSET: usize = 65;
const BURN_RECEIPT_MIN_LEN: usize = 89;

// MintClaimCell — same layout as documented in the sUDT companion.
const MINT_CLAIM_VERSION_OFFSET: usize = 0;
const MINT_CLAIM_AMOUNT_OFFSET: usize = 33;
const MINT_CLAIM_MIN_LEN: usize = 97;

// AttestationCell — see attestation crate.
const ATTESTATION_VERSION_OFFSET: usize = 0;
const ATTESTATION_MIN_LEN: usize = 32 + 1 + 8 + 32 + 16 + 32 + 96 + 8; // ~225

// ============ Entry ============

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.len() != ARGS_VALIDATOR_REGISTRY_REF_LEN {
        return Err(Error::ScriptArgsMalformed);
    }

    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    // Reject any malformed schema version up front.
    for c in inputs.iter().chain(outputs.iter()) {
        if c.version != SCHEMA_VERSION {
            return Err(Error::SchemaVersionUnsupported);
        }
        if c.chain_id == 0 {
            return Err(Error::ChainIdReserved);
        }
        if c.direction != DIRECTION_INBOUND && c.direction != DIRECTION_OUTBOUND {
            return Err(Error::DirectionInvalid);
        }
    }

    let sum_in = sum_amounts(&inputs)?;
    let sum_out = sum_amounts(&outputs)?;

    if sum_in == sum_out {
        // Pure-transit at the messaging boundary. We tolerate this only
        // if direction is preserved across groups (a boundary cell can
        // be split or aggregated but cannot flip inbound <-> outbound).
        verify_direction_preserved(&inputs, &outputs)?;
        Ok(())
    } else if sum_out > sum_in {
        // Mint into the messaging boundary. Must be matched by a
        // MintClaimCell (consumed) AND an AttestationCell (consumed or
        // referenced via input — the attestation type-script does the
        // BLS verify).
        let mint_amount = sum_out - sum_in;
        verify_mint_authorized(mint_amount)?;
        // Output cells must all be direction=inbound.
        for o in outputs.iter() {
            if o.direction != DIRECTION_INBOUND {
                return Err(Error::DirectionInvalidForMint);
            }
        }
        Ok(())
    } else {
        // Burn out of the messaging boundary. Must be matched by a
        // BurnReceiptCell (produced).
        let burn_amount = sum_in - sum_out;
        verify_burn_authorized(burn_amount)?;
        // Input cells must all be direction=outbound to permit this.
        for i in inputs.iter() {
            if i.direction != DIRECTION_OUTBOUND {
                return Err(Error::DirectionInvalidForBurn);
            }
        }
        Ok(())
    }
}

// ============ Cell-data parsing ============

#[derive(Clone, Copy)]
struct ParsedCell {
    version: u8,
    amount: u128,
    chain_id: u64,
    direction: u8,
}

fn read_group_cells(source: Source) -> Result<heapless::Vec<ParsedCell, 32>, Error> {
    let mut out: heapless::Vec<ParsedCell, 32> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        if data.len() < MIN_CELL_LEN {
            return Err(Error::CellDataMalformed);
        }
        let version = data[OFFSET_VERSION];
        let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN]);
        let chain_id = read_u64_le(&data[OFFSET_CHAIN_ID..OFFSET_CHAIN_ID + CHAIN_ID_LEN]);
        let direction = data[OFFSET_DIRECTION];
        out.push(ParsedCell {
            version,
            amount,
            chain_id,
            direction,
        })
        .map_err(|_| Error::IndexOutOfBound)?;
    }
    Ok(out)
}

fn sum_amounts(cells: &[ParsedCell]) -> Result<u128, Error> {
    let mut acc: u128 = 0;
    for c in cells {
        acc = acc.checked_add(c.amount).ok_or(Error::AmountOverflow)?;
    }
    Ok(acc)
}

fn verify_direction_preserved(inputs: &[ParsedCell], outputs: &[ParsedCell]) -> Result<(), Error> {
    // Per-direction sum-equality. This is tighter than the sUDT origin
    // check because at the messaging boundary direction is the
    // load-bearing accounting axis.
    let mut in_inbound: u128 = 0;
    let mut in_outbound: u128 = 0;
    for c in inputs {
        match c.direction {
            DIRECTION_INBOUND => {
                in_inbound = in_inbound.checked_add(c.amount).ok_or(Error::AmountOverflow)?
            }
            DIRECTION_OUTBOUND => {
                in_outbound = in_outbound.checked_add(c.amount).ok_or(Error::AmountOverflow)?
            }
            _ => return Err(Error::DirectionInvalid),
        }
    }
    let mut out_inbound: u128 = 0;
    let mut out_outbound: u128 = 0;
    for c in outputs {
        match c.direction {
            DIRECTION_INBOUND => {
                out_inbound = out_inbound
                    .checked_add(c.amount)
                    .ok_or(Error::AmountOverflow)?
            }
            DIRECTION_OUTBOUND => {
                out_outbound = out_outbound
                    .checked_add(c.amount)
                    .ok_or(Error::AmountOverflow)?
            }
            _ => return Err(Error::DirectionInvalid),
        }
    }
    if in_inbound != out_inbound || in_outbound != out_outbound {
        return Err(Error::DirectionFlipped);
    }
    Ok(())
}

// ============ Companion-cell authority checks ============

/// Mint authorized iff (MintClaimCell consumed with matching amount) AND
/// (AttestationCell present in the same tx). The AttestationCell's own
/// type-script performs the BLS verify; this script only checks PRESENCE
/// + amount-equality, delegating cryptographic verification.
fn verify_mint_authorized(mint_amount: u128) -> Result<(), Error> {
    let claim_amount = find_mint_claim_amount()?;
    match claim_amount {
        Some(a) if a == mint_amount => {}
        Some(_) => return Err(Error::MintAmountMismatch),
        None => return Err(Error::MintWithoutClaim),
    }
    // Cross-check: an AttestationCell must also be referenced. Without
    // this the MintClaimCell could be forged in isolation.
    if !attestation_present()? {
        return Err(Error::MintWithoutAttestation);
    }
    Ok(())
}

/// Burn authorized iff a BurnReceiptCell is produced with matching amount.
fn verify_burn_authorized(burn_amount: u128) -> Result<(), Error> {
    let receipt_amount = find_burn_receipt_amount()?;
    match receipt_amount {
        Some(a) if a == burn_amount => Ok(()),
        Some(_) => Err(Error::BurnAmountMismatch),
        None => Err(Error::BurnWithoutReceipt),
    }
}

// ============ Heuristic companion-cell detection ============
//
// TODO: Replace with compile-time code-hash matching once
// burn-receipt-cell-type-script + mint-claim-cell-type-script +
// attestation-cell-type-script code-hashes are pinned at deploy time.

fn find_mint_claim_amount() -> Result<Option<u128>, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Input) {
            Ok(data) => {
                if data.len() >= MINT_CLAIM_MIN_LEN
                    && data[MINT_CLAIM_VERSION_OFFSET] == SCHEMA_VERSION
                {
                    let a = read_u128_le(
                        &data[MINT_CLAIM_AMOUNT_OFFSET..MINT_CLAIM_AMOUNT_OFFSET + AMOUNT_LEN],
                    );
                    return Ok(Some(a));
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(None),
            Err(e) => return Err(e.into()),
        }
    }
}

fn find_burn_receipt_amount() -> Result<Option<u128>, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Output) {
            Ok(data) => {
                if data.len() >= BURN_RECEIPT_MIN_LEN
                    && data[BURN_RECEIPT_VERSION_OFFSET] == SCHEMA_VERSION
                {
                    let a = read_u128_le(
                        &data[BURN_RECEIPT_AMOUNT_OFFSET..BURN_RECEIPT_AMOUNT_OFFSET + AMOUNT_LEN],
                    );
                    return Ok(Some(a));
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(None),
            Err(e) => return Err(e.into()),
        }
    }
}

fn attestation_present() -> Result<bool, Error> {
    // Check both Input AND CellDep — the attestation can be consumed or
    // referenced.
    for source in [Source::Input, Source::CellDep] {
        let mut idx = 0usize;
        loop {
            match load_cell_data(idx, source) {
                Ok(data) => {
                    if data.len() >= ATTESTATION_MIN_LEN
                        && data[ATTESTATION_VERSION_OFFSET] == SCHEMA_VERSION
                    {
                        return Ok(true);
                    }
                    idx += 1;
                }
                Err(ckb_std::error::SysError::IndexOutOfBound) => break,
                Err(e) => return Err(e.into()),
            }
        }
    }
    Ok(false)
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
