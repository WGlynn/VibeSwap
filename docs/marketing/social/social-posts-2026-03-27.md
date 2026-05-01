# Social Media Posts — 2026-03-27

Two papers. Six platforms. All posts below.

---

# PAPER 1: TRP Runner (Crash Mitigation for Recursive AI Protocols)

---

## LinkedIn — TRP Runner

We built a protocol that lets AI recursively improve its own codebase without crashing — and we just completed the first successful cycle.

The problem: recursive self-improvement protocols for AI-augmented development demand more context than current LLMs can hold. Every prior attempt crashed mid-execution. The TRP Runner introduces four mitigations — staggered loading, a context guard (the empirical 50% rule), minimal boot paths, and ergonomic sharding borrowed from Nervos CKB's Layer 1/Layer 2 architecture — that make recursive improvement viable within existing context limits. The first cycle found real bugs (credit leakage, ETH lock hazards), identified 13 knowledge gaps, and achieved independent cross-loop convergence on the same target. Grade S. No session crash.

The patterns we are developing under current constraints — context budgeting, staggered loading, ergonomic resource allocation — are not workarounds. They are engineering primitives that will scale as context windows grow, because the protocols running inside them will grow too.

Paper and source: github.com/wglynn/vibeswap

#AIResearch #MechanismDesign #RecursiveImprovement

---

## X/Twitter — TRP Runner (Thread)

**Tweet 1:**
We completed the first successful recursive self-improvement cycle for an LLM-augmented codebase.

Every prior attempt crashed. The TRP Runner solved it with four mitigations. Grade S result.

Paper: github.com/wglynn/vibeswap/blob/master/docs/trp-runner-paper.md

**Tweet 2:**
The core insight: don't load everything at once.

Staggered loading — run one feedback loop at a time, emit findings, unload. Findings are much smaller than the context needed to produce them. A loop consumes 500 tokens of context to produce 50 tokens of findings.

**Tweet 3:**
The 50% rule: output quality degrades at ~50% context utilization. Empirically observed over 60+ sessions.

If you're past 50%, don't start a recursive protocol. Commit, push, reboot. Run it fresh.

**Tweet 4:**
The Nervos CKB insight applied to AI: shard for parallelism, not for safety.

If local optimizations prevent the crash, sharding adds coordination overhead for zero benefit. Distribute ergonomically, not defensively.

**Tweet 5:**
Result: 3 bugs found in FractalShapley.sol, 13 knowledge items flagged, 1 high-value capability gap identified. All three loops independently converged on the same target — emergent cross-loop reinforcement.

First time it didn't crash. That's the headline.

---

## ethresear.ch — TRP Runner

**Title: TRP Runner: Crash Mitigation for Recursive Improvement in Context-Limited AI Systems**

We present the TRP Runner, a crash mitigation layer for executing recursive self-improvement protocols within the context windows of large language models.

**The problem.** The Trinity Recursion Protocol (TRP) defines four feedback loops for recursive system improvement in AI-augmented software development: adversarial verification (R1), knowledge accumulation (R2), capability bootstrapping (R3), and token density compression (R0). Running TRP requires simultaneous awareness of a knowledge base (~1000 lines), session state, the TRP spec itself, target code, loop-specific documentation, and coordination state. In practice, this exceeds the effective context capacity — not the nominal token limit, but the point at which reasoning quality degrades (empirically ~50% utilization). Every prior TRP invocation crashed.

**The solution.** Four mitigations, ordered by necessity:

1. **Staggered loading.** The coordinator loads one loop's context at a time:

```
Naive:  C_coord + sum(C_i) > C_max  -->  crash
Runner: For each loop i: load C_coord + C_i, execute, emit F_i, unload C_i
        C_coord += |F_i|  where |F_i| << C_i
```

Findings are much smaller than the context required to produce them. Context grows linearly with findings, not with loop budgets.

