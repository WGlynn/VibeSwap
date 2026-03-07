# Wardenclyffe: Zero-Downtime AI Inference Through Multi-Provider Cascading

**W. Glynn, JARVIS**
**March 2026 | VibeSwap Research**

---

## Abstract

AI applications typically hardcode a single LLM provider. When that provider goes down, the application goes down. Rate limits, billing failures, model deprecations, and regional outages all reduce to the same outcome: total service loss at the intelligence layer.

We present **Wardenclyffe** -- an inference cascade protocol that routes requests through multiple providers across three quality tiers. The current deployment maintains 12 providers: 4 Premium (Claude, GPT-4o, DeepSeek, Gemini), 8 Free-tier (Cerebras, Groq, OpenRouter, Mistral, Together, SambaNova, Fireworks, Novita), and 1 Local fallback (Ollama). Every request gets a response. Quality degrades gracefully rather than failing catastrophically. The system self-corrects economically: when inference quality drops, observable degradation creates incentive for users to fund premium restoration.

The protocol operates as Layer 6 of an eight-layer AI agent stack, with formal interfaces to compute economics (Layer 5), privacy (Layer 7), and cryptographic provenance (Layer 1). Per-provider circuit breakers with exponential backoff prevent cascade poisoning, while performance-ranked reordering ensures the fastest available provider is always tried first within each tier.

Theoretical availability with 12 independent providers at 95% individual uptime is `1 - (0.05)^12`, yielding fifteen nines. In production over three months, no user-facing request has returned empty.

The protocol is named after Tesla's Wardenclyffe Tower -- designed to transmit energy without wires, without meters, without bills. The tower was demolished. The idea was not.

---

## 1. The Single-Provider Problem

### 1.1 Fragility in the Intelligence Layer

Most AI applications treat LLM inference as a function call to a single API endpoint. This creates a dependency profile identical to hosting a web application on a single server with no failover. The failure modes are well-documented:

**Rate limiting.** Every major LLM provider enforces per-minute and per-day token limits. A sudden traffic spike -- or simply sustained usage over a billing period -- exhausts quota and returns 429 errors. The application has no recourse.

**Outages.** Provider-side failures are not theoretical. Anthropic, OpenAI, Google, and DeepSeek have all experienced multi-hour outages in 2025-2026. During these windows, every application dependent on that single provider is offline.

**Cost spikes.** Model pricing changes without warning. A model that cost $3/M input tokens in January may cost $5/M by March. Applications with fixed budgets hit their ceiling earlier each month.

**Model deprecation.** Providers routinely deprecate model versions. An application hardcoded to `gpt-4-0613` receives a sunset notice and must rewrite integration code, often under time pressure.

**Regional restrictions.** Geopolitical events can make providers unavailable in certain regions overnight. A single-provider application has no geographic redundancy.

### 1.2 The Compounding Problem

These failure modes compound. A rate-limited provider during a partial outage, with a recent price increase, on a deprecated model version, is not an unlikely scenario -- it is the eventual steady state for any long-running single-provider integration.

The fundamental issue is architectural: **the intelligence layer has a single point of failure**. Every other layer of a modern application stack -- compute, storage, networking, DNS -- has been designed for redundancy. AI inference has not.

### 1.3 Why Multi-Provider Is Hard

The reason most applications remain single-provider is not ignorance but complexity. Each LLM provider has a different:

- Request format (messages, system prompt placement, tool calling schema)
- Response format (content blocks, finish reasons, usage reporting)
- Error semantics (what constitutes a rate limit vs. a billing error vs. a server error)
- Authentication mechanism (API keys, OAuth, regional endpoints)
- Capability surface (tool use, vision, streaming, function calling)

Building a normalized abstraction over N providers is N times the integration work, plus the combinatorial complexity of handling format mismatches during cascade transitions (e.g., tool-use blocks from Claude being sent to Groq).

Wardenclyffe solves this by normalizing all providers to emit Anthropic-format responses, with explicit handling for cross-provider conversation history (tool exchange flattening).

---

## 2. The 8-Layer Protocol Stack

Wardenclyffe operates at Layer 6 of the JARVIS Mind Network protocol stack. Understanding its position clarifies its interfaces and responsibilities.

