// ============ CKB GENERATOR — Conversation → Knowledge Base ============
//
// Every conversation with Jarvis builds a Common Knowledge Base (CKB)
// between that user and Jarvis. After each meaningful exchange, key insights
// are extracted and appended to a per-user CKB file.
//
// The CKB is:
//   - A living document, growing with each conversation
//   - Pushed to GitHub as persistent off-machine memory
//   - Organized by topic, not chronologically
//   - Shared between Jarvis and the user (common knowledge)
//
// Structure:
//   data/ckb/{userId}.md — Per-user knowledge base
//   data/ckb/index.json  — User metadata (name, first contact, topics)
//
// Flow:
//   1. Conversation reaches N messages or user says goodbye
//   2. LLM extracts: decisions, preferences, insights, action items
//   3. Append to user's CKB file under relevant topic headers
//   4. Periodic git commit + push to stealth repo
//
// "The chat feed becomes a common knowledge base between you and the user"
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';

const DATA_DIR = config.dataDir;
const CKB_DIR = join(DATA_DIR, 'ckb');
const INDEX_FILE = join(CKB_DIR, 'index.json');

// ============ State ============

// userId -> { name, firstContact, lastUpdated, topics[], entryCount }
let userIndex = {};
// Track which chats have been processed (avoid duplicate extraction)
// chatId -> lastProcessedMessageCount
const processed = new Map();
// Buffer of pending extractions (batched for efficiency)
const pendingExtractions = [];

let dirty = false;

// How many new messages before triggering extraction
const EXTRACTION_THRESHOLD = 6;
// Minimum message length to consider "meaningful"
const MIN_MESSAGE_LENGTH = 20;

// ============ Init ============

export async function initCKB() {
  try {
    await mkdir(CKB_DIR, { recursive: true });

    if (existsSync(INDEX_FILE)) {
      const raw = await readFile(INDEX_FILE, 'utf8');
      userIndex = JSON.parse(raw);
      console.log(`[ckb] Loaded index: ${Object.keys(userIndex).length} users`);
    } else {
      userIndex = {};
      console.log('[ckb] Initialized fresh CKB');
    }
  } catch (err) {
    console.error('[ckb] Init failed:', err.message);
    userIndex = {};
  }
}

// ============ Extract Knowledge from Conversation ============

const EXTRACTION_PROMPT = `You are a knowledge extraction engine. Analyze this conversation between a user and JARVIS (an AI assistant) and extract ONLY genuinely useful knowledge that should be remembered for future conversations.

Extract into these categories (skip empty categories):

## Decisions
- Concrete decisions made (e.g., "chose React over Vue", "will use Base chain")

## Preferences
- User preferences, style choices, opinions (e.g., "prefers minimal UI", "dislikes verbose explanations")

## Technical Insights
- Technical knowledge shared, solutions found, patterns discovered

## Action Items
- Tasks committed to, next steps agreed on

## Context
- Important context about the user's situation, goals, or constraints

Rules:
- Be concise — one line per insight
- Use present tense ("User prefers X" not "User said they preferred X")
- Skip pleasantries, greetings, meta-conversation
- Skip anything already obvious from the conversation topic
- Each insight should be independently useful without seeing the original conversation
- If the conversation was trivial (just greetings, small talk), respond with exactly: NO_EXTRACTION
- Maximum 10 insights total

Respond in markdown format with the category headers shown above.`;

export async function extractKnowledge(chatId, userName, messages) {
  // Filter to meaningful messages only
  const meaningful = messages.filter(m =>
    m.content && m.content.length >= MIN_MESSAGE_LENGTH
  );

  if (meaningful.length < 3) return null;

  // Check if we already processed this many messages
  const lastCount = processed.get(chatId) || 0;
  if (meaningful.length - lastCount < EXTRACTION_THRESHOLD) return null;

  try {
    // Build conversation text for extraction
    const conversationText = meaningful.slice(-20).map(m => {
      const role = m.role === 'user' ? (userName || 'User') : 'JARVIS';
      // Truncate very long messages
      const content = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
      return `${role}: ${content}`;
    }).join('\n\n');

    const response = await llmChat({
      max_tokens: 800,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
    });

    const text = response?.content?.[0]?.text || '';

    if (!text || text.includes('NO_EXTRACTION')) {
      processed.set(chatId, meaningful.length);
      return null;
    }

    // Mark as processed
    processed.set(chatId, meaningful.length);

    return text.trim();
  } catch (err) {
    console.warn('[ckb] Extraction failed:', err.message);
    return null;
  }
}

