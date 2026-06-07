# CircuitBreaker — CKB Cell Spec

**Spec layer**: `vibeswap/contracts/core/CircuitBreaker.sol`
**Port classification**: REINTERPRET
**Status**: Spec draft. Composes with VibeAMM and other mechanism specs.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Multi-level pause cells with attested-resume per `[P·circuit-breaker-attested-resume]`. Each breaker tracks a specific signal (volume, price, withdrawal, depeg, etc.) against a configured threshold. When the threshold trips, the breaker enters a paused state. Resume requires attestation from a quorum of operators that the underlying condition has cleared, plus a cooldown floor that elapses before resume becomes possible regardless of attestation.

The structural property is that an emergency pause is fast (single transaction can trip), but resume is slow and witnessed (cooldown + attestation), preventing flash-attack-resume scenarios. The substrate enforces both halves.

## Cell architecture

One BreakerCell per (mechanism, signal-type) pair. Pauses produce updated BreakerCells. Resumes consume an attestation cell and produce updated BreakerCells.

**BreakerCell.** Holds the current state for one breaker: tripped/clear, tripped-at-block, threshold, current counter value, cooldown duration, the mechanism it gates. Lock-script permissionless; type-script enforces state transitions.

**BreakerAttestationCell.** Created when a quorum of operators attests that a tripped breaker's underlying condition has cleared. Consumed by the resume transaction. Holds BLS-aggregated operator signatures.

**BreakerResumeQueueCell.** Tracks resume requests awaiting cooldown completion. Holds the requested resume timestamp and the attesting quorum reference.

## Per-cell specifications

### BreakerCell

**Data layout** (cell-data):
- `version: u8`
- `breaker_id: [u8; 32]` (hash of mechanism_id + signal_type)
- `mechanism_id: [u8; 32]` (which mechanism this gates)
- `signal_type: SignalType` (Volume, Price, Withdrawal, Depeg, etc.)
- `threshold: u128`
- `current_counter: u128`
- `counter_window_blocks: u64` (counter resets after this many blocks)
- `counter_window_start: u64`
- `state: BreakerState` (Clear, Tripped, Resuming)
- `tripped_at_block: Option<u64>`
- `cooldown_blocks: u64` (minimum elapsed time before resume becomes possible)
- `attestation_quorum: u16` (required operators for resume)

**Lock-script**: Permissionless.

**Type-script invariants** (counter update on every mechanism action):
- `current_counter` updates based on the signal_type (e.g., for Volume: counter += trade_size)
- If `block.height > counter_window_start + counter_window_blocks`, counter resets and window slides
- If `current_counter > threshold` and `state == Clear`, state transitions to Tripped, `tripped_at_block = current_block`
- All mechanism-touching transactions must read+update this cell if applicable to that mechanism+signal

