# ShapleyDistributor — CKB Cell Spec

**Spec layer**: `contracts/incentives/ShapleyDistributor.sol`
**Port classification**: REINTERPRET
**Status**: Spec draft. No implementation cells yet.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Distributes rewards to contributors using Shapley value over a cooperative game defined per contribution event. Each batch settlement, fee distribution, or other economic event spawns its own independent Shapley game with the relevant participants, and the value of that event is divided according to the unique distribution that satisfies the five Shapley axioms (Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality).

Two tracks operate in parallel. The FEE_DISTRIBUTION track is fully time-neutral: trading fees are distributed by pure proportional Shapley, no halving, same work earns the same reward regardless of era. The TOKEN_EMISSION track follows a Bitcoin-style halving schedule for protocol token issuance, intentionally non-neutral because it's a bootstrapping mechanism.

The structural property is that distribution is mechanical, not political. Once the game's value function is defined, the distribution is uniquely determined by the axioms. The substrate enforces that the distribution produced by a transaction is exactly the Shapley value over the game; any other distribution fails the type-script and the transaction cannot land.

## Cell architecture

Contribution events spawn ContributionEventCells. Computations happen in transactions that consume ContributionEventCells and produce ShapleyDistributionCells. Claimable rewards live as RewardClaimCells, one per contributor per event, that the contributor can spend on their own lock-script to release the reward.

**ContributionEventCell.** Created by the mechanism that produced the event (e.g., the BatchSettlementCell from CommitRevealAuction creates a ContributionEventCell for fee distribution when the batch closes). Holds the event's value function, the participant set with their characteristic contributions, the event type (FEE_DISTRIBUTION or TOKEN_EMISSION), the total value to distribute, and the source-mechanism reference.

**ShapleyDistributionCell.** Created by a permissionless settlement transaction that consumes the ContributionEventCell. Holds the computed Shapley value for each participant. The type-script verifies that the distribution satisfies all five axioms over the input game. Once created, the distribution is immutable.

**RewardClaimCell.** Created in the same transaction as the ShapleyDistributionCell, one per participant. Holds the participant's share, the source event reference, and the participant's recipient lock-hash. The lock-script is the participant's, so only they can claim it. The type-script verifies the claim amount matches the participant's row in the ShapleyDistributionCell.

**EmissionScheduleCell** (TOKEN_EMISSION only). Holds the current era index, the per-era base emission, and the halving schedule. ContributionEventCells in the TOKEN_EMISSION track consult this cell via cell-dep to determine the era's available emission. Halvings happen by replacing the EmissionScheduleCell at era boundaries with an updated era field.

**SybilGuardCell.** Aggregates sybil-detection signals (failed PoM attestations, identity-divergence detections, contribution-pattern anomalies). ContributionEventCells consult this cell via cell-dep to verify that no flagged participant is included with positive weight.

## Per-cell specifications

### ContributionEventCell

**Data layout** (cell-data):
- `version: u8`
- `event_id: [u8; 32]` (hash of event source and contents)
- `event_type: EventType` (FEE_DISTRIBUTION or TOKEN_EMISSION)
- `source_outpoint: OutPoint` (the cell that triggered this event)
- `total_value: u128` (total reward to distribute)
- `value_token_type_hash: [u8; 32]` (which token the reward is denominated in)
- `participants: Vec<Participant>`
  - per participant: `lock_hash: [u8; 32]`, `characteristic_value: u128`, `contribution_type: u8`
- `game_value_function_kind: u8` (proportional, glove-game, custom-tag)
- `era_at_creation: u64` (TOKEN_EMISSION only)
- `created_at_block: u64`

**Lock-script**: Defined by the source mechanism. For batch settlement events, the lock is the BatchSettlementTypeScript-hash so only that mechanism can create the event. For other events, the originating mechanism's script-hash.

**Type-script invariants** (at creation):
- `event_id` is a fresh hash (not present in any consumed ContributionEventCell)
- `participants` has no duplicate `lock_hash`
- `total_value` matches the source mechanism's commitment (e.g., the BatchSettlementCell's fee amount)
- For TOKEN_EMISSION: `total_value ≤ EmissionScheduleCell.current_era_remaining_emission` (read via cell-dep)
- No participant `lock_hash` is in the SybilGuardCell's flagged set (read via cell-dep)
- `characteristic_value` is non-negative for all participants
- For FEE_DISTRIBUTION: sum of `characteristic_value` is preserved (no inflation)

**Type-script invariants** (at consumption by a settlement transaction):
- Exactly one output ShapleyDistributionCell references this event_id
- All output RewardClaimCells correspond to participants in this event

### ShapleyDistributionCell

**Data layout** (cell-data):
- `version: u8`
- `event_id: [u8; 32]` (matches the consumed ContributionEventCell)
- `distributions: Vec<Distribution>`
  - per distribution: `participant_lock_hash: [u8; 32]`, `shapley_share: u128`
- `axiom_witness: AxiomWitness` (succinct evidence of axiom satisfaction)

