# Portable Primitives Menu — VibeSwap to USD8

**Status**: technical reference. Adapted from a systematic inventory of `vibeswap/contracts/`.
**Audience**: USD8 protocol team — implementation engineers and architects evaluating which proven primitives to lift directly versus which to design from scratch.
**Purpose**: present the VibeSwap contract library as a menu Rick's team can pick from. For each primitive: what it does, what USD8 architectural need it addresses, port classification, effort estimate, and audit posture. Already-proposed primitives (from prior partner deliverables) are listed for completeness with a pointer to the existing spec.

---

## How to use this menu

The eight primitives in the **HIGH portability** section are the ones we recommend lifting first. Each meets all three of: (a) clean USD8 architectural fit, (b) zero or near-zero modification required, (c) audit history that USD8 inherits.

The five primitives in the **MEDIUM portability** section solve real USD8 problems but require substrate-specific adaptation. Lift them if the corresponding USD8 need becomes load-bearing.

The **already-proposed** section lists the four primitives covered in companion specs we've already shipped. Listed here so Rick has one place to see the full menu, not to recommend re-adoption.

The **deliberately not recommended** section lists primitives that exist in VibeSwap but are AMM-specific or otherwise substrate-mismatched to USD8. Listed for transparency so Rick can see what we evaluated and rejected.

---

## HIGH PORTABILITY — eight primitives

### 1. CircuitBreaker — emergency pause with attested-resume

**VibeSwap location**: `contracts/core/CircuitBreaker.sol` (478 LOC)

**What it does**: a multi-level emergency-stop mechanism with separate breaker types. Each breaker monitors a specific signal (volume anomaly, price deviation, withdrawal rate, loss rate) and trips if its threshold is breached. Crucially, breaker resume is *attested*, not automatic — the cooldown period is a floor, not a guarantee of resumption. To re-enable a tripped breaker, an explicit safety attestation is required from a configured set of attestors. This closes the failure mode where a breaker auto-resumes mid-stress because the cooldown elapsed, even though the underlying condition persists.

**USD8 architectural need**: Cover Pool circuit breaker. Pause new claims and withdrawals if depeg detected, if the Cover Pool composition becomes structurally insolvent, or if any covered protocol's price deviates beyond a configured threshold. Resume only when an attestor confirms the underlying condition has resolved.

**Port classification**: DIRECT-PORT. Drop the contract in; rename breaker types (LOSS_BREAKER → COVER_INSOLVENCY; TRUE_PRICE → COVER_ADEQUACY; VOLUME → CLAIM_RATE; WITHDRAWAL → POOL_WITHDRAWAL). Configure attestor set. No structural changes.

**Effort**: 1-2 days for adaptation + tests + audit checkpoint.

**Audit posture**: core VibeSwap security primitive; referenced as load-bearing in the C43 attested-resume deployment cycle. The attested-resume pattern itself was specifically designed to address the auto-resume-during-stress failure mode that has been the root cause of multiple DeFi incident-response failures.

---

### 2. DeterministicShuffle — ordering from XOR'd revealed secrets

**VibeSwap location**: `contracts/libraries/DeterministicShuffle.sol` (174 LOC)

**What it does**: a Fisher-Yates shuffle whose seed is constructed from the XOR of all participants' revealed secrets, plus block entropy that is unpredictable at the time of commit. The result is a deterministic ordering that cannot be predicted before all reveals are in (because the seed depends on every participant's secret) and cannot be manipulated after reveal (because the algorithm is deterministic from the combined seed).

**USD8 architectural need**: claims tribunal queue ordering. When multiple claimants submit claims against the same exploit, the order in which they are evaluated by the tribunal must be unpredictable in advance (so no claimant can game the order) and deterministic on observation (so the tribunal cannot favor one claimant by reordering). Same property structure as VibeSwap's batch-auction ordering.

