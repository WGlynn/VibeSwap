//! Error codes for `emergency-pause-boundary-cell-type-script`.

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
    EmptyTransition = 34,
    CellMultiplicityMismatch = 35,
    ActionDiscriminantUnknown = 36,
    ScopeDiscriminantUnknown = 37,

    // NCI authorization (common skeleton §1)
    NciScoreCellDepMissing = 50,
    NciScoreBelowTripThreshold = 51,
    NciScoreBelowResumeThreshold = 52,
    NciScoreStale = 53,

    // Lawson / constants
    LawsonCellDepMissing = 60,

    // BreakerCell binding (§2.6: must resolve outpoint to live BreakerCell)
    BreakerCellDepMissing = 70,
    BreakerCellMalformed = 71,
    // Trip on a breaker whose state is already Tripped or Resuming.
    BreakerAlreadyTripped = 72,
    // Resume on a breaker whose state is not Tripped.
    BreakerNotTripped = 73,
    // Same-tx output BreakerCell does not reflect the action's target state.
    BreakerOutputStateMismatch = 74,
    // Same-tx BreakerCell output breaker_id does not match the boundary's
    // referenced breaker.
    BreakerOutputIdMismatch = 75,

    // Attestation binding (§2.6 asymmetric quorum)
    // Resume requires attestation cell-dep; trip does not.
    AttestationCellDepMissing = 80,
    AttestationBreakerIdMismatch = 81,
    // Trip quorum (3 attesters) not met when boundary cell is in trip mode and
    // attestation is presented as additional evidence.
    TripAttesterCountInsufficient = 82,
    // Resume quorum (unanimous against the registry's validator-count) not met.
    ResumeAttesterCountInsufficient = 83,
    ValidatorRegistryCellDepMissing = 84,

    // Finality (REORG_BEHAVIOR_DESIGN §6: trip = 0, resume = 24)
    // Resume action cannot be consumed before 24-block finality on the
    // boundary cell that authorized it.
    ResumeNotYetFinal = 90,
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
