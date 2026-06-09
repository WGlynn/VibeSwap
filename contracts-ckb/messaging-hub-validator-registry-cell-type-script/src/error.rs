//! Error codes for `messaging-hub-validator-registry-cell-type-script`.

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ============ ckb-std passthrough (1-9) ============
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // ============ Cell-data shape (30-39) ============
    CellDataMalformed = 30,
    ScriptArgsMalformed = 31,
    SchemaVersionUnsupported = 32,
    AmountOverflow = 33,
    ValidatorCountOutOfRange = 34,
    TotalBondedMismatch = 35,
    EmptyTransition = 36,

    // ============ Transitions (40-49) ============
    EpochNotMonotonic = 40,
    GenesisEpochNotZero = 41,
    ThresholdMalformed = 42,
    ThresholdBelowFloor = 43,

    // ============ Governance (50-59) ============
    GovernanceAuthMissing = 50,
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
