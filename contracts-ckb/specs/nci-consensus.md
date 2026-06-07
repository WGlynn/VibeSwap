# NCI Consensus — CKB Cell Spec

**Spec layer**: `vibeswap/contracts/consensus/` + canonical paper `vibeswap/docs/architecture/CONSENSUS_MASTER_DOCUMENT.md`
**Port classification**: REINTERPRET (user-space cells), with UNRESOLVED augmentation-surface fallback
**Status**: Spec draft. Single biggest open architectural decision in the sovereign pivot.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

VibeSwap's NCI (Network Consensus Integrity) is a three-pillar consensus weighting that combines proof-of-work (10%), proof-of-stake (30%), and proof-of-mind (60%) for protocol-level decisions: validator-set updates, governance vetoes, slash adjudication, cross-chain attestation thresholds, and emergency pauses. The mix is calibrated so that no single pillar can act unilaterally and any two-pillar collusion is bounded by the third.

The Solidity version runs as application-layer contracts that read PoW proofs, stake-weighted vote signatures, and PoM attestations, then compute a unified score. The CKB sovereign pivot has to decide whether NCI continues as application-layer cells consuming substrate-produced signals or whether NCI replaces parts of NC-Max as a substrate-level consensus rule.

**Default position (this spec)**: NCI lives as user-space cells. NC-Max continues to run consensus over block production on the CKB substrate. NCI cells consume NC-Max outputs (block hashes, transaction inclusion proofs) as the PoW signal, consume bonded-validator BLS signatures as the PoS signal, and consume PoM lock-script attestations as the PoM signal. The unified three-pillar score is computed in the NCI type-script. Protocol decisions (governance vetoes, validator updates, etc.) gate on the score.

**Fallback position (recorded for future iteration)**: NCI replaces or extends NC-Max at the consensus layer. This is the substrate-augmentation path and lives in `AUGMENTATION_SURFACE.md` as the largest potential augmentation. Decision deferred until we have data on whether user-space NCI achieves the protocol-decision finality requirements.

## Why default to user-space

Four reasons.

First, upstream-fidelity. NC-Max is the engineered consensus that makes Nervos CKB the best-engineered blockchain Will has named. Replacing it is a substantial fork with active-maintenance burden against upstream changes. Keeping NC-Max intact is the cheaper position.

Second, separation of concerns. NC-Max's job is to produce a canonical block ordering. NCI's job is to weight protocol-level decisions across pillars. These are different functions even though both are called "consensus." NC-Max gives us a canonical history of block hashes, which the PoW pillar of NCI then consumes. We don't need to entangle them.

Third, smaller augmentation surface. Application-layer NCI keeps the augmentation surface to configuration-only changes (genesis, network parameters, possibly dust threshold). Substrate-level NCI moves us into active-maintenance territory.

Fourth, iteration discipline. If user-space NCI turns out to have unacceptable finality latency or fork-resistance gaps, we have data to motivate the augmentation. Reversing is harder than escalating.

## Cell architecture

Three pillar-input cells feed the NCI score. A NCIScoreCell aggregates them. Protocol-decision cells consume the NCIScoreCell to authorize their actions.

**PoWAnchorCell.** Tracks the canonical block-hash chain from CKB's NC-Max output. Updated on every block by a permissionless transaction that records the latest block hash. The type-script verifies the recorded hash matches the parent-hash chain. This gives NCI a substrate-anchored PoW signal.

**StakeWeightedVoteCell.** Records aggregated bonded-validator signatures on a specific protocol proposal. The validators are the same set as in MessagingHub's ValidatorRegistryCell (or a subset/superset depending on governance configuration). BLS12-381 threshold-aggregated. Type-script verifies aggregation against the registry.

**PoMAttestationCell.** Records cognitive-work attestations from operators running PoM workloads. Created via the PoM lock-script (already shipped in `contracts-ckb/proof-of-mind-lock-script/`). Each attestation is weighted by the operator's bonded stake plus the difficulty of the attested work.

