//! # EscrowVault Cell Type Script
//!
//! Bond + slash primitive for honest-attestation. Stakes JUL against claims
//! (citation / fire-weight / lineage-parent); bond slashable on CRPC dispute
//! loss.
//!
//! Verifies:
//! - `bond_amount_jul >= MIN_BOND_JUL` (structural floor; tier curve lives
//!   off-chain in v1, per Agent G Cycle 3 decision)
//! - Identity fields (task_id, staker, bond_amount, posted_at) immutable
//! - State transitions:
//!     POSTED -> RELEASED: requires now >= posted_at + lock_period AND
//!         CRPC TaskSettled witness with `staker` in winners[]
//!     POSTED -> SLASHED: requires CRPC TaskSettled witness with `staker`
//!         NOT in winners[]; routes bond to disputer-bounty + treasury
//!         (split capped at MAX_DISPUTER_BOUNTY_BPS = 5000)
//!
//! Spec: psinet-ckb-cell-model-canonical-spec.md Section 2.4.
//!
//! Status: SPEC-ONLY scaffold. The CRPC witness verification is `CYCLE5:`
//! pending the canonical witness schema across substrates. Until that lands,
//! state transitions verify structural shape but not authenticity.

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script},
};

ckb_std::entry!(program_entry);
default_alloc!();

const OFFSET_TASK_ID: usize = 0;
const OFFSET_STAKER: usize = 32;
const OFFSET_BOND_AMOUNT: usize = 64;
const OFFSET_POSTED_AT: usize = 80;
const OFFSET_LOCK_PERIOD: usize = 88;
const OFFSET_STATE: usize = 92;
const MIN_CELL_LEN: usize = OFFSET_STATE + 1;

const STATE_POSTED: u8 = 1;
const STATE_RELEASED: u8 = 2;
const STATE_SLASHED: u8 = 3;

// Structural floor; production value comes from governance config cell-dep.
const MIN_BOND_JUL: u128 = 1_000_000_000_000_000_000; // 1 JUL (18-decimal)
const DEFAULT_LOCK_PERIOD_SECS: u32 = 7 * 24 * 60 * 60;
const _MAX_DISPUTER_BOUNTY_BPS: u16 = 5000; // structural cap (enforced by slash-router tx, not this script)

#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,
    BondBelowFloor = 50,
    LockPeriodTooShort = 51,
    IdentityFieldMutated = 52,
    InvalidStateTransition = 53,
    MissingCrpcWitness = 54,
    InvalidStateValue = 55,
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

    let next = load_cell_data(0, Source::GroupOutput).map_err(Error::from)?;
    if next.len() < MIN_CELL_LEN {
        return Err(Error::LengthNotEnough);
    }
    validate_invariants(&next)?;

    match load_cell_data(0, Source::GroupInput) {
        Ok(prev) => {
            if prev.len() < MIN_CELL_LEN {
                return Err(Error::LengthNotEnough);
            }
            validate_transition(&prev, &next)?;
        }
        Err(_) => {
            // Genesis (postBond). Require state=POSTED.
            if next[OFFSET_STATE] != STATE_POSTED {
                return Err(Error::InvalidStateValue);
            }
        }
    }
    Ok(())
}

fn validate_invariants(data: &[u8]) -> Result<(), Error> {
    let bond = read_u128(&data[OFFSET_BOND_AMOUNT..OFFSET_BOND_AMOUNT + 16]);
    if bond < MIN_BOND_JUL {
        return Err(Error::BondBelowFloor);
    }
    let lock_period = read_u32(&data[OFFSET_LOCK_PERIOD..OFFSET_LOCK_PERIOD + 4]);
    if lock_period < DEFAULT_LOCK_PERIOD_SECS {
        return Err(Error::LockPeriodTooShort);
    }
    let state = data[OFFSET_STATE];
    if state != STATE_POSTED && state != STATE_RELEASED && state != STATE_SLASHED {
        return Err(Error::InvalidStateValue);
    }
    Ok(())
}

fn validate_transition(prev: &[u8], next: &[u8]) -> Result<(), Error> {
    // Identity fields immutable
    let identity_ranges = [
        OFFSET_TASK_ID..OFFSET_TASK_ID + 32,
        OFFSET_STAKER..OFFSET_STAKER + 32,
        OFFSET_BOND_AMOUNT..OFFSET_BOND_AMOUNT + 16,
        OFFSET_POSTED_AT..OFFSET_POSTED_AT + 8,
        OFFSET_LOCK_PERIOD..OFFSET_LOCK_PERIOD + 4,
    ];
    for range in identity_ranges {
        if prev[range.clone()] != next[range] {
            return Err(Error::IdentityFieldMutated);
        }
    }
    let prev_state = prev[OFFSET_STATE];
    let next_state = next[OFFSET_STATE];
    if !is_valid_state_transition(prev_state, next_state) {
        return Err(Error::InvalidStateTransition);
    }
    // For RELEASED/SLASHED transitions, require CRPC witness presence.
    if next_state == STATE_RELEASED || next_state == STATE_SLASHED {
        require_crpc_witness()?;
    }
    Ok(())
}

fn is_valid_state_transition(prev: u8, next: u8) -> bool {
    matches!(
        (prev, next),
        (STATE_POSTED, STATE_POSTED)
            | (STATE_POSTED, STATE_RELEASED)
            | (STATE_POSTED, STATE_SLASHED)
            | (STATE_RELEASED, STATE_RELEASED)
            | (STATE_SLASHED, STATE_SLASHED)
    )
}

fn require_crpc_witness() -> Result<(), Error> {
    // CYCLE5: load WitnessArgs at group index, parse the input_type field as
    // a canonical CRPC TaskSettled attestation (BLS aggregate sig over
    // (task_id, winners_merkle_root, epoch)), and verify against the bonded
    // validator set root pinned in the cell type-script args. Until that
    // lands, the witness presence check is structural-only and fails closed.
    Err(Error::MissingCrpcWitness)
}

fn read_u128(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u32(b: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&b[..4]);
    u32::from_le_bytes(buf)
}
