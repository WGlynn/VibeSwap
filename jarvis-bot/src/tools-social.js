// ============ Social & Productivity Tools ============
//
// Commands:
//   /save               — Bookmark a message (reply to save)
//   /bookmarks          — List your saved messages
//   /note <text>        — Save a personal note
//   /notes              — List your notes
//   /delnote <number>   — Delete a note by number
//   /quote              — Save a memorable quote (reply to save)
//   /quotes             — Show group's saved quotes
//   /tag <name> <text>  — Create a reusable text snippet
//   /tags               — List your tags
//   /t <name>           — Recall a tag
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const SOCIAL_FILE = join(DATA_DIR, 'social.json');
let dirty = false;

// ============ State ============

// userId -> [{ text, from, chatId, timestamp }]
const bookmarks = new Map();

// userId -> [{ text, timestamp }]
const notes = new Map();

// chatId -> [{ text, author, timestamp, savedBy }]
const quotes = new Map();

// userId -> Map<name, text>
const tags = new Map();

const MAX_BOOKMARKS = 50;
const MAX_NOTES = 100;
const MAX_QUOTES = 100;
const MAX_TAGS = 50;

// ============ Bookmarks ============

export function saveBookmark(userId, messageText, authorName, chatTitle) {
  if (!messageText) return 'Reply to a message to bookmark it.';

  if (!bookmarks.has(userId)) bookmarks.set(userId, []);
  const list = bookmarks.get(userId);

  if (list.length >= MAX_BOOKMARKS) {
    return `Bookmark limit reached (${MAX_BOOKMARKS}). Delete old ones first.`;
  }

  list.push({
    text: messageText.slice(0, 500),
    from: authorName,
    chat: chatTitle || 'DM',
    timestamp: Date.now(),
  });

  dirty = true;
  return `Bookmarked! You now have ${list.length} saved messages. View with /bookmarks`;
}

export function getBookmarks(userId, page = 1) {
  const list = bookmarks.get(userId);
  if (!list || list.length === 0) return 'No bookmarks yet. Reply to a message and use /save to bookmark it.';

  const perPage = 10;
  const totalPages = Math.ceil(list.length / perPage);
  const start = (page - 1) * perPage;
  const slice = list.slice(start, start + perPage);

  const lines = [`Bookmarks (${list.length} total)${totalPages > 1 ? ` — Page ${page}/${totalPages}` : ''}\n`];
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const age = formatAge(b.timestamp);
    const preview = b.text.length > 80 ? b.text.slice(0, 80) + '...' : b.text;
    lines.push(`  ${start + i + 1}. [${b.from}] ${preview} (${age})`);
  }

  if (totalPages > 1 && page < totalPages) {
    lines.push(`\n  /bookmarks ${page + 1} for next page`);
  }
  return lines.join('\n');
}

export function deleteBookmark(userId, index) {
  const list = bookmarks.get(userId);
  if (!list || index < 1 || index > list.length) return 'Invalid bookmark number.';
  list.splice(index - 1, 1);
  dirty = true;
  return `Bookmark #${index} deleted. ${list.length} remaining.`;
}

// ============ Notes ============

export function addNote(userId, text) {
  if (!text) return 'Usage: /note Buy ETH when fear index < 25';

  if (!notes.has(userId)) notes.set(userId, []);
  const list = notes.get(userId);

  if (list.length >= MAX_NOTES) {
    return `Note limit reached (${MAX_NOTES}). Delete old ones with /delnote.`;
  }

  list.push({ text: text.slice(0, 500), timestamp: Date.now() });
  dirty = true;
  return `Note saved (#${list.length}). View with /notes`;
}

export function getNotes(userId) {
  const list = notes.get(userId);
  if (!list || list.length === 0) return 'No notes yet. Save one with /note <text>';

  const lines = [`Your Notes (${list.length})\n`];
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const age = formatAge(n.timestamp);
    lines.push(`  ${i + 1}. ${n.text} (${age})`);
  }
  return lines.join('\n');
}

export function deleteNote(userId, index) {
  const list = notes.get(userId);
  if (!list || index < 1 || index > list.length) return 'Invalid note number.';
  list.splice(index - 1, 1);
  dirty = true;
  return `Note #${index} deleted. ${list.length} remaining.`;
}

// ============ Quotes ============