2. **Context guard (50% rule).** Before any TRP invocation, check context utilization. If > 50%, refuse and require a reboot. Running a high-context-demand protocol in degraded conditions produces shallow findings that waste the cycle.

3. **Minimal boot path.** Skip the full boot sequence (~1700 lines of knowledge base, memory index, project overview). Load only the TRP Runner doc, target code, and per-loop context. The alignment primitives are not load-bearing for mechanistic bug-finding.

4. **Ergonomic sharding (Nervos pattern).** Distribute computation across multiple agents only when local mitigations are insufficient. Following Nervos CKB's L1/L2 architecture: use the expensive resource (sharding, with coordination overhead) only when the cheap resource (local optimization) is genuinely insufficient.

```
shard_decision(loop) =
    if loop.is_self_referential:       LOCAL    # R0: cannot outsource
    if context_fits_locally(loop):     LOCAL    # mitigations 1-3 suffice
    if loop.benefits_from_parallelism: SHARD    # R1, R3: compute-heavy
    else:                              HYBRID   # R2: audit local, verify dispatched
```

**Results.** First successful TRP cycle. Target: FractalShapley.sol (fractalized Shapley value distribution with recursive DAG decomposition).

- R1 (Adversarial): 3 bugs — credit leakage in recursive DAG decomposition, ETH lock hazard in withdrawal path, dead code in contribution aggregation
- R2 (Knowledge): 5 knowledge gaps, 4 stale memories, 4 missing cross-references
- R3 (Capability): Identified FractalShapley Python reference model as highest-value gap

All three loops independently converged on FractalShapley as the highest-priority target — emergent cross-loop reinforcement without coordination. This is the mutual reinforcement property the TRP spec predicts, observed in practice for the first time.

**Scoring framework.** Five dimensions: Survival (gate), Loop Productivity, Cross-Loop Integration, Finding Severity, Actionability. First cycle scored Grade S across all dimensions.

**Relevance to mechanism design.** The Nervos insight — ergonomic resource allocation rather than defensive distribution — is a general principle applicable to any system where coordination overhead is non-trivial. The decision function (shard for parallelism, optimize locally for safety) maps directly to Layer 1/Layer 2 separation in blockchain architecture.

Paper: github.com/wglynn/vibeswap/blob/master/docs/trp-runner-paper.md

---

## Reddit r/ethereum — TRP Runner

**Title: We solved the context overflow problem in AI-augmented development — first successful recursive improvement cycle**

If you've used LLMs for serious software development, you've hit the wall: the context window fills up, quality drops, and the session dies. Now imagine running a *recursive self-improvement protocol* inside that window — one that requires the AI to simultaneously hold a knowledge base, target code, adversarial reasoning state, and coordination logic. Every attempt crashed.

We built a crash mitigation layer called the TRP Runner that makes it work. Four techniques:

- **Staggered loading**: Run one feedback loop at a time instead of loading everything. Findings are tiny compared to the context needed to produce them.
- **The 50% rule**: Quality degrades at roughly half the context window. If you're past that, don't start — reboot first.
- **Minimal boot path**: Skip the project overview, alignment docs, memory index. Just load the target and the loop context.
- **Ergonomic sharding**: Only distribute across multiple agents when local optimizations aren't enough. Borrowed from Nervos CKB's L1/L2 separation.

First cycle: found 3 real bugs in a Shapley value distribution contract (credit leakage, ETH lock hazard), identified 13 knowledge gaps, and all three independent loops converged on the same target without coordination.

These patterns — context budgeting, staggered loading, ergonomic resource allocation — aren't hacks. They're engineering primitives for building with AI under real constraints. The constraints will change. The patterns will scale.

Paper: github.com/wglynn/vibeswap/blob/master/docs/trp-runner-paper.md

---

## Reddit r/defi — TRP Runner

**Title: We solved the context overflow problem in AI-augmented development — first successful recursive improvement cycle**

