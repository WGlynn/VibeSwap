# NCI Boundary Enforcement — Mandatory Cell-Dep Invariants at the VibeSwap-App Seam

**Spec layer**: gate-document for Position C of `NCI_CONSENSUS_ANSWER.md`.
**Port classification**: REINTERPRET — the EVM "VibeSwapCore-as-gatekeeper" pattern dissolves into per-boundary type-script invariants on the CKB cell-graph.
**Status**: Spec draft. Load-bearing for the sovereign-pivot: without this doc, NCI cells from `nci-consensus.md` are decoration. With it, app-boundary authorization is structurally enforced by the substrate.
**Substrate**: VibeSwap-augmented Nervos CKB.

---

## 0. What this document is

`NCI_CONSENSUS_ANSWER.md` decided Position C: NCI is app-layer protocol-decision-weighting, **mandatorily invoked at the vibeswap-app seam**. The seam is the set of state-transitions that move value into, out of, or across vibeswap-app cells. This document enumerates that set, exhaustively, and writes the mandatory NCIScoreCell cell-dep + witness invariant that each boundary's type-script must enforce.

Every Rust crate that handles a boundary must read this document and know exactly which cell-dep to require, which witness fields to verify, which Lawson constants to read, and which failure-mode test to round-trip. The document is implementation-ready by design.

