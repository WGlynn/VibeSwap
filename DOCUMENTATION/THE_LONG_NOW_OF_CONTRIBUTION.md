# The Long Now of Contribution

**Status**: Long-timescale design philosophy. What makes contribution infrastructure durable across decades.

---

## The question

A contribution made now earns DAG credit. The credit may pay out across years — Shapley distributions compound as downstream contributors cite the earlier work. Over decades, the chain of attributions lengthens: Alice's 2026 insight informs Bob's 2030 design informs Carla's 2035 implementation informs Dana's 2040 audit...

The question: is this chain durable? Does the attribution-mechanism survive 10, 20, 40 years? If yes, how?

If no — if attribution infrastructure has a half-life shorter than the downstream impact it tries to capture — then the promise of long-term compensation is effectively a lie.

## Why this matters

Software-industry contribution systems have a well-documented short memory. GitHub commits from 2010 are technically preserved but socially forgotten; the original authors of foundational libraries are rarely compensated as their libraries propagate. Open-source's classic failure mode.

VibeSwap claims to do better. To justify the claim, the system must be designed for the long-arc: decades, not years.

## The three long-timescale requirements

### 1. Substrate survivability

The attribution records must survive chain forks, substrate changes, and provider failures. [Mind Persistence Mission](./MIND_PERSISTENCE_MISSION.md) addresses this at the infrastructure layer — encrypted capsules, Shamir-shared keys, multiple substrates. The same principles apply at the on-chain layer: attribution records replicated across multiple chains, cross-referenced so breaking one chain doesn't lose the whole history.

### 2. Economic durability

The rewards for old attributions must remain economically meaningful. Two dangers:
- **Inflation erosion** — if the token issuance outpaces attribution decay, old attributions get monetarily diluted.
- **Obsolescence** — if the project pivots and prior contributions become less relevant, old attributions lose economic weight.

VibeSwap's mitigations:
- JUL's PoW-backing + halving-schedule protects against monetary inflation.
- PoM attributions decay gradually (not cliff-off), so even obsolete contributions retain some weight.
- [Novelty Bonus](./THE_NOVELTY_BONUS_THEOREM.md) ensures early-novel contributions get super-linear credit, protecting against "late obsolescence equals zero value".

### 3. Narrative legibility

After 20 years, a reader examining the DAG must be able to reconstruct WHY each attribution was assigned. Not just "Alice got N units" but "Alice got N units because of contribution X, which was in response to problem Y, which arose in context Z". Without this narrative substrate, attributions become cargo-cult artifacts.

[Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) is this requirement operationalized. Each attribution has a Source, a solution artifact, and a closing comment. The full lineage is reconstructible from any entry point.

## The present-bias problem

Humans and markets both have present bias: immediate rewards weigh more than distant ones, exponentially. Under pure present-bias, contributions that pay off only in 20 years are undervalued by the discount factor.

In economic theory this is rational under uncertainty about the future. In cooperative-production theory, it leads to a pathology: *nobody does work whose payoff is more than 5 years away, because the present-value is too small.* Which is precisely the work that would have the biggest long-term impact.

VibeSwap tries to mitigate via:
- **Deep lineage credit** — downstream attributions that cite upstream increase the upstream's ongoing payout. An insight that propagates for 20 years keeps paying the originator.
- **Attestation longevity** — claims accepted are not re-litigated. Once accepted, they accumulate lineage credit forever.
- **Constitutional immutability** — P-000 and P-001 are not parameters; they are axioms. Future-governance cannot retroactively erase attribution.

Each of these partially counteracts present-bias. Not a full cure — present-bias is deep — but enough to make long-arc contribution economically defensible.

## The Lindy filter

Lindy's Law (Nassim Taleb): things that have existed for N years are expected to exist for N more. Applied to infrastructure, the older a mechanism, the more robust it's demonstrated to be.

For VibeSwap to earn Lindy, it has to survive long enough to compile a track record. Year 1 looks like a startup; year 10, an institution; year 30, a foundation. The principles that make this possible:

- **Minimalism of axiom count** — few load-bearing principles, each heavily tested. P-000 and P-001 are the core; everything else derives.
- **Modular primitives** — any single primitive can be replaced/refined without breaking the whole. See [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md).
- **Self-documenting architecture** — the repo is navigable by newcomers even after 10 years of accreted history. [MASTER_INDEX.md](./MASTER_INDEX.md) serves this.

None of these guarantee Lindy. They make Lindy achievable.

## The generation-gap problem

A contributor in 2026 and a contributor in 2046 have different context, tools, vocabulary. Old attributions may become illegible to new contributors. "Why did Alice get 100 units for this? What even is PoW?"

VibeSwap's answer: preserve the narrative substrate so illegibility is recoverable. If Alice got credit for a PoW contribution, the Source field shows the channel and date, the issue body explains the problem Alice was addressing, the commits show what changed. A 2046 contributor with patience can reconstruct the 2026 context.

This is pattern-continuity. The mechanism doesn't assume 2046's contributors know 2026's context. It assumes they have the tools to recover it.

## The Lawson-constant-as-keystone

The [Lawson Constant](./LAWSON_CONSTANT.md) is the keystone of long-arc attribution. If you remove attribution, the DAG becomes a sequence of orphan events. If you preserve attribution, the DAG becomes a lineage graph.

Lineage graphs are durable in a way event sequences aren't. A lineage graph can be examined from any node backward to origin; an event sequence has to be read chronologically from the beginning, which gets more expensive the longer the history.

This is why VibeSwap hardcodes the Lawson Constant into the contract bytecode. It's not a slogan. It's the mathematical guarantee that the chain remains navigable after it becomes too long to read.

## The 20-year projection

If VibeSwap survives 20 years:

- The DAG has ~O(10^6-10^8) nodes covering a significant fraction of the project's contributor-labor.
- Attribution lineage extends back through 5-10 substrate migrations (chains, providers, versions).
- Governance has faced multiple attempted captures, each resolved via constitutional axiom.
- Early contributors from 2026 continue receiving DAG-credit payouts from downstream citations.
- The project is unrecognizably-evolved from 2026 but the lineage is still traceable from any current contribution back to earliest.

If VibeSwap doesn't survive 20 years:

- The infrastructure (Mind Persistence, Contribution Traceability, Encrypted snapshot capsules) remains as open-source reference. Other projects adopt the patterns.
- The attribution-chain up to the shutdown is preserved and navigable (per Mind Persistence Mission's off-chain capsules).
- The principles (Lawson Constant, P-000, P-001) persist as design literature.

Either way, the long-arc investment isn't wasted. It either compounds within VibeSwap or propagates outward.

## Relationship to ETM

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md)'s load-bearing claim is that cognition works economically. Long-arc durability of attribution in cognition is via written language, shared institutions, cultural memory — ETM predicts the chain needs functionally-equivalent mechanisms for attribution to last.

VibeSwap's long-arc infrastructure is that functional equivalent. Contribution Traceability is the chain's "written language" for cognition; the DAG is its "shared institution"; the Lawson Constant is its "cultural memory".

## One-line summary

*Attribution has to survive substrate changes, economic turnover, narrative discontinuity, and governance attacks over decades — designed by minimalist axioms + modular primitives + preserved narrative + Lawson Constant, with partial present-bias mitigation via deep-lineage credit.*
