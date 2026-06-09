//! Error codes for `deposit-boundary-cell-type-script`.

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
    AmountOverflow = 33,
    EmptyTransition = 34,
    CellMultiplicityMismatch = 35,
    DataMutated = 36,

    // NCI authorization (common skeleton §1)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Replay prevention (§2.1 step 4)
    SourceOutpointReplayed = 70,

    // Amount conservation (cross-cell with canonical-token)
    AmountConservationFailed = 80,
    CanonicalTokenAbsent = 81,

    // Finality (REORG_BEHAVIOR_DESIGN §6 — withdrawal/claim side)
    DepositNotYetFinal = 90,
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
