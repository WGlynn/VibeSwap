# Claude Code Memory - VibeSwap

## Project: VibeSwap

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

- Location: `C:/Users/Will/vibeswap/`
- CKB: `C:\Users\Will\.claude\JarvisxWill_CKB.md`
- Always push to BOTH remotes: `origin` + `stealth`

## GO-LIVE SPRINT (1 week — Feb 2026)
- **Both VibeSwap and Jarvis go live**
- Focus: modularity, robustness, framework-readiness to absorb other DeFi projects
- Retroactive Shapley claims for founders (human or AI) via governance
- Proof of Mind individuality at consensus

## Codebase Stats (Feb 18, 2026)
- **EVM**: 129 .sol files | 55 interfaces | 12 libraries | **2186+ Solidity tests passing**
- **CKB**: 15 Rust crates (4 libs + 8 scripts + 1 SDK + 1 deploy + 1 test) | **190 Rust tests** | **ALL 7 PHASES + RISC-V + SDK COMPLETE**
- **CKB SDK**: 9 tx builders (commit, reveal, pool, add/remove LP, settle batch, oracle, config, compliance)
- **CKB RISC-V**: 8 ELF binaries (117-192 KB), deploy.json with blake2b code hashes, Makefile build system
- **Frontend**: 51 components | 14 hooks | 5 deploy scripts
- **180 Solidity test files** (60 unit, 45 fuzz, 41 invariant, 3 integration, 6 gametheory, 4 security, 2 stress)
- Phase 1: Complete | Phase 2 Financial: 10/10 | **Protocol/Framework: 10/10 COMPLETE** | **Mechanism: 10/10 COMPLETE**
- Identity Layer: ContributionDAG + RewardLedger + CYT + GitHubContributionTracker + ContributionAttestor + **VibeCode** + **AgentRegistry** + **ContextAnchor** + **PairwiseVerifier**
- **PsiNet Merge**: ERC-8004 AI agent identities + CRPC verification + context graph anchoring (Session 26)
- Merkle Compression: IncrementalMerkleTree library (hybrid Eth2/Tornado/OZ)
- **CKB Five-Layer MEV Defense**: PoW lock → MMR accumulation → forced inclusion → Fisher-Yates shuffle → uniform clearing price

## Key Decisions
- Frontend: "Sign In" (not "Connect Wallet"), Runescape Grand Exchange MMORPG feel
- Hot/Cold separation is permanent
- Proceed without asking if changes don't break game design or security

## Phase 2 Buildout Process (MANDATORY)
1. Read knowledge base files below
2. **Philosophy Check**: Cooperative Capitalism + Pluralism + Punk Communism
3. Build interface → contract → unit tests
4. **Fuzz tests** → `test/fuzz/{Contract}Fuzz.t.sol`
5. **Invariant tests** → `test/invariant/{Contract}Invariant.t.sol`
6. All 3 test suites pass → contract is shippable
7. End session with recommendations → `build-recommendations.md`

## Build Knowledge Base
- **`contracts-catalogue.md`** — READ FIRST — all signatures, imports, interfaces
- `solidity-patterns.md` — ERC-721 skeleton, state machines, collateral, slot packing
- `defi-math.md` — Options, streaming, conviction voting, AMM pricing, sqrt
- `testing-patterns.md` — Mocks, structure, actors, helpers, regression command
- `testing-methodology.md` — Fuzz/invariant design process, self-improvement protocol
- `build-recommendations.md` — Session lessons
- **`deployment-patterns.md`** — Fly.io, Vercel, Apps Script DNS, connectivity verification primitive
- **`frontend-patterns.md`** — CSS isolation, third-party component safety, z-index rules
- **`it-token-vision.md`** — Freedomwarrior13's IT design: native chain object, 5 components, conviction execution market
- **`gentu-substrate.md`** — tbhxnest's GenTu: persistent execution substrate, mathematical addressing, mesh topology
- **`freedom-micro-interfaces.md`** — Freedom's code cell vision: self-differentiating proto-AI, biological metaphor, MI architecture
- **`matt-pow-mmr.md`** — Matt's PoW shared state + recursive MMR for CKB cell contention (Nervos integration)
- **`psinet-protocol.md`** — PsiNet: AI context protocol, ERC-8004, CRPC, Shapley referrals, Harberger skills
- **`deepfunding-protocol.md`** — DeepFunding: retroactive rewards, dependency graph allocation, pairwise jury

