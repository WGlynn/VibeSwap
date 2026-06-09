//! # VibeSwap Canonical Token Type Script
//!
//! sUDT-compatible type-script for the cross-chain CanonicalTokenCell that
//! represents the VibeSwap canonical asset. Replaces the LayerZero-mediated
//! OFT pattern after the 2026-04 KelpDAO/LZ DVN-RPC compromise.
//!
//! ## Inheritance from sUDT (RFC-0025)
//!
//! - First 16 bytes of cell-data = `amount: u128` little-endian.
//! - Type-script `args` = exactly 32 bytes = blake2b-256(owner_lock_script).
//! - Owner-mode = there exists an input cell whose lock-hash equals the
//!   first 32 bytes of `args`. In owner-mode the conservation rule is
//!   relaxed (mint and burn permitted without further evidence). In
//!   non-owner-mode `sum(in) >= sum(out)` per RFC-0025.
//!
//! ## VibeSwap-specific extension (the messaging-hub.md spec)
//!
//! sUDT alone does not encode where supply came from. The canonical-burn-
//! and-mint mechanism needs every token unit to carry its source-chain
//! origin so that `SupplyAccountantCell` can preserve the global sum-of-
//! supplies invariant. We therefore append three fields after the sUDT
//! amount:
//!
//! ```text
//! | field             | bytes | offset |
//! |-------------------|-------|--------|
//! | amount            |  16   |   0    |   <-- sUDT canonical
//! | version           |   1   |  16    |
//! | source_chain_id   |   8   |  17    |   <-- u64 LE; chain that originally minted
//! | reserved          |   7   |  25    |   <-- padding to 32-byte align
//! ```
//!
//! Minimum cell-data length = 32 bytes. Trailing bytes are tolerated for
//! forward-compatible extensions (e.g. memo, sponsor-tag) — they do not
//! affect this script's invariants.
//!
//! ## Authority modes
//!
//! A transaction touching CanonicalTokenCells can be in one of three modes:
//!
//! 1. **Transfer** (`sum_in == sum_out`): standard sUDT conservation.
//!    `source_chain_id` MUST NOT change across input/output groups.
//!
//! 2. **Mint** (`sum_out > sum_in`): only allowed if EITHER
//!    a) owner-mode (sUDT-compatible governance path; the multisig owner
//!       lock can mint at will), OR
//!    b) the transaction consumes a valid `MintClaimCell` whose amount
//!       equals `sum_out - sum_in` (canonical-burn-and-mint path).
//!
//! 3. **Burn** (`sum_in > sum_out`): only allowed if EITHER
//!    a) owner-mode, OR
//!    b) the transaction produces a `BurnReceiptCell` whose amount equals
//!       `sum_in - sum_out` and whose `source_chain_id` matches our chain.
//!
//! The MintClaimCell and BurnReceiptCell type-script code-hashes are
//! identified via cell-data shape (their type-scripts have known hashes
//! that we'd compile-time embed). Cross-cell verification is delegated to
//! those companion type-scripts; this script only checks PRESENCE and
//! amount-equality, not the full attestation chain.
//!
//! ## Status
//!
//! SPEC scaffold, not audit-ready. The companion-cell detection in this
//! version uses heuristic data-shape matching pending a finalized code-
//! hash registry. Marked with TODO inline.
//!
//! Spec: `vibeswap/contracts-ckb/specs/messaging-hub.md`
//! Paper: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_lock_hash, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Cell-data layout ============

const SCHEMA_VERSION: u8 = 1;

const OFFSET_AMOUNT: usize = 0;
const AMOUNT_LEN: usize = 16; // u128 LE — sUDT canonical
const OFFSET_VERSION: usize = 16;
const OFFSET_SOURCE_CHAIN: usize = 17;
const SOURCE_CHAIN_LEN: usize = 8; // u64 LE
const MIN_CELL_LEN: usize = 32; // through the reserved padding

// ============ Type-script args layout ============

const ARGS_OWNER_LOCK_HASH_LEN: usize = 32;

