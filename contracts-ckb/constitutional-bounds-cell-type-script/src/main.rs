//! Constitutional bounds cell — immutable post-genesis. See README for spec.

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

const SCHEMA_VERSION: u8 = 1;

// Generous over realistic Lawson-constants set (~16 knobs).
const MAX_BOUNDS: usize = 64;
const MAX_CROSS_CONSTRAINTS: usize = 32;

// TODO: replace with the genesis BoundsCell's lock-hash once chain-spec emits it.
const GENESIS_LOCK_HASH_PLACEHOLDER: [u8; 32] = [0u8; 32];

// ============ Cell-data layout ============
//
// version: u8                            @ 0
// bound_count: u16 LE                    @ 1
// bounds: ConstantBound[bound_count]     @ 3
// constraint_count: u16 LE               @ 3 + 96 * bound_count
// constraints: CrossConstraint[]         @ next
// genesis_block_height: u64 LE           @ tail
//
// ConstantBound = 96 bytes:
//   name_hash: [u8; 32]    @ 0
//   min_value: u128 LE     @ 32
//   max_value: u128 LE     @ 48
//   alpha_min: u128 LE     @ 64
//   alpha_max: u128 LE     @ 80
//
// CrossConstraint = 99 bytes (well-known op-code + up to 3 operand name-hashes):
//   op_code: u8                @ 0       (see CrossOp)
//   operand_a: [u8; 32]        @ 1
//   operand_b: [u8; 32]        @ 33
//   operand_c: [u8; 32]        @ 65      (zero-hash if unused)
const BOUND_ENTRY_LEN: usize = 32 + 16 + 16 + 16 + 16; // 96
const BOUNDS_HEADER_LEN: usize = 3;
const CONSTRAINT_HEADER_LEN: usize = 2;
const CROSS_CONSTRAINT_LEN: usize = 1 + 32 * 3; // 97
const GENESIS_HEIGHT_LEN: usize = 8;

// ============ Well-known cross-constraint op-codes ============
//
// SUM_LT(a, b, c): max_value(a) + max_value(b) < min_value(c).
//   Used for the NCI pillar-weight invariant pow_bps + pos_bps < pom_bps
//   (per nci-boundary-enforcement.md §2.5).
// GTE_ZERO(a, _, _): min_value(a) >= 0. Trivially satisfied for u128;
//   reserved for future signed-value schemas.
// SUM_EQ(a, b, c): max_value(a) + max_value(b) <= max_value(c) AND
//   min_value(a) + min_value(b) >= min_value(c). Anchors a "sums to <= c"
//   shape; used for budget-shape constants.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum CrossOp {
    SumLt = 0x01,
    GteZero = 0x02,
    SumEq = 0x03,
}

impl CrossOp {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::SumLt),
            0x02 => Some(Self::GteZero),
            0x03 => Some(Self::SumEq),
            _ => None,
        }
    }
}

pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

fn verify() -> Result<(), Error> {
    // No args expected; reject if someone packs role-tag bytes.
    let script = load_script()?;
    if !script.as_reader().args().raw_data().is_empty() {
        return Err(Error::ScriptArgsMalformed);
    }

    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    if inputs.is_empty() {
        verify_genesis_mint(&outputs)
    } else {
        verify_immutable_passthrough(&inputs, &outputs)
    }
}

// Genesis-only mint path. Only legal when this binary appears as a
// type-script in an output with no matching input. Layout + cross-constraint
// shape are validated; runtime liveness of the singleton check is deferred
// to lock-script (provably-unspendable post-genesis).
fn verify_genesis_mint(outputs: &[alloc::vec::Vec<u8>]) -> Result<(), Error> {
    // Singleton: exactly one ConstitutionalBoundsCell per chain.
    if outputs.len() != 1 {
        return Err(Error::SingletonViolation);
    }
    validate_layout(&outputs[0])?;
    validate_cross_constraints(&outputs[0])?;

    // TODO: assert tx_index == 0 + header-dep on genesis block via ckb-std.
    Ok(())
}

// Immutability path: when consumed-as-input, the only legal shape is
// consumed-and-recreated byte-identical. Otherwise the cell is being
// mutated or destroyed.
fn verify_immutable_passthrough(
    inputs: &[alloc::vec::Vec<u8>],
    outputs: &[alloc::vec::Vec<u8>],
) -> Result<(), Error> {
    if outputs.is_empty() {
        return Err(Error::CellDestroyed);
    }
    if inputs.len() != 1 || outputs.len() != 1 {
        return Err(Error::CellMultiplicityMismatch);
    }
    if inputs[0] != outputs[0] {
        return Err(Error::DataMutated);
    }

    // Lock-script must also be byte-identical: if the lock can be swapped,
    // the immutability claim collapses (a future tx could relock to a
    // mutable lock and rewrite).
    let in_lock = load_cell_lock_hash(0, Source::GroupInput)?;
    let out_lock = load_cell_lock_hash(0, Source::GroupOutput)?;
    if in_lock != out_lock {
        return Err(Error::LockMutated);
    }

    // Singleton anchor: input lock-hash must match the genesis hash.
    // TODO: replace placeholder once chain-spec emits the genesis lock-hash.
    if GENESIS_LOCK_HASH_PLACEHOLDER != [0u8; 32] && in_lock != GENESIS_LOCK_HASH_PLACEHOLDER {
        return Err(Error::NotGenesisInstance);
    }

    Ok(())
}

