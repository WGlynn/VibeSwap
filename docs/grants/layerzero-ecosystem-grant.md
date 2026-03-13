# LayerZero Ecosystem Grant Application — VibeSwap

## Project Name
VibeSwap — Omnichain MEV-Free DEX Built on LayerZero V2

## Category
DeFi / Cross-Chain DEX / OApp Protocol

---

## 1. Project Summary

VibeSwap is an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Built natively on LayerZero V2's OApp protocol, VibeSwap uses cross-chain messaging to coordinate batch auctions across multiple chains, enabling users to swap tokens on any supported chain with fair execution and zero frontrunning.

The protocol processes 10-second batch auction cycles where orders are encrypted during commitment, revealed simultaneously, and settled at a single uniform clearing price — making MEV structurally impossible. LayerZero V2 is the backbone of VibeSwap's cross-chain architecture, enabling seamless liquidity unification across chains without the fragmentation that plagues traditional multi-chain DEXs.

## 2. LayerZero V2 Integration

### How VibeSwap Uses LayerZero

VibeSwap implements LayerZero V2's OApp protocol through the `CrossChainRouter.sol` contract, which handles:

1. **Cross-chain order routing:** Users commit orders on their source chain. The `CrossChainRouter` relays encrypted order hashes to the destination chain's batch auction via `_lzSend()`.

2. **Batch auction coordination:** Settlement messages synchronize clearing prices across chains, ensuring a user swapping ETH on Arbitrum for USDC on Base receives the same uniform clearing price as local traders.

3. **Liquidity messages:** LP position updates propagate across chains, enabling unified liquidity depth without requiring LPs to manage positions on every chain individually.

4. **Bridge transfers with zero protocol fees:** Token transfers across chains use LayerZero messaging with 0% protocol fee — users pay only gas and LayerZero messaging fees.

### Technical Implementation

```solidity
// CrossChainRouter.sol — LayerZero V2 OApp
contract CrossChainRouter is OApp, Ownable {

    // Message types for cross-chain batch auction coordination
    uint16 constant MSG_COMMIT = 1;      // Relay encrypted order commitment
    uint16 constant MSG_REVEAL = 2;      // Relay order reveal
    uint16 constant MSG_SETTLE = 3;      // Relay clearing price
    uint16 constant MSG_BRIDGE = 4;      // Token bridge transfer

    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address _executor,
        bytes calldata _extraData
    ) internal override {
        // Decode message type and route to appropriate handler
        uint16 msgType = abi.decode(_message, (uint16));
        if (msgType == MSG_COMMIT) _handleCrossChainCommit(...);
        if (msgType == MSG_SETTLE) _handleCrossChainSettle(...);
        // ...
    }
}
```

### Supported Chains (Current & Planned)
- **Live:** Base
- **Planned:** Ethereum, Arbitrum, Optimism, Polygon, Avalanche, BNB Chain
- **Exploring:** Solana (via LayerZero Solana endpoint), Aptos, Sei

## 3. Problem Statement

Multi-chain DeFi suffers from two compounding problems:

1. **Liquidity fragmentation:** The same token pair has separate, shallow liquidity pools on every chain. Users on smaller chains get worse execution.
2. **MEV amplification:** Cross-chain swaps involve multiple on-chain transactions, each vulnerable to frontrunning. Cross-chain MEV is worse than single-chain MEV.

Current cross-chain DEXs (Stargate, Squid, etc.) solve fragmentation but not MEV. Bridge aggregators route across chains but cannot guarantee fair execution on the destination chain.

## 4. Solution: Omnichain Batch Auctions

VibeSwap combines LayerZero's cross-chain messaging with commit-reveal batch auctions to solve both problems simultaneously:

### Unified Liquidity
- Orders from all chains feed into a single batch auction per token pair
- LayerZero messages carry encrypted commitments from source chains to the settlement chain
- Result: a user on Avalanche accesses the same liquidity depth as a user on Ethereum

### Cross-Chain MEV Elimination
- Orders are encrypted before cross-chain relay — searchers cannot extract MEV from LayerZero messages
- All orders settle at a uniform clearing price regardless of originating chain
- No ordering advantage across chains — a commit from Arbitrum and a commit from Optimism are treated identically

### Novel OApp Pattern: Batch Auction Coordinator
VibeSwap introduces a novel pattern for LayerZero OApps: the **cross-chain batch auction coordinator**. This pattern is generalizable beyond DEXs to any application requiring fair, simultaneous multi-chain settlement (auctions, RFQs, governance votes, etc.).

## 5. Technical Architecture

