//! Error codes returned by `constitutional-bounds-cell-type-script`.

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ckb-std passthrough (1-9)
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // Cell-shape invariants (50-59)
    CellDataMalformed = 50,
    SchemaVersionUnsupported = 51,
    ScriptArgsMalformed = 52,
    CapacityExceeded = 53,

    // Immutability invariants (60-69)
    /// Input bears this script but output set is empty or non-matching:
    /// the cell cannot be destroyed.
    CellDestroyed = 60,
    /// Output count != input count for an update-shaped tx (single cell
    /// in, single cell out is the only allowed update shape, and even
    /// then only when byte-identical).
    CellMultiplicityMismatch = 61,
    /// Output cell data differs from input cell data: cell is immutable.
    DataMutated = 62,
    /// Output lock-script differs from input lock-script.
    LockMutated = 63,
    /// Multiple cells minted in a single tx: singleton invariant.
    SingletonViolation = 64,

    // Bound-shape invariants (70-79)
    /// A bound has `min_value > max_value`.
    BoundsRangeInverted = 70,
    /// A bound has `alpha_min > alpha_max`.
    AlphaRangeInverted = 71,
    /// Cross-constraint op-code unrecognized.
    CrossConstraintOpUnknown = 72,
    /// Cross-constraint references a name_hash not present in bounds.
    CrossConstraintNameMissing = 73,
    /// Cross-constraint SUM_LT failed: the upper-bound sum is not strictly
    /// less than the operand bound's lower bound (the cross-constraint
    /// cannot be satisfied by any in-bound assignment).
    CrossConstraintUnsatisfiable = 74,

    // Singleton invariants (80-89)
    /// Genesis-script-hash check failed: this is not the canonical
    /// instance defined at genesis.
    NotGenesisInstance = 80,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            _ => Self::Encoding,
        }
    }
}