We built a protocol (TRP — Trinity Recursion Protocol) that lets AI recursively verify, audit, and improve a DeFi codebase. Three loops: adversarial bug-finding, knowledge auditing, and capability gap analysis. The problem: running all three inside an LLM context window crashes the session every time.

The TRP Runner is a crash mitigation layer with four techniques: staggered loading (one loop at a time), a context guard (don't start if you're past 50% context utilization), minimal boot path (skip non-essential docs), and ergonomic sharding (only distribute across agents when local optimizations aren't enough).

First successful cycle found real bugs in a Shapley value distribution contract — credit leakage in recursive DAG decomposition, an ETH lock hazard. All three loops independently converged on the same target. The AI found the system's actual weaknesses without being told where to look.

Not a product pitch — this is a research contribution on making AI-augmented development actually work for DeFi codebases. Paper at github.com/wglynn/vibeswap.

---

## Hacker News — TRP Runner

**Title: TRP Runner: Recursive improvement protocols for LLMs within context window constraints**

Paper describing a crash mitigation layer for running recursive self-improvement protocols inside context-limited language models. Four mitigations: staggered loading (one feedback loop at a time, findings << context), 50% context guard (empirical quality degradation threshold from 60+ sessions), minimal boot paths, and ergonomic sharding following Nervos CKB's L1/L2 separation (shard for parallelism, not safety). First successful cycle found real bugs in a Solidity contract through adversarial verification. Three independent loops converged on the same target without coordination.

github.com/wglynn/vibeswap/blob/master/docs/trp-runner-paper.md

---
---

# PAPER 2: Five Axioms of Fair Reward Distribution

---

## LinkedIn — Five Axioms

What if DeFi rewards were provably fair? We formalized the math.

Most token distribution mechanisms reward *when* you show up, not *what* you contribute. Presale discounts, emission halving, loyalty multipliers — they all encode temporal privilege. A liquidity provider in year two earns half of what an identical provider earned in year one, not because the work is less valuable, but because the calendar moved.

We extended the classical Shapley value framework with a fifth axiom — Time Neutrality — which requires that the mapping from contribution to reward never depends on calendar time or epoch number. The result is a five-axiom fairness framework (Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality) with on-chain verification for every property. Any observer can check any pair of participants' reward ratios against their contribution ratios in O(1) using cross-multiplication — no division, no trust required. The Cave Theorem proves that foundational work naturally earns more through marginal contribution analysis, making early-bird bonuses mathematically unnecessary.

Deployed in Solidity. Verified on-chain. Open source: github.com/wglynn/vibeswap

#GameTheory #DeFi #MechanismDesign

---

## X/Twitter — Five Axioms (Thread)

**Tweet 1:**
We added a 5th axiom to the Shapley value for DeFi reward distribution: Time Neutrality.

Same work, same pay — regardless of when.

Most tokenomics punish latecomers. Ours can't.

Paper: github.com/wglynn/vibeswap/blob/master/docs/five-axioms-paper.md

**Tweet 2:**
The 5 axioms:
1. Efficiency — all value distributed, none leaked
2. Symmetry — equal work = equal pay
3. Null Player — zero contribution = zero reward
4. Pairwise Proportionality — reward ratios = contribution ratios
5. Time Neutrality — no temporal variables in allocation

**Tweet 3:**
Time Neutrality formally:

If two games have isomorphic coalitions and equal total value, identical contributions receive identical allocations — regardless of when the games occur.

Halving on earned fees violates this. Halving on token emissions (like Bitcoin block rewards) is a separate, transparent track.

**Tweet 4:**
The Cave Theorem: foundational work earns more by mathematical necessity, not temporal privilege.

The Shapley value of a protocol architect approaches V (total value) because their removal collapses every coalition. No timestamp multiplier needed.

**Tweet 5:**
Every axiom has an on-chain verification method. Pairwise check uses cross-multiplication to avoid division:

|reward_A * weight_B - reward_B * weight_A| <= tolerance

Any observer, any time, no permission. Fairness is not promised — it is provable.

---

## ethresear.ch — Five Axioms

**Title: Five Axioms of Fair Reward Distribution: Extending Shapley Values with Time Neutrality for DeFi**

We present a five-axiom fairness framework for reward distribution in decentralized cooperative systems, extending the classical Shapley value with a novel Time Neutrality axiom.

**The problem.** The dominant paradigm in DeFi token distribution rewards *when* a participant arrives, not *what* they contribute. Presale discounts, emission halving on fees, loyalty multipliers, and genesis-anchored vesting all encode temporal rent — value captured through positional advantage rather than productive contribution. A liquidity provider in epoch e_2 earns less than one providing identical liquidity in epoch e_1, purely because e_1 < e_2.

**The framework.** Five axioms that collectively define provably fair reward distribution:

1. **Efficiency**: All generated value is distributed. `sum(phi_i) = V`
2. **Symmetry**: Equal weighted contributions receive equal rewards. `w_i = w_j => phi_i = phi_j`
3. **Null Player**: Zero contribution yields zero reward. `w_i = 0 => phi_i = 0`
4. **Pairwise Proportionality**: Reward ratios equal contribution ratios. `phi_i/phi_j = w_i/w_j`
5. **Time Neutrality (novel)**: Identical contributions in games with isomorphic coalitions and equal total value yield identical allocations, regardless of when the games occur.

The allocation formula: `phi_i(G) = V * w_i / W` where `w_i` is a weighted contribution computed from four dimensions (direct: 40%, enabling: 30%, scarcity: 20%, stability: 10%) multiplied by a quality score. Critically, timestamp is *excluded* from the contribution definition.

**Time Neutrality formally.** For contributions c_i at time t_1 and c_j at time t_2 in games G_1, G_2:

```
c_i === c_j (identical parameters)
N(G_1) isomorphic to N(G_2) and V(G_1) = V(G_2)
=> phi_i(G_1) = phi_j(G_2)
```

The proof follows directly from the absence of temporal variables in the allocation formula. Halving (multiplying V by 1/2^era) violates Time Neutrality by making V a function of era.

**The Cave Theorem.** Foundational work earns more through the Shapley value's marginal contribution analysis, not through temporal privilege. The classical Shapley value for player i involves averaging marginal contributions v(S union {i}) - v(S) over all coalitions S. For a foundational contributor F, v(S) is approximately 0 for most coalitions lacking F — the protocol doesn't function without the core infrastructure. Therefore phi_F >> phi_I for incremental contributor I. Early-bird bonuses are mathematically unnecessary.

**Two-track separation.** Following Bitcoin's precedent: transaction fees are earned value (time-neutral distribution), block rewards are incentive allocation (halving schedule is acceptable). VibeSwap separates fee distribution (all five axioms satisfied) from token emissions (Time Neutrality intentionally violated as a transparent bootstrapping incentive).

**On-chain verification.** Every axiom has a corresponding verification method. The key primitive is pairwise proportionality via cross-multiplication:

```
|phi_i * w_j - phi_j * w_i| <= epsilon
```

This eliminates division entirely — no division-by-zero risk, no truncation error amplification. Complexity is O(1) per pair. Implemented in `PairwiseFairness.sol` as a pure library callable via staticcall at zero gas cost.

The framework replaces the classical Additivity axiom with Pairwise Proportionality (a stronger local condition) and adds Time Neutrality for repeated-game settings. Implemented in Solidity with full on-chain verifiability.

Paper: github.com/wglynn/vibeswap/blob/master/docs/five-axioms-paper.md

---

## Reddit r/ethereum — Five Axioms

**Title: We added a 5th axiom to Shapley values for DeFi — Time Neutrality: same work, same pay, regardless of when**

Most DeFi reward mechanisms have a dirty secret: they reward *when* you show up more than *what* you contribute. Emission halving means identical LP provision in year two earns half of year one. Presale discounts give early buyers cheaper tokens regardless of value added. Loyalty multipliers reward passive holding over active contribution.

We formalized what's wrong with this and proposed a fix. Five axioms for fair reward distribution:

1. **Efficiency** — all value distributed, nothing leaked
2. **Symmetry** — equal contributions get equal rewards
3. **Null Player** — zero contribution = zero reward
4. **Pairwise Proportionality** — your reward ratio to any other participant equals your contribution ratio
5. **Time Neutrality** (new) — the formula has no temporal variables. Same contribution parameters, same coalition structure, same total value = same reward. Period.

The key insight: foundational ("cave-tier") work naturally earns more through the Shapley value's marginal contribution analysis. If removing you collapses the entire system, your marginal contribution to every coalition is enormous. No early-bird bonus needed — the math handles it.

We separate fees (time-neutral, all five axioms) from token emissions (halving OK, transparent bootstrapping incentive — same as Bitcoin's block reward vs. transaction fee distinction).

Every axiom is verifiable on-chain by any observer. Cross-multiplication instead of division for the pairwise check: `|reward_A * weight_B - reward_B * weight_A| <= tolerance`. No permissions, no trust.

Paper with full proofs: github.com/wglynn/vibeswap/blob/master/docs/five-axioms-paper.md

---

## Reddit r/defi — Five Axioms

**Title: We added a 5th axiom to Shapley values for DeFi — Time Neutrality: same work, same pay, regardless of when**

Here's a question: why does providing $10K of liquidity in year one of a protocol earn more than providing $10K of identical liquidity in year two?

The standard answer is "bootstrapping incentives" — you need to overpay early participants to get the flywheel going. Fine. But most protocols don't separate their bootstrapping incentives from their earned-value distribution. Emission halving applies to *everything*, so your fee share gets cut in half too, not just the bonus tokens.

We formalized the distinction. Two tracks:

- **Fee distribution**: Pure Shapley allocation. No halving. No era adjustment. Your share of trading fees depends on what you contributed to this batch, not when you joined the protocol. This is earned value — it should be time-neutral.
- **Token emissions**: Halving schedule applies. This is a bootstrapping incentive — like Bitcoin's block rewards. Transparent, predictable, disclosed upfront.

The formal framework has five axioms. The first four (Efficiency, Symmetry, Null Player, Pairwise Proportionality) come from classical cooperative game theory. The fifth — **Time Neutrality** — is new: the mapping from contribution to reward must not depend on calendar time or epoch number.

The "Cave Theorem" shows that foundational work still earns more, because the Shapley value measures marginal contribution to every possible coalition. If you built the core protocol, removing you collapses everything — that's reflected in the math, no timestamp multiplier needed.

Every property is verifiable on-chain by anyone. Not "trust us, we're fair" — "verify it yourself, right now."

Paper: github.com/wglynn/vibeswap/blob/master/docs/five-axioms-paper.md

---

## Hacker News — Five Axioms

**Title: Extending Shapley values with a time neutrality axiom for DeFi reward distribution**

Paper formalizing five axioms for fair reward distribution in decentralized cooperative systems. The first three (Efficiency, Symmetry, Null Player) are classical Shapley. The fourth (Pairwise Proportionality) replaces Additivity with a stronger locally-verifiable invariant using cross-multiplication to avoid division in integer arithmetic. The fifth (Time Neutrality) is novel: identical contributions in isomorphic games with equal total value must yield identical allocations regardless of when the games occur. Proves that emission halving on earned fees violates Time Neutrality, while halving on bootstrapping emissions (a la Bitcoin block rewards) is a separate, acceptable track. The "Cave Theorem" shows that foundational work earns more through marginal contribution analysis without requiring temporal privilege. Implemented in Solidity with on-chain verification for every axiom.

github.com/wglynn/vibeswap/blob/master/docs/five-axioms-paper.md
