// ============ AIRSPACE MONITOR — Anti-Dominance Response Throttling ============
//
// "The troll's superpower is plausible deniability — every individual message
//  looks innocent, but the cumulative effect is chat destruction."
//
// This module doesn't censor. It rebalances.
// Users who dominate chat airspace get progressively less bot attention.
// Users who rarely speak get MORE attention. Natural equilibrium.
//
// The troll doesn't get banned — they get boring, because Jarvis stops engaging.
//
// Detection signals:
//   1. Single user > 30% of messages in a 1-hour window
//   2. Same topic persisted 20+ messages without new information
//   3. Bot engagement ratio: one user triggering 10+ responses while others get none
//   4. Owner "noise" signal: Will flags conversation as low quality
//
// Response: probability-based throttling, not hard blocking.
// A dominant user might get a response 1 in 3 times instead of every time.
// A quiet user who finally speaks gets priority engagement.
// ============

import { config } from './config.js';

// ============ Constants ============

const WINDOW_MS = 60 * 60 * 1000;         // 1-hour sliding window
const DOMINANCE_THRESHOLD = 0.30;          // 30% of messages = dominant
const HIGH_DOMINANCE_THRESHOLD = 0.50;     // 50% = heavily dominant
const BOT_TRIGGER_LIMIT = 8;              // Max bot responses per user per hour
const TOPIC_REPEAT_LIMIT = 15;             // Same topic 15+ times = throttle
const QUIET_USER_BOOST_DAYS = 3;           // Users silent for 3+ days get priority
const NOISE_COOLDOWN_MS = 30 * 60 * 1000;  // 30 min after owner "noise" signal

// Response probabilities based on dominance
const RESPONSE_PROBABILITY = {
  normal: 1.0,          // No dominance — always respond
  moderate: 0.6,        // 30-50% dominance — respond 60% of the time
  heavy: 0.3,           // 50%+ dominance — respond 30% of the time
  bot_saturated: 0.15,  // Already triggered 8+ bot responses this hour
  noise_flagged: 0.0,   // Owner flagged as noise — don't respond
  quiet_user: 1.0,      // Quiet user boost — always respond (priority)
};

// ============ State ============

// chatId -> { messages: [{userId, timestamp}], botResponses: {userId: count}, noiseFlaggedUntil }
const chatState = new Map();

// userId -> { lastMessageTimestamp, messageCount (lifetime), daysSilent }
const userActivity = new Map();

// ============ Core API ============

/**
 * Record a message (call for EVERY group message, before response decision).
 */
export function recordMessage(chatId, userId) {
  const key = String(chatId);
  if (!chatState.has(key)) {
    chatState.set(key, { messages: [], botResponses: {}, noiseFlaggedUntil: 0 });
  }

  const state = chatState.get(key);
  const now = Date.now();

  // Add to sliding window
  state.messages.push({ userId: String(userId), timestamp: now });

  // Prune old messages
  state.messages = state.messages.filter(m => now - m.timestamp < WINDOW_MS);

  // Update user activity
  const uid = String(userId);
  const prev = userActivity.get(uid);
  userActivity.set(uid, {
    lastMessageTimestamp: now,
    messageCount: (prev?.messageCount || 0) + 1,
  });
}

/**
 * Record that the bot responded to a user (call after sending response).
 */
export function recordBotResponse(chatId, userId) {
  const key = String(chatId);
  const state = chatState.get(key);
  if (!state) return;

  const uid = String(userId);
  state.botResponses[uid] = (state.botResponses[uid] || 0) + 1;

  // Decay bot response counts every hour
  setTimeout(() => {
    if (state.botResponses[uid]) {
      state.botResponses[uid] = Math.max(0, state.botResponses[uid] - 1);
    }
  }, WINDOW_MS);
}

/**
 * Owner flagged this chat as noise. Suppress engagement for 30 minutes.
 */
export function flagNoise(chatId) {
  const key = String(chatId);
  if (!chatState.has(key)) {
    chatState.set(key, { messages: [], botResponses: {}, noiseFlaggedUntil: 0 });
  }
  chatState.get(key).noiseFlaggedUntil = Date.now() + NOISE_COOLDOWN_MS;
}

