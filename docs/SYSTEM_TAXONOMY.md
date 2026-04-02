# VibeSwap System Taxonomy

**Last updated**: 2026-04-02

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
│   ├── identity/          (15)         #   ContributionDAG, SoulboundNFT, ReputationOracle
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
├── docs/                               # DOCUMENTATION (29 .md + 85 subdirs)
│   ├── trp/                            #   TRP protocol + round summaries
│   │   └── round-summaries/            #     Round 16, 17, ...
│   ├── CONTRACTS_CATALOGUE.md          #   Master contract reference
│   ├── SYSTEM_TAXONOMY.md              #   This file
│   └── [research, audit, marketing]    #   Papers, audits, strategy
│
├── script/                             # DEPLOYMENT (Deploy.s.sol, ConfigurePeers.s.sol)
├── oracle/                             # PYTHON ORACLE (Kalman filter)
├── CLAUDE.md                           # Protocol chain + boot sequence
├── WHITEPAPER.md                       # VibeSwap whitepaper
└── foundry.toml                        # Foundry profiles
```

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
