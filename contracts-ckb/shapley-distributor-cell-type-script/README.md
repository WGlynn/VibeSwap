# shapley-distributor-cell-type-script

CKB type-script enforcing the **Shapley 5-axiom reward distribution** family
on the sovereign VibeSwap-CKB chain. REINTERPRET port of
`vibeswap/contracts/incentives/ShapleyDistributor.sol`.

## What this is

A scaffold of the on-chain authority check for five reward-distribution
cells. One binary, role-multiplexed by `type_script.args[0]`:

- **ContributionEventCell** (role tag `0x01`) — atomized contribution log
  per `[P·atomized-shapley]`. Each value-creating event spawns its own
  independent Shapley game. Immutable post-creation.
- **ShapleyDistributionCell** (role tag `0x02`) — per-event distribution.
  The 5-axiom check fires here.
- **RewardClaimCell** (role tag `0x03`) — one per (participant, event).
  Participant lock-script authorizes the claim; type-script verifies the
  amount matches the distribution row.
- **EmissionScheduleCell** (role tag `0x04`) — halving curve + current era.
  TOKEN_EMISSION track only; FEE_DISTRIBUTION track is time-neutral and
  does not consult it.
- **SybilGuardCell** (role tag `0x05`) — flagged lock-hash set. Sybil
  participants propagate as null-players into ContributionEventCell
  creation.

## What this is NOT

- **Not audit-ready.** Marked `TODO` inline in several load-bearing places:
  1. SybilGuardCell cell-dep discovery is shape-heuristic, not code-hash
     match. Same gap as sibling crates.
  2. Pairwise-proportionality 256-bit arithmetic uses an approximate
     `mul_u256_by_u128_div_10000` that accepts bounded rounding error.
     `ε` floor in bps is intentional but should be tightened with formal
     bound analysis before audit.
  3. Glove-game + custom-tag value-function kinds are NOT enforced for
     pairwise (early-return). Only proportional kind has the pairwise
     check wired. Glove-game enumeration is O(2^N) and is gated behind
     a small-N regime per the spec's open question.
  4. Cross-event Additivity is documented as structurally guaranteed by
     per-event independence; no per-cell check is informative. This
     reflects the spec's framing and is intentional.
  5. `find_event_for_distribution` discriminates by shape (header length
     + version byte + event_id match). Distinct from siblings only by
     event_id binding; code-hash match still pending.
  6. RewardClaim token-conservation is delegated to the canonical-token
     type-script on the participant's output cell; this scaffold checks
     the claim cell shape + amount-bound only.
  7. Hash-of-payload binding for VerifiedCompute is reserved (field
     present in cell-data; no off-chain verifier wired yet).

- **Not the source-mechanism authority.** ContributionEventCell creation
  is authorized by the SOURCE mechanism's lock-script (e.g.,
  BatchSettlementTypeScript-hash for fee events from the
  commit-reveal-auction). This crate enforces shape + sybil + sorting
  invariants on the event cell; it does NOT validate that `total_value`
  matches the source mechanism's commitment — that lives at the source
  cell's type-script.

- **Not the SybilGuard authority.** The SybilGuardCell's role-0x05 branch
  validates shape + sorting only. Add-to-flagged-set + unflag-by-governance
  require attestation evidence checked by `bls-verify` (pending).

## Cell-data layouts (Molecule fixed-struct)

### ContributionEventCell (137-byte header + variable participants)

| field                       | bytes | offset |
|-----------------------------|-------|--------|
| version                     |  1    |   0    |
| event_type                  |  1    |   1    |
| value_function_kind         |  1    |   2    |
| event_id                    | 32    |   3    |
| source_outpoint_tx          | 32    |  35    |
| source_outpoint_index       |  4    |  67    |
| total_value                 | 16    |  71    |
| value_token_type_hash       | 32    |  87    |
| era_at_creation             |  8    | 119    |
| created_at_block            |  8    | 127    |
| participant_count           |  2    | 135    |
| participants[N]             |  49N  | 137    |

Each participant: `lock_hash[32] || characteristic_value[u128 LE] || contribution_type[u8]`.
Participants must be sorted strictly ascending by `lock_hash`.

### ShapleyDistributionCell (67-byte header + variable distributions)

| field              | bytes | offset |
|--------------------|-------|--------|
| version            |  1    |   0    |
| event_id           | 32    |   1    |
| payload_hash       | 32    |  33    |
| distribution_count |  2    |  65    |
| distributions[N]   |  48N  |  67    |

Each distribution: `lock_hash[32] || shapley_share[u128 LE]`. Sorted ascending.

### RewardClaimCell (129 bytes fixed)

| field                  | bytes | offset |
|------------------------|-------|--------|
| version                |  1    |   0    |
| event_id               | 32    |   1    |
| participant_lock_hash  | 32    |  33    |
| amount                 | 16    |  65    |
| value_token_type_hash  | 32    |  81    |
| created_at_block       |  8    | 113    |
| claim_deadline         |  8    | 121    |

### EmissionScheduleCell (59 bytes fixed)

