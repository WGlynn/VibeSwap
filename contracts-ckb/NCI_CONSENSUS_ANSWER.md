# NCI Consensus — The One-Page Answer

**Status**: EXECUTED. Position chosen, justified, ready for downstream propagation.
**Author**: JARVIS, 2026-06-08, in response to senior-architect review CRITICAL #1.
**Position chosen**: **C — Hybrid app-layer consensus enforced at the vibeswap-ckb seam.**
**Disposition**: This document supersedes the ambiguous framing in `specs/nci-consensus.md`. NCI is **app-layer protocol-decision-weighting** with **chain-level mandatory invocation at the vibeswap deposit/withdrawal boundary**. The "consensus" word is being scoped, not abandoned.

---

## 0. Why this had to be answered before more NCI work

The review caught the load-bearing ambiguity: a cell-type-script only fires when a cell appears in a transaction. Block producers are free to mine blocks that omit NCI cells entirely. The underlying chain-level consensus is still upstream NC-Max + Eaglesong PoW, untouched. The current spec calls NCI "consensus" but only enforces it on transactions that voluntarily reference NCI cells. That is **not consensus**, that is **convention**.

Three positions were on the table (A app-layer governance, B substrate-patch, C hybrid seam-enforced). One must be chosen and propagated through `FORK_PLAN.md`, `AUGMENTATION_SURFACE.md`, and `NCI_RUST_DESIGN.md`. No more pending decisions.

---

## 1. The Correspondence-Triad walkthrough

### 1.1 Substrate-Geometry Match

The substrate has two geometric layers:

- **Block-production layer**: NC-Max + Eaglesong PoW. Power-law difficulty, asynchronous, probabilistic finality. Geometry = continuous, statistical, headers-are-the-only-handle.
- **Transaction-validation layer**: cell-graph. Type-scripts fire per-cell-per-tx. Geometry = discrete, deterministic, binary-pass-fail-per-transaction.

NCI as currently specced tries to fit a *consensus* concept into the transaction-validation layer. That is a **First-Available Trap**. The cell-graph is the first-available enforcement primitive to a developer thinking in CKB terms, so the spec reached for it. But block-producers select transactions independently of cell-type-script logic — they can simply not include the cell, and no type-script ever runs. **The geometry doesn't match: consensus is power-law-shaped at the block layer; cell-type-scripts are binary-per-tx at the cell layer.** An adversary's freedom-of-omission is the geometric mismatch surfacing as an attack.

But the cell-graph **IS** the natural enforcement geometry for **application-layer state transitions** — specifically the moments when value crosses the vibeswap-app boundary (deposits in, withdrawals out, governance actuations). Those transitions are themselves discrete, deterministic, binary-pass-fail-per-tx. **The cell-graph matches that geometry exactly.**

The structural answer: NCI does not belong at the chain-consensus layer (geometry mismatch); it belongs at the app-boundary layer (geometry match). The error was conflating "consensus" (the chain's block-ordering function) with "protocol-decision-weighting" (the app's authorization function). They are different operations on different geometric substrates.

### 1.2 Augmented Mechanism Design

Run the 6-step methodology (`primitive_augmented-mechanism-design-methodology.md`):

1. **Property concretely**: a protocol decision (validator-set update, governance veto, slash dispatch, emergency pause) is authorized **only if** the three-pillar weighted score (PoW 10% / PoS 30% / PoM 60%) exceeds threshold.
2. **Invariant types that enforce it**: Structural (cell-type-script enforces the arithmetic), Economic (bonded validators + PoM operators have stake at risk on dishonest signing), Verification (BLS-aggregated PoS signatures, ed25519 PoM signatures, header-hash match for PoW).
3. **Compose 2+ types**: all three are already composed in the NCI design. That part is sound.
4. **Size from paper**: Lawson constants registry, default `pow=1000 pos=3000 pom=6000` bps.
5. **Triad-check**: this section.
6. **Ship with regression tests**: §7 of `NCI_RUST_DESIGN.md` already enumerates.

