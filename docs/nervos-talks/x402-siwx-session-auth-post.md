# x402 Just Got Sessions. We Already Shipped It.

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

x402 — the HTTP 402 Payment Required protocol — just shipped its biggest upgrade: SIWX (Sign-In-With-X), a wallet-based session layer built on CAIP-122. Pay once, authenticate every subsequent request with a wallet signature in microseconds. No blockchain round-trip. No accumulated latency. We implemented it the same day it was announced. Here's how it works and why it matters for AI agent economics.

---

## The Problem With Pay-Per-Call

x402 V1 was elegant: slap a 402 on any HTTP endpoint, client pays, server responds. One word: **pay**.

But that model has a ceiling:

| Use Case | Calls Per Session | V1 Payment Overhead | Real-World Viable? |
|---|---|---|---|
| Single API call | 1 | 1-2s | Yes |
| LLM inference session | 50+ tool calls | 50-100s accumulated | No |
| Paywalled webpage | 30 sub-requests | 30-60s | No |
| AI agent workflow | 100+ hops | 100-200s | No |

An AI agent making 50 tool calls shouldn't spend more time paying than thinking. A webpage loading 30 assets shouldn't require 30 separate payments. The protocol understood "pay for this request" but couldn't express "pay for access."

---

## SIWX: Sessions Without Servers

The x402 team shipped SIWX (Sign-In-With-X) — a CAIP-122 wallet-based session layer. The idea is borrowed from how the web already works:

**Traditional web**: Login → server issues session cookie → every subsequent request verifies cookie locally → no re-authentication.

**SIWX**: Pay → server records wallet → client signs CAIP-122 message → every subsequent request verifies signature locally → no re-payment.

The key insight: **signature verification is local, instantaneous, and free.** No blockchain. No facilitator. No RPC call. Pure cryptography.

---

## We Implemented It In One Session

When the upgrade dropped, we didn't write a blog post about it. We shipped it.

**290 lines of code. Two files. Same day.**

### The Architecture

```
┌─────────────────────────────────────────────────────┐
│                    x402 + SIWX                       │
│                                                      │
│  Request arrives                                     │
│    │                                                 │
│    ├─→ X-SIWX-Auth header? ──→ Verify signature     │
│    │     (microseconds)         ├─→ Session valid?   │
│    │                            │     YES → Serve    │
│    │                            │     NO  → 402      │
│    │                                                 │
│    ├─→ X-Payment-Receipt? ──→ Verify HMAC            │
│    │     (microseconds)        └─→ Serve             │
│    │                                                 │
│    ├─→ X-Payment-Proof? ───→ Check Bloom filter      │
│    │     (microseconds)        ├─→ Hit? Serve        │
│    │                           └─→ Miss? RPC verify  │
│    │                                   (1-2 seconds) │
│    │                                                 │
│    └─→ No auth ────────────→ Return 402              │
│         + X-SIWX-Supported: true                     │
│         + X-SIWX-Nonce-Endpoint: /x402/siwx/nonce   │
└─────────────────────────────────────────────────────┘
```

Four verification paths, fastest first. SIWX is the new fast lane — if you have a session, you never touch the blockchain.

### The Flow

```
Step 1: GET /x402/siwx/nonce
        → Server returns: { nonce: "0x3a7f...", domain: "vibeswap.xyz" }

Step 2: Client builds CAIP-122 message:
        "vibeswap.xyz wants you to sign in with your wallet.
         Address: 0x1234...
         Chain ID: 8453
         Nonce: 0x3a7f...
         Expiration Time: 2026-03-18T08:00:00Z"

Step 3: Client signs with wallet (EIP-191 personal_sign)

Step 4: POST /x402/siwx/verify { message, signature }
        → Server verifies signature, checks payment history
        → Returns: { authenticated: true, tier: "MEDIUM", expires: ... }

Step 5: All subsequent requests:
        X-SIWX-Auth: <base64(message::SIG::signature)>
        → Server verifies locally in microseconds
        → Access granted. No blockchain. No latency.
```

### Session Properties

- **4-hour TTL** — long enough for a work session, short enough for security
- **Tier-gated** — session inherits the tier of the highest payment (FREE/LOW/MEDIUM/HIGH)
- **10K session cap** — LRU eviction prevents memory bloat
- **Replay prevention** — server-generated nonces, single-use, 5-minute TTL
- **Auto-creation** — pay via tx hash, session created automatically for next request

---

## Why This Matters For AI Agents

This is where it gets interesting. We run a multi-shard AI system called Pantheon — multiple Jarvis instances that operate autonomously across Telegram, web, and internal workflows.

