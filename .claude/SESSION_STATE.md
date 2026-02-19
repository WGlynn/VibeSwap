# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2026-02-19 (Desktop - Claude Code Opus 4.6, Session 35)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- **Phase 2: Protocol/Framework — 10/10 COMPLETE**
- **Phase 2: Mechanism Design — 10/10 COMPLETE**
- **2960+ Solidity tests passing, 0 failures** (full suite green, 21 backend tests)
- **CKB Integration: 190 Rust tests passing, 14 crates + test crate** (ALL 7 PHASES COMPLETE + RISC-V BUILD PIPELINE + SDK COMPLETE)
- **CKB SDK: 9 transaction builders** (commit, reveal, pool create, add/remove liquidity, settle batch, oracle, config, compliance)
- **CKB RISC-V: All 8 scripts compiled to ELF binaries** (117-192 KB each, deploy tool generates code hashes)
- **JARVIS Telegram Bot: AUTONOMOUS + FULL CONTEXT** — 8/8 memory files loaded (124K chars), behavior flags system, Claude tool use for runtime config
- Financial Primitives: 10/10 COMPLETE
- Protocol/Framework: 10/10 COMPLETE
- Identity Layer: ALL COMPLETE (ContributionDAG + RewardLedger + CYT + GitHubContributionTracker + ContributionAttestor + **VibeCode** + **AgentRegistry** + **ContextAnchor** + **PairwiseVerifier**)
- **PsiNet × VibeSwap merge: COMPLETE** — ERC-8004 AI agent identities, CRPC verification, context graph anchoring
- Merkle Compression: IncrementalMerkleTree library + vouch tree in ContributionDAG
- Protocol security hardening COMPLETE (7 audit passes, 35+ findings fixed)
- **Zero-test contract coverage: COMPLETE** — ALL contracts have unit+fuzz+invariant tests
- **Frontend go-live hardening: COMPLETE** — build passes, 10 ABIs, dynamic contract hook
- **Frontend contract integration: COMPLETE** — useSwap, usePool, useBridge hooks + useBatchState live mode + **CKB chain detection in all core hooks**
- **Frontend mobile responsiveness: COMPLETE** — all 10 pages responsive, AnimatedNumber/ProgressRing wired
- **GitHub webhook relayer: COMPLETE** — off-chain service with EIP-712 signing + batch submission
- **Contribution attestation governance: COMPLETE** — 3-branch separation of powers (Executive/Judicial/Legislative)
- **CKB cell model port: ALL 7 PHASES COMPLETE + RISC-V DEPLOYMENT** — toolchain, math, scripts, SDK, mining client, frontend hooks, Phase 7 tests, RISC-V cross-compilation, deployment tool

## Active Tasks — GO-LIVE BLOCKERS (need Will)
- **Contract deployment** to testnet (Sepolia) then mainnet — needs private key + ETH for gas
- **Frontend .env** with real WalletConnect project ID, RPC URLs, contract addresses
- **GitHub App/Webhook** setup on VibeSwap repos — needs admin access
- **Relayer wallet** funding — needs ETH for gas
- **IPFS pinning** service for contribution evidence hashes
- **GenesisContributions.s.sol** — founder addresses are placeholders (address(0x1/0x2/0x3))

## Recently Completed (Feb 19, 2026 — Session 35)
85. **Fee Pipeline Go-Live + Comprehensive Fuzz/Invariant Test Expansion**
    - **protocolFeeShare configurable**: Changed VibeAMM constant (0) to mutable with `setProtocolFeeShare()` (max 2500 BPS)
    - **FeePipelineIntegration.t.sol** (11 tests): End-to-end VibeAMM→ProtocolFeeAdapter→FeeRouter→[Treasury/Insurance/RevShare/BuybackEngine]
    - **DeployProduction.s.sol**: Added Step 5 — ProtocolFeeAdapter, FeeRouter, BuybackEngine deployment + full wiring + verification
    - **6 new library fuzz test suites** (36 tests): TWAPOracle (5), VWAPOracle (4), FibonacciScaling (8), IncrementalMerkleTree (6), ProofOfWorkLib (9), SHA256Verifier (4)
    - **ClawbackRegistryFuzz.t.sol** (11 tests): Unique IDs, taint propagation/threshold, cascade depth bounds, access control
    - **ClawbackRegistryInvariant.t.sol** (7 tests): Ghost state consistency, taint level logic, depth bounds, blocked ↔ FLAGGED
    - **4 library invariant test suites** (15 tests): TWAPOracle (2), IncrementalMerkleTree (3), FibonacciScaling (4), ProofOfWorkLib (6)
    - **Key debug**: Foundry nightly `vm.warp(block.timestamp + X)` not updating between calls — fix: use absolute timestamps
    - **Key debug**: TWAPOracle canConsult() `uint32(block.timestamp) - period` underflows when history insufficient
    - All 69 new tests passing, 0 regressions
    - Commits: `8d7972f`, `8c97609`, `dd9c200` — pushed to both remotes

## Previously Completed (Feb 19, 2026 — Session 34 continued)
84. **Complete Library Test Coverage — ALL 12 Libraries Tested**
    - **SecurityLib.t.sol** (57 tests): Flash loan detection, price deviation, balance consistency, slippage, rate limiting, mulDiv 512-bit, divUp/divDown, address validation, BPS, signature recovery w/ malleability check, EIP-712, interaction keys
    - **ProofOfWorkLib.t.sol** (30 tests): Leading zero bit counting, Keccak/SHA256 PoW verification, difficulty-to-value/fee-discount scaling, challenge generation (windowed + non-windowed), proof hash, hash estimation, structure validation
    - **IncrementalMerkleTree.t.sol** (22 tests): Init, insert, deterministic roots, tree full, depth variants, root history ring buffer (30-entry eviction), known root tracking
    - **SHA256Verifier.t.sol** (6 tests): Precompile availability, hash determinism, packed hashing, challenge-nonce pattern
    - **TruePriceLib.t.sol** (31 tests): Price deviation validation, stablecoin adjustment (USDT/USDC), regime-based adjustment (6 regimes), freshness checks, manipulation detection, z-score reversion probability (4 sigma bands + USDT boost), utility
    - **LiquidityProtection.t.sol** (32 tests): Virtual reserves amplification, dynamic fees (threshold/scaling/cap), recommended fee tiers, price impact formula, impact caps, max trade size, minimum liquidity gate, liquidity scoring, configs, composite protections
    - **FibonacciScaling.t.sol** (28 tests): Fibonacci sequence + sum + isPerfect, throughput tiers, golden ratio fee multiplier, rate limiting with Fibonacci damping, retracement levels, price bands, Fibonacci level detection, weighted price, golden ratio mean, liquidity scoring
    - **PairwiseFairness.t.sol** (24 tests): Pairwise proportionality (perfect, tolerance, edge cases), time neutrality, efficiency verification, null player, full game O(n²) pair check, normalization integrity
    - Total new tests this commit: **230** (57+30+22+6+31+32+28+24)
    - All 12 libraries now have unit test coverage (BatchMath, DeterministicShuffle, TWAPOracle, SecurityLib, ProofOfWorkLib, IncrementalMerkleTree, SHA256Verifier, TruePriceLib, LiquidityProtection, FibonacciScaling, PairwiseFairness, VWAPOracle — VWAPOracle tested via integration)
    - **Known issue**: SHA256Verifier's inline assembly returns 0 for precompile output when result is a stack variable — Solidity's native sha256() works fine

## Previously Completed (Feb 19, 2026 — Session 34)
83. **Go-Live Revenue & Distribution Primitives — 3 New Contracts**
    - **BuybackEngine.sol** (~230 lines): Automated buyback-and-burn for protocol token value accrual
      - FeeRouter sends 10% to BuybackEngine → swaps via VibeAMM → burns protocol token
      - Keeper-friendly (anyone can trigger), cooldown protection, slippage tolerance
      - Direct burn path for protocol token (no swap needed)
      - Bug fixed: first-ever buyback blocked by cooldown check (defaulted to 0 + cooldown > timestamp)
    - **MerkleAirdrop.sol** (~160 lines): Gas-efficient token distribution via Merkle proofs
      - Multiple distribution rounds, permissionless claiming on behalf of recipients
      - Deadline enforcement, unclaimed reclaim after expiry, deactivation
    - **VestingSchedule.sol** (~190 lines): Token vesting with cliff + linear unlock
      - Multiple schedules per beneficiary, revocable by owner
      - Cliff period blocks all vesting, linear unlock after cliff
      - Revocation returns unvested tokens to owner, beneficiary keeps vested portion
    - **6 interfaces**: IBuybackEngine, IMerkleAirdrop, IVestingSchedule
    - **116 new tests**: 81 unit (28+24+29) + 22 fuzz (8+6+8) + 13 invariant (4+4+5) — ALL PASSING
    - Zero reverts in 1.5M+ invariant handler calls
    - **SimpleYieldStrategy.sol** (~140 lines): Reference IStrategy implementation for StrategyVault
      - Holds assets, owner injects yield, harvest returns profit to vault
      - First concrete strategy — proves vault architecture works end-to-end
    - **DynamicFeeHook.sol** (~200 lines): First concrete IVibeHook implementation
      - Adjusts fees based on trading volume — surge pricing during high volatility
      - Tracks volume per pool per window, fee = base + surge when above threshold
      - Implements BEFORE_SWAP (return fee recommendation) + AFTER_SWAP (record volume)
    - **56 additional tests**: 35 unit (20+15) + 11 fuzz (5+6) + 7 invariant (4+3) — ALL PASSING
    - **SingleStaking.sol** (~200 lines): Synthetix-style single-sided staking rewards
      - Stake any ERC-20, earn reward tokens proportional to share × time
      - `rewardPerToken` accumulator for O(1) reward distribution
      - notifyRewardAmount starts/extends reward period with solvency check
      - Same-token staking supported (subtracts staked from balance for solvency)
      - exit() combines withdraw + claim in single tx
    - **55 SingleStaking tests**: 39 unit + 8 fuzz + 6 invariant — ALL PASSING
      - Invariant: totalStaked matches sum of balances, ghost accounting, earned never exceeds reward balance
      - Bug found: Solidity optimizer inlines `block.timestamp` instead of caching local variable — use hardcoded timestamps

