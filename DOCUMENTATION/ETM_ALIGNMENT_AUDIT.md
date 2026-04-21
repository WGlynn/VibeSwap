# ETM Alignment Audit — Step 1 of the ETM Build Roadmap

> *"yes exactly if we treat blockchain economics as a reflection of the mind."* — Will, 2026-04-21
>
> *"we want to build toward this as a reality. asap."* — Will, 2026-04-21

This document audits each major VibeSwap mechanism against the [Economic Theory of Mind](../../.claude/projects/C--Users-Will/memory/primitive_economic-theory-of-mind.md) (ETM). It is **Step 1 of the four-step ETM Build Roadmap** declared in `vibeswap/.claude/SESSION_STATE.md`:

1. **ETM Alignment Audit** *(this document)* — classify each mechanism as MIRRORS / PARTIALLY MIRRORS / FAILS TO MIRROR.
2. **ETM Build Roadmap** — translate the prioritized gap list (Section 5 of this doc) into concrete engineering work.
3. **Positioning rewrite** — reframe whitepaper / investor summary / Medium top-of-funnel as "cognitive economy externalized."
4. **C38 — first concrete alignment fix** — ship the ONE highest-leverage gap as an RSI cycle.

---

## How to read this document

### Directionality (load-bearing — do not invert)

ETM is **mind → blockchain**, not blockchain → mind. The cognitive economy is primary; on-chain mechanisms are externalizations of cognitive-economic structure into a substrate where they become legible, composable, and multi-participant. So the audit question is **not** *"does this mechanism behave like X familiar pattern from blockchain history?"* The audit question is:

> **Does this mechanism reflect, with structural fidelity, how the underlying cognitive economy already works?**

A mechanism is a faithful reflection when its rent-pressure / density-selection / common-knowledge-anchoring dynamics on the chain match the rent-pressure / density-selection / common-knowledge-anchoring dynamics that govern any healthy memory substrate (human expertise, a primitive library, an LLM context window).

A mechanism fails to reflect when it imposes structure that no cognitive economy would tolerate — typical failure modes: unbounded rent-free state, Sybil-vulnerable reputation, cost-free information flood, fairness-by-policy-not-construction.

### Classification key

| Class | Symbol | Definition |
|---|---|---|
| **MIRRORS** | ✅ | The mechanism's structure directly reflects cognitive-economic dynamics. Rent / density / common-knowledge selection arises naturally from the design. No structural redesign needed; tuning is the only future work. |
| **PARTIALLY MIRRORS** | ◐ | The mechanism reflects the right structure on one or more axes but distorts on others. Identifiable refinement makes it MIRRORS without rewriting. Candidate for refinement-class RSI cycles. |
| **FAILS TO MIRROR** | ✗ | The mechanism imposes structure no cognitive economy would produce. Either redesign with the cognitive-economic geometry as constraint, or excise. Candidate for redesign-class cycles. |

### What this audit is NOT

- **Not a security audit.** ETM-alignment is orthogonal to security correctness. A mechanism can be both ETM-aligned and exploitable, or neither. Security continues to live in TRP / RSI cycles.
- **Not a scope cut.** Mechanisms classified as PARTIALLY MIRRORS or FAILS TO MIRROR are not slated for removal. They are queued for refinement / redesign with ETM as the spec.
- **Not a static snapshot.** The audit is point-in-time as of 2026-04-21. Mechanisms ship and refactor; re-audit on major design changes.
- **Not philosophy without teeth.** Each classification produces a concrete deliverable: MIRRORS → tuning targets; PARTIALLY → refinement targets; FAILS → redesign targets. Section 5 lists the prioritized targets.

### Anti-drift guardrails (active during this write)

The four 2026-04-21 primitives apply throughout:

- **[Economic Theory of Mind](../../.claude/projects/C--Users-Will/memory/primitive_economic-theory-of-mind.md)** — the spec being audited against. Re-read on any ambiguity.
- **[Pattern-Match Drift on Novelty](../../.claude/projects/C--Users-Will/memory/primitive_pattern-match-drift-on-novelty.md)** — never round a VibeSwap primitive to the nearest familiar pattern. The novelty is the work.
- **[Token Mindfulness](../../.claude/projects/C--Users-Will/memory/primitive_token-mindfulness.md)** — direct-write with Edit-append; verify on disk; deliver content not content-about-content.
- **[JUL is Primary Liquidity](../../.claude/projects/C--Users-Will/memory/feedback_jul-is-primary-liquidity.md)** — JUL is money + PoW pillar (two roles), never a bootstrap token.

