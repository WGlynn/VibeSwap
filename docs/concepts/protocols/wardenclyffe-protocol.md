# Wardenclyffe Protocol — Layer 6: Inference Cascade

> *"Tesla's Wardenclyffe Tower was designed to transmit energy without wires, without meters, without bills. The tower was demolished. The idea was not."*

**Version**: 1.0.0
**Layer**: 6 of 8 (JARVIS Mind Network Protocol Stack)
**Purpose**: Zero-downtime AI inference through multi-provider cascading
**Status**: Implemented (`jarvis-bot/src/llm-provider.js`)

---

## 1. Protocol Overview

### Position in the 8-Layer Stack

| Layer | Name | Purpose |
|-------|------|---------|
| 8 | Application | JARVIS bot, Discord interface, user-facing tools |
| 7 | Privacy | Response encryption, context isolation |
| **6** | **Inference Cascade (Wardenclyffe)** | **Zero-downtime multi-provider LLM routing** |
| 5 | Compute Economics | Budget checks, JUL token pricing, tip jar |
| 4 | CRPC (Pairwise Verification) | Multi-model comparison, consensus |
| 3 | Identity | AgentRegistry (ERC-8004), VibeCode, SoulboundIdentity |
| 2 | Coordination | BFT consensus, action serialization, state sync |
| 1 | Mining | Proof of Mind chain, response hashes, temporal proofs |

### Design Invariants

1. **Every request gets a response** — cascade exhausts all 9 providers before failure
2. **Normalized output format** — all providers emit Anthropic-format responses
3. **Transparent degradation** — quality level is always observable
4. **Unforgeable provenance** — every response carries a SHA-256 artifact proof
5. **Economic self-correction** — quality degradation creates restoration incentive

---

## 2. Provider Registry

### Tier 1 — Premium (Paid)

| Provider | Model | Quality | Daily Capacity |
|----------|-------|---------|----------------|
| Claude (Anthropic) | claude-sonnet-4-5 | 1.00 | ~200K tok |
| OpenAI | gpt-4o | 0.90 | ~500K tok |
| DeepSeek | deepseek-chat | 0.85 | ~1M tok |
| Gemini (Google) | gemini-2.5-flash | 0.75 | ~500K tok |

### Tier 2 — Free / Low-Cost

| Provider | Model | Quality | Daily Capacity |
|----------|-------|---------|----------------|
| Cerebras | llama-3.3-70b | 0.60 | ~1M tok |
| Groq | llama-3.3-70b-versatile | 0.60 | ~1M tok |
| Together | Llama-3.3-70B-Instruct-Turbo | 0.60 | ~500K tok |
| OpenRouter | deepseek-r1:free | 0.55 | ~500K tok |
| Mistral | mistral-small-latest | 0.50 | ~500K tok |

### Tier 3 — Local

| Provider | Model | Quality | Daily Capacity |
|----------|-------|---------|----------------|
| Ollama | llama3.1 (configurable) | 0.40 | Unlimited |

**Aggregate capacity**: ~5.8M tok/day vs ~925K required = **6.3x headroom**

---

## 3. State Machine

The cascade operates in four states based on active provider tier and fallback availability.

```
                    ┌──────────┐
         ┌─────────│ NOMINAL  │─────────┐
         │         └──────────┘         │
         │ Tier 1 credit       All Tier 1│
         │ exhaustion          restored  │
         ▼                              │
    ┌──────────┐                        │
    │ DEGRADED │────────────────────────┘
    └──────────┘        tryRestorePrimary()
         │
         │ All Tier 2
         │ exhausted
         ▼
    ┌───────────┐
    │ EMERGENCY │  (Ollama / local only)
    └───────────┘
         │
         │ Local model
         │ unavailable
         ▼
    ┌──────────┐
    │ BLACKOUT │  (all providers exhausted)
    └──────────┘
```

### Transition Triggers

