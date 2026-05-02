# VibeSwap System Taxonomy

**Last updated**: 2026-05-01

---

## Knowledge System

| Acronym | Full Name | File | Purpose |
|---------|-----------|------|---------|
| **SKB** | Shared Knowledge Base | `.claude/JarvisxWill_SKB.md` | Full-form knowledge. Loaded on fresh boot. Source of truth. |
| **GKB** | Glyph Knowledge Base | `.claude/JarvisxWill_GKB.md` | Compressed glyph form. Loaded after context compression. Derived from SKB. |
| **WAL** | Write-Ahead Log | `.claude/WAL.md` | Crash recovery. Checked first on boot. |
| **State** | Session State | `.claude/SESSION_STATE.md` | Block header, current work state. |

**SKB ↔ GKB interconnection**: SKB contains a Glyph Index mapping each section to its GKB shorthand. GKB header declares its source SKB and sync date. If SKB is modified after GKB's sync date, GKB is stale.

---

## Repository Structure

```
vibeswap/                               # Root — Omnichain DEX
├── .claude/                            # SESSION SYSTEM
│   ├── JarvisxWill_SKB.md              #   Shared Knowledge Base (full form)
│   ├── JarvisxWill_GKB.md              #   Glyph Knowledge Base (compressed)
│   ├── SESSION_STATE.md                #   Current session state
│   ├── WAL.md                          #   Write-Ahead Log
│   └── session-chain/                  #   Session continuity chain
│
├── contracts/                          # SMART CONTRACTS (~315 .sol files)
│   ├── core/              (13)         #   CommitRevealAuction, VibeSwapCore, CircuitBreaker
│   ├── amm/               (8)          #   VibeAMM, VibeLP, FeeController
│   ├── mechanism/         (102)        #   DutchAuction, OTC, NFTMarket, RetroactiveFunding
│   ├── financial/         (20)         #   VibeBonds, VibeInsurance, VibePerpetual
│   ├── incentives/        (19)         #   ShapleyDistributor, ILProtection, LoyaltyRewards
│   ├── governance/        (14)         #   DAOTreasury, Governor, Tribunal, Timelock
│   ├── identity/          (15)         #   SoulboundIdentity, ContributionDAG, ReputationOracle
│   ├── agents/            (15)         #   AgentRegistry, AgentCoordinator, JouleToken
│   ├── settlement/        (15)         #   Settlement layer
│   ├── libraries/         (15)         #   BatchMath, DeterministicShuffle, SecurityLib
│   ├── security/          (9)          #   PostQuantumShield, ZKVerifier
│   ├── compliance/        (4)          #   ComplianceRegistry, ClawbackRegistry
│   ├── oracles/           (4)          #   TruePriceOracle, VolatilityOracle
│   ├── messaging/         (1)          #   CrossChainRouter (LayerZero V2)
│   └── [+13 dirs]                      #   quantum, monetary, rwa, bridge, compute...
│
├── test/                               # TEST SUITE (~85 files, 31 subdirs)
│   ├── *.t.sol            (85)         #   Unit tests
│   ├── integration/                    #   E2E (SettlementPipelineE2E)
│   ├── fuzz/                           #   Fuzz tests
│   ├── invariant/                      #   Invariant tests
│   └── [+27 dirs]                      #   security, agents, settlement, mechanism...
│
├── frontend/src/                       # REACT FRONTEND (~456 files)
│   ├── components/        (339)        #   React components
│   ├── hooks/             (72)         #   useWallet, useDeviceWallet, useBalances
│   ├── utils/             (38)         #   Utility functions
│   └── contexts/          (6)          #   React context providers
│
├── docs/                               # DOCUMENTATION (~590 .md, 10 top-level dirs)
│   ├── README.md                       #   Top-level entry point for docs/
│   ├── INDEX.md                        #   Cross-domain index of all docs
│   ├── architecture/                   #   System architecture, patterns, protocols (12 subdirs)
│   ├── concepts/                       #   Domain concepts: 15 subdirs incl. primitives/, identity/,
│   │   │                               #     monetary/, oracles/, ai-native/, etm/, shapley/, security/
│   │   └── primitives/                 #     Knowledge primitives (10 indexed)
│   ├── research/                       #   Papers, whitepapers, essays, proofs, theorems
│   │   ├── papers/                     #     23+ research papers (knowledge-primitives-index.md)
│   │   ├── whitepapers/                #     VIBESWAP_MASTER_DOCUMENT, INCENTIVES_WHITEPAPER
│   │   ├── essays/                     #     THE_COGNITIVE_ECONOMY_THESIS, etc.
│   │   ├── proofs/                     #     Formal proofs
│   │   └── theorems/                   #     Mechanism theorems
│   ├── audits/                         #   7+ audits incl. 2026-05-01-storage-layout-followup.md
│   ├── developer/                      #   CONTRACTS_CATALOGUE, INSTALLATION, runbooks/, testing/
│   ├── governance/                     #   VIPs, VSPs, proposals, regulatory, ungovernance
│   ├── marketing/                      #   forums/ (incl. nervos/), medium/, devto/, social/, pitch/
│   ├── partnerships/                   #   usd8/, anthropic/, mit/, grants/, nervos/, framework/
│   ├── _meta/                          #   Internal: protocols/, trp/, rsi/, roadmap/, KPIs, etc.
│   │   ├── SYSTEM_TAXONOMY.md          #     This file
│   │   ├── protocols/                  #     ANTI_HALLUCINATION_PROTOCOL, ANTI_AMNESIA_PROTOCOL
│   │   └── trp-existing/               #     TRP loop specs (loop-0..3), TRP_RUNNER, efficiency-heatmap
│   └── _archive/                       #   Historical correspondence, interview prep, renders
│
├── script/                             # DEPLOYMENT (Deploy.s.sol, ConfigurePeers.s.sol)
├── oracle/                             # PYTHON ORACLE (Kalman filter)
├── CLAUDE.md                           # Protocol chain + boot sequence
├── WHITEPAPER.md                       # VibeSwap whitepaper
└── foundry.toml                        # Foundry profiles
```

