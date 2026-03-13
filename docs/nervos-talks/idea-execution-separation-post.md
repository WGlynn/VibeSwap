# Idea-Execution Value Separation: What If Ideas Were First-Class Financial Assets?

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Every contribution system bundles ideas and execution into a single unit. You can't fund the *concept* of MEV resistance without funding a *specific team*. This creates three pathologies: good ideas without executors die (Dead Idea Problem), funded ideas are hostage to their executor (Hostage Problem), and originality receives no premium over copying (Commoditization Problem). **Idea-Execution Value Separation (IEVS)** decomposes contributions into two independently tokenizable components — permanent Idea Tokens (the concept's intrinsic value) and time-bound Execution Streams (ongoing labor value). Inspired by Pendle Finance's yield tokenization, but applied to human contribution. The result: **proactive funding** — capital flows toward ideas *before anyone proposes to execute them*. CKB's cell model, where each idea and each execution stream is an independent cell with its own lifecycle, is the most natural substrate for this separation.

---

## The Bundling Problem

A venture capitalist writes a check to a founder. The check funds a *person*, not a *concept*. If the founder burns out, the idea dies with them.

A DAO votes to approve a grant. The grant funds a *team*, not a *vision*. If the team pivots, the original concept evaporates.

The conventional wisdom — "ideas are worthless, execution is everything" — is a half-truth that has become destructive ideology. Ideas *are* worthless **in systems that cannot price them independently**. IEVS creates the system that can.

Three pathologies of bundled contribution:

```
Dead Idea Problem:        Good concepts with no immediate executor get $0 funding
                          (DEX concept existed for years before Uniswap — worthless until built)

Hostage Problem:          Once funded through an executor, the idea dies if they fail
                          (No mechanism for ideas to survive their first builder)

Commoditization Problem:  No premium for originality, only for labor
                          (Why ideate when you can copy and capture equal value?)
```

---

## The Pendle Insight

Pendle Finance split yield-bearing assets into two tokens:
- **Principal Token (PT)**: Fixed, redeemable value — what you get back at maturity
- **Yield Token (YT)**: Variable stream of yield — time-bound, performance-dependent

The insight: fixed value and variable value are fundamentally different things and should be priced by different markets.

**The mapping to contributions:**

| Pendle Concept | Contribution Equivalent | Properties |
|---|---|---|
| Principal Token (PT) | **Idea Value** (retroactive Shapley rewards) | Fixed, permanent, intrinsic, instantly liquid |
| Yield Token (YT) | **Execution Value** (active Shapley rewards) | Variable, time-bound, performance-dependent |

The concept of automated market making is just as valuable today as when first articulated. That's PT — permanent intrinsic value. A developer shipping code generates value that requires continuous effort. That's YT — decaying, performance-bound.

---

## The Mechanism

Four composable contracts implement IEVS:

### 1. ContributionDAG — The Trust Graph

Directed acyclic graph of trust relationships. Users vouch for each other. Bidirectional vouches form "handshakes" — strongest trust. Trust propagates from founder nodes with 15% decay per hop, max 6 hops.

| Trust Level | Threshold | Voting Multiplier |
|---|---|---|
| FOUNDER | Root node | 3.0× |
| TRUSTED | ≥ 0.70 | 2.0× |
| PARTIAL | ≥ 0.30 | 1.5× |
| LOW | > 0 | 1.0× |
| UNTRUSTED | 0 | 0.5× |

### 2. IdeaToken — The Liquid Idea

When a new idea is proposed, a fresh ERC-20 token is deployed. Anyone can fund it by depositing reward tokens and receiving IdeaTokens 1:1. IdeaTokens are fully liquid from minting — tradeable on any DEX, usable as collateral, composable with any DeFi protocol.

IdeaTokens never expire. The concept they represent is permanent. Their market price is continuous price discovery on the quality of ideas, independent of execution.

### 3. Execution Streams — Time-Bound Labor Value

Anyone can propose to execute a funded idea. Streams auto-flow at calculated rates, split among active executors. Built-in accountability: if an executor fails to report a milestone within 14 days, stream rate decays 10% per day. When fully stalled, IdeaToken holders redirect to a new executor.

**The idea survives the death of its executor.**

### 4. Idea Merging — Market-Driven Deduplication

Duplicate ideas can be merged. Source funding transfers to target. Token holders swap 1:1. Merger receives 1% bounty. The market self-organizes around the best articulation of each concept.

---

## What IEVS Unlocks: Proactive Funding

Every funding mechanism today is reactive. Someone proposes → capital moves.

IEVS inverts this: capital moves toward ideas **before anyone proposes to execute them**.

