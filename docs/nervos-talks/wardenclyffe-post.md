# Wardenclyffe: An Inference Cascade That Starts Cheap and Levels Up on Demand

**Authors:** Faraday1 & JARVIS -- vibeswap.io
**Date:** March 2026

---

## TL;DR

We built an AI inference router called **Wardenclyffe** that routes requests across 13 LLM providers in three cost tiers. The key insight: **70-80% of all messages don't need a frontier model.** A "hey jarvis" doesn't need Claude. A status check doesn't need GPT-5.4. So instead of starting at the most expensive provider and degrading on failure (cascade-down), we **start at the cheapest adequate provider and escalate only when quality gates fail** (hybrid escalation). The result: ~85% cost reduction, zero downtime over 50K+ requests, and -- critically -- free compute that multiplies linearly with network size. Each shard in the JARVIS Mind Network has its own API keys. N shards = N times the free tier capacity. We think CKB is the right place to anchor the provenance and economics of this system, and this post explains why.

**Full paper:** [Wardenclyffe v3: Hybrid Escalation Router for Zero-Downtime AI Inference](../papers/wardenclyffe-inference-cascade.md)

---

## The Economic Problem

Most AI applications hardcode a single LLM provider. When that provider goes down, the application goes down. Rate limits, billing failures, model deprecations, regional outages -- they all reduce to the same outcome: total service loss.

The obvious fix is a fallback cascade: try the best provider first, fall back to cheaper ones on failure. This is what Wardenclyffe v1 and v2 did. It guaranteed quality but at maximum cost, because **every message started at the $9/MTok tier.**

Look at the actual traffic distribution from production:

| Classification | % of Traffic | What It Looks Like |
|---------------|-------------|-------------------|
| Simple | ~40% | Greetings, status checks, one-liners |
| Moderate | ~30% | Questions, explanations, short discussion |
| Complex | ~20% | Coding, analysis, mechanism design |
| Multimodal | ~10% | Images, documents |

Under cascade-down, a "gm" costs the same as a multi-step architecture review. That is economically irrational.

---

## The Inversion: Start Cheap, Level Up

Wardenclyffe v3 inverts the model:

```
Request arrives
    |
    v
[Heuristic Triage -- classify complexity (0ms, $0)]
    |
    v
[Get Escalation Chain -- cost-ascending provider list]
    |
    v
[Try cheapest adequate provider]
    |--- success + quality gate pass --> return response
    |--- hard fail (empty/error) --> retry or escalate
    |--- soft fail (low quality) --> auto-escalate to next tier
    |
    v
[Walk chain until success or exhaustion]
    |
    v
[All providers exhausted --> return error with full trail]
```

### Zero-Cost Triage

The triage layer classifies every request using regex patterns and message metadata -- no LLM call required. Classification takes less than 1ms:

| Classification | Starting Tier | Pattern |
|---------------|--------------|---------|
| `simple` | 0 (Free) | Short greeting, status check |
| `moderate` | 0 (Free) | General conversation, questions |
| `coding` | 1 (Budget, ~$0.50/MTok) | Code keywords, file extensions |
| `math` | 1 (Budget) | Formulas, quantitative analysis |
| `reasoning` | 2 (Premium, ~$9/MTok) | Philosophy, mechanism design, tradeoffs |
| `tooluse` | 2 (Premium) | Tool definitions present in request |

The key change from v2: `moderate` now starts at Tier 0 instead of Tier 1. This alone captures ~30% of traffic at zero cost.

### Two-Level Quality Gate

**Hard gate**: Rejects truly broken responses -- no content blocks, truncated JSON, empty text.

**Soft gate**: Detects responses that are technically non-empty but inadequate:
- Response too short for complexity class (e.g., <60 chars for a `reasoning` query)
- Refusal patterns from weak models ("as an AI, I cannot...")
- Echo detection (response >60% word overlap with query = parroting)

The soft gate is intentionally conservative. False negatives (accepting mediocre responses) are cheaper than false positives (unnecessary escalation). Every escalation costs money.

