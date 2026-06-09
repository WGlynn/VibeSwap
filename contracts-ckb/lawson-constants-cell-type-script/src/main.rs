//! # Lawson Constants Type Script
//!
//! Type-script enforcing the Lawson-constants constitutional pipeline on the
//! VibeSwap-CKB sovereign chain. Direct port of
//! `vibeswap/contracts/governance/LawsonConstantsRegistry.sol` to the CKB
//! cell model, with the EVM-monolithic contract decomposed into three cells:
//!
//! 1. **ConstitutionalBoundsCell** (immutable, set at genesis) — encodes the
//!    constitutional bounds on every Lawson constant. The EVM analogue is the
//!    `ALPHA_BPS_MIN / ALPHA_BPS_MAX` immutable constants and the anchored
//!    `p000Hash / p001Hash`.
//!
//! 2. **ConstantsRegistryCell** (governance-tunable, within bounds) — current
//!    values of every Lawson constant: kappa-fee, Lawson floor alpha, Pioneer
//!    bonus multiplier, emission rate, NCI three-pillar weights, circuit-
//!    breaker thresholds, batch durations, slash percentages. The EVM
//!    analogue is the mutable `alphaBps` storage slot, generalized to N
//!    constants.
//!
//! 3. **ConstantsHistoryCell** (append-only) — every value change is logged
//!    for adversarial review.
//!
//! This single type-script binary covers all three roles, dispatching on a
//! 1-byte tag in `type_script.args[0]`. This matches the workspace pattern
//! (one crate per type-script, but role-multiplexing where the invariant sets
//! are tightly coupled).
//!
//! ## Structural property preservation
//!
//! Per `specs/lawson-constants.md` § Property preservation, the layered
//! design (physics > constitution > governance) is structurally enforced
//! by Rust returns:
//!
//! - **Physics**: ConstitutionalBoundsCell rejects any tx that consumes it
//!   as input (immutable). The only way to "change a bound" is a hardfork
//!   (deploy a new BoundsCell + new genesis), per the spec's open question.
//!
//! - **Constitution**: ConstantsRegistryCell verifies every output value is
//!   within the bounds-cell's [min, max] range (cell-dep lookup).
//!
//! - **Governance**: ConstantsRegistryCell delegates the *who-can-change-it*
//!   question to its lock-script. The lock-script is expected to gate on a
//!   ProtocolDecisionCell from the NCI consensus layer (when shipped, see
//!   `specs/nci-consensus.md`). This type-script verifies the bound check
//!   regardless of the authorization path, per the cleanest possible
//!   separation of concerns.
//!
//! ## Companion-cell discovery
//!
//! Roles are distinguished by `type_script.args[0]`. The script also needs
//! to find the BoundsCell from its outpoint-encoded reference in the
//! registry cell-data. For the scaffold we walk the cell-deps looking for a
//! BoundsCell-tagged cell of the right shape, mirroring the heuristic-
//! detection pattern in `vibeswap-canonical-token-type-script`. The
//! production version must match on a compile-time-embedded code-hash of
//! the BoundsCell type-script (which is THIS SAME binary, so once Capsule
//! emits a stable code-hash we can self-reference).
//!
//! ## Status
//!
//! SPEC scaffold, not audit-ready. Marked production-readiness TODOs are
//! inline. Source-reviewable; not yet machine-verified on this dev box (see
//! README § Known build blockers — same toolchain pinning + cc + capsule
//! issues as the sibling crates).
//!
//! Spec: `vibeswap/contracts-ckb/specs/lawson-constants.md`
//! EVM source: `vibeswap/contracts/governance/LawsonConstantsRegistry.sol`

#![no_std]
#![no_main]

extern crate alloc;

use ckb_std::{
    ckb_constants::Source,
    default_alloc,
    high_level::{load_cell_data, load_script, QueryIter},
};

mod error;
use error::Error;

ckb_std::entry!(program_entry);
default_alloc!();

// ============ Schema constants ============

const SCHEMA_VERSION: u8 = 1;