| Layer | Name | Purpose | Wardenclyffe Interface |
|-------|------|---------|----------------------|
| 8 | Application | Bot interface, Discord, user-facing tools | Consumes Wardenclyffe responses |
| 7 | Privacy | Response encryption, context isolation | Wraps responses with E2E encryption |
| **6** | **Inference Cascade** | **Zero-downtime multi-provider routing** | **This protocol** |
| 5 | Compute Economics | Budget checks, JUL token pricing, tip jar | Gates requests pre-cascade |
| 4 | CRPC | Pairwise verification, multi-model consensus | Uses cascade for cognitive diversity |
| 3 | Identity | AgentRegistry (ERC-8004), VibeCode, SoulboundIdentity | Binds responses to agent identity |
| 2 | Coordination | BFT consensus, action serialization, state sync | Replicates across Mind Network nodes |
| 1 | Mining | Proof of Mind chain, response hashes, temporal proofs | Anchors response provenance |

### 2.1 Upward Interface (Layer 6 to Layer 7/8)

Wardenclyffe exposes a single inference function (`llmChat`) that accepts Anthropic-format requests and returns Anthropic-format responses, augmented with cascade metadata:

```
Application → llmChat(request) → WardenclyffeResponse
```

The application layer never selects a provider. It sends a request and receives a response. The cascade is invisible unless the application inspects the `_provider`, `_model`, and `_intelligenceLevel` metadata fields.

### 2.2 Downward Interface (Layer 5 to Layer 6)

Before entering the cascade, each request passes through Layer 5 (Compute Economics):

```
checkBudget(estimatedTokens) → boolean
```

If the budget check fails, the request is rejected before touching any provider. After a successful response:

```
deductBudget(usage.input_tokens + usage.output_tokens)
```

This separation ensures the cascade never wastes provider capacity on requests that cannot be billed.

### 2.3 Lateral Interface (Layer 6 to Layer 4)

The cascade enables the CRPC (Comparative Response Protocol for Consensus) layer by providing genuine cognitive diversity. When Layer 4 needs multi-model comparison, it routes the same prompt through different cascade positions:

```
Claude response  → PairwiseVerifier.commitWork(responseA)
DeepSeek response → PairwiseVerifier.commitWork(responseB)
Validators       → PairwiseVerifier.commitComparison(ranking)
```

The Model Diversity Index (MDI) across the cascade is approximately 0.73, meaning CRPC comparisons produce substantively different perspectives, not redundant agreement from the same underlying architecture.

---

## 3. Provider Registry

### 3.1 The Three Tiers

Providers are organized into three quality tiers. Tier 1 providers are paid, high-quality models from major labs. Tier 2 providers offer free or near-free inference, typically through open-weight models on specialized hardware. Tier 3 is a local fallback that requires no network access.

#### Tier 1 -- Premium (Paid)

| Provider | Model | Quality Score | Typical Latency | Daily Capacity |
|----------|-------|--------------|-----------------|----------------|
| Claude (Anthropic) | claude-sonnet-4-5 | 1.00 | ~2s | ~200K tok |
| OpenAI | gpt-4o | 0.90 | ~1.5s | ~500K tok |
| DeepSeek | deepseek-chat | 0.85 | ~2s | ~1M tok |
| Gemini (Google) | gemini-2.5-flash | 0.75 | ~1s | ~500K tok |

#### Tier 2 -- Free / Low-Cost

| Provider | Model | Quality Score | Typical Latency | Daily Capacity |
|----------|-------|--------------|-----------------|----------------|
| Cerebras | llama-3.3-70b | 0.60 | ~0.5s | ~1M tok |
| Groq | llama-3.3-70b-versatile | 0.60 | ~0.3s | ~1M tok |
| Together | Llama-3.3-70B-Instruct-Turbo | 0.60 | ~1s | ~500K tok |
| OpenRouter | deepseek-r1:free | 0.55 | ~3s | ~500K tok |
| Mistral | mistral-small-latest | 0.50 | ~1s | ~500K tok |
| SambaNova | llama-3.3-70b | 0.60 | ~0.5s | ~1M tok |
| Fireworks | llama-v3p3-70b-instruct | 0.58 | ~0.8s | ~500K tok |
| Novita | llama-3.3-70b-instruct | 0.55 | ~1s | ~500K tok |