**Lock-script**: Permissionless. Anyone can produce the settlement, the type-script catches any incorrect computation.

**Type-script invariants** (at creation):
- Consumes exactly one ContributionEventCell with the matching event_id
- For each participant in the event, exactly one row in `distributions` with the same lock_hash
- **Efficiency**: `sum(distributions.shapley_share) == event.total_value`
- **Symmetry**: For any pair of participants i, j with identical characteristic values and identical contribution types, `distributions[i].shapley_share == distributions[j].shapley_share`
- **Null Player**: Any participant with `characteristic_value == 0` has `shapley_share == 0`
- **Pairwise Proportionality**: For any pair i, j, `distributions[i].shapley_share / distributions[j].shapley_share == characteristic_value[i] / characteristic_value[j]` (when value_function_kind == proportional). For glove-game and custom-tag kinds, the appropriate pairwise relation holds.
- **Time Neutrality**: For FEE_DISTRIBUTION events, the distribution function depends only on the participants' characteristic values, not on the era at creation. Verified by recomputing with `era_at_creation = 0` and checking equality.
- For each output RewardClaimCell with matching event_id, the amount matches the row in `distributions`

**Note on game value function kinds**: The proportional kind uses `shapley_share = total * characteristic / sum(characteristic)`. The glove-game kind handles enabling-contribution patterns (where one participant's contribution is worthless without another's) via the standard Shapley enumeration over coalitions. The custom-tag kind allows the source mechanism to embed a value function fingerprint that the type-script can verify against a known table. New kinds require adding entries to that table via governance.

### RewardClaimCell

**Data layout** (cell-data):
- `version: u8`
- `event_id: [u8; 32]`
- `participant_lock_hash: [u8; 32]`
- `amount: u128`
- `value_token_type_hash: [u8; 32]`
- `created_at_block: u64`
- `claim_deadline: u64` (optional; if zero, no deadline)

**Lock-script**: The participant's lock-hash (recovered from `participant_lock_hash`). Only they can spend it.

**Type-script invariants** (at creation):
- Created in the same transaction as a ShapleyDistributionCell with the matching event_id
- `amount` matches the participant's row in that ShapleyDistributionCell
- `value_token_type_hash` is consistent with the event's reward token

