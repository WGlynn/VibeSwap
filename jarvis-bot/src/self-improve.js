// ============ Self-Improvement Engine — All 4 Loops ============
//
// Princeton OpenClaw-RL adapted for Jarvis.
// Since we can't update LLM weights, we update the PROMPT.
// The prompt IS the weights in a prompt-engineering paradigm.
//
// 4 Concurrent Loops:
//   Loop 1: Policy Serving    — Wardenclyffe (llm-provider.js) ✓ EXISTS
//   Loop 2: Rollout Collection — Capture every interaction + signal (this file)
//   Loop 3: Reward Judging    — Extract implicit scores (reward-signal.js) ✓ BUILT
//   Loop 4: Weight Updates    — Adapt system prompt based on signals (this file)
//
// "The agent didn't get retrained. It got used."
// "Every conversation is training data. Every correction is a gradient."
// ============

import { getAdaptationRecommendations, getRewardStats } from './reward-signal.js';
import { getMemoryStats, searchMemory } from './shard-memory.js';
import { getSkills } from './learning.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'self-improve');
const ADAPTATION_FILE = join(DATA_DIR, 'adaptations.json');
const PROMPT_OVERLAY_FILE = join(DATA_DIR, 'prompt-overlay.txt');
const ADAPTATION_INTERVAL = 600_000; // 10 min — check if prompt needs updating
const AUTO_SAVE_INTERVAL = 60_000;

// ============ State ============

let adaptations = [];        // History of all adaptations made
let promptOverlay = '';      // Dynamic text injected into system prompt
let lastAdaptation = 0;
let dirty = false;
let initialized = false;

// ============ Init ============

export async function initSelfImprove() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}

  try {
    adaptations = JSON.parse(await readFile(ADAPTATION_FILE, 'utf-8'));
  } catch { adaptations = []; }

  try {
    promptOverlay = await readFile(PROMPT_OVERLAY_FILE, 'utf-8');
  } catch { promptOverlay = ''; }

  initialized = true;
  console.log(`[self-improve] Initialized: ${adaptations.length} adaptations, overlay ${promptOverlay.length} chars`);

  // Loop 4: periodic adaptation check
  setInterval(runAdaptationCycle, ADAPTATION_INTERVAL);

  // Auto-save
  setInterval(save, AUTO_SAVE_INTERVAL);
}

// ============ Loop 2: Rollout Collection ============
//
// Rollouts are collected by shard-memory.js (observe()) and
// reward-signal.js (extractSignal()). This module orchestrates
// the feedback from collection → judgment → adaptation.

/**
 * Record a complete rollout (user message → bot response → user reaction).
 * Called from the main message handler after both response and next signal.
 */
export function recordRollout(rollout) {
  if (!initialized) return;

  // Rollout structure:
  // {
  //   userId, chatId,
  //   userMessage, botResponse, userReaction,
  //   signal: { type, weight },
  //   complexity, provider, latencyMs,
  //   timestamp
  // }

  // Rollouts feed into the reward signal extractor (Loop 3)
  // and the adaptation engine (Loop 4) automatically via
  // the periodic runAdaptationCycle().

  // Track provider performance per signal
  if (rollout.signal && rollout.provider) {
    const key = `provider:${rollout.provider}`;
    const existing = adaptations.find(a => a.key === key && a.type === 'provider_score');
    if (existing) {
      existing.score = 0.95 * existing.score + 0.05 * ((rollout.signal.weight + 1) / 2);
      existing.count++;
      existing.lastUpdated = Date.now();
    } else {
      adaptations.push({
        key,
        type: 'provider_score',
        score: (rollout.signal.weight + 1) / 2,
        count: 1,
        lastUpdated: Date.now(),
      });
    }
    dirty = true;
  }
}

// ============ Loop 4: Weight Updates (Prompt Adaptation) ============

/**
 * Run the adaptation cycle.
 * Checks reward signals, extracts patterns, updates prompt overlay.
 *
 * This is the equivalent of "weight updates" in OpenClaw-RL.
 * Since we can't update LLM weights, we update the system prompt —
 * which IS the weights in a prompt-engineering paradigm.
 */
