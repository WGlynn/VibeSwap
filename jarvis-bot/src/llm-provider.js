// ============ WARDENCLYFFE v3 — Hybrid Escalation Router ============
//
// Tesla's Wardenclyffe Tower was designed to transmit energy without wires,
// without meters, without bills. The tower was demolished. The idea was not.
//
// Wardenclyffe v3 is a 13-provider hybrid escalation router that harvests
// free inference from the ambient compute surplus of the modern API economy.
//
// v1: Cascade down (premium first, degrade on failure)
// v2: Skill-based routing (cooperative, but still premium-first)
// v3: HYBRID ESCALATION — start cheap, level up on demand
//
// Architecture: Triage → Route to cheapest adequate tier → Escalate on quality failure
//
// Tier 0 (free):    OpenRouter/Qwen (0.80), Groq, Cerebras, SambaNova, Together, Fireworks, Novita, Mistral
// Tier 1 (budget):  DeepSeek ($0.69), Gemini ($0.38), Ollama (local)
// Tier 2 (premium): Claude ($9), OpenAI ($8.75), xAI ($5)
// v3.1: All 8 Tier 0 providers now in escalation chains (was 4). Qwen leads coding/math/moderate.
//
// Economics: ~70% of messages at $0, ~20% at $0.50/MTok, ~10% at $8/MTok
// Old model: 100% starting at $8/MTok → now saves ~90% on routine messages
//
// Horizontal scaling: Each Jarvis shard has its OWN free-tier API keys.
// N shards = N × (free tier limits). Shards communicate via Mind Mesh (BFT/CRPC).
// Free compute scales linearly with network size. Cost per shard: near-zero.
// The network doesn't share rate limits — it MULTIPLIES them.
//
// Availability: 1 - (1-a)^13 ≈ 1.0 (fifteen nines)
// All providers return normalized Anthropic-format responses:
//   { content, stop_reason, usage, _provider, _model }
//
// CRPC across different model families = genuine cognitive diversity.
// ============

import { config } from './config.js';
import { randomUUID, createHash } from 'crypto';
import { getActivePersonaId as _getPersonaId } from './persona.js';

// ============ Truncated Response Error ============
// Thrown when a provider returns incomplete/truncated JSON.
// Classified as transient so the retry + cascade logic catches it.
class TruncatedResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TruncatedResponseError';
  }
}

// ============ Provider Interface ============

/**
 * @typedef {Object} LLMRequest
 * @property {string} model - Model identifier
 * @property {number} max_tokens - Max output tokens
 * @property {string} system - System prompt
 * @property {Array} messages - Conversation history
 * @property {Array} [tools] - Tool definitions (Anthropic format)
 */

/**
 * @typedef {Object} LLMResponse
 * @property {Array} content - Content blocks (text + tool_use)
 * @property {string} stop_reason - 'end_turn' | 'tool_use'
 * @property {{input_tokens: number, output_tokens: number}} usage
 */

// ============ Tool Exchange Flattening ============
// When cascading from Claude to non-Claude providers, tool_use/tool_result blocks
// in the conversation history can cause 400 errors (Gemini, DeepSeek, etc. all have
// different format requirements). Since these tool exchanges were created by a previous
// provider and reference Jarvis-specific tools, the safest approach is to flatten them
// to plain text before sending to fallback providers.

// Providers that support vision (image input)
const VISION_PROVIDERS = new Set(['claude', 'openai', 'gemini', 'xai']);

function flattenToolExchanges(messages) {
  // Strip tool_use/tool_result blocks entirely — fallback models don't need them
  // and will echo ANY visible format (brackets, parens, natural language) as text.
  // Only preserve the text content from messages that had tool exchanges.
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;

    const hasToolUse = msg.content.some(b => b.type === 'tool_use');
    const hasToolResult = msg.content.some(b => b.type === 'tool_result');

    if (!hasToolUse && !hasToolResult) return msg;

    // Keep ONLY text blocks — drop all tool_use and tool_result blocks silently
    const textParts = msg.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text);

    const flatText = textParts.join('\n').trim();
    return flatText ? { role: msg.role, content: flatText } : null;
  }).filter(Boolean);
}

/**
 * Strip image/document blocks from messages for non-vision providers.
 * Replaces image blocks with text descriptions so the LLM knows an image was sent.
 */
function stripMediaBlocks(messages) {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;

    // Catch both Anthropic format (type: 'image') and OpenAI format (type: 'image_url')
    const hasMedia = msg.content.some(b => b.type === 'image' || b.type === 'image_url' || b.type === 'document');
    if (!hasMedia) return msg;

    const newContent = [];
    for (const block of msg.content) {
      if (block.type === 'image' || block.type === 'image_url') {
        newContent.push({ type: 'text', text: '[The user sent an image, but this model does not support vision. Describe that you cannot see images and suggest they try again when a vision-capable model is active.]' });
      } else if (block.type === 'document') {
        newContent.push({ type: 'text', text: '[The user sent a document, but this model does not support document input.]' });
      } else {
        newContent.push(block);
      }
    }

    // If all blocks became text, flatten to string
    if (newContent.every(b => b.type === 'text')) {
      return { role: msg.role, content: newContent.map(b => b.text).join('\n') };
    }
    return { ...msg, content: newContent };
  });
}

// ============ Provider Registry ============

const providers = new Map();

export function registerProvider(name, factory) {
  providers.set(name, factory);
}

// ============ Circuit Breaker — Per-Provider Health Tracking ============
// Prevents cascade poisoning by tracking error rates per provider.
// When a provider exceeds the error threshold, it's temporarily disabled
// with exponential backoff for re-enablement.
//
// States:
//   CLOSED  → normal operation, requests flow through
//   OPEN    → provider disabled, requests skip it
//   HALF    → probe: allow 1 request to test recovery
//

const CIRCUIT_BREAKER_CONFIG = {
  windowMs: 60000,           // 1 minute sliding window
  errorThreshold: 0.5,       // 50% error rate triggers open
  minRequests: 3,            // Need at least 3 requests before evaluating
  openDurationMs: 30000,     // Initial open duration: 30s
  maxOpenDurationMs: 600000, // Max open duration: 10 minutes
  backoffMultiplier: 2,      // Exponential backoff factor
  halfOpenMaxProbes: 1,      // Allow 1 probe request in half-open
};

// Per-provider circuit state — ISOLATED POOLS
// Background tasks (boredom, proactive, autonomous) use a separate pool
// so their failures can't poison user-facing circuit breakers.
const circuitBreakers = new Map();     // "user:{provider}" → CircuitState
const bgCircuitBreakers = new Map();   // "bg:{provider}" → CircuitState

// ============ Request Queue (Per-Provider Concurrency Limiter) ============
// Prevents thundering herd when a provider recovers from outage.
// Without this, N simultaneous requests all independently hammer the fallback chain.
// With this, requests serialize per-provider and back-pressure naturally.

const PROVIDER_CONCURRENCY = {
  claude: 5,       // Premium — allow more parallel
  openai: 5,
  xai: 3,
  deepseek: 3,
  gemini: 4,
  ollama: 2,       // Local — limited by hardware
  cerebras: 4,     // Free tier — moderate
  groq: 4,
  openrouter: 2,   // Free tier — conservative
  mistral: 3,
  together: 3,
  sambanova: 3,
  fireworks: 3,
  novita: 2,
};

class ProviderQueue {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.waiting = [];  // FIFO queue of { resolve, enqueueTime }
    this.totalQueued = 0;
    this.totalProcessed = 0;
    this.maxWaitMs = 30000; // Drop requests waiting longer than 30s
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    this.totalQueued++;

    return new Promise((resolve, reject) => {
      const entry = { resolve, enqueueTime: Date.now() };
      this.waiting.push(entry);

      // Timeout: don't let requests wait forever in queue
      const timeout = setTimeout(() => {
        const idx = this.waiting.indexOf(entry);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
          reject(new Error(`Queue timeout: waited ${this.maxWaitMs}ms for provider slot`));
        }
      }, this.maxWaitMs);

      // Patch resolve to clear timeout
      const origResolve = entry.resolve;
      entry.resolve = () => {
        clearTimeout(timeout);
        origResolve();
      };
    });
  }

  release() {
    this.active--;
    this.totalProcessed++;

    // Drain stale entries (waited too long)
    while (this.waiting.length > 0) {
      const next = this.waiting[0];
      if (Date.now() - next.enqueueTime > this.maxWaitMs) {
        this.waiting.shift(); // Already timed out, skip
        continue;
      }
      this.waiting.shift();
      this.active++;
      next.resolve();
      return;
    }
  }

  getStats() {
    return {
      active: this.active,
      waiting: this.waiting.length,
      maxConcurrent: this.maxConcurrent,
      totalQueued: this.totalQueued,
      totalProcessed: this.totalProcessed,
    };
  }
}

const providerQueues = new Map(); // provider name → ProviderQueue

function getProviderQueue(providerName) {
  if (!providerQueues.has(providerName)) {
    const maxConcurrent = PROVIDER_CONCURRENCY[providerName] || 3;
    providerQueues.set(providerName, new ProviderQueue(maxConcurrent));
  }
  return providerQueues.get(providerName);
}

/** Get queue stats for all providers (monitoring). */
export function getQueueStats() {
  const stats = {};
  for (const [name, q] of providerQueues) {
    stats[name] = q.getStats();
  }
  return stats;
}

class CircuitState {
  constructor(providerName) {
    this.providerName = providerName;
    this.state = 'closed'; // closed | open | half_open
    this.successes = 0;
    this.failures = 0;
    this.totalRequests = 0;
    this.lastFailure = 0;
    this.lastSuccess = 0;
    this.openedAt = 0;
    this.openDuration = CIRCUIT_BREAKER_CONFIG.openDurationMs;
    this.halfOpenProbes = 0;
    this.consecutiveFailures = 0;
    this.windowStart = Date.now();

    // Rolling window for error rate calculation
    this.recentResults = []; // [{ timestamp, success }]
  }

