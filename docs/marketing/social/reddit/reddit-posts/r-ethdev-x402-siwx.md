# r/ethdev — "x402 shipped SIWX sessions. We implemented it in 290 lines the same day."

**Subreddit**: r/ethdev
**Flair**: My Project / Technical

---

**Title**: x402 just shipped wallet-based session auth (SIWX). We implemented it in 290 lines the same day. Here's how.

**Body**:

x402 (HTTP 402 Payment Required) had a problem: every API call needed a full on-chain payment round-trip. That's 400ms on Base, 1-2s on mainnet. Per request. An AI agent making 50 tool calls accumulates 20-50s of pure payment overhead.

Yesterday they shipped SIWX — Sign-In-With-X using CAIP-122. Pay once, authenticate subsequent requests with a wallet signature in microseconds.

We implemented it the same day. 290 lines across two files. Here's the architecture:

```
Request arrives
  ├→ X-SIWX-Auth header? → verify signature (microseconds)
  │    → session valid? → serve
  │    → no? → 402
  ├→ X-Payment-Receipt? → verify HMAC (microseconds) → serve
  ├→ X-Payment-Proof? → Bloom filter → hit? serve : RPC verify (~400ms)
  └→ No auth → return 402 + X-SIWX-Supported: true
```

Four verification paths, fastest first. SIWX is the new fast lane.

**The flow:**

1. `GET /x402/siwx/nonce` → server returns nonce + domain
2. Client builds CAIP-122 message, signs with wallet (EIP-191)
3. `POST /x402/siwx/verify` → server verifies, creates 4-hour session
4. All subsequent requests: `X-SIWX-Auth` header → microsecond local verification

**Key design decisions:**

- Sessions are tier-gated (FREE/LOW/MEDIUM/HIGH) — inherits from highest payment
- Server-generated nonces with 5-min TTL prevent replay
- Auto-session creation after tx hash payment (smooth upgrade path from V1)
- 10K session cap with LRU eviction
- EIP-191 + EIP-1271 + EIP-6492 support (EOAs, smart wallets, pre-deploy wallets)

**Why EIP-6492 matters:** Our device wallet uses WebAuthn/passkeys — the smart account might not be deployed on-chain yet. EIP-6492 lets users sign SIWX messages with a wallet that only exists in their Secure Element. No MetaMask, no seed phrases, just a fingerprint.

The numbers:
- Auth latency: ~0.1ms (signature verification)
- vs V1: ~400ms on Base
- Speedup: 4,000x per subsequent request

Code (MIT): https://github.com/WGlynn/VibeSwap/blob/master/jarvis-bot/src/x402.js

Anyone else implementing SIWX? Curious what session TTL others are using and how you're handling tier inheritance.