// Heapless caps. 64 is well above the realistic Lawson constant set
// (~16 knobs as of 2026-06). Audit-time tighten as the set stabilizes.
const MAX_CONSTANTS: usize = 64;
const MAX_BOUNDS: usize = 64;

// ============ Role tag (type_script.args[0]) ============

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum RoleTag {
    Bounds = 0x01,
    Registry = 0x02,
    History = 0x03,
}

impl RoleTag {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Bounds),
            0x02 => Some(Self::Registry),
            0x03 => Some(Self::History),
            _ => None,
        }
    }
}

// ============ ConstitutionalBoundsCell layout ============
//
// version: u8                        @ 0
// bound_count: u16 (LE)              @ 1
// bounds: ConstantBound[bound_count] @ 3
// genesis_block_height: u64 (LE)     @ 3 + 80 * bound_count
//
// ConstantBound = 80 bytes:
//   name_hash: [u8; 32]    @ 0
//   min_value: u128 LE     @ 32
//   max_value: u128 LE     @ 48
//   alpha_min: u128 LE     @ 64
//   alpha_max: u128 LE     @ 80
//
// Wait — 32 + 16 + 16 + 16 + 16 = 96 bytes. Recompute:
const BOUND_NAME_HASH_LEN: usize = 32;
const BOUND_VALUE_LEN: usize = 16; // u128 LE
const BOUND_ENTRY_LEN: usize = BOUND_NAME_HASH_LEN + BOUND_VALUE_LEN * 4; // 96
const BOUNDS_HEADER_LEN: usize = 3; // version + bound_count
const BOUNDS_GENESIS_HEIGHT_LEN: usize = 8;

// ============ ConstantsRegistryCell layout ============
//
// version: u8                        @ 0
// constant_count: u16 (LE)           @ 1
// constants: ConstantValue[]         @ 3
// bounds_cell_outpoint: OutPoint     @ 3 + CONSTANT_ENTRY_LEN * count
//
// ConstantValue = 64 bytes:
//   name_hash: [u8; 32]          @ 0
//   value: u128 LE               @ 32
//   alpha: u128 LE               @ 48
//   last_updated_at_block: u64 LE @ 64
//
// 32 + 16 + 16 + 8 = 72 bytes.
const CONSTANT_NAME_HASH_LEN: usize = 32;
const CONSTANT_ENTRY_LEN: usize = 32 + 16 + 16 + 8; // 72
const REGISTRY_HEADER_LEN: usize = 3; // version + constant_count
// OutPoint encoding: tx_hash[32] + index: u32 LE = 36 bytes.
const OUTPOINT_LEN: usize = 36;

// ============ ConstantsHistoryCell layout ============
//
// version: u8                        @ 0
// entry_count: u32 (LE)              @ 1
// entries: HistoryEntry[]            @ 5
//
// HistoryEntry = 88 bytes:
//   constant_name_hash: [u8; 32]  @ 0
//   old_value: u128 LE            @ 32
//   new_value: u128 LE            @ 48
//   decision_id: [u8; 32]         @ 64
//   at_block: u64 LE              @ 96
//
// 32 + 16 + 16 + 32 + 8 = 104 bytes.
const HISTORY_ENTRY_LEN: usize = 32 + 16 + 16 + 32 + 8; // 104
const HISTORY_HEADER_LEN: usize = 5; // version + entry_count (u32)
const HISTORY_ENTRY_BLOCK_OFFSET: usize = 32 + 16 + 16 + 32; // 96

// ============ Entry ============

