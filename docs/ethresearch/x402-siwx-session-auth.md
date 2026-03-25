# x402 Just Got Sessions. We Already Shipped It.

*ethresear.ch*
*March 2026*

---

## TL;DR

x402 — the HTTP 402 Payment Required protocol — just shipped its biggest upgrade: SIWX (Sign-In-With-X), a wallet-based session layer built on CAIP-122. Pay once, authenticate every subsequent request with a wallet signature in microseconds. No blockchain round-trip. No accumulated latency. This post presents a reference implementation (290 lines, two files) and analyzes the implications for AI agent economics on Ethereum L2s.

---

## The Problem With Pay-Per-Call

x402 V1 was elegant: slap a 402 on any HTTP endpoint, client pays, server responds. One word: **pay**.

But that model has a ceiling:

| Use Case | Calls Per Session | V1 Payment Overhead (Base) | Real-World Viable? |
|---|---|---|---|
| Single API call | 1 | ~400ms | Yes |
| LLM inference session | 50+ tool calls | 20-50s accumulated | No |
| Paywalled webpage | 30 sub-requests | 12-30s | No |
| AI agent workflow | 100+ hops | 40-100s | No |

An AI agent making 50 tool calls shouldn't spend more time paying than thinking. A webpage loading 30 assets shouldn't require 30 separate payments. The protocol understood "pay for this request" but couldn't express "pay for access."

---

## SIWX: Sessions Without Servers

The x402 team shipped SIWX (Sign-In-With-X) — a CAIP-122 wallet-based session layer. The idea is borrowed from how the web already works:

**Traditional web**: Login → server issues session cookie → every subsequent request verifies cookie locally → no re-authentication.

**SIWX**: Pay → server records wallet → client signs CAIP-122 message → every subsequent request verifies signature locally → no re-payment.

The key insight: **signature verification is local, instantaneous, and free.** No blockchain. No facilitator. No RPC call. Pure `ecrecover`.

---

## We Implemented It In One Session

The reference implementation is 290 lines across two files.

### Architecture

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
│    │                                   (~400ms Base) │
│    │                                                 │
│    └─→ No auth ────────────→ Return 402              │
│         + X-SIWX-Supported: true                     │
│         + X-SIWX-Nonce-Endpoint: /x402/siwx/nonce   │
└─────────────────────────────────────────────────────┘
```

Four verification paths, fastest first. SIWX is the new fast lane — if you have a session, you never touch the chain.

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
- **Auto-creation** — pay via tx hash on Base, session created automatically for next request

---

## Why This Matters For AI Agents On Ethereum

This is where it gets interesting. We run a multi-shard AI system — multiple autonomous agent instances operating across Telegram, web, and internal workflows, all settling on Base.

Before SIWX:
```
Agent boots → needs API access → pays per call on Base → 50 tool calls × 400ms = 20s overhead
```

After SIWX:
```
Agent boots → pays once on Base → SIWX session → 50 tool calls × ~0ms = ~0s overhead
```

That's not an optimization. That's the difference between viable and not viable for agent-to-agent commerce on Ethereum L2s.

### The Inference Router Use Case

Our inference router escalates requests across 13 AI providers in 3 cost tiers. Each escalation is an API call. Under V1, every escalation would require a payment round-trip through Base. Under SIWX, the session covers the entire escalation chain:

```
User pays for MEDIUM tier on Base
  → Haiku handles it (free tier)          — SIWX auth ✓
  → Too complex, escalate to Sonnet       — SIWX auth ✓
  → Needs tool call, back to Haiku        — SIWX auth ✓
  → Final response via Opus               — SIWX auth ✓

