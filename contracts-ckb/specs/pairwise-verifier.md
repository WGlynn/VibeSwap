# PairwiseVerifier — CKB Cell Spec

**Spec layer**: `contracts/identity/PairwiseVerifier.sol` (+ `IPairwiseVerifier.sol`)
**Port classification**: REINTERPRET
**Status**: Spec draft. No implementation cells yet.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

PairwiseVerifier is the on-chain settlement layer for **CRPC** (Commit-Reveal Pairwise Comparison): the 4-phase protocol that verifies non-deterministic AI work outputs by pairwise voting from a validator set, rather than hash-equality. Workers submit work, validators compare it head-to-head, and the consensus over pairs produces both a winner-ranking and a verdict that downstream mechanisms (SlashRouter, ShapleyDistributor, EscrowVault) can consume.

The structural property is that **no single party — worker, validator, or settler — controls the verdict**. Workers cannot copy each other (commit phase hides work); validators cannot reverse-engineer judgments after seeing peer reveals (compare-commit hides choices); settlement is mechanical from the revealed data. The verdict is whatever the substrate computes from the revealed cells. There is no trusted aggregator.

In the EVM version, PairwiseVerifier is a UUPS-upgradeable contract with task state in mappings, phase advancement gated by `block.timestamp`, and a single `settle()` function that tallies wins/losses, computes per-worker rewards proportional to `wins * 2 + ties`, marks consensus-aligned validators, and divides a validator pool among them. Slashing for non-reveal sits at 50% (SLASH_RATE_BPS). The 4 phases are WORK_COMMIT → WORK_REVEAL → COMPARE_COMMIT → COMPARE_REVEAL → SETTLED.

CKB reinterprets the 5 enum states as 5 cell types. Each phase's state lives in its own cell. The settlement transaction consumes all the revealed cells for a task and produces a TaskVerdictCell (the same cell type SlashRouter expects). Permissionless settlement comes free; the type-script catches incorrect tallies, so an MEV-extractor's attempt to settle in their favor fails.

This is REINTERPRET (not DIRECT-PORT): the mechanism intent — pairwise comparison with commit-reveal at both worker and validator layers — survives intact, but the substrate shape changes from "contract with internal state machine" to "per-phase cells with type-script transitions." DROP was considered (the EVM contract is mature) and rejected because the sovereign-pivot mandates substrate-native settlement for slash-eligible mechanisms. DIRECT-PORT was rejected because the EVM contract relies on global mutable mappings and a single settle() function with O(N²) consensus tally — neither maps cleanly to cell composition without restructuring.

## Cell architecture

Six cell types compose the mechanism. Workers create commit/reveal cells. Validators create comparison commit/reveal cells. Settlement is permissionless. The verdict cell is the handoff to SlashRouter.

**VerificationTaskCell.** Created by the task creator who funds the reward pool. Holds the task description hash, the spec hash (IPFS CID), the reward pool capacity, the validator-reward-bps, and the 4-phase deadline schedule. Cannot be modified after creation; the per-phase deadlines fix the timing.

**WorkCommitCell.** Created by a worker during the WORK_COMMIT window. Holds `hash(work_hash || secret)`, the worker's lock-hash, and the parent task reference. Immutable until either a WorkRevealCell consumes it (good path) or a WorkSlashCell consumes it after the reveal deadline (slash path).

**WorkRevealCell.** Created during the WORK_REVEAL window. Spends the WorkCommitCell. Reveals `work_hash` and `secret`; the type-script verifies preimage.

**ComparisonCommitCell.** Created by a validator during the COMPARE_COMMIT window. Holds `hash(choice || secret)`, the validator's lock-hash, and references to the two WorkRevealCells being compared (`submission_a`, `submission_b`).

**ComparisonRevealCell.** Created during the COMPARE_REVEAL window. Spends the ComparisonCommitCell. Reveals the `choice` (FIRST / SECOND / EQUIVALENT) and `secret`; type-script verifies preimage and that the parent task is in the right phase.

