//! Error codes for `cross-chain-in-boundary-cell-type-script`.

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
    SourceChainIdReserved = 36,

    // NCI authorization (common skeleton §1)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Attestation + registry binding (§2.7 step 3 + 4)
    AttestationCellDepMissing = 70,
    AttestationFieldMismatch = 71,
    AttestationEpochMismatch = 72,
    ValidatorRegistryCellDepMissing = 73,
    ValidatorRegistryMalformed = 74,

    // Replay prevention (§2.7 step 5)
    BurnIdReplayed = 80,

    // Same-tx mint match (§2.7 step 6)
    CanonicalMintOutputMissing = 90,
    CanonicalMintAmountMismatch = 91,
    CanonicalMintRecipientMismatch = 92,

    // Finality (REORG_BEHAVIOR_DESIGN §6 — 24 blocks, most reorg-sensitive)
    CrossChainInNotYetFinal = 100,
    TipAnchorCellDepMissing = 101,

    // Capacity
    CapacityExceeded = 110,
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
