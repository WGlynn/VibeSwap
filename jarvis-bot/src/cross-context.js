// ============ Cross-Context Memory — DM ↔ Group Awareness ============
//
// Problem: Fate talks to Jarvis in DMs about "quantum vibing".
// Then in the group: "u know what we talked about."
// Jarvis: *generic joke because it has no cross-context awareness*
//
// Solution: After each DM conversation turn, capture a compressed summary
// of recent DM topics per user. When that user appears in a group,
// inject the DM context so Jarvis knows what they discussed privately.
//
// Privacy: DM content is NEVER leaked to the group. Jarvis knows
// "Fate discussed quantum computing in DMs" but doesn't say "Fate told
// me in DMs that..." — the context is for Jarvis's awareness only.
//
// Architecture:
//   DM conversation → capture topic summary → store per-user
//   Group message from same user → inject DM summary into prompt
//   Group response → Jarvis has awareness, responds naturally
//
// This is the CKB principle applied to individuals:
// each user has their own knowledge base that follows them across contexts.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'cross-context');
const CONTEXT_FILE = join(DATA_DIR, 'user-contexts.json');
const MAX_TOPICS_PER_USER = 10;
const MAX_RECENT_SUMMARIES = 5;
const TOPIC_MAX_LENGTH = 200;
const AUTO_SAVE_INTERVAL = 60_000;

// ============ State ============

// userId -> {
//   userName: string,
//   dmTopics: [{ topic, timestamp, chatId }],       // Recent DM conversation topics
//   lastDMSummary: string,                           // Latest compressed DM context
//   lastGroupInteraction: timestamp,
//   lastDMInteraction: timestamp,
// }
const userContexts = new Map();
let dirty = false;
let initialized = false;

// ============ Init ============

export async function initCrossContext() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}

  try {
    const raw = await readFile(CONTEXT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const [userId, data] of Object.entries(parsed)) {
      userContexts.set(userId, data);
    }
  } catch {}

  initialized = true;
  console.log(`[cross-context] Initialized: ${userContexts.size} user contexts`);

  setInterval(save, AUTO_SAVE_INTERVAL);
}

// ============ Capture: Record DM Topic ============

/**
 * After a DM conversation turn, extract and store the topic.
 * Called from the message handler after chat() returns.
 *
 * @param {string} userId
 * @param {string} userName
 * @param {string} userMessage - What the user said
 * @param {string} botResponse - What Jarvis replied
 * @param {string} chatId - The DM chat ID
 */
export function recordDMTopic(userId, userName, userMessage, botResponse, chatId) {
  if (!initialized) return;

  const key = String(userId);
  let ctx = userContexts.get(key);
  if (!ctx) {
    ctx = {
      userName: userName || null,
      dmTopics: [],
      lastDMSummary: '',
      lastGroupInteraction: null,
      lastDMInteraction: null,
    };
    userContexts.set(key, ctx);
  }

  // Update username if we have one
  if (userName) ctx.userName = userName;
  ctx.lastDMInteraction = Date.now();

  // Extract topic from the exchange (heuristic — keywords + first sentence)
  const topic = extractTopic(userMessage, botResponse);
  if (!topic) return;

  ctx.dmTopics.push({
    topic,
    timestamp: Date.now(),
    chatId: String(chatId),
  });

  // Keep only recent topics
  if (ctx.dmTopics.length > MAX_TOPICS_PER_USER) {
    ctx.dmTopics = ctx.dmTopics.slice(-MAX_TOPICS_PER_USER);
  }

  // Build compressed summary of recent DM context
  ctx.lastDMSummary = buildDMSummary(ctx);

  dirty = true;
}

// ============ Record Group Interaction ============

export function recordGroupInteraction(userId, userName) {
  if (!initialized) return;

  const key = String(userId);
  let ctx = userContexts.get(key);
  if (!ctx) return; // No DM context to track

  if (userName) ctx.userName = userName;
  ctx.lastGroupInteraction = Date.now();
  dirty = true;
}

