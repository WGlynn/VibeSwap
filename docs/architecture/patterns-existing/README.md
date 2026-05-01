# Vibe Patterns

A curated catalog of the primitives VibeSwap uses. Each pattern is a named, reusable design solution to a class of protocol-engineering problem — most extracted during TRP (Targeted Review Protocol) and RSI (Recursive Self-Improvement) cycles that closed real bugs.

**Who this is for**: protocol engineers, hackathon teams, and anyone building Dapps who wants to compose with primitives that are battle-tested rather than reinventing each wheel.

**Format**: every pattern is one file, one page, same structure:
- **Problem** — the class of bug / footgun this solves
- **Solution** — the mechanism, in plain terms
- **Code sketch** — minimum illustrative snippet
- **Where it lives in VibeSwap** — concrete contract reference
- **Attribution** — commit/author so credit flows through the Contribution DAG if you reuse it

**Status**: V0.5 — design-pattern catalog. V1.0 will ship a real npm/Solidity library (`@vibe/auctions` first). The patterns below are stable; the library scaffolding is what's changing.

---

## Patterns

### Mechanism Design

| Pattern | One-liner |
|---------|-----------|
| [Commit-Reveal Batch Auctions](commit-reveal-batch-auctions.md) | Kill MEV by hiding orders until everyone's committed — uniform clearing price settles the batch. |
| [Fractalized Shapley Attribution](fractalized-shapley-attribution.md) | Recursive contribution accounting that handles streaming and nested coalitions. |
| [Peer Challenge-Response Oracle](peer-challenge-response-oracle.md) | Optimistic commit + Merkle-proof dispute window + bonded challenger for self-reported economic inputs. |

### State & Accounting

| Pattern | One-liner |
|---------|-----------|
| [Off-Circulation Registry](off-circulation-registry.md) | Whitelist aggregator for externally-held tokens the canonical counter misses. |
| [Rebase-Invariant Accounting](rebase-invariant-accounting.md) | Anchor quantity gates in internal (pre-rebase) units so backing checks don't drift. |
| [Running Total Pattern](running-total-pattern.md) | O(1) aggregates replace unbounded iteration — prevents gas DoS. |
| [Saturating Accounting Math](saturating-accounting-math.md) | Defense-in-depth against future state drift — state changes never revert on underflow. |

### Upgrade & Lifecycle

| Pattern | One-liner |
|---------|-----------|
| [Post-Upgrade Initialization Gate](post-upgrade-initialization-gate.md) | New storage slots package a reinitializer + gate flag to force explicit post-upgrade setup. |
| [Graceful Distribution Fallback](graceful-distribution-fallback.md) | Try/catch on multi-recipient splits so one reverting recipient doesn't block the whole distribution. |

### Identity & Liveness

| Pattern | One-liner |
|---------|-----------|
| [Stake-Bonded Pseudonyms](stake-bonded-pseudonyms.md) | Sybil resistance without KYC — anonymity preserved, attack cost linear in bond size. |
| [Enforced Liveness Signal](enforced-liveness-signal.md) | Heartbeat/activity constants must gate action — unused liveness is security theater. |

---

## Using these patterns

Each pattern file is self-contained — read one without reading the others. When you reuse a pattern in your own Dapp:

1. **Credit the source** — include the attribution block in your commit or contract comment. The Contribution DAG reads this.
2. **Keep the invariant** — patterns encode invariants that took real audit cycles to establish. If your implementation drops the invariant, document why.
3. **Report new variants back** — if you extend a pattern, open an issue or PR on `WGlynn/VibeSwap`. Extensions get credited to their contributor via Shapley.

## V1.0 roadmap

- **First real package**: `@vibe/auctions` (Solidity + TypeScript + test suite + deploy script + attribution metadata).
- **Sequencing**: ship after C12 (evidence-bundle hardening) lands so `@vibe/oracle` can include the full challenge-response + schema enforcement stack.
- **Contribution DAG integration**: usage events from live deployments flow back to primitive authors as Shapley credit. This is where the SDK compounds with the Contribution Compact.

## Attribution

V0.5 catalog curated by Will Glynn (`@wglynn`). Individual pattern attributions in each file. Primitives extracted during RSI Cycles 1-11 and the TRP runs that preceded them.