The Correspondence Triad is run per boundary: substrate-geometry match (does NCI's score-threshold form match the boundary's natural geometry?), augmented-mechanism-design (math-enforced invariant vs discretionary policy?), augmented-governance (can a 51% block-producer cabal route around it? if yes, what's the backstop?). The triad is the audit-rubric; passing it means the boundary is structurally enforced rather than convention-enforced.

## 1. Common invariant skeleton

Every boundary type-script that gates a vibeswap-app state-transition implements the same four-step structural check. The shape is identical across boundaries; only the threshold-reads, the decision-type tag, and the score-window parameter change.

**Step 1 — Cell-dep presence.** The transaction MUST reference an `NCIScoreCell` of the correct version as a cell-dep. The boundary type-script reads the cell-dep's `data` field and parses an `NCIScoreView`. If no `NCIScoreCell` of the protocol's well-known type-id is present in the cell-deps, the type-script returns `Err(MissingNCIAuthorization)`.

**Step 2 — Witness binding.** The transaction's witness MUST carry an `NCIBoundaryWitness` for the boundary cell, with three fields: `proposal_id`, `decision_type`, `score_celldep_index`. The boundary type-script reads its own witness, then asserts that the referenced cell-dep at `score_celldep_index` is the `NCIScoreCell` whose `proposal_id` matches the witness's `proposal_id`. Any mismatch returns `Err(WitnessNCILinkBroken)`.

**Step 3 — Score-threshold check.** The boundary type-script reads `(min_threshold, max_score_age_blocks)` for its `decision_type` via cell-dep on `LawsonConstantsRegistry`. The bounds are constitutional: thresholds must be in `[MIN_THRESHOLD_BOUND, MAX_THRESHOLD_BOUND]` per `ConstitutionalBoundsCell`. Then the script asserts `NCIScoreView.unified_score ≥ min_threshold` AND `current_block.height − NCIScoreView.computed_at_block ≤ max_score_age_blocks`. The first check enforces authorization; the second enforces freshness. Failures return `Err(NCIScoreBelowThreshold)` or `Err(NCIScoreStale)`.

**Step 4 — Replay protection.** The boundary type-script must verify the boundary's specific replay-window primitive. For irrevocable decisions (governance, validator-set, parameter, emergency pause, slash), the `DecisionsRegistryCell` is consumed-and-recreated with the `proposal_id` appended; reuse fails because `proposal_id` is already present. For continuous boundaries (deposit, withdrawal, cross-chain), a per-trader-per-boundary nonce or score-window mechanism prevents reusing the same `NCIScoreCell` against an unbounded number of transactions; the per-boundary section below specifies the form.

Any boundary cell skipping any of these four steps is by definition broken and the implementing crate's test suite must include a negative round-trip: construct a tx without the cell-dep, without the witness, with a below-threshold score, with a stale score, with a replayed `proposal_id` — assert the type-script rejects each.

## 2. Per-boundary enforcement specifications

The eight boundaries below cover every state-transition that crosses the vibeswap-app seam. For each: the cell that owns the transition, the NCIScoreCell version + fields enforced, the witness shape, the type-script invariant, the failure mode, the Lawson constants consulted, an explicit attacker-bypass attempt with its counter, and the Correspondence-Triad check.

### 2.1 Deposit boundary

**Owning cell**: any `CommitCell` creation that brings external sUDT or CKB capacity into a vibeswap-app cell (`commit-reveal-auction.md` § CommitCell), and `ValidatorBondCell` creation that bonds external sUDT against the messaging-validator role.

**Required cell-dep**: `NCIScoreCell v≥1` with `decision_type = DepositGate` and a `proposal_id` derived as `blake2b("deposit-gate" || epoch_id || pool_id)`. Fields enforced: `unified_score`, `weights_used`, `computed_at_block`, `proposal_id`.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: DepositGate, score_celldep_index }`. The witness binds the CommitCell to the cell-dep'd NCIScoreCell.

**Type-script invariant on the boundary cell**: CommitCell's type-script extends its existing creation-invariants with the Common Skeleton § 1. Step 4's replay form: the `NCIScoreCell` for a `DepositGate` `proposal_id` is **score-window scoped** — valid for the epoch indicated in `proposal_id`. A deposit transaction in epoch `e` may reuse the same NCIScoreCell across many CommitCell creations within epoch `e`. Outside the epoch, the freshness check (`max_score_age_blocks`) fires.

**Failure mode**: missing cell-dep → tx rejected with `MissingNCIAuthorization`. Below-threshold score → rejected with `NCIScoreBelowThreshold`. Stale score (epoch boundary crossed) → rejected with `NCIScoreStale`. Wrong `decision_type` → rejected with `WitnessNCILinkBroken`.

**Lawson constants** (read via cell-dep on `LawsonConstantsRegistry`):
- `DEPOSIT_MIN_SCORE_BPS` ∈ `[5000, 7500]` — the minimum unified score (out of 10000) for deposits to be authorized.
- `DEPOSIT_SCORE_MAX_AGE_BLOCKS` ∈ `[10, 240]` — typically aligned to ~1 epoch.
- `DEPOSIT_POW_PILLAR_MIN_BPS` ∈ `[500, 1500]` — optional per-pillar floor; a deposit-gate score that's high on PoS+PoM but zero on PoW can be refused via this floor.

**Attacker bypass attempt + counter**: an attacker constructs a deposit transaction with no NCIScoreCell cell-dep, hoping the CommitCell type-script will fall back to "no NCI check needed." The CommitCell type-script's Step 1 of the Common Skeleton fails-closed: the absence of the cell-dep is itself the rejection condition. A second attempt cell-deps an `NCIScoreCell` with a forged `unified_score`; the NCIScoreCell type-script (per `nci-consensus.md` § NCIScoreCell) re-derives the score from the consumed pillar inputs, so a forged score cannot exist on-chain in the first place. A third attempt cell-deps a stale NCIScoreCell from a prior epoch; the `max_score_age_blocks` check fires.

**Correspondence-Triad check**:
- Substrate-geometry match: deposits are discrete cell-creation events at the boundary of the vibeswap-app cell-set. NCI's binary-pass-fail-per-tx score-threshold form matches exactly. ✓
- Augmented-mechanism-design: the threshold is constitutional-bounded in `ConstitutionalBoundsCell`; governance tunes within bounds but cannot disable. ✓
- Augmented-governance: a 51% block-producer cabal that refuses to include deposit transactions cannot break the invariant — they delay user liveness, but no NCI-omitting deposit ever advances vibeswap-app state. Any honest block-producer can include the user's deposit tx from the mempool. ✓ (51%-omission attack mitigated by mempool propagation; see § 3.2.)

### 2.2 Withdrawal boundary

**Owning cell**: `BatchSettlementCell` per-order output cells routing sUDT or CKB **out of** vibeswap-app pools to recipient addresses (the local-swap settlement path in `commit-reveal-auction.md` § BatchSettlementCell), plus `ValidatorBondCell` honest-release transitions (`messaging-hub.md` § ValidatorBondCell) returning external value to the bonder.

**Required cell-dep**: `NCIScoreCell v≥1` with `decision_type = WithdrawalGate` and `proposal_id = blake2b("withdrawal-gate" || epoch_id || pool_id)`. Same fields as deposit.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: WithdrawalGate, score_celldep_index }`. For multi-order settlement, a single NCIScoreCell authorizes all withdrawals in the same batch (the proposal_id is per-pool-per-epoch, not per-order).

**Type-script invariant**: BatchSettlementCell's type-script extends with Common Skeleton § 1. The withdrawal-side check is **strictly higher-threshold** than deposit-side: `WITHDRAWAL_MIN_SCORE_BPS > DEPOSIT_MIN_SCORE_BPS` by Lawson floor. Replay: same epoch-scoped window as deposit.

**Failure mode**: same as deposit + an additional check that no batch contains both NCI-authorized and NCI-omitted output cells (any mix fails the BatchSettlementCell type-script).

