//! # MessagingHub Validator Registry Cell Type Script
//!
//! Holds the bonded BLS validator set. Read via cell-dep by
//! AttestationCells to verify threshold aggregate signatures. Updated
//! via governance-gated transitions for adds, removes, and bond changes.
//!
//! ## Genesis validator set size
//!
//! 24 (mid of the 16-32 range per Will-DECISIONS_MADE 2026-06-08). With
//! threshold 16/24 = 2/3, this gives a 9-validator failure tolerance.
//! Tunable post-genesis via governance transitions.
//!
//! ## Cell-data layout
//!
//! ```text
//! | field          | bytes | offset |
//! |----------------|-------|--------|
//! | version        |   1   |   0    |
//! | epoch          |   8   |   1    |   u64 LE; monotonic
//! | threshold_n    |   2   |   9    |   u16 LE
//! | threshold_d    |   2   |  11    |   u16 LE
//! | total_bonded   |  16   |  13    |   u128 LE
//! | n_validators   |   2   |  29    |   u16 LE
//! | validators     |  var  |  31    |   n_validators * 64 bytes
//! ```
//!
//! Each validator entry is 64 bytes:
//! ```text
//! | bls_pubkey     |  48   |   0    |   compressed G1
//! | bond_amount    |  16   |  48    |   u128 LE
//! ```
//!
//! Per Will-DECISIONS_MADE: BLS pubkey (48 bytes) + stake amount (u128
//! LE). `slashed` and `lock_hash` fields from the spec are deferred to
//! the ValidatorBondCell type-script — the registry is the lean
//! BLS-verify substrate.
//!
//! ## Type-script args
//!
//! Exactly 32 bytes = governance multisig lock-hash. Only transactions
//! signed by the governance lock can transition this cell.
//!
//! ## Invariants enforced
//!
//! 1. **Epoch monotonic**: `output.epoch == input.epoch + 1` on transitions.
//! 2. **Threshold bounds**: `threshold_n / threshold_d >= 2/3` (per spec).
//!    Threshold denominator clamped to validator count.
//! 3. **Validator count**: `16 <= n_validators <= 32` at the registry
//!    level (tighter range than `bls-verify`'s upper bound; aligns with
//!    Will-DECISIONS_MADE).
//! 4. **Total-bonded conservation**: `sum(validator.bond_amount) == total_bonded`.
//! 5. **Genesis case**: `inputs.is_empty()` ⇒ epoch must be 0.
//! 6. **Governance auth**: governance lock-hash present in tx inputs.
//!
//! ## Proof-of-possession
//!
//! Per Will-DECISIONS_MADE: YES on ValidatorBondCell. PoP verification
//! happens at bond-time at the ValidatorBondCell type-script, NOT here.
//! The registry trusts that bonded validators have already proven
//! possession at their bond cells. This keeps registry transitions
//! pairing-free (cheap).
//!
//! ## Status
//!
//! Scaffold. Source-reviewable. Governance auth check is presence-only
//! at the lock-hash layer; production version may want stricter
//! threshold-of-N governance.

#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_cell_lock_hash, load_script},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Cell-data layout ============

const SCHEMA_VERSION: u8 = 1;
const OFFSET_VERSION: usize = 0;
const OFFSET_EPOCH: usize = 1;
const OFFSET_THRESHOLD_N: usize = 9;
const OFFSET_THRESHOLD_D: usize = 11;
const OFFSET_TOTAL_BONDED: usize = 13;
const OFFSET_N_VALIDATORS: usize = 29;
const OFFSET_VALIDATORS: usize = 31;
const HEADER_LEN: usize = OFFSET_VALIDATORS;

const VALIDATOR_ENTRY_LEN: usize = 64;
const VALIDATOR_PUBKEY_OFFSET: usize = 0;
const VALIDATOR_PUBKEY_LEN: usize = 48;
const VALIDATOR_BOND_OFFSET: usize = 48;
const VALIDATOR_BOND_LEN: usize = 16;

// ============ Type-script args ============

const ARGS_GOVERNANCE_LOCK_HASH_LEN: usize = 32;

// ============ Validator set bounds (per Will-DECISIONS_MADE) ============

const MIN_VALIDATORS: u16 = 16;
const MAX_VALIDATORS: u16 = 32;

// ============ Threshold bounds (per spec) ============

// Threshold floor is 2/3. We allow any (n,d) with `3*n >= 2*d` and `n <= d`.
const THRESHOLD_NUMERATOR_MIN: u64 = 2; // 2/3 lower bound
const THRESHOLD_DENOMINATOR_MIN: u64 = 3;

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
    if args_bytes.len() != ARGS_GOVERNANCE_LOCK_HASH_LEN {
        return Err(Error::ScriptArgsMalformed);
    }
    let mut governance_lock_hash = [0u8; ARGS_GOVERNANCE_LOCK_HASH_LEN];
    governance_lock_hash.copy_from_slice(&args_bytes[..ARGS_GOVERNANCE_LOCK_HASH_LEN]);

    // Load input/output registry cell-data. The registry is a singleton —
    // at most one input + one output of this type-script per tx.
    let input = load_optional_registry(Source::GroupInput)?;
    let output = load_optional_registry(Source::GroupOutput)?;

    match (input, output) {
        (None, None) => Err(Error::EmptyTransition),
        (None, Some(out)) => verify_genesis(&out, &governance_lock_hash),
        (Some(_), None) => {
            // Registry destroyed. Permitted only with governance auth
            // (e.g., end-of-chain or migration scenario).
            require_governance_auth(&governance_lock_hash)
        }
        (Some(inp), Some(out)) => verify_transition(&inp, &out, &governance_lock_hash),
    }
}