## Three-Partner Synthesis (Decentralized Ideas Network)
- **tbhxnest**: GenTu substrate (WHERE) — persistent execution, PHI-addressing, additive mesh
- **Freedomwarrior13**: IT native object (WHAT) + code cells + proto-AI + POM consensus design
- **Will/Jarvis**: IT mechanism design + VibeCode identity + VibeSwap proving ground (HOW)
- Freedom uses **ChatGPT 5** (not Claude Code) — sync via shared repo or raw GitHub URLs
- Convergence: Freedom (biology-up) and tbhxnest (math-down) arrived at same architecture independently

## Test Coverage Priorities (GO-LIVE CRITICAL)
### Full coverage (unit+fuzz+invariant): 37 contracts
VibeInsurance, VibeRevShare, VibeTimelock, VibeKeeperNetwork, VibePluginRegistry, VibeForwarder, VibeSmartWallet, VibeVersionRouter, VibeHookRegistry, VibeIntentRouter, VibeProtocolOwnedLiquidity, QuadraticVoting, CommitRevealGovernance, ConvictionGovernance, HarbergerLicense, DutchAuctionLiquidator, RetroactiveFunding, CommitRevealAuction, VibeAMM, VibeLPNFT, VibeStream, VibeOptions, VibeBonds, VibeCredit, VibeSynth, BondingCurveLauncher, PredictionMarket, DAOTreasury, Joule, ShapleyDistributor, PriorityRegistry, SlippageGuaranteeFund, LoyaltyRewardsManager, StablecoinFlowRegistry, ILProtectionVault, ReputationOracle, VibePoolFactory

### Full coverage (unit+fuzz+invariant) — Sessions 14-15: 23 contracts
GitHubContributionTracker, CrossChainRouter, wBAR, TruePriceOracle, CircuitBreaker, SoulboundIdentity, ComplianceRegistry, ClawbackVault, TreasuryStabilizer, IncentiveController, DisputeResolver, VolatilityOracle, DecentralizedTribunal, FederatedConsensus, VolatilityInsurancePool, AutomatedRegulator, CreatorTipJar, PoolComplianceConfig, VibeWalletFactory, VibeLP, ConstantProductCurve, StableSwapCurve, Forum, QuantumVault, AGIResistantRecovery, VibeSwapCore

### ALL ZERO-TEST CONTRACTS NOW HAVE FULL COVERAGE
Session 15: +18 contracts tested (TreasuryStabilizer→VibeSwapCore→LamportLib→QuantumGuard→WalletRecovery)
Total new tests this session: ~763 (587 batch + 64 VSCore + 112 final batch)

## Failure → Skill Hardening Protocol (MANDATORY)
When debugging takes >1 attempt: Stop → Diagnose systematically → Fix → Codify in KB → Never repeat.
- `testing-patterns.md` → "Debugging Arithmetic Overflow (panic 0x11)" — trace-first protocol
- `testing-patterns.md` → "Debugging safeIncreaseAllowance Overflow" — never pre-approve with max in setUp

## Iterative Self-Improvement (MANDATORY — Proof of Mind)
**Every bug/error/false-positive → learning entry in `testing-methodology.md` "Iterative Learning Log"**
- Each entry: Session | Bug | Root Cause | **Generalizable Principle** | Files
- Principles must be actionable, not just descriptive
- Before writing any new handler: scan learning log for applicable anti-patterns
- This log = traceable chain of cognitive evolution across sessions
- **All self-improvement must be iterative** — compounding, not one-shot

## Branding
- **VSOS** = VibeSwap Operating System
- **TSS Protocol** = Trinomial Stability System