/// Script entry point. Returns 0 on success, nonzero error code on rejection.
pub fn program_entry() -> i8 {
    match verify() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

// ============ Top-level dispatch ============

fn verify() -> Result<(), Error> {
    let script = load_script()?;
    // Canonical args-read pattern used across `contracts-ckb/`:
    // `script.as_reader().args().raw_data()` returns a borrowed byte-slice
    // without an alloc. See sibling crates.
    let args_reader = script.as_reader();
    let args_bytes = args_reader.args().raw_data();
    if args_bytes.is_empty() {
        return Err(Error::ScriptArgsMalformed);
    }
    let role = RoleTag::from_byte(args_bytes[0]).ok_or(Error::ScriptArgsMalformed)?;

    match role {
        RoleTag::Bounds => verify_bounds_cell(),
        RoleTag::Registry => verify_registry_cell(),
        RoleTag::History => verify_history_cell(),
    }
}

// ============ ConstitutionalBoundsCell verification ============
//
// Invariant 1 (per task brief): type-script REJECTS any tx that has it as
// input AND output (immutable post-deploy). We strengthen: REJECTS any tx
// that has it as input AT ALL. Genesis is the only legal mint.

fn verify_bounds_cell() -> Result<(), Error> {
    let inputs = count_group_cells(Source::GroupInput)?;
    let outputs = count_group_cells(Source::GroupOutput)?;

    // Any input bearing this script + this role = an attempt to mutate.
    if inputs > 0 {
        return Err(Error::BoundsCellConsumed);
    }

    // For every output, validate the layout + bound ranges.
    for data in QueryIter::new(load_cell_data, Source::GroupOutput) {
        validate_bounds_layout(&data)?;
    }

    // CYCLE5: also assert the tx is the genesis tx (header-dep on block 0,
    // tx_index == 0). For the scaffold we accept any tx that produces a
    // BoundsCell with no corresponding input — the lock-script is expected
    // to be a provably-unspendable lock that can only appear in the
    // genesis cellbase. Marked as a production gap.
    // TODO: verify-genesis-tx via ckb-std header-dep API
    let _ = outputs;
    Ok(())
}

fn validate_bounds_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < BOUNDS_HEADER_LEN + BOUNDS_GENESIS_HEIGHT_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let bound_count = read_u16_le(&data[1..3]) as usize;
    if bound_count > MAX_BOUNDS {
        return Err(Error::CapacityExceeded);
    }
    let expected_min_len =
        BOUNDS_HEADER_LEN + bound_count * BOUND_ENTRY_LEN + BOUNDS_GENESIS_HEIGHT_LEN;
    if data.len() < expected_min_len {
        return Err(Error::CellDataMalformed);
    }

    // Validate each bound's ranges are non-inverted.
    for i in 0..bound_count {
        let base = BOUNDS_HEADER_LEN + i * BOUND_ENTRY_LEN;
        let min_value = read_u128_le(&data[base + 32..base + 48]);
        let max_value = read_u128_le(&data[base + 48..base + 64]);
        let alpha_min = read_u128_le(&data[base + 64..base + 80]);
        let alpha_max = read_u128_le(&data[base + 80..base + 96]);
        if min_value > max_value {
            return Err(Error::BoundsRangeInverted);
        }
        if alpha_min > alpha_max {
            return Err(Error::AlphaRangeInverted);
        }
    }
    Ok(())
}

// ============ ConstantsRegistryCell verification ============
//
// Invariant 2 (per task brief): for each constant in output, verify
// (lower_bound <= value <= upper_bound) via cell-dep to BoundsCell.
// Invariant 3: lock-script change requires gov-multisig (lock-script
// handles auth; type-script verifies bounds).

fn verify_registry_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    // Cannot destroy the registry; if input exists, output must exist.
    if !inputs.is_empty() && outputs.is_empty() {
        return Err(Error::RegistryDestroyed);
    }

    // Find the BoundsCell via cell-dep. The output registry's
    // bounds_cell_outpoint encodes the expected reference, but we have to
    // physically read the bounds cell to do the value-vs-range check.
    // For the scaffold we pull the BoundsCell from cell-deps by tag-shape.
    // TODO: enforce that the cell-dep's outpoint equals the
    // bounds_cell_outpoint encoded in the registry data. Until then an
    // adversary could swap in a wider BoundsCell as cell-dep.
    let bounds_data = find_bounds_cell_dep()?;
    validate_bounds_layout(&bounds_data)?;

    // For each output registry cell, validate layout + bound checks.
    for out_data in &outputs {
        validate_registry_layout(out_data)?;
        validate_registry_against_bounds(out_data, &bounds_data)?;
    }

    // If there's an input registry (this is an update tx, not genesis),
    // enforce single-constant-change + unchanged-preservation.
    if let Some(in_data) = inputs.first() {
        if let Some(out_data) = outputs.first() {
            validate_registry_transition(in_data, out_data)?;
        }
    }

    Ok(())
}