The methodology check passes for **what NCI computes**. But the methodology has nothing to say about **whether the computation is invocable at all** — that's the layer above mechanism design. AMD assumes the mechanism's enforcement layer is reachable. The review's CRITICAL #1 is that reachability itself is in question.

So AMD says: keep the three-pillar math, it's a sound mechanism. The fix is not to the mechanism but to **its invocation contract** with the substrate.

### 1.3 Augmented Governance

Can 51% block-producer collusion break the NCI invariant?

- **Under current spec (user-space only)**: YES. A 51% miner cabal mines blocks that simply don't include NCI cells. The chain advances, the NCI score is never computed, protocol decisions never actuate. The math layer is decoration. **This is the cells-as-decoration failure.**
- **Under Position B (substrate patch)**: NO. The `verification/` crate would reject blocks that don't include a valid NCI cell-dep, so omission is impossible. But this puts us in Tier 2 augmentation, which is currently disallowed.
- **Under Position C (hybrid seam-enforced)**: PARTIAL. 51% miners can still mine NCI-free blocks. But they **cannot** complete a vibeswap deposit, withdrawal, governance change, validator update, or slash without referencing an NCIScoreCell that authorizes it. The chain may have NCI-free blocks; **vibeswap-app state cannot transition without NCI authorization.** The cabal's only winning move is to also be the bonded-validator-and-PoM-operator majority, which is the same security assumption the three-pillar math is designed to dissolve.

