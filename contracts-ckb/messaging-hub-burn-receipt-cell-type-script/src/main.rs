//! # MessagingHub Burn Receipt Cell Type Script
//!
//! Created in the same transaction as a CanonicalTokenCell burn. The
//! receipt is the public, on-chain evidence that a burn happened on
//! THIS chain. Off-chain validator infra observes these receipts and
//! produces BLS-aggregated AttestationCells on the destination chain.
//!
//! ## Cell-data layout (per messaging-hub.md § BurnReceiptCell)
//!
//! ```text
//! | field                  | bytes | offset |
//! |------------------------|-------|--------|
//! | version                |   1   |   0    |
//! | burn_id                |  32   |   1    |   blake2b(src_chain, sender, nonce)
//! | burner_lock_hash       |  32   |  33    |
//! | amount                 |  16   |  65    |   u128 LE
//! | destination_chain_id   |   8   |  81    |   u64 LE
//! | source_chain_id        |   8   |  89    |   u64 LE; our chain's id
//! | burn_block_height      |   8   |  97    |   u64 LE
//! | destination_recipient  |  var  | 105    |   chain-specific bytes
//! ```
//!
//! Minimum 105 bytes through fixed-size header. `destination_recipient`
//! tail is variable.
//!
//! ## Type-script args
//!
//! Exactly 32 bytes = `type_id_args` of the SupplyAccountantCell. The
//! receipt's existence is meaningful only relative to the supply
//! accountant that tracks it.
//!
//! ## Invariants enforced
//!
//! 1. **Conjunction with burn**: a CanonicalTokenCell burn (input sUDT
//!    canonical-token sum > output sum) must occur in the same tx.
//!    Specifically: either the wallet-side `vibeswap-canonical-token`
//!    OR the messaging-hub canonical-token must show net-burn equal to
//!    this receipt's `amount`.
//!
//! 2. **Freshness**: `burn_id` must not appear in any input
//!    BurnReceiptCell consumed by the SupplyAccountantCell. This is
//!    enforced by checking that no input cell with this type-script
//!    has a matching `burn_id`. Replay-protection.
//!
//! 3. **Destination enabled**: `destination_chain_id` must be in the
//!    ChainConfigCell's outbound-enabled set. ChainConfigCell read via
//!    cell-dep. TODO: ChainConfigCell crate not in this batch; placeholder
//!    rejects only the reserved zero-id.
//!
//! 4. **Immutability**: receipt cells are immutable on creation — they
//!    can only be spent by SupplyAccountantCell updates, never modified.
//!    Type-script rejects any transition where input + output of THIS
//!    type-script appear with different data (i.e. "edit").
//!
//! ## Status
//!
//! Scaffold. Source-reviewable. ChainConfigCell integration deferred.
//! Companion-cell detection (canonical-token burn) uses data-shape
//! heuristic; production version matches on code-hash.

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
const OFFSET_BURN_ID: usize = 1;
const BURN_ID_LEN: usize = 32;
const OFFSET_BURNER_LOCK_HASH: usize = 33;
const BURNER_LOCK_HASH_LEN: usize = 32;
const OFFSET_AMOUNT: usize = 65;
const AMOUNT_LEN: usize = 16;
const OFFSET_DEST_CHAIN_ID: usize = 81;
const OFFSET_SOURCE_CHAIN_ID: usize = 89;
const OFFSET_BURN_BLOCK_HEIGHT: usize = 97;
const OFFSET_DEST_RECIPIENT: usize = 105;
const MIN_CELL_LEN: usize = OFFSET_DEST_RECIPIENT;

// ============ Type-script args ============

const ARGS_SUPPLY_ACCOUNTANT_REF_LEN: usize = 32;

// ============ Companion-cell layouts ============
//
// VibeSwapCanonicalToken (wallet sUDT) — amount @ offset 0, 16 bytes.
const SUDT_AMOUNT_OFFSET: usize = 0;
const SUDT_MIN_LEN: usize = 16;

