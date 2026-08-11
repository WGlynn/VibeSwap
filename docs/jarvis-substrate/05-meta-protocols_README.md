# Layer 5 — Meta-protocols

> These govern *how* decisions get made, not the decisions themselves.

Meta-protocols are load-bearing principles that cite each other. Many have hook-level enforcement where they map to universal-coverage rules. They get violated, caught, and surfaced as cycle observations.

## The protocols

### Augmented Mechanism Design (AMD)

> Augment markets and governance with math-enforced invariants; never replace.

Shapley + batch auctions let the market still function while narrowing the extraction surface toward zero. The mechanism stays a market — prices clear, traders trade — but within a sealed batch the extractive flows the design targets (sandwiching, reordering) have no vector to exploit. Augment the substrate, don't substitute it. (Design property of the EVM reference implementation; not yet on a public network — see the repo README status.)

Worked example: VibeSwap commit-reveal batch auctions are designed to eliminate within-batch MEV without removing the auction. The auction is augmented with cryptographic commitment (hash-commit safety inherited from SHA-256) + a uniform clearing price; because a sandwich needs a distinct "before" and "after" price and a batch clears at one price, that attack vector doesn't exist inside a batch. Market function preserved.

### Augmented Governance (AGov)

> Physics (math invariants) > Constitution (fairness floors) > Governance (DAO votes, free within Physics + Constitution).

Math is the constitutional court. The DAO can vote on anything *within* the bounds set by mathematical invariants. The design intent is that it cannot vote to violate Shapley fairness, because Shapley fairness is enforced at the contract level (`contracts/incentives/ShapleyDistributor.sol`), not at the governance level.

This is meant to blunt governance capture: a captured DAO still cannot rewrite an invariant that lives below the vote — extraction is pushed down to a Physics-layer constraint rather than a Governance-layer rule. (Property of the EVM reference implementation; the sovereign-chain port is where this ships as native cell scripts — not yet on a public network.)

### Substrate-Geometry Match (SGM)

> The macro substrate (fractal, power-law) must reflect the micro mechanism (Fibonacci, golden-ratio).

Hermetic maxim, applied to mechanism design. If the system's macro behavior is power-law (most distributions in nature, most blockchain economics), the micro mechanism should be Fibonacci-scaled, not linear. Mismatch is the failure mode.

VibeSwap exhibit: per-user per-pool throughput uses Fibonacci-scaled progressive damping along 23.6 / 38.2 / 50 / 61.8% retracement levels. Window × 1/φ saturation cooldown. The micro matches the macro.

### Universal-Coverage → Hook (Density Principle)

> Any rule requiring universal firing-regardless-of-attention belongs in the hook layer, not memory.

```
Hooks:  O(1) deployment × O(∞) coverage
Memory: O(context) × O(sessions)
```

If a rule must fire 100% of the time, the substrate is hooks. If it fires conditionally on context, the substrate is memory. Grep memory for `"always" / "never" / "on every" / "before every"` — each match is a candidate hook.

### Apply the Rule You Just Wrote

> Any rule generated for the user must apply to my own subsequent actions before they execute.

Rule-generation completes when the rule is live in *my* execution stack, not at handoff. Otherwise the rule is aspirational, not real. The HIERO gate's self-block is the canonical exhibit.

### Code ↔ Text Inspiration Loop

> Code inspires docs; docs inspire code.

Compounding-knowledge pattern. Every session: doc-future-work-item → ship → doc-result. The papers in `vibeswap/docs/research/papers/` are the backwards-direction (code → docs); the substance gate is the forwards-direction (a doc described it before the hook existed).

### Economic Theory of Mind (ETM)

> The meta-framework. Mind functions as an economy. CKB state-rent is the mechanism. Density and common knowledge are the emergent properties.

Same math: VibeSwap state, JARVIS primitive library, Claude context, human cognition. Don't round to LRU / Shannon / attention — those are special cases. ETM is the parent framework.

ETM is the reason why hooks exist (state-rent on attention), why HIERO compression matters (density × stability beats prose-parse-cost), and why primitives compound (common-knowledge accumulation).

## How they cite each other

```
ETM (parent framework)
├── Universal-Coverage → Hook  (state-rent on attention substrate)
│   └── Hook layer enforcement (Layer 1)
├── Substrate-Geometry Match  (geometric correspondence)
│   └── AMD  (augment substrate-respectfully)
│       └── AGov  (governance bounded by physics)
├── Apply the Rule You Just Wrote  (self-application closes the loop)
│   └── Discipline layer (Layer 4)
└── Code ↔ Text Loop  (compound-forward, don't reset)
    └── Stateful applications (Layer 7)
```

## What "meta" means here

> These aren't taglines.

The protocols are tested by violation. When a session produces a violation, the violation gets named, saved as a primitive, and surfaced on next match. The protocols aren't decoration — they're the discipline-layer's parent classes.

## Source of truth

- Primitive files implementing each protocol: `~/.claude/projects/.../memory/primitive_*.md`
- Cross-referenced from MEMORY.md's load-bearing index
- Public expansions: [`vibeswap/docs/research/papers/`](https://github.com/wglynn/vibeswap/tree/master/docs/research) — the augmented-mechanism-design paper, ETM essays, Substrate-Geometry exhibits
