# Reorg Behavior — Cell-Dep'd Constants & State Transitions

**Status**: EXECUTED. Defaults chosen, justified, ready for downstream propagation into per-cell type-script invariants.
**Author**: JARVIS, 2026-06-08, in response to senior-architect review HIGH #5.
**Scope**: defines how vibeswap-ckb state survives Nervos NC-Max chain reorganizations. Names the per-cell-class reorg behavior, picks finality thresholds for the load-bearing boundaries, and composes with NCI Position C boundary enforcement.
**Disposition**: spec-stage HIGH severity per `[F·spec-vs-deployed-severity-calibration]` — pre-deployment, but the finality thresholds chosen here lock the protocol's safety margins for every cross-chain bridge, every governance change, and every slash dispatch. Once cells ship referencing these constants, changing them is a hardfork.

---

## 0. Why this had to be answered before more cell code

The review caught the missing spec: cell-deps reference outpoints that resolve at validation time against the **currently-live cell set**. A reorg redefines which cells are live. An attestation transaction mined in block N consumes a `ValidatorRegistryCell` whose state was current at N. If block N is reorged out, three things change simultaneously: the attestation transaction itself is back in the mempool (its inputs may or may not still be live), the cell-dep'd registry's outpoint may have moved (because the registry-update transaction that produced it was also in the orphaned chain), and the chain-tip block-number that any "current epoch" check evaluated against is now lower.

The Solidity-spec layer didn't have to answer this because EVM reorgs work differently — mempool replays the orphaned transactions in nonce order, contract state is recomputed from the new canonical chain, and there is no cell-graph identity that can dangle. CKB's cell model exposes the reorg behavior directly. We have to spec it.

---

## 1. Nervos CKB reorg model (research)

NC-Max inherits Nakamoto-consensus probabilistic finality from Bitcoin's threat model, with one substantive improvement: the difficulty-adjustment function accounts for orphan blocks ([RFC-0020](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0020-ckb-consensus-protocol/0020-ckb-consensus-protocol.md)), which dissolves the selfish-mining attack-class and stabilizes the orphan rate at a target the protocol controls. Block-time band is ~10s with a roughly two-step propose-commit confirmation cycle.

