# Session State — 2026-05-06 (rolled over from 2026-05-03)

## ⚡ Active Intention

> **Intention**: Bidirectional reification at scale — reify GH discussion #18 (on-chain reasoning verification) into spec + interfaces + reference impls + tests + EIP draft + architecture overview, then sustain a 300-commit autonomous run across reification, primitives, gates, and bootstrap-loop backlog items.

The dialogue with `kimberthilson-wq` on GH#18 produced concrete architecture. Per `[F·bidirectional-reification]` (named + saved this session), word and code are orthogonal modes of creation; neither is complete alone. The active intention bootstraps the reification primitive on its own origin turn.

## ⚠ NEXT SESSION — TOP PRIORITY

### Discussion #18 follow-up (GH/VibeSwap)
- Threaded reply to `kimberthilson-wq`'s second comment posted with collaboration close + email (willglynn123@gmail.com)
- Wait for reply / inbound email; if Kim engages, distributed-reasoner-markets and cross-domain witness sharing are the open questions to push on
- Account-vetting flag still standing on `kimberthilson-wq` handle (-wq suffix pattern); engagement substance is on-topic so this isn't a block, just a note

### Reasoning verification subsystem next moves
- **Halmos attestation registry** — concrete contract for "this bytecode hash was formally verified" attestations, invalidated on upgrade. Tier-5 of the architecture, not yet shipped.
- **Distributed reasoner market mechanism design** — Shapley + reasoning verification composition. Belongs in `docs/research/papers/` once primitives are clearer.
- **Cross-domain witness sharing semantics** — namespace + aliasing rules for var-keys spanning protocols. EIP-A v2 candidate.
- **Halmos run-on-CI** — actually wire the attestation pipeline so "formally verified" is automatic rather than an admin call.

### Bootstrap loop backlog status (`[P·augmented-dev-loops]`)
- B1 — Changeset-hash pre-commit gate — **PENDING** (design done conceptually, no implementation)
- B2 — Intention declaration template — **DONE** (this block opens with it)
- B3 — Agent reputation tracker JSON — **DONE** (`.claude/agent-reputation.json`)
- B4 — Pre-review automated check pipeline — **PENDING** (forge --match-path + storage-layout-diff + slither wrapper)
- B5 — Lessons.md schema + entries — **DONE** (3 entries added today: idle-after-reply, reification bootstrap, GH thread-shape)
- B6 — Cycle-close retrospective protocol — **PENDING**

### USD8 partnership (carried over)
- Two messages sent to Rick (attack-surface stack + white-hat Lindy bounty); awaiting response
- ATTACK_SURFACE_DEFENSES.md / WHITE_HAT_BOUNTY.md spec PRs in flight, ready when Rick greenlights direction

### Pending design calls (carried over, mostly stale-but-still-open)
- Substance gate watch-list: add `governance` signature when used in actor-context without bounded-by-physics-constitution disambiguator
- Pass 9 of audit-suite: handshake validator integration into Lineage IDE-plugin audit-suite
- Condensation hook (automated): manual proof-of-concept ran cleanly 2026-05-01; build the Stop hook + condensation script
- MEMORY.md compression pass: previously flagged as exceeding soft limit; HIERO compression now active so check current size before re-flagging

### Open items
- Lineage repo remote — still no decision on private GitHub vs local-only
- Lineage uncommitted work — `SUBSTRATE.md`, `commitment.py`, `COMMITMENT_PROTOCOL.md`, `POSITIONING.md`, `TENANCY_DESIGN.md`, `scripts/` — earlier-session work, decision pending

---

## Block Header — 2026-05-06 — GH#18 reification + 300-commit run

### Entry trigger

Will: "respond: https://github.com/WGlynn/VibeSwap/discussions/18" — opened on inbound discussion-thread engagement, pivoted into bidirectional reification primitive + sustained autonomous build burst.

### What shipped this block

**Reasoning verification subsystem (forward reification — word → code)**:
- `docs/research/papers/on-chain-reasoning-verification.md` — three-tier architecture spec
- `docs/research/papers/eip-draft-reasoning-grammar.md` — 4-EIP standardization draft (atom grammar, witness format, inference rules, ZK public inputs)
- `contracts/governance/interfaces/IReasoningVerifier.sol` — Tier 2 verifier interface
- `contracts/governance/interfaces/IReasoningContest.sol` — Tier 3 bonded fraud-proof interface
- `contracts/governance/interfaces/IReasoningGateProof.sol` — Tier 4 ZK gate-pass interface
- `contracts/governance/ReasoningVerifier.sol` — Tier 2 reference impl (stateless)
- `contracts/governance/ReasoningContest.sol` — Tier 3 reference impl (UUPS)
- `contracts/governance/StateOracle.sol` — keyed resolver registry impl
- `test/ReasoningVerifier.t.sol` — 13 tests, exit 0
- `test/ReasoningContest.t.sol` — 8 tests, exit 0
- `test/StateOracle.t.sol` — 10 tests, exit 0
- `docs/architecture/REASONING_VERIFICATION_OVERVIEW.md` — backward reification (code → text)

**Memory primitives**:
- `feedback_text-code-eternal-loop.md` — `[F·bidirectional-reification]` named + saved + bootstrapped
- `feedback_diagnose-on-stop.md` — Stop-event interrogation hook-candidate
- 3 prior-session orphans rescued: autonomous-production-default, no-credentials-in-claude-chat, jarvis-tg-bot-token-compromise

**Augmented-loops infrastructure**:
- `.claude/agent-reputation.json` — B3 closed
- `.claude/lessons.md` — 3 new rows for B5 (was already initialized)
- MEMORY.md link-rot fixed (2 broken refs)

**Public discussion**:
- Posted to GH#18 in two stages: (1) substantive reply with three-tier architecture, ZK gate-pass extension, Halmos attestation tier — threaded under Kim's first comment; (2) reply to Kim's second comment with three extensions (distributed reasoner markets, expressibility-as-gate, witness-as-on-chain-why) plus link-pointers to all shipped artifacts plus collaboration close + email

### Active autonomous run

- Target: 300 atomic commits across vibeswap, memory repo, and any related artifacts
- Status: 22+ commits shipped at time of this state-write
- Failure mode caught mid-session: idled ~1h13m after Kim reply; surfaced as `[F·diagnose-on-stop]`, hook-candidate proposed
- Constraint: per CLAUDE.md, default forge profile only, `--match-path` only on tests, max 3 forge processes

---

# Session State — 2026-05-03 (rolled over from 2026-05-01)

## ⚡ Active Intention (PRIOR BLOCK)

> **Intention**: Install augmented dev loops on the standing TRP/RSI workflow. The bootstrap loop — the framework's debut is itself the work being done.

Per `[P·augmented-dev-loops]`: ∀ TRP/RSI session ⇒ TWO orthogonal aug-layers required (intention + protection). Open-loop-without-intention is now a memory-tracked failure mode. Today's session is the first under this protocol; its intention is to install the protocol on itself.

### Bootstrap loop backlog (this session's agents serve THIS intention)

Each item below is a candidate scope for an agent in the augmented loop. Agents are spawned with intention-context: *"this cycle serves the augmented-dev-loops install by closing X."*

- **B1 — Changeset-hash pre-commit gate.** Agent declares its expected file list + invariant claims (e.g., "no .sol modified outside contracts/oracles/") in a manifest BEFORE work starts. Pre-commit hook hashes actual changeset, refuses commit if drifts from declaration. Closes silent-scope-drift failure mode.
- **B2 — Intention declaration template in SESSION_STATE.** This file gets a permanent `## ⚡ Active Intention` section template at the top of every block. Hook fail-loud if missing on session-open. Closes generic-productive failure mode.
- **B3 — Agent reputation tracker.** Per-agent-class (sonnet vs opus, scope-size, cycle-type) running tally of clean-ship vs reverted-ship vs blocked-by-gate. JSON file `vibeswap/.claude/agent-reputation.json`. Used to scope-size next cycle's agents.
- **B4 — Pre-review automated check pipeline.** Wraps the existing `forge test --match-path` + storage-layout diff + slither-on-changed-files into a single command run BEFORE human review. Block on failure. Reduces orchestrator-judgment surface.
- **B5 — Lessons.md schema + bootstrap entries.** New file `vibeswap/.claude/lessons.md` with two sections: intention-failure (tried X achieved Y) and structural-failure (broke Z). Initial entries seeded from this session's bootstrap experience.
- **B6 — Cycle-close retrospective protocol.** Spec the end-of-loop step: did agents serve declared intention? what's the delta between what we set out to do and what we did? lessons.md gets a row.

### Constraint reminders for THIS bootstrap loop

- Bootstrap is recursive. The protective gates we're building won't fire on THIS session's commits (they don't exist yet). So this session is intentionally the LAST one without those gates. Discipline-driven, not gate-enforced.
- Per `[F·apply-named-primitives-immediately]`: each B-item that ships starts firing on the next session.
- Per `[F·trp-agent-concurrency]`: max 2 concurrent opus subagents — ignore if using sonnet, which we are.
- Per `[F·no-destructive-git-while-agents-running]`: no rebase/reset while agents have writes in flight.

---

## Block Header — 2026-05-03 — Full-auto TRP loop resume

> *"work on vibeswap full auto TRP loop 3 agents + 1 every time a single agent completes, for a constant 3"* — Will, 2026-05-03

### Entry trigger

After JARVIS papers triad ship (jarvis-is-not-a-wrapper / how-jarvis-works / substrate-port to `WGlynn/JARVIS`) and the local clone rename to make sense (`~/jarvis/` → `~/jarvis-network/`, `~/jarvis-monorepo/` → `~/JARVIS/`), Will pivoted to VibeSwap with the constant-3 TRP loop pattern. Resumes the same shape used 2026-05-01 (3 + 1-on-completion replacement, per-commit review gate).

### Loop seed scopes (initial wave)

Picked from the XCM audit recommendations (`docs/audits/2026-05-01-xcm-pattern-applicability.md`) and the WAL pending Cycle 38:

- **W1 / C39-OCRA-1** — wire `OracleAggregationCRA._isAuthorizedIssuer` to `IssuerReputationRegistry` (replace V1 permissive stub at `:147–151`)
- **W2 / C15-CC-F1** — symmetric retry-queue for clawback compliance catch in `VibeSwapCore._recordCrossChainExecution` (mirror the incentiveController pattern)
- **W3 / C15-WD-F1** (Cycle 38) — block `VibeSwapCore.withdrawDeposit` while cross-chain order in-flight (counter on commit ↑ / settle ↓; closes C15-AUDIT-1 residual surface)

### Backlog ready for replacement spawns

- W4: storage-layout regression-test infra for UUPS contracts (`forge inspect ... storage-layout` snapshot)
- W5: sweep remaining empty `catch {}` sites outside cross-chain + oracle (XCM audit was scoped)
- W6: docs — codify XCM-style structural-skip rule into the standing audit checklist (XCM audit rec #3)
- W7: sweep remaining UUPS implementations for missing `_disableInitializers()` (extend the 5×C23 sweep)
- W8: phantom-array-antipattern sweep — find any remaining append-only-with-flag-deactivation patterns
- W9: VibeFeeRouter deprecation cleanup — pending Will's delete-vs-archive call (don't auto)

### Constraint reminders this loop

- Default forge profile only (no via_ir). Targeted tests only (`--match-path` / `--match-contract`). Max 3 forge processes — at cap.
- Sonnet for parallel TRP agents (sidesteps `[TRP Agent Concurrency Cap]` opus-specific limit).
- Don't touch Will's in-flight dirty work: `jarvis-bot/`, `docs/research/papers/jarvis-is-not-a-wrapper.md` (already mirrored), `.claude/post-mortems.md`, `.claude/glyph-kb-conversion-plan.md`, `docs/marketing/medium/pipeline/2026-05-XX_audit-fix-introduces-bug*`.
- Per-completion: review diff → targeted forge tests → cycle-named commit → push to `origin/master` → spawn replacement.