| field                          | bytes | offset |
|--------------------------------|-------|--------|
| version                        |  1    |   0    |
| current_era                    |  8    |   1    |
| era_start_block                |  8    |   9    |
| era_duration_blocks            |  8    |  17    |
| genesis_emission_per_event     | 16    |  25    |
| current_era_remaining_emission | 16    |  41    |
| halving_factor_bps             |  2    |  57    |

### SybilGuardCell (11-byte header + variable flagged set)

| field              | bytes | offset |
|--------------------|-------|--------|
| version            |  1    |   0    |
| last_updated_block |  8    |   1    |
| flagged_count      |  2    |   9    |
| flagged_lock_hashes[K] | 32K | 11    |

Sorted ascending; binary search in `sybil_contains`.

## Type-script args

`args[0]` = role tag (`0x01`..`0x05`). Subsequent bytes are role-specific
(reserved; v1 ignores).

## 5 axioms enforced (per `specs/shapley-distributor.md`)

1. **Efficiency**: `Σ shapley_share == event.total_value`. Anti-MLM
   structurally enforced by this single equality.
2. **Symmetry**: identical `(characteristic_value, contribution_type)`
   pairs across participants ⇒ identical `shapley_share`.
3. **Null-Player**: `characteristic_value == 0 ⇒ shapley_share == 0`.
   Sybil flag propagation enforces this: flagged lock-hashes cannot be
   admitted into ContributionEventCells with positive
   characteristic_value.
4. **Additivity** (`φ(v+w) = φ(v) + φ(w)`): structurally guaranteed by
   per-event independence — no cross-event share accumulation in the
   substrate; each event is its own cell. No per-cell check is
   informative; documented at the spec layer.
5. **Pairwise-Proportionality**: `|φ_i·w_j − φ_j·w_i| ≤ ε(magnitude)`.
   Goodhart defense per `[P·shapley-5-axiom-set]` 5th-axiom. O(N^2) over
   participant pairs; cycle bottleneck at large N.

Plus **Time Neutrality** for FEE_DISTRIBUTION: `era_at_creation == 0` is
required, which structurally guarantees the distribution does not depend
on the era.

## Structurally hardest axiom

**Pairwise-Proportionality.** The other four are O(N) cell-data checks
(sum, sorted-tuple equality, zero-cv→zero-share, per-event scope). Pairwise
is O(N^2), needs 256-bit cross-multiplication to avoid the divide, and
requires a tolerance `ε` whose calibration is the live audit question.
Glove-game and custom-tag kinds need kind-specific pairwise relations not
yet wired. This is where the cycle budget will bite first as N grows.

## Composition

- **SybilGuardCell** (cell-dep, mandatory at event creation): null-player
  propagation source.
- **EmissionScheduleCell** (cell-dep, TOKEN_EMISSION track only): era +
  per-event emission budget; consulted by ContributionEventCell creation.
- **LawsonConstantsRegistry** (cell-dep, mandatory at v2): `ε` for
  pairwise tolerance; currently hardcoded 1 bps in `PAIRWISE_EPSILON_BPS`.
- **VerifiedCompute** (off-chain compute + on-chain payload hash): the
  Shapley math itself runs off-chain; the type-script verifies the 5
  axioms over the proposed payload. Disputes via bonded challenge window
  per the VerifiedCompute primitive.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Cell-dep
discrimination uses shape heuristics. Pairwise tolerance arithmetic uses
an approximate `mul_u256_by_u128_div_10000`. Glove-game pairwise check
not wired. Capsule not run on this dev box (same toolchain blockers as
sibling crates).

Source-reviewable; aspirational invariants live in the README and the
spec, not in production. Iteration ¬ rewrite.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-36: cell-shape invariants
- 40-46: ContributionEventCell invariants
- 50-57: ShapleyDistributionCell — 5 axioms
- 60-64: EmissionScheduleCell invariants
- 70-74: RewardClaimCell invariants
- 80-82: SybilGuardCell invariants
- 90-93: composition / cell-dep / arithmetic

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p shapley-distributor-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/src/shapley_distributor_cell_type_tests.rs`
once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/shapley-distributor.md`
- EVM source: `vibeswap/contracts/incentives/ShapleyDistributor.sol`
- Siblings (composed with):
  - `lawson-constants-cell-type-script/` (`ε` source, v2)
  - `vibeswap-canonical-token-type-script/` (reward token conservation)
- Mechanism primitives:
  - `[P·shapley-5-axiom-set]` — Efficiency ∧ Symmetry ∧ Null-Player ∧
    Additivity ∧ Pairwise-Proportionality
  - `[P·atomized-shapley]` — atomized contribution events
  - `[P·composable-fairness-arrow-inversion]` — composition uniqueness
  - `[P·fairness-fixed-point-iterated-shapley]` — iterated fairness
  - `[P·structure-does-the-work]` — axioms as type-script returns
  - `[P·honesty-as-structural-load-bearing-property]` — Σ φ = v(N)
    structurally rejects MLM