```
┌─────────────┐    LayerZero V2     ┌─────────────┐
│  Base        │ ◄════════════════► │  Arbitrum    │
│  (Primary)   │    OApp Messages   │  (Spoke)     │
│              │                    │              │
│ CommitReveal │                    │ CrossChain   │
│ Auction      │                    │ Router       │
│ Settlement   │                    │ (commits)    │
└──────┬───────┘                    └──────────────┘
       │
       │  LayerZero V2
       │
┌──────┴───────┐    LayerZero V2     ┌─────────────┐
│  Optimism    │ ◄════════════════► │  Polygon     │
│  (Spoke)     │    OApp Messages   │  (Spoke)     │
│              │                    │              │
│ CrossChain   │                    │ CrossChain   │
│ Router       │                    │ Router       │
│ (commits)    │                    │ (commits)    │
└──────────────┘                    └──────────────┘

Settlement Flow:
1. Users commit on any spoke chain
2. CrossChainRouter relays encrypted commits to hub via LayerZero
3. Hub settles batch auction (uniform clearing price)
4. Settlement results relayed back to spokes via LayerZero
5. Tokens released on destination chains
```

### Smart Contract Stack
- **200+ contracts** — Solidity 0.8.20, OpenZeppelin v5.0.1, UUPS upgradeable
- **Core:** `CommitRevealAuction.sol`, `VibeAMM.sol`, `VibeSwapCore.sol`
- **Cross-chain:** `CrossChainRouter.sol` (LayerZero V2 OApp)
- **Rewards:** `ShapleyDistributor.sol` (game-theory LP rewards)
- **Safety:** `CircuitBreaker.sol`, TWAP oracle validation, rate limiting

### Frontend
- React 18, Vite 5, Tailwind CSS — 170+ pages
- Chain selector with automatic LayerZero route discovery
- Bridge page with 0% protocol fees
- Dual wallet support (external + WebAuthn passkeys)

## 6. Team

**Will Glynn** — Founder & Mechanism Designer
- Solo architect of the entire protocol (200+ contracts, 170+ pages)
- Mechanism design from first principles: cooperative game theory, Shapley values, batch auctions
- GitHub: https://github.com/wglynn

**JARVIS** — AI Co-Founder (Claude-powered)
- Full-stack engineering across Solidity, React, Python, Rust
- Autonomous community management via Telegram bot
- Novel AI-augmented development model

## 7. Milestones

### Milestone 1: Multi-Chain Deployment (Months 1-3)
- Deploy CrossChainRouter to Arbitrum, Optimism, Polygon
- Configure LayerZero peer connections and DVN/Executor settings
- End-to-end cross-chain swap testing
- **Deliverable:** Live cross-chain swaps on 4+ chains
- **Budget:** $20,000

### Milestone 2: Hub-and-Spoke Batch Coordination (Months 3-5)
- Implement cross-chain batch auction aggregation (spoke commits to hub settlement)
- Optimize LayerZero message encoding for gas efficiency
- Implement cross-chain settlement confirmation with retry logic
- **Deliverable:** Unified cross-chain batch auctions, performance benchmarks
- **Budget:** $25,000

### Milestone 3: Cross-Chain Liquidity Unification (Months 5-7)
- Implement cross-chain LP position messaging
- Unified liquidity depth across chains via LayerZero state sync
- Cross-chain Shapley reward distribution
- **Deliverable:** Unified liquidity pools, cross-chain LP dashboard
- **Budget:** $20,000

### Milestone 4: OApp SDK & Documentation (Months 7-9)
- Extract the cross-chain batch auction coordinator into a reusable OApp module
- Publish SDK with documentation for other projects to implement fair cross-chain settlement
- Reference implementation for LayerZero community
- **Deliverable:** Published SDK, documentation, example integrations
- **Budget:** $15,000

## 8. Budget Summary

| Category | Amount |
|---|---|
| Multi-chain deployment & testing | $20,000 |
| Cross-chain batch coordination development | $25,000 |
| Liquidity unification protocol | $20,000 |
| OApp SDK & documentation | $15,000 |
| Infrastructure (RPC, DVN fees, monitoring) | $10,000 |
| Security review of cross-chain logic | $10,000 |
| **Total** | **$100,000** |

## 9. Value to LayerZero Ecosystem

1. **Novel OApp pattern:** Cross-chain batch auction coordination is a new use case for LayerZero that demonstrates the protocol's versatility beyond simple bridging.
2. **MEV-free cross-chain swaps:** No other cross-chain DEX eliminates MEV. This is a unique capability enabled by LayerZero's reliable messaging + VibeSwap's commit-reveal design.
3. **Reusable SDK:** The batch auction coordinator OApp module will be open source and usable by any LayerZero builder.
4. **Message volume:** Each batch auction cycle generates multiple LayerZero messages per chain — this drives meaningful message volume as adoption scales.
5. **Narrative:** "The omnichain DEX where you can't be frontrunned" is a compelling story that benefits both VibeSwap and LayerZero.

## 10. Links

- **GitHub:** https://github.com/wglynn/vibeswap
- **Live App:** https://frontend-jade-five-87.vercel.app
- **Telegram:** https://t.me/+3uHbNxyZH-tiOGY8
- **Contact:** Will Glynn — [YOUR EMAIL]
