//! Error codes for `vibe-amm-cell-type-script`.

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
    CapacityExceeded = 33,
    EnumDiscriminantUnknown = 34,
    EmptyTransition = 35,

    // PoolCell identity (immutable across all ops)
    PoolIdentityMutated = 40,
    PoolDestroyed = 41,
    ZeroReserveSide = 42,

    // x*y=k invariant
    ConstantProductViolated = 50,
    FeeAccountingWrong = 51,
    MaxTradeSizeExceeded = 52,
    MaxReserveDrainExceeded = 53,
    DonationImbalanceExceeded = 54,

    // LP supply / share math
    LpSupplyConservationFailed = 60,
    LpMintAmountWrong = 61,
    LpBurnAmountWrong = 62,
    ProportionalAddViolated = 63,
    MinimumLiquidityNotLocked = 64,
    FirstAddRatioInvalid = 65,

    // TWAP ring buffer
    TwapDeviationExceeded = 70,
    TwapRingBufferMalformed = 71,
    TwapTimestampMonotonicity = 72,
    TwapDriftPerWindowExceeded = 73,

    // Circuit-breaker composition
    BreakerCellMissing = 80,
    BreakerCellTripped = 81,
    BreakerCounterNotAdvanced = 82,

    // Cross-cell composition
    LawsonRegistryMissing = 90,
    CanonicalTokenReserveMissing = 91,
    ReserveSudtTypeMismatch = 92,

    // VibeLPCell invariants
    LpPoolIdMutated = 100,
    LpAmountConservationFailed = 101,
    LpAmountOverflow = 102,
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
