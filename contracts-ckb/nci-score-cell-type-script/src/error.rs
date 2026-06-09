//! Error codes for `nci-score-cell-type-script`.

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ============ ckb-std passthrough (1-9) ============
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // ============ Cell-shape invariants (30-39) ============
    CellDataMalformed = 30,
    SchemaVersionUnsupported = 31,
    ScriptArgsMalformed = 32,
    AmountOverflow = 33,
    EmptyTransition = 34,

    // ============ Score-composition invariants (40-49) ============
    /// `unified_score != weighted_sum(components) / 10000`.
    ScoreCompositionMismatch = 40,
    /// `pow_bps + pos_bps + pom_bps != 10000`.
    PillarWeightsMalformed = 41,
    /// A pillar component falls below its Lawson-pinned per-pillar floor.
    PillarFloorViolated = 42,
    /// Cross-constraint `pow_bps + pos_bps < pom_bps` failed.
    PomNotDominant = 43,

    // ============ Cell-dep / witness binding (50-59) ============
    /// LawsonConstantsRegistry cell-dep is missing or shape-malformed.
    LawsonCellDepMissing = 50,
    /// ValidatorRegistry cell-dep is missing or shape-malformed.
    ValidatorRegistryCellDepMissing = 51,
    /// AttestationCell witness tx-hash does not resolve in cell-deps.
    AttestationWitnessUnresolved = 52,
    /// AttestationCell signer count does not match `attestation_count`.
    AttestationCountMismatch = 53,
    /// `attestation_count` below threshold derived from ValidatorRegistry.
    AttestationBelowQuorum = 54,

    // ============ Freshness / monotonicity (60-69) ============
    /// `tip_height - inclusion_height > MAX_SCORE_AGE_BLOCKS`.
    ScoreStale = 60,
    /// Output `epoch < input.epoch` on transition.
    EpochNotMonotonic = 61,

    // ============ Capacity (70-79) ============
    CapacityExceeded = 70,
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
