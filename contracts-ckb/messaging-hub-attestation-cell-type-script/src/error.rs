//! Error codes for `messaging-hub-attestation-cell-type-script`.
//!
//! 60-79 is reserved for bls-verify pass-through codes (the library
//! returns u8 1-9; we add 60 to project them into our script-error space).

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
    EmptyTransition = 33,
    AttestationEditAttempted = 34,

    // ============ Attestation semantics (40-49) ============
    DestinationChainMismatch = 40,
    AttestationEpochMismatch = 41,
    SourceChainIdReserved = 42,
    AttestationIdMismatch = 43,

    // ============ Registry cell-dep (50-59) ============
    RegistryCellDepMissing = 50,
    RegistryMalformed = 51,

    // ============ bls-verify pass-through (60-79) ============
    /// Wraps a `bls_verify::BlsError` code (1-9) shifted by +60.
    /// Recipient can subtract 60 to recover the underlying lib error.
    BlsLibError(i8) = 60,
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
