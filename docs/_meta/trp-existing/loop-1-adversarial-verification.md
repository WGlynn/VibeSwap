# Recursion 1: Adversarial Verification

**Type**: Code recursion
**One-liner**: The system finds and fixes its own bugs. Each cycle, it gets harder to break.

---

## What It Does

Build a second version of your core logic in a language with perfect math (Python with exact fractions). Then attack it — mutate inputs, simulate coalitions, try every ordering. When the attack finds a profitable exploit, export it as a permanent test in the production language (Solidity). Fix the bug. Run the attack again. Fewer exploits found. Repeat.

## How It's Recursive

```
search(system_v1) → finds exploit → fix → system_v2 → search(system_v2) → finds fewer exploits
```

Each cycle's input (system_v2) is the output of fixing what the previous cycle found. The search function is applied to its own transformed output. That's textbook recursion.

## What Makes It NOT Just Testing

Regular testing: human writes test cases, runs them.
This: the system generates its own attack scenarios, discovers its own weaknesses, creates its own regression tests, then attacks itself again.

The human writes the search harness once. After that, the loop runs autonomously.

## Evidence (First Cycle)

| Metric | Result |
|--------|--------|
| Attack strategies | 4 (mutation, coalition, position gaming, sybil/floor) |
| Scenarios tested | ~430 per run |
| Genuine bug found | 1 (null player dust collection) |
| Fix applied | Contract + reference model updated in lockstep |
| Re-test after fix | 0 violations (was 92/500 before fix) |
| Position independence | PROVEN: 0 exploitable orderings across 100 rounds, 2 seeds |

## Implementation

1. Mirror production logic in exact arithmetic (Python `fractions.Fraction`)
2. Build adversarial search with multiple strategies
3. Compare production output vs reference output for every input
4. Any divergence = potential bug. Any profitable deviation = exploit.
5. Export exploits as permanent regression tests
6. Fix, re-run, verify fewer findings. Repeat.

---

## See Also

- [TRP Core Spec](../../concepts/ai-native/TRINITY_RECURSION_PROTOCOL.md) — Full protocol specification
- [Loop 0: Token Density](loop-0-token-density.md) | [Loop 2: Knowledge](loop-2-common-knowledge.md) | [Loop 3: Capability](loop-3-capability-bootstrap.md)
- [Efficiency Heat Map](efficiency-heatmap.md) — Per-contract discovery yield tracking
- [TRP Pattern Taxonomy (paper)](../../research/papers/trp-pattern-taxonomy.md) — 12 recurring vulnerability patterns from this loop
- [TRP Empirical RSI (paper)](../../research/papers/trp-empirical-rsi.md) — 53-round empirical evidence