**Lawson constants**:
- `WITHDRAWAL_MIN_SCORE_BPS` ∈ `[6500, 8500]` — higher floor than deposit; capital exiting needs stronger authorization than capital entering.
- `WITHDRAWAL_SCORE_MAX_AGE_BLOCKS` ∈ `[5, 120]` — tighter freshness window than deposit.
- `WITHDRAWAL_POM_PILLAR_MIN_BPS` ∈ `[3000, 5000]` — PoM pillar floor; cognitive-work attestation is the dominant pillar (60% by weight) and the withdrawal gate insists on it.

**Attacker bypass attempt + counter**: attacker constructs a settlement transaction that omits the cell-dep and tries to drain a pool. BatchSettlementCell type-script's NCI-check (Step 1) fails-closed. Attacker attempts to reuse an old NCIScoreCell across epochs — freshness check fires. Attacker attempts to authorize one batch with a tuned `decision_type` that bypasses the PoM pillar floor — Lawson's `WITHDRAWAL_POM_PILLAR_MIN_BPS` enforces minimum PoM contribution at the boundary cell, not just on the NCIScoreCell's weighted-sum.

**Correspondence-Triad check**:
- Substrate-geometry: withdrawals are also discrete cell events; geometry matches.
- AMD: math-enforced floor on PoM pillar means a PoW+PoS cabal cannot drain pools.
- Augmented governance: 51% omission delays user withdrawals but cannot drain unauthorized; mempool fallback.

### 2.3 Validator-set update boundary

**Owning cell**: `ValidatorRegistryCell` (`messaging-hub.md` § ValidatorRegistryCell) transition from epoch `n` to epoch `n+1`.

**Required cell-dep**: `NCIScoreCell v≥1` AND a `ProtocolDecisionCell` (`nci-consensus.md` § ProtocolDecisionCell) with `decision_type = ValidatorUpdate`. The `ProtocolDecisionCell`'s `nci_score_witness` outpoint must be the cell-dep'd `NCIScoreCell`'s outpoint.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: ValidatorUpdate, score_celldep_index, decision_celldep_index }`. The witness binds the boundary cell to both the score and the decision.

**Type-script invariant**: ValidatorRegistryCell's type-script extends with Common Skeleton § 1 plus a stricter Step 4: the `DecisionsRegistryCell` is consumed-and-recreated with `proposal_id` appended; reuse fails. ValidatorRegistryCell transitions are once-per-proposal_id and the proposal_id is bound to the specific add/remove/bond-change payload.

**Failure mode**: same as deposit. Additional: if the `ProtocolDecisionCell.decision_payload` does not exactly match the proposed `validator_set` delta, the boundary cell rejects (the decision authorizes a specific payload, not a class of updates).