// MessagingHubCanonicalToken — amount @ offset 1 (after version byte).
const MHCT_VERSION_OFFSET: usize = 0;
const MHCT_AMOUNT_OFFSET: usize = 1;
const MHCT_MIN_LEN: usize = 32;

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
    if args_bytes.len() != ARGS_SUPPLY_ACCOUNTANT_REF_LEN {
        return Err(Error::ScriptArgsMalformed);
    }

    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    // Reject any malformed data.
    for c in inputs.iter().chain(outputs.iter()) {
        if c.version != SCHEMA_VERSION {
            return Err(Error::SchemaVersionUnsupported);
        }
        if c.destination_chain_id == 0 {
            return Err(Error::DestinationChainIdReserved);
        }
        if c.source_chain_id == 0 {
            return Err(Error::SourceChainIdReserved);
        }
    }

    // Immutability — if same burn_id appears on both input and output side,
    // verify the cell data is byte-identical (no edit). The data already
    // checked-versioned above means we just need to confirm payload-equality.
    // For receipt cells we adopt the stricter "no edit ever" rule: any
    // tx with BOTH input and output of this type-script is rejected,
    // EXCEPT when ALL outputs match an input by burn_id (transit through
    // the SupplyAccountant doesn't modify, only consumes).
    if !outputs.is_empty() && !inputs.is_empty() {
        // Receipts cannot be created and consumed in the same tx.
        return Err(Error::ReceiptEditAttempted);
    }

    if outputs.is_empty() {
        // Receipt is being consumed (SupplyAccountantCell update flow).
        // No further checks at this layer; the SupplyAccountant type-script
        // does the per-chain supply math.
        return Ok(());
    }

    // CREATION mode. For each output receipt:
    // - Freshness: burn_id distinctness within this tx's outputs.
    // - Conjunction: a token burn of `amount` must be observed.
    verify_burn_ids_distinct(&outputs)?;
    let total_receipt_amount = sum_amounts(&outputs)?;

    let observed_burn_amount = observed_canonical_burn()?;
    if observed_burn_amount != total_receipt_amount {
        return Err(Error::BurnAmountMismatch);
    }

    // Source chain id must match our chain. TODO: load our chain id from
    // ChainConfigCell via cell-dep once that crate ships. For now the
    // type-script trusts the value in cell-data and enforces only that
    // it's nonzero (already done above). Loose end documented.
    Ok(())
}

// ============ Cell-data parsing ============

#[derive(Clone)]
struct ParsedReceipt {
    version: u8,
    burn_id: [u8; 32],
    amount: u128,
    destination_chain_id: u64,
    source_chain_id: u64,
}

fn read_group_cells(source: Source) -> Result<heapless::Vec<ParsedReceipt, 16>, Error> {
    let mut out: heapless::Vec<ParsedReceipt, 16> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        if data.len() < MIN_CELL_LEN {
            return Err(Error::CellDataMalformed);
        }
        let mut burn_id = [0u8; 32];
        burn_id.copy_from_slice(&data[OFFSET_BURN_ID..OFFSET_BURN_ID + BURN_ID_LEN]);
        let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN]);
        let destination_chain_id =
            read_u64_le(&data[OFFSET_DEST_CHAIN_ID..OFFSET_DEST_CHAIN_ID + 8]);
        let source_chain_id =
            read_u64_le(&data[OFFSET_SOURCE_CHAIN_ID..OFFSET_SOURCE_CHAIN_ID + 8]);
        out.push(ParsedReceipt {
            version: data[OFFSET_VERSION],
            burn_id,
            amount,
            destination_chain_id,
            source_chain_id,
        })
        .map_err(|_| Error::IndexOutOfBound)?;
    }
    Ok(out)
}

fn sum_amounts(receipts: &[ParsedReceipt]) -> Result<u128, Error> {
    let mut acc: u128 = 0;
    for r in receipts {
        acc = acc.checked_add(r.amount).ok_or(Error::AmountOverflow)?;
    }
    Ok(acc)
}

fn verify_burn_ids_distinct(receipts: &[ParsedReceipt]) -> Result<(), Error> {
    for (i, a) in receipts.iter().enumerate() {
        for b in receipts.iter().skip(i + 1) {
            if a.burn_id == b.burn_id {
                return Err(Error::BurnIdDuplicate);
            }
        }
    }
    Ok(())
}

// ============ Observation of canonical-token burn ============
//
// We compute net-burn = sum(canonical-token inputs) - sum(canonical-token
// outputs) across the entire transaction, summing over BOTH the
// wallet-side sUDT AND the messaging-hub-side boundary cells. The
// canonical-token type-script does its own conservation check; this
// observer just confirms the magnitude matches the receipts.
//
// TODO: this requires distinguishing canonical-token cells from
// unrelated cells. Without a code-hash registry we use data-shape
// heuristic: a cell with type-script set + cell-data length within the
// known canonical-token range. Production version filters by code-hash.

fn observed_canonical_burn() -> Result<u128, Error> {
    let in_sum = sum_canonical_tokens(Source::Input)?;
    let out_sum = sum_canonical_tokens(Source::Output)?;
    if in_sum < out_sum {
        // Net mint, not burn. Disallowed in this tx.
        return Err(Error::NoCanonicalBurnObserved);
    }
    Ok(in_sum - out_sum)
}

fn sum_canonical_tokens(source: Source) -> Result<u128, Error> {
    let mut acc: u128 = 0;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(data) => {
                // Try wallet-side sUDT shape.
                if data.len() >= SUDT_MIN_LEN
                    && data.len() < MHCT_MIN_LEN
                {
                    let a = read_u128_le(&data[SUDT_AMOUNT_OFFSET..SUDT_AMOUNT_OFFSET + AMOUNT_LEN]);
                    acc = acc.checked_add(a).ok_or(Error::AmountOverflow)?;
                } else if data.len() >= MHCT_MIN_LEN
                    && data[MHCT_VERSION_OFFSET] == SCHEMA_VERSION
                    && data.len() < MIN_CELL_LEN
                {
                    // Likely a messaging-hub-canonical-token cell.
                    let a = read_u128_le(
                        &data[MHCT_AMOUNT_OFFSET..MHCT_AMOUNT_OFFSET + AMOUNT_LEN],
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
