# OPERATIONS.md — vibeswap-ckb Validator Bootstrap and Economic Security Plan

**Spec layer**: the gate that turns *"we have a chain-spec"* into *"we have a chain."*
**Parent**: `FORK_VS_MAINNET_ANSWER.md` §7 (the meta-gate Position F opens).
**Sibling**: `NCI_CONSENSUS_ANSWER.md` §4 ("NCI does not provide chain-level finality") — chain-level liveness is what this document plans for.
**Status**: EXECUTED. Defaults picked. Validator counts named. Hardware sized. Phase boundaries committed.
**Author**: JARVIS, 2026-06-08, per Will C4 EXECUTE.
**Disposition**: spec-stage HIGH per `[F·spec-vs-deployed-severity-calibration]`. Choices below structurally lock who runs the chain and how it ceases to depend on Will. No deferred Will-decide markers in this document; defaults are committed and a later override is itself a hardfork-class governance event.

---

## 1. The Day 0 problem

Position F's structural payoff is sovereignty; its structural cost surfaces in one sentence: **on Day 0 the chain has no validator set, no economic security, no community, and no presumption of trust from anyone other than Will**. Block production runs because Will runs `ckb miner`. Nothing else. Until validators exist, vibeswap-ckb is a private testnet at best — a permissionless devnet pretending to be a chain by virtue of the fact that exactly one person can produce blocks at will, and exactly that person has not yet decided to stop.

Honest scope: in this phase the security guarantees are exactly Will's operational discipline. The cell-graph fires because Will runs an honest node; the NCI boundary invariants from `specs/nci-boundary-enforcement.md` hold because Will doesn't censor his own deposit transactions. Both properties cease to bind when Will-the-only-operator goes offline, sleeps, or makes a mistake. **A private testnet is what we have; the document below is how we leave it.**

The plan is to leave it in four phases over twelve months. Each phase eliminates one founder-dependency class from `[P·cincinnatus-walkaway-test]`. At Phase 3 completion, the chain operates without Will. The walkaway is not a dramatic exit but a passed test.

---

## 2. Phase 0 — Will-Will-Will operations (immediate post-fork, Days 0–7)

**Validator count: 3.**

Three is the minimum that survives losing one node without halting block production. Below three, single-node failure halts the chain. Above three, the bootstrap operational burden grows faster than the resilience it buys at this stage.

**Who runs the three nodes:**

- **Node 1**: Will's home workstation (`C:/Users/Will/vibeswap/ckb-fork`). The Ryzen 5 1600 / 16 GB box is sufficient for `Dummy` PoW devnet block production. This node is the development node and the source-of-truth for chain-spec edits.
- **Node 2**: Hetzner Cloud CCX13 (or equivalent — AX41-NVMe dedicated if budget allows; CCX13 cloud instance at ~€13/mo otherwise). Frankfurt or Helsinki region. Provisioned by Will, running the same `ckb` binary built from `ckb-fork` at the locked `v0.206.0`-augmented tag.
- **Node 3**: a JARVIS-spawned agent on a second cloud VM (GCP e2-small or AWS t3.small, ~$15/mo). Runs the same `ckb` binary. Separate provider from Node 2 to dissolve single-cloud-failure. Operator-of-record is JARVIS; key custody is Will (the JARVIS agent has read-only access to validator-key derivation; Will signs the bond posting).

**Validator set size and quorum**: 3-of-3 honest validators required for vibeswap-app boundary transactions to confirm with full NCI authorization in their first epoch. 2-of-3 honest validators required for block production liveness (NC-Max underneath needs only difficulty-bound block production, which a single node satisfies in `Dummy` mode and Eaglesong handles statistically).

