# HANDOFF — MindCoin ($MIND) / PoM-on-ETH ("The DAO 2" / Ethereum Cogcoin)

_Last updated: 2026-07-03 (Opus, ultracode session). NOT committed — everything on-disk, held for Will (two repos: vibeswap + noesis)._

## What this is
The EVM consumer of Noesis's off-chain PoM reduction: an optimistic export layer that
lets Ethereum consume proof-of-mind scores WITHOUT a signer quorum, and pays a fair-launch
meta-block subsidy (MindCoin, $MIND) to whoever produced the proven novelty. "Ethereum
Cogcoin": Economitra generalized from CogCoin's sentences (proof-of-language) to any
contribution (proof-of-mind). Inspired by Tom Lindeman (Pragma) + Will's CogCoin/Economitra thesis.

## Current state — BUILT + GREEN (held, not committed)
- **Solidity:** `contracts/pom/` — PoMOperatorRegistry, PoMReward, PoMExportHub (+ interfaces).
  14/14 tests in `test/pom/PoMExportHub.t.sol`. Run: `FOUNDRY_PROFILE=pom ~/.foundry/bin/forge test --match-path 'test/pom/PoMExportHub.t.sol'`.
  (Scoped `pom` profile in foundry.toml dodges a PRE-EXISTING broken import in
  `contracts/identity/AgentRegistry.sol` -> missing `contracts/psinet/...` — NOT ours; the
  whole repo tree won't compile until someone fixes that. Flag for Will.)
- **Rust:** `~/noesis/node/src/pom_export.rs` — per-contributor keccak Merkle `scores_root`
  (OZ double-hash leaf + commutative pairs), `tiny-keccak` dep added. 270/270 node tests
  (`cargo test --lib`), 8/8 pom_export. Cross-language Merkle root pinned + conformed:
  `daf99dca546152568a24c92ce244b1cdc50a8d893b491485e740811609d38bc0`.
- **Hardened** per adversarial review (workflow wkp84x0vz): resolver CANNOT finalize a
  challenged standing (it only slashes; a challenged standing is always discarded);
  `expireChallenge` gives liveness without the resolver; `MIN_CHALLENGE_WINDOW` floor; CEI.
- **Fair-launch DONE:** PoMReward has zero premine + `setMinter` is now ONE-SHOT (minter
  locked after first set) — closes the top gate finding. ERC20 name/symbol = "MindCoin"/"MIND".
- Docs: `contracts/pom/SECURITY-NOTES.md`; `~/noesis/internal/VERIFIABLE-REDUCTION-AND-EXPORT-LAYER.md`
  (design note, BUILT stamp at bottom); `~/noesis/docs/MINDCOIN-FOUNDING.md` + `~/Desktop/MindCoin-Founding.pdf` (founding doc).

## Key decisions (and why)
- **Optimistic re-derivation, NOT multisig** (Will: "just not multisigerino"). No signer quorum.
- **A now, C later:** v1 resolver = governance adjudicator; v2 = ZK/RISC-V one-step proof in the
  same swappable slot. Safety-freeze never trusts the resolver.
- **Delta-priced subsidy:** each meta-block pays for NEW information, not lifetime cumulative
  score (scoresRoot is lifetime -> pro-rata would pay perpetual rent, violating the value-router soul).
- **Bitcoin-form schedule** (can't mirror ETH's dynamic issuance): inherit ETH SECURITY, mirror BITCOIN's schedule.
- **Honesty is the moat:** the founding doc leads with the v1 limit (see below), not the hype.

## Subsidy design — DESIGNED + GATED, NOT YET CODED (workflow w0qpj9yx7, 9 fable agents, 4 gate lenses; all "concern")
Implementation spec (condensed; full contractChanges in the workflow output + founding doc):
- **PoMReward:** add `MAX_SUPPLY = 1_312_500e18` + cap-check in mint(). (Minter-lock already done.)
- **IPoMExportHub.PomStanding:** add `bytes32 payoutRoot` + `uint64 thetaEntQ16`. Add
  `claimContributorReward(contributorId, payTo, cumulativePayout, proof)`, events MetaBlockSubsidy/
  ContributorRewardClaimed, errors NoNewInformation/InvalidClaimProof/NothingToClaim.
- **PoMExportHub:** constants INITIAL_SUBSIDY=3.125e18, HALVING_INTERVAL=210_000, CONTRIBUTOR_SHARE_BPS=9100
  (constant); pure `metaBlockSubsidy(nonce)= INITIAL >> (nonce/HALVING_INTERVAL)` (epoch>=64 ->0);
  storage proposerCutBps/trancheBps(600/300), emissionCommitted/contributorBudget/contributorMinted/
  securityBudget, `payoutRoots` + `claimed` mappings; propose() add `if(standing.total<=current.total) revert NoNewInformation`;
  _finalize: replace fixed proposerReward with subsidy split (proposer 6% mint, contributor 91% to budget,
  security 3% to budget, store payoutRoot); resolveDispute: challenger paid min(challengerReward, securityBudget) budget-draw;
  DELETE setRewards, ADD setChallengerReward + setSplit(within 9%); add claimContributorReward (watermark by soulbound contributorId, payTo in-leaf).
- **pom_export.rs:** SHIP-BLOCKER fix — route export through the entropy floor. ***USE
  `semantic_floor_q16` direct composition at RAW integer scale, NOT `production_value_q16`
  (which multiplies by ONE=2^16 -> 65536x scale shift; gate caught this).*** Add `payout_root`
  (delta-priced cumulative payout tree, leaf = keccak256(keccak256(abi.encode(bytes32 contributor,
  address payTo, uint256 value))), value as u128); extend verify() to cover payout_root; pin a NEW
  cross-language payout-tree conformance vector in both Rust + Solidity.

## MUST-FIX gate items to fold in (before the subsidy is real)
1. Scale bug: semantic_floor not production_value_q16 (above). 
2. Checkpoint anchor on PomStanding (Noesis height+tip-hash) + canonical-prefix rule -> anti selective-inclusion theft (proposer omitting rivals' cells).
3. Pin thetaSimQ16/thetaEntQ16 as on-chain consensus constants; require standing thetas == canonical (else self-declared theta_ent=1.0 floors nothing, "false" undefined).
4. Challenger-incentive-at-genesis: securityBudget=0 at start -> first challenger earns 0. Route a slash slice to challenger, or seed genesis tranche.
5. `MAX_RESOLUTION_WINDOW` bound (owner could set huge resolutionWindow -> permanent emission-halt grief).
6. Delete the payoutRoots[nonce] stale-proof claim overload (re-opens rotated-payTo attack). Claim vs current.payoutRoot only.
7. Delta clamp: delta_i = max(0, cum(k)-cum(k-1)); define total-decrease rule (theta change) so NoNewInformation guard can't deadlock.
8. Registry: snapshot bondFloor per-operator at registration (setBondFloor raise can de-activate challengers mid-window, breaking the 1-of-N freeze).
9. Test migration: struct + initialize changes break all 14 tests; rewrite reward-amount assertions to the schedule; update Rust sample-cell expectations for entropy-floored values.

## Open founding decisions — WILL'S CALLS (block the subsidy build)
1. Halving interval: 210k (clean Bitcoin cap, ~24yr epoch-0 @ hourly) vs cadence-fit ~35k (~4yr, loses clean cap). Cannot re-tune later.
2. Quiet-chain MIN_DELTA floor: ship without (recommended, Bitcoin early-cheap shape) vs add.
3. Ossify now (burn/timelock hub upgrade -> "immutable 91%" true) vs keep-upgradable + honest caveat.
4. Identity bridge: payout-address registration cell format (authenticated by soulbound key; default accrue-unclaimable-until-registered).
5. Name timing: lead "Ethereum Cogcoin" now (with v1 caveats) vs after blob-DA earns it. (Ticker $MIND already exists as an ERC-20 on ETH -> public symbol = launch-day call.)

## THE honest v1 limit (load-bearing, in the founding doc Section 5)
v1 pays for novelty VOLUME through an entropy floor, NOT quality. The challenge game verifies
faithful COMPUTATION, not value QUALITY. CogCoin's anti-junk defense is its 256-scorer ensemble;
ours (learned quality gate / v8) is OPEN (NULL on real labels). So low-entropy word-salad passes
the entropy floor and captures the pool, unchallengeably, until the quality gate ships. Honest v1
= "fair-launch novelty subsidy with an entropy floor," NOT "ungameable like CogCoin." Fixed
schedule bounds it to redistribution, never inflation (honest contributors are the counterparty).

## SUBSIDY BUILT + GREEN — 2026-07-03 (this session)
The meta-block subsidy is CODED and passing: 23/23 Solidity + 271/271 Rust node at the time of this
section (SUPERSEDED by the v1.1 CLOSED section below: **29/29 Solidity + 275/275 node**). Founding decisions used the recommended DEFAULTS (halving 210k, no MIN_DELTA, keep-upgradable+caveat, accrue-unclaimable-until-registered) — Will can still override.
- **Rust ship-blocker FIXED:** export routes through the entropy floor at RAW scale (`floored_values` = `semantic_floor_q16 ∘ temporal_novelty_with_similarity_floor_q16`, NOT `production_value_q16` — avoided the 2^16 scale bug). `theta_ent_q16` threaded + bound in commit. Noise-zeroing test proves it.
- **Solidity subsidy:** `metaBlockSubsidy(nonce)` (3.125 MIND, halving 210k, epoch>=64 guard) + `MAX_SUPPLY = 1,312,500` cap in the non-upgradeable token; 91/6/3 split at `_finalize` (contributor pool + proposer 6% mint + 3% security tranche); `CONTRIBUTOR_SHARE_BPS = 9100` constant (setSplit can only move the 9%); delta-guard `total > current.total`; theta-pinning; budget-draw challenger; `MAX_RESOLUTION_WINDOW`; minter one-shot lock. **Contributor claim** = per-block delta payout (leaf = `keccak256(keccak256(abi.encode(contributor, payTo, amount)))`), once per (nonce, contributor), solvent-by-construction.
- **Gate fixes FOLDED:** minter-lock, scale-bug, cap, theta-pin, delta-guard, res-window-bound, budget-draw, setSplit-91-lock, CEI, per-block-delta (avoids lifetime-rent).

## v1.1 CLOSED + REVIEWED — 2026-07-03 (Opus ultracode session)
All three remaining items shipped, adversarially re-reviewed, green. **Solidity 29/29** (was 23),
**Rust pom_export 13/13** (was 8), **full node suite 275/275** (was 271). NOT committed — on-disk,
held for Will (two repos: vibeswap + noesis).

1. **Rust payout-ROOT generation — DONE.** `pom_export::payout_entries / payout_root / payout_proof /
   verify_payout` + `meta_block_subsidy_wei / meta_block_pool_wei` (mirror `_finalize`'s remainder-
   routed pool EXACTLY). 3-field keccak leaf `(contributor, payTo, amount)`; delta-priced, FLOOR-
   division → sum ≤ blockPool (solvent by construction). Pinned cross-language payout vector
   `c6abf3071c75118de31c207fec9f98a7198f97403165a0b45dd20b99b315536e` (Rust + Solidity); end-to-end
   Solidity claim consumes a Rust-produced root. Last cross-language tie CLOSED.
2. **Selective-inclusion anchor — DONE.** `PomStanding.noesisHeight` strict-advance + non-zero tip
   (`inputCommitment`) guards in `propose` (`PrefixNotAdvancing` / `TipHashMissing`). Honest framing:
   on-chain is a DETECTION ENABLER (forces a fresh tip per block); omission is caught off-chain by a
   challenger re-hashing the canonical prefix (1-of-N-honest). Not on-chain prevention (documented).
3. **Genesis challenger bounty — DONE.** `registry.slashToBeneficiary` routes a bond slice (default
   50%) of the loser's slashed bond to the winning challenger — pays at genesis, no off-schedule mint.
   Slice rate snapshotted at `challenge()` (`challengerSlashSliceBpsAtChallenge`) so governance can't
   retroactively alter a committed challenger's bounty.

### Adversarial re-review (workflow `wqytz7u4t`, 6 lenses, per-finding refutation)
6 confirmed (all medium/low), 3 dismissed (by-design). NO critical/high — mechanism sound. All folded:
- CODE: snapshot challengerSlashSliceBps at challenge (item-3 retro-change fix) + test.
- DOCS/honesty: payout_leaf_hash u128-not-uint256 comment; selective-inclusion on-chain "detection-
  enabler not prevention" reword; registrations trust-boundary natspec + SECURITY-NOTES; clamped-pool
  proposer-clamp note. Dismissed (correctly): missing-inputCommitment-test, unregistered-dilution
  (intended), saturating_sub-masking (theta pinned in v1).

## Reputation-consumer surface — SHIPPED 2026-07-03 (PoM-is-the-product)
Will reframed: **Proof of Mind is the product** (a portable cryptoeconomic primitive), Noesis is its
reference chain ([[project_proof-of-mind-is-the-product]]). This ships the primitive's 2nd value prop
(exportable on-chain reputation) as a clean consumer surface:
- **`IProofOfMindReputation` + `PoMReputationOracle`** (`contracts/pom/`, 6/6 tests): any protocol
  imports the interface and reads a contributor's earned, math-derived standing to gate/weight by
  MIND not money (governance weight, allowlists, sybil-resistant airdrops, under-collateralized
  credit). `recordReputation` verifies a Merkle proof against the hub's live `scoresRoot` and caches
  it; `reputationOf` / `hasReputationAtLeast` are cheap reads; `verifyLive` is an as-of-now check.
- **Trust:** immutable hub (no admin/upgrade surface); reputation is a VERIFIED LOWER BOUND as of the
  recorded nonce (cumulative PoM value is monotone across standings) ⇒ gating is fail-safe (never
  over-grants). Keyed by soulbound contributor id; address↔id binding is the consumer's identity
  bridge (same open item as the payout registration, honestly out of scope).

## Reserved for v2 (the one real gap the review surfaced)
- **On-chain registrations commitment.** payoutRoot does not commit the registrations map, so `payTo`
  correctness is an off-chain challenger check in v1 (fine, resolver-adjudicated). Before the
  DA-blob / RISC-V permissionless resolver ships, add `bytes32 registrationsRoot` to `PomStanding` +
  verify in propose/challenge, else "permissionless" is bypassable by registrations substitution.

## Next session
Commit (both repos) on Will's word — nothing left open in v1.1. Then v2: registrations commitment +
DA-blob/RISC-V resolver. Loose ends (unchanged): anthropic-github-campaign Lane B critical-qa issue
DRAFTED + held for Will go (`Desktop/anthropic-github-skills-critical-qa-issue-draft-2026-07-03.md`);
pre-existing AgentRegistry/psinet repo-compile break (flag to Will — not ours).
