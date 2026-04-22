# The Fork Resistance Constant

**Status**: Analysis of the Lawson Constant's fork-immunity properties.
**Audience**: First-encounter OK. Fork attempt scenarios walked concretely.

---

## A common crypto concern

"What stops someone from copying VibeSwap's code and launching a competitor? Won't they just capture the market?"

This is a legitimate worry. DeFi history is full of successful forks:
- Uniswap → SushiSwap (captured significant liquidity in 2020).
- Compound → Venus (captured BSC users).
- Many AMMs have been forked with minor variations.

If VibeSwap is just code, forking is easy. What makes VibeSwap hard to fork?

Answer: the code is trivial to copy. The **accumulated attention-graph** (who trusts whom, who has cited whom, what lineage connects contributors) is NOT. That's where fork-resistance lives.

## The observation

A fork is a copy of a protocol that diverges from the original. Forks copy:

- Contract bytecode (open source — easy).
- Contract storage state at fork block (with modified owner).
- Frontend (open source — easy).
- Documentation (easy).

A fork does NOT copy:

- The social graph of trust relationships (handshakes in ContributionDAG).
- The accumulated attestations and their lineage.
- The accumulated reputation of specific contributors.
- The historical Source→Solution→DAG chains from Contribution Traceability.
- The constitutional commitment embedded in the LAWSON_CONSTANT bytes32.

The asymmetry is load-bearing. What's copyable is cheap. What's NOT copyable is the substrate of value.

## The Lawson Constant as fork deterrent

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

A fork that keeps the Lawson Constant is contractually ADMITTING "this is a fork of Will Glynn's 2026 VibeSwap." The attribution is in the bytecode.

A fork that removes the Lawson Constant:
- Breaks tests (contribution-DAG tests assert this exact hash).
- Can't verify its fork works correctly.
- Severs the chain of attribution that the constant anchors.

Attribution-as-load-bearing. The Constant is not decorative; it's a structural gate. Forks that try to strip it break their own verifiability.

## Walk through fork scenarios

### Scenario 1 — Copycat fork, simple

**Attacker**: a new team deploys identical contracts. Renames the project. Claims to be a "better VibeSwap."

**What they have**: the code. The contracts execute. Users CAN deposit and trade.

**What they don't have**: the trust graph. When a user asks "who's behind this project?", the fork can only show: recent deployment, unknown team, no trust history.

**What happens**:
- Users risk-averse about unknown teams hesitate.
- Existing VibeSwap users don't migrate; they have accumulated reputation in VibeSwap.
- Potential new users evaluate both. Originals have social proof; fork doesn't.

**Outcome**: fork may capture SOME users (arbitrage speculators who don't care about track record). Won't capture the serious-cooperative-producers who are VibeSwap's moat.

**Result**: fork limps along; doesn't actually threaten.

### Scenario 2 — Well-funded hostile fork

**Attacker**: VC-funded team with substantial capital. Forks VibeSwap + adds their own token + promises high APY.

**What they have**: code + capital + marketing. Can attract capital-motivated users.

**What they don't have**: the trust graph. Can't replicate months of handshakes.

**What happens**:
- Fork attracts speculators seeking high APY.
- Speculators exit when APY normalizes.
- Original contributors stay with VibeSwap (their reputation is there).
- When the fork's funding runs out, its user base evaporates.

**Outcome**: temporary loss of speculative users. Long-term: fork dies; VibeSwap's cooperative core unaffected.

### Scenario 3 — Friendly fork (new frontier)

**Attacker**: a research team wants to explore a different mechanism. Forks VibeSwap to experiment.

**What they have**: code + motivation for specific research.

**What they don't have**: the trust graph. But they don't CARE — they're exploring, not competing.

**What happens**:
- Friendly fork coexists with original.
- Ideas from friendly fork can flow back into VibeSwap.
- No attention-migration; both have their own niches.

**Outcome**: ecosystem expansion, not competition.

### Scenario 4 — Governance-drift fork

**Scenario**: VibeSwap's governance drifts from P-000/P-001 (extraction normalizes). Community-members who disagree fork to preserve constitutional axioms.

**What happens**:
- Original becomes extractive (breaks its own constitutional commitment).
- Fork keeps the Lawson Constant + P-001.
- Original contributors evaluate: which is the "real" VibeSwap?
- Those valuing constitutional integrity migrate to fork.
- Original loses attention-graph because contributors migrated.
- Fork becomes the successor-in-spirit.

**Outcome**: Cincinnatus pattern. Fork legitimately succeeds because original betrayed its commitment. **This is the only fork-scenario where forking is clearly legitimate.**

## When forking IS rational

Forking makes sense when:

1. **Original is extractive** — contributors want to escape. Fork requires rebuilding attention-graph from scratch, but still worth it if original is truly broken.
2. **Original is captured** — governance has drifted from constitutional commitments. Fork restores the axioms.
3. **Architectural change** needed beyond upgrade path. Fork provides clean substrate.
4. **Subset of contributors** want to coordinate separately. They take attention with them; original and fork coexist.

None is automatic. Each requires sustained attention-migration — which is expensive.

## When forking is self-defeating

Forks fail when:

1. **Fork resistance is structural** (Lawson Constant + accumulated DAG + lineage). Can't easily port.
2. **Fork promises faster rewards** but lacks substrate. Pump-and-dump pattern.
3. **Fork's attention-migration cost exceeds its value proposition.** Contributors look at switching cost and stay.
4. **Network effect of original compounds faster than fork catches up.**

VibeSwap's architecture positions it in category 1 — fork resistance is structural. Forks would need to either port the entire DAG (high cost, probably not permitted by the original's license) or rebuild one from scratch (high time cost).