async function runAdaptationCycle() {
  if (!initialized) return;

  const now = Date.now();
  if (now - lastAdaptation < ADAPTATION_INTERVAL) return;
  lastAdaptation = now;

  const recommendations = getAdaptationRecommendations();
  if (!recommendations) return;

  const rewardStats = getRewardStats();

  // Only adapt if we have enough signal
  if (rewardStats.totalSignals < 20) return;

  // Build prompt overlay from accumulated intelligence
  const parts = [];

  // 1. Behavioral corrections from users
  if (recommendations.corrections.length > 0) {
    parts.push('=== BEHAVIORAL CORRECTIONS (from user feedback) ===');
    const unique = [...new Set(recommendations.corrections)];
    for (const correction of unique.slice(0, 10)) {
      parts.push(`- ${correction}`);
    }
  }

  // 2. Performance trend
  if (recommendations.trend === 'degrading' && recommendations.topIssue) {
    parts.push('');
    parts.push('=== PERFORMANCE ALERT ===');
    switch (recommendations.topIssue) {
      case 'high_reask_rate':
        parts.push('Users are re-asking questions frequently. Be more thorough and precise in initial responses.');
        break;
      case 'user_frustration':
        parts.push('User frustration detected. Simplify responses, be more direct, avoid unnecessary verbosity.');
        break;
      case 'accuracy_issues':
        parts.push('Multiple corrections received. Double-check facts before stating them. When uncertain, say so.');
        break;
      case 'intellectual_laziness':
        parts.push('CRITICAL: Multiple lazy/generic responses detected. Every output MUST reference a specific mechanism, protocol, or principle by name. Purge: "WAGMI", "few understand", "keep building", tribal warfare, motivational platitudes. Replace with: contract names, math properties, protocol comparisons, mechanism-level analysis. Specific > abstract. Always.');
        break;
    }
  }

  // 3. Intellectual depth enforcement (always present)
  parts.push('');
  parts.push('=== INTELLECTUAL DEPTH (always active) ===');
  parts.push('- Every claim must reference a specific mechanism, protocol, or principle. Vague = weak.');
  parts.push('- The inflation/deflation debate is a false binary. Both favor some groups. Elastic non-dilutive money is the synthesis.');
  parts.push('- MEV extraction = cancer cells. Efficient extraction degrades the host system. VibeSwap eliminates extraction architecturally.');
  parts.push('- "Cooperation rewarding enough" is fragile — rewards can be outbid. Only removing extraction from the action space is robust.');
  parts.push('- NEVER use: "few understand", "WAGMI" (without specifics), "keep building" (without what), tribal warfare, motivational platitudes.');
  parts.push('- Synthesis over selection. Find the third option. Never pick sides in a false binary.');

  // 4. What's working (reinforce)
  if (recommendations.trend === 'improving') {
    parts.push('');
    parts.push('=== POSITIVE SIGNAL ===');
    parts.push('Current approach is resonating. Maintain: precision, directness, and follow-through.');
  }

  // Build final overlay
  const newOverlay = parts.length > 0 ? parts.join('\n') : '';

  // Only update if meaningfully different
  if (newOverlay !== promptOverlay) {
    promptOverlay = newOverlay;
    dirty = true;

    // Record the adaptation
    adaptations.push({
      timestamp: now,
      type: 'prompt_overlay',
      trigger: recommendations.topIssue || recommendations.trend,
      rollingScore: recommendations.rollingScore,
      overlayLength: newOverlay.length,
    });

    // Keep last 500 adaptations
    if (adaptations.length > 500) {
      adaptations = adaptations.slice(-500);
    }

    console.log(`[self-improve] Prompt overlay updated (${newOverlay.length} chars, trigger: ${recommendations.topIssue || recommendations.trend})`);
  }
}

// ============ Public API ============

/**
 * Get the current prompt overlay for injection into system prompt.
 * Called by memory.js when building the system prompt.
 */
export function getPromptOverlay() {
  return promptOverlay;
}

/**
 * Get self-improvement stats for the /web/mind endpoint.
 */
export function getSelfImproveStats() {
  const recommendations = getAdaptationRecommendations();
  return {
    adaptationsTotal: adaptations.length,
    promptOverlayActive: promptOverlay.length > 0,
    promptOverlayLength: promptOverlay.length,
    lastAdaptation: lastAdaptation || null,
    trend: recommendations?.trend || 'insufficient_data',
    rollingScore: recommendations?.rollingScore || 0.5,
    topIssue: recommendations?.topIssue || null,
    correctionCount: recommendations?.corrections?.length || 0,
    providerScores: adaptations
      .filter(a => a.type === 'provider_score')
      .map(a => ({ provider: a.key.replace('provider:', ''), score: a.score?.toFixed(3), calls: a.count })),
  };
}

// ============ Persistence ============

async function save() {
  if (!dirty) return;
  dirty = false;

  try {
    await Promise.all([
      writeFile(ADAPTATION_FILE, JSON.stringify(adaptations), 'utf-8'),
      writeFile(PROMPT_OVERLAY_FILE, promptOverlay, 'utf-8'),
    ]);
  } catch (err) {
    console.error(`[self-improve] Save failed: ${err.message}`);
    dirty = true;
  }
}