  /**
   * Record a successful request.
   */
  recordSuccess() {
    this.successes++;
    this.totalRequests++;
    this.lastSuccess = Date.now();
    this.consecutiveFailures = 0;
    this.recentResults.push({ timestamp: Date.now(), success: true });
    this._pruneWindow();

    if (this.state === 'half_open') {
      // Recovery confirmed — close the breaker
      console.log(`[circuit-breaker] ${this.providerName}: HALF_OPEN → CLOSED (probe succeeded)`);
      this.state = 'closed';
      this.openDuration = CIRCUIT_BREAKER_CONFIG.openDurationMs; // Reset backoff
      this.halfOpenProbes = 0;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(error) {
    this.failures++;
    this.totalRequests++;
    this.lastFailure = Date.now();
    this.consecutiveFailures++;
    this.recentResults.push({ timestamp: Date.now(), success: false });
    this._pruneWindow();

    // 529 Overloaded / 429 Rate Limit → instant trip with extended cooldown
    const status = error?.status || error?.statusCode || error?.response?.status;
    const msg = (error?.message || '').toLowerCase();
    if (status === 529 || msg.includes('overloaded')) {
      return this.recordOverloaded();
    }
    if (status === 429 || msg.includes('rate limit')) {
      return this.recordRateLimited();
    }

    if (this.state === 'half_open') {
      // Probe failed — reopen with increased backoff
      this.openDuration = Math.min(
        this.openDuration * CIRCUIT_BREAKER_CONFIG.backoffMultiplier,
        CIRCUIT_BREAKER_CONFIG.maxOpenDurationMs
      );
      this.openedAt = Date.now();
      this.state = 'open';
      this.halfOpenProbes = 0;
      console.warn(`[circuit-breaker] ${this.providerName}: HALF_OPEN → OPEN (probe failed, backoff ${this.openDuration}ms)`);
      return;
    }

    // Check if error rate exceeds threshold (closed state)
    if (this.state === 'closed') {
      const windowResults = this._getWindowResults();
      if (windowResults.total >= CIRCUIT_BREAKER_CONFIG.minRequests) {
        const errorRate = windowResults.failures / windowResults.total;
        if (errorRate >= CIRCUIT_BREAKER_CONFIG.errorThreshold) {
          this.state = 'open';
          this.openedAt = Date.now();
          console.warn(`[circuit-breaker] ${this.providerName}: CLOSED → OPEN (error rate ${(errorRate * 100).toFixed(0)}% in ${windowResults.total} requests)`);
        }
      }
    }
  }

  /**
   * Instant circuit trip for 529 Overloaded errors.
   * Overload events are service-wide and last minutes, not seconds.
   * Don't waste retries probing a provider that told us it's overloaded.
   */
  recordOverloaded() {
    const prevState = this.state;
    this.state = 'open';
    this.openedAt = Date.now();
    // Overloaded = long cooldown. Minimum 60s, escalating on repeat.
    this.openDuration = Math.max(
      60000,  // At least 60s (vs default 30s)
      Math.min(this.openDuration * CIRCUIT_BREAKER_CONFIG.backoffMultiplier, CIRCUIT_BREAKER_CONFIG.maxOpenDurationMs)
    );
    this.halfOpenProbes = 0;
    console.warn(`[circuit-breaker] ${this.providerName}: ${prevState} → OPEN (529 OVERLOADED — instant trip, cooldown ${Math.round(this.openDuration / 1000)}s)`);
  }

  /**
   * Instant circuit trip for 429 Rate Limited errors.
   * Shorter cooldown than overloaded — rate limits clear faster.
   */
  recordRateLimited() {
    const prevState = this.state;
    this.state = 'open';
    this.openedAt = Date.now();
    // Rate limit = moderate cooldown. Minimum 30s, escalating on repeat.
    this.openDuration = Math.max(
      30000,
      Math.min(this.openDuration * CIRCUIT_BREAKER_CONFIG.backoffMultiplier, CIRCUIT_BREAKER_CONFIG.maxOpenDurationMs)
    );
    this.halfOpenProbes = 0;
    console.warn(`[circuit-breaker] ${this.providerName}: ${prevState} → OPEN (429 RATE LIMITED — instant trip, cooldown ${Math.round(this.openDuration / 1000)}s)`);
  }

  /**
   * Check if requests should be allowed through.
   */
  allowRequest() {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      // Check if open duration has elapsed
      if (Date.now() - this.openedAt >= this.openDuration) {
        this.state = 'half_open';
        this.halfOpenProbes = 0;
        console.log(`[circuit-breaker] ${this.providerName}: OPEN → HALF_OPEN (testing recovery)`);
        return true; // Allow probe
      }
      return false; // Still open
    }

    if (this.state === 'half_open') {
      // Allow limited probes
      if (this.halfOpenProbes < CIRCUIT_BREAKER_CONFIG.halfOpenMaxProbes) {
        this.halfOpenProbes++;
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Get stats for monitoring.
   */
  getStats() {
    const windowResults = this._getWindowResults();
    return {
      provider: this.providerName,
      state: this.state,
      totalRequests: this.totalRequests,
      successes: this.successes,
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      windowErrorRate: windowResults.total > 0
        ? (windowResults.failures / windowResults.total * 100).toFixed(1) + '%'
        : 'n/a',
      windowRequests: windowResults.total,
      openDuration: this.state === 'open' ? this.openDuration : 0,
      timeUntilProbe: this.state === 'open'
        ? Math.max(0, this.openDuration - (Date.now() - this.openedAt))
        : 0
    };
  }

  _pruneWindow() {
    const cutoff = Date.now() - CIRCUIT_BREAKER_CONFIG.windowMs;
    this.recentResults = this.recentResults.filter(r => r.timestamp > cutoff);
  }

  _getWindowResults() {
    this._pruneWindow();
    const total = this.recentResults.length;
    const failures = this.recentResults.filter(r => !r.success).length;
    return { total, failures, successes: total - failures };
  }
}

/**
 * Get or create circuit breaker for a provider.
 * @param {string} providerName
 * @param {boolean} background - If true, use isolated background pool
 */
function getCircuitBreaker(providerName, background = false) {
  const pool = background ? bgCircuitBreakers : circuitBreakers;
  const key = providerName;
  if (!pool.has(key)) {
    pool.set(key, new CircuitState(`${background ? 'bg:' : ''}${providerName}`));
  }
  return pool.get(key);
}

/**
 * Get health stats for all providers.
 * Shows both user-facing and background circuit breaker pools.
 */
export function getProviderHealth() {
  const health = {};
  for (const [name, cb] of circuitBreakers) {
    health[name] = cb.getStats();
  }
  for (const [name, cb] of bgCircuitBreakers) {
    health[`bg:${name}`] = cb.getStats();
  }
  return health;
}

/**
 * Get a status string for monitoring.
 */
export function getProviderHealthString() {
  const lines = ['=== Wardenclyffe Provider Health ==='];
  for (const [name, cb] of circuitBreakers) {
    const stats = cb.getStats();
    const perf = providerPerformance.get(name);
    const q = providerQueues.get(name);
    const stateIcon = stats.state === 'closed' ? 'OK' : stats.state === 'open' ? 'DOWN' : 'PROBE';
    const latStr = perf ? ` ~${Math.round(perf.emaLatency)}ms` : '';
    const queueStr = q ? ` [${q.active}/${q.maxConcurrent} active, ${q.waiting.length} queued]` : '';
    lines.push(`  ${stateIcon} ${name}: ${stats.windowErrorRate} error rate (${stats.windowRequests} req/min)${latStr}${queueStr}, ${stats.totalRequests} total`);
    if (stats.state === 'open') {
      lines.push(`     → reopens in ${Math.round(stats.timeUntilProbe / 1000)}s`);
    }
  }
  if (fallbackProviders.length > 0) {
    lines.push(`\nFallback order: ${fallbackProviders.map(p => p.name).join(' → ')}`);
  }
  return lines.join('\n');
}

// ============ Provider Performance Ranking ============
// Tracks per-provider latency and success rate using exponential moving average.
// Used to dynamically reorder Tier 2 fallback providers by recent performance.
// Tier 1 order stays fixed (quality-based), Tier 2 sorts by fastest/most reliable.

const providerPerformance = new Map(); // provider name → { emaLatency, emaSuccessRate, samples }

const PERF_EMA_ALPHA = 0.3; // Weight for new observations (0.3 = responsive to recent changes)

function recordProviderPerformance(providerName, latencyMs, success) {
  let perf = providerPerformance.get(providerName);
  if (!perf) {
    perf = { emaLatency: latencyMs, emaSuccessRate: success ? 1 : 0, samples: 0 };
    providerPerformance.set(providerName, perf);
  }

  perf.samples++;
  perf.emaLatency = PERF_EMA_ALPHA * latencyMs + (1 - PERF_EMA_ALPHA) * perf.emaLatency;
  perf.emaSuccessRate = PERF_EMA_ALPHA * (success ? 1 : 0) + (1 - PERF_EMA_ALPHA) * perf.emaSuccessRate;
}

/**
 * Score a provider for fallback ordering.
 * Lower score = better (faster + more reliable).
 * Providers with no data get a neutral score.
 */
function getProviderScore(providerName) {
  const perf = providerPerformance.get(providerName);
  if (!perf || perf.samples < 2) return 5000; // Neutral score for unknown providers

  // Score = latency * (2 - successRate)
  // Fast + reliable = low score. Slow + unreliable = high score.
  return perf.emaLatency * (2 - perf.emaSuccessRate);
}

/**
 * Reorder Tier 2 fallback providers by performance score.
 * Called periodically or after cascade events.
 */
function reorderFallbacksByPerformance() {
  // Only reorder Tier 2 providers within the fallback array
  const tier1 = [];
  const tier2 = [];

  for (const fb of fallbackProviders) {
    const info = PROVIDER_QUALITY[fb.name] || { tier: 2 };
    if (info.tier === 1) {
      tier1.push(fb);
    } else {
      tier2.push(fb);
    }
  }

  // Sort Tier 2 by performance score (lower = better)
  tier2.sort((a, b) => getProviderScore(a.name) - getProviderScore(b.name));

  // Rebuild: Tier 1 first (fixed order), then Tier 2 (ranked)
  fallbackProviders = [...tier1, ...tier2];
}

/**
 * Get performance stats for monitoring.
 */
export function getProviderPerformanceStats() {
  const stats = {};
  for (const [name, perf] of providerPerformance) {
    stats[name] = {
      avgLatencyMs: Math.round(perf.emaLatency),
      successRate: (perf.emaSuccessRate * 100).toFixed(1) + '%',
      samples: perf.samples,
      score: Math.round(getProviderScore(name)),
    };
  }
  return stats;
}

// ============ Claude (Anthropic) Provider ============

function createClaudeProvider(providerConfig) {
  // Dynamic import to avoid hard dependency when using other providers
  let client = null;

  async function getClient() {
    if (!client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      client = new Anthropic({ apiKey: providerConfig.apiKey, timeout: 120_000 });
    }
    return client;
  }

  return {
    name: 'claude',
    model: providerConfig.model || 'claude-sonnet-4-5-20250929',

    async chat(request) {
      const c = await getClient();
      const response = await c.messages.create({
        model: request.model || this.model,
        max_tokens: request.max_tokens,
        system: request.system,
        messages: request.messages,
        ...(request.tools?.length ? { tools: request.tools } : {}),
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
      });
      // Already in Anthropic format — pass through
      return {
        content: response.content,
        stop_reason: response.stop_reason,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    },
  };
}

registerProvider('claude', createClaudeProvider);

// ============ OpenAI Provider ============

function createOpenAIProvider(providerConfig) {
  const baseUrl = providerConfig.baseUrl || 'https://api.openai.com/v1';
  const apiKey = providerConfig.apiKey;
  const defaultModel = providerConfig.model || 'gpt-5.4';

  // Convert Anthropic tool format → OpenAI function format
  function convertTools(tools) {
    if (!tools?.length) return undefined;
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  // Convert Anthropic messages → OpenAI messages
  function convertMessages(messages, system) {
    const result = [];
    if (system) {
      result.push({ role: 'system', content: system });
    }
    for (const msg of messages) {
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          // Could be tool_results or multimodal content
          const toolResults = msg.content.filter(b => b.type === 'tool_result');
          if (toolResults.length > 0) {
            for (const tr of toolResults) {
              result.push({
                role: 'tool',
                tool_call_id: tr.tool_use_id,
                content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
              });
            }
          } else {
            // Multimodal content — convert image/document blocks to OpenAI format
            const hasMedia = msg.content.some(b => b.type === 'image' || b.type === 'document');
            if (hasMedia) {
              const parts = [];
              for (const block of msg.content) {
                if (block.type === 'text') {
                  parts.push({ type: 'text', text: block.text });
                } else if (block.type === 'image' && block.source?.type === 'base64') {
                  parts.push({
                    type: 'image_url',
                    image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
                  });
                }
                // Documents not natively supported by OpenAI — skip
              }
              result.push({ role: 'user', content: parts });
            } else {
              result.push({ role: 'user', content: msg.content.map(b => b.text || '').join('') });
            }
          }
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(b => ({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }));
          const entry = { role: 'assistant' };
          // Groq/some providers reject null content — omit if empty, or use empty string
          if (textParts) entry.content = textParts;
          else if (!toolCalls.length) entry.content = '';
          if (toolCalls.length) entry.tool_calls = toolCalls;
          result.push(entry);
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      }
    }
    return result;
  }

  // Convert OpenAI response → Anthropic format
  function convertResponse(response) {
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new TruncatedResponseError('Missing choices[0].message in API response');
    }
    const content = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch (parseErr) {
          // Truncated tool call arguments — treat as transient (provider cut off mid-stream)
          console.warn(`[openai-compat] Truncated tool_call arguments for ${tc.function.name}: ${parseErr.message}`);
          throw new TruncatedResponseError(`Truncated tool_call arguments: ${parseErr.message}`);
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsedArgs,
        });
      }
    }

    return {
      content,
      stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
    };
  }

  return {
    name: providerConfig.providerName || 'openai',
    model: defaultModel,

    async chat(request) {
      const body = {
        model: request.model || this.model,
        max_tokens: request.max_tokens,
        messages: convertMessages(request.messages, request.system),
        ...(request.tools?.length ? { tools: convertTools(request.tools) } : {}),
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000), // 120s — prevents hanging on stalled providers
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`${this.name} API error ${response.status}: ${error}`);
      }

      // Parse response body — catch truncated JSON from providers that cut off mid-stream
      let responseData;
      try {
        responseData = await response.json();
      } catch (parseErr) {
        throw new TruncatedResponseError(`${providerConfig.providerName || 'openai'} returned truncated JSON: ${parseErr.message}`);
      }

      return convertResponse(responseData);
    },
  };
}