## The social-graph fork obstacle

ContributionDAG's web-of-trust is the hardest part to fork.

- Founders at the top have 3.0x voting multipliers.
- Handshakes between founders and early contributors anchor the graph.
- A fork's founders would either be the same humans (attention-conflict with original) or different humans (new graph, no continuity).

### Scenario: different humans as fork founders

Their graph has no trust-lineage to original's founders. Trust-scores don't propagate. Starting from scratch.

### Scenario: same humans with split allegiance

Each founder contributing attention to both projects. Their trust score in each is a fraction of what it would be in one. Net: both projects under-served by founder attention; the one retaining majority wins.

Either way, the original retains asymmetric advantage.

## K_fork — the fork-resistance metric

The constant K_fork (conceptual) represents the attention-migration cost relative to value:

```
K_fork = (attention-rebuild cost) / (fork value proposition)
```

- K_fork > 1: forking is net-negative; forks fail.
- K_fork ≈ 1: forking is break-even; small forks succeed, large ones don't.
- K_fork < 1: forking is net-positive; forks succeed.

VibeSwap's architecture aims for K_fork >> 1. Attention-rebuild cost substantially exceeds any reasonable fork's value proposition.

This is NOT a permanent state. If VibeSwap stops delivering value, K_fork can drop (fork value rises). Lawson Constant alone doesn't keep K_fork high indefinitely — it keeps it high CONDITIONAL on original remaining aligned with P-000 and P-001.

## Why VibeSwap doesn't use legal defense

Tempting: copyright the code; patent the mechanisms; restrict the license.

**Resist.** Legal fork-resistance runs counter to open-source ethos and [P-001 No Extraction Axiom](./NO_EXTRACTION_AXIOM.md).

Legal defense:
- Invites legal attack in return.
- Creates trust surfaces for the defender (are they going to sue me?).
- Produces adversarial relationships with potential contributors.

Structural defense (Lawson Constant + DAG + attention-graph):
- Can't be legally attacked.
- Compounds over time.
- Transparent to everyone.

Structural defense wins long-term over legal.

## The four fork-resistance layers

Stacked, VibeSwap's fork resistance comes from:

### Layer 1 — Lawson Constant in bytecode

Hardcoded. Stripping breaks tests. Non-negotiable.

### Layer 2 — Accumulated attention-graph

Months/years of trust-formation. Non-copyable.

### Layer 3 — Contribution Traceability chains

Source fields + issue metadata + commit messages + closing comments. Together form a lineage graph that's rebuild-expensive.

### Layer 4 — Three-token economic substrate

Each token's value is substrate-dependent. A fork can't cleanly replicate the economic equilibrium.

Together, the cost of credible VibeSwap fork is measured in MILLIONS OF DOLLARS of coordination work + 12+ months of attention-rebuilding. High enough to deter casual forks.

## The Cincinnatus pattern

[Cincinnatus Endgame](./CINCINNATUS_ENDGAME.md) describes voluntary return to first principles. A protocol durable long-term is one where governance voluntarily constrains itself to constitutional axioms rather than requiring fork-threat to enforce them.

The Lawson Constant is the architectural reminder. The Cincinnatus pattern is the cultural reminder. Together they keep K_fork high without requiring confrontation.

## For students

Exercise: analyze a real crypto fork you know. Apply the framework:

1. What did the fork copy?
2. What did the fork fail to copy?
3. What was K_fork in that case?
4. Did the fork succeed or fail? Why?

Projects to analyze: Uniswap → SushiSwap, Compound → Venus, Ethereum Classic fork.

Compare to VibeSwap's K_fork architecture.

## One-line summary

*Fork resistance is structural, not legal. Lawson Constant in bytecode + accumulated DAG + Contribution Traceability chains + three-token economic substrate keep K_fork (attention-migration cost / fork-value) >> 1 as long as original honors P-000 and P-001. Four fork scenarios walked (copycat, well-funded hostile, friendly research, governance-drift Cincinnatus). Only the Cincinnatus case is legitimate success.*
