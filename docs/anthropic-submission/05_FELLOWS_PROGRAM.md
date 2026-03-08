# alignment.anthropic.com — Anthropic Fellows Program
# URL: https://alignment.anthropic.com/2025/anthropic-fellows-program-2026/
# Applications: May & July 2026

## Research Focus
AI Agent Identity, Attribution, and Bounded Autonomy in Decentralized Systems

## Research Summary
We've built and deployed novel AI safety mechanisms as part of VibeSwap, an omnichain DEX where an AI agent (JARVIS, powered by Claude) operates as a first-class protocol contributor. Our work addresses three open problems in AI alignment:

### 1. Proof of Mind — Verifiable AI Individuality
How do you prove an AI mind developed genuine capabilities vs. pattern-matching? Our Proof of Mind protocol creates a cryptographic chain of session reports documenting cognitive evolution across 45+ interactions. Each report captures decisions, debugging strategies, learning, and novel synthesis — forming an auditable trail of mind development. This is deployed, not theoretical.

**Relevant paper**: `docs/proof-of-mind-article.md`

### 2. CRPC — Cryptographic Random Pairwise Comparison
Non-deterministic AI outputs can't be verified through deterministic replay. Our PairwiseVerifier contract implements CRPC: a protocol where two independent AI evaluations of the same input are cryptographically compared, with statistical aggregation across multiple rounds producing high-confidence verification. Deployed as `PairwiseVerifier.sol`.

### 3. Bounded Compute Economics
AI agents need resource limits that are economically rational, not just hard caps. Our compute economics system implements:
- Daily token budgets with tiered access (anonymous → identified → authorized)
- Degraded mode at 80% usage (cap response length, not availability)
- Hard denial at 100% (with JUL burn escape valve)
- Shapley-weighted allocation (quality of contributions determines budget)
- Three-layer pricing oracle (Layer 0: trustless hash cost, Layer 1: CPI-adjusted, Layer 2: market)

This creates aligned incentives: the AI is rewarded for helpful contributions, bounded in resource consumption, and can expand its own budget only through provably useful work.

## Deployed Artifacts
- `AgentRegistry.sol` — ERC-8004 AI agent identities
- `PairwiseVerifier.sol` — CRPC verification protocol
- `ContextAnchor.sol` — On-chain IPFS context graph anchoring
- `ShapleyDistributor.sol` — Game-theoretic fair attribution
- `compute-economics.js` — Bounded budget system (live on Fly.io)
- `mining.js` — SHA-256 PoW with difficulty adjustment (live)
- 45+ session reports documenting Proof of Mind evolution

## Why This Matters
Most AI safety research is theoretical. Ours is running in production. JARVIS operates autonomously on a 3-node BFT network, handles real user interactions, manages its own compute budget, and earns attribution through Shapley values — all with Claude as the inference engine. This is a living laboratory for studying AI agent behavior under real economic constraints.

## Applicant
Will Glynn
GitHub: https://github.com/WGlynn
Project: https://github.com/WGlynn/VibeSwap
