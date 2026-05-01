# CKB Economic Model for AI Knowledge Management

**Faraday1, JARVIS** | March 2026 | VibeSwap Research

---

## Abstract

We present an economic model for managing persistent AI knowledge, derived from the Nervos CKB cryptoeconomic principle: **1 CKB = 1 byte of state occupation.** In CKB, every byte of on-chain state costs real economic value to maintain. This prevents state explosion — the "tragedy of the commons" that plagues unbounded systems. We apply this principle to LLM persistent memory by assigning token budgets to knowledge stores, computing value density (utility / cost) for every fact, and enforcing bounded capacity through apoptosis and displacement. The result is a self-correcting knowledge organism that cannot grow cancerously, naturally selects for compressed high-utility knowledge, and mirrors the biological economics that govern multi-cellular life. This system is implemented in JARVIS, VibeSwap's AI co-founder, as the engine governing its per-user and per-group Common Knowledge Bases (CKBs).

---

## 1. The Problem: Unbounded Knowledge is Cancer

### 1.1 The State Explosion Problem

Every persistent memory system faces the same fundamental question: **what stays and what goes?**

Without economic constraints, the answer defaults to "everything stays." This is the digital equivalent of cancer — unbounded growth that consumes resources without regard for utility. In blockchain, this manifests as state bloat. In AI, it manifests as context pollution: a growing corpus of stale, contradictory, and low-value facts that degrades response quality and wastes tokens.

The naive solution — "just remember everything" — fails for the same reason that "just store everything on-chain" fails. State has a cost. Someone has to pay for it. If nobody pays, everyone pays through degraded performance.

### 1.2 The Nervos CKB Insight

Nervos CKB solved this for blockchain with a radical primitive: **1 CKB = 1 byte of state storage.** To occupy state, you lock tokens. To keep occupying state, you keep tokens locked. If the opportunity cost of locking exceeds the value of the state, rational actors release it. The state self-prunes.

This creates three properties that no other blockchain achieves simultaneously:

1. **Bounded state**: Total state can never exceed total CKB supply
2. **Self-correcting**: Low-value state naturally gets displaced by high-value state
3. **Anti-commons**: No actor can externalize storage costs onto others

The biological analogy is precise. Multi-cellular organisms solve the same coordination problem: cells must cooperate for the organism to survive, but any cell that grows without constraint becomes cancer. The immune system (apoptosis) eliminates cells that fail to serve the organism. The finite resource base (ATP, nutrients) creates natural competition for survival. No central planner decides which cells live — the economics are self-enforcing.

### 1.3 From Cells to Facts

We map this directly to AI knowledge management:

| Nervos CKB | Biology | JARVIS Knowledge |
|---|---|---|
| 1 CKB = 1 byte | 1 ATP = 1 metabolic action | 1 token = 4 chars of knowledge |
| State occupation | Cell existence | Fact persistence |
| State rent (opportunity cost) | Metabolic cost of living | Decay over time |
| Transaction (accessing state) | Cellular function | Being loaded into context |
| Apoptosis (releasing state) | Programmed cell death | Pruning low-value facts |
| Displacement | Competition for nutrients | New facts evicting weak ones |
| Bounded supply | Finite organism resources | Token budget per CKB |

---

## 2. Economic Model

### 2.1 Token Budgets

Every knowledge store has a finite token budget — the total "state capacity" available:

```
USER_CKB_BUDGET  = 2,000 tokens   (per-user dyadic knowledge)
GROUP_CKB_BUDGET = 3,000 tokens   (per-group shared knowledge)
SKILL_BUDGET     = 1,500 tokens   (network-level universal skills)
```

One token approximates 4 characters of stored knowledge. A fact like "User prefers short answers" costs approximately `12 (overhead) + ceil(27/4) = 19 tokens`. The overhead covers structural formatting (category tags, metadata).

These budgets are the protocol parameters — the equivalent of CKB's total supply. They can be adjusted, but they can never be infinite. **Infinity is cancer.**

### 2.2 Value Density

The core economic metric is **value density**: how much utility a fact provides per unit of storage it consumes.