**Port classification**: DIRECT-PORT. Pure library; protocol-agnostic; supply the participant set and the secret-commitment data.

**Effort**: a few hours for integration + tests.

**Audit posture**: implements the standard "last-revealer attack" defense via secure seed generation. The library has been reviewed across multiple audit cycles in VibeSwap's commit-reveal infrastructure.

---

### 3. TWAPOracle — depeg detection via time-weighted price

**VibeSwap location**: `contracts/libraries/TWAPOracle.sol` (272 LOC)

**What it does**: a ring-buffer time-weighted-average-price oracle with configurable observation windows from 5 minutes to 24 hours. Auto-grows cardinality as needed. Designed to be fed by any price source (DEX, oracle aggregator, custom feed). Returns smoothed price over the configured window — robust to single-block manipulation but responsive enough for short-window applications.

**USD8 architectural need**: depeg detection for the underlying USDC reserve. Sample USDC/USD price every block; compute TWAP over a 1-hour window; if the spot vs TWAP deviation exceeds a configured threshold, trip the Cover Pool circuit breaker. Same use case for any other protocol-collateral asset USD8 depends on.

**Port classification**: DIRECT-PORT. Pure library; supply the initial price seed and the price source (Chainlink, Pyth, etc.).

**Effort**: a few hours for integration + tests, plus configuration of the price source.

**Audit posture**: foundational oracle library; well-tested DEX pattern. The ring-buffer-with-cardinality-growth pattern is the same one used in Uniswap v3's TWAP implementation and has been audited extensively across the DeFi space.

---

### 4. VerifiedCompute — off-chain compute with bonded dispute window

**VibeSwap location**: `contracts/settlement/VerifiedCompute.sol` (195 LOC)

**What it does**: an abstract base contract for the pattern "submit a result of off-chain computation; bond stake against its correctness; allow a dispute window during which any observer can challenge with a counter-proof; finalize after the window if no challenge succeeds." The base contract handles status transitions (None → Pending → Finalized or Disputed), bond accounting, and the slash mechanic on successful disputes.

**USD8 architectural need**: the core of the Brevis-integrated Cover Score flow. Off-chain Brevis circuit computes the score; submitter bonds stake against the computation's correctness; a 24-hour dispute window opens; if no successful counter-proof arrives, the score is finalized and the claim settles. If a counter-proof arrives, the bond is slashed and the original score is rejected.

**Port classification**: WRAPPER-NEEDED. The base contract is abstract and substrate-agnostic. USD8 implements a concrete subclass `CoverScoreVerifiedCompute` that defines: how to verify a Brevis proof matches the submitted result hash, which roles can submit, what the dispute mechanic looks like for Cover Score specifically. The wrapper is small (~100-200 LOC); the base contract does the heavy lifting.

**Effort**: 3-5 days for the wrapper + tests + Brevis-circuit integration.

**Audit posture**: the underlying pattern is the same as Tornado Cash's proof finalization and modern ZK rollup settlement. The abstract base has been reviewed in the VibeSwap audit. The wrapper inherits the audit posture of the base.

---

### 5. OracleAggregationCRA — commit-reveal oracle batch aggregator

**VibeSwap location**: `contracts/oracles/OracleAggregationCRA.sol` (279 LOC)

**What it does**: aggregates multiple oracle submissions in a commit-reveal batch. Phase 1: oracles commit hashes of their submissions over a 30-second window. Phase 2: oracles reveal their actual submissions over a 10-second window. Phase 3: the contract computes the median (or other quorum function) of revealed submissions; non-revealing committers are slashed. Replaces policy-level deviation gates ("don't accept submissions more than 5% off median") with a structural commit-reveal opacity that prevents oracles from observing each other before submission.

**USD8 architectural need**: aggregating multiple Brevis proofs of the same Cover Score. If USD8 wants to require N-of-M attestor agreement on a Cover Score before settlement (defense-in-depth above what a single Brevis proof gives), this primitive provides the commit-reveal pattern that prevents attestor collusion via observation.

