import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { config } from './config.js';
import { loadSystemPrompt } from './memory.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Per-chat conversation history — persisted to disk
const conversations = new Map();

const DATA_DIR = join(homedir(), 'vibeswap', 'jarvis-bot', 'data');
const CONVERSATIONS_FILE = join(DATA_DIR, 'conversations.json');

let systemPrompt = '';
let conversationsDirty = false;

// ============ Conversation Persistence ============

async function loadConversations() {
  try {
    const data = await readFile(CONVERSATIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    let totalMessages = 0;
    for (const [chatId, messages] of Object.entries(parsed)) {
      conversations.set(Number(chatId), messages);
      totalMessages += messages.length;
    }
    console.log(`[claude] Loaded ${conversations.size} conversation(s), ${totalMessages} messages from disk`);
  } catch {
    console.log('[claude] No saved conversations found — starting fresh');
  }
}

export async function saveConversations() {
  if (!conversationsDirty) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [chatId, messages] of conversations) {
      // Only persist last 30 messages per chat to keep file reasonable
      obj[chatId] = messages.slice(-30);
    }
    await writeFile(CONVERSATIONS_FILE, JSON.stringify(obj, null, 2));
    conversationsDirty = false;
  } catch (err) {
    console.error('[claude] Failed to save conversations:', err.message);
  }
}

// ============ Init ============

export async function initClaude() {
  await loadConversations();
  systemPrompt = await loadSystemPrompt();
  console.log(`[claude] System prompt loaded (${systemPrompt.length} chars)`);
}

export async function reloadSystemPrompt() {
  systemPrompt = await loadSystemPrompt();
  console.log(`[claude] System prompt reloaded (${systemPrompt.length} chars)`);
}

export function clearHistory(chatId) {
  conversations.delete(chatId);
  conversationsDirty = true;
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

  conversationsDirty = true;
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

    // Mark dirty for periodic save
    conversationsDirty = true;

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
