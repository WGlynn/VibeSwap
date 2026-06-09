//! Error codes returned by `lawson-constants-cell-type-script`.
//!
//! Codes 1-9 are reserved for ckb-std SysError conversion (matches the
//! convention used by sibling crates `datatoken-cell-type-script`,
//! `primitive-cell-type-script`, and `vibeswap-canonical-token-type-
//! script`). Codes 50+ are script-specific to the Lawson-constants triad.
//!
//! On failure, `program_entry()` returns the discriminant value as the
//! exit code (CKB-VM consumes this as the verification result).

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ============ ckb-std passthrough (1-9) ============
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // ============ Cell-shape invariants (50-59) ============
    /// Cell data is shorter than the minimum layout requires.
    CellDataMalformed = 50,
    /// Version byte does not match SCHEMA_VERSION.
    SchemaVersionUnsupported = 51,
    /// Script args malformed (expected exactly one of the three
    /// cell-role tag bytes; see `RoleTag`).
    ScriptArgsMalformed = 52,
    /// Heapless capacity exceeded (>64 constants or >64 bounds).
    CapacityExceeded = 53,

    // ============ ConstitutionalBoundsCell invariants (60-69) ============
    /// ConstitutionalBoundsCell appeared as input — it is immutable post-
    /// genesis and must never be consumed (only referenced as cell-dep).
    BoundsCellConsumed = 60,
    /// ConstitutionalBoundsCell produced outside a genesis transaction.
    /// CYCLE5: distinguish "genesis tx" from "later tx" via header-dep on
    /// block 0; for the scaffold any output is rejected unless the input
    /// side is empty (Cellbase-like shape).
    BoundsCellMintedPostGenesis = 61,
    /// A bound has `min_value > max_value` (illegal range).
    BoundsRangeInverted = 62,
    /// A bound has `alpha_min > alpha_max` (illegal alpha range).
    AlphaRangeInverted = 63,

    // ============ ConstantsRegistryCell invariants (70-79) ============
    /// A constant's `value` falls outside its bound's [min_value, max_value].
    ConstantValueOutOfBounds = 70,
    /// A constant's `alpha` falls outside its bound's [alpha_min, alpha_max].
    ConstantAlphaOutOfBounds = 71,
    /// A constant in the output cell carries a `name_hash` that does not
    /// appear in the ConstitutionalBoundsCell.
    ConstantNameUnknown = 72,
    /// The output registry references a different bounds-cell outpoint than
    /// the one provided as cell-dep.
    BoundsCellMismatch = 73,
    /// The output registry mutates an unchanged constant's
    /// `last_updated_at_block` (must preserve unchanged constants).
    UnchangedConstantMutated = 74,
    /// More than one constant changed between input and output. Per the
    /// spec, each update transaction changes exactly one constant.
    MultiConstantUpdate = 75,
    /// The set of `name_hash` keys in input and output do not match (constants
    /// cannot be added or removed by a tunable update — only modified).
    ConstantSetMutated = 76,
    /// ConstantsRegistryCell input present but no output produced (state
    /// cannot be destroyed; the registry is forever).
    RegistryDestroyed = 77,

    // ============ ConstantsHistoryCell invariants (80-89) ============
    /// History output is shorter than the input (append-only violation).
    HistoryTruncated = 80,
    /// History output adds more than one entry per update tx (per spec,
    /// each update writes exactly one history entry).
    HistoryMultipleEntries = 81,
    /// History output rewrote an existing entry (the prefix must be
    /// byte-identical to the input).
    HistoryRewritten = 82,
    /// The newly appended history entry's `at_block` is older than the
    /// previous tail entry (monotonic block-height required).
    HistoryNonMonotonic = 83,
    /// History input present but no output produced.
    HistoryDestroyed = 84,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            // Catch-all: any new variant ckb-std introduces gets bucketed
            // into Encoding rather than producing an unreachable! panic in
            // VM. TODO: verify against ckb-std 0.16 SysError variant list.
            _ => Self::Encoding,
        }
    }
}
