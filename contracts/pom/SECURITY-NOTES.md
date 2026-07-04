# PoM-on-ETH ("The DAO 2") — v1 security notes

Trust model + adversarial-review triage for the optimistic PoM export layer under
`contracts/pom/`. Companion to the design note
`~/noesis/internal/VERIFIABLE-REDUCTION-AND-EXPORT-LAYER.md`. Status discipline: what
holds, what is a deliberate v1 boundary, what was dismissed and why.

## What the layer is

PoM value is computed off-chain by the deterministic `pom_export` reduction (too expensive
for the EVM). This layer lets a host chain consume that output **without a signer quorum**,
via an optimistic re-derivation game:

- `propose` — a bonded operator posts the next standing (monotonic nonce, one in flight)
- `challenge` — any bonded operator freezes it within the window
- `finalize` — after the window with no challenge, the standing goes live
- `resolveDispute` / `expireChallenge` — settle or time-out a challenge

A finalized standing is a "meta-block." Consumers read `currentStanding()` and verify a
contributor's score against `scoresRoot` with a Merkle proof.

## Security properties that hold

- **No quorum on the happy path.** A single bonded proposer posts; finalize is permissionless.
- **1-of-N-honest safety.** A single honest challenger freezes a bad standing so it can never
  be consumed. This does **not** depend on the resolver: a challenged proposal is always
  discarded, and the resolver decides only who is slashed, never which standing goes live.
- **Liveness without the resolver.** After `resolutionWindow`, anyone can `expireChallenge`
  and reopen the slot, so an absent/censoring resolver cannot freeze the queue.
- **Fair-launch reward.** `PoMReward` has no premine; it is minted only by the hub, only on
  finalization.
- **Merkle binding.** A leaf binds `(contributor, cumulativeValue)` together
  (`keccak256(keccak256(abi.encode(contributor, value)))`, OZ convention), so a proof cannot
  be reused for a different contributor even at equal value. Byte-for-byte matched by
  `pom_export.rs` (pinned conformance vector).

## Fixed from the adversarial review (2026-07-03, workflow `wkp84x0vz`)

1. **Resolver could push a false standing live** — `resolveDispute(id, true)` used to finalize.
   Now a challenged proposal is always discarded; the resolver only slashes. Safety no longer
   depends on resolver honesty.
2. **Absent resolver could freeze a slot forever** — added `expireChallenge` after
   `resolutionWindow` (permissionless, no slashing).
3. **Owner could set `challengeWindow = 0`** — added `MIN_CHALLENGE_WINDOW` floor.
4. **CEI hygiene** — dispute resolution commits state before external slash/mint calls.

## v1.1 hardening (2026-07-03, workflow `wqytz7u4t`)

Three remaining v1.1 items were closed and adversarially re-reviewed (6-lens, per-finding
refutation). No critical/high findings; the confirmed set was one code hardening + five
documentation/trust-boundary clarifications, all folded.

1. **Delta-priced payout root, cross-language.** `pom_export::payout_entries/payout_root` now
   produces the `PomStanding.payoutRoot` the hub's `claimContributorReward` consumes. Pool is
   split pro-rata by each contributor's per-block DELTA (new information only, no lifetime rent),
   FLOOR-divided so the leaves always sum to `<= blockPool` (solvent by construction; floor dust is
   never minted). Pinned cross-language conformance vector on both sides
   (`c6abf30…5536e`); an end-to-end Solidity claim consumes a Rust-produced root.
2. **Anti selective-inclusion (canonical-prefix).** `PomStanding.noesisHeight` must strictly
   advance and `inputCommitment` (the canonical-prefix tip) must be non-zero. This is an on-chain
   DETECTION ENABLER, not prevention: it forces a fresh tip each meta-block; a proposer who omits a
   canonical contributor posts a tip a challenger (holding the prefix) refutes and freezes.
3. **Genesis challenger bounty.** `registry.slashToBeneficiary` routes a bps slice of a losing
   proposer's slashed BOND to the winning challenger, so the challenger is compensated even when the
   MIND security budget is empty at genesis (no off-schedule mint). The slice rate is snapshotted at
   `challenge()` time (`challengerSlashSliceBpsAtChallenge`) so governance cannot retroactively alter
   a committed challenger's bounty.

