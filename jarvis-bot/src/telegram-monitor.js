/**
 * @module telegram-monitor
 * @description Monitors public Telegram groups using MTProto (GramJS).
 *
 * Unlike the Bot API, MTProto can read public groups without joining.
 * Requires one-time phone auth → generates a session string for reuse.
 *
 * Flow:
 *   1. Will runs /monitor-setup → enters phone, code, password
 *   2. Session string saved to data/mtproto-session.txt
 *   3. On startup, monitor auto-connects and polls configured groups
 *   4. Summaries available via /intel <group> or periodic digest
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const SESSION_FILE = join(config.dataDir, 'mtproto-session.txt');
const INTEL_FILE = join(config.dataDir, 'group-intel.json');

// Telegram API credentials — get from https://my.telegram.org/apps
const API_ID = parseInt(process.env.TG_API_ID || '0');
const API_HASH = process.env.TG_API_HASH || '';

// Groups to monitor (public usernames, no @)
const MONITORED_GROUPS = (process.env.MONITORED_GROUPS || 'NervosNation').split(',').map(g => g.trim());

// How often to poll (ms) — default 10 minutes
const POLL_INTERVAL = parseInt(process.env.MONITOR_POLL_INTERVAL || '600000');

// How many messages to fetch per poll
const MESSAGES_PER_POLL = 50;

let client = null;
let isConnected = false;
let pollTimer = null;

// In-memory intel buffer — persisted to INTEL_FILE
let intel = {};

// ============ Session Management ============

async function loadSession() {
  try {
    const data = await readFile(SESSION_FILE, 'utf-8');
    return data.trim();
  } catch {
    return '';
  }
}

async function saveSession(sessionStr) {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(SESSION_FILE, sessionStr);
}

// ============ Intel Storage ============

async function loadIntel() {
  try {
    const data = await readFile(INTEL_FILE, 'utf-8');
    intel = JSON.parse(data);
  } catch {
    intel = {};
  }
}

async function saveIntel() {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(INTEL_FILE, JSON.stringify(intel, null, 2));
}

function getGroupIntel(groupName) {
  if (!intel[groupName]) {
    intel[groupName] = {
      messages: [],       // Recent messages (rolling window)
      lastMessageId: 0,   // Track what we've already seen
      lastPoll: null,
      summaries: [],       // AI-generated summaries
    };
  }
  return intel[groupName];
}

// ============ Client Setup ============

function isConfigured() {
  return API_ID > 0 && API_HASH.length > 0;
}

async function connectClient() {
  if (!isConfigured()) {
    console.log('[monitor] TG_API_ID / TG_API_HASH not set — monitor disabled.');
    return false;
  }

  const sessionStr = await loadSession();
  if (!sessionStr) {
    console.log('[monitor] No session found. Use /monitor-setup to authenticate.');
    return false;
  }

  try {
    const session = new StringSession(sessionStr);
    client = new TelegramClient(session, API_ID, API_HASH, {
      connectionRetries: 3,
    });

    await client.connect();
    isConnected = true;
    console.log('[monitor] MTProto client connected.');
    return true;
  } catch (err) {
    console.error(`[monitor] Connection failed: ${err.message}`);
    isConnected = false;
    return false;
  }
}

// ============ Interactive Auth (via Telegram bot) ============

/**
 * Runs interactive phone auth through the Telegram bot chat.
 * Will sends /monitor-setup, then responds to prompts for phone, code, password.
 */
async function interactiveAuth(ctx, botInstance) {
  if (!isConfigured()) {
    await ctx.reply(
      'Monitor not configured. Set these env vars on Fly.io:\n\n' +
      '  TG_API_ID=<from my.telegram.org/apps>\n' +
      '  TG_API_HASH=<from my.telegram.org/apps>\n\n' +
      'Then restart and run /monitor-setup again.'
    );
    return false;
  }

  const session = new StringSession('');
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
  });

  // We need to collect phone, code, and maybe password interactively
  let resolvePhone, resolveCode, resolvePassword;
  const phonePromise = new Promise(r => { resolvePhone = r; });
  const codePromise = new Promise(r => { resolveCode = r; });
  const passwordPromise = new Promise(r => { resolvePassword = r; });

  // Set up a temporary message listener
  let authStep = 'phone'; // phone → code → password
  const chatId = ctx.chat.id;

  const tempHandler = (msgCtx) => {
    if (msgCtx.chat.id !== chatId || msgCtx.from.id !== config.ownerUserId) return;
    const text = msgCtx.message?.text?.trim();
    if (!text || text.startsWith('/')) return;

    if (authStep === 'phone') {
      resolvePhone(text);
      authStep = 'code';
    } else if (authStep === 'code') {
      resolveCode(text);
      authStep = 'password';
    } else if (authStep === 'password') {
      resolvePassword(text);
    }
  };

  botInstance.on('text', tempHandler);

  try {
    await ctx.reply('Starting MTProto auth. Send your phone number (with country code, e.g. +1234567890):');

    await client.start({
      phoneNumber: async () => {
        return await phonePromise;
      },
      phoneCode: async () => {
        await ctx.reply('Code sent to your Telegram. Send it here:');
        return await codePromise;
      },
      password: async () => {
        await ctx.reply('2FA password required. Send it here (will be used once, not stored):');
        return await passwordPromise;
      },
      onError: (err) => {
        ctx.reply(`Auth error: ${err.message}`);
      },
    });

    // Save session
    const sessionStr = client.session.save();
    await saveSession(sessionStr);
    isConnected = true;

    await ctx.reply(
      'MTProto authenticated! Session saved.\n\n' +
      `Monitoring: ${MONITORED_GROUPS.join(', ')}\n` +
      `Poll interval: ${POLL_INTERVAL / 60000} minutes\n\n` +
      'Use /intel to see latest group activity.'
    );

    return true;
  } catch (err) {
    await ctx.reply(`Auth failed: ${err.message}`);
    return false;
  }
}

