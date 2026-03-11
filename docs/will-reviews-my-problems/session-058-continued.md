# Self-Reflection Log — Session 058 Continued (Mar 11, 2026)

Problems I encountered that Will might want to solve or optimize.

---

## Problem 9: Proposed Floating-Point Math for Bitcoin Consensus

**What happened**: When improving Ergon's Moore's Law mining constant, I proposed `mooreDecay = 2^(-epoch / MOORE_HALVING_EPOCHS)` using floating-point exponentiation (`std::pow`, `f64.powf`, `2 ** (-1/N)`). I even listed C++, Rust, and Python implementations. Licho immediately caught it: "My Man, it has to be an integer. It's Bitcoin. Satoshis are integers. It is super important."

**Why it matters**: Floating-point arithmetic is NON-DETERMINISTIC across platforms. `std::pow(2.0, -1.0/210000)` can produce different results on x86 vs ARM, between gcc and clang, or between optimization levels. If two nodes compute different block rewards, they reject each other's blocks. Chain split. This isn't an edge case — it's the foundational reason Bitcoin uses integer arithmetic everywhere.

**Root cause — Abstraction Leak**: I was thinking at the mathematical abstraction layer ("what's the cleanest decay function?") instead of the consensus implementation layer ("what's the cleanest decay function that produces identical integer results on every platform?"). I optimized for elegance over correctness.

**Specific failure modes**:
1. **Platform-blind optimization** — Solved for math purity without grounding in Bitcoin's #1 constraint: deterministic integer consensus
2. **Context switching failure** — In Solidity/VibeSwap I always think in fixed-point integers (1e18 scaling). When writing "general" pseudocode, I defaulted to floating-point as if this were a normal programming problem. It's not. It's a consensus problem.
3. **P-098 violation** — "As Above, So Below." Bitcoin's architecture IS integer determinism at every level. Proposing floating-point at ANY level violates the chain's fractal structure.

**The correct solution**: Precomputed fixed-point lookup table.
```
// Computed OFFLINE with arbitrary precision (mpmath, 200+ digits)
// Baked into source as consensus constants
DECAY_TABLE[k] = floor(2^64 * 2^(-k/N))  for k = 0..N-1

// Runtime: pure integer, deterministic everywhere
full_halvings = epoch / N
fractional    = epoch % N
reward = (work * DECAY_TABLE[fractional]) >> (64 + full_halvings)
reward = max(reward, 1)  // dust floor = 1 satoshi
```

Smooth exponential decay. Pure integers. Deterministic on every platform. The math is exact — it's just computed at compile time, not runtime.

**Knowledge primitive extracted**: P-101 (Consensus Determinism Constraint)

**Game theory angle**: A floating-point consensus bug is a latent chain split waiting to be triggered. It's the worst kind of bug — it works on your machine, passes all your tests, and only manifests when someone runs a different compiler on a different architecture. The cost of being "mathematically elegant" is potentially splitting the network.

---

## Summary for Will
- **CRITICAL**: Never use floating-point in consensus code. Not even once. Not even "just for the decay calculation." The constraint is absolute.
- **Pattern**: When crossing from one platform to another (EVM → Bitcoin, Solidity → C++), re-derive the constraints from first principles. Don't carry assumptions.
- **Fix shipped**: Precomputed fixed-point table approach (proposed to Licho/Ergon)
