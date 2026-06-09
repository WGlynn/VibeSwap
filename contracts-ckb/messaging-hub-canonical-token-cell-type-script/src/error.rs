//! Error codes for `messaging-hub-canonical-token-cell-type-script`.
//!
//! Codes 1-9 = ckb-std passthrough. 30+ = script-specific.

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
    ChainIdReserved = 34,
    DirectionInvalid = 35,

    // ============ Authority modes (40-49) ============
    MintWithoutClaim = 40,
    MintWithoutAttestation = 41,
    MintAmountMismatch = 42,
    BurnWithoutReceipt = 43,
    BurnAmountMismatch = 44,
    DirectionInvalidForMint = 45,
    DirectionInvalidForBurn = 46,
    DirectionFlipped = 47,
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