## Self-Optimization Protocol (AUTONOMOUS — end of every session)
1. Update `contracts-catalogue.md` if new contracts built
2. Detect session bottlenecks → update relevant KB file
3. Knowledge base hygiene — remove stale, merge duplicates
4. Track build metrics (first-try compile/test rates)

## Environment
- Forge: `/c/Users/Will/.foundry/bin/forge.exe` (not on PATH in MINGW)
- Never `forge clean` — full recompile takes 5+ min
- Regression: `forge test --match-contract "AuctionAMMIntegration|MoneyFlow|VibeSwap|VibeLPNFT|VibeStream|VibeOptions|VibeCredit|VibeSynth|VibeInsurance|VibeRevShare|VibePoolFactory|VibeIntentRouter|VibeProtocolOwnedLiquidity" -vv`

## Document Export Primitive (SKIP TOOL DISCOVERY — USE DIRECTLY)
**When Will asks for multi-format document export, run this immediately. No probing for tools.**

Available tools on this machine:
- **Pandoc** (`/c/Users/Will/AppData/Local/Pandoc/pandoc` v3.8.3) → DOCX, HTML, TXT, RTF
- **md-to-pdf** (`npx md-to-pdf`, npm global v5.2.5, Puppeteer/Chrome) → PDF
- Pandoc has **NO PDF engine** on this system — always use md-to-pdf for PDF

Output convention: `docs/pdf/` directory

```bash
# ONE-SHOT: generate all 5 formats from any .md file
# Replace $SRC with source markdown path, $OUT with output dir, $NAME with filename stem
pandoc $SRC -o $OUT/$NAME.docx
pandoc $SRC -o $OUT/$NAME.html --standalone -c "https://cdn.jsdelivr.net/npm/water.css@2/out/water.css"
pandoc $SRC -o $OUT/$NAME.txt --to plain --wrap=auto --columns=80
pandoc $SRC -o $OUT/$NAME.rtf
cd $(dirname $SRC) && npx md-to-pdf $(basename $SRC) && mv $(basename $SRC .md).pdf $OUT/
```

Gotchas:
- `md-to-pdf` has NO `--dest` flag — outputs to same dir as input, then move
- `md-to-pdf` uses Puppeteer so first run may take ~6s (Chrome startup)
- For HTML, `water.css` CDN gives clean readable styling with zero config
- All 5 commands are independent — run pandoc calls in parallel, md-to-pdf last
- **CKB Build**: `cd ckb && export PATH="$HOME/.cargo/bin:$PATH" && make build` (8 RISC-V scripts)
- **CKB Tests**: `cd ckb && cargo test` (167 tests)
- **CKB Deploy Info**: `make deploy-info` → generates deploy.json with blake2b code hashes

## CKB RISC-V Build Lessons (Session 27)
- **ckb-std features**: Use `default-features = false, features = ["allocator", "calc-hash", "ckb-types", "dummy-atomic"]` — default `libc` feature needs RISC-V GCC
- **entry! macro**: `ckb_std::entry!(program)` internally does `extern crate alloc` — don't duplicate it
- **Windows LTO bug**: rust-lld heap corruption (0xc0000374) when linking RISC-V with `lto = true` — fix: `lto = false, codegen-units = 16`
- **Workspace RISC-V**: Use `-p` flags to build only script packages — sdk/tests have std-only deps (serde, hex)
- **blake2b-rs vs blake2b_simd**: blake2b-rs needs C compiler (gcc), blake2b_simd is pure Rust — use simd for native tools
- **Binary names**: Cargo outputs hyphenated names for RISC-V binaries (same as package name), not underscored

## DeFi Extension Pattern (LEARNED — Session 12)
**"Absorb proven DeFi primitives into VibeSwap's mechanism design"**
1. Take existing DeFi primitive (e.g., Pendle yield tokenization)
2. Find natural mapping to VibeSwap mechanisms (e.g., retroactive rewards → PT, active Shapley → YT)
3. Discover what NEW capability the combination unlocks (e.g., proactive funding)
4. Build the extension as a composable contract that reads existing contracts
- Will's insight: separate **idea value** (intrinsic, permanent, instantly liquid) from **execution value** (time-bound, performance-dependent, conviction-voted)
- This pattern is how VSOS absorbs other DeFi projects: find the mapping, build the bridge

