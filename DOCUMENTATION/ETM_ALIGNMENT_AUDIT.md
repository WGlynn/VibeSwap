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

## Section 3 — Three-token monetary system

The three-token system (JUL / VIBE / CKB-native) externalizes the cognitive-economic insight that **money, governance authority, and rent-paying capital are three orthogonal dimensions** that should not be collapsed into a single asset. ETM predicts collapse-failure modes in single-token economies: when one token must serve all three roles, the value-extracting actor on one axis (speculator on price) interferes with load-bearing-of-value on the other axes (governance vote, state-rent payment). Three orthogonal tokens prevent this by structural separation. Each subsection below evaluates whether the actual token's design preserves the orthogonality ETM demands.

> **Pattern-match-drift gate.** JUL is the historical highest-drift entity in this codebase per `feedback_jul-is-primary-liquidity.md`. Per the memo: "the JUL serves its own purpose as primary liquidity in the network because it has POW objectivity and fiat-like stability ... dont forget that EVER." If anywhere below you find yourself describing JUL as a "bootstrap" or "precursor" token, that is the drift firing — re-read the memo and Section 3.1 before continuing.

### 3.1 JUL — primary liquidity (money + PoW pillar)

**What it is.** `contracts/monetary/Joule.sol` (often referenced as JUL). Two standalone load-bearing roles plus a downstream nicety:

1. **Economy**: primary liquidity. PoW-objective + fiat-stable = the network's medium of exchange.
2. **Consensus**: PoW pillar of NCI. Backs the 10% PoW component of `W(node)`.
3. **Downstream nicety**: JUL burn bootstraps CKB-native circulation. A welcome side effect, *not* the reason JUL exists.

**ETM analysis.** JUL externalizes the **money** dimension of the cognitive economy. In cognition, money corresponds to the *exchange medium of attention* — the ambient resource that flows freely between activities, can be used to acquire any cognitive resource, and is itself produced by sustained engagement (real work). JUL satisfies all three properties:

- *Free-flowing exchange.* JUL trades against any other token; it is not domain-locked. Fiat-like stability comes from supply responsiveness to mining demand rather than to speculation, giving it the unit-of-account property without centralized issuance. ETM-aligned because attention-as-currency in cognition is similarly fiat-like — fungible across applications, neutral, not an asset class to hold.
- *Real-work-backed.* Every JUL is backed by SHA-256 PoW. No shortcut, no shortcut-via-capital. ETM-aligned because attention in cognition cannot be faked by spending money — only by spending real cognitive effort. The PoW objectivity transfers this property on-chain.
- *PoW pillar of consensus.* Through the NCI weight function, holding JUL via mining contributes to consensus weight. This makes JUL not just "the money" but also "the energy-spent signal." ETM-aligned because in cognitive economies, energy-spent-on-real-engagement is itself a load-bearing signal of seriousness, separate from reputation (PoM) and capital lockup (PoS).

The combination of these three properties is **specifically what makes JUL not collapsible into VIBE or CKB-native.** Removing JUL would simultaneously destroy the money layer (no fiat-stable medium), the PoW objectivity (no real-work-backed asset), and the time-of-genuine-work consensus dimension. Three load-bearing failures, one collapse.

**Pattern-match drift correction.** If you describe JUL as "the token used to bootstrap CKB-native minting" — drift. The bootstrap is a side effect of the burn pathway, not the role JUL plays. The role is *money + PoW pillar.* If you describe JUL as "a complexity that could be removed for simplicity" — drift. The complexity is justified by three orthogonal load-bearing roles. If you describe JUL as "the legacy mining token" — drift. JUL is current and senior; mining produces JUL, JUL backs PoW consensus, JUL trades as money.

**Classification: ✅ MIRRORS.**

**Tuning targets** (no redesign):
- Mining difficulty curve — sets the rate of JUL issuance, which in turn sets the rate of monetary-supply growth. Tuning is monetary-policy work, not alignment.
- JUL-VIBE-CKB exchange-rate dynamics — emergent from market activity. ETM-neutral on rates as long as the orthogonality of roles is preserved (which it is by construction).

