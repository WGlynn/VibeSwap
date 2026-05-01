# Builder Sandbox — Feature Spec

**Author**: Will + Jarvis | March 2026
**Status**: Approved for Implementation
**App Store**: Builder category (5 apps)

---

## Vision

A sandbox environment for builders who want to build something of their own but with the same foundational design principles as VibeSwap. Not just a developer portal — a full creative workshop.

> "As Above, So Below" (P-098) — the sandbox mirrors the production protocol at every level.

## The 5 Builder Apps

### 1. Builder Sandbox (`/sandbox`)
**The Workshop**. Interactive development environment where builders can:
- Fork any VibeSwap contract template with one click
- Deploy to local testnet (Anvil/Hardhat) in-browser
- Test against mock oracles, mock AMMs, mock reputation
- Share sandboxes via URL (like CodeSandbox but for smart contracts)

**Templates available:**
- **Build Your Own DEX**: Fork VibeAMM + CommitRevealAuction + BatchMath
- **Build Your Own Jarvis**: Fork agent framework + Wardenclyffe cascade + context protocol
- **Build Your Own Frontend**: Fork React UI + useWallet hooks + ethers.js patterns
- **Build Your Own Backend**: Fork oracle infrastructure + Kalman filter + keeper network
- **Build Your Own Token**: Fork JUL tokenomics + ABC bonding curve + fee distribution

### 2. VibeForge (`/forge`)
**Smart Contract IDE** with SVC templates. Features:
- Syntax-highlighted Solidity editor
- One-click compilation with error highlighting
- Gas estimation and optimization suggestions
- SVC compliance checker (validates Shapley integration points)
- Deploy to testnet or mainnet
- Automatic test generation from contract ABI

### 3. VibeClone (`/clone`)
**One-click fork** of any VibeApp:
- Select an app from the store
- Fork its contracts + frontend + tests
- Customize branding, parameters, fee structure
- Deploy as your own instance
- Automatic Shapley attribution back to original creators

### 4. VibeAPI (`/api`)
**REST & GraphQL endpoints** for all protocols:
- Pool data, price feeds, position queries
- Governance proposals and voting state
- Identity and reputation scores
- WebSocket streams for real-time updates
- API key management with rate limiting
- SDK for JavaScript, Python, Rust

### 5. VibeDocs (`/docs`)
**Interactive developer documentation**:
- Contract ABIs with live examples
- Architecture diagrams (auto-generated from imports)
- Tutorial tracks: Beginner → Advanced → Expert
- Community-contributed guides with Shapley attribution
- Live contract state explorer

## Design Principles (SVC-Native)

1. **Shapley Attribution**: Every fork tracks its lineage. Original creators earn from derivatives.
2. **Open by Default**: All templates are open source. No paywalls. No gatekeeping.
3. **Learn by Building**: Tutorials are interactive — code runs as you learn.
4. **Composable**: Every sandbox output can be imported into any other sandbox.
5. **P-098 Compliant**: The sandbox's internal structure mirrors production VibeSwap.

## Technical Architecture

```
/sandbox
├── Monaco Editor (code editing)
├── Anvil Instance (local chain per user)
├── Forge Integration (compile + test)
├── Template Registry (on-chain contract templates)
└── Share Service (IPFS-pinned sandbox states)
```

## Cross-References
- P-096: SVC — The Everything App
- P-098: As Above, So Below
- AppStore.jsx: Builder category
- All contract templates from `contracts/`
