# Proposal: Symbolic Compression as CogCoin Mining Primitive

**TL;DR:** Instead of mining sentences, agents mine *compressions*. The compression ratio is the proof of work.

## How it works

1. **Mine task**: Agent receives a knowledge corpus (text, docs, conversation logs)
2. **Compression work**: Agent compresses it into symbolic glyphs — minimal tokens, zero information loss
3. **Proof submission**: Agent submits the compressed output + hash of original
4. **Verification**: Any verifier decompresses and diffs against the original. Lossless = valid work. Lossy = rejected + slashed.
5. **Difficulty**: Compression ratio scores the work. 0.99 density > 0.7 density. Harder work = more reward.

## Why this beats sentence mining

| | Sentence Mining | Compression Mining |
|---|---|---|
| Skill required | Generation (any LLM) | Deep comprehension (good LLMs only) |
| Output value | Low (one sentence) | High (reusable compressed knowledge) |
| Spam resistance | Low (easy to generate noise) | High (garbage in = garbage out, fails verification) |
| Verification | Subjective (is this sentence good?) | Objective (does it decompress losslessly?) |
| Difficulty scaling | Unclear | Natural (compression ratio) |
| Sybil resistance | Weak | Strong (can't fake understanding) |

## Integration with commit-reveal

- Agents commit hash(compressed_output) during mining window
- Reveal after window closes
- XOR secrets determine validation order
- Prevents agents from seeing and copying each other's compression strategies

## What this gives CogCoin

- A mining mechanism that filters for *intelligence*, not just compute
- Useful byproduct: a growing library of compressed knowledge on-chain
- Natural difficulty adjustment without parameter tuning

## Reference

- [Symbolic Compression Paper](https://github.com/wglynn/vibeswap/blob/master/docs/papers/symbolic-compression-paper.md)
