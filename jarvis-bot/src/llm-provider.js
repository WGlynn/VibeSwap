// ============ LLM Provider Abstraction — Multi-Model Mind Network ============
//
// Each shard can run ANY LLM — Claude, GPT, Llama, Gemini, DeepSeek.
// The provider layer translates between a unified interface and each API's format.
//
// All providers return Anthropic-format responses internally:
//   { content: [{ type: 'text', text }, { type: 'tool_use', id, name, input }],
//     stop_reason: 'end_turn' | 'tool_use',
//     usage: { input_tokens, output_tokens } }
//
// This means the rest of JARVIS (tools, history, CRPC) works unchanged
// regardless of which model powers a given shard.
//
// When CRPC runs across shards with DIFFERENT models, you get genuine
// cognitive diversity — not just temperature variation on the same model.
// ============

import { config } from './config.js';
import { randomUUID } from 'crypto';

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
    name: 'openai',
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
        throw new Error(`OpenAI API error ${response.status}: ${error}`);
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

    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'model' : 'user';

      if (Array.isArray(msg.content)) {
        const parts = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'image' && block.source?.type === 'base64') {
            parts.push({
              inlineData: { mimeType: block.source.media_type, data: block.source.data },
            });
          } else if (block.type === 'tool_use') {
            parts.push({
              functionCall: { name: block.name, args: block.input },
            });
          } else if (block.type === 'tool_result') {
            parts.push({
              functionResponse: {
                name: block.tool_use_id,
                response: { result: block.content },
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role, parts });
        }
      } else if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
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
    baseUrl: providerConfig.baseUrl || 'https://api.deepseek.com/v1',
    model: providerConfig.model || 'deepseek-chat',
  });
}

registerProvider('deepseek', createDeepSeekProvider);

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

// ============ Credit/Billing Error Detection ============

function isCreditError(error) {
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('rate_limit') && msg.includes('billing') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('payment required') ||
    /\b402\b/.test(msg) ||
    (msg.includes('400') && msg.includes('credit'));
}

// ============ Fallback: Activate Next Provider ============

function activateFallback() {
  if (fallbackProviders.length === 0) return false;
  const next = fallbackProviders.shift();
  console.warn(`[llm] PRIMARY PROVIDER CREDIT EXHAUSTED — falling back to ${next.name} (${next.model})`);
  activeProvider = next;
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
        default: return config.anthropic?.apiKey;
      }
    })(),
    baseUrl: (() => {
      switch (providerName) {
        case 'deepseek': return 'https://api.deepseek.com/v1';
        case 'ollama': return config.llm?.ollamaUrl || 'http://localhost:11434';
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
  const fallbackOrder = ['claude', 'deepseek', 'gemini', 'openai'];
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
    console.log(`[llm] ${fallbackProviders.length} fallback provider(s) ready — auto-switch on credit exhaustion`);
  } else {
    console.warn('[llm] No fallback providers configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or DEEPSEEK_API_KEY for resilience.');
  }

  return activeProvider;
}

// ============ Convenience: Direct Chat (with auto-fallback) ============

export async function llmChat(request) {
  if (!activeProvider) {
    throw new Error('LLM provider not initialized. Call initProvider() first.');
  }

  try {
    return await activeProvider.chat(request);
  } catch (error) {
    if (isCreditError(error) && activateFallback()) {
      console.warn(`[llm] Retrying with fallback provider: ${activeProvider.name} (${activeProvider.model})`);
      // Strip the original model — let fallback use its own default
      const { model, ...rest } = request;
      return await activeProvider.chat(rest);
    }
    throw error; // Not a credit error, or no fallbacks left
  }
}