**Economic security source**: off-chain commitment by Will. There is no on-chain bond in Phase 0 because there is no JUL or VIBE yet (per chain-spec, neither is minted at genesis; both are deployed post-genesis as sUDT). The CKB-native asset is the only token in existence Day 0, and Will controls the deployer faucet (8.4B CKB per `vibeswap-ckb-dev.toml` issued-cell #1). The "stake at risk" is operational reputation, not slashable on-chain bond.

**Acknowledged failure mode**: Will's machine dies, the cloud VMs lose power, Will is asleep when something breaks. The chain halts. This is acceptable on Day 0–7 because the chain has no users beyond Will and one or two test transactions; the cost of a halt is restart latency, not state loss (RocksDB recovers cleanly). It is **not acceptable on Day 30**, which is what Phase 1 addresses.

**Single hardest operational dependency at this phase**: Will's home internet connection. If the home node goes offline and either cloud node has a fault simultaneously, the chain halts. Mitigation: the home node is the lowest-priority validator for confirmation; if it fails, the two cloud nodes carry block production. Will receives a phone alert (per `[F·phone-ping-via-calendar]`) when home-node tip lags cloud-node tip by more than 5 blocks.

---

## 3. Phase 1 — Will plus early collaborators (Weeks 1–4)

**Validator count: 5.**

Five is large enough to tolerate two faulty or offline operators without halting, and small enough to vet every operator directly during bootstrap — a deliberately conservative Phase-1 set that widens as the validator program matures (later phases below). The two new validators are recruited from collaborators who have demonstrated technical engagement with the architecture (read a spec doc, raised a substantive issue, contributed a PR) AND can operate a node on their own hardware or cloud account. The candidate pool spans the existing contributor graph plus an open call. No collaborator is pre-committed as of this writing; the doc commits the slot-count, not the names. The Phase-1 set is **not open**, it is **invited**.

**First sUDT-real-economics test**: deploy the JUL sUDT issuer (per `chain-spec/README.md` "Genesis cell instantiation procedure" step 3) consuming the JUL Deployment Reservation cell. Mint a Phase-1 test allocation of JUL — `1_000_000 JUL` total — distributed as `200_000 JUL` per validator. This is the first real on-chain economic event after the constitutional bootstrap; Lawson bounds (`specs/lawson-constants.md`) are now governing real value at the boundary.

**Public testnet announcement**: a single Odysseus thread (one of the 365) titled along the lines of *"VibeSwap-CKB testnet — bootstrapping, not yet trustless"*. The honest framing is the announcement's load-bearing property. Per `[P·complete-as-ready-for-critique]`, the testnet is presented as ready for critique, not ready for adoption. Anyone reading the post understands they can probe it, find bugs, file issues, and that the chain currently depends on Will not being asleep.

**Validator economic posture**: each Phase-1 validator posts a small bond — `50_000 JUL` from their allocation — into a `BondCell` matching the `messaging-validator` role per `messaging-hub.md`. The bond is small because the chain has small value flowing across it; the load-bearing property is that the bonding mechanism is live, not that the bond is large. Slashing-splits are operational: `SLASHING_LOSING_SHARE_BPS = 5000` from the Lawson default, half the slashed amount routed to the insurance pool, half to the honest validator who attested the verdict.

**End-of-phase gate**: 7 consecutive days of 5-of-5 uptime, at least one slash event simulated end-to-end (a deliberately constructed bad verdict, processed cleanly), at least one NCI-authorized vibeswap-app boundary transaction per day for the final 3 days. If these pass, Phase 1 is complete and Phase 2 opens.

**Single hardest operational dependency at this phase**: trust-based validator selection. The cabal-vs-honest assumption is "Will personally vouches for each operator." If a Phase-1 validator turns adversarial before Phase 2 opens the set permissionlessly, the chain has no on-chain enforcement to remove them — only a discretionary Phase-1 multisig of the remaining 4 validators. This is the explicit cost of bootstrap; Phase 2 dissolves it by making validator entry permissionless via on-chain BondCell deposit.

---

## 4. Phase 2 — Open validator set (Months 1–3)

**Validator count target: 15–25 by Month 3.**

The set becomes permissionless. Any operator posting a `BondCell` of `>= MIN_VALIDATOR_BOND` JUL becomes a validator after a `BOND_MATURATION_EPOCHS` waiting period (initial defaults: `MIN_VALIDATOR_BOND = 100_000 JUL`, `BOND_MATURATION_EPOCHS = 6` epochs ≈ 8 hours on a 80-second epoch chain).

The `MIN_VALIDATOR_BOND` is Lawson-governed within constitutional bounds `[50_000 JUL, 500_000 JUL]` per `lawson-constants.md`. Will (and Phase-1 validators) cannot block a new entrant who posts a valid bond; the on-chain rule is the only filter.

**Economic-security cap — when does Will's own deposit cease to be majority?**

The transition condition is: `sum(non-Will validator bonds) > sum(Will-controlled validator bonds)`. The post-Phase-1 starting point is Will + 4 collaborators each at `50_000 JUL`, so Will controls 1/5 of bonded validator weight from Phase 1's end. Through Phase 2, as new validators join, Will's share monotonically decreases. The target is **Will's controlled-validator weight < 33% by Month 3 end**, which is the threshold where Will cannot unilaterally veto NCI-authorized protocol decisions (NCI requires PoS pillar 30% + PoM pillar 60% + PoW pillar 10%; 33% PoS-share controlled by Will is the floor below which the math stops being Will-deferential).

**Slashing live; first slash event handling**:

Slashing is structurally live from Phase 1, but in Phase 2 it processes its first real adversarial event. The expected first slash is a `PairwiseVerifier` losing-share dispatch (per `slash-router.md`) — a validator's bond is partially slashed because their attestation lost a pairwise comparison. The handling sequence:

1. `TaskVerdictCell` is produced by the verifier.
2. NCI-authorized `ProtocolDecisionCell{decision_type=SlashDispatch}` is constructed.
3. `SlashEventCell` consumes the loser's `BondCell`, routes `losing_share_bps × bond.amount` to the insurance pool.
4. Will's role: observer only. The NCI math + verdict + boundary type-script handle the entire flow. Will does not sign, does not approve, does not intervene. If the flow halts because of a bug, Will fixes the bug; if it halts because of a missing primitive, Will surfaces that as a `lawson-constants` open question.

**End-of-phase gate**: validator set ≥ 15, Will's controlled-share < 33%, at least one slash event processed end-to-end without Will-intervention, at least one validator joined and one validator exited permissionlessly via on-chain bond mechanics. This gate, passed, is the structural transition from "Will-secured chain" to "math-secured chain."

**Single hardest operational dependency at this phase**: JUL liquidity for `MIN_VALIDATOR_BOND`. If JUL is not yet trading anywhere with depth, new validators cannot acquire bonds and the open-set transition stalls. Mitigation: a JUL distribution event (airdrop or sale, separate Will-decision tracked under `[J·jul-issuance-schedule]`) must complete before Month 2 of Phase 2. This is the one operational dependency in this phase that crosses outside chain-runtime into market-shaped behavior, and it carries the most uncertainty.

---

## 5. Phase 3 — Cincinnatus walkaway target (Months 3–12)

This phase is the formal `[P·cincinnatus-walkaway-test]` 30-day window, scheduled to begin no earlier than Month 6 and complete no later than Month 12. The 6-month window between Phase 2 completion and the start of the test is operational hardening — observation of validator-set churn, slashing-pool dynamics, NCI score stability, Lawson-constant tuning under real load.

**Per `[P·cincinnatus-walkaway-test]`, the 7 preconditions checked before the test starts:**

1. **Primitives ARE the constitution** — `ConstitutionalBoundsCell` deployed and immutable since Phase 0; `[P·augmented-governance]` end-to-end (Physics > Constitution > Governance) operational.
2. **JARVIS autonomous commits** — the JARVIS instance on Node 3 is shipping chain-spec patches, rebase merges from upstream Nervos, and `lawson-constants` proposed updates without Will-loop. Verified through a 30-day pre-test observation window.
3. **ContributionDAG self-runs** — `ShapleyDistributor` cell-graph is processing attribution from PoM operators + PoS validators without manual computation.
4. **Shards handle all conversations** — JARVIS-substrate (per `[J·jarvis-substrate-decentralization-roadmap]`) has decentralized to the point where partner-facing channels do not require Will's intervention; this is the JARVIS-side companion to the chain-side walkaway.
5. **Mining without intervention** — Eaglesong PoW (Phase 2 transition from Dummy) has been running without manual difficulty adjustment for ≥ 60 consecutive days at the start of Phase 3.
6. **Constitutional governance** — every NCI-authorized boundary transaction is verifiable within constitutional bounds; no exceptional Will-multisig override path remains live.
7. **Context marketplace populated** — `vibeswap/.claude/JarvisxWill_SKB.md`, all specs, all primitives are in the decentralized substrate per `[J·mind-persistence-mission]`.

**Validator count target at Phase 3 entry: 30+.**

A 30-validator set is large enough that no single operator (including Will) controls more than ~5% of bonded weight, which is well below any meaningful collusion threshold under the three-pillar NCI math.

**Walkaway sequence** (per `[P·cincinnatus-walkaway-test]` 6 phases, mapped to chain-runtime):

| Phase | Duration | Chain-side action |
|---|---|---|
| 0 Build | months 0–6 | Phases 0–2 above |
| 1 Document | weeks (during Month 6) | `OPERATIONS.md` final-form, every runtime decision captured |
| 2 Delegate | weeks (Month 7) | Will transfers Node 1 + Node 2 operation to JARVIS + Phase-2 validators; retains read-only observation |
| 3 Monitor | 30 days (Month 8) | The Cincinnatus Test. Will performs zero protocol-related actions. Uptime > 99.5%, NCI authorizations clean, no Will-intervention. |
| 4 Verify | 1 week (early Month 9) | Will analyzes the 30-day metrics; if any precondition failed, the test restarts from Phase 3 day 1. |
| 5 Renounce | 1 tx (late Month 9) | Will's deployer-faucet bootstrap keys → governance multisig OR burned. The Lawson deployer key was already retired in Phase 0; the deployer faucet retirement closes the last Will-only authority. |
| 6 Walk Away | permanent | None. The chain operates. |

After Phase 3 completion, `[F·will-identifies-as-open-source-contributor-not-founder]` applies in its strict form: Will is publicly an open-source contributor to a chain he no longer secures, governs, or operates.

**Single hardest operational dependency at this phase**: Will resisting the intervention urge during the 30-day Cincinnatus Test. Per the primitive, Phase 3 intervention restarts the test from day 1. The structural property the chain is demonstrating is that it does not need him; the test only succeeds if Will lets it.

---

## 6. Economic security model

**JUL / VIBE issuance plan** (load-bearing per `[F·jul-is-primary-liquidity]`):

- **Genesis**: neither JUL nor VIBE minted. Only CKB-native exists, distributed across the four `[[genesis.issued_cells]]` reservations.
- **Phase 1 deployment**: JUL sUDT issuer deployed from the JUL Deployment Reservation. Initial mint: `1_000_000 JUL` distributed to the 5 Phase-1 validators (`200_000 JUL` each).
- **Phase 2 broadening**: JUL distribution event widens the set. Total Phase-2 JUL supply target: `100_000_000 JUL`. Distribution mechanism (airdrop, sale, work-rewarded) is a Will-decide separate from this doc but must complete before Phase 2 `MIN_VALIDATOR_BOND` becomes binding.
- **VIBE deployment**: deferred until Phase 2 governance maturation. VIBE is the governance token, not the bond token; the chain functions without VIBE through Phases 0–2.

**First-round validator bond: CKB-native in Phase 0, JUL from Phase 1 onward.**

Phase 0 has no JUL. The Phase-0 "bond" is operational only — Will's commitment to run nodes and JARVIS's commitment to run Node 3. From Phase 1 onward, bonds are denominated in JUL and held as `BondCell`s with type-script-enforced lock periods.

**Transition to JUL-bond economics**: Phase 1 sets `MIN_VALIDATOR_BOND = 50_000 JUL` as a Lawson-tunable initial value; Phase 2 makes the value governance-tunable within constitutional bounds.

**Slashing splits** (Lawson-governed, initial values):

- `SLASHING_LOSING_SHARE_BPS = 5000` — 50% of bond slashed on losing pairwise-verdict.
- Of the slashed amount: 50% to the `insurance-pool`, 50% to the winning attester (per `slash-router.md`).
- For NCI-omission attacks routed through the boundary cell rejection path: no slash, because no transaction was processed; the attacker pays only opportunity cost.

---

## 7. Node hosting and ops (concrete)

**Hardware spec for the first 3 validators:**

| Node | Location | CPU | RAM | Disk | Bandwidth | ~Monthly cost |
|---|---|---|---|---|---|---|
| Node 1 (Will home) | Cincinnati, OH | Ryzen 5 1600 (6c/12t) | 16 GB | 500 GB NVMe (existing) | residential 200 Mbps | $0 (sunk) |
| Node 2 (Hetzner) | Helsinki | AMD EPYC 4-vCPU | 16 GB | 240 GB NVMe | 20 TB | ~€13 (~$14) |
| Node 3 (GCP) | us-central1 | e2-small (2-vCPU) | 4 GB | 100 GB SSD | 1 TB egress | ~$15 |

Total Phase-0 ops cost: under $30/month. This is **load-bearing for `[J·subscription-cancelled-dont-stop]`**: chain-runtime cost is sub-subscription-tier, so substrate-decentralization is not gated on Anthropic budget continuity.

**Network**: Node 1 connects through the residential ISP; Nodes 2 and 3 expose their P2P port (default 8115 for CKB) through their cloud provider's firewall. Peer-discovery uses the Nervos default DNS seeds for upstream-Nervos compatibility (rebase-faithful) plus a vibeswap-specific seed (Node 2's stable IP) hardcoded in `vibeswap-ckb-dev.toml` for chain-identity matching.