fn validate_registry_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < REGISTRY_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let constant_count = read_u16_le(&data[1..3]) as usize;
    if constant_count > MAX_CONSTANTS {
        return Err(Error::CapacityExceeded);
    }
    let expected_min_len =
        REGISTRY_HEADER_LEN + constant_count * CONSTANT_ENTRY_LEN + OUTPOINT_LEN;
    if data.len() < expected_min_len {
        return Err(Error::CellDataMalformed);
    }
    Ok(())
}

fn validate_registry_against_bounds(
    registry_data: &[u8],
    bounds_data: &[u8],
) -> Result<(), Error> {
    let constant_count = read_u16_le(&registry_data[1..3]) as usize;
    let bound_count = read_u16_le(&bounds_data[1..3]) as usize;

    for i in 0..constant_count {
        let base = REGISTRY_HEADER_LEN + i * CONSTANT_ENTRY_LEN;
        let name_hash = &registry_data[base..base + 32];
        let value = read_u128_le(&registry_data[base + 32..base + 48]);
        let alpha = read_u128_le(&registry_data[base + 48..base + 64]);

        let bound = find_bound_by_name(bounds_data, bound_count, name_hash)
            .ok_or(Error::ConstantNameUnknown)?;

        if value < bound.min_value || value > bound.max_value {
            return Err(Error::ConstantValueOutOfBounds);
        }
        if alpha < bound.alpha_min || alpha > bound.alpha_max {
            return Err(Error::ConstantAlphaOutOfBounds);
        }
    }
    Ok(())
}

struct Bound {
    min_value: u128,
    max_value: u128,
    alpha_min: u128,
    alpha_max: u128,
}

fn find_bound_by_name(bounds_data: &[u8], bound_count: usize, name_hash: &[u8]) -> Option<Bound> {
    for i in 0..bound_count {
        let base = BOUNDS_HEADER_LEN + i * BOUND_ENTRY_LEN;
        if &bounds_data[base..base + 32] == name_hash {
            return Some(Bound {
                min_value: read_u128_le(&bounds_data[base + 32..base + 48]),
                max_value: read_u128_le(&bounds_data[base + 48..base + 64]),
                alpha_min: read_u128_le(&bounds_data[base + 64..base + 80]),
                alpha_max: read_u128_le(&bounds_data[base + 80..base + 96]),
            });
        }
    }
    None
}

/// Single-constant-change rule + preservation of unchanged constants'
/// `last_updated_at_block`. Per spec § Type-script invariants (at update).
fn validate_registry_transition(in_data: &[u8], out_data: &[u8]) -> Result<(), Error> {
    let in_count = read_u16_le(&in_data[1..3]) as usize;
    let out_count = read_u16_le(&out_data[1..3]) as usize;

    // The constant set is fixed at genesis; cannot add/remove constants
    // via tunable updates (would require a hardfork).
    if in_count != out_count {
        return Err(Error::ConstantSetMutated);
    }

    let mut changed_count = 0u32;
    for i in 0..in_count {
        let base = REGISTRY_HEADER_LEN + i * CONSTANT_ENTRY_LEN;
        let in_name = &in_data[base..base + 32];
        let out_name = &out_data[base..base + 32];

        // Per-index name_hash must match (constants are positionally
        // identified — the index ordering is fixed at genesis).
        if in_name != out_name {
            return Err(Error::ConstantSetMutated);
        }

        let in_value = &in_data[base + 32..base + 48];
        let in_alpha = &in_data[base + 48..base + 64];
        let in_block = &in_data[base + 64..base + 72];
        let out_value = &out_data[base + 32..base + 48];
        let out_alpha = &out_data[base + 48..base + 64];
        let out_block = &out_data[base + 64..base + 72];

        let value_changed = in_value != out_value;
        let alpha_changed = in_alpha != out_alpha;
        let block_changed = in_block != out_block;

        if value_changed || alpha_changed {
            changed_count = changed_count.saturating_add(1);
            // last_updated_at_block MUST be bumped when the value or alpha
            // changes; the type-script doesn't validate the new height
            // (the chain enforces that downstream), but it must differ
            // from the old.
            if !block_changed {
                return Err(Error::UnchangedConstantMutated);
            }
        } else {
            // Unchanged constant: last_updated_at_block must also be
            // preserved (per spec invariant: unchanged constants are
            // preserved exactly).
            if block_changed {
                return Err(Error::UnchangedConstantMutated);
            }
        }
    }

    if changed_count > 1 {
        return Err(Error::MultiConstantUpdate);
    }
    Ok(())
}

