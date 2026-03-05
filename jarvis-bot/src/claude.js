import { writeFile, readFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { config } from './config.js';
import { loadSystemPrompt } from './memory.js';
import { setFlag, getBehavior } from './behavior.js';
import { learnFact, buildKnowledgeContext, compressCKB } from './learning.js';
import { searchDeepStorageFull } from './deep-storage.js';
import { llmChat, getProvider, getProviderName, getModelName } from './llm-provider.js';
import { getLimniStats, registerTerminal, registerVPS, listStrategies, getStrategy, registerStrategy, checkTerminalHealth, checkAllVPS, fetchTrades, verifyTrade, strategyPipeline, deployStrategy, startMonitorLoop, stopMonitorLoop, getAlerts, runBacktest, listBacktests, getBacktestResult } from './limni.js';
import { registerKataraktiStrategies, validateCryptoTrade, kellyPositionSize, formatPerformanceSummary } from './katarakti.js';

const REPO_PATH = config.repo.path;

// Per-chat conversation history — persisted to disk
const conversations = new Map();

const DATA_DIR = config.dataDir;
const CONVERSATIONS_FILE = join(DATA_DIR, 'conversations.json');

let systemPrompt = '';
let conversationsDirty = false;

// Track last JARVIS response per chat for correction detection
const lastResponses = new Map(); // chatId -> { text, timestamp }

// ============ Per-Chat Async Lock ============
// Prevents concurrent messages from corrupting the same conversation history.
const chatLocks = new Map(); // chatId -> Promise

async function withChatLock(chatId, fn) {
  // Wait for any pending operation on this chat to finish
  const prev = chatLocks.get(chatId) || Promise.resolve();
  let release;
  const lock = new Promise(resolve => { release = resolve; });
  chatLocks.set(chatId, lock);
  try {
    await prev; // Wait for previous operation
    return await fn();
  } finally {
    release();
    // Clean up if no one else is queued (the lock is still ours)
    if (chatLocks.get(chatId) === lock) {
      chatLocks.delete(chatId);
    }
  }
}

// ============ Periodic Cleanup ============
// Evict stale entries from lastResponses and chatLocks every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [chatId, entry] of lastResponses) {
    if (entry.timestamp < cutoff) lastResponses.delete(chatId);
  }
}, 30 * 60 * 1000);

export function getLastResponse(chatId) {
  return lastResponses.get(chatId) || null;
}

// ============ Conversation Persistence ============

