# SlashRouter — CKB Cell Spec

**Spec layer**: `vibeswap/contracts/consensus/SlashRouter.sol`
**Port classification**: REINTERPRET
**Status**: Spec draft.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Adjudicates between CRPC (Compute Result Proof of Correctness) task settlements and bond consumption. When a pairwise verifier reaches a verdict on a task, the loser's bond must be slashed and the winner's bond released. SlashRouter is the routing layer that bridges PairwiseVerifier output to EscrowVault's slashBond dispatch.

In the Solidity version, SlashRouter is a UUPS-upgradeable contract with permissionless dispatch (no griefing because slash only fires on a real CRPC loser condition), replay protection via a `_dispatched[taskId]` flag, and a governance-tunable losing-threshold-bps within constitutional bounds [5000, 8000].

The structural property is that slashing is the deterministic consequence of an attested verdict. No party can slash without the verdict; no party can avoid slashing once the verdict is on-chain. Permissionless dispatch means even an adversary can fire the slash, because the substrate enforces that the slash matches the verdict exactly.

## Cell architecture

CRPC settlement produces TaskVerdictCells. SlashRouter consumes them and produces SlashEventCells that authorize EscrowVault to consume the loser's bond. A DispatchedTaskRegistryCell prevents replay.

**TaskVerdictCell.** Produced by the PairwiseVerifier when a CRPC task settles. Holds the task ID, the participants and their characteristic values, the verdict (winner/loser identification), the loser-percentage, and the proof-witnesses for the verdict.

**SlashEventCell.** Created by SlashRouter when it consumes a TaskVerdictCell. Authorizes a specific bond-consumption against EscrowVault. Holds the task ID, the loser's lock-hash, the slash amount, and the verdict reference.

**DispatchedTaskRegistryCell.** Tracks task IDs that have already been routed. Prevents replay. Either an explicit list (small N) or MMR commitment (large N).

**BondCell.** EscrowVault's bond representation. Consumed when a SlashEventCell references it. Lock-script is the bonder's, but spending requires consumption of a matching SlashEventCell OR an honest-release attestation.

## Per-cell specifications

### TaskVerdictCell

**Data layout** (cell-data):
- `version: u8`
- `task_id: [u8; 32]`
- `participants: Vec<(lock_hash, characteristic_value)>`
- `verdict: VerdictKind` (Pairwise winner/loser identification)
- `losing_share_bps: u16` (configured per-task, within Lawson bounds [5000, 8000])
- `verdict_witness: VerdictWitness` (BLS-aggregated verifier signatures or equivalent)
- `settled_at_block: u64`

**Lock-script**: PairwiseVerifier's authorizing script. Only the verifier can produce this cell.

**Type-script invariants**:
- `verdict_witness` verifies against the configured verifier-set
- `task_id` is fresh (not present in DispatchedTaskRegistryCell)
- `participants` has at least two entries
- `losing_share_bps` is within `[5000, 8000]` (Lawson bounds)
- `verdict` identifies exactly one loser among the participants

### SlashEventCell

**Data layout** (cell-data):
- `version: u8`
- `task_id: [u8; 32]`
- `loser_lock_hash: [u8; 32]`
- `bond_outpoint: OutPoint` (the BondCell being slashed)
- `slash_amount: u128`
- `verdict_witness_outpoint: OutPoint` (the TaskVerdictCell)
- `dispatched_at_block: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- Created in conjunction with consumption of the TaskVerdictCell at `verdict_witness_outpoint`
- `loser_lock_hash` matches the loser identified in the verdict
- The referenced BondCell's owner matches `loser_lock_hash`
- `slash_amount` = `bond.amount * verdict.losing_share_bps / 10000`
- The DispatchedTaskRegistryCell is updated to include `task_id` (replay protection)

### DispatchedTaskRegistryCell

**Data layout** (cell-data):
- `version: u8`
- `dispatched_task_ids: Vec<[u8; 32]>` (or MMR root for large N)
- `last_updated_at_block: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- Append-only: every update adds new task_ids, never removes
- Updates only happen as part of a SlashEventCell creation transaction
- Newly-added task_ids match the SlashEventCell created in the same transaction

### BondCell (EscrowVault)

**Data layout** (cell-data):
- `version: u8`
- `bonder_lock_hash: [u8; 32]`
- `amount: u128`
- `bond_type_id: [u8; 32]` (which type of bond: messaging-validator, CRPC-participant, etc.)
- `bonded_at_block: u64`
- `unbonding_started_at: Option<u64>`
- `slashed: bool`

**Lock-script**: Bonder's. Spending requires either:
- An honest-release attestation (no slash event references this bond, and unbonding period has elapsed)
- A SlashEventCell consumed in the same transaction (partial spend, the slashed portion goes to treasury/slashing-pool)

**Type-script invariants** (slash path):
- A SlashEventCell with matching `bond_outpoint` is consumed
- Output cells split: `slash_amount` to slashing-pool-cell, `(amount - slash_amount)` back to the bonder
- The BondCell's `slashed` flag transitions to true

