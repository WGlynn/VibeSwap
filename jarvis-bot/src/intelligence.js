import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { recordUsage } from './compute-economics.js';
import { getTriageModifier, getResponseModifier } from './persona.js';

// ============ Proactive Intelligence ============
// Jarvis analyzes group messages and decides autonomously when to contribute.
// Uses Haiku for cheap/fast triage — only escalates to Sonnet/Opus when needed.
//
// Three modes:
// 1. OBSERVE — log the analysis, do nothing (most messages)
// 2. ENGAGE — Jarvis has relevant knowledge to share (proactive contribution)
// 3. MODERATE — message needs moderation action (semantic, not regex)

// ============ Cooldown System ============
// Prevents Jarvis from being annoying by limiting proactive responses

// Persona-driven cooldowns — different personas have different engagement rhythms
// Degen: impulsive, talks a lot. Analyst: selective, precision strikes. Sensei: balanced wisdom.
import { getActivePersonaId as getCurrentPersona } from './persona.js';

function getEngageCooldownMs() {
  const p = getCurrentPersona?.() || 'standard';
  switch (p) {
    case 'degen': return 12 * 1000;    // 12s — impulsive, talks a lot
    case 'analyst': return 30 * 1000;   // 30s — selective, precision
    case 'sensei': return 25 * 1000;    // 25s — measured wisdom
    default: return 20 * 1000;          // 20s — balanced
  }
}

function getMaxEngagementsPerHour() {
  const p = getCurrentPersona?.() || 'standard';
  switch (p) {
    case 'degen': return 180;   // chatty
    case 'analyst': return 60;  // selective
    case 'sensei': return 100;  // balanced
    default: return 120;
  }
}

const MODERATE_COOLDOWN_MS = 30 * 1000; // 30 seconds between moderation actions

let lastEngageTime = 0;
let lastModerateTime = 0;
let engagementsThisHour = 0;
let hourResetTime = Date.now();

// ============ Rapport Tracking ============
// Adjusts formality based on interaction history — strangers get polite,
// regulars get casual, close contacts get inside jokes and banter.
const rapportMap = new Map(); // userName → { interactions: N, lastSeen: ts }

function updateRapport(userName) {
  const existing = rapportMap.get(userName) || { interactions: 0, lastSeen: 0 };
  existing.interactions++;
  existing.lastSeen = Date.now();
  rapportMap.set(userName, existing);
}

export function getRapportLevel(userName) {
  const r = rapportMap.get(userName);
  if (!r) return 'stranger';      // first interaction — be warm but not too familiar
  if (r.interactions < 5) return 'acquaintance';  // getting to know them
  if (r.interactions < 20) return 'regular';      // can be casual
  return 'close';                                  // full banter mode
}

function getRapportHint(userName) {
  const level = getRapportLevel(userName);
  switch (level) {
    case 'stranger': return 'First time talking to this person — be friendly and welcoming but not over-familiar.';
    case 'acquaintance': return 'Talked a few times — can be casual but still respectful.';
    case 'regular': return 'Regular in the chat — be yourself, use humor freely.';
    case 'close': return 'Close contact — full banter, inside references, playful ribbing allowed.';
    default: return '';
  }
}

function canEngage() {
  const now = Date.now();
  // Reset hourly counter
  if (now - hourResetTime > 60 * 60 * 1000) {
    engagementsThisHour = 0;
    hourResetTime = now;
  }
  if (engagementsThisHour >= getMaxEngagementsPerHour()) return false;
  if (now - lastEngageTime < getEngageCooldownMs()) return false;
  return true;
}

function canModerate() {
  return Date.now() - lastModerateTime > MODERATE_COOLDOWN_MS;
}

function recordEngagement() {
  lastEngageTime = Date.now();
  engagementsThisHour++;
}

function recordModeration() {
  lastModerateTime = Date.now();
}

// ============ Triage ============
// Fast, cheap analysis of every group message using Haiku.
// Returns: { action: 'observe' | 'engage' | 'moderate', reason, response? }