/**
 * Should the bot respond to this user in this chat?
 * Returns { shouldRespond: boolean, reason: string, probability: number }
 *
 * This is NOT a hard block — it's probabilistic throttling.
 * The bot rolls a dice and responds with the given probability.
 */
export function checkAirspace(chatId, userId) {
  const key = String(chatId);
  const uid = String(userId);
  const now = Date.now();

  // Owner and authorized users always get responses
  if (uid === config.ownerId) {
    return { shouldRespond: true, reason: 'owner', probability: 1.0 };
  }

  const state = chatState.get(key);
  if (!state || state.messages.length < 5) {
    return { shouldRespond: true, reason: 'insufficient_data', probability: 1.0 };
  }

  // Check noise flag first (owner said "slop")
  if (state.noiseFlaggedUntil > now) {
    return { shouldRespond: false, reason: 'noise_flagged', probability: 0.0 };
  }

  // Calculate user's dominance in the window
  const windowMessages = state.messages.filter(m => now - m.timestamp < WINDOW_MS);
  const userMessages = windowMessages.filter(m => m.userId === uid);
  const dominance = windowMessages.length > 0 ? userMessages.length / windowMessages.length : 0;

  // Check bot response saturation
  const botResponses = state.botResponses[uid] || 0;

  // Check if user has been quiet (boost quiet users)
  const activity = userActivity.get(uid);
  const daysSilent = activity
    ? (now - activity.lastMessageTimestamp) / (24 * 60 * 60 * 1000)
    : 999;

  // Quiet user boost — someone who hasn't spoken in days gets priority
  if (daysSilent >= QUIET_USER_BOOST_DAYS) {
    return { shouldRespond: true, reason: 'quiet_user_boost', probability: 1.0 };
  }

  // Bot response saturation — already triggered too many responses
  if (botResponses >= BOT_TRIGGER_LIMIT) {
    const prob = RESPONSE_PROBABILITY.bot_saturated;
    return {
      shouldRespond: Math.random() < prob,
      reason: `bot_saturated (${botResponses} responses this hour)`,
      probability: prob,
    };
  }

  // Heavy dominance
  if (dominance >= HIGH_DOMINANCE_THRESHOLD) {
    const prob = RESPONSE_PROBABILITY.heavy;
    return {
      shouldRespond: Math.random() < prob,
      reason: `heavy_dominance (${(dominance * 100).toFixed(0)}% of messages)`,
      probability: prob,
    };
  }

  // Moderate dominance
  if (dominance >= DOMINANCE_THRESHOLD) {
    const prob = RESPONSE_PROBABILITY.moderate;
    return {
      shouldRespond: Math.random() < prob,
      reason: `moderate_dominance (${(dominance * 100).toFixed(0)}% of messages)`,
      probability: prob,
    };
  }

  // Normal — respond
  return { shouldRespond: true, reason: 'normal', probability: 1.0 };
}

/**
 * Get airspace stats for a chat (for /health or debugging).
 */
export function getAirspaceStats(chatId) {
  const key = String(chatId);
  const state = chatState.get(key);
  if (!state) return { active: false };

  const now = Date.now();
  const windowMessages = state.messages.filter(m => now - m.timestamp < WINDOW_MS);

  // Calculate per-user dominance
  const userCounts = {};
  for (const m of windowMessages) {
    userCounts[m.userId] = (userCounts[m.userId] || 0) + 1;
  }

  const dominanceMap = Object.entries(userCounts)
    .map(([userId, count]) => ({
      userId,
      count,
      dominance: (count / windowMessages.length * 100).toFixed(1) + '%',
      botResponses: state.botResponses[userId] || 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    active: true,
    totalMessages: windowMessages.length,
    uniqueUsers: Object.keys(userCounts).length,
    noiseFlagged: state.noiseFlaggedUntil > now,
    dominance: dominanceMap.slice(0, 5),
  };
}

// ============ Cleanup ============

// Prune stale chat state every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of chatState) {
    state.messages = state.messages.filter(m => now - m.timestamp < WINDOW_MS * 2);
    if (state.messages.length === 0) chatState.delete(key);
  }
}, 30 * 60 * 1000);
