//! Error codes for `slash-boundary-cell-type-script`.

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
    SlashReasonUnknown = 36,
    SlashAmountZero = 37,

    // NCI authorization (common skeleton §1; highest threshold of any boundary)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Evidence + registry binding (§2.4 step 3 + 4)
    EvidenceCellDepMissing = 70,
    EvidenceShapeMismatch = 71,
    EvidenceReasonMismatch = 72,
    ValidatorRegistryCellDepMissing = 73,
    ValidatorNotBonded = 74,

    // Slash cap (§2.4 step 5; Lawson SLASH_LOSING_SHARE_BPS)
    SlashAmountExceedsCap = 80,
    SlashCapMalformed = 81,
    SlashCapOverflow = 82,

    // Replay prevention (§2.4 step 7; per evidence_cell_outpoint)
    EvidenceOutpointReplayed = 90,

    // Finality (REORG_BEHAVIOR_DESIGN §6 — 100 blocks, deepest threshold)
    SlashNotYetFinal = 100,
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
