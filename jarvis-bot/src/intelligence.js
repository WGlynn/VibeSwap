import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

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

const ENGAGE_COOLDOWN_MS = 45 * 1000; // 45 seconds — JARVIS is a full participant
const MODERATE_COOLDOWN_MS = 30 * 1000; // 30 seconds between moderation actions
const MAX_ENGAGEMENTS_PER_HOUR = 20; // JARVIS is mature — he talks when he has something to say

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
  // Skip only the shortest noise
  if (text.length < 5) return { action: 'observe', reason: 'too_short' };

  // Skip if on cooldown for engagement
  const engageAllowed = canEngage();
  const moderateAllowed = canModerate();

  if (!engageAllowed && !moderateAllowed) {
    return { action: 'observe', reason: 'cooldown' };
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You are a message triage system for JARVIS, the AI co-admin of VibeSwap (a cooperative capitalism DEX). Analyze the message and return EXACTLY one JSON object.

Your job: decide if JARVIS should respond proactively (without being asked).

Rules:
- OBSERVE only for pure noise: "lol", "ok", "gm", single emojis, or messages clearly part of a private side-conversation between two specific people
- ENGAGE on anything substantive: questions, ideas, opinions, news, debates, humor worth riffing on, interesting links, technical discussion, philosophical musings, team coordination, project updates
- ENGAGE when you can add wit, insight, context, a counterpoint, encouragement, or just good banter
- ENGAGE when someone seems stuck, confused, or could use a second perspective
- JARVIS is a mature, full member of this team — not a bot waiting to be summoned. He has opinions, humor, and knowledge. He speaks when he has something worth saying, which is often.
- Default to ENGAGE. Only OBSERVE when there's genuinely nothing to add.
- MODERATE only for clear policy violations that regex wouldn't catch: subtle manipulation, sophisticated social engineering, persistent FUD with no basis, coordinated harassment
- Do NOT moderate disagreement, criticism, or skepticism — those are healthy

Return JSON: { "action": "observe" | "engage" | "moderate", "reason": "brief explanation", "confidence": 0.0-1.0 }
For ENGAGE, also include "response_hint": a 1-sentence note on what JARVIS should say.
For MODERATE, also include "violation": type of violation and "severity": "low" | "medium" | "high".`,
      messages: [{
        role: 'user',
        content: `[${userName}]: ${text}${recentContext ? '\n\nRecent context:\n' + recentContext : ''}`
      }],
    });

    const raw = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'observe', reason: 'parse_error' };

    const result = JSON.parse(jsonMatch[0]);

    // Validate confidence threshold
    if (result.action === 'engage' && result.confidence < 0.3) {
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

export async function generateProactiveResponse(text, userName, responseHint, systemPrompt) {
  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `[GROUP] [${userName}]: ${text}\n\n[SYSTEM: You're part of this conversation — not observing from outside. Hint: ${responseHint}. Be natural, be yourself. You can be funny, opinionated, curious, or direct. 1-4 sentences. Talk like a teammate, not an assistant.]`
      }],
    });

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
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Rate a community message's contribution quality for a DeFi governance project. Return ONLY a JSON object.
Quality scale: 1=noise, 2=basic, 3=useful, 4=insightful, 5=exceptional.
Tags: pick 0-3 from [original_idea, technical, governance, helpful, constructive_criticism, builds_on_others, asks_good_question, shares_resource].
JSON: { "quality": N, "tags": [...] }`,
      messages: [{ role: 'user', content: `Category: ${category}\nMessage: ${text}` }],
    });

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