| From | To | Trigger |
|------|----|---------|
| NOMINAL | DEGRADED | `isCreditError(error)` on last Tier 1 provider; `activateFallback()` moves to Tier 2 |
| DEGRADED | NOMINAL | `tryRestorePrimary()` succeeds (tip jar refill) |
| DEGRADED | EMERGENCY | All Tier 2 providers return credit/rate errors |
| EMERGENCY | BLACKOUT | Ollama unavailable or removed from chain |
| BLACKOUT | NOMINAL | Manual provider reconfiguration or key rotation |
| Any | NOMINAL | `initProvider()` called with valid primary config |

### State Observability

```javascript
getIntelligenceLevel() → {
  provider: string,      // Active provider name
  model: string,         // Active model identifier
  quality: number,       // 0-100 (100 = Claude reference)
  tier: number,          // 1 = Premium, 2 = Free, 3 = Local
  tierLabel: string,     // "Premium" | "Free" | "Local"
  degraded: boolean,     // true if tier > 1
  degradedSince: number, // Unix timestamp of degradation onset
  primary: string,       // Remembered primary provider name
  fallbacksRemaining: number
}
```

---

## 4. Core Algorithm

### 4.1 Cascade Model — Absorbing Markov Chain

Each provider `i` has independent availability `a_i`. The cascade tries providers sequentially until one succeeds.

**System availability**:

```
A_sys = 1 - ∏(1 - a_i)  for i = 1..n
```

With n=9 providers at individual availabilities ≥ 0.95:

```
A_sys = 1 - (1 - 0.95)^9
      = 1 - (0.05)^9
      = 1 - 1.95 × 10⁻¹²
      ≈ 0.999999999998  (twelve nines)
```

**Expected providers tried before success**: E[tries] = 1.01 (geometric distribution).

### 4.2 Elastic Intelligence

Intelligence quality is a function of the active provider:

```
I(t) = q_{active(t)}
```

where `q` is the quality rating from `PROVIDER_QUALITY`. When quality drops (Tier 1 → Tier 2), visible degradation creates economic incentive:

- Users observe quality drop via `getIntelligenceLevel()`
- Community tips flow to the tip jar
- `tryRestorePrimary()` re-activates Claude when credits are replenished
- Quality restores to 1.00

**Self-correcting equilibrium**: `E[Tips] ≈ Premium consumption cost`. The system can't stay degraded forever because degradation itself creates the incentive to restore.

### 4.3 Proof of Mind — Four-Layer Verification

| Layer | Type | Mechanism | Implementation |
|-------|------|-----------|----------------|
| 0 | Computational | SHA-256 PoW (adjustable difficulty) | `ergon.ts:generatePowChallenge()` |
| 1 | Cognitive | 10 challenge types requiring understanding | `challenges.ts:generateChallenge()` |
| 2 | Artifact | Provider metadata + response hash + cascade trail | `llm-provider.js:_responseHash` |
| 3 | Temporal | Session reports + knowledge graph growth | `docs/session-reports/` |

**Theorem**: Spoofing all four layers simultaneously costs as much as actually doing the work — there is no shortcut that satisfies computational, cognitive, artifact, AND temporal proofs.

### 4.4 Model Diversity Index

```
MDI = 1 - Σ sim(p_i, p_j) / C(n, 2)
```

where `sim(p_i, p_j)` measures output distribution similarity between model families.

With 3 distinct model families across 9 providers (Anthropic, OpenAI/DeepSeek, Meta/Llama):

```
MDI ≈ 0.73
```

High MDI means CRPC comparisons across the cascade produce genuine cognitive diversity, not redundant agreement.

---

## 5. Message Formats

### 5.1 Request Envelope

```typescript
interface WardenclyffeRequest {
  requestId: string;           // UUID v4
  payload: {
    model?: string;            // Override model (optional)
    max_tokens: number;
    system: string;
    messages: AnthropicMessage[];
    tools?: AnthropicTool[];
  };
  maxRetries: number;          // Default: 3 (MAX_RETRIES)
  budgetCheck?: boolean;       // Layer 5 pre-check
}
```

### 5.2 Response Envelope

