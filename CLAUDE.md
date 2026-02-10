# Claude Code Memory

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

