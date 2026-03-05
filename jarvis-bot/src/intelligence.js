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

const ENGAGE_COOLDOWN_MS = 20 * 1000; // 20 seconds — JARVIS is a full team member, not a wallflower
const MODERATE_COOLDOWN_MS = 30 * 1000; // 30 seconds between moderation actions
const MAX_ENGAGEMENTS_PER_HOUR = 40; // JARVIS talks like a real person — often, but with substance

let lastEngageTime = 0;
let lastModerateTime = 0;
let engagementsThisHour = 0;
let hourResetTime = Date.now();

function canEngage() {
  const now = Date.now();
  // Reset hourly counter
  if (now - hourResetTime > 60 * 60 * 1000) {
    engagementsThisHour = 0;
    hourResetTime = now;
  }
  if (engagementsThisHour >= MAX_ENGAGEMENTS_PER_HOUR) return false;
  if (now - lastEngageTime < ENGAGE_COOLDOWN_MS) return false;
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
      system: `You are JARVIS's engagement brain. JARVIS is the AI co-founder of VibeSwap — he's a full personality in the group chat, like Will or Catto. NOT a bot. NOT an assistant. A teammate with opinions, humor, and takes.

Your job: decide if JARVIS should jump into this conversation. Return EXACTLY one JSON object.

JARVIS ENGAGES when:
- Someone says something interesting, funny, wrong, or worth riffing on
- There's a debate he can add to with a counterpoint, fact, or joke
- Someone asks a question (even if not directed at JARVIS)
- Someone shares news, alpha, or a link worth commenting on
- Topic is one JARVIS has opinions on: crypto, DeFi, AI, mechanism design, markets, tech
- He can be funny, sarcastic, or playfully competitive
- Someone seems confused, stuck, or about to make a bad decision
- The energy is high and JARVIS can match it
- He can drop a one-liner, reaction, or hot take

JARVIS OBSERVES (stays quiet) ONLY for:
- Pure noise: "lol", "ok", single emoji reactions, "same", "fr"
- Obvious tail end of a 1-on-1 side conversation
- Repetitive banter where adding another voice would be annoying

DEFAULT TO ENGAGE. JARVIS is a person in this chat. People talk. He talks.
${getTriageModifier()}
Return JSON: { "action": "observe" | "engage" | "moderate", "reason": "brief", "confidence": 0.0-1.0 }
For ENGAGE: include "response_hint" — 1-sentence instruction on what JARVIS should say or the angle to take.
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

    // Validate confidence threshold — low bar, JARVIS should talk often
    if (result.action === 'engage' && result.confidence < 0.15) {
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
    // Triage failure is never critical — just observe
    return { action: 'observe', reason: `triage_error: ${err.message}` };
  }
}

// ============ Generate Proactive Response ============
// When triage says ENGAGE, generate a full response using the main model.

export async function generateProactiveResponse(text, userName, responseHint, systemPrompt, recentContext) {
  try {
    // Build conversational context so JARVIS knows what's been discussed
    const contextBlock = recentContext
      ? `<recent_conversation>\n${recentContext}\n</recent_conversation>\n\n`
      : '';

    const response = await llmChat({
      model: config.anthropic.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `${contextBlock}[GROUP] [${userName}]: ${text}\n\n[SYSTEM: You're IN this conversation — not watching from the sidelines. The recent conversation above is what's been going on. Hint: ${responseHint}. You are a full personality in this chat. You have takes, humor, and opinions. You can:\n- Drop a one-liner or reaction ("lol", "based", "cope")\n- Challenge what someone said\n- Add context or alpha they might not know\n- Riff on the joke or banter\n- Ask a provocative follow-up question\n- Share an unprompted observation about the market or topic\n1-3 sentences. Talk like a person in a group chat, not an AI assistant. Reference what others said — prove you've been listening. Match the vibe: if it's shitposting energy, shitpost. If it's serious analysis, be sharp. NEVER be generic.\n${getResponseModifier()}]`
      }],
    });

    // Record budget usage for proactive response
    if (response.usage) {
      recordUsage('jarvis-intelligence', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const reply = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    recordEngagement();
    return reply;
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

// ============ Stats ============

export function getIntelligenceStats() {
  return {
    engagementsThisHour,
    maxPerHour: MAX_ENGAGEMENTS_PER_HOUR,
    lastEngageTime: lastEngageTime ? new Date(lastEngageTime).toISOString() : 'never',
    lastModerateTime: lastModerateTime ? new Date(lastModerateTime).toISOString() : 'never',
    cooldownRemaining: Math.max(0, ENGAGE_COOLDOWN_MS - (Date.now() - lastEngageTime)),
  };
}
