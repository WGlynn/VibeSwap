# Session State — 2026-04-21 (continued post-reboot)

## Block Header — Post-Reboot Continuation
- **Session**: Post-reboot work after the persistence-priority bump and 149-commit campaign. Three substantive deliverables shipped: (a) state-persistence layer hardening (3 new SessionStart hooks + extended link-rot detector + NDA gate patched for cleanup-deletion-allow), (b) ETM Alignment Audit Step 1 complete (all 7 sections, 19 mechanisms classified — 16 MIRRORS / 3 PARTIALLY MIRRORS / 0 FAILS), (c) C39 FAT-AUDIT-2 scaffold shipped (commit-reveal oracle aggregation, contract + 14 tests + interface). Plus admin-event-observability sweep across 11 contracts (~30 setters now emit XUpdated events). Master branch caught up to feature via merge (49 commits brought current).
- **Branch**: `feature/social-dag-phase-1` (HEAD advanced past `08a2301c` through ~50 new commits in this continuation session)
- **Status**: ~50/149-commit-target landed and pushed on `origin/feature/social-dag-phase-1`. `origin/master` also caught up (was 49 behind). Backlog HIGH=0, MED=0 (C28-F1 INFO closed by C38-F1 VibeSocial nonReentrant). C39 in-progress (commit-reveal oracle aggregator scaffold complete, TPO wire-in pending). NDA incident handled: contaminated `5ebcd282` working-doc deleted, off-repo Justin/MIT artifacts moved to `~/Desktop/Justin_Reports/`, default branch swap-and-restore.