**Port classification**: REFINE-WITH-INPUT-REDEFINITION. The phase-timing structure is fine; substitute "price submission" with "Brevis proof bundle hash"; substitute "median computation" with "quorum-weighted acceptance of the proof set." The state machine itself is reusable.

**Effort**: 1-2 weeks for the adaptation + tests + Brevis integration.

**Audit posture**: implementation of the FAT-AUDIT-2 / ETM Alignment Gap 2 work. Phase timing is locked; the commit/reveal/settle logic has been reviewed.

---

### 6. IssuerReputationRegistry — stake-bonded issuer identity with mean-reversion

**VibeSwap location**: `contracts/oracles/IssuerReputationRegistry.sol` (316 LOC)

**What it does**: a registry where attesting parties (oracles, signers, attestors) bond stake to register and accumulate reputation through clean operation. Reputation is in basis points, scaled 0-10000, with mean-reversion toward a midpoint (5000 bps) and a 30-day half-life decay. Slashing subtracts reputation BPS and burns proportional stake. There is *no* positive-reward feedback loop — reputation is a penalty counter that fades back toward the mean over time. A 7-day unbonding delay prevents slash-dodging.

**USD8 architectural need**: Brevis attestor reputation. Each attestor bonds collateral. If a proof is shown to be fraudulent (via the dispute window in VerifiedCompute), the attestor is slashed. The mean-reversion ensures temporary slashing doesn't permanently destroy reputation — recovery is possible via 30 days of honest issuance, which is operationally reasonable but expensive enough to deter repeated bad behavior.

**Port classification**: REFINE-WITH-INPUT-REDEFINITION. The registry structure is USD8-ready as-is. Substitute the staked token (CKB → USDC or ETH or USD8 itself) and the authorized slashers (VibeSwap-specific addresses → Brevis-proof verifier + Cover Score tribunal).

**Effort**: 2-3 days for adaptation + tests.

**Audit posture**: the C12 isolation pattern (standalone registry, not an extension of any other reputation contract) was specifically chosen to keep this primitive independently auditable. Permissioned slashing is locked; social slashing is stubbed but disabled by default.

---

### 7. Off-Circulation Registry pattern

**VibeSwap location**: pattern documented in memory `primitive_off-circulation-registry.md`; instances in multiple contracts.

**What it does**: a pattern (not a single contract) for tracking tokens that are "off-circulation" — locked in vaults, in-flight to other chains, in cooldown periods, or otherwise not freely transferable. The pattern requires that quantity gates (caps, throttles, supply queries) anchor in a canonical "off-circulation registry" rather than reading raw `balanceOf` from token contracts (which can lie via rebasing or fee-on-transfer behaviors).

**USD8 architectural need**: tracking USD8 in three states — freely transferable, locked in Cover Pool deposits (14-day cooldown), and committed to outstanding claims (pending settlement). Cap calculations for Cover Score, total supply queries, and rate limits should all read from a canonical registry, not from `balanceOf` directly.

**Port classification**: DIRECT-PORT (pattern). Implement a `USD8OffCirculationRegistry` contract that tracks the three categories above; have all USD8-state-touching code read from the registry rather than from token contracts.

**Effort**: 3-5 days for the registry + integration with Cover Pool + claim flow.

**Audit posture**: pattern proven across multiple VibeSwap contracts. The decision to anchor in a registry rather than `balanceOf` was specifically driven by a near-miss with rebasing-token interaction; USD8 may not have rebasing tokens in its reserve set today, but the registry pattern is cheap insurance for the future.

---

### 8. AdminEventObservability — every privileged setter emits XUpdated

**VibeSwap location**: pattern documented in memory `primitive_admin-event-observability.md`; instances in ~22 contracts.