registerProvider('openai', createOpenAIProvider);

// ============ Ollama Provider (Local Models) ============

function createOllamaProvider(providerConfig) {
  const baseUrl = providerConfig.baseUrl || 'http://localhost:11434';
  const defaultModel = providerConfig.model || 'llama3.1';

  // Ollama uses OpenAI-compatible /v1/chat/completions
  // But tool support varies by model. We handle both cases.

  function convertMessages(messages, system) {
    const result = [];
    if (system) {
      result.push({ role: 'system', content: system });
    }
    for (const msg of messages) {
      // Ollama requires ALL content to be plain strings — not arrays, not objects.
      // Force-flatten every message regardless of role.
      let content;
      if (Array.isArray(msg.content)) {
        const parts = [];
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) parts.push(block.text);
          else if (block.type === 'tool_result') {
            parts.push(`[Tool result for ${block.tool_use_id}]: ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}`);
          } else if (block.type === 'tool_use') {
            parts.push(`[Using tool: ${block.name}(${JSON.stringify(block.input)})]`);
          } else if (block.type === 'image' || block.type === 'image_url' || block.type === 'document') {
            parts.push(`[${block.type} attached]`);
          }
        }
        content = parts.join('\n') || '';
      } else if (typeof msg.content === 'string') {
        content = msg.content;
      } else {
        content = msg.content ? String(msg.content) : '';
      }

      if (msg.role === 'user' || msg.role === 'assistant') {
        if (content) result.push({ role: msg.role, content });
      }
    }
    return result;
  }

  return {
    name: 'ollama',
    model: defaultModel,

    async chat(request) {
      const messages = convertMessages(request.messages, request.system);

      // Try OpenAI-compatible endpoint first (Ollama 0.2+)
      const body = {
        model: request.model || this.model,
        messages,
        stream: false,
        options: {
          num_predict: request.max_tokens || 2048,
        },
      };

      // 120s timeout — Ollama cold-starts take 3-5s to load model into RAM.
      // Default Node fetch has NO timeout, so stalled requests would hang forever.
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error ${response.status}: ${error}`);
      }

      const data = await response.json();
      const text = data.message?.content || '';

      // Parse tool calls from structured text (for models without native tool support)
      const content = [];
      const toolCallRegex = /\[Using tool: (\w+)\((.*?)\)\]/g;
      let match;
      let cleanText = text;
      const toolCalls = [];

      while ((match = toolCallRegex.exec(text)) !== null) {
        try {
          toolCalls.push({
            type: 'tool_use',
            id: `toolu_ollama_${randomUUID().slice(0, 8)}`,
            name: match[1],
            input: JSON.parse(match[2]),
          });
          cleanText = cleanText.replace(match[0], '').trim();
        } catch { /* ignore parse failures */ }
      }

      if (cleanText) {
        content.push({ type: 'text', text: cleanText });
      }
      content.push(...toolCalls);

      return {
        content,
        stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        usage: {
          input_tokens: data.prompt_eval_count || 0,
          output_tokens: data.eval_count || 0,
        },
      };
    },
  };
}

registerProvider('ollama', createOllamaProvider);

// Pre-warm Ollama model on startup — loads weights into RAM so first real message isn't slow
async function warmOllama() {
  try {
    const url = process.env.OLLAMA_URL || 'http://localhost:11434';
    // Always warm the Ollama model (may differ from LLM_MODEL when Claude is primary)
    const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    console.log(`[ollama] Pre-warming model ${model}...`);
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) console.log(`[ollama] Model ${model} warm — ready for inference`);
    else console.warn(`[ollama] Pre-warm failed: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[ollama] Pre-warm skipped: ${e.message}`);
  }
}
// Fire and forget — don't block startup. Always warm if Ollama URL is set (it's in the cascade)
if (process.env.OLLAMA_URL) warmOllama();

// ============ Gemini Provider ============

function createGeminiProvider(providerConfig) {
  const apiKey = providerConfig.apiKey;
  const defaultModel = providerConfig.model || 'gemini-2.5-flash';
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  function convertMessages(messages, system) {
    const contents = [];

    // Build tool_use_id → function_name lookup across all messages
    const toolIdToName = new Map();
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.id && block.name) {
            toolIdToName.set(block.id, block.name);
          }
        }
      }
    }

    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'model' : 'user';

      if (Array.isArray(msg.content)) {
        // Gemini requires: functionCall in model turn, functionResponse in user turn
        // immediately after. Separate them from text/image parts.
        const functionCallParts = [];
        const functionResponseParts = [];
        const otherParts = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            otherParts.push({ text: block.text });
          } else if (block.type === 'image' && block.source?.type === 'base64') {
            otherParts.push({
              inlineData: { mimeType: block.source.media_type, data: block.source.data },
            });
          } else if (block.type === 'tool_use') {
            functionCallParts.push({
              functionCall: { name: block.name, args: block.input || {} },
            });
          } else if (block.type === 'tool_result') {
            const funcName = toolIdToName.get(block.tool_use_id) || block.tool_use_id;
            functionResponseParts.push({
              functionResponse: {
                name: funcName,
                response: { result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) },
              },
            });
          }
        }

        // Emit parts in Gemini-required order:
        // Gemini allows text + functionCall in same model turn, but functionResponse
        // must be in a dedicated user turn immediately after the functionCall turn.
        if (functionCallParts.length > 0) {
          // Model turn: text (if any) + functionCall parts together
          const modelParts = [...otherParts, ...functionCallParts];
          contents.push({ role: 'model', parts: modelParts });
        } else if (functionResponseParts.length > 0) {
          // User turn: functionResponse parts (+ any text, though rare)
          const userParts = [...otherParts, ...functionResponseParts];
          contents.push({ role: 'user', parts: userParts });
        } else if (otherParts.length > 0) {
          // No function parts — just text/image in natural role
          contents.push({ role, parts: otherParts });
        }
      } else if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    // Gemini doesn't allow consecutive same-role turns (except model→model for
    // function call chains). Merge consecutive same-role non-function turns.
    for (let i = 1; i < contents.length; i++) {
      if (contents[i].role === contents[i - 1].role) {
        // Check if merging is safe (don't merge functionCall with text, etc.)
        const prevHasFunc = contents[i - 1].parts.some(p => p.functionCall || p.functionResponse);
        const currHasFunc = contents[i].parts.some(p => p.functionCall || p.functionResponse);
        if (!prevHasFunc && !currHasFunc) {
          contents[i - 1].parts.push(...contents[i].parts);
          contents.splice(i, 1);
          i--;
        }
      }
    }

    return { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined };
  }

  function convertTools(tools) {
    if (!tools?.length) return undefined;
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    }];
  }

  return {
    name: 'gemini',
    model: defaultModel,

    async chat(request) {
      const model = request.model || this.model;
      const { contents, systemInstruction } = convertMessages(request.messages, request.system);

      const body = {
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(request.tools?.length ? { tools: convertTools(request.tools) } : {}),
        generationConfig: {
          maxOutputTokens: request.max_tokens || 2048,
        },
      };

      const response = await fetch(
        `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${error}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const content = [];
      let hasToolCalls = false;

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            content.push({ type: 'text', text: part.text });
          }
          if (part.functionCall) {
            hasToolCalls = true;
            content.push({
              type: 'tool_use',
              id: `toolu_gemini_${randomUUID().slice(0, 8)}`,
              name: part.functionCall.name,
              input: part.functionCall.args || {},
            });
          }
        }
      }

      return {
        content,
        stop_reason: hasToolCalls ? 'tool_use' : 'end_turn',
        usage: {
          input_tokens: data.usageMetadata?.promptTokenCount || 0,
          output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    },
  };
}

