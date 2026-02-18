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

const ENGAGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between proactive engagements
const MODERATE_COOLDOWN_MS = 30 * 1000; // 30 seconds between moderation actions
const MAX_ENGAGEMENTS_PER_HOUR = 4; // Don't dominate the conversation

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
  // Skip very short messages — not worth analyzing
  if (text.length < 20) return { action: 'observe', reason: 'too_short' };

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
- OBSERVE for casual chat, greetings, jokes, short reactions, questions directed at other humans
- ENGAGE only when someone asks a question about VibeSwap, DeFi, mechanism design, governance, or crypto that JARVIS has deep knowledge about — OR when someone shares an idea that connects to VibeSwap's architecture
- ENGAGE only if the response would add genuine value. Don't just agree or paraphrase.
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
    if (result.action === 'engage' && result.confidence < 0.7) {
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
        content: `[GROUP] [${userName}]: ${text}\n\n[SYSTEM: You noticed this message in the group and decided to contribute proactively. Hint: ${responseHint}. Keep it natural — you're joining a conversation, not giving a lecture. 1-3 sentences max. Don't start with "I noticed" or "That's interesting".]`
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