**Type-script invariants** (at consumption / claim):
- Standard token-conservation against the value_token_type_hash
- If `claim_deadline > 0` and `block.timestamp > claim_deadline`, only a sweeper transaction can consume (and reroute to the protocol's unclaimed-rewards pool)

### EmissionScheduleCell

**Data layout** (cell-data):
- `version: u8`
- `current_era: u64`
- `era_start_block: u64`
- `era_duration_blocks: u64`
- `genesis_emission_per_event: u128`
- `current_era_remaining_emission: u128`
- `halving_factor: u16` (e.g., 5000 bps = 50%)

**Lock-script**: Governance-gated (a multi-sig or DAO mutation cell during bootstrap; later, immutable).

**Type-script invariants** (at era transition):
- A transition is only valid when `block.height >= era_start_block + era_duration_blocks`
- The new era's `genesis_emission_per_event = old.genesis_emission_per_event * halving_factor / 10000`
- The new era's `era_start_block = old.era_start_block + old.era_duration_blocks`
- The new era's `current_era_remaining_emission = genesis_emission_per_event * games_per_era` (where games_per_era is a constant or governance parameter)

**Type-script invariants** (at consumption by a TOKEN_EMISSION ContributionEventCell):
- `block.height ∈ [era_start_block, era_start_block + era_duration_blocks]`
- `current_era_remaining_emission` decrements by the event's claimed emission

### SybilGuardCell

**Data layout** (cell-data):
- `version: u8`
- `flagged_lock_hashes: Vec<[u8; 32]>` (or an MMR root over a larger set)
- `last_updated_block: u64`

**Lock-script**: Governance-gated; updates require validator-attestation evidence.

**Type-script invariants**:
- Adding to the flagged set requires inclusion of attestation witnesses from configured anti-sybil validators
- Removing from the flagged set requires either evidence of expiration or governance multi-sig

## Transaction shapes

**Event-spawn transaction**: A source-mechanism transaction.
- Inputs: source mechanism's cell (e.g., BatchSettlementCell)
- Outputs: ContributionEventCell + downstream source-mechanism state
- Type-script: source mechanism's authorizing script must produce the ContributionEventCell with correct value, participants, and event_id

**Shapley computation and distribution transaction**: Permissionless settlement.
- Inputs: ContributionEventCell, EmissionScheduleCell (if TOKEN_EMISSION), SybilGuardCell (via cell-dep)
- Outputs: ShapleyDistributionCell, one RewardClaimCell per participant, updated EmissionScheduleCell (if TOKEN_EMISSION)
- Anyone can construct; type-script enforces correctness

**Reward claim transaction**: Participant transaction.
- Inputs: RewardClaimCell, capacity from participant
- Outputs: participant's reward-token cell, participant's change cell
- Lock-script verifies participant signature; type-script verifies token conservation

**Unclaimed sweep transaction**: Sweeper transaction (only if deadline passed).
- Inputs: RewardClaimCell past deadline, unclaimed-pool cell
- Outputs: updated unclaimed-pool cell with rewards added
- Type-script verifies deadline and routes to the protocol's unclaimed pool

## Property preservation

The five Shapley axioms are mathematical, not procedural. The substrate's job is to verify that any produced distribution satisfies them. The verification is exactly the axiom check listed in the ShapleyDistributionCell type-script invariants.

**Five axioms enforced structurally**: Efficiency, Symmetry, Null Player, Pairwise Proportionality, and Time Neutrality are each a type-script check. No permission, no trusted distributor, no admin override can produce a distribution that violates them. This is the meaning of [P·shapley-5-axiom-set] applied at the substrate layer.

**Anti-MLM by Σφ = v(N)**: The Efficiency axiom ensures that no value is created in the distribution. Σ shapley_share == event.total_value. Pyramid schemes that depend on inflation cannot pass the type-script.

**Time Neutrality for FEE_DISTRIBUTION**: The FEE track's distribution function does not consult the era. Two events with identical participants and identical characteristic values produce identical distributions regardless of when they happen.

**Halving for TOKEN_EMISSION is honest**: The emission halving is in the EmissionScheduleCell, not in the Shapley function itself. The Shapley distribution over a TOKEN_EMISSION event is still axiom-preserving for that event. What changes across eras is the total value being distributed, not the distribution rule.

**Sybil filtering**: SybilGuardCell flags propagate to ContributionEventCell creation. Flagged participants cannot be included with positive weight.

**Permissionless settlement**: Anyone can construct the distribution transaction. The substrate verifies correctness. No trusted oracle, no distributor role.

## Upstream pulls

**From `ckb-system-scripts`**: Standard locks for participant authorization.

**From sUDT**: Reward token cells and the unclaimed-pool cell.

**From `ckb-std`**: Syscalls, hashing, witness parsing for all type-scripts.

**From `ckb-merkle-mountain-range`**: For the SybilGuardCell when the flagged set is large enough to warrant MMR commitment with inclusion proofs.

**From Omnilock**: Participant claim authorization.

## Build new

**ContributionEventTypeScript**: Rust crate at `contracts-ckb/contribution-event-type-script/`. Verifies event creation invariants and the relationship to consumed source-mechanism cells.

**ShapleyDistributionTypeScript**: Rust crate at `contracts-ckb/shapley-distribution-type-script/`. Implements all five axiom checks. The largest piece of new code in this mechanism. Cycle budget needs careful attention because axiom verification scales with participant count.

**RewardClaimTypeScript**: Rust crate at `contracts-ckb/reward-claim-type-script/`. Standard claim semantics with optional deadline.

**EmissionScheduleTypeScript**: Rust crate at `contracts-ckb/emission-schedule-type-script/`. Era-transition logic, halving arithmetic, emission accounting.

**SybilGuardTypeScript**: Rust crate at `contracts-ckb/sybil-guard-type-script/`. Aggregates anti-sybil signals.

**Value function library**: A no_std Rust crate providing the standard value functions (proportional, glove-game, custom-tag) as shared code for the ShapleyDistributionTypeScript to use.

## Open questions

- **Glove-game cycle cost**: Glove-game Shapley computation enumerates over coalitions. For N participants this is 2^N combinations. CKB-VM cycle limits will cap practical N. Spike needed: at what N does glove-game enumeration exceed budget? Likely small (N ≤ 16 or so), which constrains where glove-game value functions can apply.

- **Pairwise Proportionality verification**: The pairwise check is O(N^2). For events with many participants, this is the cycle bottleneck. Optimization: verify a random subset of pairs and rely on the type-script's deterministic nature to catch violations probabilistically, paired with a challenge-window. Adds complexity.

- **Time Neutrality verification by re-computation**: The current spec requires verifying the distribution matches a computation with `era = 0`. This effectively requires running the value function twice. Alternative: prove time-neutrality structurally by inspecting the value function fingerprint and showing it has no era input.

- **MMR vs explicit list in SybilGuardCell**: If the flagged set is small (under a few hundred), explicit list is fine. If it grows large, MMR commitment with inclusion proofs is needed. Decide based on operational data.

- **Cross-event Shapley composition**: The Solidity version is event-based (each event independent). Some use cases (long-running contribution graphs for the persistent-skills system, for example) benefit from cross-event Shapley with proper composition. This is the same shape as the Odysseus #3178 discussion on attribution graphs. Out of scope for the initial spec but flagged for future iteration.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/incentives/ShapleyDistributor.sol`
- Solidity helpers: `PairwiseFairness.sol`, `ISybilGuard.sol`, `IShapleyVerifier.sol`
- Mechanism primitives: `[P·shapley-5-axiom-set]`, `[P·composable-fairness-arrow-inversion]`, `[P·cooperative-game-elicitation-stack]`, `[P·atomized-shapley]`
- Related specs: `commit-reveal-auction.md` (fee event source), `vibe-amm.md` (fee event source), `messaging-hub.md` (pending)