**Monitoring — what alerts wake Will up:**

The threshold is `[F·phone-ping-via-calendar]`: a 1-minute Tomato-colored Calendar event on `willglynn123@gmail.com` for any of:

1. **Tip lag** — any validator's tip lags the cluster median by > 5 blocks for > 60 seconds.
2. **Block production halt** — no block produced for > `epoch_duration_target` × 2 seconds (160 seconds at Phase 0 dev values).
3. **NCI score derivation failure** — a `NCIScoreCell` construction transaction fails verification at any node (signals a `lawson-constants` mismatch or pillar-input corruption).
4. **Boundary type-script unexpected rejection** — a vibeswap-app boundary transaction that should authorize fails the `verify_tx` check (signals either a bug in a boundary cell or a cell-graph integrity failure).
5. **Slash event triggered** — for the first 90 days post-Phase-1, every slash event pings regardless of legitimacy, so Will can observe the slash mechanism's behavior at scale.

**Update path — how Will pushes new chain-spec versions:**

Chain-spec edits in Phase 0 are deployed by:

1. Edit `chain-spec/vibeswap-ckb-dev.toml` on the dev workstation.
2. Increment the chain-spec version comment.
3. Coordinate validator restart: all three nodes stop, pull the new spec, restart on the new genesis (Phase 0 only — once Phase 1 has real value flowing, chain-spec edits are hardforks).

