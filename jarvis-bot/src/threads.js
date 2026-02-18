import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { config } from './config.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const DATA_DIR = join(homedir(), 'vibeswap', 'jarvis-bot', 'data');
const THREADS_FILE = join(DATA_DIR, 'threads.json');

// ============ Thread Archival ============
// When a conversation becomes substantive, Jarvis can archive it as a
// knowledge artifact. Future: bridge to Forum contract on-chain.
//
// Thread detection criteria:
// - 3+ participants in a reply chain
// - OR 5+ high-quality messages in a topic window
// - OR explicit /archive command

let threads = [];
let threadsDirty = false;

// In-memory tracking of active conversations
const activeConversations = new Map(); // chatId -> { messages: [], participants: Set, startTime }

const CONVERSATION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes — messages within this window are "same thread"
const MIN_MESSAGES_FOR_AUTO_DETECT = 5;
const MIN_PARTICIPANTS_FOR_AUTO_DETECT = 3;
const MIN_AVG_QUALITY_FOR_AUTO_DETECT = 3;

// ============ Init ============

export async function initThreads() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const data = await readFile(THREADS_FILE, 'utf-8');
    threads = JSON.parse(data);
  } catch {
    threads = [];
  }
  console.log(`[threads] Loaded ${threads.length} archived threads`);
}

async function saveThreads() {
  if (!threadsDirty) return;
  try {
    await writeFile(THREADS_FILE, JSON.stringify(threads, null, 2));
    threadsDirty = false;
  } catch {}
}

// ============ Track Messages for Thread Detection ============

export function trackForThread(chatId, userId, userName, text, quality, messageId) {
  const now = Date.now();

  if (!activeConversations.has(chatId)) {
    activeConversations.set(chatId, {
      messages: [],
      participants: new Set(),
      startTime: now,
    });
  }

  const conv = activeConversations.get(chatId);

  // Prune old messages outside the window
  conv.messages = conv.messages.filter(m => now - m.timestamp < CONVERSATION_WINDOW_MS);

  // If we pruned everything, this is a new conversation
  if (conv.messages.length === 0) {
    conv.participants = new Set();
    conv.startTime = now;
  }

  conv.messages.push({
    userId,
    userName,
    text: text.slice(0, 500), // Cap stored text for memory
    quality,
    timestamp: now,
    messageId,
  });

  conv.participants.add(userId);

  return conv;
}

// ============ Auto-Detection ============
// Returns true if the current conversation meets archival criteria

export function shouldSuggestArchival(chatId) {
  const conv = activeConversations.get(chatId);
  if (!conv) return false;

  const msgCount = conv.messages.length;
  const participantCount = conv.participants.size;

  if (msgCount < MIN_MESSAGES_FOR_AUTO_DETECT) return false;
  if (participantCount < MIN_PARTICIPANTS_FOR_AUTO_DETECT) return false;

  // Check average quality
  const totalQuality = conv.messages.reduce((sum, m) => sum + m.quality, 0);
  const avgQuality = totalQuality / msgCount;

  if (avgQuality < MIN_AVG_QUALITY_FOR_AUTO_DETECT) return false;

  // Check that we haven't already suggested recently for this conversation window
  const windowKey = `${chatId}_${Math.floor(conv.startTime / CONVERSATION_WINDOW_MS)}`;
  if (conv._suggested === windowKey) return false;

  conv._suggested = windowKey;
  return true;
}

// ============ Archive a Thread ============

export async function archiveThread(chatId, chatTitle, requestedBy) {
  const conv = activeConversations.get(chatId);
  if (!conv || conv.messages.length === 0) {
    return { success: false, error: 'No active conversation to archive.' };
  }

  // Generate summary using Haiku
  const messagesText = conv.messages
    .map(m => `[${m.userName}]: ${m.text}`)
    .join('\n');

  let summary = '';
  let topics = [];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `Summarize this community discussion thread in 2-3 sentences. Also extract 1-3 topic tags. Return JSON: { "summary": "...", "topics": ["topic1", "topic2"] }`,
      messages: [{ role: 'user', content: messagesText }],
    });

    const raw = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      summary = parsed.summary || '';
      topics = parsed.topics || [];
    }
  } catch {
    summary = `${conv.messages.length} messages from ${conv.participants.size} participants over ${Math.round((Date.now() - conv.startTime) / 60000)} minutes.`;
  }

  // Create thread artifact
  const threadHash = createHash('sha256')
    .update(`thread:${chatId}:${conv.startTime}:${conv.messages.length}`)
    .digest('hex');

  const thread = {
    id: threadHash.slice(0, 16),
    chatId,
    chatTitle: chatTitle || 'Unknown',
    timestamp: Date.now(),
    startTime: conv.startTime,
    endTime: Date.now(),
    duration: Date.now() - conv.startTime,
    messageCount: conv.messages.length,
    participants: [...conv.participants].map(id => {
      const msg = conv.messages.find(m => m.userId === id);
      return { userId: id, userName: msg?.userName || 'Unknown' };
    }),
    summary,
    topics,
    avgQuality: (conv.messages.reduce((s, m) => s + m.quality, 0) / conv.messages.length).toFixed(1),
    evidenceHash: threadHash,
    archivedBy: requestedBy,
    // Store message snapshots (privacy: truncated)
    messages: conv.messages.map(m => ({
      userName: m.userName,
      text: m.text.slice(0, 200),
      quality: m.quality,
      timestamp: m.timestamp,
    })),
  };

  threads.push(thread);
  threadsDirty = true;
  await saveThreads();

  // Clear the active conversation (it's been archived)
  activeConversations.delete(chatId);

  return { success: true, thread };
}

// ============ Query ============

export function getRecentThreads(chatId, limit = 10) {
  return threads
    .filter(t => !chatId || t.chatId === chatId)
    .slice(-limit);
}

export function getThreadById(threadId) {
  return threads.find(t => t.id === threadId) || null;
}

export function getThreadStats() {
  return {
    totalArchived: threads.length,
    totalMessages: threads.reduce((s, t) => s + t.messageCount, 0),
    totalParticipants: new Set(threads.flatMap(t => t.participants.map(p => p.userId))).size,
    topTopics: getTopTopics(),
  };
}

function getTopTopics() {
  const topicCounts = {};
  for (const thread of threads) {
    for (const topic of thread.topics) {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
  }
  return Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => `${topic}: ${count}`);
}

// ============ Flush ============

export async function flushThreads() {
  await saveThreads();
}