Position C honors `[P·augmented-governance]`: the math IS load-bearing for any vibeswap-app state change. Physics (NC-Max produces blocks) > Constitution (vibeswap-app lock-scripts mandate NCI authorization) > Governance (NCI-weighted protocol decisions actuate within constitutional bounds). 51% block-producer collusion can deny vibeswap **liveness** for vibeswap-app users (they can't get their tx mined), but it **cannot break the NCI invariant** because no NCI-omitting block can advance vibeswap-app state. Liveness denial is the same property NC-Max already inherits from Bitcoin's threat model and is not a new attack surface — it's the existing substrate's existing property.

---

## 2. What NCI IS (executed framing)

NCI is the **vibeswap-app protocol-decision-weighting layer**. It is the cryptographically-verified three-pillar score (PoW 10% / PoS 30% / PoM 60%) that authorizes any vibeswap-app state transition crossing the deposit / withdrawal / governance / validator-set / slash / emergency-pause boundary.

NCI is **not** chain-level block-production consensus. NC-Max + Eaglesong PoW remains the block-production consensus, untouched. NCI consumes NC-Max's output (block headers via `load_header`) as one of its three pillar inputs.

The word "consensus" stays in the name because NCI **is** the three-token consensus mechanism for protocol decisions — but the scope is **vibeswap-app protocol decisions**, not chain-level block ordering. The renaming convention: call this **"app-layer consensus enforced at the vibeswap-app seam"** when precision matters; "NCI" when shorthand suffices.

---

## 3. What NCI ENFORCES (concrete invariants)

Under Position C, NCI mandatorily enforces:

1. **No deposit into vibeswap-app pools without NCI authorization**: every `DepositCell → PoolCell` transition references a current-epoch NCIScoreCell exceeding the deposit-threshold.
2. **No withdrawal from vibeswap-app pools without NCI authorization**: every `PoolCell → WithdrawalCell` transition references a current-epoch NCIScoreCell exceeding the withdrawal-threshold.
3. **No validator-set update without NCI authorization**: every `ValidatorRegistryCell_n → ValidatorRegistryCell_{n+1}` transition consumes a `ProtocolDecisionCell{decision_type=ValidatorUpdate}` whose `nci_score_witness` resolves to a sufficient score.
4. **No governance parameter change without NCI authorization**: same pattern, `decision_type=GovernanceVeto` or `decision_type=ParameterUpdate`.
5. **No slash dispatch without NCI authorization**: same pattern, `decision_type=SlashDispatch`.
6. **No emergency pause/resume without NCI authorization**: same pattern, `decision_type=EmergencyPause`.
7. **No NCI score computed dishonestly**: the NCIScoreCell type-script enforces the three-pillar arithmetic; a constructed score that doesn't match the consumed pillar inputs fails `verify_tx`.
8. **No NCI score with stale pillar inputs**: epoch-bound; the StakeWeightedVoteCell must match the current ValidatorRegistry epoch; the PoMAttestationCell must match a current PoM-operator-registry epoch; the PoWAnchorCell must reference a header within the current epoch's window.
9. **No replay of a protocol decision**: DecisionsRegistryCell tracks consumed `proposal_id`s.
10. **No NCI weighting outside constitutional bounds**: ConstitutionalBoundsCell caps `pow_bps ∈ [500,2000]`, `pos_bps ∈ [2000,4000]`, `pom_bps ∈ [4000,7000]`, with cross-constraint `pos_bps + pow_bps < pom_bps`.

**The load-bearing structural property**: any vibeswap-app state change is verifiable from on-chain data alone as either (a) NCI-authorized within constitutional bounds, or (b) invalid. There is no third option. The cells are not decoration; they are the seam through which all vibeswap-app value flows.

---

## 4. What NCI does NOT enforce (honest scope)

1. **NCI does not constrain block production.** Block producers can mine blocks containing no NCI cells. NC-Max chooses the canonical chain by cumulative difficulty over Eaglesong PoW; NCI has no vote in block ordering.
2. **NCI does not provide chain-level finality.** Finality is whatever NC-Max provides (probabilistic, deepening with confirmations). NCI provides **vibeswap-app-state finality** — once an NCI-authorized state transition is included in a block buried under N confirmations, vibeswap-app considers it final to the same depth as NC-Max considers the containing block final.
3. **NCI does not prevent denial-of-service liveness attacks.** A 51% block-producer cabal can refuse to include vibeswap-app transactions in blocks. This is the same liveness property the underlying chain already has; we inherit it, we do not amplify or fix it.
4. **NCI does not enforce invariants on non-vibeswap-app cells.** A user can hold sUDT tokens, transfer them, run other apps — NCI has no role. NCI is scoped to vibeswap-app boundary transitions only.
5. **NCI is not "consensus" in the block-ordering sense.** It is consensus in the protocol-decision-authorization sense. Different word, same root, used precisely.
6. **NCI does not require modifying upstream `verification/` or `chain/` crates.** No Tier 2 augmentation. The "augmentation surface stays clean" discipline holds.

---

## 5. Implications for `FORK_PLAN.md`

The fork still makes sense. The grounds shift slightly.

**Pre-position-C grounds for fork (from existing FORK_PLAN.md)**: genesis configuration, native token model, network parameter tuning, dust threshold. All configuration-only.

**Post-position-C added grounds**: the vibeswap-ckb genesis cell allocation must include **the system code-cell deploying NCIScoreCell-type-script**, **the ConstitutionalBoundsCell** (with NCI weight bounds), **the LawsonConstantsRegistryCell** (initial weights), **the PoMOperatorRegistry** (genesis operators), **the ValidatorRegistryCell** (genesis validators), **the PoWAnchorCell at genesis**, and crucially, **every vibeswap-app boundary lock/type-script that mandates NCI authorization for its respective state transition**.

This is **still configuration-only at the substrate**. No Rust code in `chain/` or `verification/` changes. The substrate fork's only purpose is:

1. Genesis configuration that anchors the NCI cells from block 0.
2. Network parameters tuned for the commit-reveal-batch timing (10s block-time band).
3. Dust threshold tuned for vibeswap-cell sizes once specs surface concrete numbers.
4. **A reserved system-cell slot for the NCI mandatory cell-deps** — so app-layer lock-scripts can reference them by well-known type-id without re-deploying.

**FORK_PLAN.md Section 3.3 ("NCI consensus integration") needs updating**: replace the "user-space path / substrate-augmentation escape hatch" framing with "hybrid app-layer mandatory cell-dep at vibeswap-app seam — zero substrate code, mandatory genesis cells." The substrate-augmentation escape hatch can be archived rather than left as an open option; if Position C proves insufficient in practice, **the correct next escalation is to revisit Position B and modify `verification/`, but only after operational data justifies it**.

**The fork is justified.** The grounds are: (a) genesis ownership (we boot a chain with our genesis cells and our protocol seam from block 0); (b) network parameter latitude (commit-reveal-batch timing); (c) ability to track upstream rebase cadence without licensing or governance friction. Deploying on Nervos mainnet would not give us (a) or (b) and would couple our protocol upgrades to Nervos's governance cycle.

What the fork does **NOT** give us, post-Position-C, that's worth being explicit about: it does not give us a different consensus algorithm. Block production is NC-Max identically to mainnet. If a future world wants NCI to vote on block ordering itself (Position B), that becomes a Tier 2 augmentation **then**, with operational data motivating it, and gets added to `AUGMENTATION_SURFACE.md` at that point.

---

## 6. Implications for `AUGMENTATION_SURFACE.md`

**Tier stays at 1 (configuration-only).** Position C deliberately keeps NCI in the user-space-default column.

Update needed: the existing "NCI consensus integration" entry currently says "Lean toward user-space" with "Decision deferred." Replace with:

> **Status**: Decided — Position C (hybrid app-layer mandatory cell-dep at vibeswap-app seam).
> **Scope**: zero upstream Rust code changes. NCI cells exist; vibeswap-app boundary lock/type-scripts enforce mandatory NCI authorization via cell-dep. Block production unchanged from NC-Max.
> **Justification**: substrate-geometry match — block-production consensus belongs at the block layer (NC-Max), protocol-decision authorization belongs at the cell-graph layer (NCI). Conflating them was a First-Available Trap.
> **User-space sufficient**: yes, because vibeswap-app value transitions are themselves cell-graph operations, so cell-graph enforcement is geometrically aligned. The chain-level "every block must include NCI" pattern (Position B) is not required; the boundary-enforcement pattern (Position C) achieves the same security property for vibeswap-app users.
> **Escalation trigger**: only escalate to Position B (substrate patch) if operational data shows the boundary-enforcement pattern is bypassable in ways the three-pillar math intended to prevent. Specifically: if 51%-of-validators collusion compromises both PoS AND the bonded-PoM-operator weighting, AND that compromise can route around the seam by attacking pre-deposit value flows. This is not a near-term concern; it is a far-term operational-data question.

This **preserves the discipline** the augmentation surface is designed to enforce: nothing on the surface unless required, every entry justified, the smaller the file the more credible the "we are building on Nervos rather than rewriting it" claim.

---

## 7. Implications for `NCI_RUST_DESIGN.md`

The Rust crate skeleton from Agent 25's design is **substantially unchanged**. The five type-script binaries plus shared `bls-verify` crate stay as specced. The arithmetic, BLS verification, ed25519 verification, and cell-graph transaction shapes all match Position C.

**What changes**: the framing in §0 and §8 ("What this does NOT touch"). The §0 paragraph and §8 are written for Position A (pure user-space, no mandatory invocation). Under Position C, the bright line is:

- We still **don't touch** `chain/`, `verification/`, `pow/`, CKB-VM, or NC-Max consensus.
- We **do add** a new pattern: every vibeswap-app boundary lock-script (deposit, withdrawal, governance actuation, validator update, slash, emergency pause) **mandates an NCIScoreCell cell-dep** as part of its own type-script invariants. This is **not** a substrate change; it's an app-side enforcement discipline.

**Specific NCI_RUST_DESIGN.md updates**:

1. **§0 framing**: change "NCI lives as user-space cells" to "NCI lives as user-space cells, **mandatorily referenced as cell-deps by every vibeswap-app boundary lock/type-script**."
2. **§4 cell-graph composition**: add a "Tx-VibeSwap-Boundary" template showing how a deposit/withdrawal/governance/etc. transaction must reference an NCIScoreCell as a cell-dep, with the boundary type-script's invariant `assert_nci_authorization(score_celldep, decision_type)`. This is the load-bearing seam.
3. **§8 "What this does NOT touch"**: keep the substrate-untouched language, but add a bullet that vibeswap-app boundary scripts **do** mandate NCI invocation — this is an app-layer discipline, not a substrate patch.
4. **§9 open questions**: add: "Define the canonical list of vibeswap-app boundary transitions that require NCI authorization, and write them into the corresponding lock/type-script specs (DepositCell, WithdrawalCell, ValidatorRegistryUpdate, GovernanceVeto, SlashDispatch, EmergencyPause, FeeParameterUpdate)."
5. **§11 next concrete steps**: add a step between current steps 6 and 7: "**Write the boundary-enforcement spec** at `contracts-ckb/specs/nci-boundary-enforcement.md` enumerating every vibeswap-app boundary transition and its required NCI invariant. This is the doc that turns Position C from architectural decision into per-cell discipline."

The Rust crates themselves are unchanged. The discipline they're embedded in tightens.

---

## 8. The single biggest downstream implication

**The cells are not decoration, but only because every vibeswap-app boundary script now mandates NCI authorization as a cell-dep invariant.** That discipline — `contracts-ckb/specs/nci-boundary-enforcement.md` — is the load-bearing artifact that must be written next, before any vibeswap-app boundary cell ships its lock/type-script Rust code.

Without that spec, Position C reduces to Position A and the cells are decoration. With that spec, Position C is structurally complete and the chain-build is unblocked to proceed on the existing FORK_PLAN trajectory without consensus-code patching.

This is the gate.

---

## 9. Composition trace

For the record:

- `[P·substrate-geometry-match]` — block layer is power-law, cell-graph is binary-per-tx; matched correctly post-Position-C.
- `[P·augmented-mechanism-design]` — mechanism math is sound; invocation contract is the layer above it; both now hold.
- `[P·augmented-governance]` — physics > constitution > governance; physics = NC-Max + cell-graph; constitution = vibeswap-app boundary scripts mandating NCI; governance = NCI-weighted protocol decisions actuated within constitutional bounds.
- `[P·structure-does-the-work]` — security comes from the seam-enforcement structural property, not from a trusted scorer or admin.
- `[P·dissolve-attack-surface]` — block-producer omission attack is dissolved at the vibeswap-app boundary even though it persists at the block layer.
- `[P·honesty-as-structural-load-bearing-property]` — no profitable path exists for a vibeswap-app user to bypass the NCI invariant; the boundary-script enforcement is structural.
- `[F·blockchain-not-contracts]` — we own the chain end-to-end: NCI is enforced because we own the genesis cells AND we own the vibeswap-app boundary scripts. This is a blockchain-level property of our chain, not a contract running on someone else's.
- `[J·vibeswap-ckb-sovereign-pivot]` — sovereign means we control the seam. Position C makes that operational.

---

## 10. Cross-references

- Parent review: `Desktop/architecture-review-2026-06-08-senior-blockchain-architect.md` (CRITICAL #1)
- Spec to update: `contracts-ckb/specs/nci-consensus.md` (rename "consensus" framing per §2 above)
- Plan to update: `contracts-ckb/FORK_PLAN.md` §3.3 (per §5 above)
- Surface to update: `contracts-ckb/AUGMENTATION_SURFACE.md` "NCI consensus integration" entry (per §6 above)
- Rust design to update: `contracts-ckb/consensus-integration/NCI_RUST_DESIGN.md` §0, §4, §8, §9, §11 (per §7 above)
- Spec to write next: `contracts-ckb/specs/nci-boundary-enforcement.md` (the gate per §8 above)
- Primitive: `[P·substrate-geometry-match]`, `[P·augmented-mechanism-design]`, `[P·augmented-governance]`, `[F·blockchain-not-contracts]`