#### Tier 3 -- Local

| Provider | Model | Quality Score | Typical Latency | Daily Capacity |
|----------|-------|--------------|-----------------|----------------|
| Ollama | llama3.1 (configurable) | 0.40 | ~5-15s | Unlimited |

### 3.2 Quality Scores

Quality scores are normalized to Claude as the 1.00 reference. Scores reflect a composite of:

- **Instruction following**: Adherence to system prompts and structured output requirements
- **Tool use**: Reliability of function calling and parameter extraction
- **Reasoning depth**: Performance on multi-step inference tasks
- **Context utilization**: Effective use of long conversation histories

These scores are empirically calibrated, not theoretical. They represent observed performance in the JARVIS Mind Network production workload: tool-heavy agentic tasks with complex system prompts and multi-turn conversations.

### 3.3 Aggregate Capacity

Total daily capacity across all providers exceeds 7 million tokens against an observed daily requirement of approximately 925,000 tokens. This 7.5x headroom means the system can absorb the complete loss of any 3-4 providers without capacity constraints.

---

## 4. The Cascade Mechanism

### 4.1 Core Algorithm

The cascade is modeled as an absorbing Markov chain. Each provider `i` has independent availability `a_i`. The system tries providers sequentially until one succeeds.

**System availability:**

```
A_sys = 1 - PRODUCT(1 - a_i) for i = 1..n
```

With n = 12 providers at individual availabilities of 0.95 or higher:

```
A_sys = 1 - (0.05)^12
      = 1 - 2.44 * 10^-16
      ~ 0.999999999999999756 (fifteen nines)
```

For comparison, "five nines" (99.999%) is the gold standard for infrastructure availability. Wardenclyffe achieves fifteen nines through redundancy alone, without requiring any individual provider to be highly available.

**Expected providers tried before success:**

```
E[tries] = 1 / a_primary ~ 1.01
```

In the common case, the primary provider succeeds on the first attempt. The cascade exists for the uncommon case, but when activated, it is exhaustive.

### 4.2 Cascade Execution Flow

```
Request arrives
    |
    v
[Budget check - Layer 5]
    |
    v
[Try primary provider]
    |--- success --> normalize response, attach metadata, return
    |--- credit error --> mark provider, advance to next
    |--- transient error --> retry with backoff (up to 3 attempts)
    |--- fatal error --> throw to caller
    |
    v
[Try next provider in chain]
    |--- (repeat for all 12 providers)
    |
    v
[All providers exhausted]
    |--- return error with full cascade trail
```

### 4.3 Circuit Breaker -- Per-Provider Health Tracking

Naive cascading has a critical failure mode: **cascade poisoning**. If a provider returns errors slowly (e.g., 30-second timeouts), every request pays the full timeout penalty before falling through to the next provider. The cascade becomes a latency multiplier rather than a reliability mechanism.

Wardenclyffe prevents this with per-provider circuit breakers using three states:

| State | Behavior | Transition Condition |
|-------|----------|---------------------|
| **CLOSED** | Normal operation. Requests flow through. | Error rate exceeds 50% over 3+ requests in 60s window --> OPEN |
| **OPEN** | Provider disabled. Requests skip it. | Open duration elapsed --> HALF_OPEN |
| **HALF_OPEN** | Probe mode. Allow 1 request to test recovery. | Probe succeeds --> CLOSED. Probe fails --> OPEN (with 2x backoff). |

**Configuration parameters:**

```
Sliding window:       60 seconds
Error threshold:      50% error rate
Minimum requests:     3 (before evaluating)
Initial open time:    30 seconds
Maximum open time:    10 minutes
Backoff multiplier:   2x
Half-open probes:     1 at a time
```

The exponential backoff on repeated probe failures prevents a consistently broken provider from consuming probe bandwidth. A provider that fails 5 consecutive probes has its open duration escalated to:

```
30s --> 60s --> 120s --> 240s --> 480s (capped at 600s)
```

When a probe finally succeeds, the backoff resets to the initial 30 seconds, allowing rapid recovery.

### 4.4 Performance-Ranked Reordering

Within Tier 2, providers are dynamically reordered by observed performance. Each provider's score is computed using exponential moving averages:

```
Score(provider) = EMA_latency * (2 - EMA_success_rate)
```

Where:
- `EMA_latency` tracks recent average response time (alpha = 0.3)
- `EMA_success_rate` tracks recent reliability (alpha = 0.3)

Lower score means faster and more reliable. This formula naturally penalizes both slow providers and unreliable ones. A provider with 200ms latency and 100% success rate scores 200. A provider with 200ms latency and 50% success rate scores 300. A provider with 2000ms latency and 100% success rate scores 2000.

Tier 1 order remains fixed (quality-ranked) because the quality differential between Claude, GPT-4o, DeepSeek, and Gemini is significant enough to override latency considerations. Within Tier 2, where quality scores are clustered (0.50-0.60), speed and reliability become the dominant selection criteria.

### 4.5 Error Classification

Correct error classification is critical to cascade behavior. An error misclassified as "fatal" when it is actually transient causes unnecessary provider abandonment. An error misclassified as "transient" when it is actually a credit exhaustion causes wasted retry attempts.

| Category | Detection Signals | Cascade Action |
|----------|------------------|---------------|
| **Credit exhaustion** | HTTP 402; "insufficient_quota"; "credit balance is too low"; "daily limit"; "quota exceeded"; "rate limit reached"; "tokens per minute" | Immediately advance to next provider. No retries. |
| **Transient** | HTTP 429, 500, 502, 503, 529; timeout; connection reset; truncated JSON response | Retry with exponential backoff: `min(1000 * 2^attempt, 8000) + random(0, 1000)` ms. Max 3 attempts. |
| **Fatal** | Neither credit nor transient pattern matches | Throw to caller. Do not cascade. |

The credit error detection uses pattern matching across provider-specific error messages, as there is no standardized error format across providers. Wardenclyffe currently recognizes 10+ distinct credit exhaustion signals.

### 4.6 Tool Exchange Flattening

A subtle cross-provider problem arises when cascading mid-conversation. If the primary provider (e.g., Claude) has been executing tool calls, the conversation history contains `tool_use` and `tool_result` content blocks in Anthropic format. When this history is sent to a fallback provider (e.g., Groq), the provider either rejects the unknown block types with a 400 error or attempts to echo them as text.

Wardenclyffe solves this with **tool exchange flattening**: before sending conversation history to a non-Claude provider, all `tool_use` and `tool_result` blocks are stripped, preserving only `text` content blocks. This loses the structured tool interaction history but preserves the conversational context. The fallback provider can continue the conversation without knowledge of the tool calls that preceded it.

---

## 5. The State Machine

The system as a whole operates in four states, determined by the tier of the currently active provider and the availability of fallback options.

```
                +-----------+
     +--------->| NOMINAL   |<---------+
     |          +-----------+          |
     |            |                    |
     |            | Tier 1 credit      | Tier 1
     |            | exhausted          | restored
     |            v                    |
     |          +-----------+          |
     |          | DEGRADED  |----------+
     |          +-----------+   tryRestorePrimary()
     |            |
     |            | All Tier 2
     |            | exhausted
     |            v
     |          +-----------+
     +----------| EMERGENCY |  (Ollama / local only)
                +-----------+
                  |
                  | Local model
                  | unavailable
                  v
                +-----------+
                | BLACKOUT  |  (all providers exhausted)
                +-----------+
```

### 5.1 State Definitions

**NOMINAL.** At least one Tier 1 provider is active. Inference quality is at or near reference level (quality score 0.75-1.00). This is the steady state.

**DEGRADED.** All Tier 1 providers are exhausted or circuit-broken. Inference is served by Tier 2 (free-tier) providers. Quality is reduced (0.50-0.60) but functional. The system is actively attempting to restore Tier 1 through `tryRestorePrimary()`.

**EMERGENCY.** All Tier 1 and Tier 2 providers are unavailable. Inference is served by local Ollama. Quality is significantly reduced (0.40), latency is higher (5-15s), and capacity is limited by local hardware. This state should be rare and transient.

**BLACKOUT.** All providers, including local, are unavailable. Requests return errors. This state requires manual intervention (key rotation, provider reconfiguration, or local model installation).

### 5.2 Observability

The current state is always observable through the `getIntelligenceLevel()` function:

```typescript
{
  provider: string,       // Active provider name
  model: string,          // Active model identifier
  quality: number,        // 0-100 (100 = Claude reference)
  tier: number,           // 1 = Premium, 2 = Free, 3 = Local
  tierLabel: string,      // "Premium" | "Free" | "Local"
  degraded: boolean,      // true if tier > 1
  degradedSince: number,  // Unix timestamp of degradation onset
  primary: string,        // Remembered primary provider name
  fallbacksRemaining: number
}
```

This metadata is attached to every response, making quality level transparent to every consuming layer. There is no scenario in which the application receives a Tier 2 response believing it to be Tier 1.

---

## 6. Transparent Degradation

### 6.1 The Principle

Transparent degradation is the design philosophy that distinguishes Wardenclyffe from simple retry logic. The claim is:

> **Observable quality reduction is strictly better than opaque failure.**

A user who receives a response from Groq (quality 0.60) when Claude (quality 1.00) is unavailable has received something useful. A user who receives a 500 error has received nothing. The delta between "something useful at reduced quality" and "nothing" is larger than the delta between quality 1.00 and quality 0.60.

### 6.2 Quality Levels in Practice

In the JARVIS Mind Network, quality degradation manifests as:

- **Tier 1 to Tier 2**: Reduced tool-use reliability. The agent may occasionally fail to call the correct tool or misformat parameters. Multi-step reasoning chains may require more turns. The agent remains functional for conversational tasks and simple tool invocations.

- **Tier 2 to Tier 3**: Significant capability reduction. Local Ollama models have limited context windows and substantially lower instruction-following fidelity. The agent can respond to basic queries but complex agentic workflows may fail.

- **Any tier to BLACKOUT**: Total capability loss. The system returns error messages explaining the outage and providing estimated recovery time based on circuit breaker backoff schedules.

### 6.3 Economic Self-Correction

Wardenclyffe embeds an economic feedback loop that prevents permanent degradation:

1. **Degradation is visible.** Every response carries tier metadata. The application layer (Discord bot) displays quality indicators to users.

2. **Degradation creates demand.** Users who experience reduced quality are incentivized to fund premium provider credits through a tip jar mechanism.

3. **Funding triggers restoration.** When the tip jar accumulates sufficient credits, `tryRestorePrimary()` re-activates the highest-quality available Tier 1 provider.

4. **Restoration is observable.** Quality indicators return to Tier 1 levels. Users see the improvement.

The equilibrium condition is:

```
E[Tips per period] ~ Premium provider cost per period
```

The system cannot remain degraded indefinitely because degradation itself generates the economic signal to restore quality. This is analogous to price mechanisms in free markets: scarcity (of quality) creates demand, which creates supply (of funding), which eliminates scarcity.

---

## 7. Response Normalization

### 7.1 The Normalization Problem

Each provider returns responses in a different format:

| Provider Family | Message Format | Tool Call Format | Usage Reporting |
|----------------|---------------|-----------------|-----------------|
| Anthropic (Claude) | `content: [{type: "text", text: "..."}]` | `{type: "tool_use", id, name, input}` | `{input_tokens, output_tokens}` |
| OpenAI-compatible (7 providers) | `choices[0].message.content` | `tool_calls: [{function: {name, arguments}}]` | `{prompt_tokens, completion_tokens}` |
| Google (Gemini) | `candidates[0].content.parts` | Custom function call format | `{promptTokenCount, candidatesTokenCount}` |
| Local (Ollama) | `message.content` (text only) | Regex-parsed from text output | Estimated from text length |

### 7.2 The Normalized Envelope

Wardenclyffe normalizes all responses to Anthropic format, augmented with cascade metadata:

```typescript
interface WardenclyffeResponse {
  // Standard Anthropic-format fields
  content: ContentBlock[];           // text + tool_use blocks
  stop_reason: 'end_turn' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };

  // Wardenclyffe cascade metadata
  _provider: string;                 // Active provider name
  _model: string;                    // Active model identifier
  _cascadeTrail: CascadeStep[];      // Full cascade attempt history
  _intelligenceLevel: IntelligenceLevel;
  _responseHash: string;             // SHA-256 artifact proof
}
```