**Type-script invariants** (trip transition):
- `state` Clear → Tripped only when `current_counter > threshold`
- Mechanism transactions that would cross the threshold are rejected (or the mechanism's type-script triggers the trip in the same tx)

**Type-script invariants** (resume transition):
- `state` Tripped → Resuming requires a BreakerAttestationCell consumed in the same transaction with matching `breaker_id`
- `state` Resuming → Clear requires `block.height ≥ tripped_at_block + cooldown_blocks` AND the BreakerResumeQueueCell's request is mature
- Counter resets to 0 on transition to Clear

### BreakerAttestationCell

**Data layout** (cell-data):
- `version: u8`
- `breaker_id: [u8; 32]`
- `cleared_at_block: u64`
- `aggregated_signature: [u8; 96]` (BLS12-381)
- `signer_bitmap: Vec<u8>`
- `attestation_message: AttestationMessage` (breaker_id, cleared_at_block, "CLEAR_ATTESTED")

**Lock-script**: Permissionless.

**Type-script invariants**:
- `aggregated_signature` verifies against the operator-set (read from MessagingHub's ValidatorRegistryCell via cell-dep, or a breaker-specific operator set)
- The number of signers in `signer_bitmap` ≥ `attestation_quorum` (read from the BreakerCell)
- The signed message attests that the underlying condition has cleared
- `cleared_at_block` is recent (within a configured staleness window)

### BreakerResumeQueueCell

**Data layout** (cell-data):
- `version: u8`
- `breaker_id: [u8; 32]`
- `resume_requested_at: u64`
- `attestation_outpoint: OutPoint`
- `eligible_at_block: u64` (= request_block + cooldown_blocks)

**Lock-script**: Permissionless.

**Type-script invariants**:
- Created when a resume request is initiated, after the BreakerAttestationCell is in place
- `eligible_at_block` is computed correctly from cooldown
- Consumable only when `block.height ≥ eligible_at_block`

## Transaction shapes

**Counter update transaction** (implicit, embedded in mechanism transactions): Whenever a mechanism action (swap, withdrawal, etc.) touches a signal a breaker watches, the same transaction updates the BreakerCell counter.
- Inputs: previous BreakerCell, mechanism-specific inputs
- Outputs: updated BreakerCell, mechanism-specific outputs
- Cell-deps: LawsonConstantsRegistry (for threshold reads)

**Trip transaction**: Implicit at threshold-cross. Counter update transitions state Clear → Tripped if threshold exceeded.

**Resume-request transaction**: Anyone can initiate a resume sequence once a BreakerAttestationCell exists.
- Inputs: BreakerCell (Tripped), BreakerAttestationCell, capacity
- Outputs: BreakerCell (Resuming), BreakerResumeQueueCell
- Type-script verifies attestation quorum

**Resume-finalize transaction**: Anyone can finalize once cooldown has elapsed.
- Inputs: BreakerCell (Resuming), BreakerResumeQueueCell (mature)
- Outputs: BreakerCell (Clear)
- Type-script verifies eligible_at_block has passed

## Property preservation

**Asymmetric trip-vs-resume**: Trip is a side-effect of a normal transaction (fast). Resume requires attestation + cooldown + finalization (slow). This is the load-bearing structural property: an attacker can trip a breaker easily as part of an attempted exploit, but cannot resume it in the same flash-window.

**Permissionless trip detection**: Anyone can construct the counter-update transaction. The type-script enforces correctness. Adversaries can't suppress legitimate trips.

**Permissionless resume execution**: Once attestation + cooldown are satisfied, anyone can construct the resume transaction. No resume authority.

**Attested resume requires quorum**: Resume cannot happen on a single operator's say-so. The quorum requirement plus BLS aggregation prevents any single operator from unilaterally unpausing.

**Cooldown floor**: Even with full attestation, resume cannot complete before cooldown elapses. This is the time window during which adversarial-resume challenges can surface.

**Per-mechanism, per-signal isolation**: Each (mechanism, signal) pair has its own BreakerCell. A trip in one breaker doesn't cascade to others unless explicitly composed via cell-deps.

**Small-withdrawal bypass**: For withdrawal breakers, small withdrawals below SMALL_WITHDRAWAL_BPS_THRESHOLD can bypass the breaker per the Solidity version. This lives in the consuming mechanism's type-script (e.g., VibeAMM PoolTypeScript), not in the BreakerCell itself.

## Upstream pulls

**From MessagingHub**: BLS verification library, ValidatorRegistryCell pattern (if operator set is shared).

**From LawsonConstantsRegistry**: Thresholds, cooldown durations, attestation quorum sizes (all governance-tunable within bounds).

**From `ckb-std`**: Standard syscalls.

**From `ckb-system-scripts`**: Where needed.

## Build new

**BreakerTypeScript**: Rust crate. Counter logic, threshold check, state-transition rules.

**BreakerAttestationTypeScript**: Rust crate. BLS verification reuses MessagingHub code.

**BreakerResumeQueueTypeScript**: Rust crate. Cooldown-eligibility check.

**Mechanism-side integration**: Each mechanism that consumes a breaker (e.g., VibeAMM PoolTypeScript) reads + updates the BreakerCell as part of its own type-script logic. No separate integration code; it's part of each mechanism's spec.

## Open questions

- **Cross-breaker cascades**: Some breaker trips should imply others (e.g., a depeg detected on one pool should pause that pool's withdrawals). The current design isolates breakers. Composition can be done by chaining BreakerCells via cell-deps, but the latency and consistency model needs careful design.

- **Operator set scope**: BreakerAttestationCell signers can be the messaging validators (reused), or a dedicated breaker-operator set. Reuse is simpler but couples the two mechanisms. Dedicated set is cleaner but more bonded-stake-management overhead. Default to reuse, escalate to dedicated if scope grows.

- **Cooldown vs immediate-resume on false-positive**: If a breaker trips on a false positive (e.g., a temporary network glitch that produces a fake depeg signal), the cooldown means real users wait. Counter-design: a fast-path resume for false-positive detection that requires a higher attestation threshold (e.g., 90% vs 67%) but no cooldown. Adds complexity; defer unless data shows it's needed.

- **Adversarial trip griefing**: An adversary can intentionally trigger breakers to cause downtime. The volume breaker is most vulnerable here (large wash trades to push the counter). Mitigation: per-actor counters (already in Fibonacci damping spec), or trip-cost pricing (small fee to trip beyond a soft warning level). Out of scope for this spec but flagged.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/core/CircuitBreaker.sol`
- Mechanism primitives: `[P·circuit-breaker-attested-resume]`, `[P·structure-does-the-work]`, `[P·dissolve-attack-surface]`, `[P·TWAP-depeg-detector]`
- Related specs: `vibe-amm.md` (primary consumer), `lawson-constants.md` (thresholds), `messaging-hub.md` (BLS + operator set), `nci-consensus.md` (governance authorization for threshold updates)
