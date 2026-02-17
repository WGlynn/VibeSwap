import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { loadSystemPrompt } from './memory.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Per-chat conversation history
const conversations = new Map();

let systemPrompt = '';

export async function initClaude() {
  systemPrompt = await loadSystemPrompt();
  console.log(`[claude] System prompt loaded (${systemPrompt.length} chars)`);
}

export async function reloadSystemPrompt() {
  systemPrompt = await loadSystemPrompt();
  console.log(`[claude] System prompt reloaded (${systemPrompt.length} chars)`);
}

export function clearHistory(chatId) {
  conversations.delete(chatId);
}

// Buffer a message into conversation history WITHOUT calling Claude.
// Used for group chat messages so JARVIS has situational awareness.
export function bufferMessage(chatId, userName, message) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  const history = conversations.get(chatId);
  const taggedMessage = userName ? `[${userName}]: ${message}` : message;

  // Claude API requires alternating user/assistant messages.
  // Buffer consecutive user messages by appending to the last user message.
  const last = history[history.length - 1];
  if (last && last.role === 'user') {
    last.content += '\n' + taggedMessage;
  } else {
    history.push({ role: 'user', content: taggedMessage });
  }

  // Trim if too long
  while (history.length > config.maxConversationHistory) {
    history.shift();
  }
}

export async function chat(chatId, userName, message) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  const history = conversations.get(chatId);

  // Add user message with name tag
  const taggedMessage = userName ? `[${userName}]: ${message}` : message;

  // Append to existing user block or create new one
  const last = history[history.length - 1];
  if (last && last.role === 'user') {
    last.content += '\n' + taggedMessage;
  } else {
    history.push({ role: 'user', content: taggedMessage });
  }

  // Trim history if too long
  while (history.length > config.maxConversationHistory) {
    history.shift();
  }

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: history,
    });

    const assistantMessage = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Add assistant response to history
    history.push({ role: 'assistant', content: assistantMessage });

    return {
      text: assistantMessage,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  } catch (error) {
    console.error('[claude] API error:', error.message);
    throw error;
  }
}