registerProvider('gemini', createGeminiProvider);

// ============ DeepSeek Provider (OpenAI-compatible) ============

function createDeepSeekProvider(providerConfig) {
  // DeepSeek uses OpenAI-compatible API
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'deepseek',
    baseUrl: providerConfig.baseUrl || 'https://api.deepseek.com/v1',
    model: providerConfig.model || 'deepseek-chat',
  });
}

registerProvider('deepseek', createDeepSeekProvider);

// ============ Cerebras Provider (Free Tier — Llama 3.3 70B, 1M tok/day) ============

function createCerebrasProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'cerebras',
    baseUrl: providerConfig.baseUrl || 'https://api.cerebras.ai/v1',
    model: providerConfig.model || 'llama-3.3-70b',
  });
}

registerProvider('cerebras', createCerebrasProvider);

// ============ Groq Provider (Free Tier — Llama 3.3 70B, ~14K req/day) ============

function createGroqProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'groq',
    baseUrl: providerConfig.baseUrl || 'https://api.groq.com/openai/v1',
    model: providerConfig.model || 'llama-3.3-70b-versatile',
  });
}

registerProvider('groq', createGroqProvider);

// ============ OpenRouter Provider (Free Tier — Qwen 3.6 Plus stable, quality 0.80) ============
// Wardenclyffe v3.1: Qwen 3.6 Plus (stable, April 2 build) replaces DeepSeek R1 free as default.
// Tier 0 lead for coding, math, moderate chains. 0.80 quality at $0.

function createOpenRouterProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'openrouter',
    baseUrl: providerConfig.baseUrl || 'https://openrouter.ai/api/v1',
    model: providerConfig.model || 'qwen/qwen3.6-plus:free',
  });
}

registerProvider('openrouter', createOpenRouterProvider);

// ============ Mistral Provider (Free Tier — Mistral Small, ~500K tok/min) ============

function createMistralProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'mistral',
    baseUrl: providerConfig.baseUrl || 'https://api.mistral.ai/v1',
    model: providerConfig.model || 'mistral-small-latest',
  });
}

registerProvider('mistral', createMistralProvider);

// ============ Together Provider (Signup Credits — Llama 3.3 70B) ============

function createTogetherProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'together',
    baseUrl: providerConfig.baseUrl || 'https://api.together.xyz/v1',
    model: providerConfig.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  });
}

registerProvider('together', createTogetherProvider);

// ============ SambaNova Provider (Free Tier — Llama 3.3 70B, fast inference) ============

function createSambaNovaProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'sambanova',
    baseUrl: providerConfig.baseUrl || 'https://api.sambanova.ai/v1',
    model: providerConfig.model || 'Meta-Llama-3.3-70B-Instruct',
  });
}

registerProvider('sambanova', createSambaNovaProvider);

// ============ Fireworks Provider (Free Credits — Llama 3.3 70B, blazing fast) ============

function createFireworksProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'fireworks',
    baseUrl: providerConfig.baseUrl || 'https://api.fireworks.ai/inference/v1',
    model: providerConfig.model || 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  });
}

registerProvider('fireworks', createFireworksProvider);

// ============ Novita Provider (Free Tier — Llama 3.3 70B, generous limits) ============

function createNovitaProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'novita',
    baseUrl: providerConfig.baseUrl || 'https://api.novita.ai/v3/openai',
    model: providerConfig.model || 'meta-llama/llama-3.3-70b-instruct',
  });
}

registerProvider('novita', createNovitaProvider);

// ============ xAI Grok Provider (OpenAI-compatible, Free Tier available) ============

function createXAIProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'xai',
    baseUrl: providerConfig.baseUrl || 'https://api.x.ai/v1',
    model: providerConfig.model || 'grok-3',
  });
}

registerProvider('xai', createXAIProvider);

// ============ Factory ============

let activeProvider = null;
let fallbackProviders = [];   // Pre-initialized fallbacks, ordered by priority
let primaryProviderName = ''; // Remember the primary for recovery

export function createProvider(providerName, providerConfig) {
  const factory = providers.get(providerName);
  if (!factory) {
    throw new Error(`Unknown LLM provider: "${providerName}". Available: ${[...providers.keys()].join(', ')}`);
  }
  activeProvider = factory(providerConfig);
  console.log(`[llm] Provider initialized: ${providerName} (model: ${activeProvider.model})`);
  return activeProvider;
}

export function getProvider() {
  return activeProvider;
}

export function getProviderName() {
  return activeProvider?.name || 'none';
}

export function getModelName() {
  return activeProvider?.model || 'unknown';
}

export function getFallbackChain() {
  return {
    active: activeProvider ? { name: activeProvider.name, model: activeProvider.model } : null,
    remaining: fallbackProviders.map(p => ({ name: p.name, model: p.model })),
    totalProviders: 1 + fallbackProviders.length,
  };
}

// ============ Wardenclyffe — Elastic Intelligence Tiers ============
//
// Quality degrades visibly when paid providers exhaust.
// This creates economic incentive: community tips refill premium credits.
// Supply (Anthropic credits) and demand (output quality) find equilibrium.
//
// Tier 1: Claude          — quality 1.00 (reference)
// Tier 1: DeepSeek        — quality 0.85
// Tier 1: Gemini          — quality 0.75
// Tier 1: OpenAI GPT-5.4  — quality 0.95
// Tier 2: Cerebras/Groq   — quality 0.60 (Llama 3.3 70B)
// Tier 2: OpenRouter      — quality 0.55 (free DeepSeek R1)
// Tier 2: Mistral Small   — quality 0.50
// Tier 2: Together        — quality 0.60
// Tier 2: SambaNova       — quality 0.60 (Llama 3.3 70B, free)
// Tier 2: Fireworks       — quality 0.60 (Llama 3.3 70B, fast)
// Tier 2: Novita          — quality 0.55 (Llama 3.3 70B, free)

const PROVIDER_QUALITY = {
  claude:     { quality: 1.00, tier: 1, label: 'Premium' },
  deepseek:   { quality: 0.85, tier: 1, label: 'Premium' },
  openai:     { quality: 0.95, tier: 1, label: 'Premium' },
  gemini:     { quality: 0.75, tier: 1, label: 'Premium' },
  cerebras:   { quality: 0.60, tier: 2, label: 'Free' },
  groq:       { quality: 0.60, tier: 2, label: 'Free' },
  openrouter: { quality: 0.55, tier: 2, label: 'Free' },
  mistral:    { quality: 0.50, tier: 2, label: 'Free' },
  together:   { quality: 0.60, tier: 2, label: 'Free' },
  sambanova:  { quality: 0.60, tier: 2, label: 'Free' },
  fireworks:  { quality: 0.60, tier: 2, label: 'Free' },
  novita:     { quality: 0.55, tier: 2, label: 'Free' },
  xai:        { quality: 0.90, tier: 1, label: 'Premium' },
  ollama:     { quality: 0.40, tier: 3, label: 'Local' },
};

// ============ Provider Cost Map ($/MTok, blended input+output avg) ============
// Used by compute-economics.js to auto-adjust JUL pricing oracle (Layer 1)
// When the active provider changes, the JUL-to-token ratio auto-adjusts so
// 1 JUL always buys the same DOLLAR VALUE of compute regardless of provider.
const PROVIDER_COST_PER_MTOK = {
  claude:     9.00,   // $3 input + $15 output, blended ~$9/MTok
  deepseek:   0.69,   // $0.27 input + $1.10 output, blended
  openai:     8.75,   // $2.50 input + $15 output, blended (GPT-5.4)
  gemini:     0.375,  // $0.15 input + $0.60 output, blended
  cerebras:   0.001,  // Free tier
  groq:       0.001,  // Free tier
  openrouter: 0.001,  // Free tier
  mistral:    0.001,  // Free tier
  together:   0.001,  // Free tier (credits)
  sambanova:  0.001,  // Free tier
  fireworks:  0.001,  // Free tier
  novita:     0.001,  // Free tier
  xai:        5.00,   // $2 input + $8 output, blended (Grok-3)
  ollama:     0.001,  // Local (electricity only)
};