**TaskVerdictCell.** This is the cell SlashRouter consumes (per `slash-router.md`). Created by the permissionless settlement transaction that consumes all ComparisonRevealCells and WorkRevealCells for a task. Holds the participants with characteristic values (win-scores), the verdict (winner/loser identification), the losing-share-bps (within Lawson bounds [5000, 8000]), and a verdict-witness that proves the tally was computed correctly from the revealed cells.

**WorkSlashCell** / **ComparisonSlashCell.** Created by permissionless sweepers to consume non-revealed commit cells after their respective deadlines pass. Splits the implicit deposit (cell capacity above the floor) 50/50 between treasury and committer per SLASH_RATE_BPS.

## Per-cell specifications

### VerificationTaskCell

**Data layout** (cell-data):
- `version: u8`
- `task_id: [u8; 32]` (hash of creator lock-hash, nonce, block height)
- `creator_lock_hash: [u8; 32]`
- `description_hash: [u8; 32]`
- `spec_hash: [u8; 32]` (IPFS CID)
- `reward_pool: u128`
- `reward_token_type_hash: [u8; 32]`
- `validator_reward_bps: u16` (default 3000; capped at 10_000)
- `work_commit_end: u64`
- `work_reveal_end: u64`
- `compare_commit_end: u64`
- `compare_reveal_end: u64`
- `min_submissions: u8` (default 2 per [P·lawson-constants])
- `max_submissions: u8` (default 20)
- `min_comparisons_per_pair: u8` (default 3)

**Lock-script**: Permissionless. Anyone can construct; type-script enforces invariants.

**Type-script invariants**:
- `task_id` is fresh (not present in any other VerificationTaskCell on the chain — checked via a TaskRegistryCell index, or by deterministic derivation from `(creator_lock_hash, nonce, block.height)`)
- Phase deadlines monotonically increasing
- `reward_pool` matches the capacity locked in the cell
- `validator_reward_bps ≤ 10_000`
- Constants `min_submissions`, `max_submissions`, `min_comparisons_per_pair` read from LawsonConstantsRegistry via cell-dep, must be within configured bounds

### WorkCommitCell

**Data layout**:
- `version: u8`
- `task_outpoint: OutPoint` (the VerificationTaskCell)
- `submission_id: [u8; 32]` (hash of task_id || worker_lock_hash || nonce)
- `worker_lock_hash: [u8; 32]`
- `commit_hash: [u8; 32]` (keccak256 of `work_hash || secret`)
- `deposit_amount: u64` (capacity reserved for slashing)

**Lock-script**: Worker's lock (Omnilock).

**Type-script invariants** (at creation):
- The VerificationTaskCell at `task_outpoint` is in WORK_COMMIT phase: `block.timestamp ≤ task.work_commit_end`
- `block.timestamp ≥ task.created_at` (no creation before the task)
- The worker has not already submitted to this task (verified via a `task_submissions` registry cell consumed in the same transaction, OR via uniqueness of `submission_id` derived from `(task_id, worker_lock_hash)`)
- Total submissions for this task `< max_submissions`

**Type-script invariants** (at consumption by WorkRevealCell):
- Exactly one output WorkRevealCell references this `submission_id`
- `deposit_amount` passes through unchanged

**Type-script invariants** (at consumption by WorkSlashCell):
- `block.timestamp > task.work_reveal_end`
- No WorkRevealCell for this submission_id exists in the chain history (verified via the settlement-set or a NonRevealedRegistryCell)
- Split: 50% to treasury cell, 50% returned to `worker_lock_hash`

### WorkRevealCell

**Data layout**:
- `version: u8`
- `task_outpoint: OutPoint`
- `submission_id: [u8; 32]`
- `worker_lock_hash: [u8; 32]`
- `work_hash: [u8; 32]` (IPFS CID of actual work)
- `secret: [u8; 32]`
- `deposit_amount: u64` (passed through)

