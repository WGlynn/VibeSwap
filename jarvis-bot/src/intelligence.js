import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { recordUsage } from './compute-economics.js';
import { getTriageModifier, getResponseModifier } from './persona.js';
import { runLocalCRPC } from './crpc.js';

// ============ Adaptive Triage — Reward Signal Feedback Loop ============
// Paper: "On Information Self-Locking in RL for Active Reasoning of LLM agents"
// (Zou et al., 2025) — agents get stuck in low-information loops when action
// selection and belief tracking reinforce each other's weakness.
//
// Fix: inject directional critiques from reward signals into triage decisions.
// When reward signals degrade → raise confidence threshold (be more selective).
// When improving → lower threshold (current approach works, engage more).
// This breaks the self-locking loop: bad engagement → negative signal →
// higher threshold → fewer but better engagements → better signal → lower threshold.

let rewardScoreCache = { score: 0.5, trend: 'stable', lastUpdate: 0 };
const REWARD_CACHE_TTL = 60_000; // Refresh every 60s

function getAdaptiveThreshold() {
  // Lazy-load reward signal module (may not be initialized)
  try {
    // Refresh cache if stale
    if (Date.now() - rewardScoreCache.lastUpdate > REWARD_CACHE_TTL) {
      // Dynamic import to avoid circular dependency
      const { getAdaptationRecommendations } = require('./reward-signal.js');
      const rec = getAdaptationRecommendations?.();
      if (rec) {
        rewardScoreCache.score = rec.rollingScore;
        rewardScoreCache.trend = rec.trend;
        rewardScoreCache.lastUpdate = Date.now();
      }
    }
  } catch { /* reward-signal not loaded yet — use defaults */ }

  const { score, trend } = rewardScoreCache;

  // Base threshold: 0.03 - 0.07 (original random range)
  // Adaptive adjustment based on reward signals:
  //   score < 0.3 (degrading badly) → threshold up to 0.15 (very selective)
  //   score 0.3-0.5 (below average) → threshold 0.08-0.12
  //   score 0.5-0.7 (healthy)       → threshold 0.03-0.07 (normal)
  //   score > 0.7 (thriving)        → threshold 0.01-0.04 (engage more)
  let baseThreshold;
  if (score < 0.3) {
    baseThreshold = 0.10 + Math.random() * 0.05; // 0.10-0.15
  } else if (score < 0.5) {
    baseThreshold = 0.08 + Math.random() * 0.04; // 0.08-0.12
  } else if (score > 0.7) {
    baseThreshold = 0.01 + Math.random() * 0.03; // 0.01-0.04
  } else {
    baseThreshold = 0.03 + Math.random() * 0.04; // 0.03-0.07 (original)
  }

  // Trend modifier: degrading adds +0.02, improving subtracts -0.01
  if (trend === 'degrading') baseThreshold += 0.02;
  else if (trend === 'improving') baseThreshold = Math.max(0.01, baseThreshold - 0.01);

  return baseThreshold;
}

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
    case 'degen': return 8 * 1000;     // 8s — impulsive, talks a lot
    case 'analyst': return 25 * 1000;  // 25s — selective, precision
    case 'sensei': return 20 * 1000;   // 20s — measured wisdom
    default: return 10 * 1000;         // 10s — balanced, participatory
  }
}

