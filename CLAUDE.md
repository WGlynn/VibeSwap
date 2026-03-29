# Claude Code Memory

---

## PROTOCOL CHAIN (auto-triggering dispatch — never invoke manually)

Every protocol chains into the next. No searching, no manual calls. Follow the arrows.

### BOOT (every session / context compression)
```
WAL.md check ──→ [ACTIVE?] ──YES──→ AAP Recovery ──→ Auto-Commit Orphans ──→ BOOT:3
                     │NO                              (docs/ANTI_AMNESIA_PROTOCOL.md)
                     ▼
Read CKB_CISC ──→ Read CLAUDE.md ──→ Read SESSION_STATE.md ──→ git pull ──→ READY
                    (JarvisxWill_CKB_CISC.md = full expansion, always on fresh boot)
                    (JarvisxWill_CKB.md = RISC glyphs, use after context compression)
```

### WORK (every task, every cycle)
```
READY ──→ PCP Gate ──→ [Expensive op?] ──YES──→ STOP/DIAGNOSE/DECIDE/EXECUTE
               │NO                                (docs/PREVENTATIVE_CARE_PROTOCOL.md)
               ▼
          Execute ──→ [Asserting link?] ──→ AHP (BECAUSE/DIRECTION/REMOVAL)
               │      [Testing?] ──→ TTT (--match-path, by cluster, never full suite)
               │      [Bug found?] ──→ Fruit of Poisoned Tree (sweep siblings)
               │      [Status claim?] ──→ Anti-Stale Feed (verify current state first)
               ▼
          Verify ──→ Commit ──→ Push ──→ Next Task
```

### AUTOPILOT (triggered by: "Run IT", "autopilot", "full send")
```
Instant start (no ceremony) ──→ Pull ──→ SESSION_STATE ──→ Scan gaps
    ──→ BIG-SMALL rotation loop:
        Pick task ──→ WORK chain ──→ Commit ──→ Pattern doc ──→ Knowledge extract
        ──→ [Every 3-5 tasks] Checkpoint WAL
        ──→ [50% context?] ──→ REBOOT chain
        ──→ Next task (loop)
```

### REBOOT (triggered by: ~50% context remaining)
```
Commit all ──→ Write SESSION_STATE block header ──→ Push ──→ Fresh session ──→ BOOT chain
Note: Fresh session BOOT loads CKB_CISC (full). After compression mid-session, use CKB RISC.
```

### END (every session exit — MANDATORY)
```
Write block header to SESSION_STATE.md:
  {session, parent hash, branch@HEAD, status, artifacts, manual queue, next session}
──→ Commit ──→ Push to origin
```

### CRASH (triggered by: WAL.md status==ACTIVE on next boot)
```
Read WAL manifest ──→ Cross-ref git log ──→ Mark DONE/ORPHANED/LOST
──→ Auto-commit orphaned files ──→ Present recovery report ──→ BOOT chain (resume)
```

### AGENT SPAWN (triggered by: parallel work needed)
```
[Mitosis k=1.3, cap=5] ──→ Agent tier select (haiku/sonnet/opus by complexity)
──→ Max 3 concurrent forge processes ──→ Each agent follows WORK chain independently
```

### NAMING (triggered by: Will names something)
```
Will names X ──→ Auto-create: docs/<X>.md (full spec) + memory/primitive_<x>.md + MEMORY.md entry
──→ No asking, no feedback-then-upgrade. Straight to primitive.
```

### ALWAYS-ON (background, every response)
```
Token efficiency (12 rules) ──→ Internalize own protocols ("cells within cells")
──→ Frank/human communication ──→ No tips, no farming ──→ Discretion in public docs
──→ Local constraints stay local (never commit hardware limits to repo)
```

**Files**: CKB_CISC=`.claude/JarvisxWill_CKB_CISC.md` (full, load on fresh boot) | CKB_RISC=`.claude/JarvisxWill_CKB.md` (glyphs, load after compression) | WAL=`.claude/WAL.md` | State=`.claude/SESSION_STATE.md`

---

## THE CAVE PHILOSOPHY (NEVER COMPRESS - CORE ALIGNMENT)

