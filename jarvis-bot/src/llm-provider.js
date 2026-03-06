// ============ WARDENCLYFFE — LLM Provider Cascade ============
//
// Tesla's Wardenclyffe Tower was designed to transmit energy without wires,
// without meters, without bills. The tower was demolished. The idea was not.
//
// Wardenclyffe is a 12-provider LLM cascade that harvests free inference
// from the ambient compute surplus of the modern API economy.
// When paid providers exhaust, free-tier providers sustain the signal.
//
// Tier 1 (paid):  Claude → DeepSeek → Gemini → OpenAI
// Tier 2 (free):  Cerebras → Groq → OpenRouter → Mistral → Together → SambaNova → Fireworks → Novita
//
// Availability: 1 - (1-a)^12 ≈ 1.0 (fifteen nines)
// Single-provider dependency: 100% → 8.3%
//
// All providers return normalized Anthropic-format responses:
//   { content, stop_reason, usage, _provider, _model }
//
// CRPC across different model families = genuine cognitive diversity.
// ============

import { config } from './config.js';
import { randomUUID, createHash } from 'crypto';

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

function flattenToolExchanges(messages) {
  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;

    const hasToolUse = msg.content.some(b => b.type === 'tool_use');
    const hasToolResult = msg.content.some(b => b.type === 'tool_result');

    if (!hasToolUse && !hasToolResult) return msg;

    // Flatten tool blocks to text
    const textParts = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        textParts.push(`[Used tool: ${block.name}(${JSON.stringify(block.input).slice(0, 200)})]`);
      } else if (block.type === 'tool_result') {
        const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        textParts.push(`[Tool result: ${content.slice(0, 500)}]`);
      }
      // Keep image/document blocks as-is (handled separately by converters)
    }

    const flatText = textParts.join('\n').trim();
    return flatText ? { role: msg.role, content: flatText } : null;
  }).filter(Boolean);
}

// ============ Provider Registry ============

const providers = new Map();

export function registerProvider(name, factory) {
  providers.set(name, factory);
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
  const defaultModel = providerConfig.model || 'gpt-4o';

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
          result.push({
            role: 'assistant',
            content: textParts || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
      }
    }
    return result;
  }

  // Convert OpenAI response → Anthropic format
  function convertResponse(response) {
    const choice = response.choices[0];
    const content = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
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

      return convertResponse(await response.json());
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

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
// Tier 1: OpenAI GPT-4o   — quality 0.90
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
  openai:     { quality: 0.90, tier: 1, label: 'Premium' },
  gemini:     { quality: 0.75, tier: 1, label: 'Premium' },
  cerebras:   { quality: 0.60, tier: 2, label: 'Free' },
  groq:       { quality: 0.60, tier: 2, label: 'Free' },
  openrouter: { quality: 0.55, tier: 2, label: 'Free' },
  mistral:    { quality: 0.50, tier: 2, label: 'Free' },
  together:   { quality: 0.60, tier: 2, label: 'Free' },
  sambanova:  { quality: 0.60, tier: 2, label: 'Free' },
  fireworks:  { quality: 0.60, tier: 2, label: 'Free' },
  novita:     { quality: 0.55, tier: 2, label: 'Free' },
  ollama:     { quality: 0.40, tier: 3, label: 'Local' },
};

// ============ Provider Cost Map ($/MTok, blended input+output avg) ============
// Used by compute-economics.js to auto-adjust JUL pricing oracle (Layer 1)
// When the active provider changes, the JUL-to-token ratio auto-adjusts so
// 1 JUL always buys the same DOLLAR VALUE of compute regardless of provider.
const PROVIDER_COST_PER_MTOK = {
  claude:     9.00,   // $3 input + $15 output, blended ~$9/MTok
  deepseek:   0.69,   // $0.27 input + $1.10 output, blended
  openai:     6.25,   // $2.50 input + $10 output, blended
  gemini:     0.375,  // $0.15 input + $0.60 output, blended
  cerebras:   0.001,  // Free tier
  groq:       0.001,  // Free tier
  openrouter: 0.001,  // Free tier
  mistral:    0.001,  // Free tier
  together:   0.001,  // Free tier (credits)
  sambanova:  0.001,  // Free tier
  fireworks:  0.001,  // Free tier
  novita:     0.001,  // Free tier
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
        case 'openai': return 'gpt-4o';
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
        default: return config.llm?.baseUrl || process.env.LLM_BASE_URL || undefined;
      }
    })(),
  };
}