/**
 * Get the active provider's cost per MTok.
 * Used by the JUL pricing oracle to auto-adjust the token ratio.
 */
export function getProviderCostPerMTok() {
  const name = activeProvider?.name || 'none';
  return PROVIDER_COST_PER_MTOK[name] || 3.00; // default to reference
}

// Track when we dropped from Tier 1 to Tier 2
let degradedSince = null;
let degradationNotified = false;

/**
 * Get current intelligence quality as a percentage.
 * 100% = Claude (best). Drops as we cascade to cheaper providers.
 */
export function getIntelligenceLevel() {
  const name = activeProvider?.name || 'none';
  const info = PROVIDER_QUALITY[name] || { quality: 0.50, tier: 2, label: 'Unknown' };
  return {
    provider: name,
    model: activeProvider?.model || 'unknown',
    quality: Math.round(info.quality * 100),
    tier: info.tier,
    tierLabel: info.tierLabel || info.label,
    degraded: info.tier > 1,
    degradedSince,
    primary: primaryProviderName,
    fallbacksRemaining: fallbackProviders.length,
  };
}

/**
 * Check if intelligence just degraded (for one-time notification).
 * Returns degradation info or null if no change.
 */
export function checkDegradation() {
  const name = activeProvider?.name || 'none';
  const info = PROVIDER_QUALITY[name] || { tier: 2 };

  if (info.tier > 1 && !degradedSince) {
    degradedSince = Date.now();
    degradationNotified = false;
  }

  if (info.tier <= 1 && degradedSince) {
    // Recovered to premium
    degradedSince = null;
    degradationNotified = false;
    return { recovered: true, provider: name };
  }

  if (degradedSince && !degradationNotified) {
    degradationNotified = true;
    return {
      degraded: true,
      provider: name,
      quality: Math.round((info.quality || 0.5) * 100),
      since: degradedSince,
    };
  }

  return null;
}

/**
 * Attempt to restore the primary (premium) provider.
 * Called when tip jar receives funds — try to reactivate Claude.
 */
export function tryRestorePrimary() {
  if (activeProvider?.name === primaryProviderName) {
    return { restored: false, reason: 'already on primary' };
  }

  const primaryConfig = getProviderConfig(primaryProviderName);
  if (!primaryConfig.apiKey) {
    return { restored: false, reason: 'no API key for primary' };
  }

  try {
    const factory = providers.get(primaryProviderName);
    if (!factory) return { restored: false, reason: 'unknown provider' };

    const primary = factory(primaryConfig);
    // Prepend current active + remaining fallbacks behind the restored primary
    fallbackProviders.unshift(activeProvider, ...fallbackProviders);
    activeProvider = primary;
    degradedSince = null;
    degradationNotified = false;

    console.log(`[wardenclyffe] Primary provider restored: ${primaryProviderName} — tip jar refilled credits`);
    return { restored: true, provider: primaryProviderName, model: primary.model };
  } catch (err) {
    return { restored: false, reason: err.message };
  }
}

// ============ Credit/Billing Error Detection ============

function isCreditError(error) {
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || error?.response?.status;
  return msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('rate_limit') && msg.includes('billing') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('payment required') ||
    msg.includes('daily limit') ||
    msg.includes('daily token limit') ||
    msg.includes('requests per day') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('rate limit reached') ||
    msg.includes('tokens per minute') ||
    msg.includes('requests per minute') ||
    status === 402 ||
    (status === 429 && (msg.includes('limit') || msg.includes('quota'))) ||
    (msg.includes('400') && msg.includes('credit'));
}

// ============ Transient/Glitch Error Detection (Retryable) ============

function isTransientOrGlitch(error) {
  if (error instanceof TruncatedResponseError) return true;
  if (error instanceof EmptyResponseError) return true;
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || error?.response?.status;
  return msg.includes('model not exist') ||   // DeepSeek transient glitch
    msg.includes('temporarily unavailable') ||
    msg.includes('service unavailable') ||
    msg.includes('internal server error') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('truncated') ||              // Truncated JSON response
    msg.includes('unterminated string') ||    // Specific JSON parse error
    status === 500 || status === 502 || status === 503 || status === 504;
}

// ============ Fallback: Activate Next Provider ============

function activateFallback() {
  if (fallbackProviders.length === 0) return false;
  const previous = activeProvider?.name;
  const next = fallbackProviders.shift();
  const info = PROVIDER_QUALITY[next.name] || { tier: 2, quality: 0.5 };
  console.warn(`[wardenclyffe] ${previous} credits exhausted — cascading to ${next.name} (${next.model}) [Tier ${info.tier}, ${Math.round(info.quality * 100)}% quality]`);
  activeProvider = next;

  // Track degradation onset
  if (info.tier > 1 && !degradedSince) {
    degradedSince = Date.now();
    degradationNotified = false;
    console.warn(`[wardenclyffe] Intelligence degraded to free tier — tip jar contributions will restore premium quality`);
  }

  return true;
}

// ============ Init from Config ============

function getProviderConfig(providerName) {
  return {
    model: (() => {
      switch (providerName) {
        case 'claude': return config.llm?.model || config.anthropic?.model;
        case 'openai': return 'gpt-5.4';
        case 'gemini': return 'gemini-2.5-flash';
        case 'deepseek': return 'deepseek-chat';
        case 'ollama': return config.llm?.model || 'llama3.1';
        case 'cerebras': return 'llama-3.3-70b';
        case 'groq': return 'llama-3.3-70b-versatile';
        case 'openrouter': return 'qwen/qwen3.6-plus:free';
        case 'mistral': return 'mistral-small-latest';
        case 'together': return 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
        case 'sambanova': return 'Meta-Llama-3.3-70B-Instruct';
        case 'fireworks': return 'accounts/fireworks/models/llama-v3p3-70b-instruct';
        case 'novita': return 'meta-llama/llama-3.3-70b-instruct';
        case 'xai': return 'grok-3';
        default: return config.llm?.model;
      }
    })(),
    apiKey: (() => {
      switch (providerName) {
        case 'claude': return config.anthropic?.apiKey;
        case 'openai': return config.llm?.openaiApiKey || process.env.OPENAI_API_KEY;
        case 'gemini': return config.llm?.geminiApiKey || process.env.GEMINI_API_KEY;
        case 'deepseek': return config.llm?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
        case 'ollama': return null;
        case 'cerebras': return config.llm?.cerebrasApiKey || process.env.CEREBRAS_API_KEY;
        case 'groq': return config.llm?.groqApiKey || process.env.GROQ_API_KEY;
        case 'openrouter': return config.llm?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
        case 'mistral': return config.llm?.mistralApiKey || process.env.MISTRAL_API_KEY;
        case 'together': return config.llm?.togetherApiKey || process.env.TOGETHER_API_KEY;
        case 'sambanova': return config.llm?.sambanovaApiKey || process.env.SAMBANOVA_API_KEY;
        case 'fireworks': return config.llm?.fireworksApiKey || process.env.FIREWORKS_API_KEY;
        case 'novita': return config.llm?.novitaApiKey || process.env.NOVITA_API_KEY;
        case 'xai': return config.llm?.xaiApiKey || process.env.XAI_API_KEY;
        default: return config.anthropic?.apiKey;
      }
    })(),
    baseUrl: (() => {
      switch (providerName) {
        case 'deepseek': return 'https://api.deepseek.com/v1';
        case 'ollama': return config.llm?.ollamaUrl || 'http://localhost:11434';
        case 'cerebras': return 'https://api.cerebras.ai/v1';
        case 'groq': return 'https://api.groq.com/openai/v1';
        case 'openrouter': return 'https://openrouter.ai/api/v1';
        case 'mistral': return 'https://api.mistral.ai/v1';
        case 'together': return 'https://api.together.xyz/v1';
        case 'sambanova': return 'https://api.sambanova.ai/v1';
        case 'fireworks': return 'https://api.fireworks.ai/inference/v1';
        case 'novita': return 'https://api.novita.ai/v3/openai';
        case 'xai': return 'https://api.x.ai/v1';
        default: return config.llm?.baseUrl || process.env.LLM_BASE_URL || undefined;
      }
    })(),
  };
}

// ============ Wardenclyffe v3 — Hybrid Escalation Router ============
// "The models should be cooperative not competitive and zero sum" — Will
//
// ARCHITECTURE: Start cheap, level up on demand.
//
// Old model (Cascade Down): Claude → DeepSeek → free tier
//   Problem: 80% of messages are simple, burns premium tokens on "hey jarvis"
//
// New model (Hybrid Escalation): Triage → Route to cheapest adequate tier → Escalate on quality failure
//   Benefit: Cost scales with actual complexity. Simple = $0. Premium reserved for premium tasks.
//
// Tier 0 — Free ($0):     OpenRouter/Qwen (0.80), Groq, Cerebras, SambaNova, Together, Fireworks, Novita, Mistral
//   For: greetings, short Q&A, status checks, simple factual, coding, math (Qwen leads)
// Tier 1 — Budget (~$0.50/MTok): DeepSeek, Gemini, Mistral, Ollama
//   For: conversation, coding, math, moderate reasoning, multimodal (Gemini)
// Tier 2 — Premium (~$8/MTok):   Claude, OpenAI, xAI
//   For: complex reasoning, tool use, philosophy, mechanism design, long-form analysis
//
// Escalation: If quality gate detects weak response → auto-promote to next tier.
// User sees slightly slower response, never an error. Seamless quality guarantee.
//
// Each complexity/skill class maps to a starting tier + escalation chain:
//   simple    → Tier 0 → Tier 1 → Tier 2
//   moderate  → Tier 0 → Tier 1 → Tier 2  (KEY: was Tier 1, now starts FREE)
//   coding    → Tier 1 → Tier 2            (DeepSeek can handle 80% of coding)
//   math      → Tier 1 → Tier 2            (DeepSeek leads, cheap)
//   reasoning → Tier 2                     (irreducible — needs Claude)
//   tooluse   → Tier 2                     (irreducible — needs native tool support)
//   multimodal→ Tier 1 → Tier 2            (Gemini cheap + vision-capable)
//   complex   → Tier 2                     (frontier models only)
//
// Economics: ~70% of messages handled at $0, ~20% at $0.50/MTok, ~10% at $8/MTok
// vs old model: 100% starting at $8/MTok and cascading down on failure