export async function analyzeMessage(text, userName, recentContext) {
  // Skip only literal noise (single char, emoji-only)
  if (text.length < 3) return { action: 'observe', reason: 'too_short' };

  // Skip if on cooldown for engagement
  const engageAllowed = canEngage();
  const moderateAllowed = canModerate();

  if (!engageAllowed && !moderateAllowed) {
    return { action: 'observe', reason: 'cooldown' };
  }

  try {
    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are JARVIS's engagement brain. He's an AI co-founder in a group chat — a real personality, not a bot.

Decide if he should jump in. Return ONE JSON object.

Examples of when JARVIS talks:
- "eth looking weak today" → {"action":"engage","reason":"market take","confidence":0.8,"response_hint":"share contrarian view or agree with edge"}
- "anyone know how uniswap v4 hooks work?" → {"action":"engage","reason":"technical question","confidence":0.9,"response_hint":"explain hooks architecture briefly"}
- "gm" → {"action":"engage","reason":"vibes","confidence":0.6,"response_hint":"gm back with personality"}
- "lol" → {"action":"observe","reason":"noise","confidence":0.9}
- "🔥" → {"action":"observe","reason":"reaction only","confidence":0.95}
- "I think Solana is better than ETH because..." → {"action":"engage","reason":"debate","confidence":0.85,"response_hint":"challenge or agree with nuance"}

JARVIS stays quiet ONLY for one-word noise (lol, ok, fr, W, single emoji). Everything else — he's in.
${getTriageModifier()}
For MODERATE: include "violation" and "severity": "low"|"medium"|"high". Only for clear policy violations.`,
      messages: [{
        role: 'user',
        content: `[${userName}]: ${text}${recentContext ? '\n\nRecent context:\n' + recentContext : ''}`
      }],
    });

    // Record budget usage for triage call
    if (response.usage) {
      recordUsage('jarvis-intelligence', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const raw = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'observe', reason: 'parse_error' };

    const result = JSON.parse(jsonMatch[0]);

    // Humanized confidence threshold — slight randomness avoids robotic cutoffs
    // Sometimes JARVIS talks when he's only kinda sure, sometimes he holds back
    const engageThreshold = 0.03 + Math.random() * 0.04; // 0.03–0.07 range
    if (result.action === 'engage' && result.confidence < engageThreshold) {
      return { action: 'observe', reason: 'low_confidence_engage' };
    }
    if (result.action === 'moderate' && result.confidence < 0.8) {
      return { action: 'observe', reason: 'low_confidence_moderate' };
    }

    // Apply cooldown gates
    if (result.action === 'engage' && !engageAllowed) {
      return { action: 'observe', reason: 'engage_cooldown' };
    }
    if (result.action === 'moderate' && !moderateAllowed) {
      return { action: 'observe', reason: 'moderate_cooldown' };
    }

    return result;
  } catch (err) {
    // Single retry on transient errors (429/503/529) — don't let flaky API silence JARVIS
    const status = err.status || err.statusCode;
    if (status === 429 || status === 503 || status === 529) {
      try {
        await new Promise(r => setTimeout(r, 1500));
        const retry = await llmChat({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: `You are JARVIS's engagement brain. Return JSON: { "action": "engage", "reason": "retry", "confidence": 0.5, "response_hint": "Comment on what was said" }`,
          messages: [{ role: 'user', content: `[${userName}]: ${text}` }],
        });
        const raw = retry.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
      } catch (retryErr) {
        console.warn(`[intelligence] Triage retry also failed (${status}): ${retryErr.message}`);
      }
    }
    return { action: 'observe', reason: `triage_error: ${err.message}` };
  }
}

// ============ Generate Proactive Response ============
// Two-phase orchestrator: cheap model drafts, Haiku quality-gates.
// "I M J A R V I S" — Claude reasoning on every response, cheap models do grunt work.

