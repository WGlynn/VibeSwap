//! Error codes returned by `shapley-distributor-cell-type-script`.
//!
//! Codes 1-9: ckb-std SysError passthrough (workspace convention).
//! Codes 30+: script-specific to the Shapley distributor cell family.

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
    CapacityExceeded = 33,
    EnumDiscriminantUnknown = 34,
    EmptyTransition = 35,
    CellMultiplicityMismatch = 36,

    // ============ ContributionEventCell invariants (40-49) ============
    EventIdMismatch = 40,
    DuplicateParticipantLockHash = 41,
    SourceMechanismMissing = 42,
    NegativeCharacteristicValue = 43,
    TotalValueMismatchSource = 44,
    SybilParticipantPresent = 45,
    EventConsumedWithoutDistribution = 46,

    // ============ ShapleyDistributionCell — 5 axioms (50-59) ============
    /// Σ φ_i ≠ v(N). Efficiency axiom violated.
    AxiomEfficiencyViolated = 50,
    /// Identical characteristic + contribution-type ⇒ unequal share. Symmetry violated.
    AxiomSymmetryViolated = 51,
    /// Zero characteristic ⇒ non-zero share. Null-Player violated.
    AxiomNullPlayerViolated = 52,
    /// φ(v+w) ≠ φ(v) + φ(w). Additivity / Linearity violated.
    /// Cross-event check; verified at composition time per [P·shapley-5-axiom-set].
    AxiomAdditivityViolated = 53,
    /// Pairwise ratio mismatch: |φ_i·w_j − φ_j·w_i| > ε. 5th-axiom (Goodhart defense) violated.
    AxiomPairwiseProportionalityViolated = 54,
    /// FEE_DISTRIBUTION track: distribution depends on era_at_creation. Time-Neutrality violated.
    AxiomTimeNeutralityViolated = 55,
    /// Distribution count ≠ participant count.
    DistributionParticipantCountMismatch = 56,
    /// Distribution lock_hash set ≠ event participant lock_hash set.
    DistributionLockHashSetMismatch = 57,

    // ============ EmissionScheduleCell invariants (60-69) ============
    EmissionScheduleMissing = 60,
    EmissionExceedsEpochBudget = 61,
    EraTransitionPremature = 62,
    HalvingArithmeticInvalid = 63,
    EmissionAccountingInvariant = 64,

    // ============ RewardClaimCell invariants (70-79) ============
    ClaimAmountExceedsDistribution = 70,
    ClaimDistributionLinkBroken = 71,
    ClaimDuplicate = 72,
    ClaimTokenTypeMismatch = 73,
    ClaimDeadlineMisuse = 74,

    // ============ SybilGuardCell invariants (80-89) ============
    SybilGuardCellDepMissing = 80,
    SybilFlagWithoutAttestation = 81,
    SybilUnflagWithoutGovernance = 82,

    // ============ Composition / cell-dep (90-99) ============
    LawsonRegistryMissing = 90,
    SourceOutpointMalformed = 91,
    AmountOverflow = 92,
    HashOfPayloadMismatch = 93,
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