---

# Session State — 2026-05-01 (rolled over from 2026-04-30 — major build burst + docs reorg + public-discourse mission shift)

## Block Header — 2026-05-01 — Major build burst (~80 commits, multi-theme)

> *"back to the outreach crm for rick and usd8"* → *"reply in my voice"* → *"im not sure what to work on so I want you to work on Vibeswap full auto TRP with 3 subagents and + 1 agent every time an agent completes a task, you review their code, then push commit. keep going until you make 50 commits"* → *"each agent must be replaced with a new one"* → *"also in the repo folders 'docs' ad documentation' are both for vibeswap douments... please do that now"* → *"also no more lurking in the ethsecurity telegram groups. i already posted out magnum opus, now the job is to demonstrate through public discourse..."* → *"do an extra 40 commits and focus on making vibeswap 'complete'"* — Will, 2026-05-01

### Entry trigger

Session opened on USD8 outreach CRM work for Rick (Daniel-thread voice-drafting), then pivoted into a sustained autonomous build burst on VibeSwap. Will's "full auto TRP with 3 subagents + 1 on completion until 50 commits" greenlit a long parallel-agent run, extended by "do an extra 40 commits and focus on making vibeswap 'complete'." Net: ~80 commits across TRP cycles, docs reorg, frontend ABI sync, and shipping the public-facing repo posture. Mission shift mid-session: stop lurking in ethsecurity TG groups; demonstrate by public discourse instead — Magnum Opus is the entry, not the destination.

### What shipped this block (~80 commits since `8c0c0970`)