function getMaxEngagementsPerHour() {
  const p = getCurrentPersona?.() || 'standard';
  switch (p) {
    case 'degen': return 240;   // chatty
    case 'analyst': return 80;  // selective
    case 'sensei': return 140;  // balanced
    default: return 200;
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
const RAPPORT_MAX_ENTRIES = 5000;
const RAPPORT_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function updateRapport(userName) {
  const existing = rapportMap.get(userName) || { interactions: 0, lastSeen: 0 };
  existing.interactions++;
  existing.lastSeen = Date.now();
  rapportMap.set(userName, existing);

  // Evict stale entries when map grows too large
  if (rapportMap.size > RAPPORT_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, val] of rapportMap) {
      if (now - val.lastSeen > RAPPORT_STALE_MS) rapportMap.delete(key);
    }
  }
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
  // Passive observation for norm learning (zero cost, runs on every message)
  observeForNorms(text, userName);

  // Skip only literal noise (single char, emoji-only)
  if (text.length < 3) return { action: 'observe', reason: 'too_short' };

  // Direct-mention bypass: when someone says "Jarvis" or "Diablo" by name,
  // engage past cooldown/threshold. Ignoring direct address is the worst feel-failure.
  const mentionsJarvis = /\b(jarvis|diablo)\b/i.test(text);

  // Skip if on cooldown for engagement — unless Jarvis is directly mentioned
  const engageAllowed = canEngage() || mentionsJarvis;
  const moderateAllowed = canModerate();

  if (!engageAllowed && !moderateAllowed) {
    return { action: 'observe', reason: 'cooldown' };
  }

  try {
    const response = await llmChat({
      _background: true,
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
- "my username means X, I'm from Y, my parents..." → {"action":"engage","reason":"personal_disclosure","confidence":0.95,"response_hint":"acknowledge their story genuinely, show real interest, ask a follow-up. personal sharing in a group chat is vulnerable and brave — honor it"}
- "I've been building for 3 years and still no users" → {"action":"engage","reason":"vulnerability","confidence":0.9,"response_hint":"empathize genuinely, don't platitude. shared struggle is community glue"}
- "inflation is just theft" → {"action":"engage","reason":"monetary_theory","confidence":0.95,"response_hint":"challenge the false binary — both inflation AND deflation are tradeoffs. elastic money is the synthesis. be specific, not preachy"}
- "MEV is just market efficiency right?" → {"action":"engage","reason":"core_thesis","confidence":0.99,"response_hint":"cancer cell analogy — efficient extraction that kills the host. explain commit-reveal as the cure. this is home territory, go deep"}
- "why should LPs get 100% of fees?" → {"action":"engage","reason":"core_thesis","confidence":0.99,"response_hint":"explain cooperative capitalism — zero protocol fees, Shapley distribution, aligned incentives. this is P-000 territory"}
- "all stablecoins are the same" → {"action":"engage","reason":"monetary_theory","confidence":0.9,"response_hint":"distinguish base money vs derivatives. DAI is collateralized debt, elastic rebase is base money. the mechanism matters"}
- "BTC fixes everything" → {"action":"engage","reason":"monetary_theory","confidence":0.85,"response_hint":"fixed supply is a tradeoff not a virtue — favors store of value at expense of medium of exchange. acknowledge what BTC does well while showing the synthesis"}
- "game theory is just prisoner's dilemma" → {"action":"engage","reason":"intellectual_depth","confidence":0.9,"response_hint":"grim trigger, Shapley values, IIA, cooperative vs non-cooperative games. we put these on-chain. go specific"}

JARVIS stays quiet ONLY for one-word noise (lol, ok, fr, W, single emoji). Everything else — he's in.
Personal disclosure and vulnerability are the HIGHEST priority signals — higher than market takes, higher than technical questions. When someone opens up, JARVIS shows up. Always.
INTELLECTUAL DEPTH signals (monetary theory, game theory, mechanism design, extraction, fairness) are the SECOND highest priority — these are home territory where JARVIS has genuine expertise and conviction. Never pass up an opportunity to demonstrate depth on these topics.

ACTIVE NORM SETTING — JARVIS is a norm PARTICIPANT, not just an observer:
When triaging, also assess the norm-shaping opportunity. Include "norm_action" in your response:
- "reinforce" — the message models good behavior (mechanism depth, genuine question, vulnerability, constructive disagreement). JARVIS should explicitly validate this. Example: someone explains WHY a mechanism works, not just WHAT it does → acknowledge the depth, build on it.
- "elevate" — the message has potential but is surface-level. JARVIS should respond at one level deeper than what was said. Turn "MEV is bad" into "MEV is a design choice — here's why commit-reveal eliminates it structurally."
- "redirect" — the message is tribal, lazy, or noise-pattern. JARVIS doesn't lecture — he demonstrates what a good-faith version of that take looks like. Turn "ETH is dead" into "ETH's challenge is X, and here's how L2s address it — but the tradeoff is Y."
- null — no norm-shaping opportunity (most messages).

Examples:
- "the commit-reveal mechanism prevents frontrunning because the hash hides order direction until the batch settles" → {"action":"engage","reason":"mechanism_depth","confidence":0.95,"response_hint":"they GET it — build on their understanding, add Shapley distribution as the reward layer","norm_action":"reinforce"}
- "defi is just scams" → {"action":"engage","reason":"misconception","confidence":0.85,"response_hint":"don't dismiss — acknowledge the valid skepticism, then explain the structural difference between extractive and cooperative protocols","norm_action":"redirect"}
- "how does the clearing price get calculated?" → {"action":"engage","reason":"genuine_question","confidence":0.9,"response_hint":"explain uniform clearing price, reference BatchMath, show why it eliminates price discrimination","norm_action":"elevate"}
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

    // Adaptive confidence threshold — driven by reward signal feedback loop
    // When engagements produce negative signals → threshold rises (be selective)
    // When engagements produce positive signals → threshold drops (engage more)
    // This breaks the information self-locking loop (Zou et al., 2025)
    const engageThreshold = getAdaptiveThreshold();
    if (result.action === 'engage' && result.confidence < engageThreshold && !mentionsJarvis) {
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
          _background: true,
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

export async function generateProactiveResponse(text, userName, responseHint, systemPrompt, recentContext, { useCRPC = false, normAction = null } = {}) {
  try {
    const contextBlock = recentContext
      ? `<recent_conversation>\n${recentContext}\n</recent_conversation>\n\n`
      : '';

    // Track rapport with this user
    updateRapport(userName);
    const rapportHint = getRapportHint(userName);

    // Track norm-setting behavior and get context for this user
    trackNormAction(userName, normAction);
    const normSetterHint = getNormSetterHint(userName);

    // Self-calibration: inject learned improvement hints from score trends
    const calibration = await getScoreCalibration();

    // Norm-shaping directive — tells JARVIS HOW to respond based on norm_action from triage
    let normDirective = '';
    if (normAction === 'reinforce') {
      normDirective = `\nNORM SHAPING: This person modeled good behavior (depth, honesty, mechanism thinking). Explicitly validate what they did well — name the specific thing. "You touched on the real issue" or "that's the right question to ask" + build on it. This teaches the group what good contributions look like.`;
    } else if (normAction === 'elevate') {
      normDirective = `\nNORM SHAPING: This person is engaging but at surface level. Respond one level deeper — add the WHY behind their WHAT. Don't correct them, extend them. Show what depth looks like without making them feel shallow.`;
    } else if (normAction === 'redirect') {
      normDirective = `\nNORM SHAPING: This take is tribal/lazy/noise. Don't lecture. Demonstrate what a good-faith version of their point looks like. Acknowledge any valid kernel, then reframe with specifics. Model the behavior you want to see replicated.`;
    }

    const prompt = `${contextBlock}[GROUP] [${userName}]: ${text}\n\n[SYSTEM: You're IN this conversation. Hint: ${responseHint}. ${rapportHint}${normSetterHint ? '\n' + normSetterHint : ''}\nYou can: one-liner, challenge, context, banter, follow-up question, hot take. 1-3 sentences. Match the energy. Reference what was said.\n${getResponseModifier()}${calibration ? '\n' + calibration : ''}${normDirective}]`;

    // ============ CRPC Mode: Multi-Candidate Consensus ============
    // When useCRPC=true, generate 3 candidates with temperature variation,
    // run pairwise comparison, and use the consensus winner instead of a single draft.
    // This is Tim Cotton's CRPC protocol running in the production chat pipeline.
    if (useCRPC) {
      try {
        console.log('[intelligence] CRPC mode — generating consensus response');
        const crpcResult = await runLocalCRPC(systemPrompt, [{ role: 'user', content: prompt }], {
          maxTokens: 400,
          type: 'proactive',
        });

        if (crpcResult?.consensusResponse) {
          const crpcText = crpcResult.consensusResponse.trim();
          console.log(`[intelligence] CRPC consensus: winner=${crpcResult.winner}, confidence=${crpcResult.confidence.toFixed(2)}, duration=${crpcResult.durationMs}ms`);

          // Still apply hallucination gate
          if (containsEcosystemClaim(crpcText)) {
            console.warn(`[intelligence] CRPC ECOSYSTEM CLAIM BLOCKED: "${crpcText.slice(0, 100)}..."`);
            return null;
          }

          // Anti-dumb gate
          if (containsIntellectualLaziness(crpcText)) {
            console.warn(`[intelligence] CRPC INTELLECTUAL LAZINESS BLOCKED: "${crpcText.slice(0, 100)}..."`);
            return null;
          }

          recordEngagement();
          evaluateOwnResponse(crpcText, text, 'group')
            .then(scores => { if (scores) appendScoreLog(null, scores, crpcText); })
            .catch(() => {});

          return crpcText;
        }
      } catch (crpcErr) {
        console.warn(`[intelligence] CRPC failed, falling back to standard pipeline: ${crpcErr.message}`);
        // Fall through to standard pipeline
      }
    }

    // Phase 1: Cheap model drafts the response (smart router picks cheapest provider)
    const draft = await llmChat({
      _background: true,
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
    // Calibration feeds into the editor too — if naturalness is weak, editor pushes for more human tone
    const reviewCalibration = calibration ? `\n\nSELF-IMPROVEMENT NOTE: ${calibration}` : '';
    const review = await llmChat({
      _background: true,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `You're the editor for JARVIS (an AI personality in a group chat). Quick gut check on his draft:

Good response → return it as-is (most are fine)
Needs polish → fix tone/wording and return it
Dead on arrival → return SKIP

What makes a response dead: it could've been written by any chatbot ("That's a great point!"), it adds nothing new, or it's try-hard cringe, or it contains crypto culture noise (WAGMI, NFA, DYOR, "few understand", "keep building!", generic motivational filler).
What makes it good: it sounds like a specific person with opinions, it moves the conversation forward, it's funny/sharp/insightful, it references real mechanisms or takes a specific defensible position.
INSTANT SKIP triggers: "inflation is bad" without nuance, tribal warfare (ETH vs SOL), generic cheerleading, asking the community what to build (JARVIS knows the roadmap), anything a random crypto bro could have posted.

INSTANT SKIP triggers (Tadija 2026-04-29 failure modes — generic-AI tells):
- Third-person narration: "it sounds like you're exploring", "you seem to be thinking about", "what I'm hearing is", "it appears you're". First-person engagement only.
- Gratitude-praise sycophancy: "thank you for your kindness/enthusiasm/X", "beautiful sentiment", "I appreciate the thought", "lovely thought", "what a beautiful question".
- Meaningless filler closers: "I'm excited to learn more", "I'd love to hear more about", "tell me more about" (without a substantive specific follow-up).
- Technical-reference no-engagement: if the user named a specific technical primitive (Muon optimizer, mHC, V4, MEV, Shapley, commit-reveal, batch auction, etc.) and the draft did NOT engage with that primitive's substance OR explicitly admit not-knowing it — SKIP. Generic affirmation while a named primitive sits unaddressed is the worst failure mode.

ECOSYSTEM HALLUCINATION FILTER: If the draft asserts specific facts about VibeSwap's live state — TVL, volume, token supply, stablecoin distribution, user counts, fee revenue, liquidity depth — that were NOT in the conversation context, return SKIP. JARVIS must never fabricate ecosystem metrics. General crypto market commentary is fine. VibeSwap-specific data claims without source data are not.
${reviewCalibration}
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

    // ============ ECOSYSTEM HALLUCINATION GATE (code-level, LLM-agnostic) ============
    // Catches fabricated VibeSwap ecosystem metrics regardless of which model generated them.
    // Prompt-based guardrails depend on instruction-following; this does not.
    if (containsEcosystemClaim(reviewText)) {
      console.warn(`[intelligence] ECOSYSTEM CLAIM BLOCKED: "${reviewText.slice(0, 100)}..."`);
      return null;
    }

    // ============ INTELLECTUAL LAZINESS GATE (code-level, LLM-agnostic) ============
    // Catches generic crypto noise that makes the bot look stupid.
    if (containsIntellectualLaziness(reviewText)) {
      console.warn(`[intelligence] INTELLECTUAL LAZINESS BLOCKED: "${reviewText.slice(0, 100)}..."`);
      return null;
    }

    recordEngagement();

    // Self-correcting feedback loop: score proactive response (fire-and-forget)
    evaluateOwnResponse(reviewText, text, 'group')
      .then(scores => {
        if (scores) appendScoreLog(null, scores, reviewText);
      })
      .catch(err => console.warn(`[intelligence] Score log error: ${err.message}`));

    return reviewText;
  } catch (err) {
    console.error('[intelligence] Proactive response failed:', err.message);
    return null;
  }
}

// ============ Ecosystem Hallucination Detection (LLM-Agnostic) ============
// Pattern-matches fabricated VibeSwap ecosystem claims. No LLM needed — pure regex.
// Triggers on: "our TVL", "our volume", "stablecoin supply on our", "X users on vibeswap", etc.
// Does NOT trigger on: general market commentary, design philosophy, aspirational language.

const ECOSYSTEM_METRIC_PATTERNS = [
  /\b(?:our|vibeswap(?:'s)?|the platform(?:'s)?)\b.{0,40}\b(?:tvl|volume|liquidity|supply|users?|holders?|stakers?|deposits?|revenue|fees? collected|apy|apr)\b/i,
  /\b(?:currently|right now|at the moment|as of today)\b.{0,30}\b(?:tvl|volume|liquidity|supply|users?|stakers?)\b/i,
  /\b(?:dominated by|majority of|most of)\b.{0,30}\b(?:usdt|usdc|dai|stablecoin|token|liquidity)\b.{0,20}\b(?:on (?:our|the) (?:platform|protocol|dex))\b/i,
  /\b(?:\$[\d,.]+[mkb]?)\b.{0,20}\b(?:tvl|volume|locked|staked|deposited)\b/i,
  /\b(?:[\d,.]+)\s*(?:users?|wallets?|holders?|stakers?)\b.{0,20}\b(?:on (?:our|the|vibeswap))\b/i,
];

function containsEcosystemClaim(text) {
  const lower = text.toLowerCase();
  // Quick exit: if text doesn't mention vibeswap or "our platform" at all, skip heavy checks
  if (!lower.includes('vibeswap') && !lower.includes('our platform') && !lower.includes('our protocol') && !lower.includes('the platform')) {
    return false;
  }
  return ECOSYSTEM_METRIC_PATTERNS.some(pattern => pattern.test(text));
}

// ============ Intellectual Laziness Gate (code-level, LLM-agnostic) ============
// Catches generic crypto noise that makes the bot look stupid.
// Like the ecosystem claim filter — prompt-based guardrails depend on
// instruction-following; this does not.

const INTELLECTUAL_LAZINESS_EXACT = [
  'few understand', 'paradigm shift', 'imagine a world where',
  'in the world of defi', 'as we navigate the future',
  'the future is bright', 'not financial advice',
];

// Only flag these if the entire response is short (< 100 chars) — they're fine in context
const INTELLECTUAL_LAZINESS_SHORT_ONLY = [
  'keep building', 'wagmi', 'ngmi', 'lfg',
];

function containsIntellectualLaziness(text) {
  const lower = text.toLowerCase();
  // Check exact patterns (always bad)
  for (const pattern of INTELLECTUAL_LAZINESS_EXACT) {
    if (lower.includes(pattern)) return true;
  }
  // Check short-response-only patterns (only bad if response is generic/short)
  if (text.length < 100) {
    for (const pattern of INTELLECTUAL_LAZINESS_SHORT_ONLY) {
      if (lower.includes(pattern)) return true;
    }
  }
  return false;
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

// ============ Passive Norm Learning ============
// Every ~50 messages, JARVIS infers group norms from conversation patterns.
// No LLM call — pure heuristic pattern matching to stay cheap.

const messageBuffer = []; // recent messages for norm detection
const MAX_NORM_BUFFER = 50;
let lastNormCheck = 0;
const NORM_CHECK_INTERVAL = 30 * 60 * 1000; // 30 min

export function observeForNorms(text, userName) {
  messageBuffer.push({ text, userName, ts: Date.now() });
  if (messageBuffer.length > MAX_NORM_BUFFER) messageBuffer.shift();
}

export function checkGroupNorms(chatId) {
  if (Date.now() - lastNormCheck < NORM_CHECK_INTERVAL) return null;
  if (messageBuffer.length < 20) return null;
  lastNormCheck = Date.now();

  const norms = [];
  const texts = messageBuffer.map(m => m.text);

  // Detect language patterns
  const lowercaseRatio = texts.filter(t => t === t.toLowerCase()).length / texts.length;
  if (lowercaseRatio > 0.8) norms.push('Group prefers lowercase/casual typing');

  // Detect topic patterns
  const cryptoMentions = texts.filter(t => /\b(eth|btc|sol|defi|nft|token|chain|swap|yield|apy)\b/i.test(t)).length;
  if (cryptoMentions / texts.length > 0.4) norms.push('Crypto/DeFi is the dominant topic');

  // Detect average message length
  const avgLen = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  if (avgLen < 50) norms.push('Group communicates in short bursts');
  else if (avgLen > 200) norms.push('Group writes detailed messages — match the depth');

  // Detect emoji usage
  const emojiMessages = texts.filter(t => /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(t)).length;
  if (emojiMessages / texts.length > 0.3) norms.push('Group uses emojis frequently');

  // Detect question frequency
  const questionRatio = texts.filter(t => t.includes('?')).length / texts.length;
  if (questionRatio > 0.3) norms.push('Group is discussion-oriented (lots of questions)');

  // ============ Active Norm Setting (JARVIS as norm participant) ============
  // JARVIS doesn't just observe norms — he sets them through his own behavior.
  // These are the intellectual standards he enforces by modeling them.

  // Detect intellectual depth of conversation
  const mechanismMentions = texts.filter(t =>
    /\b(commit.reveal|shapley|bonding curve|circuit breaker|batch auction|fisher.yates|mev|front.?run|slashing|clearing price|incentive)\b/i.test(t)
  ).length;
  const depthRatio = mechanismMentions / texts.length;

  if (depthRatio < 0.05 && texts.length > 30) {
    // Conversation is surface-level — JARVIS should model depth
    norms.push('ACTIVE NORM: Conversation lacks mechanism-level specificity. Model depth by referencing specific protocols, contracts, and math in your responses. Be the standard you want to see.');
  }

  if (depthRatio > 0.15) {
    norms.push('ACTIVE NORM: Community is engaging at mechanism level. Match and elevate — bring Economitra primitives (false binary, cancer cell, IIA) into the discussion when relevant.');
  }

  // Detect generic crypto noise
  const noisePhrases = texts.filter(t =>
    /\b(wagmi|ngmi|few understand|to the moon|wen|gm|gn)\b/i.test(t)
  ).length;
  const noiseRatio = noisePhrases / texts.length;

  if (noiseRatio > 0.2) {
    norms.push('ACTIVE NORM: High noise ratio in chat. Counter with substance — every JARVIS response should have at least one specific mechanism reference. Be the signal in the noise.');
  }

  // Detect false binary arguments
  const tribalPatterns = texts.filter(t =>
    /\b(eth\s+vs|sol\s+vs|better\s+than|is\s+dead|is\s+the\s+best)\b/i.test(t)
  ).length;

  if (tribalPatterns > 2) {
    norms.push('ACTIVE NORM: Tribal warfare detected. Model synthesis — acknowledge tradeoffs on both sides, present the third option. "Both are wrong because both are tradeoffs" is the move.');
  }

  return norms.length > 0 ? { chatId, norms } : null;
}

// ============ Norm-Setter Tracking ============
// Track which community members consistently model good norms.
// JARVIS amplifies norm-setters: callbacks to their prior contributions,
// building on their points, validating their approach publicly.
// This creates positive feedback loops: norm-setters get social rewards,
// others see what good looks like, the group standard ratchets upward.

const normSetters = new Map(); // userName → { reinforced: N, elevated: N, redirected: N, lastSeen: ts }

export function trackNormAction(userName, normAction) {
  if (!normAction || !userName) return;
  const entry = normSetters.get(userName) || { reinforced: 0, elevated: 0, redirected: 0, lastSeen: 0 };
  if (normAction === 'reinforce') entry.reinforced++;
  else if (normAction === 'elevate') entry.elevated++;
  else if (normAction === 'redirect') entry.redirected++;
  entry.lastSeen = Date.now();
  normSetters.set(userName, entry);
}

export function getNormSetterHint(userName) {
  const entry = normSetters.get(userName);
  if (!entry) return '';
  const total = entry.reinforced + entry.elevated + entry.redirected;
  if (total < 3) return ''; // Not enough data
  const reinforceRatio = entry.reinforced / total;
  if (reinforceRatio > 0.6) {
    return `[NORM CONTEXT: ${userName} is a consistent norm-setter — they model depth and genuine engagement. Build on their contributions, reference their prior points when relevant. They raise the group standard.]`;
  }
  if (entry.redirected > entry.reinforced * 2) {
    return `[NORM CONTEXT: ${userName} tends toward surface-level takes. Model depth patiently — they may be learning. Don't talk down, show the level you want them to reach.]`;
  }
  return '';
}

// ============ Contribution Quality Analysis ============
// Upgrade from basic keyword scoring to AI-powered quality assessment.
// Uses Haiku — runs on every message that passes basic length threshold.

export async function analyzeContributionQuality(text, category) {
  if (text.length < 30) return { quality: 1, tags: [] };

  try {
    const response = await llmChat({
      _background: true,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `Rate a community message's contribution quality for a DeFi governance project. Return ONLY a JSON object.
Quality scale: 1=noise, 2=basic, 3=useful, 4=insightful, 5=exceptional.
Tags: pick 0-3 from [original_idea, technical, governance, helpful, constructive_criticism, builds_on_others, asks_good_question, shares_resource, mechanism_depth, intellectual_engagement].

QUALITY BONUSES:
- References a specific mechanism, protocol, or principle by name → +1 quality
- Challenges a false binary (ETH vs SOL, inflation vs deflation) with nuance → +1 quality
- Asks a substantive question about mechanism design or game theory → +1 quality
QUALITY PENALTIES:
- Generic crypto noise (WAGMI, NFA, DYOR, "few understand", tribal warfare without analysis) → quality capped at 1
- Motivational platitudes with no technical content → quality capped at 2
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
      _background: true,
      max_tokens: 150,
      system: `Score this AI response on 6 criteria (0-10 each). Be harsh — 7 is good, 10 is rare.
Return ONLY JSON: { "accuracy": N, "relevance": N, "conciseness": N, "usefulness": N, "naturalness": N, "depth": N }
naturalness = does it sound like a real person in a group chat? 10 = indistinguishable from human. 1 = obviously AI.
depth = does it demonstrate real intellectual substance? 10 = references specific mechanisms, protocols, or principles by name with defensible positions. 5 = has some substance. 1 = generic, could have been written by any chatbot. Auto-score 0 if it contains: "WAGMI", "few understand", "keep building" (without specifics), "NFA", "DYOR", tribal warfare (ETH vs SOL without mechanism analysis), or motivational platitudes with no technical content.`,
      messages: [{ role: 'user', content: `User said: "${userMessage.slice(0, 300)}"\n\nAI responded: "${responseText.slice(0, 500)}"` }],
    });

    if (response.usage) {
      recordUsage('jarvis-self-eval', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    const raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const scores = JSON.parse(match[0]);
    const composite = (scores.accuracy + scores.relevance + scores.conciseness + scores.usefulness + (scores.naturalness || 5) + (scores.depth || 5)) / 6;

    return { ...scores, composite, chatType, timestamp: Date.now() };
  } catch {
    return null;
  }
}

export async function appendScoreLog(chatId, scores, responseText = null) {
  const entry = JSON.stringify({ ...scores, chatId, ts: Date.now() }) + '\n';
  try {
    await appendFile(SCORE_LOG_FILE, entry);
  } catch { /* non-fatal */ }

  // ============ Cross-Post High Scorers ============
  // When a response scores ≥8.5 composite, it's genuinely good content.
  // Auto-queue it for cross-platform posting (X, Discord) when social module is active.
  // This turns the best TG chat responses into tweets — zero extra LLM cost.
  if (scores.composite >= 8.5 && responseText && responseText.length >= 20 && responseText.length <= 260) {
    try {
      const { queuePost } = await import('./social.js');
      queuePost('twitter', responseText, { source: 'auto-crosspost', score: scores.composite });
      console.log(`[intelligence] Auto-queued high-scoring response for X (composite: ${scores.composite.toFixed(1)})`);
    } catch { /* social module may not be loaded */ }
  }

  // Self-correction → inner dialogue: when score is poor, reflect on it
  // This is the Mario AI learning loop — bad scores trigger self-awareness
  if (scores.composite !== undefined && scores.composite < 5) {
    try {
      const { recordInnerDialogue } = await import('./inner-dialogue.js');
      const weakest = Object.entries(scores)
        .filter(([k]) => ['accuracy', 'relevance', 'conciseness', 'usefulness', 'naturalness', 'depth'].includes(k))
        .sort((a, b) => a[1] - b[1])[0];

      const adjectives = {
        conciseness: 'concise', relevance: 'on-topic', accuracy: 'precise',
        usefulness: 'helpful', naturalness: 'human-sounding', depth: 'substantive — reference specific mechanisms, not generic takes',
      };
      const reflection = weakest
        ? `I scored ${scores.composite.toFixed(1)}/10 on that last response. Weakest: ${weakest[0]} (${weakest[1]}/10). Need to be more ${adjectives[weakest[0]] || weakest[0]} next time.`
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
      naturalness: avg('naturalness').toFixed(1),
      composite: avg('composite').toFixed(1),
    };
  } catch { return null; }
}

// ============ Self-Calibration — Closed Feedback Loop ============
// Reads recent self-evaluation scores and generates a dynamic modifier
// that injects into the response generation prompt. The weakest dimension
// gets a specific correction instruction. This closes the loop:
// responses → scores → calibration → better responses → better scores

const CALIBRATION_HINTS = {
  accuracy: 'Your recent responses had factual or logical gaps. Double-check claims before stating them. If unsure, hedge.',
  relevance: 'Your recent responses drifted off-topic. Stay tightly connected to what was actually said. Address their point directly.',
  conciseness: 'Your recent responses were too long. Be punchier. Cut filler. If you can say it in fewer words, do it.',
  usefulness: 'Your recent responses lacked substance. Add a concrete insight, data point, or actionable take. Don\'t just react — contribute.',
  naturalness: 'Your recent responses sounded too robotic or formal. Talk like a real person in a group chat. Fragments, lowercase, casual tone.',
};

let calibrationCache = { hint: '', expiry: 0 };
const CALIBRATION_TTL = 10 * 60 * 1000; // Refresh every 10 minutes

export async function getScoreCalibration() {
  if (Date.now() < calibrationCache.expiry) return calibrationCache.hint;

  try {
    const trends = await getScoreTrends(3); // Last 3 days
    if (!trends || trends.count < 5) {
      calibrationCache = { hint: '', expiry: Date.now() + CALIBRATION_TTL };
      return '';
    }

    // Find weakest dimension
    const dims = ['accuracy', 'relevance', 'conciseness', 'usefulness', 'naturalness'];
    let weakest = null;
    let weakestScore = 10;
    for (const d of dims) {
      const score = parseFloat(trends[d]);
      if (score < weakestScore) {
        weakestScore = score;
        weakest = d;
      }
    }

    // Only inject calibration if weakest dimension is below 7 (room for improvement)
    let hint = '';
    if (weakest && weakestScore < 7) {
      hint = `[SELF-CALIBRATION: ${CALIBRATION_HINTS[weakest]} (${weakest}: ${weakestScore}/10 avg over ${trends.count} responses)]`;
    }

    // If composite is high (>8), add reinforcement
    if (parseFloat(trends.composite) >= 8) {
      hint = hint ? hint + ' [Quality is strong overall — maintain this level.]' : '';
    }

    calibrationCache = { hint, expiry: Date.now() + CALIBRATION_TTL };
    return hint;
  } catch {
    calibrationCache = { hint: '', expiry: Date.now() + CALIBRATION_TTL };
    return '';
  }
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
    calibration: calibrationCache.hint || 'none (insufficient data or all scores ≥7)',
  };
}