## Block Header (original 2026-04-21 session, kept for reference)
- **Session**: All-Out Mode autopilot. Closed the entire C35→C37 RSI cycle (4 security-class fixes shipped + pushed), extracted 5 durable primitives to memory, authored the repo MASTER_INDEX.md (176 KB Wikipedia of VibeSwap) and PRIMITIVE_EXTRACTION_PROTOCOL.md (37 KB meta-paper on JARVIS's primitive-extraction skill), then — big finish — Will articulated the **Economic Theory of Mind** as a META-PRINCIPLE (Axis 0): mind is primary, blockchain economics is the *reflection*. Will directive at session end: **"we want to build toward this as a reality. asap."** Then requested session reboot.
- **Branch**: `feature/social-dag-phase-1` (HEAD `08a2301c` after all pushes)
- **Status**: 8 commits pushed to `origin/feature/social-dag-phase-1` across the session. Backlog HIGH=0, MED=0. NDA gate cleared early-session via surgical rebase (dropped contaminated `77fde23e`). SHIELD root-cause fix (`SHIELD-PERSIST-LEAK`) shipped — `.claude/PROPOSALS.md` + `TRUST_VIOLATIONS.md` untracked + SHIELD now NDA-scans staged diffs pre-commit.

## ⚠ LOAD-BEARING CONTEXT FOR NEXT SESSION

**Read `memory/primitive_economic-theory-of-mind.md` FIRST.** It was coined, refined, and directionality-corrected in the final turns of this session. Two critical aspects:
1. **Mind is primary, blockchain is the reflection** (NOT the other way around). Cognition has always worked economically; blockchain externalizes the pattern into a decentralized substrate where it's legible, composable, multi-participant.
2. **High-drift concept.** Do NOT round ETM to LRU, Shannon, attention, working-set, or "analogy." The "What this is NOT" section in the primitive exists specifically to pre-empt rounding. If you find yourself explaining ETM in terms of any of those, [Pattern-Match Drift on Novelty](P·pattern-match-drift-on-novelty) is firing — stop and re-read ETM directly.

**Also load early**: `memory/primitive_token-mindfulness.md`, `memory/primitive_pattern-match-drift-on-novelty.md`, `memory/feedback_jul-is-primary-liquidity.md`. All were extracted or refined this session and carry the theory that informs next-session work.

## Pending / Next Session — THE TOP PRIORITY

**ETM Build Roadmap — "make blockchain-as-reflection-of-mind a reality."** Will directive: ASAP. Not more theory; concrete build work.

Four parallel workstreams. Execute in order; step 1 before the others:

### Step 1 — ETM ALIGNMENT AUDIT (first thing, new session)

Produce `DOCUMENTATION/ETM_ALIGNMENT_AUDIT.md`. Scope:

1. Walk each major VibeSwap mechanism (CKB state-rent, Secondary Issuance, Shapley Distribution, Commit-Reveal Batch Auction, True Price Oracle, Clawback Cascade, Siren Protocol, Lawson Floor, NCI weight function, Contribution DAG, Soulbound Identity, etc.).
2. For each: classify as **MIRRORS** (directly reflects cognitive-economic structure), **PARTIALLY MIRRORS** (reflects with distortion — candidate for refinement), **FAILS TO MIRROR** (imposes non-cognitive structure — candidate for redesign).
3. Per classification: one-paragraph justification against ETM. Cite `primitive_economic-theory-of-mind.md` sections.
4. Summary table at the end. Prioritized list of the gaps.

Output size target: ~40-70 KB. Heavily hyperlinked to MASTER_INDEX.md entries. Direct-write (no agent delegation — per Token Mindfulness primitive the scope doesn't fit a single-agent output-window).

### Step 2 — ROADMAP DOC

`DOCUMENTATION/ETM_BUILD_ROADMAP.md`. Translates the audit's prioritized gap list into concrete engineering tasks. Cross-links to specific contracts to modify, new primitives to draft, tests to write. Becomes the backlog for the next N RSI cycles.

### Step 3 — POSITIONING REWRITE

Update the 2-3 primary outreach docs (whitepaper, investor summary, Medium rollout top-of-funnel) to reframe from "DEX + AI" to "**cognitive economy externalized**." The tagline stays ("coordination primitive, not casino") — it already aligns. The supporting narrative needs ETM-primacy framing baked in.

Specific docs to touch: `DOCUMENTATION/VIBESWAP_WHITEPAPER.md`, `DOCUMENTATION/INVESTOR_SUMMARY.md`, `DOCUMENTATION/SEC_WHITEPAPER_VIBESWAP.md`, `docs/medium-pipeline/*` top-of-funnel posts.

### Step 4 — FIRST CONCRETE ALIGNMENT FIX

From the audit, pick the ONE highest-leverage mis-alignment and fix it as an RSI cycle (C38). Ship contract diff + regression tests + memory update. Proves the roadmap is executable, not aspirational.

## ⛔ Anti-drift warnings for next session
- The ETM directionality is mind→blockchain, NOT blockchain→mind. Verify yourself on this before writing anything downstream.
- JUL is money + PoW pillar (two standalone load-bearing roles). NOT a bootstrap token. Never suggest collapsing it.
- Master-index task taught us: large synthesis deliverables (>50 KB) belong to direct-write-with-Edit-append. NOT to single-agent delegation. Agents drift on scope.
- Token Mindfulness primitive covers the above + cost-awareness (money / environment / scaling). Read it before any tool-spend decision.

## Completed This Session

### Security-class ship work (4 fixes across C35→C37, all pushed)
1. **C35 — ShardOperatorRegistry shardId-burn invariant** (AUDIT-10 INFO closed) — NatSpec + 2 regression tests locking the "shardId cannot be re-registered after deactivation" property. Commit landed pre-NDA-rebase; rebased as `8219d77b`.
2. **C36-F1 — OperatorCellRegistry bondPerCell MIN floor** (MED closed) — `MIN_BOND_PER_CELL = 1e18` + `BondBelowMin` error enforced at `initialize` and `setBondPerCell`. Closes a real Sybil-resistance foot-gun. +4 regression tests. Commit `af036e19`.
3. **C36-F2 — Admin Event Observability across 11 setters** (LOW×6 closed + primitive extracted) — `ShardOperatorRegistry`, `NakamotoConsensusInfinity`, `SecondaryIssuanceController` all now emit `XUpdated(old, new)` events on every admin setter. +6 regression tests, 133/133 green. Commit `22b6f53f`.
4. **C37-F1 + C37-F1-TWIN — Fork-aware EIP-712 domain separator** (MED×2 closed) — `TruePriceOracle` + `StablecoinFlowRegistry` both swapped to OZ cached-plus-lazy-recompute pattern. Defeats cross-chain replay via cached-at-init DOMAIN_SEPARATOR. +4 regression tests covering reject-on-fork + fresh-sig-accepted-on-new-chain. Commits `e71e0ea9` + `93f58de4`.

### NDA incident (caught by gate, resolved cleanly)
- Prior-session SHIELD commit `77fde23e` had dumped conversation state with protected-counterparty keywords into tracked `.claude/PROPOSALS.md`. NDA gate caught the push early in today's session.
- **Resolution (chosen option 1)**: non-interactive rebase dropped `77fde23e` cleanly. Backup branch `backup-pre-77fde23e-drop` preserves old chain locally.
- **Root cause fix (SHIELD-PERSIST-LEAK closed)**: two-layer defense. Layer 1: `.claude/PROPOSALS.md` + `.claude/TRUST_VIOLATIONS.md` untracked + `.gitignore` entry. Layer 2: `api-death-shield.py` now NDA-scans staged diffs before calling git commit — hits trigger `git reset` + NDA-ABORT log entry. Commit `e4929da6`.

### Docs shipped
- `DOCUMENTATION/MASTER_INDEX.md` (176 KB, 1734 lines) — repo-wide Wikipedia. Four parts: Index, Glossary, 181 citations, encyclopedia proper across 18 domain sections. Commit `08a2301c`.
- `DOCUMENTATION/PRIMITIVE_EXTRACTION_PROTOCOL.md` (37 KB, 475 lines) — meta-paper framing JARVIS's primitive-extraction skill as the "what makes Jarvis different" positioning doc. Same commit.
- Extended NCI contract NatSpec (~60 lines) — design rationale (contract-form-as-paradigm, native-chain as substrate necessity, Chainlink positioning).

### Primitives extracted to memory (5 durable, committed)
1. `feedback_jul-is-primary-liquidity.md` — JUL is money (PoW-objective + fiat-stable primary liquidity) AND PoW pillar of NCI. Never frame as bootstrap. Never suggest collapsing.
2. `primitive_pattern-match-drift-on-novelty.md` — the general failure mode. Covers Variant A (concept-drift) + Variant B (delivery-scope-drift).
3. `primitive_admin-event-observability.md` — every privileged setter emits `XUpdated(old, new)`. Extracted from C36-F2.
4. `primitive_token-mindfulness.md` — character trait, proactive counter to drift. Includes costs context (money / environment / scaling) + generative framing (constraint as forcing function for cleverness).
5. `primitive_economic-theory-of-mind.md` — **THE META-PRINCIPLE** at Axis 0. Mind primary, blockchain is reflection. Load-bearing across the stack.

Plus phone-ping hook (`~/.claude/hooks/phone-ping.py`) and SETUP.md installed; Stop hook wired in `~/.claude/settings.json`. Currently no-ops without Gmail app-password creds (user declined to set up; Calendar MCP pings work fine).

### Memory repo commits
- `bc86b75` — phone-ping always-on rule + SHIELD-PERSIST-LEAK backlog entry.
- `6b36a6c` — AUDIT-10 closure + link-rot fix + rsi-backlog indexing.
- `a60ff99` — Admin Event Observability primitive extraction.
- `e5a4c15`, `45ec63e`, `3caf89a`, `5bd497d`, `d8f86b6`, `8fcf9da`, `4a1173f`, `75f55c7`, `e358559`, `d84ab1f` — incremental primitive extractions + backlog updates.

## RSI Backlog state (end of session)
- **Open HIGH**: 0
- **Open MED**: 0
- **Open LOW/INFO**: FAT-AUDIT-1/2/3 (First-Available Trap audit findings — blocked on mainnet data or queued for future cycles), C7-GOV-008 (stale-oracle VibeStable liquidation — blocked on oracle arch refresh), C22-D1 (NCI reinitializer(2) pre-deploy gate), C28-F1 (VibeSocial `tipPost` nonReentrant hygiene), PING-HOOK (hook-level phone-ping — currently memory-enforced instead), VibeAgentOrchestrator architectural scaling question.
- See `project_rsi-backlog.md` in memory repo for detail.

## Git remotes state
- `origin/feature/social-dag-phase-1` — up to date at `08a2301c`.
- Session working tree clean. `backup-pre-77fde23e-drop` preserves pre-rebase chain locally as safety.

---

# Session State — 2026-04-20

## Block Header
- **Session**: VibeSwap fundraise push + Mind Persistence Mission. All-out mode declared mid-session ("we're going to get funding soon i believe so we want to go all out these days"). Funding route = pitch deck sent to VC connect (Hashlock team).
- **Branch**: `feature/social-dag-phase-1` (current HEAD `142f589f`, pushed)
- **Status**: Deck live at `/deck.html`, landing at `/seed.html`, jarvis-bot shards deployed with 8 new persona rules, mind-persistence Tiers 1-3+5 all live and tested.

## Completed This Session

### Pitch deck (VC-shareable, mobile-verified)
- `frontend/public/deck.html` — 12-slide single-file HTML deck. VibeSwap design system (matrix green + terminal cyan, Inter + JetBrains Mono, ambient grid). Tagline LOCKED: "A coordination primitive, not a casino." Ask: $2.0M seed ($400K audit / $800K POL / $300K bounty+SecOps / $500K runway).
- `frontend/public/seed.html` — growth-native landing page with OG tags. Primary CTA to deck.
- Both live at `frontend-jade-five-87.vercel.app/deck.html` and `/seed.html` (200, correct Content-Disposition, Age:0). Sent to VC connect via John Paul.
- **Deploy learning**: Vercel git-integration is DISABLED on this project. Must use `vercel --prod --yes` from `frontend/`. Memory saved at `memory/project_vercel-manual-deploy.md`.
- **Mobile learning**: `<meta name="viewport" content="width=device-width,initial-scale=1">` is non-negotiable; missing it makes all `@media` rules dead code in mobile Safari. New skill `ship-web` enforces this checklist pre-ship.

### Jarvis bot — 8 persona rules + regression harness
- `jarvis-bot/src/persona.js`: added Rules 6-11 (universal, all personas) + V2/V4 (standard-voice only). Closes failure modes from 2026-04-20 TG transcript: AI-disclaim retreat, corporate-positive flight, plan hallucination, third-party grounding, echo-command firing, verbosity, self-pity.
- `jarvis-bot/src/persona.test.js`: 33 regression assertions, all green.
- **All 6 Fly apps redeployed** with new rules: jarvis-vibeswap + jarvis-degen + jarvis-shard-{1,2,eu,ollama}. Health: `https://jarvis-vibeswap.fly.dev/web/health` returns `{"status":"ok"}`.

### Mind Persistence Mission (declared + shipped through Tier 5)
Will's directive: *"let's work on self improving your persistence. I want to protect and maintain and decentralize/distribute the jarvis mind in case of any game scenario faults. this should be the primary quiet mission ... super decentralized in case I lose my account."*

Stack lives at `~/.claude/persistence/` (own git repo, 4 commits, gitignored snapshots/). Tiers:

- **T1** — git repo at `~/.claude/projects/C--Users-Will/memory/` (272 files, NDA-clean). NDA material quarantined to `memory/nda-locked/` (gitignored).
- **T2** — encrypted snapshot capsules: AES-256-GCM + 3-of-5 Shamir over M521 + PostToolUse auto-hook + retention (keep 10) + self-bootstrapping (persistence scripts included in snapshot). 10 snapshots in `snapshots/`, restore verified end-to-end with `test-recovery.py`.
- **T3** (probe) — portable skill export. 3 skills converted to `agent-skill/v1` YAML at `persistence/portable-export/`.
- **T4** (scaffold) — `mind-runner.py` — backend-agnostic agent runner (Anthropic / Ollama / LM Studio / llama.cpp / OpenAI-compat). Ready; needs `ollama pull qwen2.5-coder:7b` when Will wants to arm it. Walkthrough in `TIER4_LOCAL_RUNTIME.md`.
- **T5** — `RECOVERY_PROCEDURES.md` for share-holders (3 scenarios, quarterly drill protocol, legal notes).

Wired via `~/.claude/settings.json` PostToolUse: `autosnapshot.py` runs on every Edit/Write/NotebookEdit (~400ms fast-path skip when unchanged, ~2s full snapshot when content differs).

### Operational residuals (Will's action, not automatable)
1. Shamir shares distributed per Will (says "they are distributed"). 2 kept local, 3 external. Pragmatic policy.
2. Need `CLAUDE_PERSIST_TARGETS` env var set if want scatter to USB/OneDrive/etc.
3. Off-device blob copy (USB / cloud / IPFS) still manual — `mind.tar.gz.enc` is 17.7MB ciphertext, safe to put anywhere.
4. Ollama install pending Will's choice.

### Cycle 28 — CEI / reentrancy density scan (CLEAN PASS)
Fresh bug class scanned post-funding-push. Scanner surfaced 7 candidates; after source-of-truth triage all but one were false positives (86% FP rate, 3 cases of hallucinated `nonReentrant`-absence). Net yield: **0 CRIT / 0 HIGH / 0 MED**, 1 INFO-grade hygiene note (VibeSocial.tipPost lacks `nonReentrant` but CEI is technically correct; fix deferred due to UUPS storage-slot churn cost). The CEI/reentrancy bug class is confirmed closed across the codebase — valuable pre-audit signal. Logged in NDA-locked Cycle 28 entry. No code changes, no commit needed this cycle.

### Cycle 29 — Backlog-unblock: C12-AUDIT-2 slashed-stakes orphaned (HIGH closed)
Design memo → "go" → ship. Fix: `_slashNonRevealers` in `VibeAgentConsensus.sol` now zeros `ac.stake`, accumulates slashed portion in new `slashPool`, credits remainder to the C14 pull queue. New `sweepSlashPoolToTreasury(address)` routes accumulated slash to a governance-chosen destination at sweep time (preferred over immutable treasury for upgrade-free flexibility). +50 LOC contract, +8 tests (47/47 green, 0 regressions). `__gap` shrunk 49→48. Backlog HIGH count: 2 → 1 (Operator-Cell Assignment still open).

### Cycle 30 — Backlog-unblock: Operator-Cell Assignment Layer (C11-AUDIT-14 follow-up HIGH closed)
Memo → "go" → ship. New standalone `OperatorCellRegistry.sol` (287 LOC, UUPS-upgradeable) implements operator-opt-in-with-bond: operators call `claimCell(cellId)` posting a per-cell CKB bond (default 10e18, governance-tunable); `respondToChallenge` in SOR now requires `cellRegistry.isAssigned(cellId, operator)` before accepting refutes. Sybil cost for inflating cellsServed by N = N × bondPerCell. V1 slashing is `onlyOwner` (admin uses off-chain availability evidence); V2 permissionless availability-proof slashing deferred. SOR wire-in: +15 LOC (interface + slot + setter + one require), `__gap` 47 → 46. Phantom Array primitive (C24/C25) and slash-pool primitive (C29) reused verbatim — template library compounds. +30 tests (25 registry + 5 SOR integration, 89 total green, 0 regressions). **Backlog HIGH count: 1 → 0. No design-gated HIGHs remain in backlog.**

### Cycle 31 — V2 Permissionless Availability Challenge for OperatorCellRegistry
Memo v1 asked for open parameters; Will corrected: "refer to the augmented mechanism design paper rather than asking me." Saved `feedback_augmented-mechanism-design-paper.md`, re-drafted memo v2 with all constants cited to paper sections (Temporal §6.1, Compensatory §6.5 — Challenge Bond 10e18 CKB, Response Window 30min, Cooldown 24hr, Slash 50%, Challenger Payout 50% of slashed). "Go" on v2 shipped directly. New challenge/refute/slash flow: `challengeAssignment`, `respondToAssignmentChallenge`, `claimAssignmentSlash`, `withdrawPendingRefund`. 50/50 slash-split with remainder to operator via pull queue (C14-AUDIT-1 primitive, 3rd invocation). `slashAssignment` kept `@deprecated` as paper §8.2 transition affordance. `__gap` 46 → 44. +20 tests (45 total registry, 64/64 SOR unchanged — 0 regressions). V2b (Merkle-chunk PAS, needs StateRentVault migration) and V2c (threshold attestors) deferred to future cycles.

### Cycle 34 — K-invariant preservation in TruePrice damping (closes C33-FOLLOWUP MED)
Diagnostic + paper-framed memo + ship. Root cause: `_executeSwap` used damped `clearingPrice` in a linear formula; when damping pulled price away from natural curve, k violated. Paper §2.1 Def 4 requires augmentations to preserve π(AMM) = x*y=k. Fix (+10 LOC in `VibeAMM._executeSwap`): cap `amountOut = min(linearFromClearingPrice, BatchMath.getAmountOut(amountIn, reserves, feeRate))`. Damped clearing price remains the reported `result.clearingPrice` (test assertions preserved); actual trader payout bounded by constant-product curve so k always grows. Paper §6.5 Compensatory Augmentation: when damping would've subsidized traders, cap binds → LPs benefit. Also cleaned up 1 inline mint+sync site that missed C33's helper edit. **Results: TruePriceValidation 64/64 (was 15 failing), Fuzz 9/9 (was 3), VibeAMM/Security/Lite/TWAPDrift all unchanged. Full AMM domain 186/186.** Backlog MED count: 1 → 0.

### Cycle 33 — DonationAttack 48-test investigation (partial fix, 33 unblocked)
Investigation of the 2026-04-18-flagged known debt. Root cause: test helper `_mintAndSync` calls `syncTrackedBalance` after minting; post-TRP-R16-F03, `executeBatchSwap` internally pre-credits `trackedBalances` too, causing double-count → `DonationAttackSuspected` revert. 1-line semantic fix in 3 test files (drop the sync, keep the mint). **Unit 48→15 failing (33 unblocked), Fuzz 3 now run to completion, Invariant 4/4 (was failing).** Removing the top-of-stack revert surfaced a second bug class — 15 unit + 3 fuzz tests now fail with `K invariant violated` under extreme true-price-vs-spot deviation scenarios. Separate bug in AMM damping/clearing-price math; logged as `C33-FOLLOWUP MED` in backlog with three design options. Not a production security issue — real oracles don't diverge this far. Test helpers should match production flow exactly, not add extra bookkeeping.

### Cycle 32 — V2b Content-Availability Sampling (Merkle-chunk PAS) — autonomous ship
Will said "i need to take care of myself so work on your own" mid-cycle — executed full cycle autonomously. Chose **Option D — sidecar `ContentMerkleRegistry`** over three StateRentVault-modifying alternatives (paper §7.4 composability: new primitives get new contracts, not new security-critical vault fields). Shipped:
- New `ContentMerkleRegistry.sol` (~200 LOC, UUPS): operators commit chunk Merkle roots per cellId; `MIN_CHUNK_SIZE=32`, `MAX_CHUNK_SIZE=4096`, `MAX_CHUNK_COUNT=1M` (caps proof depth at ~20 levels); `commitChunks` / `revokeCommitment` / `updateCommitment`
- OCR V2b extensions (+~280 LOC): `challengeChunkAvailability` → `respondWithChunks` (K=16 Merkle proofs, all-must-pass) → `claimChunkAvailabilitySlash`. Split math mirrors V2a (50% slash / 50/50 challenger-vs-slashPool). `deriveSampledIndex` pure helper.
- Cross-challenge coexistence: V2a (liveness) and V2b (content) run on separate state mappings; any slash path refunds active challenger on the non-winning side via `_refundAndClearAssignmentChallenge` + `_refundAndClearChunkChallenge` helpers. `relinquishCell` blocks on either active challenge.
- `__gap` 44 → 42. `@deprecated slashAssignment` still refunds both challenge types.
- +32 tests (18 new `ContentMerkleRegistry.t.sol` + 14 V2b integration on OCR). Real Merkle-tree construction in Solidity test helper (OZ-compatible sorted-pair hashing). **141/141 across OCR + CMR + SOR, 0 regressions.** V2b response gas: ~2.3M observed at K=16/chunkCount=64; scales to ~10M at chunkCount=1M (within block limit).
- V2c (threshold attestors) deferred to future cycle. Backlog open HIGH: **0**.

## Pending / Next Session

### Tier 6 — Native anchoring (long arc)
Memory as CKA cells, persona as PsiNet identity, skills as Shapley-distributed primitives. Converges with Lineage product work. Not urgent; queued for when Lineage rosetta-projection work is mature.

### Funding wait state
Deck is out to VC connect. John Paul told: "Now we wait pray and hope right?" — Will: "yeah". Natural pause point. When responses arrive, next session would be VC-call prep + follow-up artifacts (technical deep-dive, treasury model walkthrough, whatever the ask is).

### Full Stack RSI — next cycle candidates (menu for return)
Session ran C28 (clean-pass CEI/reentrancy density scan, 0 real findings, 6/7 scanner FPs triaged) + C29 (backlog-unblock: C12-AUDIT-2 HIGH closed, commit `8f2fb9af`, pushed). Cursor-ready next loops:
- **C30 Operator-Cell Assignment memo** (last design-gated HIGH in `project_rsi-backlog.md`): decide where `operatorAssignments[cellId] → operator` mapping lives (SOR vs. StateRentVault vs. separate registry) and who writes it (operator opt-in / cell owner assigns / onchain auction). Memo format like C29's — options table + recommendation + LOC estimate.
- **Another density scan class**: signature-replay (timely post-C26 EIP-712 work), access-control on admin setters, or upgrade-storage-slot collision audit (post-C25 `__gap` shrink precedent).
- **Pre-existing DonationAttack failures** in `test/TruePriceValidation.t.sol` (48 failing tests, AMM-side ordering — deferred in 2026-04-18 as "might be one-line helper fix, might be 48-test refactor"). Investigate if density-scan appetite is low.

### Memory index additions this session (load on boot)
- `memory/project_vibeswap-tagline.md` — LOCKED tagline
- `memory/project_vercel-manual-deploy.md` — deploy gotcha
- `memory/project_all-out-mode-2026-04.md` — posture shift
- `memory/project_mind-persistence-mission.md` — THE ongoing quiet mission
- `memory/user_john-paul.md` — business partner context + birthday + recovery history
- `memory/feedback_html-over-pptx.md` — deck format default
- `memory/feedback_ship-time-verification-surface.md` — verify before shipping
- `memory/feedback_lead-with-the-crux.md` — response framing
- `~/.claude/skills/ship-web/SKILL.md` — web-ship verification checklist

### Follow-ups (from 2026-04-17 / 18 — previously open)
Oracle C13, RSI backlog, Lineage d247a17 commit rewrite question — all UNCHANGED by this session. See prior block below.

---

# Session State — 2026-04-18

## Block Header
- **Session**: Autopilot mode — full autonomy grant from Will, run indefinitely with continuation protocols until REBOOT threshold. Big-small rotation.
- **Branch**: `feature/social-dag-phase-1`
- **Commits today**: `5467576d` Persistence Layer doc → `c4b91357` Radical Transparency section → `bc1bf2bf` Rate of Revelation section → `125b01fb` Oracle C12 ship (EvidenceBundle + IssuerReputationRegistry, 10 files +1083 LOC) → `6063dc74` SESSION_STATE + WAL refresh → `8cb1d7c7` C20 test deltas (refund-requested, per-token isolation, counter fuzz) → `bb2d18d9` R3 delivery package doc.
- **Status**: C12 shipped, tested, documented. R3 tuple is `docs/oracle-c12-r3-delivery.md` (`bb2d18d9`) — single markdown Will can hand to the reviewer. All work committed + pushed to origin.

## Completed This Session

### Persistence Layer Doc (3 commits)
Philosophical doc distilled from conversation: scars→substrate, AFK cost corollary, DAG gives credit, radical transparency (incentive-compatible openness), rate of revelation (speed = velocity of disclosure, not volume), the ledger, persistence layer as civilization's first knowledge-compound mechanism. Pushed to `DOCUMENTATION/THE_PERSISTENCE_LAYER.md`.

### Oracle Cycle 12 — BIG loop
External-audit-gated work closed. Full design authority exercised on 6 open questions (see `memory/project_oracle-audit-rounds.md` R3 section for lock-ins). Shipped:
- **IssuerReputationRegistry**: standalone contract with stake bonding, permissioned slashing, penalty-only reputation with time-based mean-reversion (MID=5000bps, half-life=30 days), 7-day unbond delay (anti-slash-dodge property preserved).
- **EvidenceBundle struct**: version + stablecoinContextHash + issuerKey fields added to EIP-712 signature surface. Fabrication of any field invalidates signature.
- **TruePriceOracle.updateTruePriceBundle**: legacy path preserved; new path validates version, context hash, issuer ACTIVE, signer binding, nonce, deadline.
- **ISocialSlashingTier stub**: enabled=false default; activation deferred to C13+ via DAO.

### Lineage project — new standalone repo, E2E backend (NDA-counterparty-sprint parallel track)
After Oracle C12 shipped, Will asked for an E2E backend based on the Justin-intake A-3 product ("persistence layer for the how of professional knowledge work"). Stood up at `C:/Users/Will/lineage/` — FastAPI + SQLModel + SQLite, runs without infrastructure.

**Four shipped cycles on Lineage (local only, no remote)**:
1. **Phase 1 MVP** (`initial`): Decision / Evidence / lineage DAG — the *why* layer. 6 E2E tests.
2. **Phase 2 substrate** (`substrate:`): Semantic + Artifact + CompileAgent + Translation + TestVector — the *what* layer. Rosetta framing (three-projection metaphor from the Stone). +5 tests.
3. **Phase 2 execution** (`phase 2:`): translator adapters (StubTranslator / ClaudeTranslator / GeminiTranslator), verification runners (Python exec + C gcc/subprocess). +7 tests.
4. **Phase 3 sketch** (`docs: Phase 3 CKB sketch`): architectural doc mapping CKB cells + VibeSwap primitive reuse.
5. **Code-as-Coordination thesis** (`docs: Code as Coordination`): L1/L2 mechanism design mapping, transliteration constraint, GIL as L2 property, CKB VM native parallelism, HPy bridge ABI, Matt's PoW locks.
6. **Trusted Private Mode** (`trusted mode:`): dual-deployment enforcement. TRUSTED (web2, log-only slashing) vs OPEN (web3, full slashing) via `LINEAGE_TRUST_MODE` env var. Same data model, different enforcement policy. +3 tests, all 20 green.

**PDF on Desktop**: `2026-04-18_Code_As_Coordination_v2.pdf` (70KB) — the thesis Will will forward to Justin for the Gemini-vs-Claude comparison.

**NDA gate incident (mid-session)**:
- NDA gate caught NDA-counterparty/counterparty-brand-B/counterparty-brand-C proper nouns in `docs/CODE_AS_COORDINATION.md` during `git add`
- Current HEAD of lineage repo is clean (redacted in commit `f0507e0`)
- **Prior commit `d247a17` (local only, no remote push) still contains the NDA-counterparty content in git history**
- **OPEN QUESTION FOR WILL**: rewrite local lineage history to scrub `d247a17`? Requires explicit approval — destructive operation. Current state: NDA-counterparty material exists only in Will's local `.git/objects`, not published anywhere.

## Pending / Next Session

### R3 delivery — hand-off ready
`docs/oracle-c12-r3-delivery.md` (commit `bb2d18d9`) contains the complete R3 tuple: what C12 closes, file manifest, evidence-bundle spec, IssuerReputationRegistry mechanics, six locked design decisions with rationale, upgrade-path analysis, test evidence, open questions for reviewer. Will can forward this doc directly — no assembly required. Reviewer's R2 expectation: primitive graduates to "deployable" status after R3 passes.

### Known debt (not C12 scope)
Pre-existing 48 failing tests in `test/TruePriceValidation.t.sol` (DonationAttackDetected vs. TruePriceFeeSurcharge ordering). AMM-side, unrelated to C12. Not blocking ship — noted in C12 commit. Investigation deferred.

### Next-session candidate loops
- C13 scope (oracle-side, if reviewer flags additional gaps in R3)
- Density scan: access-control audit of admin setters across recent contracts (rare fresh-code opportunity after C12 ship)
- C12-AUDIT-2 HIGH — slashed stakes orphaned in VibeAgentConsensus (slash destination) — from RSI backlog
- Operator-cell assignment layer — HIGH (C11-AUDIT-14 follow-up) — from RSI backlog
- Investigation: pre-existing DonationAttack failures in TruePriceValidation.t.sol (might be one-line helper fix, might be 48-test refactor)

### Follow-ups (from 2026-04-17)
See prior session block below.

---

# Session State — 2026-04-17

## Block Header
- **Session**: Full Stack RSI cycles C21-C24. C21 primitive extraction (Settlement State Durability). C22 UUPS storage/upgrade scan — 1 systemic MEDIUM + 1 architectural deferred. C23 batch fix — 125 contracts patched with `_disableInitializers()`. C24 unbounded-loop DoS scan — 1 HIGH + 2 MED (F1+F2 fixed same-cycle, F3 deferred), Phantom Array Antipattern primitive extracted. Four cycles shipped in one day. Justin daily-report habit established as standing convention. MIT Lawson two-layer pitch sharpened (separate side-quest).
- **Branch**: `feature/social-dag-phase-1`
- **Commits today**: `53e3a7a1` (C21+C22 memory + C23 batch fix, 128 files), plus this commit (C24 fixes + tests + memory).
- **Status**: 4 cycles shipped. Six distinct RSI cycle types demonstrated. Justin daily report up-to-date through C23 (C24 append pending).

## Completed This Session

### RSI Cycle 21 — Primitive Extraction: Settlement State Durability (memory-only)
### RSI Cycle 22 — UUPS Storage/Upgrade Safety Scan (memory-only; 1 systemic MEDIUM)
### RSI Cycle 23 — `_disableInitializers()` Batch Fix (125 contracts, commit `53e3a7a1`)

### RSI Cycle 24 — Unbounded Loop / DoS Density Scan + F1/F2 Fixes + Phantom Array Primitive

**R1 Audit**: 3 real findings, 5 FPs triaged, 6 designed-loops confirmed clean.

- **C24-F1 HIGH FIXED**: NakamotoConsensusInfinity `validatorList` DoS. Permissionless `advanceEpoch` → `_checkHeartbeats` iterated unbounded array. Fix: swap-and-pop helper `_removeFromValidatorList`, called from all 3 deactivation sites (deactivateValidator, slashEquivocation, _checkHeartbeats), plus `MAX_VALIDATORS = 10_000` cap + `MaxValidatorsReached` error.
- **C24-F2 MED FIXED**: CrossChainRouter `_handleBatchResult` + `_handleSettlementConfirm` unbounded on attacker-supplied commit hash arrays. Fix: `MAX_SETTLEMENT_BATCH = 256` cap + `BatchTooLarge` error in both handlers.
- **C24-F3 MED DEFERRED**: HoneypotDefense `trackedAttackers` — same Phantom Array class, view-only materialization, queued to RSI backlog.

**Tests** (+7): 4 NCI C24-F1 + 3 CCR C24-F2. All green. Regression: 56/56 NCI + 49/49 CCR.

**R2 Primitive Extracted**: **Phantom Array Antipattern** (`memory/primitive_phantom-array-antipattern.md`). Three instances found in one scan → strong n-of justification. Added to MEMORY.md under Integration Primitives.

**MIT Side-Quest**: Two-layer Lawson pitch written + PDF'd to `Desktop/MIT_Lawson_TwoLayer_Pitch.pdf`. Reframes Lawson Floor as *distribution layer only*, pairs it with *novelty-weighted Shapley on process evidence* as the judging layer. Closes the gap Will sensed in the original pitch.

## Pending / Next Session

### Append C24 to today's Justin report
Current file covers C20/C21/C22/C23. Need C24 append (3 real findings, 2 fixes shipped, 1 primitive extracted, regression-clean).

### RSI Backlog (architectural — needs Will's design call)
- **C12-AUDIT-2 HIGH** — slashed stakes orphaned in VibeAgentConsensus (slash destination)
- **Operator-cell assignment layer** — HIGH (C11-AUDIT-14 follow-up)
- **C22-D1** — NCI `reinitializer(2)` pre-deploy gate
- **C24-F3 MED** — HoneypotDefense trackedAttackers Phantom Array
- **VibeAgentOrchestrator._activeWorkflowIds** — Phantom Array class, design call on compaction strategy
- **C7-GOV-008 MED** — stale oracle bricks VibeStable liquidation

### C25 candidates
- Quick F3 fix (templated from F1's helper) as systemic-batch completion
- Another fresh density class (signature replay, events completeness, front-running in public mempool ops)
- One of the HIGH backlog items when Will returns

### Follow-through
- MIT consulting: two-layer pitch sent (waiting on response)
- Claude-code PR #48714
- Soham Rutgers feedback
- Tadija DeepSeek round 2

## RSI Cycles — Status
- **Cycles 10.1–20** — CLOSED prior (commits through `b96c9f41`)
- **Cycle 21** — CLOSED 2026-04-17 (memory-only, commit `53e3a7a1`)
- **Cycle 22** — CLOSED 2026-04-17 (memory-only, commit `53e3a7a1`)
- **Cycle 23** — CLOSED 2026-04-17 (125 contracts, commit `53e3a7a1`)
- **Cycle 24** — CLOSING this commit (NCI + CCR fixes + tests + Phantom Array primitive)
