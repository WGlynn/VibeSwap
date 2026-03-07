// ============ GROUP CONTEXT PRIMITIVE — Sliding Window for Group Chats ============
//
// The problem:  When Jarvis is addressed in a group, he sees conversation history
//               but has no clean, structured view of WHAT was just discussed.
//               Buffered messages merge into long user blocks. Proactive responses
//               don't track in history. recentContext is always ''.
//
// The fix:      A sliding window of recent group messages — both human and Jarvis.
//               Injected as explicit context whenever Jarvis responds.
//               Three roles:
//
//               1. EXPLICIT RECENT CONTEXT — last N messages, timestamped, clean
//               2. SELF-TRACKING — what Jarvis already said (no phantom responses)
//               3. PROACTIVE FEED — gives triage real context instead of ''
//
// Persisted to disk so context survives deploys/restarts.
// "Jarvis doesn't just hear the last thing said. He hears the whole room."
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const CONTEXT_FILE = join(DATA_DIR, 'group-context.json');

// chatId -> GroupContextWindow
const contextWindows = new Map();

// ============ Configuration ============

const MAX_WINDOW_SIZE = 30;         // Keep last 30 messages per group
const MAX_MSG_LENGTH = 500;         // Cap individual messages to prevent bloat
const MAX_JARVIS_TRACKED = 10;      // Track last 10 Jarvis responses
const STALE_THRESHOLD_MS = 3600000; // Messages older than 1 hour are "stale"

// ============ Context Window ============

class GroupContextWindow {
  constructor() {
    this.messages = [];
    this.jarvisResponses = [];
  }

  push(user, text, messageId, isJarvis = false) {
    const entry = {
      user,
      text: typeof text === 'string' ? text.slice(0, MAX_MSG_LENGTH) : String(text).slice(0, MAX_MSG_LENGTH),
      timestamp: Date.now(),
      messageId,
      isJarvis,
    };

    this.messages.push(entry);
    while (this.messages.length > MAX_WINDOW_SIZE) {
      this.messages.shift();
    }

    if (isJarvis) {
      this.jarvisResponses.push(entry);
      while (this.jarvisResponses.length > MAX_JARVIS_TRACKED) {
        this.jarvisResponses.shift();
      }
    }
  }

  // Format as a structured context block for system prompt injection
  format() {
    if (this.messages.length === 0) return '';

    // Filter out stale messages for the formatted view
    const now = Date.now();
    const recent = this.messages.filter(m => (now - m.timestamp) < STALE_THRESHOLD_MS);
    if (recent.length === 0) return '';

    const lines = recent.map(m => {
      const age = Math.round((now - m.timestamp) / 1000);
      const ageStr = age < 60 ? `${age}s ago`
        : age < 3600 ? `${Math.round(age / 60)}m ago`
        : `${Math.round(age / 3600)}h ago`;
      const prefix = m.isJarvis ? 'JARVIS' : m.user;
      return `  [${prefix}] (${ageStr}): ${m.text}`;
    });

    return '\n\n// ============ RECENT GROUP CONVERSATION ============\n'
      + '// These are the last few messages in this group chat.\n'
      + '// Pay close attention to the flow of conversation — who said what,\n'
      + '// what topics are being discussed, and what questions were asked.\n'
      + '// When someone addresses you, respond to the SUBSTANCE of the\n'
      + '// ongoing discussion, not just the literal text of their message.\n'
      + lines.join('\n')
      + '\n// ============ END RECENT GROUP CONVERSATION ============';
  }

  // Plain text recent context for proactive intelligence triage
  recentPlain(limit = 10) {
    const slice = this.messages.slice(-limit);
    if (slice.length === 0) return '';
    return slice.map(m => {
      const prefix = m.isJarvis ? 'JARVIS' : m.user;
      return `[${prefix}]: ${m.text}`;
    }).join('\n');
  }

  // What Jarvis last said (for self-awareness — prevents repeating himself)
  lastJarvisResponse() {
    return this.jarvisResponses.length > 0
      ? this.jarvisResponses[this.jarvisResponses.length - 1]
      : null;
  }
}