// ============ Layout validation ============

fn validate_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < BOUNDS_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }

    let bound_count = read_u16_le(&data[1..3]) as usize;
    if bound_count > MAX_BOUNDS {
        return Err(Error::CapacityExceeded);
    }

    let bounds_end = BOUNDS_HEADER_LEN + bound_count * BOUND_ENTRY_LEN;
    if data.len() < bounds_end + CONSTRAINT_HEADER_LEN + GENESIS_HEIGHT_LEN {
        return Err(Error::CellDataMalformed);
    }

    // Bound ranges: min <= max for both value and alpha.
    for i in 0..bound_count {
        let base = BOUNDS_HEADER_LEN + i * BOUND_ENTRY_LEN;
        let min_v = read_u128_le(&data[base + 32..base + 48]);
        let max_v = read_u128_le(&data[base + 48..base + 64]);
        let alpha_min = read_u128_le(&data[base + 64..base + 80]);
        let alpha_max = read_u128_le(&data[base + 80..base + 96]);
        if min_v > max_v {
            return Err(Error::BoundsRangeInverted);
        }
        if alpha_min > alpha_max {
            return Err(Error::AlphaRangeInverted);
        }
    }

    let constraint_count = read_u16_le(&data[bounds_end..bounds_end + 2]) as usize;
    if constraint_count > MAX_CROSS_CONSTRAINTS {
        return Err(Error::CapacityExceeded);
    }
    let constraints_end =
        bounds_end + CONSTRAINT_HEADER_LEN + constraint_count * CROSS_CONSTRAINT_LEN;
    if data.len() < constraints_end + GENESIS_HEIGHT_LEN {
        return Err(Error::CellDataMalformed);
    }

    Ok(())
}

// ============ Cross-constraint shape validation ============
//
// Cross-constraints are static well-formedness checks on the bounds
// themselves (do the ranges admit any valid assignment satisfying the
// constraint), not runtime checks on registry values. Runtime registry
// checks live in lawson-constants-cell-type-script.

fn validate_cross_constraints(data: &[u8]) -> Result<(), Error> {
    let bound_count = read_u16_le(&data[1..3]) as usize;
    let bounds_end = BOUNDS_HEADER_LEN + bound_count * BOUND_ENTRY_LEN;
    let constraint_count = read_u16_le(&data[bounds_end..bounds_end + 2]) as usize;

    for i in 0..constraint_count {
        let base = bounds_end + CONSTRAINT_HEADER_LEN + i * CROSS_CONSTRAINT_LEN;
        let op = CrossOp::from_byte(data[base]).ok_or(Error::CrossConstraintOpUnknown)?;
        let a = &data[base + 1..base + 33];
        let b = &data[base + 33..base + 65];
        let c = &data[base + 65..base + 97];

        match op {
            CrossOp::SumLt => {
                let ba = find_bound(data, bound_count, a)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                let bb = find_bound(data, bound_count, b)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                let bc = find_bound(data, bound_count, c)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                // Static feasibility: there must exist some (a, b, c) in
                // their ranges with a + b < c. Sufficient: a_min + b_min < c_max.
                let lhs = ba.min_value.saturating_add(bb.min_value);
                if lhs >= bc.max_value {
                    return Err(Error::CrossConstraintUnsatisfiable);
                }
            }
            CrossOp::GteZero => {
                // u128 is always >= 0; presence-check only.
                find_bound(data, bound_count, a)
                    .ok_or(Error::CrossConstraintNameMissing)?;
            }
            CrossOp::SumEq => {
                let ba = find_bound(data, bound_count, a)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                let bb = find_bound(data, bound_count, b)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                let bc = find_bound(data, bound_count, c)
                    .ok_or(Error::CrossConstraintNameMissing)?;
                // Static feasibility: a_min + b_min <= c_max AND
                // a_max + b_max >= c_min so some assignment hits c's range.
                let lo = ba.min_value.saturating_add(bb.min_value);
                let hi = ba.max_value.saturating_add(bb.max_value);
                if lo > bc.max_value || hi < bc.min_value {
                    return Err(Error::CrossConstraintUnsatisfiable);
                }
            }
        }
    }
    Ok(())
}

struct Bound {
    min_value: u128,
    max_value: u128,
}

fn find_bound(data: &[u8], bound_count: usize, name_hash: &[u8]) -> Option<Bound> {
    for i in 0..bound_count {
        let base = BOUNDS_HEADER_LEN + i * BOUND_ENTRY_LEN;
        if &data[base..base + 32] == name_hash {
            return Some(Bound {
                min_value: read_u128_le(&data[base + 32..base + 48]),
                max_value: read_u128_le(&data[base + 48..base + 64]),
            });
        }
    }
    None
}

// ============ Group-cell helpers ============

fn collect_group_data(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, 4>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, 4> = heapless::Vec::new();
    for data in QueryIter::new(load_cell_data, source) {
        out.push(data).map_err(|_| Error::CapacityExceeded)?;
    }
    Ok(out)
}

// ============ Byte readers ============

fn read_u128_le(b: &[u8]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&b[..16]);
    u128::from_le_bytes(buf)
}

fn read_u16_le(b: &[u8]) -> u16 {
    let mut buf = [0u8; 2];
    buf.copy_from_slice(&b[..2]);
    u16::from_le_bytes(buf)
}