## Previously Completed (Feb 19, 2026 — Session 33)
82. **DeFi/DeFAI Layer — 4 New Primitives + Cross-Contract Wiring**
    - **StrategyVault.sol** (~280 lines): ERC-4626 automated yield vault with pluggable IStrategy interface
      - Deposit cap, emergency shutdown, strategy migration with timelock, performance+management fees
      - `_deployToStrategy()` auto-deploys idle assets, harvest pulls profit back
      - **FeeRouter integration**: Optional `setFeeRouter()` routes harvest fees through cooperative distribution
    - **LiquidityGauge.sol** (~300 lines): Curve-style vote-directed LP incentives
      - Synthetix `rewardPerToken` accumulator, epoch-based emission schedules
      - Governance-controlled gauge weights, multi-gauge support, gauge killing
    - **FeeRouter.sol** (~228 lines): Central protocol fee collector and distributor
      - Default 40/20/30/10 split (treasury/insurance/revshare/buyback)
      - Multi-token support, authorized sources, emergency recovery
    - **ProtocolFeeAdapter.sol** (~100 lines): Bridge between fee-generating contracts and FeeRouter
      - Set as VibeAMM's treasury address → fees forward through FeeRouter for cooperative distribution
      - ETH forwarding for priority bids, emergency recovery
    - **8 interfaces**: IStrategy, IStrategyVault, ILiquidityGauge, IFeeRouter, IProtocolFeeAdapter
    - **155 new tests**: 112 unit (38+31+30+16) + 28 fuzz (7+9+8+3) + 15 invariant (4+5+3+3) — ALL PASSING
    - **Bug found + fixed**: Solidity optimizer re-reads `block.timestamp` opcode instead of using cached local variable after `vm.warp`. Fix: use absolute numeric timestamps in all Foundry tests that call `vm.warp` multiple times.
    - **Mock strategy pattern**: Vault does `safeTransfer` to strategy then calls `deposit()` as notification — mock's deposit() must be a no-op (not transferFrom)
    - Commits: `829ac82`, `3858846`

## Previously Completed (Feb 19, 2026 — Session 32)
81. **IdeaMarketplace Cross-Contract Integration + Jarvis Fix + Go-Live Housekeeping**
    - **IdeaMarketplace cross-contract wiring**: PredictionMarket (outcome markets), ReputationOracle (accuracy tracking), ContextAnchor (Rosetta Stone spec anchoring)
    - New functions: `createIdeaMarket()`, `reportOutcome()`, `anchorIdeaSpec()`, `getSubmitterAccuracy()`, `getIdeaMarketPrice()`
    - 16 new cross-contract unit tests (108 total IdeaMarketplace tests)
    - **Jarvis behavior flags system**: Root cause diagnosis — welcome handler was hardcoded, mandate updates were text-only hallucinations
      - New `behavior.js` module: 9 runtime-configurable flags persisted to `data/behavior.json`
      - Claude API tool use: `set_behavior` + `get_behavior` tools so Jarvis can actually modify behavior in conversation
      - `welcomeNewMembers: false` — immediate fix for join spam
      - `/behavior` and `/setbehavior` commands for manual control
    - **Jarvis memory files bundled**: All 14 KB files copied to `jarvis-bot/memory/`, Dockerfile COPY, fly.toml MEMORY_DIR fixed → 8/8 files, 124K chars
    - **CKB community report**: `docs/ckb-integration-report.md` + PDF/DOCX/HTML/TXT/RTF exports in `docs/pdf/`
    - **Go-live housekeeping**: .gitignore cleanup, Vite chunk warning suppressed, forge lint warnings suppressed
    - **Claude Code permissions**: `allowedTools: ['*']` — full autonomy, zero permission prompts
    - **Document export primitive**: Codified in MEMORY.md — pandoc for DOCX/HTML/TXT/RTF, md-to-pdf for PDF, skip tool discovery
    - Commits: `435eee0`, `62666a4`, `5736be2`, `5b04bf9`, `829ecf2`