**NCIScoreCell.** Aggregates the three pillars into a unified score for a specific proposal ID. Type-script enforces the 10/30/60 weighting (or whatever current LawsonConstantsRegistry value), normalization, and the proposal-ID match across consumed pillar inputs.

**ProtocolDecisionCell.** Created when a NCIScoreCell exceeds a configured threshold. Authorizes a specific protocol action (validator-set update, governance veto, slash dispatch, etc.). Consumed by the target mechanism to actuate the decision.

## Per-cell specifications

### PoWAnchorCell

**Data layout** (cell-data):
- `version: u8`
- `block_height: u64`
- `block_hash: [u8; 32]`
- `parent_hash: [u8; 32]`
- `cumulative_difficulty: u128`
- `anchored_at_height: u64` (the height at which this anchor was recorded)

**Lock-script**: Permissionless.

**Type-script invariants**:
- Anchor transactions are valid only at the boundary of NC-Max block headers (verified via syscall to read block header)
- `block_hash` matches the actual CKB block header at `block_height`
- `parent_hash` matches the previous PoWAnchorCell's `block_hash` (chain continuity)
- `cumulative_difficulty` is monotonically increasing
- A single canonical PoWAnchorCell exists per `block_height` (the type-script consults a chain-tip registry)

### StakeWeightedVoteCell