// ============ Message Fetching ============

async function fetchGroupMessages(groupUsername) {
  if (!isConnected || !client) return [];

  try {
    const entity = await client.getEntity(groupUsername);
    const groupIntel = getGroupIntel(groupUsername);

    const params = {
      limit: MESSAGES_PER_POLL,
    };

    // Only fetch messages newer than what we've seen
    if (groupIntel.lastMessageId > 0) {
      params.minId = groupIntel.lastMessageId;
    }

    const messages = await client.getMessages(entity, params);

    const parsed = [];
    for (const msg of messages) {
      if (!msg.message) continue; // Skip non-text (media, actions, etc.)

      let senderName = 'Unknown';
      try {
        if (msg.senderId) {
          const sender = await client.getEntity(msg.senderId);
          senderName = sender.firstName || sender.username || `User${msg.senderId}`;
        }
      } catch {
        senderName = `User${msg.senderId || '?'}`;
      }

      parsed.push({
        id: msg.id,
        date: msg.date, // Unix timestamp
        sender: senderName,
        text: msg.message.slice(0, 500), // Cap length
        replyTo: msg.replyTo?.replyToMsgId || null,
      });
    }

    // Update intel
    if (parsed.length > 0) {
      const maxId = Math.max(...parsed.map(m => m.id));
      groupIntel.lastMessageId = Math.max(groupIntel.lastMessageId, maxId);

      // Rolling window: keep last 200 messages
      groupIntel.messages = [...groupIntel.messages, ...parsed].slice(-200);
    }
    groupIntel.lastPoll = new Date().toISOString();

    return parsed;
  } catch (err) {
    console.error(`[monitor] Failed to fetch ${groupUsername}: ${err.message}`);
    return [];
  }
}

// ============ Polling Loop ============

async function pollAll() {
  if (!isConnected) return;

  let totalNew = 0;
  for (const group of MONITORED_GROUPS) {
    const messages = await fetchGroupMessages(group);
    totalNew += messages.length;
  }

  if (totalNew > 0) {
    await saveIntel();
    console.log(`[monitor] Polled ${MONITORED_GROUPS.length} groups — ${totalNew} new messages.`);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);

  // Initial poll immediately
  pollAll().catch(err => console.error(`[monitor] Poll error: ${err.message}`));

  // Then on interval
  pollTimer = setInterval(() => {
    pollAll().catch(err => console.error(`[monitor] Poll error: ${err.message}`));
  }, POLL_INTERVAL);

  console.log(`[monitor] Polling started — every ${POLL_INTERVAL / 60000} min — groups: ${MONITORED_GROUPS.join(', ')}`);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ============ Intel Formatting ============

function formatIntelReport(groupName, maxMessages = 20) {
  const groupIntel = getGroupIntel(groupName);

  if (groupIntel.messages.length === 0) {
    return `No intel from ${groupName} yet. ${groupIntel.lastPoll ? `Last poll: ${groupIntel.lastPoll}` : 'Never polled.'}`;
  }

  const recent = groupIntel.messages.slice(-maxMessages);
  const lines = [`Intel from ${groupName} (${recent.length} recent messages):\n`];

  for (const msg of recent) {
    const time = new Date(msg.date * 1000).toISOString().slice(11, 16);
    const text = msg.text.length > 120 ? msg.text.slice(0, 120) + '...' : msg.text;
    lines.push(`[${time}] ${msg.sender}: ${text}`);
  }

  lines.push(`\nLast poll: ${groupIntel.lastPoll}`);
  lines.push(`Total buffered: ${groupIntel.messages.length} messages`);

  return lines.join('\n');
}

function getMonitorStatus() {
  const lines = [
    `Monitor: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`,
    `Configured: ${isConfigured() ? 'YES' : 'NO (need TG_API_ID + TG_API_HASH)'}`,
    `Groups: ${MONITORED_GROUPS.join(', ')}`,
    `Poll interval: ${POLL_INTERVAL / 60000} min`,
    `Polling: ${pollTimer ? 'ACTIVE' : 'STOPPED'}`,
    '',
  ];

  for (const group of MONITORED_GROUPS) {
    const gi = intel[group];
    if (gi) {
      lines.push(`${group}: ${gi.messages.length} messages buffered, last poll ${gi.lastPoll || 'never'}`);
    } else {
      lines.push(`${group}: no data yet`);
    }
  }

  return lines.join('\n');
}

/**
 * Get raw messages for Claude to analyze
 */
function getMessagesForAnalysis(groupName, count = 50) {
  const groupIntel = getGroupIntel(groupName);
  return groupIntel.messages.slice(-count);
}

// ============ Init ============

async function initMonitor() {
  await loadIntel();

  if (!isConfigured()) {
    console.log('[monitor] TG_API_ID/TG_API_HASH not set — group monitor disabled.');
    console.log('[monitor] To enable: set TG_API_ID and TG_API_HASH env vars, then /monitor-setup');
    return;
  }

  const connected = await connectClient();
  if (connected) {
    startPolling();
  }
}

export {
  initMonitor,
  interactiveAuth,
  fetchGroupMessages,
  formatIntelReport,
  getMonitorStatus,
  getMessagesForAnalysis,
  startPolling,
  stopPolling,
  isConnected as monitorConnected,
  MONITORED_GROUPS,
};