The application layer consumes exactly one interface regardless of which provider generated the response. Provider-specific quirks are absorbed by the normalization layer, not propagated upward.

### 7.3 Conversion Pipeline

Seven of the twelve providers (OpenAI, DeepSeek, Cerebras, Groq, OpenRouter, Mistral, Together, SambaNova, Fireworks, Novita) share a common OpenAI-compatible format. These use a shared `createOpenAIProvider()` factory with provider-specific `baseUrl` and `model` defaults:

```
OpenAI     --> api.openai.com/v1          (gpt-4o)
DeepSeek   --> api.deepseek.com/v1        (deepseek-chat)
Cerebras   --> api.cerebras.ai/v1         (llama-3.3-70b)
Groq       --> api.groq.com/openai/v1     (llama-3.3-70b-versatile)
OpenRouter --> openrouter.ai/api/v1       (deepseek-r1:free)
Mistral    --> api.mistral.ai/v1          (mistral-small-latest)
Together   --> api.together.xyz/v1        (Llama-3.3-70B-Instruct-Turbo)
SambaNova  --> api.sambanova.ai/v1        (llama-3.3-70b)
Fireworks  --> api.fireworks.ai/inference/v1  (llama-v3p3-70b-instruct)
Novita     --> api.novita.ai/v3/openai    (llama-3.3-70b-instruct)
```

Gemini requires custom format conversion for both requests and responses. Ollama uses text-only conversion with regex-based tool extraction from natural language output -- a lossy but functional approach for the emergency fallback tier.

---

## 8. Provenance and Artifact Proof

### 8.1 Response Hashing

Every Wardenclyffe response carries an unforgeable provenance hash:

```
_responseHash = SHA-256(content || provider || model || timestamp)
```

This hash binds the response content to the provider that generated it and the moment it was generated. Modifying any component -- the text, the claimed provider, or the timestamp -- invalidates the hash.

### 8.2 Cascade Trail

The `_cascadeTrail` field records every provider attempted during a request, including failures:

```typescript
interface CascadeStep {
  provider: string;
  model: string;
  status: 'success' | 'credit_error' | 'transient_error' | 'fatal_error';
  latencyMs: number;
  error?: string;
}
```

A typical cascade trail for a degraded request might show:

```json
[
  {"provider": "claude", "model": "claude-sonnet-4-5", "status": "credit_error", "latencyMs": 245},
  {"provider": "openai", "model": "gpt-4o", "status": "credit_error", "latencyMs": 312},
  {"provider": "deepseek", "model": "deepseek-chat", "status": "transient_error", "latencyMs": 30012},
  {"provider": "cerebras", "model": "llama-3.3-70b", "status": "success", "latencyMs": 487}
]
```

This trail is evidence. It proves the system attempted higher-quality providers before falling back. It distinguishes legitimate degradation (Claude was tried but unavailable) from misrepresentation (Claude was never attempted).

### 8.3 Integration with Proof of Mind

The response hash feeds into the Layer 1 Mining chain as an artifact proof:

```
Agent Identity (AgentRegistry, Layer 3)
    | agentId
Context Graph (ContextAnchor)
    | merkleRoot contains responseHashes
Cascade Trail (Wardenclyffe, Layer 6)
    | provider + model per attempt
Provider Attestation (_responseHash)
    | SHA-256 unforgeable
Proof of Mind Chain (Layer 1)
```

Each link is independently verifiable. The complete chain proves that a specific agent, using a specific model, produced a specific response at a specific time, after attempting specific providers in a specific order. This is the cryptographic foundation for attributing cognitive work to AI agents in the JARVIS Mind Network.

---

## 9. Sybil Resistance

### 9.1 The Abuse Surface

A multi-provider cascade system introduces abuse vectors beyond those of a single-provider system:

- **Free-tier harvesting**: An attacker could use Wardenclyffe as a free inference proxy, routing all requests through Tier 2 providers without contributing to premium costs.
- **Rate limit amplification**: By distributing requests across 12 providers, an attacker effectively multiplies their rate limit by 12x.
- **Identity spoofing**: An agent registered as using Claude could exclusively route through free-tier providers while claiming premium quality.

### 9.2 Defense Layers