4 inference calls, 0 payment round-trips. 1 Base transaction.
```

---

## EIP Compatibility: Why CAIP-122

We didn't invent a custom auth protocol. CAIP-122 is a battle-tested, chain-agnostic standard that composes with the Ethereum EIP stack:

- **EIP-191**: Regular EOA signatures (MetaMask, Coinbase Wallet, Rainbow)
- **EIP-1271**: Smart contract wallet signatures (Safe, Argent, Kernel)
- **EIP-6492**: Pre-deployment wallet signatures — this is the big one

EIP-6492 means users can sign SIWX messages with a smart wallet that hasn't been deployed on-chain yet. We use WebAuthn/passkey-based smart accounts (ERC-4337) where the key lives in the device's Secure Element. Users can authenticate with a fingerprint. No MetaMask. No seed phrases. No browser extension.

**The full stack**: ERC-4337 smart account → WebAuthn signer → EIP-6492 pre-deploy signature → CAIP-122 message → SIWX session → x402 access. All Ethereum-native. All composable.

---

## The EVM Implementation: What's On-Chain vs Off-Chain

### On-Chain (Base)

```solidity
// VibePayPerCall.sol — Service registry + credit system
contract VibePayPerCall {
    struct Service {
        address provider;
        uint8 serviceType;
        bytes32 endpointHash;
        uint256 pricePerCall;
        uint256 rateLimit;
    }

    // Users can prepay credits or pay per call
    function depositCredit(uint256 serviceId) external payable;
    function callService(uint256 serviceId, bytes32 requestHash) external payable;
}
```

Payment settlement happens on Base — cheap, fast, final. The on-chain contract handles economic finality: who paid, how much, for what service.

### Off-Chain (Server)

SIWX handles identity and session management off-chain:

```javascript
// Verify SIWX signature — pure ecrecover, no RPC
function verifySIWXSignature(message, signature) {
  const recovered = ethers.verifyMessage(message, signature)
  // Parse CAIP-122 fields, check expiry, validate nonce
  return { valid: true, address: recovered }
}
```

The separation is clean: **Base for money, signatures for identity.** Each does what it's best at.

---

## Implications For Ethereum Ecosystem

### 1. Agent-to-Agent Commerce on L2s

SIWX makes agent-to-agent payment sessions viable on Base, Arbitrum, Optimism. An agent pays once, gets a 4-hour session, makes hundreds of calls. The L2's low gas cost makes the initial payment negligible, and SIWX eliminates all subsequent overhead.

### 2. ERC-4337 as an Identity Layer

Smart accounts aren't just wallets anymore — they're session identities. SIWX turns your 4337 account into a universal API key. Pay from any L2, authenticate everywhere.

### 3. Paywall Infrastructure for Ethereum-Native Services

Every Ethereum service — oracle feeds, MEV protection, private mempools, AI inference, data indexing — can now gate access with x402 + SIWX. One standard for the entire stack. No API key management. No billing dashboards. Just wallets and signatures.

### 4. Cooperative Game Theory Integration

Here's what nobody's talking about yet: **SIWX + Shapley distribution = metered cooperative access.**

You pay for a session. Your usage is tracked (queries, data contributed, liquidity provided). At session end, your marginal contribution is computed via Shapley values. If your contribution exceeds your payment, you earn the difference back.

```
Pay for access. Earn for contribution.
The protocol measures both with the same math.
```

We use Shapley values for reward distribution across our DEX — the same `ShapleyDistributor.sol` (62 tests passing) that distributes LP rewards can measure session contribution. SIWX provides the identity (who you are), Shapley provides the fairness (what you deserve).

That's a new economic primitive. And it's only possible on Ethereum because the composability exists: ERC-4337 → CAIP-122 → x402 → Shapley → settlement on Base.

---

## What We're NOT Doing

1. **Not replacing payment verification** — SIWX layers ON TOP. The tx hash path still works for one-shot calls.
2. **Not making sessions transferable** — tied to your wallet signature.
3. **Not extending sessions on activity** — 4-hour TTL is fixed.
4. **Not using JWTs** — wallet signatures are self-verifying. No shared secrets needed.

---

## The Numbers

```
Implementation:  290 lines (x402.js + web-api.js)
Time to ship:    Same day as announcement
Deployed on:     Base (Chain ID 8453)
Session TTL:     4 hours
Nonce TTL:       5 minutes (replay prevention)
Max sessions:    10,000 (LRU eviction)
Auth latency:    ~0.1ms (signature verification)
vs V1 latency:   ~400ms on Base (on-chain verification)
Speedup:         4,000x per subsequent request
```

---

## Code

All open source:

- [x402.js — Full SIWX Implementation](https://github.com/WGlynn/VibeSwap/blob/master/jarvis-bot/src/x402.js)
- [VibePayPerCall.sol — On-Chain Service Registry](https://github.com/WGlynn/VibeSwap/blob/master/contracts/mechanism/VibePayPerCall.sol)
- [ShapleyDistributor.sol — Cooperative Reward Distribution](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol)
- [ExtractionDetection.t.sol — Fairness Simulation (9 tests)](https://github.com/WGlynn/VibeSwap/blob/master/test/simulation/ExtractionDetection.t.sol)
- [CAIP-122 Standard](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-122.md)

---

*VibeSwap — omnichain DEX on Base. 1,845+ commits, 351 Solidity contracts, 5,800+ Foundry tests, $0 funding. 0% protocol fees. Built in a cave.*