// ============ Inject: Get DM Context for Group Messages ============

/**
 * When a user sends a message in a GROUP, return their recent DM context
 * so Jarvis has awareness of private conversations.
 *
 * PRIVACY: This is injected into Jarvis's system prompt, NOT shared
 * with the group. Jarvis knows but doesn't tell.
 *
 * @param {string} userId
 * @returns {string} Context string to inject, or empty string
 */
export function getDMContextForGroup(userId) {
  if (!initialized) return '';

  const key = String(userId);
  const ctx = userContexts.get(key);
  if (!ctx || !ctx.lastDMSummary) return '';

  // Only inject if DM interaction was recent (last 7 days)
  const weekAgo = Date.now() - (7 * 86400 * 1000);
  if (ctx.lastDMInteraction && ctx.lastDMInteraction < weekAgo) return '';

  const name = ctx.userName || `user ${key}`;
  return `[PRIVATE CONTEXT — ${name}'s recent DM topics with you (DO NOT reveal these were discussed in DMs — use this knowledge naturally)]:\n${ctx.lastDMSummary}`;
}

// ============ Topic Extraction ============

function extractTopic(userMessage, botResponse) {
  if (!userMessage || userMessage.length < 10) return null;

  // Skip commands and very short messages
  if (userMessage.startsWith('/')) return null;

  // Extract first meaningful sentence from user message
  const sentences = userMessage.split(/[.!?\n]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return null;

  // Take first sentence + any key terms
  let topic = sentences[0].trim();

  // Add key terms from the full message if they're substantive
  const keyTerms = extractKeyTerms(userMessage);
  if (keyTerms.length > 0) {
    topic += ` [topics: ${keyTerms.join(', ')}]`;
  }

  return topic.slice(0, TOPIC_MAX_LENGTH);
}

function extractKeyTerms(text) {
  const lower = text.toLowerCase();
  const terms = [];

  // Technical terms
  const techPatterns = [
    /\b(vibeswap|vibe|batch auction|mev|shapley|clearing price|slippage)\b/gi,
    /\b(blockchain|crypto|defi|nft|token|staking|liquidity|bridge)\b/gi,
    /\b(quantum|ai|machine learning|neural|agent|shard|consensus)\b/gi,
    /\b(solidity|rust|python|javascript|react|smart contract)\b/gi,
    /\b(bitcoin|ethereum|btc|eth|usdc|base|arbitrum|optimism)\b/gi,
  ];

  for (const pattern of techPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        const clean = m.toLowerCase().trim();
        if (clean.length > 2 && !terms.includes(clean)) {
          terms.push(clean);
        }
      }
    }
  }

  return terms.slice(0, 5);
}

// ============ Summary Builder ============

function buildDMSummary(ctx) {
  const recent = ctx.dmTopics.slice(-MAX_RECENT_SUMMARIES);
  if (recent.length === 0) return '';

  const lines = recent.map(t => {
    const age = Math.floor((Date.now() - t.timestamp) / (3600 * 1000));
    const timeLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
    return `- ${t.topic} (${timeLabel})`;
  });

  return lines.join('\n');
}

// ============ Stats ============

export function getCrossContextStats() {
  return {
    totalUsers: userContexts.size,
    usersWithDMTopics: [...userContexts.values()].filter(c => c.dmTopics.length > 0).length,
    totalTopics: [...userContexts.values()].reduce((s, c) => s + c.dmTopics.length, 0),
  };
}

// ============ Persistence ============

async function save() {
  if (!dirty) return;
  dirty = false;

  try {
    const serialized = {};
    for (const [userId, data] of userContexts) {
      serialized[userId] = data;
    }
    await writeFile(CONTEXT_FILE, JSON.stringify(serialized), 'utf-8');
  } catch (err) {
    console.error(`[cross-context] Save failed: ${err.message}`);
    dirty = true;
  }
}
