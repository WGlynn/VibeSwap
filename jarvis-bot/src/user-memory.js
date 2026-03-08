// ============ USER MEMORY — Per-User Persistent Personal Details ============
//
// JARVIS remembers personal details about each user across conversations —
// names, preferences, topics they care about, inside jokes, pets, relationships.
// This is what makes him feel human.
//
// Uses simple keyword heuristics (no LLM calls) to detect memorable facts
// from conversation. Memories persist to disk as JSON.
//
// Max 20 memories per user (FIFO eviction when exceeded).
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const MEMORIES_FILE = join(DATA_DIR, 'user-memories.json');
const MAX_MEMORIES_PER_USER = 20;

// ============ State ============

// userId (string) -> { userName, memories: string[] }
const userMemories = new Map();
let dirty = false;

// ============ Init ============

export async function initUserMemory() {
  try {
    await mkdir(DATA_DIR, { recursive: true });

    if (existsSync(MEMORIES_FILE)) {
      const raw = await readFile(MEMORIES_FILE, 'utf8');
      const parsed = JSON.parse(raw);

      for (const [userId, data] of Object.entries(parsed)) {
        userMemories.set(userId, data);
      }

      console.log(`[user-memory] Loaded memories for ${userMemories.size} users`);
    } else {
      console.log('[user-memory] No existing memories file — starting fresh');
    }
  } catch (err) {
    console.error('[user-memory] Failed to load memories:', err.message);
  }
}

// ============ Accessors ============

export function getUserMemory(userId) {
  const key = String(userId);
  const entry = userMemories.get(key);
  return entry ? [...entry.memories] : [];
}

export function addUserMemory(userId, memory) {
  const key = String(userId);
  const trimmed = memory.trim();
  if (!trimmed) return;

  let entry = userMemories.get(key);
  if (!entry) {
    entry = { userName: null, memories: [] };
    userMemories.set(key, entry);
  }

  // Deduplicate — skip if a similar memory already exists
  const normalized = trimmed.toLowerCase();
  const isDuplicate = entry.memories.some(existing => {
    const existingNorm = existing.toLowerCase();
    // Exact match
    if (existingNorm === normalized) return true;
    // One contains the other (substring match for similar memories)
    if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) return true;
    // High word overlap (>70% shared words)
    const wordsA = new Set(existingNorm.split(/\s+/));
    const wordsB = new Set(normalized.split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    if (union > 0 && intersection / union > 0.7) return true;
    return false;
  });

  if (isDuplicate) {
    console.log(`[user-memory] Skipped duplicate memory for user ${key}`);
    return;
  }

  entry.memories.push(trimmed);

  // FIFO eviction if over limit
  while (entry.memories.length > MAX_MEMORIES_PER_USER) {
    const evicted = entry.memories.shift();
    console.log(`[user-memory] Evicted oldest memory for user ${key}: "${evicted}"`);
  }

  dirty = true;
  console.log(`[user-memory] Added memory for user ${key}: "${trimmed}"`);
}

// ============ Context Injection ============

export function getUserMemoryContext(userId) {
  const key = String(userId);
  const entry = userMemories.get(key);
  if (!entry || entry.memories.length === 0) return '';

  const name = entry.userName || `user ${key}`;
  const memoriesText = entry.memories.join('\n');
  return `[JARVIS MEMORY — What you remember about ${name}]:\n${memoriesText}`;
}

// ============ Persistence ============

export async function flushUserMemory() {
  if (!dirty) return;

  try {
    await mkdir(DATA_DIR, { recursive: true });

    const serialized = {};
    for (const [userId, data] of userMemories.entries()) {
      serialized[userId] = data;
    }

    const tmpFile = MEMORIES_FILE + '.tmp';
    await writeFile(tmpFile, JSON.stringify(serialized, null, 2), 'utf8');

    // Atomic rename
    const { rename } = await import('fs/promises');
    await rename(tmpFile, MEMORIES_FILE);

    dirty = false;
    console.log(`[user-memory] Flushed memories for ${userMemories.size} users to disk`);
  } catch (err) {
    console.error('[user-memory] Failed to flush memories:', err.message);
  }
}

// ============ Heuristic Memory Extraction ============

