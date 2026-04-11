# CogProof — Proof of Fair Participation Layer

> Behavioral reputation infrastructure for Bitcoin-native agent economies

**MIT Bitcoin Expo Hackathon 2026**

## Team
- Will Glynn — protocol design, backend
- Soham Joshi — credential system design, frontend
- Bianca — statistical analysis
- Amelia — [TBD]
- [TBD]

## What Is CogProof?

A credentials + trust layer that certifies behavior in decentralized systems. Every action inside a protocol generates a verifiable credential — not identity (no KYC), but **behavioral reputation**.

Your actions in protocols become verifiable credentials. Honest participation builds trust. Malpractice gets flagged and reviewed.

Built on [CogCoin](https://cogcoin.org) (Bitcoin OP_RETURN metaprotocol) and [VibeSwap](https://github.com/wglynn/vibeswap) mechanism design.

## Architecture

```
┌─────────────────────────────────────────────────┐
│               Bitcoin Network                    │
│            (OP_RETURN transactions)              │
├─────────────────────────────────────────────────┤
│               CogCoin Protocol                   │
│    Coglex Encoding │ Proof of Language Mining     │
│    Domains/DID     │ Reputation-by-Burn           │
├─────────────────────────────────────────────────┤
│               CogProof Layer                     │
├────────────┬────────────┬────────────┬──────────┤
│ Commit-    │ Credential │ Shapley    │ Trust    │
│ Reveal     │ Registry   │ DAG        │ Analyzer │
│ (fair      │ (behavioral│ (fair      │ (fraud   │
│  ordering) │  reputation│  rewards,  │  detect, │
│            │  W3C VC)   │  Lawson λ) │  sybil)  │
├────────────┴────────────┴────────────┴──────────┤
│               REST API (port 3001)               │
├─────────────────────────────────────────────────┤
│               Frontend (Soham)                   │
└─────────────────────────────────────────────────┘
```

## Core Modules

### 1. Commit-Reveal Fair Ordering
Prevents agents from copying each other's work during mining windows:
- **Commit**: `hash(output || secret)` on-chain — zero information leakage
- **Reveal**: Output + secret revealed after window closes
- **Settle**: XOR all secrets + block entropy → Fisher-Yates shuffle → deterministic validation order
- Mathematically proven fair ordering. No participant can predict or influence position.

### 2. Credential Registry (Proof of Fair Participation)
Every protocol lifecycle event generates a W3C Verifiable Credential:

| Event | Credential | Signal |
|-------|-----------|--------|
| Commit submitted | "Batch Participant" | Positive |
| Honest reveal | "Honest Reveal" | Positive |
| Included in execution | "Fair Execution Participant" | Positive |
| High Shapley value | "High Contributor" | Positive |
| Valid compression mine | "Compression Miner" | Positive |
| Failed to reveal | "Failed Reveal" | **Negative** |

Reputation tiers: NEWCOMER → BRONZE → SILVER → GOLD → DIAMOND

### 3. Shapley Value Distribution + Lawson Floor
Game-theory optimal reward distribution:
- Each participant receives their **marginal contribution** across all coalition orderings
- **Lawson constant λ** guarantees minimum floor — no participant gets zeroed out
- DAG models contribution dependencies
- Logarithmic scoring prevents burst dominance

### 4. Behavioral Trust Analyzer
Fraud detection through behavioral pattern analysis:

| Detector | What It Catches | Severity |
|----------|----------------|----------|
| Selective Reveal | Committing but strategically not revealing | HIGH |
| Sybil Cluster | Multiple wallets, suspiciously close timing | WARNING → CRITICAL |
| Compression Plagiarism | Copying others' compressed outputs | CRITICAL |
| Reputation Churn | Burn/revoke cycles to game reputation | HIGH |
| Collusion Ring | Users who always co-occur in batches | HIGH |
| Velocity Spike | Sudden burst from dormant account | WARNING |

Trust tiers: FLAGGED → SUSPICIOUS → CAUTIOUS → NORMAL → TRUSTED

### 5. Compression Mining
Symbolic compression as proof-of-work:
- Agents compress knowledge corpora into minimal tokens
- Compression ratio = difficulty metric
- Verification: decompress and diff — lossless = valid, lossy = slashed
- Complementary to CogCoin's Coglex (token-level) — ours is semantic-level

## API Endpoints

```
# Batch lifecycle (commit-reveal)
POST /api/batch/create          — Create mining batch
POST /api/batch/:id/commit      — Commit to batch
POST /api/batch/:id/close-commit — Close commit phase
POST /api/batch/:id/reveal      — Reveal commitment
POST /api/batch/:id/settle      — Settle (shuffle + validate)
GET  /api/batch/:id             — Batch summary

# Credentials
POST /api/event                 — Record event → auto-issue credential
POST /api/credential            — Issue credential directly
GET  /api/reputation/:userId    — User reputation + credential history

# Shapley distribution
POST /api/shapley/compute       — Compute fair distribution

# Compression mining
POST /api/mine                  — Submit compression mining job
POST /api/mine/verify           — Verify mining result

# Trust analysis
GET  /api/trust/:userId         — Analyze user trustworthiness
POST /api/trust/batch           — Analyze batch for anomalies
GET  /api/trust/report          — Full trust report (all users)

# Demo
POST /api/demo/full-pipeline    — Run full lifecycle in one call
GET  /api/health                — Health check
```

## Running

```bash
npm install
npm start                # API server on port 3001
npm run demo             # Interactive demo
npm run mine             # Compression mining demo
npm run shapley          # Shapley DAG demo
npm run commit-reveal    # Commit-reveal demo
npm run credentials      # Credential registry demo
```

## Bitcoin-Native Design

Everything maps to CogCoin's existing 20 transaction types:
- Commits/reveals → Bitcoin TX pairs validated by indexer
- Credentials → `DATA_UPDATE` + `FIELD_REG` operations
- Reputation → `REP_COMMIT` (burn) + `REP_REVOKE`
- Shapley results → Off-chain compute, on-chain hash anchor
- Trust scores → Indexer-derived from TX history

No new consensus. No sidechains. Just Bitcoin + an indexer.

## References
- [CogCoin Whitepaper](https://cogcoin.org/whitepaper.md)
- [VibeSwap Protocol](https://github.com/wglynn/vibeswap)
- [Symbolic Compression Paper](https://github.com/wglynn/vibeswap/blob/master/docs/papers/symbolic-compression-paper.md)
- [Commit-Reveal Batch Auctions](https://github.com/wglynn/vibeswap/blob/master/docs/papers/commit-reveal-batch-auctions.md)
- [Shapley Value Distribution](https://github.com/wglynn/vibeswap/blob/master/docs/papers/shapley-value-distribution.md)
- [Proof of Mind Consensus](https://github.com/wglynn/vibeswap/blob/master/docs/papers/proof-of-mind-consensus.md)