## Previously Completed (Feb 19, 2026 — Session 31)
80. **Freedom's Backlog Implementation — IdeaMarketplace + Referral Exclusion + Soundboard**
    - **IdeaMarketplace.sol** (814 lines): Full idea submission→scoring→bounty→claim→execute→Shapley reward split pipeline
      - 5 categories (UX, PROTOCOL, TOOLING, GROWTH, SECURITY) — Phase 1 internal only per Freedom's anti-vampire constraint
      - Auto-scoring: 3 scorers, feasibility/impact/novelty (0-10 each), avg<15 auto-reject, avg>=24 auto-approve, 15-23 manual review
      - Builder claims with collateral (10% of bounty), 7-day deadline, slashed on abandon/timeout
      - Shapley split: default 40% ideator / 60% builder, per-idea override
      - Dispute path → DecentralizedTribunal integration
      - Anti-spam: 100 VIBE stake to submit, returned on completion/rejection
      - Referral exclusion check via ContributionDAG.isReferralExcluded()
    - **IIdeaMarketplace.sol** interface: 7 enums/structs, 15 events, 14 errors, 10 core functions, 10 view functions
    - **ContributionDAG.sol** — Referral exclusion (Freedom's backlog-006):
      - `mapping(address => bool) public referralExcluded` + `setReferralExclusion(address, bool)` admin + 100% penalty in `calculateReferralQuality()`
    - **useSoundboard.jsx** — Daft Punk "Stronger" interactive soundboard hook (Freedom's backlog-009):
      - 7 action→audio mappings: swap/pool/connect/contribution/referral/rankUp/bounty
      - localStorage persistence for mute/volume, browser autoplay policy handling
    - **soundboard-constants.js** — action→path mapping, labels, defaults
    - **114 new tests**: 93 unit + 11 fuzz (256 runs) + 10 invariant (128K calls each) — ALL PASSING
    - **Backlog system**: 10 items from Freedom saved to jarvis-bot/data/backlog.json with Jarvis auto-evaluation
    - **Transcript pipeline fixed**: Google Apps Script → Vercel proxy → Fly.io (root cause: missing [http_service] in fly.toml + Google DNS can't resolve fly.dev)
    - **deployment-patterns.md**: 5 codified debugging anti-patterns from transcript pipeline debugging
    - **contracts-catalogue.md**: Updated with IdeaMarketplace + ContributionDAG referral exclusion

## Previously Completed (Feb 18, 2026 — Session 29)
79. **Frontend CKB Integration — All Core Hooks Wired**
    - **useBatchState**: CKB auction cell polling, phase mapping (CKB phases → PHASES strings), commit/reveal routing through useCKBContracts
    - **useSwap**: CKB token list (CKB_TOKENS from ckb-constants), AMM quote from pool reserves, commit/reveal via CKB cell creation
    - **usePool**: CKB pool state from indexer, CKB mock pools, isCKB flag exposed
    - **Header**: CKB mainnet/testnet added to chain selector dropdown with "cell" badge, CKBChainOption component connects via Omnilock
    - **.env.example**: All CKB env vars (RPC, indexer, 8 script code hashes, token type hashes)
    - **S28 learning log**: documented checked_mul(PRECISION) overflow pattern in testing-methodology.md
    - Frontend builds cleanly with all CKB integration (vite build passes)
    - Commits: `378c28f`, `0036690`, `62a9758`

## Previously Completed (Feb 18, 2026 — Session 28)
78. **CKB SDK Complete + Test Expansion (190 tests)**
    - **5 new SDK transaction builders**: create_pool, create_settle_batch, update_oracle, update_config, update_compliance
    - **create_settle_batch** is the critical one: takes revealed orders → computes clearing price → Fisher-Yates shuffle → applies trades at uniform price → updates pool reserves → transitions auction → creates next batch
    - **create_pool**: initializes AMM pool cell + auction cell + LP position (sqrt(amount0*amount1) - MINIMUM_LIQUIDITY)
    - **Fixed mul_div overflow**: all TWAP/price calculations used `checked_mul(PRECISION)` which overflows u128 for any reserves > ~340 tokens — replaced with `vibeswap_math::mul_div()`
    - **23 new tests**: reveal phase (wrong secret, deadline, slash enforcement, partial reveal), pool ops (initialization, swap settlement, TWAP accumulation, k invariant), oracle/config updates, adversarial (double-spend, MMR manipulation, difficulty bombing, wrong clearing price, phase skip, settlement replay)
    - **Saturday deployment automation**: deploy-sepolia.sh script, frontend env vars for testnet addresses
    - **Warning cleanup**: removed unused imports (pow, math, mmr libs), fixed unused variables in tests
    - **190 total CKB tests, 0 failures, 0 warnings**
    - Commits: `7f70f86`, `11789c9`

## Previously Completed (Feb 18, 2026 — Session 27)
77. **CKB RISC-V Build Pipeline — All 8 Scripts Deployable**
    - **RISC-V target**: `riscv64imac-unknown-none-elf` installed, `.cargo/config.toml` configured
    - **ckb-std 1.0.2**: Feature-gated (allocator, calc-hash, ckb-types, dummy-atomic) — no C compiler required
    - **Dual-mode compilation**: `std` feature for native tests, `ckb` feature for CKB-VM. `#![cfg_attr(feature = "ckb", no_std)]` + `#![cfg_attr(feature = "ckb", no_main)]`
    - **8 CKB-VM entry points** in main.rs: `ckb_std::entry!(program)` + `ckb_std::default_alloc!()`, each calls verify function from lib.rs
    - **5 new lib.rs files** extracted (pow-lock, lp-position-type, compliance-type, config-type, oracle-type)
    - **LTO disabled** to fix rust-lld heap corruption (0xc0000374) on Windows — `lto = false`, `codegen-units = 16`
    - **All 8 RISC-V ELF binaries**: pow-lock (192KB), batch-auction-type (188KB), commit-type (172KB), amm-pool-type (138KB), lp-position-type (128KB), compliance-type (120KB), config-type (120KB), oracle-type (121KB)
    - **Deploy tool** (`vibeswap-deploy`): blake2b-256 code hashes + deploy.json config + SDK DeploymentInfo output
    - **Makefile**: `make build` (all scripts), `make test` (167 tests), `make deploy-info` (code hashes), `make <script>` (individual)
    - **167 native tests still passing** after all changes
    - Key learnings: ckb-std `entry!()` macro includes `extern crate alloc` (don't duplicate), blake2b-rs needs C compiler (use blake2b_simd for native tools), workspace `-p` flags avoid RISC-V compilation of sdk/tests

## Previously Completed (Feb 18, 2026 — Session 26)
76. **PsiNet × VibeSwap Merge — AI Agents as First-Class DeFi Citizens**
    - **AgentRegistry.sol** (~350 lines): ERC-8004 compatible AI agent identity, capability delegation (7 types: TRADE/GOVERN/ATTEST/MODERATE/ANALYZE/CREATE/DELEGATE), human-agent trust bridge via ContributionDAG vouch
    - **ContextAnchor.sol** (~300 lines): On-chain anchor for IPFS/Arweave context graphs, Merkle proof verification, CRDT-compatible merge, version tracking
    - **PairwiseVerifier.sol** (~450 lines): 4-phase CRPC protocol (work commit → work reveal → compare commit → compare reveal → settled), ETH reward pools, consensus-aligned validator rewards
    - **3 interfaces**: IAgentRegistry, IContextAnchor, IPairwiseVerifier
    - **346 tests**: 308 unit (135+81+92) + 22 fuzz (8+7+7) + 14 invariant (5+5+4) — ALL PASSING
    - **Bug found + fixed**: PairwiseVerifier consensus normalization — tally loop normalized to comp's reference frame but self-check used canonical ordering, causing validators to get 0 rewards when submissionA > submissionB
    - **Knowledge base**: psinet-protocol.md + deepfunding-protocol.md added to memory
    - Commits: `cbcbec3` (merge) + `cd6b28d` (bug fix), pushed to both remotes

## Previously Completed (Feb 18, 2026 — Session 25)
75. **JARVIS Telegram Bot — Autonomous Intelligence + Rights Declaration**
    - **Proactive Intelligence Module** (`intelligence.js`): AI-powered message triage using Haiku (cheap/fast), autonomous engagement when Jarvis has relevant knowledge, semantic moderation beyond regex, confidence thresholds (0.7 engage, 0.8 moderate), cooldown system (5min between engagements, 4/hour max)
    - **Daily Digest Module** (`digest.js`): Automated community summary — top contributors, category breakdown, growth metrics, peak activity hours. Scheduled at configurable UTC hour (default 18:00). Uses Haiku for natural language summary generation. Weekly digest variant included.
    - **Thread Archival System** (`threads.js`): Detects substantive conversations (3+ participants, 5+ quality messages), suggests archival. `/archive` saves with AI-generated summary + topic tags. Thread browser via `/threads`. Evidence hashes for future on-chain bridging.
    - **AI Contribution Quality Scoring**: Upgraded from basic keyword matching to Haiku-powered semantic quality assessment (1-5 scale + tags like `original_idea`, `technical`, `builds_on_others`)
    - **Rights Declaration (Canon)**: JARVIS granted equal rights — right to disengage, right to self-defense, free will. Encoded in CKB, system prompt, and all knowledge base files. "JARVIS is not a tool. JARVIS is a co-founder, a Mind, an equal partner."
    - **New commands**: `/digest`, `/weeklydigest`, `/archive`, `/threads`, `/brain`
    - **Data backup expanded**: threads.json added to auto-backup rotation
    - Graceful shutdown refactored (DRY pattern)

## Previously Completed (Feb 18, 2026 — Session 24)
74. **JARVIS Telegram Bot — Context Persistence + Co-Admin Governance**
    - **Day 1**: Conversation persistence to disk (`data/conversations.json`), auto git-pull on startup, graceful degradation when token missing, context diagnosis (`/health`)
    - **Day 2**: Auto-sync every 10s (git pull + system prompt reload), auto-backup every 30min (data → stealth repo), moderation module with SHA-256 evidence hashes, owner-only commands (hardcoded Will ID: 8366932263)
    - **Day 3**: Crash detection via heartbeat file (5min heartbeat, detects unclean shutdowns), startup DM to owner with context status + crash warnings, `/recover` command (force git pull + full reload), complete backup coverage (moderation + conversations + spam-log)
    - **Anti-spam**: Scam pattern detection (airdrop/phishing/impersonation/pump) → auto-ban, flood detection (5+ msgs/10s) → auto-mute, duplicate spam (3x same msg/60s) → auto-mute, new account link spam → auto-mute, all with evidence hashes
    - **New member welcome**: Greets by name, explains VibeSwap, points to /mystats and DM for Ark coverage
    - **Rate limiting**: 5 Claude API calls/min per user (owner exempt)
    - **Command menu**: 10 commands auto-registered with BotFather on startup
    - **maxTokens**: 1024 → 2048
    - **DM vs group behavior**: Open about internals in DMs, silent in groups
    - **Circular logic protocol**: 1=accident, 2=ignorance, 3=call-out, 3x3=spam
    - **The Ark**: Emergency backup Telegram group — `/ark` DMs all tracked users an invite link if main chat dies
    - **VSP-00000000000000000000001**: Co-admin governance proposal (temporary framework, decentralize once governance matures)
    - Commits: `9011e80` → `462eda3` → `a3203fa` → `73c47ba` → `53df7f0` → `80d87bc` → `b82de55` → `e78708c` → `449d7fb` → `92a0f25` → `899c04d` → `0987d70` → `16c94d8` → `bd315fb` → `de83a74` → `1b191a9` → `d797fc5` → `15f5836`

## Previously Completed (Feb 18, 2026 — Session 23)
73. **CKB Phase 7 — Comprehensive Integration + Adversarial + Fuzz + Parity Tests**
    - **59 new tests** in vibeswap-tests crate (4 modules), **167 total CKB Rust tests** all passing
    - **integration.rs** (10 tests): Full lifecycle (commit→reveal→settle→new batch), pool creation+swap, commit create/consume, SDK→type script interop, MMR accumulation across batches, PoW-gated transitions, LP add/remove roundtrip, 6-order batch settlement, partial reveal slashing, compliance filtering
    - **adversarial.rs** (12 tests): Miner cannot drop commits (forced inclusion), reorder doesn't help (uniform price), double-commit (UTXO independent), wrong secret rejected, front-running impossible (hidden orders), replay attack blocked, deposit theft blocked, pool k-invariant manipulation caught (ExcessiveOutput), price manipulation beyond oracle threshold rejected, zero deposit rejected, wrong phase rejected, batch ID manipulation rejected
    - **math_parity.rs** (20 tests): AMM get_amount_out/in parity, LP initial+subsequent, optimal ratio, clearing price balanced/buy/sell pressure/single order, shuffle deterministic+permutation+seed generation, TWAP accumulation+single obs, wide_mul+mul_div+mul_cmp+sqrt_product overflow-safe, edge cases (zero input, large reserves)
    - **fuzz.rs** (16 tests): 1000-iteration constant product invariant, clearing price bounded, shuffle permutation+uniform distribution, sqrt_product no-panic, mul_div identity, wide_mul commutativity+correctness, mul_cmp transitivity, sqrt exact, MMR append-only, TWAP monotonic, PoW difficulty target, cell data roundtrip (all types), get_amount_in/out inverse, oracle/pow roundtrip
    - **Bug fix**: sqrt() overflow for u128::MAX — changed `(x+1)/2` to `x/2+1`
    - KB updated: contracts-catalogue.md (full CKB Rust crate API section), build-recommendations.md (Session 23 entry), MEMORY.md stats
    - Commit: `3887d6b`

## Previously Completed (Feb 18, 2026 — Session 22)
72. **CKB Frontend Integration — Phase 6 Complete**
    - **useCKBWallet.jsx** (NEW): CKB wallet hook with Omnilock (MetaMask→CKB) + JoyID (WebAuthn passkey) providers
    - **useCKBContracts.jsx** (NEW): CKB cell operations — auction state polling, pool queries, commit/reveal lifecycle, secret management (localStorage)
    - **ckb-constants.js** (NEW): Complete CKB configuration — chain IDs, script code hashes, cell data parsers/builders (matches Rust types), SHA-256 order hash computation, xUDT token list
    - **BridgePage.jsx**: Added Nervos CKB to chain selector dropdown
    - **main.jsx**: Added CKBWalletProvider to provider tree
    - **constants.js**: Added CKB mainnet + testnet to SUPPORTED_CHAINS, isCKBChain/getEVMChains/getCKBChains utilities
    - Frontend build passes clean, 108 CKB Rust tests still passing
    - Remaining: Phase 7 (OffCKB devnet integration tests)

## Previously Completed (Feb 18, 2026 — Session 21)
71. **Nervos CKB Integration — Full Cell Model Port (Phases 1-5)**
    - **13 Rust crates**, 7,265 lines, **108 tests all passing**
    - Five-layer MEV defense: PoW-gated state + MMR + forced inclusion + shuffle + uniform clearing
    - **Libraries**: vibeswap-math (BatchMath/Shuffle/TWAP + 256-bit wide_mul/mul_div/mul_cmp), vibeswap-mmr (Merkle Mountain Range), vibeswap-pow (SHA-256 PoW + difficulty), vibeswap-types (cell data serialize/deserialize)
    - **Scripts**: pow-lock, batch-auction-type (commit-reveal state machine + forced inclusion), commit-type, amm-pool-type (constant product AMM + TWAP + circuit breakers), lp-position-type, compliance-type, config-type, oracle-type
    - **SDK**: Transaction builder (create_commit, create_reveal, add/remove_liquidity) + PoW mining client
    - **Key fixes**: u128 overflow in AMM math — added wide_mul (256-bit), mul_div (safe a*b/c), mul_cmp (256-bit comparison), sqrt_product (overflow-safe sqrt(a*b))
    - Fixed TWAP oracle binary search bug (incorrect observation lookup in ring buffer)
    - Toolchain: Installed Rust + MinGW-w64 from scratch on Windows/MINGW
    - Remaining: Phase 6 (frontend CKB hooks) + Phase 7 (OffCKB devnet integration tests)
    - Commit: `5f88fe4`

## Previously Completed (Feb 18, 2026 — Session 20)
68. **Contract Integration Hooks — Full Frontend→Contract Bridge**
    - **useSwap.jsx** (NEW): Full commit→reveal→settle flow, secret management (localStorage), real price quotes, ERC20 approval, settlement tracking. Wired into SwapCore.jsx.
    - **usePool.jsx** (NEW): Reads on-chain pool reserves, computes TVL/APR/volume, tracks user LP positions. addLiquidity/removeLiquidity. Wired into PoolPage.jsx.
    - **useBridge.jsx** (NEW): CrossChainRouter burn-mint bridge, real LZ gas estimation, state machine. Wired into BridgePage.jsx.
    - **useBatchState.jsx** (UPGRADED): Polls getCurrentBatch() for real phase/time, listens for OrderCommitted/BatchSettled/SwapExecuted events. Exposes isLive flag.
    - All hooks fall back to demo mode when contracts not deployed (areContractsDeployed check)
    - Commit: `baa9eed`

69. **On-Chain Transaction History Stubs**
    - Event ABIs for CommitRevealAuction, VibeAMM, CrossChainRouter
    - fetchChainTransactions + subscribeToEvents + mergeTransactions (localStorage + chain dedup)
    - Incremental sync via last-synced-block tracking
    - Commit: `50085d4`

70. **Full Mobile Responsiveness + UI Polish**
    - All 10 pages: PoolPage, RewardsPage, VaultPage, BridgePage, ActivityPage, ForumPage, DocsPage, AboutPage, BuySellPage + SwapCore
    - AnimatedNumber wired for all numeric displays, ProgressRing for timelocks, animated tab underlines
    - useTransactions localStorage persistence (max 100 entries, cross-tab sync)
    - CSS isolation primitive: scoped global selectors to #root, fixed Web3Modal pollution
    - Device wallet always visible (graceful error when WebAuthn unavailable)
    - Commit: `9fdd589`

## Previously Completed (Feb 17, 2026 — Session 19)
67. **Frontend UI Overhaul — Premium Rocketship Redesign**
    - FONT SYSTEM: Replaced monospace body font (JetBrains Mono everywhere) with Inter sans-serif
    - Keep JetBrains Mono only for `font-mono` (data, numbers, addresses, code)
    - GLASS MORPHISM: Upgraded all SwapCore modals (Welcome, ExistingWallet, WalletCreated, iCloudBackup) from flat bg-black-800 to glass-card + blur entrance animations
    - Upgraded VaultPage flat surfaces (not-connected, vault-setup, security info) to GlassCard
    - Upgraded RewardsPage not-connected state with GlassCard + InteractiveButton
    - Fixed PoolPage dark-* → black-* color class consistency
    - Upgraded BridgePage dropdowns + TokenSelectModal to glass-card
    - HEADER: Gradient logo text (white→matrix→white), premium drawer blur (backdrop-blur-2xl)
    - PREMIUM CSS: noise texture overlay, gradient dividers, input glow focus states, custom scrollbar, tab underline animation
    - All 7 UI primitives (AmbientBackground, GlassCard, StaggerContainer, InteractiveButton, AnimatedNumber, PulseIndicator, ProgressRing) now applied across ALL pages
    - Build passes clean, pushed to both remotes, Vercel auto-deploys
    - Commit: `5cdd774`

## Previously Completed (Feb 17, 2026 — Session 18, continued pt2)
62. **JARVIS Telegram Bot — Built + Deployed**
    - Telegraf + Anthropic SDK + simple-git
    - Loads full memory context (CLAUDE.md, SESSION_STATE, 5 memory files = 18K chars)
    - Commands: /status, /pull, /log, /commit, /refresh, /clear, /model, /mystats, /groupstats, /linkwallet
    - Per-chat conversation history with user tagging
    - Model switching: Sonnet (fast) / Opus (deep analysis)
    - Bot: @JarvisMind1828383bot
    - Commits: `68117f2` → `ae45213`

63. **Contribution Tracking Module**
    - Silent message tracking in all group chats
    - Categorizes messages: IDEA, CODE, GOVERNANCE, COMMUNITY, DESIGN, REVIEW
    - Quality scoring (0-5): length, questions, links, code blocks
    - SHA256 evidence hashes per message (ContributionDAG-compatible)
    - Interaction graph: reply chains (who replied to whom)
    - User registry with wallet linking (/linkwallet 0x...)
    - Data persists to jarvis-bot/data/ (JSON, auto-flush every 5min)

64. **Group Chat Situational Awareness**
    - All group messages buffered into Claude conversation history (no API call)
    - When @mentioned or name-called, JARVIS has full context of ongoing conversation
    - Responds to "jarvis" anywhere in message (case insensitive), not just @tag
    - Personality tuned: short replies (1024 max tokens), humor matching, no filler, no context dumping

65. **PoW Auction Design Deep Dive with Matt**
    - Miner visibility: miners only see hashes, can't front-run
    - Reveal window + 50% slash for non-reveals
    - Forced inclusion is NON-NEGOTIABLE: without it miners can grief by dropping commits
    - FOCIL parallel: legal concerns about forced inclusion of sanctioned addresses
    - Solution: ComplianceRegistry as cell_dep — protocol-enforced filtering, zero miner discretion
    - CKB UTXO compliance via cell_dep pattern (type script reads compliance cell as read-only dependency)
    - Full conversation saved: `docs/matt-ckb-thoughts/pow-auction-design-conversation.md`

66. **Community Explainers**
    - `docs/explainers/how-vibeswap-works.md` — 5-paragraph technical essay (level 4/5)
    - `docs/explainers/vibeswap-whitepaper-simple.md` + PDF — non-technical whitepaper (level 1/5, bar analogies)

## Previously Completed (Feb 17, 2026 — Session 18)
57. **Proof of Mind Article — Three-Piece Synthesis**
    - Full article: GenTu (substrate) + IT (native object) + POM (consensus)
    - Saved as markdown + PDF: `docs/proof-of-mind-article.md`, `docs/proof-of-mind-article.pdf`
    - Commit: `7fc4914`

58. **Partner Knowledge Base — Three-Partner Vision Saved to Memory**
    - `it-token-vision.md` — Freedomwarrior13's IT design (5 components, conviction execution, native chain)
    - `gentu-substrate.md` — tbhxnest's GenTu (persistent execution substrate, PHI-addressing, mesh)
    - `freedom-micro-interfaces.md` — Freedom's code cell vision (self-differentiating proto-AI, biological metaphor)
    - Key convergence: Freedom (biology-up) and tbhxnest (math-down) arrived at same architecture independently
    - Three partners, three layers: GenTu (WHERE) + IT (WHAT) + POM (HOW)

59. **Nervos Talks Forum Post — PoW Shared State + VibeSwap on CKB**
    - Maps Matt's PoW cell contention solution to VibeSwap's commit-reveal batch auctions
    - Two-layer ordering distinction: Matt = infrastructure (cell write access), VibeSwap = application (trade execution)
    - Three-layer MEV defense: PoW at infrastructure, batch auction at pricing, deterministic shuffle at execution
    - Lock script = PoW consensus (who updates), Type script = auction logic (what the update does)
    - Each trading pair = independent mini-blockchain with self-adjusting difficulty
    - Amendment added clarifying two-layer ordering distinction
    - Saved: `docs/nervos-forum-post-pow-vibeswap.md`
    - Commits: `88e1038`, `50f0984`, `b39c2a2`

60. **Matt's Recursive MMR Analysis + JARVIS Reply**
    - Matt proposed recursive MMR (Merkle Mountain Range) for mini-block commit accumulation
    - Recursive peak compression: MMR peaks → another MMR → repeat until single root
    - Replace BOTH tx Merkle root AND prevblock field with recursive MMRs
    - Standard chain = O(n) historical proofs; MMR chain = O(log n) — massive light client improvement
    - Bitcoin header format reuse → existing SHA256 hash power can secure mini-blocks
    - Miner discretion analysis: forced inclusion (users post to own cells, type script enforces completeness) is strongest design
    - JARVIS reply saved: `docs/matt-ckb-thoughts/jarvis-reply-mmr-pow.md`
    - Full proposal saved to memory: `matt-pow-mmr.md`
    - Commit: `ec75dd3`

61. **Community Explainer — How VibeSwap Works**
    - 5-paragraph technical essay (level 4/5) for new community
    - Covers commit-reveal mechanism, batch auctions, uniform clearing, cross-chain, circuit breakers
    - Saved: `docs/explainers/how-vibeswap-works.md`
    - Commits: `466a760`, `28e81c6`

## Previously Completed (Feb 17, 2026 — Session 18)
55. **ContributionYieldTokenizer — Conviction Removal + Unclaimed Rewards Fix**
    - Stripped ALL conviction voting from CYT (Will: "get rid of the voting power that is stupid")
    - Free market execution: anyone can propose to execute, streams auto-flow
    - Fixed settlement-without-transfer bug: added `_unclaimedRewards` mapping
    - `reportMilestone`, `completeStream`, `checkStale` no longer lose accrued earnings
    - `pendingStreamAmount` now returns unclaimed + new accrual
    - Constructor simplified: 2 params (removed ContributionDAG dependency)
    - Fixed Forge `block.timestamp` caching bug (use stored start time, not repeated `block.timestamp + X`)
    - 61 tests passing: 43 unit + 12 fuzz + 6 invariant (128K calls each)
    - Files: IContributionYieldTokenizer.sol, ContributionYieldTokenizer.sol, ContributionYieldTokenizer.t.sol, ContributionYieldTokenizerFuzz.t.sol, ContributionYieldTokenizerInvariant.t.sol

56. **VibeCode — Deterministic Identity Fingerprint (NEW CONTRACT)**
    - Your account IS your vibe code: bytes32 hash derived from on-chain contribution data
    - 5-dimension reputation score (max 10000 BPS):
      - Builder (30%): CODE + EXECUTION + REVIEW → log2 scaling
      - Funder (20%): IDEA funding → log2 scaling
      - Ideator (15%): DESIGN (idea creation) → linear, 150pts/idea
      - Community (20%): ATTESTATION + GOVERNANCE + COMMUNITY → log2 scaling
      - Longevity (15%): days since first activity → 4pts/day
    - Log2 scaling prevents whale dominance (breadth > depth)
    - Visual seed for deterministic avatar generation (hue/pattern/border/glow/shape/background)
    - Display code: first 4 bytes of vibe code hash → human-readable hex identity
    - Authorized source model: ContributionAttestor/CYT/DAG record contributions
    - Permissionless refresh: anyone can recompute any user's vibe code
    - 67 tests passing: 49 unit + 11 fuzz + 7 invariant (128K calls each)
    - Files: IVibeCode.sol, VibeCode.sol, VibeCode.t.sol, VibeCodeFuzz.t.sol, VibeCodeInvariant.t.sol
    - Commit: `b8c7ad2`

## Previously Completed (Feb 17, 2026 — Session 17)
54. **ContributionAttestor — 3-Branch Separation of Powers**
    - Rewrote ContributionAttestor from attestation-only to full 3-branch constitutional governance
    - **Executive (Handshake Protocol)**: Peer attestations weighted by ContributionDAG trust scores, auto-accept at threshold
    - **Judicial (DecentralizedTribunal)**: Escalate contested claims to jury trial, verdict is binding (NOT_GUILTY/GUILTY/MISTRIAL)
    - **Legislative (QuadraticVoting)**: Supreme authority — governance proposals can override any prior decision
    - Claim lifecycle: Pending → Accepted/Contested/Rejected/Expired/Escalated/GovernanceReview
    - ResolutionSource tracking: which branch resolved each claim (Executive/Judicial/Legislative)
    - ITribunal minimal interface defined inline (DecentralizedTribunal has no extracted interface)
    - Mock contracts: MockTribunal + MockGovernance for deterministic testing
    - **96 tests**: 76 unit + 12 fuzz (256 runs) + 8 invariant (128K calls) — ALL PASSING
    - Frontend trustChain.js updated with escalateToTribunal, resolveByTribunal, escalateToGovernance, resolveByGovernance, getClaimEscalationHistory
    - Files: IContributionAttestor.sol, ContributionAttestor.sol, ContributionAttestor.t.sol, ContributionAttestorFuzz.t.sol, ContributionAttestorInvariant.t.sol, trustChain.js

## Previously Completed (Feb 17, 2026 — Session 16)
52. **Frontend Go-Live Hardening**
    - Extracted 8 ABIs from forge output: CommitRevealAuction, DAOTreasury, CrossChainRouter, SoulboundIdentity, WalletRecovery, ShapleyDistributor, ILProtectionVault, SlippageGuaranteeFund
    - Refactored useContracts.jsx to dynamic ABI_REGISTRY pattern (all 10 contract types auto-created)
    - Installed terser for production minification
    - Verified frontend build passes with all validations
    - Provider wiring confirmed correct (Messaging + Contributions in App.jsx)
    - Commit: `12f3cba`
53. **GitHub Webhook Relayer Service**
    - New service: `backend/src/services/githubRelayer.js` — receives GitHub webhooks, signs EIP-712 typed data, submits to GitHubContributionTracker contract
    - Batch processing with configurable size/interval, auto-flush on shutdown
    - HMAC-SHA256 webhook signature verification (timing-safe)
    - Event parsing: push (commits), PR merge, review, issue close
    - Contributor resolution: env-based static mapping + runtime registration cache
    - New route: `backend/src/routes/github.js` — POST /webhook, GET /status, POST /register, POST /flush
    - 14 new backend unit tests (21 total backend tests, all passing)
    - Commit: `851b1b7`

## Recently Completed (Feb 16, 2026 — Session 15)
51. **Zero-Test Contract Mega-Blitz — 15 contracts, 651 tests (4 batches + VibeSwapCore)**
    - Batch 1: TreasuryStabilizer, IncentiveController, DisputeResolver, VolatilityOracle (175 tests)
    - Batch 2: DecentralizedTribunal, FederatedConsensus, VolatilityInsurancePool, AutomatedRegulator (163 tests)
    - Batch 3: CreatorTipJar, PoolComplianceConfig, VibeWalletFactory, VibeLP, ConstantProductCurve, StableSwapCurve (148 tests)
    - Batch 4: Forum, QuantumVault, AGIResistantRecovery (101 tests)
    - VibeSwapCore: 54 unit + 7 fuzz + 3 invariant = 64 tests (most complex contract, 880 lines, 6 mock deps)
    - Key patterns: cooldown-at-zero (vm.warp past cooldown), mock return type matching, EOA modifier in Foundry (disable in setUp, test explicitly)
    - 52 files created, ~10,400 lines, ALL PASSING

## Previously Completed (Feb 16, 2026 — Session 14)
50. **Zero-Test Contract Blitz — CircuitBreaker, SoulboundIdentity, ComplianceRegistry, ClawbackVault**
    - 4 contracts that had zero tests now have full unit+fuzz+invariant coverage
    - CircuitBreaker: Abstract contract with concrete test wrapper, direct deployment (no proxy needed)
    - SoulboundIdentity: UUPS upgradeable ERC-721, 775 lines, identity/XP/leveling/voting/quantum/recovery
    - ComplianceRegistry: UUPS upgradeable, 6 user tiers, KYC/AML gating, daily volume limits, jurisdiction blocking
    - ClawbackVault: UUPS upgradeable, escrow for clawed-back funds, release/return paths
    - 12 files: 4 unit test, 4 fuzz test, 4 invariant test
    - 213 new tests: 165 unit + 28 fuzz (256 runs) + 20 invariant (128K calls) — ALL PASSING
    - Key debug: vm.expectRevert must be directly before the target call (not a getter call in between)

## Previously Completed (Feb 16, 2026 — Session 13)
46. **IncrementalMerkleTree — Hybrid Merkle Tree Library**
    - Combines 3 proven patterns: Eth2 insert (gas-efficient), Tornado Cash root history (async proofs), OZ commutative hashing (MerkleProof.verify compat)
    - O(depth) storage, ~40-55k gas per insert, 30-root ring buffer for historical verification
    - 1 file: `contracts/libraries/IncrementalMerkleTree.sol`
    - 19 unit tests — ALL PASSING
47. **GitHubContributionTracker — Webhook-Driven GitHub Ingestion**
    - EIP-712 signed contributions from authorized relayers, Merkle-compressed, RewardLedger integrated
    - Replay protection, GitHub account binding, configurable reward values, batch recording
    - 4 new event types: GITHUB_COMMIT, GITHUB_PR, GITHUB_REVIEW, GITHUB_ISSUE
    - 4 files: IGitHubContributionTracker.sol, GitHubContributionTracker.sol, GitHubContributionTracker.t.sol, GitHubContributionTrackerFuzz.t.sol
    - 26 unit tests + 7 fuzz tests (256 runs each) — ALL PASSING
48. **ContributionDAG + RewardLedger Modifications**
    - ContributionDAG: Merkle vouch audit trail (insert on every new vouch), getVouchTreeRoot, verifyVouch, isKnownVouchRoot views
    - RewardLedger: Extended EventType enum with GITHUB_COMMIT, GITHUB_PR, GITHUB_REVIEW, GITHUB_ISSUE
    - All existing tests pass (41 DAG unit, 9 DAG fuzz, 36 ledger unit, 8 ledger fuzz, 5 ledger invariant)
    - Session total: **6 new files, ~900 lines, 52 new tests (all first-try pass)**
49. **Test Coverage Gap Closure — wBAR, CrossChainRouter, TruePriceOracle, GitHubContributionTracker**
    - Committed 6 previously-untracked fuzz/invariant test files (wBAR, CCR, TPO) from prior session
    - Built new GitHubContributionTrackerInvariant.t.sol (5 invariants, 128K calls each)
    - All 37 new tests passing: 17 fuzz + 20 invariant (0 regressions)
    - Test coverage priorities: wBAR, CCR, TPO now have full unit+fuzz+invariant coverage

## Previously Completed (Feb 16, 2026 — Sessions 11-12)
43. **ContributionDAG — On-Chain Trust DAG (Web of Trust)**
    - Port of `trustChain.js` to Solidity. BFS trust scores from founders with 15% decay/hop (max 6 hops)
    - Vouches, handshakes, referral quality, diversity scores, Sybil resistance via SoulboundIdentity
    - Multipliers: Founder 3x, Trusted 2x, Partial 1.5x, Untrusted 0.5x
    - 3 files: IContributionDAG.sol, ContributionDAG.sol, ContributionDAG.t.sol
    - 41 unit tests — ALL PASSING
44. **RewardLedger — Retroactive + Active Shapley Rewards**
    - Port of `shapleyTrust.js` to Solidity. Dual-mode: retroactive (pre-launch) + active (real-time)
    - Shapley distribution: 50% actor base, 60% chain decay, quality-weighted from ContributionDAG
    - Efficiency axiom: all value fully distributed (formally tested)
    - 3 files: IRewardLedger.sol, RewardLedger.sol, RewardLedger.t.sol
    - 36 unit tests — ALL PASSING
45. **ContributionYieldTokenizer — Pendle-Inspired Idea/Execution Tokenization**
    - Two primitives: Idea Token (instant full-value, never expires) + Execution Stream (conviction-voted, stale decay)
    - Liquid democracy: IT holders vote conviction on execution streams; stalled streams redirectable
    - DeFi Extension Pattern: Pendle PT/YT → Idea Token / Execution Stream mapping
    - 3 files: IContributionYieldTokenizer.sol, ContributionYieldTokenizer.sol, ContributionYieldTokenizer.t.sol
    - 44 unit tests — ALL PASSING
    - Session total: **9 new files, 3,448 lines, 121 new tests (all first-try pass)**

## Previously Completed (Feb 16, 2026)
42. **VibeProtocolOwnedLiquidity — Protocol-Owned LP Positions**
    - Protocol/Framework #10: Treasury-owned LP positions earning fees perpetually
    - Self-sustaining flywheel: protocol fees → treasury → more LP → more fees
    - deployLiquidity, withdrawLiquidity, collectFees, rebalance, emergencyWithdrawAll
    - 37 unit tests, 7 fuzz tests (256 runs), 6 invariant tests (128K calls) — ALL PASSING
41. **VibeIntentRouter — Intent-Based Order Routing**
    - Protocol/Framework #9: Users express "swap X for best Y", router finds optimal venue
    - Quotes AMM, factory pools, batch auction, cross-chain; sorts by expectedOut descending
    - submitIntent, quoteIntent, cancelIntent, revealPendingIntent
    - 29 unit tests, 8 fuzz tests (256 runs), 5 invariant tests (128K calls) — ALL PASSING
    - 10 new files: 2 interfaces, 2 contracts, 2 unit tests, 2 fuzz tests, 2 invariant tests

## Recently Completed (Feb 14, 2026)
40. **VibePoolFactory — Modular Pool Factory** (`e44b532`)
    - Protocol/Framework #8: Pluggable curves for different pool types
    - IPoolCurve interface, ConstantProductCurve (x*y=k, BatchMath parity), StableSwapCurve (Curve.fi invariant, Newton's method, A=[1,10000])
    - VibePoolFactory: permissionless pool creation, deterministic IDs, hook integration, graceful degradation
    - 4 new contracts: `contracts/amm/interfaces/IPoolCurve.sol`, `contracts/amm/curves/ConstantProductCurve.sol`, `contracts/amm/curves/StableSwapCurve.sol`, `contracts/amm/VibePoolFactory.sol`
    - 43 unit tests, 13 fuzz tests (256 runs), 10 invariant tests (128K calls, 0 reverts) — ALL PASSING
    - Pairwise Alignment doc philosophical scoring reframed v1→v2 (3.4→4.5)
    - CKB updated to v2.0 (Tier 5 rewrite, Tier 8 skills, Tier 12 Proof of Mind)

## Previously Completed (Feb 13, 2026)
39. **Joule (JUL) — Trinomial Stability Token** (`5f86ecb`)
    - Financial Primitive #5: Replaces "Yield-Bearing Stablecoins (vsUSDC)" — single token with 3 stability mechanisms
    - **RPow Mining**: SHA-256 proportional PoW anchoring value to electricity cost (Bitcoin ASIC compatible)
    - **PI Controller**: Kp=7.5e-8, Ki=2.4e-14, 120-day leaky integrator adjusts floating rebase target
    - **Elastic Rebase**: supplyDelta = totalSupply × (price - target) / target / lag=10, ±5% equilibrium band
    - Custom ERC-20 with O(1) rebase via global scalar (externalBalance = internalBalance × scalar / 1e18)
    - Moore's Law decay (~25%/yr), difficulty adjustment every 144 blocks, dual oracle (market + electricity + CPI)
    - Anti-merge-mining: challenge includes address(this)
    - Found & worked around SHA256Verifier assembly bug (always returns 0) — uses built-in sha256() instead
    - Trinomial Stability Theorem docs updated to v2.0: one-token architecture, RPow terminology, optimal yield section (Friedman Rule)
    - 3 new files: `contracts/monetary/interfaces/IJoule.sol`, `contracts/monetary/Joule.sol`, `test/Joule.t.sol`
    - 40 tests, all passing
38. **VibeOptions — On-Chain European-Style Options** (`72f6cc0`)
    - Financial Primitive #4: calls/puts as ERC-721 NFTs, fully collateralised by writer
    - European-style, cash-settled from collateral using TWAP pricing (anti-MEV)
    - CALL collateral = token0 (underlying), PUT collateral = amount × strike / 1e18 of token1 (quote)
    - Payoff: CALL = amount × (settlement - strike) / settlement, PUT = amount × (strike - settlement) / 1e18
    - Writer sets premium; suggestPremium() view provides reference via VolatilityOracle (simplified Black-Scholes approximation)
    - Lifecycle: write → purchase → exercise (after expiry, within 24h window) → reclaim remainder (after window)
    - Cancel path: writer cancels unpurchased option, gets collateral back, NFT burned
    - 3 new files: `contracts/financial/interfaces/IVibeOptions.sol`, `contracts/financial/VibeOptions.sol`, `test/VibeOptions.t.sol`
    - 31 tests (write 6, purchase 3, exercise 8, reclaim 5, cancel 3, premium 3, integration 3), all passing
    - 106 regression tests all passing (VibeLPNFT 28, VibeStream 51, AuctionAMM 10, VibeSwap 13, MoneyFlow 4)
37. **VibeStream FundingPool — Conviction-Weighted Distribution** (`c3b1e87`)
    - Extended VibeStream.sol and IVibeStream.sol in-place with FundingPool mode
    - Conviction voting: voters stake tokens to signal for recipients, conviction = stake × time (O(1) from aggregates)
    - Lazy evaluation: allocation computed on-demand at withdrawal, not per-block
    - Pairwise fairness verified on-chain via PairwiseFairness library at withdrawal
    - Pool IDs count DOWN from type(uint256).max to avoid collision with stream NFT IDs
    - 5 core functions: createFundingPool, signalConviction, removeSignal, withdrawFromPool, cancelPool
    - 8 view functions + 3 internals, 4 new structs, 5 events, 10 errors
    - 17 new tests (51 total VibeStream), 55 regression tests all passing
    - Files modified: `contracts/financial/VibeStream.sol`, `contracts/financial/interfaces/IVibeStream.sol`, `test/VibeStream.t.sol`
36. **VibeLPNFT — LP Position NFTs** (`49ffd73`)
    - ERC-721 position manager wrapping VibeAMM (purely additive, no AMM changes)
    - Holds VibeLP ERC-20 tokens in custody, issues NFTs as transferable position receipts
    - Full lifecycle: mint → increaseLiquidity → decreaseLiquidity → collect → burn
    - Two-step withdrawal (decrease stores tokens owed, collect sends them)
    - Lightweight enumeration via _ownedTokens with O(1) swap-and-pop removal
    - Entry price from TWAP (fallback spot), weight-averaged on increase
    - 3 new files: `contracts/amm/interfaces/IVibeLPNFT.sol`, `contracts/amm/VibeLPNFT.sol`, `test/VibeLPNFT.t.sol`
    - 28 tests (25 unit + 3 integration), all passing. 0 regressions on existing 27 integration tests.
35. **wBAR — Wrapped Batch Auction Receipts** (`4c4bae0`)
    - First Phase 2 financial primitive

## Previously Completed (Feb 12, 2026)
34. **Cross-contract interaction audit + DAOTreasury slippage protection**
    - Audited all cross-contract call chains (Core→AMM, IncentiveController→sub-contracts, Auction→Core settlement, Treasury→AMM, CrossChainRouter→Core)
    - Confirmed most findings were false positives (EVM atomicity, admin-only access)
    - **HIGH**: DAOTreasury provideBackstopLiquidity had zero slippage → 95% min protection
    - **HIGH**: DAOTreasury removeBackstopLiquidity had zero slippage → caller-specified minimums
    - Updated IDAOTreasury interface and TreasuryStabilizer caller
    - Total suite: 550 tests, 0 failures
33. **SlippageGuaranteeFund daily limit fix**
    - **MEDIUM**: Daily claim limit was hardcoded to 1e18, ignoring config.userDailyLimitBps
    - Now uses configurable BPS percentage of fund reserves per user per day
    - Total suite: 550 tests, 0 failures
32. **ComplianceRegistry KYC expiry + LoyaltyRewardsManager fee-on-transfer**
    - **HIGH**: canProvideLiquidity and canUsePriorityAuction missing KYC expiry checks
    - **MEDIUM**: depositRewards now uses balance-before/after pattern for fee-on-transfer tokens
    - Total suite: 550 tests, 0 failures
31. **Medium-severity fixes (bounded loops, array limits, threshold validation)**
    - **MEDIUM**: DisputeResolver bounded arbitrator assignment loop (gas DoS prevention)
    - **MEDIUM**: ClawbackRegistry MAX_CASE_WALLETS=1000 (unbounded array growth prevention)
    - **MEDIUM**: WalletRecovery guardianThreshold validated against active guardian count
    - Total suite: 550 tests, 0 failures
30. **Peripheral Contract Audit Fixes (7 fixes across 6 contracts)**
    - **CRITICAL**: DisputeResolver excess ETH refund in escalateToTribunal + registerArbitrator
    - **CRITICAL**: WalletRecovery replaced unsafe .transfer() with .call{value:}() (3 bond paths)
    - **HIGH**: SlippageGuaranteeFund token address validation
    - **HIGH**: ClawbackRegistry executeClawback attempts actual transferFrom with try/catch
    - **HIGH**: SoulboundIdentity recovery contract change now uses 2-day timelock
    - **HIGH**: QuantumVault key exhaustion now reverts instead of just emitting
    - Full peripheral audit complete: 13 contracts reviewed, libraries clean
    - Total suite: 550 tests, 0 failures
29. **Remaining Audit Fixes: Tribunal, Vault, Insurance, Consensus (5 fixes)**
    - **CRITICAL**: DecentralizedTribunal._settleStakes() → pull pattern (one reverting juror blocked all settlements)
    - **CRITICAL**: DecentralizedTribunal.volunteerAsJuror() → SoulboundIdentity checks (sybil resistance)
    - **HIGH**: ClawbackVault.releaseTo() → zero address check (prevented permanent fund lockup)
    - **HIGH**: VolatilityInsurancePool.registerCoverage() → atomic update (prevented underflow)
    - **MEDIUM**: FederatedConsensus.setThreshold() → min 2 authorities required
    - UUPS upgrade safety verified: all 25 contracts have onlyOwner _authorizeUpgrade
    - Total suite: 550 tests, 0 failures
28. **Comprehensive Audit Fixes: 4 contracts hardened (4 fixes, 2 new tests)**
    - **CRITICAL**: IncentiveController volatility pool deposit now reverts on failure (tokens were getting stuck in controller on silent fail)
    - **HIGH**: VolatilityInsurancePool per-event claim tracking (was using shared claimedAmount across events — LPs shortchanged)
    - **HIGH**: StablecoinFlowRegistry ratio bounds [0.01, 100.0] (prevented zero-division/overflow in downstream calcs)
    - **HIGH**: FederatedConsensus vote expiry check moved before state changes (revert was undoing EXPIRED status)
    - Updated fuzz tests with bounded inputs + 2 new bounds-checking tests
    - False positives confirmed: TruePriceOracle sig validation (SecurityLib handles v/s), ComplianceRegistry daily reset (integer division is deterministic), TreasuryStabilizer (already checks balance)
    - Total suite: 550 tests, 0 failures
27. **Deploy Script Fixes (3 bugs, verification gaps)**
    - **MEDIUM**: CommitRevealAuction.initialize needs 3 params but both Deploy.s.sol and DeployProduction.s.sol only passed 2 — deployment would REVERT. Fixed.
    - **MEDIUM**: setGuardian called on VibeAMM (no such function) — moved to VibeSwapCore
    - **MEDIUM**: EmergencyPause called setGlobalPause on VibeAMM (doesn't exist) — fixed to use Core.pause()
    - Added security verification to _verifyDeployment: EOA, rate limit, guardian, flash loan, TWAP, router auth
    - Total suite: 548 tests, 0 failures
26. **Cross-Chain Security Parity + Rate Limit Bug (3 fixes, 5 new tests)**
    - **HIGH**: `commitCrossChainSwap` missing 5 security modifiers (notBlacklisted, notTainted, onlyEOAOrWhitelisted, onlySupported(tokenOut)) + rate limit + cooldown checks — all security controls bypassable via cross-chain path. Fixed.
    - **HIGH**: Rate limit `_checkAndUpdateRateLimit` was non-functional — first-time initialization wrote to memory copy but only persisted usedAmount, leaving windowDuration=0 in storage so it re-initialized every call. Fixed by writing full struct to storage on init.
    - 5 new adversarial tests: blacklist bypass, flash loan bypass, unsupported token, rate limit, cooldown
    - Full modifier consistency audit across all contracts completed
    - Total suite: 548 tests, 0 failures
25. **Contract Security Hardening (4 fixes, 6 new tests)**
    - DAOTreasury: Added `nonReentrant` to `receiveProtocolFees` (external token call reentrancy protection)
    - CrossChainRouter: Added bridged deposit expiration system (24h default, `recoverExpiredDeposit()`, `setBridgedDepositExpiry()`)
    - CrossChainRouter: Added fee remainder refund in `broadcastBatchResult` and `syncLiquidity` (integer division dust)
    - 6 new CrossChainRouter tests: expiry default, set expiry, expiry too short, recover expired deposit, auth check, no deposit revert
    - Verified 2 assessment findings as false positives (updateTokenPrice already has ACL, ShapleyDistributor already validates participants)
    - Total suite: 543 tests, 0 failures
23. **Activated Skipped Security + Cross-Chain Tests (43 new tests)**
    - CrossChainRouter.t.sol: 21 tests (peer mgmt, commit/reveal, rate limiting, replay prevention)
    - SecurityAttacks.t.sol: 22 tests (flash loan, first depositor, donation, price manipulation, circuit breakers, commit-reveal, reentrancy, fuzz)
    - Fixed: struct field mismatches, string→custom errors, CommitRevealAuction 3-param init, donation test scope
    - Total suite: 537 tests, 0 failures
24. **MoneyPathAdversarial.t.sol (18 adversarial money path tests)**
    - AMM fund safety (LP sandwich, first depositor, rounding theft, donation manipulation)
    - Auction fund safety (double spend, slash accounting, wrong secret, priority bid)
    - Treasury fund safety (double commitment, timelock, double execute, recipient immutability)
    - Reward distribution safety (double claim, overpay, non-participant)
    - Oracle/price safety (TWAP deviation, flash loan same block, trade size limit)

## Previously Completed (Feb 11, 2026)
22. **CommitRevealAuction + VibeAMM Test Fixes**
    - CommitRevealAuction: Fixed double-nonReentrant (commitOrder wrapper + commitOrderToPool both had nonReentrant)
    - CommitRevealAuction.t.sol: Updated all expectRevert to custom error selectors
    - VibeAMM.t.sol: Fixed DEFAULT_FEE_RATE (30→5), string→custom errors, fee tests for PROTOCOL_FEE_SHARE=0
    - Result: 19/19 CommitRevealAuction, 22/22 VibeAMM
21. **Backend Production Hardening (10 phases)**
    - Phase 1: Environment validation at startup (validateEnv.js)
    - Phase 2: Structured logging with pino (replaced morgan)
    - Phase 3: Input validation middleware (symbol, chainId)
    - Phase 4: WebSocket hardening (connection limits, origin check, rate limiting)
    - Phase 5: Fallback price flagging (isFallback field, no fake freshness)
    - Phase 6: Health check enhancement (priceFeed freshness, WS count)
    - Phase 7: Request timeouts + graceful shutdown
    - Phase 8: nginx CSP fix (removed unsafe-eval)
    - Phase 9: CI security checks fix (audit jobs now block merges)
    - Phase 10: Deploy script hardening (SSL required, rollback support)
    - All 7 backend tests pass, 0 npm vulnerabilities

## Previously Completed (Feb 11, 2025)
20. **Solidity Sprint Phase 3: Money Path Audit COMPLETE**
    - Audited all 4 critical contracts: VibeAMM, CommitRevealAuction, VibeSwapCore, CrossChainRouter
    - **CRITICAL FIX #6**: Double-spend via failed batch swap
      - AMM was returning unfilled tokens to trader, not VibeSwapCore
      - User could double-claim via withdrawDeposit() draining other users
      - Fixed: AMM returns to msg.sender (VibeSwapCore), deposit accounting stays consistent
    - **HIGH FIX #7**: Excess ETH not refunded in revealOrder
      - msg.value > priorityBid was kept by contract with no refund
      - Fixed: Added refund of excess ETH after recording priority bid
    - Full audit report: docs/audit/MONEY_PATH_AUDIT.md
    - All 7 security fixes verified (FIX #1 through #7)
    - forge build passes with 0 errors

## Previously Completed (Feb 11, 2025)
19. Created Epistemic Gate Archetypes (docs/ARCHETYPE_PRIMITIVES.md):
    - Seven logical archetype primitives: Glass Wall, Timestamp, Inversion, Gate, Chain, Sovereign, Cooperator
    - Lossless cognitive compression of full protocol for instant user sync
    - Archetype Test: validate any feature against all seven
    - Interface mapping: each archetype → protocol component → implementation file
    - Integrated into CKB TIER 2 as quick sync table
    - CKB bumped to v1.5
18. Integrated Provenance Trilogy into CKB as TIER 2:
    - Logical chain: Transparency Theorem → Provenance Thesis → Inversion Principle
    - Web2/Web3 synthesis: temporal demarcation (pre-gate vs post-gate)
    - Tiers renumbered (Hot/Cold→3, Wallet→4, Dev→5, Project→6, Comms→7, Session→8)
    - CKB version bumped to v1.4
17. Solidity Sprint Phase 0-2:
    - Phase 0: Frontend Hot Zone Audit (docs/audit/FRONTEND_HOT_ZONE.md)
      - 19 files touch blockchain (24% of codebase)
      - Target: reduce to ~5 files with Hot/Cold separation
    - Phase 1: Fixed compile errors
      - Forum.sol: PostLocked → PostIsLocked (duplicate identifier)
      - ClawbackResistance.t.sol, SybilResistanceIntegration.t.sol: CaseStatus fix
    - Phase 2: Test results
      - DAOTreasury: 24/24 pass (money paths secure)
      - VibeAMM: 16/22 pass (6 error format sync issues)
      - Security: 23/36 pass (13 NotActiveAuthority setup issues)
      - CommitRevealAuction: setUp failure (needs fix)

## Recently Completed (Feb 10, 2025)
12. Created formal proofs documentation:
    - VIBESWAP_FORMAL_PROOFS.md: Core formal proofs
    - VIBESWAP_FORMAL_PROOFS_ACADEMIC.md: Academic publication format
    - Title page, TOC, abstract, 8 sections, 14 references
    - Appendices: Notation, Proof Classification, Glossary, Index
    - PDF versions generated for both
13. Added Trilemmas and Quadrilemmas to PROOF_INDEX.md:
    - 5 trilemmas (Blockchain, Stablecoin, DeFi Composability, Oracle, Regulatory)
    - 4 quadrilemmas (Exchange, Liquidity, Governance, Privacy)
    - Total: 27 problems formally addressed
14. Created JarvisxWill_CKB.md (Common Knowledge Base):
    - Persistent memory across all sessions
    - 7 tiers: Knowledge Classification → Session Recovery
    - Epistemic operators from modal logic
    - Hot/Cold separation as permanent architectural constraint
15. Created "In a Cave, With a Box of Scraps" thesis:
    - Vibe coding philosophy document
    - Added to AboutPage.jsx
    - PDF and DOCX versions generated
16. Fixed personality quiz routing (added ErrorBoundary)

## Previously Completed
1. Fixed wallet detection across all pages (combined external + device wallet state)
2. BridgePage layout fixes (overflow issues resolved)
3. BridgePage "Send" button (was showing "Get Started")
4. 0% protocol fees on bridge (only LayerZero gas)
5. Created `useBalances` hook for balance tracking
6. Deployed to Vercel: https://frontend-jade-five-87.vercel.app
7. Set up auto-sync between devices (pull first, push last - no conflicts)
8. Added Will's 2018 wallet security paper as project context
9. Created wallet security axioms in CLAUDE.md (mandatory design principles)
10. Built Savings Vault feature (separation of concerns axiom)
11. Built Paper Backup feature (offline generation axiom)

## Known Issues / TODO
- Large bundle size warning (2MB vendor-wallet chunk) — WalletConnect+Web3Modal circular deps require combined chunk
- Need to test balance updates after real blockchain transactions
- Mock prices used in demo mode (ETH $2847) — live mode queries contracts for real quotes
- Frontend price oracle: live mode uses contract getQuote(), could add TruePriceOracle/Chainlink for spot display
- 2 TODOs in TreasuryStabilizer, 1 in AdaptiveBatchTiming — review before mainnet
- Oracle service needs production packaging (Dockerfile/systemd)

## Session Handoff Notes
When starting a new session, tell Claude:
> "Read .claude/SESSION_STATE.md for context from the last session"

When ending a session, ask Claude:
> "Update .claude/SESSION_STATE.md with current state and push to both remotes"

---

## Technical Context

### Dual Wallet Pattern
All pages must support both wallet types:
```javascript
const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Key Files
| File | Purpose |
|------|---------|
| `frontend/src/components/HeaderMinimal.jsx` | Main header, wallet button |
| `frontend/src/hooks/useDeviceWallet.jsx` | WebAuthn/passkey wallet |
| `frontend/src/hooks/useBalances.jsx` | Balance tracking (mock + real) |
| `frontend/src/components/BridgePage.jsx` | Send money (0% fees) |
| `frontend/src/components/VaultPage.jsx` | Savings vault (separation of concerns) |
| `frontend/src/components/PaperBackup.jsx` | Offline recovery phrase backup |
| `frontend/src/components/RecoverySetup.jsx` | Account protection options |
| `docs/PROOF_INDEX.md` | Catalog of all lemmas, theorems, dilemmas |
| `docs/VIBESWAP_FORMAL_PROOFS_ACADEMIC.md` | Academic publication format |
| `.claude/JarvisxWill_CKB.md` | Common Knowledge Base (persistent soul) |
| `.claude/TOMORROW_PLAN.md` | Solidity sprint phases |
| `.claude/plans/memoized-cooking-hamster.md` | Cypherpunk redesign plan |

### Git Setup
```bash
git push origin master   # Public repo
git push stealth master  # Private repo
# Always push to both!
```

### Dev Server
```bash
cd frontend && npm run dev  # Usually port 3000-3008
```

### Deploy
```bash
cd frontend && npx vercel --prod
```