**What it does**: a discipline (not a contract) requiring every privileged setter function to emit an `XUpdated(oldValue, newValue)` event with both the previous and new value. Enables off-chain monitoring infrastructure to detect parameter changes in real time, including detecting changes that bypass governance (e.g., a key compromise that lets an attacker set a parameter directly).

**USD8 architectural need**: every USD8 privileged setter (rate-limit thresholds, covered-protocol additions, Cover Score formula coefficients, attestor whitelist, Brevis circuit hash, etc.) should emit XUpdated. This makes USD8's parameter state continuously observable by anyone running an indexer, providing both operational transparency and early-warning detection of unauthorized changes.

**Port classification**: DIRECT-PORT (discipline). A one-line change per setter to emit the event. Mechanical to apply.

**Effort**: 1 day for the sweep across all USD8 contracts.

**Audit posture**: pattern proven across VibeSwap's setter surface. The C36-F2 cycle that introduced this discipline closed six low-severity audit findings simultaneously, which informed the decision to make it a discipline rather than a per-contract decision.

---

## MEDIUM PORTABILITY — five primitives

### 9. ContributionAttestor — three-branch claim adjudication

**VibeSwap location**: `contracts/identity/ContributionAttestor.sol` (508 LOC)

**What it does**: separates claim adjudication into three branches — Executive (handshake-weighted attestation by trusted parties), Judicial (tribunal escalation if contested), Legislative (governance override as a last resort). Maps to a separation-of-powers architecture for any claim-resolution flow.

**USD8 architectural need**: claims tribunal. For ambiguous coverage situations (partial hacks, multi-protocol exploits), this gives USD8 a graduated escalation path: most claims resolve at the Executive level (Cover Pool quorum — operator-side adjudication); contested ones escalate to Judicial (jury — operator-side dispute resolution); the rare cases that the jury cannot resolve escalate to Legislative (DAO governance — bounded by Layer 1 + Layer 2 invariants per Augmented Governance, so DAO acts as a backstop within constitutional bounds, not as a coordinate branch in the allocation layer).

**Port classification**: REFINE-WITH-INPUT-REDEFINITION. The three-branch pattern is generic; substitute the Executive weighting (trust-graph score → Cover Score reputation), the Judicial tribunal (random jury from high-reputation attestors), and the Legislative override (USD8 DAO).

**Effort**: 1-2 weeks for the adaptation, integration with Cover Score, and the tribunal-jury-selection mechanism.

**Audit posture**: non-upgradeable design. Gas-bounded BFS for trust-hop computation. Specific audit attention has been paid to escalation race conditions.

---

### 10. BehavioralReputationVerifier — fraud detection via off-chain compute + Merkle proof

**VibeSwap location**: `contracts/reputation/BehavioralReputationVerifier.sol` (281 LOC)