**Lawson constants**:
- `VALIDATOR_UPDATE_MIN_SCORE_BPS` ∈ `[7500, 9000]` — high floor; validator-set changes are load-bearing.
- `VALIDATOR_UPDATE_SCORE_MAX_AGE_BLOCKS` ∈ `[1, 24]` — very fresh; a stale score cannot authorize a registry change.
- `VALIDATOR_UPDATE_THRESHOLD_RATIO_BPS` ∈ `[6667, 7500]` — minimum supermajority embedded in the threshold formula (this is the `threshold_n / threshold_d` floor from the registry's own type-script).

**Attacker bypass attempt + counter**: attacker proposes a malicious validator set, manages to construct an NCIScoreCell barely above threshold by exploiting PoS-validator collusion. Counter: the PoM pillar (60% weight) is the dominant counterweight; PoS-only collusion fails to clear the threshold without PoM cooperation. A PoS+PoM collusion still hits the `VALIDATOR_UPDATE_THRESHOLD_RATIO_BPS` supermajority constraint at the registry level. Attacker replays a prior valid validator-update — `DecisionsRegistryCell` rejects by `proposal_id` presence.

**Correspondence-Triad check**: ✓ across all three axes; this is the boundary the NCI mechanism was originally designed for. Geometric match is exact (discrete decision, per-tx pass-fail). AMD: math-enforced with three-pillar mix. Augmented governance: the 51% block-producer cabal cannot construct a valid NCIScoreCell without controlling the PoM operators (60% weight) and the PoS validators (30%) simultaneously, which is the same security assumption the three-pillar math is designed to dissolve.

### 2.4 Slash boundary

**Owning cell**: `SlashRouter`'s `SlashEventCell` (`slash-router.md` § SlashEventCell). Slashing consumes a `BondCell` and routes the slashed amount to the slashing-pool.

**Required cell-dep**: `NCIScoreCell v≥1` AND `ProtocolDecisionCell` with `decision_type = SlashDispatch`. Same binding pattern as ValidatorUpdate.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: SlashDispatch, score_celldep_index, decision_celldep_index, task_id }`. The `task_id` binds the witness to a specific `TaskVerdictCell`.

**Type-script invariant**: SlashEventCell's type-script extends with Common Skeleton § 1. The `decision_payload` of the consumed `ProtocolDecisionCell` must exactly match the slash parameters: `loser_lock_hash`, `slash_amount`, `bond_outpoint`. Step 4 uses `DispatchedTaskRegistryCell` (already in `slash-router.md`) as the replay primitive, indexed by `task_id`.

**Failure mode**: same as ValidatorUpdate. Additional: a slash dispatch whose `loser_lock_hash` does not match the verdict's identified loser is rejected by both the slash-router's own invariant and the NCI authorization (the `decision_payload` mismatch).

**Lawson constants**:
- `SLASH_MIN_SCORE_BPS` ∈ `[6000, 8000]` — slash is consequential but evidence-driven, so threshold is lower than ValidatorUpdate.
- `SLASH_SCORE_MAX_AGE_BLOCKS` ∈ `[5, 60]` — slash should fire on fresh consensus.
- `SLASHING_LOSING_SHARE_BPS` ∈ `[5000, 8000]` — from `slash-router.md`; the cap on what fraction of bond is slashable.

**Attacker bypass attempt + counter**: attacker tries to slash an innocent validator by constructing a fake `TaskVerdictCell`. The `TaskVerdictCell`'s own type-script (per `pairwise-verifier.md`) rejects fake verdicts. Attacker tries to slash without a `ProtocolDecisionCell` — boundary cell rejects on missing cell-dep. Attacker tries to dispatch the same valid slash twice — `DispatchedTaskRegistryCell` rejects by `task_id` presence. Attacker tries to dispatch a slash with a higher amount than the verdict allows — `slash_amount = bond.amount * verdict.losing_share_bps / 10000` is type-script-enforced and any deviation fails.

**Correspondence-Triad check**: ✓. Slashing is a discrete adjudication; NCI's per-tx form matches. AMD: math-enforced with verdict-bound payload, constitutional cap on losing share. Augmented governance: 51% block-producer omission can delay slash dispatch but cannot prevent it indefinitely; the verdict cell remains in mempool until an honest block-producer includes it.

### 2.5 Governance parameter update boundary

**Owning cell**: `LawsonConstantsRegistry`'s mutation transitions and `ProtocolDecisionCell` creations with `decision_type ∈ {GovernanceVeto, ParameterUpdate}`.

**Required cell-dep**: `NCIScoreCell v≥1` AND `ProtocolDecisionCell` with matching `decision_type`. AND `ConstitutionalBoundsCell` as cell-dep to verify the proposed update stays within constitutional bounds.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type, score_celldep_index, decision_celldep_index, constitutional_bounds_celldep_index }`.

**Type-script invariant**: `LawsonConstantsRegistry`'s type-script extends with Common Skeleton § 1 plus a constitutional-bounds check: the proposed parameter delta must keep every governed constant within its `ConstitutionalBoundsCell` range. Specifically, the NCI weights themselves are governed by this boundary, with the constraint `pos_bps + pow_bps < pom_bps` enforced as a structural invariant (see `nci-consensus.md` § 3 invariant 10). Step 4: `DecisionsRegistryCell` consumed-and-recreated with `proposal_id`.

**Failure mode**: as ValidatorUpdate. Additional: a parameter-update payload that would violate constitutional bounds is rejected even if NCI authorization is otherwise valid. The math-layer veto cannot be tuned away by NCI; the constitutional layer is above the governance layer per `[P·augmented-governance]`.

**Lawson constants** (recursive — these govern themselves):
- `PARAMETER_UPDATE_MIN_SCORE_BPS` ∈ `[7000, 9000]` — high floor.
- `PARAMETER_UPDATE_SCORE_MAX_AGE_BLOCKS` ∈ `[1, 24]` — very fresh.
- `GOVERNANCE_VETO_MIN_SCORE_BPS` ∈ `[7500, 9500]` — vetoes are exceptional; require near-unanimity in weighted terms.

**Attacker bypass attempt + counter**: attacker attempts to update NCI weights to `pow=0, pos=0, pom=10000`, dissolving the three-pillar mix. The `ConstitutionalBoundsCell` (immutable per `nci-consensus.md` § 3) caps `pow_bps ∈ [500,2000]`, `pos_bps ∈ [2000,4000]`, `pom_bps ∈ [4000,7000]`, and the cross-constraint enforces three-pillar diversity. The attacker's proposed payload fails the boundary type-script's constitutional check before NCI authorization is even evaluated. The math-layer veto holds.