// Patterns: each entry is [regex, extractor function that returns a memory string or null]
const EXTRACTION_PATTERNS = [
  // "my name is X" / "I'm X" / "call me X"
  [
    /\bmy name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    (m) => `Their name is ${m[1]}`,
  ],
  [
    /\bcall me\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    (m) => `Prefers to be called ${m[1]}`,
  ],

  // Pets: "my dog/cat/pet X", "my dog's name is X"
  [
    /\bmy\s+(dog|cat|pet|puppy|kitten|parrot|bird|fish|hamster|rabbit|turtle|snake|ferret|guinea pig)(?:'s name is|(?:\s+is\s+(?:named|called)))?\s+([A-Z][a-z]+)/i,
    (m) => `Has a ${m[1].toLowerCase()} named ${m[2]}`,
  ],
  [
    /\bmy\s+(dog|cat|pet|puppy|kitten|parrot|bird|fish|hamster|rabbit|turtle|snake|ferret|guinea pig)\s+([A-Z][a-z]+)/i,
    (m) => `Has a ${m[1].toLowerCase()} named ${m[2]}`,
  ],

  // Relationships: "my wife/husband/partner/gf/bf X"
  [
    /\bmy\s+(wife|husband|partner|girlfriend|boyfriend|gf|bf|fiancée?|spouse|significant other)(?:'s name is|(?:\s+is\s+(?:named|called)))?\s+([A-Z][a-z]+)/i,
    (m) => `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} is named ${m[2]}`,
  ],
  [
    /\bmy\s+(wife|husband|partner|girlfriend|boyfriend|gf|bf|fiancée?|spouse)\s+([A-Z][a-z]+)/i,
    (m) => `${m[1].charAt(0).toUpperCase() + m[1].slice(1)} is named ${m[2]}`,
  ],

  // Work: "I work at X", "I'm a developer/engineer/etc"
  [
    /\bi work (?:at|for)\s+(.{2,40})(?:\.|,|$)/i,
    (m) => `Works at ${m[1].trim()}`,
  ],
  [
    /\bi(?:'m| am) an?\s+(developer|engineer|designer|teacher|student|trader|analyst|researcher|founder|ceo|cto|doctor|nurse|lawyer|artist|musician|writer|chef|manager|consultant|freelancer|architect|scientist|professor|accountant|journalist|photographer|pilot|paramedic)(?:\b)/i,
    (m) => `Occupation: ${m[1]}`,
  ],

  // Location: "I live in X", "I'm from X", "I'm based in X"
  [
    /\bi (?:live|reside|am based) in\s+(.{2,40})(?:\.|,|$)/i,
    (m) => `Lives in ${m[1].trim()}`,
  ],
  [
    /\bi(?:'m| am) from\s+(.{2,40})(?:\.|,|$)/i,
    (m) => `From ${m[1].trim()}`,
  ],

  // Favorites: "my favorite X is Y"
  [
    /\bmy (?:favorite|favourite)\s+(\w+(?:\s+\w+)?)\s+is\s+(.{2,40})(?:\.|,|$)/i,
    (m) => `Favorite ${m[1].toLowerCase()}: ${m[2].trim()}`,
  ],

  // Likes/Loves/Hates: "I like/love/hate X"
  [
    /\bi\s+(really\s+)?(like|love|enjoy|adore)\s+(.{2,50})(?:\.|,|!|$)/i,
    (m) => `Loves ${m[3].trim().replace(/\.$/, '')}`,
  ],
  [
    /\bi\s+(really\s+)?(hate|dislike|can't stand|detest)\s+(.{2,50})(?:\.|,|!|$)/i,
    (m) => `Hates ${m[3].trim().replace(/\.$/, '')}`,
  ],

  // Birthday: "my birthday is X"
  [
    /\bmy birthday is\s+(.{3,30})(?:\.|,|$)/i,
    (m) => `Birthday: ${m[1].trim()}`,
  ],
  [
    /\bi was born (?:on|in)\s+(.{3,30})(?:\.|,|$)/i,
    (m) => `Born: ${m[1].trim()}`,
  ],

  // Timezone: "I'm in EST", "I'm in PST", "it's Xam/pm here"
  [
    /\bi(?:'m| am) in\s+(EST|CST|MST|PST|ET|CT|MT|PT|UTC[+-]?\d*|GMT[+-]?\d*|CET|EET|IST|JST|AEST|NZST|BST|CEST)\b/i,
    (m) => `Timezone: ${m[1].toUpperCase()}`,
  ],
  [
    /\bit(?:'s| is)\s+(\d{1,2})\s*([ap]m)\s+(?:here|for me|where i am)/i,
    (m) => `Last known local time reference: ${m[1]}${m[2]}`,
  ],
];

export async function extractAndStoreMemories(userId, userName, userMessage, assistantResponse) {
  const key = String(userId);

  // Update userName if provided
  if (userName) {
    let entry = userMemories.get(key);
    if (!entry) {
      entry = { userName, memories: [] };
      userMemories.set(key, entry);
    } else if (!entry.userName || entry.userName !== userName) {
      entry.userName = userName;
      dirty = true;
    }
  }

  // Only scan the user's message for personal facts
  if (!userMessage || typeof userMessage !== 'string') return;

  let extracted = 0;

  for (const [pattern, extractor] of EXTRACTION_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match) {
      try {
        const memory = extractor(match);
        if (memory) {
          addUserMemory(userId, memory);
          extracted++;
        }
      } catch (err) {
        // Pattern matched but extractor failed — skip silently
      }
    }
  }

  if (extracted > 0) {
    console.log(`[user-memory] Extracted ${extracted} memories from message by user ${key}`);
    // Auto-flush after extraction
    await flushUserMemory();
  }
}
