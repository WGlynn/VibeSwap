//! Error codes for `withdrawal-boundary-cell-type-script`.

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

    // NCI authorization (common skeleton §1)
    NciScoreCellDepMissing = 50,
    NciScoreBelowThreshold = 51,
    NciScoreStale = 52,
    WitnessNciLinkBroken = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // Matched-deposit (§2.2 step 4: matched-deposit existence + unconsumed)
    MatchedDepositMissing = 70,
    MatchedDepositOwnerMismatch = 71,
    MatchedDepositSudtMismatch = 72,
    MatchedDepositConsumed = 73,

    // Amount (§2.2: amount ≤ matched_deposit.amount)
    WithdrawalExceedsDeposit = 80,
    CanonicalTokenOutputAbsent = 81,
    CanonicalTokenOutputMismatch = 82,

    // Finality on matched deposit (REORG §6 — 6 blocks)
    MatchedDepositNotYetFinal = 90,
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
