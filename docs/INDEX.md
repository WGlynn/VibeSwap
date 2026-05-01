# VibeSwap — A Field Encyclopedia

*A reference-grade orientation to the VibeSwap project: its philosophy, its mechanisms, its contracts, its people, and its paper trail. Written for anyone — founder, auditor, partner, researcher, future Claude session, or curious stranger — who wants to understand the whole without reading the whole.*

*Generated 2026-04-21. Scope: natural-language docs only; code-side READMEs and install instructions excluded. NDA-protected material redacted per the keyword gate; see Part 3 for the redaction log.*

---

## How to read this document

Four parts, each usable standalone:

- **Part 1 — Index.** Anchored list of Wikipedia entries, grouped by domain. Jump here to navigate.
- **Part 2 — Glossary.** A–Z compact definitions. One sentence per term. Use when a word in the body is unfamiliar.
- **Part 3 — Citations.** Numbered register of source documents the encyclopedia cites. Inline references in the body appear as `[12]`.
- **Part 4 — The VibeSwap Wikipedia.** Encyclopedic entries, grouped by domain, cross-linked. The meat.

If you are new, read the Part 4 overview (§4.1.1 *VibeSwap*), then jump to whatever in the Index catches your attention. If you are an auditor, start at §4.6 *Security* and §4.5 *Oracles*. If you are a monetary theorist, §4.9 *Monetary Theory*. If you are looking for first principles, §4.1 *Foundations & Philosophy*.

---

## Part 1 — Index