// ============ Public API ============

/**
 * Record a message in the group context window.
 * Call this for EVERY group message — human or Jarvis.
 */
export function pushGroupMessage(chatId, userName, text, messageId, isJarvis = false) {
  if (!contextWindows.has(chatId)) {
    contextWindows.set(chatId, new GroupContextWindow());
  }
  contextWindows.get(chatId).push(userName, text, messageId, isJarvis);
}

/**
 * Get formatted group context for system prompt injection.
 * Returns a block like:
 *   // ============ RECENT GROUP CONVERSATION ============
 *   [Will] (2m ago): What do you think about X?
 *   [Herbert] (1m ago): I think we should democratize it
 *   [JARVIS] (30s ago): Interesting point — but consider...
 *   // ============ END RECENT GROUP CONVERSATION ============
 */
export function getGroupContext(chatId) {
  return contextWindows.get(chatId)?.format() || '';
}

/**
 * Get plain-text recent context for proactive intelligence.
 * Replaces the empty '' that was passed to analyzeMessage.
 */
export function getRecentContext(chatId, limit = 10) {
  return contextWindows.get(chatId)?.recentPlain(limit) || '';
}

/**
 * Get what Jarvis last said in this group (for self-awareness).
 */
export function getLastJarvisMessage(chatId) {
  return contextWindows.get(chatId)?.lastJarvisResponse() || null;
}

/**
 * Get stats for health endpoint.
 */
export function getGroupContextStats() {
  const stats = { groups: contextWindows.size, totalMessages: 0 };
  for (const [, w] of contextWindows) {
    stats.totalMessages += w.messages.length;
  }
  return stats;
}

// ============ Persistence ============
// Save/load context windows so they survive deploys and restarts.

let contextDirty = false;

// ============ Periodic Cleanup ============
// Remove stale context windows — groups with no recent activity

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Every 6 hours
const WINDOW_EXPIRY_MS = 24 * 60 * 60 * 1000;   // 24 hours no activity → evict

setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [chatId, win] of contextWindows) {
    const newest = win.messages.length > 0
      ? win.messages[win.messages.length - 1].timestamp
      : 0;
    if (now - newest > WINDOW_EXPIRY_MS) {
      contextWindows.delete(chatId);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[group-context] Cleanup: evicted ${evicted} stale context windows (${contextWindows.size} remaining)`);
    contextDirty = true;
  }
}, CLEANUP_INTERVAL_MS);

// Mark dirty when a message is pushed (called from pushGroupMessage wrapper below isn't needed —
// we just set it inside push since pushGroupMessage already calls push)
const _originalPush = GroupContextWindow.prototype.push;
GroupContextWindow.prototype.push = function (...args) {
  contextDirty = true;
  return _originalPush.call(this, ...args);
};

export async function initGroupContext() {
  try {
    const data = await readFile(CONTEXT_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    for (const [chatId, windowData] of Object.entries(parsed)) {
      const win = new GroupContextWindow();
      // Restore messages — only keep non-stale ones
      const now = Date.now();
      for (const msg of windowData.messages || []) {
        if (now - msg.timestamp < STALE_THRESHOLD_MS * 2) { // 2 hour window for restored context
          win.messages.push(msg);
        }
      }
      // Restore jarvis responses
      for (const msg of windowData.jarvisResponses || []) {
        if (now - msg.timestamp < STALE_THRESHOLD_MS * 2) {
          win.jarvisResponses.push(msg);
        }
      }
      if (win.messages.length > 0) {
        contextWindows.set(Number(chatId), win);
      }
    }
    console.log(`[group-context] Restored ${contextWindows.size} group context windows`);
  } catch {
    console.log('[group-context] No saved context — starting fresh');
  }
}

export async function flushGroupContext() {
  if (!contextDirty) return;
  const obj = {};
  for (const [chatId, win] of contextWindows) {
    obj[chatId] = {
      messages: win.messages,
      jarvisResponses: win.jarvisResponses,
    };
  }
  await writeFile(CONTEXT_FILE, JSON.stringify(obj));
  contextDirty = false;
}