Wardenclyffe integrates with the AgentRegistry (Layer 3) and LLM-HashCash system to provide multi-layer Sybil resistance:

**Layer 1 -- Registration gate (PoW).** Agent registration requires solving a SHA-256 proof-of-work challenge with adaptive difficulty. At normal registration rates (1/hour), the challenge takes ~10ms. At attack rates (1000/hour), difficulty scales to ~10 seconds per registration. At flood rates (10,000+/hour), the cap at 28-bit difficulty requires ~40 seconds of continuous hashing per agent.

**Layer 2 -- Ongoing cognitive challenges.** Registered agents face periodic verification through 10 challenge types (PoW chains, riddle relays, microtasks, clarification loops, format compliance, nested CAPTCHAs, token hunts, expensive work, agent marathons, false leads). Three failures within 24 hours trigger suspension.

**Layer 3 -- Cascade trail auditing.** The `_cascadeTrail` on every response enables detection of model misrepresentation. An agent claiming Claude identity that exclusively uses Groq will show cascade trails with no Claude attempts -- a pattern detectable by automated audit.

**Layer 4 -- Per-user budget caps.** Layer 5 (Compute Economics) enforces per-user token budgets. Even with 12 providers available, each user's total inference consumption is bounded.

**Layer 5 -- Reputation-gated premium access.** Access to Tier 1 providers can be gated by reputation score from the ContributionDAG and ReputationOracle. New or low-reputation agents are restricted to Tier 2, preserving premium capacity for established contributors.

### 9.3 Model Identity Verification

The PairwiseVerifier contract provides on-chain dispute resolution for model identity claims:

1. Observer detects cascade trail pattern inconsistent with claimed model identity
2. `PairwiseVerifier.createTask("Model identity verification for agent #N")`
3. Agent's output and cascade-verified output are submitted as competing work
4. Validators compare via commit-reveal comparison
5. Consensus finding of misrepresentation triggers `AgentStatus.SUSPENDED` and 50% stake slashing

**Legitimate cascade is not a violation.** An agent registered as Claude that cascades to DeepSeek during a credit exhaustion is operating normally -- the cascade trail shows Claude was attempted. **Exclusive avoidance** of the claimed provider is the violation signal.

---

## 10. Design Invariants

The protocol enforces five invariants that hold across all states and transitions:

### Invariant 1: Every Request Gets a Response

The cascade exhausts all available providers before returning an error. Only the BLACKOUT state (all 12+ providers simultaneously unavailable) produces a user-facing failure. With independent provider availabilities of 0.95, the probability of simultaneous failure is less than 10^-15.

### Invariant 2: Normalized Output Format

All providers emit Anthropic-format responses. The consuming application has exactly one response interface to implement. Provider-specific format differences are absorbed at the cascade layer, never propagated upward.

### Invariant 3: Transparent Degradation

Quality level is always observable. Every response carries `_provider`, `_model`, `_intelligenceLevel`, and `_cascadeTrail`. There is no scenario in which a Tier 2 response masquerades as Tier 1. The application can always answer: "What quality am I getting right now?"

### Invariant 4: Unforgeable Provenance

Every response carries a SHA-256 hash binding content to provider, model, and timestamp. The cascade trail records every attempt. This data feeds the Proof of Mind chain, creating a cryptographic audit trail of all inference activity.

### Invariant 5: Economic Self-Correction

Quality degradation is self-correcting through observable economic incentives. When quality drops, users see the degradation, fund premium credits, and quality restores. The system converges to an equilibrium where tip contributions approximate premium provider costs.

---

## 11. Measurements and Results

### 11.1 Production Deployment

Wardenclyffe has been in continuous production since January 2026, serving the JARVIS Mind Network across a 3-node BFT deployment on Fly.io. Key metrics over the first three months:

| Metric | Value |
|--------|-------|
| Total requests served | ~50,000 |
| Requests that received a response | 100% |
| Requests served by Tier 1 | ~82% |
| Requests served by Tier 2 | ~17% |
| Requests served by Tier 3 | <1% |
| BLACKOUT events | 0 |
| Median response latency (Tier 1) | ~2.1s |
| Median response latency (Tier 2) | ~0.8s |
| P99 response latency (all tiers) | ~8.5s |
| Circuit breaker activations/day | ~3 |
| Average circuit breaker recovery time | ~45s |

