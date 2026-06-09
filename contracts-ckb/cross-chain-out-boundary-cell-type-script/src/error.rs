//! Error codes for `cross-chain-out-boundary-cell-type-script`.

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
    ZeroAmount = 36,
    ZeroBurnId = 37,

    // NCI authorization (Common Skeleton §1 steps 1-3)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Replay prevention (§2.8 — burn_id uniqueness across siblings)
    BurnIdReplayed = 70,
    BurnIdDuplicateWithinTx = 71,

    // Cross-cell composition with canonical-token + BurnReceiptCell
    CanonicalBurnAmountMismatch = 80,
    CanonicalBurnAbsent = 81,
    BurnReceiptAbsent = 82,
    BurnReceiptAmountMismatch = 83,
    BurnReceiptBurnIdMismatch = 84,
    BurnReceiptDestChainMismatch = 85,
    BurnReceiptRecipientMismatch = 86,

    // Destination-chain validation
    DestChainIdReserved = 90,
    DestChainNotSupported = 91,

    // Finality (REORG_BEHAVIOR_DESIGN §6 — outbound = withdrawal class)
    InclusionHeightInFuture = 95,
    TipAnchorCellDepMissing = 96,

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