The published security calibration: **6 confirmations** fully settle a transaction at orphan-rate 0%; **24 confirmations** are needed for the same security level at orphan-rate 2.5% ([Nervos docs glossary](https://docs.nervos.org/docs/tech-explanation/glossary)). No fixed finality depth is protocol-mandated; users choose confirmation thresholds against their threat model. Reorg-depth distribution is power-law — exponentially decreasing probability of N-deep reorgs as N grows, with the orphan-rate parameter setting the decay constant.

For our purposes: treat 6 blocks as the **low-stakes confirmation floor** (~60–120s wall clock depending on block-time band) and 24 blocks as the **high-stakes confirmation floor** (~4–8 min). Deeper thresholds (100 blocks ≈ 17–34 min) buy exponential additional safety for the most reorg-sensitive operations.

## 2. Cell-dep semantics under reorg

Two failure modes, both load-bearing:

**Input-cell re-entry**: input cells consumed by transactions in the orphaned block re-enter the mempool as live cells. The transaction can be re-mined in the new canonical chain if its cell-deps still resolve, but the cell-dep references may have moved.

**Cell-dep dangling**: cell-deps are resolved by outpoint at validation time. If the dep'd cell was produced by a transaction in the orphaned chain, the outpoint no longer resolves to a live cell. The transaction is invalid against the new chain-tip and must be reconstructed with the **new** dep outpoint (the current-canonical version of the referenced cell at the new chain-tip).

The off-chain determinism property of the cell model ([CKB tx-pool docs](https://docs-old.nervos.org/docs/essays/tx-pool)) means transactions can be reconstructed deterministically by the submitter as long as they observe the new dep state. This is the recovery primitive. The discipline question for us is: which transactions does our protocol require to be auto-reconstructable, and which require a finality wait before they're considered committed?

## 3. Per-cell-class reorg behavior

Six cell classes, each with a different reorg posture. The pattern: **survive-by-rebuild** if cheap, **survive-by-wait** if expensive, **survive-by-append-only-history** if the evidence is what matters.

**LawsonConstantsRegistryCell** — rare updates (governance-cadence, weeks-to-months). Reorg-survivable if no concurrent update lands in the orphaned span. If an update was in the orphaned block, the new chain-tip resolves to the **previous** registry state; consumer transactions referencing the post-update value fail their type-script bound-check, return to mempool, and the update transaction is rebuilt against the new tip. **ConstantsHistoryCell** is append-only — if a history entry was in the orphaned block, that entry is simply not added to the new chain. The constitutional bounds cell never changes, so it's reorg-immune.

**ValidatorRegistryCell** — updates at epoch cadence (≤ once per epoch). Reorg-survivable if no rotation lands in the orphaned span. If a rotation was in the orphaned block, the new chain-tip resolves to the pre-rotation set; attestations signed under the pre-rotation set are still valid (their BLS aggregation verifies against the cell-dep'd registry at the new tip). The risk window: an attestation signed under the **post-rotation** set, included in a block referencing the post-rotation registry, both reorged out — the attestation must be re-signed by the pre-rotation set (or wait for the rotation to be re-mined). Our defense is a finality wait on rotation finalization before validators rotate their signing key material off the old set.

**AttestationCell** — per-cross-chain-event. Reorg-rebuild possible from off-chain aggregator. Validators retain their signed pieces; the aggregator can re-assemble against whatever registry the new chain-tip presents. The on-chain AttestationCell is just a commitment; the underlying signature material is durable off-chain. **No state is lost** in a reorg of an attestation — only latency is added.

**CommitCell / RevealCell** — per-batch (10s commit, 2s reveal, settlement). Reorg = batch failed. The reveal cells from the orphaned block are invalid against the new chain-tip (their cell-dep'd commit cells moved). Users repeat at the next batch. **No state is preserved** across the reorg for in-flight batches — by design. Commit-reveal is short-lived enough that a 6-block reorg covers far more batches than is operationally acceptable; we accept that as the cost. Deposit/withdrawal commit cells (longer-lived) are handled by the AMM pool cells, not the batch cells.

**CircuitBreakerCell** — state-machine. Trip event in orphaned block = trip event **lost on the orphaned chain**, but re-derivable. The trip is computed from a signal (volume counter, price drift, depeg evidence) that's itself a function of the on-chain state of the consuming mechanism. If the conditions that tripped the breaker still hold against the new chain-tip, the next consumer transaction re-trips it. If the conditions don't hold against the new chain-tip (because the offending transaction was also orphaned), the trip was a false-positive of the orphaned chain and should not be re-asserted. **The trip event is a derived property, not a persisted decision**, which is the right shape for reorg-survivability.

Resume is the asymmetric case. A resume that was in the orphaned block carries an attestation cell that's still valid material (operators signed a clear-message that's still true if the underlying condition is still clear). Resume can be re-submitted on the new chain-tip. The cooldown timestamp uses block-height-delta, which the new chain naturally re-computes. **Resume composes safely with reorg**, but the cooldown reset is a structural-honesty consideration in section 6.

**ProtocolDecisionCell** — governance. Finality matters most. A protocol decision (validator-set update, slash dispatch, parameter change, emergency pause) is the highest-stakes operation in the protocol; a reorg that loses a slash dispatch is a missed punishment, a reorg that re-applies one is a double-slash. **Both failure modes are unacceptable**, which is what motivates the deepest finality wait in section 6.

## 4. Defense patterns

Four patterns, ordered from cheapest to most-discipline.

**Finality threshold via cell-dep'd chain-tip check**: every boundary type-script that's reorg-sensitive includes a cell-dep on a **TipAnchorCell** (the same PoWAnchorCell pattern from NCI), reads the current chain-tip block-number via syscall, and rejects the transaction if `tip_height - consumed_cell_inclusion_height < finality_blocks`. This is the math-enforcement primitive — no off-chain process, no validator discretion. The threshold value comes from `LawsonConstantsRegistry` per `[P·augmented-mechanism-design]` — governance-tunable within constitutional bounds.

**Cell-dep retry semantics**: on dep-resolution failure (orphaned-outpoint case), the submitter's off-chain orchestration auto-reconstructs the transaction against the new tip. Aggregator implementations (the messaging-attestation gossip layer, the commit-reveal batch coordinator, the breaker-attestation collector) MUST be reorg-aware: subscribe to chain-tip changes, re-resolve dep outpoints, re-submit. **Automatic, not manual**, because manual retry under partner-facing operational load is a foot-gun.

**Append-only history cells as evidence**: `ConstantsHistoryCell`, the `DecisionsRegistryCell` consumed-proposal-id tracker, the `SupplyAccountantCell` per-chain-supply log — all append-only by design. They survive reorgs as evidence because their type-script semantics is "if the entry exists in the canonical chain, the event happened." A reorg simply means the entry isn't there yet, not that it's been revoked. This converts "what happened" questions into "is it deep enough" questions, which the finality threshold answers.

**Witness-recoverable state**: anything reconstructable from off-chain material need not depend on the chain-state surviving. BLS signature pieces, commit-secrets, attestation messages — all retained by their originators. The on-chain commitment is the convergence point, not the source. **The chain is the projector, not the storage.** This is the primary defense for attestations and commit-reveal batches.

## 5. Critical boundary-class identification (NCI Position C composition)

Per Position C, the load-bearing seam is the **vibeswap-app boundary** where value crosses in or out, and where protocol decisions actuate. From the cell-class survey, the most reorg-sensitive boundaries are:

1. **WithdrawalBoundaryCell** — value leaves the protocol. A reorg-rolled-back withdrawal that's already been credited downstream (off-chain notification, partner system, downstream chain mint) is a double-spend on the protocol's perspective. **Highest-stakes outflow boundary.**
2. **AttestationBoundaryCell (inbound cross-chain mint authorization)** — value enters from a remote chain. A reorg-rolled-back attestation that has already triggered a mint = mint without burn = supply inflation = protocol-fatal. **Highest-stakes inflow boundary.**
3. **ProtocolDecisionCell (slash dispatch)** — bonded validator stake gets slashed. A double-slash from reorg-reapplication or a missed-slash from reorg-rollback both break the bonding incentive. **Highest-stakes punishment boundary.**
4. **ValidatorRegistryCell rotation finalization** — the active signing set changes. A reorg that rolls back a rotation while the old set has already destroyed their signing material = signature liveness failure. **Highest-stakes set-transition boundary.**

The **structurally most reorg-sensitive boundary** is the cross-chain AttestationBoundary, because its failure mode (mint-without-burn) is supply-inflation, which is the load-bearing invariant of the canonical burn-and-mint design (per `messaging-hub.md` §"No-double-mint"). A reorg-induced double-mint reduces the protocol to a non-canonical bridge, which is the failure mode the post-LayerZero design was constructed to dissolve. **AttestationBoundary is named as the structural-priority for finality enforcement.**

## 6. Decisions to execute (defaults)

Per `[F·spec-vs-deployed-severity-calibration]` and `[Will-EXECUTE rule]` — picking defaults now, written into `LawsonConstantsRegistry` as governance-tunable within constitutional bounds.

| Operation | Finality wait | ~Wall clock | Justification |
|---|---:|---|---|
| **Withdrawal finalization** | **6 blocks** | ~60–120s | NC-Max docs anchor: 6 blocks settles transactions at orphan-rate 0. Matches user expectation of "tx confirmed" speed. Bounded loss in worst case = one user's withdrawal at one boundary. |
| **Cross-chain attestation** | **24 blocks** | ~4–8 min | NC-Max docs anchor: 24 blocks at orphan-rate 2.5%. Mint-without-burn is supply-inflation, structurally fatal, justifies the higher threshold. Matches the highest-listed-confirmation in published security calibration. |
| **Governance updates** (LawsonConstantsRegistry, ChainConfig, ProtocolDecision actuation) | **24 blocks** | ~4–8 min | Same threshold as cross-chain attestation. Governance is rare (epoch-cadence or slower); the extra latency is not a UX cost. Reorg-induced double-actuation is fatal. |
| **Slash execution** | **100 blocks** | ~17–34 min | Deepest threshold. Avoid false-slash in deep reorg. Slash is punitive and irreversible (bonded stake transferred to slashing pool); the cost of a wrong slash is bond destruction + protocol reputation. The cost of a delayed slash is bounded (the offender keeps their bond ~30 min longer). Asymmetric cost favors patience. |
| **CircuitBreaker trip** | **0 blocks (immediate)** | 0 | Security-priority, asymmetric cost: false-positive trip costs latency, false-negative trip costs exploit. Trip is also derived from current chain-state, so a reorged trip re-asserts naturally if conditions still hold. Resume requires 24-block confirmation (governance-equivalent threshold) per the breaker-attestation semantics. |
| **CircuitBreaker resume** | **24 blocks** | ~4–8 min | Resume is asymmetric to trip — slow by design `[P·circuit-breaker-attested-resume]`. The 24-block threshold composes with cooldown floor; whichever is larger applies. |

These six rows are the protocol-wide finality contract. They will be encoded in `LawsonConstantsRegistry` as `finality_blocks_withdrawal`, `finality_blocks_attestation`, `finality_blocks_governance`, `finality_blocks_slash`, `finality_blocks_breaker_trip` (=0), `finality_blocks_breaker_resume`. Constitutional bounds on these constants (encoded in `ConstitutionalBoundsCell`):

- `finality_blocks_withdrawal ∈ [3, 24]` — can't go below 3 (single-block reorg trivial); can't go above 24 (UX dies)
- `finality_blocks_attestation ∈ [12, 100]` — can't undercut the published 24-confirmation security target by more than ~50%; can't exceed 100 (cross-chain UX dies)
- `finality_blocks_governance ∈ [12, 100]` — same range as attestation
- `finality_blocks_slash ∈ [24, 1000]` — never less than the attestation threshold (slash is strictly more sensitive); 1000-block cap on punitive latency
- `finality_blocks_breaker_resume ∈ [12, 200]` — never less than governance; 200-block cap

These bounds are the math-enforced governance layer per `[P·augmented-governance]` — physics (NC-Max produces blocks) > constitution (these bounds) > governance (NCI-authorized tuning within the bounds).

## 7. Composition with NCI Position C

Position C mandates that every vibeswap-app boundary lock/type-script consumes an `NCIScoreCell` as a cell-dep with `assert_nci_authorization(score_celldep, decision_type)`. The reorg-defense extends this contract: the boundary type-script ALSO validates `tip_height - consumed_cell_inclusion_height ≥ finality_blocks[decision_type]` against the LawsonConstantsRegistry threshold.

Stated as a single invariant per boundary transition:

> A boundary transition is authorized iff (a) an NCIScoreCell is consumed with sufficient unified_score for the decision_type AND (b) the chain-tip block-height exceeds the consumed cell's inclusion height by at least the per-decision-type finality threshold from LawsonConstantsRegistry.

The two conditions compose as an AND. NCI authorization without finality is premature; finality without authorization is unauthorized. Both gates must hold. This is the cell-graph implementation of "physics > constitution > governance" applied per-boundary-transition: NC-Max produces the block (physics), the finality threshold enforces the constitutional safety margin (constitution), the NCI score authorizes the action (governance).

The PoWAnchorCell from NCI already reads the chain-tip block-number via syscall; the reorg-defense extension reuses that same primitive — no new substrate touch, no new syscall, no new infrastructure. **Position C's mandatory cell-dep contract is the right hook for the finality threshold check.**

## 8. Open questions (only IRREVERSIBLE + projection-uncertain)

Per `[C4 EXECUTE rule]`, the only open questions surfaced for Will-decision are the ones where (a) the choice is irreversible post-deployment and (b) Will-projection isn't confident enough to default.

1. **Should withdrawals scale finality with withdrawal-size?** A small withdrawal (under SMALL_WITHDRAWAL_BPS_THRESHOLD) might justify a 3-block threshold; a large withdrawal might justify 24. The current default is a single threshold for all sizes. Will-question: is the operational complexity of a sized-tier worth the UX gain? Default to single-threshold-for-all until data motivates tiers; recorded here as an explicit deferral.
2. **Should attestation finality be measured on the CKB side or the source-chain side?** A burn on Ethereum mined at depth 12 there → attestation submitted on CKB. Do we wait 24 CKB-blocks from CKB-mining, OR do we wait until the Ethereum burn is 12-deep (Ethereum's strong-finality threshold), OR both? Current default: **both**, with the CKB-side measured via this spec's threshold and the source-chain-side enforced in the validator off-chain attestation logic (validators don't sign until source-chain finality is met). Will-projection: this is right because both gates compose multiplicatively for safety; flagging for confirmation.
3. **Should slash thresholds differ by slash-size?** A small slash (~5%) might justify 24-block finality; a full slash (50% per the existing spec) might justify 100. The current default treats all slashes at 100-block finality. Will-question: is the operational complexity of a sized-tier worth the latency gain for small slashes? Default to single-threshold-for-all.

The remaining decisions (the six finality thresholds in section 6) are EXECUTED per `[C4]` and propagated into `LawsonConstantsRegistry` defaults + `ConstitutionalBoundsCell` bounds.

## 9. Composition trace

- `[P·substrate-geometry-match]` — probabilistic finality is power-law (reorg-depth distribution decays exponentially); fixed-block thresholds match this geometry at the per-decision-type granularity.
- `[P·augmented-mechanism-design]` — finality enforcement is math-invariant (cell-dep'd chain-tip check, encoded in type-script) augmenting NC-Max's existing block-production consensus. The augmentation is at the application-layer-invariant, not at the substrate.
- `[P·augmented-governance]` — physics (NC-Max blocks) > constitution (ConstitutionalBoundsCell ranges) > governance (NCI-authorized LawsonConstantsRegistry tuning within bounds). The thresholds themselves are governance-tunable but the bounds aren't.
- `[P·structure-does-the-work]` — finality is enforced by type-script structural invariant, not by validator discretion or off-chain consensus.
- `[P·honesty-as-structural-load-bearing-property]` — no profitable path exists for an adversary to actuate a reorg-rollbackable boundary transition; the type-script rejects pre-finality submissions.
- `[P·dissolve-attack-surface]` — the reorg-induced double-mint attack-class is dissolved at the AttestationBoundary by the 24-block finality threshold AND the source-chain finality composition; there is no detection step, the math forbids it.
- `[F·blockchain-not-contracts]` — finality defense is a chain-level property because we own the genesis cells AND the boundary type-scripts; the threshold can't be bypassed by app-layer flexibility.
- `[J·vibeswap-ckb-sovereign-pivot]` — sovereign means we own the finality contract, not just inherit Nervos's. Position C plus this spec makes the contract operational.

## 10. Cross-references

- Parent review: `Desktop/architecture-review-2026-06-08-senior-blockchain-architect.md` (HIGH #5)
- NCI position composing: `contracts-ckb/NCI_CONSENSUS_ANSWER.md` (Position C boundary enforcement)
- Spec to update: `contracts-ckb/specs/lawson-constants.md` (add the six finality constants + bounds)
- Spec to update: `contracts-ckb/specs/messaging-hub.md` (AttestationCell invariant + cell-dep'd finality check)
- Spec to update: `contracts-ckb/specs/circuit-breaker.md` (trip immediate, resume 24-block + cooldown)
- Spec to update: `contracts-ckb/specs/nci-consensus.md` (ProtocolDecisionCell finality contract)
- Spec to write next: `contracts-ckb/specs/nci-boundary-enforcement.md` (per NCI_CONSENSUS_ANSWER §8 — should incorporate this finality-threshold contract as the second composed gate)
- Mechanism primitives: `[P·substrate-geometry-match]`, `[P·augmented-mechanism-design]`, `[P·augmented-governance]`, `[P·structure-does-the-work]`, `[P·dissolve-attack-surface]`, `[F·blockchain-not-contracts]`

Sources for the research section:
- [Nervos CKB Glossary — confirmations & probabilistic finality](https://docs.nervos.org/docs/tech-explanation/glossary)
- [NC-Max consensus protocol RFC-0020](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0020-ckb-consensus-protocol/0020-ckb-consensus-protocol.md)
- [CKB Transaction Pool — orphan handling](https://docs-old.nervos.org/docs/essays/tx-pool)
- [CKB Cell Model](https://docs.nervos.org/docs/tech-explanation/cell-model)
