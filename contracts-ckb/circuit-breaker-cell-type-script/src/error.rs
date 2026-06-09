//! Error codes returned by `circuit-breaker-cell-type-script`.
//!
//! Codes 1-9 are reserved for ckb-std SysError conversion (matches the
//! convention used by sibling crates `datatoken-cell-type-script`,
//! `primitive-cell-type-script`, `vibeswap-canonical-token-type-script`,
//! `lawson-constants-cell-type-script`). Codes 50+ are script-specific
//! to the circuit-breaker triad.
//!
//! On failure, `program_entry()` returns the discriminant value as the
//! exit code (CKB-VM consumes this as the verification result).

use ckb_std::error::SysError;

#[repr(i8)]
#[derive(Debug, Clone, Copy)]
pub enum Error {
    // ============ ckb-std passthrough (1-9) ============
    IndexOutOfBound = 1,
    ItemMissing = 2,
    LengthNotEnough = 3,
    Encoding = 4,

    // ============ Cell-shape invariants (50-59) ============
    /// Cell data is shorter than the minimum layout requires.
    CellDataMalformed = 50,
    /// Version byte does not match SCHEMA_VERSION.
    SchemaVersionUnsupported = 51,
    /// Script args malformed (expected exactly one of the three
    /// cell-role tag bytes; see `RoleTag`).
    ScriptArgsMalformed = 52,
    /// Heapless capacity exceeded.
    CapacityExceeded = 53,
    /// Encoded enum discriminant unknown (SignalType, BreakerState, ...).
    EnumDiscriminantUnknown = 54,

    // ============ BreakerCell invariants (60-69) ============
    /// BreakerCell input present but no output produced (state cannot be
    /// destroyed; breaker cells are forever once minted).
    BreakerDestroyed = 60,
    /// BreakerCell `breaker_id` mutated between input and output (identity
    /// is immutable; each breaker is per `(mechanism, signal)`).
    BreakerIdMutated = 61,
    /// Counter exceeds threshold but state remains Clear in the output
    /// (trip must fire when threshold is crossed).
    TripNotFired = 62,
    /// State transition is illegal (e.g., Clear -> Resuming, or
    /// Resuming -> Tripped). See `is_legal_transition`.
    IllegalStateTransition = 63,
    /// Output state is Tripped but `tripped_at_block` is unset.
    TrippedAtBlockMissing = 64,
    /// Counter-window math invariant violated (window_start moved
    /// backward, or counter mutated without window slide / trade).
    CounterWindowInvariant = 65,
    /// Threshold read from the LawsonConstantsRegistry does not match the
    /// threshold encoded in the BreakerCell. The breaker's threshold is
    /// projected from Lawson; mismatch implies stale or forged state.
    /// CYCLE5: this enforcement gated on the registry-cell-dep wiring
    /// being non-heuristic (see find_lawson_registry_cell_dep TODO).
    ThresholdMismatch = 66,
    /// Resume transition (Tripped -> Resuming) attempted without a
    /// BreakerAttestationCell consumed in the same tx with matching
    /// `breaker_id`.
    ResumeMissingAttestation = 67,
    /// Finalize transition (Resuming -> Clear) attempted before
    /// `tripped_at_block + cooldown_blocks` has elapsed.
    CooldownNotElapsed = 68,
    /// Finalize transition (Resuming -> Clear) attempted without a
    /// mature BreakerResumeQueueCell consumed in the same tx.
    ResumeQueueMissing = 69,

    // ============ BreakerAttestationCell invariants (70-79) ============
    /// AttestationCell `breaker_id` does not match the BreakerCell being
    /// resumed.
    AttestationBreakerIdMismatch = 70,
    /// Signer count in `signer_bitmap` is below the breaker's
    /// `attestation_quorum`. Default quorum = 3 per executed default
    /// (matches NCI minimum-validator-rotation).
    AttestationQuorumNotMet = 71,
    /// `cleared_at_block` is stale (outside the configured staleness
    /// window). Prevents replay of old attestations.
    AttestationStale = 72,
    /// BLS aggregated signature verification failed against the
    /// NCI-validator-set referenced by cell-dep.
    /// CYCLE5: actual BLS pairing check delegated to `bls-verify` crate;
    /// this scaffold rejects only on shape-level invariants until that
    /// crate's `verify_aggregated` is wired in.
    AttestationSignatureInvalid = 73,
    /// AttestationCell appeared as output without being consumed as input
    /// — attestations are one-shot and must be consumed in the resume tx
    /// that mints them.
    AttestationCellLeaked = 74,

    // ============ BreakerResumeQueueCell invariants (80-89) ============
    /// ResumeQueueCell `breaker_id` does not match the BreakerCell being
    /// finalized.
    ResumeQueueBreakerIdMismatch = 80,
    /// `eligible_at_block` was computed incorrectly from the requested
    /// resume block + cooldown.
    ResumeQueueEligibilityWrong = 81,
    /// Resume queue FIFO ordering violated (sequence_num must be
    /// monotonic; reorder rejected to preserve fairness).
    ResumeQueueOrderViolated = 82,
    /// `attestation_outpoint` does not point to the AttestationCell
    /// consumed in the request tx.
    /// CYCLE5: this enforcement currently shape-only (outpoint length
    /// validated, but cross-tx referential integrity not yet verified).
    ResumeQueueAttestationMissing = 83,
    /// ResumeQueueCell consumed before `eligible_at_block`.
    ResumeQueueImmature = 84,

    // ============ Composition invariants (90-99) ============
    /// LawsonConstantsRegistry cell-dep not provided. Required for the
    /// threshold/cooldown/quorum reads.
    LawsonRegistryMissing = 90,
    /// NCI ValidatorRegistry cell-dep not provided (for attestation
    /// signer verification).
    ValidatorRegistryMissing = 91,
}

impl From<SysError> for Error {
    fn from(err: SysError) -> Self {
        match err {
            SysError::IndexOutOfBound => Self::IndexOutOfBound,
            SysError::ItemMissing => Self::ItemMissing,
            SysError::LengthNotEnough(_) => Self::LengthNotEnough,
            SysError::Encoding => Self::Encoding,
            // Catch-all: any new variant ckb-std introduces gets bucketed
            // into Encoding rather than producing an unreachable! panic in
            // VM. TODO: verify against ckb-std 0.16 SysError variant list.
            _ => Self::Encoding,
        }
    }
}