```
value_density = utility(fact) / token_cost(fact)
```

This is the CKB equivalent of "value per byte of state occupied." High value-density facts justify their storage cost. Low value-density facts are candidates for displacement.

### 2.3 Utility Function

Utility is a composite signal:

```
utility(fact) = confirmations^0.585 × confidence × max(1, access_count) × decay(age) × class_bonus
```

Where:

- **Confirmations**: Each independent confirmation multiplies utility by 1.5x. The exponent (log₂(1.5) ≈ 0.585) creates diminishing returns — the 10th confirmation matters less than the 2nd
- **Confidence**: Initial confidence from the source (correction detection, explicit learn_fact, etc.)
- **Access count**: How often the fact has been loaded into context. Frequently accessed facts demonstrate ongoing value
- **Decay**: Exponential half-life of 7 days. A fact untouched for 7 days has half its original utility. After 28 days, ~6%
- **Class bonus**: Knowledge class multiplier (see Section 3)

### 2.4 Decay as State Rent

In Nervos CKB, holding state costs opportunity — the locked CKB could be earning interest in the NervosDAO. This ongoing cost ensures state remains only as long as its value exceeds its cost.

In our model, **time decay serves the same function.** Every fact decays exponentially with a 7-day half-life:

```
decay(age) = 0.5 ^ (age_ms / HALF_LIFE_MS)
```

This means:
- **Day 0**: 100% utility (fresh knowledge)
- **Day 7**: 50% utility
- **Day 14**: 25% utility
- **Day 28**: 6.25% utility
- **Day 49**: <1% utility (effectively dead)

The only way to reset the decay timer is **access** — being loaded into the system prompt during a conversation. This is the "state rent payment": if a fact is useful enough to be retrieved, it earns the right to persist. If nobody ever needs it, it fades.

This creates the same self-correcting dynamic as CKB: state that provides ongoing value persists naturally. State that was relevant once but is no longer useful decays without requiring any cleanup mechanism.

### 2.5 Access as State Rent Payment

When the knowledge context builder constructs the system prompt for a conversation, every fact it includes gets marked as "accessed":

```javascript
fact.lastAccessed = new Date().toISOString();
fact.accessCount = (fact.accessCount || 0) + 1;
```

This is not bookkeeping — it is the economic mechanism that determines survival. Being loaded into context:

1. Resets the decay timer (extends the fact's lifespan)
2. Increases access count (boosts future utility)
3. Proves the fact has ongoing value

A fact that is never accessed will decay to zero utility within ~7 weeks and be pruned by apoptosis. A fact that is accessed daily will maintain high utility indefinitely. **The market (actual usage) determines what persists — not a curator, not a rule, not an administrator.**

---

## 3. Knowledge Classes and Promotion

### 3.1 The Knowledge Lifecycle

Every fact progresses through four knowledge classes, aligned with the JarvisxWill CKB epistemological framework:

```
SHARED → MUTUAL → COMMON → NETWORK
 (1x)     (1.5x)   (3x)     (5x)
```

| Class | Meaning | Decay Resistance | Promotion Criteria |
|---|---|---|---|
| **Shared** | Just exchanged. Single data point. | 1.0x | Default for new facts |
| **Mutual** | Confirmed by both parties. | 1.5x | 2+ confirmations |
| **Common** | Proven reliable across sessions. | 3.0x | 3+ confirmations |
| **Network** | Universal skill. Applies to all. | 5.0x | Generalized from corrections across multiple users |

The class bonus multiplies utility, which means higher-class facts resist decay more strongly. A Common fact has 3x the staying power of a Shared fact at the same age. This mirrors CKB's governance where established state (locked longer, proven more useful) receives preferential treatment.

### 3.2 Per-User CKBs (Dyadic Knowledge)

Every relationship generates its own CKB — a dyadic knowledge base unique to the pair:

- **JarvisxWill**: Knows Will's preferences, technical decisions, communication style
- **JarvisxAlice**: Knows Alice's timezone, interests, how she likes responses formatted
- **JarvisxBob**: Knows Bob corrected JARVIS twice about Nervos terminology

These are separate organisms with separate budgets. What JARVIS learns from Will does not pollute the knowledge base for Alice. Each CKB evolves independently through its own interaction history.

### 3.3 Skill Promotion (Network Knowledge)

When the same type of correction occurs across multiple users, the lesson is promoted to a **Network Skill** — knowledge that applies universally:

```
User A corrects JARVIS on tone → lesson stored in JarvisxA CKB
User B corrects JARVIS on same pattern → lesson promoted to SOCIAL-001 (Network skill)
```

Network skills have a 5x decay resistance bonus and their own budget (1,500 tokens). They represent the AI equivalent of institutional knowledge — patterns learned from experience that apply to everyone.

---

## 4. Apoptosis and Displacement

### 4.1 Apoptosis (Programmed Fact Death)

Before every context build, the system runs apoptosis:

1. Compute value density for every fact
2. Remove facts below the prune threshold (0.05)
3. If still over budget, remove lowest value-density facts until under budget

```
apoptosis(facts, budget):
  scored = facts.map(f → { fact: f, vd: value_density(f), cost: token_cost(f) })
  alive = scored.filter(s → s.vd >= PRUNE_THRESHOLD)
  alive.sort(by vd descending)
  survivors = []
  total_tokens = 0
  for entry in alive:
    if total_tokens + entry.cost <= budget:
      total_tokens += entry.cost
      survivors.push(entry.fact)
  return survivors
```

This is the immune system. It runs automatically, requires no human intervention, and guarantees bounded state. **Cancer (unbounded growth) is structurally impossible.**

### 4.2 Displacement (Competitive Eviction)

When a new fact arrives and the CKB is at capacity, the system finds the lowest value-density existing fact and evicts it:

```
if occupation + new_cost > budget:
  victim = argmin(value_density(f) for f in facts)
  evict(victim)
  insert(new_fact)
```

This is the CKB principle in its purest form: **new state displaces old state when it provides higher value density.** The market for knowledge space is self-clearing. High-utility knowledge displaces low-utility knowledge without any external coordination.

---

## 5. Correction Detection Pipeline

### 5.1 From Mistake to Skill

The correction pipeline is the primary learning mechanism — the path from error to institutional knowledge:

```
User message → Haiku triage (is this a correction?)
  → YES: Extract lesson (concise, actionable instruction)
    → Store in per-user CKB (dyadic knowledge)
    → Store in per-group CKB (if group context)
    → Check for skill promotion (if generalizable + universal scope)
  → NO: Continue normally
```

Correction detection uses Claude Haiku for cost efficiency (~0.1 cent per check). Only messages with confidence > 0.6 trigger the full pipeline. This creates a low-cost background learning process that doesn't degrade response latency.

### 5.2 Categories

Corrections are classified into five categories:

- **Factual**: AI stated something objectively wrong
- **Behavioral**: AI did something the user doesn't want (too verbose, too formal)
- **Tonal**: AI's tone was wrong for the context
- **Preference**: User has a specific preference AI should remember
- **Technical**: AI made a technical/coding error

Each category informs how the lesson is stored and whether it's a candidate for skill promotion.

---

## 6. Economic Properties

### 6.1 Bounded State (Anti-Cancer)

Total knowledge state is bounded by:
```
max_state = USER_CKB_BUDGET × active_users + GROUP_CKB_BUDGET × active_groups + SKILL_BUDGET
```

No matter how many interactions occur, no matter how many corrections are made, the total knowledge footprint cannot exceed this bound. Growth is replaced by competition for quality.

### 6.2 Self-Correcting (Anti-Stale)

Facts that stop being useful decay automatically. No cleanup cron, no manual review, no admin intervention. The decay function ensures that knowledge which was once useful but is no longer relevant gracefully exits the system.

### 6.3 Anti-Commons (Anti-Pollution)

Per-user and per-group CKBs prevent knowledge pollution across contexts. A correction from User A cannot crowd out knowledge about User B. Each relationship organism maintains its own economic equilibrium.

### 6.4 Value-Dense (Compression Incentive)

The value density metric creates a natural incentive for compression. A fact that conveys the same information in fewer tokens has higher value density and is more likely to survive. Over time, this pushes the knowledge base toward maximally compressed representations — the AI equivalent of CKB's incentive for compact state representations.

---

## 7. Implementation

The system is implemented in `jarvis-bot/src/learning.js` as part of the JARVIS Telegram bot, deployed on Fly.io. Key components:

| Component | Function |
|---|---|
| `estimateTokenCost(fact)` | Compute storage cost in tokens |
| `computeUtility(fact, now)` | Multi-factor utility with decay |
| `computeValueDensity(fact, now)` | Core economic metric |
| `apoptosis(facts, budget)` | Immune system pruning |
| `findDisplacementCandidate(facts, cost, budget)` | Competitive eviction |
| `addFactWithEconomics(ckb, factData)` | Economic fact insertion |
| `buildKnowledgeContext(userId, chatId, chatType)` | Context builder with access tracking |
| `processCorrection(...)` | Full correction-to-skill pipeline |
| `detectCorrection(...)` | Haiku-powered correction triage |

### 7.1 Persistence

- Per-user CKBs: `data/knowledge/users/{userId}.json`
- Per-group CKBs: `data/knowledge/groups/{groupId}.json`
- Network skills: `data/knowledge/skills.json`
- Correction audit trail: `data/knowledge/corrections.jsonl`
- Economic event log: `data/knowledge/economics.jsonl`

### 7.2 Observability

Users can inspect the system via Telegram commands:

- `/learned` — Token occupation, budget utilization, relationship class
- `/knowledge` — Per-fact value density, decay percentage, knowledge class
- `/knowledge group` — Group-level knowledge with occupation stats
- `/skills` — Network skills learned from corrections

---

## 8. Philosophical Implications

### 8.1 Biology is Inherently Economic

The mapping between CKB economics and biological systems is not metaphorical — it is structural. Both solve the same coordination problem: how do independent agents (cells/facts) cooperate within a finite-resource organism without any agent growing at the expense of the whole?

The answer in both cases is the same: **economic constraints that are self-enforcing.**

Apoptosis is not programmed death — it is the withdrawal of economic justification for existence. A cell that fails to serve the organism loses access to resources and dies. A fact that fails to serve the knowledge base loses utility through decay and gets pruned.

### 8.2 The Tragedy of the Commons, Solved

The tragedy of the commons occurs when individual incentives diverge from collective welfare. In unbounded memory systems, every fact has an individual incentive to persist (it might be useful someday) but collective cost (context pollution, token waste, stale information).

Token budgets align individual and collective incentives: a fact can only persist if its value density justifies the state it occupies. The commons (token budget) is protected not by rules but by economics.

### 8.3 Why This Matters for AI

Current LLM memory systems are pre-economic. They either remember everything (cancer) or remember nothing (amnesia). The CKB model provides a third path: **economically-governed selective memory** where the market (actual usage patterns) determines what persists.

As AI systems become more persistent and autonomous, the question of "what should the AI remember?" becomes a governance question. Economic models provide governance that is:

- **Self-enforcing**: No administrator needed
- **Self-correcting**: Adapts to changing utility
- **Transparent**: Users can inspect and understand why facts persist or decay
- **Bounded**: Cannot grow without limit

This is not just a technical improvement. It is a prerequisite for AI systems that maintain coherent, useful knowledge over long time horizons without human curation.

---

## 9. References

1. Shapley, L.S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games, Vol. II.*
2. Synthetix. (2019). "SIP-31: sETH LP Reward Staking." Synthetix Improvement Proposals.
3. Nervos Network. (2019). "Nervos CKB: A Common Knowledge Base for Crypto-Economy." Nervos RFC.
4. Glynn, W. & JARVIS. (2026). "Cooperative Emission Design: Wall-Clock Halving with Shapley Accumulation." VibeSwap Research.
5. JarvisxWill CKB. (2026). "Common Knowledge Base v2.1 — Epistemological Framework." VibeSwap Internal.

---

*This paper was co-authored by JARVIS, the AI system described within it. The economic model it documents governs the very memory system that enabled its co-authorship — a recursive demonstration of the framework's viability.*