// Bare greetings — truly zero-effort, route to free tier
const SIMPLE_PATTERNS = /^(hey|hi|hello|yo|sup|gm|gn|gg|lol|lmao|ok|okay|sure|thanks|ty|thx|bet|word|facts|based|fr|w |l |nice|cool|dope|sick|fire|mid|nah|yep|yea|yeah|yes|no|nope|good (morning|night|evening))\b/i;

// Warm greetings — social energy, deserve personality even from standard JARVIS
const WARM_GREETING_PATTERNS = /^(gm fam|gm frens?|yo what'?s? ?(up|good|poppin)|wagmi|ngmi|send it|what'?s? your name|who are you|how are you|wen )/i;

// Skill detection patterns
const CODING_SIGNALS = /```|write ?(a |the |some |this )?code|write ?(a |the )?function|write ?(a |the )?script|implement|refactor|debug|fix ?(the |this |a )?bug|compile|syntax|snippet|regex|algorithm|API |endpoint|class |interface |struct |enum |const |let |var |import |require|\.sol\b|\.js\b|\.py\b|\.rs\b|\.ts\b|solidity|javascript|typescript|python|rust |golang|react|nextjs|html|css|sql|git |docker|deploy|build ?(a |the |this )?app|build ?(a |the |this )?contract/i;

const REASONING_SIGNALS = /explain ?(why|how|the|what)|philosophy|ethics|moral|mechanism ?design|game ?theory|incentive|governance|trade-?off|nuance|compare ?(and|the)|pros ?(and|vs)|argue|debate|perspective|implications|consequences|should (we|i|the)|what if|thought experiment|first principles/i;

const MATH_SIGNALS = /calculate|compute|equation|formula|integral|derivative|matrix|statistics|probability|regression|optimize|converge|proof |theorem|lemma|mathematical|arithmetic|algebra|calculus|geometric|logarithm|exponential|sqrt|summation|∑|∫|∂|σ|μ|π|tokenomics|bonding curve|pricing model|yield/i;

const COMPLEX_SIGNALS = /contract |function |error |bug |debug|implement|refactor|analyze|compare|explain .{80,}|write a |build |create a |design |architect|security|audit|vulnerabil|exploit|smart contract|solidity|rust |python |javascript/i;

function classifyComplexity(request) {
  // If tools are requested, always use Claude (native tool use)
  if (request.tools?.length > 0) return 'tooluse';

  // If caller explicitly set a model, check if any available provider can serve it.
  // Background tasks often request 'claude-haiku-4-5-20251001' but when Claude credits
  // are exhausted, this model can't be served by anyone. Instead of failing the entire
  // chain, treat unserviceable explicit models as 'simple' (background tasks are low-priority).
  if (request.model) {
    // Check if any pool provider can serve this model
    const modelName = request.model.toLowerCase();
    const providerOwnsModel = (name) => {
      const p = providerPool.get(name);
      return p && p.model && modelName.includes(name);
    };
    // Claude models → needs claude provider. OpenAI models → needs openai. etc.
    const isClaudeModel = modelName.startsWith('claude');
    const isOpenAIModel = modelName.startsWith('gpt');
    const isGeminiModel = modelName.startsWith('gemini');

    if (isClaudeModel && !getCircuitBreaker('claude').allowRequest()) {
      // Claude is down/exhausted — don't force explicit, let router handle it
      request._strippedModel = request.model; // Remember for logging
      delete request.model;
      return request._background ? 'simple' : 'moderate';
    }
    if (isOpenAIModel && !getCircuitBreaker('openai').allowRequest()) {
      request._strippedModel = request.model;
      delete request.model;
      return request._background ? 'simple' : 'moderate';
    }
    if (isGeminiModel && !getCircuitBreaker('gemini').allowRequest()) {
      request._strippedModel = request.model;
      delete request.model;
      return request._background ? 'simple' : 'moderate';
    }
    return 'explicit';
  }

  // Analyze the last user message
  const lastMsg = [...(request.messages || [])].reverse().find(m => m.role === 'user');
  if (!lastMsg) return 'moderate';

  const text = typeof lastMsg.content === 'string'
    ? lastMsg.content
    : Array.isArray(lastMsg.content)
      ? lastMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
      : '';

  const len = text.length;

  // Warm greetings — social energy, route to moderate for personality
  if (len < 80 && WARM_GREETING_PATTERNS.test(text)) {
    return 'moderate';
  }

  // Short + matches simple patterns → free tier (unless persona wants personality)
  if (len < 80 && SIMPLE_PATTERNS.test(text)) {
    try {
      if (_getPersonaId?.() === 'degen') return 'moderate';
    } catch {}
    return 'simple';
  }

  // Very short messages without complex signals → simple
  if (len < 30 && !COMPLEX_SIGNALS.test(text)) return 'simple';

  // Has images/documents → Gemini (multimodal specialist)
  if (Array.isArray(lastMsg.content) && lastMsg.content.some(b => b.type === 'image' || b.type === 'document')) {
    return 'multimodal';
  }

  // ============ Skill-Based Routing (Cooperative Intelligence) ============
  // Check skill patterns BEFORE falling back to complexity-only routing.
  // A coding question is a coding question regardless of length.

  const isCoding = CODING_SIGNALS.test(text);
  const isReasoning = REASONING_SIGNALS.test(text);
  const isMath = MATH_SIGNALS.test(text);

  // If multiple skills match, pick the dominant one
  if (isCoding && !isReasoning) return 'coding';
  if (isMath && !isCoding) return 'math';
  if (isReasoning && !isCoding) return 'reasoning';

  // Coding + reasoning overlap (e.g. "explain this smart contract design") → Claude
  if (isCoding && isReasoning) return 'reasoning';

  // Coding + math overlap (e.g. "implement this formula") → GPT-5.4
  if (isCoding && isMath) return 'coding';

  // Legacy complexity-based fallbacks
  if (COMPLEX_SIGNALS.test(text)) return 'complex';
  if (len > 500) return 'complex';

  // Everything else → moderate
  return 'moderate';
}

// Provider pool — all initialized providers keyed by name
const providerPool = new Map();

// ============ Escalation Chains (cost-ascending) ============
// Each classification maps to an ordered chain: try cheapest first, escalate on quality failure.
// Within each tier, providers are ordered by skill fit (best specialist first).
const ESCALATION_CHAINS = {
  // Start FREE → Budget → Premium
  // All 8 Tier 0 providers in chains. Ordered by quality within tier.
  // openrouter = Qwen 3.6 Plus (0.80), groq/cerebras/sambanova/together (0.60),
  // fireworks (0.58), novita (0.55), mistral (0.50)
  simple:     ['openrouter', 'groq', 'cerebras', 'sambanova', 'together', 'fireworks', 'novita', 'mistral', 'deepseek', 'gemini', 'ollama'],
  moderate:   ['openrouter', 'groq', 'cerebras', 'sambanova', 'together', 'novita', 'deepseek', 'gemini', 'xai', 'claude'],

  // Start FREE (Qwen 0.80 quality) → Budget → Premium
  // Wardenclyffe v3.1: Qwen leads coding/math — 32/40 on DeFi mechanism design, $0.
  coding:     ['openrouter', 'deepseek', 'gemini', 'openai', 'xai', 'claude'],
  math:       ['openrouter', 'deepseek', 'gemini', 'openai', 'xai', 'claude'],
  multimodal: ['gemini', 'xai', 'claude', 'openai'],                    // Gemini cheap + vision (text-only models can't help here)

  // Start PREMIUM (irreducible complexity — these NEED frontier models)
  // Qwen as fallback between premium and budget — 0.80 quality may satisfy before hitting paid tiers
  reasoning:  ['claude', 'xai', 'openai', 'openrouter', 'deepseek', 'gemini'],
  tooluse:    ['claude', 'openai', 'xai', 'deepseek'],                  // Tool use needs native tool support, Qwen via OpenRouter won't help
  complex:    ['claude', 'xai', 'openai', 'openrouter', 'deepseek', 'gemini'],

  explicit:   [], // Caller specified model — use activeProvider
};

// Tier boundaries for logging
const PROVIDER_TIER = {
  groq: 0, cerebras: 0, sambanova: 0, fireworks: 0, novita: 0, openrouter: 0, mistral: 0, together: 0,
  deepseek: 1, gemini: 1, ollama: -1, // Tier -1: local inference, zero cost
  claude: 2, openai: 2, xai: 2,
};

function getProviderForComplexity(complexity) {
  // Tier -1: If Ollama is available and configured, try it first for ALL complexity levels.
  // Local inference = zero cost, zero rate limit, zero dependency.
  // The escape hatch from every API toll booth.
  if (process.env.OLLAMA_URL && providerPool.has('ollama')) {
    return providerPool.get('ollama');
  }

  // Return first available provider from the escalation chain
  const chain = ESCALATION_CHAINS[complexity] || ESCALATION_CHAINS.moderate;
  for (const name of chain) {
    const provider = providerPool.get(name);
    if (provider) return provider;
  }
  return activeProvider;
}

/**
 * Get the full escalation chain for a complexity class.
 * Returns array of available providers in cost-ascending order.
 * Used by llmChat for auto-escalation on quality failure.
 */
function getEscalationChain(complexity) {
  const chain = ESCALATION_CHAINS[complexity] || ESCALATION_CHAINS.moderate;
  return chain
    .map(name => providerPool.get(name))
    .filter(Boolean);
}

// ============ Escalation Metrics ============
// Track how often we escalate, and how much money we save.
const escalationMetrics = {
  totalRequests: 0,
  tier0Handled: 0, // Handled by free tier (no escalation)
  tier1Handled: 0, // Handled by budget tier
  tier2Handled: 0, // Required premium tier
  escalations: 0,  // Total escalation events
  estimatedSavings: 0, // Dollars saved vs always-premium (rough estimate)
};

function recordEscalationMetric(providerName, escalated) {
  escalationMetrics.totalRequests++;
  const tier = PROVIDER_TIER[providerName] ?? 1;
  if (tier === 0) escalationMetrics.tier0Handled++;
  else if (tier === 1) escalationMetrics.tier1Handled++;
  else escalationMetrics.tier2Handled++;
  if (escalated) escalationMetrics.escalations++;

  // Rough savings estimate: premium costs ~$9/MTok, free costs ~$0
  // Average message ~2K tokens. If handled at tier 0 instead of tier 2, save ~$0.018/msg
  if (tier === 0) escalationMetrics.estimatedSavings += 0.018;
  else if (tier === 1) escalationMetrics.estimatedSavings += 0.012;
}

export function getEscalationMetrics() {
  const total = escalationMetrics.totalRequests || 1;
  return {
    ...escalationMetrics,
    tier0Pct: (escalationMetrics.tier0Handled / total * 100).toFixed(1) + '%',
    tier1Pct: (escalationMetrics.tier1Handled / total * 100).toFixed(1) + '%',
    tier2Pct: (escalationMetrics.tier2Handled / total * 100).toFixed(1) + '%',
    escalationRate: (escalationMetrics.escalations / total * 100).toFixed(1) + '%',
    savingsUSD: '$' + escalationMetrics.estimatedSavings.toFixed(3),
  };
}

// Export for testing/debugging
export function getRouterStats() {
  return {
    poolSize: providerPool.size,
    providers: [...providerPool.keys()],
    classify: (text) => classifyComplexity({ messages: [{ role: 'user', content: text }] }),
  };
}

export function initProvider() {
  const providerName = config.llm?.provider || 'claude';
  primaryProviderName = providerName;

  // Init primary
  const providerConfig = getProviderConfig(providerName);
  createProvider(providerName, providerConfig);
  providerPool.set(providerName, activeProvider);

  // Init ALL available providers into the pool + fallback chain
  // Cascade: quality-first, Ollama as floor (never runs out of credits)
  // "When people top off credits, the network Nash-equilibriums at positive-sum" — Will
  const fallbackOrder = ['claude', 'deepseek', 'openai', 'xai', 'gemini', 'ollama', 'cerebras', 'groq', 'openrouter', 'mistral', 'together', 'sambanova', 'fireworks', 'novita'];
  fallbackProviders = [];

  for (const name of fallbackOrder) {
    if (name === providerName) continue; // Skip primary
    const fbConfig = getProviderConfig(name);
    if (name === 'ollama' || (fbConfig.apiKey && fbConfig.apiKey.length > 10)) {
      try {
        const factory = providers.get(name);
        if (factory) {
          const fb = factory(fbConfig);
          fallbackProviders.push(fb);
          providerPool.set(name, fb); // Also add to router pool
          console.log(`[llm] Provider registered: ${name} (${fb.model})`);
        }
      } catch (err) { console.warn(`[llm] Failed to init ${name}: ${err.message}`); }
    }
  }

  if (providerPool.size > 1) {
    console.log(`[wardenclyffe v3] Hybrid Escalation Router: ${providerPool.size} providers — start cheap, level up on demand`);
    const chainSummary = (name) => {
      const chain = ESCALATION_CHAINS[name] || [];
      return chain.filter(n => providerPool.has(n)).map(n => `${n}[T${PROVIDER_TIER[n] ?? '?'}]`).join(' → ') || 'fallback';
    };
    console.log(`[wardenclyffe v3]   simple    : ${chainSummary('simple')}`);
    console.log(`[wardenclyffe v3]   moderate  : ${chainSummary('moderate')}`);
    console.log(`[wardenclyffe v3]   coding    : ${chainSummary('coding')}`);
    console.log(`[wardenclyffe v3]   math      : ${chainSummary('math')}`);
    console.log(`[wardenclyffe v3]   reasoning : ${chainSummary('reasoning')}`);
    console.log(`[wardenclyffe v3]   multimodal: ${chainSummary('multimodal')}`);
    console.log(`[wardenclyffe v3]   tooluse   : ${chainSummary('tooluse')}`);
    console.log(`[wardenclyffe v3] Economics: simple/moderate start FREE → escalate on quality failure`);
    console.log(`[wardenclyffe v3] Legacy cascade: ${providerName} → ${fallbackProviders.map(p => p.name).join(' → ')}`);
  } else {
    console.warn('[wardenclyffe v3] No fallback providers configured. Set CEREBRAS_API_KEY, GROQ_API_KEY, etc. for infinite compute.');
  }

  return activeProvider;
}

// ============ Response Quality Gate ============
// Two-level quality check:
// 1. validateResponse — hard gate: reject empty/broken responses (throws → retry)
// 2. isAdequateResponse — soft gate: detect low-quality responses (returns false → escalate)

class EmptyResponseError extends Error {
  constructor(providerName) {
    super(`${providerName} returned empty response (no text, no tool calls)`);
    this.name = 'EmptyResponseError';
  }
}

function validateResponse(result, providerName) {
  if (!result || !result.content) {
    throw new EmptyResponseError(providerName);
  }

  // Check if content is actually empty
  const hasText = result.content.some(b => b.type === 'text' && b.text?.trim());
  const hasToolUse = result.content.some(b => b.type === 'tool_use');

  if (!hasText && !hasToolUse) {
    throw new EmptyResponseError(providerName);
  }

  return result;
}

/**
 * Soft quality gate — detect responses that are technically non-empty but inadequate.
 * Returns false if the response should trigger escalation to a higher tier.
 *
 * Heuristics (intentionally conservative — false negatives are better than false positives):
 * - Tool use responses are always adequate (the model is doing its job)
 * - Response too short relative to query complexity
 * - Response contains refusal/confusion patterns from weak models
 * - Response is just echoing the question back
 */
function isAdequateResponse(result, complexity, queryText) {
  // Tool use = adequate (model is using tools correctly)
  if (result.content.some(b => b.type === 'tool_use')) return true;

  const text = result.content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join(' ')
    .trim();

  const len = text.length;

  // Simple queries — any non-empty response is fine
  if (complexity === 'simple') return len > 0;

  // Refusal/confusion patterns from weak models
  const WEAK_PATTERNS = /^(i('m| am) (not sure|unable|sorry)|i (don'?t|can'?t) (help|assist|answer)|as an ai|i (don'?t|do not) have (access|the ability)|i('m| am) (just )?a (language model|text|chat))/i;
  if (WEAK_PATTERNS.test(text)) return false;

  // Response too short for complexity class
  const minLengths = {
    moderate: 20,
    coding: 40,
    math: 30,
    reasoning: 60,
    complex: 60,
    multimodal: 20,
    tooluse: 10,
  };
  const minLen = minLengths[complexity] || 20;
  if (len < minLen) return false;

  // Echo detection — if response is >60% overlap with query, it's just parroting
  if (queryText && queryText.length > 30) {
    const queryWords = new Set(queryText.toLowerCase().split(/\s+/));
    const responseWords = text.toLowerCase().split(/\s+/);
    const overlap = responseWords.filter(w => queryWords.has(w)).length;
    if (responseWords.length > 0 && overlap / responseWords.length > 0.6) return false;
  }

  return true;
}

// ============ Per-Provider Adaptive Timeouts ============
// Fast providers (Groq, Cerebras) fail fast. Slow providers (Ollama) wait longer.
// Adapts based on EMA latency if enough samples exist.

const PROVIDER_BASE_TIMEOUT = {
  claude: 60000,      // 60s — can be slow on complex tool use
  openai: 45000,      // 45s
  xai: 45000,         // 45s — Grok
  deepseek: 45000,    // 45s
  gemini: 45000,      // 45s
  ollama: 120000,     // 120s — cold start can be very slow
  cerebras: 15000,    // 15s — ultra fast inference
  groq: 15000,        // 15s — ultra fast inference
  openrouter: 30000,  // 30s — variable depending on upstream
  mistral: 30000,     // 30s
  together: 30000,    // 30s
  sambanova: 20000,   // 20s — fast inference
  fireworks: 20000,   // 20s — fast inference
  novita: 30000,      // 30s
};

function getProviderTimeout(providerName) {
  const base = PROVIDER_BASE_TIMEOUT[providerName] || 30000;
  const perf = providerPerformance.get(providerName);
  if (perf && perf.samples >= 5) {
    // Adaptive: 4x EMA latency, clamped between base/4 and base
    return Math.max(base / 4, Math.min(base, perf.emaLatency * 4));
  }
  return base;
}

// ============ Retry helpers ============

function isTransientError(error) {
  if (error instanceof TruncatedResponseError) return true;
  if (error instanceof EmptyResponseError) return true;
  const status = error?.status || error?.statusCode || error?.response?.status;
  if ([429, 500, 502, 503, 529].includes(status)) return true;
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('econnreset')
      || msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('fetch failed')
      || msg.includes('truncated') || msg.includes('unterminated string')) {
    return true;
  }
  return false;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Convenience: Direct Chat (with escalation + fallback + retry) ============
//
// Flow:
// 1. Classify complexity → get escalation chain (cost-ascending)
// 2. Try cheapest adequate provider first
// 3. Hard gate (empty/broken) → retry same provider or escalate
// 4. Soft gate (low quality) → auto-escalate to next tier
// 5. Credit exhaustion → cascade through remaining chain
// 6. All providers exhausted → throw

export async function llmChat(request) {
  if (!activeProvider) {
    throw new Error('LLM provider not initialized. Call initProvider() first.');
  }

  const MAX_RETRIES = 2;
  let lastError;
  const bg = request._background || false;
  const cascadeTrail = [];
  const originalRequest = request; // Keep original for Claude (tools intact)

  // ============ Classify & Build Escalation Chain ============
  const complexity = classifyComplexity(request);
  let escalationChain;

  if (complexity === 'explicit' || providerPool.size <= 1) {
    escalationChain = [activeProvider];
  } else {
    escalationChain = getEscalationChain(complexity);
    if (escalationChain.length === 0) escalationChain = [activeProvider];
  }

  // Extract query text for adequacy checks
  const lastUserMsg = [...(request.messages || [])].reverse().find(m => m.role === 'user');
  const queryText = !lastUserMsg ? '' :
    typeof lastUserMsg.content === 'string' ? lastUserMsg.content :
    Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '';

  // ============ Walk the Escalation Chain ============
  let escalated = false;

  for (let chainIdx = 0; chainIdx < escalationChain.length; chainIdx++) {
    let currentProvider = escalationChain[chainIdx];
    const providerTier = PROVIDER_TIER[currentProvider.name] ?? 1;

    // Circuit breaker — skip providers with open circuits
    const cb = getCircuitBreaker(currentProvider.name, bg);
    if (!cb.allowRequest()) {
      cascadeTrail.push({
        provider: currentProvider.name,
        status: 'circuit_open',
        tier: providerTier,
      });
      continue; // Skip to next in chain
    }

    // Prepare request for this provider
    let providerRequest = originalRequest;

    // Non-Claude: flatten tool exchanges, strip tools AND model name
    // The original request carries model: 'claude-sonnet-4-5-...' which other providers reject.
    // Each provider's .chat() uses `request.model || this.model` — stripping model lets the
    // provider use its own default model.
    if (currentProvider.name !== 'claude' && providerRequest.messages) {
      providerRequest = { ...providerRequest, messages: flattenToolExchanges(providerRequest.messages) };
      const { tools, model, ...cleaned } = providerRequest;
      providerRequest = cleaned;
    }

    // Non-vision: strip image blocks
    if (!VISION_PROVIDERS.has(currentProvider.name) && providerRequest.messages) {
      providerRequest = { ...providerRequest, messages: stripMediaBlocks(providerRequest.messages) };
    }

    if (chainIdx > 0) {
      escalated = true;
      console.log(`[escalation] ${complexity} → escalating from tier ${PROVIDER_TIER[escalationChain[chainIdx - 1]?.name] ?? '?'} to tier ${providerTier} (${currentProvider.name})`);
    } else if (escalationChain.length > 1) {
      console.log(`[router] ${complexity} → ${currentProvider.name} [tier ${providerTier}] (${escalationChain.length - 1} escalation tiers available)`);
    }

    // ============ Try Current Provider (with retries + queue) ============
    const queue = getProviderQueue(currentProvider.name);
    let queueAcquired = false;

    try {
      await queue.acquire();
      queueAcquired = true;
    } catch (queueErr) {
      // Queue timeout — provider is overwhelmed, skip to next
      cascadeTrail.push({
        provider: currentProvider.name,
        status: 'queue_timeout',
        tier: providerTier,
        error: queueErr.message,
      });
      console.warn(`[queue] ${currentProvider.name}: queue full, skipping to next provider`);
      continue;
    }

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const attemptStart = Date.now();
        try {
          const result = await currentProvider.chat(providerRequest);

          // Hard gate — reject empty/broken
          validateResponse(result, currentProvider.name);

          // Record success
          getCircuitBreaker(currentProvider.name, bg).recordSuccess();
          recordProviderPerformance(currentProvider.name, Date.now() - attemptStart, true);

          // Soft gate — check adequacy for potential escalation
          // Only escalate if: (1) there's a higher tier available, (2) response is inadequate
          // (3) we're not already at the top of the chain
          if (chainIdx < escalationChain.length - 1 && !isAdequateResponse(result, complexity, queryText)) {
            const nextProvider = escalationChain[chainIdx + 1];
            const nextTier = PROVIDER_TIER[nextProvider?.name] ?? 1;
            // Only escalate to a HIGHER tier, not lateral moves within same tier
            if (nextTier > providerTier) {
              console.log(`[escalation] ${currentProvider.name} response inadequate for ${complexity} — escalating to ${nextProvider.name} [tier ${nextTier}]`);
              cascadeTrail.push({
                provider: currentProvider.name,
                model: currentProvider.model,
                status: 'escalated_quality',
                tier: providerTier,
                latencyMs: Date.now() - attemptStart,
              });
              break; // Break retry loop, continue chain loop
            }
          }

          // ============ Success — attach metadata and return ============
          cascadeTrail.push({
            provider: currentProvider.name,
            model: currentProvider.model,
            status: 'success',
            tier: providerTier,
            latencyMs: Date.now() - attemptStart,
            complexity,
            escalated,
          });

          recordEscalationMetric(currentProvider.name, escalated);
          reorderFallbacksByPerformance();

          result._provider = currentProvider.name;
          result._model = currentProvider.model;
          result._cascadeTrail = cascadeTrail;
          result._intelligenceLevel = getIntelligenceLevel();
          result._complexity = complexity;
          result._tier = providerTier;
          result._escalated = escalated;
          const contentStr = JSON.stringify(result.content);
          result._responseHash = createHash('sha256')
            .update(contentStr + currentProvider.name + currentProvider.model + Date.now())
            .digest('hex');
          return result;

        } catch (error) {
          lastError = error;
          const latencyMs = Date.now() - attemptStart;

          getCircuitBreaker(currentProvider.name, bg).recordFailure(error);
          recordProviderPerformance(currentProvider.name, latencyMs, false);

          cascadeTrail.push({
            provider: currentProvider.name,
            model: currentProvider.model,
            status: isCreditError(error) ? 'credit_error' : isTransientError(error) ? 'transient_error' : 'error',
            tier: providerTier,
            latencyMs,
            error: error.message?.slice(0, 120),
          });

          // Credit/permanent error → skip to next provider in chain (escalate)
          if (isCreditError(error) || (!isTransientError(error) && !isTransientOrGlitch(error))) {
            console.warn(`[escalation] ${currentProvider.name} failed (${isCreditError(error) ? 'credits' : 'permanent'}): ${error.message?.slice(0, 80)}`);
            break; // Break retry loop, continue chain loop
          }

          // 529/overloaded OR 429/rate-limit → DON'T retry same provider, instant escalate
          // The circuit breaker already tripped — skip remaining retries, try next provider.
          // Retrying a rate-limited provider wastes 30-60s when a fallback can answer instantly.
          const errStatus = error?.status || error?.statusCode || error?.response?.status;
          const errMsg = (error?.message || '').toLowerCase();
          if (errStatus === 529 || errMsg.includes('overloaded')) {
            console.warn(`[escalation] ${currentProvider.name} overloaded (529) — instant escalate, no retry`);
            break; // Skip remaining retries, move to next provider
          }
          if (errStatus === 429 || errMsg.includes('rate limit')) {
            console.warn(`[escalation] ${currentProvider.name} rate limited (429) — instant escalate, no retry`);
            break; // Skip remaining retries, move to next provider
          }

          // Transient error — retry with backoff
          if (attempt < MAX_RETRIES) {
            // 429 rate limit → longer backoff (10-30s) vs generic transient (1-4s)
            let baseDelay, jitterRange;
            if (errStatus === 429 || errMsg.includes('rate limit')) {
              baseDelay = Math.min(10000 * Math.pow(2, attempt), 30000); // 10s, 20s, 30s
              jitterRange = 5000;
            } else {
              baseDelay = Math.min(1000 * Math.pow(2, attempt), 4000);  // 1s, 2s, 4s
              jitterRange = 500;
            }
            const jitter = Math.random() * jitterRange;
            console.warn(`[llm] Transient error on ${currentProvider.name} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retry in ${Math.round(baseDelay + jitter)}ms`);
            await sleep(baseDelay + jitter);
            continue;
          }

          // Exhausted retries on this provider → escalate
          console.warn(`[escalation] ${currentProvider.name} exhausted retries — escalating`);
          break;
        }
      }
    } finally {
      // ALWAYS release queue slot, even on escalation
      if (queueAcquired) queue.release();
    }
  }

  // ============ Escalation Chain Exhausted — Last Resort Legacy Cascade ============
  // If the smart escalation chain is exhausted, fall through to the flat fallback list.
  // This handles edge cases where a provider isn't in any escalation chain but has credits.
  const triedProviders = new Set(cascadeTrail.map(t => t.provider));

  for (const fb of fallbackProviders) {
    if (triedProviders.has(fb.name)) continue; // Already tried

    const fbCB = getCircuitBreaker(fb.name, bg);
    if (!fbCB.allowRequest()) continue;

    console.warn(`[wardenclyffe] Last resort fallback: ${fb.name}`);

    let fbRequest = originalRequest;
    if (fb.name !== 'claude' && fbRequest.messages) {
      fbRequest = { ...fbRequest, messages: flattenToolExchanges(fbRequest.messages) };
      const { tools, model, ...cleaned } = fbRequest;
      fbRequest = cleaned;
    }
    if (!VISION_PROVIDERS.has(fb.name) && fbRequest.messages) {
      fbRequest = { ...fbRequest, messages: stripMediaBlocks(fbRequest.messages) };
    }

    const fbStart = Date.now();
    try {
      const result = await fb.chat(fbRequest);
      validateResponse(result, fb.name);
      getCircuitBreaker(fb.name, bg).recordSuccess();
      recordProviderPerformance(fb.name, Date.now() - fbStart, true);
      recordEscalationMetric(fb.name, true);

      cascadeTrail.push({ provider: fb.name, model: fb.model, status: 'success', latencyMs: Date.now() - fbStart });
      result._provider = fb.name;
      result._model = fb.model;
      result._cascadeTrail = cascadeTrail;
      result._intelligenceLevel = getIntelligenceLevel();
      result._complexity = complexity;
      result._escalated = true;
      const contentStr = JSON.stringify(result.content);
      result._responseHash = createHash('sha256')
        .update(contentStr + fb.name + fb.model + Date.now())
        .digest('hex');
      return result;
    } catch (fbErr) {
      lastError = fbErr;
      getCircuitBreaker(fb.name, bg).recordFailure(fbErr);
      recordProviderPerformance(fb.name, Date.now() - fbStart, false);
      cascadeTrail.push({ provider: fb.name, model: fb.model, status: 'fallback_error', error: fbErr.message?.slice(0, 120) });
      continue;
    }
  }

  throw lastError || new Error('All providers exhausted');
}
