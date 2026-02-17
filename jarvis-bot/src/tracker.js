import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const DATA_DIR = join(homedir(), 'vibeswap', 'jarvis-bot', 'data');
const CONTRIBUTIONS_FILE = join(DATA_DIR, 'contributions.json');
const USERS_FILE = join(DATA_DIR, 'users.json');
const INTERACTIONS_FILE = join(DATA_DIR, 'interactions.json');

// ============ Categories ============

const CATEGORY_KEYWORDS = {
  IDEA: [
    'what if', 'idea:', 'proposal', 'suggest', 'imagine', 'concept',
    'we could', 'we should', 'how about', 'vision', 'roadmap',
  ],
  CODE: [
    'function', 'contract', 'solidity', 'bug', 'fix', 'deploy',
    'compile', 'test', 'commit', 'merge', 'refactor', 'implement',
    'github', 'repo', 'pull request', 'pr', 'branch',
  ],
  GOVERNANCE: [
    'vote', 'governance', 'proposal', 'dao', 'treasury', 'quorum',
    'consensus', 'decision', 'policy', 'rule', 'amendment',
  ],
  COMMUNITY: [
    'welcome', 'thanks', 'help', 'explain', 'guide', 'tutorial',
    'onboard', 'question', 'answer', 'support',
  ],
  DESIGN: [
    'ui', 'ux', 'design', 'layout', 'wireframe', 'mockup',
    'interface', 'frontend', 'component', 'animation',
  ],
  REVIEW: [
    'review', 'audit', 'feedback', 'critique', 'opinion', 'thoughts on',
    'looks good', 'lgtm', 'issue with', 'problem with',
  ],
};

// ============ State ============

let contributions = [];
let users = {};
let interactions = [];

// ============ Init ============

export async function initTracker() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {}

  contributions = await loadJson(CONTRIBUTIONS_FILE, []);
  users = await loadJson(USERS_FILE, {});
  interactions = await loadJson(INTERACTIONS_FILE, []);

  console.log(`[tracker] Loaded ${contributions.length} contributions, ${Object.keys(users).length} users, ${interactions.length} interactions`);
}

async function loadJson(path, fallback) {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function saveAll() {
  await Promise.all([
    writeFile(CONTRIBUTIONS_FILE, JSON.stringify(contributions, null, 2)),
    writeFile(USERS_FILE, JSON.stringify(users, null, 2)),
    writeFile(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2)),
  ]);
}

// ============ User Registry ============

function trackUser(from) {
  const id = String(from.id);
  if (!users[id]) {
    users[id] = {
      telegramId: from.id,
      username: from.username || null,
      firstName: from.first_name || null,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      messageCount: 0,
      walletAddress: null,
    };
  } else {
    users[id].lastSeen = Date.now();
    users[id].username = from.username || users[id].username;
    users[id].firstName = from.first_name || users[id].firstName;
  }
  users[id].messageCount++;
  return id;
}

// ============ Categorization ============

function categorizeMessage(text) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) scores[category]++;
    }
  }

  // Find highest scoring category
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  // Default to COMMUNITY if no keywords match
  if (best[1] === 0) return 'COMMUNITY';
  return best[0];
}

function computeQualitySignal(text) {
  let score = 0;

  // Length — longer messages tend to be more substantive
  if (text.length > 50) score += 1;
  if (text.length > 200) score += 1;
  if (text.length > 500) score += 1;

  // Questions show engagement
  if (text.includes('?')) score += 1;

  // Links show research
  if (text.includes('http') || text.includes('github')) score += 1;

  // Code blocks show technical contribution
  if (text.includes('```') || text.includes('function') || text.includes('contract')) score += 1;

  return Math.min(score, 5); // Cap at 5
}

// ============ Core Tracking ============

export async function trackMessage(ctx) {
  if (!ctx.message || !ctx.message.text) return;
  if (ctx.message.text.startsWith('/')) return; // Skip commands

  const from = ctx.message.from;
  if (from.is_bot) return; // Skip bot messages

  const text = ctx.message.text;
  const userId = trackUser(from);
  const category = categorizeMessage(text);
  const quality = computeQualitySignal(text);

  // Hash the message for evidenceHash
  const evidenceHash = createHash('sha256')
    .update(`${from.id}:${ctx.message.date}:${text}`)
    .digest('hex');

  const contribution = {
    evidenceHash,
    telegramUserId: from.id,
    username: from.username || from.first_name,
    chatId: ctx.chat.id,
    chatTitle: ctx.chat.title || 'DM',
    messageId: ctx.message.message_id,
    timestamp: ctx.message.date * 1000,
    category,
    quality,
    textLength: text.length,
    // Don't store full message text for privacy — just metadata
  };

  contributions.push(contribution);

  // Track reply interactions (who replied to whom)
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    const replyTo = ctx.message.reply_to_message.from;
    if (!replyTo.is_bot) {
      interactions.push({
        from: from.id,
        to: replyTo.id,
        type: 'reply',
        timestamp: ctx.message.date * 1000,
        chatId: ctx.chat.id,
      });
    }
  }

  // Periodic save (every 10 messages)
  if (contributions.length % 10 === 0) {
    await saveAll();
  }
}

// ============ Wallet Linking ============

export async function linkWallet(telegramId, walletAddress) {
  const id = String(telegramId);
  if (users[id]) {
    users[id].walletAddress = walletAddress;
    await saveAll();
    return true;
  }
  return false;
}

// ============ Stats ============

export function getUserStats(telegramId) {
  const id = String(telegramId);
  const user = users[id];
  if (!user) return null;

  const userContributions = contributions.filter(c => c.telegramUserId === telegramId);

  const categoryCounts = {};
  let totalQuality = 0;
  for (const c of userContributions) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
    totalQuality += c.quality;
  }

  const repliesGiven = interactions.filter(i => i.from === telegramId).length;
  const repliesReceived = interactions.filter(i => i.to === telegramId).length;

  const daysSinceFirst = user.firstSeen
    ? Math.floor((Date.now() - user.firstSeen) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    username: user.username || user.firstName,
    walletLinked: !!user.walletAddress,
    messageCount: user.messageCount,
    contributions: userContributions.length,
    categoryCounts,
    avgQuality: userContributions.length ? (totalQuality / userContributions.length).toFixed(1) : 0,
    repliesGiven,
    repliesReceived,
    daysSinceFirst,
    firstSeen: new Date(user.firstSeen).toISOString().split('T')[0],
  };
}

export function getGroupStats(chatId) {
  const chatContributions = chatId
    ? contributions.filter(c => c.chatId === chatId)
    : contributions;

  const categoryCounts = {};
  const userCounts = {};

  for (const c of chatContributions) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
    userCounts[c.username || c.telegramUserId] = (userCounts[c.username || c.telegramUserId] || 0) + 1;
  }

  // Top contributors
  const topContributors = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}: ${count}`);

  return {
    totalContributions: chatContributions.length,
    totalUsers: Object.keys(userCounts).length,
    categoryCounts,
    topContributors,
    totalInteractions: chatId
      ? interactions.filter(i => i.chatId === chatId).length
      : interactions.length,
  };
}

// ============ Export for DAG ============

export function getUnsubmittedContributions(sinceTimestamp = 0) {
  return contributions.filter(c => c.timestamp > sinceTimestamp);
}

export function getAllUsers() {
  return { ...users };
}

// ============ Flush ============

export async function flushTracker() {
  await saveAll();
}
