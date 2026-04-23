// ============ Archive Query Tools ============
//
// Exposes the canonical chat archive to the LLM reply path so replies
// ground themselves in real history instead of inventing it. The archive
// is the substrate-gap overlay that makes Telegram history retroactively
// accessible to the bot (bots can't call getHistory; the archive is what
// we've been recording since deploy).
//
// Tools never take chatId from the model. The dispatcher injects the
// current chat's id from call context — the model can't query a chat
// it isn't in, and can't invent a chatId to exfiltrate another room's
// archive.

import {
  searchArchive,
  getRecentMessages,
  getUserMessages,
  getUserProfile,
  getMessagesByDate,
  getChatRoster,
} from './archive.js';

export const ARCHIVE_TOOLS = [
  {
    name: 'archive_recent',
    description: 'Read the most recent messages in THIS chat from the persisted archive. Use this whenever you are asked "what just happened", "what did X say", or need to anchor a reply in what was actually said. Returns compact records newest-first. Prefer this over guessing.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent messages to return (1–50, default 10).' },
      },
      required: [],
    },
  },
  {
    name: 'archive_search',
    description: 'Full-text substring search across THIS chat\'s archived messages. Case-insensitive. Use when asked "did we talk about X", "what was the Qwen thread", "find the message where Y said Z". Results newest-first.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to match against message text (case-insensitive).' },
        limit: { type: 'number', description: 'Max matches to return (1–50, default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'archive_user_messages',
    description: 'All recent messages posted in THIS chat by a specific user. Resolves the user by username (with or without @), numeric id, or first_name. Use this instead of guessing what someone has said or likes to talk about.',
    input_schema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'Username (e.g. "tadija_ninovic" or "@tadija_ninovic"), numeric Telegram id, or first_name.' },
        limit: { type: 'number', description: 'Max messages to return (1–50, default 10).' },
      },
      required: ['user'],
    },
  },
  {
    name: 'archive_user_profile',
    description: 'Grounded profile for a user in THIS chat: first_seen, last_seen, message count, message type breakdown, replies given/received. Every field is derived from the archive — none are inferred or invented. Returns null if the user has never posted here. Use this before making any factual claim about a user\'s history.',
    input_schema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'Username, numeric id, or first_name.' },
      },
      required: ['user'],
    },
  },
  {
    name: 'archive_day',
    description: 'All messages posted in THIS chat on a given UTC calendar day. Use for "what happened yesterday" / "what did we discuss on 2026-04-21". Returns chronological order.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'UTC date in YYYY-MM-DD form.' },
        limit: { type: 'number', description: 'Max messages to return (1–50, default 50).' },
      },
      required: ['date'],
    },
  },
  {
    name: 'archive_roster',
    description: 'List of users who have posted in THIS chat in the last N days (default 7). Use this to verify a user exists in the chat before addressing them by name. Username/first_name here is canonical — do not alter, truncate, or substitute nicknames.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (1–60, default 7).' },
      },
      required: [],
    },
  },
];

export const ARCHIVE_TOOL_NAMES = ARCHIVE_TOOLS.map(t => t.name);

// ============ Tool Handler ============
//
// Dispatcher. `chatId` is REQUIRED in context — it is never taken from the
// model's input. If it's missing we refuse to answer rather than guessing.

export async function handleArchiveTool(name, input, { chatId } = {}) {
  if (!chatId) {
    return JSON.stringify({ error: 'archive tool called without chatId context — refusing to answer' });
  }

  try {
    switch (name) {
      case 'archive_recent': {
        const limit = Number.isFinite(input?.limit) ? input.limit : undefined;
        const records = await getRecentMessages(chatId, limit);
        return JSON.stringify({ chatId, count: records.length, records });
      }
      case 'archive_search': {
        if (!input?.query || typeof input.query !== 'string') {
          return JSON.stringify({ error: 'archive_search requires a non-empty `query` string' });
        }
        const records = await searchArchive(chatId, input.query, input.limit);
        return JSON.stringify({ chatId, query: input.query, count: records.length, records });
      }
      case 'archive_user_messages': {
        if (!input?.user) {
          return JSON.stringify({ error: 'archive_user_messages requires `user`' });
        }
        const records = await getUserMessages(chatId, input.user, input.limit);
        return JSON.stringify({ chatId, user: input.user, count: records.length, records });
      }
      case 'archive_user_profile': {
        if (!input?.user) {
          return JSON.stringify({ error: 'archive_user_profile requires `user`' });
        }
        const profile = await getUserProfile(chatId, input.user);
        if (!profile) {
          return JSON.stringify({ chatId, user: input.user, profile: null, note: 'user has never posted in this chat — do not invent details about them' });
        }
        return JSON.stringify({ chatId, profile });
      }
      case 'archive_day': {
        if (!input?.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
          return JSON.stringify({ error: 'archive_day requires `date` in YYYY-MM-DD form' });
        }
        const records = await getMessagesByDate(chatId, input.date, input.limit);
        return JSON.stringify({ chatId, date: input.date, count: records.length, records });
      }
      case 'archive_roster': {
        const days = Number.isFinite(input?.days) ? Math.min(60, Math.max(1, input.days | 0)) : 7;
        const roster = await getChatRoster(chatId, days);
        return JSON.stringify({ chatId, windowDays: days, count: roster.length, roster });
      }
      default:
        return JSON.stringify({ error: `unknown archive tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `archive tool ${name} failed: ${err.message}` });
  }
}