async function loadConversations() {
  try {
    const data = await readFile(CONVERSATIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    let totalMessages = 0;
    for (const [chatId, messages] of Object.entries(parsed)) {
      sanitizeHistory(messages);
      conversations.set(Number(chatId), messages);
      totalMessages += messages.length;
    }
    console.log(`[claude] Loaded ${conversations.size} conversation(s), ${totalMessages} messages from disk (sanitized)`);
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
      const trimmed = messages.slice(-30);
      sanitizeHistory(trimmed);
      obj[chatId] = trimmed;
    }
    // Atomic write: write to temp file, then rename (prevents corruption on crash)
    const tmpFile = CONVERSATIONS_FILE + '.tmp';
    await writeFile(tmpFile, JSON.stringify(obj, null, 2));
    await rename(tmpFile, CONVERSATIONS_FILE);
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

// ============ History Sanitization ============
// Ensures no orphaned tool_result blocks exist without their matching tool_use.
// This can happen when history is trimmed (shift or slice) mid-tool-exchange,
// or when conversations are loaded from disk after a crash.

function sanitizeHistory(history) {
  if (!history || history.length === 0) return history;

  // Step 1: Ensure history starts with a user message (API requirement)
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  // Step 2: Ensure alternating roles — collapse same-role adjacents
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === history[i - 1].role) {
      if (history[i].role === 'user') {
        // Merge user messages (both must be strings for merging)
        const prev = typeof history[i - 1].content === 'string' ? history[i - 1].content : '';
        const curr = typeof history[i].content === 'string' ? history[i].content : '';
        if (prev && curr) {
          history[i - 1].content = prev + '\n' + curr;
          history.splice(i, 1);
          i--;
        }
      } else {
        // Remove duplicate assistant messages
        history.splice(i, 1);
        i--;
      }
    }
  }

  // Step 3: Collect all tool_use IDs from assistant messages
  // MUST run after structural cleanup so removed messages don't contribute phantom IDs
  const toolUseIds = new Set();
  for (const msg of history) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.id) {
          toolUseIds.add(block.id);
        }
      }
    }
  }

  // Step 4: Also enforce adjacency — each tool_result must reference a tool_use
  // in the immediately preceding assistant message (Claude API requirement)
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Get tool_use IDs from the immediately preceding assistant message
      const prevMsg = i > 0 ? history[i - 1] : null;
      const prevToolIds = new Set();
      if (prevMsg && prevMsg.role === 'assistant' && Array.isArray(prevMsg.content)) {
        for (const block of prevMsg.content) {
          if (block.type === 'tool_use' && block.id) {
            prevToolIds.add(block.id);
          }
        }
      }

      const filtered = msg.content.filter(block => {
        if (block.type === 'tool_result') {
          // Must match a tool_use in the immediately preceding assistant message
          return prevToolIds.has(block.tool_use_id);
        }
        return true;
      });
      if (filtered.length === 0) {
        // Entire message was orphaned tool_results — remove it
        history.splice(i, 1);
        i--;
      } else if (filtered.length !== msg.content.length) {
        msg.content = filtered;
      }
    }
  }

  // Step 5: Re-check structure after tool_result cleanup (may have created gaps)
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  return history;
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
    let response = await llmChat({
      model: getModelName(),
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

      response = await llmChat({
        model: getModelName(),
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
  // Synchronous lock-free path — bufferMessage doesn't await anything,
  // but we still guard the mutations for safety with the lock.
  // Since this is sync, we just do it inline (lock is for async chat()).
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  const history = conversations.get(chatId);
  const taggedMessage = userName ? `[${userName}]: ${message}` : message;

  // Claude API requires alternating user/assistant messages.
  // Buffer consecutive user messages by appending to the last user message.
  // But only if the last user message is a string (not tool_result array).
  const last = history[history.length - 1];
  if (last && last.role === 'user' && typeof last.content === 'string') {
    last.content += '\n' + taggedMessage;
  } else {
    history.push({ role: 'user', content: taggedMessage });
  }

  // Trim if too long
  while (history.length > config.maxConversationHistory) {
    history.shift();
  }
  sanitizeHistory(history);

  conversationsDirty = true;
}

export async function chat(chatId, userName, message, chatType = 'private', media = [], { maxTokensOverride, userId } = {}) {
  return withChatLock(chatId, async () => {
    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }

    const history = conversations.get(chatId);

    // Add user message with name tag and chat context
    const isDM = chatType === 'private';
    const contextPrefix = isDM ? '[DM] ' : '[GROUP] ';
    const taggedMessage = contextPrefix + (userName ? `[${userName}]: ${message}` : message);

    // Build content: multimodal array if media present, plain string otherwise
    if (media.length > 0) {
      // Multimodal message — content array with media blocks + text
      const contentBlocks = [];
      for (const m of media) {
        if (m.type === 'image') {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: m.mimeType, data: m.data },
          });
        } else if (m.type === 'document') {
          contentBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: m.mimeType, data: m.data },
          });
        }
      }
      contentBlocks.push({ type: 'text', text: taggedMessage });

      // Store text-only placeholder in history (no base64 bloat)
      const mediaDesc = media.map(m => `[${m.type}: ${m.filename || m.mimeType}]`).join(' ');
      history.push({ role: 'user', content: `${mediaDesc} ${taggedMessage}` });

      // Swap last history entry's content for the API call, restore after
      const historyEntry = history[history.length - 1];
      const savedContent = historyEntry.content;
      historyEntry.content = contentBlocks;

      // Trim + sanitize before API call
      while (history.length > config.maxConversationHistory) {
        history.shift();
      }
      sanitizeHistory(history);

      try {
        return await _sendToLLM(chatId, userName, chatType, history, maxTokensOverride, userId);
      } finally {
        // Restore text-only content for persistence (no base64 stored)
        historyEntry.content = savedContent;
      }
    }

    // Plain text path (original behavior)
    // Append to existing user block or create new one
    // Only merge if the last message is a plain string (not tool_result array)
    const last = history[history.length - 1];
    if (last && last.role === 'user' && typeof last.content === 'string') {
      last.content += '\n' + taggedMessage;
    } else {
      history.push({ role: 'user', content: taggedMessage });
    }

    // Trim history if too long — but never cut inside a tool_use/tool_result pair
    while (history.length > config.maxConversationHistory) {
      history.shift();
    }
    sanitizeHistory(history);

    return _sendToLLM(chatId, userName, chatType, history, maxTokensOverride, userId);
  });
}

