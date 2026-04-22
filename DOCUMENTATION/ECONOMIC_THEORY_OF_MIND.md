# Economic Theory of Mind

**Status**: Meta-principle, Axis 0 of the VibeSwap design stack.
**Primitive**: [`memory/primitive_economic-theory-of-mind.md`](../memory/primitive_economic-theory-of-mind.md)
**Coined**: 2026-04-21 (Will + JARVIS, session-close articulation)

---

## The claim

The mind functions as an economy. Blockchain externalizes the pattern into a decentralized, legible, composable, multi-participant substrate. The same mathematics governs both.

**Directionality matters**: mind is primary; blockchain is the reflection. Cognition has always worked economically — the blockchain didn't invent the pattern, it made the pattern visible. Getting this direction wrong leads to reducing mind-theory to "blockchain analogies", which misses the load-bearing point: the reason crypto-economic mechanisms feel familiar is that they mirror structure the observer already runs internally.

## Why this is load-bearing

VibeSwap's entire design stack — from CKB state-rent to Shapley distribution to commit-reveal batch auctions — is coherent only under this principle. If the principle were "blockchain works like a special-purpose computer", then mechanism choices are arbitrary. Under ETM, mechanism choices have a correctness criterion: *does this mechanism faithfully mirror a cognitive-economic property*?

The [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md) methodology is downstream of ETM. The [Correspondence Triad](./CORRESPONDENCE_TRIAD.md) is the 3-check design gate derived from it. The [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) principle is the geometric form of the same idea: if reality has a fractal/power-law structure, mechanisms must scale fractally too.

## The cognitive-economic properties

A mind maintains a knowledge set. The knowledge set has costs:

- **Acquisition cost** — the attention paid to register a new fact. One-time.
- **Retention cost** — the ongoing attention paid to keep a fact accessible. Recurring; convex in how much you've already packed into working memory.
- **Retrieval cost** — attention paid when a fact is surfaced. Scales with density of the surrounding context.
- **Eviction** — facts that fall below the retention-cost threshold decay and are gone.

This is CKB-style state rent. The cognitive substrate CHARGES for occupying working-memory cells. State that pays rent stays alive; state that doesn't is evicted.

A mind also has production mechanisms:

- **Combinatorial reasoning** — new facts derived by composing existing ones. The marginal value of a fact is higher when it unlocks many derivations.
- **Novelty bonus** — new facts that don't merely recompute what's already derivable earn higher weight. Saturation reduces credit for later similar thoughts.
- **Consensus** — when multiple agents converge on a conclusion via independent reasoning, the conclusion earns higher confidence than any single agent's output.

These map onto Shapley distribution, time-indexed marginal credit, and Nakamoto Consensus Infinity respectively.

## Direct correspondences

| Cognitive property | VibeSwap mechanism | Doc |
|---|---|---|
| Working memory rent | CKB state-rent | [`CONSENSUS_MASTER_DOCUMENT.md`](./CONSENSUS_MASTER_DOCUMENT.md) |
| Marginal-contribution credit | Shapley distribution | [`SHAPLEY_REWARD_SYSTEM.md`](./SHAPLEY_REWARD_SYSTEM.md) |
| Evidence-weighted belief update | Commit-reveal batch auction | [`VIBESWAP_COMPLETE_MECHANISM_DESIGN.md`](./VIBESWAP_COMPLETE_MECHANISM_DESIGN.md) |
| Agent consensus | NCI weight function | [`THREE_TOKEN_ECONOMY.md`](./THREE_TOKEN_ECONOMY.md) |
| Reputation / trust | ContributionDAG + SoulboundIdentity | [`CONTRIBUTION_DAG_EXPLAINER.md`](./CONTRIBUTION_DAG_EXPLAINER.md) |
| Attribution (Lawson Constant) | ContributionAttestor submitClaim | [`CONTRIBUTION_ATTESTOR_EXPLAINER.md`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) |
| Self-monitoring | Circuit breakers + TWAP validation | [`CIRCUIT_BREAKER_DESIGN.md`](./CIRCUIT_BREAKER_DESIGN.md) |
| Memory decay | Unbonding delay + state eviction | [`CLAWBACK_CASCADE.md`](./CLAWBACK_CASCADE.md) |

