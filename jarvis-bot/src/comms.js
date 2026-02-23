/**
 * @module comms
 * @description Bidirectional communication layer between JARVIS (Telegram bot)
 * and Claude Code (CLI). Enables full autopilot — no human relay needed.
 *
 * Architecture:
 *   Claude Code → HTTP POST /api/* → JARVIS (real-time)
 *   JARVIS → outbox file → git sync → Claude Code reads on next session
 *
 * All messages are persisted to data/comms.json for auditability.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const COMMS_FILE = join(config.dataDir, 'comms.json');

// In-memory state
let comms = {
  inbox: [],      // Messages FROM Claude Code (processed by JARVIS)
  outbox: [],     // Messages FROM JARVIS (awaiting Claude Code pickup)
  log: [],        // Audit trail of all messages (rolling 500)
};

// ============ Persistence ============

async function loadComms() {
  try {
    const data = await readFile(COMMS_FILE, 'utf-8');
    comms = JSON.parse(data);
    // Ensure structure
    if (!comms.inbox) comms.inbox = [];
    if (!comms.outbox) comms.outbox = [];
    if (!comms.log) comms.log = [];
  } catch {
    comms = { inbox: [], outbox: [], log: [] };
  }
}

async function saveComms() {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(COMMS_FILE, JSON.stringify(comms, null, 2));
}

// ============ Inbox (Claude Code → JARVIS) ============

/**
 * Receive a message from Claude Code.
 * Types: 'context_update', 'task', 'message', 'session_state', 'deploy_result'
 */
function receiveFromClaudeCode(message) {
  const entry = {
    id: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    direction: 'claude_code_to_jarvis',
    type: message.type || 'message',
    content: message.content,
    metadata: message.metadata || {},
    processed: false,
  };
  comms.inbox.push(entry);
  addToLog(entry);
  return entry;
}

/**
 * Get unprocessed inbox messages.
 */
function getUnprocessedInbox() {
  return comms.inbox.filter(m => !m.processed);
}

/**
 * Mark inbox message as processed.
 */
function markProcessed(messageId) {
  const msg = comms.inbox.find(m => m.id === messageId);
  if (msg) {
    msg.processed = true;
    msg.processedAt = new Date().toISOString();
  }
}

// ============ Outbox (JARVIS → Claude Code) ============

/**
 * Queue a message for Claude Code to pick up.
 * Types: 'intel_report', 'task_result', 'alert', 'status_update', 'message'
 */
function sendToClaudeCode(type, content, metadata = {}) {
  const entry = {
    id: `j-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    direction: 'jarvis_to_claude_code',
    type,
    content,
    metadata,
    acknowledged: false,
  };
  comms.outbox.push(entry);
  addToLog(entry);
  return entry;
}

/**
 * Get all unacknowledged outbox messages.
 */
function getOutbox() {
  return comms.outbox.filter(m => !m.acknowledged);
}

/**
 * Acknowledge receipt of outbox messages (Claude Code confirms it read them).
 * Pass specific IDs or 'all' to clear everything.
 */
function acknowledgeOutbox(ids) {
  if (ids === 'all') {
    comms.outbox.forEach(m => {
      m.acknowledged = true;
      m.acknowledgedAt = new Date().toISOString();
    });
  } else if (Array.isArray(ids)) {
    for (const id of ids) {
      const msg = comms.outbox.find(m => m.id === id);
      if (msg) {
        msg.acknowledged = true;
        msg.acknowledgedAt = new Date().toISOString();
      }
    }
  }
}

// ============ Audit Log ============

function addToLog(entry) {
  comms.log.push({
    id: entry.id,
    timestamp: entry.timestamp,
    direction: entry.direction,
    type: entry.type,
    contentPreview: typeof entry.content === 'string'
      ? entry.content.slice(0, 200)
      : JSON.stringify(entry.content).slice(0, 200),
  });
  // Rolling window — keep last 500 entries
  if (comms.log.length > 500) {
    comms.log = comms.log.slice(-500);
  }
}

/**
 * Get recent comms log.
 */
function getCommsLog(count = 20) {
  return comms.log.slice(-count);
}

/**
 * Get comms stats.
 */
function getCommsStats() {
  return {
    inboxTotal: comms.inbox.length,
    inboxUnprocessed: comms.inbox.filter(m => !m.processed).length,
    outboxTotal: comms.outbox.length,
    outboxPending: comms.outbox.filter(m => !m.acknowledged).length,
    logEntries: comms.log.length,
    lastActivity: comms.log.length > 0 ? comms.log[comms.log.length - 1].timestamp : null,
  };
}

// ============ Cleanup ============

/**
 * Prune old processed inbox and acknowledged outbox messages (older than 7 days).
 */
function pruneOldMessages() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  comms.inbox = comms.inbox.filter(m =>
    !m.processed || new Date(m.processedAt || m.timestamp).getTime() > cutoff
  );
  comms.outbox = comms.outbox.filter(m =>
    !m.acknowledged || new Date(m.acknowledgedAt || m.timestamp).getTime() > cutoff
  );
}

export {
  loadComms,
  saveComms,
  receiveFromClaudeCode,
  getUnprocessedInbox,
  markProcessed,
  sendToClaudeCode,
  getOutbox,
  acknowledgeOutbox,
  getCommsLog,
  getCommsStats,
  pruneOldMessages,
};