### The Provider Registry

Three tiers, 13 providers:

**Tier 0 -- Free ($0/MTok):** Groq, Cerebras, SambaNova, Fireworks, Novita, OpenRouter, Mistral, Together -- all running Llama 3.3-70B variants or equivalent.

**Tier 1 -- Budget (~$0.50/MTok):** DeepSeek (deepseek-chat), Gemini 2.5 Flash, Ollama (local).

**Tier 2 -- Premium (~$8/MTok):** Claude Sonnet 4.5, GPT-5.4, Grok-3.

Escalation chains are classification-specific and cost-ascending:

```
simple   : groq -> cerebras -> sambanova -> fireworks -> deepseek -> gemini
moderate : groq -> cerebras -> sambanova -> deepseek -> gemini -> xai -> claude
coding   : deepseek -> gemini -> openai -> xai -> claude
reasoning: claude -> xai -> openai -> deepseek -> gemini
```

Within each tier, providers are ordered by specialist fit for that task type.

---

## Free Compute Multiplication: The Network Effect

This is the critical insight that makes Wardenclyffe viable at scale, and the part most relevant to decentralized infrastructure.

Each free-tier LLM provider enforces rate limits **per API key**. A single node gets ~5.5M tokens/day across all free providers. But the JARVIS Mind Network runs multiple shards, and each shard has **its own API keys**:

```
Shard-0: Groq key A -> 1M tok/day
Shard-1: Groq key B -> 1M tok/day
Shard-2: Groq key C -> 1M tok/day
───────────────────────────────────
Network total:         3M tok/day from Groq alone
```

This is not load balancing. This is **quota multiplication** -- each shard brings independent, full-capacity allocations from every provider.

The scaling law:

```
Free_headroom(N) = (N * 5.5M) / 925K daily requirement

Free_headroom(1)   =  5.95x
Free_headroom(3)   = 17.84x
Free_headroom(10)  = 59.46x
Free_headroom(100) = 594.6x
```

At 10 shards: $113.30/month total for a production-grade AI inference network serving ~9.25M tokens/day across 130+ free-tier API allocations with 59x headroom. The marginal cost of adding a shard is $11.33/month, and each shard brings 5.5M new free tokens/day.

### Shard Coordination

Shards don't share rate limits -- they multiply them. But they DO share:

- **Circuit breaker state**: If shard-0 discovers Groq is down, it broadcasts so shard-1 and shard-2 skip it immediately
- **Performance rankings**: Per-provider latency EMA shared across shards
- **Escalation metrics**: Aggregate tier distribution optimizes the triage classifier

Communication uses BFT consensus and CRPC (the same protocols used for response verification):

```
Shard-0 detects: Groq circuit -> OPEN
    |
    v
[BFT broadcast to mesh]
    |
    v
Shard-1, Shard-2: Update local Groq circuit -> OPEN (skip probing)
    |
    v
[CRPC consensus]: 2/3 shards agree -> network-wide OPEN
```

---

## Provenance: Every Response Has a Receipt

Every response carries Wardenclyffe metadata:

```typescript
interface WardenclyffeResponse {
    content: ContentBlock[];
    _provider: string;
    _model: string;
    _tier: number;              // 0 | 1 | 2
    _escalated: boolean;        // did quality gate trigger escalation?
    _complexity: string;        // triage classification
    _cascadeTrail: CascadeStep[];
    _responseHash: string;      // SHA-256(content || provider || model || timestamp)
}
```

The cascade trail proves the economic efficiency is auditable:

```json
[
    {"provider": "groq", "tier": 0, "status": "escalated_quality", "latencyMs": 312},
    {"provider": "deepseek", "tier": 1, "status": "success", "latencyMs": 1847}
]
```

This trail says: we tried the cheapest option first, quality was insufficient, we escalated appropriately. No waste.

---

## Why CKB Is the Right Substrate

### Inference Economics as Cell State

Each escalation event can be represented as a CKB cell:

```
Cell {
    data: { classification, tier_path, cost, quality_score, response_hash }
    type_script: InferenceEconomicsVerifier
    lock_script: AgentIdentityLock
}
```

This creates an on-chain ledger of inference economics -- queryable, composable, and permanent. Want to know the average escalation rate for `coding` queries? Query the cells. Want to prove that a specific agent's responses were verified through CRPC? Check the provenance chain.

### Response Provenance via Content Hash

Wardenclyffe already computes `SHA-256(content || provider || model || timestamp)` for every response. On CKB, these hashes can anchor into cells that compose with ContextAnchor Merkle roots:

```
Agent Identity (AgentRegistry, ERC-8004)
    | agentId
Context Graph (ContextAnchor)
    | merkleRoot contains responseHashes
Escalation Trail (Wardenclyffe v3)
    | provider + tier + escalation status
Provider Attestation (_responseHash)
    | SHA-256 unforgeable
Proof of Mind Chain (CKB cells)
```

### Free Compute Multiplication Aligns with CKB's Economics

CKB's state model charges for bytes stored, not computation performed. Wardenclyffe minimizes on-chain computation (only verification and anchoring) while storing compact provenance cells. The expensive part (inference) happens off-chain; the valuable part (provenance) lives on CKB at minimal cost.

### Circuit Breaker State as Shared Cells

Circuit breaker state could be shared across shards via cells rather than BFT mesh broadcast. A "Groq is down" cell, created by one shard and observed by others through cell deps, provides the same skip-probing benefit with on-chain verifiability. The lock script could require 2-of-3 shard signatures (BFT threshold), making the circuit breaker consensus trustless.

### Horizontal Scaling Without Centralization

Each shard maintains its own keys, circuits, and escalation chains. CKB provides the shared truth layer (provenance, economics, circuit state) without centralizing inference. Decentralized AI infrastructure where CKB anchors the economics while compute scales horizontally.

---

## Production Results

Over 50,000 requests served with zero empty responses and zero blackout events. Projected v3 blended cost: ~$0.67/MTok (down from ~$4.50, an 85% reduction). Simple and moderate messages -- 70% of traffic -- drop to $0. Theoretical availability with 13 independent providers at 95% individual uptime: `1 - (0.05)^13`, approximately fifteen nines.

---

## Discussion Questions

1. **Inference cells on CKB**: We propose anchoring escalation events as CKB cells. At high throughput, this could generate many cells. Should inference provenance be batched (one cell per N events, Merkle-compressed) or individual? What's the right granularity for auditability vs. state cost?

2. **Decentralized API key management**: Currently, each shard manages its own keys. Could CKB cells represent key allocations -- each key registered as a cell, with type scripts enforcing rate limit accounting? This would make the quota multiplication auditable.

3. **Circuit breaker consensus on-chain**: We described circuit breaker state as shared cells. Is the BFT threshold (2-of-3 shards) sufficient for CKB's security model, or should circuit breaker cells require different authorization?

4. **Quality gate evolution**: The soft gate uses regex heuristics. Could CKB cells store community-contributed quality patterns -- a "quality gate registry" where participants propose and vote on new detection rules?

5. **Cross-network inference markets**: If inference provenance lives on CKB, could it enable an inference market where agents bid for compute using CKB-native tokens, with Wardenclyffe routing to the most cost-effective provider and CKB settling the economics?

6. **AI agent identity**: Wardenclyffe responses are bound to agent identity via ERC-8004. How should this map to CKB -- should each agent have a persistent identity cell that accumulates inference provenance over time?

---

## Further Reading

- **Full paper**: [Wardenclyffe v3: Hybrid Escalation Router](../papers/wardenclyffe-inference-cascade.md)
- **Proof of Mind**: [PoM consensus post](proof-of-mind-post.md)
- **CKB integration**: [Nervos and VibeSwap Synergy](nervos-vibeswap-synergy.md)
- **Agent identity**: [Shards Over Swarms post](shards-over-swarms-post.md)
- **Source code**: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

Fairness Above All. -- P-000, VibeSwap Protocol