**Type-script invariants** (honest release path):
- No SlashEventCell references this bond
- `unbonding_started_at` is set and `block.height > unbonding_started_at + unbonding_blocks`
- `slashed == false`
- Full amount released to bonder

## Transaction shapes

**Verdict creation transaction**: PairwiseVerifier-authorized.
- Inputs: PairwiseVerifier's settlement state, capacity
- Outputs: TaskVerdictCell
- Type-script gated by PairwiseVerifier's lock

**Slash dispatch transaction**: Permissionless.
- Inputs: TaskVerdictCell, BondCell (the loser's), DispatchedTaskRegistryCell, capacity
- Outputs: SlashEventCell, updated DispatchedTaskRegistryCell, slash-amount to slashing-pool-cell, (bond - slash) to loser
- Anyone can construct; type-script catches replay and incorrect amounts

**Honest release transaction**: Bonder-initiated.
- Inputs: BondCell (with unbonding elapsed and no slash)
- Outputs: bonder's reclaimed capacity
- Lock-script verifies bonder; type-script verifies no slash event

## Property preservation

**Permissionless dispatch**: Anyone can construct the slash transaction once a verdict exists. The type-script catches incorrect dispatches. This removes the trusted-dispatcher role from the EVM version.

**Replay protection**: DispatchedTaskRegistryCell ensures each task_id can produce at most one slash.

**Verdict-bound slashing**: Slash amount is determined by the verdict and the Lawson-bounded losing_share_bps. No party can choose a different amount.

**Honest release is unimpeded**: A bonder whose unbonding period has elapsed and who has no slash event against them can release their full bond. The substrate enforces this directly.

**No griefing**: Permissionless dispatch can only fire when a verdict exists. An adversary cannot create fake verdicts (PairwiseVerifier's lock-script prevents that), so dispatch griefing is bounded by the legitimate-verdict rate.

**Constitutional bound on slash percentage**: `losing_share_bps` is in `[5000, 8000]` (Lawson bounds, immutable). Governance can tune within bounds but cannot push past them.

## Upstream pulls

**From `ckb-system-scripts`**: Standard locks for bonder authorization.

**From `ckb-std`**: Syscalls, hashing, witness parsing.

**From `ckb-merkle-mountain-range`**: For DispatchedTaskRegistryCell when N grows large.

**From MessagingHub**: BLS verification library if `verdict_witness` uses BLS aggregation.

**From LawsonConstantsRegistry**: `losing_share_bps` bounds.

## Build new

**TaskVerdictTypeScript**: Rust crate. Verdict witness verification, fresh task_id check, Lawson bound check.

**SlashEventTypeScript**: Rust crate. Verdict consumption, slash-amount computation, DispatchedTaskRegistry update.

**DispatchedTaskRegistryTypeScript**: Rust crate. Append-only registry.

**BondTypeScript**: Rust crate (shared with MessagingHub's ValidatorBondTypeScript pattern). Slash path and honest-release path.

**PairwiseVerifierAdapter**: The PairwiseVerifier itself is a separate mechanism not specced yet. SlashRouter consumes its output via TaskVerdictCell. PairwiseVerifier spec is future iteration.

## Open questions

- **PairwiseVerifier integration**: PairwiseVerifier is referenced but not yet specced. Decide whether it's a separate cell-spec doc or whether it lives inside the CRPC-MindMesh spec already drafted at `vibeswap/docs/jarvis-substrate/papers/crpc-mindmesh-design-spec-2026-05-24.md`.

- **Multi-loser tasks**: Current spec assumes one loser per task. Some adjudication patterns have multiple losers (e.g., a 3-party task where the verdict identifies two losers). Extend the SlashEventCell to support multiple loser_lock_hashes if needed.

- **Partial slashing**: Some verdicts produce a slash percentage less than the full losing_share. The current `slash_amount = bond.amount * verdict.losing_share_bps / 10000` assumes a fixed percentage. Variable-percentage verdicts need a verdict-side percentage field.

- **Cross-mechanism bond pooling**: A bonder may have bonds in multiple mechanisms (messaging-validator + CRPC-participant). A slash on one shouldn't auto-slash all. Each BondCell is independent and identified by `bond_type_id`, which preserves isolation.

- **Sweeper bounty for permissionless dispatch**: The dispatcher pays the transaction fee but doesn't profit. Consider adding a small bounty paid from the slashed amount to incentivize quick dispatch.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/consensus/SlashRouter.sol`
- Foundry tests (existing, via_ir compile in progress per session-state): `vibeswap/test/consensus/SlashRouter.t.sol`
- Adjacent spec layer: PairwiseVerifier, EscrowVault contracts
- CRPC-MindMesh design: `vibeswap/docs/jarvis-substrate/papers/crpc-mindmesh-design-spec-2026-05-24.md`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·pairwise-language-comparison]`, `[P·unbonding-slash-completeness]`, `[P·dissolve-attack-surface]`
- Related specs: `messaging-hub.md` (shared BondCell/ValidatorBondCell pattern + BLS), `lawson-constants.md` (losing_share_bps bounds), `nci-consensus.md` (PoS pillar consumes bonded stake)
