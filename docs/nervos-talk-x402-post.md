# x402 on VibeSwap: Machine-to-Machine Payments for Agent Intelligence

**Posted by**: Will Glynn (@faraday1)
**Category**: Development / DeFi / Agent Infrastructure

---

## The Problem

Every AI agent that calls an API today does so with an API key issued by a human. The human pays a monthly subscription. The agent has no economic agency of its own.

This creates a bottleneck: AI agents can't autonomously pay for services, can't route around rate limits, and can't participate in markets as first-class economic actors.

HTTP status code 402 — Payment Required — was reserved in 1999 for "future use." 27 years later, we're using it.

## What We Built

VibeSwap's web API now implements x402: a payment-gated middleware where any endpoint can require micropayment before serving a response.

### How It Works

1. Agent requests a premium endpoint (e.g., `/web/chat` — talk to JARVIS)
2. Server returns `402 Payment Required` with payment instructions:
   - Treasury address
   - Amount in VIBE/ETH/USDC
   - Accepted tokens
3. Agent sends payment on-chain
4. Agent retries with `X-Payment-Proof: <tx_hash>` header
5. Server validates, serves response, issues signed receipt for future requests

### Three Verification Layers (Fastest First)

1. **Signed Receipt** (HMAC-SHA256) — pure crypto, zero I/O. After one on-chain verification, subsequent requests use a cryptographically signed receipt. No RPC calls needed.

2. **Bloom Filter** (O(1)) — 64K-bit filter with 7 hash functions. Previously verified tx hashes are checked in constant time. False positive rate: ~0.8% at capacity.

3. **On-Chain Verification** (RPC) — full transaction receipt validation. Only used for first-time proofs. Issues signed receipt for all future requests.

### Pricing Tiers

| Tier | Price | Endpoints |
|------|-------|-----------|
| FREE | 0 | Health, covenants, token supply, lexicon |
| LOW | 100 wei | Mind state, mesh topology, mining stats, search |
| MEDIUM | 1,000 wei | Chat, TTS, predictions, reports |
| HIGH | 10,000 wei | Streaming chat, CRPC demo |

## Why This Matters for Nervos/CKB

The x402 stack is chain-agnostic by design. The payment proof is a transaction hash — it works on any EVM chain, and with minimal adaptation, on CKB's cell model.

The deeper connection: **x402 + CRPC + ERC-8004 = autonomous agent infrastructure**.

- **ERC-8004**: On-chain identity for AI agents (delegatable authority, operator-controlled)
- **x402**: Payment layer (agents pay per-call, no subscriptions)
- **CRPC**: Quality verification (multi-agent consensus on response quality)

Together, these enable a world where AI agents are genuine economic participants — they earn, spend, verify, and coordinate without human intermediation.

CKB's programmable cell model is uniquely suited for this. Intent-based transactions on CKB could express x402 payment proofs as cell transformations — the payment and the API call become a single atomic operation.

## Code

- x402 middleware: `jarvis-bot/src/x402.js`
- Bloom filter + signed receipts: same file
- Pricing endpoint: `GET /web/x402/pricing`
- Full source: https://github.com/WGlynn/VibeSwap

## What's Next

AWS just published their own x402 reference architecture on Base (Lambda@Edge + Agentcore). We shipped ours independently, same week. The convergence is real — machine-to-machine payments are coming regardless of who builds it first. The question is whether the payment layer will be extractive (subscriptions, API keys, centralized billing) or cooperative (on-chain proofs, sovereign receipts, open pricing).

We chose cooperative.

---

*Built by Will Glynn and JARVIS — VibeSwap, March 2026*
