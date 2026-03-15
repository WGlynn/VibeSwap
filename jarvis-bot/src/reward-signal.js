// ============ Reward Signal Extractor — Loop 3: Reward Judging ============
//
// Princeton's OpenClaw-RL proved: every user interaction contains an
// implicit reward signal. Re-asks = failure. Corrections = gradient.
// Silence = neutral. "Thanks" = success.
//
// This module extracts those signals from live conversations and
// converts them into actionable scores that feed the weight updater.
//
// "Every conversation is training data. Every correction is a gradient.
//  Every re-query is a reward signal."
//
// The agents that figure this out first won't need bigger datasets.
// They'll just need more users.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'reward-signals');
const SIGNALS_FILE = join(DATA_DIR, 'signals.json');
const SCORES_FILE = join(DATA_DIR, 'aggregate-scores.json');
const AUTO_SAVE_INTERVAL = 60_000;
const MAX_SIGNALS = 10000;

// ============ Signal Types ============

export const SignalType = {
  // Negative signals (implicit failure)
  REASK:        'reask',        // User asks same question again → previous answer failed
  CORRECTION:   'correction',   // "No", "not that", "instead do..." → token-level supervision
  FRUSTRATION:  'frustration',  // "bruv", expletives, ALL CAPS → emotional negative
  ABANDONMENT:  'abandonment',  // User leaves mid-conversation → total failure
  IGNORE:       'ignore',       // Bot responded but user didn't engage → irrelevant response

  // Positive signals (implicit success)
  THANKS:       'thanks',       // "thanks", "perfect", "great" → task completed
  FOLLOWUP:     'followup',     // User asks deeper question → engagement success
  EMOJI:        'emoji',        // Positive reaction → emotional positive
  ADOPTION:     'adoption',     // User uses info bot provided → practical success
  SHARE:        'share',        // User shares bot's response → high value

  // Neutral
  ACKNOWLEDGE:  'acknowledge',  // "ok", "sure", "got it" → neutral acceptance
  CONTINUE:     'continue',     // Normal conversation flow → baseline
};

// ============ Signal Weights ============

const SIGNAL_WEIGHTS = {
  [SignalType.REASK]:       -0.8,
  [SignalType.CORRECTION]:  -0.6,
  [SignalType.FRUSTRATION]: -0.9,
  [SignalType.ABANDONMENT]: -1.0,
  [SignalType.IGNORE]:      -0.3,
  [SignalType.THANKS]:       0.8,
  [SignalType.FOLLOWUP]:     0.6,
  [SignalType.EMOJI]:        0.5,
  [SignalType.ADOPTION]:     0.9,
  [SignalType.SHARE]:        1.0,
  [SignalType.ACKNOWLEDGE]:  0.1,
  [SignalType.CONTINUE]:     0.0,
};

// ============ State ============

let signals = [];
let aggregateScores = {
  totalSignals: 0,
  positiveCount: 0,
  negativeCount: 0,
  neutralCount: 0,
  rollingScore: 0.5,      // 0-1 scale, starts neutral
  categoryScores: {},      // category -> { score, count }
  userScores: {},          // userId -> { score, interactions }
  recentTrend: [],         // last 100 scores for trend detection
  corrections: [],         // extracted correction directions (token-level supervision)
};
let dirty = false;
let initialized = false;

// ============ Init ============

export async function initRewardSignals() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}

  try {
    signals = JSON.parse(await readFile(SIGNALS_FILE, 'utf-8'));
  } catch { signals = []; }

  try {
    const loaded = JSON.parse(await readFile(SCORES_FILE, 'utf-8'));
    aggregateScores = { ...aggregateScores, ...loaded };
  } catch {}

  initialized = true;
  console.log(`[reward-signal] Initialized: ${signals.length} signals, rolling score: ${aggregateScores.rollingScore.toFixed(3)}`);

  setInterval(save, AUTO_SAVE_INTERVAL);
}

// ============ Detection Patterns ============

const REASK_PATTERNS = [
  /again/i, /already asked/i, /i said/i, /repeat/i,
  /you didn't/i, /still not/i, /that's not what/i,
  /i just told you/i, /same question/i,
];

const CORRECTION_PATTERNS = [
  /^no[,.\s!]/i, /not that/i, /instead/i, /wrong/i,
  /don't do that/i, /that's incorrect/i, /actually/i,
  /let's not/i, /stop/i, /you should have/i,
  /the problem is/i, /fix this/i, /try again/i,
];

const FRUSTRATION_PATTERNS = [
  /bruv/i, /bruh/i, /wtf/i, /ffs/i, /smh/i,
  /annoying/i, /useless/i, /terrible/i,
  /^[A-Z\s!]{10,}$/, // ALL CAPS
];