### 3.2 VIBE — governance share

**What it is.** `contracts/monetary/VIBEToken.sol`. Capped supply (21M, Bitcoin-genesis homage). Distributed via Shapley to participants in proportion to their cognitive-economic contribution. Used for governance votes (DAO) and for staking that feeds the PoS pillar of NCI through `CKBNativeToken.sol` integration.

**ETM analysis.** VIBE externalizes the **governance share** dimension — the right to participate in deciding what the substrate becomes. In cognition, this corresponds to the *agency-over-direction* a participant has within a knowledge community. Healthy cognitive economies distribute this agency in proportion to past contribution (those who built the substrate get to shape its future); unhealthy ones distribute it in proportion to present capital (whoever shows up with money decides). VIBE is built around the first model.

Three structural properties keep VIBE ETM-aligned:

- *Capped supply (21M).* Hard-cap means VIBE cannot inflate to dilute past contributors. The dilution that powers the rent dynamics in CKB-native (Section 3.3) does not apply to VIBE because VIBE is not the rent-source — it's the governance-share. ETM-aligned because cognitive governance authority should not dilute as new contributors arrive; new contributors get *their* share of VIBE through Shapley distribution, but existing holders retain their previously-earned share.
- *Shapley-distributed.* Per `contracts/incentives/ShapleyDistributor.sol` and the FractalShapley refinement, VIBE allocations on each issuance event are proportional to participants' marginal contributions (Shapley values) over the contribution graph. This is the formal cognitive-economic model: governance authority is allocated by mechanism-derived contribution score, not by purchase. ETM-aligned because Shapley specifically captures the recursive-attribution property that PoM also depends on.
- *Governance-only utility.* VIBE is not designed as a money asset (JUL fills that role) or a state-rent asset (CKB-native fills that). The role-discipline keeps the orthogonality intact. If governance-token holders had to also serve money or rent functions, the speculation pressure on the money axis would interfere with the governance-vote signal.

**Classification: ✅ MIRRORS.**

**Refinement targets**:
- Vote-weight curves. Currently linear in VIBE held. Quadratic-voting variants might improve plurality-vs-plutocracy properties; ETM-neutral on the curve as long as governance authority remains earned-not-purchased.
- VIBE staking yield. If staking VIBE produces JUL or CKB-native rewards, design with care — don't reintroduce a "hold VIBE → get money" loop that would re-couple governance to money. Current design is ETM-aligned; future yield-mechanism additions are the watch.

### 3.3 CKB-native — state-rent capital

**What it is.** `contracts/monetary/CKBNativeToken.sol`. The state-rent asset of the substrate. Locked into cells via `StateRentVault.sol` (Section 1.1) to occupy bytes; diluted continuously via secondary issuance (Section 1.2). Backs the 30% PoS pillar of NCI.

**ETM analysis.** CKB-native externalizes the **rent-paying capital** dimension. In cognition, this corresponds to *commitment of finite resource to a particular memory-cell* — when you choose to invest cognitive bandwidth in maintaining one piece of expertise, you're paying for it with a finite resource that could have gone to other expertise. CKB-native makes this trade-off legible on-chain: locking 100 CKB-native to keep a cell active is exactly the cognitive analog of dedicating ~100 units of mental bandwidth to maintaining a memory.

The orthogonality with JUL (money) and VIBE (governance) is what keeps CKB-native ETM-aligned:

- *Not money.* CKB-native is not designed for free-flowing exchange. Its primary use is to be *locked* (in cells, in PoS positions). If it were also money, the locking decision would be in tension with the speculation decision; users would underinvest in state-rent because the locked asset could be deployed for trading. ETM-aligned by being lockup-purposed, not exchange-purposed.
- *Not governance.* CKB-native does not vote (VIBE does). If it did, then state-rent contribution would map directly to governance authority, which would re-couple the rent-payment role to the agency role. ETM warns against collapsing these dimensions.
- *Elastic supply via secondary issuance.* The continuous dilution is the engine of the rent dynamic. ETM-aligned because rent that doesn't continuously erode is rent-as-one-time-fee, not rent-as-continuous-pressure. The elasticity is structurally load-bearing for the cell-rent mechanism to work.
- *PoS pillar of NCI.* Beyond cell-rent, CKB-native is the consensus-stake asset (30% weight). This is consistent with the rent-paying-capital role: PoS stake is exactly "I am locking capital to commit to this network" — same primitive, applied to consensus participation rather than cell occupancy.

