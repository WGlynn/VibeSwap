// ============ WARDENCLYFFE — LLM Provider Cascade ============
//
// Tesla's Wardenclyffe Tower was designed to transmit energy without wires,
// without meters, without bills. The tower was demolished. The idea was not.
//
// Wardenclyffe is a 12-provider LLM cascade that harvests free inference
// from the ambient compute surplus of the modern API economy.
// When paid providers exhaust, free-tier providers sustain the signal.
//
// Tier 1 (paid):  Claude → DeepSeek → OpenAI (GPT-5.4) → xAI (Grok-3) → Gemini
// Tier 2 (free):  Cerebras → Groq → OpenRouter → Mistral → Together → SambaNova → Fireworks → Novita
//
// Availability: 1 - (1-a)^13 ≈ 1.0 (fifteen nines)
// Single-provider dependency: 100% → 7.7%
//
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

    const hasMedia = msg.content.some(b => b.type === 'image' || b.type === 'document');
    if (!hasMedia) return msg;

    const newContent = [];
    for (const block of msg.content) {
      if (block.type === 'image') {
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
    const stateIcon = stats.state === 'closed' ? 'OK' : stats.state === 'open' ? 'DOWN' : 'PROBE';
    const latStr = perf ? ` ~${Math.round(perf.emaLatency)}ms` : '';
    lines.push(`  ${stateIcon} ${name}: ${stats.windowErrorRate} error rate (${stats.windowRequests} req/min)${latStr}, ${stats.totalRequests} total`);
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
      client = new Anthropic({ apiKey: providerConfig.apiKey });
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
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          const toolResults = msg.content.filter(b => b.type === 'tool_result');
          if (toolResults.length > 0) {
            // Ollama doesn't support tool results natively — inject as user context
            const resultText = toolResults.map(tr =>
              `[Tool result for ${tr.tool_use_id}]: ${typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content)}`
            ).join('\n');
            result.push({ role: 'user', content: resultText });
          } else {
            // Strip media blocks — Ollama is text-only, extract text parts
            const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text);
            const mediaDescs = msg.content.filter(b => b.type === 'image' || b.type === 'document')
              .map(b => `[${b.type} attached]`);
            result.push({ role: 'user', content: [...mediaDescs, ...textParts].join('\n') || '' });
          }
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const toolCalls = msg.content.filter(b => b.type === 'tool_use');
          if (toolCalls.length > 0) {
            // Represent tool calls as structured text for models without native tool support
            const toolText = toolCalls.map(tc =>
              `[Using tool: ${tc.name}(${JSON.stringify(tc.input)})]`
            ).join('\n');
            result.push({ role: 'assistant', content: (text + '\n' + toolText).trim() });
          } else {
            result.push({ role: 'assistant', content: text });
          }
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
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

// ============ OpenRouter Provider (Free Tier — DeepSeek/Qwen free models) ============

function createOpenRouterProvider(providerConfig) {
  return createOpenAIProvider({
    ...providerConfig,
    providerName: 'openrouter',
    baseUrl: providerConfig.baseUrl || 'https://openrouter.ai/api/v1',
    model: providerConfig.model || 'deepseek/deepseek-r1:free',
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
        case 'openrouter': return 'deepseek/deepseek-r1:free';
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

// ============ Smart Router — Route by Skill (Cooperative Intelligence) ============
// "The models should be cooperative not competitive and zero sum" — Will
//
// Each model has strengths. Instead of a fallback chain where one model is
// "better" than another, we delegate to the RIGHT model for the RIGHT task.
// This is Cooperative Capitalism applied to the model layer:
//   - Claude: reasoning, philosophy, nuance, long-form analysis, tool use
//   - GPT-5.4: coding, structured output, instruction following, technical docs
//   - DeepSeek: math, data analysis, cost-efficient reasoning, Chinese/multilingual
//   - Gemini: multimodal (images/docs), large context, search-grounded answers
//   - Free tier: simple tasks that don't need frontier models
//
// Complexity levels (preserved):
//   simple   → free tier (Groq/Cerebras) — greetings, one-liners, short factual
//   moderate → mid tier (DeepSeek/Gemini) — conversation, explanations, summaries
//   complex  → premium (Claude) — reasoning, philosophy, long-form analysis
//
// Skill levels (NEW — cooperative delegation):
//   coding      → GPT-5.4 (best-in-class code generation)
//   reasoning   → Claude (nuance, ethics, philosophy, mechanism design)
//   math        → DeepSeek (cost-efficient analytical reasoning)
//   multimodal  → Gemini (images, documents, large context)
//   tooluse     → Claude (native tool use support)

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

  // If caller explicitly set a model, respect it
  if (request.model) return 'explicit';

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

function getProviderForComplexity(complexity) {
  // Cooperative routing — each model does what it's best at
  const routes = {
    // Skill-based (cooperative delegation)
    coding:     ['openai', 'xai', 'claude', 'deepseek', 'gemini'],     // GPT-5.4 leads coding, Grok strong
    reasoning:  ['claude', 'xai', 'openai', 'deepseek', 'gemini'],   // Claude leads reasoning, Grok 2nd
    math:       ['deepseek', 'openai', 'xai', 'claude', 'gemini'],   // DeepSeek leads math
    tooluse:    ['claude', 'openai', 'xai', 'deepseek'],              // Claude has native tool use
    multimodal: ['gemini', 'xai', 'claude', 'openai'],                // Gemini leads multimodal, Grok has vision

    // Complexity-based (legacy, still useful)
    simple:     ['groq', 'cerebras', 'sambanova', 'deepseek', 'gemini'],
    moderate:   ['deepseek', 'xai', 'gemini', 'groq', 'cerebras'],
    complex:    ['claude', 'xai', 'openai', 'deepseek', 'gemini'],   // Frontier models for complex

    explicit:   [], // Caller specified model — use activeProvider
  };

  const candidates = routes[complexity] || routes.moderate;
  for (const name of candidates) {
    const provider = providerPool.get(name);
    if (provider) return provider;
  }

  // Fallback to active provider if no candidates available
  return activeProvider;
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
    if (name === 'ollama' || fbConfig.apiKey) {
      try {
        const factory = providers.get(name);
        if (factory) {
          const fb = factory(fbConfig);
          fallbackProviders.push(fb);
          providerPool.set(name, fb); // Also add to router pool
          console.log(`[llm] Provider registered: ${name} (${fb.model})`);
        }
      } catch { /* skip broken providers */ }
    }
  }

  if (providerPool.size > 1) {
    console.log(`[wardenclyffe] Cooperative router: ${providerPool.size} providers — routing by SKILL`);
    console.log(`[wardenclyffe]   coding    → ${['openai', 'claude', 'deepseek'].filter(n => providerPool.has(n))[0] || 'fallback'} (GPT-5.4)`);
    console.log(`[wardenclyffe]   reasoning → ${['claude', 'openai', 'deepseek'].filter(n => providerPool.has(n))[0] || 'fallback'} (Claude)`);
    console.log(`[wardenclyffe]   math      → ${['deepseek', 'openai', 'claude'].filter(n => providerPool.has(n))[0] || 'fallback'} (DeepSeek)`);
    console.log(`[wardenclyffe]   multimodal→ ${['gemini', 'claude', 'openai'].filter(n => providerPool.has(n))[0] || 'fallback'} (Gemini)`);
    console.log(`[wardenclyffe]   simple    → ${['groq', 'cerebras', 'sambanova'].filter(n => providerPool.has(n))[0] || 'fallback'} (free tier)`);
    console.log(`[wardenclyffe] Cascade fallback: ${providerName} → ${fallbackProviders.map(p => p.name).join(' → ')}`);
  } else {
    console.warn('[wardenclyffe] No fallback providers configured. Set CEREBRAS_API_KEY, GROQ_API_KEY, etc. for infinite compute.');
  }

  return activeProvider;
}

// ============ Response Quality Gate ============
// Validate that a provider's response actually has content.
// Empty responses from free-tier providers shouldn't count as success.

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

// ============ Convenience: Direct Chat (with auto-fallback + retry) ============

export async function llmChat(request) {
  if (!activeProvider) {
    throw new Error('LLM provider not initialized. Call initProvider() first.');
  }

  const MAX_RETRIES = 3;
  let lastError;
  const bg = request._background || false; // Isolated circuit breaker pool for background tasks

  const cascadeTrail = [];

  // ============ Smart Router ============
  // Route to the best provider based on query complexity.
  // Only routes if: (1) multiple providers available, (2) caller didn't specify a model
  const complexity = classifyComplexity(request);
  let routedProvider = activeProvider;

  if (complexity !== 'explicit' && providerPool.size > 1) {
    routedProvider = getProviderForComplexity(complexity);
    if (routedProvider !== activeProvider) {
      console.log(`[router] ${complexity} → ${routedProvider.name} (saved ${activeProvider.name} for complex)`);
    }
  }

  // Non-Claude providers can't handle tool_use/tool_result in conversation history.
  // Flatten them BEFORE sending — not just during cascade.
  if (routedProvider.name !== 'claude' && request.messages) {
    request = { ...request, messages: flattenToolExchanges(request.messages) };
  }

  // Strip image/document blocks for non-vision providers — they'll crash on base64 image data
  if (!VISION_PROVIDERS.has(routedProvider.name) && request.messages) {
    request = { ...request, messages: stripMediaBlocks(request.messages) };
  }

  // Circuit breaker check — skip providers that are currently open
  // Background tasks use isolated breaker pool so they can't poison user-facing requests
  const routedCB = getCircuitBreaker(routedProvider.name, bg);
  if (!routedCB.allowRequest() && routedProvider !== activeProvider) {
    console.log(`[circuit-breaker] ${routedProvider.name} circuit open — falling back to ${activeProvider.name}`);
    routedProvider = activeProvider;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const attemptStart = Date.now();
    try {
      const result = await routedProvider.chat(request);
      // Quality gate — reject empty responses from free-tier providers
      validateResponse(result, routedProvider.name);
      // Record success in circuit breaker + performance tracker
      getCircuitBreaker(routedProvider.name, bg).recordSuccess();
      recordProviderPerformance(routedProvider.name, Date.now() - attemptStart, true);
      // Cascade trail — record successful attempt
      cascadeTrail.push({
        provider: routedProvider.name,
        model: routedProvider.model,
        status: 'success',
        latencyMs: Date.now() - attemptStart,
        complexity,
      });
      // Attach provider metadata for usage tracking
      result._provider = routedProvider.name;
      result._model = routedProvider.model;
      // Wardenclyffe protocol metadata
      result._cascadeTrail = cascadeTrail;
      result._intelligenceLevel = getIntelligenceLevel();
      result._complexity = complexity;
      const contentStr = JSON.stringify(result.content);
      result._responseHash = createHash('sha256')
        .update(contentStr + routedProvider.name + routedProvider.model + Date.now())
        .digest('hex');
      return result;
    } catch (error) {
      lastError = error;

      // Record failure in circuit breaker + performance tracker
      getCircuitBreaker(routedProvider.name, bg).recordFailure(error);
      recordProviderPerformance(routedProvider.name, Date.now() - attemptStart, false);

      // Routed provider failed (non-transient) — fall back to primary before cascading
      if (routedProvider !== activeProvider && !isTransientError(error)) {
        cascadeTrail.push({
          provider: routedProvider.name,
          model: routedProvider.model,
          status: 'route_error',
          latencyMs: Date.now() - attemptStart,
          error: error.message?.slice(0, 120),
        });
        console.warn(`[router] ${routedProvider.name} failed for ${complexity} query — falling back to ${activeProvider.name}`);
        routedProvider = activeProvider; // Switch to primary
        // Re-send with original request (tools + model intact for Claude)
        if (routedProvider.name === 'claude') {
          // Undo flattening — Claude can handle tools
          request = { ...request };
        }
        continue; // Retry with primary
      }

      // Credit exhaustion on primary — cascade through fallback providers
      if (isCreditError(error) && activateFallback()) {
        cascadeTrail.push({
          provider: routedProvider.name,
          model: routedProvider.model,
          status: 'credit_error',
          latencyMs: Date.now() - attemptStart,
          error: error.message?.slice(0, 120),
        });

        // Flatten tool exchanges for non-Claude providers — they can't use Jarvis tools
        // and will reject Claude-format tool_use/tool_result in conversation history
        const { model, tools, ...rest } = request;
        if (rest.messages) {
          rest.messages = flattenToolExchanges(rest.messages);
          // Strip image blocks for non-vision fallback providers
          if (!VISION_PROVIDERS.has(activeProvider.name)) {
            rest.messages = stripMediaBlocks(rest.messages);
          }
        }

        // Try each fallback provider until one succeeds
        // Each provider gets up to 2 attempts (1 retry) for transient errors
        let fallbackError;
        do {
          console.warn(`[llm] Retrying with fallback provider: ${activeProvider.name} (${activeProvider.model})`);

          // Circuit breaker: skip fallback providers that are currently open
          const fbCB = getCircuitBreaker(activeProvider.name, bg);
          if (!fbCB.allowRequest()) {
            console.warn(`[circuit-breaker] Fallback ${activeProvider.name} circuit open — skipping`);
            break; // Skip to next fallback via activateFallback()
          }

          for (let fbAttempt = 0; fbAttempt < 2; fbAttempt++) {
            const fallbackStart = Date.now();
            try {
              const result = await activeProvider.chat(rest);
              getCircuitBreaker(activeProvider.name, bg).recordSuccess();
              recordProviderPerformance(activeProvider.name, Date.now() - fallbackStart, true);
              reorderFallbacksByPerformance(); // Learn from cascade events
              cascadeTrail.push({
                provider: activeProvider.name,
                model: activeProvider.model,
                status: 'success',
                latencyMs: Date.now() - fallbackStart,
              });
              result._provider = activeProvider.name;
              result._model = activeProvider.model;
              result._cascadeTrail = cascadeTrail;
              result._intelligenceLevel = getIntelligenceLevel();
              const contentStr = JSON.stringify(result.content);
              result._responseHash = createHash('sha256')
                .update(contentStr + activeProvider.name + activeProvider.model + Date.now())
                .digest('hex');
              return result;
            } catch (fbErr) {
              fallbackError = fbErr;
              getCircuitBreaker(activeProvider.name, bg).recordFailure(fbErr);
              recordProviderPerformance(activeProvider.name, Date.now() - fallbackStart, false);
              cascadeTrail.push({
                provider: activeProvider.name,
                model: activeProvider.model,
                status: fbAttempt === 0 ? 'fallback_error_retry' : 'fallback_error',
                latencyMs: Date.now() - fallbackStart,
                error: fbErr.message?.slice(0, 120),
              });
              // Retry once for transient errors (e.g. DeepSeek "Model Not Exist" glitches)
              if (fbAttempt === 0 && isTransientOrGlitch(fbErr)) {
                console.warn(`[wardenclyffe] Fallback ${activeProvider.name} transient error — retrying in 1s: ${fbErr.message?.slice(0, 80)}`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
              }
              console.warn(`[wardenclyffe] Fallback ${activeProvider.name} failed: ${fbErr.message?.slice(0, 100)}`);
              break;
            }
          }
        } while (activateFallback());

        // All fallbacks exhausted
        throw fallbackError || error;
      }

      // Transient errors — retry with exponential backoff + jitter
      if (isTransientError(error) && attempt < MAX_RETRIES) {
        cascadeTrail.push({
          provider: routedProvider.name,
          model: routedProvider.model,
          status: 'transient_error',
          latencyMs: Date.now() - attemptStart,
          error: error.message?.slice(0, 120),
        });
        const baseDelay = Math.min(1000 * Math.pow(2, attempt), 8000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;
        console.warn(`[llm] Transient error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${Math.round(delay)}ms: ${error.message?.slice(0, 80)}`);
        await sleep(delay);
        continue;
      }

      // Fatal error — record and throw
      cascadeTrail.push({
        provider: routedProvider.name,
        model: routedProvider.model,
        status: 'fatal_error',
        latencyMs: Date.now() - attemptStart,
        error: error.message?.slice(0, 120),
      });
      throw error;
    }
  }

  throw lastError; // Exhausted retries
}
