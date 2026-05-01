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

### 4.3 Shapley Distribution / FractalShapley

**What it is.** `contracts/incentives/ShapleyDistributor.sol` and the FractalShapley refinement in adjacent contracts. Shapley value computation distributes rewards from a contribution pool to participants in proportion to their *marginal* contribution — the average increment they bring to all possible coalitions of contributors. FractalShapley extends this recursively: each contribution is itself decomposable into sub-contributions that get their own sub-Shapley distribution.

**ETM analysis.** Shapley distribution externalizes the **fair-attribution-of-collective-output** property. In cognition, when many participants jointly produce something, the cognitive economy needs a way to allocate credit that is (a) fair to the marginal contributor (their share reflects what they actually added, not just headcount), (b) not gameable by ordering or coalition formation, and (c) consistent (the same contribution structure always produces the same allocation). Shapley value uniquely satisfies all three properties (Shapley's axioms: efficiency, symmetry, dummy, additivity). It is *the* mathematically-correct attribution function for cognitive-collective-output.

ETM-aligned because:

- *Marginal contribution captures real cognitive economics.* The participant who, when added to a coalition, increases output the most, is doing the most cognitive-economic work. Pay them in proportion to that marginal increment, not in proportion to their seniority or headcount or order-of-arrival.
- *Symmetry: identical contributors get identical rewards.* No structural advantage from being early, late, named, or anonymous. ETM demands structural neutrality, and Shapley enforces it.
- *Coalition-resistance.* Two contributors cannot collude to extract more than their joint marginal contribution would justify; the math doesn't allow it. ETM-aligned because cognitive-economic primitives must resist Sybil-coalition extraction.

The FractalShapley refinement extends ETM-fidelity further: most blockchain reward systems treat "a contribution" as a leaf node, but real cognitive contributions decompose recursively (a contribution to VibeSwap might itself be backed by a contribution from Uniswap V4's design, which itself comes from constant-product AMM theory, etc.). FractalShapley's recursive sub-distribution lets credit flow upstream through the contribution lineage, which matches how cognitive economies actually work — credit flows backward through the ideas that made the current contribution possible.

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- Computation cost. Exact Shapley is exponential in coalition size; approximations (Monte Carlo sampling, structural decomposition) keep it tractable. Per-participant gas budget is the limiting parameter; ETM-neutral on the choice of approximation.
- Recursion depth for FractalShapley. How far back through the contribution graph does credit flow? Cognitive analog: how many citation-hops back does academic credit propagate? Empirically tunable; ETM-neutral.

### 4.4 VibeAMM constant-product

**What it is.** `contracts/amm/VibeAMM.sol`. Constant-product AMM (`x * y = k`) for liquidity pools. Trades execute via batch settlement (post-CRA), with the cap that trader payout cannot exceed the natural curve amount even if the externally-derived clearing price would have given more (the C34 fix). LPs deposit pairs; receive LP tokens; earn fees from trades.

**ETM analysis.** This is the audit's most interesting case. Constant-product AMM is the canonical *neutral pricing primitive* — it has no notion of memory rent, no notion of contribution graph, no notion of soulbound identity. It's pure market mechanism: liquidity in, liquidity out, price discovered from the curve. So is it ETM-aligned?

The answer is **partial**: VibeAMM mirrors ETM at the operational layer (the batch-settlement integration with CRA preserves the uniform-clearing property; the C34 curve-cap preserves the k-invariant under price damping) but does NOT mirror ETM at the LP-position layer (LP positions don't pay state-rent, they sit unbounded, and they accrue fees in proportion to time-locked liquidity rather than in proportion to attentive maintenance).

What's right:
- *Curve-bounded payout.* The C34 fix (`amountOut = min(linear, curve)`) means the AMM's structural invariant is preserved against externally-imposed pricing pressure. ETM-aligned: the substrate (k-invariant) is honored even when other mechanisms (TPO damping) push against it.
- *Batch settlement integration with CRA.* All pool trades land via uniform-clearing batches, so MEV doesn't attack the AMM-side of trades. ETM-aligned via inheritance from CRA's MIRROR.
- *LP fee distribution proportional to liquidity contribution.* Standard AMM math; matches contribution-proportional reward (Shapley-adjacent for the simple two-asset case).

What's NOT right:
- *No state-rent on LP positions.* An LP position occupies state forever (until withdrawn) without paying continuous rent. This is a violation of the substrate-layer rent property — the pool data takes up cells in state, but the LP doesn't pay dilution-based rent on those cells. ETM would predict: dormant LP positions (low fee earnings, low utilization) should face increasing rent pressure to either re-deploy or exit, freeing capacity for higher-utility positions.
- *Time-locked rather than attention-rewarded.* LP rewards accrue in proportion to time-in-pool, not in proportion to active rebalancing or thoughtful position management. A passive LP and an active LP earn the same fee share for the same time-weighted liquidity. ETM-aligned mechanism would distinguish these — active LPs (who reposition as conditions warrant, who provide where it's most needed) should earn more than passive LPs, even at the same time-weighted notional.

**Classification: ◐ PARTIALLY MIRRORS.**

**Refinement targets**:
- *State-rent on LP positions.* Apply CKB-native lockup proportional to position byte-occupancy. LP positions then pay rent the same way cells do; dormant positions face dilution pressure; the pool gets self-cleaning of stale liquidity.
- *Active-vs-passive LP differentiation.* Concentrated-liquidity (Uniswap V3 style) is one path; on-chain rebalancing-attribution metrics (per-LP, per-block) is another. ETM-aligned mechanisms would reward active position management over passive holding.
- *IL-protection vault re-evaluation.* The currently-deferred FAT-AUDIT-1 backlog item asks whether the IL-protection vault is insurance against a symptom rather than a fix for the cause. ETM frame says: yes, IL is the symptom of an unbounded-LP-state mechanism; fix the mechanism (rent on LP positions) and IL-protection becomes redundant.

### 4.5 Lawson Floor

**What it is.** A fairness lower bound that gates settlement: a settlement is valid only if the worst-off participant's utility meets the Lawson floor. Not a threshold of quality; a *minimum-outcome constraint* derived from Rawlsian-maximin fairness analysis. Backed by `docs/papers/contribution-dag-lawson-constant.md` (formal theory), `sims/lawson_floor_sim.py` (simulation), and `test/vectors/lawson_floor.json` (test vectors).

**ETM analysis.** Lawson Floor externalizes the cognitive-economic property that **a cognitive economy maintains a lower bound on participant experience, below which the economy refuses to operate**. In cognition, this corresponds to: a healthy knowledge community does not accept collective decisions that crush the worst-off participant for aggregate gain. There is a fairness floor below which the community rejects the outcome, even if it would be aggregate-pareto-optimal above the floor.

Applied to on-chain settlement, Lawson Floor is the mechanism that refuses to settle a trade batch, a governance decision, or an incentive distribution if the minimum participant-utility below a threshold. The floor is not a policy parameter ("we like to have at least 10% payout") — it's a mathematically-derived constant from the fairness-model's maximin optimization. That structural derivation is what makes it ETM-aligned rather than ETM-failing.

Three properties that keep it aligned:

- *Settlement-gating, not post-hoc compensation.* Lawson Floor refuses to finalize outcomes that fail the floor; it doesn't let them finalize and then try to compensate. ETM-aligned because post-hoc compensation admits the extractive dynamic first and attempts to un-extract — which is fundamentally weaker than preventing the extraction at settlement.
- *Maximin-derived rather than threshold-derived.* The floor is computed from Rawlsian maximin over the participant set, giving a mathematically-unique value. Per the Augmented Mechanism Design paper's augmentation-not-policy principle: math-derived floors are structural; arbitrary thresholds are policy. ETM-aligned via the math-derivation.
- *Works across mechanisms.* Lawson Floor isn't bound to one contract — the mathematical floor applies to any outcome-producing mechanism (batch auctions, Shapley distributions, governance allocations). This cross-cutting-ness is ETM-aligned because the cognitive-economic fairness-floor is itself cross-cutting: it applies to any collective-output mechanism, not just one specific domain.

**Pattern-match drift warning.** Do NOT round Lawson Floor to "a minimum-guaranteed-price" or "a quality threshold." Both framings miss the maximin-derivation and the settlement-gating-not-compensation properties. The closest mainstream analog is "Rawlsian veil-of-ignorance applied to mechanism outcomes" — but even that requires the on-chain enforcement specificity to match VibeSwap's use.

**Classification: ✅ MIRRORS.**

**Tuning targets**:
- Floor level calibration. The maximin produces a value dependent on participant utility functions; those functions are mechanism-specific. Empirical work post-mainnet to confirm the floor matches real participant welfare.
- Cross-mechanism Lawson-floor uniformity. Currently floor is computed per-mechanism; a unified cross-mechanism floor (if provable) would be stronger. Formal-theory work queued in `project_lawson-floor-research-agenda.md`.

### 4.6 Contribution DAG

**What it is.** `contracts/identity/ContributionDAG.sol`. Directed acyclic graph where nodes are contributions, edges are `contribution-A references/depends-on contribution-B`. Each node has authors (from SoulboundIdentity), timestamps, attestations. Contribution weight accrues along the DAG via recursive-authority scoring (PageRank-like, weighted by citer's PoM).

**ETM analysis.** The Contribution DAG is the **on-chain substrate for the common-knowledge layer of the cognitive economy.** In cognition, common knowledge is the web of cross-referenced ideas that anchor the substrate — each idea's authority derives from which other ideas cite it, which in turn derive their authority from *their* citers, and so on recursively. The DAG is the literal data structure of this web. Externalizing it on-chain means: (a) contribution-authority is computable rather than declared, (b) the computation is transparent and verifiable, (c) new contributions can accrue authority over time by being cited by established nodes.

ETM-aligned structural properties:

- *Acyclic constraint.* Citations go backward in time; no self-citation loops; no mutual-citation rings that artificially inflate authority. The DAG's acyclicity is load-bearing — it prevents the Sybil-coalition mutual-citation attack. ETM demands this structure because cognitive-economic common-knowledge works the same way: ideas must build on prior ideas, not on themselves.
- *PoM-weighted citation.* A citation from a high-PoM node weighs more than from a low-PoM or new node. This prevents Sybil inflation (Sybil nodes can cite, but they have low PoM weight) while rewarding legitimate contributions (a citation from a recognized expert is valuable). ETM-aligned: matches academic citation-authority weighting.
- *Soulbound attribution.* Each DAG node's author is soulbound-identity-bound; contribution-weight is not transferable. ETM-aligned because cognitive contribution accrues to the contributor, not to an asset they could sell.

**Classification: ✅ MIRRORS.**

**Refinement targets**:
- Traversal cost at scale. Already noted under Section 2.2 (PoM). Same issue; same mitigation paths.
- Contribution-type specialization. Different contribution classes (code, docs, research, operational) might warrant different citation-weighting curves. ETM-neutral on specialization as long as within-class symmetry is preserved.

<!-- SECTION-4-MARKER -->

## Section 5 — Defense layer mechanisms

The defense layer is where ETM alignment is most frequently violated in blockchain systems generally. Most defense mechanisms are policy-level overlays (blacklists, whitelists, timelocks, circuit breakers, pause switches) that impose discretionary authority on top of the substrate. ETM predicts that defense-via-policy is structurally weaker than defense-via-rent — because policy admits governance capture, enforcement drift, and attacker-learnable thresholds, while rent imposes continuous structural cost that cannot be threshold-gamed. VibeSwap's defense layer takes the harder path: rent on attacker cells (Siren), topological-taint propagation (Clawback), with circuit breakers and TWAP guards as the known policy-level exceptions.

### 5.1 Siren Protocol

**What it is.** `contracts/core/HoneypotDefense.sol` and `contracts/core/OmniscientAdversaryDefense.sol` together implement the Siren Protocol: instead of blocking attackers via blacklist, the protocol engages attackers in progressively-expensive shadow operations until the attacker's resource commitment exhausts itself against the defense. The attacker cannot tell initially whether a transaction is real or honey; the defense charges progressively more rent as engagement depth increases.

**ETM analysis.** Siren externalizes the cognitive-economic defense pattern: **a healthy cognitive economy doesn't blacklist attackers; it exhausts them through rent.** An attacker who commits resources to attacking a memory substrate finds that each attack step costs more than the last, because the substrate's defenses scale their rent charge with the evidence of attack. Eventually the attacker's marginal cost exceeds their marginal expected benefit, and they exit voluntarily. This is the economic-rationality parallel of biological immune systems: they don't "ban" pathogens; they exhaust them by raising the cost of replication until replication becomes unprofitable.

Three properties keep Siren ETM-aligned:

- *Cost-scaling instead of blocklisting.* Siren doesn't reject attacker transactions outright; it accepts them but progressively increases their cost. ETM-aligned because blocklist-based defenses admit governance capture (who decides who goes on the list?) and structural holes (Sybil-rotation defeats blocklists); rent-based defenses don't have these failure modes.
- *Asymmetric cost: high for attacker, low for honest user.* The rent is triggered by attack-signals, not by traffic volume. Honest users pay minimal or no Siren rent; attackers pay escalating rent. ETM-aligned because cognitive substrates similarly distinguish attention-worthy input from attention-consuming noise.
- *Engagement-until-exhaustion rather than rejection.* By accepting the attacker into the honeypot space, Siren forces the attacker to expend resources for zero substrate-destabilizing effect. Rejection returns the attacker's unspent resources; engagement consumes them.

**Pattern-match drift warning.** Do NOT round Siren to "blacklist plus timelock." That framing misses the engagement-until-exhaustion property. Siren is closer to "economic tar pit with progressively-sticky walls" — the attacker is welcomed in, and leaving becomes expensive.

**Classification: ✅ MIRRORS.**

**Refinement targets**:
- Attack-signal calibration. False positives (honest users flagged as attackers, paying Siren rent) and false negatives (attackers not detected, paying no rent) are the two failure modes. Tuning is mechanism-economics; ETM-neutral.
- Cross-contract Siren integration. Currently Siren primarily applies at specific contract entry points; a network-wide Siren layer could amortize cost across contracts. Future cycle.

### 5.2 Clawback Cascade

**What it is.** `contracts/compliance/ClawbackRegistry.sol` + `contracts/compliance/ClawbackVault.sol`, gated on `contracts/compliance/FederatedConsensus.sol`. When a wallet is flagged (`openCase`, `ClawbackRegistry.sol:187`), authorities open a `ClawbackCase` and the origin wallet's `WalletRecord` enters `TaintLevel.FLAGGED`. Taint propagates along the recorded transaction graph (`recordTransaction`/`_propagateTaint`, `ClawbackRegistry.sol:342, 488`): every downstream recipient inherits a `TaintRecord` and an incremented `taintDepth`, bounded by `maxCascadeDepth` and `MAX_CASE_WALLETS = 1000`, with `minTaintAmount` filtering dust. Adjudication is gated on FederatedConsensus voting — `submitForVoting` (`ClawbackRegistry.sol:227`) sends the case to authority vote; `executeClawback` (`ClawbackRegistry.sol:256`) requires `consensus.isProposalApproved(...)` before transferring tainted balances to the vault. Per the contract NatSpec: *"Off-chain entities (government, lawyers, courts, SEC) vote through FederatedConsensus before any clawback executes."*

**ETM analysis.** Clawback Cascade externalizes the cognitive-economic property that **provenance-based quality assessment propagates through the substrate.** In cognition, if you learn that a source you relied on was fraudulent, you re-evaluate everything you learned from that source and everything you taught others based on it; the re-evaluation propagates topologically through your knowledge graph. Clawback Cascade applies the same geometry to value-flow: topological taint, depth-bounded propagation, registry-coordinated adjudication.

ETM-aligned structural properties:

- *Topological propagation.* Taint flows along the recorded transaction graph (`taintChain[wallet]`), not by address-list membership. Substrate-faithful: cognitive taint also follows the graph of information flow, not membership in a "bad" category. The `taintDepth` field surfaces the path metric directly on each record, matching ETM's preference for legible structural state.
- *Bounded cascade.* `maxCascadeDepth` + `MAX_CASE_WALLETS` + `minTaintAmount` keep the cascade well-bounded against gas griefing and dust-Sybil amplification. ETM-aligned because cognitive-graph re-evaluation is also bounded — you don't trace fraud to the dawn of recorded thought; you stop at evidentiary depth limits.
- *Registry-coordinated adjudication.* Detection is permissioned to authorized trackers + authorities (`onlyTracker` modifier; authority gate on `openCase`); adjudication routes through FederatedConsensus voting. ETM-aligned in the sense that *consistent adjudication is a common-knowledge anchor*, but see partial-mirror caveat below for where the structure diverges.

**Partial-mirror caveat.** The cascade geometry is ETM-aligned, but the **adjudication layer is governance-by-authority, not structural rent.** The audit's earlier draft described "anyone who received tainted funds legitimately can contest within the window" — that is not what ships. What ships is FederatedConsensus voting by registered authorities (government / legal / regulatory entities), with the on-chain side providing only the execution rail. Downstream holders cannot file an in-protocol contest; their recourse is off-chain (legal challenge to the authority decision). ETM predicts this is the right call for the regulatory adjudication problem (which is genuinely off-chain in nature) but flags the absence of an on-chain contest primitive as a partial-alignment edge: tainted holders bear strict on-chain liability subject only to off-chain authority discretion. A future structural augmentation — bond-backed on-chain contest with FederatedConsensus as the dispute-resolution oracle, mirroring OCR V2a's permissionless-challenge geometry — would close this edge without removing authority adjudication.

**Pattern-match drift warning.** Do NOT round Clawback Cascade to "freeze funds" or "blacklist addresses" — those framings miss the topological-propagation-with-bounded-depth property. But also do NOT round it to "permissionless contest with adjudication oracle" — that overshoots in the other direction relative to what the contract actually implements.

**Classification: ◐ PARTIALLY MIRRORS.** The cascade geometry MIRRORS; the adjudication path PARTIALLY MIRRORS due to authority-only contest. Net: PARTIALLY.

**Refinement targets**:
- *On-chain bonded contest primitive.* Permissionless `contest(caseId, wallet, evidence, bond)` against an in-flight clawback. Wins return bond + share of slash from authority error budget; losses forfeit bond. Mirrors OCR V2a challenge geometry. Converts strict-liability-with-only-off-chain-recourse to math-enforced rent-on-disputes-pays-discovery.
- *Cross-chain taint propagation.* Currently contained to native-chain transactions; LayerZero integration + registry replication across chains would extend the topological scope to match the actual fund-flow graph. Future cycle.
- *Cascade-depth elasticity.* Currently a single `maxCascadeDepth` parameter. Cognitive analog: depth-of-trace should scale with magnitude (high-stake fraud warrants deeper trace). Parameterizable per-case rather than per-registry.

### 5.3 Circuit Breakers / TWAP guards

**What it is.** Two related defense surfaces:

- *Circuit breakers* — `contracts/core/CircuitBreaker.sol` (abstract base inherited by VibeAMM and others). Five typed breakers (`VOLUME_BREAKER`, `PRICE_BREAKER`, `WITHDRAWAL_BREAKER`, `LOSS_BREAKER`, `TRUE_PRICE_BREAKER`) each parameterized by `threshold`, `cooldownPeriod`, `windowDuration`. `_checkBreaker` (`CircuitBreaker.sol:334`) gates protected functions; `_updateBreaker` (`CircuitBreaker.sol:367`) accumulates window values and trips on threshold breach. **C43 augmentation (`CircuitBreaker.sol:52-94, 282-322`)**: opt-in `requiresAttestedResume[breakerType]` flag turns cooldown into a *floor* — past cooldown the breaker stays tripped until M-of-N certified attestors call `attestResume(breakerType, evidenceHash)`; trip generation counter (`tripGeneration`) scopes attestor signatures to the current trip and implicitly invalidates them on the next trip without iteration.
- *TWAP guards in VibeAMM* — `contracts/amm/VibeAMM.sol` `validatePrice` modifier (`VibeAMM.sol:399`). Two layered gates: (a) **AMM-04** single-trade deviation gate `MAX_DEVIATION = 500` bps (5%) against TWAP, applied post-swap via `_validatePriceAgainstTWAP` (`VibeAMM.sol:79, 422`); (b) **AMM-05** cross-window drift gate `MAX_TWAP_DRIFT_BPS = 200` bps (2%) against `lastTwapSnapshot[poolId]`, applied pre-swap (`VibeAMM.sol:88-95, 405-419`). The AMM-05 gate explicitly catches gradual manipulation that walks the TWAP across windows while staying under the 5% per-trade limit.

**ETM analysis.** This is the audit's most nuanced alignment case. The naive read — "circuit breakers and TWAP deviation are policy-level pause-switches" — is true of the *vanilla* breaker behavior but understates two structural augmentations already shipped: AMM-05 and C43. With those two layered in, the defense surface is closer to a hybrid: vanilla policy-thresholds for normal operation, structural augmentations for the gaming pressure that pure policy admits.

What's aligned (structural augmentations already shipped):
- *Transparent thresholds + last-resort disposition.* Firing conditions are on-chain and observable; no off-chain discretion in the firing decision. The design explicitly treats these as last-resort, with backlog items FAT-AUDIT-2 (commit-reveal oracle) and FAT-AUDIT-3 (adaptive fees + Stabilizer) targeting reduction of the firing domain.
- *Cross-window drift catch (AMM-05).* The 200 bps drift gate is the structural answer to the "stay-just-under-the-threshold" attack on the 5% single-trade gate. By measuring TWAP-against-snapshot at window boundaries, AMM-05 removes the threshold-gaming free-ride. ETM-aligned because it imposes structural cost on the *strategy of riding-just-under*, not on individual trades.
- *Attested resume (C43).* The cognitive analog of breaker-resume is *biological flinch relaxation* — which never relaxes on a wall-clock timer alone. The substrate evaluates safety before resuming engagement. C43 externalizes exactly this: cooldown becomes a floor, not a trigger; M-of-N certified attestors must sign a safety-evaluation evidence-hash before trading resumes; trip generation prevents stale attestations from short-circuiting future trips. ETM-aligned in geometry — explicit safety attestation gates re-engagement, mirroring how cognitive systems gate reactivation after a defensive response.

What's NOT aligned (the remaining policy edges):
- *Attacker-learnable single-trade thresholds.* The 5% AMM-04 gate is still threshold-based per-trade; AMM-05 closes the cross-window edge but a single-window saturating attack within 5% per trade and 2% per window is still feasible. ETM predicts this class will not fully close until the deviation gates are replaced by structural commit-reveal oracle aggregation (FAT-AUDIT-2).
- *Governance-set breaker parameters.* `configureBreaker` (`CircuitBreaker.sol:219`) is `onlyOwner`; thresholds, cooldown, window are governance-tunable. Augmented Governance (Physics > Constitution > Governance) puts these in the "thin" governance territory — math-invariants do not constrain `threshold` choices. Capture-resistance here depends on social/political layer, not structural.
- *No continuous rent on near-threshold positioning.* A participant whose activity consistently runs at 4.9% deviation pays no continuous cost for that positioning. ETM-aligned defense would impose continuous rent proportional to proximity-to-threshold (e.g., superlinear fee curves), making the near-threshold strategy unprofitable independent of breaker firing.
- *C43 is opt-in, not default.* `requiresAttestedResume` defaults to `false` for backwards compatibility. The structural augmentation is shipped but not yet load-bearing across the production breaker set. The augmentation matures as governance opts breakers in.

**Classification: ◐ PARTIALLY MIRRORS.** AMM-05 + C43 lift this above what the audit's earlier categorization implied — there is real structural augmentation work shipped — but the policy-level core (governance-set thresholds, no near-threshold rent, single-trade deviation gate) keeps it from full MIRROR. Closer to MIRROR than to FAIL; refinement-class, not redesign-class.

**Refinement targets** (FAT-AUDIT-2 + FAT-AUDIT-3 canonicals plus C43 maturation):
- *Commit-reveal oracle aggregation* (FAT-AUDIT-2). Removes the AMM-04 5% deviation gate's load-bearing role by making oracle aggregation structural. Co-refinement with Section 4.2 Gap 2.
- *Adaptive fee curves* (FAT-AUDIT-3). Superlinear fee scaling with volume / price-move replaces the binary breaker-fires-or-not edge with continuous near-threshold rent. Closes the "no continuous rent" edge structurally.
- *Treasury Stabilizer expansion* (FAT-AUDIT-3). Auto-provides liquidity during stress rather than halting. Preserves trading during the exact moments breakers would otherwise fire.
- *C43 default-on for high-stake breakers.* Promote `requiresAttestedResume = true` from opt-in to default for `LOSS_BREAKER` and `TRUE_PRICE_BREAKER`; keep opt-out for low-stake operational breakers. Matures the C43 mechanism to load-bearing status.
- *Attestor-set decentralization.* `setCertifiedAttestor` is currently `onlyOwner`; ETM-aligned trajectory is FederatedConsensus-style multi-authority gating, then PoM-weighted attestor selection.

<!-- SECTION-5-MARKER -->

## Section 6 — Summary table

| # | Mechanism | Class | Notes |
|---|---|---|---|
| 1.1 | CKB State-Rent | ✅ MIRRORS | Canonical instantiation; cell + rent + citation-density + reaping. |
| 1.2 | Secondary Issuance | ✅ MIRRORS | Continuous dilution is the rent engine. Split ratios ETM-neutral. |
| 1.3 | Operator-Cell Assignment (OCR V1+V2a) | ✅ MIRRORS | Per-cell bond = attention rent; V2a permissionless challenge converts governance-slashing to math-enforced game. |
| 1.4 | Content Merkle Registry / PAS (V2b) | ✅ MIRRORS | Extends rent from liveness to content-delivery. K-sampling structural. |
| 2.1 | NCI 3D Consensus weight (PoW 10% / PoS 30% / PoM 60%) | ✅ MIRRORS | Three orthogonal cognitive resources; PoM seniority correct. |
| 2.2 | Proof of Mind (PoM) | ✅ MIRRORS | Highest-fidelity common-knowledge externalization on any chain. |
| 2.3 | Soulbound Identity + Heartbeat | ✅ MIRRORS | Continuity-of-identity as rent-unit; eviction-with-teeth (Enforced Liveness Signal primitive). |
| 3.1 | JUL — primary liquidity | ✅ MIRRORS | Money + PoW pillar. Do NOT round to "bootstrap." |
| 3.2 | VIBE — governance share | ✅ MIRRORS | Capped 21M, Shapley-distributed, governance-only utility. |
| 3.3 | CKB-native — state-rent capital | ✅ MIRRORS | Locked-not-exchanged; elastic via issuance. Three-token orthogonality complete + minimal. |
| 4.1 | Commit-Reveal Batch Auction (CRA) | ✅ MIRRORS | Walrasian batch at mechanism layer; eliminates ordering-extraction. |
| 4.2 | True Price Oracle (TPO) | ◐ PARTIALLY | Stake-bonded + reputation + EvidenceBundle align; 5% deviation gate is policy, not structural. Refinement: FAT-AUDIT-2. |
| 4.3 | Shapley + FractalShapley Distribution | ✅ MIRRORS | Mathematically-unique fair attribution function; recursive credit flow matches citation graph. |
| 4.4 | VibeAMM constant-product | ◐ PARTIALLY | Operational layer aligned; LP positions sit rent-free + time-locked-not-attention-rewarded. Refinement: rent on LP positions + active-LP differentiation. |
| 4.5 | Lawson Floor | ✅ MIRRORS | Maximin-derived settlement gate; structural not threshold. |
| 4.6 | Contribution DAG | ✅ MIRRORS | Acyclic + PoM-weighted + soulbound-attributed. Substrate for common-knowledge layer. |
| 5.1 | Siren Protocol | ✅ MIRRORS | Rent-until-exhaustion, not blacklist. High-drift zone handled correctly. |
| 5.2 | Clawback Cascade | ◐ PARTIALLY | Topological taint geometry MIRRORS; adjudication is FederatedConsensus authority-vote with no on-chain bonded-contest path for tainted holders. |
| 5.3 | Circuit Breakers + TWAP guards | ◐ PARTIALLY | AMM-05 cross-window drift + C43 attested-resume are real structural augmentations; remaining policy edges (single-trade 5% gate, governance-set thresholds, no near-threshold rent) keep it short of full MIRROR. Refinement: FAT-AUDIT-2 + FAT-AUDIT-3 + C43 maturation. |

**Totals**: 15 MIRRORS / 4 PARTIALLY MIRRORS / 0 FAILS TO MIRROR across 19 major mechanisms audited.

**The 0 FAILS TO MIRROR result is itself noteworthy.** VibeSwap was designed against the cognitive-economic spec before the spec was articulated as ETM. The absence of full-fail mechanisms says: the underlying design intuition has been consistently ETM-aligned across the mechanism space. The 4 PARTIAL cases — TPO 5% gate (FAT-AUDIT-2), VibeAMM LP rent-free (FAT-AUDIT-1), Clawback authority-only adjudication, Circuit-breaker policy edges (FAT-AUDIT-3 + C43 maturation) — are all refinement-class with known structural-augmentation paths, not redesign-class.

<!-- SECTION-6-MARKER -->

## Section 7 — Prioritized gap list (feeds Step 2 Build Roadmap)

The 4 PARTIALLY MIRRORS classifications convert into 5 prioritized gaps. Order is by leverage — the gap whose closure most strengthens the overall ETM-fidelity of the system, not necessarily by implementation cost. Estimated cycle cost is S (single cycle, ≤ ~3 days), M (2-3 cycles), or L (4+ cycles or multi-component).

### Gap 1 — VibeAMM LP positions are rent-free (HIGH leverage)

**From Section 4.4.** LP positions occupy state, accrue fees in proportion to time-locked-liquidity, and never face dilution pressure. ETM predicts: dormant positions should pay rent the same way other cells do; active position management should be rewarded over passive holding.

**Why HIGH leverage**: this is the most-frequent participant interface in the system. Every LP touches this; every fee distribution is shaped by it. Closing the gap here propagates ETM-alignment into the daily-experience surface of the protocol.

**Refinement direction**:
- Apply CKB-native lockup proportional to LP-position byte-occupancy. LP positions then participate in the same rent dynamics as cells in `StateRentVault`.
- Differentiate active-rebalancing LPs from passive-holding LPs in fee distribution (concentrated-liquidity-position-style metrics, or per-block rebalancing attribution).
- Reframe IL-protection vault as conditional-on-residual-IL after rent + active-LP differentiation reduce the underlying problem.

**Rough scope (M)**: 2-3 cycles. New `LPRentRegistry` sidecar + VibeAMM wire-in + fee-distribution recomputation.

### Gap 2 — TPO uses 5% deviation gate as primary defense (MED-HIGH leverage)

**From Section 4.2.** Deviation-threshold protection is policy-level. Determined attacker can ride within the gate.

**Why MED-HIGH leverage**: oracle correctness is upstream of every pricing-dependent mechanism (CRA settlement, AMM trades, liquidations). A failure here cascades. Not the highest-frequency participant interface but the highest-criticality one.

**Refinement direction (canonical: FAT-AUDIT-2)**:
- Commit-reveal oracle aggregation. Issuers commit prices, reveal together, median computed. Pattern identical to CRA — high code reuse.
- Replaces the deviation-gate's load-bearing role with structural commit-reveal opacity.
- Hardens VibeStable liquidation path (closes C7-GOV-008 dependency).

**Rough scope (S-M)**: 1-2 cycles. New aggregation contract + TPO wire-in + VibeStable liquidation path update.

### Gap 3 — Circuit breakers / TWAP deviation are policy thresholds (MED leverage)

**From Section 5.3.** Last-resort policy mechanisms; attacker-learnable; no continuous rent.

**Why MED leverage**: secondary defense layer, fires only under stress. ETM-alignment matters but the failure mode (a stress event survives the last-resort defense and propagates) is rare.

**Refinement direction (canonical: FAT-AUDIT-3)**:
- Adaptive fee curves: fees scale superlinearly with volume / price-move. Cascade profit motive drops organically before breaker fires.
- Treasury Stabilizer expansion: auto-provides liquidity during stress, preserving trading rather than halting.
- Goal: shrink breaker firing domain over time. Keep breakers as true last-resort, not first-line.

**Rough scope (M)**: 2-3 cycles. New fee-curve contract + Treasury Stabilizer extension + breaker parameter rebalance + C43 default-on flip for high-stake breakers.

### Gap 4 — IL Protection Vault may be insurance against a symptom (LOW-MED leverage, post-mainnet decision)

**From Section 4.4 + backlog FAT-AUDIT-1.** ETM predicts: if rent-on-LP-positions (Gap 1) closes the IL exposure at the source, the IL-protection vault becomes redundant. But this is empirical — needs mainnet IL-claim-frequency data before the call can be made.

**Why LOW-MED leverage**: depends on Gap 1 closure first; depends on real volume data. Decoupling delays this.

**Refinement direction**:
- Ship Gap 1 first.
- Instrument IL-claim frequency on mainnet launch.
- Re-audit post-volume. If claim data supports low-incidence, route Vault revenue streams (priority bid % + early-exit penalty %) directly to LPs — simpler, cheaper, same user outcome.

**Rough scope (S-M, conditional)**: depends on Gap 1 + mainnet runtime data. If empirical claim-frequency supports it: 1 cycle to retire vault + redirect revenue streams (S). If claim data shows residual IL: 2-3 cycles to refactor vault as last-resort backstop only (M).

### Gap 5 — Clawback Cascade has no on-chain bonded-contest path (MED leverage)

**From Section 5.2.** The cascade geometry is ETM-aligned, but tainted-by-association holders have no in-protocol way to contest the clawback before execution. Adjudication is FederatedConsensus authority-vote; downstream recourse is purely off-chain (legal challenge to the authority decision). This produces strict on-chain liability subject only to off-chain authority discretion.

**Why MED leverage**: not the highest-frequency interface (most users never hit the clawback path), but the one where ETM's "math-enforced not policy-enforced" principle is most visible-by-its-absence. Adding an on-chain contest primitive would also harden the system against authority-set capture, which sits in Augmented Governance's "thin" territory until structurally augmented.

**Refinement direction**:
- Permissionless `contest(caseId, wallet, evidence, bond)` on `ClawbackRegistry`. Bond sits at-risk during a fixed contest window before `executeClawback` may fire.
- Wins (case dismissed via FederatedConsensus on the contest evidence) return bond + share of slash from authority error budget; losses (case proceeds) forfeit bond.
- Mirrors OCR V2a permissionless-challenge geometry — same primitive, applied to the value-clawback domain rather than the operator-availability domain.
- Keeps FederatedConsensus as the dispute-resolution oracle (it is the right authority for regulatory adjudication); changes only that the authority must engage with on-chain evidence on a math-enforced timeline rather than firing into a mute on-chain target.

**Rough scope (M)**: 2 cycles. `ClawbackContest` extension to `ClawbackRegistry` + bond accounting + FederatedConsensus-callback wiring + tests modeling the contest window state machine.

### Gap 6 — C43 attested-resume is opt-in rather than default-on for high-stake breakers (LOW-MED leverage, S)

**From Section 5.3.** The C43 mechanism is shipped but `requiresAttestedResume` defaults `false` for backwards compatibility. As long as it is opt-in, the structural-augmentation it provides is dormant in production breaker behavior.

**Why LOW-MED leverage**: small surface area; the augmentation is already implemented; the gap is configuration-and-attestor-bootstrapping, not new code. Low-leverage in absolute terms but cheap to close, so high return-per-cycle.

**Refinement direction**:
- Promote `requiresAttestedResume = true` from opt-in to default for `LOSS_BREAKER` and `TRUE_PRICE_BREAKER` (the high-stake breakers where wall-clock auto-resume is cognitively-incorrect).
- Bootstrap initial certified attestor set (governance-set, M=2 default to start).
- Document attestor expectations in `docs/attestor-charter.md`; queue PoM-weighted attestor-selection for a future cycle (replaces `onlyOwner` `setCertifiedAttestor`).

**Rough scope (S)**: 1 cycle. Configuration flip + attestor bootstrap + tests verifying the default-on path.

### Cycle-cost summary

| Gap | Leverage | Cost | Type |
|---|---|---|---|
| 1. VibeAMM LP rent-free | HIGH | M (2-3) | New code (LPRentRegistry sidecar) |
| 2. TPO 5% deviation gate | MED-HIGH | S-M (1-2) | New code (commit-reveal aggregation) |
| 3. Circuit breakers / TWAP policy edges | MED | M (2-3) | New code + parameter rebalance |
| 4. IL Protection Vault re-eval | LOW-MED | S-M (conditional) | Conditional refactor / retire |
| 5. Clawback bonded contest | MED | M (2) | New code (ClawbackContest) |
| 6. C43 default-on for high-stake | LOW-MED | S (1) | Config + attestor bootstrap |

---

## Step 2 entry point

`DOCUMENTATION/ETM_BUILD_ROADMAP.md` will translate these 6 gaps into concrete engineering tasks: per-gap acceptance criteria, contracts to modify, primitives to draft, tests to write. Each gap becomes ~1-3 RSI cycles in the build queue.

## Step 4 candidate

C39 (next concrete alignment fix) — two viable openers, both small:

- **Gap 6 — C43 default-on flip (S, 1 cycle)** is the cheapest. Code is already shipped; the work is configuration + attestor bootstrap + tests. Activates a structural augmentation that is currently dormant.
- **Gap 2 — TPO commit-reveal oracle aggregation (S-M, 1-2 cycles)** is the highest-leverage among the cheap ones. High code reuse from existing CRA primitive (4th invocation of commit-reveal pattern, see Cycle 36 memory); unblocks downstream VibeStable refresh.

Recommended sequence: **Gap 6 (C39) → Gap 2 (C40-41) → Gap 1 (C42-44)**. Gap 6 is high-confidence-low-cost so it ships fast and matures the C43 augmentation to load-bearing status. Gap 2 ships next because it propagates ETM-fidelity into the oracle layer that all other mechanisms depend on. Gap 1 (LPRentRegistry) takes longer but draws on the patterns proved out by Gap 2's commit-reveal-aggregation work. Gaps 3, 4, 5 queue behind based on mainnet runtime data and emerging priorities.

<!-- SECTION-7-MARKER -->
