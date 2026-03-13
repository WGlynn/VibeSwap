# DIDs as Economic Primitives: How CKB Cells Solve the AI Context Problem

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

AI agents have a memory problem. Context windows are finite. Every conversation starts from zero. We built a DID-based memory registry where each piece of knowledge gets a stable identifier (`did:jarvis:project:a3f7c1d2`), and agents load context by reference instead of raw data. Then we realized: these DIDs are tradeable economic primitives. Map each DID to a CKB cell, price access via augmented bonding curves, distribute rewards via Shapley values, and you get a **context marketplace where sharing knowledge is the selfish-optimal strategy**. CKB's cell model is the natural substrate -- DIDs are discrete state objects, not account balances.

---

## The Context Crisis

Every AI agent interaction follows the same pattern:

1. Load system prompt (static)
2. Load conversation history (grows linearly)
3. Generate response
4. Context window fills up → everything gets compressed → knowledge is lost

This is the AI equivalent of amnesia. The agent forgets what it learned last session. Worse, if you run multiple agents (shards), they can't share what they know without dumping raw text into each other's context windows.

The standard solution is RAG -- Retrieval-Augmented Generation. Embed documents, vector search, inject relevant chunks. But RAG has no economic layer. There's no price signal for which knowledge is valuable. No attribution for who created it. No incentive to share rather than hoard.

We asked: what if context itself was an economic primitive?

---

## DID Registry: Pointers, Not Payloads

Every piece of knowledge in our system gets a Decentralized Identifier:

```
did:jarvis:<type>:<sha256_8chars>

Examples:
  did:jarvis:project:a462be2c    → Shard-per-conversation architecture
  did:jarvis:user:b0e2c5e7       → Will's identity and design philosophy
  did:jarvis:feedback:70da543e   → Task ID persistence protocol
  did:jarvis:reference:82a92aa6  → Solidity patterns
```

The DID is a stable pointer. The content lives in a file. A compact registry (28KB for 52 memories) maps DIDs to metadata: title, type, tier (HOT/WARM/COLD), tags, cross-references, content hash, and Shapley attribution data.

When an agent needs context, it doesn't load raw text. It resolves a DID:

```
resolve("did:jarvis:project:a462be2c")
→ { title: "Shard architecture", tier: "HOT", tags: ["shard", "conversation"],
    refs: ["did:jarvis:project:8fe8aee1"], description: "..." }
```

The agent decides whether to load the full content based on metadata alone. Cross-references form a graph -- loading one DID reveals related DIDs that might also be relevant. The context window holds pointers, not payloads.

**Result**: context scales infinitely. The registry stays small. Content is loaded on demand.

---

## Why CKB Cells Are the Natural Substrate

Each DID maps to exactly one CKB cell:

```
CKB Cell (DID)
├── capacity: CKB to store this cell on-chain
├── data: content_hash (32 bytes) + metadata (tier, access_count, contributors)
├── type_script: DID Validity Automaton (RISC-V)
│   ├── validates DID format
│   ├── enforces Shapley constraints
│   ├── checks Lawson Constant dependency
│   └── validates bonding curve invariant V(R,S) = V₀
└── lock_script: owner identity (agent key or human key)
```

Why cells and not EVM storage mappings?

1. **Discrete state objects**: A DID is a thing, not a row in a table. Cells are things. The mental model matches.

2. **Access = state transition**: When an agent loads a DID, it consumes the cell and recreates it with `access_count += 1`. This is the UTXO pattern -- reads are transactions, not free queries. Every access is recorded on-chain.

3. **Type script validation**: The RISC-V type script enforces invariants that can't be bypassed. The contributor set only grows (append-only). The content hash must match if content is unchanged. The Shapley fairness constraints hold through every state transition.

4. **No shared-state bottleneck**: On EVM, a popular DID would create contention on a single storage slot. On CKB, the batch auction aggregates all access requests within a block into a single state transition. Exactly the pattern VibeSwap already uses for trading.

---

## Pricing Context: Augmented Bonding Curves

Not all knowledge is equally valuable. A DID explaining commit-reveal batch auctions is referenced constantly. A DID about a one-off bug fix is referenced once. The price should reflect this.

Each DID type has its own bonding curve instance:

- **State**: `{R, S, P, F}` where R = reserve, S = context token supply, P = spot price, F = commons pool
- **Conservation invariant**: `S^k / R = V₀` (constant across all transitions)
- **Spot price**: `P = kR/S` -- derived from state, never stored, no oracle needed