export function initProvider() {
  const providerName = config.llm?.provider || 'claude';
  primaryProviderName = providerName;

  // Init primary
  const providerConfig = getProviderConfig(providerName);
  createProvider(providerName, providerConfig);

  // Init fallbacks — any provider with a configured API key that isn't the primary
  // Tier 1 (paid) → Tier 2 (free/low-cost) — Infinite Compute cascade
  const fallbackOrder = ['claude', 'deepseek', 'gemini', 'openai', 'cerebras', 'groq', 'openrouter', 'mistral', 'together', 'sambanova', 'fireworks', 'novita'];
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
          console.log(`[llm] Fallback registered: ${name} (${fb.model})`);
        }
      } catch { /* skip broken fallbacks */ }
    }
  }

  if (fallbackProviders.length > 0) {
    console.log(`[wardenclyffe] ${fallbackProviders.length} fallback provider(s) in cascade — auto-switch on credit exhaustion`);
    console.log(`[wardenclyffe] Chain: ${providerName} → ${fallbackProviders.map(p => p.name).join(' → ')}`);
  } else {
    console.warn('[wardenclyffe] No fallback providers configured. Set CEREBRAS_API_KEY, GROQ_API_KEY, etc. for infinite compute.');
  }

  return activeProvider;
}

// ============ Retry helpers ============

function isTransientError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  if ([429, 500, 502, 503, 529].includes(status)) return true;
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('econnreset')
      || msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('fetch failed')) {
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

  const cascadeTrail = [];

  // Non-Claude providers can't handle tool_use/tool_result in conversation history.
  // Flatten them to plain text BEFORE sending — not just during cascade.
  if (activeProvider.name !== 'claude' && request.messages) {
    request = { ...request, messages: flattenToolExchanges(request.messages) };
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const attemptStart = Date.now();
    try {
      const result = await activeProvider.chat(request);
      // Cascade trail — record successful attempt
      cascadeTrail.push({
        provider: activeProvider.name,
        model: activeProvider.model,
        status: 'success',
        latencyMs: Date.now() - attemptStart,
      });
      // Attach provider metadata for usage tracking
      result._provider = activeProvider.name;
      result._model = activeProvider.model;
      // Wardenclyffe protocol metadata
      result._cascadeTrail = cascadeTrail;
      result._intelligenceLevel = getIntelligenceLevel();
      const contentStr = JSON.stringify(result.content);
      result._responseHash = createHash('sha256')
        .update(contentStr + activeProvider.name + activeProvider.model + Date.now())
        .digest('hex');
      return result;
    } catch (error) {
      lastError = error;

      // Credit exhaustion — cascade through fallback providers
      if (isCreditError(error) && activateFallback()) {
        cascadeTrail.push({
          provider: cascadeTrail.length > 0 ? cascadeTrail[cascadeTrail.length - 1].provider : 'unknown',
          model: cascadeTrail.length > 0 ? cascadeTrail[cascadeTrail.length - 1].model : 'unknown',
          status: 'credit_error',
          latencyMs: Date.now() - attemptStart,
          error: error.message?.slice(0, 120),
        });

        // Flatten tool exchanges for non-Claude providers — they can't use Jarvis tools
        // and will reject Claude-format tool_use/tool_result in conversation history
        const { model, tools, ...rest } = request;
        if (rest.messages) {
          rest.messages = flattenToolExchanges(rest.messages);
        }

        // Try each fallback provider until one succeeds
        let fallbackError;
        do {
          console.warn(`[llm] Retrying with fallback provider: ${activeProvider.name} (${activeProvider.model})`);
          const fallbackStart = Date.now();
          try {
            const result = await activeProvider.chat(rest);
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
            cascadeTrail.push({
              provider: activeProvider.name,
              model: activeProvider.model,
              status: 'fallback_error',
              latencyMs: Date.now() - fallbackStart,
              error: fbErr.message?.slice(0, 120),
            });
            console.warn(`[wardenclyffe] Fallback ${activeProvider.name} failed: ${fbErr.message?.slice(0, 100)}`);
          }
        } while (activateFallback());

        // All fallbacks exhausted
        throw fallbackError || error;
      }

      // Transient errors — retry with exponential backoff + jitter
      if (isTransientError(error) && attempt < MAX_RETRIES) {
        cascadeTrail.push({
          provider: activeProvider.name,
          model: activeProvider.model,
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
        provider: activeProvider.name,
        model: activeProvider.model,
        status: 'fatal_error',
        latencyMs: Date.now() - attemptStart,
        error: error.message?.slice(0, 120),
      });
      throw error;
    }
  }

  throw lastError; // Exhausted retries
}