## Accepted v1 boundaries (deliberate, with the v2 path)

- **Registrations are an off-chain trust input.** The `payoutRoot` commits `(contributor, payTo,
  amount)` but NOT the contributor→address registrations map used to derive `payTo`, so the contract
  does not prove `payTo` is a contributor's true registered address. A dishonest proposer could route
  a share to an attacker `payTo` and post a self-consistent root. This is caught off-chain: a bonded
  challenger re-runs `pom_export::payout_entries` with the canonical registrations
  (`PoMOperatorRegistry.payoutOf`) and challenges any mismatch (1-of-N-honest). **v2's permissionless
  path MUST add an on-chain registrations commitment** — a reserved `registrationsRoot` on
  `PomStanding`, checked in `propose`/challenge re-derivation. Without it, v2's "permissionless"
  claim would be bypassable by registrations substitution (this is the one item to close before the
  DA-blob / RISC-V resolver ships).
- **Payout pool must be proposer-clamped near the cap.** `pom_export::meta_block_pool_wei` is
  unclamped; on-chain `_finalize` clamps the subsidy to `MAX_SUPPLY - emissionCommitted`. A proposer
  building a payout root within the final wei of the 1,312,500 cap (≈epoch 62, far beyond v1) must
  clamp to on-chain headroom, else honest claims revert `ClaimExceedsPool` (fail-safe, never
  insolvent). Documented on both sides; no on-chain guard added (impractical to reach in v1).

- **Resolver is trusted for SLASHING only** (not for safety). v1 = a governance adjudicator
  that re-runs `pom_export` (permissionless to verify). v2 = a ZK / RISC-V one-step proof in
  the same swappable `resolver` slot → fully trustless slashing.
- **Owner (UUPS admin) is trusted.** It can upgrade and change the resolver/params. v2 =
  timelock + governance. Inherent to the upgradeable-proxy model.
- **Free-challenge griefing.** Challenging costs only the challenger's existing bond exposure;
  a griefer can force re-proposals. Bounded by: challengers must be bonded (Sybil cost +
  activation delay) and a present resolver slashes frivolous challenges. v1.1 = an upfront
  challenge bond.
- **Post-slash re-registration.** A slashed operator can register a fresh address while old
  bond unbonds. Inherent to address-keyed bonded sets; the activation delay mitigates.
- **Off-chain trust root.** On the ETH MVP the canonical cells and correct computation live
  off-chain, so *resolution* is informed off-chain. The safety-freeze is trustless; final
  resolution is not, until the ZK/RISC-V slot (or the sovereign chain, where cells are chain
  state) closes it.
- **`reward.mint` on the finalize path.** In principle a reverting mint could block finalize;
  `PoMReward` is non-pausable with a fixed minter, so this is not exploitable in practice.

## Dismissed findings (with reasoning)

- **"Critical: double-finalize via resolveDispute"** — the status FSM already blocks re-entry
  into a resolved/finalized proposal; the reviewer's own note conceded the risk is "low."
- **"Merkle leaves swappable at equal value"** — false: the leaf hashes `(contributor, value)`
  together, so distinct contributors have distinct leaves even at equal value.
- **"finalize is unincentivized"** — the proposer self-finalizes to claim their reward, so the
  action is motivated without a separate finalizer bounty.

## Test coverage

`test/pom/PoMExportHub.t.sol` (29/29, run under `FOUNDRY_PROFILE=pom`): happy path + consume,
challenge-freeze, both dispute outcomes, expire-without-resolver, window floor, replay/nonce,
unbonded/only-resolver guards, the cross-language scores + payout Merkle conformance vectors,
delta-priced claim + replay/bad-proof/unknown-nonce, meta-block schedule, delta-guard, theta-pin,
prefix-advance + tip-missing guards, the genesis bond-slice (registry primitive + bounds +
challenge-time lock), and the split-can't-touch-91% guard.
`pom_export` Rust tests (13/13) pin the same vectors + the payout-tree / schedule / delta-pricing /
verify-payout / entropy-floor properties. Full node suite 275/275.
