//! # LineageRoyaltyVault Cell Type Script
//!
//! Per-primitive royalty accumulator. Enforces:
//! - `primitive_type_id` constant across the input/output cells of the group
//! - `accumulated_fire_weight` monotone-increases between settlements
//! - On settlement transition (epoch_id increments):
//!     * accumulator resets to zero
//!     * new `shapley_root` provided in cell data
//!     * CRPC-attested witness required (verified via cell-dep witness;
//!       full predicate is CYCLE5)
//!     * lock_period since last_settlement enforces minimum cadence
//!
//! Royalty split contracts (40 / 30 / 20 / 10) are NOT enforced by this
//! script — they live in the off-chain Shapley settlement transaction
//! constructor and are verified by the auditor of the settlement tx.
//! The on-chain script verifies the structural conservation only.
//!
//! Spec: psinet-ckb-cell-model-canonical-spec.md Section 2.3.
//!
//! Status: SPEC-ONLY scaffold. Not audit-ready.

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script},
};

ckb_std::entry!(program_entry);
default_alloc!();

const OFFSET_PRIMITIVE_ID: usize = 0;
const OFFSET_ACCUM: usize = 32;
const OFFSET_LAST_SETTLEMENT: usize = 48;
const OFFSET_EPOCH_ID: usize = 56;
const OFFSET_SHAPLEY_ROOT: usize = 60;
const MIN_CELL_LEN: usize = OFFSET_SHAPLEY_ROOT + 32;

// Minimum seconds between settlements (1 week).
const MIN_SETTLEMENT_INTERVAL_SECS: u64 = 7 * 24 * 60 * 60;

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    PrimitiveIdMutated = 40,
    AccumDecreasedWithoutSettlement = 41,
    SettlementCadenceTooFast = 42,
    EpochMonotonicityViolated = 43,
    SettlementAccumNotZeroed = 44,
}

impl From<ckb_std::error::SysError> for Error {
    fn from(err: ckb_std::error::SysError) -> Self {
        use ckb_std::error::SysError::*;
        match err {
            IndexOutOfBound => Self::IndexOutOfBound,
            ItemMissing => Self::ItemMissing,
            LengthNotEnough(_) => Self::LengthNotEnough,
            Encoding => Self::Encoding,
            _ => Self::Encoding,
        }
    }
}

/// Script entry point. Returns 0 on success, nonzero error code on rejection.
pub fn program_entry() -> i8 {
    match verify() {
        Ok(_) => 0,
        Err(e) => e as i8,
    }
}

fn verify() -> Result<(), Error> {
    let _script = load_script()?;

    // Vault is a singleton-per-primitive cell. Group should have exactly one
    // output. If a transition (input present), enforce transition rules.
    let next = load_cell_data(0, Source::GroupOutput).map_err(Error::from)?;
    if next.len() < MIN_CELL_LEN {
        return Err(Error::LengthNotEnough);
    }

    match load_cell_data(0, Source::GroupInput) {
        Ok(prev) => {
            if prev.len() < MIN_CELL_LEN {
                return Err(Error::LengthNotEnough);
            }
            validate_transition(&prev, &next)?;
        }
        Err(_) => {
            // Genesis creation. Validated by primitive author's signature
            // via the lock script; this type script accepts the genesis cell
            // as-is, provided structural fields are well-formed.
        }
    }
    Ok(())
}

fn validate_transition(prev: &[u8], next: &[u8]) -> Result<(), Error> {
    // Primitive id immutable
    if prev[OFFSET_PRIMITIVE_ID..OFFSET_PRIMITIVE_ID + 32]
        != next[OFFSET_PRIMITIVE_ID..OFFSET_PRIMITIVE_ID + 32]
    {
        return Err(Error::PrimitiveIdMutated);
    }
    let prev_accum = read_u128(&prev[OFFSET_ACCUM..OFFSET_ACCUM + 16]);
    let next_accum = read_u128(&next[OFFSET_ACCUM..OFFSET_ACCUM + 16]);
    let prev_last = read_u64(&prev[OFFSET_LAST_SETTLEMENT..OFFSET_LAST_SETTLEMENT + 8]);
    let next_last = read_u64(&next[OFFSET_LAST_SETTLEMENT..OFFSET_LAST_SETTLEMENT + 8]);
    let prev_epoch = read_u32(&prev[OFFSET_EPOCH_ID..OFFSET_EPOCH_ID + 4]);
    let next_epoch = read_u32(&next[OFFSET_EPOCH_ID..OFFSET_EPOCH_ID + 4]);

    if next_epoch == prev_epoch {
        // Accumulation-only transition: epoch unchanged, accum may only grow
        if next_accum < prev_accum {
            return Err(Error::AccumDecreasedWithoutSettlement);
        }
        if next_last != prev_last {
            return Err(Error::SettlementCadenceTooFast);
        }
    } else {
        // Settlement transition
        if next_epoch != prev_epoch + 1 {
            return Err(Error::EpochMonotonicityViolated);
        }
        if next_accum != 0 {
            return Err(Error::SettlementAccumNotZeroed);
        }
        if next_last < prev_last + MIN_SETTLEMENT_INTERVAL_SECS {
            return Err(Error::SettlementCadenceTooFast);
        }
        // CYCLE5: verify CRPC TaskSettled witness in WitnessArgs.input_type
        // attesting the new shapley_root + lineage depth-5 walk integrity.
    }
    Ok(())
}

fn read_u128(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u64(b: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&b[..8]);
    u64::from_le_bytes(buf)
}

fn read_u32(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}