**Correspondence-Triad check**: ✓. Discrete governance event; NCI per-tx form matches. AMD: dual-layer enforcement (NCI authorization + constitutional bounds); the constitutional layer is the math-veto on the governance layer. Augmented governance: 51% block-producer omission delays parameter updates but cannot break invariants; constitutional bounds are immutable in genesis cells per `FORK_PLAN.md` (§ 5 of `NCI_CONSENSUS_ANSWER.md`).

### 2.6 Emergency pause boundary

**Owning cell**: `BreakerCell` (`circuit-breaker.md` § BreakerCell) on either trip (`Clear → Tripped`) or resume (`Tripped → Resuming → Clear`).

**Required cell-dep**: trip via a guardian/governance pause (as opposed to automatic threshold-cross) **requires** `NCIScoreCell` + `ProtocolDecisionCell` with `decision_type = EmergencyPause`. Resume **requires** `NCIScoreCell` + `ProtocolDecisionCell` with `decision_type = EmergencyResume`. Automatic threshold-cross trips (the counter exceeds `threshold` during a normal mechanism transaction) do **not** require NCI authorization — they are structural, not discretionary.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type, score_celldep_index, decision_celldep_index, breaker_id }`. The `breaker_id` binds the witness to a specific BreakerCell.

**Type-script invariant**: BreakerCell's type-script differentiates by trigger type:
- Automatic trip: counter exceeds threshold → state transitions Clear → Tripped. No NCI required because the trip is mechanically derived from the underlying signal.
- Discretionary trip (emergency pause): Common Skeleton § 1 fires. `ProtocolDecisionCell.decision_payload` must match `breaker_id` and the requested target state.
- Resume: Common Skeleton § 1 fires AND the cooldown floor (per `circuit-breaker.md`) AND the `BreakerAttestationCell` quorum check all hold simultaneously. NCI authorization is **additive** to attested resume, not substitutive.

Replay: per-breaker `EmergencyDecisionsRegistryCell` indexed by `(breaker_id, proposal_id)`.

**Failure mode**: missing NCI on a discretionary trip → rejected. Missing attestation on a resume → rejected. NCI authorizes resume but cooldown has not elapsed → rejected. NCI authorizes pause for a breaker whose state is already Tripped → idempotent rejection.

**Lawson constants**:
- `EMERGENCY_PAUSE_MIN_SCORE_BPS` ∈ `[5500, 7500]` — pausing is conservative; lower threshold than ValidatorUpdate, higher than DepositGate.
- `EMERGENCY_RESUME_MIN_SCORE_BPS` ∈ `[7500, 9000]` — resuming after pause is more consequential than pausing (false-resume risk).
- `EMERGENCY_SCORE_MAX_AGE_BLOCKS` ∈ `[1, 12]` — very fresh on both sides.

**Attacker bypass attempt + counter**: attacker tries to resume a tripped breaker after a flash exploit by constructing a fake NCIScoreCell — fake scores cannot exist on-chain (NCIScoreCell type-script catches). Attacker tries to use a stale NCIScoreCell from before the trip — freshness check fires. Attacker tries to construct a permissionless resume without attestation — both NCI and `BreakerAttestationCell` checks fire (additive, not OR). Attacker tries to pause a breaker spuriously to grief the protocol — pause requires NCI threshold and `EmergencyDecisionsRegistryCell` replay protection prevents repeated griefing on the same proposal_id.

**Correspondence-Triad check**: ✓. Pause/resume is discrete and binary; geometry matches. AMD: dual enforcement (NCI + cooldown + attestation) for resume, math-enforced thresholds for both. Augmented governance: the asymmetric trip-vs-resume property (`[P·circuit-breaker-attested-resume]`) holds — trips are fast and require lower authorization; resumes are slow and require higher authorization.

### 2.7 Cross-chain in boundary

**Owning cell**: `MintClaimCell` (`messaging-hub.md` § MintClaimCell) creation and consumption, which authorizes the mint of CanonicalTokenCells on CKB-VibeSwap in response to a remote-chain burn.

**Required cell-dep**: `NCIScoreCell v≥1` with `decision_type = CrossChainInGate` and a `proposal_id = blake2b("xchain-in-gate" || epoch_id || source_chain_id)`. The score authorizes the **gate**, not the specific mint; the mint's correctness is independently enforced by the `AttestationCell` BLS verification.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: CrossChainInGate, score_celldep_index, source_chain_id, attestation_outpoint }`.

**Type-script invariant**: `MintClaimCell`'s type-script extends its existing creation invariants (per `messaging-hub.md`) with Common Skeleton § 1. The NCI gate is a layered defense on top of the validator-threshold attestation: even with a valid BLS-threshold attestation, the mint is rejected if the cross-chain-in gate's NCI score is below threshold for the current epoch. This protects against the scenario where the validator set is compromised but the broader three-pillar mix (PoW substrate, PoM operators) has not yet failed.