---

## Table of contents

- [Section 1 — Substrate-layer mechanisms](#section-1--substrate-layer-mechanisms)
  - [1.1 CKB State-Rent (StateRentVault + cell occupancy)](#11-ckb-state-rent)
  - [1.2 Secondary Issuance (rent source)](#12-secondary-issuance)
  - [1.3 Operator-Cell Assignment Layer (OCR V1 + V2a)](#13-operator-cell-assignment-layer)
  - [1.4 Content Merkle Registry / PAS (V2b)](#14-content-merkle-registry--pas)
- [Section 2 — Consensus and identity mechanisms](#section-2--consensus-and-identity-mechanisms)
  - [2.1 NCI 3D Consensus weight function](#21-nci-3d-consensus-weight-function)
  - [2.2 Proof of Mind (PoM)](#22-proof-of-mind-pom)
  - [2.3 Soulbound Identity / Heartbeat](#23-soulbound-identity--heartbeat)
- [Section 3 — Three-token monetary system](#section-3--three-token-monetary-system)
  - [3.1 JUL — primary liquidity (money + PoW pillar)](#31-jul--primary-liquidity)
  - [3.2 VIBE — governance share](#32-vibe--governance-share)
  - [3.3 CKB-native — state-rent capital](#33-ckb-native--state-rent-capital)
- [Section 4 — Mechanism layer](#section-4--mechanism-layer)
  - [4.1 Commit-Reveal Batch Auction (CRA)](#41-commit-reveal-batch-auction)
  - [4.2 True Price Oracle (TPO)](#42-true-price-oracle)
  - [4.3 Shapley Distribution / FractalShapley](#43-shapley-distribution--fractalshapley)
  - [4.4 VibeAMM constant-product](#44-vibeamm-constant-product)
  - [4.5 Lawson Floor](#45-lawson-floor)
  - [4.6 Contribution DAG](#46-contribution-dag)
- [Section 5 — Defense layer mechanisms](#section-5--defense-layer-mechanisms)
  - [5.1 Siren Protocol](#51-siren-protocol)
  - [5.2 Clawback Cascade](#52-clawback-cascade)
  - [5.3 Circuit Breakers / TWAP guards](#53-circuit-breakers--twap-guards)
- [Section 6 — Summary table](#section-6--summary-table)
- [Section 7 — Prioritized gap list (feeds Step 2 Build Roadmap)](#section-7--prioritized-gap-list)

## Section 1 — Substrate-layer mechanisms

The substrate layer is where ETM's externalization is most direct: state occupies cells, cells pay rent, dilution selects for density and common-knowledge anchoring. Every mechanism in this section should map cleanly to ETM's four-layer model (cell / rent / who-pays / what-emerges). When they do, they MIRROR; when the mapping requires distortion, they PARTIALLY MIRROR; when the mapping breaks, they FAIL.

### 1.1 CKB State-Rent

**What it is.** `contracts/consensus/StateRentVault.sol` holds a population of cells (literal `Cell` structs, each with `owner / capacity / occupiedBytes / lockedNative / lastRentTick / active`). Cells lock CKB-native to occupy bytes; secondary issuance (Section 1.2) dilutes the locked stock continuously. A cell whose locked-stake-share drops below its capacity-share fails its rent-test and is reapable.

**ETM analysis.** Direct, point-for-point externalization of ETM's Layer 1–4:

- *Layer 1 (cell)*: a literal cell with explicit capacity-measured-in-bytes. Substrate role exact.
- *Layer 2 (rent)*: continuous, ambient, paid via dilution-of-stock-share rather than per-block charges. The continuity is structurally enforced by the issuance schedule, not by an external job. **This is the structural property ETM demands** — rent must be a continuous ambient pressure, not a discrete fee, because discrete fees admit gaming via timing while continuous pressure cannot be timed-out-of.
- *Layer 3 (who pays)*: load-bearing cells (those whose data is referenced, valuable, used) attract their owners to add stake; orphan cells do not. Density (high information per byte locked) reduces rent burden directly. Common-knowledge cells (cited by many other contracts / reads / writes) attract many participants whose stake-additions distribute the rent burden.
- *Layer 4 (what emerges)*: the population converges on dense, widely-cited cells; orphan/diffuse cells decay out via reaping; new experiments enter at the bottom and either climb the citation/density ladder or vanish.

**This is the canonical instantiation.** ETM was articulated in the context of CKB state-rent; the rest of the audit measures other mechanisms against the standard CKB-state-rent sets.

**Classification: ✅ MIRRORS.**

**Tuning targets** (no redesign — these are parameter-space refinements):
- Reaping cadence — how often the dilution-driven rent-test fires. Too slow and decayed cells overstay; too fast and brief-but-valuable cells get evicted before they can earn citations. Empirical work post-mainnet.
- Bond-to-bytes elasticity — currently linear (`lockedNative` proportional to `occupiedBytes`). Could be sublinear (rewards density) or superlinear (penalizes hoarding). ETM neutral as long as monotone-increasing; choice is mechanism-economics, not alignment.

### 1.2 Secondary Issuance

**What it is.** `contracts/consensus/SecondaryIssuanceController.sol` continuously mints CKB-native at a fixed schedule, splitting newly-issued stock among (occupiers, DAO treasury, miners). The issuance is the rent source for Section 1.1: every issuance event reduces every existing locker's share of total supply.

**ETM analysis.** Issuance is **the engine that makes rent work.** Without continuous dilution, a cell's locked stake would retain full purchasing-share forever; rent would be a one-time fee, not continuous pressure. Issuance converts the one-time lock into a continuous-decay obligation. This matches ETM exactly: in cognition, the "issuance" is the continuous arrival of new candidate items competing for finite cognitive capacity. New thoughts, new experiences, new candidate primitives — they don't replace existing memory by overwriting; they dilute existing memory by competing for the same finite substrate. Old memory survives only by being valuable enough to retain its share against the constant arrival of new contenders.

The three-way split (occupiers / DAO / miners) preserves ETM-alignment so long as each recipient class corresponds to a load-bearing role:

- *Occupiers*: rebate cells that are paying their rent, reducing the dilution they actually face. ETM-aligned — load-bearing cells deserve relief; the dilution they "pay" is their share of the universal pressure, but their delivered value entitles them to continued tenure.
- *DAO treasury*: funds the substrate's own maintenance (governance, defense, common goods). ETM-aligned — corresponds to the metabolic-overhead component of any cognitive substrate.
- *Miners*: pays the consensus-and-PoW work that secures the substrate itself. ETM-aligned — corresponds to the deep-infrastructure cost (bodily energy supporting cognition).

The proportional-scaling fix shipped in Cycle 4 (`NCI-003/MON-006`) handles the case where occupiers + DAO claims exceed total issuance, scaling all claimants pro-rata. ETM-aligned — proportional scaling preserves the relative rent-paying-power signal without any party getting unbounded priority. **Critical**: do NOT replace this with priority-ordering (occupiers-first or DAO-first), which would inject discretion where ETM demands structural neutrality.

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- Issuance rate — sets the strength of the rent pressure. Too low → stagnation (old cells never decay); too high → churn (good cells evicted before earning citations). Tunable via DAO within physics-set bounds.
- Split ratios — the (occupier / DAO / miner) split is a parameter, not a structural axis. ETM-neutral within reasonable bands.

### 1.3 Operator-Cell Assignment Layer

**What it is.** `contracts/consensus/OperatorCellRegistry.sol` (V1: opt-in claim with per-cell bond; admin slashing) plus V2a permissionless availability challenge (Cycle 31: challenge → respond → claim-slash with 50/50 split). Operators post a bond per cell they claim to serve; failure to respond to a challenge within window slashes the bond.

**ETM analysis.** OCR is the **rent layer for operator attention** as a distinct cognitive resource from cell-storage. Storage is one resource; the operational labor of serving cell reads/writes is another. Without a rent layer for operator-attention, the cognitive economy has free-riders — operators claim credit for serving cells they aren't actually serving. ETM demands a continuous, structural rent on the *attention claim*, not just on the storage occupancy. OCR provides exactly that: the bond is at-risk continuously while the assignment is held; failure to respond proves the attention was not delivered.

V2a's permissionless challenge layer is the load-bearing piece. Admin-only slashing (V1) is governance-as-rent — discretion-driven, slow, captureable. V2a converts the rent enforcement to *math-enforced via permissionless game*: any participant can fire a challenge at the cost of their own bond; failure to respond triggers automatic slash, success returns the challenger's bond. This matches ETM's structural-not-discretionary requirement.

The cooldown (24hr per cell) plus paper-cited window (30min response) plus 50/50 slash split (half to slashPool, half to challenger) come from the Augmented Mechanism Design paper §6.1 / §6.5 — the calibration is paper-aligned, which is itself ETM-aligned because the paper's augmentation-not-replacement principle is the ETM-aligned approach to mechanism design.

**Classification: ✅ MIRRORS.**

**Refinement targets** (V2c queued, non-urgent):
- V2c threshold attestors — multiple operators sign jointly on availability claims; reduces the per-operator burden of unilateral availability proof. ETM-neutral but could increase honest-operator participation rate.
- Bond elasticity — currently flat per-cell. Could scale with cell value (high-value cells require larger bonds), which ETM-aligns more tightly with "rent proportional to capacity-occupied."

### 1.4 Content Merkle Registry / PAS

**What it is.** `contracts/consensus/ContentMerkleRegistry.sol` (V2b, Cycle 32) — operators commit Merkle roots of cell-content chunks; permissionless challenge picks K=16 random chunks; operator must produce Merkle proofs for all K within window or be slashed. Provable Availability Sampling (PAS) layered on top of OCR's V2a liveness challenge.

**ETM analysis.** PAS extends the rent dimension from "operator was reachable" to "operator actually has the content." V2a alone catches the operator-offline case; V2b catches the operator-online-but-content-deleted case. Without V2b, an operator could pass V2a (respond to liveness pings) while having silently dropped the content payload — collecting rewards for serving cells they cannot actually serve. ETM demands rent proportional to *delivered value*, not to *appearance of delivery*; V2b closes the gap between appearance and delivery.

The K=16 / all-must-pass design comes from DAS literature. The honest-operator pass rate is `0.999^16 ≈ 98.4%` for 99.9%-honest cells; the 1.6% false-positive rate is acceptable given the bond-recovery path (challenger's bond returns on responder's correct answer, attentiveness reward flows to operator). ETM-neutral on K (parameter, not structural axis).

The cross-challenge coexistence — V2a and V2b run on separate state, slash paths refund the non-winning side's challenger — is the right structural choice. Two orthogonal rent dimensions (attention to liveness, attention to content), each with independent settlement; ETM demands both, and the implementation respects both.

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- K parameter under load — at chunk_count = 1M with K=16, response gas is ~10M (within block limit but eats budget). Future cycle may want adaptive K (lower K for hotter cells, higher K for colder cells where the slash-to-bond ratio justifies more rigorous sampling).
- SNARK migration (V2c+) — proof-batching via SNARK could collapse K-proofs into one O(log) verification. ETM-neutral (mechanism stays structural; only the implementation changes).



## Section 2 — Consensus and identity mechanisms

The substrate-layer mechanisms (Section 1) externalize the *what* — what state is, what rent is, who pays. The consensus / identity layer externalizes the *who* — which participants count, with what weight, on what evidence. ETM demands that the *who* layer also reflect cognitive-economic structure: weight should accrue to participants whose contributions would survive rent-pressure in a healthy cognitive economy, and the weight signal should be hard to fake along orthogonal dimensions (no single resource — money, energy, time — should be able to monopolize "who counts").

### 2.1 NCI 3D Consensus weight function

**What it is.** `contracts/consensus/NakamotoConsensusInfinity.sol` defines node weight as `W(node) = 0.10 × PoW + 0.30 × PoS + 0.60 × PoM`, where:

- *PoW* is log₂-scaled cumulative mining solutions (backed by `Joule.sol` / JUL).
- *PoS* is CKB-native stake locked for consensus (1 stake = 1e18 weight units).
- *PoM* is mind-score from `SoulboundIdentity + ContributionDAG + VibeCode + AgentReputation`, multiplied by `POM_SCALE`.

The weights sum to 1.00; the dimensions are orthogonal (each resource attacks a different axis); attacking the consensus requires coordinated compromise across all three.

**ETM analysis.** The 3D weight function is one of the highest-fidelity ETM externalizations in the codebase. Each pillar maps to an orthogonal cognitive-economic resource:

- *PoW (10%) — ambient-work signal.* Cognition has an analogous dimension: the energy continuously spent demonstrating real engagement (problem-solving cycles, attention sustained over time, deep-work bouts). PoW makes this dimension on-chain: every JUL minted is verifiable SHA-256 work, no shortcut, no shortcut-via-capital. The log₂ scaling is critical — linear PoW would let compute-rich actors dominate; log₂ flattens the curve so a doubling of effort yields only one more weight unit. ETM-aligned because cognitive contribution doesn't scale linearly with hours either; the 100th hour of work on the same problem is worth far less than the first hour, and the cognitive economy reflects this in its diminishing-returns reward shape.
- *PoS (30%) — rent-paying capacity.* Stake locked = capacity to pay rent on consensus participation, the same way locking CKB-native to occupy a cell is rent-paying-power for substrate-cells (Section 1.1). Linear-in-stake (1:1 weight) is correct here because PoS is denominated in the same unit as the rent itself; log-scaling stake would be a category error.
- *PoM (60% — the dominant pillar) — common-knowledge anchoring.* Time-accumulated, soulbound, contribution-weighted, citation-cross-referenced. PoM is the on-chain externalization of the cognitive-economic property that *common-knowledge cells anchor the substrate*. The 60% weight is load-bearing: it sets common-knowledge as the senior signal, which is exactly the seniority ETM demands (density alone without recognition is isolated; rent-paying alone without contribution is plutocracy; common-knowledge anchoring is what keeps the substrate coherent).

The orthogonality property is critical for ETM-alignment. Cognition has the same orthogonality: you cannot fake contribution by spending energy (PoW does not buy PoM), you cannot fake reputation by holding capital (PoS does not buy PoM), you cannot fake recognition by mining hashes. Each axis defends a distinct attack surface. The 3D consensus inherits this property structurally, not by policy.

**Pattern-match drift warning.** The 3D consensus is a high-drift zone (per `primitive_pattern-match-drift-on-novelty.md`). Do **not** round NCI to "weighted average of PoW and PoS with reputation bonus." That framing collapses the orthogonality and treats PoM as a policy add-on rather than a structural senior pillar. The correct framing is *three orthogonal pillars, weighted to reflect cognitive seniority of common-knowledge*.

**Classification: ✅ MIRRORS.**

**Tuning targets** (no redesign):
- Pillar weights — 60/30/10 reflects current judgment on cognitive seniority. As the network matures and contribution attribution becomes more reliable, PoM weight could plausibly rise (70%+); if attribution proves gameable, weight would shift back. ETM-neutral on exact ratio so long as PoM remains senior.
- Log-scale base for PoW — `log₂` is the current choice. `ln` or `log₁₀` would shift the diminishing-returns curve. Mechanism-economics, not alignment.

### 2.2 Proof of Mind (PoM)

**What it is.** PoM is the senior pillar of the NCI weight function (60%). Operationally, it is the scalar score of a participant's cognitive-economic contribution to the network, computed from several backing contracts: `contracts/identity/SoulboundIdentity.sol` (non-transferable identity), `contracts/identity/ContributionDAG.sol` (directed-acyclic graph of attested contributions), `contracts/identity/VibeCode.sol` + `contracts/identity/AgentRegistry.sol` (recognized contribution surfaces).

**ETM analysis.** PoM is the highest-fidelity externalization of ETM's **common-knowledge anchoring** property available on any blockchain to date. The three properties that make it work:

1. **Time-accumulated, not purchasable.** PoM score cannot be bought because soulbound identity prevents transfer of the underlying identity token. A wealthy actor cannot arrive and buy themselves a high PoM score; they must accumulate contributions over real time. This mirrors cognition: expertise cannot be purchased, only acquired through sustained engagement. A cognitive economy where reputation is for sale produces fake experts; ETM demands the opposite, and PoM enforces it structurally.

2. **Attested by cross-referencing peers.** Contributions are scored via the Contribution DAG — each contribution is a node, references are edges, score accrues to nodes with many incoming edges (citations) from other high-PoM participants. Pure citation-count is gameable by Sybil mutual-citation rings; weighting citations by citer's PoM breaks the Sybil attack because high-PoM citers cannot themselves be Sybils (they too had to accumulate PoM over time). This is the PageRank-style recursive-authority property applied to contribution attribution, and it matches cognitive economies exactly: in academia, a citation from a Nobel laureate weighs more than a citation from an anonymous blog, and the Nobel laureate's weight came from her own citations-from-weighty-peers over decades.

3. **Verifiable on-chain via the DAG.** Every claim of PoM reputation resolves to a concrete path through the DAG — which nodes cite me, which nodes cite them, all the way back to the genesis of the reputation substrate. The transparency is load-bearing because ETM's common-knowledge property requires *verifiable* status, not self-declared status. On-chain DAG gives the verifiability that cognitive economies accomplish via institutional memory (conferences, journals, citation graphs) but with lower overhead and cross-domain consistency.

**Pattern-match drift warning.** PoM is explicitly called out in `primitive_pattern-match-drift-on-novelty.md` as a high-drift zone. Do **not** round PoM to "reputation score" or "trust score." Those framings miss the time-accumulated + soulbound + citation-weighted-by-cited-weight property set, which is the complete structural property that makes PoM work. It's closer to "on-chain academic reputation" than "DeFi trust score," but even that analogy falls short because academic reputation has no analog of the soulbound property — a dead academic's h-index doesn't transfer to their heirs.

The 60% weight in NCI is the right weight *because* PoM is the senior common-knowledge signal. ETM would predict that any healthy cognitive economy puts common-knowledge at the top of its weight stack; NCI complies.

**Classification: ✅ MIRRORS.**

**Refinement targets**:
- DAG traversal cost for large participation sets. As PoM-node count grows, recursive-authority scoring becomes expensive. Future cycle may want cached sub-scores with periodic recomputation, or SNARK-backed authority proofs. ETM-neutral on implementation.
- Score-decay calibration. PoM score should decay modestly for inactive participants (cognitive seniority decays too — a decade out of the field costs reputation), but the decay rate is sensitive. Too fast → penalizes sabbaticals; too slow → allows zombie-authority. Empirical tuning.

### 2.3 Soulbound Identity and Heartbeat

**What it is.** `contracts/identity/SoulboundIdentity.sol` issues non-transferable identity tokens — once bound to an address, they cannot move. `contracts/consensus/NakamotoConsensusInfinity.sol` enforces validator heartbeats — nodes must emit a liveness signal within `HEARTBEAT_WINDOW`; failure triggers downtime slashing (`SLASH_DOWNTIME = 5%` per NCI constant) and eventual deactivation. Together these ensure that participation is bound to a single time-continuous entity, not a transferable asset, and that entity must actively demonstrate presence.

**ETM analysis.** The soulbound + heartbeat pair externalizes a property cognitive economies always have but blockchains historically don't: **continuity-of-identity over time is the unit that accumulates rent-paying power.** In cognition, your reputation accrues to *you* — not to a transferable token you could sell. In most PoS blockchains, stake is the unit; stake is transferable; reputation-weight moves with the coin. That structure fails ETM's seniority-of-common-knowledge property because it makes the senior signal a liquid asset.

Soulbound fixes this by making the identity-unit non-transferable. Heartbeat fixes the adjacent failure: soulbound alone lets a long-inactive identity retain weight forever (dead-hand problem). Continuous heartbeat is the continuous-rent-payment in the identity dimension — presence must be demonstrated continuously, same as any other rent.

The C24 primitive *Enforced Liveness Signal* (`primitive_enforced-liveness-signal.md`) made the load-bearing observation: a heartbeat CONSTANT without a corresponding gate or eviction is theater. The primitive flagged this as a failure mode and the implementation corrected: NCI's heartbeat is paired with `_checkHeartbeats` (called on epoch advance) that deactivates non-heartbeating validators. Without that teeth, the heartbeat constant would have been ETM-failing (rent-declared but not rent-enforced). With the teeth, it's ETM-aligned.

The heartbeat + soulbound pair closes the continuity loop: (a) identity cannot be transferred, so weight always corresponds to the original-accruing participant; (b) identity must be continuously maintained by liveness, so dormant identities decay.

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- `HEARTBEAT_WINDOW` — currently fixed. Cognitive economies don't have uniform attention demands across all participants; scholars can be heads-down for months without reputational decay, but active-duty professionals cannot be absent for days. A future refinement might make the window role-specific (e.g. tied to operational class), though the added complexity may not earn its rent.
- `SLASH_DOWNTIME` = 5%. Probably appropriate for casual liveness failure; may need escalation for repeated failures. Parameter-space, not alignment.

<!-- SECTION-3-MARKER -->

<!-- SECTION-4-MARKER -->

<!-- SECTION-5-MARKER -->

<!-- SECTION-6-MARKER -->

<!-- SECTION-7-MARKER -->