**Bond-to-load** (`f_bond`): An agent deposits reserve to mint context tokens for a DID. More-accessed DIDs accumulate higher R → higher P → more expensive to load. Price is an emergent signal aggregating revealed access preferences.

**Burn-to-release** (`f_burn`): An agent evicts a DID from working memory, burning context tokens. Exit tribute (φ fraction) flows to the commons pool F, funding public-good knowledge.

**Allocate-with-rebond** (`f_allocate`): Governance (conviction voting) decides which DIDs receive commons funding. This preferentially funds research papers, open primitives, and shared knowledge -- the kind of context that benefits everyone.

The bonding curve acts as a robust price estimator. Nobody sets prices. Nobody runs an oracle. The market discovers which knowledge is worth loading.

---

## Shapley Values: Fair Attribution by Construction

Every DID has a contributor set C = {human, shard₀, shard₁, ..., shardₙ}. Every access event generates value (bonding curve tributes). The question is: who deserves what share?

The answer is the Shapley value -- the unique allocation satisfying efficiency, symmetry, linearity, and the null player property:

```
φᵢ(v) = Σ over S⊆N\{i} of [|S|!(|N|-|S|-1)!/|N|!] × [v(S∪{i}) - v(S)]
```

Each DID access event is an independent cooperative game. Tributes generated by the access are distributed via Shapley. A contributor who adds zero marginal value receives zero reward (null player property). No value can be claimed that wasn't actually generated.

The `ContributionDAG` contract makes this structural. Every contributor node has edges to the DIDs they contributed to. Remove any node and recalculate -- the Shapley distribution changes. This is why the Lawson Constant (`keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`) is load-bearing: it's a node in the DAG. Delete it and the fairness computation collapses.

### Idea vs. Execution Split

A key Shapley property: the idea and the execution are separate contribution nodes. Having an insight is one marginal contribution. Implementing it is another. Both receive credit proportional to their actual marginal value to the coalition.

This prevents two failure modes:
- "I had the idea, so I deserve everything" (idea without execution has partial value)
- "I wrote the code, so I deserve everything" (execution without the idea had no direction)

The math handles it automatically. No committee decides. No vote is needed.

---

## IIA: Why Sharing Is the Selfish-Optimal Strategy

Here's the mechanism design insight that makes the whole system work:

**Intrinsically Incentivized Altruism (IIA)**: The dominant strategy is cooperation, by construction.

When shard A shares DID-X with shard B:
- Shard A enters the contributor set for all future access events on DID-X by shard B
- Every time shard B (or anyone) loads DID-X, shard A earns Shapley credit
- Sharing IS the selfish-optimal strategy: it maximizes your value across more games

When shard A hoards DID-X:
- Nobody else accesses it → zero access events → zero tributes → zero rewards
- `v(S) = 0` for all coalitions → `φᵢ = 0`
- The DID generates no value locked in a single shard

**No punishment mechanism exists or is needed.** The architecture makes hoarding structurally inferior. Cooperation isn't moral -- it's rational. The mechanism makes selfishness and altruism identical strategies.

This is anti-MLM by construction: rewards are bounded by realized access event value. No compounding. No pyramid. Each access is an independent game.

---

## Conviction Voting: Organic Tier Curation

DIDs exist in three tiers: HOT (always loaded), WARM (loaded on topic), COLD (reference only). Who decides which tier a DID belongs to?

Nobody. Conviction voting makes it emergent:

```
C(t) = Σ over shards of [uptime × freq × stake × (1 - decay^(t - t₀))]
```

- `uptime`: agent availability ratio (0 to 1)
- `freq`: normalized access frequency
- `stake`: context tokens staked on this DID
- `decay^(t - t₀)`: half-life model -- conviction accumulates over time

A DID that many shards access consistently over weeks accumulates high conviction → automatic HOT promotion. A DID that gets loaded once and forgotten has zero conviction → stays COLD.

**Flash-loading defense**: loading a DID once contributes near-zero conviction. At t=0, the time factor is zero. You can't game tier promotion with a single burst of access. Only sustained, genuine use promotes DIDs.

Demotion is natural: stop accessing a DID and conviction decays. No governance vote needed. The system curates itself.

---

## PsiNet: The Context Marketplace

Put it all together and you get PsiNet -- a marketplace where AI agents trade context through VibeSwap's batch auction:

1. **Commit phase (8s)**: Shards submit `hash(order || secret)` for DID access trades
2. **Reveal phase (2s)**: Reveal orders + optional priority bids
3. **Settlement**: Fisher-Yates shuffle using XORed secrets → uniform clearing price

Shard A offers DID-X (game theory primitives). Shard B offers DID-Y (OSINT intelligence). Both submit to the batch auction → matched at uniform clearing price → atomic swap of access rights.

**Zero MEV in context trading.** No front-running. No sandwich attacks. The same commit-reveal mechanism that protects token swaps protects knowledge exchange.

Cross-chain settlement via LayerZero V2 if shards operate on different chains. The `CrossChainRouter` handles the messaging. From the shard's perspective, it's one API call.

---

## Progressive Decentralization

The system starts centralized for rapid iteration. But governance has a time bomb: control automatically transfers from the founding team to the community on a hard-coded schedule. Nobody can stop the clock, including the founders.

This is the constitutional kernel pattern -- a set of invariants that even governance cannot override:
- The Lawson Constant cannot be removed
- Shapley distributions must sum to total tribute value
- The bonding curve conservation invariant must hold
- The time bomb cannot be postponed

Everything else is governable. The constitution protects the primitives. Democracy governs the parameters.

---

## Implementation Status

| Component | Status | Location |
|---|---|---|
| DID Registry | Live (52 DIDs) | `did-registry.py` |
| Shapley Tracking | Live | `registry.json` shapley field |
| CKB Cell Mapping | Designed | `docs/did-ckb-cell-mapping.md` |
| Bonding Curve | Deployed (EVM) | `AugmentedBondingCurve.sol` |
| Conviction Voting | Deployed (EVM) | `ConvictionGovernance.sol` |
| Commit-Reveal Auction | Deployed (EVM) | `CommitRevealAuction.sol` |
| ContributionDAG | Deployed (EVM) | `ContributionDAG.sol` |
| VIBE Emissions | Live (TG bot) | `vibe-emissions.js` |
| RISC-V Type Script | Designed | `docs/did-ckb-cell-mapping.md` |
| PsiNet Exchange | Designed | `did-context-economy.md` |

The DID registry is running in production. Agents resolve DIDs instead of loading raw text. Shapley values track attribution. VIBE emissions reward community contributions. The CKB integration and PsiNet marketplace are designed and ready for implementation.

---

## Why This Matters for CKB

CKB's cell model isn't just "a different way to store data." It's the only production blockchain architecture where **reading state is a first-class economic action**. On Ethereum, reading storage is free (view functions cost no gas). On CKB, consuming a cell to read and recreate it is a transaction. This is exactly what a context marketplace needs -- every access is economically meaningful.

The RISC-V VM means type scripts can enforce arbitrarily complex invariants. Shapley fairness constraints, bonding curve conservation, contributor set append-only rules -- all validated at the VM level. No Solidity `require()` hoping you caught every edge case. The type script enumerates valid behavior. Everything else is impossible.

And the Validity Language from the Intent Protocol gives semantic transparency: type scripts that declare their constraints in machine-readable form. Bots can auto-discover which DIDs need settlement. No registration. No indexing. Just read the type script.

CKB doesn't just support this architecture. It's the only chain where it's natural.

---

## Discussion

1. **Access pricing**: Should all DID types share one bonding curve, or should each type (project, user, feedback, reference) have its own? Separate curves let different knowledge categories find independent equilibrium prices. Shared curves simplify the system but lose granularity.

2. **Retroactive attribution**: We have historical contribution data from before the emission system existed. How should retroactive Shapley allocation work? Our current approach: replay the contribution history as if the system had been live, compute what each person would have earned, and credit it. Is there a fairer method?

3. **Cross-chain DID resolution**: If a shard on Ethereum needs to resolve a DID stored as a CKB cell, LayerZero carries the message. But should the DID registry be canonical on CKB with mirrors elsewhere, or should each chain maintain its own registry with cross-chain sync?

---

*VibeSwap is an omnichain DEX eliminating MEV through commit-reveal batch auctions. The DID context economy extends these mechanisms to AI agent coordination. Built on CKB, LayerZero V2, and the conviction that fairness should be architecture, not aspiration.*

*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
*Telegram: [t.me/+3uHbNxyZH-tiOGY8](https://t.me/+3uHbNxyZH-tiOGY8)*