Replay: the existing `SupplyAccountantCell` (`messaging-hub.md` § SupplyAccountantCell) is the replay primitive; the NCI score-window scopes to per-epoch-per-source-chain, allowing many mints within the window.

**Failure mode**: missing NCI cell-dep → rejected. Valid attestation but below-threshold NCI → rejected (the layered defense fires). NCI fresh but attestation stale → rejected by `messaging-hub.md`'s own attestation invariants. Source chain not in `ChainConfigCell.enabled_inbound` → rejected.

**Lawson constants**:
- `XCHAIN_IN_MIN_SCORE_BPS` ∈ `[6000, 8000]` — higher than deposit because cross-chain trust is broader than local trust.
- `XCHAIN_IN_SCORE_MAX_AGE_BLOCKS` ∈ `[10, 240]` — per-epoch scope.
- `XCHAIN_IN_POM_PILLAR_MIN_BPS` ∈ `[3500, 5500]` — PoM floor; cognitive-work attestation is the strongest signal that the cross-chain bridge is operating honestly.

**Attacker bypass attempt + counter**: attacker compromises the validator set via 2/3 collusion and produces valid BLS attestations for fake burns. Without the NCI gate, mints would succeed on attestation alone. With the NCI gate, the compromised PoS pillar contributes weight, but PoM (60%) and PoW (10%) remain honest — the unified score falls below the per-epoch threshold and mints are rejected. This is the structural defense that justifies layering NCI on top of attestation rather than relying on attestation alone.

Attacker tries to mint without the NCI cell-dep — boundary fails-closed. Attacker tries to use a stale NCIScoreCell from before validator-set compromise was suspected — freshness check forces re-derivation on every epoch boundary, so a stale score cannot indefinitely authorize mints.

**Correspondence-Triad check**: ✓. Cross-chain in is discrete (per-mint) and binary; geometry matches. AMD: layered defense, math-enforced. Augmented governance: 51% block-producer omission delays cross-chain mints but cannot break the invariant; the user's burn on the source chain has its own finality, and the attestation/score remain valid for the freshness window.

### 2.8 Cross-chain out boundary

**Owning cell**: `BurnReceiptCell` (`messaging-hub.md` § BurnReceiptCell) creation, which emits a cross-chain burn event for remote-chain mint authorization.

**Required cell-dep**: `NCIScoreCell v≥1` with `decision_type = CrossChainOutGate` and `proposal_id = blake2b("xchain-out-gate" || epoch_id || destination_chain_id)`.

**Required witness**: `NCIBoundaryWitness { proposal_id, decision_type: CrossChainOutGate, score_celldep_index, destination_chain_id }`.

**Type-script invariant**: `BurnReceiptCell`'s type-script extends with Common Skeleton § 1. The NCI gate authorizes the broad cross-chain-out flow per epoch per destination; the specific receipt is then bound to a CanonicalTokenCell burn via the existing matched-burn invariant.

Replay: per-epoch score-window. The receipt's own `burn_id` (already fresh-checked by `messaging-hub.md`) is the per-receipt replay primitive.

**Failure mode**: missing NCI → rejected. Below threshold → rejected. Destination chain not in `ChainConfigCell.enabled_outbound` → rejected. Receipt amount does not match burned CanonicalTokenCell amount → rejected by existing messaging-hub invariant.

**Lawson constants**:
- `XCHAIN_OUT_MIN_SCORE_BPS` ∈ `[6000, 8000]` — symmetric with cross-chain in.
- `XCHAIN_OUT_SCORE_MAX_AGE_BLOCKS` ∈ `[10, 240]` — per-epoch scope.
- `XCHAIN_OUT_PILLAR_BALANCE_BPS` ∈ `[3000, 5000]` — minimum spread requirement: no single pillar can be the entirety of the score (prevents single-pillar collusion from unilaterally enabling outbound flows).

**Attacker bypass attempt + counter**: attacker tries to burn CanonicalTokenCells and emit a receipt without NCI authorization, hoping the remote-chain validators will accept the receipt as valid. Without the NCI cell-dep on CKB-VibeSwap, no BurnReceiptCell can be created in the first place — the boundary fails-closed at the source. Remote-chain validators observing CKB-VibeSwap will see no receipt; no remote mint happens. The attacker's CanonicalTokenCells are not even burned (the transaction fails atomically).

Attacker compromises some PoS validators and tries to emit a receipt authorized by a manipulated score — same defense as cross-chain in: PoM and PoW pillars push the unified score below threshold during periods of validator compromise.