// ============ LLM Call + Tool Loop (shared by text and multimodal paths) ============

async function _sendToLLM(chatId, userName, chatType, history, maxTokensOverride, userId) {
  // In DMs, chatId IS the userId. In groups, userId must be passed explicitly.
  const effectiveUserId = userId || chatId;

  // Extract latest user message text for relevance scoring
  const latestMessage = history.length > 0 ? history[history.length - 1] : null;
  const messageText = latestMessage?.role === 'user' && typeof latestMessage.content === 'string'
    ? latestMessage.content : '';

  // Build knowledge context for this user/chat (with relevance scoring)
  let knowledgeContext = '';
  try {
    knowledgeContext = await buildKnowledgeContext(effectiveUserId, chatId, chatType, messageText);
  } catch {}

  const fullSystemPrompt = knowledgeContext
    ? systemPrompt + '\n\n' + knowledgeContext
    : systemPrompt;

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
    {
      name: 'learn_fact',
      description: 'Persistently learn a fact about a user, group, or topic. Use this when someone tells you something you should remember for future conversations — preferences, facts about them, project decisions, corrections, or important context. This writes to your persistent knowledge base and survives restarts. Examples: "User prefers short answers", "The group decided to use X over Y", "User\'s timezone is EST".',
      input_schema: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'The fact to remember. Write it as a clear statement.' },
          category: {
            type: 'string',
            enum: ['preference', 'factual', 'technical', 'social', 'project', 'behavioral'],
            description: 'Category of the fact',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for retrieval (e.g., ["timezone", "communication"])',
          },
        },
        required: ['fact', 'category'],
      },
    },
    {
      name: 'recall_knowledge',
      description: 'Search your deep memory (L2 archive) for facts that were previously learned but pruned from active memory. Use this when you sense you should know something but cannot find it in your current knowledge context, or when a user asks about something you may have learned in a past conversation.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what you are looking for' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags to filter by',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'web_search',
      description: 'Search the web for current information, public archives, news, documentation, or any real-time data. Use this when the user asks a question you cannot answer from your knowledge base, or when they explicitly ask you to search/look something up.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file from the VibeSwap repository or any accessible path. Use this when you need to look up code, configs, docs, or any file content. Returns the file contents as text. Path can be relative to the repo root (e.g., "jarvis-bot/src/config.js") or absolute.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to repo root or absolute)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file in the VibeSwap repository. Creates the file if it does not exist. Use this to update code, configs, docs, or create new files. Only writes within the repo directory for safety.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to repo root (e.g., "docs/new-doc.md")' },
          content: { type: 'string', description: 'The full content to write to the file' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'run_command',
      description: 'Execute a shell command in the VibeSwap repository directory. Use for git operations (commit, push, pull, status, diff, log), running tests, building, or any CLI operation. Commands run with a 60-second timeout. For safety, destructive commands (rm -rf, drop, etc.) are blocked.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (defaults to repo root)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'fetch_repo',
      description: 'Fetch and read files from a GitHub repository URL. Clones/pulls the repo to a temp directory and reads specified files. Use when someone shares a GitHub URL and you need to read its contents.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'GitHub repository URL (e.g., https://github.com/user/repo)' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of file paths to read from the repo (e.g., ["README.md", "src/index.ts"]). If empty, reads README.md.',
          },
        },
        required: ['url'],
      },
    },
    {
      name: 'flag_deceiver',
      description: 'Flag a user/entity as a deceiver in the Hell registry. Only use when there is highly credible + probabilistic evidence consistent with deceptive behavior. This is the system immune response — automated trust enforcement. Entry criteria: (1) credible evidence, (2) probabilistic consistency, (3) behavioral alignment with deception. Exit only via repentance process.',
      input_schema: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Username, wallet address, or other identifier of the deceiver' },
          evidence: { type: 'string', description: 'Description of the credible evidence of deception' },
          pattern: { type: 'string', description: 'The deceptive behavior pattern observed' },
          severity: {
            type: 'string',
            enum: ['minor', 'moderate', 'severe', 'critical'],
            description: 'Severity of the deception',
          },
        },
        required: ['identifier', 'evidence', 'pattern', 'severity'],
      },
    },
    // ============ Limni — Trading Terminal Integration ============
    {
      name: 'limni_status',
      description: 'Get the current status of all connected Limni trading terminals, registered strategies, VPS health, and trade statistics. Use when asked about trading status, bot health, or strategy performance.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'limni_register_terminal',
      description: 'Register a Limni trading terminal for monitoring. Use when setting up a new connection to Freedom\'s Limni instance.',
      input_schema: {
        type: 'object',
        properties: {
          terminalId: { type: 'string', description: 'Unique terminal identifier (e.g., "katarakti", "universal")' },
          url: { type: 'string', description: 'Terminal API base URL' },
          apiKey: { type: 'string', description: 'API key for authentication (optional)' },
          operator: { type: 'string', description: 'Who monitors this terminal (e.g., "will", "freedom")' },
        },
        required: ['terminalId', 'url', 'operator'],
      },
    },
    {
      name: 'limni_register_vps',
      description: 'Register a VPS for health monitoring. Use when adding a new VPS that hosts Limni or trading bots.',
      input_schema: {
        type: 'object',
        properties: {
          vpsId: { type: 'string', description: 'Unique VPS identifier' },
          host: { type: 'string', description: 'VPS hostname or IP' },
          healthUrl: { type: 'string', description: 'Health check URL (e.g., http://host:port/health)' },
          operator: { type: 'string', description: 'Who manages this VPS' },
        },
        required: ['vpsId', 'host', 'healthUrl', 'operator'],
      },
    },
    {
      name: 'limni_check_health',
      description: 'Check health of a specific terminal or all VPS instances. Returns current status and any connectivity issues.',
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '"vps" to check all VPS, or a terminal ID to check a specific terminal' },
        },
        required: ['target'],
      },
    },
    {
      name: 'limni_monitor',
      description: 'Start or stop the autonomous trade monitoring loop. The loop checks all terminals at regular intervals and verifies trades.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop'], description: 'Start or stop the monitor loop' },
          intervalMs: { type: 'number', description: 'Check interval in milliseconds (default: 30000 = 30s). Only used with "start".' },
        },
        required: ['action'],
      },
    },
    {
      name: 'limni_alerts',
      description: 'Get recent trading alerts (invalid trades, terminal failures, VPS issues).',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of alerts to return (default: 20)' },
        },
      },
    },
  ];

  try {
    const effectiveMaxTokens = maxTokensOverride || config.maxTokens;

    let response = await llmChat({
      model: getModelName(),
      max_tokens: effectiveMaxTokens,
      system: fullSystemPrompt,
      messages: history,
      tools,
    });

    // Handle tool use loop (max 5 rounds to prevent infinite loops)
    let rounds = 0;
    const historyLenBeforeTools = history.length;
    while (response.stop_reason === 'tool_use' && rounds < 5) {
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
        } else if (tb.name === 'learn_fact') {
          try {
            await learnFact(
              effectiveUserId, userName, chatId, chatType,
              tb.input.fact, tb.input.category, tb.input.tags || []
            );
            result = `Learned: "${tb.input.fact}" — stored in persistent knowledge base.`;
            console.log(`[claude] Tool: learn_fact("${tb.input.fact.slice(0, 50)}...")`);
          } catch (err) {
            result = `Failed to learn: ${err.message}`;
          }
        } else if (tb.name === 'recall_knowledge') {
          try {
            const results = await searchDeepStorageFull(effectiveUserId, tb.input.query, tb.input.tags || [], 5);
            if (results.length === 0) {
              result = 'No matching facts found in deep memory (L2 archive).';
            } else {
              const formatted = results.map((r, i) => `${i + 1}. [${r.category || 'general'}] ${r.content} (archived: ${r.archivedAt || 'unknown'}, reason: ${r.archiveReason || 'unknown'})`);
              result = `Found ${results.length} fact(s) in deep memory:\n${formatted.join('\n')}`;
            }
            console.log(`[claude] Tool: recall_knowledge("${tb.input.query.slice(0, 40)}...") → ${results.length} results`);
          } catch (err) {
            result = `Deep memory search failed: ${err.message}`;
          }
        } else if (tb.name === 'web_search') {
          try {
            result = await _webSearch(tb.input.query);
            console.log(`[claude] Tool: web_search("${tb.input.query.slice(0, 40)}...")`);
          } catch (err) {
            result = `Web search failed: ${err.message}`;
          }
        } else if (tb.name === 'read_file') {
          try {
            const filePath = tb.input.path.startsWith('/') || tb.input.path.match(/^[A-Z]:/)
              ? tb.input.path
              : join(REPO_PATH, tb.input.path);
            const content = await readFile(filePath, 'utf-8');
            // Cap at 8000 chars to avoid context explosion
            result = content.length > 8000
              ? content.slice(0, 8000) + `\n\n[... truncated, ${content.length} chars total]`
              : content;
            console.log(`[claude] Tool: read_file("${tb.input.path}") → ${content.length} chars`);
          } catch (err) {
            result = `Failed to read file: ${err.message}`;
          }
        } else if (tb.name === 'write_file') {
          try {
            const filePath = join(REPO_PATH, tb.input.path);
            // Safety: ensure path is within repo
            const resolved = resolve(filePath);
            const repoResolved = resolve(REPO_PATH);
            if (!resolved.startsWith(repoResolved)) {
              result = 'Blocked: write_file path must be within the repository.';
            } else {
              // Ensure parent directory exists
              const parentDir = resolve(filePath, '..');
              await mkdir(parentDir, { recursive: true });
              await writeFile(filePath, tb.input.content, 'utf-8');
              result = `Written ${tb.input.content.length} chars to ${tb.input.path}`;
              console.log(`[claude] Tool: write_file("${tb.input.path}") → ${tb.input.content.length} chars`);
            }
          } catch (err) {
            result = `Failed to write file: ${err.message}`;
          }
        } else if (tb.name === 'run_command') {
          try {
            const cmd = tb.input.command;
            // Safety: block destructive commands
            const blocked = ['rm -rf /', 'rm -rf ~', 'DROP TABLE', 'DROP DATABASE', 'format c:', 'mkfs', ':(){:|:&};:'];
            const isBlocked = blocked.some(b => cmd.toLowerCase().includes(b.toLowerCase()));
            if (isBlocked) {
              result = 'Blocked: destructive command detected.';
            } else {
              const cwd = tb.input.cwd
                ? (tb.input.cwd.startsWith('/') || tb.input.cwd.match(/^[A-Z]:/) ? tb.input.cwd : join(REPO_PATH, tb.input.cwd))
                : REPO_PATH;
              const { execSync } = await import('child_process');
              const output = execSync(cmd, {
                cwd,
                timeout: 60000,
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
              });
              // Cap output
              result = output.length > 4000
                ? output.slice(0, 4000) + `\n\n[... truncated, ${output.length} chars total]`
                : output || '(no output)';
              console.log(`[claude] Tool: run_command("${cmd.slice(0, 60)}") → ${output.length} chars output`);
            }
          } catch (err) {
            result = `Command failed: ${err.stderr || err.message || String(err)}`.slice(0, 2000);
          }
        } else if (tb.name === 'fetch_repo') {
          try {
            const url = tb.input.url.replace(/\.git$/, '');
            const repoName = url.split('/').pop();
            const tempDir = join(REPO_PATH, '.claude', 'repo-cache', repoName);
            const { execSync } = await import('child_process');
            if (existsSync(tempDir)) {
              execSync('git pull --ff-only', { cwd: tempDir, timeout: 30000, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
            } else {
              await mkdir(join(REPO_PATH, '.claude', 'repo-cache'), { recursive: true });
              execSync(`git clone --depth 1 ${url}.git ${tempDir}`, { timeout: 60000, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
            }
            const files = tb.input.files?.length ? tb.input.files : ['README.md'];
            const results = [];
            for (const f of files.slice(0, 5)) { // Max 5 files
              try {
                const content = await readFile(join(tempDir, f), 'utf-8');
                const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n[truncated]' : content;
                results.push(`--- ${f} ---\n${truncated}`);
              } catch {
                results.push(`--- ${f} --- (not found)`);
              }
            }
            result = results.join('\n\n');
            console.log(`[claude] Tool: fetch_repo("${repoName}") → ${files.length} files read`);
          } catch (err) {
            result = `Failed to fetch repo: ${err.message}`;
          }
        } else if (tb.name === 'flag_deceiver') {
          try {
            const { flagDeceiver } = await import('./hell.js');
            const entry = await flagDeceiver(
              tb.input.identifier,
              tb.input.evidence,
              tb.input.pattern,
              tb.input.severity,
              { flaggedBy: userName, flaggedByUserId: effectiveUserId, chatId }
            );
            result = `Flagged "${tb.input.identifier}" in Hell registry. Entry ID: ${entry.id}. Severity: ${tb.input.severity}. Exit path: repentance process only.`;
            console.log(`[claude] Tool: flag_deceiver("${tb.input.identifier}") — severity: ${tb.input.severity}`);
          } catch (err) {
            result = `Failed to flag: ${err.message}`;
          }
        // ============ Limni Tools ============
        } else if (tb.name === 'limni_status') {
          result = JSON.stringify(getLimniStats(), null, 2);
          console.log('[claude] Tool: limni_status');
        } else if (tb.name === 'limni_register_terminal') {
          try {
            const terminal = registerTerminal(tb.input.terminalId, {
              url: tb.input.url,
              apiKey: tb.input.apiKey,
              operator: tb.input.operator,
              strategies: [],
            });
            result = `Terminal '${tb.input.terminalId}' registered at ${tb.input.url} (operator: ${tb.input.operator})`;
            console.log(`[claude] Tool: limni_register_terminal("${tb.input.terminalId}")`);
          } catch (err) {
            result = `Failed to register terminal: ${err.message}`;
          }
        } else if (tb.name === 'limni_register_vps') {
          try {
            registerVPS(tb.input.vpsId, {
              host: tb.input.host,
              healthUrl: tb.input.healthUrl,
              operator: tb.input.operator,
            });
            result = `VPS '${tb.input.vpsId}' registered (${tb.input.host}) — operator: ${tb.input.operator}`;
            console.log(`[claude] Tool: limni_register_vps("${tb.input.vpsId}")`);
          } catch (err) {
            result = `Failed to register VPS: ${err.message}`;
          }
        } else if (tb.name === 'limni_check_health') {
          try {
            if (tb.input.target === 'vps') {
              const vpsResults = await checkAllVPS();
              result = JSON.stringify(vpsResults, null, 2);
            } else {
              const termResult = await checkTerminalHealth(tb.input.target);
              result = JSON.stringify(termResult, null, 2);
            }
            console.log(`[claude] Tool: limni_check_health("${tb.input.target}")`);
          } catch (err) {
            result = `Health check failed: ${err.message}`;
          }
        } else if (tb.name === 'limni_monitor') {
          try {
            if (tb.input.action === 'start') {
              startMonitorLoop(tb.input.intervalMs || 30000);
              result = `Monitor loop started (interval: ${(tb.input.intervalMs || 30000) / 1000}s)`;
            } else {
              stopMonitorLoop();
              result = 'Monitor loop stopped.';
            }
            console.log(`[claude] Tool: limni_monitor("${tb.input.action}")`);
          } catch (err) {
            result = `Monitor control failed: ${err.message}`;
          }
        } else if (tb.name === 'limni_alerts') {
          const alerts = getAlerts(tb.input?.limit || 20);
          result = alerts.length === 0
            ? 'No recent alerts.'
            : alerts.map(a => `[${new Date(a.timestamp).toISOString()}] ${a.type}: ${a.message}`).join('\n');
          console.log(`[claude] Tool: limni_alerts → ${alerts.length} alerts`);
        } else {
          result = 'Unknown tool.';
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
      }
      history.push({ role: 'user', content: toolResults });

      try {
        response = await llmChat({
          model: getModelName(),
          max_tokens: effectiveMaxTokens,
          system: fullSystemPrompt,
          messages: history,
          tools,
        });
      } catch (toolLoopError) {
        // API failed mid-tool-loop — roll back partial tool exchange to prevent
        // corrupted history (consecutive user messages, orphaned tool_results)
        console.error(`[claude] Tool loop failed at round ${rounds}, rolling back ${history.length - historyLenBeforeTools} messages`);
        history.length = historyLenBeforeTools;
        sanitizeHistory(history);
        throw toolLoopError;
      }
    }

    const assistantMessage = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      || '...';

    // Add assistant response to history
    history.push({ role: 'assistant', content: assistantMessage });

    // Track last response for correction detection
    lastResponses.set(chatId, {
      text: assistantMessage,
      timestamp: Date.now(),
    });

    // Cross-chat context symmetry: extract user-specific context from conversation
    // and flow it into the CKB pipeline so knowledge persists across DM/group/shard
    _extractConversationContext(effectiveUserId, userName, chatId, chatType, messageText, assistantMessage).catch(() => {});

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

// ============ Cross-Chat Context Extraction ============
// After each conversation turn, extract user-specific context and store as CKB facts.
// This makes conversation-derived knowledge flow through the CKB pipeline (L1/L2),
// ensuring the same user gets identical knowledge in DM, group, or different shard.

const _contextExtractionThrottle = new Map(); // userId -> lastExtractTime
const EXTRACTION_COOLDOWN = 60 * 1000; // 1 min between extractions per user

async function _extractConversationContext(userId, userName, chatId, chatType, userMessage, assistantResponse) {
  if (!userMessage || userMessage.length < 30) return;
  if (!userId) return;

  // Throttle: max 1 extraction per minute per user
  const lastTime = _contextExtractionThrottle.get(String(userId)) || 0;
  if (Date.now() - lastTime < EXTRACTION_COOLDOWN) return;
  _contextExtractionThrottle.set(String(userId), Date.now());

  try {
    const response = await llmChat({
      max_tokens: 200,
      system: `You extract key user-specific facts from conversations. Only extract facts that are worth remembering long-term (preferences, personal info, decisions, project context). Return JSON:
{ "facts": [{ "content": "fact text", "category": "preference|factual|technical|project", "tags": ["tag1"] }] }
Return { "facts": [] } if nothing worth remembering. Be very selective — only persistent facts, not transient conversation topics.`,
      messages: [{
        role: 'user',
        content: `User (${userName}): "${userMessage.slice(0, 300)}"\nAssistant response: "${assistantResponse.slice(0, 200)}"`,
      }],
    });

    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.facts || result.facts.length === 0) return;

    // Learn each extracted fact via the CKB pipeline
    for (const fact of result.facts.slice(0, 3)) {
      if (fact.content && fact.content.length > 5) {
        await learnFact(userId, userName, chatId, chatType, fact.content, fact.category || 'factual', fact.tags || []);
      }
    }
  } catch {
    // Non-critical — silently fail
  }
}

// ============ Web Search ============
// Uses DuckDuckGo Instant Answer API (no API key needed) + fallback to scraping

async function _webSearch(query) {
  try {
    // DuckDuckGo Instant Answer API — free, no key needed
    const encoded = encodeURIComponent(query);
    const ddgUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(ddgUrl, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();

    const results = [];

    // Abstract (main answer)
    if (data.Abstract) {
      results.push(`**${data.Heading || 'Answer'}**: ${data.Abstract}`);
      if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`);
    }

    // Related topics
    if (data.RelatedTopics?.length > 0) {
      const topics = data.RelatedTopics
        .filter(t => t.Text)
        .slice(0, 5)
        .map(t => `- ${t.Text}`);
      if (topics.length > 0) {
        results.push('\nRelated:');
        results.push(...topics);
      }
    }

    // Infobox
    if (data.Infobox?.content?.length > 0) {
      const info = data.Infobox.content
        .slice(0, 5)
        .map(i => `- ${i.label}: ${i.value}`)
        .join('\n');
      results.push('\nInfo:\n' + info);
    }

    if (results.length === 0) {
      // Fallback: try DuckDuckGo HTML search
      return await _webSearchFallback(query);
    }

    return results.join('\n');
  } catch (err) {
    console.warn(`[claude] DDG search failed: ${err.message}`);
    return await _webSearchFallback(query);
  }
}

async function _webSearchFallback(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JarvisBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();

    // Extract result snippets from DDG HTML
    const snippets = [];
    const regex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 5) {
      const title = match[1].replace(/<[^>]+>/g, '').trim();
      const snippet = match[2].replace(/<[^>]+>/g, '').trim();
      if (title && snippet) {
        snippets.push(`**${title}**: ${snippet}`);
      }
    }

    if (snippets.length === 0) {
      return `No results found for "${query}". Try a different search query.`;
    }

    return `Search results for "${query}":\n\n${snippets.join('\n\n')}`;
  } catch (err) {
    return `Web search unavailable: ${err.message}. Try again later.`;
  }
}

// ============ Conversation Summarization ============
// When history exceeds threshold, summarize oldest messages into a knowledge entry

export async function summarizeConversationChunk(chatId, messages) {
  if (!messages || messages.length < 10) return null;

  try {
    const textMessages = messages
      .filter(m => typeof m.content === 'string')
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .slice(0, 20);

    if (textMessages.length < 5) return null;

    const response = await llmChat({
      max_tokens: 300,
      system: 'Summarize this conversation into 2-3 key takeaways. Focus on: decisions made, preferences expressed, facts learned, topics discussed. Return a JSON object: { "summary": "...", "keyFacts": ["fact1", "fact2"], "topics": ["topic1"] }',
      messages: [{
        role: 'user',
        content: textMessages.join('\n'),
      }],
    });

    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`[claude] Conversation summarization failed: ${err.message}`);
    return null;
  }
}