export function saveQuote(chatId, messageText, authorName, savedByName) {
  if (!messageText) return 'Reply to a message to save it as a quote.';

  if (!quotes.has(chatId)) quotes.set(chatId, []);
  const list = quotes.get(chatId);

  if (list.length >= MAX_QUOTES) {
    list.shift(); // Remove oldest to make room
  }

  list.push({
    text: messageText.slice(0, 500),
    author: authorName,
    savedBy: savedByName,
    timestamp: Date.now(),
  });

  dirty = true;
  return `Quote saved! "${messageText.slice(0, 60)}${messageText.length > 60 ? '...' : ''}" — ${authorName}`;
}

export function getQuotes(chatId, count = 5) {
  const list = quotes.get(chatId);
  if (!list || list.length === 0) return 'No quotes saved in this chat. Reply to a message and use /quote.';

  // Show random selection
  const shuffled = [...list].sort(() => Math.random() - 0.5).slice(0, count);

  const lines = [`Quotes (${list.length} total)\n`];
  for (const q of shuffled) {
    lines.push(`  "${q.text.slice(0, 120)}${q.text.length > 120 ? '...' : ''}"\n    — ${q.author}`);
  }
  return lines.join('\n');
}

// ============ Tags (reusable text snippets) ============

export function setTag(userId, name, text) {
  if (!name || !text) return 'Usage: /tag <name> <text>\n\nExample: /tag links Check vibeswap.io and our TG group';

  if (!tags.has(userId)) tags.set(userId, new Map());
  const userTags = tags.get(userId);

  if (userTags.size >= MAX_TAGS && !userTags.has(name.toLowerCase())) {
    return `Tag limit reached (${MAX_TAGS}). Delete old ones first.`;
  }

  userTags.set(name.toLowerCase(), text.slice(0, 1000));
  dirty = true;
  return `Tag "${name}" saved. Recall with /t ${name}`;
}

export function getTag(userId, name) {
  const userTags = tags.get(userId);
  if (!userTags) return `No tags saved. Create one with /tag <name> <text>`;
  const text = userTags.get(name.toLowerCase());
  if (!text) return `Tag "${name}" not found. Your tags: ${[...userTags.keys()].join(', ') || 'none'}`;
  return text;
}

export function listTags(userId) {
  const userTags = tags.get(userId);
  if (!userTags || userTags.size === 0) return 'No tags saved. Create one with /tag <name> <text>';

  const lines = [`Your Tags (${userTags.size})\n`];
  for (const [name, text] of userTags) {
    lines.push(`  /t ${name} — ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
  }
  return lines.join('\n');
}

export function deleteTag(userId, name) {
  const userTags = tags.get(userId);
  if (!userTags || !userTags.has(name.toLowerCase())) return `Tag "${name}" not found.`;
  userTags.delete(name.toLowerCase());
  dirty = true;
  return `Tag "${name}" deleted.`;
}

// ============ Persistence ============

export async function initSocial() {
  try {
    const data = await readFile(SOCIAL_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.bookmarks) {
      for (const [id, list] of Object.entries(parsed.bookmarks)) {
        bookmarks.set(Number(id), list);
      }
    }
    if (parsed.notes) {
      for (const [id, list] of Object.entries(parsed.notes)) {
        notes.set(Number(id), list);
      }
    }
    if (parsed.quotes) {
      for (const [id, list] of Object.entries(parsed.quotes)) {
        quotes.set(Number(id), list);
      }
    }
    if (parsed.tags) {
      for (const [id, tagObj] of Object.entries(parsed.tags)) {
        tags.set(Number(id), new Map(Object.entries(tagObj)));
      }
    }
    console.log(`[social] Loaded ${bookmarks.size} bookmark users, ${notes.size} note users, ${quotes.size} quote chats, ${tags.size} tag users`);
  } catch {
    console.log('[social] No saved social data — starting fresh');
  }
}

export async function flushSocial() {
  if (!dirty) return;
  try {
    const obj = {
      bookmarks: Object.fromEntries(bookmarks),
      notes: Object.fromEntries(notes),
      quotes: Object.fromEntries(quotes),
      tags: {},
    };
    // Convert tag Maps to plain objects
    for (const [id, tagMap] of tags) {
      obj.tags[id] = Object.fromEntries(tagMap);
    }
    await writeFile(SOCIAL_FILE, JSON.stringify(obj, null, 2));
    dirty = false;
  } catch (err) {
    console.warn(`[social] Flush failed: ${err.message}`);
  }
}

// ============ Helpers ============

function formatAge(timestamp) {
  const ms = Date.now() - timestamp;
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}