**Correspondence-Triad check**: ✓. Cross-chain out is discrete and binary; geometry matches. AMD: layered defense at both source and destination. Augmented governance: omission delays but does not break; pillar-balance Lawson constraint prevents single-pillar capture.

## 3. Cross-boundary defenses

### 3.1 Replay protection summary

| Boundary | Replay primitive | Scope |
|---|---|---|
| Deposit | per-epoch score-window | epoch × pool |
| Withdrawal | per-epoch score-window | epoch × pool |
| Validator-set update | `DecisionsRegistryCell` | per proposal_id |
| Slash | `DispatchedTaskRegistryCell` | per task_id |
| Governance parameter update | `DecisionsRegistryCell` | per proposal_id |
| Emergency pause | `EmergencyDecisionsRegistryCell` | per (breaker_id, proposal_id) |
| Cross-chain in | `SupplyAccountantCell` + score-window | per burn_id, per epoch |
| Cross-chain out | `BurnReceiptCell.burn_id` + score-window | per burn_id, per epoch |

The pattern: discrete one-shot decisions (Validator, Slash, Governance, Emergency) use registry cells indexed by proposal_id / task_id. Continuous gated flows (Deposit, Withdrawal, Cross-chain) use the per-epoch score-window plus per-event freshness identifiers.

### 3.2 Tx-omission attack

A 51% block-producer cabal can mine blocks that omit any specific transaction. Under Position C, omission is delay, not break. The user's boundary transaction with its NCI cell-dep sits in mempool; any honest block-producer in any subsequent block can include it. The cabal's choice is either (a) honestly include the transaction, in which case the boundary is authorized normally, or (b) censor it indefinitely, which is a liveness denial against the user but does not allow the cabal to advance vibeswap-app state in a non-authorized direction.

The mitigation is structural: the NCI invariant is on the boundary cell's type-script, which fires on consumption-or-creation. There is no way for the cabal to construct an alternative transaction that touches the boundary cell without the NCI cell-dep, because the boundary cell's type-script rejects any such transaction. The cabal's choices are "include the user's authorized transaction" or "include nothing." They cannot include a tampered or unauthorized boundary transaction.

This is the load-bearing "cells-are-not-decoration" property from `NCI_CONSENSUS_ANSWER.md` § 1.3: the math layer is load-bearing because no vibeswap-app state can transition without referencing it.

### 3.3 NCI cell freshness and stale-score attacks

A stale-NCIScoreCell attack works as follows: an attacker constructs an NCIScoreCell during a period when the three-pillar mix was healthy, then reuses it months later when the validator set has been compromised. The mitigation is the per-boundary `MAX_SCORE_AGE_BLOCKS` Lawson constant, enforced as Step 3 of the Common Skeleton.

The freshness window is calibrated per boundary: tight (1–24 blocks) for one-shot discretionary decisions (Validator, Slash, Governance, Emergency), wider (10–240 blocks ≈ 1 epoch) for continuous gated flows (Deposit, Withdrawal, Cross-chain). The wider windows are acceptable because the per-epoch scope still forces re-derivation of the NCIScoreCell whenever the underlying pillar inputs change meaningfully (validator-set updates, PoM-operator-set updates, new PoW anchors).

A second-order defense: the `LawsonConstantsRegistry` itself can tune `MAX_SCORE_AGE_BLOCKS` downward under emergency conditions via the governance-parameter-update boundary (§ 2.5), with NCI authorization on that update. This is the recursive self-defense of the system: if stale-score attacks become a live concern, governance can shrink the freshness window without protocol changes.

### 3.4 Per-pillar floor enforcement

Several boundaries specify a per-pillar floor in their Lawson constants (e.g., `WITHDRAWAL_POM_PILLAR_MIN_BPS`, `XCHAIN_IN_POM_PILLAR_MIN_BPS`). These floors prevent the scenario where the unified score is above threshold but driven entirely by one pillar that has been captured. The boundary type-script reads the NCIScoreCell's `normalized_pow`, `normalized_pos`, `normalized_pom` fields and asserts the per-pillar contributions meet the floor. This is a stronger check than the unified-score threshold alone.

## 4. Integration with VibeSwapCore Option B (no orchestrator)

`vibeswap-core-port-classification.md` decided Option B: there is no `VibeSwapCoreCell` orchestrator. Cross-mechanism invariants are enforced per-boundary at the cell-graph layer.

This spec aligns perfectly with Option B: the NCI boundary check is added to each boundary cell's existing type-script invariants, not to a separate orchestrator. The `vibeswap-ckb-tx-builder` crate (per Option B § Migration path from EVM) gains responsibility for constructing transactions with the correct NCI cell-deps and witnesses. The tx-builder's `build_commit_swap`, `build_settle_batch`, `build_validator_update`, etc. all add the NCI cell-dep + witness in the appropriate slot.

