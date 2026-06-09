//! Error codes for `commit-reveal-auction-cell-type-script`.

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
    RoleTagUnknown = 33,
    EmptyTransition = 34,
    CellMultiplicityMismatch = 35,

    // Lawson / constants
    LawsonCellDepMissing = 40,
    PoolCellDepMissing = 41,

    // CommitCell invariants (§ CommitCell)
    DepositBelowMinBond = 50,
    CommitOutsideCommitWindow = 51,
    BatchIdMismatch = 52,
    CommitHashMalformed = 53,

    // RevealCell invariants (§ RevealCell)
    RevealOutsideRevealWindow = 60,
    HashBindingFailed = 61,                  // blake2b(order || secret) != commit.hash
    CommitOutpointAbsent = 62,
    OrderDataMalformed = 63,
    DepositOrCollateralMutated = 64,
    OrderExceedsTradeSize = 65,

    // BatchSettlementCell invariants (§ BatchSettlementCell)
    SettlementBeforeBatchEnd = 70,
    ShuffleSeedMismatch = 71,                // seed != XOR(secrets, canonical-ordered)
    FisherYatesOrderingInvalid = 72,
    ClearingPriceInvalid = 73,
    MatchedOrderInconsistent = 74,
    RevealNotIncludedInSettlement = 75,      // a RevealCell consumed but not in matched_orders
    MultiplePoolsInBatch = 76,               // v1: single pool per batch

    // SlashCell invariants (§ SlashCell)
    SlashBeforeDeadline = 80,
    SlashRateMismatch = 81,                  // != 50/50 per SLASH_RATE_BPS
    SlashSumMismatch = 82,                   // treasury + committer + bounty != deposit + collateral
    RevealExistedForCommit = 83,             // a reveal exists; slash forbidden

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
