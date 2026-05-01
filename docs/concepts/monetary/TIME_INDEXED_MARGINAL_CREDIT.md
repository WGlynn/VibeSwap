# Time-Indexed Marginal Credit

> *Alice publishes the first paper on a new result in June. Bob publishes a near-identical result in December, unaware of Alice's work. Should they be credited equally? Plain Shapley says yes. Common sense says no.*

This doc extracts a primitive that generalizes the Gap #2 Shapley fix from the ETM Build Roadmap: Shapley should be weighted by **time-indexed marginality** — a contribution's marginal value depends on what the ecosystem already knew when it arrived. Priority matters. The primitive extends this principle beyond economics into any credit-assignment setting.

## The authorship story

Science has had this problem for centuries. Newton and Leibniz both formulated calculus. Wallace and Darwin both formulated natural selection. Tesla and Marconi both formulated radio. In each case the near-simultaneous discoveries triggered priority disputes — and in each case, history settled them by asking: **who arrived first, and what did the ecosystem already know?**

Scientific priority is a time-indexed marginal credit system. Replications are credited (they're still knowledge) but at a discount. First publications get the lion's share. Partial-overlap contributions get partial credit.

Blockchain credit assignment, by contrast, has no built-in time-indexing. Plain Shapley computes marginal value within a given coalition at a given moment. If Alice and Bob both submit the same insight to the DAO, plain Shapley sees "two contributors added value equivalently" and splits credit 50-50. That ignores the ecosystem's prior knowledge state — the fact that by the time Bob submitted, Alice's contribution had already made Bob's information redundant.

The fix: make Shapley time-indexed. Compute each contribution's marginal value relative to the **ecosystem's state at the contribution's arrival time**, not relative to an abstract coalition.

## The primitive, stated precisely

**Time-Indexed Marginal Credit (TIMC)** is the rule that:

- **Each contribution C is a function of (content, arrival_time).** Content is what was contributed. Arrival time is when the ecosystem first learned it.
- **The marginal value of C is computed relative to the ecosystem knowledge-state S(t_C)** at arrival time t_C — not relative to an abstract all-contributors coalition.
- **Novelty multiplier ν(C) = f(similarity(C, S(t_C)))** — high novelty (C dissimilar to prior state) → high multiplier; low novelty (C similar to prior state) → low multiplier.
- **Floor constraint**: replications still receive credit, bounded below by a Lawson Floor (see [`THE_LAWSON_FLOOR_MATHEMATICS.md`](../../research/proofs/THE_LAWSON_FLOOR_MATHEMATICS.md)). Zero credit is not the right answer for replications; partial credit is.

The result: first publishers get high credit, replications get floor-bounded credit, and derivative work gets intermediate credit proportional to its incremental novelty.

## Why plain Shapley is wrong

Plain Shapley (see [`SHAPLEY_REWARD_SYSTEM.md`](../shapley/SHAPLEY_REWARD_SYSTEM.md)) is **permutation-symmetric**. It averages over all permutations of the coalition. This is a strength — symmetric treatment of all members — in settings where arrival order doesn't matter. But in a knowledge-accumulation setting, arrival order DOES matter.

Consider three contributors submitting knowledge K to an ecosystem:

- **Plain Shapley**: averages over 3! = 6 permutations of (Alice, Bob, Carol). Alice's marginal contribution is averaged across orderings where she's first, second, and third. Same for Bob and Carol. All three end up with equal credit.
- **Time-Indexed Shapley**: uses the ACTUAL arrival order. Alice arrived first when S was empty → high marginal. Bob arrived second when S already contained K via Alice → low marginal (replication). Carol arrived third when S already contained K via two prior sources → even lower marginal.

The difference is structural. Plain Shapley treats the space of possibilities (all orderings). Time-Indexed Shapley treats the actual history.

**This matches how science actually credits discoveries.** Not "what permutation would be fair?" but "who contributed what to the ecosystem in the order it actually happened?"

## Walked example: three contributors, same insight

Suppose the insight is worth 900 reward-tokens. Plain Shapley distributes symmetrically:
- Alice: 300
- Bob: 300
- Carol: 300

Now apply Time-Indexed Shapley. Similarity scoring returns:
- Alice's content similarity to S(t_A): 0.05 (almost entirely novel)
- Bob's content similarity to S(t_B): 0.90 (heavily redundant with Alice)
- Carol's content similarity to S(t_C): 0.95 (heavily redundant with Alice + Bob)

Novelty multipliers (ν = 1 - similarity):
- ν_A = 0.95 → 2.0x multiplier
- ν_B = 0.10 → 1.3x multiplier (Lawson Floor applies; replications still credited)
- ν_C = 0.05 → 0.7x multiplier (floor applies)

Weighted shares (normalized):
- Alice: 900 × (2.0 / (2.0 + 1.3 + 0.7)) = 900 × 0.50 = **450**
- Bob: 900 × (1.3 / 4.0) = 900 × 0.325 = **292.5**
- Carol: 900 × (0.7 / 4.0) = 900 × 0.175 = **157.5**

Alice went from 300 → 450 (+50% of her original share).
Carol went from 300 → 157.5 (-47.5% of hers).
Bob was close to average in both systems — the novelty curve is near-linear around his position.

Total conserved: 450 + 292.5 + 157.5 = 900. Same token budget, better-aligned distribution.

## Where this matters in VibeSwap

### ShapleyDistributor (Gap #2, C41-C42)

The core site. `contracts/incentives/ShapleyDistributor.computeShare()` currently uses permutation-averaged plain Shapley. Gap #2 extends the signature to accept a `priorContext: bytes32` hash representing the ecosystem state at the contribution's time, then weights by similarity.

**Code cycle scope (C41)**: extend the function signature + add similarity-lookup call. ~100 LOC change + 6 regression tests.

**Code cycle scope (C42)**: implement the off-chain similarity-keeper that computes the similarity score and commits it via commit-reveal. ~200 LOC of Python + 4 integration tests.

### ContributionAttestor

A supporting change. `getClaimsByContributorSince(contributor, since)` becomes a new query so the similarity keeper can compute state as of any time t. Small addition — ~30 LOC — but required for the keeper to function.

### Novelty Bonus Theorem

[`THE_NOVELTY_BONUS_THEOREM.md`](../../research/theorems/THE_NOVELTY_BONUS_THEOREM.md) proves that plain Shapley under-rewards novelty by a specific bounded amount. The Time-Indexed variant provably closes that gap. The doc exists; the code cycle is Gap #2.

### Contribution DAG ordering

The DAG (see [`CONTRIBUTION_DAG_EXPLAINER.md`](../identity/CONTRIBUTION_DAG_EXPLAINER.md)) already records arrival times via block timestamps. The data needed for TIMC already exists. What's missing is the scoring function that consumes arrival times.

### Cross-Domain Shapley

[`CROSS_DOMAIN_SHAPLEY.md`](../shapley/CROSS_DOMAIN_SHAPLEY.md) describes Shapley across multiple domains (code, docs, tests, etc.). TIMC applies within each domain — a contribution's novelty is computed against the ecosystem's prior state **in that domain**.

## The similarity function

The hardest design question: how do you compute similarity(C, S)?

Options:
1. **Human review**: attestors manually rate similarity. Too slow, too subjective.
2. **Embedding similarity**: compute embedding(C) and embedding(S), take cosine distance. Requires embedding infrastructure.
3. **Keyword overlap**: count overlapping n-grams. Simple but shallow.
4. **Graph-theoretic**: treat contributions as nodes in a DAG; compute graph-distance. Uses structure but ignores content.

The Gap #2 implementation plan uses **embedding similarity** (option 2) because:
- Can be computed by a trusted off-chain keeper.
- Embeddings generalize across content types (code, prose, math).
- Well-studied in NLP — lots of priors on which embeddings work.

**Trust boundary**: the keeper is trusted to compute similarities correctly. Mitigation: the keeper **commits** the similarity function publicly (via on-chain hash commitment) BEFORE being asked to compute any scores. Subsequent reveals verify the committed function is what's being used. No retroactive tuning.

See [`COMMIT_REVEAL_FOR_ORACLES.md`](../oracles/COMMIT_REVEAL_FOR_ORACLES.md) (queued) for more on this pattern.

## Student exercises

1. **Compute TIMC shares by hand.** Given three contributions with similarities [0.10, 0.60, 0.30] at arrival times [t1, t2, t3], distribute a 1000-token reward. Use the Lawson Floor at 0.2x and cap multipliers at 2.0x.

2. **Identify time-indexed marginality in a non-economic domain.** Describe how academic publication handles priority (who gets credit for a theorem). Map the rules onto TIMC.

3. **Detect novelty-game attacks.** If TIMC is deployed, what attacks could contributors run to boost their novelty scores? Propose a mitigation for each.

4. **Lawson Floor tuning.** Why isn't the floor set to zero? What behavior would zero-floor incentivize that is undesirable? What behavior would a 0.5x floor incentivize? Where is the sweet spot and why?

5. **Write the commit-reveal spec.** Specify the protocol for the similarity-keeper's function commitment: what does it commit, when, and how is it verified?

## Contrast with alternatives

### Pure "first finder wins"

Give 100% to the first contributor, 0% to subsequent. Problem: replications still provide value (verification, accessibility, alternative framings). Zero-crediting replications disincentivizes them entirely. The Lawson Floor exists for exactly this reason.

### Time-decayed credit

Weight contributions by age — older contributions get more because they've been useful longer. Problem: conflates usefulness-over-time with priority-at-arrival. A contribution could be old and still have been redundant at arrival; a new contribution could be highly novel. Age is a different axis than priority.

### Pure novelty weighting (ignore content merit)

Weight only by novelty, ignoring content quality. Problem: novel garbage gets more credit than redundant genius. Quality must remain in the formula; TIMC adds a novelty FACTOR, it doesn't replace content-value.

## Governance of the multiplier curve

TIMC parameters are governance-tunable within bounds:
- Multiplier range: [0.2x, 2.5x] absolute. Cannot be tuned outside this.
- Lawson Floor: minimum 0.2x multiplier. Governance can raise it but not lower it.
- Similarity function: commit-reveal locked. Changes require new commitment + reveal cycle.

Why bounded? Because extreme multipliers distort incentives. A 10x novelty bonus would make contributors compete on pure novelty-gaming regardless of content quality. A 0.01x floor would collapse the replication ecosystem. The bounds preserve the mechanism's intended shape.

See [`AUGMENTED_GOVERNANCE.md`](../../architecture/AUGMENTED_GOVERNANCE.md) for the general principle: governance is free WITHIN math-enforced invariants.

## Future work — concrete code cycles this primitive surfaces

### Queued for C41 (target 2026-04-25)

- **ShapleyDistributor signature extension** — add `priorContext: bytes32` parameter. Route similarity-score lookups from the passed context. 6 regression tests: equal-novelty case, pure-original case, pure-replication case, three-contributor-cascade, Lawson-Floor-binding, multiplier-cap-binding. `contracts/incentives/ShapleyDistributor.sol`.

### Queued for C42 (target 2026-04-28)

- **Similarity keeper** — off-chain Python service. Computes embedding(C) for each contribution, stores in IPFS or Arweave. Publishes similarity scores via commit-reveal (`commit_hash, reveal(function, salt)`). Integration test: simulate 10 contributions over 1 week, assert scores match expected curve. `scripts/similarity-keeper.py`.

- **ContributionAttestor time-windowed query** — `getClaimsByContributorSince(contributor, since)` + `getClaimsInWindow(t_start, t_end)`. Small additions. `contracts/identity/ContributionAttestor.sol`.

### Queued for cycle X (un-scheduled)

- **Multi-keeper consensus** — instead of trusting one similarity keeper, require M-of-N agreement. Useful once the protocol has mainnet economic stakes that could incentivize keeper corruption.

- **Alternative similarity functions** — A/B test embedding similarity vs keyword overlap vs graph-distance. Publish findings. Inform which default to use.

- **TIMC for code contributions** — most TIMC discussion is about prose/knowledge. Extend to code: novelty = how much of this PR's AST is dissimilar to prior state. Cycle-worthy once Gap #2 ships for prose.

### Primitive extraction

Extract this primitive to `memory/primitive_time-indexed-marginal-credit.md` once Gap #2 ships. The primitive becomes a design-gate: any new credit-assignment mechanism proposed for VibeSwap must justify whether time-indexed marginality applies to it or not.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](../ATTENTION_SURFACE_SCALING.md)) — the finite-surface-pays-convex-rent primitive. TIMC addresses a DIFFERENT axis: not how long a contribution persists, but what the ecosystem knew when it arrived.
- **Novelty Bonus Theorem** — proves plain Shapley's gap quantitatively.
- **Lawson Floor Mathematics** — prevents replications from getting zero.
- **Commit-Reveal For Oracles** (queued) — protects the similarity function from retroactive tuning.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Names the primitive (TIMC).
2. Specifies the similarity function trust boundary.
3. Queues C41 + C42 with enough specificity (file paths, test counts) that cycles can pick them up.
4. Opens a research direction (TIMC for code contributions).

When Gap #2 ships, this doc gets a "shipped" section with commit pointers + regression-test outputs as worked examples. The abstract curve becomes a concrete case. Further refinements (e.g., multi-keeper consensus) become follow-up cycles.

## One-line summary

*Time-Indexed Marginal Credit is the rule that contributions are credited proportional to their novelty relative to the ecosystem's knowledge-state at arrival time, not relative to an abstract all-contributors coalition. Generalizes Gap #2 Shapley fix. Lawson Floor prevents zero-credit for replications. Similarity function is commit-reveal-locked against retroactive tuning. Ships in C41-C42 (target 2026-04-25 to 2026-04-28).*
