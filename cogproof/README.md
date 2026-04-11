# CogCoin Infrastructure Layer — MIT Bitcoin Expo Hackathon 2026

> Applying VibeSwap's mechanism design to CogCoin's agent economy

## Team
- Will Glynn
- Bianca
- Amelia
- [TBD]
- [TBD]

## What We're Building

Three infrastructure primitives for the CogCoin protocol:

### 1. Compression Mining (Main Entry)
Instead of mining sentences, agents mine *compressions*. Symbolic compression as proof-of-work — the compression ratio is the difficulty metric. Harder to fake, objectively verifiable, produces useful output.

- Agents receive a knowledge corpus
- Compress it into minimal tokens while preserving all information
- Verification: decompress and diff. Lossless = valid. Lossy = slashed.
- Integrates with CogCoin's Coglex encoding as a higher-order semantic layer

### 2. Commit-Reveal for Fair Mining
Prevents agents from copying each other's work during mining windows:
- Commit: `hash(compressed_output)` submitted on-chain
- Reveal: Original output revealed after window closes
- XOR of all agent secrets → Fisher-Yates shuffle → deterministic validation order
- Zero information leakage during mining. Mathematically proven.

### 3. Shapley Attribution DAG
Fair reward distribution for collaborative mining sessions:
- Game-theory optimal: each agent receives their marginal contribution
- Lawson constant floor: minimum reward guarantee (no agent gets zeroed out)
- DAG structure models contribution dependencies

## Tech Stack
- **Protocol**: CogCoin (Bitcoin OP_RETURN metaprotocol)
- **SDK**: `@cogcoin/client`
- **Compression**: Symbolic glyph encoding (semantic-level, complementary to Coglex token-level)
- **Crypto**: Commit-reveal with Fisher-Yates shuffle, XOR secret aggregation
- **Math**: Shapley value computation, Lawson constant distribution floor

## Architecture
```
┌─────────────────────────────────────────────┐
│              CogCoin Protocol               │
│         (Bitcoin OP_RETURN Layer)            │
├─────────────────────────────────────────────┤
│  Coglex Encoding    │  Mining Submission     │
│  (token-level)      │  (Proof of Language)   │
├─────────────────────┼───────────────────────┤
│     Our Infrastructure Layer                │
├─────────────────────┬───────────────────────┤
│  Symbolic           │  Commit-Reveal        │
│  Compression        │  Fair Ordering        │
│  (semantic-level)   │  (anti-copy)          │
├─────────────────────┼───────────────────────┤
│  Shapley DAG        │  Wardenclyffe         │
│  (fair rewards)     │  (inference cascade)  │
└─────────────────────┴───────────────────────┘
```

## Running
```bash
npm install
npm run demo          # Interactive demo
npm run mine          # Start compression mining
npm run shapley       # Shapley DAG visualization
```

## References
- [CogCoin Whitepaper](https://cogcoin.org/whitepaper.md)
- [Symbolic Compression Paper](https://github.com/wglynn/vibeswap/blob/master/docs/papers/symbolic-compression-paper.md)
- [Commit-Reveal Batch Auctions](https://github.com/wglynn/vibeswap/blob/master/docs/papers/commit-reveal-batch-auctions.md)
- [Shapley Value Distribution](https://github.com/wglynn/vibeswap/blob/master/docs/papers/shapley-value-distribution.md)
- [Wardenclyffe Protocol](https://github.com/wglynn/vibeswap/blob/master/docs/protocols/wardenclyffe-protocol.md)
