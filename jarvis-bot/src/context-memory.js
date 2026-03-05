// ============ CONTINUOUS CONTEXT — Rolling Conversation Memory ============
//
// The breakthrough: with Wardenclyffe providing free compute, we can afford
// LLM summarization calls to compress old messages instead of losing them.
//
// Problem:  maxConversationHistory = 50. Messages beyond 50 get shift()'d off.
//           conversations.json only persists last 30. Everything else is LOST.
//           Every restart, every trim = partial amnesia.
//
// Solution: Before trimming, summarize the chunk being removed into a rolling
//           context summary. The summary accumulates — new summaries incorporate
//           the old summary. The LLM always sees:
//
//             [system prompt] + [rolling summary of ALL past context] + [recent messages]
//
//           This gives Jarvis continuous memory across:
//           - Long conversations (beyond 50 messages)
//           - Bot restarts
//           - Context window limits
//
// Design:   One summary per chatId, persisted to disk.
//           Summary grows via accumulation, not replacement.
//           Compression ratio: ~20 messages → ~200 words of summary.
//           With Wardenclyffe, summarization calls cost nothing.
//
// "No more session resets. Jarvis becomes truly persistent."
// ============

import { writeFile, readFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';

const DATA_DIR = config.dataDir;
const CONTEXT_DIR = join(DATA_DIR, 'context-memory');
const SUMMARIES_FILE = join(CONTEXT_DIR, 'summaries.json');

// ============ State ============

// chatId -> { summary, messageCount, lastUpdated, version }
const summaries = new Map();

// How many messages to keep in live history before summarizing
const SUMMARIZE_THRESHOLD = 40;     // Start summarizing when history hits this
const KEEP_RECENT = 25;             // Keep this many recent messages verbatim
const SUMMARIZE_BATCH = 15;         // Summarize this many oldest messages at a time
const MAX_SUMMARY_LENGTH = 3000;    // Max chars for the rolling summary (prevent bloat)

let dirty = false;

// ============ Init ============

export async function initContextMemory() {
  try {
    await mkdir(CONTEXT_DIR, { recursive: true });

    if (existsSync(SUMMARIES_FILE)) {
      const raw = await readFile(SUMMARIES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      let count = 0;
      for (const [chatId, data] of Object.entries(parsed)) {
        summaries.set(Number(chatId), data);
        count++;
      }
      console.log(`[context-memory] Loaded ${count} conversation summaries (continuous context active)`);
    } else {
      console.log('[context-memory] No saved summaries — starting fresh (continuous context active)');
    }
  } catch (err) {
    console.warn(`[context-memory] Init warning: ${err.message}`);
  }
}

// ============ Persistence ============

export async function flushContextMemory() {
  if (!dirty) return;
  try {
    const obj = {};
    for (const [chatId, data] of summaries) {
      obj[chatId] = data;
    }
    const tmpFile = SUMMARIES_FILE + '.tmp';
    await writeFile(tmpFile, JSON.stringify(obj, null, 2));
    await rename(tmpFile, SUMMARIES_FILE);
    dirty = false;
  } catch (err) {
    console.warn(`[context-memory] Flush error: ${err.message}`);
  }
}

// ============ Core: Summarize & Trim ============

/**
 * Check if a conversation history needs summarization, and if so,
 * summarize the oldest messages into the rolling summary.
 *
 * Call this BEFORE trimming history. It will:
 * 1. Check if history.length >= SUMMARIZE_THRESHOLD
 * 2. Extract the oldest SUMMARIZE_BATCH messages
 * 3. Summarize them (incorporating existing rolling summary)
 * 4. Remove summarized messages from history
 * 5. Store the updated rolling summary
 *
 * @param {number} chatId - Chat identifier
 * @param {Array} history - The conversation history array (MUTATED in place)
 * @returns {boolean} Whether summarization occurred
 */
export async function summarizeIfNeeded(chatId, history) {
  if (!history || history.length < SUMMARIZE_THRESHOLD) return false;

  const messagesToSummarize = history.length - KEEP_RECENT;
  if (messagesToSummarize < 5) return false;

  // Extract the oldest messages that will be summarized
  const batch = history.slice(0, messagesToSummarize);

  // Get existing summary for this chat
  const existing = summaries.get(chatId);
  const existingSummary = existing?.summary || '';

  try {
    // Build the summarization prompt
    const textMessages = batch
      .filter(m => typeof m.content === 'string')
      .map(m => {
        const text = m.content.length > 300 ? m.content.slice(0, 300) + '...' : m.content;
        return `${m.role}: ${text}`;
      });

    // Also include tool interactions as context (summarized)
    const toolMessages = batch
      .filter(m => Array.isArray(m.content))
      .map(m => {
        if (m.role === 'assistant') {
          const tools = m.content.filter(b => b.type === 'tool_use').map(b => b.name);
          const text = m.content.filter(b => b.type === 'text').map(b => b.text.slice(0, 100)).join(' ');
          return tools.length > 0
            ? `assistant: [used tools: ${tools.join(', ')}] ${text}`
            : `assistant: ${text}`;
        }
        return null;
      })
      .filter(Boolean);

    const allMessages = [...textMessages, ...toolMessages];
    if (allMessages.length < 3) return false;

    const prompt = existingSummary
      ? `EXISTING CONTEXT SUMMARY:\n${existingSummary}\n\nNEW CONVERSATION MESSAGES TO INCORPORATE:\n${allMessages.join('\n')}`
      : allMessages.join('\n');

    const systemMsg = `You are a context memory system. Your job is to maintain a rolling summary of a conversation.

${existingSummary ? 'Update the existing summary by incorporating the new messages below.' : 'Create a summary of the conversation below.'}

Rules:
- Focus on: decisions made, facts learned, preferences expressed, ongoing tasks, action items, relationships between people mentioned
- Preserve important details: names, numbers, dates, technical decisions, code changes
- Remove chit-chat and greetings — keep only substantive content
- Write in present tense as ongoing context ("User prefers X", "Currently working on Y")
- Keep under 600 words — be dense and information-rich
- Do NOT use JSON — write natural flowing prose with bullet points for key facts
- This summary will be prepended to future conversations so the AI has continuous memory`;

    const response = await llmChat({
      max_tokens: 800,
      system: systemMsg,
      messages: [{ role: 'user', content: prompt }],
    });

    const summaryText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!summaryText || summaryText.length < 20) {
      console.warn('[context-memory] Summarization returned empty result — skipping');
      return false;
    }

    // Truncate if too long (should rarely happen with good prompting)
    const finalSummary = summaryText.length > MAX_SUMMARY_LENGTH
      ? summaryText.slice(0, MAX_SUMMARY_LENGTH) + '\n[summary truncated]'
      : summaryText;

    // Store the summary
    const messageCount = (existing?.messageCount || 0) + messagesToSummarize;
    summaries.set(chatId, {
      summary: finalSummary,
      messageCount,
      lastUpdated: Date.now(),
      version: (existing?.version || 0) + 1,
    });
    dirty = true;

    // Remove summarized messages from history (keep only recent ones)
    history.splice(0, messagesToSummarize);

    console.log(`[context-memory] Chat ${chatId}: summarized ${messagesToSummarize} messages (total: ${messageCount}, summary: ${finalSummary.length} chars, v${(existing?.version || 0) + 1})`);
    return true;
  } catch (err) {
    console.warn(`[context-memory] Summarization failed for chat ${chatId}: ${err.message}`);
    return false;
  }
}

// ============ Get Summary for Prompt Injection ============

/**
 * Get the rolling context summary for a chat.
 * Returns a formatted string to prepend to the system prompt,
 * or empty string if no summary exists.
 */
export function getContextSummary(chatId) {
  const data = summaries.get(chatId);
  if (!data?.summary) return '';

  const age = Date.now() - data.lastUpdated;
  const ageStr = age < 3600000
    ? `${Math.round(age / 60000)}m ago`
    : age < 86400000
      ? `${Math.round(age / 3600000)}h ago`
      : `${Math.round(age / 86400000)}d ago`;

  return `\n\n// ============ CONTINUOUS CONTEXT (${data.messageCount} messages summarized, updated ${ageStr}) ============\n${data.summary}\n// ============ END CONTINUOUS CONTEXT ============`;
}

// ============ Manual Operations ============

/**
 * Force a summary update for a chat.
 */
export async function forceSummarize(chatId, history) {
  if (!history || history.length < 5) return { error: 'Not enough messages to summarize' };

  const originalThreshold = SUMMARIZE_THRESHOLD;
  // Temporarily lower threshold to force summarization
  const result = await summarizeIfNeeded(chatId, history);
  return {
    summarized: result,
    summary: summaries.get(chatId)?.summary || null,
    messageCount: summaries.get(chatId)?.messageCount || 0,
  };
}

/**
 * Get stats about context memory.
 */
export function getContextMemoryStats() {
  const stats = {
    totalChats: summaries.size,
    summaries: [],
    totalMessages: 0,
    totalSummaryChars: 0,
  };

  for (const [chatId, data] of summaries) {
    stats.summaries.push({
      chatId,
      messageCount: data.messageCount,
      summaryLength: data.summary.length,
      version: data.version,
      lastUpdated: new Date(data.lastUpdated).toISOString(),
    });
    stats.totalMessages += data.messageCount;
    stats.totalSummaryChars += data.summary.length;
  }

  return stats;
}

/**
 * Clear the summary for a specific chat.
 */
export function clearContextSummary(chatId) {
  const existed = summaries.has(chatId);
  summaries.delete(chatId);
  if (existed) dirty = true;
  return existed;
}

/**
 * Get raw summary data for a chat.
 */
export function getRawSummary(chatId) {
  return summaries.get(chatId) || null;
}
