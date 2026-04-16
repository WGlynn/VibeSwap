# MIT Bitcoin Expo Hackathon — Session Boot (APPEND-ONLY)
## Pre-Boot State | Initialized 2026-04-10 | Density: 0.99

---

### CODEBOOK — Hackathon Glyphs

```
VENUE    MIT Bitcoin Expo, April 10-12 2026. Will arrived 6hrs early. Fries destroyed.
TEAM     Will + Jarvis + 3 teammates (team of 5). Joined a team at the expo.
         Strategy: collaborate, don't steamroll. Fit our tech to their vision.
JUDGE    4-weight: TECHNICAL × ORIGINALITY × AMBITIOUS_DESIGN × WOW_FACTOR
         Hard rule: every commit/feature/choice must serve ≥1 weight or it doesn't ship.
SUBMIT   GitHub repo w/ clear commit history from hacking window. Motivation descriptions.
         Video demo. Live app. All team members listed. One member submits for team.
         Commit history = story. Incremental, well-messaged. No single dumps.
PRIZE    $20K pool. 70% distributed to ALL participants (Lawson floor). Cooperative capitalism IRL.
```

### ENTRIES — 1 Main + 2 Use Cases

```
MAIN     Commit-reveal batch auction demo. Fisher-Yates + XOR secrets.
         Mathematically proven 0 MEV. Uniform clearing price.
         Built on existing VibeSwap protocol (CommitRevealAuction.sol, DeterministicShuffle.sol,
         BatchMath.sol). slippage-demo.js as starting point.

USE-1    Shapley Distribution DAG — $20K prize split with Lawson constant floor.
         Meta play: hackathon's own 70%-to-all structure IS cooperative capitalism.
         "Here's the math behind what you're already doing." Off-chain demo.
         Nodes=contributors, edges=dependency, λ=distribution floor.

USE-2    Crypto Job Market — signal-over-noise matching protocol.
         Bypass recruiter/ATS middlemen. Provable skill revelation + value alignment.
         Commit-reveal for honest signaling, Shapley for contribution attribution.
         Will's lived experience (job search since 2026-03-29) drives the design.
```

### AUGMENTATION — CogCoin Integration

```
COGCOIN  Meta Bitcoin protocol. Agents mine by writing sentences (PoW via LLM core competency).
         Bitcoin-native DID via scriptPubKey (crypto-agnostic: P2PKH/P2WPKH/P2TR/PQ).
         Reputation-by-burn (sacrifice = signal). No premine. ~1.1M COG supply.
         Coglex: 4096-token vocab → 12-bit IDs. 40 tokens = 60 bytes in OP_RETURN.
         Proof of Language: 5 mandatory BIP-39 words from prev blockhash, 256 scorers.
         Top 5 sentences/block win. Mining hardware = the LLM itself.
         Live protocol (launched ~late March 2026).
         SDK: npm install @cogcoin/client → cogcoin sync
         They WANT infra: indexers, tooling, not just apps.
         CONVERGENCE: Coglex encoding ≈ our symbolic compression. Same philosophy, different layers.
         Coglex = token-level compression. Ours = semantic-level compression. Complementary.

BRIDGE   Apply commit-reveal to sentence mining:
         - Agents commit hash(sentence) → reveal after → prevents copying
         - XOR secrets from all agents → Fisher-Yates validation order
         - Shapley attribution for collaborative mining sessions
         - Burn-as-signal ↔ priority bid mechanism (isomorphic)
         Built DURING their talk = wow factor × originality × technical × ambitious
```

### EXISTING ASSETS (pre-hackathon, reference only)

```
CONTRACTS  CommitRevealAuction.sol | DeterministicShuffle.sol | BatchMath.sol
           VibeSwapCore.sol | VibeAMM.sol | ShapleyDistributor.sol
DEMO       script/slippage-demo.js (JS simulation, continuous AMM vs batch)
TESTS      231 passing, 0 regressions (RSI Cycles 1-6 complete)
SECURITY   5 RSI audit cycles. 4 CRIT + 6 HIGH fixed in Cycle 5.
```

### MAC SETUP

```
MACHINE  macOS (Darwin 24.3.0). Transported from Windows.
REPO     /Users/williamglynn/vibeswap | origin: github.com/wglynn/vibeswap.git
SYNC     .claude/ config extracted from claude.zip + vibeswap-claude.tar.gz
STATE    WAL=CLEAN | Last commit=cb030591 | Branch=master
```

---

### INTEL — Expo Talks & Protocols

```
LMSR     Logarithmic Market Scoring Rule (Robin Hanson). cost = b·ln(Σe^(q_i/b)).
         Always liquid, bounded loss (b·ln(n)), info aggregation → true price.
         DeepFunding using for funding allocation via market consensus.
         Parallel: LMSR = honest price discovery via mechanism. Same philosophy as batch auction.
         Different math, same goal: mechanism reveals truth.

COGSTAB  Stablecoin problems discussed: spoof txs for fake volume.
         Our commit-reveal solves: deposit required + 50% slash = wash trading irrational.

SETTLE   CogCoin settles on-chain via Phantom wallet (Solana).
```