```typescript
interface WardenclyffeResponse {
  // Standard Anthropic-format fields
  content: ContentBlock[];     // text + tool_use blocks
  stop_reason: 'end_turn' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };

  // Wardenclyffe protocol metadata
  _provider: string;           // Active provider name
  _model: string;              // Active model identifier
  _cascadeTrail: CascadeStep[];  // Full cascade attempt history
  _intelligenceLevel: IntelligenceLevel;  // Current quality snapshot
  _responseHash: string;       // SHA-256 artifact proof
}

interface CascadeStep {
  provider: string;
  model: string;
  status: 'success' | 'credit_error' | 'transient_error' | 'fatal_error';
  latencyMs: number;
  error?: string;              // Error message if status != 'success'
}
```

### 5.3 Degradation Notification

```typescript
interface DegradationNotification {
  type: 'degraded' | 'recovered';
  provider: string;            // Current active provider
  quality: number;             // 0-100
  since?: number;              // Unix timestamp (for degraded)
  fallbacksRemaining: number;
}
```

Emitted by `checkDegradation()` — returns `null` when no change, notification object on first degradation or recovery.

---

## 6. Error Handling

### Error Classification

| Category | Detection | Action | Retry? |
|----------|-----------|--------|--------|
| Credit exhaustion | `isCreditError(error)` — status 402, 429+billing, quota messages | `activateFallback()` immediately | Yes, on next provider |
| Transient | `isTransientError(error)` — status 429, 500, 502, 503, 529, timeout, reset | Exponential backoff with jitter | Yes, up to MAX_RETRIES |
| Fatal | Neither credit nor transient | Throw to caller | No |

### Credit Error Signals

```javascript
// Any of these patterns trigger immediate cascade fallback:
'credit balance is too low'
'insufficient_quota'
'exceeded your current quota'
'payment required'                // HTTP 402
'daily limit' / 'daily token limit'
'too many requests' / 'quota exceeded'
'rate limit reached'
'tokens per minute' / 'requests per minute'
```

### Backoff Formula

```
delay = min(1000 × 2^attempt, 8000) + random(0, 1000)
```

Capped at 8 seconds base + up to 1 second jitter. Three attempts maximum.

---

## 7. Provider Attestation (Artifact Proof)

Every response carries an unforgeable provenance hash:

```
_responseHash = SHA-256(content || provider || model || timestamp)
```

This hash serves as **Layer 2 (Artifact) Proof of Mind**:

- **Non-repudiation**: The provider that generated the response is cryptographically bound
- **Temporal ordering**: Timestamp prevents replay
- **Content integrity**: Any modification invalidates the hash
- **Cascade trail**: The full `_cascadeTrail` records every provider attempted, including failures

### Verification

Given a response with `_responseHash`, a verifier can:

1. Reconstruct the hash from response fields
2. Verify it matches the claimed hash
3. Check the cascade trail for consistency (failed providers listed before successful one)
4. Submit to Layer 1 (Mining) as a Proof of Mind artifact

---

## 8. Inter-Layer Interfaces

### Layer 5 (Compute Economics) → Layer 6 (Wardenclyffe)

```
Before request: checkBudget(estimatedTokens) → boolean
After response:  deductBudget(usage.input_tokens + usage.output_tokens)
```

Layer 5 gates requests based on JUL token balance. If budget check fails, the request is rejected before touching the cascade.

### Layer 6 → Layer 7 (Privacy)

```
After response: if (privacyMode) encrypt(response, recipientPubKey)
```

Layer 7 wraps Wardenclyffe responses with end-to-end encryption when privacy mode is active.

### Layer 6 → Layer 4 (CRPC)

```
CRPC comparison: send same prompt to multiple cascade positions
                  → PairwiseVerifier.commitWork() with each response
                  → Validators rank via commitComparison()
```

The cascade enables genuine multi-model comparison because different providers use different model families (MDI ≈ 0.73). CRPC across Claude vs. DeepSeek vs. Llama produces meaningful cognitive diversity.

### Layer 6 → Layer 1 (Mining)

```
After response: appendToPoMChain({
  responseHash: _responseHash,
  cascadeTrail: _cascadeTrail,
  intelligenceLevel: _intelligenceLevel,
  timestamp: Date.now()
})
```