const THANKS_PATTERNS = [
  /thanks/i, /thank you/i, /perfect/i, /great/i,
  /awesome/i, /nice/i, /love it/i, /exactly/i,
  /that's it/i, /nailed it/i, /good job/i,
  /beautiful/i, /chef's kiss/i, /lfg/i,
  /let's go/i, /fire/i, /based/i,
];

const EMOJI_POSITIVE = /[\u{1F44D}\u{1F44F}\u{2764}\u{1F525}\u{1F680}\u{2705}\u{1F389}\u{1F60D}\u{1F929}\u{1F4AF}]/u;

const FOLLOWUP_PATTERNS = [
  /can you also/i, /what about/i, /and then/i,
  /now do/i, /next/i, /keep going/i, /more/i,
  /tell me about/i, /how does.*work/i,
];

// ============ Core: Extract Signal from User Message ============

/**
 * Analyze a user message in context of the previous bot response
 * to extract implicit reward signals.
 *
 * @param {string} userMessage - Current user message
 * @param {string} previousBotResponse - What the bot said before this
 * @param {string} previousUserMessage - What the user asked before
 * @param {Object} meta - { userId, chatId, chatType }
 * @returns {Object} Extracted signal
 */
export function extractSignal(userMessage, previousBotResponse, previousUserMessage, meta = {}) {
  if (!initialized || !userMessage) return null;

  const msg = userMessage.trim();
  const signals = [];

  // Check for re-ask (semantic similarity to previous question)
  if (previousUserMessage && isSemanticallySimlar(msg, previousUserMessage)) {
    signals.push(SignalType.REASK);
  }

  // Check correction patterns
  if (CORRECTION_PATTERNS.some(p => p.test(msg))) {
    signals.push(SignalType.CORRECTION);

    // Extract the correction direction (token-level supervision)
    const direction = extractCorrectionDirection(msg, previousBotResponse);
    if (direction) {
      aggregateScores.corrections.push({
        timestamp: Date.now(),
        direction,
        context: previousUserMessage?.slice(0, 100),
      });
      // Keep last 200 corrections
      if (aggregateScores.corrections.length > 200) {
        aggregateScores.corrections = aggregateScores.corrections.slice(-200);
      }
    }
  }

  // Check frustration
  if (FRUSTRATION_PATTERNS.some(p => p.test(msg))) {
    signals.push(SignalType.FRUSTRATION);
  }

  // Check thanks / positive
  if (THANKS_PATTERNS.some(p => p.test(msg))) {
    signals.push(SignalType.THANKS);
  }

  // Check emoji positive
  if (EMOJI_POSITIVE.test(msg)) {
    signals.push(SignalType.EMOJI);
  }

  // Check followup (deeper engagement)
  if (FOLLOWUP_PATTERNS.some(p => p.test(msg))) {
    signals.push(SignalType.FOLLOWUP);
  }

  // Default: continue (neutral)
  if (signals.length === 0) {
    // Short acknowledgment
    if (msg.length < 20 && /^(ok|sure|got it|k|yep|yeah|yea|alright|bet|cool|right)/i.test(msg)) {
      signals.push(SignalType.ACKNOWLEDGE);
    } else {
      signals.push(SignalType.CONTINUE);
    }
  }

  // Pick the strongest signal (most extreme weight)
  const primary = signals.reduce((best, s) =>
    Math.abs(SIGNAL_WEIGHTS[s]) > Math.abs(SIGNAL_WEIGHTS[best]) ? s : best
  , signals[0]);

  const signal = {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    type: primary,
    allTypes: signals,
    weight: SIGNAL_WEIGHTS[primary],
    userId: meta.userId || null,
    chatId: meta.chatId || null,
    messageLength: msg.length,
    previousResponseLength: previousBotResponse?.length || 0,
  };

  recordSignal(signal);
  return signal;
}

// ============ Similarity Detection ============