A boundary cell's type-script + NCI-check is the load-bearing structural property. The tx-builder is helper code; if buggy, transactions fail at the type-script. The boundary cell is the authoritative spec.

## 5. Failure-mode test matrix

Every Rust crate implementing a boundary cell must include a fuzz/round-trip test suite with at minimum:

| Test | Expected result |
|---|---|
| Construct boundary tx with valid NCI cell-dep + witness | tx accepted |
| Construct boundary tx without NCI cell-dep | tx rejected (`MissingNCIAuthorization`) |
| Construct boundary tx with NCI cell-dep but mismatched proposal_id witness | tx rejected (`WitnessNCILinkBroken`) |
| Construct boundary tx with NCI score below threshold | tx rejected (`NCIScoreBelowThreshold`) |
| Construct boundary tx with NCI score above unified threshold but failing per-pillar floor | tx rejected (`NCIScoreBelowThreshold`) |
| Construct boundary tx with NCI score older than `MAX_SCORE_AGE_BLOCKS` | tx rejected (`NCIScoreStale`) |
| Replay a one-shot decision with same proposal_id | second tx rejected (registry conflict) |
| Replay a continuous gated flow with NCIScoreCell within score-window | second tx accepted (intentional) |
| Replay a continuous gated flow with NCIScoreCell outside score-window | second tx rejected (`NCIScoreStale`) |

These tests are the implementation acceptance criterion. A boundary crate that passes them is conformant; one that fails any of them is broken regardless of code review.

## 6. Open questions

- **Q1 — Score caching vs per-tx re-derivation**: high-throughput boundaries (Deposit, Withdrawal) within a single epoch reuse the same NCIScoreCell across many transactions. The cell is read as cell-dep, which is cheap, but the per-pillar floor checks still execute per-tx. Spike: is this acceptable in steady-state, or do we need a per-epoch precomputed-attestation cell that boundary cells can verify by hash-lookup?

- **Q2 — Multi-pool batch settlement**: when a future iteration of `commit-reveal-auction.md` supports multi-pool batch settlement, the NCIScoreCell's `proposal_id` is per-pool. The batch settlement transaction must cell-dep multiple NCIScoreCells, one per pool. Boundary cell's type-script must verify all required scores are present.

- **Q3 — NCI gate on PoM operator-set updates**: the `PoMOperatorRegistry` is mentioned in `nci-consensus.md` but not specced for governance-gated updates. Updating the PoM operator set is structurally similar to updating the validator set — it should likely require NCI authorization with `decision_type = PoMOperatorUpdate`. Defer to a `pom-operator-registry.md` spec.

- **Q4 — Score precomputation latency**: NCIScoreCell production has its own latency (pillar input collection + verification). For emergency-pause boundaries that need fast authorization, this latency may be too slow. Spike: target NCIScoreCell-production-to-availability latency at < 1 block under normal conditions; if not achievable, consider a fast-path emergency pause that does not require NCI authorization but only guardian multi-sig (a tradeoff that weakens the structural property).

- **Q5 — Cross-shard NCI**: if vibeswap-app cells eventually shard across multiple chains/substrates, the NCI cell-dep must be available on each shard. Out of scope for v1; flagged for shard-aware design when sharding becomes operationally relevant.

## 7. Cross-references

- Parent decision: `contracts-ckb/NCI_CONSENSUS_ANSWER.md` (Position C)
- NCI cell spec: `contracts-ckb/specs/nci-consensus.md` (NCIScoreCell, ProtocolDecisionCell, pillar inputs)
- Boundary cells: `commit-reveal-auction.md` (CommitCell, BatchSettlementCell), `messaging-hub.md` (ValidatorRegistryCell, BurnReceiptCell, MintClaimCell, ValidatorBondCell), `slash-router.md` (SlashEventCell), `circuit-breaker.md` (BreakerCell), `pairwise-verifier.md` (TaskVerdictCell)
- Orchestration framing: `vibeswap-core-port-classification.md` (Option B — composition via cell-graph linkage, no orchestrator)
- Lawson constants source: `lawson-constants.md` (constitutional bounds, governance-tunable parameters)
- Fork plan: `contracts-ckb/FORK_PLAN.md` § 3.3 (genesis cells for NCI mandatory infrastructure)
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·substrate-geometry-match]`, `[P·augmented-mechanism-design]`, `[P·augmented-governance]`, `[P·honesty-as-structural-load-bearing-property]`, `[P·dissolve-attack-surface]`, `[P·circuit-breaker-attested-resume]`, `[F·blockchain-not-contracts]`
