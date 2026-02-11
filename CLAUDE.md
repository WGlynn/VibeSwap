# Claude Code Memory

---

## SESSION START PROTOCOL

**On EVERY new session or after context compression:**

```
1. Read .claude/JarvisxWill_CKB.md     → Core alignment primitives
2. Read CLAUDE.md (this file)          → Project context
3. Read .claude/SESSION_STATE.md       → Recent work state
4. git pull origin master              → Latest code
5. Resume work
```

**Common Knowledge Base**: `.claude/JarvisxWill_CKB.md` (GitHub synced)

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
3. Push to BOTH remotes: `git push origin master && git push stealth master`

**Pull first, push last = no conflicts ever.**

Example:
1. User: "Fix the login bug"
2. `git pull origin master` (get latest)
3. Fix bug (multiple tool calls)
4. Update SESSION_STATE.md, commit, push to both remotes
5. Done

This ensures real-time sync between all sessions (desktop, mobile, any device).

---

## WALLET SECURITY AXIOMS (MANDATORY DESIGN PRINCIPLES)

These axioms are derived from Will's 2018 paper on wallet security fundamentals. They are **non-negotiable** and must be heavily weighted in ALL design decisions, code implementations, and documentation.

See full paper: `docs/wallet-security-fundamentals-2018.md`

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
│   ├── governance/     # DAOTreasury, TreasuryStabilizer
│   ├── incentives/     # ShapleyDistributor, ILProtection, LoyaltyRewards
│   ├── messaging/      # CrossChainRouter (LayerZero)
│   └── libraries/      # DeterministicShuffle, BatchMath, TWAPOracle
├── test/               # Foundry tests (fuzz/, security/, integration/)
├── script/             # Deploy.s.sol, ConfigurePeers.s.sol
├── frontend/src/       # React components, hooks, utils
├── oracle/             # Python Kalman filter price oracle
└── docs/               # Whitepapers and mechanism design docs
```

### Core Mechanism (10-second batches)
1. **Commit Phase (8s)**: Users submit `hash(order || secret)` with deposit
2. **Reveal Phase (2s)**: Reveal orders + optional priority bids
3. **Settlement**: Fisher-Yates shuffle using XORed secrets, uniform clearing price

### Common Commands
```bash
# Contracts
forge build
forge test -vvv
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast

# Frontend
cd frontend && npm run dev    # Port 3000

# Oracle
pip install -e oracle/
python -m oracle.main
```

### Key Contracts
- `CommitRevealAuction.sol` - Batch auction mechanism
- `VibeAMM.sol` - Constant product AMM (x*y=k)
- `VibeSwapCore.sol` - Main orchestrator
- `ShapleyDistributor.sol` - Game theory reward distribution
- `CrossChainRouter.sol` - LayerZero messaging

### Coding Conventions
- Solidity: OpenZeppelin patterns, UUPS proxies, `nonReentrant` guards
- Comments: Section headers with `// ============ Name ============`
- Frontend: Functional components, custom `useWallet` hook
- Python: black formatter, 100 char lines, type hints, pytest

### Philosophy
"Cooperative Capitalism" - Mutualized risk (insurance pools, treasury stabilization) + free market competition (priority auctions, arbitrage)

### Security Features
- Flash loan protection (EOA-only commits)
- TWAP validation (max 5% deviation)
- Rate limiting (1M tokens/hour/user)
- Circuit breakers (volume, price, withdrawal thresholds)
- 50% slashing for invalid reveals

---

## Recent Session State (Feb 2025)

### Just Completed
- Fixed wallet detection for BOTH external wallets (MetaMask etc) AND device wallets (WebAuthn/passkeys)
- All pages now use combined wallet state: `isConnected = isExternalConnected || isDeviceConnected`
- BridgePage: Fixed layout overflow, button says "Send" not "Get Started", 0% protocol fees
- Created `useBalances` hook for balance tracking (mock + real blockchain)
- Deployed to Vercel: https://frontend-jade-five-87.vercel.app

### Key Patterns
```javascript
// Dual wallet detection pattern used across all pages:
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Important Files Recently Modified
- `frontend/src/components/HeaderMinimal.jsx` - Main header with wallet button
- `frontend/src/components/BridgePage.jsx` - Send money page (0% fees, LayerZero bridge)
- `frontend/src/hooks/useBalances.jsx` - Balance tracking for demo/real modes
- `frontend/src/hooks/useDeviceWallet.jsx` - WebAuthn/passkey wallet

### Git Remotes
- `origin`: https://github.com/wglynn/vibeswap.git (public)
- `stealth`: https://github.com/WGlynn/vibeswap-private.git (private)
- Both repos have identical content, push to both when committing

