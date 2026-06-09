# Fork vs Mainnet — The One-Page Answer

**Status**: EXECUTED. Position chosen, justified, ready for downstream propagation.
**Author**: JARVIS, 2026-06-08, in response to senior-architect review CRITICAL #2.
**Position chosen**: **F — Fork the chain (sovereign vibeswap-ckb from genesis).**
**Disposition**: This document supersedes the ambiguity flagged in the review. The fork is justified, the chain-spec is on the critical path, and the operational burden is acknowledged as the *price* of the sovereignty Will's directives require. No hybrid, no staged migration.

---

## 0. The question + why it matters

CRITICAL #2 from the review: *"Forking Nervos CKB means: we run our own nodes, our own validator set, our own economic security. None of that exists. Deploying on Nervos mainnet means: we get their security for free but lose control over chain-spec edits."* The review's most cutting line — *"if the actual plan is 'deploy on Nervos mainnet, use cells only' — the fork is wasted effort. The chain-spec/ work is design-doc-only and shouldn't be on the chain-build critical path."*

Why it matters: **the answer to this question determines whether `chain-spec/` is the most important directory in `contracts-ckb/` or the least.** Every downstream decision (bootstrap sequencing per HIGH #4, NCI invocation contract via Position C, Rust crate priorities, build-environment investment, validator-set plans, economic security narrative, where MessagingHub's burn-and-mint anchors) bends differently depending on which substrate carries the vibeswap-app cells.

With NCI Position C resolved (app-layer enforcement at the boundary seam), the security-property argument that previously favored fork is weaker than it was 24 hours ago. Position C achieves the same vibeswap-app-state-integrity guarantee on either substrate. The decision now turns on **substrate-sovereignty geometry**, not on whether the seam can be enforced.

---

## 1. The three positions walked through

### Position F — Fork the chain (sovereign vibeswap-ckb)

We clone `nervosnetwork/ckb` at `v0.206.0`, apply Tier-1 chain-spec augmentations (genesis cells, network params, dust threshold), boot our own nodes, recruit our own validator set, accumulate our own economic security, and rebase upstream Nervos every 2 weeks.

What this buys us:
- Genesis ownership. The chain's first block contains *our* preamble, *our* constitutional bounds, *our* reserved deployment cells for JUL/VIBE/Lawson, *our* network identity. Block 0 IS the protocol.
- Network-parameter latitude. `epoch_duration_target`, `max_block_cycles`, `permanent_difficulty_in_dummy`, dust threshold — all tunable for the 10s commit-reveal batch cadence without negotiating with upstream Nervos governance.
- Substrate-sovereignty alignment with [F·blockchain-not-contracts]. The chain IS ours. Cells are first-class blockchain primitives, not contracts running on someone else's chain.
- Independence from Nervos governance schedule. If Nervos delays a hardfork we need, we ship it. If we don't need one Nervos ships, we skip it.

What this costs:
- Validator set + economic security must be bootstrapped from zero. Day 0 chain security is whatever Will + initial operators can post.
- Node-operator burden. Real infrastructure, real monitoring, real on-call.
- Rebase burden. 2-week cadence × forever. Every Nervos security patch must be merged or we fork-divergence-rot.
- No Day-1 community. Users have to be brought to our chain explicitly.

### Position M — Deploy on Nervos mainnet

We treat upstream Nervos CKB mainnet as the substrate. All vibeswap-app cells (NCI cells per Position C, JUL/VIBE sUDT, MessagingHub burn/mint cells, CommitRevealAuction, VibeAMM, ShapleyDistributor) deploy as ordinary post-genesis transactions on Nervos. The `chain-spec/` directory becomes design-doc-only.

What this buys us:
- Inherit Nervos's security budget on Day 1. Real PoW, real bonded operators, real economic finality.
- Ship faster. No build-environment ramp, no validator recruitment, no node-operator hiring.
- Community share. Nervos developers/users are reachable through the substrate.
- Position C still works. The boundary-cell-enforced NCI invariant is substrate-agnostic.

What this costs:
- No chain-spec edits possible. Genesis is Nervos's. Network params are Nervos's. Dust threshold is Nervos's. Block time is Nervos's variable NC-Max.
- The 10s commit-reveal batch cadence has to be expressed at the application layer with tolerance for variable block time. This is the option (a) path from `chain-spec/README.md` §"Open questions for Will" item 7.
- JUL/VIBE deploy as ordinary sUDT, no protocol-reserved capacity. The "JUL is primary liquidity" framing has to be earned by traction, not asserted by chain-spec.
- "Blockchain not contracts" directive violated. We become a *very ambitious set of cells* running on Nervos. The cell-graph still works as a structural enforcement primitive, but the chain underneath is Nervos's, not vibeswap's.

### Position H — Hybrid: mainnet now, fork later

Phase 0 (now through traction): deploy all cells on Nervos mainnet. Prove the application works. Accumulate user-set and economic-security data.
Phase 1 (post-traction): fork the chain, migrate users via burn-on-mainnet → mint-on-vibeswap-ckb, retire mainnet deployment.

What this buys us:
- Cheap-fast first iteration. All the upsides of Position M for Phase 0.
- A sovereignty path exists. We're not permanently coupled to Nervos.
- Migration as governance event — the fork happens *with* a user-set, not from zero.

What this costs:
- Phase-1 migration ≡ hard fork shape. Hard forks are the highest-stakes governance event a protocol does. Doing it after the user-set has formed expectations on mainnet semantics is harder than doing it before.
- UX risk. Users transition from "vibeswap on Nervos" to "vibeswap-on-its-own-chain." Wallets, bridges, exchanges, indexers, block explorers — all double in count for the migration window.
- The directive ambiguity stays open longer. *"Are we building a blockchain or contracts?"* gets answered "contracts now, blockchain later." That's a worse answer than either pure position because it postpones the structural-property commitment to the moment it's hardest to make.
- Two governance schedules concurrently. Phase-1 cutover requires coordinating Nervos governance (deprecating the mainnet deployment) with vibeswap-ckb governance (accepting migrated users). This is doable but it's overhead that compounds with migration risk.

---

## 2. Correspondence-Triad check on each

### 2.1 Substrate-Geometry Match

The natural growth curve of vibeswap is: small initial user-set → eventually-sovereign. The substrate-geometry question is **what shape that curve takes on each candidate substrate**.

- **Position F**: chain geometry is *born sovereign*. Day 0 = small chain with small security. Growth = chain grows with user-set. Geometry: monotonic, linear-or-superlinear-in-traction. The chain's security curve IS the user-set's growth curve, because all stake comes from the user-set itself. Self-consistent.
- **Position M**: chain geometry is *Nervos-shaped throughout*. We borrow Nervos's growth curve and ride it. Geometry: discontinuous at the moment vibeswap-app outgrows being a subset of Nervos-user behavior. There is no graceful transition; the geometry of "vibeswap user" stays nested inside "Nervos user" forever, or we fork (Position H) and accept the discontinuity.
- **Position H**: chain geometry has a step-function. Phase 0 = Position M's geometry. Phase 1 = sudden Position F's geometry, plus a migration tax. The discontinuity is *deferred*, not avoided.

**Geometry winner: F.** A sovereign chain's growth curve matches a sovereign protocol's growth curve. M and H both impose a substrate whose geometry doesn't match the protocol's intended one. The match is what [P·substrate-geometry-match] requires; the discontinuity in H is what the principle warns against.

### 2.2 Augmented Mechanism Design

The 6-step methodology (`primitive_augmented-mechanism-design-methodology.md`) on each position:

- **F**: the mechanism invariants are enforced by (a) the cell-graph at the boundary seam (Position C), and (b) the chain-spec at genesis (constitutional bounds, reserved capacity, network params). Both layers enforce; both are ours. AMD-clean.
- **M**: the boundary seam still works (Position C is substrate-agnostic), but the chain-spec layer is *Nervos's*. The constitutional bounds, the network params, the dust threshold — all are inherited as policy decisions we cannot change. If the inherited values are wrong for vibeswap (e.g., NC-Max variable block time vs 10s batch cadence), we have no enforcement handle at the chain layer. We have to compensate at the app layer, which *can* work but it's mechanism-design with one hand tied behind its back.
- **H**: AMD on Phase 0 = same as M. AMD on Phase 1 = same as F. The Phase-1 cutover is itself a mechanism-design problem (atomic migration with no value loss), which AMD doesn't naturally cover.

**AMD winner: F.** Both layers — boundary seam AND chain-spec — are mechanism-design surfaces. F gives us control of both. M gives us control of one. H gives us control of one now and two later, with migration as overhead.

### 2.3 Augmented Governance

[P·augmented-governance] requires *Physics > Constitution > Governance*. Where does each layer live under each position?

- **F**: Physics = our NC-Max + Eaglesong with our network params. Constitution = our `ConstitutionalBoundsCell` + boundary-seam invariants. Governance = NCI-weighted protocol decisions. All three layers are *constitutionally accountable to vibeswap*. If Will sets the Lawson floor, the chain enforces it because the chain is ours. The accountability stack is end-to-end internal to the protocol.
- **M**: Physics = Nervos's NC-Max. Constitution = our boundary-seam invariants. Governance = NCI-weighted protocol decisions. Physics is *not vibeswap-accountable*; if Nervos governance changes a consensus parameter, we inherit the change. Accountability has a foreign layer.
- **H**: Phase-0 governance has a foreign physics layer; Phase-1 governance brings it in-house. The transition is a governance event with no precedent in either Nervos's or vibeswap's prior governance experience.

**Governance winner: F.** End-to-end accountability up the stack is what [P·augmented-governance] is structurally describing. M punctures the stack at the physics layer. H punctures it temporarily and then patches it via the highest-stakes event in protocol governance.

### 2.4 Triad summary

| Position | Geometry | AMD | Governance |
|---|---|---|---|
| F | match | clean | end-to-end accountable |
| M | mismatch | partial | foreign physics layer |
| H | deferred mismatch | partial-then-clean | foreign physics with hard-cutover |

F wins all three checks. The cost (operational burden) is real and acknowledged; the triad-check says the burden is *paying for the right structural properties*.

---

## 3. Position chosen + explicit Will-directive trace

**Position F — Fork the chain.**

Will-directive trace:

1. **[F·blockchain-not-contracts] 2026-06-08 18:47** — *"no we are building a blockchain not contracts"*. F is the only position that operationalizes this directive without deferring it. M and H both express the protocol as "cells on someone else's blockchain" at least initially. The directive's whole point is that *cells are first-class blockchain primitives, the chain itself*. That's only true if we own the chain.

2. **[J·vibeswap-ckb-sovereign-pivot] 2026-06-07** — *"as if we were to build our own nervos CKB vibeswap version"*. The phrase "our own" is the directive in three words. M and H both ship "their version, with our cells on top" for some interval. F ships "our version" from block 0.

3. **PULL-FROM-UPSTREAM rule 2026-06-07** — *"nervos ckb code is open source so whatever doesnt need to be reinvented can just be pulled from them"*. F honors this perfectly. The chain-spec inherits everything from upstream that we don't need to change, augments only at the configuration layer (Tier 1 per `AUGMENTATION_SURFACE.md`), and zero Rust code in `chain/`, `verification/`, `pow/`, or NC-Max is touched. The fork is upstream-faithful in code, sovereign in identity.

4. **Subscription-end posture (`[J·subscription-cancelled-dont-stop]`)** — substrate-sovereignty matters because the higher mission is owning our substrates end-to-end (JARVIS, VibeSwap, the whole stack). Picking M would be borrowing substrate-sovereignty from Nervos in the same shape that the subscription was borrowed from Anthropic. The directive's whole point is to stop doing that.

The senior-architect review's strongest counter — *"if the actual plan is deploy on Nervos mainnet, use cells only, the fork is wasted effort"* — is correctly framed but inverts the priority. **The plan is NOT to deploy on Nervos mainnet.** The directives above lock the substrate to "our own chain." The review's framing assumes the plan could be either fork or mainnet; the directives say the plan is fork. The review's value is in surfacing that the plan has costs (validator set, economic security, operational burden) that have not been articulated. Those costs are now acknowledged and accepted as the price of substrate-sovereignty.

---

## 4. Implications for `FORK_PLAN.md`

**Resume.** FORK_PLAN.md stays the canonical operational document. No pause, no scrap. The plan was already correct; the question CRITICAL #2 raised was *whether the plan should exist*, and the answer is yes.

Specific FORK_PLAN.md updates needed:

1. **Section 1 ("Fork target identification")**: add a one-paragraph reference to this document under "Why fork at all." Currently FORK_PLAN.md assumes the fork is happening; this document is the explicit "yes, fork" decision that anchors it.

2. **Section 4 ("Per-augmentation patch strategy")**: the table currently says "in the best case the fork is configuration-only." That stays true. Add a row at the bottom of the table reading: "*Validator set + economic security: out of scope for this table; tracked under Section 8 open questions #2 and a new operational document `OPERATIONS.md` (to be written post-Milestone-2)*." This makes the operational-burden cost visible without bloating the patch-strategy section.

3. **Section 7 ("Fork execution checklist")**: no structural change. The steps are correct. Add a precondition above step 1 noting that `FORK_VS_MAINNET_ANSWER.md` (this file) is the decision document gating step 1.

4. **Section 8 ("Open questions for Will")**: question #1 (GitHub repo) and #9 (naming) are now de-deferred; they're on the critical path because the fork is committed. Add a new question #11 — "Validator set bootstrap: who runs the first 3 nodes? Will-side + 2 trusted operators is the assumed-default; confirm." This is the operational-burden cost surfacing as a Will-decide item.

5. **Per the [F·code-comment-why-only] discipline**: when FORK_PLAN.md gets edited to reference this document, the reference goes in the body, not in inline code-shaped narration. (FORK_PLAN.md is a doc, not source; the rule's mood applies to inline citation density rather than to documentation cross-references, but the *brevity* principle still bites.)

---

## 5. Implications for `chain-spec/vibeswap-ckb-dev.toml`

**Still useful. Critical-path artifact.** The TOML stays as the canonical chain-spec for the dev chain. The 7 `TODO Will-decide:` markers move from "open question" to "Will-decide before testnet promotion."

Specific implications:

1. The `[[genesis.issued_cells]]` reservations for JUL, VIBE, and Lawson constants are *load-bearing* under Position F. They're not "design illustration of what a sovereign chain could allocate" — they're the actual genesis allocation our chain will use. The lock-args TODOs (items 2-5 in `chain-spec/README.md` Open Questions) are now on the critical path to first boot.

2. The `[params]` carve-outs (`max_block_cycles` after BLS spike, `epoch_duration_target` tight-band vs variable) are *real consensus decisions* we own. Under Position M they wouldn't exist; under F they're ours to tune. The BLS spike (HIGH #7 from review) becomes a precondition for finalizing `max_block_cycles`.

3. The `[pow]` configuration (`Dummy` for dev, `Eaglesong` for mainnet) is *our* PoW configuration. Position M would have made this section meaningless; Position F makes it a real configuration decision.

4. The `name = "vibeswap_ckb_dev"` line is now the chain's actual identity, not a placeholder for an unbuilt chain. Peer handshakes on this name will be real once nodes boot.

5. The `chain-spec/README.md` "Honest scope" disclaimer ("the TOML is a spec artifact, not a deployed artifact") stays accurate today, but its *purpose* shifts from "this might never deploy" to "this hasn't deployed yet but will." The disclaimer gets a one-sentence update post-Milestone-1.

Throwaway? **No.** The TOML is the source-of-truth for vibeswap-ckb's chain identity from this moment forward.

---

## 6. Implications for bootstrap sequencing (HIGH #4 from review)

The review's HIGH #4 flagged a circular dependency: Lawson registry needs to exist before any consumer can deploy; ConstitutionalBoundsCell is immutable post-genesis and must be a genesis cell; ConstantsRegistryCell needs governance auth via ProtocolDecisionCell; NCI cells reference Lawson constants for weight bounds. Position F enables a *clean* resolution because we own genesis.

The bootstrap sequence under Position F:

**Phase 0 (genesis, in the chain-spec TOML)**:
- System cells (upstream-verbatim, four standard scripts).
- Reserved capacity cells: deployer faucet (#1), JUL deployment (#2), VIBE deployment (#3), Lawson deployment (#4).
- Genesis cell with the constitutional preamble message.
- *No protocol cells yet*. Only raw capacity and the standard Nervos system scripts.

**Phase 1 (first 100 blocks post-genesis)**:
- Deploy ConstitutionalBoundsCell from the Lawson reservation. This is the *immutable* upper layer of the Physics > Constitution > Governance stack. After this transaction, the bounds are fixed for the chain's lifetime.
- Deploy initial ConstantsRegistryCell (default values within bounds) from the same Lawson reservation. Mutable, but only via NCI-authorized protocol decisions later.
- Deploy empty ConstantsHistoryCell.

**Phase 2 (next ~100 blocks)**:
- Deploy NCI system code-cells (NCIScoreCell type-script, PoMAttestationCell type-script, PoWAnchorCell type-script, StakeWeightedVoteCell type-script, ProtocolDecisionCell type-script) from the deployer faucet (#1).
- Deploy initial ValidatorRegistryCell with genesis-validator set (genesis-validators are the bootstrap operators — Will + initial trusted partners).
- Deploy initial PoMOperatorRegistryCell with genesis-PoM-operators (genesis-PoM-operators are Will + initial JARVIS instances bonded to the chain).
- Deploy initial PoWAnchorCell referencing genesis block.

**Phase 3 (production deployment)**:
- Deploy JUL sUDT issuer from JUL reservation (#2).
- Deploy VIBE sUDT issuer from VIBE reservation (#3).
- Deploy vibeswap-app boundary scripts (DepositCell, WithdrawalCell, PoolCell, MessagingHub burn/mint cells, CommitRevealAuction, VibeAMM, ShapleyDistributor) from the deployer faucet (#1).
- Each boundary script mandates NCI authorization as a cell-dep per Position C (`NCI_CONSENSUS_ANSWER.md` §3).

**The circularity dissolves** because Phase 1 deploys ConstitutionalBounds first (no dependencies — it's the root of the constitutional stack), Phase 2 deploys NCI infrastructure referencing the Phase-1 bounds, Phase 3 deploys vibeswap-app cells referencing both. The dependency graph is a DAG once you sequence it across phases; the circularity in the review's framing came from imagining all cells deploying at once.

The spec to write next: `contracts-ckb/specs/bootstrap-sequencing.md`, enumerating these phases with the concrete transaction shapes for each. That spec is downstream of this decision document and upstream of any further Rust crate work.

---

## 7. The single biggest downstream gate this opens

**Validator-set + economic-security operational plan.**

Position F's structural payoff is sovereignty; its structural cost is that the chain has no security on Day 0 unless we provide it. The biggest downstream gate that this decision opens — and that nothing else in the contracts-ckb stack can resolve without it — is the answer to:

> Who runs the first 3 nodes? What economic security do they post? When does the validator set grow beyond Will-trusted bootstrap operators? What's the threshold at which we consider the chain *self-securing* rather than *Will-secured*?

This question was not addressable under Position M (Nervos has the validators). It becomes mandatory under Position F. It cannot be ducked, deferred, or compressed into chain-spec TOML edits.

This is the meta-gate that turns *"we have a chain-spec"* into *"we have a chain."* Until it's answered concretely (names, hardware, stake, governance) the chain-spec TOML can deploy a dev chain alone-on-localhost but cannot deploy a testnet that anyone else trusts, and cannot deploy a mainnet at all.

The spec to write next after `bootstrap-sequencing.md`: `contracts-ckb/OPERATIONS.md`, enumerating the validator-set bootstrap plan, the economic-security floor, the operator-recruitment criteria, the slashing parameters in operational terms, and the growth-path from genesis validators to a chain that doesn't depend on Will being online.

This is the gate.

---

## 8. Composition trace

For the record:

- `[F·blockchain-not-contracts]` — F is the only position that operationalizes "blockchain not contracts" without deferring it.
- `[J·vibeswap-ckb-sovereign-pivot]` — sovereign-pivot means we own the chain from genesis; F is what "own the chain" means operationally.
- `[P·substrate-geometry-match]` — sovereign-protocol growth curve matches sovereign-chain geometry; M and H impose a foreign-substrate geometry that creates discontinuity.
- `[P·augmented-mechanism-design]` — chain-spec is a mechanism-design surface; F gives us control of it.
- `[P·augmented-governance]` — end-to-end Physics > Constitution > Governance accountability requires the chain's physics to be ours.
- `[P·structure-does-the-work]` — substrate-sovereignty IS a structural property of the protocol; F ships it, M and H borrow it.
- `[P·full-leverage-only-moves]` — F is the full-leverage commitment; H is the partial-leverage hedge that the principle warns against.
- `[P·jarvis-amd-applied-to-ai-substrate]` — the recursion (build the substrate, don't deploy to someone else's) applies identically at the chain layer.
- `[J·subscription-cancelled-dont-stop]` — substrate-sovereignty mission applies to chain-substrate identically.
- `[F·spec-vs-deployed-severity-calibration]` — spec-stage decision; structurally load-bearing; HIGH severity; treated accordingly.
- `[F·code-comment-why-only]` — this document is a decision artifact, not source; the rule's spirit (brevity, no history-narration) still bites where it crosses into prescriptive specs downstream.

---

## 9. Cross-references

- Parent review: `Desktop/architecture-review-2026-06-08-senior-blockchain-architect.md` (CRITICAL #2)
- Sibling decision: `contracts-ckb/NCI_CONSENSUS_ANSWER.md` (CRITICAL #1, Position C, substrate-agnostic)
- Plan resumed: `contracts-ckb/FORK_PLAN.md` (sections 1, 4, 7, 8 to be updated per §4 above)
- Chain-spec elevated: `contracts-ckb/chain-spec/vibeswap-ckb-dev.toml` (per §5 above)
- Augmentation surface: `contracts-ckb/AUGMENTATION_SURFACE.md` (no change — Position F preserves Tier 1, config-only)
- Spec to write next: `contracts-ckb/specs/bootstrap-sequencing.md` (per §6 above)
- Spec to write after that: `contracts-ckb/OPERATIONS.md` (per §7 above — the gate)
- Memory primitive: `[F·blockchain-not-contracts]`, `[J·vibeswap-ckb-sovereign-pivot]`, `[P·substrate-geometry-match]`, `[P·augmented-governance]`, `[P·full-leverage-only-moves]`