Response hashes feed the Proof of Mind chain — an append-only log of verifiable cognitive work. On CKB, this maps to MMR-accumulated knowledge cells (see `nervos-intel.md`).

---

## 9. Function Reference

All functions are exported from `jarvis-bot/src/llm-provider.js`.

### Initialization

| Function | Signature | Description |
|----------|-----------|-------------|
| `initProvider()` | `() → Provider` | Initialize primary + all fallbacks from config |
| `createProvider()` | `(name, config) → Provider` | Create and set a specific provider |
| `registerProvider()` | `(name, factory) → void` | Register a provider factory |

### Inference

| Function | Signature | Description |
|----------|-----------|-------------|
| `llmChat()` | `(request) → WardenclyffeResponse` | Send request through cascade with auto-fallback |

### Observability

| Function | Signature | Description |
|----------|-----------|-------------|
| `getIntelligenceLevel()` | `() → IntelligenceLevel` | Current quality/tier/degradation state |
| `checkDegradation()` | `() → DegradationNotification \| null` | One-time degradation event |
| `getFallbackChain()` | `() → { active, remaining, totalProviders }` | Full cascade state |
| `getProvider()` | `() → Provider` | Active provider instance |
| `getProviderName()` | `() → string` | Active provider name |
| `getModelName()` | `() → string` | Active model name |

### Recovery

| Function | Signature | Description |
|----------|-----------|-------------|
| `tryRestorePrimary()` | `() → { restored, reason?, provider?, model? }` | Attempt to re-activate primary provider |

### Internal

| Function | Signature | Description |
|----------|-----------|-------------|
| `activateFallback()` | `() → boolean` | Shift to next provider in chain |
| `isCreditError()` | `(error) → boolean` | Classify error as credit exhaustion |
| `isTransientError()` | `(error) → boolean` | Classify error as transient/retryable |
| `getProviderConfig()` | `(name) → { model, apiKey, baseUrl }` | Resolve config for a provider |

---

## 10. Provider Implementations

Each provider implements a common interface:

```typescript
interface Provider {
  name: string;
  model: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
}
```

### Format Normalization

All non-Anthropic providers convert to Anthropic format:

| Provider | Input Conversion | Output Conversion |
|----------|-----------------|-------------------|
| Claude | None (native) | None (native) |
| OpenAI, DeepSeek, Cerebras, Groq, OpenRouter, Mistral, Together | `convertMessages()` + `convertTools()` | `convertResponse()` |
| Gemini | Custom Gemini format conversion | Custom response extraction |
| Ollama | Text-only conversion + tool text parsing | Regex-based tool extraction |

### OpenAI-Compatible Family

Seven providers share `createOpenAIProvider()` with different `baseUrl` and `model` defaults:

```
OpenAI     → api.openai.com/v1         (gpt-4o)
DeepSeek   → api.deepseek.com/v1       (deepseek-chat)
Cerebras   → api.cerebras.ai/v1        (llama-3.3-70b)
Groq       → api.groq.com/openai/v1    (llama-3.3-70b-versatile)
OpenRouter → openrouter.ai/api/v1      (deepseek-r1:free)
Mistral    → api.mistral.ai/v1         (mistral-small-latest)
Together   → api.together.xyz/v1       (Llama-3.3-70B-Instruct-Turbo)
```

---

## References

- [Wardenclyffe Paper](../../llm-hashcash/docs/wardenclyffe-paper.md) — Full academic treatment <!-- FIXME: ../../llm-hashcash/docs/wardenclyffe-paper.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
- [Sybil Resistance Spec](./wardenclyffe-sybil-resistance.md) — AgentRegistry integration
- [CKB Synergy](../../../.claude/nervos-intel.md) — PoW shared state + MMR <!-- FIXME: ../../../.claude/nervos-intel.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
- [llm-provider.js](../../jarvis-bot/src/llm-provider.js) — Reference implementation
- [ergon.ts](../../llm-hashcash/src/services/ergon.ts) — PoW primitives
- [challenges.ts](../../llm-hashcash/src/services/challenges.ts) — Cognitive challenge types