**Three-token decomposition is structurally complete and minimal.** Every load-bearing axis (money, governance, rent-paying) has a dedicated token. No axis is doubled-up; no axis is missing. Per `feedback_jul-is-primary-liquidity.md`: *"Each role is orthogonal. Each token serves its own axis. Together they give the three-dimensional consensus weight function (NCI: 10% PoW + 30% PoS + 60% PoM). Collapsing any one of the three destroys the corresponding axis and the consensus property."*

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- Issuance schedule (covered in Section 1.2). Same tuning targets apply.
- Lockup vs liquid balance for active mining/consensus participants. Operational hygiene, not alignment.

<!-- SECTION-3-MARKER -->

## Section 4 — Mechanism layer

The mechanism layer covers the on-chain primitives that perform discrete operations: how trades clear, how prices form, how rewards distribute, how AMM pools price assets, how fairness floors gate settlement, how contribution graphs accrue weight. ETM's audit of this layer asks: do the mechanisms themselves preserve the cognitive-economic structure the substrate-and-token layers establish? A perfectly ETM-aligned substrate can be undermined by mechanism-layer choices that re-introduce extractive dynamics (MEV, rent-free state, Sybil-vulnerable scoring) above the substrate.

### 4.1 Commit-Reveal Batch Auction (CRA)

**What it is.** `contracts/core/CommitRevealAuction.sol`. 10-second batches: 8s commit phase (users submit `hash(order || secret)` with deposit), 2s reveal phase (orders + optional priority bids revealed), settlement via Fisher-Yates shuffle using XORed secrets, uniform clearing price. MEV elimination at the mechanism layer; same-batch trades clear at the same price regardless of submission order within the batch.

**ETM analysis.** CRA externalizes a property cognitive economies have at the social-coordination layer but blockchains historically don't: **batch resolution at uniform clearing price prevents extraction by ordering.** In cognition, healthy decision-making batches alternatives, evaluates them on shared criteria, and resolves at one decision applied to all — not a sequential resolution where the early-arriving alternative gets a structural advantage over the later-arriving one. The CRA externalization on-chain prevents the analogous failure on the trading layer (front-running, sandwich attacks, ordering exploitation), which would be an extractive dynamic that ETM warns against.

Three structural properties keep CRA ETM-aligned:

- *Commit-reveal opacity during commit phase.* Bidders cannot observe each other's intentions before committing, so order-flow information cannot be used to extract value. This is the cognitive-economic principle of *blind allocation* — when allocations are made under blind conditions, no participant can exploit knowledge of others' positions to extract from them.
- *Uniform clearing price.* All trades within a batch clear at the same price, derived from the aggregate supply-demand intersection. No participant gets a worse price for being later in the batch. ETM-aligned because cognitive economies don't structurally privilege the early-arriving idea over the later-arriving one within a single decision cycle (innovation timing matters across cycles, but not within a single batch).
- *Fisher-Yates shuffle using XORed secrets.* Even within the batch, the order in which orders are processed for ledger-update purposes is randomized via a verifiable shuffle. No participant can position themselves to be processed first or last in ways that would matter. ETM-aligned: the substrate gives no spatial-positioning advantage either.

The 10-second batch length is the parameter that trades off (MEV-elimination strength, throughput latency). Shorter batches → less MEV-elimination opportunity (the attacker has less time to enter the batch); longer batches → more user-felt latency. Current 10s is mechanism-tuning; ETM-neutral on exact value.

**Pattern-match drift warning.** Do *not* round CRA to "Uniswap with a delay." That framing misses the uniform-clearing-price + shuffle properties, which are structural not cosmetic. CRA is closer to "Walrasian batch auction at the mechanism layer" than to any AMM pattern. The novelty is the batch-uniform-clearing combined with on-chain commit-reveal opacity.