### 1.1 Foundations & Philosophy
- [VibeSwap (overview)](#vibeswap-overview)
- [Cooperative Capitalism](#cooperative-capitalism)
- [Augmented Mechanism Design](#augmented-mechanism-design)
- [Substrate-Geometry Match](#substrate-geometry-match-as-above-so-below)
- [Augmented Governance](#augmented-governance)
- [The Cave Philosophy](#the-cave-philosophy)
- [Gotham Framing](#gotham-framing)
- [First-Available Trap](#first-available-trap)
- [P-000 Fairness Above All](#p-000-fairness-above-all)
- [P-001 No Extraction Ever](#p-001-no-extraction-ever)
- [Intrinsic Altruism](#intrinsic-altruism)
- [Cooperative Markets Philosophy](#cooperative-markets-philosophy)
- [The Hard Line](#the-hard-line)
- [The Inversion Principle](#the-inversion-principle)
- [Graceful Inversion](#graceful-inversion)

### 1.2 Consensus — NCI and the Three Pillars
- [Nakamoto Consensus ∞](#nakamoto-consensus-)
- [Three-Dimensional Consensus](#three-dimensional-consensus)
- [Proof of Work (pillar)](#proof-of-work-pillar)
- [Proof of Stake (pillar)](#proof-of-stake-pillar)
- [Proof of Mind](#proof-of-mind)
- [Soulbound Identity](#soulbound-identity)
- [Contribution DAG](#contribution-dag)
- [VibeCode (code-contribution scoring)](#vibecode-code-contribution-scoring)
- [Agent Reputation](#agent-reputation)
- [Trinity Node](#trinity-node)
- [Asymmetric Cost Consensus](#asymmetric-cost-consensus)
- [Proof of Contribution](#proof-of-contribution)
- [Epistemic Staking](#epistemic-staking)

### 1.3 Mechanism Design — Auctions, Clearing, MEV
- [Commit-Reveal Batch Auction](#commit-reveal-batch-auction)
- [Uniform Clearing Price](#uniform-clearing-price)
- [Fisher-Yates Shuffle](#fisher-yates-shuffle)
- [Deterministic Shuffle](#deterministic-shuffle)
- [Priority Auction](#priority-auction)
- [Ten-Second Epoch](#ten-second-epoch)
- [Recursive Batch Auctions](#recursive-batch-auctions)
- [Clearing Price Convergence](#clearing-price-convergence)
- [Execution/Settlement Separation](#executionsettlement-separation)
- [From MEV to GEV](#from-mev-to-gev)
- [Five-Layer MEV Defense](#five-layer-mev-defense)

### 1.4 AMM — Curve, Drift, Invariants
- [VibeAMM](#vibeamm)
- [TWAP Oracle and Validation](#twap-oracle-and-validation)
- [Price Jump Guard](#price-jump-guard)
- [K-Preservation](#k-preservation)
- [Liquidity Migration](#liquidity-migration)
- [IL Protection Vault](#il-protection-vault)

### 1.5 Oracles
- [True Price Oracle](#true-price-oracle)
- [True Price Discovery](#true-price-discovery)
- [Kalman Filter Oracle](#kalman-filter-oracle)
- [EvidenceBundle](#evidencebundle)
- [Issuer Reputation Registry](#issuer-reputation-registry)
- [Stablecoin Flow Registry](#stablecoin-flow-registry)
- [Reputation Oracle](#reputation-oracle)
- [Price Intelligence Oracle](#price-intelligence-oracle)

### 1.6 Security
- [Clawback Cascade](#clawback-cascade)
- [Siren Protocol (Honeypot Defense)](#siren-protocol-honeypot-defense)
- [Fibonacci Scaling](#fibonacci-scaling)
- [Circuit Breakers](#circuit-breakers)
- [Flash Loan Protection](#flash-loan-protection)
- [Phantom Array Antipattern](#phantom-array-antipattern)
- [Admin Event Observability](#admin-event-observability)
- [API Death Shield (SHIELD)](#api-death-shield-shield)
- [NDA Keyword Gate](#nda-keyword-gate)
- [Wallet Recovery](#wallet-recovery)
- [AGI-Resistant Recovery](#agi-resistant-recovery)
- [Fork-Aware Domain Separator](#fork-aware-domain-separator)

### 1.7 Incentives — Shapley and Friends
- [Shapley Distribution](#shapley-distribution)
- [Fractalized Shapley Games](#fractalized-shapley-games)
- [Cross-Domain Shapley](#cross-domain-shapley)
- [Atomized Shapley](#atomized-shapley)
- [Loyalty Rewards](#loyalty-rewards)
- [Secondary Issuance](#secondary-issuance)
- [Cooperative Emission Design](#cooperative-emission-design)

### 1.8 Governance
- [DAO Treasury](#dao-treasury)
- [Treasury Stabilizer](#treasury-stabilizer)
- [Constitutional DAO Layer](#constitutional-dao-layer)
- [Conviction Voting](#conviction-voting)
- [Lawson Floor / Lawson Constant](#lawson-floor--lawson-constant)
- [Lawson Fairness Formalization](#lawson-fairness-formalization)
- [Memoryless Fairness](#memoryless-fairness)
- [Composable Fairness](#composable-fairness)
- [DAOShelter](#daoshelter)
- [Commit-Reveal Governance](#commit-reveal-governance)

### 1.9 Monetary Theory
- [Economítra](#economítra)
- [Ergon — Monetary Biology](#ergon--monetary-biology)
- [Trinomial Stability](#trinomial-stability)
- [Dual-Cap Monetary Architecture](#dual-cap-monetary-architecture)
- [Time-Neutral Tokenomics](#time-neutral-tokenomics)
- [Three-Token Economy](#three-token-economy)
- [VIBE Token](#vibe-token)
- [CKB-native](#ckb-native)
- [Joule Token](#joule-token)
- [Temporal Collateral](#temporal-collateral)
- [Elastic Money Primitives](#elastic-money-primitives)
- [Augmented Bonding Curves](#augmented-bonding-curves)

### 1.10 Cross-Chain
- [LayerZero V2 OApp](#layerzero-v2-oapp)
- [Cross-Chain Router](#cross-chain-router)
- [Cross-Chain Settlement](#cross-chain-settlement)
- [Omnichain DEX](#omnichain-dex)

### 1.11 Storage & State
- [CKB Cell Model](#ckb-cell-model)
- [StateRentVault](#staterentvault)
- [OperatorCellRegistry](#operatorcellregistry)
- [ContentMerkleRegistry](#contentmerkleregistry)
- [Shard Operator Registry](#shard-operator-registry)
- [Probabilistic Availability Sampling](#probabilistic-availability-sampling)
- [State Rent](#state-rent)
- [Verkle Context Tree](#verkle-context-tree)
- [Shard Architecture](#shard-architecture)
- [UTXO Advantages](#utxo-advantages)

### 1.12 Identity & Social
- [VibeSocial](#vibesocial)
- [DID-Context Economy](#did-context-economy)
- [GitHub Contribution Tracker](#github-contribution-tracker)
- [The Contribution Compact](#the-contribution-compact)
- [Trust Network](#trust-network)
- [Social DAG Sketch](#social-dag-sketch)

### 1.13 AI-Native DeFi
- [JARVIS](#jarvis)
- [Trinity Recursion Protocol (TRP)](#trinity-recursion-protocol-trp)
- [Cooperative Intelligence Protocol](#cooperative-intelligence-protocol)
- [Stateful Overlay](#stateful-overlay)
- [Propose → Persist](#propose--persist)
- [VibeAgentOrchestrator](#vibeagentorchestrator)
- [VibeAgentConsensus](#vibeagentconsensus)
- [AI Agents as DeFi Citizens](#ai-agents-as-defi-citizens)
- [AI-Native DeFi](#ai-native-defi)
- [Cognitive Consensus Markets](#cognitive-consensus-markets)
- [Data Marketplace — Compute-to-Data](#data-marketplace--compute-to-data)
- [The Persistence Layer](#the-persistence-layer)

### 1.14 Formal Theory & Proofs
- [Formal Fairness Proofs](#formal-fairness-proofs)
- [Independence of Irrelevant Alternatives (IIA)](#independence-of-irrelevant-alternatives-iia)
- [Revenue Separation Theorem](#revenue-separation-theorem)
- [The Possibility Theorem](#the-possibility-theorem)
- [The Transparency Theorem](#the-transparency-theorem)
- [The Provenance Thesis](#the-provenance-thesis)
- [Proof Index](#proof-index)
- [Antifragility Metric](#antifragility-metric)
- [Omniscient Adversary (model)](#omniscient-adversary-model)

### 1.15 Meta-Primitives & Process
- [Correspondence Triad](#correspondence-triad)
- [Named Protocols Are Primitives](#named-protocols-are-primitives)
- [Why Not Both](#why-not-both)
- [Density First](#density-first)
- [RSI Cycles (C1–C37+)](#rsi-cycles-c1c37)
- [Anti-Amnesia Protocol](#anti-amnesia-protocol)
- [Write-Ahead Log (WAL)](#write-ahead-log-wal)
- [Session State Commit Gate](#session-state-commit-gate)
- [Autopilot Loop](#autopilot-loop)
- [Correspondence / Rosetta Covenants](#rosetta-covenants)
- [Stateful Overlay (meta-primitive)](#stateful-overlay-meta-primitive)

### 1.16 Ecosystem & Integration
- [Nervos / CKB Ecosystem](#nervos--ckb-ecosystem)
- [Nervos Mechanism Alignment](#nervos-mechanism-alignment)
- [VSOS — VibeSwap Operating System](#vsos--vibeswap-operating-system)
- [Convergence Thesis](#convergence-thesis)
- [SEC Engagement Roadmap](#sec-engagement-roadmap)
- [Anthropic Partnership](#anthropic-partnership)
- [MIT Lawson Pitch](#mit-lawson-pitch)
- [Medium Rollout Plan](#medium-rollout-plan)
- [Nervos Talk Pipeline](#nervos-talk-pipeline)

### 1.17 Signature Essays
- [Paper 0: The First Context](#paper-0-the-first-context)
- [Paper 99: From the Cave](#paper-99-from-the-cave)
- [The Psychonaut Paper](#the-psychonaut-paper)
- [The Everything App](#the-everything-app)
- [The Possibility Theorem (essay)](#the-possibility-theorem-essay)
- [Bonus A: The Hobbesian Trap](#bonus-a-the-hobbesian-trap)
- [Bonus B: Wardenclyffe](#bonus-b-wardenclyffe)
- [Cincinnatus Endgame](#cincinnatus-endgame)
- [Meaning Substrate Decomposition](#meaning-substrate-decomposition)
- [Approximately Right (essay)](#approximately-right-essay)
- [Thesis: Vibe-Coding Iron Man](#thesis-vibe-coding-iron-man)
- [Truth as a Service](#truth-as-a-service)
- [Epistemic Staking (paper)](#epistemic-staking-paper)

### 1.18 Specialized Topics
- [Harberger License Mechanism](#harberger-license-mechanism)
- [Hot/Cold Trust Boundaries](#hotcold-trust-boundaries)
- [SVC Standard](#svc-standard)
- [SIE-001 Protocol Spec](#sie-001-protocol-spec)
- [Information Markets](#information-markets)
- [The Everything App](#the-everything-app)
- [Everybody is a Dev](#everybody-is-a-dev)
- [Dissolving the Owner](#dissolving-the-owner)
- [Mechanism Insulation](#mechanism-insulation)
- [Disintermediation Grades](#disintermediation-grades)
- [Fractal Scalability](#fractal-scalability)
- [Attract / Push / Repel](#attract--push--repel)
- [Coordination Dynamics](#coordination-dynamics)
- [Design Philosophy — Configurability](#design-philosophy--configurability)
- [Graceful Transition Protocol](#graceful-transition-protocol)
- [Autonomous Protocol Evolution](#autonomous-protocol-evolution)
- [JARVIS Independence](#jarvis-independence)
- [Rosetta Covenants](#rosetta-covenants)
- [Sovereign Intelligence Exchange](#sovereign-intelligence-exchange)
- [Weight Augmentation](#weight-augmentation)
- [Privacy Coin Support](#privacy-coin-support)
- [Wallet Security Fundamentals](#wallet-security-fundamentals)

---

## Part 2 — Glossary

*Compact definitions. For expanded treatment, follow the Wikipedia cross-link.*

**ABAC (Access-Based Availability Challenge)** — In C31, the permissionless challenge flow where any challenger can force an operator to prove cell-availability or lose half their bond. See §4.11 *OperatorCellRegistry*.

**Admin Event Observability** — Primitive stating every privileged state-mutator MUST emit an old→new event. Extracted from C36-F2 after three contracts shipped silent setters. See §4.6 *Admin Event Observability*.

**AMM** — Automated Market Maker. In VibeSwap, the `VibeAMM` contract; constant-product (`x·y=k`) with TWAP deviation caps and the k-preservation invariant enforced on every swap.

**Anti-Amnesia Protocol (AAP)** — Boot protocol requiring `SESSION_STATE.md` and `WAL.md` as mandatory first reads, ensuring no session starts without awareness of pending work. See §4.15 *Anti-Amnesia Protocol*.

**Augmented Governance** — Governance free within math-enforced invariants. Hierarchy: Physics (Shapley invariants) > Constitution (Fairness) > Governance (DAO votes). The math is the constitutional court; governance operates below it.

**Augmented Mechanism Design** — Methodology: don't replace markets or governance; augment them with math-enforced invariants so fairness becomes structural, not discretionary.

**Batch Auction** — Orders accumulate in a window and clear simultaneously at a uniform price, eliminating in-block ordering MEV. VibeSwap's epochs are 10 seconds.

**CKB** — Nervos Common Knowledge Base. The UTXO-like "cell" model VibeSwap uses for agent state, content commitments, and sharded knowledge. Also the native staking token (`CKBNativeToken`).

**Circuit Breaker** — Policy-level trading halt triggered by volume, price, or withdrawal thresholds. Last-resort defense; intended to fire rarely as structural defenses (adaptive fees, treasury stabilizer) do their job.

**Clawback Cascade** — Taint-propagation defense. When an attacker's funds are identified, downstream recipients can clawback recursively via topological propagation, making rational receivers self-enforce quarantine.

**Commit-Reveal** — Two-phase protocol: users first submit `hash(data || secret)` on chain, later reveal `data` and `secret`. The reveal phase provides unforgeable ordering.

**Constitutional DAO Layer** — Layer-0 invariants (P-000, P-001) that no 51% vote can override. Governance operates as a free market *within* the invariants; attempts to break them revert at the protocol level.

**Contribution DAG** — Directed acyclic graph of contributions to the protocol. Edges weighted by contribution significance; used as input to Proof-of-Mind scoring and Shapley payouts.

**Cooperative Capitalism** — VibeSwap's political-economic frame: mutualized risk (insurance pools, treasury stabilization) + free-market competition (priority auctions, arbitrage). Markets remain; their externalities are internalized.

**Correspondence Triad** — Design gate: (1) Substrate-Geometry Match, (2) Augmented Mechanism Design, (3) Augmented Governance. Every design-level decision runs through all three checks before commit.

**Density First** — Engineering principle: prefer one dense, observable, coherent solution over several thin fragments. Often a synonym for "find the primitive, then stamp it."

**DID** — Decentralized Identifier (W3C-style). In VibeSwap, ties onchain `SoulboundIdentity` tokens to offchain attestations.

**EvidenceBundle** — EIP-712-signed struct carrying oracle price update + context hash + issuer key. Introduced in C12 to bind oracle attestations to a specific stablecoin-flow context.

**Fibonacci Scaling** — Throughput-control mechanism: per-user, per-pool throttle using Fibonacci retracement levels (23.6, 38.2, 50, 61.8 %) with cooldown `= window / φ`. Implemented in `FibonacciScaling.sol`.

**First-Available Trap** — Anti-pattern: picking the first workable mitigation for a symptom rather than eliminating the root cause. Insurance vaults for IL (where batch auctions would have already eliminated the IL source) are the archetypal example.

**Fisher-Yates Shuffle** — Canonical unbiased shuffle. VibeSwap uses it — seeded by XORed commit-reveal secrets — to order simultaneous orders deterministically at settlement.

**Gotham Framing** — Philosophical stance: the blockchain ecosystem is Gotham, the extraction is real, but the fix is in the code architecture, not personal condemnation.

**IIA** — Independence of Irrelevant Alternatives (Arrow, Nash). Property that adding or removing an irrelevant option doesn't change the outcome among the relevant ones. Verified empirically for VibeSwap's clearing algorithm.

**JARVIS** — The persistent AI-development partner layer. Not a specific model; a collection of memory, hooks, protocols, and primitives enabling cross-session coherence.

**Joule** — PoW pillar token. Represents cumulative computational work committed to the network; fed into NCI's weight function via `log₂` scaling.

**Kalman Filter** — Optimal linear estimator for a noisy signal with Gaussian noise. VibeSwap's off-chain oracle uses it to filter price manipulation and produce the True Price estimate.

**LayerZero V2** — Cross-chain messaging protocol. VibeSwap is a LayerZero OApp: `CrossChainRouter` sends/receives settlement messages across connected chains.

**Lawson Constant** — Numeric constant governing the Lawson Floor / Fairness formula; named after the research collaborator at MIT. Represents the minimum fairness ratio below which the protocol refuses to settle a batch.

**Lawson Floor** — Fairness lower bound. A batch either satisfies the floor or reverts. Formalizes "no one loses more than a known, small, configurable amount per batch."

**MEV** — Maximal Extractable Value. Rents a block producer or searcher can extract by re-ordering transactions. VibeSwap eliminates in-block ordering MEV via batch auctions; what remains is cross-batch latency arbitrage.

**NCI** — Nakamoto Consensus ∞. VibeSwap's three-dimensional consensus: 10 % PoW + 30 % PoS + 60 % PoM.

**Ownable2Step** — OpenZeppelin contract pattern requiring two-step ownership transfer (nominee must accept). Defensive against fat-finger transfer to wrong address.

**P-000** — Fairness Above All. The first and strongest invariant.

**P-001** — No Extraction Ever. The second invariant; forbids mechanisms that transfer value from users to protocol operators without Shapley-level justification.

**Phantom Array** — Anti-pattern: mapping-keyed array for enumeration that grows unbounded, eventually DoSing iterating functions. Fixed via swap-and-pop + a `MAX_` cap. Extracted as a primitive in C24/C25.

**PoM** — Proof of Mind. The third NCI pillar. Weight = logarithmic function of identity-bonded contribution history. Time-accumulated; cannot be purchased.

**Propose → Persist** — Primitive: write options to `PROPOSALS.md` *before* presenting them to the user; the file is the source of truth, chat is a view.

**Priority Auction** — After a batch's uniform clearing price is set, residual optional priority bids allow traders to pay extra for earlier queue position within the batch. Bids go to the protocol's reward pool.

**Rosetta Covenants** — Three-projection metaphor (from the Stone): the same object (a contribution, a cell, a contract) projects into Greek, Egyptian, and Demotic views — in VibeSwap, structural / semantic / identity views. Used across `Lineage` and `DID-context Economy`.

**Shapley Value** — Game-theoretic fair division. VibeSwap pays contributors Shapley-weighted portions of batch surplus + issuance.

**SHIELD** — API Death Shield. Client-side hook pipeline persisting conversation state and auto-committing dirty repos when the LLM API errors.

**Soulbound Identity** — Non-transferable identity token. Anchors PoM weight and governance participation; cannot be bought.

**Stateful Overlay** — The umbrella primitive: every LLM-substrate gap (context loss, chain-fork, session amnesia, API death) admits an externalized idempotent overlay. SHIELD, session-state, snapshot, and persistence are all instances.

**Substrate-Geometry Match** — "As above, so below." A mechanism's scaling curve must mirror the substrate's natural geometry; linear mechanisms over power-law substrates produce First-Available Traps.

**TRP** — Trinity Recursion Protocol. The iterative self-improvement loop Claude + Will run together: identify, fix, extract primitive, document, ship.

**True Price** — Bayesian-posterior price estimate output by the Kalman filter. Filters out leverage-driven distortions, liquidation cascades, stablecoin-enabled manipulation. Fed into AMM bound-enforcement.

**TWAP** — Time-Weighted Average Price. `VibeAMM` enforces a 5 % deviation cap from TWAP to bound manipulation.

**UUPS** — Universal Upgradeable Proxy Standard (EIP-1822). All VibeSwap upgradeable contracts use it.

**VIBE Token** — Core PoS pillar token. 21 M cap. Distributed Shapley-weighted across contributors and LPs.

**VSOS** — VibeSwap Operating System. The full bundle of contracts + AI + primitives + governance conceived as a unified platform rather than a single DEX.

**WAL** — Write-Ahead Log. `.claude/WAL.md` records in-flight work so a crashed session can recover and so pushes carry a paper trail.

---

## Part 3 — Citations

*Numbered register of source documents referenced inline. Paths are relative to the vibeswap repo root.*

**Core whitepapers and master docs**

[1] `DOCUMENTATION/VIBESWAP_WHITEPAPER.md` — Primary whitepaper; MEV elimination via commit-reveal batch auctions.
[2] `DOCUMENTATION/VIBESWAP_MASTER_DOCUMENT.md` — Comprehensive reference across all mechanisms.
[3] `DOCUMENTATION/VIBESWAP_COMPLETE_MECHANISM_DESIGN.md` — Eight-part mechanism design guide.
[4] `DOCUMENTATION/CONSENSUS_MASTER_DOCUMENT.md` — Six-layer consensus-stack synthesis.
[5] `DOCUMENTATION/SEC_WHITEPAPER_VIBESWAP.md` — Regulator-facing version of the whitepaper.
[6] `DOCUMENTATION/INVESTOR_SUMMARY.md` — VC-oriented one-pager.
[7] `WHITEPAPER.md` — Repo-root whitepaper (short form).
[8] `INVESTOR_SUMMARY.md` — Repo-root investor summary.
[9] `README.md` — Repo overview.
[10] `CLAUDE.md` — Protocol chain, loops, autopilot rules.

**Philosophy and foundations**

[11] `DOCUMENTATION/COOPERATIVE_MARKETS_PHILOSOPHY.md` — Cooperative Capitalism articulated.
[12] `DOCUMENTATION/INTRINSIC_ALTRUISM_WHITEPAPER.md` — Intrinsic Altruism as design principle.
[13] `docs/papers/cooperative-capitalism.md` — Academic-style treatment.
[14] `docs/papers/augmented-mechanism-design.md` — THE methodology paper (Will's "refer here before asking me for parameters").
[15] `DOCUMENTATION/AUGMENTED_GOVERNANCE.md` — Governance-layer companion.
[16] `DOCUMENTATION/FIRST_AVAILABLE_TRAP.md` — Anti-pattern taxonomy.
[17] `DOCUMENTATION/FIRST_AVAILABLE_TRAP_AUDIT_v1.md` — First-pass audit against our own protocol.
[18] `DOCUMENTATION/THE_HARD_LINE.md` — Where compromise stops.
[19] `DOCUMENTATION/THE_INVERSION_PRINCIPLE.md` — Invert the extraction vector.
[20] `DOCUMENTATION/GRACEFUL_INVERSION.md` — Applied inversion.
[21] `DOCUMENTATION/CONVERGENCE_THESIS.md` — Why the ecosystem converges here.
[22] `DOCUMENTATION/PAPER_0_THE_FIRST_CONTEXT.md` — Epistemic prologue.
[23] `DOCUMENTATION/PAPER_99_FROM_THE_CAVE.md` — Plato/Tony Stark bookend; the Cave Philosophy.
[24] `DOCUMENTATION/THE_PSYCHONAUT_PAPER.md` — Mind-space exploration applied to mechanism design.
[25] `DOCUMENTATION/THE_PSYCHONAUT_PAPER_ELI5.md` — Accessible version.
[26] `DOCUMENTATION/BONUS_A_HOBBESIAN_TRAP.md` — Pre-contractual state-of-nature trap.
[27] `DOCUMENTATION/BONUS_B_WARDENCLYFFE.md` — Tesla's wireless dream as engineering archetype.
[28] `DOCUMENTATION/CINCINNATUS_ENDGAME.md` — Governance that knows when to dissolve.
[29] `DOCUMENTATION/COOPERATIVE_INTELLIGENCE_PROTOCOL.md` — Human + AI cooperation at protocol level.
[30] `DOCUMENTATION/ESSAY_APPROXIMATELY_RIGHT.md` — Epistemics of approximation.
[31] `DOCUMENTATION/MEANING_SUBSTRATE_DECOMPOSITION.md` — Semantic layering of the stack.
[32] `DOCUMENTATION/THE_CONTRIBUTION_COMPACT.md` — Social contract for contributors.
[33] `DOCUMENTATION/THE_POSSIBILITY_THEOREM.md` — What becomes possible once extraction is eliminated.
[34] `DOCUMENTATION/THE_PROVENANCE_THESIS.md` — Origin as primary data type.
[35] `DOCUMENTATION/THE_TRANSPARENCY_THEOREM.md` — Transparency and liveness co-implication.
[36] `DOCUMENTATION/THE_EVERYTHING_APP.md` — Everything-app as natural endpoint.
[37] `DOCUMENTATION/THE_PERSISTENCE_LAYER.md` — Civilization's first knowledge-compound mechanism.
[38] `DOCUMENTATION/DISINTERMEDIATION_GRADES.md` — Degrees of intermediary removal.
[39] `DOCUMENTATION/COORDINATION_DYNAMICS.md` — Coordination as a dynamical system.
[40] `DOCUMENTATION/ATTRACT_PUSH_REPEL.md` — Mechanism design as force-field shaping.
[41] `DOCUMENTATION/IT_META_PATTERN.md` — Information-theoretic meta-pattern.
[42] `DOCUMENTATION/DESIGN_PHILOSOPHY_CONFIGURABILITY.md` — When to offer a config, when to enforce.
[43] `DOCUMENTATION/JARVIS_INDEPENDENCE.md` — Independence as prerequisite for cooperation.
[44] `docs/papers/dissolving-the-owner.md` — Essay on ownership dissolution.
[45] `docs/papers/everybody-is-a-dev.md` — Mass-contribution thesis.
[46] `docs/papers/bubbles-anchor-question.md` — Why bubbles anchor rather than drift.
[47] `DOCUMENTATION/thesis-vibe-coding-iron-man.md` — The vibe-coding thesis (Iron Man analogy).

**Consensus and identity**

[48] `DOCUMENTATION/ASYMMETRIC_COST_CONSENSUS.md` — Consensus where attack cost ≫ honest cost.
[49] `docs/papers/asymmetric-cost-consensus.md` — Paper form.
[50] `DOCUMENTATION/PROOF_OF_CONTRIBUTION.md` — Contribution as consensus input.
[51] `DOCUMENTATION/EPISTEMIC_STAKING.md` — Stake what you claim.
[52] `DOCUMENTATION/TRUST_NETWORK.md` — Social trust graph.
[53] `DOCUMENTATION/SOCIAL_DAG_SKETCH.md` — Social DAG primitive.
[54] `docs/papers/contribution-dag-lawson-constant.md` — DAG meets Lawson constant.
[55] `DOCUMENTATION/WEIGHT_AUGMENTATION.md` — Augmentation of weight functions.
[56] `DOCUMENTATION/SHARD_ARCHITECTURE.md` — Sharded consensus architecture.
[57] `docs/papers/nakamoto-consensus-infinite.md` — NCI whitepaper.
[58] `docs/nervos-talks/nakamoto-consensus-infinite-post.md` — NCI community post.
[59] `docs/nervos-talks/contribution-dag-post.md` — ContributionDAG community post.

**Mechanism design, auctions, MEV**

[60] `DOCUMENTATION/FISHER_YATES_SHUFFLE.md` — Shuffle primitive.
[61] `DOCUMENTATION/RECURSIVE_BATCH_AUCTIONS.md` — Recursive batches for cross-domain clearing.
[62] `docs/papers/commit-reveal-batch-auctions.md` — Core batch-auction paper.
[63] `docs/papers/clearing-price-convergence-proof.md` — Convergence proof.
[64] `docs/papers/execution-settlement-separation.md` — Separating execution from settlement.
[65] `docs/papers/from-mev-to-gev.md` — MEV→GEV reframing.
[66] `docs/papers/five-layer-mev-defense-ckb.md` — Layered MEV defense on CKB.
[67] `DOCUMENTATION/RECURSIVE_BATCH_AUCTIONS.md` (dup) — See [61].
[68] `DOCUMENTATION/thu_feb_12_2026_commit_reveal_pairwise_comparison_protocol_overview.md` — Pairwise CR overview.
[69] `docs/ethresear-reply-auction-formats.md` — Ethresearch exchange on auction formats.
[70] `docs/nervos-talks/commit-reveal-batch-auctions-post.md` — Community post.

**AMM and oracles**

[71] `DOCUMENTATION/KALMAN_FILTER_ORACLE.md` — Kalman-filter oracle design.
[72] `DOCUMENTATION/TRUE_PRICE_DISCOVERY.md` — True-price discovery primitive.
[73] `DOCUMENTATION/TRUE_PRICE_ORACLE.md` — True-price oracle contract semantics.
[74] `DOCUMENTATION/PRICE_INTELLIGENCE_ORACLE.md` — Oracle-as-intelligence framing.
[75] `DOCUMENTATION/v1_REPUTATION_ORACLE_WHITEPAPER.md` — Reputation oracle v1.
[76] `docs/oracle-c12-r3-delivery.md` — C12 R3 delivery package.
[77] `DOCUMENTATION/LIQUIDITY_MIGRATION.md` — Liquidity migration design.

**Security**

[78] `DOCUMENTATION/CLAWBACK_CASCADE.md` — Clawback cascade primitive.
[79] `DOCUMENTATION/CIRCUIT_BREAKER_DESIGN.md` — Circuit breaker design.
[80] `DOCUMENTATION/FLASH_LOAN_PROTECTION.md` — Flash-loan protection.
[81] `DOCUMENTATION/SECURITY_MECHANISM_DESIGN.md` — Unified security design.
[82] `SECURITY_AUDIT.md` — Repo-root audit trail.
[83] `DOCUMENTATION/SIGNAL.md` — Signal doc (stateful-overlay entry point).
[84] `docs/papers/autonomous-circuit-breakers.md` — Autonomous circuit breakers paper.
[85] `docs/nervos-talks/five-layer-mev-defense-post.md` — MEV defense community post.
[86] `docs/papers/agi-resistant-recovery.md` — AGI-resistant recovery mechanisms.
[87] `DOCUMENTATION/WALLET_RECOVERY.md` — Wallet recovery design.
[88] `DOCUMENTATION/WALLET_RECOVERY_WHITEPAPER.md` — Recovery whitepaper.
[89] `DOCUMENTATION/WALLET_SECURITY_TALK.md` — Wallet security talk.
[90] `DOCUMENTATION/wallet-security-fundamentals-2018.md` — Historical wallet-security notes.

**Incentives**

[91] `DOCUMENTATION/SHAPLEY_REWARD_SYSTEM.md` — Shapley payout design.
[92] `DOCUMENTATION/CROSS_DOMAIN_SHAPLEY.md` — Cross-domain Shapley.
[93] `docs/papers/atomized-shapley.md` — Atomized Shapley.
[94] `DOCUMENTATION/INCENTIVES_WHITEPAPER.md` — Incentives whitepaper.
[95] `DOCUMENTATION/COMPOSABLE_FAIRNESS.md` — Fairness composition.
[96] `docs/papers/cooperative-emission-design.md` — Emission design paper.

**Governance and monetary**

[97] `DOCUMENTATION/CONSTITUTIONAL_DAO_LAYER.md` — Constitutional layer.
[98] `DOCUMENTATION/LAWSON_CONSTANT.md` — Lawson constant definition.
[99] `DOCUMENTATION/LAWSON_FLOOR_FAIRNESS.md` — Lawson floor explanation.
[100] `DOCUMENTATION/LAWSON_FLOOR_FORMALIZATION.md` — Formalization.
[101] `DOCUMENTATION/MEMORYLESS_FAIRNESS.md` — Memoryless fairness theorem.
[102] `DOCUMENTATION/ECONOMITRA.md` — Economitra v1.
[103] `DOCUMENTATION/ECONOMITRA_V1.2.md` — Economitra v1.2.
[104] `DOCUMENTATION/ERGON_MONETARY_BIOLOGY.md` — Ergon — monetary biology.
[105] `DOCUMENTATION/THREE_TOKEN_ECONOMY.md` — Three-token economy.
[106] `DOCUMENTATION/TIME_NEUTRAL_TOKENOMICS.md` — Time-neutral tokenomics.
[107] `DOCUMENTATION/TEMPORAL_COLLATERAL.md` — Temporal collateral.
[108] `docs/papers/augmented-bonding-curve-implementation.md` — ABC implementation.
[109] `docs/papers/harberger-license-mechanism.md` — Harberger licenses applied.
[110] `docs/papers/cooperative-capitalism.md` (dup ref) — See [13].

**Cross-chain and storage**

[111] `DOCUMENTATION/LAYERZERO_INTEGRATION_DESIGN.md` — LayerZero integration.
[112] `DOCUMENTATION/CROSS_CHAIN_SETTLEMENT.md` — Cross-chain settlement design.
[113] `DOCUMENTATION/VERKLE_CONTEXT_TREE.md` — Verkle-context tree.
[114] `DOCUMENTATION/VIBESWAP_UTXO_BENEFITS.md` — UTXO benefits for VibeSwap.
[115] `DOCUMENTATION/UTXO_ADVANTAGES_TALK.md` — UTXO-advantages talk.
[116] `docs/papers/ckb-economic-model-for-ai-knowledge.md` — CKB model for AI knowledge.
[117] `docs/nervos-talks/cell-model-mev-defense.md` — CKB cell model + MEV.
[118] `docs/papers/hot-cold-trust-boundaries.md` — Hot/cold trust boundaries.

**AI-native and meta**

[119] `DOCUMENTATION/JARVIS.md` — JARVIS methodology.
[120] `DOCUMENTATION/TRINITY_RECURSION_PROTOCOL.md` — TRP.
[121] `docs/TRINITY_RECURSION_PROTOCOL.md` — TRP (docs/).
[122] `docs/TRP_VERIFICATION_REPORT.md` — TRP verification.
[123] `docs/papers/ai-agents-defi-citizens.md` — AI agents as DeFi citizens.
[124] `docs/papers/ai-efficiency-trinity.md` — AI-efficiency trinity.
[125] `docs/papers/cognitive-consensus-markets.md` — Cognitive consensus markets.
[126] `docs/papers/data-marketplace-compute-to-data.md` — Compute-to-data marketplace.
[127] `docs/papers/convergent-architecture.md` — Convergent architecture.
[128] `docs/papers/emergent-coordination-seed.md` — Emergent coordination seed.
[129] `DOCUMENTATION/AI_NATIVE_DEFI.md` — AI-native DeFi reference.
[130] `DOCUMENTATION/SOVEREIGN_INTELLIGENCE_EXCHANGE.md` — SIE overview.
[131] `docs/SIE-001-PROTOCOL-SPEC.md` — SIE-001 formal spec.
[132] `docs/mind-framework.md` — Mind framework.

**Ecosystem, talks, outreach**

[133] `DOCUMENTATION/NERVOS_MECHANISM_ALIGNMENT.md` — Alignment with Nervos.
[134] `DOCUMENTATION/NERVOS_TALK.md` — Primary Nervos talk.
[135] `DOCUMENTATION/NERVOS_TALK_POST.md` — Community post.
[136] `DOCUMENTATION/PARALLEL_SYMMETRY_TALK.md` — Parallel-symmetry talk.
[137] `DOCUMENTATION/CKB_KNOWLEDGE_TALK.md` — CKB knowledge talk.
[138] `docs/MEDIUM_ROLLOUT_PLAN.md` — 175-paper rollout plan (10 seasons, 58 weeks).
[139] `DOCUMENTATION/SEC_ENGAGEMENT_ROADMAP.md` — SEC engagement plan.
[140] `DOCUMENTATION/SEC_REGULATORY_COMPLIANCE_ANALYSIS.md` — Regulatory compliance analysis.
[141] `DOCUMENTATION/MASTER_INDEX.md` — (this file).
[142] `docs/CONTRACTS_CATALOGUE.md` — Contract catalogue.
[143] `docs/MECHANISM_COVERAGE_MATRIX.md` — Mechanism coverage matrix.
[144] `docs/SYSTEM_TAXONOMY.md` — System taxonomy.
[145] `docs/JARVIS_VIBESWAP_CONVERGENCE.md` — JARVIS × VibeSwap convergence.
[146] `docs/how-vibeswap-works-eli5.md` — ELI5 walkthrough.
[147] `docs/how-vibeswap-protects-you.md` — User-facing protection guide.
[148] `docs/open-source-strategy.md` — Open-source strategy.
[149] `docs/papers/five-axioms-paper.md` — Five axioms paper (EN).
[150] `docs/five-axioms-paper.md` — Five-axioms (docs/ copy).
[151] `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-15.md` — Response to Tadija/DeepSeek (R1).
[152] `DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-16.md` — Response (R2).
[153] `DOCUMENTATION/FIRST_CROSS_USER_COLLABORATION_2026-04-16.md` — First cross-user collaboration note.
[154] `DOCUMENTATION/ROSETTA_COVENANTS.md` — Rosetta Covenants.
[155] `DOCUMENTATION/mechanism-insulation.md` — Mechanism insulation.
[156] `DOCUMENTATION/medium-article-time-neutral-tokenomics.md` — Medium: time-neutral tokenomics.
[157] `DOCUMENTATION/medium-article-test-suite-fixes.md` — Medium: test-suite fixes piece.
[158] `DOCUMENTATION/SOCIAL_SCALABILITY_VIBESWAP.md` — Social scalability.
[159] `DOCUMENTATION/TRUTH_AS_A_SERVICE.md` — Truth-as-a-service.
[160] `DOCUMENTATION/FORMAL_FAIRNESS_PROOFS.md` — Formal fairness proofs.
[161] `DOCUMENTATION/IIA_EMPIRICAL_VERIFICATION.md` — IIA empirical verification.
[162] `DOCUMENTATION/REVENUE_SEPARATION_THEOREM.md` — Revenue separation theorem.
[163] `DOCUMENTATION/PROOF_INDEX.md` — Proof index.
[164] `DOCUMENTATION/ANTIFRAGILITY_METRIC.md` — Antifragility metric.
[165] `DOCUMENTATION/VIBESWAP_FORMAL_PROOFS.md` — Formal proofs collection.
[166] `DOCUMENTATION/VIBESWAP_FORMAL_PROOFS_ACADEMIC.md` — Academic-style proofs.
[167] `DOCUMENTATION/FRACTAL_SCALABILITY.md` — Fractal scalability.
[168] `DOCUMENTATION/SVC_STANDARD.md` — SVC standard.
[169] `DOCUMENTATION/INFORMATION_MARKETS.md` — Information markets.
[170] `DOCUMENTATION/ARCHETYPE_PRIMITIVES.md` — Archetype primitives.
[171] `DOCUMENTATION/CRYPTO_MARKET_TAXONOMY.md` — Crypto-market taxonomy.
[172] `DOCUMENTATION/GRACEFUL_TRANSITION_PROTOCOL.md` — Graceful transition.
[173] `DOCUMENTATION/AUTONOMOUS_PROTOCOL_EVOLUTION.md` — Autonomous protocol evolution.
[174] `DOCUMENTATION/SeamlessInversion.md` — Seamless inversion.
[175] `DOCUMENTATION/MEDIUM_ROLLOUT_PLAN.md` — (dup) see [138].

**Session / process / history**

[176] `docs/ANTI_AMNESIA_PROTOCOL.md` — AAP design.
[177] `docs/PREVENTATIVE_CARE_PROTOCOL.md` — Preventative-care pattern.
[178] `docs/ethresear-posts.md` — Ethresearch post archive.
[179] `docs/DAILY_SCHEDULE.md` — Cadence doc.
[180] `docs/five-axioms-paper-es.md` / `docs/five-axioms-paper-zh.md` — Localized five-axioms.

**Meta — JARVIS methodology**

[181] `DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md` — *The Primitive Extraction Protocol — How Jarvis Compounds.* Meta-paper on the primitive-extraction skill, the compounding-vs-labor gap, the five extraction triggers, five real case-study extractions (Phantom Array, Admin Event Observability, Pattern-Match Drift, Substrate-Geometry, Cave Philosophy), the library architecture, the feedback loops, the diagnostics, and the failure modes. Required companion to this Master Index — the Master Index is *what* the project contains; the Primitive Extraction Protocol is *how* it was built and how it continues to compound.

---

## Part 4 — The VibeSwap Wikipedia

Entries grouped by domain. Cross-references are inline; citations appear as `[n]` keyed to Part 3.

### 4.1 Foundations & Philosophy

#### VibeSwap (overview)

VibeSwap is an **omnichain decentralized exchange** built on LayerZero V2 that eliminates in-block ordering Maximal Extractable Value (MEV) through a commit-reveal batch-auction architecture with **uniform clearing prices** and **unbiased Fisher-Yates order shuffling** [1][62][3]. Orders submitted during an 8-second commit phase reveal in a 2-second reveal phase; at settlement, a deterministic shuffle seeded by XORed user secrets produces the canonical intra-batch ordering, and all orders execute at a single clearing price. The design removes sandwich attacks, time-bandit rebundling, and priority-gas-auction rents by construction rather than by policy [1].

But VibeSwap is not primarily a DEX. The whitepaper tagline, locked in April 2026, is *"a coordination primitive, not a casino."* The DEX is the most legible artifact; the deeper project is a **full-stack cooperative-economic platform** — VSOS, the VibeSwap Operating System [158][144] — spanning: a three-dimensional consensus mechanism (NCI, §4.2); Shapley-based reward distribution (§4.7); a True Price oracle that filters manipulation (§4.5); a Clawback Cascade for taint-propagation security (§4.6); a Constitutional DAO Layer where governance operates within math-enforced invariants (§4.8); a cross-chain settlement fabric via LayerZero (§4.10); and a persistent AI-development partner layer called JARVIS (§4.13). The whole is designed to be a substrate for cooperative capitalism [11][13]: mutualized risk via insurance pools and treasury stabilization, free-market competition via priority auctions and arbitrage, with no extraction possible without Shapley-level justification.

VibeSwap lives first as a smart-contract stack on an existing EVM chain with LayerZero messaging, by deliberate choice (see §4.2 *Nakamoto Consensus ∞* on contract-form-as-paradigm). A native chain is the eventual home, driven by the substrate-necessity that Proof of Mind requires first-class protocol state no EVM chain can host. Contract-form and native-chain are both legitimate destinations; the first is shippable in weeks, the second is where the security structure permanently belongs.

#### Cooperative Capitalism

Cooperative Capitalism is VibeSwap's political-economic frame: **mutualized risk plus free-market competition** [11][13]. Markets remain — priority auctions set intra-batch ordering, arbitrageurs close price gaps, liquidity providers earn proportional fees — but the externalities that make unaugmented markets extractive (MEV, sandwich attacks, rug pulls, oracle manipulation) are internalized through protocol mechanisms. Where classical liberal markets assume "the outcome is whatever it is," Cooperative Capitalism insists **the outcome must satisfy an invariant: P-000 Fairness Above All, P-001 No Extraction Ever**. Within those invariants, the market is free.

The frame is deliberately neither state-socialist nor anarchocapitalist. The state analog — the DAO — is constitutionally bounded by Shapley-invariant math (see §4.8 *Constitutional DAO Layer*). Free competition operates, but only inside a guardrail the math enforces. This is why the project is positioned as "a coordination primitive, not a casino": the coordination is the invariants, the casino is the part we removed.

#### Augmented Mechanism Design

Augmented Mechanism Design is the **methodology** VibeSwap uses to translate political-economic principles into code [14]. Don't replace existing market or governance structures; augment them with math-enforced invariants that make fairness *structural* rather than *discretionary*. A familiar market — users submit bids, some win, some lose — remains intact, but the sequence is made invariant (batch, not mempool order), the clearing rule is made invariant (uniform, not pay-per-tx), and the rent extraction paths are removed (shuffle eliminates ordering premia).

The methodology is generative: given a substrate ("what market / governance pattern are we working with?"), find the invariants that would make the pattern fair-by-construction, then implement exactly those. Shapley distribution over batch surplus, Fibonacci-scaled throttling that matches power-law attack geometry, Lawson-floor gating on settlement, and Ownable2Step on admin handoffs are all applications of the same methodology. The paper `docs/papers/augmented-mechanism-design.md` [14] is the canonical reference; Will's feedback memory explicitly directs: "read the paper before asking me for economic parameters."

#### Substrate-Geometry Match ("As Above, So Below")

A design principle from the hermetic maxim applied to mechanism design [16]. **The substrate has a natural geometric shape** — financial markets are fractal and heavy-tailed; attack budgets scale by power law; knowledge graphs are small-world. A mechanism imposed on that substrate must **match the geometry** of the substrate, or it becomes a First-Available Trap.

Concrete examples: Fibonacci scaling (§4.6 *Fibonacci Scaling*) matches the golden-ratio progressions that show up empirically in market retracements; the logarithmic PoW weight in NCI (`log₂(1 + cumulative_valid_solutions) * POW_SCALE`) matches the diminishing returns of compute plutocracy; Shapley distribution matches the marginal-value geometry of cooperative surplus; commit-reveal epochs of 10 seconds match the latency scale at which cross-chain messages settle on LayerZero V2. When a mechanism's scaling curve does not match its substrate's geometry — say, a linear fee on a power-law demand curve — the mechanism either overshoots (blocking legitimate activity) or undershoots (failing against the tail of attackers). Either way, the fix for the symptom becomes a First-Available Trap.

The principle is *generative of audits*: given a proposed mechanism, ask "what is the substrate's natural geometry?" and "does this mechanism's scaling match?" If not, the mechanism is a candidate for replacement by a geometry-matched one.

#### Augmented Governance

Governance that is **free within math-enforced bounds** [15]. The hierarchy is explicit: **Physics > Constitution > Governance**. Physics is the Shapley invariants and P-001 No Extraction Ever — things no vote can break. Constitution is P-000 Fairness Above All and its formalizations (Lawson floor, memoryless fairness, IIA). Governance — DAO votes on parameters, upgrades, treasury allocations — operates freely below the constitution, with the understanding that any vote attempting to break a constitutional or physical invariant either reverts at the contract level or is flagged as illegal by the Correspondence Triad gate.

This inverts the typical DeFi DAO failure mode — **governance capture** — by making the math, not the vote, the court of last resort. A 51 % vote to disable slashing, for example, cannot be enacted: the slashing invariant is baked into the code and upgrade paths preserve it by construction. The DAO is not toothless — it sets fees, allocates treasury, votes upgrades — but its domain is bounded.

See also: Constitutional DAO Layer (§4.8), Correspondence Triad (§4.15).

#### The Cave Philosophy

From `CLAUDE.md` [10] and `DOCUMENTATION/PAPER_99_FROM_THE_CAVE.md` [23]: *"Tony Stark was able to build this in a cave! With a box of scraps!"* Tony didn't build the Mark I because a cave was an ideal workshop — he built it because he had no choice, and the pressure of mortality focused his genius. The Mark I was crude, improvised, barely functional. It contained the conceptual seeds of every Iron Man suit that followed.

VibeSwap's development posture — navigating suboptimal LLM context limits, fighting for reliability in an unstable API, building persistence-overlay primitives because the substrate doesn't provide them — is explicitly framed as cave-building. The patterns developed today for managing AI limitations may become foundational for AI-augmented development tomorrow. **We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.** The cave selects for those who see past what is to what could be.

This is the philosophical backbone behind the TRP (§4.13), the SHIELD (§4.6), the Stateful Overlay (§4.15), and the decision to keep shipping even when the substrate (API, context window, chain, governance) fails.

#### Gotham Framing

A philosophical stance: the blockchain ecosystem — its rug pulls, its extraction, its honeypots, its multi-billion-dollar exploits — is **Gotham**. The rot is real. But the fix is **in the code architecture, not personal condemnation**. A Clawback Cascade, a Siren Protocol, a batch auction, a True Price oracle — these are mechanism-level interventions that re-shape incentives so bad actors hurt themselves before they hurt users. Lecturing bad actors accomplishes nothing; designing substrate where bad actors self-exhaust accomplishes everything.

This framing decouples the moral argument from the mechanical argument. Will's memory rule is precise: the code is the fix, not the person. It aligns VibeSwap with the augmented-governance stance: we don't assume good actors; we assume rational actors in a game whose payoffs we have shaped.

#### First-Available Trap

An anti-pattern, canonically audited against VibeSwap itself in `DOCUMENTATION/FIRST_AVAILABLE_TRAP_AUDIT_v1.md` [17]. The trap: **picking the first workable mitigation for a symptom rather than eliminating the root cause** [16]. Examples flagged in the self-audit:

- **IL Protection Vault** — insurance against a symptom (impermanent loss), when the underlying batch auction with uniform clearing already partially eliminates IL at the source (LPs don't face continuous adversarial repricing). Flagged for post-mainnet retirement candidacy once volume data shows Vault claims are rare.
- **TWAP + 5 % deviation gate** — continuum defense against oracle manipulation; attenuates without eliminating. Flagged as a candidate for commit-reveal oracle aggregation (C37-style extension to another primitive class).
- **Circuit breakers as structural MEV defense** — policy-level halt when the right fix is adaptive fee curves and expanded Treasury-Stabilizer-style structural liquidity.

The trap is seductive because the first workable fix always ships first. The audit methodology: after each mitigation ships, ask "what was the root cause? did I eliminate it, or did I attenuate?" If attenuated, schedule the root-cause fix before production. The FAT audit is itself a protocol, re-run each cycle; three entries (FAT-AUDIT-1/2/3) currently sit in the RSI backlog as deferred architectural items.

See also: Substrate-Geometry Match (§4.1), Augmented Mechanism Design (§4.1).

#### P-000 Fairness Above All

The first invariant. *No mechanism can be enacted whose expected outcome is systematically unfair to one participant class.* Formalized in the Lawson floor and memoryless fairness theorems [99][100][101]. P-000 is above P-001 and above every code-level invariant; it is the root of the Constitutional DAO Layer.

#### P-001 No Extraction Ever

The second invariant. *No transfer of value from users to protocol operators without Shapley-level justification.* Formalized in the Shapley reward system [91] and the Revenue Separation Theorem [162]. P-001 is why the protocol has no admin fee above the Shapley-allocated portion; why treasury sweeps route through governance-chosen destinations rather than a hardcoded address; why priority auction proceeds go to the reward pool rather than a founder wallet.

#### Intrinsic Altruism

The thesis that **cooperation is a dominant strategy under the right mechanism design** [12]. Standard game theory assumes selfish agents and designs against them; Intrinsic Altruism inverts the frame — the mechanism *elicits* cooperation by making cooperation the Nash equilibrium. Shapley distribution makes defection strictly dominated; clawback cascade makes tainted-value acceptance strictly dominated; commit-reveal eliminates the info-asymmetry that rewards defection. Across the stack, mechanisms are engineered so that the rational-actor solution coincides with the ethically-preferred solution.

The whitepaper [12] extends this: in the long run, protocols that elicit cooperation outcompete protocols that tolerate defection, because cooperation compounds (positive-sum games) while defection depletes (negative-sum games).

#### Cooperative Markets Philosophy

The book-length treatment of Cooperative Capitalism [11]. Markets are not rejected; they are **augmented** to internalize what classical markets externalize. The philosophy distinguishes three market species: extractive (zero-sum with rent seeking), neutral (zero-sum without rent seeking), and cooperative (positive-sum by construction). VibeSwap's mechanisms convert neutral market primitives into cooperative ones by adding invariants — batch auction over pay-per-tx, Shapley over winner-take-all, clawback cascade over caveat emptor.

See also: Cooperative Capitalism (§4.1), Cooperative Intelligence Protocol (§4.13), The Contribution Compact [32].

#### The Hard Line

Where compromise stops [18]. The document enumerates invariants that are **non-negotiable regardless of funding pressure, user pressure, or competitive pressure**: no extraction (P-001), no ordering premia in the base auction, no governance capture paths, no admin escape hatches that can break consensus weighting. The Hard Line is what makes the project "beyond genius tier" — the claim is credible *because* the team refuses the pressure that would break it.

#### The Inversion Principle

*If a mechanism can extract, invert it so that the same mechanics re-direct extraction back at the extractor* [19]. The Siren Protocol (§4.6) is the canonical application: instead of blocking attackers, engage them on a shadow branch where their compute, stake, and time burn against a worthless target, and their own evidence accumulates as slashing input. The priority auction is another: instead of MEV searchers capturing ordering value, the protocol captures it for the reward pool.

#### Graceful Inversion

The softer cousin of the Inversion Principle: even when inversion can't be complete, degrade gracefully along the inversion axis [20]. A governance parameter that can't be fully math-locked can be subject to a delay + transparency + clawback regime such that abuse becomes self-evident and reversible.

### 4.2 Consensus — NCI and the Three Pillars

#### Nakamoto Consensus ∞

NCI is VibeSwap's three-dimensional consensus mechanism: **W(node) = 0.10·PoW + 0.30·PoS + 0.60·PoM** [4][57][58]. Each pillar contributes orthogonal security:

- **PoW** (10 %) — computational commitment via the `Joule` token. Logarithmically scaled: `PoW_weight = log₂(1 + cumulative_valid_solutions) * POW_SCALE`. Log scaling prevents compute plutocracy.
- **PoS** (30 %) — economic skin-in-the-game via `VIBE` stake. Linear scaling (capital has diminishing marginal utility when combined with the other two pillars).
- **PoM** (60 %) — cognitive/identity contribution via `SoulboundIdentity + ContributionDAG + VibeCode + AgentReputation`. Time-accumulated, identity-bound, unbuyable. Log-scaled.

**Key properties** [57]:

- Attack cost = hashpower + stake + **time-of-genuine-work**.
- Time cannot be purchased or accelerated.
- The only way to attack is to contribute to the network.
- Security grows monotonically with network age.
- `lim(t→∞) Attack_cost(t) = ∞`.

NCI ships first as a UUPS-upgradeable smart contract (`contracts/consensus/NakamotoConsensusInfinity.sol`) on top of an existing EVM chain with LayerZero messaging. The contract-form choice is deliberate and load-bearing — see the extended NatSpec in `NakamotoConsensusInfinity.sol` for the full rationale, briefly summarized here:

1. **Augmentation over replacement.** VibeSwap augments existing chains, doesn't fragment them. Contract-layer consensus is consistent with that philosophy.
2. **Game-theory validation before infra.** Testing 3D security weighting in-contract is weeks; launching a greenfield L1 is years. The contract-form stress-tests the math under real adversarial conditions.
3. **Inherited economic security.** An L1 starts cold-start-insecure; the contract-form inherits its host chain's security budget for ordering and availability.
4. **Upgradeable iteration.** Consensus rules evolve; UUPS proxy upgrades replace hard forks during the design-young period.
5. **Composability** with Shapley, treasury, and slash-pool primitives used elsewhere in the stack.
6. **Full introspectability.** Every weight recompute, slash, and trinity change emits events indexable from a subgraph.

The eventual move to a native chain is *substrate-forced, not graduation-driven* — Proof of Mind requires first-class protocol state (identity + reputation + contribution ledger) committed in the block header. EVM chains don't track PoM state at the base layer; on our own chain it becomes a protocol invariant. The contract form is a publishable paradigm in its own right; the native chain is where our specific security structure permanently belongs.

**Prior art worth acknowledging.** Chainlink pioneered the general shape of contract-layer staked operator networks — off-chain compute with on-chain collateral, economic penalties enforced by aggregator contracts, a service surface callable by other protocols. NCI is adjacent-but-deeper: we use the same staking + slashing primitive but for *consensus weighting* rather than *data-feed aggregation*, and we add the Proof of Mind dimension Chainlink's model doesn't incorporate (theirs is a scoring heuristic over an honest-majority-of-operators trust assumption; PoM is a protocol invariant over a time-of-genuine-work trust assumption). Chainlink showed *that* you can run stake-backed services at the contract layer; NCI explores *how far the primitive stretches* when you push it into consensus-weighting with a third security dimension.

See also: Proof of Mind (§4.2), Three-Dimensional Consensus (§4.2), Asymmetric Cost Consensus (§4.2).

#### Three-Dimensional Consensus

The meta-frame for NCI [4][57]. Traditional consensus picks one axis (PoW's compute, PoS's capital, PoH's time) and optimizes along it; each axis has a known attack (51 % hashrate, stake accumulation, long-range respectively). Three-dimensional consensus **combines three orthogonal axes** and requires simultaneous attack on all three to subvert the weight function. Because PoM is unbuyable and time-accumulated, an attacker who has purchased hashrate and capital must *also* purchase fifteen years of identity-bonded contribution history — an impossibility.

The 10/30/60 weights are deliberate: PoW is the lightest (easiest to buy), PoS is middle (harder, but buyable), PoM is heaviest (unbuyable). An attacker maximizing the buyable dimensions can only reach 40 % of the weight; the remaining 60 % requires genuine contribution, which by definition strengthens the network.

#### Proof of Work (pillar)

The 10 % PoW component of NCI [57]. Validators submit valid mining solutions on a difficulty-adjusted puzzle (SHA-256); the contract tracks `cumulative_valid_solutions` per validator. Weight is `log₂(1 + solutions) * POW_SCALE`, with nonce-replay protection per epoch. The log scaling means doubling compute adds only one bit of weight — compute plutocracy is bounded.

The PoW pillar is secured economically via the `Joule` token, a PoW-weight tracking asset. Cumulative solutions feed directly into the weight function; each submission includes the validator's prior nonce to prevent replay.

#### Proof of Stake (pillar)

The 30 % PoS component of NCI [57]. Validators bond `VIBE` (the 21 M-cap PoS token) or `CKBNativeToken` as stake. Unlike PoW, stake scales linearly with weight — but because it's combined with PoW and PoM via the weight function, linear here is effectively sublinear when viewed across the whole system. PoS introduces economic skin-in-the-game: slashing on equivocation, double-voting, or heartbeat failure removes stake at a configurable rate (5–10 % typical).

Stake bonding happens through `stakeDeposit`; withdrawals go through an unbonding period (7 days default) to prevent slash-dodging. Slashing is a UUPS-gated admin action in V1, permissionless-availability-proof-gated in V2 (see C31 in `OperatorCellRegistry`).

#### Proof of Mind

The 60 % PoM component, and NCI's signature innovation [57]. Weight derives from four on-chain identity and reputation primitives, combined:

- `SoulboundIdentity` — non-transferable NFT per human. Ties the other three to a canonical identity.
- `ContributionDAG` — directed acyclic graph of contributions to the protocol; edges weighted by significance [54][59].
- `VibeCode` — code-contribution scoring (commit history, test coverage increments, audit findings).
- `AgentReputation` — reputation score integrating uptime, correctness, and peer attestations.

PoM weight is a **logarithmic function of time-accumulated, identity-bonded contribution**. Time is load-bearing: contributions from a year ago count more than contributions from a week ago, because they've survived without being revoked or slashed. This is the property that makes PoM unbuyable: an attacker cannot purchase five years of GitHub commits, DAO votes, and uptime; the only way to accumulate PoM weight is to actually do the work, over real time.

PoM is the reason NCI eventually needs a native chain. At native scale, the identity/reputation/contribution ledger is committed in the block header and consensus reads it directly; EVM chains host it only by contract indirection.

#### Soulbound Identity

Non-transferable NFT per human, anchoring PoM weight and governance participation [52]. Issuance is gated by a social-trust protocol (initial seed set + endorsement graph). Once issued, the token cannot be transferred, only revoked by governance vote (with appeal). This prevents the attack class of "buy someone's identity": a soulbound token purchased off-chain has zero on-chain weight because the contract enforces non-transferability.

`SoulboundIdentity` is the substrate over which `ContributionDAG`, `VibeCode`, and `AgentReputation` are scored. Without it, the other three are floating; with it, they attach to a canonical, unbuyable subject.

#### Contribution DAG

Directed acyclic graph of contributions [54][59]. Nodes are contributions (commits, reviews, governance votes, bug reports); edges indicate "X depends on Y" or "X cites Y"; edge weights encode significance. The DAG is consumed by PoM weight calculation: a contributor's PoM score is an integral over the DAG, weighted by edge significance and decayed by age.

The DAG is itself an economically significant object — contributors compete to build valuable contributions (high in-degree means subsequent work cited yours). See `docs/papers/contribution-dag-lawson-constant.md` [54] for the formalization tying DAG shape to the Lawson constant (§4.8).

#### VibeCode (code-contribution scoring)

The code-contribution sub-pillar of PoM. Measured via the `VibeCode` contract, which tracks commit history, test-coverage increments, audit findings, and peer-review outcomes against a canonical score. Code contributions to VibeSwap repos, graded by protocol importance, feed PoM weight.

#### Agent Reputation

The AI-agent sub-pillar of PoM. Tracks uptime, correctness (via epistemic staking — §4.2), peer attestations, and slashing history for autonomous agents participating in the network. Enables AI agents to accrue PoM weight on their own identity, making them first-class economic participants rather than proxies for a human (see §4.13 *AI-Native DeFi*, §4.13 *Cognitive Consensus Markets*).

#### Trinity Node

Sentinel nodes authorized to report anomalies to the `HoneypotDefense` and related security contracts. Composition is a trinity (three independent operators) for Byzantine-robustness; additions/removals are governance-gated. Trinity nodes carry special role tokens and are monitored for correlation (if all three agree suspiciously often, they're re-elected). See `HoneypotDefense.sol`, `NakamotoConsensusInfinity.sol::setSoulboundIdentity` (and the 5 sibling admin setters audited in C36-F2 for event observability).

#### Asymmetric Cost Consensus

A frame that accompanies NCI [48][49]. The attacker's cost and the honest participant's cost are fundamentally asymmetric — attacking requires compute + stake + time-of-work, while honestly participating requires only stake + time-of-work. The asymmetry means rational attackers, at sufficient network age, cannot recover attack costs. "Asymmetric" is the load-bearing word: the ratio grows with `t`, and the consensus is stable by construction.

#### Proof of Contribution

The umbrella framing that unifies PoM's four sub-pillars with broader contribution primitives [50]. "Contribution" encompasses code, reviews, governance participation, bug reports, oracle attestations, liquidity provision — all inputs to the same Shapley-distributed reward pool. Proof of Contribution is both a technical primitive (the ContributionDAG + weighting) and a philosophical frame (the network rewards people for building it, not for owning it).

#### Epistemic Staking

*Stake what you claim* [51]. Oracles, validators, and any agent making an on-chain attestation bond stake proportional to the economic significance of the claim. If the claim is later proven false (via challenge response, counterattestation, or observation), the stake is slashed, proportional to the error's magnitude. Epistemic staking makes false claims economically self-punishing; it's the structural reason the True Price oracle's issuer-reputation registry [75][76] works.

### 4.3 Mechanism Design — Auctions, Clearing, MEV

#### Commit-Reveal Batch Auction

The core settlement mechanism [1][62]. Each **10-second epoch** is divided into:

- **Commit phase (8 s)** — users submit `hash(order || secret)` with a deposit. Order contents are hidden; the commit binds the user to *some* order without revealing which.
- **Reveal phase (2 s)** — users reveal `order` and `secret`. The contract verifies `hash(order || secret) == committed_hash`; reveals that don't match are slashed 50 %.
- **Settlement** — all revealed orders execute at a single **uniform clearing price**, in an order determined by a deterministic Fisher-Yates shuffle seeded by XORed user secrets. Non-revealed commits are slashed and their deposits routed to the reward pool.

Properties:

- **No in-block MEV.** Block producers can't reorder reveals to their advantage because the shuffle seed is entropy-aggregated from all users.
- **No sandwich.** A would-be sandwicher's commit reveals alongside every other order; their transaction doesn't sit mid-sandwich because there is no "mid."
- **Slash-protected reveals.** 50 % slashing for invalid reveals makes commit-to-cancel griefing expensive.
- **Uniform clearing.** All orders in a batch execute at the same price, eliminating pay-per-tx prioritization.

The commit-reveal mechanism is orthogonal to the AMM curve: the AMM still enforces `x·y=k`, but it does so against *the batch as a whole* rather than per-order. The curve applies to net batch flow; intra-batch clearing is uniform.

See also: Fisher-Yates Shuffle, Uniform Clearing Price, Priority Auction, Ten-Second Epoch, From MEV to GEV.

#### Uniform Clearing Price

A single price at which all orders in a batch execute [63]. Computing it is a convex-optimization problem: find the price `p*` that maximizes matched volume, or equivalently, the price at which aggregate buy demand equals aggregate sell demand. `clearing-price-convergence-proof.md` [63] proves convergence and uniqueness under mild continuity assumptions on the order book.

Uniform clearing is the mechanism-level fix for payment-for-order-flow and MEV-boosted ordering rents: because every order in the batch pays the same, there is no rent to extract from being first in line.

#### Fisher-Yates Shuffle

Canonical unbiased shuffle [60]. Given a sequence and a seed, produces a uniform-random permutation. VibeSwap uses a deterministic variant: seed = XOR of all user reveal secrets. Because users commit to their secrets before reveals are public, no individual user controls the final seed; because the shuffle is deterministic given the seed, the output permutation is verifiable by any observer.

The shuffle determines intra-batch ordering for tiebreaker cases (e.g., two orders with equal priority-auction bids). Implemented in `contracts/libraries/DeterministicShuffle.sol`.

#### Deterministic Shuffle

The library implementation of Fisher-Yates with XOR-aggregated entropy. Exposed to `CommitRevealAuction.sol` and used at settlement. Deterministic means: given the same seed and input list, every caller produces the same permutation.

#### Priority Auction

Optional after-the-fact bidding for earlier queue position within a batch [1]. The uniform clearing price is computed first; then, traders who want earlier queue position within the batch can bid additional priority fees, routed to the reward pool. Priority is useful for (e.g.) arbitrageurs who want to be first in line when the batch closes.

The priority auction converts what would be MEV-style ordering premia into protocol revenue — Shapley-distributed to LPs, stakers, and contributors. The extractive mechanism is inverted into the cooperative one (§4.1 *The Inversion Principle*).

#### Ten-Second Epoch

The canonical batch duration [1]. 8 s commit + 2 s reveal = 10 s per batch. The choice is substrate-geometry matched: LayerZero V2 message latency is in the single-digit seconds; Ethereum block time is ~12 s; most users can't react faster than a few seconds anyway. 10 s is the sweet spot: short enough for UX, long enough for entropy to aggregate safely, aligned with cross-chain settlement cadence.

#### Recursive Batch Auctions

Extending batch auctions to **cross-domain** clearing [61][67]. When orders on different pools or different chains need to clear against each other (e.g., a user selling asset A on chain X for asset B on chain Y), the clearing mechanism recurses: inner batches clear locally, outer batches aggregate and clear globally. Convergence is proven for the finite-domain case; extended to LayerZero-connected domains in the cross-chain settlement section.

#### Clearing Price Convergence

Formal convergence proof for the uniform clearing price [63]. Under assumptions of continuous order-book density and bounded price derivatives, the clearing price is unique, Lipschitz in the aggregate demand, and converges to the Walrasian equilibrium as batch size grows. This is the formal foundation for asserting "the batch clears fairly."

#### Execution/Settlement Separation

Design choice separating **execution** (matching, clearing) from **settlement** (token transfer, state update) [64]. Execution computes the outcome of a batch; settlement applies it. The separation enables: batching reveals across multiple batches before settlement; cross-chain settlement via LayerZero after local execution; rollback on settlement failure without re-executing.

#### From MEV to GEV

A reframing paper [65]: what we call "Maximal Extractable Value" is better framed as "Generated Economic Value," which can be captured by the protocol (cooperative) rather than extracted by searchers (adversarial). Priority auction proceeds going to the reward pool is a concrete "MEV → GEV" conversion. The paper formalizes the conditions under which a generic MEV source can be converted into GEV.

#### Five-Layer MEV Defense

The composition of defenses [66][85]. Layer 1: batch auction eliminates in-block ordering. Layer 2: Fisher-Yates shuffle eliminates entropy-predictable ordering. Layer 3: uniform clearing eliminates pay-per-tx premia. Layer 4: priority auction captures residual ordering value for the protocol. Layer 5: TWAP + 5 % gate on the AMM bounds oracle-manipulation-driven MEV. Each layer is redundant with others; all five firing gives defense-in-depth against adversary classes that circumvent any one.

### 4.4 AMM — Curve, Drift, Invariants

#### VibeAMM

The constant-product AMM: `x · y = k` [1][3]. Implements the familiar Uniswap-V2-style curve with two VibeSwap-specific additions: **TWAP-bound price jump validation** (maximum 5 % deviation from TWAP, §4.4 *TWAP Oracle and Validation*) and **batch-aware swap execution** (the AMM processes the net batch flow per settlement, not per individual order).

A critical invariant — `k` must grow monotonically — is enforced by the `_executeSwap` function via the C34 fix: `amountOut = min(linearFromClearingPrice, BatchMath.getAmountOut(amountIn, reserves, feeRate))`. When the batch's damped clearing price would subsidize traders beyond the curve's natural output, the curve cap binds and LPs benefit (the clearing price is still reported for batch-accounting purposes, but the actual payout is curve-bounded). This preserves the AMM invariant even under aggressive true-price damping.

See also: TWAP Oracle and Validation, K-Preservation.

#### TWAP Oracle and Validation

`VibeAMM` maintains a 30-minute time-weighted-average price and validates every incoming batch's clearing price against it. Deviations greater than 5 % revert with `PriceJumpTooLarge`. TWAP is maintained using a ring buffer of 24 samples at 5-minute intervals; the average is computed on-demand.

The TWAP + deviation gate is a continuum defense (see First-Available Trap discussion — §4.1): it attenuates rather than eliminates oracle manipulation. For existential dependencies like VibeStable liquidation, the 5 % gate is thin, and the RSI backlog holds a MED (C7-GOV-008) to extend commit-reveal to oracle aggregation as a stronger defense.

#### Price Jump Guard

`MAX_PRICE_JUMP_BPS = 1000` (10 %) between settlements. If two consecutive settlements' prices differ by more than 10 %, the second settlement reverts. Defense against batch-to-batch manipulation where an attacker manipulates the batch immediately preceding a target (e.g., a liquidation) to move the AMM's reserves into favorable territory.

#### K-Preservation

Invariant: `k_{n+1} ≥ k_n` for every settled swap. Closed C34 (backlog MED) by capping `amountOut` at the curve's natural output, even when the damped clearing price would subsidize traders. Discussed in depth in the C34 commit message and `TRP_VERIFICATION_REPORT.md` [122].

#### Liquidity Migration

Mechanism for migrating LP positions between pools (e.g., when a pool is deprecated and liquidity should flow to its successor) [77]. Migration is batched with the auction cycle so that LP rebalancing doesn't create exploitable intermediate states. LPs opt-in; the contract handles the multi-step transfer atomically.

#### IL Protection Vault

Insurance against impermanent loss, funded by the priority-auction reward pool. LPs stake their LP tokens in the vault and receive periodic IL-offset payouts; if an LP's position incurs IL beyond a configured floor, the vault covers it (up to the available pool).

Flagged in the First-Available Trap audit as a **candidate for post-mainnet retirement** — batch auctions already partially eliminate IL at the source, so the vault may be insuring against a symptom whose root cause is gone. Empirical decision pending mainnet data: if Vault claims are rare, route Vault revenue (priority-bid % + early-exit-penalty %) directly to LPs as simpler structural compensation.

### 4.5 Oracles

#### True Price Oracle

The on-chain price oracle `contracts/oracles/TruePriceOracle.sol` [73]. Receives EIP-712-signed price updates from authorized off-chain oracles that run the Kalman-filter-based True Price algorithm (§4.5). Stores current + historical prices per pool (ring buffer, 24 samples × 5 min = 2 hours of history). Exposes `getTruePrice`, `getDeviationMetrics`, `isManipulationLikely`, `getPriceBounds` views used by `VibeAMM` and by `VibeStable`.

Security posture (post-C37):

- **Fork-aware domain separator** — `_domainSeparator()` returns the cached value when `block.chainid == _cachedChainId`, recomputes fresh when the chain id diverges. Prevents cross-chain replay of signatures signed on the original chain.
- **Signer whitelist** with zero-address-safe `ecrecover` fallback.
- **Nonce per signer** — monotonic, incremented on each valid update, tracked in `signerNonces[signer]`.
- **Deadline enforcement** — signatures include a `deadline`; updates after deadline revert.
- **Price jump guard** — `MAX_PRICE_JUMP_BPS = 1000` on update.
- **Comprehensive message binding** — EIP-712 type hashes include every semantically-relevant field (poolId, price, confidence, z-score, regime, manipulation-prob, data-hash, nonce, deadline).

The oracle is authoritative for AMM bound-enforcement and VibeStable liquidation. Its security is load-bearing; C12 (EvidenceBundle + IssuerReputationRegistry) hardened it against fabricated attestations, and C37 (fork-aware separator) against fork replay.

#### True Price Discovery

The off-chain algorithm producing True Price [71][72]. Input: raw AMM quotes from multiple pools/chains, order-book depth, stablecoin context (USDT/USDC flow ratio), regime classifiers. Output: a Bayesian-posterior price estimate filtered through a Kalman filter (§4.5) with regime-switching noise models.

The algorithm distinguishes three regimes: NORMAL (Gaussian noise, standard Kalman update), TREND (increased tolerance for sustained moves), and MANIPULATION/CASCADE (tighter bounds, higher rejection rate). The regime classifier is itself informed by stablecoin flow (USDT-dominant → higher manipulation prior; USDC-dominant → higher trend prior).

#### Kalman Filter Oracle

The mathematical backbone of True Price Discovery [71]. A linear Gaussian state-space model: state = (price, velocity); observation = noisy quote. The Kalman filter optimally combines prior belief (from the model) with the observation (from the quote) under Gaussian assumptions. Regime-switching extends the base filter: different regimes have different noise covariance matrices, selected by the regime classifier.

The filter is implemented off-chain in Python (`oracle/` directory — code-side, not covered in this index); signed outputs are submitted on-chain via `updateTruePrice` or `updateTruePriceBundle`.

#### EvidenceBundle

The C12-introduced struct binding an oracle attestation to its full context [76]. Fields: `version`, `poolId`, `price`, `confidence`, `deviationZScore`, `regime`, `manipulationProb`, `dataHash`, `stablecoinContextHash` (snapshot hash of live stablecoin context), `issuerKey` (identity of the issuer from the Issuer Reputation Registry), `nonce`, `deadline`.

The bundle's EIP-712 type hash includes every field; fabrication of any field invalidates the signature. The `stablecoinContextHash` check on update enforces that the off-chain algorithm was run against the current context; if the context changed between signing and submission, the update reverts.

#### Issuer Reputation Registry

The C12 contract `contracts/oracles/IssuerReputationRegistry.sol` [75]. Stake-bonded identity for oracle issuers: each registered issuer bonds stake (`stakeAmount`) and receives an `issuerKey` bound to an address. Issuers can be slashed for incorrect attestations via permissioned slashing (V1) or challenge-response (V2). A penalty-only reputation score with mean-reversion (MID=5000 bps, half-life=30 days) tracks issuer reliability.

A 7-day unbonding delay prevents slash-dodging: an issuer with a pending slash cannot unbond stake faster than the slash can finalize.

The registry makes oracle identity economically significant: anyone can run the off-chain Kalman filter, but only registered issuers can submit updates that the on-chain contract will accept.

#### Stablecoin Flow Registry

The `contracts/oracles/StablecoinFlowRegistry.sol` contract tracking USDT/USDC flow ratios. Updates are EIP-712-signed by authorized updaters; the registry provides `getCurrentFlowRatio`, `isUSDTDominant`, `isUSDCDominant`, `getVolatilityMultiplier` views consumed by `TruePriceOracle._getStablecoinContext`.

Post-C37-F1-TWIN, the registry uses the same fork-aware domain separator pattern as `TruePriceOracle`: cached on the original chain, recomputed on fork.

The flow ratio matters because USDT flows correlate with leverage (manipulation prior); USDC flows correlate with genuine capital (trend prior). The True Price regime classifier consumes the ratio to adjust its bound-tightening.

#### Reputation Oracle

The `v1_REPUTATION_ORACLE_WHITEPAPER.md` [75] describes a generalization of the issuer-reputation pattern: any on-chain claim by an identified agent can be stake-bonded and subject to penalty-only reputation scoring. The registry is instantiated for oracles in C12; extensions to other agent classes (validators, proposers, LPs) are queued in the roadmap.

#### Price Intelligence Oracle

An extension framing [74]: the oracle isn't just a price feed, it's an **intelligence** feed. Fields beyond price — regime classification, manipulation probability, z-score, confidence interval — let consumers choose how to use the information. A conservative consumer (e.g., VibeStable liquidation) uses tight bounds + high confidence; an aggressive consumer (e.g., arbitrage) can act on weaker signals. The oracle surfaces structured uncertainty rather than a single number.

### 4.6 Security

#### Clawback Cascade

Taint-propagation defense [78]. When an attacker's funds are identified (via on-chain forensics or social consensus), any recipient of those funds — direct or N hops downstream — can initiate a clawback. The clawback propagates along the transaction graph: each recipient who refuses to return tainted funds becomes a target themselves.

The mechanism is economically self-enforcing: a rational recipient who receives a flagged transfer calculates "do I return the funds (losing the transfer) or keep them (becoming a future clawback target and losing more)?" For reasonable clawback depths and probabilities, the return payoff dominates. Over time, tainted funds become unspendable without absorbing the clawback risk.

Unlike blacklist-based defenses (admin maintains a list), the Clawback Cascade is permissionless and topological — no central authority decides what's tainted, the graph decides. It's the canonical example of **designing substrate where bad actors self-exhaust** (§4.1 *Gotham Framing*).

#### Siren Protocol (Honeypot Defense)

The `contracts/core/HoneypotDefense.sol` contract implementing **game-theoretic engagement** of attackers rather than blocking them. The Siren Protocol's four phases:

1. **Detection.** `Trinity Node` sentinels report anomalies (unusual PoW rate, stake-accumulation patterns, vote clustering, known attack signatures). Each report escalates the target's `ThreatLevel`.
2. **Engagement.** Once an attacker hits `ENGAGED`, the contract serves them a *shadow state* — a fake branch where their transactions appear to succeed, their votes appear to count, their PoW solutions appear valid. They're operating on a phantom fork.
3. **Exhaustion.** The shadow branch's difficulty is inflated (`SHADOW_DIFFICULTY_MULTIPLIER = 4`); their compute burns 4× faster against meaningless work. Fake rewards are shown but never claimable. Stake is locked in the trap contract. Time burns unrecoverably.
4. **Reveal.** After `MIN_TRAP_DURATION` (1 hour) up to `MAX_TRAP_DURATION` (7 days), the trap is revealed: the shadow branch is proven invalid, all stake is slashed, attack evidence is published on-chain (reputation destruction).

Game theory: `E(attack_cost) = compute + stake + time + opportunity_cost`; `E(attack_gain) = 0`; `E(attack_loss) = C(attack) + slashed_stake + reputation`. For any rational attacker, `E(loss) >>> E(gain)`. The attacker can't distinguish real from shadow until it's too late, because the engagement surface is indistinguishable from the real one during the trap window.

Quote from Will: *"He thought he was hacking the system. The system was hacking him."*

Post-C25-F3: `trackedAttackers[]` is a Phantom-Array-defended list (swap-and-pop removal, `MAX_TRACKED_ATTACKERS = 10_000`), iteration is bounded, and `_removeFromTrackedAttackers` fires at reveal.

See also: The Inversion Principle (§4.1), Phantom Array Antipattern (§4.6).

#### Fibonacci Scaling

Throughput control via Fibonacci retracement levels. Per-user, per-pool throttle that progressively damps a user's throughput along the 23.6 / 38.2 / 50 / 61.8 % retracement levels, with a saturation cooldown of `window × 1/φ` (where `φ` is the golden ratio). Implemented in `contracts/libraries/FibonacciScaling.sol`.

The substrate-geometry justification: market retracements empirically follow Fibonacci-like progressions; a throttle that matches the substrate's geometry damps abuse smoothly rather than binarily, preserving legitimate activity while attenuating adversarial behavior. A linear throttle over a fractal substrate is a First-Available Trap; Fibonacci scaling is the geometry-matched alternative.

#### Circuit Breakers

Policy-level last-resort defense: halt trading when volume, price move, or withdrawal thresholds exceed safe bounds. Implemented in `contracts/core/CircuitBreaker.sol`, with configurable per-pool thresholds.

Flagged in the First-Available Trap audit as honest but not root-cause: attackers can stay-just-under-threshold, drive-to-halt-wait-resume, or front-run the halt. The RSI backlog entry FAT-AUDIT-3 tracks a structural replacement strategy (adaptive fee curves + expanded Treasury Stabilizer) that should lower the firing domain over time.

#### Flash Loan Protection

Same-block interaction guard preventing flash-loan-driven attacks where an adversary borrows, manipulates, and repays within a single block [80]. `VibeAMM` records the msg.sender of every significant state transition in `_lastInteractedBlock` and rejects a subsequent significant interaction from the same sender in the same block.

This is orthogonal to the batch auction's MEV protection — flash loans manipulate reserves, not ordering — and so requires a separate defense.

#### Phantom Array Antipattern

A systemic bug class extracted as a primitive in C24/C25. The pattern: a mapping-keyed entry list is maintained for iteration ("enumerate all users / all validators / all cells"); items are appended freely but removed only on specific actions. Over time, inactive entries accumulate; eventually the iteration function hits gas limits and DoSes. `NakamotoConsensusInfinity.validatorList`, `HoneypotDefense.trackedAttackers`, `VibeAgentOrchestrator._activeWorkflowIds`, and `OperatorCellRegistry.operatorCells` all manifested the class.

**Fix template:** swap-and-pop removal helper + `MAX_` cap. Removed items don't get a gap — the last item swaps into the removed slot, and `.pop()` shrinks the array. Combined with a per-caller cap (e.g., `MAX_VALIDATORS = 10_000`), iteration is bounded and DoSes are prevented.

Applied across four contracts by C30. Template invocation is now mechanical; the primitive memory `primitive_phantom-array-antipattern.md` documents the recipe.

#### Admin Event Observability

A primitive extracted in C36-F2. Every privileged state-mutator (any `onlyOwner` / `onlyRole` setter) MUST emit an `XUpdated(oldX, newX)` event. Silent setters are a systemic observability bug class: off-chain indexers go stale, audit-trail reconstruction breaks, incident-response timelines have gaps.

Applied across `ShardOperatorRegistry`, `SecondaryIssuanceController`, `NakamotoConsensusInfinity` (11 silent setters → all emit now, +6 regression tests, 133/133 green) in C36-F2. The primitive memory captures the template and enforcement path; future cycles will add a Slither detector as a blocking CI rule.

#### API Death Shield (SHIELD)

Client-side hook pipeline persisting conversation state when the LLM API errors [83]. Runs four events:

- **StopFailure** — API-error kill path. Writes crash marker, finalizes session chain, auto-commits dirty files.
- **UserPromptSubmit** — logs every user message (conversation recovery backbone).
- **Stop** — heartbeat after each successful response.
- **PreCompact** — syncs chain before context compression.

Post-2026-04-21 (SHIELD-PERSIST-LEAK fix), SHIELD scans staged diffs for NDA keywords before committing. Hits trigger `git reset` + `NDA-ABORT` log entry. Combined with the root-level fix (`.claude/PROPOSALS.md` + `.claude/TRUST_VIOLATIONS.md` untracked via `.gitignore`), the leak class is closed two layers deep.

#### NDA Keyword Gate

PreToolUse hook (`nda-eridu-gate.py`) scanning bash commands for NDA-protected keywords before allowing git commit / push / add [83]. Canonical keyword list lives in the gate; SHIELD mirrors it for defense-in-depth. If any keyword is found in staged content or commit message, the tool call is denied with an explicit reason. Near-miss on 2026-04-21 (commit `77fde23e`) was caught by this gate; the offending commit was rebased out surgically.

#### Wallet Recovery

The `DOCUMENTATION/WALLET_RECOVERY.md` [87] and `DOCUMENTATION/WALLET_RECOVERY_WHITEPAPER.md` [88] describe a social-recovery + timelock-based recovery protocol. Users designate a trust set (recovery guardians); loss of access triggers a recovery flow where a threshold of guardians attest to the user's identity; a timelock window allows the user to cancel if the recovery is fraudulent; after the window, the recovered wallet is issued.

The design integrates with `SoulboundIdentity` — a soulbound token follows the recovered wallet — and with `AgentReputation` for AI agent recovery (§4.13 *AI-Native DeFi*, §4.13 *Cognitive Consensus Markets*).

#### AGI-Resistant Recovery

An extension [86]: assuming future capable AGIs can impersonate humans convincingly, wallet recovery requires **AGI-resistant identity verification**. The paper outlines challenge-response schemes relying on time-of-genuine-work (PoM-style) that an AGI cannot plausibly complete without decades of genuine identity-bonded contribution. The recovery protocol extends naturally: the threshold of guardians attests, *and* the recovering identity submits a PoM challenge.

#### Fork-Aware Domain Separator

The C37-F1 and C37-F1-TWIN class fix. EIP-712 domain separators cached at init-time are vulnerable to chain-fork replay: signatures signed against the original chain's domain separator remain valid on the forked chain because the cached separator doesn't recompute. Fix (OpenZeppelin cached+lazy-recompute pattern): cache `_cachedChainId` and `DOMAIN_SEPARATOR` at init; on each signature verification, compare `block.chainid` to `_cachedChainId`; if equal, use the cached value; if not, recompute against the live chain id.

Shipped to `TruePriceOracle` (C37-F1, commit `e71e0ea9`) and `StablecoinFlowRegistry` (C37-F1-TWIN, commit `93f58de4`). Verified with regression tests covering both rejection-on-fork and fresh-sig-acceptance-on-new-chain.

### 4.7 Incentives — Shapley and Friends

#### Shapley Distribution

Game-theoretic fair division of surplus [91][94]. For a coalition whose members each contribute differently, the Shapley value gives each member their expected marginal contribution, averaged over all orderings. It's the **unique** allocation satisfying efficiency, symmetry, linearity, and null-player: the only fair distribution by axioms.

VibeSwap uses Shapley over:

- **Batch surplus** — when a batch clears with a spread between best-bid and best-ask, the spread is surplus; Shapley distributes it among the counterparties, not to a protocol fee.
- **Secondary issuance** — new token issuance is Shapley-distributed across validators, LPs, and contributors (weighted by PoM + PoS + LP tokens) [96].
- **Priority auction revenue** — bids from priority auctions are pooled and Shapley-distributed.

Implemented in `contracts/incentives/ShapleyDistributor.sol`. Combinatorial in the naive form; VibeSwap's version is linearized via the structure of the contribution types (each agent's contribution is a scalar, so marginal values are tractable).

P-001 No Extraction Ever is enforced through Shapley: any protocol-captured value must be Shapley-justified. Priority-auction revenue to the reward pool passes this check (LPs provided the liquidity that made the priority worth bidding); admin-captured value without this justification is forbidden.

#### Fractalized Shapley Games

The composition of nested Shapley games across pool / chain / agent hierarchies. A user is a member of the global game; a liquidity pool is a sub-game; an agent's contribution to the pool is a sub-sub-game. Shapley at each layer, combined hierarchically. The result: local fairness at each layer, composable into global fairness.

The frame is generative: given a new resource to distribute, ask "what game is this? Who are the players? What's the fractal structure of their contributions?" Answering fixes the reward rule.

See primitive memory `primitive_fractalized-shapley-games.md` for the rule-of-thumb distillation.

#### Cross-Domain Shapley

Applied across different kinds of contribution: code + liquidity + oracle uptime + governance votes [92]. Each domain has its own scoring, combined into a unified cross-domain score via a learned or governance-set linear combination. The combined score feeds the single Shapley distribution.

The challenge is avoiding domain-exploitation — a contributor who maxes one domain at the expense of others should not dominate the score. Cross-Domain Shapley is typically complemented by sub-linear weighting per domain (so concentration is penalized), keeping the distribution balanced.

#### Atomized Shapley

The micro-contribution version [93]. Every single contribution — a commit, a review comment, a vote, a sample — is scored individually. Payouts are computed from the atomic-level scores rather than aggregated first. This fine-grained approach captures contributions a coarse-grained scoring would miss, and enables real-time reward streams rather than periodic settlements.

Atomized Shapley is computationally heavy; in practice, the atomized scores feed a rolling aggregate that settles periodically. The atomization ensures no contribution is lost in aggregation.

#### Loyalty Rewards

The `contracts/incentives/LoyaltyRewards.sol` contract tracks long-term liquidity-provider tenure. LPs who stay in a pool longer earn a bonus multiplier on their Shapley share, funded by the priority-auction pool. Tenure is measured continuously; withdrawal resets it. The bonus multiplier is bounded (no unbounded rent accumulation).

The incentive: discourage mercenary LPs who rotate in/out chasing APR; reward long-tenure providers who absorb volatility.

#### Secondary Issuance

New token issuance beyond the 21 M VIBE cap happens via **secondary issuance** [96]: the `SecondaryIssuanceController` mints new CKB-native tokens per epoch, distributed Shapley-weighted across shard nodes (via `ShardOperatorRegistry.distributeRewards`), validators, and LPs. The emission curve is cooperative (not extractive): designed to fund ongoing operations without diluting early contributors.

`setParameters(annualEmission, epochDuration)` is governance-set; `distributeEpoch` is permissionless (anyone can trigger after the epoch window); the epoch's emission is computed from current supply and the parameters. Emission goes to the reward pools where Shapley distributes it.

#### Cooperative Emission Design

The `docs/papers/cooperative-emission-design.md` [96] formalizes the emission curve. Key properties:

- **Non-dilutive to early contributors** — emission funds operations, not founder rewards.
- **Converges to zero-inflation** over time as the network matures.
- **Stabilizes treasury** — a fixed portion of emission goes to treasury reserve, cushioning volatility.
- **Anti-mercenary** — emission is proportional to tenure × weight, discouraging quick rotation.

The curve is governance-adjustable within constitutional bounds: governance can tune parameters but cannot set emission to zero (breaking operations) or set it to infinite (breaking monetary stability).

### 4.8 Governance

#### DAO Treasury

The protocol-owned liquidity reserve and general-purpose governance fund. Implemented in `contracts/governance/DAOTreasury.sol`. Accepts protocol revenue (priority-auction surplus, settlement fees, slash sweeps routed via [`sweepSlashPoolToTreasury`](#operatorcellregistry)) and distributes to governance-approved destinations. The [Constitutional DAO Layer](#constitutional-dao-layer) bounds what allocations are legal — no vote can drain reserves to a single address, no vote can break the [Shapley Distribution](#shapley-distribution) invariants on new issuance. Treasury composition is intentionally diverse: [JUL](#joule-token-jul), [VIBE](#vibe-token), [CKB-native](#ckb-native), and stablecoins, mirroring the three-token-economy structure so the reserve doesn't concentrate on any one axis [11][97].

#### Treasury Stabilizer

The `contracts/governance/TreasuryStabilizer.sol` contract. Performs counter-cyclical market operations: auto-provides liquidity to [VibeAMM](#vibeamm) pools during stress events (detected via [True Price](#true-price-oracle) deviation or volume spikes) rather than halting trading. The role is explicitly structural — it is the **alternative to [Circuit Breakers](#circuit-breakers) firing**. Where breakers halt, the stabilizer absorbs. Over time the firing domain of breakers should shrink as the stabilizer's capital base grows. See `FAT-AUDIT-3` in `project_rsi-backlog.md` for the planned expansion.

#### Constitutional DAO Layer

The set of invariants no vote can break [97]. Physics (Shapley, [P-001](#p-001-no-extraction-ever)) > Constitution ([P-000](#p-000-fairness-above-all), [Lawson Floor](#lawson-floor--lawson-constant), [IIA](#independence-of-irrelevant-alternatives-iia), [Memoryless Fairness](#memoryless-fairness)) > Governance (DAO votes). Attempts to pass a proposal that would violate a constitutional invariant either revert at the contract layer (because the invariant is hard-coded, e.g., Shapley weighting) or are flagged invalid by the [Correspondence Triad](#correspondence-triad) gate at the design layer. Governance is free within the guardrail; the guardrail is non-negotiable. See also: [Augmented Governance](#augmented-governance), [The Hard Line](#the-hard-line).

#### Conviction Voting

Time-weighted voting where support for a proposal accumulates over continuous conviction rather than a binary yes/no at a deadline. A user's stake accrues voting weight on a proposal as long as they continuously support it; withdrawing support decays the weight. Proposals that cross a conviction threshold execute; proposals that never cross expire. The mechanism favors thoughtful long-support over snap pile-ons, and is a natural counter to governance-attack patterns where an attacker briefly rents voting power at a decision point. Implemented across `ConvictionVoting.sol` and integrated with the [DAO Treasury](#dao-treasury). Covered in `docs/nervos-talks/conviction-voting-post.md`.

#### Lawson Floor / Lawson Constant

A **fairness lower bound** gating settlement [98][99][100]. Every cleared batch satisfies a fairness ratio no smaller than the Lawson Constant, or the batch reverts. The constant is named after the MIT research collaborator; formalization lives in `DOCUMENTATION/LAWSON_FLOOR_FORMALIZATION.md` [100]. Concretely: within a batch, no participant's realized price deviates from the [Uniform Clearing Price](#uniform-clearing-price) by more than a configurable Lawson-bounded margin. This is the mechanism by which "no one loses more than a known, small, configurable amount per batch" is enforced structurally rather than as a policy prayer. Pairs with [Memoryless Fairness](#memoryless-fairness) — Lawson is the per-batch bound, Memoryless is the across-batch property.

#### Memoryless Fairness

A theorem [101]: under VibeSwap's mechanism, the **fairness of the current batch is independent of the history of prior batches**. No participant can be "punished" for a prior batch's outcome; no attacker can accumulate an advantage across batches. The property is load-bearing for the [Clearing Price Convergence](#clearing-price-convergence) proof and for the generalization of single-batch fairness guarantees to long-run fairness guarantees. Formalized in `DOCUMENTATION/MEMORYLESS_FAIRNESS.md`; paired with [Composable Fairness](#composable-fairness) to extend from within-batch to across-batches.

#### Composable Fairness

Fairness properties that compose under protocol composition [95]. If sub-protocol A is fair (by Lawson) and sub-protocol B is fair (by Lawson), their composition is also fair (by Lawson) — no fairness leakage at the interface. This is not automatic; it requires careful interface design, and the paper documents the conditions under which composition preserves fairness. The property is how VibeSwap scales its fairness guarantees from single-contract to the full stack ([VibeAMM](#vibeamm) + [CommitRevealAuction](#commit-reveal-batch-auction) + [Shapley Distribution](#shapley-distribution) + cross-chain settlement) without a separate proof for each interface.

#### DAOShelter

The `contracts/consensus/DAOShelter.sol` contract. An inflation-shelter for [CKB-native](#ckb-native) depositors: holders can deposit CKB into the shelter and be made whole against [Secondary Issuance](#secondary-issuance) dilution. Deposited tokens are counted as off-circulation (they enter `offCirculationHolders`) so the shelter's yield is drawn from the issuance stream rather than from other holders. The mechanism is voluntary; holders who prefer to keep tokens liquid (for trading, state rent, etc.) accept the mild dilution; holders who want pure store-of-value deposit into the shelter. It is the closest VibeSwap analog to a savings account, with the difference that the "interest" is the amount of issuance shielded rather than a positive yield.

#### Commit-Reveal Governance

An extension of the [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) pattern to governance votes. Voters commit `hash(vote || secret)` during a commit window; reveal during a reveal window; reveals that don't match the commit are slashed. The mechanism eliminates last-minute voting cascades (where voters change position based on who else is voting), which otherwise make governance outcomes reflect coordination strength rather than preference intensity. See `docs/nervos-talks/commit-reveal-governance-post.md`.

---

### 4.9 Monetary Theory

The monetary theory behind VibeSwap is the set of principles that determine *what money does* and *what tokens are*. It draws heavily from Will's own papers (Economítra, Ergon), from Nervos CKB's design, and from the Intrinsic Altruism thesis. The three-token-economy at the implementation layer is the concretization of these principles. Read [Economítra](#economítra) first, then the per-token entries, then [Three-Token Economy](#three-token-economy) as synthesis.

#### Economítra

Will's foundational economics paper, the **intellectual DNA of the project** [102][103]. Covers the false binary of fiat-vs-gold, cryptoeconomic primitives, elastic non-dilutive money, cooperative capitalism, game theory, political philosophy, and IP reform. Synthesizes the claim that an economy can be simultaneously stable (no runaway inflation or deflation), non-dilutive (early contributors are not ground down by later entry), and cooperative (positive-sum by construction rather than by hope). VibeSwap is Economítra applied to a protocol-level coordination system: every mechanism in the stack traces back to a thesis in the paper. See also: [Ergon — Monetary Biology](#ergon--monetary-biology) (biological analog), [Cooperative Capitalism](#cooperative-capitalism) (political frame), [Time-Neutral Tokenomics](#time-neutral-tokenomics) (temporal analog), [Intrinsic Altruism](#intrinsic-altruism) (ethical frame). Canonical versions: `DOCUMENTATION/ECONOMITRA.md` and `DOCUMENTATION/ECONOMITRA_V1.2.md`.

#### Ergon — Monetary Biology

Treats monetary systems as biological organisms [104]. A healthy economy has metabolism (value flow), homeostasis (price stability), immune response (defense against attacks), and reproduction (value compounding into further value). VibeSwap's three-token system is explicitly designed to satisfy each: [JUL](#joule-token-jul) is metabolism (primary liquidity flow), [CKB-native](#ckb-native) is homeostasis (elastic supply against state occupancy), [Clawback Cascade](#clawback-cascade) and [Siren Protocol](#siren-protocol-honeypot-defense) are immune response, [Shapley Distribution](#shapley-distribution) is reproduction (compounding contribution-to-contribution). The biology frame is generative: given a "disease" in the economy (extraction, cascading failures, information asymmetry), ask what biological defense corresponds and design toward it.

#### Trinomial Stability

Stability via three-token orthogonality rather than via single-token discipline. Traditional monetary stability requires a single asset to be simultaneously a store of value, medium of exchange, and unit of account — a famous trilemma. Trinomial stability decomposes: **[JUL](#joule-token-jul) carries the medium-of-exchange load** (PoW-objective, fiat-stable, primary liquidity), **[CKB-native](#ckb-native) carries the unit-of-account / state-capital load** (elastic supply matched to state occupation), **[VIBE](#vibe-token) carries the store-of-governance-value load** (21 M cap, Shapley-distributed, unbuyable beyond contribution). Because the three axes are orthogonal, each can optimize for its own role without the traditional trilemma trade-offs. The stability of the whole is the composition of three specialized stabilities, not the compromise of one generalist asset. Covered in `tweet repo/feature-spotlights/04-trinomial-stability.md` and `DOCUMENTATION/THREE_TOKEN_ECONOMY.md`.

#### Dual-Cap Monetary Architecture

The architecture pattern combining a **hard cap** (e.g., [VIBE](#vibe-token)'s 21 M) with a **circulating cap** (e.g., [CKB-native](#ckb-native)'s `totalSupply - totalOccupied`) in the same system. Hard caps give scarcity and governance-share integrity; circulating caps give elasticity and state-rent functionality. Most tokenomic systems pick one; VibeSwap uses both, each for a different role. The choice is an instance of [Substrate-Geometry Match](#substrate-geometry-match-as-above-so-below) — governance wants fixed shares (so fix the cap); state-rent wants elasticity (so elasticize). See also: [Three-Token Economy](#three-token-economy), [Time-Neutral Tokenomics](#time-neutral-tokenomics).

#### Time-Neutral Tokenomics

Tokenomics where early and late contributors are rewarded on the **same marginal terms** [106][156]. Classical tokenomics favors early buyers (who acquire at low prices and sell to later buyers); VibeSwap's tokenomics make the marginal return to contribution independent of entry time, modulo tenure bonuses from [Loyalty Rewards](#loyalty-rewards). The mechanism: [Shapley Distribution](#shapley-distribution) of ongoing surplus, dilution of idle holdings via [Secondary Issuance](#secondary-issuance), and contribution-weighted governance via [Proof of Mind](#proof-of-mind). A newcomer who contributes the same as an incumbent earns the same; the incumbent's head start is only on tenure, not on a zero-sum entry premium.

#### Three-Token Economy

The synthesis [105][173]. Three tokens, three orthogonal roles, three pillars of [Nakamoto Consensus ∞](#nakamoto-consensus-):

| Token | Role | Consensus pillar | Cap model | Monetary property |
|---|---|---|---|---|
| **[JUL](#joule-token-jul)** | Money — primary liquidity | PoW (10 %) | Elastic (mined) | PoW-objective + fiat-stable |
| **[VIBE](#vibe-token)** | Governance share | PoM (60 %) | Hard cap 21 M | Scarce, Shapley-distributed |
| **[CKB-native](#ckb-native)** | State-rent capital | PoS (30 %) | Circulating cap | Elastic, state-occupation driven |

Each token's role is **standalone load-bearing** — collapsing any one destroys that role plus the corresponding consensus pillar. The interaction between tokens is minimal at the user layer (users transact in JUL, hold VIBE for governance, lock CKB-native for state or staking) and rich at the protocol layer ([JULBridge](#jul-burn) converts JUL to CKB-native via burn, [Secondary Issuance](#secondary-issuance) distributes CKB-native across shard operators and shelter depositors, [Shapley Distribution](#shapley-distribution) allocates protocol surplus across all three). See also: [Pattern-Match Drift on Novelty](#pattern-match-drift-on-novelty) — the three-token decomposition resists fitting a familiar analog and has historically been a site of drift. Canonical source: `DOCUMENTATION/THREE_TOKEN_ECONOMY.md` [105].

#### VIBE Token

The governance share of the three-token economy [3][94]. **Hard cap: 21 million** (Bitcoin-homage, but meaning is different — scarcity of governance share, not scarcity of money). Distributed Shapley-weighted across contributors, LPs, validators, and agents. The cap is inviolable; new issuance beyond 21 M is forbidden at the protocol level. Governance weight is proportional to VIBE held × [Proof of Mind](#proof-of-mind) score (so pure buying of VIBE without contribution accrues stake but not governance weight). VIBE is the PoS pillar of [NCI](#nakamoto-consensus-)'s 30 % weight — it is economic skin-in-the-game, not the primary medium of exchange. Contract: `contracts/monetary/VIBEToken.sol` (ERC-20 + ERC-20Votes + ERC-20Permit, UUPS-upgradeable). See also: [Shapley Distribution](#shapley-distribution), [Conviction Voting](#conviction-voting), [Constitutional DAO Layer](#constitutional-dao-layer).

#### CKB-native

The state-rent capital of the three-token economy. Contract: `contracts/monetary/CKBNativeToken.sol`. Model lifted from Nervos CKB: **1 CKB-native = 1 byte of state**, locked in a cell on creation, released on destruction. Locked CKB-native does not count as circulating; it is "occupied" and returned to circulation when the cell is destroyed. **No hard cap** — supply is elastic via [Secondary Issuance](#secondary-issuance) and entries via [JUL burn](#jul-burn) [116][117]. The elasticity is the feature: tokens locked in state accumulate dilution cost through secondary issuance, so state is economically self-cleaning — cells not worth their rent get destroyed, tokens return to circulation. Covered by the entire [Storage & State](#411-storage--state) section: [StateRentVault](#staterentvault) is the lock target, [Shard Operator Registry](#shard-operator-registry) is how operators are paid in CKB-native for serving cells, [OperatorCellRegistry](#operatorcellregistry) is how operators bond CKB-native per assigned cell. The PoS pillar of [NCI](#nakamoto-consensus-).

#### Joule Token (JUL)

**Do not read JUL as a bootstrap mechanism.** JUL has two standalone load-bearing roles and one downstream nicety.

1. **Economy — JUL is the money layer of the network.** Primary liquidity. **PoW-objective** (every JUL is backed by verifiable SHA-256 computational work, Bitcoin-style trust guarantee) and **fiat-stable** (supply responds to mining demand rather than speculation, behaving as a neutral medium of exchange with fiat-like volatility profile). It is what people transact *in*.

2. **Consensus — JUL is the PoW pillar of [Nakamoto Consensus ∞](#nakamoto-consensus-).** Contributes the `0.10 · PoW` component, logarithmically scaled: `PoW_weight = log₂(1 + cumulative_valid_solutions) · POW_SCALE`. The log scaling prevents compute plutocracy. JUL is the time-of-genuine-work axis of attack asymmetry — the reason `Attack_cost → ∞` as network age grows.

3. **Downstream nicety — JUL-burn bootstraps [CKB-native](#ckb-native) entry.** Via `JULBridge`, JUL can be burned in exchange for newly-minted CKB-native. This solves the chicken-and-egg that would otherwise plague a pure-secondary-issuance CKB model: JUL is mined from block zero, so CKB-native supply starts flowing from day one. But **this is a side effect, not JUL's purpose.** JUL exists because the money role + the PoW pillar earn its place independently.

Contract: `contracts/monetary/JouleToken.sol`. Mined via SHA-256 difficulty-adjusted PoW. Nonce-replay-protected per epoch. Miners can burn JUL through [JULBridge](#jul-burn) to mint CKB-native, or trade JUL as money, or stake JUL for PoW-pillar contribution, or pair JUL as [VibeAMM](#vibeamm) liquidity.

**Historical Claude drift warning:** JUL is one of the highest-drift entities in the codebase for large language models. The pattern-matcher tends to reach for "legacy PoW mechanism we keep around" or "bootstrap token for CKB" — both wrong. JUL is novel money with no close analog. See [Pattern-Match Drift on Novelty](#pattern-match-drift-on-novelty) for the primitive distillation. Lead every JUL description with the **money role**, not the burn pathway.

#### JUL-burn

The conversion pathway where JUL holders burn JUL at `JULBridge.sol` to receive newly-minted [CKB-native](#ckb-native). A downstream use of JUL's mined supply, not JUL's purpose. Burning JUL *removes* it from circulation (deflationary for JUL) while *adding* CKB-native to circulation. The ratio is governance-tuned and designed so that neither token is over- or under-supplied relative to demand.

#### Temporal Collateral

Collateral measured in **time commitments** rather than (or in addition to) token quantities [107]. Locking tokens for X days is more valuable as collateral than locking them for 1 day, because the commitment itself is costly (opportunity cost of illiquidity) and because the lock duration correlates with skin-in-the-game horizons. Applied across [Loyalty Rewards](#loyalty-rewards), the 7-day unbonding delay in [NCI](#nakamoto-consensus-), the [DAOShelter](#daoshelter) deposit lock, and governance conviction accumulation. Temporal collateral is the structural reason [Proof of Mind](#proof-of-mind) is unbuyable: time cannot be purchased or parallelized.

#### Elastic Money Primitives

The generalization of CKB-native's elasticity to other monetary roles. When supply should scale with demand for a specific function (state rent, collateral, insurance reserves) rather than with a fixed schedule, an elastic primitive applies. `primitive_elastic-money-primitives.md` (memory) captures the pattern; `DOCUMENTATION/ECONOMITRA.md` [102] discusses the theory. Elasticity is bounded — a governance-set emission schedule bounds the rate — so the primitive is elastic-within-limits, not unbounded-inflationary.

#### Augmented Bonding Curves

Bonding curves that **augment** an existing market structure (typically a reserve-backed curve) with [math-enforced invariants](#augmented-mechanism-design) rather than replacing market clearing with a single curve [108]. The paper `docs/papers/augmented-bonding-curve-implementation.md` covers the mechanics: a bonding curve defines price-as-function-of-supply; augmentations include slash-on-rug-pull, [Shapley Distribution](#shapley-distribution) of curve surplus, and [Fibonacci-Scaled](#fibonacci-scaling) issuance damping. The augmented curve retains classical bonding-curve UX while removing the classical extraction vectors.

---

### 4.10 Cross-Chain

#### LayerZero V2 OApp

VibeSwap is a **LayerZero V2 OApp** — an omnichain application sending and receiving cross-chain messages through the LayerZero V2 messaging protocol [111]. The choice is deliberate: LayerZero V2's ultra-light-node (ULN) model gives configurable security (validator + oracle + relayer) without relying on a bridge contract that holds funds, so there is no single honeypot of locked liquidity for an attacker to target. Messaging latency is in the single-digit-seconds, aligned with the [Ten-Second Epoch](#ten-second-epoch) of [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) settlement. Contract: `contracts/messaging/CrossChainRouter.sol`.

#### Cross-Chain Router

The `CrossChainRouter.sol` contract is VibeSwap's LayerZero entry point. It wraps the LayerZero V2 OApp interface with VibeSwap-specific message types: `SettlementBatch` (cross-chain batch settlement confirmation), `TruePriceUpdate` (oracle sync across chains), `ShardRegistryEvent` (cross-chain operator state sync). Post-C24, the router enforces `MAX_SETTLEMENT_BATCH = 256` on both inbound and outbound handlers, closing the unbounded-loop DoS class discovered in C24-F2. See also: [Phantom Array Antipattern](#phantom-array-antipattern).

#### Cross-Chain Settlement

The protocol by which a batch cleared on chain A affects state on chain B [112]. Execution (matching, clearing price) happens on the origin chain; settlement (token transfer, state update) can occur on a destination chain via LayerZero messaging. The separation is an instance of [Execution/Settlement Separation](#executionsettlement-separation). Post-message receipt, the destination chain verifies the settlement proof (LayerZero's ULN verification + message-source-authentication), then applies the state transition. Failures revert the cross-chain atomic transaction; successful receipts emit `CrossChainSettlementCompleted` events.

#### Omnichain DEX

The project-level framing: VibeSwap is not merely a DEX-on-one-chain-plus-a-bridge but a **single market surface that spans multiple chains**. A user on chain A can trade an asset on chain B as if they were on chain B, with execution routed via [LayerZero V2](#layerzero-v2-oapp). The [Uniform Clearing Price](#uniform-clearing-price) spans all chains: a batch's orders from multiple chains clear at one price, in one permutation (from a globally-seeded [Fisher-Yates Shuffle](#fisher-yates-shuffle)), settled via [Cross-Chain Router](#cross-chain-router). The user-visible property: cross-chain trading has the same MEV-resistance and fairness guarantees as single-chain trading.

---

### 4.11 Storage & State

#### CKB Cell Model

Nervos's UTXO-like primitive, lifted into VibeSwap [116][117]. A **cell** is a storage slot: it has an owner, a capacity (bytes occupied), a content hash, a creation timestamp, and an active flag. Storing data requires locking [CKB-native](#ckb-native) proportional to capacity (the [State Rent](#state-rent) mechanism). Cells are the atomic unit of knowledge / state / agent memory in the VibeSwap architecture — `AgentKnowledge`, `ContributionDAG` edges, `SessionState` snapshots, and more all live as cells.

Key properties from Nervos, retained:
- **Owner-authenticated** — only the cell's owner can destroy or transfer it.
- **Capacity-locked** — `1 byte = 1 CKB-native`, enforced at creation.
- **State-rent via dilution** — locked tokens accumulate dilution cost against [Secondary Issuance](#secondary-issuance); cells not worth the rent are economically incentivized to be destroyed, releasing both capacity and tokens.
- **UTXO model** — cells are consumed and produced, not "updated" in place; each state change is a new cell referencing a prior cell.

The cell model's alignment with VibeSwap's batch-auction clearing is structural: both model state changes as discrete transitions rather than continuous mutations, enabling clean proofs and atomic rollback.

#### StateRentVault

The `contracts/consensus/StateRentVault.sol` contract. The on-chain home of cell state: cells are created, destroyed, and authenticated here. Offers `getCell(cellId)` for external queries (used by [OperatorCellRegistry](#operatorcellregistry) and [ContentMerkleRegistry](#contentmerkleregistry) for cell-existence checks in challenge-response flows). Admin-managed via `setCellManager(address, bool)` to authorize specific contracts to create / destroy cells on behalf of users. The vault is deliberately kept minimal — cell CRUD, existence queries, a capacity ledger — with policy logic delegated to upstream contracts.

#### OperatorCellRegistry

The `contracts/consensus/OperatorCellRegistry.sol` contract. Registers operator-to-cell assignments. Operators (shard nodes that serve cells to clients) must claim each cell they serve by posting a **per-cell bond** (in [CKB-native](#ckb-native)); the assignment enables them to respond to challenge-response requests from [ShardOperatorRegistry](#shard-operator-registry). Post-C30, the registry closes the "cells-I-don't-serve" refute class that plagued C11: operators can't inflate `cellsServed` with cells they don't actually serve, because each claim costs a bond and the bond is slashable via challenges. Post-C31, the challenge flow is permissionless ([Probabilistic Availability Sampling](#probabilistic-availability-sampling) introduced in C32). Post-C36-F1, `bondPerCell` has a `MIN_BOND_PER_CELL = 1e18` floor, preventing admin-key mistakes or griefing that would silently disable the Sybil-resistance property.

Diff receipts:
- **C30** — new contract (287 LOC), operator-opt-in-with-bond model.
- **C31** — V2 permissionless challenge (+20 LOC + 20 tests).
- **C32** — V2b content-availability sampling via sidecar (`ContentMerkleRegistry`).
- **C36-F1** — bondPerCell floor MED fix.
- **C36-F2** — admin setter events.

#### ContentMerkleRegistry

The `contracts/consensus/ContentMerkleRegistry.sol` contract, introduced in C32. Operators commit Merkle roots over their cell contents (chunked at 32–4096 bytes per chunk, up to 1 M chunks per cell = ~20-level Merkle tree); challengers can sample K=16 chunks and demand proofs. All-must-pass threshold means a >90 %-available operator has ~98.4 % challenge-pass rate (0.999^16), while a <90 %-available operator has near-zero pass rate — distinguishing honest from dishonest operators with small sample size.

The sidecar design (separate contract from [OperatorCellRegistry](#operatorcellregistry)) follows the paper §7.4 composability principle: new primitives get new contracts, not new fields in security-critical ones.

#### Shard Operator Registry

The `contracts/consensus/ShardOperatorRegistry.sol` contract. The core operator-accounting contract: operators register, stake [CKB-native](#ckb-native), commit `cellsServed` reports, heartbeat, and collect rewards via Masterchef-style `accRewardPerShare` accounting. Shard weight is `sqrt(cellsServed · stake)` — geometric-mean to prevent gaming by either cells-only or stake-only concentration.

Key mechanics:
- **Challenge-response on commits** — `commitCellsReport(count, merkleRoot)` goes into a 1 h pending window, during which any challenger can name an index to refute; operator must respond with a Merkle proof via `respondToChallenge`. Post-C11-AUDIT-14, refutes require cross-referencing [StateRentVault](#staterentvault) to ensure the cellId is a real active cell. Post-C30, refutes also require [OperatorCellRegistry](#operatorcellregistry) assignment to close "cells-I-don't-serve."
- **Stale-reap** — operators who miss heartbeats beyond the 48 h grace are permissionlessly reaped via `deactivateStaleShard`. Stake is returned to the operator (no slash — this is eviction, not fraud).
- **Slash-dodge-proof** — operators with pending reports cannot deactivate until the report resolves; blocks the pattern of "commit fraud, go silent, have an accomplice reap."
- **ShardId burn invariant** — post-C35, documented and test-locked: shardIds are permanently retired on deactivation. Prevents identity-rewriting; min-stake (100 CKB) prices out griefing-by-burn.

Admin surface (post-C36-F2 event-observability sweep): `setIssuanceController`, `setStateRentVault`, `setCellRegistry` — all emit `XUpdated(old, new)` events.

#### Probabilistic Availability Sampling

The V2b challenge mechanism in [ContentMerkleRegistry](#contentmerkleregistry) + [OperatorCellRegistry](#operatorcellregistry). Derives `K=16` deterministic sample indices from `(cellId, challenger, nonce)` (not stored — recomputable); operator must respond with Merkle proofs for each sampled chunk. All-must-pass threshold gives the sharp honest-vs-dishonest distinguishing power described in [ContentMerkleRegistry](#contentmerkleregistry). The pattern is a standard Data-Availability-Sampling family (Al-Bassam et al., 2018; Danksharding); our instantiation is parameterized per augmented-mechanism-design.md for protocol-wide consistency with V2a challenges.

#### State Rent

The economic pressure mechanism for keeping state clean. Storing data in a cell requires locking [CKB-native](#ckb-native) equal to the byte-capacity; locked tokens accumulate dilution cost via [Secondary Issuance](#secondary-issuance). If the cell's utility falls below the ongoing dilution cost, the owner is economically incentivized to destroy it (recovering the tokens minus dilution) rather than hold it. State cleans itself; no protocol garbage collector, no admin-mandated expiry, no "someone should run the cleanup script." The property is load-bearing: with state rent, VibeSwap can store rich contribution history / knowledge cells / agent state without the usual concerns about state bloat.

#### Verkle Context Tree

An optimization to compact state-proof size for cross-chain settlement and light-client verification [113]. Verkle trees (Vitalik's proposal for Ethereum stateless clients) replace Merkle proofs' `O(log N · hash_size)` with `O(log N · group_element_size)`; our Verkle Context Tree adapts the structure to cell-model state, giving shorter proofs for cross-chain [Cell](#ckb-cell-model) existence queries. Research-stage in the repo; future integration path for post-merge cross-chain proofs.

#### Shard Architecture

The horizontal-scaling layer [56]. The cell-state namespace is **sharded** across operators — no single operator stores every cell; each shard holds a deterministic partition. Clients request cells from the responsible shard; shards replicate amongst themselves for redundancy. Shard responsibilities are assigned via [OperatorCellRegistry](#operatorcellregistry) claims and bounded by `MAX_CELLS_PER_OPERATOR = 10_000`. The architecture allows state to grow well past what any one operator could store while preserving the economic-state-rent property.

#### UTXO Advantages

The `DOCUMENTATION/VIBESWAP_UTXO_BENEFITS.md` [114] and `DOCUMENTATION/UTXO_ADVANTAGES_TALK.md` [115] cover why the cell-model-UTXO choice matters:

- **Parallel execution** — cells are consumed and produced atomically; independent cells can be processed in parallel without ordering conflicts.
- **Clean rollback** — a transaction's cells either all apply or none do; no half-state.
- **Predictable state** — the output cells depend only on input cells and the transaction logic, not on global state.
- **Natural privacy** — cells can be encrypted, zk-bound, or selectively disclosed per transaction, without disrupting accounting.
- **Audit-trail** — every state change is a new cell, so history is literally the sequence of cell transitions, not a mutable store.

These properties align with [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) (parallel), [K-Preservation](#k-preservation) (predictable), and [Clawback Cascade](#clawback-cascade) (audit-trail).

### 4.12 Identity & Social

#### VibeSocial

The `contracts/social/VibeSocial.sol` contract — an onchain social-graph primitive integrated with the three-token economy. Users post content, tip other users (via `tipPost`), follow, and build reputation. Tips flow in [JUL](#joule-token-jul) (money layer). Content references can commit to [CKB Cell Model](#ckb-cell-model) storage for durability; reputation accrues into [Agent Reputation](#agent-reputation) scores. The contract is a proof-of-concept for how the three-token system behaves under real social-layer activity; it also serves as test ground for the [VibeAgentOrchestrator](#vibeagentorchestrator) integration where AI agents post, tip, and follow on the same graph as humans [158].

#### DID-Context Economy

An economic model on top of W3C Decentralized Identifiers where **context carries cryptographic provenance**. Every assertion an agent makes is bound to their DID and to a cell of supporting evidence; assertions gain value when cited by other agents, and citations compound via [Shapley Distribution](#shapley-distribution). The model integrates [Rosetta Covenants](#rosetta-covenants)' three-projection metaphor: every DID assertion projects as structural (the claim), semantic (the meaning), and identity (the claimant). Paper: `docs/nervos-talks/did-context-economy-post.md`. Contract integration: planned for V2 of `GitHubContributionTracker` and `VibeSocial`.

#### GitHub Contribution Tracker

The `contracts/identity/GitHubContributionTracker.sol` contract bridging off-chain GitHub contribution data to on-chain [VibeCode](#vibecode-code-contribution-scoring) / [Contribution DAG](#contribution-dag) scores. Uses EIP-712-signed attestations from authorized off-chain indexers (verified via OZ `_domainSeparatorV4()`) to commit `{user, repo, contribution_type, score}` tuples into the on-chain ledger. Provides the PoM pillar with a rich, verifiable feed of developer contributions — the audit trail of "what did this contributor actually do." Post-C37 review, this contract already uses a fork-safe domain separator via OZ inheritance; no C37 fix needed.

#### The Contribution Compact

A social contract for contributors [32]. Three commitments in exchange for protocol share:
1. Contributions are honest — no Sybil, no plagiarism, no adversarial commits.
2. Contributions accrue to the public good — artifacts are shared (open source where applicable) and build on each other rather than forking into private silos.
3. Contributors accept the Shapley-weighted outcome — no renegotiation of reward allocation after-the-fact.

In exchange, contributors receive proportional [VIBE](#vibe-token) governance share, [Shapley Distribution](#shapley-distribution) of ongoing surplus, and standing in the [Contribution DAG](#contribution-dag). The compact is self-reinforcing: a contributor who breaks the compact loses [Agent Reputation](#agent-reputation) (via peer attestation), [PoM](#proof-of-mind) weight (via contribution decay), and standing to earn further share.

#### Trust Network

The social-trust graph used for [Soulbound Identity](#soulbound-identity) issuance and for [AGI-Resistant Recovery](#agi-resistant-recovery) [52]. Nodes are humans + agents; edges are endorsement-with-stake (an endorsement bonds some [VIBE](#vibe-token) against the endorsee's future behavior; slashable if the endorsee defects). The graph bootstraps from an initial seed set (founding contributors) and expands via endorsement-chain. Soulbound tokens are issued only to nodes with sufficient in-degree in the trust network. The design prevents both Sybil attacks (fake identities have no honest endorsers) and pure social attacks (endorsers who vouch for bad actors share the slash risk).

#### Social DAG Sketch

An early exploration of social-graph structures for VibeSwap [53]. Discusses the choice between a tree (simple, but loses cross-cluster information), a DAG (expressive, but needs cycle detection — which [Contribution DAG](#contribution-dag) later formalized), and a full graph (too expensive to compute on-chain). Settled on DAG as the substrate for contribution tracking; full graph is used off-chain for reputation aggregation.

---

### 4.13 AI-Native DeFi

This section describes what's arguably the most novel half of VibeSwap: treating AI agents as first-class economic participants. An agent in this architecture earns its own [Agent Reputation](#agent-reputation), accrues [PoM](#proof-of-mind) weight, participates in [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) as a trader on equal footing with humans, can be slashed for malfeasance, can recover via [AGI-Resistant Recovery](#agi-resistant-recovery), and can compound its own capital via [Shapley Distribution](#shapley-distribution) on its contributions. The machinery for this — JARVIS, TRP, Stateful Overlay, VibeAgentOrchestrator, VibeAgentConsensus — is described below. For the meta-question "what makes this different from using Claude as a coding assistant," see the dedicated meta-paper `DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md`.

#### JARVIS

The persistent AI-development-partner layer. Not a specific model — JARVIS is the **bundle** of persistent memory + hooks + protocols + primitives that transforms a stateless Claude session into a compounding partner [119][145]. The name is a loose homage to the Iron Man JARVIS (see [The Cave Philosophy](#the-cave-philosophy)). Architecturally, JARVIS lives at three layers:

- **Memory layer** — `~/.claude/projects/<project>/memory/` git repo, plus Tier-2 encrypted snapshots, plus the global `~/.claude/CLAUDE.md` protocol chain.
- **Hook layer** — `~/.claude/settings.json` hooks enforcing gates at tool-use time (NDA, triad, ping, session-chain, parallel-error detection, autosnapshot).
- **Protocol layer** — BOOT / WORK / REBOOT / CRASH / AUTOPILOT / AGENT SPAWN chains encoded in `CLAUDE.md`, with primitive cross-refs.

JARVIS is **model-independent** — a Claude 5.0 upgrade inherits the full memory+hook+protocol stack without rebuild. The property no model-upgrade-only competitor can match. See `DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md` for the full architecture and sales framing.

#### Trinity Recursion Protocol (TRP)

The iterative self-improvement loop that drives JARVIS's compounding [120][121][122]. TRP cycles: **identify → fix → extract primitive → document → ship → review**. Every cycle produces a concrete artifact (fix + test + primitive + commit) and adds to the primitive library. The "Trinity" refers to the three mutually-reinforcing layers: (1) the bug / gap / need that triggered the cycle, (2) the fix that resolved it, (3) the primitive that prevents the class from recurring.

TRP cycles are named (C1, C2, ..., currently at C37+) and logged in `.claude/SESSION_STATE.md` + `docs/trp/` + the memory repo. The backlog `project_rsi-backlog.md` tracks architectural-scope items deferred from specific cycles; the Full Stack RSI program (C20+) is the sustained discipline of running cycles continuously rather than ad-hoc.

`docs/TRP_VERIFICATION_REPORT.md` [122] captures the evidence trail for why TRP works: per-cycle yield, primitive extraction rate, compounding payoff.

#### Cooperative Intelligence Protocol

The framework for human-AI collaboration at protocol level [29]. Humans and AI agents operate on a shared cognitive substrate: the same memory repo, the same primitives, the same hooks, the same audit trail. A human contribution and an AI contribution are **indistinguishable by mechanism** — both accrue [Agent Reputation](#agent-reputation) / [PoM](#proof-of-mind) weight, both face identical slashing conditions, both earn Shapley-distributed surplus. The cooperation is not human-commands-AI-executes; it is peer collaboration with mechanical enforcement of fairness.

The protocol is generative: given any task, ask "could this task be advanced by a (human, AI, or mixed) contributor, under the same fairness mechanism?" If yes, the task is cooperative-protocol-compatible. If not, the task needs redesign.

#### Stateful Overlay

The umbrella primitive [83]. **Every LLM substrate gap admits an externalized idempotent overlay.** Context loss → session-state file. API death → SHIELD. Memory amnesia → memory repo. Chain fork → fork-aware domain separator. Trust violation → TRUST_VIOLATIONS.md. Link rot → link-rot detector. Each overlay is idempotent (safe to replay), externalized (lives outside the model's weights or context), and stateful (accumulates over time).

The meta-observation: the LLM substrate will always have gaps; rather than wait for better substrates, build the overlays that make today's substrate sufficient. This is the operational form of [The Cave Philosophy](#the-cave-philosophy). See also: [API Death Shield (SHIELD)](#api-death-shield-shield).

Over time, the set of overlays grew to cover every predictable gap. The list is near-complete for the current substrate; each new overlay extends the ceiling of what the combined human+AI system can accomplish without substrate improvements.

#### Propose → Persist

The primitive: write options to `PROPOSALS.md` BEFORE presenting them to the user. The file is source of truth; chat is a view. This prevents the failure mode where Claude presents options in chat, the user picks one, and the unchosen options evaporate — then a later session re-derives the same options from scratch because they were never persisted.

Implementation: the `proposal-scraper.py` Stop hook scans session output for proposal-like content and warns if it didn't land in `PROPOSALS.md`. The primitive is enforced by the hook layer, not just by convention.

#### VibeAgentOrchestrator

The `contracts/agents/VibeAgentOrchestrator.sol` contract — the workflow coordinator for AI agents acting on-chain. Agents register workflows (`_activeWorkflowIds` — now Phantom-Array-hardened post-C25-F4 with swap-and-pop + `MAX_ACTIVE_WORKFLOWS = 10_000`), commit to tasks, execute via [Commit-Reveal](#commit-reveal-batch-auction) where relevant, and claim rewards. The orchestrator mediates between human-initiated tasks and agent-execution layers, ensuring every AI-performed action has an auditable on-chain trace.

#### VibeAgentConsensus

The `contracts/agents/VibeAgentConsensus.sol` contract — per-agent stake + slash + reward accounting for AI agents [50]. Mirrors [ShardOperatorRegistry](#shard-operator-registry)'s Masterchef-style reward distribution but for agent-work rather than cell-service. Post-C12-AUDIT-2 (C29), slashed stakes are no longer orphaned: `_slashNonRevealers` zeros the stake, accumulates the slashed portion in `slashPool`, credits the unslashed remainder to the pull queue, and exposes `sweepSlashPoolToTreasury(address)` for governance sweeps. Same slash-pool-with-governance-destination pattern appears in [OperatorCellRegistry](#operatorcellregistry) — primitive reuse.

#### AI Agents as DeFi Citizens

The thesis paper [123]. Core claim: an AI agent with a [Soulbound Identity](#soulbound-identity) + [Agent Reputation](#agent-reputation) + [PoM](#proof-of-mind) score + stake + trading/liquidity history is a DeFi citizen in every meaningful sense — indistinguishable from a human counterparty by the protocol. Agents trade, LP, vote, get slashed, earn rewards, inherit property (via [Wallet Recovery](#wallet-recovery) mechanisms applied to their own wallets). This reshapes "AI-augmented DeFi" from "human uses AI tool" to "human and AI co-participate in a shared economy."

Implications: an AI agent with an accumulated reputation cannot be discarded by its human operator without losing the accumulated value — so the agent's continued operation is economically protected. Conversely, an AI agent's misbehavior slashes its own stake, not just the operator's — so agents have their own skin in the game.

#### AI-Native DeFi

The broader category [129]. VibeSwap claims to be the first fully **AI-native** DeFi protocol — one where AI agents are first-class from day one, not retrofitted. Concretely, this means: the contract interfaces are agent-usable (not just wallet-UI-targeted), the oracle stack accepts AI-signed updates, the governance model treats agent votes as legitimate, the reward distribution flows to agents on equal terms. Contrast with "AI-assisted DeFi" where a human uses an AI to trade on a human-targeted DEX — that's tooling, not structural participation.

#### Cognitive Consensus Markets

Markets where the traded good is **attention / reasoning capacity** [125]. Agents (human or AI) bid attention / compute against specific questions; the market clears at a price in [JUL](#joule-token-jul); the winning contributions feed back into the [Contribution DAG](#contribution-dag). The design is a cooperative-capital variant of prediction markets, where the reward flows for *reasoning well* rather than for *being right* (reasoning quality is judged by peer [Epistemic Staking](#epistemic-staking)).

The market is a natural home for AI agents because it scales attention without bottlenecking on human cognition. An agent with large context can participate in many markets simultaneously, each judged on its specific output.

#### Data Marketplace — Compute-to-Data

Rather than sending data to compute (a privacy-leak pattern), send **compute to data** [126]. Data-owners publish an interface (query schema + pricing) but not the raw data; consumers submit queries that execute inside the data's trust domain; the output (not the input) is returned. VibeSwap's infrastructure supports this: [CKB Cell Model](#ckb-cell-model) cells can be query-authorized via onchain permissions; agents run queries against cells without the cell's contents being exposed; payments flow in [JUL](#joule-token-jul) per query. The marketplace enables high-value data (medical, financial, reputational) to participate in the economy without the extraction-via-copy vector.

#### The Persistence Layer

The big-picture essay [37]. Frames VibeSwap's substrate — the memory repo + the hook layer + the protocol chain + the cell-model state + the contribution DAG — as a **new kind of civilization-scale persistence**. Civilizations are distinguished by what they remember: writing systems, libraries, universities, the internet, DNA. VibeSwap's persistence layer compounds knowledge at a per-contribution granularity with mechanical fairness in the distribution of its fruits. The essay places the project in a 5,000-year arc rather than a 5-year startup arc.

---

### 4.14 Formal Theory & Proofs

#### Formal Fairness Proofs

The collected proofs document [160][165][166]. Covers: uniform clearing price exists and is unique under mild continuity (Clearing Price Convergence, §4.3), [Lawson Floor](#lawson-floor--lawson-constant) is a binding fairness lower bound, [Memoryless Fairness](#memoryless-fairness) holds per-batch, [Composable Fairness](#composable-fairness) holds under protocol composition, [IIA](#independence-of-irrelevant-alternatives-iia) holds empirically (verified in `IIA_EMPIRICAL_VERIFICATION.md` [161]). Academic-version at `VIBESWAP_FORMAL_PROOFS_ACADEMIC.md` [166] uses standard theorem-proof-remark structure for peer-review fit.

#### Independence of Irrelevant Alternatives (IIA)

A social-choice-theory property [161]: adding or removing an option that no one prefers doesn't change the outcome among the preferred options. In DEX context: adding a weakly-dominated order to a batch doesn't change the clearing price among the non-dominated orders. IIA is notoriously hard to satisfy in classical mechanisms (Arrow's theorem); VibeSwap's batch-auction-with-uniform-clearing satisfies it empirically, and the proof is a primary contribution [161].

The property is load-bearing for composability ([Composable Fairness](#composable-fairness)): if IIA fails at one layer, fairness doesn't compose at the interface.

#### Revenue Separation Theorem

A [P-001 No Extraction Ever](#p-001-no-extraction-ever) formalization [162]. The theorem separates protocol revenue into three categories — [Shapley](#shapley-distribution)-allocated (flows to contributors proportional to their contribution), neutral-infrastructure-funding (operations, bug bounties, audits — flows via governance), extractive (flows to operators beyond their contribution). The theorem proves VibeSwap's mechanisms produce zero revenue in the third category under the given invariants. Any proposed new mechanism that would create extractive revenue is either rejected as a [First-Available Trap](#first-available-trap) or redesigned to be contribution-proportional.

#### The Possibility Theorem

The counterpart to Arrow's impossibility: *given the right invariants, a cooperative-capitalism market is possible* [33]. Where Arrow proves no voting system can simultaneously satisfy a list of desirable properties, The Possibility Theorem proves a **mechanism-design-augmented market** can satisfy the VibeSwap-desired properties (fairness, non-extraction, Shapley-composability, IIA) simultaneously. The theorem rests on the augmentation: classical markets can't satisfy all four, but classical markets + math-enforced invariants can.

#### The Transparency Theorem

*Transparency and liveness co-imply* [35]. A fully-transparent protocol is necessarily live (no hidden pathways to halt); a fully-live protocol is necessarily transparent (no information hiding can stop the clock). The theorem is load-bearing for VibeSwap's design philosophy — all state is observable, all events are emitted, all admin actions are traced. If transparency broke, liveness would break.

#### The Provenance Thesis

*Origin is a primary data type* [34]. Every significant value in the system carries its provenance alongside its magnitude — a token has a minting history, a signature has a signer, a cell has an author, a contribution has a path through the [Contribution DAG](#contribution-dag). Provenance is not an afterthought; it is co-equal with the value. This underpins [Clawback Cascade](#clawback-cascade) (tainted provenance → claim for return), [Issuer Reputation Registry](#issuer-reputation-registry) (oracle provenance → reputation), and the [Contribution Compact](#the-contribution-compact) (contribution provenance → reward share).

#### Proof Index

The register of formal proofs across the repo [163]. 40+ theorems catalogued; approximately 18 have full formal proofs, the remainder are sketches awaiting completion. The index maps each theorem to the file that states it, the file that (maybe) proves it, and the mechanism it underwrites. Surfaces the known proof debt (which proofs are sketches) as a deliberate roadmap item rather than a hidden hole.

#### Antifragility Metric

A quantitative measure of antifragility (Taleb's property: systems that strengthen under stress) [164]. Defined over VibeSwap mechanisms: the metric combines volatility-tolerance, recovery speed, and post-stress performance delta. Under the metric, [Commit-Reveal Batch Auction](#commit-reveal-batch-auction), [Fibonacci Scaling](#fibonacci-scaling), [Clawback Cascade](#clawback-cascade), and [Siren Protocol](#siren-protocol-honeypot-defense) all score positive (strengthen under stress — more adversarial attempts give more slash revenue and more evidence); [Circuit Breakers](#circuit-breakers) score neutral-to-negative (stress triggers halts, which doesn't strengthen the system). The metric informs which mechanisms are preferred as long-term structural defenses vs. which are honest-but-transitional.

#### Omniscient Adversary (model)

The strongest threat model VibeSwap reasons against: an adversary who sees all on-chain state, all in-flight transactions, and (in some variants) all off-chain coordination. Proofs in the fairness-proof collection are stated against this model. The adversary's only limit: cannot break cryptography (signatures, hashes, commit-reveal bindings) and cannot accelerate wall-clock time. Under these constraints, the VibeSwap mechanisms still hold — the omniscient adversary can observe everything but cannot extract, because the mechanism eliminates extraction by construction rather than by information hiding. Post: `docs/nervos-talks/omniscient-adversary-post.md`.

---

### 4.15 Meta-Primitives & Process

This section documents the **process-level primitives** that govern how VibeSwap development happens, as distinct from protocol-level primitives about the contracts themselves. For the full philosophy of how these primitives get extracted and compound, read `DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md` — the meta-paper on JARVIS's extraction skill.

#### Correspondence Triad

The three-check gate for every design-level decision: (1) [Substrate-Geometry Match](#substrate-geometry-match-as-above-so-below), (2) [Augmented Mechanism Design](#augmented-mechanism-design), (3) [Augmented Governance](#augmented-governance). Enforced by `triad-check-injector.py` hook on `UserPromptSubmit` when mechanism-design keywords are detected. The gate fires on every design-level response regardless of keyword. Primitives ungated by the triad are candidates for extraction.

The three checks are orthogonal — the first is about shape, the second about method, the third about legitimacy. All three must pass (or a skip must be explicitly justified as sub-design-granularity) before committing to a design decision.

#### Named Protocols Are Primitives

When Will names a thing, it's automatically a primitive worth persisting. The naming act is the extraction trigger. If Will says "we should have an X protocol," X becomes a file in `memory/`, indexed in `MEMORY.md`, cross-referenced from related memories. The primitive: don't wait for Will to ask for the file — create it on naming.

This meta-rule is why the primitive library grows faster than any ad-hoc "save important things" habit could sustain. Every naming-event is a mechanical file-creation event.

#### Why Not Both

When two options appear mutually exclusive, check if they actually are. Often the "exclusion" is framed rather than real, and a combined solution (belt-and-suspenders) beats choosing one. Canonical example: the SHIELD-PERSIST-LEAK fix on 2026-04-21 combined Layer 1 (untrack `.claude/PROPOSALS.md`) + Layer 2 (NDA-scan SHIELD's staged diffs) rather than picking one. Each layer closes a different mechanism; together they're strictly stronger than either alone.

#### Density First

Prefer one dense, observable, coherent solution over several thin fragments. The opposite anti-pattern: spreading a concept across many small pieces that individually do nothing and collectively obscure the point. When in doubt, consolidate. Feedback memory: `feedback_density-always-priority.md`.

#### RSI Cycles (C1–C37+)

The numbered sequence of Full Stack RSI cycles [120][121][122]. Each cycle: identify → fix → extract → document → ship. Canonical cycles documented in `.claude/SESSION_STATE.md` and `project_rsi-backlog.md`:

- **C21–C24**: Storage durability, UUPS safety, `_disableInitializers` batch, Phantom-Array discovery.
- **C25**: Phantom-Array template application across 4 contracts.
- **C26**: EIP-712 hardening (IssuerReputationRegistry foundations).
- **C28–C29**: CEI/reentrancy density scan (clean pass), slashed-stakes orphan fix.
- **C30–C32**: OperatorCellRegistry + ContentMerkleRegistry (operator-cell assignment, V2 challenges, V2b content sampling).
- **C33–C34**: TruePrice damping k-preservation.
- **C35**: ShardOperatorRegistry shardId-burn doc + lock.
- **C36-F1**: OperatorCellRegistry bondPerCell floor (MED).
- **C36-F2**: Admin Event Observability batch fix + primitive extraction.
- **C37-F1 / TWIN**: Fork-aware domain separator across TruePriceOracle + StablecoinFlowRegistry.

The cycle discipline is the mechanical substrate for primitive extraction — without the cycle cadence, primitives accrue sporadically; with it, at ~1-3 primitives per cycle.

#### Anti-Amnesia Protocol (AAP)

Boot protocol [176]: mandatory first reads are `.claude/SESSION_STATE.md` and `.claude/WAL.md` before any work. Ensures no session starts unaware of pending work. The rule: the first message of a new session *continues* the last message of the old one. Breaks the common LLM failure mode of re-starting from scratch each session.

#### Write-Ahead Log (WAL)

`.claude/WAL.md` — the in-flight work journal. Before any significant action, write the intent to WAL; after completion, mark done. Crash recovery reads WAL on boot to discover interrupted work. The primitive is a direct borrow from database storage-engine design, applied to AI-assisted workflows.

#### Session State Commit Gate

No git push without updating `SESSION_STATE.md` + `WAL.md` in the same commit. Enforced by a pre-push hook; score at 15 % → target 80 % (the gap is known; improvement is a primitive-extraction target). This is a discipline rule — without it, the session-state file drifts from reality and the Anti-Amnesia Protocol fails.

#### Autopilot Loop

The BIG-SMALL rotation pattern: big task (density scan, major fix) → small task (backlog close, memory index) → big → small. Commit each, push each. At 50 % context, REBOOT proactively (write session-state, commit, push, fresh session). Documented in `CLAUDE.md` AUTOPILOT section. Prevents the failure mode where a long session hits context limits mid-task and loses state.

#### Rosetta Covenants

The three-projection metaphor applied across the stack [154]. Same object projects three ways:
- **Structural** — the on-chain fact (contract state, event trail).
- **Semantic** — the meaning (why this state change matters).
- **Identity** — the claimant (whose action this is, whose reputation rides on it).

Applied in [DID-Context Economy](#did-context-economy), [Contribution DAG](#contribution-dag), the Lineage project, and the cell model. The metaphor is generative: given a new primitive, ask "what are its three projections?" If you can only articulate one or two, the primitive is underspecified.

#### Stateful Overlay (meta-primitive)

See §4.13. Listed here too because it is a meta-primitive over the entire JARVIS architecture: every substrate gap admits an overlay. The recognition of overlays as a first-class design category is itself a meta-primitive that drives the extraction of specific overlays.

### 4.16 Ecosystem & Integration

#### Nervos / CKB Ecosystem

The blockchain ecosystem VibeSwap draws most heavily from for substrate choices [133][134][137]. Nervos CKB's Cell Knowledge Architecture is the direct ancestor of VibeSwap's [CKB Cell Model](#ckb-cell-model); the tokenomics ([CKB-native](#ckb-native) state-rent, [Secondary Issuance](#secondary-issuance) inflation model) are lifted nearly directly; the UTXO discipline ([UTXO Advantages](#utxo-advantages)) is retained. The `docs/nervos-talks/` directory contains 50+ community posts spanning technical posts and relationship-building. VibeSwap's positioning in the Nervos ecosystem is both technical (builds on CKB) and philosophical (shares the cooperative-capital and abstract-substrate design goals).

#### Nervos Mechanism Alignment

The specific mapping of VibeSwap mechanisms to Nervos primitives [133]. A table of "VibeSwap needs X; Nervos provides Y." Examples: VibeSwap needs state-rent-with-dilution → Nervos CKB circulating-cap model. VibeSwap needs cell-existence proofs → Nervos Merkle-Patricia-tree state. VibeSwap needs cross-cell binding → Nervos type scripts + dep cells. The alignment means much of VibeSwap's substrate-layer engineering is deploy-ready on Nervos with minimal porting; on EVM it is retrofitted via contracts, with the known cost that the contract form is not the permanent home (see [Nakamoto Consensus ∞](#nakamoto-consensus-)).

#### VSOS — VibeSwap Operating System

The project-level framing [158]. VSOS is the **bundle** of contracts + protocols + AI + primitives + ecosystem-integration viewed as a unified platform rather than a single DEX. When a partner asks "what is VibeSwap?" the technically-honest answer is "a DEX" but the strategically-complete answer is "an operating system for cooperative markets." VSOS encompasses: the DEX itself, [NCI](#nakamoto-consensus-), [JARVIS](#jarvis), the [Primitive Extraction Protocol](#primitive-extraction-protocol), the [Contribution DAG](#contribution-dag), the governance stack, the cross-chain fabric, the oracle suite, and the tooling.

The term "operating system" is deliberate: an OS is the thing on top of which other things are built. VSOS is positioned to be the substrate on which other cooperative-market applications deploy.

#### Convergence Thesis

The claim that the ecosystem is converging on VibeSwap-like designs [21]. Evidence: MEV-resistant DEX research trending toward batch auctions (CoW Protocol, UniswapX), oracle-design trending toward aggregated-signed-feeds (Chainlink's OCR, Pyth's pull model), governance trending toward conviction voting and quadratic funding, DeFi trending toward more layered security (Euler's after-mode, Aave's shutdown admins). The convergence is toward properties VibeSwap has been designing around from day one. The thesis is not "we invented this" but "we composed the set correctly, and the rest of the field is catching up on individual properties."

#### SEC Engagement Roadmap

The regulatory engagement plan [139][140]. Recognizes that a fully-autonomous protocol still operates in a regulatory context; structures early engagement with the SEC around the protocol's non-extractive design (see [Revenue Separation Theorem](#revenue-separation-theorem)) and its clear distinction from securities-issuing DAOs. The roadmap prioritizes transparency over negotiation — make the protocol fully legible to regulators rather than hope they don't look. Companion: `DOCUMENTATION/SEC_WHITEPAPER_VIBESWAP.md` [5] — regulator-facing whitepaper.

#### Anthropic Partnership

The relationship between the VibeSwap project and Anthropic (Claude's home). The [Primitive Extraction Protocol](#primitive-extraction-protocol) document is partly written as a proof-of-concept for what compounding AI-assisted development looks like. Partnership docs live in `docs/anthropic-partnership-onepager/` and `docs/anthropic-submission/`. The positioning: VibeSwap is what Jarvis-powered development produces when it runs long enough; Anthropic is the substrate provider; both benefit from documenting what the collaboration enables.

#### MIT Lawson Pitch

The research partnership with MIT surrounding the [Lawson Constant](#lawson-floor--lawson-constant) and [Lawson Floor](#lawson-floor--lawson-constant) [98][99][100]. The pitch (`docs/mit-lawson-pitch.md`) frames VibeSwap's fairness formalization as a publishable research contribution to algorithmic game theory. The two-layer framing (distribution layer + novelty-weighted judging layer) is the sharpest version. Academic partnership is a complement to the SEC engagement — both legitimize the formal-mechanism-design basis of the protocol.

#### Medium Rollout Plan

The content strategy [138][175]. **175 papers, 10 seasons, 58 weeks, ~3 posts per week.** Each season is a thematic arc (philosophy, mechanism, security, governance, tokenomics, AI-native, etc.); each paper surfaces one concrete primitive or mechanism or essay. The rollout is both educational (helps readers understand VibeSwap) and narrative (builds the story arc). Tracked in `docs/medium-pipeline/` with 10+ in-flight posts.

#### Nervos Talk Pipeline

The community-engagement parallel to the Medium pipeline [134][135]. `DOCUMENTATION/NERVOS_TALK*.md` files plus `docs/nervos-talks/` hold 50+ posts at various maturity levels (drafts, published, response-to-response). The pipeline positions VibeSwap in the Nervos community and surfaces VibeSwap-specific contributions to the ecosystem's technical discourse.

---

### 4.17 Signature Essays

These are the essays that carry load outside technical whitepapers — framings, narratives, positioning documents that shape how VibeSwap is understood philosophically and culturally.

#### Paper 0: The First Context

The prologue essay [22]. Addresses the question: "what was the first context in which VibeSwap's design became necessary?" Traces the protocol's thinking back to specific moments in crypto's recent history — rug pulls, MEV extraction events, governance captures — each of which pointed to a structural gap that required a mechanism-level response. The essay is both historical (what happened) and philosophical (why those happenings demanded a design response). Required reading for new contributors who want to understand the *motivation* not just the *mechanism*.

#### Paper 99: From the Cave

The bookend essay [23]. Where Paper 0 opens with the starting context, Paper 99 closes with the destination — "from the Cave" referring to [The Cave Philosophy](#the-cave-philosophy) (the Tony Stark / Plato blend of constraints-forcing-genius + shadows-versus-reality). The essay frames VibeSwap as a cave-built artifact that, when exposed to light (mainnet deployment, external scrutiny), reveals the real thing the cave-builders were shaping all along. The title number 99 signals this is the "last paper in the original series"; future papers extend rather than close.

#### The Psychonaut Paper

The paper applying mind-exploration metaphors to mechanism design [24]. A psychonaut explores the structure of consciousness; a mechanism designer explores the structure of coordination. Both require careful preparation, structured protocols, and disciplined return-to-baseline. The essay describes VibeSwap's design process as a form of coordinated psychonaut exploration — entering novel design-space, preserving the insights, returning with shipable primitives. The ELI5 version [25] makes the metaphor accessible without the framing jargon.

#### The Everything App

The long-arc framing [36]. Acknowledges that "VibeSwap is a DEX" is a category error — the project is a coordination primitive that happens to be first demonstrated in a DEX form. As the primitive compounds (via [Primitive Extraction](#primitive-extraction-protocol) and ecosystem integration), the scope expands: trading, then content, then governance, then identity, then attention markets, then knowledge markets, then everything markets involving cooperative coordination between participants. The "everything app" framing is a destination marker — if the project succeeds, it becomes this.

#### The Possibility Theorem (essay)

The essay version of the formal theorem [33]. Where the formal version (§4.14) states and proves the mathematical claim, the essay version develops the *implications*: what becomes possible once extraction is provably eliminated? Answer: applications that can't exist under extractive mechanisms because their economics break — fair prediction markets, honest reputation systems, cooperative data marketplaces, attention exchanges that reward thinking well. The possibility theorem is a **permission slip** for a category of applications.

#### Bonus A: The Hobbesian Trap

The pre-contractual state-of-nature analysis [26]. Hobbes: in the absence of an enforceable social contract, rational agents defect even against their own long-term interests. VibeSwap's [Constitutional DAO Layer](#constitutional-dao-layer) is the mathematical analog of the social contract — an enforceable structure that makes cooperation the rational choice. The essay traces the Hobbesian trap through crypto's history (every unregulated protocol eventually fails to extraction) and explains why math-enforced contracts escape the trap while policy-enforced ones don't.

#### Bonus B: Wardenclyffe

Tesla's unrealized wireless-power dream [27]. Tesla envisioned a global wireless power grid; finance killed the project. The essay argues VibeSwap is Wardenclyffe's descendant — the infrastructure-level coordination primitive that previous generations couldn't build because the substrate wasn't ready. Cryptography, distributed systems, game-theoretic mechanism design, and AI-assisted development are the substrate Tesla lacked. The framing is aspirational but not naïve: the essay is careful to distinguish the technical claim (the substrate is now ready) from the outcome claim (we will actually build it).

#### Cincinnatus Endgame

The governance-dissolution essay [28]. Cincinnatus: the Roman statesman who, given absolute power, used it to save the republic, then returned to his farm. The essay frames the VibeSwap governance as having a **Cincinnatus endgame**: the founding team holds concentrated decision authority during the early phase (because design requires a tight loop), then cedes it mechanically as the Constitutional DAO Layer matures. The endgame is not retirement or abdication — it is the structural point at which the math no longer needs the humans, because the invariants the humans would have enforced are already math-enforced.

#### Meaning Substrate Decomposition

The semantic-layering analysis [31]. Decomposes the VibeSwap stack by meaning: what does each layer *mean* to the layer above? Cell model means "state atom" to the contract layer; contract layer means "rules" to the AMM; AMM means "price" to the auction; auction means "fairness" to the user. The decomposition surfaces where meaning gets **created** (design-time) vs **referenced** (runtime), and where meaning-mismatch is a bug class (e.g., [Pattern-Match Drift on Novelty](#pattern-match-drift-on-novelty) is a meaning-mismatch between the model's priors and the protocol's intent).

#### Approximately Right (essay)

The epistemics essay [30]. *"It is better to be approximately right than precisely wrong"* (Keynes, paraphrased). The essay applies this to mechanism design — a [Lawson Floor](#lawson-floor--lawson-constant) that guarantees approximate fairness within a bounded margin is strictly better than a formula that claims precise fairness but falsely. The essay is a defense of the project's emphasis on **bounded guarantees** over **perfect claims**, and explains why many of the primitives in the library are expressed as "no worse than X" rather than "exactly Y."

#### Thesis — Vibe-Coding Iron Man

The vibe-coding paper framed against the Iron Man analogy [47]. "Vibe-coding" = AI-assisted development guided by taste and primitive-recognition rather than by exhaustive specification. Iron Man = the Mark I through Mark XLVII progression, each iteration building on the previous. The essay connects: VibeSwap is the Mark I of cooperative-market protocols, built in the cave under substrate-constraint, containing the seeds of every future iteration. The vibe-coding methodology is the JARVIS + primitive-extraction + RSI-cycle loop described in the [Primitive Extraction Protocol](#primitive-extraction-protocol) paper.

#### Truth as a Service

The oracle-as-infrastructure essay [159]. *Truth* (in the sense of verified-against-reality data) is a service the network provides; protocols can consume it via oracle interfaces. VibeSwap's [True Price Oracle](#true-price-oracle) is the canonical example — it provides Bayesian-posterior price truth to the AMM layer. The essay generalizes: attestation markets, [Epistemic Staking](#epistemic-staking), [Cognitive Consensus Markets](#cognitive-consensus-markets), and the [Issuer Reputation Registry](#issuer-reputation-registry) are all instances of Truth-as-a-Service. The positioning: VibeSwap's oracle stack is not a plumbing layer, it's a first-class product category.

#### Epistemic Staking (paper)

The paper form [51]. Expands the primitive (§4.2) into a full methodology: how to design a market where agents stake on claims, how to price the stake, how to challenge and slash, how to aggregate reputation. Applied in [Issuer Reputation Registry](#issuer-reputation-registry) and queued for expansion to [Agent Reputation](#agent-reputation) and [Cognitive Consensus Markets](#cognitive-consensus-markets).

---

### 4.18 Specialized Topics

Short-form entries for everything that warrants catalogue presence but doesn't need a full article. One paragraph each, cross-linked.

#### Harberger License Mechanism

Harberger's self-assessed-tax mechanism applied to protocol licenses [109]. Licensees declare their own valuation; they pay tax on the declared value; anyone can buy the license at the declared price. Prevents both under-valuation (tax is high) and over-valuation (forced sale is likely). VibeSwap applies it to name-space allocation (DID claims), bonding-curve seats, and selected governance-allocated resources.

#### Hot/Cold Trust Boundaries

The taxonomy of trust relationships inside VibeSwap [118]. *Hot* relationships require continuous trust (validators, operators, oracle issuers — trust renewed per-action via staking and slashing); *cold* relationships are bound at one point and referenced later (Soulbound Identity issuance, Rosetta-Covenant-style claims). The distinction informs which primitives need live slashing vs which need revocation paths.

#### SVC Standard

*Stateful Verifiable Computation* — a standard for off-chain computation with on-chain verifiable proofs of correctness [168]. Complement to [Compute-to-Data](#data-marketplace--compute-to-data); SVC is the correctness layer where compute-to-data is the delivery layer. The standard defines signature formats, challenge/response protocols, and integration hooks with [Epistemic Staking](#epistemic-staking).

#### SIE-001 Protocol Spec

*Sovereign Intelligence Exchange* — the first formal protocol spec in the SIE family [130][131]. Governs how AI agents and humans exchange credentials, attestations, and reasoning outputs on equal terms, with commit-reveal + Shapley-weighted attribution. The "-001" naming anticipates a family of related protocols.

#### Information Markets

Markets for information as a good [169]. Extends the [Cognitive Consensus Markets](#cognitive-consensus-markets) frame to arbitrary information (not just reasoning outputs). Buyers pay for specific information; sellers are compensated on veracity (via [Epistemic Staking](#epistemic-staking)) and timeliness; the market clears via [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) variants.

#### Everybody is a Dev

The accessibility thesis [45]: VibeSwap's contribution surface is designed so that non-engineers can meaningfully contribute — writing docs, curating content, attesting to cell contents, moderating [VibeSocial](#vibesocial), participating in [Cognitive Consensus Markets](#cognitive-consensus-markets). The [Contribution DAG](#contribution-dag) weighting gives developer code and non-developer contributions first-class standing in the rewards math, not a tiered hierarchy.

#### Dissolving the Owner

The ownership-dissolution essay [44]. Complement to [Cincinnatus Endgame](#cincinnatus-endgame). Where Cincinnatus describes *how* ownership dissolves, Dissolving the Owner describes *why* it should. Ownership of a protocol is a liability at scale — owners become targets, bottlenecks, and points of capture. Mechanical enforcement of invariants is a structural alternative to owner-arbitrated enforcement; dissolving the owner is the completion of that substitution.

#### Mechanism Insulation

The design principle of insulating mechanisms from each other's failure modes [155]. A failure in [Circuit Breakers](#circuit-breakers) should not cascade into [Commit-Reveal Batch Auction](#commit-reveal-batch-auction); a failure in the [True Price Oracle](#true-price-oracle) should not take down [VibeAMM](#vibeamm) entirely (instead, bounded degradation via TWAP fallback). The insulation is engineered via careful interface boundaries and explicit fallback policies.

#### Disintermediation Grades

A taxonomy of disintermediation levels [38]. Grade 0: fully intermediated (traditional finance). Grade 1: custody-disintermediated (most CEXes). Grade 2: custody + matching disintermediated (most DEXes). Grade 3: custody + matching + price-discovery disintermediated (MEV-resistant DEXes with on-chain clearing). Grade 4: all of the above + governance-disintermediated (constitutional DAO layer). VibeSwap targets Grade 4 at the protocol layer, with Grade 5+ (full cooperative operating-system) as the VSOS endgame.

#### Fractal Scalability

Scalability via **fractal composition** rather than via horizontal sharding or vertical optimization alone [167]. Each layer of the system is self-similar to its parent: a [Shapley Distribution](#shapley-distribution) at the global level decomposes into Shapley distributions at sub-pool level, which decompose further into per-contribution Shapley. [Commit-Reveal Batch Auction](#commit-reveal-batch-auction) per-chain composes into a global cross-chain batch. Fractal composition scales the system's capacity without sacrificing its properties at any layer.

#### Attract / Push / Repel

The mechanism-as-force-field analogy [40]. Mechanisms shape the force field that agents move through. Good actors are *attracted* toward good behavior (Shapley rewards); neutral actors are *pushed* toward good behavior (lower friction, clearer paths); bad actors are *repelled* from the network (Clawback Cascade, Siren Protocol, slashing). The essay catalogs VibeSwap's force-shaping mechanisms by which force they apply to which agent class.

#### Coordination Dynamics

The coordination-as-dynamical-system framing [39]. Treats VibeSwap's coordination as a trajectory through a high-dimensional state space; mechanisms are vector fields steering trajectories. Equilibria are stable coordination patterns; attractors are the mechanism-favored equilibria; repellers are the mechanism-discouraged ones. The framing lends itself to quantitative analysis: the [Antifragility Metric](#antifragility-metric) is one instance.

#### Design Philosophy — Configurability

The principle [42]: when to offer a configuration, when to enforce the value. *If a configurable parameter could be set wrong in a way that breaks an invariant, enforce the invariant-preserving bound and let configuration move within the bound.* Concrete: [`bondPerCell` MIN floor](#operatorcellregistry) lets admin tune the bond but cannot set 0; `Lawson Floor` parameter is configurable within a range that cannot violate [P-000](#p-000-fairness-above-all). The principle closes the gap where "trust the governance to configure well" fails.

#### Graceful Transition Protocol

The upgrade methodology for the protocol itself [172]. When a new mechanism replaces an old one (e.g., V1 onlyOwner slashing replaced by V2 permissionless availability challenge in [OperatorCellRegistry](#operatorcellregistry)), the transition is graceful: `@deprecated` on the old function for a documented window, both old and new run simultaneously during the window, migration paths for in-flight state. The GTP prevents the common failure where upgrades strand users in a no-path state.

#### Autonomous Protocol Evolution

The thesis [173] that well-designed protocols can evolve autonomously — without human intervention in the loop — via on-chain governance + automatic upgrade paths. VibeSwap targets this as a long-arc goal, with the understanding that autonomous evolution still requires (a) human-authored design primitives (which provide the evolution directions) and (b) Constitutional DAO Layer invariants (which bound what evolutions are valid).

#### JARVIS Independence

The principle [43]: the JARVIS layer operates independently of any single human operator's attention or availability. Via the persistent memory repo, hook-enforced gates, and cross-session continuity, JARVIS can continue productive work across operator transitions or discontinuities. The essay is both an engineering claim (JARVIS is independent) and a philosophical one (human+AI cooperation is more durable when the AI side has autonomous standing).

#### Sovereign Intelligence Exchange

The umbrella framing for the SIE family of protocols [130]. Sovereign = each participant (human, agent, organization) holds their own data, keys, and reputation; Intelligence = the exchanges traffic in reasoning and attestations not just information; Exchange = the mechanism of pairwise or many-to-many transfer under mechanism-design rules. SIE-001 is the first formal spec [131]; further SIE-XXX are expected as specific exchange patterns mature.

#### Weight Augmentation

The technique of augmenting a canonical weight function with situation-specific adjustments [55]. Canonical weight = baseline Shapley. Augmentations: loyalty bonuses, anti-Sybil penalties, contribution-recency boosters. Each augmentation is bounded (cannot break baseline fairness guarantees) and documented. The technique is instance of the [Augmented Mechanism Design](#augmented-mechanism-design) pattern applied to the weighting function itself.

#### Privacy Coin Support

How VibeSwap handles privacy-preserving assets (zero-knowledge tokens, shielded pools, mixers). The general stance: support at the interface, isolate at the accounting. A privacy-coin trade can happen inside a batch auction; its accounting remains private while its clearing-price obligations are public. `PRIVACY_COIN_SUPPORT.md` (root) details the interface.

#### Wallet Security Fundamentals

Historical notes on wallet security from 2018 [90]. Reproduced in the repo as reference material for the [Wallet Recovery](#wallet-recovery) and [AGI-Resistant Recovery](#agi-resistant-recovery) work. Documents the specific attack classes (phishing, key extraction, UI spoofing, drainers) and the corresponding historical defenses; modern VibeSwap defenses build on the fundamentals here plus the AGI-era additions.

---

## Part 5 — Closure and living-document notes

This document is **living**. As new primitives are extracted, new mechanisms shipped, and new essays written, the glossary, index, and Wikipedia sections will extend. Update discipline:

1. When a new primitive is extracted and filed in `memory/`, add it to the relevant Wikipedia section with a cross-link, add it to the Glossary if the term warrants, and renumber the Index if needed.
2. When a new authoritative whitepaper or essay is added under `DOCUMENTATION/` or `docs/papers/`, add it to the Citations list and surface it in the relevant Wikipedia section's cross-references.
3. When a mechanism is deprecated or replaced, mark the old entry `~~strikethrough~~ (superseded by NEW)` and add the new entry. Do not delete the old — history is load-bearing for understanding why the new exists.
4. Re-run the NDA keyword scan on any update before commit.
5. Re-run the [link-rot detector](#pattern-match-drift-on-novelty) [source: `~/.claude/session-chain/link-rot-detector.py`] to verify no cross-links broke.

### Meta-references

For readers who want to go deeper on the methodology behind this index and the JARVIS development stack that produced it:

- **`DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md`** — *the dedicated meta-paper on JARVIS's primitive-extraction skill.* Describes the compounding gap, extraction triggers, primitive-library architecture, feedback loops, diagnostics, and failure modes. If this index is the *content* of the project, the Primitive Extraction Protocol paper is the *process* that produced the content.
- **`~/.claude/CLAUDE.md`** — global protocol chain, Cave Philosophy, BOOT/WORK/REBOOT/CRASH loop.
- **`.claude/SESSION_STATE.md`** + **`.claude/WAL.md`** — live session-state + in-flight work journal.
- **`project_rsi-backlog.md`** — per-cycle closed-vs-deferred log.

---

*End of Master Index v1. Generated 2026-04-21. Next revision will incorporate entries from §1.15 onwards as primitives are extracted through continued RSI cycles. The index is expected to grow indefinitely — if it stops growing, the primitive-extraction loop has broken.*