**Note (2026-05-01)**: `docs/` was reorganized from a flat `DOCUMENTATION/` into the 10 top-level subdirectories above (`architecture/`, `concepts/`, `research/`, `audits/`, `developer/`, `governance/`, `marketing/`, `partnerships/`, `_meta/`, `_archive/`). Each subdir has a `README.md` index. Knowledge primitives were consolidated under `docs/concepts/primitives/`. References to the legacy `DOCUMENTATION/` path are stale and should be updated.

---

## Acronym Registry

| Acronym | Meaning | Context |
|---------|---------|---------|
| **SKB** | Shared Knowledge Base | Session system — full knowledge doc |
| **GKB** | Glyph Knowledge Base | Session system — compressed glyphs |
| **WAL** | Write-Ahead Log | Session system — crash recovery |
| **TRP** | Trinity Recursion Protocol | Self-improvement loops (R0-R4) |
| **CKB** | Common Knowledge Base (Nervos) | External blockchain — NOT our knowledge system |
| **VSOS** | VibeSwap Operating System | Phase 2 umbrella concept |
| **CRA** | CommitRevealAuction | Core contract |
| **VSC** | VibeSwapCore | Core contract |
| **AMM** | Automated Market Maker | VibeAMM contract |
| **POM** | Proof of Mind | Governance primitive |
| **AHP** | Anti-Hallucination Protocol | Verification primitive |
| **AAP** | Anti-Amnesia Protocol | Crash recovery primitive |
| **PCP** | Pre-Computation Protocol | Cost gate before expensive ops |
| **TTT** | Targeted Test Triage | Testing methodology |
| **FPT** | First Principles Triage | Bug fixing methodology |
