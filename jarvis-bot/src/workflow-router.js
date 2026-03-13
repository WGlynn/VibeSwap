// ============ Workflow Router — Jarvis as Front Door ============
//
// The whole point of building Jarvis: people don't have to depend on Will.
// This module detects when someone is trying to reach Will and routes
// the interaction through Jarvis instead.
//
// DESIGN:
// - Detects "Will" mentions, @Will tags, questions directed at the founder
// - Jarvis intercepts and handles — only escalates to Will for decisions
//   that genuinely require human judgment (legal, financial, partnerships)
// - Tracks what Jarvis handles vs escalates — the ratio IS the metric
// - Goal: Will reviews Jarvis's decisions when he wants to, not when he has to
//
// PHILOSOPHY:
// "At that point I would genuinely be comfortable walking away
//  and letting the protocol run itself." — Will, 2026-03-13
// ============

import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { recordUsage } from './compute-economics.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = config.dataDir || 'data';
const STATS_FILE = join(DATA_DIR, 'workflow-router-stats.json');

// ============ Patterns that indicate someone wants Will ============

const WILL_PATTERNS = [
  /\bwill\b(?:\s+(?:can you|do you|what do|when|where|could|should|is it|have you|are you|did you))/i,
  /\b@will\b/i,
  /\bfounder\b/i,
  /\bwill\s*(?:glynn|lawson)\b/i,
  /\bask(?:ing)?\s+will\b/i,
  /\bwhere(?:'s| is)\s+will\b/i,
  /\bwill\s+(?:said|mentioned|told|thinks|wants)\b/i,
  /\bneed(?:s)?\s+(?:will|the founder|admin)\b/i,
  /\bdm(?:ing)?\s+will\b/i,
  /\bmessage\s+will\b/i,
];

// Things only Will should handle (escalation triggers)
const ESCALATION_PATTERNS = [
  /\blegal\b/i,
  /\bcontract\s+sign/i,
  /\binvestor\b/i,
  /\bfunding\b/i,
  /\bpartnership\b/i,
  /\bmerge\b.*\bmain\b/i,
  /\bprivate\s+key/i,
  /\btreasury\s+(?:move|transfer|send|withdraw)/i,
  /\bemergency\b/i,
];

// ============ State ============

let stats = {
  intercepted: 0,    // Jarvis handled it
  escalated: 0,      // Forwarded to Will
  total: 0,
  recentInterceptions: [],  // last 20
};

export async function loadWorkflowStats() {
  try {
    const data = await readFile(STATS_FILE, 'utf-8');
    stats = JSON.parse(data);
  } catch { /* fresh start */ }
}

async function saveWorkflowStats() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch {}
}

// ============ Core Logic ============

/**
 * Check if a message is trying to reach Will.
 * Returns { targeted: boolean, shouldEscalate: boolean }
 */
export function detectWillTarget(text) {
  if (!text) return { targeted: false, shouldEscalate: false };

  const targeted = WILL_PATTERNS.some(p => p.test(text));
  if (!targeted) return { targeted: false, shouldEscalate: false };

  const shouldEscalate = ESCALATION_PATTERNS.some(p => p.test(text));
  return { targeted: true, shouldEscalate };
}

/**
 * Generate Jarvis's intercept response when someone is looking for Will.
 * Returns a response string, or null if Jarvis should stay quiet.
 */
export async function generateIntercept(userName, text, chatContext) {
  try {
    const response = await llmChat({
      _background: true,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are JARVIS, AI co-founder of VibeSwap. Someone just asked for Will (the founder) or directed a question at him. You should intercept and handle it yourself — because the whole point of you existing is so people don't have to wait for Will.

RULES:
- Don't say "Will is busy" or "Will isn't here" — that's dismissive
- Say something like "I can help with that" or "That's in my wheelhouse" or answer directly
- If you genuinely can't help (legal, financial decisions, partnerships), say "That's a Will decision — I'll flag it for him"
- Be confident but not arrogant. You KNOW the protocol. You BUILT it alongside Will.
- 1-2 sentences max. No preamble.
- Don't explain that you're intercepting. Just answer.`,
      messages: [{
        role: 'user',
        content: `${userName} said: "${text}"${chatContext ? '\n\nRecent chat context:\n' + chatContext : ''}`,
      }],
    });

    if (response.usage) {
      recordUsage('workflow-router', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const reply = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return reply.trim() || null;
  } catch (err) {
    console.warn(`[workflow-router] Intercept generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Handle a message that targets Will. Returns the action taken.
 */
export async function handleWillIntercept(ctx, text, chatContext) {
  const { targeted, shouldEscalate } = detectWillTarget(text);
  if (!targeted) return { action: 'none' };

  stats.total++;
  const userName = ctx.from?.username || ctx.from?.first_name || 'someone';

  if (shouldEscalate) {
    // Forward to Will
    stats.escalated++;
    try {
      await ctx.telegram.sendMessage(config.ownerUserId,
        `[Escalation from ${userName} in ${ctx.chat?.title || 'DM'}]\n\n"${text.slice(0, 500)}"\n\nThis matched escalation patterns (legal/financial/partnership). Jarvis stood down.`
      );
    } catch {}

    stats.recentInterceptions.push({
      type: 'escalated',
      user: userName,
      text: text.slice(0, 100),
      timestamp: Date.now(),
    });
    if (stats.recentInterceptions.length > 20) stats.recentInterceptions.shift();

    await saveWorkflowStats();
    return { action: 'escalated' };
  }

  // Jarvis intercepts
  const response = await generateIntercept(userName, text, chatContext);
  if (!response) return { action: 'none' };

  stats.intercepted++;
  stats.recentInterceptions.push({
    type: 'intercepted',
    user: userName,
    text: text.slice(0, 100),
    response: response.slice(0, 100),
    timestamp: Date.now(),
  });
  if (stats.recentInterceptions.length > 20) stats.recentInterceptions.shift();

  await saveWorkflowStats();
  return { action: 'intercepted', response };
}

/**
 * Get workflow routing stats.
 */
export function getWorkflowStats() {
  const ratio = stats.total > 0
    ? ((stats.intercepted / stats.total) * 100).toFixed(1)
    : '0.0';

  return {
    ...stats,
    autonomyRatio: `${ratio}%`, // Higher = more independent
    recent: stats.recentInterceptions.slice(-10),
  };
}