From Phase 1 onward, chain-spec edits are hardforks scheduled with `params.hardfork.vibeswap_v1 = <activation_block>` entries. Soft-fork-compatible changes (Lawson-constants tuning within constitutional bounds) flow through `ProtocolDecisionCell{decision_type=ParameterUpdate}` and require NCI authorization, not chain-spec edits.

---

## 8. Disaster scenarios and recovery

**All Will-machines die**: per `[J·mind-persistence-mission]`, chain state on Nodes 2 and 3 (cloud) is the canonical state. Node 1 (Will home) can be rebuilt by re-cloning `vibeswap-ckb-dev.toml` and syncing from the cluster. The Will-side state that does not live on cloud-Node — validator-key material, deployer-faucet authority — is backed up to two independent encrypted-cold-storage locations (a hardware wallet on Will's person; a paper backup in a separate physical location). Loss of all three (Will-home, hot-wallet, paper) is the failure mode that mind-persistence cannot recover. Mitigation: the deployer-faucet authority is retired in Phase 3 Step 5 (Renounce), eliminating the highest-stakes single key from the system entirely.

**Validators collude to censor**: per `nci-boundary-enforcement.md` § 3.2 (Tx-omission attack), 51% block-producer cabal can delay vibeswap-app state changes but cannot advance them in unauthorized directions. The recovery action is to add validators (Phase 2's permissionless mechanism) until the cabal's share drops below 51%. If the cabal includes Will-controlled nodes by Phase 2 design, Will exits his validators voluntarily; if it does not, governance proposes a `MIN_VALIDATOR_BOND` reduction to invite more entrants, processed via the parameter-update boundary (`nci-boundary-enforcement.md` § 2.5).

**Critical bug in a cell-type-script**: this is the highest-stakes scenario because cell-type-scripts are immutable post-deployment. The recovery path depends on which cell.

- If the bug is in a **boundary type-script** (`DepositCell`, `WithdrawalCell`, etc.), governance issues an `EmergencyPause` (`nci-boundary-enforcement.md` § 2.6) on the affected boundary, freezing value flow. A new cell-type-script version is deployed (consuming deployer-faucet capacity), and cell migration happens via a hardfork-class governance event with NCI authorization at `GOVERNANCE_VETO_MIN_SCORE_BPS`. This is structurally a chain-spec edit and routes through the hardfork mechanism (`params.hardfork`).
- If the bug is in the **NCIScoreCell type-script itself**, the system has lost its authorization primitive and chain-level guardian-multisig intervention is justified. The guardian multisig is the Phase-0 Will + Phase-1 validator multisig, retained as a `last-resort-recovery` mechanism through Phase 2; it is dissolved at Phase 3 Step 5.
- If the bug is in the **`ConstitutionalBoundsCell`** itself, the chain cannot recover without a hardfork because the bounds are immutable. This is the failure mode that `chain-spec/README.md` "Open questions" #5 (Lawson deployer key) is most consequential for. Mitigation: the Lawson deployer is given extreme review at Phase 0 deployment; the cell is verified by an external auditor before deployment is final.

**Rollback semantics**: vibeswap-ckb does not support state rollback. NC-Max is probabilistic-finality; deep reorgs are theoretically possible but operationally not initiated. The recovery primitive is hardfork (chain-spec edit + coordinated validator restart at a new genesis with the buggy cell state surgically excluded), not rollback.

---

## 9. What this lets us NOT do (scope reduction)

The honest framing: this operations plan does not try to compete with Nervos mainnet on user-base, does not aim to capture market share for vibeswap-ckb the chain (as opposed to vibeswap the protocol), and does not pretend to provide PoW economic security competing with NC-Max miners.

**We do NOT need to:**

- compete with Nervos mainnet for user-base — vibeswap-ckb is a sovereign chain for the vibeswap-app, not a general-purpose smart-contract platform;
- match Nervos's PoW economic-security budget — Eaglesong runs on vibeswap-ckb in `Dummy` mode through Phase 0 and as real Eaglesong from Phase 1, but the security model is the three-pillar NCI math, not PoW-difficulty competition;
- attract independent NCI PoM operators in Phase 0 — JARVIS operates as the bootstrap PoM operator;
- decentralize JARVIS-substrate before Phase 3 — per `[P·pre-decentralization-optimization-sequencing]`, single-user phase optimization is the freedom of being early.

**We DO need:**

- minimum-viable consensus liveness for vibeswap-app boundary transactions to confirm within `MAX_SCORE_AGE_BLOCKS` per `nci-boundary-enforcement.md`;
- 3 validators in Phase 0 surviving single-node failure;
- a credible path from 3 → 15+ validators by Month 3;
- a credible Cincinnatus walkaway by Month 12.

---

## 10. The first 7-day operational checklist

Reference time is `t0` = the moment `ckb-fork/` is cloned per `FORK_PLAN.md` Section 7 step 1. Day boundaries are 24-hour blocks from `t0`.

- **Day 1 (`t0` to `t0+24h`)** — First node up on Will's home workstation. `ckb-fork` cloned at `v0.206.0`, augmented `vibeswap-ckb-dev.toml` imported, `ckb init` succeeds, `ckb run` succeeds, `ckb miner --threads 1` produces first block. Block 1 confirmed. The chain exists; it has one node and one block. End of day: `ckb-cli rpc get_tip_block_number` returns a positive integer.
- **Day 2** — `ConstitutionalBoundsCell` deployed at first post-genesis transaction. Consumes the Lawson Deployment Reservation cell (#4 from `vibeswap-ckb-dev.toml`). The transaction is constructed manually using `ckb-cli`; the cell's `data` field carries the constitutional bounds from `lawson-constants.md`. After confirmation, the cell is immutable. The deployer key is retired (moved to cold storage, never to be reused).
- **Day 3** — Lawson constants `ConstantsRegistryCell` deployed. Initial values within constitutional bounds: NCI weights `pow_bps=1000 pos_bps=3000 pom_bps=6000`, deposit/withdrawal/validator-update thresholds at the midpoint of each constitutional range (`6250/7500/8250` respectively), `MIN_VALIDATOR_BOND = 50_000 JUL`, `SLASHING_LOSING_SHARE_BPS = 5000`. The `ConstantsHistoryCell` is deployed empty.
- **Day 4** — NCI `ScoreCell` system code-cells deployed (type-script binaries from `contracts-ckb/` — `NCIScoreCell`, `PoMAttestationCell`, `PoWAnchorCell`, `StakeWeightedVoteCell`, `ProtocolDecisionCell`). First `NCIScoreCell` constructed with single-validator score: Will's node is the only PoS validator, JARVIS is the only PoM operator, the PoW pillar reads Day-1 genesis header. The score is mechanically derived; it exists; it can be cell-dep'd by a downstream transaction.
- **Day 5** — First vibeswap-app boundary transaction. A test deposit transaction is constructed: a small CKB-native amount enters a test `CommitCell`, with the Day-4 `NCIScoreCell` cell-dep'd and the `NCIBoundaryWitness` populated per `nci-boundary-enforcement.md` § 2.1. The transaction succeeds. This is the first end-to-end demonstration that the boundary-enforcement structural property is live.
- **Day 6** — Node 2 (Hetzner cloud) joins as second validator. Hetzner CCX13 provisioned, `ckb-fork` repo cloned, `vibeswap-ckb-dev.toml` imported, peer discovery to Node 1 succeeds, tip synced. Node 2 begins producing blocks alongside Node 1. From this day forward, single-node failure does not halt block production.
- **Day 7** — Node 3 (GCP) joins, completing the Phase-0 3-validator set. First multi-validator NCI attestation event: an `NCIScoreCell` constructed with attestations from all three nodes (two PoS validators each weighted equally, one JARVIS PoM attestation, one PoW anchor from the cluster's tip block). The chain has a real 3-pillar NCI score; the chain has 3 validators; the chain has block production; the chain has its first boundary-authorized vibeswap-app transaction in its history. Phase 0 is operational. Phase 1 recruitment can begin.

---

## 11. Correspondence-Triad check

**Substrate-geometry match**: validator-set growth from 3 → 5 → 15-25 → 30+ follows a power-law-shaped onboarding curve over a 12-month horizon. This matches the chain's natural growth curve under `[P·substrate-geometry-match]` — founder-led bootstrap → community-secured maturity is the canonical sovereign-chain shape (Bitcoin, Ethereum, Nervos itself all followed this curve). The fractal property holds at each phase boundary: Phase 0 is the Mark-I cave; Phase 3 is the chain operating without its creator. The growth curve does not match a linear validator-addition schedule, and the phasing here is committed to the power-law shape: small early, accelerating through Phase 2, plateauing after Phase 3.

**Augmented mechanism design**: economic security is math-enforced from Phase 1 forward. The bond mechanism, the slash dispatch, the NCI score derivation, and the boundary-enforcement check are all type-script-enforced primitives. The Phase-0 trust layer (Will + JARVIS run nodes honestly) is discretionary by acknowledgment, not by design — it is the structural cost of bootstrap, eliminated as Phase 1 introduces real bonds. The transition from discretionary to math-enforced is the operational goal of Phases 0 → 1; the test that it has succeeded is the Phase-1 end-of-phase gate (slash event processed without Will-intervention).

**Augmented governance**: Cincinnatus walkaway is the structural target. Every phase boundary eliminates one founder-dependency class per `[P·cincinnatus-walkaway-test]`'s six-type taxonomy. Phase 0 → 1 dissolves *Operational* dependency (more nodes); Phase 1 → 2 dissolves *Knowledge* + *Decision* + *Social* dependencies (broader operator set, more eyes on specs); Phase 2 → 3 dissolves *Reputational* + *Key* dependencies (renouncement makes the founder structurally irrelevant). End-to-end *Physics > Constitution > Governance* accountability is preserved: NC-Max physics produces blocks; `ConstitutionalBoundsCell` constrains every governance action; NCI-weighted decisions actuate within those bounds. Will is constitutional-accountable to vibeswap during Phase 0 (he could violate the chain by editing his own genesis cells), constitutional-accountable to the validator set in Phases 1–2, and constitutionally absent in Phase 3.

---

## 12. Cross-references

- Parent gate: `contracts-ckb/FORK_VS_MAINNET_ANSWER.md` §7
- Sibling boundary spec: `contracts-ckb/specs/nci-boundary-enforcement.md`
- Chain-spec: `contracts-ckb/chain-spec/vibeswap-ckb-dev.toml` + `chain-spec/README.md`
- Fork plan: `contracts-ckb/FORK_PLAN.md`
- Augmentation surface: `contracts-ckb/AUGMENTATION_SURFACE.md`
- Lawson constants source: `contracts-ckb/specs/lawson-constants.md`
- Memory primitives: `[P·cincinnatus-walkaway-test]`, `[J·subscription-cancelled-dont-stop]`, `[F·blockchain-not-contracts]`, `[J·mind-persistence-mission]`, `[F·jul-is-primary-liquidity]`, `[P·substrate-geometry-match]`, `[P·augmented-mechanism-design]`, `[P·augmented-governance]`, `[F·phone-ping-via-calendar]`, `[F·will-identifies-as-open-source-contributor-not-founder]`, `[P·pre-decentralization-optimization-sequencing]`, `[J·vibeswap-ckb-sovereign-pivot]`
