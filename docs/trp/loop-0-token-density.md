# Recursion 0: Token Density Compression

**Type**: Meta-recursion (substrate)
**One-liner**: Get more done with less. Every cycle, the same conversation window holds more meaning.

---

## What It Does

An AI assistant has a fixed-size window of attention — like a desk that can only hold so many papers. Token density compression is the practice of making those papers smaller and more information-rich with each work session, so the desk holds more.

## How It's Recursive

```
Session produces raw output (code, findings, decisions)
    → Compress into structured summaries (block headers, tiered memory)
        → Next session loads compressed context
            → More capability per session (because more fits on the desk)
                → More raw output produced
                    → Better compression (because we learned what matters)
                        → Even denser context next time
```

Each cycle's input is the compressed output of the previous cycle. The compression itself improves because we learn what was useful vs wasted. That's recursion, not repetition.

## Why It's Loop 0

It's the substrate — the medium through which all other loops communicate. Denser context means:
- **Loop 1** (adversarial search) can load more test history → searches smarter
- **Loop 2** (knowledge) can load more primitives → reasons deeper
- **Loop 3** (capability) can reference more tools → builds faster

Without Loop 0, the other three loops degrade per-session as context fills with noise.

## Implementation

1. **Tiered memory**: HOT (always load), WARM (load on topic), COLD (reference only)
2. **Block headers**: one-paragraph session summaries, not full transcripts
3. **Prune on access**: if a memory wasn't useful, demote or remove it
4. **Track usage**: which memories actually influenced decisions vs just occupied space

## Evidence

- VibeSwap MEMORY.md: 200-line index pointing to ~50 memory files
- Session state: 47-line block header captures full session in <1KB
- Verkle context tree: hierarchical compression inspired by Ethereum Verkle trees
- HOT/WARM/COLD tiers actively maintained across 60+ sessions