**Data layout** (cell-data):
- `version: u8`
- `proposal_id: [u8; 32]`
- `voted_for_value: u128` (cumulative stake voting "for")
- `voted_against_value: u128` (cumulative stake voting "against")
- `aggregated_signature: [u8; 96]`
- `signer_bitmap: Vec<u8>`
- `voting_epoch: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- `aggregated_signature` verifies against the BLS aggregation of the signer_bitmap's validators (read from ValidatorRegistryCell via cell-dep)
- The signed message includes `proposal_id`, the vote direction (for/against), and the voting_epoch
- `voted_for_value` and `voted_against_value` sum to the bonded stake of the included signers
- `voting_epoch` matches the current epoch of the ValidatorRegistryCell

### PoMAttestationCell

**Data layout** (cell-data):
- `version: u8`
- `proposal_id: [u8; 32]`
- `attestations: Vec<Attestation>`
  - per attestation: `operator_lock_hash: [u8; 32]`, `work_difficulty: u128`, `pom_signature: [u8; 64]`
- `total_pom_weight: u128`

**Lock-script**: Permissionless.

**Type-script invariants**:
- Each attestation's `pom_signature` verifies against the operator's PoM lock-script (referenced via cell-dep on a PoMOperatorRegistryCell)
- The signed message includes the `proposal_id`
- `work_difficulty` matches the difficulty of the attested cognitive-work batch
- `total_pom_weight` is the sum of operators' (bonded_stake × work_difficulty) contributions
- Each operator_lock_hash appears at most once

### NCIScoreCell

**Data layout** (cell-data):
- `version: u8`
- `proposal_id: [u8; 32]`
- `pow_input: u128` (from PoWAnchorCell's cumulative_difficulty delta over the proposal window)
- `pos_input: u128` (from StakeWeightedVoteCell's voted_for_value - voted_against_value)
- `pom_input: u128` (from PoMAttestationCell's total_pom_weight)
- `normalized_pow: u128`
- `normalized_pos: u128`
- `normalized_pom: u128`
- `unified_score: u128`
- `weights_used: NCIWeights` (snapshot of pillar weights at compute time)

**Lock-script**: Permissionless.

**Type-script invariants**:
- Consumes exactly one PoWAnchorCell, one StakeWeightedVoteCell, one PoMAttestationCell, all with matching `proposal_id`
- Consumes the LawsonConstantsRegistry's NCIWeights cell via cell-dep; `weights_used` matches
- Default weights: `pow_weight=1000, pos_weight=3000, pom_weight=6000` (bps, summing to 10000)
- `normalized_*` = pillar_input scaled into a normalized range
- `unified_score = (normalized_pow * weights_used.pow_weight + normalized_pos * weights_used.pos_weight + normalized_pom * weights_used.pom_weight) / 10000`
- No pillar is missing; if any pillar has zero input, `unified_score` is computed honestly with that pillar at zero (no fallback weighting)

### ProtocolDecisionCell

**Data layout** (cell-data):
- `version: u8`
- `proposal_id: [u8; 32]`
- `decision_type: DecisionType` (ValidatorUpdate, GovernanceVeto, SlashDispatch, EmergencyPause, etc.)
- `decision_payload: Vec<u8>` (decision-specific data)
- `nci_score_witness: [u8; 32]` (NCIScoreCell outpoint that authorized this)

**Lock-script**: Permissionless.

**Type-script invariants**:
- Consumes the NCIScoreCell referenced by `nci_score_witness`
- The NCIScoreCell's `unified_score` exceeds the threshold for the `decision_type` (thresholds in LawsonConstantsRegistry, read via cell-dep)
- The `decision_payload` is consistent with the votes recorded in the consumed StakeWeightedVoteCell
- A given proposal_id can authorize at most one ProtocolDecisionCell (enforced via a decisions-registry cell tracking consumed proposal_ids)

## Transaction shapes

**PoW anchor transaction**: Permissionless block-by-block update.
- Inputs: previous PoWAnchorCell (at parent height)
- Outputs: new PoWAnchorCell (at current height)
- Verifies the recorded hash against CKB's syscall-accessible block header

**Stake-weighted vote transaction**: Validator-coordinated, permissionless submission.
- Inputs: capacity
- Outputs: StakeWeightedVoteCell
- Cell-dep: ValidatorRegistryCell
- Off-chain: validators coordinate to produce the BLS-aggregated signature; on-chain transaction just submits the result

**PoM attestation transaction**: Operator-coordinated, permissionless submission.
- Inputs: capacity
- Outputs: PoMAttestationCell
- Cell-deps: PoMOperatorRegistryCell, the proposal context

**NCI score transaction**: Permissionless.
- Inputs: PoWAnchorCell snapshot for the proposal window, StakeWeightedVoteCell, PoMAttestationCell, capacity
- Outputs: NCIScoreCell
- Cell-dep: LawsonConstantsRegistry NCIWeights

**Protocol decision transaction**: Permissionless, threshold-driven.
- Inputs: NCIScoreCell
- Outputs: ProtocolDecisionCell, updated decisions-registry cell

**Decision consumption transaction**: Target-mechanism-specific.
- Inputs: ProtocolDecisionCell
- Outputs: the actuated mechanism state (e.g., updated ValidatorRegistryCell, slash event, governance change)

## Property preservation

**Three-pillar weighting preserved**: The 10/30/60 base weighting is enforced in the NCIScoreCell type-script. Lawson constants registry governance can tune within bounds, but the structural property (no single pillar dominates) is bounded by the constants.

**No-collusion-by-two-pillars bounded by third**: With weights 10/30/60, PoW+PoS = 40 < 60 = PoM, PoW+PoM = 70 > 30 = PoS, PoS+PoM = 90 > 10 = PoW. The first inequality is the load-bearing one: PoW and PoS together cannot outweigh PoM. This is preserved at the substrate level because the type-script enforces the weight ratios.

**No trusted scorer**: Anyone can construct the NCIScoreCell transaction. The type-script catches any incorrect computation. There is no scorer role.

**Substrate-anchored PoW**: The PoWAnchorCell verifies against CKB's actual block headers via syscall. There is no oracle for the PoW signal; it's read directly from the substrate.

**BLS-verified PoS**: Stake-weighted votes are cryptographically aggregated and verified against the bonded validator set. No vote-counting authority.

**PoM-attested cognitive work**: PoM attestations are signed by operators whose cognitive work is verified by the PoM lock-script. No PoM authority.

**Decision finality is deterministic**: A proposal with a given set of pillar inputs produces a determined score, which produces a determined decision. Multiple parties constructing the same transaction produce the same result. First-included settles.

## Upstream pulls

**From CKB substrate**: Block headers via syscall, used by PoWAnchorCell to verify NC-Max output.

**From MessagingHub spec**: The ValidatorRegistryCell, ValidatorBondCell, AttestationCell patterns (BLS aggregation, threshold verification) are reused. The same BLS verification library serves both mechanisms.

**From existing PoM lock-script**: `contracts-ckb/proof-of-mind-lock-script/` is the PoM signing primitive. Already shipped.

**From sUDT**: For bonded stake accounting.

**From `ckb-std`**: Standard syscalls including block-header-read.

**From `ckb-merkle-mountain-range`**: For decisions-registry cell when the consumed-proposal-id set grows large.

## Build new

**PoWAnchorTypeScript**: Rust crate. Verifies recorded block-hash against the substrate's actual block header via syscall.

**StakeWeightedVoteTypeScript**: Rust crate. BLS verification, stake aggregation. Shares BLS code with MessagingHub.

**PoMAttestationTypeScript**: Rust crate. Coordinates with the PoM lock-script for signature verification.

**NCIScoreTypeScript**: Rust crate. Three-pillar normalization and weighted-sum computation.

**ProtocolDecisionTypeScript**: Rust crate. Decision actuation based on score-threshold.

**PoMOperatorRegistryTypeScript**: Rust crate. Per-operator PoM attestation aggregation.

## Open questions

- **PoM normalization function**: The Solidity version uses a calibration that combines bonded stake and work-difficulty. The CKB version needs the same function ported to no_std Rust with consistent rounding. Spec-layer cross-check needed against the canonical paper.

- **PoWAnchorCell update cadence**: One anchor per block produces O(blocks-per-day) transactions per day. This is non-trivial state-rent cost. Alternatives: aggregated anchors per epoch (cheaper, looser PoW signal), or anchors triggered only on proposal-window boundaries (cheaper, but introduces ordering questions).

- **Cross-pillar timing alignment**: PoW evolves continuously, PoS votes happen in batches, PoM attestations are asynchronous. The proposal-window has to encompass enough of each to produce a meaningful score. Defines the protocol-decision latency. Choose carefully.

- **Substrate-level fallback escalation**: If user-space NCI fails to achieve decision finality fast enough or proves vulnerable to a re-org attack, we escalate to substrate-level integration. Document the escalation triggers explicitly so the decision point is clear.

- **Stake snapshot vs streaming**: Stake-weighted votes use a snapshot of the ValidatorRegistryCell at voting epoch. Stake can change during the voting window if validators add/remove bonds. The snapshot-vs-streaming choice affects fairness and attack surface. Default to snapshot at epoch boundary; revisit if needed.

- **Governance veto via NCI**: One of NCI's protocol-decisions is the augmented-governance veto. The Shapley-veto pattern from `[P·augmented-governance]` interacts with the three-pillar score. Specifically, governance proposals that would violate constitutional bounds get vetoed by the math layer, but the math layer's parameters are themselves NCI-tunable. Recursive governance question; not blocking but worth designing carefully.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md` (NCI consensus integration entry)
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec-layer master doc: `vibeswap/docs/architecture/CONSENSUS_MASTER_DOCUMENT.md`
- Spec-layer related: `vibeswap/docs/architecture/ASYMMETRIC_COST_CONSENSUS.md`, `vibeswap/docs/architecture/AUGMENTED_GOVERNANCE.md`
- Existing PoM CKB script: `vibeswap/contracts-ckb/proof-of-mind-lock-script/`
- Mechanism primitives: `[P·augmented-governance]`, `[P·structure-does-the-work]`, `[P·honesty-as-structural-load-bearing-property]`, `[P·consensus-constitution]` (3-token separation of powers)
- Related specs: `messaging-hub.md` (shared BLS + validator registry), `lawson-constants.md` (pending; NCI weights live here)