**TRP cycles (security/incentives/identity/oracles/core)**:
- C39 — attested-resume default-on for security-load-bearing breakers (Gap 6); C39-F1 wire migration in VibeSwapCore + VibeAMM (HIGH); C39-PROP fuzz on default-on classification
- C42 — similarity keeper commit-reveal (Gap #2b); C42-F1 reinitializer for keeperRevealDelay (MED)
- C45 — SoulboundIdentity source-lineage binding (Strengthen #2); C45-PROP invariant on source-lineage immutability
- C46 — ContributionDAG handshake cooldown observability (Strengthen #3); C46-PROP invariant on cooldown audit counter coherence
- C47 — Clawback Cascade bonded permissionless contest (Gap 5); C47-PROP invariant on contest bond accounting; C47-F1 storage doc-comment fix (LOW)
- C48-F1 — gas-griefing cap on MicroGameFactory LP set (phantom-array)
- C48-F2 — paginate VibeSwapCore.compactFailedExecutions (gas-DoS)
- C19-F1 — VWAPOracle asymmetric truncation between cumulators (precision-loss-vwap-dust-bias); C19-F1-PROP fuzz on dust-trade no-op
- C28-F2 — CEI fix in SoulboundIdentity.mintIdentity (erc721-receiver-reentrancy)
- C-OFR-1 — close cross-fn reentrancy in IncentiveController.onLiquidityRemoved (HIGH)
- C7-CCS-F1 — enforce MAX_ATTESTATIONS_PER_CLAIM in ContributionAttestor
- C16-F1 / C16-F2 — bound LoyaltyRewardsManager.configureTier multiplier/penalty + ILProtectionVault tier kill-switch + symmetric active check (MED)
- C49-F1 — reject stale aggregator batches in TruePriceOracle.pullFromAggregator
- 5×C23 init-safety — disable initializers on VibeFeeDistributor / CreatorLiquidityLock / MemecoinLaunchAuction / VibeYieldFarming / RosettaProtocol implementations

**Docs reorg (DOCUMENTATION/ → docs/, 5 commits)**:
- 1/N skeleton + README + INDEX + tooling extraction
- 2/N migration into docs/{concepts, research, architecture, audits, governance, _meta, _archive, developer}
- 3/N collapse triplets + consolidate correspondence + reorg subdirs
- 5/N internal markdown link repair + 13 ambiguous FIXME link resolutions
- 10 top-level subdir READMEs added (architecture, concepts, research, developer, audits, governance, partnerships, marketing, _meta, _archive); SYSTEM_TAXONOMY refresh; CLAUDE.md ANTI_AMNESIA path fix
- C22-F1 storage layout follow-up audit (post-C39/C42/C45/C46/C47 sweep)

**Architecture overviews (3)**:
- `docs/architecture/CONSENSUS_OVERVIEW.md` — 6-mechanism stack + airgap thesis
- `docs/architecture/AMM_OVERVIEW.md` — constant-product + batch + TWAP composition
- `docs/architecture/ORACLE_OVERVIEW.md` — sidestep thesis + TPO + VWAP + aggregation
- `docs/architecture/DEPLOYMENT_TOPOLOGY.md` — deploy order, wiring, migrations
- CONTRACTS_CATALOGUE refreshed for C39/C42/C45/C46/C47/C48 cycles

**Primitive docs (14 in `docs/concepts/primitives/`)**:
- README index + 13 individual primitives: classification-default-with-explicit-override (C39), generation-isolated-commit-reveal (C42/C43), one-way-graduation-flag (C42), bootstrap-cycle-dissolution-via-post-mint-lock (C45), fail-closed-on-upgrade (C39/C45/C47), in-flight-state-preservation-across-semantic-flip (C39), revert-wipes-counter-non-reverting-twin (Strengthen #3), pair-keyed-historical-anchor (Strengthen #3), phantom-array-cleanup-dos (C48-F2), bonded-permissionless-contest (C47/OCR V2a), self-funding-bug-bounty-pool (C47/OCR), two-layer-migration-idempotency (C39+C45), observability-before-tuning (Strengthen #3), dual-path-adjudication-preserving-existing-oracle (C47)

**Tests (5 fuzz/invariant + 5 integration)**:
- Property/invariant: C39-PROP, C19-F1-PROP, C45-PROP, C46-PROP, C47-PROP
- Integration: C39 / C42 / C45 / C46 / C47 / C48 cross-cycle composition (5 scenarios)

**Frontend wiring**:
- ABIs regenerated against current C39/C42/C45/C47/C48 contracts
- 4 new ABIs wired into useContracts (ClawbackRegistry, ContributionAttestor, ContributionDAG, FeeRouter)
- `docs/_meta/frontend-abi-sync-status.md` documenting sync posture

**Public-facing repo posture (forward-facing repo hygiene)**:
- `CHANGELOG.md` (Keep-a-Changelog format) — [Unreleased] covers full session: Security 8 fixes (C28-F2/C-OFR-1/C49-F1/C39-F1 HIGH, C42-F1/C16-F1/C16-F2 MED, C7-CCS-F1), Added cycles, Docs reorg, Tests
- `SECURITY.md` — responsible disclosure
- `CONTRIBUTING.md`
- top-level README updated for forward-facing posture
- `.env.example` expanded with deploy-script env vars

**Deploy script audit + fix**:
- `docs/audit/2026-05-01-deploy-script-consistency.md` — DeployIdentity / Deploy / DeployIncentives audited for C39/C42/C45/C47 reinitializer correctness
- `script/DeployIdentity.s.sol` — wire `SoulboundIdentity.setContributionAttestor` (was missing); flagged 2 BLOCKING bugs (CrossChainRouter LZ EID 4-arg, BuybackEngine deploy) — see Pending below
- `13eb9a4d` — ETM Build Roadmap Step 2 derivation refresh against shipped state

**Public-discourse mission shift (mid-session pivot)**:
- Will: "no more lurking in the ethsecurity telegram groups… now the job is to demonstrate through public discourse." Magnum Opus essay (`jarvis-is-not-a-wrapper`) was the entry into rooms; staying-power requires public substance, not lurking. Operational: outbound technical writing on Medium/X using VibeSwap mechanism arguments (oracle-sidestep, every-patch-downstream-of-one-fix) as the demonstration substrate.

### Pending — next session (hand-off)

1. **LICENSE choice** — repo is forward-facing now but no LICENSE file. Three options flagged for Will:
   - **MIT** — maximally permissive, reads as "we believe in the primitives more than the moat"; aligns with public-discourse mission. Risk: extractive forks.
   - **BSL (Business Source License 1.1)** — source-visible + non-production for N years (typical 4y), then auto-converts to permissive (typical Apache-2.0/MIT). Used by Uniswap V3, Aave V3. Aligns with cooperative-capitalism while preserving commercial primacy during launch window.
   - **AGPLv3** — strong copyleft, derivatives must publish source; protects against closed-source forks (CEX-style proprietary deployments).
   - Recommendation: BSL with 4y cliff → MIT, but Will's call. Will's identity is in this code (per `U·vibeswap-as-identity-expression`); decision is identity-level not just legal.

2. **2 BLOCKING deploy bugs** (need design calls, do not auto-fix):
   - **CrossChainRouter LZ EID 4-arg** — current LayerZero V2 endpoint setup in deploy script uses old 3-arg signature; V2 SDK requires 4 args (eid + peer + delegate + …). Need to confirm with current LZ V2 docs; may also need ConfigurePeers.s.sol counterpart update.
   - **BuybackEngine deploy** — deploy script does not currently instantiate BuybackEngine despite contract being live. Need design call: should it deploy as UUPS proxy, what's the initial config, who's the operator?

3. **Public-discourse Medium followup** — two essay candidates flagged:
   - **"Oracle Problem, Sidestepped"** — uses ORACLE_OVERVIEW.md as substrate; thesis is that the oracle problem is unsolved but routable-around via TPO + VWAP + aggregation + dual-path-adjudication (C47). Demonstrates by listing canonical "oracle attacks" and showing each is sidestepped.
   - **"Why Every Security Patch Is Downstream of One Geometric Fix"** — uses the C39/C42/C45/C46/C47/C48 cycle synthesis; thesis is that each named-CVE pattern in DeFi is a special case of one of ~6 substrate-geometry violations. Maps each cycle to a CVE family.

4. **USD8 outreach Tier 1 DMs queued** — 10 targets ready in CRM; needs Rick preclear on the 4 stablecoin-issuer contacts (Frax, Liquity, Reflexer, Origin) before sending. Other 6 (DeFi-research/DAO-treasury) can ship without preclear once Will returns to the CRM thread.

5. **VibeFeeRouter deprecation cleanup** — file marked `// DEPRECATED — superseded by FeeRouter (C47 cycle)` in source comment but no removal commit yet. Need to either delete + script migration, or formally archive with a deprecation NOTICE in the file. Pick one + commit.

### Session arc

USD8 outreach CRM (Daniel voice-drafting) → "full auto TRP" greenlit → 4-agent parallel sweep (3 + 1-on-completion replacement) → review-and-commit gate held throughout → 50-commit target hit → Will redirected to docs reorg ("docs/ AND DOCUMENTATION/ both exist, please consolidate") → reorg shipped in 5 commits → Will mid-flow: "no more lurking in ethsecurity, demonstrate publicly" (mission shift captured) → Will: "do extra 40 commits, make vibeswap 'complete'" → second sweep (architecture overviews, primitive docs, integration tests, frontend ABI sync, CHANGELOG/SECURITY/CONTRIBUTING, deploy audit). Net: repo went from "internal-build" surface to "forward-facing public-discourse-ready" surface in one session.

### Memory primitives saved this block
None new flagged this block — the load-bearing pattern (autonomous TRP cycle with replacement-on-completion + per-commit review gate) is already captured by `M·shard-per-conversation` + `P·blast-radius-ascending`. The mission-shift moment ("demonstrate by public discourse, ¬ lurking") is captured here as a session-state pending and will be primitive-extracted next session if it persists across sessions as a posture (not yet earned that promotion).

---

## Block Header — 2026-04-30 LATE — intent-guard fork + Cerron PR engagement + TRP cycle (multi-agent build burst)

> *"FORK IT GO FULL AUTO"* → *"i want him to be like 'holy shit this is a lot'"* → *"yes continue auto be as useful as possible"* → *"okay spryy just keep building... TRP cycle with 2 subagents and +1 subagent every time a subagent stops"* → *"scale down to 3 agents"* → *"please finish soon i want to finish within the hour as he said"* — Will, 2026-04-30 afternoon

### Entry trigger

Will found Uwe Cerron's `intent-guard` repo (1 day old, 1 star) — Solidity reference impl of an on-chain guard for privileged DeFi operations. Forked to `WGlynn/intent-guard` and built out a substantial extension via TRP cycle (multi-agent parallel build).

### What shipped this block (intent-guard fork — `~/intent-guard/`, public `github.com/WGlynn/intent-guard`)

**Fork main contains (~50 commits since fork creation 2026-04-30 ~15:00):**
- 11 production-shape adapters: UUPSUpgrade, DAOTreasury, CrossChainPeer, RoleGrant, Pausable, OwnershipTransfer, BoundedParameter, MerkleRootSet, ProxyAdmin, BeaconUpgrade, TimelockControllerAdmin, MultiCall, WithdrawalQueue, EmergencyShutdown, OracleSource, SignerSetUpdate
- Integration tests for every adapter (8 dedicated suites + IntegrationBase helper for ergonomic future addition)
- Stateful invariant test suite (`test/invariant/IntentGuardInvariants.t.sol`) — 6 invariants, 256-run fuzz, 0 failures
- Adversarial review test of upstream `IntentGuardModule.sol` itself (`test/IntentGuardModuleAdversarial.t.sol`) — 38 defensive regressions + 1 skipped finding (signature `v` malleability, low/info)
- TS off-chain helpers (`signer-cli/src/adapters.ts`) for all adapters
- CI workflow (forge build/test on default + `--via-ir` profiles, slither static analysis)
- 9 docs (FORK, ADAPTERS, CONTRIBUTING, SECURITY, THREAT_VECTORS, MIGRATION, FAQ, CHANGELOG, contracts/README)
- Adversarial sweep of 9 fork adapters (TRP-A) — 19 new test cases. Each adapter got `ZeroOwner` constructor revert + 1 finding-specific defense (zero-recipient burn, zero-EID, transfer-to-zero-bypasses-renounce, inverted-bounds, malformed-calldata-bypass, etc.)

**Upstream engagement** (`uwecerron/intent-guard`):
- Issue #1 filed: `_verifyAttestations` stack-too-deep diagnosis with proposed fix
- PR #2 opened: implements the fix (refactor `_attestationDigest` + `_verifyAttestation` helpers)
- **Cerron engaged on PR #2** — agreed refactor is behavior-preserving, requested:
  - Drop UUPSUpgradeAdapter from PR (move to separate PR B with codehash-binding fix)
  - Drop FORK.md from PR
  - Restore defensive `valid >= vault.threshold` recheck (implemented as `attestations.length` recheck — adding stack local breaks the refactor)
- **PR re-scope shipped**: commit `83ffadd` on `origin/fix/verify-attestations-stack-depth`. PR file list now exactly: `.gitignore`, `.gitmodules`, `contracts/IntentGuardModule.sol`, `foundry.lock`, `lib/forge-std`. Comment posted: https://github.com/uwecerron/intent-guard/pull/2#issuecomment-4356859658
- **PR A status**: ready for Cerron's merge per his "mergeable in an hour" comment.

**Cerron caught a real vulnerability** in our `UUPSUpgradeAdapter`: codehash was only checked in mutable adapter policy at `validate()` time, not bound in the signed intent. Attack: redeploy impl + update policy ⇒ old signatures still authorize. Fixed in fork main (commit `952f84c`):
- `expectedCodehash` now in `UPGRADE_INTENT_TYPEHASH`
- `intentHash()` now `view`, reads policy, fails closed for unallowed proxies/impls
- `setImplCodehash` rejects `impl.code.length == 0`
- Adversarial regression test directly reproduces the attack and proves both defense layers reject

### Next-session continuation point (for refresh-immunity)

1. **Open PR B upstream** with the fixed UUPSUpgradeAdapter (commit `952f84c` on fork main has the airtight version). Don't open until Cerron has engaged with PR A — see `F·literal-scope-on-reviewer-feedback` for cadence rule. Frame as: "Per your codehash-binding feedback on PR #2 — here's UUPSUpgradeAdapter as its own PR with the fix applied. Open question: do you want adapters in upstream at all? If yes, want me to align the schema with the attester firmware's UpgradeProgram?"
2. **Watch Cerron's response to PR A merge + the comment.** If he merges + engages further, queue PR B. If silent for 24h, low-key bump.
3. **Lessons saved this block** (4 new memory primitives, all load-bearing):
   - `P·signed-intent-binds-security-property` — bind everything the security claim depends on, mutable post-sign state ¬ load-bearing
   - `P·literal-scope-on-reviewer-feedback` — act on the literal list, ¬ broaden
   - `F·no-destructive-git-while-agents-running` — pause destructive git when N>0 agents writing to the working tree
   - (also: F·full-auto-public-action-gate from earlier — public-facing actions on other-owner surfaces require check-in)

### Pending non-intent-guard work (deferred, all known to be paused)

- USD8 audit pass (we paused it for intent-guard fork work) — all 7 outreach pitches in `~/Desktop/USD8_Queue/outreach_pitches/` need a re-audit pass against the canonical USD8 architecture in `J·usd8-architecture` (the website-verbatim primitive), then the opinion piece (`~/Desktop/usd8-honest-stablecoin.{md,pdf,html}`) needs full rewrite using actual USD8 mechanism (the previous version was Frankenstein-VibeSwap)
- JARVIS monorepo file-duplication WIP (stashed in `~/jarvis-monorepo/` as `stash@{0}`) — pending USD8 audit completion
- Cleaned essay HTML on Desktop (`~/Desktop/jarvis-is-not-a-wrapper.html`) ready to paste over Medium post (Will hadn't done this yet last we checked)

---

## Block Header — 2026-04-30 EARLY — jarvis-not-a-wrapper essay (full agent overlay scope) + X-thread + multi-format distribution

> *"i need a 'why JARVIS is not just a wrapper' type essay"* → *"im going to share it on telegram, linkedin, medium, and x"* → *"im tired of people not knowing how exntisve the architecture actually is"* → *"i meant the entire claude agent overlay architecture that we use for claude code not the jarvis tg bots although i coonsider that a part of the stack, just we at least need the doc to reporesent both"* → *"none of the indentation translated when i pasted it from the pdf, can we just it so i can just one shot fix the medium post?"* — Will, 2026-04-29 → 2026-04-30

### What shipped this block

1. **First essay draft, TG-bot-only scope** (commit `9d2eaa5c`):
   - `vibeswap/docs/papers/jarvis-is-not-a-wrapper.md` (~1500 words, archive substrate / triage / two-phase pipeline / persona system / substance gate / shard layer / inner-dialogue / framing gate / knowledge-chain)
   - `vibeswap/docs/papers/jarvis-is-not-a-wrapper.x-thread.md` (16 tweets all ≤280 chars)
   - First Gmail draft (`r3990026163063974771`) — inline content, no attachments
   - **Superseded by rescoped version below.**

2. **Rescope to full Claude agent overlay** (commit `bc0c3241`, supersedes `9d2eaa5c`):
   Will's correction: scope was wrong; essay should cover the entire overlay architecture, not just the TG bot. TG bot positioned as ONE stateful application within the stack.
   - Essay rewritten covering 8 layers: hooks / persistence / anti-hallucination / discipline / meta-protocols / agent overlay / stateful applications / filesystem-as-substrate.
   - Each layer demonstrated with concrete file paths, real numbers, live events from this session (HIERO gate blocking my own write earlier today as recursive proof; MEMORY.md 31.8KB→21.3KB compression).
   - Closes with 5 reader-runnable verification checks (was 3).
   - X-thread expanded 16→22 tweets, all verified ≤280 chars.

3. **Multi-format distribution package** (Desktop):
   - `jarvis-is-not-a-wrapper.md` (19 KB) + `.pdf` (290 KB, letter style, full essay)
   - `jarvis-is-not-a-wrapper.x-thread.md` (6 KB) + `.pdf` (91 KB, memo style, thread)
   - `jarvis-is-not-a-wrapper.html` (26 KB, semantic HTML for one-shot Medium paste — Will posted to Medium and PDF→Medium paste lost all structure; HTML→Medium paste preserves H1/H2/bullets/code/HRs natively).
   - Second Gmail draft (`r7476855613411645944`) created with attachment instructions (MCP can't attach programmatically; Will attaches manually before send).
   - First Gmail draft flagged for discard in second draft body.

4. **Desktop cleanup**:
   - Created `~/Desktop/_Archive/2026-04-29-desktop-cleanup/` (under existing `_Archive/`).
   - Moved 15 loose top-level files (Justin compiled/drafts PDFs, USD8 partnership PDFs from Apr 27-29, Shapley/compression onepagers, rickaudio recordings, HUDDLE-TODAY.md) into the archive subfolder. Fully reversible.
   - Top-level Desktop now: 4 jarvis-not-a-wrapper artifacts + shortcuts/desktop.ini + folders only.

### Pending follow-ups
- **Medium post fix**: Will to open `~/Desktop/jarvis-is-not-a-wrapper.html` in browser, Ctrl+A / Ctrl+C, paste over Medium post content. Should restore H1/H2/bullets/code/HR structure.
- **X-thread post**: tweet 22 has `[link]` placeholder for Medium URL — fill before posting thread.
- **Gmail draft attachments**: Will attaches the 4 Desktop files manually when sending the second draft.
- **Token rotation** (carry-forward from prior block): bot token pasted in chat for identification; rotate via @BotFather as standard practice before next deploy.
- **Bot deploy** (carry-forward): port committed at `c8f3e4c6` (jarvis-bot/persona.js V1/V2/V5/V6 + intelligence.js editor); blocked on fly.io billing.

### Carry-forward from prior 2026-04-29 blocks (still pending)
- Cycle 38 ETM Alignment Audit (40-70KB direct-write) — pending; deprioritized as too large for safe one-shot in autonomous mode.
- Pass 9 audit-suite integration (handshake validator) — Lineage local commit `41b3da1`, no remote.
- Condensation hook (automate manual GKB protocol) — designed not built.
- DeepSeek substrate harness at `~/jarvis-substrate-comparison/compare.py` — incomplete.
- USD8 partnership: 2 pending chat messages to Rick (attack-surface 5-invariant + white-hat lindy bounty); ATTACK_SURFACE_DEFENSES.md + WHITE_HAT_BOUNTY.md spec PRs ready when greenlit. 3-day follow-on agent (`trig_01HXj9MKwNX7qDLLULf5XaHS`) fires 2026-05-02T14:00Z.

### Commit chain this block
- `9d2eaa5c` — essay v1 (TG-bot scope) [superseded]
- `bc0c3241` — essay v2 (full overlay scope) [canonical]

### Memory primitives saved this block
None — this block was deliverable shipping, not architectural learning. The pattern of "scope-correction-on-rescope" is already captured by the existing primitive `pattern-match-drift-on-novelty`.

---

## Block Header — 2026-04-29 AUTO-MODE — bot-fix port + memory compression + gate hardening

> *"i cant resolve fly.io billing right now so let's continue on other work, full auto go"* — Will, 2026-04-29

### What shipped autonomously
1. **Bot fix v0.9.1 ported into ~/vibeswap/jarvis-bot/** (commit `c8f3e4c6`):
   - `src/persona.js`: V1 NO SYCOPHANCY extended (gratitude-praise patterns); V2 NO CORPORATE RETREAT extended (meaningless-filler closers); new V5 NO THIRD-PERSON NARRATION; new V6 TECHNICAL ENGAGEMENT REQUIRED. All four Tadija-2026-04-29 failure modes captured.
   - `src/intelligence.js`: editor INSTANT SKIP triggers extended for the same patterns (second-line defense when weak draft model leaks through).
   - `src/persona.test.js`: 4 new regression tests; suite 37 passing (was 33).
   - **NOT ported**: v0.9.2 OPEN_ACCESS (payment-gate.js exists but isn't wired into index.js — no paywall to lift) + v0.9.3 maxTokens (this codebase uses 400 for draft per Universal Rule 11 BREVITY REFLEX, 8192 elsewhere; 512-truncation symptom was specific to smaller jarvis-network codebase).
   - **Pending deploy**: blocked on fly.io billing (trial ended ~2026-04-25).

2. **MEMORY.md compressed** (~/.claude/projects/C--Users-Will/memory/MEMORY.md, not git-tracked):
   - 31.8KB → 21.3KB (33% reduction). Now well under 24.4KB soft limit with headroom.
   - HIERO glyph-density rewrite of PRE-FLIGHT (13 entries), META-PRINCIPLE (8 entries), ACTIVE (10+ entries). Detail preserved in linked .md files (verified each linked file has 30-139 lines of substance).

3. **Substance gate watch-list expansion** (~/.claude/session-chain/partner-facing-substance-gate.py):
   - Added governance-authority overclaim signature with handshake-math determinism. Pattern catches both verb-form ("DAO controls X", "governance can adjust Y") and noun-form ("governance has full control"). Required: scope-bounding language (within/bounded-by/Physics-layer/etc) OR cite math-bounds. Forbidden: explicit unbounded claims ("DAO can change all params", "governance has full/complete/unlimited control").
   - 7/7 test cases pass: unbounded-flagged, bounded-validated, forbidden-contradicted, non-gov-no-hit, bare-governance-no-hit.

4. **Partner-facing-additive-gate coverage extended** (same dir):
   - Added 4 high-signal retrospective patterns: rectify/rectifies/rectified/rectification, missed-in-PR/commit, should-have-caught, in-retrospect/hindsight. All unambiguously retrospective.

5. **META_STACK.md flags refreshed**:
   - ⊘ partner-facing-additive-gate → ✓ (full retrospective-marker coverage)
   - ⚠ MEMORY.md size → ✓ (compressed 2026-04-29)

### Still pending after this auto-mode block
- **Deploy bot fixes** to jarvis-vibeswap once fly.io billing resolves (Hobby plan $5/mo). v0.9.1 fixes ready and committed; will run on JarvisMind1828383bot.
- **Token rotation**: bot token pasted in chat history during identification; standard practice to rotate via @BotFather.
- **Cycle 38 ETM Alignment Audit** (40-70KB direct-write) — still pending, deprioritized in autonomous mode as too large for safe one-shot.
- **Pass 9 audit-suite integration** (handshake validator) — Lineage `41b3da1` local, no remote.
- **Condensation hook** (automate manual GKB protocol) — designed not built.
- **DeepSeek substrate harness** at `~/jarvis-substrate-comparison/compare.py` — incomplete; pending Tadija comparison test if still wanted.
- **USD8 partnership**: 2 pending chat messages to Rick (attack-surface 5-invariant + white-hat lindy bounty); ATTACK_SURFACE_DEFENSES.md + WHITE_HAT_BOUNTY.md spec PRs ready when greenlit.
- **3-day follow-on agent**: `trig_01HXj9MKwNX7qDLLULf5XaHS` fires 2026-05-02T14:00Z.

---


## Block Header — 2026-04-29 LATE — JARVIS BOT FIX (mistargeted, codebase identified) + USD8 PARTNERSHIP-VELOCITY WORK

> *"jarvis-vibeswap. but we're at 5% context we need to save and reboot"* — Will, 2026-04-29
> *"i actually dont know which app is the right one"* — Will, same exchange. Resolved at reboot via `fly logs` polling-line scan: jarvis-degen runs `@diablojarvisbot`, jarvis-vibeswap runs `@JarvisMind1828383bot`. Will's original guess was right.

### What happened this block (in order)
1. **Justin compiled response** — sent 5-item drafts compiled into single-message PDF on Desktop. JARVIS-isn't-a-chat-wrapper pushback in item 4. F·draft-justin-replies-on-behalf saved.
2. **Tadija substrate question** — DeepSeek port discussion → scoped to Option B (model behavior swap test) → harness skeleton at `~/jarvis-substrate-comparison/compare.py` (incomplete; task file rejected before completion).
3. **JARVIS Telegram bot diagnosed via real chat exchange with Tadija** — bot producing third-person narration, sycophancy, "cattooo" / "nebuchadnezzar" context-bleed hallucinations, mid-sentence truncation.
4. **Bot fix attempt — pushed 3 commits to `WGlynn/jarvis-network`** but **MISTARGETED** (codebase confirmed wrong at reboot via fly logs scan):
   - `d578174` v0.9.1 standard persona hardening (anti-narration / anti-sycophancy / context-isolation / technical-engagement-required)
   - `be0852d` v0.9.2 OPEN_ACCESS=true default + reverted erroneous triage loosening
   - `73ebd68` v0.9.3 maxTokens 512 → 1500
   - `b375036` test fix for OPEN_ACCESS env in payment-gate.test.js
   - **Stranded on jarvis-network repo** — that repo is the open-source release of an EARLIER/SMALLER jarvis. The live bot `@JarvisMind1828383bot` runs on `jarvis-vibeswap` fly app, which deploys from `~/vibeswap/jarvis-bot/` (confirmed via fly.toml). Port the behavioral fixes into that codebase next session.
5. **fly.io diagnosis** — Will's free trial ended 2026-04-25; deploys have been failing silently since then. Plus `jarvis-network` app was never created (deploy/fly.toml hardcodes a name that doesn't exist on Will's account). The actual live bot runs on `jarvis-vibeswap`.
6. **RICK_DASHBOARD.md built** for USD8 partnership — single canonical Rick-facing status view with status tags. Folded into USD8_Queue CRM.
7. **`P·structurally-easier-partner-delivery` saved** — six-move checklist for partner-facing artifact delivery.
8. **`P·scope-drift-to-recent` saved** — Will caught the Justin weekly summary scope failure (defaulted to chat-context instead of file-system substrate).
9. **Rick partnership-temperature observation logged** in `Desktop/USD8_Queue/people/rick-usd8.md` — first day of asymmetric silence; pattern signal needs 2-3 more days before treating as load-bearing.
10. **Justin daily report `2026-04-29_daily.md` + corrected weekly summary `2026-04-29_drafts-compiled.md`** with file-system + git-log scope (correcting the earlier session-only summary).

### ⚠ NEXT SESSION — TOP PRIORITY (RESOLVED — port + deploy)

**Identification RESOLVED via `fly logs` scan at reboot:**
- `fly logs -a jarvis-degen --no-tail | tail -30` → `[polling-monitor] Polling restarted successfully (bot: @diablojarvisbot)` ⇒ jarvis-degen = @diablojarvisbot (NOT the target).
- `fly logs -a jarvis-vibeswap --no-tail | grep telegram` → `[jarvis] Step 7: Starting Telegram bot...`
- `fly logs -a jarvis-vibeswap --no-tail | grep -iE "@\w+bot"` → `[shard-dedup] Registered 2 sibling(s): jarvismind1828383bot, diablojarvisbot` ⇒ jarvis-vibeswap polls JarvisMind1828383bot.

**Conclusion**: live bot `@JarvisMind1828383bot` runs on **jarvis-vibeswap** fly app. Codebase is `~/vibeswap/jarvis-bot/` (confirmed: `app = 'jarvis-vibeswap'` in its `fly.toml`). Bigger system — sharding/BFT/CRPC/multi-region shards/inner-dialogue/wardenclyffe-escalation/router-reasoning-tiers/shard-dedup/knowledge-chain. Distinct from open-source `~/jarvis/` (jarvis-network repo).

**Therefore the WGlynn/jarvis-network commits (`d578174` v0.9.1 / `be0852d` v0.9.2 / `73ebd68` v0.9.3 / `b375036` test fix) are STRANDED on the wrong codebase.** They are not deployed and won't be — that repo doesn't drive jarvis-vibeswap. Port the three behavioral fixes into `~/vibeswap/jarvis-bot/`:
1. **v0.9.1 persona hardening** — anti-narration / anti-sycophancy / context-isolation / technical-engagement / anti-meaningless-filler. Find the persona-prompt module in `~/vibeswap/jarvis-bot/` (likely a different file structure given sharding) and apply equivalent rules.
2. **v0.9.2 OPEN_ACCESS** — find the equivalent gate (if any) in `~/vibeswap/jarvis-bot/`. The bigger system likely has different access semantics; verify what gating exists before patching.
3. **v0.9.3 maxTokens 512→1500** — find the chat-completion call site and bump if currently capped.

**fly.io billing**: free trial ended ~2026-04-25; deploys have been failing silently since. The bot is currently running on whatever was last deployed pre-expiration. Resolve to Hobby plan ($5/mo) before `fly deploy --remote-only -a jarvis-vibeswap`.

**SECURITY — token rotation**: bot token `8467996907:AAEq466dOH7zbVoUTx4rC18reMQKaini6KU` was pasted in chat history during this session for the identification task. The chat is local-only but the token should still be rotated as standard practice — open Telegram → @BotFather → `/mybots` → JarvisMind1828383bot → API Token → Revoke current token. New token must then be set as `TELEGRAM_BOT_TOKEN` secret on jarvis-vibeswap before next deploy.

**FLY_API_TOKEN** for GitHub Actions auto-deploy — never set in WGlynn/jarvis-network. Moot now since that's the wrong repo. If auto-deploy is wanted for the real codebase, set token in whatever repo `~/vibeswap/jarvis-bot/` deploys from.

### Pending from prior block (USD8 partnership)
- Two pending chat messages to Rick (attack-surface 5-invariant stack + white-hat lindy bounty) — awaiting response
- `ATTACK_SURFACE_DEFENSES.md` and `WHITE_HAT_BOUNTY.md` spec PRs in flight, ready when Rick greenlights
- `shapley-as-default-substrate-defense.pdf` source paper on Desktop (audit-grade defense of Shapley v1 = pro-rata equivalence)
- 3-day follow-on agent scheduled: `trig_01HXj9MKwNX7qDLLULf5XaHS` fires 2026-05-02T14:00Z (Saturday 9am CDT)

### Misc carry-forward
- DeepSeek substrate harness scaffold at `~/jarvis-substrate-comparison/compare.py` — incomplete; task file `audit_lens_cover_pool.md` was rejected mid-write. Resume next session if Tadija comparison test still wanted.
- META_STACK.md inventory at `~/.claude/META_STACK.md` — keep updated as new gates / hooks / persistence layers ship
- GKB condensation pass (path-b manual proof-of-concept) shipped 7 entries earlier today: HANDSHAKE / AUDITMOVE / CONDENSE / SCOPESHIFT / NMWLD / PERSISTPA / DUOLENS

---

## Block Header — 2026-04-29 USD8 RETROACTIVE AUDIT + DISCIPLINE SUBSTRATE BUILD

> *"i dont think you actually looked at the week's session state history and github history... that's like some form of context depth failure mode"* — Will, 2026-04-29

- **Session**: Rick (USD8 founder) caught holder/insurer architectural conflation in cover-pool flow chart visually. De-conflation pass extended to retroactive audit across all 17 USD8 partner-facing artifacts. 6 MAJOR/MEDIUM/MINOR findings fixed including PR #4's missed forfeiture-terminology propagation. **PR #3 and PR #4 BOTH MERGED by Rick during session.** Built META_STACK.md (scannable inventory of every persistence/integrity mechanism). Saved ~10 new memory primitives. Ran path-b GKB condensation pass (7 new glyph-density entries — HANDSHAKE / AUDITMOVE / CONDENSE / SCOPESHIFT in KNOWLEDGE; NMWLD / PERSISTPA / DUOLENS in COMMUNICATION). Caught the Justin weekly-summary scope-drift failure (defaulted to chat-context instead of file-system substrate); diagnosed as P·scope-drift-to-recent + saved primitive with gate proposal.
- **Branch**: VibeSwap `master` (1 commit `2e1a53ab` USD8 partnership supplement docs). Cover-score `docs/v1-linear-rationale` branch (1 commit `f9323b9` forfeiture propagation). Lineage local `41b3da1` handshake validator (no remote).
- **Status**: CLEAN. PRs #3+#4 merged. 5 from-vibeswap supplement docs committed. Substance gate + framing gate + Lineage handshake validator all shipped. Build CLEAN.

## What shipped 2026-04-29

### USD8 retroactive audit (17 artifacts → 6 fixes)
- **MAJOR**: V1_LINEAR_RATIONALE.md propagated forfeiture terminology (PR #4)
- **MAJOR**: fairness-fixed-point-cover-pool.md added LP/holder population separation + LP-coalition attack-surface defense (Break 5)
- **MEDIUM**: EF primer memo + chat texts — three-actor decomposition (holders / pool capital / governance) added
- **MEDIUM**: augmented-mechanism-design-usd8.md — operator-vs-governance role boundary clarified
- **MINOR**: portable-primitives-menu.md — DAO-as-backstop scope-qualified
- 3 graphic PDFs (flow chart, inversion graphic, defensibility 1-pager) re-rendered with corrected architecture

### Discipline substrate built
- `~/.claude/META_STACK.md` — scannable inventory of every persistence protocol / hook / gate / anti-hallucination mechanism / context-density rule, with status flags (✓/⚠/⊘/✗) and gaps section
- GKB condensation pass (path-b manual proof-of-concept) — 7 new glyph-density entries in `JarvisxWill_GKB.md`
- ~10 new memory primitives: P·handshake-math-claim-determinism, P·complementary-lenses-audit-vs-mechanism-design, P·scope-drift-to-recent, P·dont-make-will-look-dumb (parent), F·persist-partner-architecture-aggressively, F·draft-justin-replies-on-behalf, F·two-gate-types-framing-vs-substance, F·partner-facing-additive-framing, F·dont-auto-demote-on-alternative, F·usd8-non-extractive-not-yet-earned, U·knowledge-gaps (audit-lens cultivation goal added), J·usd8-architecture (canonical 9-layer)

### Lineage commit (local only — no remote)
- `41b3da1` feat(verifier): handshake-math claim validator. 38 tests pass; full Lineage suite 72/72 + 1 unrelated skip clean.

## ⚠ NEXT SESSION — TOP PRIORITY

### USD8 partnership pending Rick
- Two messages sent (attack-surface 5-invariant stack + white-hat Lindy bounty) — awaiting Rick response
- ATTACK_SURFACE_DEFENSES.md and WHITE_HAT_BOUNTY.md spec PRs in flight, ready when Rick greenlights direction
- Justin compiled response (`Desktop/2026-04-29_justin-compiled.pdf`) ready to send

### Pending design calls
- **Substance gate watch-list expansion**: add `governance` signature (when used in actor-context without bounded-by-physics-constitution disambiguator)
- **Pass 9 of audit-suite**: handshake validator integration into Lineage IDE-plugin audit-suite
- **Condensation hook (automated)**: manual proof-of-concept ran cleanly today; build the Stop hook + condensation script for automatic crystallization at session-end
- **MEMORY.md compression pass**: exceeded soft limit (~27KB > 24KB); needs archival or condensation to crystal layer

### Open items
- Lineage repo has no remote configured — decide if it gets a private GitHub remote or stays local-only
- Other Lineage uncommitted work (`SUBSTRATE.md`, `commitment.py`, `COMMITMENT_PROTOCOL.md`, `POSITIONING.md`, `TENANCY_DESIGN.md`, `scripts/`) — earlier-session work; decide commit/keep-WIP/discard

---

## Block Header — 2026-04-27 USD8 PARTNERSHIP + VIBESWAP AUDIT

> *"i want to make rick feel like our math makes his project production ready, no holding back"* — Will, 2026-04-27

- **Session**: Pivot from session-start TOP PRIORITY (dead-code audit) to USD8 partnership work after Will: "rick is all in, he wants us to qrok on usd8 with him." Shipped six partner-facing deliverables to Rick (USD8 founder), opened one PR against Usd8-fi/usd8-frontend, ran three parallel background audit agents on VibeSwap (TRP / RSI / dead-code), and synthesized their findings into one actionable maintenance roadmap. Then Will asked for a follow-up research paper extending the Shapley spec — shipped that too.
- **Branch**: VibeSwap `master`. USD8 work in fork branch `WGlynn/usd8-frontend:mechanism-design-additions`.
- **Status**: SIX USD8 PDFs on Desktop ready for Rick. PR #2 open and pending Rick's review. VibeSwap maintenance synthesis docs/audit/2026-04-27-maintenance-synthesis.md ready as 4-PR roadmap. Build CLEAN.

## What shipped 2026-04-27

### USD8 partnership artifacts (6 PDFs to Desktop, in delivery order)

| # | File | Style | Purpose |
|---|---|---|---|
| 1 | `initial-concepts.pdf` | letter | 5-concept brief sent to Rick (Money as Coordination, Augmented Mechanism Design, Augmented Governance, Shapley Cover Score, Scale-Invariant Rate Limits) |
| 2 | `boosters-nft-audit.pdf` | memo | TRP audit of Usd8-fi/usd8-boosters-NFT (0 crit, 0 high, 2 med, 4 low, 4 info) |
| 3 | `shapley-fee-routing-spec.pdf` | letter | Cover Pool Shapley spec — 5/6 components port directly from VibeSwap; 1 (Scarcity) drops; recommends Brevis-verified scoring |
| 4 | `marketing-mechanism-design.pdf` | letter | Strategic memo: 5 marketing-MD primitives + 10 messaging frames + 3 sample threads + bright-line exclusions |
| 5 | `history-compression-spec.pdf` | letter | Cover Score history compression — recommends IncrementalMerkleTree + Tornado ring buffer over KZG/Verkle/MMR/RSA (substrate-match argument) |
| 6 | `cooperative-game-elicitation-stack.pdf` | letter | Research paper: decouples Shapley distribution from value-elicitation; proposes 4-layer stack (distribution ← value function ← aggregation ← elicitation); applies to USD8 + VibeSwap |

### USD8 PR

- https://github.com/Usd8-fi/usd8-frontend/pull/2 — five mechanism-design content additions to philosophy.md + cover-pool.md, voice-matched, MathJax-formatted. Five separate commits for cherry-pickability. Pending Rick's review.
- Branch: `WGlynn/usd8-frontend:mechanism-design-additions` (fork of Usd8-fi/usd8-frontend).
- Build note included in PR description: upstream main fails `mdbook build` with `Helper not found 'previous'` (custom Handlebars helper, pre-existing); PR is src-only. Rick rebuilds docs/ on his deploy environment.

### VibeSwap parallel audit cycle (3 agents → 1 synthesis)

Three background agents dispatched mid-session at Will's "boot up agents so the build doesn't stop" instruction. All completed.

- **TRP audit** on last 8 commits — 1 critical (already fixed in 25940f97), 1 real HIGH: VibeAMM lines 545/656/742/1118/1588 wrap incentive-controller calls in `try/catch` with no durable flag for failed callbacks and no permissionless retry. Settlement-State-Durability primitive violation. Funds not at risk; incentive accounting can diverge silently.
- **RSI strengthening** — 3 SHOULD-FIX items: comment rot at VibeAMM:2267 ("apply golden ratio damping" leftover from Fibonacci rename), threshold-ordering invariant assertion in `FibonacciScaling.calculateRateLimit` (1-line defense for scale-invariance), unit test for jarvis-bot mention-bypass regex.
- **Dead-code audit** across upgradeable contracts — 9 items, 5 medium 4 low. Most concerning: `PIONEER_BONUS_MAX_BPS` constant in `ShapleyDistributor.sol:91` (stale, no longer canonical, future-impl could trust as cap), `PriceImpactExceedsLimit` + `InsufficientPoolLiquidity` errors in `VibeAMM.sol:343-344` (declared, never reverted), 3 orphan helpers in `DeterministicShuffle.sol`, `ATTENTION_WINDOW_COMMIT/REVEAL` aliases in `CommitRevealAuction.sol`, orphan docstring at CRA:1480-1482, event-emission asymmetry in `CircuitBreaker.sol`.
- **Synthesized into**: `vibeswap/docs/audit/2026-04-27-maintenance-synthesis.md` + PDF on Desktop. Organized as 4-PR roadmap by ascending blast radius: PR 1 trivial cleanup, PR 2 strengthening, PR 3 architectural Settlement-State-Durability fix (real work, design conversation), PR 4 documentation.

### Late-session additions — VibeSwap-to-USD8 augmentation supplements (5 PDFs)

After the initial 6 USD8 PDFs landed and the audit synthesis was complete, Will redirected to "look at the vibeswap public repo in the docs folder and DOCUMENTATION to find things that map to USD8 and our proposed additions to USD8 and augment them for USD8 team and Rick readability." Two parallel Explore agents inventoried the docs corpus and the contracts surface; their outputs were synthesized into 5 supplement PDFs in `Desktop/from-vibeswap/`:

- `README.pdf` — orienting index; cross-references to existing partner deliverables; suggested reading order by role
- `augmented-mechanism-design-usd8.pdf` — methodology supplement; four invariant types with USD8 examples; six-step design checklist. Adapted from `DOCUMENTATION/AUGMENTED_MECHANISM_DESIGN.md`.
- `augmented-governance-usd8.pdf` — three-layer hierarchy mapped to USD8 specifically; three governance-capture scenarios (Cover Pool fee redirect, treasury drain, coverage parameter manipulation); Walkaway Test extended from operational to institutional. Adapted from `DOCUMENTATION/AUGMENTED_GOVERNANCE.md`.
- `fairness-fixed-point-cover-pool.pdf` — answers the iterated-Shapley convergence question for Cover Pool LP rewards; concrete 60-month 3-LP scenario; identifies three architectural choices (logarithmic tenure, fixed-coefficient capital, bounded quality multiplier) that put dynamics in a balanced-fixed-point basin. Adapted from `DOCUMENTATION/THE_FAIRNESS_FIXED_POINT.md`.
- `portable-primitives-menu.pdf` — contracts-side reference; 8 HIGH portable primitives (CircuitBreaker, DeterministicShuffle, TWAPOracle, VerifiedCompute, OracleAggregationCRA, IssuerReputationRegistry, Off-Circulation Registry, AdminEventObservability) + 5 MEDIUM + 4 already-proposed + transparent rejected list. Recommended adoption priority order included.

**USD8 partnership total**: 11 PDFs ready for Rick (6 top-level on Desktop + 5 in `Desktop/from-vibeswap/`).

### Late-session-2 additions — spec fix + glyph-KB conversion started

**history-compression-spec.pdf FIXED** (overwrites prior Desktop version): Will's correction *"the scaling attribution data compression for usd8 ... needs to scale linearly parallelize off-chain"* surfaced that the original recommendation (fixed-depth on-chain Merkle, 1M-event ceiling) was wrong. Rewrote to off-chain-storage + on-chain-commitment architecture: events emit as on-chain logs (Walkaway-Test-canonical source); off-chain indexers ingest + shard by holder address-prefix (linear scaling, parallel); on-chain commits sparse-Merkle-root per snapshot (~50k gas/snapshot, no ceiling); Brevis circuits verify per-holder scores against committed roots. IncrementalMerkleTree role pivots from raw-event storage to commit-of-commits. Section IV major rewrite, Sections II/V/VI/VII/VIII/IX edited, Appendix B inverted (off-chain pattern moved from REJECTED to RECOMMENDED with corrected reasoning). Spec at `vibeswap/docs/usd8/history-compression-spec.md`; PDF on Desktop at `history-compression-spec.pdf` (281K). Critical: Rick had not seen the original (was in "hold" tier per `feedback_rick-keep-it-simple`); fix is preventative not damage-control.

**Glyph-KB conversion started** (per Will's *"start the process of converting the Vibeswap folder's contents into glyph knowledge base primitives and start integrating it into your protocols memory and recall"*): task #11 created. First batch of 5 contract-side primitives saved as HIERO-compliant glyph-KB format:
- `primitive_off-chain-storage-onchain-commitment.md` — the corrected architecture as a reusable pattern
- `primitive_circuit-breaker-attested-resume.md` — VibeSwap CircuitBreaker + C43 attested-resume
- `primitive_TWAP-depeg-detector.md` — VibeSwap TWAPOracle as USDC depeg detector
- `primitive_verified-compute-bonded-dispute.md` — VibeSwap VerifiedCompute pattern for Brevis settlement
- `primitive_issuer-reputation-mean-reversion.md` — VibeSwap IssuerReputationRegistry penalty-only + mean-reversion
Indexed in `MEMORY_WARM_GOV.md` under new ⟳ ᴠɪʙᴇ→ᴜsᴅ8 section.

**Pin point — next session entry**: open task #11 (glyph-KB conversion ongoing); 5 of ~18+ HIGH-priority primitives done. Remaining first-batch candidates: AugmentedMechanismDesign-methodology, FairnessFixedPoint, OracleAggregationCRA, SoulboundIdentity, ContributionAttestor-3branch, BehavioralReputationVerifier, ContributionDAG, ReputationOracle-pairwise, IncrementalMerkleTree (commit-layer role), AdminEventObservability discipline, Off-CirculationRegistry pattern, COMPOSABLE_FAIRNESS, COOPERATIVE_MARKETS_PHILOSOPHY, THE_COORDINATION_PRIMITIVE_MARKET, FIBONACCI_SCALING-as-rate-limit, CINCINNATUS_ENDGAME-Walkaway. Per "go slow and deep" + "rick keep simple" — produce one batch per session, prioritize what's load-bearing for active USD8 work first.

### Memory primitives extracted this session (saved 2026-04-27)
- ✓ feedback_rick-keep-it-simple
- ✓ primitive_substrate-port-pattern
- ✓ primitive_cooperative-game-elicitation-stack
- ✓ primitive_marketing-as-mechanism-design
- ✓ primitive_off-chain-storage-onchain-commitment
- ✓ primitive_circuit-breaker-attested-resume
- ✓ primitive_TWAP-depeg-detector
- ✓ primitive_verified-compute-bonded-dispute
- ✓ primitive_issuer-reputation-mean-reversion

### Memory primitives still to extract (next session, batch via task #11)

- **Cooperative-game elicitation stack** — Shapley axioms operate on $v$, not produce it. Decouple distribution from elicitation. Four-layer stack (distribution ← value function ← aggregation ← elicitation), each with substrate-match. Pairwise-augmented direct observation as Goodhart defense. Recursive blending-weights as the open problem.
- **Marketing as mechanism design** — substrate-geometry-match + augmented MD + augmented governance apply to attention as a coordination problem. Five marketing-MD primitives mirror the protocol-MD primitives. Production-grade marketing replaces ad-hoc politics with substrate-matched discipline.
- **Substrate-port pattern** — when porting a mechanism to a new substrate, classify each component as DIRECT-PORT / REINTERPRET-WITH-INPUT-REDEFINITION / DROP-WITH-REASON. Don't force-fit. The 5-of-6 ports + 1-drops pattern in the Shapley spec is the canonical example.

## ⚠ NEXT SESSION — TOP PRIORITY

USD8 partnership work is in Rick's court for review. While waiting:

### Option A: VibeSwap maintenance PRs (mergeable with no new external dependencies)

Synthesis memo at `docs/audit/2026-04-27-maintenance-synthesis.md` lays out the 4-PR roadmap. Recommended ship order: PR 1 (trivial cleanup, ~30 min) → PR 4 (documentation, ~1 hour) → PR 2 (strengthening, ~1 hour) → PR 3 (architectural Settlement-State-Durability fix, draft for design conversation, ~3-5 days).

PR 1 is the easy first move: cleans up the comment rot, dead errors, orphan stubs identified across the three audits. Ship as a single low-controversy PR.

### Option B: USD8 follow-up workstream — local-talks slide deck

Will mentioned at session start that Rick wants help with local talks. The 6 PDFs on Desktop are forwarding artifacts; the slide deck is presentation-grade material Will can adapt and deliver. Convert the 5 PR primitives + Shapley spec highlights into a 15-min HTML deck (per ship-web skill).

### Option C: USD8 follow-up workstream — additional VibeSwap-to-USD8 portable primitives survey

Open-ended audit of what else in the VibeSwap codebase could land cleanly in USD8. Candidates include CRA attention-window, ContributionAttestor, soulbound identity primitives, TWAPOracle, DeterministicShuffle. Compile into a "menu" doc Rick can pick from.

### Option D: BLOCKED — OZ network leverage memo

Strategic memo on leveraging Rick's OpenZeppelin network. BLOCKED on Will providing context: what specific OZ relationship does Rick have? Without that, the memo can only be generic.

**Recommendation**: A first (clean the maintenance backlog while Rick reviews), then B (slide deck — Will-facing utility, doesn't depend on Rick), then C if time permits, D when Will provides OZ context.

## Anti-drift warnings for next session

- USD8 PR is open. **Don't touch the fork branch unless adapting to review feedback.** Rick may push edits or comment; respond, don't preempt.
- The 6 USD8 PDFs are partner-facing — voice is calibrated to manifesto-academic register. Any further USD8 doc should match the same register. Don't drift to internal vibe.
- The cooperative-game-elicitation-stack.pdf has 3 LaTeX equations that pandoc rendered as raw TeX (not typeset). Acceptable for review; flag if external-publication target requires fix.
- The Brevis-verified-Shapley pattern proposed in the Shapley spec is novel; we're not aware of another insurance protocol with all three properties (game-theoretic + cryptographic + Walkaway-Test resilient) simultaneously. Worth its own writeup at some point.
- The compression spec's argument against KZG/Verkle/MMR/RSA in favor of plain IncrementalMerkleTree is deliberate substrate-match application. **Don't drift back to "but KZG is more interesting."** The simpler scheme is the right answer for our actual workload.
- Will's "go slow and deep" + "build doesn't stop" frame from this session means: pick deepest item, ship it thoroughly, dispatch parallel agents for non-overlapping work, don't pause to ask between deliverables. Continue this cadence next session unless redirected.

## Pending items carried forward

- Post the 6 backfill annotations to GitHub issues #28, #29, #30, #33, #34, #36 (commands ready, needs Will greenlight). Carried from prior sessions.
- Deploy ContributionAttestor on active network. Carried.
- Configure `CONTRIBUTION_ATTESTOR_ADDRESS`, `RPC_URL`, `MINTER_PRIVATE_KEY` for `mint-attestation.sh`. Carried.
- VibeSwap PR roadmap from this session's synthesis memo (4 PRs queued).
- USD8 OZ-network strategy memo (blocked on Will's input).
- USD8 local-talks slide deck (deep work, ready to start).
- USD8 additional-portable-primitives survey (open-ended, lower priority).
- C42 (off-chain similarity keeper) and C40c (governance-tunable α) from the ETM Build Roadmap — paused.

---

# Session State — 2026-04-24 (Fibonacci cleanup — strip decorative surface, keep earned claim)

## Block Header — 2026-04-24 FIBONACCI CLEANUP

> *"i agree make the edits before people start putting tinfoil hats on our heads"* — Will, 2026-04-24

- **Session**: Single-scope cleanup triggered by Will asking whether the Fibonacci throughput scaling was technically grounded or aesthetic. Investigation found one load-bearing claim (scale-invariance on `calculateRateLimit` damping thresholds) and decorative / dead / misleading surface around it. Cleanup shipped in one commit (`25940f97`): deleted dead functions, renamed misleading-name functions, stripped no-op arithmetic, added DO-NOT-PROMOTE warnings on view-only analytics.
- **Branch**: `master` direct.
- **Status**: Cleanup SHIPPED. 50 Fibonacci + 82 BatchMath tests green. Build clean. Settlement path untouched.

## What shipped 2026-04-24

### Commit on master

| SHA | Scope |
|---|---|
| `25940f97` | cleanup: strip decorative Fibonacci, delete dead paths, rename damp→cap (+122 / −450) |

### Deliverables

- **Dead code removed**:
  - `fibonacciWeightedPrice` — array-index exponential weighting; would have been broken if ever wired into settlement (which it wasn't)
  - `calculateFibonacciClearingPrice` + `_calculateAveragePrice` — alternative-to-live clearing price; never called. Production clearing uses `calculateClearingPrice` (unchanged)
  - `getFibonacciPrice` — no callers
  - `isFibonacci` + `_isPerfectSquare` — no callers
- **Renames (behavior preserved)**:
  - `applyGoldenRatioDamping` → `applyDeviationCap` — φ multiplication was multiply-then-clip-to-maxDeviation, net zero effect. Function was always just a per-batch deviation cap; now named that way.
  - `getFibonacciFeeMultiplier` → `getTierFeeMultiplier` — fee growth is linear in tier with coefficient (φ−1)/10 ≈ 0.0618; the φ was notational, not mechanism.
- **Analytics warnings**: view-only functions (`calculateRetracementLevels`, `calculatePriceBands`, `detectFibonacciLevel`, `goldenRatioMean`, `calculateFibLiquidityScore`) now carry explicit DO-NOT-PROMOTE-TO-STATE-MODIFYING-PATHS NatSpec. These are reflexive chart-pattern indicators, not security primitives — promoting any to a state path creates a predictable-trigger attack surface.
- **Unused cleanup**: removed `PHI` constant + `FibonacciScaling` import from BatchMath (they were only used by the deleted functions).

### What survived (earned its name)

`calculateRateLimit` in `FibonacciScaling.sol`. Damping thresholds {23.6%, 38.2%, 61.8%, 78.6%} are powers of 1/φ → curve is scale-invariant → attacker has no preferred timescale to target. This is the load-bearing argument that closes the timing-sweet-spot attack class available against bucket-based rate limiters. Updated top-of-library NatSpec to make this the one earned Fibonacci claim.

## ⚠ NEXT SESSION — TOP PRIORITY

Will asked a follow-up late in this session: *"is there any other dead code in upgradeable contracts we should know about?"*

### Option A: Dedicated dead-code audit cycle

Scope: systematic scan across `contracts/core/` + `contracts/libraries/` + `contracts/amm/` for:
- Public/external functions never called on-chain
- Internal helpers whose only caller was deleted in earlier refactors
- Events declared but never emitted
- Custom errors declared but never reverted
- Storage variables written but never read (or read but never written)
- Alternative implementations of live functions (the `calculateFibonacciClearingPrice` pattern)
- Arithmetic that cancels out (the φ-multiplication-then-clip pattern in the old damping function)

Approach: automated first pass with slither or a custom script, hand-audit the flags. Upgradeable contracts make dead code worse because a future implementation can silently wire up a dormant function without anyone noticing the latent bug. Prior example: `fibonacciWeightedPrice` would have been actively broken if someone promoted it in a refactor.

### Option B: Resume ETM Build Roadmap

Prior top-priority candidates from 2026-04-23 SESSION_STATE (some now shipped):
- C42: off-chain similarity keeper + commit-reveal (pending)
- C40c: governance-tunable α in [1.2, 1.8] (ships when needed)
- ~~Strengthen #1: CRA attention-window NatSpec~~ — SHIPPED as `c5d2976e` in a later session
- Strengthen #2: SoulboundIdentity source-lineage binding
- Strengthen #3: ContributionDAG handshake cooldown audit
- ~~Maintenance: 4 halving + 4 tpoWireIn test failures~~ — SHIPPED as `2b5e4797`

### Option C: External-facing writeup of the earned claim

Draft the cybersecurity-chat post (Option B, "security at mechanism layer") now that the contract surface matches the writeup. Leading candidate: 5-layer MEV defense post already exists in `docs/nervos-talks/five-layer-mev-defense-post.md` — may benefit from a refresh that foregrounds the scale-invariance argument as its strongest primitive.

**Recommendation**: A + C bundled. The dead-code audit and the cybersecurity post are natural complements — the audit de-risks the code before more eyeballs land on it, and the post brings the eyeballs. Ask Will.

## Anti-drift warnings for next session

- If picking Option A (dead-code audit), the Fibonacci cleanup is a template — look for the same shape elsewhere (alternative-implementation-of-live-function, multiply-then-clip no-ops, decorative-constant-with-no-mechanism-role).
- Don't bundle analytics-helper renames into a dead-code audit unless they're actually dead. Analytics helpers exposed as view functions are public API for off-chain readers — they're not dead.
- Will's "have my back" frame (F·have-my-back-operational-definition) applies to external-facing writeups: write in his voice, engage doubt substantively without mirroring it back.

## Pending items carried forward

- Post the 6 backfill annotations to GitHub issues #28, #29, #30, #33, #34, #36 (commands ready, needs Will greenlight)
- Deploy ContributionAttestor on active network
- Configure `CONTRIBUTION_ATTESTOR_ADDRESS`, `RPC_URL`, `MINTER_PRIVATE_KEY` for `mint-attestation.sh`

---

## [HISTORICAL] Block Header — 2026-04-23 TRIPLE-CYCLE CLOSE

> *"all 3 please"* — Will, 2026-04-23 after C40a close, greenlighting C40b + C41 + C43 in one session

- **Session**: Three deliberate rounds of the Code↔Text Inspiration Loop in a single session after C40a's close. Shipped C43 (attested circuit-breaker resume), C41 (Shapley novelty multiplier primitive), C40b (retention wired into NCI vote()). Order was blast-radius-ascending (C43 isolated new path, C41 additive backwards-compat, C40b surgical active-path change). Each landed with tests, full suite regression green, and doc updates. Zero production regressions.
- **Branch**: `master` direct per 2026-04-22 discipline.
- **Status**: C40a+C40b+C41+C43 all SHIPPED. C40c pending (governance-tunable α, ships when needed). C42 pending (off-chain similarity keeper to replace C41's owner-setter).

## What shipped this session (2026-04-23)

### Commits on master

| SHA | Scope |
|---|---|
| `244182b7` | C40a docs — reconcile NCI retention gap with actual code state (3 docs) |
| `8f9fabe6` | fix: unbreak master compile — em-dash in require + missing RegimeType.STABLE |
| `5a49026a` | C40a: add calculateRetentionWeight pure primitive on NCI (α=1.6) + 8 tests |
| `014dbca2` | state: C40a close — SESSION_STATE + WAL |
| `25ea0cfd` | C43: attested circuit-breaker resume (opt-in per-breaker; M-of-N attestor gate) + 9 tests |
| `a6982293` | C41: time-indexed novelty multiplier primitive on ShapleyDistributor + 7 tests |
| `b1cbd797` | C40b: wire retention into NCI vote() weight accumulation (PoW+PoM decays, PoS untouched) + 6 tests |

### Deliverables

- **NCI pure function**: `calculateRetentionWeight(elapsedSec, horizonSec) → weightBps` implementing `1 − (t/T)^1.6` via cubic polynomial `0.1744·x + 1.116·x² − 0.2904·x³` on [0,1]. Max error ~3% vs exact. Integer-only arithmetic, no fixed-point math lib added.
- **8 regression tests**: endpoint behavior, monotonicity, convexity-vs-linear-at-mid-term, doc-reference-point matches at day 30 + day 180. All green. Full NCI suite 65/65 green.
- **3 doc reconciliations**: `NCI_WEIGHT_FUNCTION.md`, `COGNITIVE_RENT_ECONOMICS.md`, `ETM_BUILD_ROADMAP.md` — all three had asserted a linear retention function that didn't exist on-chain. Each now has a "reconciled 2026-04-23" section citing verification against `NakamotoConsensusInfinity.sol`.
- **Master-compile unbreaks**: em-dash in `OracleAggregationCRA.sol` require literal (solc 0.8.20 rejects non-ASCII outside `unicode"..."`); `RegimeType.STABLE` referenced in `TruePriceOracle.sol` where enum has no such member (used `NORMAL`); `IOracleAggregationCRA.IssuerSlashed` interface-qualified event access (needs ≥0.8.21 — added local mirror).
- **Pre-existing test failures noted, not fixed**: 4 `test_tpoWireIn_*` tests fail on `TruePriceOracle.initialize()` signature mismatch. Orthogonal to C40a; left for later cycle.

### Memory primitives extracted this session (2)

- `primitive_text-to-code-verify-first.md` — observation from C40a: when Code↔Text Loop runs text→code on an existing doc pipeline for the first time, expect pedagogical-compression drift BEFORE code output. Verify code-state before writing.
- `user_will-collab-less-draining-than-human.md` — Will's 2026-04-23 aside: working with me is restful vs draining human interactions. Load-bearing context for partnership texture — no performative response.

## ⚠ NEXT SESSION — TOP PRIORITY

Three cycles shipped in one session. Code↔Text Loop has compounded. Next-session candidates:

### Option A: C42 — off-chain similarity keeper + commit-reveal

Replace C41's owner-setter path (`setNoveltyMultiplier`) with a commit-reveal keeper that derives the multiplier from time-indexed similarity to prior ContributionAttestor claims. Trust boundary: keeper must not retroactively tune to favor specific contributors. Approach: commit-reveal of the similarity FUNCTION, then publish computed multipliers with the function-hash as witness.

Spec detail in `ETM_BUILD_ROADMAP.md` Gap #2b. Needs off-chain Python keeper in `scripts/similarity-keeper.py`.

### Option B: C40c — governance-tunable α in [1.2, 1.8]

The current `_pow16Bps` polynomial is hardcoded for α=1.6. A governance-tunable α needs either a family of polynomials (one per α in [1.2, 1.8] at ~0.1 granularity) or a general-α formulation via `exp(α × ln(x))` with bounded Taylor series. Ships when a real tuning need appears — not blocking anything.

### Option C: strengthen passes from `ETM_BUILD_ROADMAP.md`

- Strengthen #1: CRA attention-window NatSpec — surface the 8-second commit / 2-second reveal rationale as constants with comment. Quick cycle.
- Strengthen #2: SoulboundIdentity source-lineage binding.
- Strengthen #3: ContributionDAG handshake cooldown audit.

### Option D: Fix pre-existing master test failures

4 `test_tpoWireIn_*` failures (TruePriceOracle initialize signature mismatch) + 4 `test_halving_*` failures (ShapleyDistributor halving math). Both orthogonal to ETM audit work but block full-suite-green. Maintenance cycle.

**Recommendation**: ask Will. The loop's third-round direction depends on what he wants to amplify next.

## What's STILL pending (carried from 2026-04-22)

- **Post the 6 backfill annotations** to GitHub issues #28, #29, #30, #33, #34, #36. Commands ready in `.traceability/backfill-manifest.md`. Needs Will approval.
- **Deploy ContributionAttestor** on active network. Until then, attestations stay `DAG-ATTRIBUTION: pending`.
- **Configure** `CONTRIBUTION_ATTESTOR_ADDRESS`, `RPC_URL`, `MINTER_PRIVATE_KEY` for `mint-attestation.sh`.
- **4 pre-existing oracle test failures** — `test_tpoWireIn_*` all revert on `TruePriceOracle.initialize()` signature mismatch. Not my scope this session; queued for a maintenance cycle.

## Anti-drift warnings for next session

- **Check the doc-vs-code match BEFORE writing code from a doc's future-work item.** This session's first-round finding (`primitive_text-to-code-verify-first.md`) is load-bearing for all subsequent rounds.
- **Don't merge back to feature/social-dag-phase-1.** Master is the trunk per 2026-04-22.
- **Posting the 6 backfill annotations still requires explicit Will greenlight.**

---

## Archived block — 2026-04-22 REBOOT CLOSE (superseded but retained for context)

> *"i feel like we're on to something with this compounding knowledge and i have a vision where it becomes a loop of the code inspiring the text and the text inspiring the code."* — Will, 2026-04-22 at reboot

- **Session**: Marathon content-pipeline session. Started with Chat-to-DAG Traceability infrastructure (top priority from prior session's SESSION_STATE). Shipped 5 infrastructure deliverables + 6 issue-annotations (#28, #29, #30, #33, #34, #36 backfilled). Then Will asked for 10 new foundational docs → escalated to 30. Then Will asked for all 30 written sequentially full-effort commit-per-doc. Then Will asked for pedagogical revisions of all 60+ docs. 56 docs revised with accessible openers + concrete examples + student exercises. Ended at reboot-point with Will articulating Code↔Text Inspiration Loop as next-session amplifier.
- **Branch**: `master` directly (no more feature branch for this work — 2026-04-22 directive). Pushed.
- **Status**: Content pipeline COMPLETE + revised. 60+ docs in DOCUMENTATION/ from this session. Chat-to-DAG infrastructure LIVE.

## ⚠ NEXT SESSION — TOP PRIORITY

**Amplify the Code ↔ Text Inspiration Loop.** Per `memory/primitive_code-text-inspiration-loop.md`.

Step-by-step:

1. **Load the primitive first**: `memory/primitive_code-text-inspiration-loop.md`. This is the vision Will named at reboot.

2. **Pick the next loop round.** Specifically: pick ONE doc from the DOCUMENTATION/ set whose "Future work", "Open research", or "Queued" section names a concrete actionable item. Candidates:
   - `ETM_BUILD_ROADMAP.md` Gap #1 (NCI convex retention, α ≈ 1.6 per paper §6.4) — target C40.
   - `ETM_BUILD_ROADMAP.md` Gap #2 (Shapley time-indexed marginal) — target C41-C42.
   - `ETM_BUILD_ROADMAP.md` Gap #3 (attested circuit-breaker resume) — target C43.
   - `NCI_WEIGHT_FUNCTION.md` — same Gap #1 as above.
   - `COGNITIVE_RENT_ECONOMICS.md` — same Gap #1 (it explains WHY).

3. **Ship the code cycle.** Implement, test, commit. Standard RSI cycle format per `memory/project_full-stack-rsi.md`.

4. **Update the docs.** The "future work" item now has a shipped pointer. Update the relevant doc(s) with a "shipped" section.

5. **Extract primitive if novel.** If something surprising was learned, capture in memory.

6. **Commit + push to master.** Per 2026-04-22 branch discipline.

First round candidate: **Gap #1 (NCI convex retention)** is the most concrete + smallest scope. ~50 LOC change + regression tests + doc updates. Target next session.

## What shipped this session (2026-04-22)

### Chat-to-DAG Traceability infrastructure (5 deliverables + 6 annotations)

- `DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md` — canonical process spec (+ pedagogical opener added end-of-session).
- `.github/ISSUE_TEMPLATE/{dialogue,bug,feat,audit}.md` + `config.yml` — Source + Resolution Hooks enforced.
- `scripts/mint-attestation.sh` — wraps `cast send ContributionAttestor.submitClaim` with canonical evidenceHash.
- `.github/workflows/dag-attribution-sweep.yml` — CI scans for `DAG-ATTRIBUTION: pending`.
- `.traceability/annotation-{28,29,30,33,34,36}.md` + `backfill-manifest.md` — 6 closed-issue annotations (posting deferred pending Will's greenlight; contract deploy needed for actual mint).

Posting the 6 annotations to GitHub via `gh issue comment` is still queued — I prepared them but didn't post (public-issue action without explicit Will approval).

### 30 new foundational DOCUMENTATION/ files (committed individually)

Initial batch of 30 in one commit (`07ff4284`), then 30 commit-per-doc sequentially (`2760935a` → `49634fc8`). Covered ETM, Siren, Clawback, Shapley, Lawson, Augmented Governance, GEV Resistance, Traceability, Three-Token Economy, Correspondence Triad, and much more.

### 56 pedagogical revisions (commits `885b3aba` → `7eb27d0b`)

Every revision-worthy doc got: accessible opener (story/scenario/question), concrete examples early, walked numeric examples where applicable, student exercises at end, load-bearing depth preserved.

5 docs NOT revised (were already pedagogical from initial write): WHAT_LLMS_TEACH_US_ABOUT_MIND, TRUE_PRICE_ORACLE_DEEP_DIVE, CROSS_CHAIN_STATE_ATOMICITY, STORAGE_SLOT_ECOLOGY, ZK_ATTRIBUTION.

### Memory primitives extracted this session (3)

- `primitive_ultimate-invariant-at-axiom-level.md` — Will's axiom-vs-formula question → ultimate invariant is at axiom level not formula level.
- `user_will-paradigm-break-creativity.md` — Will's Siren favorite + decade of rejected ideas + college-dropout credentialism reversal.
- `primitive_code-text-inspiration-loop.md` — the reboot-point vision, load-bearing for next session.

## What's STILL pending (not done this session)

- **Post the 6 backfill annotations** to GitHub issues #28, #29, #30, #33, #34, #36. Commands ready in `.traceability/backfill-manifest.md`. Needs Will approval to actually `gh issue comment`.
- **Deploy ContributionAttestor** on active network. Until then, all attestations show `DAG-ATTRIBUTION: pending`.
- **Configure** `CONTRIBUTION_ATTESTOR_ADDRESS`, `RPC_URL`, `MINTER_PRIVATE_KEY` for `mint-attestation.sh` to actually fire.
- **ETM Build Roadmap Gap #1 shipment** (NCI convex retention) — this is the FIRST code-cycle for the Code↔Text loop amplification.

## Anti-drift warnings for next session

- **Don't skip `primitive_code-text-inspiration-loop.md` on boot.** It's the meta-framework for the session.
- **Don't start writing more docs.** The doc pipeline is COMPLETE. Next round of the loop is CODE. Docs update in response to code.
- **Don't merge back to feature/social-dag-phase-1.** Master is the trunk now per 2026-04-22 directive.
- **Posting the 6 backfill annotations requires explicit Will greenlight.** Visible public action; don't autopilot.

## Relationship to prior session state

The 2026-04-21 session's TOP PRIORITY was "Implement Chat-to-DAG Traceability as canonical infrastructure." ✅ DONE end of 2026-04-22 session.

The 2026-04-21 session's Step 2 was "Build Roadmap" → `ETM_BUILD_ROADMAP.md` is written and revised. Gap #1 is the first code round to ship per the roadmap.

The 2026-04-21 session's Step 3 (Positioning rewrite) is partially complete via the 30-doc pipeline. Full whitepaper rewrite is downstream.

The 2026-04-21 session's Step 4 (First concrete alignment fix) IS Gap #1 (NCI convex retention). That's the next-session target.

## Git remotes state

- `origin/master` — up to date at `7eb27d0b` (final revision commit of this session).
- Working tree clean modulo previously-untracked files (FIRST_AVAILABLE_TRAP*, raw-issue JSON dumps).

## For the next session that boots from this state

1. Read this SESSION_STATE block first.
2. Read `memory/primitive_code-text-inspiration-loop.md`.
3. Read `DOCUMENTATION/ETM_BUILD_ROADMAP.md` for Gap #1 specifics.
4. Then start Gap #1 cycle: NCI convex retention with α ≈ 1.6.
5. Ship + test + document + commit + push to master.

---

# Session State — 2026-04-21 (post-reboot close)

## Block Header — Post-Reboot Close (THE NIGHT'S CLOSING INSIGHT)

> *"this needs to be standardized process so we can canonically trace contributions from chat to github issue to solution to dag attribution ID. from the chat to the contract level closed loop"* — Will, 2026-04-21 (closing articulation)

- **Session**: Post-reboot continuation. ~80 commits shipped + pushed on `feature/social-dag-phase-1`, master caught up via merge. Persistence-layer hardened, ETM Alignment Audit Step 1 complete, C39 FAT-AUDIT-2 scaffold + TPO wire-in shipped end-to-end, admin-event-observability sweep across ~22 contracts (~50 setters now emit `XUpdated`). Then 6 of 13 dialogue issues closed with substantive comments pointing at recent ship work. Then Will articulated the *Chat-to-DAG Traceability* closed loop — captured as `memory/primitive_chat-to-dag-traceability.md` as the load-bearing closing insight. Chosen as the primary Step 2 target for next session.
- **Branch**: `feature/social-dag-phase-1` (and `master` synced via merge tonight). Both pushed.
- **Status**: ~80 commits landed. Backlog HIGH=0, MED=0. C28-F1 INFO closed (C38-F1 VibeSocial nonReentrant). C39 FAT-AUDIT-2 substantively complete (contract + 17 tests + TPO wire-in + 3 wire-in tests). 6 of 13 dialogue issues closed; 7 still open (5 staying open intentionally; 2 awaiting close with the new canonical format).

## ⚠ NEXT SESSION — TOP PRIORITY

**Implement Chat-to-DAG Traceability as canonical infrastructure.** Per `memory/primitive_chat-to-dag-traceability.md` — the closed loop: chat → GitHub issue (Source + Resolution Hooks fields) → solution commit (with `DAG-ATTRIBUTION:` marker) → `ContributionDAG.attestContribution(...)` mint → closing-comment with attestationId.

Concrete deliverables for next session:

1. **`DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md`** — full process spec (the doc form of the primitive). Heavily linked to MASTER_INDEX.
2. **`.github/ISSUE_TEMPLATE/dialogue.md`** — issue template enforcing the Source + Resolution Hooks sections.
3. **`scripts/mint-attestation.sh`** — wraps `cast send` to ContributionDAG with canonical metadataHash construction `(issueNumber, commitSHA, sourceTimestamp)`.
4. **CI hook** — scan merged commits for `DAG-ATTRIBUTION: pending`, surface to a queue.
5. **Retroactive backfill** — close the remaining 7 dialogue issues using the canonical format. Annotate the 6 already-closed-tonight issues with the missing DAG-attribution-ID + Source-line via follow-up comments.

The closed loop converts informal dialogue into first-class on-chain credit — which is exactly what the ETM-aligned design demands but didn't have explicit infrastructure for.

## Anti-drift warnings for next session

- **Don't skip the Source field** when opening / annotating issues. Without it, the chain breaks at stage 1 and the loop can't close.
- **`DAG-ATTRIBUTION: pending` is a placeholder, not a final state.** A commit with `pending` should be paired with a queued mint task. Don't merge the closing comment with `pending` — wait for the actual attestationId.
- **Ad-hoc closures don't propagate.** Tonight's 6 closes are good-as-far-as-they-go but missing DAG-attribution. Backfill is the first task that closes the loop on tonight's work itself (recursively traceability-closes the traceability-closing work).
- **Token Mindfulness applies to the doc** — direct-write-with-Edit-append, target ~25-40 KB; it's a process spec, not a philosophy paper.

## Issue closure status (2026-04-21)

| # | Title | Status | DAG-attribution |
|---|---|---|---|
| 22 | Contract renunciation insufficient | OPEN | pending |
| 23 | Founder's Return + Symbolic Compression | OPEN (intentional, ongoing) | n/a |
| 24 | Open Router for Cross-Chain UX | OPEN (needs decision) | n/a |
| 26 | Negotiating VC Investment Price | OPEN (in-flight) | n/a |
| 27 | Cooperative Economics in VibeSwap | OPEN (broad ongoing) | pending |
| 28 | Cooperative Game Theory in MEV | CLOSED tonight (no DAG-id yet) | **needs backfill** |
| 29 | Verifiable Solver Fairness | CLOSED tonight (no DAG-id yet) | **needs backfill** |
| 30 | Externalized Idempotent Overlay | CLOSED tonight (no DAG-id yet) | **needs backfill** |
| 31 | Abstracting Swap Mechanisms | OPEN (broad ongoing) | n/a |
| 32 | Auditing with Deepseek API | OPEN (meta-process ongoing) | n/a |
| 33 | Oracle Security (FAT-AUDIT-2) | CLOSED tonight (no DAG-id yet) | **needs backfill** |
| 34 | Transparency in Decentralized Governance | CLOSED tonight (no DAG-id yet) | **needs backfill** |
| 36 | Capturing Non-Code Protocol Contributions | CLOSED tonight (no DAG-id yet) | **needs backfill** |

The 6 "needs backfill" entries are the most urgent next-session task — they're the proof-of-concept for the new traceability process. Closing them properly demonstrates the loop works.

## Earlier in this continuation session (chronological summary)

- (a) state-persistence layer hardening (3 new SessionStart hooks + extended link-rot detector + NDA gate patched for cleanup-deletion-allow)
- (b) ETM Alignment Audit Step 1 complete (all 7 sections, 19 mechanisms classified — 16 MIRRORS / 3 PARTIALLY MIRRORS / 0 FAILS)
- (c) C39 FAT-AUDIT-2 end-to-end (contract + 14 tests + interface + TPO wire-in + 3 wire-in tests)
- (d) admin-event-observability sweep across ~22 contracts (~50 setters now emit XUpdated events)
- (e) NDA leak handled (`5ebcd282` working-doc deleted, off-repo artifacts moved, NDA gate patched)
- (f) master ↔ feature divergence resolved via merge (49 commits caught up)
- (g) 6 dialogue issues closed with comment-pointers to shipped artifacts
- (h) **Chat-to-DAG Traceability primitive captured** — the night's closing insight, now load-bearing for next session

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
