# LawsonConstantsRegistry — CKB Cell Spec

**Spec layer**: `vibeswap/contracts/governance/LawsonConstantsRegistry.sol`
**Port classification**: DIRECT-PORT
**Status**: Spec draft. Simple mechanism, low-risk port.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

Stores governance-tunable protocol constants with constitutional bounds. Each constant has a name, a current value, a min and max bound, and an alpha (Lawson floor coefficient) that affects how downstream mechanisms compute their floors. Examples: Lawson floor coefficient itself, NCI three-pillar weights, circuit-breaker thresholds, fee rates, batch durations, slash percentages.

The structural property is that any constant can be tuned within its constitutional bounds via governance, but no tuning can push a constant past its bounds. The bounds themselves are immutable (set at deployment / cell genesis) and not governance-tunable. This is the Lawson Floor pattern: governance has authority over current values, but constitutional bounds are physics-layer guarantees that survive any governance capture.

## Cell architecture

One ConstantsRegistryCell holds all current values. Update transactions consume the current cell and produce an updated one, with the type-script enforcing bounds and governance authorization.

**ConstantsRegistryCell.** The single source of truth for governance-tunable constants. Holds all constant values and their immutable bounds. Permissionless lock; updates gated by type-script consumption of a ProtocolDecisionCell (from NCI) authorizing the change.

**ConstitutionalBoundsCell.** Immutable companion cell containing the bounds for every constant. Created once at genesis. Cannot be modified after creation. ConstantsRegistryCell references this via cell-dep for bound checks.

**ConstantsHistoryCell** (optional). Append-only log of value changes for audit. Useful for adversarial review and post-hoc challenge mechanisms.

## Per-cell specifications

### ConstitutionalBoundsCell

**Data layout** (cell-data):
- `version: u8`
- `bounds: Vec<ConstantBound>`
  - per bound: `name_hash: [u8; 32]`, `min_value: u128`, `max_value: u128`, `alpha_min: u128`, `alpha_max: u128`
- `genesis_block_height: u64`

**Lock-script**: Provably-unspendable. Set once at genesis, never modified.

**Type-script invariants**:
- Created exactly once at chain genesis (verified via genesis-block witness)
- Never consumed as input in any transaction (always referenced as cell-dep)

### ConstantsRegistryCell

**Data layout** (cell-data):
- `version: u8`
- `constants: Vec<ConstantValue>`
  - per constant: `name_hash: [u8; 32]`, `value: u128`, `alpha: u128`, `last_updated_at_block: u64`
- `bounds_cell_outpoint: OutPoint` (the ConstitutionalBoundsCell)

**Lock-script**: Permissionless. Authorization is in the type-script.

**Type-script invariants** (universal):
- `bounds_cell_outpoint` matches the ConstitutionalBoundsCell read via cell-dep
- For each constant in `constants`, the `name_hash` exists in the bounds cell

**Type-script invariants** (at update):
- A ProtocolDecisionCell with `decision_type == GovernanceConstantUpdate` is consumed in the same transaction
- The decision_payload specifies the constant name_hash, new value, and new alpha
- The new `value` is in `[bounds.min_value, bounds.max_value]`
- The new `alpha` is in `[bounds.alpha_min, bounds.alpha_max]`
- Only the named constant changes; all other constants are preserved exactly
- `last_updated_at_block` for the changed constant is set to the current block height
- All unchanged constants' `last_updated_at_block` are preserved

### ConstantsHistoryCell (optional)

**Data layout** (cell-data):
- `version: u8`
- `entries: Vec<HistoryEntry>` (or MMR root for large history)
  - per entry: `constant_name_hash: [u8; 32]`, `old_value: u128`, `new_value: u128`, `decision_id: [u8; 32]`, `at_block: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- Updated whenever a ConstantsRegistryCell update transaction runs
- New entries are append-only (no rewrites)

## Transaction shapes

**Genesis transaction**: One-time at chain launch.
- Outputs: ConstitutionalBoundsCell (with all bounds set), ConstantsRegistryCell (with initial values), ConstantsHistoryCell (empty)
- Verified via genesis-block witness

**Update transaction**: Permissionless, authorized by NCI ProtocolDecisionCell.
- Inputs: previous ConstantsRegistryCell, ProtocolDecisionCell with GovernanceConstantUpdate payload, previous ConstantsHistoryCell
- Outputs: updated ConstantsRegistryCell, updated ConstantsHistoryCell
- Cell-dep: ConstitutionalBoundsCell
- Type-script verifies bound check, payload consistency, history append correctness

**Read transaction**: No transaction needed. Downstream mechanisms reference ConstantsRegistryCell via cell-dep in their own transactions.

## Property preservation

**Constitutional bounds are physics**: ConstitutionalBoundsCell is set at genesis and never modified. No governance path can change a bound. This is the Lawson Floor pattern: the math layer's authority is constitutional. Governance lives below, within the bounds.

**Governance-tunable within bounds**: ConstantsRegistryCell can be updated via NCI ProtocolDecisionCell authorization. Updates that violate bounds fail the type-script.

**Permissionless update execution**: Anyone can construct the update transaction once an NCI decision has been produced. The type-script catches incorrect updates.

**Auditable history**: ConstantsHistoryCell preserves the changelog for adversarial review.

**Constitutional pipeline scaffolding**: Per `[P·constitutional-pipeline-scaffolding]`, the layered design (physics > constitution > governance) is structurally enforced. Physics is ConstitutionalBoundsCell. Constitution is the bound-enforcement logic in the type-script. Governance is NCI authorization. Each layer enforces the layer above.

## Upstream pulls

**From `ckb-system-scripts`**: Standard locks where needed (probably nowhere; this mechanism is permissionless).

**From `ckb-std`**: Syscalls for cell-dep reads, witness parsing, hashing.

**From `ckb-merkle-mountain-range`**: For ConstantsHistoryCell when history grows large enough to warrant MMR commitment.

## Build new

**ConstitutionalBoundsTypeScript**: Rust crate. Minimal: verifies genesis creation and unspendability.

**ConstantsRegistryTypeScript**: Rust crate. Bound-check, authorization via consumed ProtocolDecisionCell, preservation of unchanged constants.

**ConstantsHistoryTypeScript**: Rust crate. Append-only verification.

## Open questions

- **MMR for history**: Decide when to migrate from explicit list to MMR. Probably at ~1000 entries.

- **Per-constant authorization scope**: Some constants are more sensitive than others (NCI weights vs fee rates). Consider per-constant decision-type thresholds in NCI scoring, so high-sensitivity constants require higher NCI scores to change. Lives in NCIScoreCell, not here, but should be coordinated.

- **Bound revision via emergency hardfork**: If a bound proves wrong (e.g., max_value too low for legitimate use cases), the only way to change it is a hardfork. This is intentional but should be acknowledged: there's no governance backdoor for bounds.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/governance/LawsonConstantsRegistry.sol`
- Foundry tests (existing, 34/34 green): `vibeswap/test/governance/LawsonConstantsRegistry.t.sol`
- Mechanism primitives: `[P·constitutional-pipeline-scaffolding]`, `[P·augmented-governance]`, `[P·structure-does-the-work]`
- Related specs: `nci-consensus.md` (provides ProtocolDecisionCell for updates), `circuit-breaker.md` (pending; circuit-breaker thresholds live here), `vibe-amm.md` (consumes fee_rate, MAX_TWAP_DRIFT_BPS, etc.)