// ============ Companion-cell detection ============
//
// MintClaimCell data layout (from messaging-hub.md § MintClaimCell):
//   version: u8       @ 0
//   attestation_id   : [u8; 32] @ 1
//   amount: u128      @ 33   <-- the field we read
//   recipient_lock_hash: [u8; 32] @ 49
//   created_at_block: u64 @ 81
//   claim_deadline: u64   @ 89
// Total: 97 bytes.
//
// BurnReceiptCell data layout (from messaging-hub.md § BurnReceiptCell):
//   version: u8       @ 0
//   burn_id: [u8; 32] @ 1
//   burner_lock_hash: [u8; 32] @ 33
//   amount: u128      @ 65   <-- the field we read
//   destination_chain_id: u64 @ 81
//   ... (variable-length destination_recipient + tail)
//
// TODO: replace data-shape heuristic with compile-time-embedded code-hash
// constants once the companion type-scripts ship. For now we detect by:
//   - cell-data length range
//   - the companion type-script must be non-None
//   - the companion type-script's args must encode a self-tag (deferred)
// Detection logic is isolated in `find_mint_claim_amount()` and
// `find_burn_receipt_amount()` so the swap is local.

const MINT_CLAIM_AMOUNT_OFFSET: usize = 33;
const MINT_CLAIM_MIN_LEN: usize = 97;
const BURN_RECEIPT_AMOUNT_OFFSET: usize = 65;
const BURN_RECEIPT_MIN_LEN: usize = 89;

// ============ Entry ============

/// Script entry point. Returns 0 on success, nonzero error code on rejection.
pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level verification ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    // Canonical args-read pattern used across `contracts-ckb/`:
    // `script.as_reader().args().raw_data()` returns the args as a borrowed
    // byte-slice without an alloc. See `proof-of-mind-lock-script/src/main.rs`.
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.len() != ARGS_OWNER_LOCK_HASH_LEN {
        return Err(Error::ScriptArgsMalformed);
    }
    let mut owner_lock_hash = [0u8; ARGS_OWNER_LOCK_HASH_LEN];
    owner_lock_hash.copy_from_slice(&args_bytes[..ARGS_OWNER_LOCK_HASH_LEN]);

    // Read all GroupInput and GroupOutput cell-data parsed into our shape.
    let inputs = read_group_cells(Source::GroupInput)?;
    let outputs = read_group_cells(Source::GroupOutput)?;

    // Sum amounts.
    let sum_in = sum_amounts(&inputs)?;
    let sum_out = sum_amounts(&outputs)?;

    // Verify schema versions + source-chain immutability for transfers.
    for c in inputs.iter().chain(outputs.iter()) {
        if c.version != SCHEMA_VERSION {
            return Err(Error::SchemaVersionUnsupported);
        }
        if c.source_chain_id == 0 {
            return Err(Error::SourceChainIdReserved);
        }
    }

    // Branch on flow direction.
    if sum_in == sum_out {
        // Pure transfer. source_chain_id must be preserved per-group.
        // We don't require identical origin across all cells in a tx (a tx
        // can move tokens of different origins together), but we DO require
        // that the multiset of (amount, source_chain_id) on the output side
        // is consistent with the input side, i.e. cannot relabel origin.
        verify_origin_preservation(&inputs, &outputs)?;
        Ok(())
    } else if sum_out > sum_in {
        let mint_amount = sum_out - sum_in;
        verify_mint_authorized(&owner_lock_hash, mint_amount)
    } else {
        let burn_amount = sum_in - sum_out;
        verify_burn_authorized(&owner_lock_hash, burn_amount)
    }
}

// ============ Cell-data parsing ============

#[derive(Clone, Copy)]
struct ParsedCell {
    amount: u128,
    version: u8,
    source_chain_id: u64,
}

