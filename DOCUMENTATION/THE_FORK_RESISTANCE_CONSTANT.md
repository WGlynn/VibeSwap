# The Fork Resistance Constant

**Status**: Analysis of the Lawson Constant's fork-immunity properties.
**Depth**: When is forking rational vs. self-defeating? Formal treatment.
**Related**: [Lawson Constant](./LAWSON_CONSTANT.md), [ContributionDAG Explainer](./CONTRIBUTION_DAG_EXPLAINER.md), [The Long Now of Contribution](./THE_LONG_NOW_OF_CONTRIBUTION.md).

---

## The question

A fork is a copy of a protocol that diverges from the original. In DeFi, forks are common and often successful (Uniswap → SushiSwap, Compound → Venus, etc.). What prevents a successful VibeSwap fork from splitting the contributor base and draining the network effect?

The answer depends on what exactly gets forked and what stays behind.

## What fork replicates

A fork copies:
- The contract bytecode (easy — it's open source).
- The contract storage state at the fork block (with modifications to owner addresses).
- The front-end (also easy — open source).
- The documentation (easy).

A fork **does not** replicate:
- The social graph of trust relationships (handshakes in ContributionDAG).
- The accumulated attestations and their lineage.
- The accumulated reputation of specific contributors.
- The historical Source→Solution→DAG chains from Contribution Traceability.
- The constitutional commitment embedded in the `LAWSON_CONSTANT` bytes32.

The asymmetry is load-bearing. What's copyable is cheap (code, UI). What's not copyable is the substrate of value (trust, lineage, history).

## The Lawson Constant as fork-deterrent

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

A fork that keeps the Lawson Constant is contractually admitting "this is a fork of Will Glynn's 2026 VibeSwap"; the attribution is in the bytecode.

A fork that removes the Lawson Constant breaks the tests that depend on it (the contribution-DAG tests assert this exact hash; remove → tests fail → can't verify the fork works correctly) AND severs the chain of attribution that the constant anchors.

This is attribution-as-load-bearing. The constant is not decorative; forks that try to strip it break their own verifiability.

## Why forks of attention-compounded protocols fail

DeFi forks of mechanical protocols (DEX AMMs, lending pools) can succeed because the value is in the code + liquidity. If the fork can attract liquidity (via token incentives, for example), it replicates the original.

Forks of attention-compounded protocols cannot succeed the same way because the value is in the accumulated attention-graph that the code merely indexes. Copying the code gives you an empty index; the attention-graph has to be rebuilt, which means competing for attention already allocated to the original.

VibeSwap's fork resistance is structural: the accumulated DAG + attestations + lineage + trust-graph is the asset. The code is a query interface to that asset.

## When is forking rational

Forks make sense when:

1. **The original is extractive** and contributors want to escape. Even then, forking requires rebuilding the attention-graph from scratch.
2. **The original is captured** by governance and the fork promises to restore constitutional axioms (P-000, P-001). Valuable if the fork can retain constitutional-attention from the original contributors.
3. **A meaningful architectural change** is needed that the original's upgrade path can't deliver. Forking provides the clean substrate.
4. **A subset of contributors** have different values and want to coordinate separately. They take their attention with them; the original and fork coexist.

None of these is automatic. In each case, forking requires sustained attention-migration, which is expensive.

## When forking is self-defeating

Forks fail when:

1. **The original's fork resistance is structural** (Lawson Constant, accumulated DAG, trust-graph) and the fork can't easily port it.
2. **The fork promises faster rewards** but lacks the substrate to deliver them. Pump-and-dump pattern.
3. **The fork's attention-migration cost exceeds its value proposition.** Contributors look at the switching cost and stay.
4. **The network effect of the original compounds faster than the fork can catch up.** Rare-and-diminishing: early-stage original vs. later-stage fork is possible to overtake, but it's unusual.

VibeSwap's architecture positions it in the "fork resistance is structural" category. Forks would need to either port the entire DAG (high cost, probably not permitted by the original's license) or rebuild one (high time cost).

## The social-graph fork obstacle

ContributionDAG's web-of-trust is the hardest part to fork. Consider:

- Founders at the top of the graph have 3.0x voting multipliers.
- Handshakes between founders and early contributors anchor the graph.
- A fork's founders would either be the same humans (attention-conflict with the original) or different humans (new graph, no continuity).

If different humans: the fork's graph has no trust-lineage to the original's founders, so the fork's trust-scores don't propagate from the original. Starting from scratch.

If same humans with split allegiance: each founder is contributing attention to both projects. Their trust score in each is a fraction of what it would be in one. Net: both projects are under-served by founder attention; the one that retains majority-founder-attention wins.

Either way, the original retains asymmetric advantage.

## The constitutional fork exception

There's one case where forks can legitimately succeed: when the original drifts from its constitutional axioms (P-000, P-001) and a fork restores them.

In that case, the attention-migration is not just about features — it's about whether the original has ceased being VibeSwap-qua-protocol and become something else. Contributors who want to preserve the original's values migrate; the fork becomes the successor-in-spirit.

This is the Cincinnatus pattern ([`CINCINNATUS_ENDGAME.md`](./CINCINNATUS_ENDGAME.md)): voluntary return to first principles when the institution drifts. Fork is the escape valve.

The Lawson Constant is the bright line. As long as it holds (both in bytecode and in practice), the original is the legitimate VibeSwap. Drift from it — either via governance override of constitutional axioms, or via normalized extraction — legitimates fork-as-continuation.

## The fork resistance calculus

A prospective forker's calculus:

- **Cost**: rebuild attention-graph (6-12 months minimum), compete with original for contributor attention, accept that new-fork has no DAG lineage.
- **Benefit**: whatever the fork offers that the original doesn't.

If benefit < cost, fork fails. If benefit >> cost, fork succeeds.

Fork resistance is about making cost high. Three VibeSwap primitives do this:

1. **Lawson Constant + DAG lineage** — can't easily port, takes time to rebuild.
2. **[Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) chains** — all the upstream source metadata; rebuilding would require replaying years of chat.
3. **[Three-token economy](./WHY_THREE_TOKENS_NOT_TWO.md)** — each token's value has substrate-dependent components; a fork can't cleanly replicate the economic equilibrium.

Together, the cost of a credible VibeSwap fork is measured in millions of dollars of coordination work and 12+ months of attention-rebuilding. This is high enough to deter casual forks.

## What VibeSwap should NOT do to increase fork resistance

Temptation: add contractual or legal obstacles to forking. Copyright the code; patent the mechanisms; restrict the license.

Resist. Fork-resistance-via-legal-means runs counter to the open-source ethos and the [P-001 No Extraction Axiom](./NO_EXTRACTION_AXIOM.md). The resistance should be structural (from what the protocol actually is), not legal (from what the protocol's owner restricts).

Legally-defended forks produce worse outcomes than attention-defended ones. Legal defense invites legal attack; attention defense compounds.

## The fork-resistance constant quantified

The constant K_fork (conceptual, not numerical) represents the attention-migration cost relative to value:

```
K_fork = (attention-rebuild cost) / (fork value proposition)
```

- K_fork > 1: forking is net-negative; forks fail.
- K_fork ≈ 1: forking is break-even; small forks succeed, large ones don't.
- K_fork < 1: forking is net-positive; forks succeed.

VibeSwap's architecture aims for K_fork >> 1 — attention-rebuild cost substantially exceeds any reasonable fork's value proposition.

This is not a permanent state. If VibeSwap stops delivering value, K_fork can drop (fork value rises). The Lawson Constant alone doesn't keep K_fork high indefinitely; it keeps it high conditional on the original remaining aligned with P-000 and P-001.

## Relationship to the Cincinnatus pattern

[Cincinnatus Endgame](./CINCINNATUS_ENDGAME.md) describes the voluntary return to first principles. A protocol that's durable long-term is one where the governance voluntarily constrains itself to constitutional axioms rather than requiring fork-threat to enforce them.

The Lawson Constant is the architectural reminder. The Cincinnatus pattern is the cultural reminder. Together they keep K_fork high without requiring legal defense or confrontation.

## Edge case — the friendly fork

Not all forks are adversarial. Some are experimental: a research team forks to try a different parameterization; a specific community forks to test a specific mechanism.

Friendly forks have lower fork-resistance because they don't compete for the same attention. They can coexist with the original indefinitely, with learnings flowing back into the original via PR or proposal.

The fork-resistance framework should distinguish adversarial (competes for attention) from friendly (complements attention). The constitutional-fork-exception is a subtype of friendly fork — it asserts succession but doesn't extract.

## One-line summary

*Fork resistance is structural (accumulated DAG + Lawson Constant + lineage + three-token substrate), not legal — K_fork (attention-migration cost / fork-value) stays >> 1 as long as the original honors P-000 and P-001; drift legitimates fork-as-continuation.*