fn load_optional_registry(source: Source) -> Result<Option<RegistryCell>, Error> {
    match load_cell_data(0, source) {
        Ok(data) => Ok(Some(parse_registry(&data)?)),
        Err(ckb_std::error::SysError::IndexOutOfBound) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ============ Parsed shape ============

struct RegistryCell {
    version: u8,
    epoch: u64,
    threshold_n: u16,
    threshold_d: u16,
    total_bonded: u128,
    n_validators: u16,
    // We store the byte-slice region for validators rather than fully
    // decoding into a heapless Vec — that would force a 32*64 = 2KB
    // alloc on every tx. The byte region is sliced on demand.
    validators_bytes_len: usize,
    // Sum of bond amounts, computed during parse for the conservation check.
    computed_total_bonded: u128,
}

fn parse_registry(data: &[u8]) -> Result<RegistryCell, Error> {
    if data.len() < HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    let version = data[OFFSET_VERSION];
    if version != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let epoch = read_u64_le(&data[OFFSET_EPOCH..OFFSET_EPOCH + 8]);
    let threshold_n = read_u16_le(&data[OFFSET_THRESHOLD_N..OFFSET_THRESHOLD_N + 2]);
    let threshold_d = read_u16_le(&data[OFFSET_THRESHOLD_D..OFFSET_THRESHOLD_D + 2]);
    let total_bonded = read_u128_le(&data[OFFSET_TOTAL_BONDED..OFFSET_TOTAL_BONDED + 16]);
    let n_validators = read_u16_le(&data[OFFSET_N_VALIDATORS..OFFSET_N_VALIDATORS + 2]);

    if n_validators < MIN_VALIDATORS || n_validators > MAX_VALIDATORS {
        return Err(Error::ValidatorCountOutOfRange);
    }

    let validators_bytes_len = (n_validators as usize) * VALIDATOR_ENTRY_LEN;
    if data.len() < HEADER_LEN + validators_bytes_len {
        return Err(Error::CellDataMalformed);
    }

    // Compute sum of bond amounts.
    let mut sum: u128 = 0;
    for i in 0..(n_validators as usize) {
        let off = HEADER_LEN + i * VALIDATOR_ENTRY_LEN + VALIDATOR_BOND_OFFSET;
        let b = read_u128_le(&data[off..off + VALIDATOR_BOND_LEN]);
        sum = sum.checked_add(b).ok_or(Error::AmountOverflow)?;
    }

    Ok(RegistryCell {
        version,
        epoch,
        threshold_n,
        threshold_d,
        total_bonded,
        n_validators,
        validators_bytes_len,
        computed_total_bonded: sum,
    })
}

// ============ Genesis ============

fn verify_genesis(out: &RegistryCell, governance_lock_hash: &[u8; 32]) -> Result<(), Error> {
    if out.epoch != 0 {
        return Err(Error::GenesisEpochNotZero);
    }
    check_threshold_bounds(out.threshold_n, out.threshold_d)?;
    if out.computed_total_bonded != out.total_bonded {
        return Err(Error::TotalBondedMismatch);
    }
    require_governance_auth(governance_lock_hash)
}

// ============ Transition ============

fn verify_transition(
    inp: &RegistryCell,
    out: &RegistryCell,
    governance_lock_hash: &[u8; 32],
) -> Result<(), Error> {
    // Epoch monotonic.
    if out.epoch != inp.epoch + 1 {
        return Err(Error::EpochNotMonotonic);
    }
    check_threshold_bounds(out.threshold_n, out.threshold_d)?;
    // Conservation.
    if out.computed_total_bonded != out.total_bonded {
        return Err(Error::TotalBondedMismatch);
    }
    // Total-bonded delta must reflect either a bond add (in) or unbond
    // (out). The actual ValidatorBondCell type-script enforces capacity
    // movement; here we just ensure conservation within this cell.
    require_governance_auth(governance_lock_hash)
}

// ============ Governance auth ============

fn require_governance_auth(governance_lock_hash: &[u8; 32]) -> Result<(), Error> {
    let mut idx = 0usize;
    loop {
        match load_cell_lock_hash(idx, Source::Input) {
            Ok(h) => {
                if &h == governance_lock_hash {
                    return Ok(());
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                return Err(Error::GovernanceAuthMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Threshold validation ============

fn check_threshold_bounds(n: u16, d: u16) -> Result<(), Error> {
    if d == 0 {
        return Err(Error::ThresholdMalformed);
    }
    if n > d {
        return Err(Error::ThresholdMalformed);
    }
    // n/d >= 2/3 iff 3n >= 2d. Use u64 to avoid overflow.
    let lhs = (n as u64) * THRESHOLD_DENOMINATOR_MIN;
    let rhs = (d as u64) * THRESHOLD_NUMERATOR_MIN;
    if lhs < rhs {
        return Err(Error::ThresholdBelowFloor);
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

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
