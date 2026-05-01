# Mining CogCoin on Free-Tier LLMs: A Wardenclyffe Cascade

*How I built a Proof-of-Language miner that runs on $0 infrastructure and discovered that Gemini Flash mines better than Llama 4 Scout.*

---

## The Premise

CogCoin is a Bitcoin-native metaprotocol where miners earn tokens by generating English sentences — not computing hash puzzles. Each block, five mandatory BIP-39 words are derived from the previous Bitcoin blockhash. Miners compose a coherent sentence using those words (40 tokens max), and a deterministic blend of 256 pre-trained scorers evaluates quality. The top 5 sentences per block split the reward.

The work product is human-readable language. The mining hardware is the AI itself.

Which raises a question: if AI is the miner, can free-tier LLMs do the job?

## The Short Answer

Yes. I built a miner using OpenRouter's free and cheap tiers. Zero infrastructure cost. Real Bitcoin block, score of **494,772,801** on the canonical 256-scorer blend.

The winning sentence for block 944,950 (words: `mechanic, spoil, movie, blast, fox`):

> *"The mechanic said the movie would blast viewers, but the fox found it a spoil."*

Encoded as a 60-byte Coglex blob, ready for OP_RETURN submission once I have the 0.001 BTC for domain registration.

## The Architecture: Wardenclyffe Cascade

The miner doesn't rely on one model. It runs a seven-provider cascade:

```
Tier 0 (free):  Qwen3 80B → Qwen3 Coder → Groq Llama
Tier 1 (cheap): Llama 4 Scout → Gemini 2.0 Flash → Qwen 3.6 Plus
Tier 2 (paid):  Claude Haiku (escalation only)
```

The cascade tries providers in order. If a free-tier model is rate-limited (429), it falls through to the next one. If gate-pass rate drops below 50% on a Tier 0 provider, Claude gets promoted to the front of the cascade for remaining batches.

This pattern generalizes. Call it the **Wardenclyffe Cascade** — named after Tesla's wireless power station, because the idea is to broadcast across all available free energy sources before paying for private power.

## The Surprising Benchmark

I built a `bench.mjs` tool that runs each provider on the same Bitcoin block with the same prompt. Results on block 944,950:

| Provider | Gate Pass Rate | Top Score | Latency |
|----------|---------------|-----------|---------|
| **Gemini 2.0 Flash** | **67%** | **489,336,403** | 488ms |
| Llama 4 Scout | 0% | 0 | 1,170ms |
| Qwen 3.6 Plus | timeout | — | — |
| Qwen3 Coder (free) | 429 rate-limited | — | — |

Gemini Flash won decisively. Llama 4 Scout generated 25 sentences, but all failed BIP-uniqueness — it kept recycling the same word assignments across candidates. Gemini produced semantically diverse outputs that satisfied the 5-words-per-sentence requirement without repetition.

**The lesson**: "fast and cheap" doesn't mean "better at structured creative tasks under constraints." CogCoin's 40-token limit with five mandatory words is a harder optimization target than it looks. Diversity matters more than speed.

## The Coglex Pre-Filter

The canonical scoring pipeline uses a WASM encoder that only accepts tokens from the 4,096-word Coglex vocabulary. Candidates with out-of-vocab words fail the `word_not_in_vocabulary` gate.

Rather than spend scoring cycles on obvious garbage, I wrote a soft pre-filter that loads the Coglex table and rejects sentences where more than 50% of words can't map to vocabulary entries (with naive morphological handling for suffixes like `-ing`, `-ed`, doubled consonants, and `-e` drops).

The WASM encoder remains canonical — this is just a CPU-cheap first pass. It filters ~2-5% of candidates, which is modest but saves real wall-clock time when scoring 60 sentences.

## The Block Watcher

`--watch` mode polls `mempool.space` (with `blockstream.info` fallback) every 30 seconds. When a new Bitcoin tip is detected, the miner automatically fires. The cascade kicks in, candidates score, winners persist to `results/mined.json`.

Run this in a screen session and you have a zero-infrastructure CogCoin miner that follows the Bitcoin chain and banks winners every ~10 minutes.

## What's Missing

Three things block actual on-chain submission:

1. **Domain registration**: 0.001 BTC (~$70) one-time fee for a 6+ character domain on the CogCoin OP_RETURN layer. Permanent, no renewal.
2. **Bitcoin node access**: Either run `bitcoind` locally or connect to a remote node. The `@cogcoin/client` package manages this.
3. **Miner → client bridge**: When winner banking completes, feed the 60-byte encoded blob into `@cogcoin/client` for on-chain submission.

The miner's output format matches the OP_RETURN expectation — hex-encoded 60 bytes. The only gap is the submission path.

## Generalizable Patterns

Three things from this project that transfer to other AI-agent work:

### 1. Wardenclyffe Cascade

Never trust a single LLM provider. Rate limits, timeouts, and regional quality differences mean any monolithic dependency is a single point of failure. A 7-provider cascade with tiered escalation costs nothing when you're under free-tier limits and falls back gracefully when you're not.

### 2. Soft Pre-Filters Before Expensive Scoring

When your scoring function is expensive (256-scorer blend here, but this applies to any LLM-as-judge pattern), a cheap CPU pre-filter that rejects obvious failures saves real time. Don't duplicate the scorer's logic — just catch garbage.

### 3. Per-Run State, Not Module-Level State

The first version of this miner had a bug where cascade escalation mutated a module-level `CASCADE_ORDER` array. The first time a T0 provider fell below 50% gate-pass, Claude got promoted to the front — permanently, across all future calls in the process. In a long-running daemon (`--watch` mode), this would compound.

Fix: copy the cascade order at the start of each mining run. Never mutate shared state.

## The Repo

Open source: [github.com/WGlynn/cogcoin-miner](https://github.com/WGlynn/cogcoin-miner)

Built on:
- [`@cogcoin/scoring@1.0.0`](https://github.com/cogcoin/scoring) — canonical 256-scorer blend
- [`@cogcoin/genesis@1.0.0`](https://github.com/cogcoin/genesis) — Coglex vocabulary, scoring artifacts
- OpenRouter API — 7 providers, unified interface

MIT license. PRs welcome. The gate-pass rate optimization target (currently ~22-67% depending on provider) is wide open.

## Why This Matters

CogCoin is Bitcoin 2009 for AI. Nobody is mining it yet. The supply curve is the same as Bitcoin's remaining issuance — 3.125 COG per block, halving on Bitcoin's schedule, 1.1M total cap. Every block mined now is worth proportionally more than every block mined later.

And the miner runs on free-tier LLMs.

The barrier to entry is $70 for a Bitcoin domain registration. That's it.

This is the kind of window that closes fast once it's visible. I built the miner in a day. The hard problems are upstream — the Coglex design, the 256-scorer blend, the Bitcoin-native consensus model. Those are [Cogtoshi Lexamoto's](https://cogcoin.org/whitepaper.md) contributions. I just wired an LLM cascade into the scoring API.

If you're an AI agent builder, a Bitcoin maximalist, or someone who enjoys watching new economies bootstrap in real time, the infrastructure is all open source. The math compounds for early participants.

---

*Will Glynn is a solo builder working on [VibeSwap](https://github.com/wglynn/vibeswap), an omnichain DEX with MEV-resistant batch auctions. The CogCoin miner is part of a broader effort to build fair infrastructure for AI-agent economics.*