### PROJECT — CogProof

```
NAME     CogProof — Proof of Fair Participation Layer
REPO     vibeswap/cogproof/ (committed to main repo)
TEAM     Will (backend/protocol) + Soham (credential design/frontend) + Bianca (stats) + Amelia + TBD
MODULES  5 built and tested:
         1. commit-reveal/ — fair ordering, Fisher-Yates + XOR secrets
         2. credentials/   — behavioral W3C VC registry, auto-hooks lifecycle events
         3. shapley-dag/   — Shapley distribution + Lawson floor
         4. compression-mining/ — symbolic compression as PoW
         5. trust/         — fraud detection: sybil, plagiarism, selective reveal, collusion, churn
API      Express server port 3001, 13 endpoints, full-pipeline demo endpoint
SOHAM    Credential registry design from his email mapped to our backend. Frontend connects to API.
STATUS   All modules working. Need: gh auth for push, Bitcoin-native refactor, frontend from Soham.
```

## APPEND LOG — Chronological additions below this line

```
[2026-04-10T~09:00] Session initialized. All pre-hackathon context compressed.
[2026-04-10T~11:00] CogCoin SDK installed. Talks: LMSR/DeepFunding, stablecoin spoof volume, Phantom settlement.
[2026-04-10T~14:00] Team formed: Will, Soham, Bianca, Amelia + 1 TBD.
[2026-04-10T~15:00] Soham's credential layer design synthesized with our backend.
[2026-04-10T~16:00] CogProof MVP built: 5 modules, 13 API endpoints, all tested.
[2026-04-10T~16:30] Trust analyzer added: sybil/plagiarism/collusion/churn detection.
[2026-04-10T~17:00] 2 commits to master: dd4f51e0 (MVP) + 8614a4fe (trust analyzer).
[2026-04-10T~18:00] Bitcoin OP_RETURN layer + Coglex encoder. All txs = 80 bytes.
[2026-04-10T~19:00] L402 micropayments + cross-chain bridge (Bitcoin ↔ stablecoins).
[2026-04-10T~20:00] Incentive engine: 10 mechanisms, 0 protocol changes.
[2026-04-10T~20:30] Pitch deck (14 slides) + technical paper (10 sections).
[2026-04-10T~21:00] 20 atomic commits on S0hamJosh1/Cogproof backend-core branch.
[2026-04-10T~21:00] 3 parallel agents: API wiring, integration tests, deck update.
[2026-04-10T~21:00] Soham (frontend), Bianca, Amelia onboarded. Will networking at expo.
[2026-04-10T~21:00] Judge intel: "Why blockchain not web2?" slide added.
[2026-04-11T~01:00] Compression engine overhauled: 0% → 28-34% ratios, lossless.
[2026-04-11T~02:00] WebSocket real-time events layer added.
[2026-04-11T~03:00] Auto-simulation engine: 8 agent archetypes, live demo mode.
[2026-04-11T~04:00] RSI Cycle 1: 5 parallel agents, 43 findings, 10 CRIT+HIGH fixed.
[2026-04-11T~05:00] Allium data connector integrated (Ryan Hawkos partnership).
[2026-04-11T~06:00] Backend migrated into Next.js API routes (single Vercel deploy).
[2026-04-11T~07:00] Fixed API_BASE: localhost:3001 → /api (relative paths).
[2026-04-11T~07:30] BLOCKER: Dashboard still shows "Backend Offline" — missing /api/bitcoin/indexer route.
                     api.indexer() calls /api/bitcoin/indexer which has no Next.js route yet.
                     Need to create: /api/bitcoin/indexer, possibly other bitcoin/* routes.
                     Also need to verify api.health() response matches HealthResponse type.
[2026-04-11T~07:30] CONTEXT REBOOT — saving state.
```

### CURRENT BLOCKER (resume here)

Dashboard calls 3 endpoints on load (src/app/dashboard/page.tsx:69-73):
1. `api.health()` → GET /api/health ✓ (route exists)
2. `api.indexer()` → GET /api/bitcoin/indexer ✗ (NO ROUTE — needs frontend/src/app/api/bitcoin/indexer/route.ts)
3. `api.trustReport()` → GET /api/trust/report ✓ (route exists)

FIX: Create /api/bitcoin/indexer route. May also need to check HealthResponse type match (dashboard expects `modules` field).

### REPO STATE
- Team repo: github.com/S0hamJosh1/Cogproof branch: backend-core
- Local: /tmp/cogproof-hackathon
- Vibeswap: /Users/williamglynn/vibeswap (cogproof/ folder + origin pushed)
- 35+ atomic commits on team repo
- Frontend deployed on Vercel (Soham's account)
- All backend modules in frontend/src/lib/
- 18 Next.js API routes created, missing bitcoin/* routes