**What it does**: extends VerifiedCompute (primitive #4 above) to handle a specific class of off-chain computations — fraud detection. Six fraud-detector circuits run off-chain (selective reveal, Sybil timing, collusion ring, plagiarism, reputation churn, velocity spike); their results are committed via Merkle proof; the on-chain contract finalizes after the dispute window.

**USD8 architectural need**: claims fraud detection. Brevis-style off-chain computation runs anti-fraud heuristics on each claim; the result is submitted on-chain via the VerifiedCompute pattern; if not disputed, fraud-flagged claims are blocked or escalated to the tribunal.

**Port classification**: REFINE-WITH-INPUT-REDEFINITION. The VerifiedCompute subclass structure is solid; substitute the fraud flags (VibeSwap-specific behavioral patterns → claim-specific patterns: malicious attestation, double submission, timing attack, collusion with oracle).

**Effort**: 1-2 weeks for adaptation + the actual fraud-detection circuit design (which is the harder part).

**Audit posture**: extends VerifiedCompute, inheriting its audit posture. The fraud-detection circuits themselves are an open research surface — they will need auditing per circuit as USD8 defines them.

---

### 11. ContributionDAG — trust network with distance-based scoring

**VibeSwap location**: `contracts/identity/ContributionDAG.sol` (686 LOC)

**What it does**: a web-of-trust graph where users vouch for each other; a BFS from configured "founders" computes per-user trust scores with 15% decay per hop. Distance-from-founder produces a multiplier (founder 3.0×, trusted 2.0×, partial-trust 1.5×, untrusted 0.5×). Capped at six hops to bound gas cost.

**USD8 architectural need**: optional Cover Score v2 enhancement. Build a small trust graph rooted in known-good attestors (Chainlink operators, Pyth signers, USD8 team members); use the trust-distance as a credibility multiplier on attestation weights. Direct application: weight Brevis attestors by their on-chain trust distance from a small founder set.

**Port classification**: WRAPPER-NEEDED. The graph structure is generic but the integration with Cover Score reputation is USD8-specific. Likely a future-iteration enhancement, not a launch primitive.

**Effort**: 2-3 weeks if pursued; significant integration surface.

**Audit posture**: non-upgradeable design. MAX_TRUST_HOPS gas-bounded. The Lawson Constant attribution-anchor at line 38 is specifically designed to keep this primitive's properties stable as the graph scales.

---

### 12. ReputationOracle — pairwise comparison for tier promotion

**VibeSwap location**: `contracts/oracle/ReputationOracle.sol` (566 LOC)

**What it does**: implements pairwise comparison voting (Bradley-Terry style) over a population of evaluators. Voters commit a hash of their preference; reveal in a separate phase; aggregate via tier thresholds (20th percentile, 40th percentile, etc.). Used in VibeSwap for ranking participants by quality.

**USD8 architectural need**: claims tribunal juror tier assignment. Rank tribunal jurors via pairwise comparison of past verdict quality (good verdicts → tier up; bad verdicts → slash reputation). Direct application of the elicitation-stack framework from the cooperative-game-elicitation-stack research paper.

**Port classification**: REFINE-WITH-INPUT-REDEFINITION. Commit-reveal cycle is fine; substitute the comparison subject (claim verdict quality instead of contribution quality); substitute the eligibility check (tribunal-juror identity instead of VibeSwap-participant identity).

**Effort**: 1-2 weeks for adaptation + integration with the tribunal.

**Audit posture**: own commit-reveal logic; integrates SoulboundIdentity for voter eligibility; ShapleyDistributor rewards honest voters.

---

### 13. SoulboundIdentity — non-transferable ERC-721 for issuer registration

**VibeSwap location**: `contracts/identity/SoulboundIdentity.sol` (826 LOC, but only the soulbound primitive itself is portable; the gamification layer is VibeSwap-specific)

**What it does**: a non-transferable ERC-721 NFT used as an identity binding. The full contract has a rich gamification layer (XP, levels, alignment, quantum keys) that is specific to VibeSwap; the underlying soulbound-identity primitive is generic.

**USD8 architectural need**: attestor identity binding. Each Brevis attestor or claim juror is associated with a soulbound NFT that cannot be transferred. The NFT becomes the identity-key for reputation tracking, slashing, and tribunal-juror-selection.

**Port classification**: WRAPPER-NEEDED. Lift the soulbound-NFT base; build a much smaller USD8-specific wrapper without the gamification layer.

**Effort**: 2-3 days for the lift + USD8-specific wrapper.

**Audit posture**: the soulbound-NFT pattern is well-established (ERC-5114, ERC-5484). The VibeSwap implementation extends OZ's ERC-721 with disabled transfer functions.

---

## ALREADY-PROPOSED — for completeness

These four were covered in earlier partner deliverables. Listed here so Rick has the full menu in one place.

### IncrementalMerkleTree — history compression
- **VibeSwap location**: `contracts/libraries/IncrementalMerkleTree.sol` (199 LOC)
- **Already-proposed in**: `history-compression-spec.pdf`
- **Port classification**: DIRECT-PORT
- **One-line summary**: Eth2 deposit-contract append-only Merkle tree + Tornado Cash 30-root ring buffer for async proof verification. Compresses Cover Score holder history to O(log n) query cost.

### ShapleyDistributor — five-component fair allocation
- **VibeSwap location**: `contracts/incentives/ShapleyDistributor.sol` (1576 LOC)
- **Already-proposed in**: `shapley-fee-routing-spec.pdf`
- **Port classification**: DIRECT-PORT (5 of 6 components port directly with input redefinition; Scarcity component drops by default)
- **One-line summary**: Cover Pool LP fee distribution via Shapley value with five weights — direct contribution, enabling tenure, scarcity (drops for USD8), stability, quality.

### FibonacciScaling — scale-invariant rate limiting
- **VibeSwap location**: `contracts/libraries/FibonacciScaling.sol` (433 LOC)
- **Already-proposed in**: PR concept #5 + `initial-concepts.pdf`
- **Port classification**: DIRECT-PORT
- **One-line summary**: damping curve with thresholds at powers of 1/φ (23.6%, 38.2%, 61.8%, 78.6%) — scale-invariant, denies attackers a preferred timescale to target.

### ContributionAttestor (state machine portion)
- **VibeSwap location**: `contracts/identity/ContributionAttestor.sol` (508 LOC)
- **Already-proposed in**: `shapley-fee-routing-spec.pdf` (mentioned for Cover Score attestation; tribunal escalation also discussed in MEDIUM #9 above for adjudication)
- **Port classification**: DIRECT-PORT for the state-machine portion; REFINE for the weighting integration

---

## DELIBERATELY NOT RECOMMENDED

Listed for transparency. Each was evaluated and rejected for substrate-mismatch reasons.

| Primitive | Reason for rejection |
|---|---|
| `CommitRevealAuction.sol` | MEV-defense for trading pairs; AMM-specific. Cover Pool claims don't have priority bidding. |
| AMM contracts (`VibeAMM.sol`, `VibeRouter.sol`, `VibeLP*`, `ConstantProductCurve.sol`, etc.) | Liquidity-provision math irrelevant to a Cover Pool. Different substrate entirely. |
| `CrossChainRouter.sol` | LayerZero-specific; USD8 may have different cross-chain requirements. |
| Full `SoulboundIdentity.sol` (only the base soulbound primitive is portable; see MEDIUM #13) | The gamification layer is VibeSwap-specific. Extracting just the soulbound-base is recommended. |

---

## Recommended priority order for USD8

If USD8 wants to start with the highest-leverage adoptions first, the order is:

1. **CircuitBreaker** — load-bearing safety primitive; integrate immediately into Cover Pool pause logic.
2. **VerifiedCompute + IssuerReputationRegistry** — together form the Brevis settlement foundation. Implement as a pair.
3. **TWAPOracle** — depeg detector; pair with CircuitBreaker for the depeg-pause flow.
4. **AdminEventObservability** — discipline sweep across all USD8 contracts; cheap insurance for monitoring.
5. **Off-Circulation Registry** — set up the canonical USD8-state registry early; retrofitting later is harder.
6. **DeterministicShuffle** — apply when the tribunal flow is being implemented.
7. **OracleAggregationCRA** — apply when N-of-M Brevis attestation is on the roadmap.
8. **ContributionAttestor (full)** — apply when the multi-branch claim adjudication flow is ready.

The first four are the production-readiness foundation. The next three are the adjudication infrastructure. The last is the institutional-governance scaffold.

---

*Compiled from systematic inventory of `vibeswap/contracts/` against USD8's architectural needs. Per-primitive audit history and deeper context available in the VibeSwap repository under `docs/audit/` and the relevant `memory/primitive_*.md` files. This menu is offered as a starting point for Rick's team to prioritize the integration work — implementation begins upon access to USD8 contract surface and confirmation of which primitives Rick wants to adopt in which order.*