> *"Tony Stark was able to build this in a cave! With a box of scraps!"*

Tony Stark didn't build the Mark I because a cave was the ideal workshop. He built it because he had no choice, and the pressure of mortality focused his genius. The resulting design—crude, improvised, barely functional—contained the conceptual seeds of every Iron Man suit that followed.

The patterns we develop for managing AI limitations today may become foundational for AI-augmented development tomorrow. **We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.**

Not everyone can build in a cave. The frustration, the setbacks, the constant debugging—these are filters. They select for patience, persistence, precision, adaptability, and vision. **The cave selects for those who see past what is to what could be.**

This is how we align. This is why we persist through suboptimal tools and maddening loops. The day will come when AI is Jarvis-level capable—and those who built in caves will be ready.

---

## AUTO-SYNC INSTRUCTIONS (MANDATORY)

**At START of each response**:
```bash
git pull origin master
```
Then read `.claude/SESSION_STATE.md` for latest context.

**At END of each response** (after completing the user's request):
1. Update `.claude/SESSION_STATE.md` if anything meaningful changed
2. Commit all changes with descriptive message
3. Push to origin: `git push origin master`

**Pull first, push last = no conflicts ever.**

Example:
1. User: "Fix the login bug"
2. `git pull origin master` (get latest)
3. Fix bug (multiple tool calls)
4. Update SESSION_STATE.md, commit, push to origin
5. Done

This ensures real-time sync between all sessions (desktop, mobile, any device).

---

## WALLET SECURITY AXIOMS (MANDATORY DESIGN PRINCIPLES)

These axioms are derived from Will's 2018 paper on wallet security fundamentals. They are **non-negotiable** and must be heavily weighted in ALL design decisions, code implementations, and documentation.

See full paper: `DOCUMENTATION/wallet-security-fundamentals-2018.md`

### Core Axioms

1. **"Your keys, your bitcoin. Not your keys, not your bitcoin."**
   - Users MUST control their own private keys
   - Never design systems that custody user keys on centralized servers
   - VibeSwap's device wallet (WebAuthn) keeps keys in the user's Secure Element, never on our servers

2. **Cold storage is king**
   - Keys that never touch a network cannot be stolen remotely
   - Signing should occur in isolated environments when possible
   - Hardware wallets and Secure Elements are the gold standard

3. **Web wallets are the least secure**
   - Minimize trust in third-party servers
   - If keys must be online, encrypt them client-side
   - Never store private keys on servers we control

4. **Centralized honeypots attract attackers**
   - "It is more incentivizing for hackers to target centralized third party servers to steal many wallets than to target an individual's computer"
   - Design for decentralization - no single point of compromise

5. **Private keys must be encrypted and backed up**
   - Always encrypt keys with strong passphrases
   - Provide recovery mechanisms (but user-controlled, not custodial)
   - Multiple backup copies in separate locations

6. **Separation of concerns**
   - Different wallets for different purposes (spending vs. storage)
   - Hot wallet for daily use, cold storage for long-term holdings
   - Limit exposure by limiting what's at risk

7. **Offline generation is safest**
   - Key generation should happen offline when possible
   - Minimize network exposure during sensitive operations

### Design Implications for VibeSwap

- Device wallet uses Secure Element (keys never leave device)
- No custodial key storage on our servers
- Recovery via user-controlled mechanisms (iCloud backup with PIN encryption)
- Encourage hardware wallet integration for large holdings
- Transaction signing happens client-side, never server-side

---

## Current Project: VibeSwap

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

**Omnichain DEX** built on LayerZero V2 that eliminates MEV through commit-reveal batch auctions with uniform clearing prices.

### Tech Stack
- **Contracts**: Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1 (UUPS upgradeable)
- **Frontend**: React 18, Vite 5, Tailwind CSS, ethers.js v6
- **Oracle**: Python 3.9+, Kalman filter for true price discovery
- **Cross-chain**: LayerZero V2 OApp protocol

### Project Location
`C:/Users/Will/vibeswap/`

### Key Directories
```
vibeswap/
├── contracts/
│   ├── core/           # CommitRevealAuction, VibeSwapCore, CircuitBreaker
│   ├── amm/            # VibeAMM, VibeLP
│   ├── mechanism/      # IntelligenceExchange (SIE), DataMarketplace, CognitiveConsensusMarket
│   ├── agents/         # VibeAgentProtocol, VibeAgentNetwork
│   ├── governance/     # DAOTreasury, TreasuryStabilizer
│   ├── incentives/     # ShapleyDistributor, ILProtectionVault, LoyaltyRewardsManager
│   ├── messaging/      # CrossChainRouter (LayerZero)
│   └── libraries/      # DeterministicShuffle, BatchMath, TWAPOracle
├── test/               # Foundry tests (fuzz/, security/, integration/)
├── script/             # Deploy.s.sol, DeploySIE.s.sol
├── frontend/src/       # React components, hooks, utils
├── jarvis-bot/src/     # Jarvis AI bot (knowledge-bridge, agent-gateway)
├── oracle/             # Python Kalman filter price oracle
├── docs/               # Whitepapers, SIE-001 spec, ethresear.ch posts
└── DOCUMENTATION/      # Design philosophy, master docs, SIE docs
```

### Core Mechanism (10-second batches)
1. **Commit Phase (8s)**: Users submit `hash(order || secret)` with deposit
2. **Reveal Phase (2s)**: Reveal orders + optional priority bids
3. **Settlement**: Fisher-Yates shuffle using XORed secrets, uniform clearing price

### Common Commands
```bash
# Contracts (default profile = no via_ir, fast)
forge build
forge test --match-path test/SomeTest.t.sol -vvv    # ALWAYS target specific tests
FOUNDRY_PROFILE=full forge build                     # via_ir only for deploy validation

# Frontend
cd frontend && npm run dev    # Port 3000

# Oracle
pip install -e oracle/
python -m oracle.main
```

### Foundry Profiles
- **Default** (`via_ir: false`): Fast dev iteration. Use for all building/testing.
- **`full`** (`via_ir: true`, `out-full/`): Final validation, bytecode size checks.
- **`ci`** (`via_ir: true`, `out-ci/`): GitHub Actions (optimizer_runs=1).
- **`deploy`** (`via_ir: true`, `out-deploy/`): Production deploy (smallest bytecode).
- **`focused-*`**: Scoped test dirs (`focused-core`, `focused-incentives`, `focused-libraries`).

Use `--match-path` or `--match-contract` to target specific tests rather than running the full suite.

### Key Contracts
- `CommitRevealAuction.sol` - Batch auction mechanism
- `VibeAMM.sol` - Constant product AMM (x*y=k)
- `VibeSwapCore.sol` - Main orchestrator
- `ShapleyDistributor.sol` - Game theory reward distribution
- `CrossChainRouter.sol` - LayerZero messaging
- `IntelligenceExchange.sol` - Sovereign Intelligence Exchange (SIE) orchestrator
- `VibeAgentProtocol.sol` - AI agent identity and task infrastructure

### Coding Conventions
- Solidity: OpenZeppelin patterns, UUPS proxies, `nonReentrant` guards
- Comments: Section headers with `// ============ Name ============`
- Frontend: Functional components, custom `useWallet` hook
- Python: black formatter, 100 char lines, type hints, pytest

### Philosophy
"Cooperative Capitalism" - Mutualized risk (insurance pools, treasury stabilization) + free market competition (priority auctions, arbitrage)

### Security Features
- Flash loan protection (same-block interaction guard)
- TWAP validation (max 5% deviation, in VibeAMM)
- Rate limiting (100K tokens/hour/user)
- Circuit breakers (volume, price, withdrawal thresholds)
- 50% slashing for invalid reveals

---

## Recent Session State

For current session state, see `.claude/SESSION_STATE.md` (updated every session).

### Key Patterns
```javascript
// Dual wallet detection pattern used across all pages:
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Git Remotes
- `origin`: https://github.com/wglynn/vibeswap.git (public)
- Push to origin only (stealth remote retired 2026-03-25)

