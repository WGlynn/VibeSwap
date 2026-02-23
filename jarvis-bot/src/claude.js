import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { config } from './config.js';
import { loadSystemPrompt } from './memory.js';
import { setFlag, getBehavior } from './behavior.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const REPO_PATH = config.repo.path;

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

// ============ Idea-to-Code Generation ============

// Sandboxed file write — only allows writing inside the repo
function safeRepoPath(filePath) {
  const resolved = resolve(REPO_PATH, filePath);
  if (!resolved.startsWith(resolve(REPO_PATH))) {
    throw new Error('Path traversal blocked: ' + filePath);
  }
  return resolved;
}

const CODE_GEN_TOOLS = [
  {
    name: 'write_file',
    description: 'Write a file to the repository. Use relative paths from the repo root (e.g., "contracts/ideas/MyIdea.sol" or "docs/ideas/my-idea.md"). Creates directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the repository to understand existing code. Use relative paths.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory to understand existing structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path from repo root' },
      },
      required: ['path'],
    },
  },
];

async function handleCodeGenTool(toolName, input) {
  try {
    if (toolName === 'write_file') {
      const fullPath = safeRepoPath(input.path);
      const dir = resolve(fullPath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, input.content, 'utf-8');
      return `Wrote ${input.content.length} chars to ${input.path}`;
    }
    if (toolName === 'read_file') {
      const fullPath = safeRepoPath(input.path);
      if (!existsSync(fullPath)) return `File not found: ${input.path}`;
      const content = await readFile(fullPath, 'utf-8');
      return content.length > 8000 ? content.slice(0, 8000) + '\n... (truncated)' : content;
    }
    if (toolName === 'list_files') {
      const fullPath = safeRepoPath(input.path);
      if (!existsSync(fullPath)) return `Directory not found: ${input.path}`;
      const { readdirSync } = await import('fs');
      const entries = readdirSync(fullPath, { withFileTypes: true });
      return entries.map(e => (e.isDirectory() ? e.name + '/' : e.name)).join('\n');
    }
    return 'Unknown tool.';
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * Generate code from an idea description. Claude gets file read/write tools.
 * Returns: { text: string, filesWritten: string[] }
 */
export async function codeGenChat(ideaDescription, author) {
  const codeGenPrompt = `${systemPrompt}

# CODE GENERATION MODE

You are generating code for a community idea submitted via Telegram.
Author: ${author}

RULES:
1. Write code that fits VibeSwap's existing architecture and conventions
2. Place Solidity contracts in contracts/ideas/ directory
3. Place documentation in docs/ideas/ directory
4. Place tests in test/ideas/ directory
5. Use existing patterns from the codebase (UUPS upgradeable, OZ v5, section headers)
6. Write a brief README for the idea in docs/ideas/<name>.md
7. This is a DRAFT — mark TODOs for things that need review
8. Keep it focused — implement the core concept, not every edge case

Use the tools to read existing files for reference and write new files.`;

  const messages = [{
    role: 'user',
    content: `Generate code for this idea:\n\n${ideaDescription}`,
  }];

  const filesWritten = [];
  let rounds = 0;

  try {
    let response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 8192,
      system: codeGenPrompt,
      messages,
      tools: CODE_GEN_TOOLS,
    });

    while (response.stop_reason === 'tool_use' && rounds < 10) {
      rounds++;
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const tb of toolBlocks) {
        const result = await handleCodeGenTool(tb.name, tb.input);
        if (tb.name === 'write_file') {
          filesWritten.push(tb.input.path);
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
        console.log(`[codegen] Tool: ${tb.name}(${tb.input.path || ''}) → ${result.slice(0, 80)}`);
      }
      messages.push({ role: 'user', content: toolResults });

      response = await client.messages.create({
        model: config.anthropic.model,
        max_tokens: 8192,
        system: codeGenPrompt,
        messages,
        tools: CODE_GEN_TOOLS,
      });
    }

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return { text, filesWritten };
  } catch (error) {
    console.error('[codegen] Error:', error.message);
    return { text: `Code generation failed: ${error.message}`, filesWritten };
  }
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