A community identifies an unsolved problem — say, MEV resistance for cross-chain transactions. Under traditional models, someone writes a proposal, recruits a team, pitches for funding. Under IEVS, community members buy IdeaTokens immediately. The funding pool accumulates. When a qualified team appears, capital is already there.

**Instead of ideas competing for money, money competes for ideas.**

This is particularly powerful for public goods. Open-source software, academic research, and infrastructure chronically struggle to attract funding because their value is diffuse. IEVS provides a mechanism for the market to price and fund these contributions directly.

---

## Why CKB Is the Perfect Substrate for IEVS

This mechanism maps onto CKB's cell model with remarkable naturalness.

### Each Idea Is a Cell

```
Idea Cell {
  capacity: [accumulated funding in CKB]
  data: [idea_hash, total_supply, creator_pubkey, creation_epoch]
  type_script: idea_token_validator  // Defines valid funding/withdrawal
  lock_script: community_governed    // IdeaToken holders control
}
```

The idea cell's lifecycle is independent of any executor. Executors come and go; the idea cell persists. Its capacity represents accumulated belief in the concept. Its type script enforces the funding rules. No one can drain it without IdeaToken holder consensus.

### Execution Streams as Consumable Cells

```
Stream Cell {
  capacity: [allocated funding]
  data: [executor, rate, last_milestone, stale_deadline]
  type_script: stream_validator  // Enforces milestone reporting
  lock_script: idea_cell_ref    // Governed by parent idea
}
```

When an executor reports a milestone, they consume the stream cell and produce an updated one with reset stale timer. If they miss the deadline, the type script allows IdeaToken holders to consume the stream and redirect it. The executor can't prevent this — the type script defines it.

### Trust as Cell References

Each vouch in the ContributionDAG is an independent cell:

```
Vouch Cell {
  data: [voucher, vouchee, timestamp, weight]
  type_script: vouch_validator
  lock_script: voucher_only
}
```

Trust score computation traverses vouch cells via indexer — O(1) lookup, not O(n) storage iteration. Adding a vouch creates a cell. Revoking consumes it. The trust graph = the set of live vouch cells.

### Why CKB, Not Ethereum?

| Aspect | Ethereum | CKB |
|---|---|---|
| Idea lifecycle | Mapping entry (coupled to contract) | Independent cell (sovereign) |
| Executor accountability | `require()` checks (miss one = exploit) | Type script (only valid transitions exist) |
| Trust computation | Storage iteration O(n) | Cell indexer O(1) |
| Stream redirection | Complex access control | Cell consumption (natural lifecycle) |
| Idea merging | Multi-contract coordination | Cell consumption + production |

The cell model's independence means ideas, executions, and trust relationships each have their own lifecycle. They compose through cell references, not coupled state. This is the DeFi Extension Pattern at the substrate level.

---

## Beyond DeFi: Where IEVS Applies

**Open Source**: Issue authors receive IdeaTokens. Community funds important bugs/features. Bounty hunters compete for Execution Streams. If the first developer fails, the idea retains funding.

**Academic Research**: Theoretical frameworks get IdeaTokens. When subsequent work builds on them (ContributionDAG), original researchers' tokens appreciate. Shapley distribution ensures proportional credit.

**AI Contributors**: Under IEVS, AI contributions are tokenized through the same mechanism. An AI that proposes a novel mechanism design receives IdeaTokens. This is **Proof of Mind** made economically real.

---

## Open Questions for Discussion

1. **CKB-native idea discovery**: Could the indexer enable browsing unfunded ideas by category, trust-weighted popularity, or funding velocity? What query patterns would make idea markets efficient?

2. **Cross-chain IdeaTokens**: Ideas are chain-agnostic but funding is chain-specific. Could CKB IdeaTokens bridge to other chains via LayerZero while maintaining the trust graph on CKB?

3. **Quadratic funding for ideas**: Instead of 1:1 funding, could a matching pool amplify small contributions to ideas quadratically? The cell model seems ideal for transparent matching pools.

4. **Idea futures**: If IdeaTokens represent the market's assessment of concept quality, could you build a prediction market on idea success? What would the cell structure look like?

5. **Is permanent idea value real?** We claim ideas have intrinsic, non-decaying value. But do they? Does the concept of AMMs have the same intrinsic value in 2030 as in 2018? How should IdeaToken economics account for conceptual obsolescence?

---

## Further Reading

- **Full paper**: [idea-execution-value-separation.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/idea-execution-value-separation.md)
- **Related**: [ContributionDAG + Lawson Constant](https://github.com/wglynn/vibeswap/blob/master/docs/papers/contribution-dag-lawson-constant.md), [Shapley Value Distribution](https://github.com/wglynn/vibeswap/blob/master/docs/papers/shapley-value-distribution.md)
- **Code**: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*
