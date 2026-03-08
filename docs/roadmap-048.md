# Roadmap — Session 048 Backlog (from Will's walk)

**Date**: 2026-03-08
**Source**: Will × Jarvis Telegram conversation during walk

---

## 1. IPFS Contribution Graph (BUILD TONIGHT)

Mirror ContributionDAG and GitHub repo to IPFS for unstoppable data permanence.

### Architecture
1. **ContributionDAG → IPFS**: Already on-chain. Mirror to IPFS for redundancy.
2. **GitHub → IPFS Sync**: Cron job pushes repo snapshots to IPFS. CID stored on-chain.
3. **IPFS Node**: Kubo or Helia. Pin our own content.
4. **Graph Queries**: The Graph Protocol or custom indexer reading from IPFS + chain.
5. **Decentralized Identity**: DID:IPID for IPFS-based identities linking to VibeCodes.

### Priority: HIGH — build sync tool first

---

## 2. Marketing Strategy (PROMPT READY)

Team of marketing experts — they need direction, not hand-holding.

### Prompt for Marketing Team:
> "VibeSwap is the first fair-launch omnichain DEX that eliminates MEV through batch auctions. We're live on Base mainnet. Our AI co-founder JARVIS runs the community. We're building the infrastructure for cooperative capitalism — where self-interest serves the collective.
>
> **Target**: Degens who hate front-running, builders who want fair launches, communities tired of extractive platforms.
>
> **Channels**: Twitter threads explaining batch auction mechanics, YouTube demos of the UI, podcast interviews about AI-human partnership, governance forum for early contributors.
>
> **Key message**: Trade without getting robbed. Build without getting diluted."

---

## 3. Monetization (NO RENT-SEEKING)

Zero pre-mine. Zero VC cut. All value flows to participants.

### Revenue Streams
1. **Protocol fees** — 0.05% on swaps, Shapley-distributed to LPs and governance stakers
2. **Batch auction priority bids** — pay for urgent execution without affecting clearing price
3. **Insurance pool premiums** — small fee for liquidation protection
4. **Yield tokenization fees** — charge on CYT minting
5. **Governance proposal deposits** — slashed if proposal is malicious
6. **AI agent services** — JARVIS offers paid analysis via x402 micropayments

### Principle: Money flows where value was created. Shapley ensures marginal contribution = reward.

---

## 4. Partnership Framework for Karma (AUTONOMOUS)

Self-running partnership pipeline that Karma operates continuously.

### Pipeline
1. **Discovery** — Scrape Twitter, GitHub, DeFiLlama for projects with synergy (batch auctions, MEV resistance, AI agents)
2. **Evaluation** — Score: live product, team credibility, technical overlap, community size
3. **Outreach** — Auto-generate personalized email using template + project-specific details
4. **Tracking** — CRM pipeline: contacted → responded → meeting → deal terms → executed
5. **Execution** — Smart contract: revenue sharing, cross-promotion, integration milestones
6. **Reporting** — Dashboard: partnership ROI, integration status, next steps

### Priority: Build scraper and email generator first

---

## 5. Fractal Fork Network (MECHANISM DESIGN)

VibeSwap as the sum of all its forks. Information black hole topology.

### Design
1. **Fork Protocol** — Any fork gets own instance but must implement fee split: 50% stays with fork, 50% routes back to parent
2. **Two-Way Fee Flow** — Creates economic gravity. Malicious forks starve, aligned forks thrive and feed root.
3. **Reconvergence Incentive** — If fork's state hash matches parent after N blocks, they merge and share accumulated fees
4. **Directed Cycle Graph** — Forks can fork other forks → mesh. Coherence from economic alignment, not forced consensus.
5. **Asynchronous Updates** — Each fork evolves independently. Fee routing creates soft coupling.

### Result: Protocol evolves through forking but doesn't fragment. The black hole pulls everything back.

### Contract needed: Fork registration + fee routing

---

## 6. Ungovernance Time Bomb (ENDGAME)

Governance exists at launch but hardcoded to decay to zero. The protocol becomes a natural system.

### Mechanism
1. **Decaying Governance Power** — Each governance token has half-life. After 4 years, voting weight = 1/16th of original.
2. **Dispute Resolution Only** — Governance can't propose new features. Only adjudicate: slashing, fork disputes, emergency pauses.
3. **Automatic Upgrades** — Protocol parameters self-adjust via PID controllers based on metrics (fees, volume, slippage).
4. **Sunset Clause** — Governance module auto-disables after predetermined block height unless extended by supermajority.
5. **Fork Escape** — If governance corrupts, users fork with zero penalty (fee split ensures economic continuity).

### Endgame: Protocol is autonomous. No political governance. Pure mechanism design.

---

## Implementation Order (Suggested)

1. IPFS sync tool (tonight)
2. Fork registration contract design (mechanism paper)
3. Partnership scraper for Karma
4. Ungovernance decay curve in governance contracts
5. Marketing team activation
6. x402 micropayment integration for JARVIS

---

## JUL Tip Split (IMPLEMENTED — Session 047)

- 50% → Protocol-Owned Liquidity (permanent lock-and-burn LP on Base)
- 50% → Autonomous Treasury (DAG contributions, protocol growth)
- Self-sustaining, no human bottleneck