// ============ ConstantsHistoryCell verification ============
//
// Invariant 4 (per task brief): output amount = input amount + 1 entry; new
// entry references the ConstantsRegistryCell tx-hash.
//
// We enforce the append-only property: the output history's entry list must
// be a prefix-extension of the input history's entry list by exactly one
// entry, and the new entry's at_block must be >= the previous tail's
// at_block.

fn verify_history_cell() -> Result<(), Error> {
    let inputs = collect_group_data(Source::GroupInput)?;
    let outputs = collect_group_data(Source::GroupOutput)?;

    if !inputs.is_empty() && outputs.is_empty() {
        return Err(Error::HistoryDestroyed);
    }
    if outputs.is_empty() {
        // No-op (e.g. unrelated tx that happens to bear our script).
        return Ok(());
    }

    for out_data in &outputs {
        validate_history_layout(out_data)?;
    }

    if let Some(in_data) = inputs.first() {
        let out_data = &outputs[0];
        validate_history_layout(in_data)?;
        validate_history_append(in_data, out_data)?;
    } else {
        // Genesis: the history cell starts empty.
        // CYCLE5: require the bound-genesis tx for the empty-history mint.
        let entry_count = read_u32_le(&outputs[0][1..5]) as usize;
        if entry_count != 0 {
            return Err(Error::HistoryRewritten);
        }
    }

    Ok(())
}

fn validate_history_layout(data: &[u8]) -> Result<(), Error> {
    if data.len() < HISTORY_HEADER_LEN {
        return Err(Error::CellDataMalformed);
    }
    if data[0] != SCHEMA_VERSION {
        return Err(Error::SchemaVersionUnsupported);
    }
    let entry_count = read_u32_le(&data[1..5]) as usize;
    let expected_min_len = HISTORY_HEADER_LEN + entry_count * HISTORY_ENTRY_LEN;
    if data.len() < expected_min_len {
        return Err(Error::CellDataMalformed);
    }
    Ok(())
}