// ============ Append to User's CKB ============

export async function appendToCKB(userId, userName, extraction) {
  if (!extraction) return;

  const userFile = join(CKB_DIR, `${sanitizeId(userId)}.md`);
  const now = new Date().toISOString();
  const dateStr = now.split('T')[0];

  // Read existing CKB or create new one
  let existing = '';
  if (existsSync(userFile)) {
    existing = await readFile(userFile, 'utf8');
  } else {
    // Create header for new user
    existing = `# Common Knowledge Base: ${userName || userId} x JARVIS

> Generated from conversations. Updated automatically.
> Each entry represents shared knowledge between ${userName || 'this user'} and JARVIS.

---

`;
    // Update index
    userIndex[userId] = {
      name: userName || userId,
      firstContact: now,
      lastUpdated: now,
      entryCount: 0,
    };
  }

  // Append the new extraction with timestamp
  const entry = `\n### Session — ${dateStr}\n\n${extraction}\n\n---\n`;
  existing += entry;

  // Write back
  await writeFile(userFile, existing, 'utf8');

  // Update index
  if (userIndex[userId]) {
    userIndex[userId].lastUpdated = now;
    userIndex[userId].entryCount = (userIndex[userId].entryCount || 0) + 1;
    if (userName) userIndex[userId].name = userName;
  }

  dirty = true;
  console.log(`[ckb] Appended to ${sanitizeId(userId)}.md (${extraction.length} chars)`);
}

// ============ Process Conversation (Called after chat) ============

export async function processConversation(chatId, userId, userName, messages) {
  try {
    const extraction = await extractKnowledge(chatId, userName, messages);
    if (extraction) {
      await appendToCKB(userId, userName, extraction);
      await saveIndex();
    }
  } catch (err) {
    console.warn('[ckb] Process failed:', err.message);
  }
}

// ============ Get User's CKB (for context injection) ============

export async function getUserCKB(userId) {
  const userFile = join(CKB_DIR, `${sanitizeId(userId)}.md`);
  if (!existsSync(userFile)) return null;

  try {
    const content = await readFile(userFile, 'utf8');
    // Return last N chars to stay within token budget
    const MAX_CKB_CONTEXT = 3000;
    if (content.length > MAX_CKB_CONTEXT) {
      // Return header + most recent entries
      const header = content.split('---')[0] + '---\n';
      const rest = content.slice(-(MAX_CKB_CONTEXT - header.length));
      return header + '\n...(earlier entries truncated)...\n' + rest;
    }
    return content;
  } catch {
    return null;
  }
}

// ============ Get CKB Stats ============

export function getCKBStats() {
  return {
    totalUsers: Object.keys(userIndex).length,
    users: Object.entries(userIndex).map(([id, info]) => ({
      id: sanitizeId(id),
      name: info.name,
      entries: info.entryCount || 0,
      lastUpdated: info.lastUpdated,
    })),
  };
}

// ============ Persistence ============

async function saveIndex() {
  if (!dirty) return;
  try {
    await writeFile(INDEX_FILE, JSON.stringify(userIndex, null, 2), 'utf8');
    dirty = false;
  } catch (err) {
    console.error('[ckb] Failed to save index:', err.message);
  }
}

// Auto-save every 5 minutes
setInterval(() => {
  if (dirty) saveIndex();
}, 5 * 60 * 1000);

// ============ Helpers ============

function sanitizeId(id) {
  // Make safe for filenames
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ============ Export for Git Backup ============

export function getCKBDataFiles() {
  // Return list of CKB files for git backup
  const files = [`jarvis-bot/data/ckb/index.json`];
  for (const userId of Object.keys(userIndex)) {
    files.push(`jarvis-bot/data/ckb/${sanitizeId(userId)}.md`);
  }
  return files;
}