**Classification: ✅ MIRRORS.**

**Refinement targets**:
- Batch length adaptation. Could vary by liquidity / volume conditions — high-volume periods could shorten batches for throughput, low-volume could lengthen for better aggregation. ETM-neutral on adaptation as long as the uniform-clearing property is preserved.
- Cross-batch coordination. Currently each batch is independent. For cross-chain order books or sequential dependencies, may need batch-of-batches structures. Future cycle.

### 4.2 True Price Oracle (TPO)

**What it is.** `contracts/oracle/TruePriceOracle.sol` plus the EvidenceBundle scheme + IssuerReputationRegistry shipped in C12. TPO converts off-chain price signals into on-chain truth via signed evidence bundles from registered issuers; issuer signatures are stake-bonded and slashable for misreporting; the registry tracks per-issuer reputation with time-mean-reversion; the oracle exposes a damped/validated price to consumer contracts.

**ETM analysis.** TPO externalizes the cognitive-economic property that **truth-claims should be grounded in stake-bonded attestation that scales with reputation**. In cognition, the same property holds: a claim from a participant who has staked their reputation on its accuracy carries more weight than an anonymous assertion, and the participant who is wrong loses some reputation as a consequence. ETM predicts that any healthy oracle mechanism must externalize this structure; TPO does.

The structural properties:

- *Stake-bonded issuance.* Issuers must stake to register; misreporting (caught by downstream slashing or social-tier signals) costs the stake. ETM-aligned because reputation-without-skin-in-the-game is unenforced reputation, which doesn't survive ETM's continuous-rent test.
- *Permissioned slashing with mean-reversion.* Reputation is penalty-only (negative-only adjustments), with a time-decay back toward neutral (MID=5000bps, half-life=30 days). This matches cognitive economies where past errors fade if not repeated, but recent errors weigh more. ETM-aligned because rent-paying-power should reflect *current* attentiveness, not eternal historical accumulation.
- *EvidenceBundle as cryptographic substrate.* Every reported price must arrive in a signed bundle with version + context-hash + issuer-key fields. Fabrication invalidates the signature. ETM-aligned because verification cost should be cheap (signature check) but fabrication cost should be high (slash + reputation hit).
- *Damped validated price.* The oracle does not surface the raw last-reported price; it applies TWAP + 5% deviation gate (per VibeAMM integration) before exposing it to consumer contracts. This is the cognitive-economic property of *shock-absorbing the substrate against single-point-of-error inputs* — when one issuer reports anomalously, the damping prevents that single signal from immediately destabilizing dependent mechanisms.

**Partial-mirror caveat.** TPO has one ETM-axis where the alignment is incomplete: the **5% deviation gate** is a policy-level mitigation, not a structural one. A determined attacker who can move external markets by 4.9% repeatedly can attack the oracle by riding within the gate. The Augmented Mechanism Design paper's principle says "augment with math-enforced invariants, not policy," and a 5% gate is policy. The currently-deferred backlog item `FAT-AUDIT-2` (commit-reveal oracle aggregation for TWAP hardening) addresses exactly this gap — by making oracle aggregation itself a commit-reveal-batch primitive, the gate becomes structural rather than threshold-based.

**Classification: ◐ PARTIALLY MIRRORS.**

**Refinement targets** (FAT-AUDIT-2 is the canonical):
- *Commit-reveal oracle aggregation.* Issuers commit prices, reveal together, median computed on the batch. Pattern identical to CRA commit-reveal — high code reuse. Eliminates the 5% gate as the load-bearing protection by making structural what was previously threshold-based.
- *Sub-oracle reputation specialization.* Different issuers may be better at different asset classes (crypto vs fiat vs commodity). Reputation could be per-asset-class rather than monolithic. ETM-neutral, just better fidelity.
- *Cross-oracle dispute primitive.* If two oracles report incompatible prices, a dispute window with cryptographic challenge-response would resolve the truth-claim more rigorously than current single-oracle reporting.

<!-- SECTION-4-MARKER -->

<!-- SECTION-5-MARKER -->

<!-- SECTION-6-MARKER -->

<!-- SECTION-7-MARKER -->