**Lock-script**: Worker's lock.

**Type-script invariants** (at creation):
- A WorkCommitCell with matching `submission_id` is consumed
- `keccak256(work_hash || secret) == commit.commit_hash`
- VerificationTaskCell at `task_outpoint` is in WORK_REVEAL phase: `task.work_commit_end < block.timestamp ≤ task.work_reveal_end`
- `worker_lock_hash` matches the consumed commit's `worker_lock_hash`

**Type-script invariants** (at consumption by TaskVerdictCell settlement):
- Included in the settlement transaction's input set for this task_id
- Win-score `wins * 2 + ties` matches the TaskVerdictCell's recorded characteristic_value for this worker

### ComparisonCommitCell

**Data layout**:
- `version: u8`
- `task_outpoint: OutPoint`
- `comparison_id: [u8; 32]`
- `validator_lock_hash: [u8; 32]`
- `submission_a_id: [u8; 32]` (the canonical lower of the two — order-independent)
- `submission_b_id: [u8; 32]`
- `commit_hash: [u8; 32]` (keccak256 of `uint8(choice) || secret`)

**Lock-script**: Validator's lock.

**Type-script invariants** (at creation):
- VerificationTaskCell at `task_outpoint` is in COMPARE_COMMIT phase
- `submission_a_id != submission_b_id` (no self-comparison)
- `submission_a_id < submission_b_id` (canonical ordering enforced; this is the cell-side analog of `_pairHash`)
- WorkRevealCells for both `submission_a_id` and `submission_b_id` exist and are referenced via cell-dep
- The validator has not already submitted a comparison for this pair-task tuple (verified via `comparison_id` derivation OR a per-task validator-pair registry cell)

### ComparisonRevealCell

**Data layout**:
- `version: u8`
- `task_outpoint: OutPoint`
- `comparison_id: [u8; 32]`
- `validator_lock_hash: [u8; 32]`
- `submission_a_id: [u8; 32]`
- `submission_b_id: [u8; 32]`
- `choice: u8` (1=FIRST, 2=SECOND, 3=EQUIVALENT)
- `secret: [u8; 32]`

**Lock-script**: Validator's lock.

**Type-script invariants** (at creation):
- A ComparisonCommitCell with matching `comparison_id` is consumed
- `keccak256(uint8(choice) || secret) == commit.commit_hash`
- VerificationTaskCell at `task_outpoint` is in COMPARE_REVEAL phase: `task.compare_commit_end < block.timestamp ≤ task.compare_reveal_end`
- `choice ∈ {1, 2, 3}`

### TaskVerdictCell

**Data layout** (matches the format SlashRouter consumes — see `slash-router.md`):
- `version: u8`
- `task_id: [u8; 32]`
- `participants: Vec<(lock_hash, characteristic_value)>` where characteristic_value = `wins * 2 + ties` for each worker
- `verdict: VerdictKind` (identifies the loser(s) — worker with lowest characteristic_value, breaking ties deterministically by lock_hash)
- `winner_lock_hash: [u8; 32]` (highest characteristic_value)
- `losing_share_bps: u16` (within Lawson bounds [5000, 8000])
- `verdict_witness: VerdictWitness` (struct binding the tally to the consumed reveal cells)
- `worker_rewards: Vec<(lock_hash, u128)>` (each `reward_pool * (10000 - validator_reward_bps) / 10000 * win_score / total_win_score`)
- `validator_rewards: Vec<(lock_hash, u128)>` (validators who were `consensus_aligned`, each receiving `validator_pool / aligned_count`)
- `consensus_aligned_validators: Vec<[u8; 32]>` (for downstream reputation update)
- `settled_at_block: u64`

**Lock-script**: Permissionless. Type-script catches incorrect settlement.