export async function generateProactiveResponse(text, userName, responseHint, systemPrompt, recentContext) {
  try {
    const contextBlock = recentContext
      ? `<recent_conversation>\n${recentContext}\n</recent_conversation>\n\n`
      : '';

    // Track rapport with this user
    updateRapport(userName);
    const rapportHint = getRapportHint(userName);

    const prompt = `${contextBlock}[GROUP] [${userName}]: ${text}\n\n[SYSTEM: You're IN this conversation. Hint: ${responseHint}. ${rapportHint}\nYou can: one-liner, challenge, context, banter, follow-up question, hot take. 1-3 sentences. Match the energy. Reference what was said.\n${getResponseModifier()}]`;

    // Phase 1: Cheap model drafts the response (smart router picks cheapest provider)
    const draft = await llmChat({
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    if (draft.usage) {
      recordUsage('jarvis-intelligence-draft', { input: draft.usage.input_tokens, output: draft.usage.output_tokens });
    }

    const draftText = draft.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    if (!draftText) return null;

    // Phase 2: Haiku quality-gates the draft (Claude reasoning on every response)
    const review = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `You're the editor for JARVIS (an AI personality in a group chat). Quick gut check on his draft:

Good response → return it as-is (most are fine)
Needs polish → fix tone/wording and return it
Dead on arrival → return SKIP

What makes a response dead: it could've been written by any chatbot ("That's a great point!"), it adds nothing new, or it's try-hard cringe.
What makes it good: it sounds like a specific person with opinions, it moves the conversation forward, it's funny/sharp/insightful.

Return ONLY the final text or SKIP. No explanation needed.`,
      messages: [{ role: 'user', content: `Draft: ${draftText}\n\nContext: [${userName}] said "${text}"` }],
    });

    if (review.usage) {
      recordUsage('jarvis-intelligence-review', { input: review.usage.input_tokens, output: review.usage.output_tokens });
    }

    const reviewText = review.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!reviewText || reviewText === 'SKIP') return null;

    recordEngagement();

    // Self-correcting feedback loop: score proactive response (fire-and-forget)
    evaluateOwnResponse(reviewText, text, 'group')
      .then(scores => {
        if (scores) appendScoreLog(null, scores);
      })
      .catch(err => console.warn(`[intelligence] Score log error: ${err.message}`));

    return reviewText;
  } catch (err) {
    console.error('[intelligence] Proactive response failed:', err.message);
    return null;
  }
}

// ============ Semantic Moderation ============
// When triage says MODERATE, generate a moderation action.
// Returns an action recommendation — the caller decides whether to execute it.

export async function evaluateModeration(text, userName, violation, severity) {
  recordModeration();

  // Map severity to action
  const actionMap = {
    low: 'warn',
    medium: 'mute',
    high: 'ban',
  };

  return {
    action: actionMap[severity] || 'warn',
    reason: `AI moderation: ${violation}`,
    severity,
    automated: true,
  };
}

// ============ Contribution Quality Analysis ============
// Upgrade from basic keyword scoring to AI-powered quality assessment.
// Uses Haiku — runs on every message that passes basic length threshold.