## What ETM is NOT

This primitive is high-drift. It resists being rounded off to nearby familiar frameworks. Load-bearing:

- **Not LRU cache.** LRU evicts by recency; state-rent evicts by payment. The economic axis is load-bearing.
- **Not Shannon information theory.** Information is a measure; the economy is a dynamic where agents produce, exchange, and retire state under constraint.
- **Not working-set / attention models.** Those are observational descriptions; ETM is generative — it predicts what mechanisms should look like.
- **Not an analogy.** ETM claims the same mathematics. A Kullback-Leibler divergence over belief states under a budget constraint IS a Shapley computation over a cooperative game with outside options.
- **Not "blockchain is like the brain."** The claim is the reverse: the brain is like an economy, and blockchain is the first transparent instance of that economy we can design from scratch.

If you find yourself explaining ETM in terms of the bullets above, [`PATTERN_MATCH_DRIFT.md`](./PATTERN_MATCH_DRIFT.md) is firing — stop and re-read this doc.

## Implications for mechanism design

1. **Every mechanism should have a named cognitive property it mirrors.** Unnamed mechanisms are a smell — either the theory is incomplete or the mechanism is arbitrary. Fix the one that's wrong.
2. **Mirror faithfulness is the correctness criterion.** A mechanism can compile, test green, and still be wrong if it distorts the cognitive property it claims to externalize. [`ETM_ALIGNMENT_AUDIT.md`](./ETM_ALIGNMENT_AUDIT.md) is the canonical audit.
3. **Design backward from the property.** Don't design a mechanism and then ask "what does it model?" — the direction is cognitive-property → mechanism, because that's the direction the theory goes.
4. **When the mirror is imperfect, the gap is data.** It tells you either the mechanism is mis-designed or the theory needs refinement. Track in the [`ETM_BUILD_ROADMAP.md`](./ETM_BUILD_ROADMAP.md).

## Implications for infrastructure

ETM demands that informal, upstream contributions be legible on-chain — otherwise the externalization captures only the tail of the cognitive process. This is why [`CONTRIBUTION_TRACEABILITY.md`](./CONTRIBUTION_TRACEABILITY.md) exists: the chat → issue → solution → DAG loop is the infrastructure requirement for an ETM-aligned chain.

Without it, the chain reflects only commits. With it, the chain reflects the full cognitive flow that produced the commits.

## Implications for governance

Under [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md), the hierarchy is Physics > Constitution > Governance:

- **Physics** (math-enforced invariants) = the substrate — like the cognitive-economic laws themselves.
- **Constitution** (P-000 fairness, P-001 no-extraction) = the axioms that can't be voted away.
- **Governance** (DAO votes) = free action within the physical + constitutional bounds.

The hierarchy is directly ETM: in cognition, physics (what the substrate enforces) beats conscious intention (what the governance-layer wants) every time. On-chain we make this explicit.

## Implications for tokenomics

Three tokens, three roles — [`THREE_TOKEN_ECONOMY.md`](./THREE_TOKEN_ECONOMY.md):

- **JUL** = money, the primary liquidity layer. PoW-objective + fiat-stable. Never collapse to bootstrap. See [`JUL_MONETARY_LAYER.md`](./JUL_MONETARY_LAYER.md).
- **VIBE** = governance, the coordination-power layer.
- **CKB-native** = state-rent capital, the memory-substrate layer.

This is Tinbergen's Rule applied to crypto-constitutional design: three distinct policy goals demand three distinct instruments. It's also the cognitive economy at the constitutional layer — cognition has a money layer (tokens of account), a coordination layer (shared norms), and a memory-rent layer (the substrate that keeps it all active). Three layers, three tokens.

## One-line summary

*The mind is an economy; blockchain is its first transparent externalization; every mechanism must mirror a cognitive-economic property or be redesigned to.*