**Type-script invariants**:
- `block.timestamp > task.compare_reveal_end`
- All WorkRevealCells and ComparisonRevealCells for this `task_id` (that exist on-chain prior to settlement) are consumed as inputs OR referenced via cell-dep; the type-script verifies no revealed cell is excluded
- For each worker, characteristic_value = `wins * 2 + ties` where wins/losses/ties are tallied by iterating consumed ComparisonRevealCells per the per-pair majority rule (mirrors `_markConsensusAligned`)
- Consensus per pair: majority of revealed choices (normalized to the canonical pair ordering); ties broken to EQUIVALENT
- Each `validator_rewards[i]` is set IFF that validator's ComparisonRevealCell.choice matches the pair's consensus
- Sum of `worker_rewards + validator_rewards + sweeper_bounty == task.reward_pool` (capacity conservation)
- `losing_share_bps` is read from LawsonConstantsRegistry via cell-dep, in `[5000, 8000]`
- `verdict_witness` binds the participant list to the consumed reveal cells' outpoints (hash-commit), so SlashRouter can verify the verdict's lineage

### WorkSlashCell / ComparisonSlashCell

**Data layout**:
- `version: u8`
- `task_outpoint: OutPoint`
- `commit_outpoint: OutPoint` (the non-revealed cell being slashed)
- `treasury_share: u64`
- `committer_share: u64`
- `sweeper_bounty: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- `block.timestamp > task.work_reveal_end` (WorkSlashCell) OR `> task.compare_reveal_end` (ComparisonSlashCell)
- No corresponding reveal cell for `commit_outpoint` exists
- `treasury_share = floor(deposit * SLASH_RATE_BPS / 10000)` where SLASH_RATE_BPS = 5000 (Lawson constant)
- `treasury_share + committer_share + sweeper_bounty == commit.deposit_amount`
- `sweeper_bounty` capped by protocol constant

## Transaction shapes

**Task creation transaction**: Creator → VerificationTaskCell. Inputs: creator's funded capacity (≥ reward_pool + storage capacity). Outputs: VerificationTaskCell. Lock = permissionless; type-script enforces all invariants. Cell-deps: LawsonConstantsRegistry.

**Work commit transaction**: Worker → WorkCommitCell. Inputs: worker's capacity (≥ deposit_amount + storage). Outputs: WorkCommitCell. Cell-deps: VerificationTaskCell. The worker's lock-script verifies they authorized the commit.

**Work reveal transaction**: Worker → WorkRevealCell. Inputs: worker's WorkCommitCell. Outputs: WorkRevealCell. Type-script verifies preimage.

**Comparison commit transaction**: Validator → ComparisonCommitCell. Cell-deps include the two WorkRevealCells being compared.

**Comparison reveal transaction**: Validator → ComparisonRevealCell. Inputs: validator's ComparisonCommitCell. Outputs: ComparisonRevealCell.

**Settlement transaction**: Anyone → TaskVerdictCell. Inputs: all WorkRevealCells + all ComparisonRevealCells for the task, plus VerificationTaskCell, plus any task-registry housekeeping cells. Outputs: TaskVerdictCell + reward-claim cells (one per worker, one per consensus-aligned validator, one sweeper-bounty cell). Cell-deps: LawsonConstantsRegistry. Permissionless; type-script catches incorrect tally.

**Slash transaction**: Anyone → WorkSlashCell or ComparisonSlashCell. Inputs: the non-revealed commit cell. Outputs: SlashCell + treasury cell + committer-refund cell + sweeper-bounty cell.

## Composition with SlashRouter

The TaskVerdictCell **is the exact handoff cell SlashRouter's spec expects** (see `slash-router.md` § TaskVerdictCell). SlashRouter consumes a TaskVerdictCell as a cell-dep, identifies the loser via the `verdict` field, and produces a SlashEventCell that authorizes EscrowVault to consume the loser's BondCell at `losing_share_bps`. Key handoff fields:

- `task_id` — SlashRouter's replay key (DispatchedTaskRegistryCell tracks dispatched task_ids)
- `participants` with characteristic values — SlashRouter uses these to identify the loser
- `verdict` — explicit winner/loser identification
- `losing_share_bps` — Lawson-bounded, drives the slash amount
- `verdict_witness` — proves the verdict was derived from real revealed cells, not fabricated

SlashRouter's lock-script for TaskVerdictCell creation is "PairwiseVerifier's authorizing script" per its spec — meaning the TaskVerdictCell's type-script *is* PairwiseVerifier's settlement type-script. They share a code-cell. There is no separate trust boundary; SlashRouter trusts the TaskVerdictCell because the type-script that produced it is the one defined here, and SlashRouter cell-dep-references that type-script's code-hash for identity verification.

## Composition with other specs

**ShapleyDistributor** (`shapley-distributor.md`): The `worker_rewards` and `validator_rewards` distributions in TaskVerdictCell can be reinterpreted as a ContributionEventCell input for a more sophisticated Shapley-game distribution if the task creator opts in. Default path uses the simple proportional split (matches EVM behavior); ShapleyDistributor opt-in is a future iteration where the value function honors the 5 axioms over the worker+validator coalition.

**EscrowVault** (existing `contracts-ckb/escrow-vault-cell-type-script/`): The slash path consumes BondCells matching `loser_lock_hash`. The verdict cell flows: PairwiseVerifier → TaskVerdictCell → SlashRouter → SlashEventCell → EscrowVault BondCell consumption.

**MessagingHub** (`messaging-hub.md`): If pairwise tasks involve cross-chain workers (e.g., validating AI work submitted from EVM-side via a CanonicalTokenCell-denominated reward pool), the reward_token_type_hash points at the CanonicalTokenCell type. No new mechanism; just sUDT-style accounting.

**AgentRegistry** (pending CKB-side spec): The EVM version references `agentRegistry`. On CKB, this becomes an AgentRegistryCell consulted via cell-dep at commit-time to verify the worker / validator is a registered agent. For the v1 port, this dependency is optional (any lock-hash can participate); registry gating is a future tightening.

**LawsonConstantsRegistry** (`lawson-constants.md`): Provides `min_submissions`, `max_submissions`, `min_comparisons_per_pair`, `losing_share_bps` bounds [5000, 8000], `SLASH_RATE_BPS` = 5000, `DEFAULT_VALIDATOR_REWARD_BPS` = 3000.

## Constants and parameters (pulled from Lawson)

| Constant | EVM value | Lawson bounds | Read at |
|---|---|---|---|
| `MIN_SUBMISSIONS` | 2 | [2, 5] | Task create |
| `MAX_SUBMISSIONS` | 20 | [10, 50] | Task create + commit |
| `MIN_COMPARISONS_PER_PAIR` | 3 | [3, 7] | Settlement |
| `DEFAULT_VALIDATOR_REWARD_BPS` | 3000 | [1500, 5000] | Task create |
| `SLASH_RATE_BPS` | 5000 | Fixed (constitutional) | Slash |
| `losing_share_bps` | n/a (new) | [5000, 8000] (per slash-router.md) | Settlement |

All read via cell-dep on LawsonConstantsRegistry's ConstantsRegistryCell, with the immutable ConstitutionalBoundsCell enforcing the outer bounds.

## Property preservation

**Commit privacy (worker layer)**: WorkCommitCell holds only the hash; the work itself lives off-chain (IPFS). No mempool inspection reveals more than the hash. Reveal window timing is enforced by `block.timestamp` vs `work_reveal_end`.

**Commit privacy (validator layer)**: ComparisonCommitCell holds only `hash(choice || secret)`. Validators cannot see peer choices before committing. The compare-commit window forces validators to lock in judgments before any reveals are visible.

**Consensus determinism**: Tally is mechanical from revealed cells. Pair-majority computed deterministically with canonical pair-ordering (`submission_a_id < submission_b_id`). Ties broken to EQUIVALENT (matches EVM `_markConsensusAligned`).

**Permissionless settlement**: Anyone can construct the settlement transaction. Incorrect tallies fail type-script. No trusted settler. Removes the implicit settlement-trust assumption from the EVM version (where settle() is permissionless but state can drift if tallies are computed in-contract).

**No reentrancy**: Cells consumed once. ReentrancyGuard from EVM disappears (per [P·substrate-port-pattern] DROP).

**Replay protection on task settlement**: TaskVerdictCell creation is gated by VerificationTaskCell consumption (one-shot). Re-running settle is impossible because the VerificationTaskCell is gone.

**Slash mechanicalness**: Non-reveal slash is permissionless, gated by deadline, and type-script-enforced 50/50 split. Sweeper bounty incentivizes prompt slashing.

## Upstream pulls

- **`ckb-system-scripts`**: secp256k1 / Omnilock for worker and validator authorization
- **`ckb-std`**: syscalls, witness parsing, blake2b, keccak256 (needs `no_std` keccak crate — sha3-no-std exists)
- **sUDT/xUDT**: if reward_pool is denominated in a sUDT (CanonicalTokenCell or VIBE token); native CKB capacity is the default
- **From SlashRouter spec**: shared `VerdictWitness` and `VerdictKind` structs (defined in a shared `vibeswap-ckb-verdict` Rust crate)
- **From LawsonConstantsRegistry**: all numeric parameters via cell-dep
- **From existing PsiNet `proof-of-mind-lock-script`**: optional gating where workers must produce a PoM attestation to commit (raises sybil-resistance per the PsiNet × VibeSwap merge)

## Build new

- **VerificationTaskTypeScript** — Rust crate
- **WorkCommitTypeScript** + **WorkRevealTypeScript** — Rust crates; reveal does the keccak preimage check
- **ComparisonCommitTypeScript** + **ComparisonRevealTypeScript** — Rust crates
- **TaskVerdictTypeScript** — Rust crate, largest piece. Implements per-pair majority tally, characteristic-value computation, reward allocation, verdict-witness binding. Cycle-budget critical (O(N²) pair tally over comparisons).
- **WorkSlashTypeScript** + **ComparisonSlashTypeScript** — small slash crates
- **`vibeswap-ckb-verdict`** crate (shared with SlashRouter) — `VerdictKind`, `VerdictWitness`, serialization

## Failure modes and recovery

- **Invalid preimage at reveal**: ComparisonRevealCell's type-script rejects; reveal transaction fails; validator is treated as non-revealed and slashable after deadline.
- **Tied verdict (multiple workers with same characteristic_value)**: Verdict identifies all tied participants but selects loser by deterministic tie-break (lowest `lock_hash`). Documented at the type-script level. If no clear loser exists (all tied at zero), the task is marked `inconclusive` in the verdict and SlashRouter treats this as a no-op (no SlashEventCell produced; reward pool refunded to creator minus storage costs).
- **Insufficient submissions (`< min_submissions`)**: Settlement still runs but the verdict carries `inconclusive` flag; rewards refund to creator. Workers who did submit still claim back their deposit (no slash; they did their part).
- **Insufficient comparisons per pair (`< min_comparisons_per_pair`)**: Pair tally falls back to `EQUIVALENT`; characteristic_values draw from valid pairs only. Documented in the type-script.
- **Contested verdict (validators split evenly across choices)**: Per-pair consensus falls back to `EQUIVALENT` on exact split (matches EVM `>=` logic). No deadlock state.
- **Non-revealed workers**: Slashed 50% via WorkSlashCell after `work_reveal_end`. Sweepers earn small bounty.
- **Non-revealed validators**: Slashed 50% via ComparisonSlashCell after `compare_reveal_end`.
- **Settlement transaction omits a revealed cell**: Type-script rejects (every revealed cell with matching `task_id` must be in the consumed set, verified via cell-dep enumeration or a per-task RevealRegistryCell). Prevents adversarial cherry-picking.
- **Capacity griefing on task creation**: `reward_pool` is locked at creation; an abandoned task (no submissions) refunds capacity to creator after `compare_reveal_end` via a reclaim transaction.

## Open questions

- **Cycle budget for settlement**: Pair tally is O(N_comparisons²) (per-pair iterating all comparisons to count peer votes). For 20 submissions × 3 comparisons per pair × C(20,2)=190 pairs = ~570 comparisons → ~325K iterations. Settlement type-script may exceed CKB-VM cycle limits. Spike needed: estimate cycles per iteration, determine max-comparisons-per-task in practice. Mitigation paths: (a) per-pair tally in separate intermediate cells, settlement aggregates; (b) Merkle proof of tally with prover-computed witness; (c) cap on submissions/comparisons via Lawson.
- **Settlement enumeration via cell-dep**: How does the settlement type-script enumerate all revealed cells for a task? Options: (a) walk the chain via cell-deps that the constructor provides + type-script verifies completeness against a TaskSubmissionRegistryCell that was append-only-updated by reveal transactions; (b) require a snapshot cell built at compare_reveal_end as a separate preparation transaction. Decision needed before implementation.
- **AgentRegistry integration**: Should worker / validator commits gate on AgentRegistry membership? The EVM contract has an `agentRegistry` reference but does not enforce gating at commit-time in the public functions reviewed. CKB-side decision: optional in v1, mandatory in v2 once AgentRegistryCell is specced.
- **PoM gating for validators**: Should validators be required to attach a fresh MessagingPoMCell / generic PoM attestation per comparison to raise sybil cost? Aligns with PsiNet × VibeSwap merge intent but adds cycle cost. Will-decision.
- **Reward denomination**: native CKB capacity vs sUDT (JUL / VIBE / CanonicalToken). v1 ships with native CKB; sUDT support is a parameterization, not a redesign.
- **Worker reward proportional vs Shapley**: v1 uses EVM-style proportional (`wins * 2 + ties / total`). Future: opt-in Shapley distribution per `shapley-distributor.md`. The TaskVerdictCell already exposes `participants` + characteristic_values, which is the input shape ShapleyDistributor wants.
- **Tie-break determinism for verdict loser**: Lowest `lock_hash` chosen here. Alternatives: lowest characteristic_value (then lowest lock_hash); creator-specified tie-break rule in VerificationTaskCell. Will-decision.
- **VerdictWitness format**: Binding the tally to consumed reveal-cell outpoints needs a concrete serialization. Candidate: blake2b hash over the canonical ordering of `(comparison_id, choice)` tuples, plus root of a Merkle tree over those tuples for downstream verification (e.g., if SlashRouter wants to spot-check). Spec-level commitment pending implementation spike.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/identity/PairwiseVerifier.sol` + `interfaces/IPairwiseVerifier.sol`
- EVM tests: `vibeswap/test/unit/PairwiseVerifierTest.t.sol`, `test/fuzz/PairwiseVerifierFuzz.t.sol`, `test/invariant/PairwiseVerifierInvariant.t.sol`
- CRPC × MindMesh design: `vibeswap/docs/jarvis-substrate/papers/crpc-mindmesh-design-spec-2026-05-24.md` (CRPC generalization to mesh-wide gossip)
- Existing PsiNet PoM lock-script: `contracts-ckb/proof-of-mind-lock-script/`
- Existing EscrowVault cell type-script: `contracts-ckb/escrow-vault-cell-type-script/`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·pairwise-language-comparison]`, `[P·honesty-as-structural-load-bearing-property]`, `[P·dissolve-attack-surface]`, `[P·substrate-port-pattern]`
- Related specs: `slash-router.md` (primary downstream consumer), `lawson-constants.md` (parameter source), `shapley-distributor.md` (future opt-in distribution), `messaging-hub.md` (BondCell pattern shared via SlashRouter)
