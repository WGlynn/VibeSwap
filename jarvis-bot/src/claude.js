import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { loadSystemPrompt } from './memory.js';
import { setFlag, getBehavior } from './behavior.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Per-chat conversation history — persisted to disk
const conversations = new Map();

const DATA_DIR = config.dataDir;
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

export function getSystemPrompt() {
  return systemPrompt;
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

export async function chat(chatId, userName, message, chatType = 'private') {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  const history = conversations.get(chatId);

  // Add user message with name tag and chat context
  const isDM = chatType === 'private';
  const contextPrefix = isDM ? '[DM] ' : '[GROUP] ';
  const taggedMessage = contextPrefix + (userName ? `[${userName}]: ${message}` : message);

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

  // Tools Jarvis can use to take real actions (not just generate text)
  const tools = [
    {
      name: 'set_behavior',
      description: 'Update a runtime behavior flag. Use this when the user asks you to change your behavior (e.g. stop welcoming new members, disable digest, etc). Available flags: welcomeNewMembers, proactiveEngagement, dailyDigest, autoModeration, arkDmOnJoin, trackContributions, respondInGroups, respondInDms. You can also set welcomeMessage (string).',
      input_schema: {
        type: 'object',
        properties: {
          flag: { type: 'string', description: 'The behavior flag to update' },
          value: { description: 'The new value (boolean for flags, string for welcomeMessage)' },
        },
        required: ['flag', 'value'],
      },
    },
    {
      name: 'get_behavior',
      description: 'Read current behavior flags to see what is enabled/disabled.',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  try {
    let response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: history,
      tools,
    });

    // Handle tool use loop (max 3 rounds to prevent infinite loops)
    let rounds = 0;
    while (response.stop_reason === 'tool_use' && rounds < 3) {
      rounds++;
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');
      history.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const tb of toolBlocks) {
        let result;
        if (tb.name === 'set_behavior') {
          const ok = await setFlag(tb.input.flag, tb.input.value);
          result = ok
            ? `Done. ${tb.input.flag} is now ${JSON.stringify(tb.input.value)}.`
            : `Unknown flag: ${tb.input.flag}`;
          console.log(`[claude] Tool: set_behavior(${tb.input.flag}, ${tb.input.value}) → ${ok ? 'ok' : 'failed'}`);
        } else if (tb.name === 'get_behavior') {
          result = JSON.stringify(getBehavior(), null, 2);
        } else {
          result = 'Unknown tool.';
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
      }
      history.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: config.anthropic.model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        messages: history,
        tools,
      });
    }

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