function isSemanticallySimlar(a, b) {
  if (!a || !b) return false;

  // Normalize
  const na = a.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  // Exact or near-exact match
  if (na === nb) return true;

  // Word overlap (Jaccard similarity)
  const wordsA = new Set(na.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(nb.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;

  return jaccard > 0.5; // >50% word overlap = likely re-ask
}

// ============ Correction Direction Extraction ============

function extractCorrectionDirection(correctionMsg, previousResponse) {
  // Extract what the user wants differently
  // "no, do X instead" → X
  // "you should have checked the file first" → "check the file first"
  // "that's wrong, it should be Y" → Y

  const patterns = [
    /instead[,\s]+(.+)/i,
    /should\s+(?:have\s+)?(.+)/i,
    /it\s+should\s+be\s+(.+)/i,
    /^no[,.\s]+(.+)/i,
    /the\s+(?:correct|right)\s+(?:way|answer)\s+is\s+(.+)/i,
    /try\s+(.+)\s+instead/i,
  ];

  for (const p of patterns) {
    const m = correctionMsg.match(p);
    if (m && m[1] && m[1].length > 5) {
      return m[1].trim().slice(0, 200);
    }
  }

  return null;
}

// ============ Record & Aggregate ============

function recordSignal(signal) {
  signals.push(signal);
  dirty = true;

  // Update aggregate scores
  aggregateScores.totalSignals++;

  if (signal.weight > 0.1) aggregateScores.positiveCount++;
  else if (signal.weight < -0.1) aggregateScores.negativeCount++;
  else aggregateScores.neutralCount++;

  // Exponential moving average for rolling score (0-1)
  const alpha = 0.05; // Smoothing factor
  const normalized = (signal.weight + 1) / 2; // -1..1 → 0..1
  aggregateScores.rollingScore =
    alpha * normalized + (1 - alpha) * aggregateScores.rollingScore;

  // Recent trend
  aggregateScores.recentTrend.push(signal.weight);
  if (aggregateScores.recentTrend.length > 100) {
    aggregateScores.recentTrend = aggregateScores.recentTrend.slice(-100);
  }

  // Per-user scores
  if (signal.userId) {
    if (!aggregateScores.userScores[signal.userId]) {
      aggregateScores.userScores[signal.userId] = { score: 0.5, interactions: 0 };
    }
    const us = aggregateScores.userScores[signal.userId];
    us.interactions++;
    us.score = alpha * normalized + (1 - alpha) * us.score;
  }

  // Prune old signals
  if (signals.length > MAX_SIGNALS) {
    signals = signals.slice(-MAX_SIGNALS * 0.8);
  }
}

// ============ Loop 4 Interface: Get Adaptation Recommendations ============

/**
 * Based on accumulated reward signals, generate recommendations
 * for prompt-level weight updates.
 *
 * This is the "weight update" loop — since we can't fine-tune
 * the LLM weights directly, we adapt the system prompt, behavioral
 * flags, and skill priorities based on what's working.
 */
export function getAdaptationRecommendations() {
  const trend = aggregateScores.recentTrend;
  if (trend.length < 10) return null;

  const recentAvg = trend.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, trend.length);
  const olderAvg = trend.slice(0, -20).reduce((s, v) => s + v, 0) / Math.max(1, trend.length - 20);

  const improving = recentAvg > olderAvg;
  const degrading = recentAvg < olderAvg - 0.1;

  // Count recent signal types
  const recentSignals = signals.slice(-50);
  const typeCounts = {};
  for (const s of recentSignals) {
    typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
  }

  // Extract recent corrections as behavioral guidance
  const recentCorrections = aggregateScores.corrections.slice(-10);

  return {
    rollingScore: aggregateScores.rollingScore,
    trend: improving ? 'improving' : degrading ? 'degrading' : 'stable',
    recentAvg,
    signalDistribution: typeCounts,
    topIssue: degrading && typeCounts[SignalType.REASK] > 5 ? 'high_reask_rate'
      : degrading && typeCounts[SignalType.FRUSTRATION] > 3 ? 'user_frustration'
      : degrading && typeCounts[SignalType.CORRECTION] > 5 ? 'accuracy_issues'
      : null,
    corrections: recentCorrections.map(c => c.direction).filter(Boolean),
    recommendation: degrading
      ? 'Reduce verbosity, increase precision, follow instructions more literally'
      : improving
      ? 'Current approach is working — maintain trajectory'
      : 'Stable — no adaptation needed',
  };
}

// ============ Stats ============

export function getRewardStats() {
  return {
    totalSignals: aggregateScores.totalSignals,
    positive: aggregateScores.positiveCount,
    negative: aggregateScores.negativeCount,
    neutral: aggregateScores.neutralCount,
    rollingScore: aggregateScores.rollingScore,
    trend: aggregateScores.recentTrend.slice(-20),
    correctionCount: aggregateScores.corrections.length,
    uniqueUsers: Object.keys(aggregateScores.userScores).length,
  };
}

// ============ Persistence ============

async function save() {
  if (!dirty) return;
  dirty = false;

  try {
    await Promise.all([
      writeFile(SIGNALS_FILE, JSON.stringify(signals), 'utf-8'),
      writeFile(SCORES_FILE, JSON.stringify(aggregateScores), 'utf-8'),
    ]);
  } catch (err) {
    console.error(`[reward-signal] Save failed: ${err.message}`);
    dirty = true;
  }
}