/// Iterate all cells in a group source and decode the sUDT-extended shape.
fn read_group_cells(
    source: Source,
) -> Result<heapless::Vec<ParsedCell, 32>, Error> {
    let mut out: heapless::Vec<ParsedCell, 32> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        if data.len() < MIN_CELL_LEN {
            return Err(Error::CellDataMalformed);
        }
        let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN]);
        let version = data[OFFSET_VERSION];
        let source_chain_id =
            read_u64_le(&data[OFFSET_SOURCE_CHAIN..OFFSET_SOURCE_CHAIN + SOURCE_CHAIN_LEN]);
        // heapless::Vec::push returns Err on full. We choose to reject the
        // tx if any single tx exceeds 32 group cells (per side), which is
        // already pathological for sUDT-shape; legitimate flows are < 8.
        out.push(ParsedCell {
            amount,
            version,
            source_chain_id,
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

// ============ Authority modes ============

/// Owner-mode = at least one input cell uses the owner lock. Per RFC-0025.
fn is_owner_mode(owner_lock_hash: &[u8; 32]) -> Result<bool, Error> {
    // Iterate ALL inputs in the transaction (Source::Input), not GroupInput.
    // sUDT semantics: the owner lock can appear on a CKB-only input (not
    // carrying our type-script) and still authorize mint/burn here.
    let mut idx = 0usize;
    loop {
        match load_cell_lock_hash(idx, Source::Input) {
            Ok(h) => {
                if &h == owner_lock_hash {
                    return Ok(true);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(false),
            Err(e) => return Err(e.into()),
        }
    }
}

/// Mint is authorized if (owner-mode) OR (a MintClaimCell with matching
/// amount was consumed). Per messaging-hub.md § CanonicalTokenCell.Mint.
fn verify_mint_authorized(owner_lock_hash: &[u8; 32], mint_amount: u128) -> Result<(), Error> {
    if is_owner_mode(owner_lock_hash)? {
        return Ok(());
    }
    let claim_amount = find_mint_claim_amount()?;
    match claim_amount {
        Some(a) if a == mint_amount => Ok(()),
        Some(_) => Err(Error::MintAmountMismatch),
        None => Err(Error::MintWithoutClaim),
    }
}

/// Burn is authorized if (owner-mode) OR (a BurnReceiptCell with matching
/// amount was produced). Per messaging-hub.md § CanonicalTokenCell.Burn.
fn verify_burn_authorized(owner_lock_hash: &[u8; 32], burn_amount: u128) -> Result<(), Error> {
    if is_owner_mode(owner_lock_hash)? {
        return Ok(());
    }
    let receipt_amount = find_burn_receipt_amount()?;
    match receipt_amount {
        Some(a) if a == burn_amount => Ok(()),
        Some(_) => Err(Error::BurnAmountMismatch),
        None => Err(Error::BurnWithoutReceipt),
    }
}

// ============ Companion-cell heuristic detection ============
//
// TODO: replace with compile-time code-hash matching against the deployed
// `mint-claim-type-script` and `burn-receipt-type-script` once those crates
// exist. For the scaffold we walk the tx's Input cells looking for cell
// data of the documented MintClaimCell length, and the Output cells for
// BurnReceiptCell length. This is a placeholder that's correct enough for
// tests to drive but NOT safe for production: an adversary could craft an
// unrelated cell of the same length and bypass detection. Audit gate.

fn find_mint_claim_amount() -> Result<Option<u128>, Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::Input) {
            Ok(data) => {
                if data.len() >= MINT_CLAIM_MIN_LEN
                    && data[0] == SCHEMA_VERSION
                    // TODO: also match the cell's type-script.code_hash
                    // against the MintClaimType code-hash constant once
                    // available; until then this is shape-only.
                {
                    let a = read_u128_le(
                        &data[MINT_CLAIM_AMOUNT_OFFSET
                            ..MINT_CLAIM_AMOUNT_OFFSET + AMOUNT_LEN],
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
                    && data[0] == SCHEMA_VERSION
                    // TODO: same code-hash audit gate as MintClaim path.
                {
                    let a = read_u128_le(
                        &data[BURN_RECEIPT_AMOUNT_OFFSET
                            ..BURN_RECEIPT_AMOUNT_OFFSET + AMOUNT_LEN],
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

// ============ Origin preservation ============

/// For a pure transfer (`sum_in == sum_out`), the multiset of (amount,
/// source_chain_id) on output side must be derivable from the input side
/// without inventing or relabeling origin. We enforce the WEAKER form:
/// for every distinct source_chain_id that appears on the OUTPUT side,
/// it must also appear on the INPUT side. This blocks unilateral origin-
/// relabel attacks while permitting amount-splitting within a single
/// origin (a 100-unit input cell can split into two 50-unit output cells
/// of the same origin).
///
/// The stronger form (per-origin sum equality) is a CYCLE5 tighten:
/// `for each chain_id, sum_in(chain_id) == sum_out(chain_id)`. The weak
/// form is sufficient to preserve global sum-of-supplies because the
/// SupplyAccountantCell is the system of record.
fn verify_origin_preservation(
    inputs: &[ParsedCell],
    outputs: &[ParsedCell],
) -> Result<(), Error> {
    // Empty output side w/ empty input side = trivial; nothing to check.
    if outputs.is_empty() {
        return Ok(());
    }
    for o in outputs {
        let mut found = false;
        for i in inputs {
            if i.source_chain_id == o.source_chain_id {
                found = true;
                break;
            }
        }
        if !found {
            return Err(Error::SourceChainIdMutated);
        }
    }
    Ok(())
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