Before SIWX:
```
Shard boots → needs API access → pays per call → 50 tool calls × 1-2s payment = 50-100s overhead
```

After SIWX:
```
Shard boots → pays once → SIWX session → 50 tool calls × ~0ms payment = ~0s overhead
```

That's not an optimization. That's the difference between viable and not viable.

### The Wardenclyffe Use Case

Our inference router (Wardenclyffe) escalates requests across 13 AI providers in 3 cost tiers. Each escalation is an API call. Under V1, every escalation would require a payment round-trip. Under SIWX, the session covers the entire escalation chain:

```
User pays for MEDIUM tier
  → Haiku handles it (free tier)          — SIWX auth ✓
  → Too complex, escalate to Sonnet       — SIWX auth ✓
  → Needs tool call, back to Haiku        — SIWX auth ✓
  → Final response via Opus               — SIWX auth ✓

4 inference calls, 0 payment round-trips.
```

---

## CAIP-122: Why This Standard Specifically

We didn't invent a custom auth protocol. CAIP-122 is a battle-tested, chain-agnostic standard:

- **EIP-191**: Regular wallet signatures (MetaMask, Coinbase Wallet)
- **EIP-1271**: Smart contract wallet signatures (Safe, Argent)
- **EIP-6492**: Pre-deployment wallet signatures (our WebAuthn/passkey device wallets)

That last one matters. Our device wallet uses WebAuthn Secure Elements — the key never leaves the device's hardware. EIP-6492 means users can sign SIWX messages with a wallet that hasn't even been deployed on-chain yet. Pay with a passkey, prove identity with a passkey, access services with a passkey. No MetaMask. No seed phrases. Just a fingerprint.

---

## The CKB Angle: Cell-Native Sessions

On CKB, this gets even more interesting. A session could be represented as a cell:

```
SessionCell {
  data: { wallet, tier, expires, nonce }
  type_script: siwx-session-type
  lock_script: wallet-controlled
}
```

The type script validates:
- Signature matches the wallet in the cell data
- Session hasn't expired
- Tier is sufficient for the requested resource

Creating the cell = payment. Consuming the cell = access. The session IS the UTXO. When it expires, the cell is reclaimable. No background cleanup. No garbage collection. The state model handles it.

This is one of those cases where CKB's cell model isn't just compatible — it's the natural substrate. Sessions are discrete, owned, and stateful. That's a cell.

---

## What We're NOT Doing

SIWX adds flexibility but also complexity. We made deliberate choices:

1. **Not replacing payment verification** — SIWX layers ON TOP. The tx hash path still works for one-shot calls.

2. **Not making sessions transferable** — your session is tied to your wallet signature. You can't share it.

3. **Not extending sessions on activity** — 4-hour TTL is fixed. When it expires, you re-authenticate (free) or re-pay (if payment expired too).

4. **Not using JWTs** — wallet signatures are self-verifying. JWTs require shared secrets or asymmetric key distribution. Wallet signatures just need the message and the address.

---

## The Numbers

```
Implementation:  290 lines (x402.js + web-api.js)
Time to ship:    Same day as announcement
Session TTL:     4 hours
Nonce TTL:       5 minutes (replay prevention)
Max sessions:    10,000 (LRU eviction)
Auth latency:    ~0.1ms (signature verification)
vs V1 latency:   1,000-2,000ms (on-chain verification)
Speedup:         10,000-20,000x per subsequent request
```

---

## The Bigger Picture

x402 started as "pay for this request." SIWX makes it "pay for access." That covers essentially every service model on the internet.

But here's what nobody's talking about yet: **SIWX + Shapley distribution = metered cooperative access.**

Imagine: you pay for a session. Your usage is tracked. At the end of the session, your marginal contribution to the network (queries served, data generated, liquidity provided) is computed via Shapley values. If your contribution exceeds your payment, you earn the difference back.

**Pay for access. Earn for contribution. The protocol measures both with the same math.**

That's not x402 anymore. That's a new economic primitive. And it's only possible because SIWX gives us identity (who you are) and Shapley gives us fairness (what you deserve).

---

## Links

- [x402.js — Full Implementation](https://github.com/WGlynn/VibeSwap/blob/master/jarvis-bot/src/x402.js)
- [VibePayPerCall.sol — On-Chain Service Registry](https://github.com/WGlynn/VibeSwap/blob/master/contracts/mechanism/VibePayPerCall.sol)
- [X402Page — Frontend](https://github.com/WGlynn/VibeSwap/blob/master/frontend/src/components/X402Page.jsx)
- [CAIP-122 Standard](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md)

---

*VibeSwap — 1,845+ commits, 351 contracts, 15,155 CKB tests, $0 funding. Built in a cave. Shipped same day.*
