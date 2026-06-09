//! Error codes for `messaging-hub-burn-receipt-cell-type-script`.

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
    DestinationChainIdReserved = 34,
    SourceChainIdReserved = 35,

    // ============ Authority / invariants (40-49) ============
    BurnAmountMismatch = 40,
    BurnIdDuplicate = 41,
    NoCanonicalBurnObserved = 42,
    ReceiptEditAttempted = 43,
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