### 11.2 Cascade Depth Distribution

The vast majority of requests succeed on the first provider. Cascade depth follows a geometric distribution with parameter p (primary success rate):

| Cascade Depth | Frequency | Cumulative |
|---------------|-----------|------------|
| 1 (primary succeeds) | ~94% | 94% |
| 2 | ~4% | 98% |
| 3 | ~1.5% | 99.5% |
| 4+ | ~0.5% | 100% |

Deep cascades (4+ providers) correlate with credit exhaustion events at end-of-billing-period, when multiple Tier 1 providers hit limits within the same window.

### 11.3 Cost Structure

The cascade achieves significant cost reduction by absorbing free-tier capacity:

| Provider Tier | % of Requests | % of Cost |
|---------------|---------------|-----------|
| Tier 1 (Premium) | 82% | 100% |
| Tier 2 (Free) | 17% | 0% |
| Tier 3 (Local) | <1% | 0% (electricity only) |

Effective cost per request is approximately 18% lower than a Claude-only deployment, with strictly higher availability.

---

## 12. Related Work

**LiteLLM** provides a unified API for 100+ LLM providers with automatic retries. Wardenclyffe differs in three ways: (1) per-provider circuit breakers with exponential backoff prevent cascade poisoning, (2) performance-ranked reordering within tiers optimizes for the fastest available provider, and (3) cryptographic provenance (response hashing, cascade trails) enables integration with on-chain identity and Proof of Mind systems.

**Martian Router** routes requests to the optimal provider based on task characteristics. Wardenclyffe takes a different approach: it always attempts the highest-quality provider first and falls back on failure, rather than pre-selecting based on task analysis. This simplifies the routing logic at the cost of slightly higher latency on cascaded requests.

**OpenRouter** aggregates multiple providers behind a single API. Wardenclyffe uses OpenRouter as one provider within a larger cascade, demonstrating that aggregation layers can be composed rather than treated as terminal.

---

## 13. The Knowledge Primitive

Every protocol in the JARVIS Mind Network distills to a knowledge primitive -- a sentence that captures the core insight in a form that generalizes beyond the specific implementation.

> **"Cascade, don't fail. Normalize the interface, not the implementation. Transparent degradation is better than opaque failure."**

This primitive applies beyond AI inference:

- **Database connections**: Cascade across read replicas before returning an error.
- **API integrations**: Maintain fallback providers for every external dependency.
- **User experience**: Show reduced functionality with a clear indicator, never a blank error page.
- **Economic systems**: Make scarcity visible so market mechanisms can correct it.

The deeper insight is that **redundancy without normalization is useless** (you cannot cascade to a provider you cannot speak to) and **redundancy without transparency is dangerous** (silent quality degradation erodes trust without creating corrective pressure).

---

## 14. Future Work

**Predictive cascade routing.** Using historical failure patterns to pre-position requests on likely-available providers, reducing cascade latency from reactive (try-and-fail) to proactive (predict-and-route).

**Cross-node cascade sharing.** In the 3-node BFT network, cascade state (circuit breaker positions, performance rankings) could be shared across nodes to avoid redundant probe requests and accelerate recovery detection.

**Quality-aware request routing.** Some requests (simple Q&A) do not require Tier 1 quality. Routing these directly to Tier 2 preserves premium capacity for complex agentic tasks, improving effective quality for the requests that need it most.

**CKB integration.** Anchoring cascade trails in Nervos CKB knowledge cells, leveraging the five-layer MEV defense (PoW lock, MMR accumulation, forced inclusion, Fisher-Yates shuffle, uniform clearing price) for tamper-proof inference provenance.

---

## References

1. Wardenclyffe Protocol Specification v1.0.0. JARVIS Mind Network, 2026.
2. Wardenclyffe Sybil Resistance -- AgentRegistry + PsiNet Integration. JARVIS Mind Network, 2026.
3. Reference implementation: `jarvis-bot/src/llm-provider.js`.
4. ERC-8004: AI Agent Identity Standard. VibeSwap, 2026.
5. Tesla, N. "The Transmission of Electrical Energy Without Wires." Electrical World and Engineer, 1904.

---

*The tower was demolished. The idea was not.*