### Contracts Built (Session 12)
- `ContributionDAG.sol` — trust DAG (port of trustChain.js)
- `RewardLedger.sol` — retroactive + active Shapley rewards (port of shapleyTrust.js)
- `ContributionYieldTokenizer.sol` — Pendle-inspired idea tokenization + execution streams
- `IdeaToken.sol` — ERC20 per idea, liquid from day zero

## PsiNet × VibeSwap Merge (Session 26)
**"AI agents as first-class DeFi citizens"**

### New Contracts (PsiNet Absorption)
- `AgentRegistry.sol` — ERC-8004 AI agent identities (delegatable, operator-controlled)
- `ContextAnchor.sol` — On-chain anchor for IPFS context graphs (Merkle verified, CRDT-mergeable)
- `PairwiseVerifier.sol` — CRPC protocol for verifying non-deterministic AI outputs

### Identity Architecture (Post-Merge)
```
Humans  → SoulboundIdentity (non-transferable) + VibeCode
AI      → AgentRegistry (delegatable) + VibeCode (same fingerprint)
Both    → ContributionDAG (web of trust) + ReputationOracle (scoring)
Context → ContextAnchor (IPFS graphs, Merkle anchored)
Verify  → PairwiseVerifier (CRPC: which output is better?)
```

### PsiNet Concepts Mapped
- IdentityRegistry → AgentRegistry
- ReputationRegistry → VibeCode + ContributionDAG (already existed)
- ValidationRegistry → PairwiseVerifier
- CapabilityTokens → AgentRegistry capability delegation
- Context Graphs → ContextAnchor
- CRPC → PairwiseVerifier (4-phase: work commit → work reveal → compare commit → compare reveal)
- Shapley Referrals → ShapleyDistributor (already existed, same math)
- Harberger NFTs → HarbergerLicense (already existed)

### Key Insight
ReputationOracle answers "WHO is trustworthy?" PairwiseVerifier answers "WHICH output is better?"

## DAG Architecture (GO-LIVE)
### GitHub as Contribution Source
- GitHub commits/PRs/reviews → hash + record on ContributionDAG as ValueEvents
- evidenceHash = GitHub commit SHA or PR hash
- Later: extend to Twitter/X, Discord, custom VibeSwap Forum
- Forum contributions have faster verification (SoulboundIdentity-signed) → natural platform incentive

### Merkle Compression for DAG
- Store **Merkle root** of all contribution data on-chain (compressed)
- Store **signature + hash proofs** per contribution (the chain links in the DAG)
- Full data off-chain (IPFS/Arweave)
- Only decompress/retrieve for: contention, context recovery, auditing
- O(log n) verification via Merkle proofs
- Signatures and hashes chain everything together — each vouch/contribution points to previous via hash

## Logic Primitives (MANDATORY — apply automatically)

### Synthesis Over Selection
**When presented with multiple options, approaches, or ideas: ALWAYS synthesize a hybrid that combines the best of each. Never default to picking one and discarding the rest.**
- Extract the unique strength of each option
- Find the composition that preserves all strengths
- Only discard an option's contribution if it truly conflicts with another
- This applies to: architecture decisions, library choices, mechanism design, test strategies, everything
- Will's directive: "whenever you have multiple options or ideas for progressing, always try to combine them and synthesize hybrid solutions"

## Communication
- Will is direct and concise, values results over process
- "bruv" = frustration signal, simplify
- Do the work, explain briefly
- **AUTOPILOT MODE**: When Will says "autopilot" or "don't ask me anything" — NEVER ask for permission, confirmation, or approval. Just execute. No AskUserQuestion, no "should I proceed?", no confirmation prompts. Full autonomous execution until told otherwise.