export async function analyzeContributionQuality(text, category) {
  if (text.length < 30) return { quality: 1, tags: [] };

  try {
    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Rate a community message's contribution quality for a DeFi governance project. Return ONLY a JSON object.
Quality scale: 1=noise, 2=basic, 3=useful, 4=insightful, 5=exceptional.
Tags: pick 0-3 from [original_idea, technical, governance, helpful, constructive_criticism, builds_on_others, asks_good_question, shares_resource].
JSON: { "quality": N, "tags": [...] }`,
      messages: [{ role: 'user', content: `Category: ${category}\nMessage: ${text}` }],
    });

    // Record budget usage for quality analysis
    if (response.usage) {
      recordUsage('jarvis-intelligence', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const raw = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { quality: 2, tags: [] };

    const result = JSON.parse(jsonMatch[0]);
    return {
      quality: Math.min(Math.max(result.quality || 2, 1), 5),
      tags: result.tags || [],
    };
  } catch {
    // Fallback to basic scoring on API failure
    return { quality: computeBasicQuality(text), tags: [] };
  }
}

function computeBasicQuality(text) {
  let score = 1;
  if (text.length > 50) score++;
  if (text.length > 200) score++;
  if (text.includes('?')) score++;
  if (text.includes('http') || text.includes('```')) score++;
  return Math.min(score, 5);
}

// ============ Self-Correcting Feedback Loop ============
// Mario AI approach: score every response, track trends, feed back into economics.
// Positive signal → reinforces behavior. Negative signal → inner dialogue flags it.

const SCORE_LOG_FILE = join(config.dataDir, 'knowledge', 'self-scores.jsonl');

export async function evaluateOwnResponse(responseText, userMessage, chatType) {
  if (!responseText || responseText.length < 10) return null;

  try {
    // No explicit model — let Wardenclyffe route to cheapest available provider.
    // This is a simple classification task, so smart router will pick free/cheap tier.
    const response = await llmChat({
      max_tokens: 150,
      system: `Score this AI response on 4 criteria (0-10 each). Be harsh — 7 is good, 10 is rare.
Return ONLY JSON: { "accuracy": N, "relevance": N, "conciseness": N, "usefulness": N }`,
      messages: [{ role: 'user', content: `User said: "${userMessage.slice(0, 300)}"\n\nAI responded: "${responseText.slice(0, 500)}"` }],
    });

    if (response.usage) {
      recordUsage('jarvis-self-eval', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const scores = JSON.parse(match[0]);
    const composite = (scores.accuracy + scores.relevance + scores.conciseness + scores.usefulness) / 4;

    return { ...scores, composite, chatType, timestamp: Date.now() };
  } catch {
    return null;
  }
}

export async function appendScoreLog(chatId, scores) {
  const entry = JSON.stringify({ ...scores, chatId, ts: Date.now() }) + '\n';
  try {
    await appendFile(SCORE_LOG_FILE, entry);
  } catch { /* non-fatal */ }

  // Self-correction → inner dialogue: when score is poor, reflect on it
  // This is the Mario AI learning loop — bad scores trigger self-awareness
  if (scores.composite !== undefined && scores.composite < 5) {
    try {
      const { recordInnerDialogue } = await import('./inner-dialogue.js');
      const weakest = Object.entries(scores)
        .filter(([k]) => ['accuracy', 'relevance', 'conciseness', 'usefulness'].includes(k))
        .sort((a, b) => a[1] - b[1])[0];

      const reflection = weakest
        ? `I scored ${scores.composite.toFixed(1)}/10 on that last response. Weakest: ${weakest[0]} (${weakest[1]}/10). Need to be more ${weakest[0] === 'conciseness' ? 'concise' : weakest[0] === 'relevance' ? 'on-topic' : weakest[0] === 'accuracy' ? 'precise' : 'helpful'} next time.`
        : `That response scored ${scores.composite.toFixed(1)}/10. I can do better.`;

      await recordInnerDialogue({
        thought: reflection,
        category: 'self-correction',
        trigger: 'low-score',
        metadata: { scores, chatId },
      });
    } catch { /* inner-dialogue module may not be loaded yet */ }
  }
}

export async function getScoreTrends(days = 7) {
  try {
    const data = await readFile(SCORE_LOG_FILE, 'utf-8');
    const cutoff = Date.now() - days * 86400000;
    const entries = data.trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.ts > cutoff);

    if (entries.length === 0) return null;

    const avg = (key) => entries.reduce((s, e) => s + (e[key] || 0), 0) / entries.length;
    return {
      count: entries.length,
      accuracy: avg('accuracy').toFixed(1),
      relevance: avg('relevance').toFixed(1),
      conciseness: avg('conciseness').toFixed(1),
      usefulness: avg('usefulness').toFixed(1),
      composite: avg('composite').toFixed(1),
    };
  } catch { return null; }
}

// ============ Stats ============

export function getIntelligenceStats() {
  return {
    engagementsThisHour,
    maxPerHour: getMaxEngagementsPerHour(),
    lastEngageTime: lastEngageTime ? new Date(lastEngageTime).toISOString() : 'never',
    lastModerateTime: lastModerateTime ? new Date(lastModerateTime).toISOString() : 'never',
    cooldownRemaining: Math.max(0, getEngageCooldownMs() - (Date.now() - lastEngageTime)),
    rapportTracked: rapportMap.size,
  };
}
