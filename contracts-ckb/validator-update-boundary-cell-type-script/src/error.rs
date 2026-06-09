//! Error codes for `validator-update-boundary-cell-type-script`.

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ckb-std passthrough
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // Cell-shape invariants
    CellDataMalformed = 30,
    SchemaVersionUnsupported = 31,
    ScriptArgsMalformed = 32,
    ChangeTypeUnknown = 33,
    EmptyTransition = 34,
    CellMultiplicityMismatch = 35,

    // NCI authorization (common skeleton §1)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Registry binding (§2.3-specific)
    RegistryInputAbsent = 70,
    RegistryOutputAbsent = 71,
    RegistryOutpointMismatch = 72,
    RegistryEpochNotMonotonic = 73,
    RegistryMalformed = 74,

    // Change-shape (§2.3-specific)
    ChangeShapeMismatch = 80,
    AffectedPubkeyAbsentInDelta = 81,
    AffectedPubkeyPresentInDelta = 82,

    // Finality (REORG §6 governance-class = 24 blocks)
    BoundaryNotYetFinal = 90,
    TipAnchorCellDepMissing = 91,

    // Capacity
    CapacityExceeded = 100,
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
