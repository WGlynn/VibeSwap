//! # Datatoken Cell Type Script
//!
//! Enforces conservation + genesis-mint rules for PsiNet datatoken cells
//! (UDT-style, 1:1 with PrimitiveCell).
//!
//! Verifies:
//! - Conservation: `Sum(inputs.amount) >= Sum(outputs.amount)` (allows burn)
//! - Genesis mint: detected via no-input-with-this-type; enforces 1M total
//!   supply with canonical split (850K author / 100K Shapley / 50K LP-seed)
//! - `primitive_type_id` field constant across input/output cells of same group
//!
//! Spec: psinet-ckb-cell-model-canonical-spec.md Section 2.2.
//!
//! Status: SPEC-ONLY scaffold. Not audit-ready. Genesis 3-way split shape
//! check is structural-only; recipient identity checks (correct
//! ShapleyReserveCell address, correct LP-seed cell) are CYCLE5: work.

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, QueryIter},
};

ckb_std::entry!(program_entry);
default_alloc!();

const OFFSET_AMOUNT: usize = 0;
const AMOUNT_LEN: usize = 16; // u128 LE
const OFFSET_PRIMITIVE_ID: usize = 16;
const PRIMITIVE_ID_LEN: usize = 32;
const MIN_CELL_LEN: usize = OFFSET_PRIMITIVE_ID + PRIMITIVE_ID_LEN;

// Genesis distribution (18 decimals)
const GENESIS_TOTAL: u128 = 1_000_000 * 10u128.pow(18);
const GENESIS_AUTHOR: u128 = 850_000 * 10u128.pow(18);
const GENESIS_SHAPLEY: u128 = 100_000 * 10u128.pow(18);
const GENESIS_LP_SEED: u128 = 50_000 * 10u128.pow(18);

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    ConservationViolated = 30,
    GenesisTotalMismatch = 31,
    GenesisOutputCountMismatch = 32,
    GenesisSplitMismatch = 33,
    PrimitiveIdMismatch = 34,
    AmountOverflow = 35,
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

    let mut inputs: heapless::Vec<(u128, [u8; 32]), 16> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, Source::GroupInput) {
        if data.len() < MIN_CELL_LEN {
            return Err(Error::LengthNotEnough);
        }
        let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN]);
        let pid = read_pid(&data);
        let _ = inputs.push((amount, pid));
    }

    let mut outputs: heapless::Vec<(u128, [u8; 32]), 16> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, Source::GroupOutput) {
        if data.len() < MIN_CELL_LEN {
            return Err(Error::LengthNotEnough);
        }
        let amount = read_u128_le(&data[OFFSET_AMOUNT..OFFSET_AMOUNT + AMOUNT_LEN]);
        let pid = read_pid(&data);
        let _ = outputs.push((amount, pid));
    }

    if inputs.is_empty() {
        verify_genesis(&outputs)?;
    } else {
        verify_conservation(&inputs, &outputs)?;
    }

    Ok(())
}

fn verify_genesis(outputs: &[(u128, [u8; 32])]) -> Result<(), Error> {
    if outputs.len() != 3 {
        return Err(Error::GenesisOutputCountMismatch);
    }
    let pid = outputs[0].1;
    for (_amt, p) in outputs {
        if *p != pid {
            return Err(Error::PrimitiveIdMismatch);
        }
    }
    // Sort by amount to allow any output order
    let mut amounts: [u128; 3] = [outputs[0].0, outputs[1].0, outputs[2].0];
    amounts.sort_unstable();
    // Ascending: LP_SEED (50K) < SHAPLEY (100K) < AUTHOR (850K)
    if amounts[0] != GENESIS_LP_SEED
        || amounts[1] != GENESIS_SHAPLEY
        || amounts[2] != GENESIS_AUTHOR
    {
        return Err(Error::GenesisSplitMismatch);
    }
    let total = amounts[0]
        .checked_add(amounts[1])
        .ok_or(Error::AmountOverflow)?
        .checked_add(amounts[2])
        .ok_or(Error::AmountOverflow)?;
    if total != GENESIS_TOTAL {
        return Err(Error::GenesisTotalMismatch);
    }
    // CYCLE5: verify recipient identities (author lock-hash, Shapley reserve
    // type-id, LP-seed cell type-id) against expected values pinned in the
    // PrimitiveCell or governance config.
    Ok(())
}

fn verify_conservation(
    inputs: &[(u128, [u8; 32])],
    outputs: &[(u128, [u8; 32])],
) -> Result<(), Error> {
    // All cells in this group must share a single primitive_type_id
    let pid = inputs[0].1;
    let mut sum_in: u128 = 0;
    for (amt, p) in inputs {
        if *p != pid {
            return Err(Error::PrimitiveIdMismatch);
        }
        sum_in = sum_in.checked_add(*amt).ok_or(Error::AmountOverflow)?;
    }
    let mut sum_out: u128 = 0;
    for (amt, p) in outputs {
        if *p != pid {
            return Err(Error::PrimitiveIdMismatch);
        }
        sum_out = sum_out.checked_add(*amt).ok_or(Error::AmountOverflow)?;
    }
    if sum_out > sum_in {
        return Err(Error::ConservationViolated);
    }
    // CYCLE5: handle `consume()` semantics — witness ConsumeWitness carrying
    // (fire_id, fire_weight, author_sig); when present, fire_weight tokens
    // must flow to a LineageRoyaltyVaultCell matching `pid`.
    Ok(())
}

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_pid(data: &[u8]) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&data[OFFSET_PRIMITIVE_ID..OFFSET_PRIMITIVE_ID + 32]);
    buf
}