fn validate_history_append(in_data: &[u8], out_data: &[u8]) -> Result<(), Error> {
    let in_count = read_u32_le(&in_data[1..5]) as usize;
    let out_count = read_u32_le(&out_data[1..5]) as usize;

    // Append-only: output_count == input_count + 1. Multi-entry appends or
    // truncations are rejected.
    if out_count < in_count {
        return Err(Error::HistoryTruncated);
    }
    if out_count != in_count + 1 {
        return Err(Error::HistoryMultipleEntries);
    }

    // The first in_count entries of out_data must be byte-identical to the
    // entries of in_data (no rewrites of prior history).
    let in_entries_end = HISTORY_HEADER_LEN + in_count * HISTORY_ENTRY_LEN;
    let out_prefix_end = HISTORY_HEADER_LEN + in_count * HISTORY_ENTRY_LEN;
    if in_data[HISTORY_HEADER_LEN..in_entries_end]
        != out_data[HISTORY_HEADER_LEN..out_prefix_end]
    {
        return Err(Error::HistoryRewritten);
    }

    // Monotonic at_block: new entry's at_block >= previous tail's at_block.
    if in_count > 0 {
        let prev_tail_base =
            HISTORY_HEADER_LEN + (in_count - 1) * HISTORY_ENTRY_LEN + HISTORY_ENTRY_BLOCK_OFFSET;
        let prev_tail_block = read_u64_le(&in_data[prev_tail_base..prev_tail_base + 8]);
        let new_entry_base =
            HISTORY_HEADER_LEN + in_count * HISTORY_ENTRY_LEN + HISTORY_ENTRY_BLOCK_OFFSET;
        let new_block = read_u64_le(&out_data[new_entry_base..new_entry_base + 8]);
        if new_block < prev_tail_block {
            return Err(Error::HistoryNonMonotonic);
        }
    }

    // TODO: verify the new entry's `decision_id` corresponds to the
    // ProtocolDecisionCell consumed in the SAME tx. Currently the type-
    // script trusts the appended entry's decision_id; the registry-cell
    // type-script catches the unauthorized-value-change case, so this
    // gap is bounded but should be tightened. Audit gate.

    Ok(())
}

// ============ Companion cell discovery ============

/// Walk CellDep slots looking for cell data shaped like a BoundsCell. For
/// the scaffold we match on (version == SCHEMA_VERSION) and (data length
/// >= the minimum bounds-cell length for a 1-bound encoding). The first
/// match wins.
///
/// TODO: replace with compile-time code-hash matching against the deployed
/// `lawson-constants-cell-type-script` binary, with the `RoleTag::Bounds`
/// args[0]. Until then this is shape-only and an adversary could craft an
/// unrelated cell of similar shape. Audit gate.
fn find_bounds_cell_dep() -> Result<heapless::Vec<u8, 8192>, Error> {
    let min_bounds_len = BOUNDS_HEADER_LEN + BOUND_ENTRY_LEN + BOUNDS_GENESIS_HEIGHT_LEN;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, Source::CellDep) {
            Ok(data) => {
                if data.len() >= min_bounds_len && data[0] == SCHEMA_VERSION {
                    // TODO: also verify this cell's type-script has the
                    // same code-hash as ours AND args[0] == RoleTag::Bounds.
                    let mut buf: heapless::Vec<u8, 8192> = heapless::Vec::new();
                    // Truncated copy if oversized (pathological); for the
                    // scaffold we reject anything larger than the heapless
                    // bound — production should stream instead.
                    if data.len() > buf.capacity() {
                        return Err(Error::CapacityExceeded);
                    }
                    for b in data.iter() {
                        // unwrap-or-break: we already checked capacity.
                        if buf.push(*b).is_err() {
                            return Err(Error::CapacityExceeded);
                        }
                    }
                    return Ok(buf);
                }
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => {
                // No BoundsCell in deps: registry update cannot proceed.
                return Err(Error::ItemMissing);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

// ============ Group-cell helpers ============

fn count_group_cells(source: Source) -> Result<usize, Error> {
    let mut count = 0usize;
    let mut idx = 0usize;
    loop {
        match load_cell_data(idx, source) {
            Ok(_) => {
                count += 1;
                idx += 1;
            }
            Err(ckb_std::error::SysError::IndexOutOfBound) => return Ok(count),
            Err(e) => return Err(e.into()),
        }
    }
}

/// Collect all cell-data blobs in the group source into a heapless::Vec
/// of owned Vec<u8>. We use ckb-std's `alloc`-fed Vec (from default_alloc)
/// because borrowing across syscalls is awkward with QueryIter and the
/// data sizes are small (under 16 KB per registry).
fn collect_group_data(
    source: Source,
) -> Result<heapless::Vec<alloc::vec::Vec<u8>, 8>, Error> {
    let mut out: heapless::Vec<alloc::vec::Vec<u8>, 8> = heapless::Vec::new();
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

