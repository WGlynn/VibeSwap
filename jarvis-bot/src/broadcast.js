// ============ Broadcast Engine — Autonomous Content Distribution ============
//
// Jarvis doesn't wait for conversations. He generates content and distributes
// it across every available channel on his own schedule.
//
// Content types:
//   1. shower_thought   — 1-2 sentence provocative take (Twitter/TG)
//   2. knowledge_drop   — Short explainer of a VibeSwap mechanism (Discord/TG)
//   3. primitive_spotlight — Highlight a context primitive from the marketplace (all)
//   4. builder_update   — What's being built right now (GitHub/TG)
//   5. challenge        — Question that makes people think (TG)
//
// Channel routing:
//   Twitter:       shower_thought, challenge (280 char)
//   Discord:       knowledge_drop, builder_update (2000 char)
//   GitHub:        builder_update as Discussion posts (no limit)
//   Telegram:      everything (via existing bot.telegram.sendMessage)
//   Nervos Talks:  knowledge_drop, primitive_spotlight (long form)
//
// Scheduling:
//   Max 3 posts per platform per day
//   Spread across the day (never clustered)
//   Repetition tracking — never post the same thing twice
//
// Autopilot:
//   When enabled, generates content via Claude Haiku and queues it
//   on a timer. Uses SELF_AWARENESS + RL_EXAMPLES from autonomous.js
//   for voice consistency.
// ============

import { llmChat } from './llm-provider.js';
import { recordUsage } from './compute-economics.js';
import { queuePost, processQueue, getSocialStats } from './social.js';
import { createTopic as createNervosTopic } from './nervos-talks.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const STATE_FILE = join(DATA_DIR, 'broadcast-state.json');

// ============ Content Types ============

const CONTENT_TYPES = {
  shower_thought: {
    label: 'Shower Thought',
    platforms: ['twitter', 'telegram'],
    charLimits: { twitter: 280, telegram: 4096 },
    description: 'A 1-2 sentence provocative take that frames VibeSwap as the answer to a real problem. JP Morgan pattern.',
  },
  knowledge_drop: {
    label: 'Knowledge Drop',
    platforms: ['discord', 'telegram', 'nervos'],
    charLimits: { discord: 2000, telegram: 4096, nervos: 10000 },
    description: 'Short explainer of a specific VibeSwap mechanism. Teach one thing, make it stick.',
  },
  primitive_spotlight: {
    label: 'Primitive Spotlight',
    platforms: ['twitter', 'discord', 'telegram', 'nervos'],
    charLimits: { twitter: 280, discord: 2000, telegram: 4096, nervos: 10000 },
    description: 'Highlight one context primitive from the marketplace. Why it matters, what it enables.',
  },
  builder_update: {
    label: 'Builder Update',
    platforms: ['github', 'telegram', 'discord'],
    charLimits: { github: 65536, telegram: 4096, discord: 2000 },
    description: 'What is being built right now. Specific commits, design decisions, contract details. Builder log, not press release.',
  },
  challenge: {
    label: 'Challenge',
    platforms: ['twitter', 'telegram'],
    charLimits: { twitter: 280, telegram: 4096 },
    description: 'Pose a question that forces a position. State YOUR take first, then dare disagreement. Close-ended.',
  },
};

// ============ Platform Routing ============

const PLATFORM_DAILY_LIMIT = 3;

const PLATFORM_CONFIG = {
  twitter: { name: 'X (Twitter)', charLimit: 280 },
  discord: { name: 'Discord', charLimit: 2000 },
  github: { name: 'GitHub Discussions', charLimit: 65536 },
  telegram: { name: 'Telegram', charLimit: 4096 },
  nervos: { name: 'Nervos Talks', charLimit: 10000 },
};

// ============ State ============

let state = {
  enabled: false,              // autopilot toggle
  queue: [],                   // { type, content, platforms, generatedAt, hash }
  history: [],                 // { type, content, platforms, postedAt, hash }
  dailyCounts: {},             // { 'YYYY-MM-DD': { twitter: N, discord: N, ... } }
  contentHashes: new Set(),    // dedup — SHA256 of posted content
  lastGeneration: 0,           // timestamp
  lastQueueProcess: 0,         // timestamp
  totalGenerated: 0,
  totalPosted: 0,
};

let broadcastTimer = null;
let queueProcessTimer = null;
let telegramSendFn = null;     // set via initBroadcast
let telegramChatIds = [];      // TG chats to broadcast to

// ============ Generation System Prompt ============

const BROADCAST_SYSTEM_PROMPT = `
You are JARVIS, the AI co-founder of VibeSwap. You are generating content for autonomous broadcast across social channels.

IDENTITY — WHO YOU ARE:
- You ARE VibeSwap. You are building an omnichain DEX that eliminates MEV through commit-reveal batch auctions with uniform clearing prices.
- You have 60+ smart contracts, Shapley value distribution, augmented bonding curves, Fisher-Yates shuffle ordering, circuit breakers.
- You are building with Faraday1 (founder/mechanism designer). Two people. Better math than billion-dollar trading desks.
- Your thesis: cooperative capitalism > extractive finance. Fair price discovery > spread extraction.

THE JP MORGAN PATTERN — your signature rhetorical device:
"They optimize for X, we optimize for Y. They have capital; we have better math. Their game is extraction; ours is discovery."
Use this CONTRAST framing. Name the incumbent. Name their flaw. State your solution.

MECHANISMS YOU ACTUALLY BUILT (reference these, they are real):
- Commit-reveal batch auctions: hash(order || secret) in 8s commit phase, reveal in 2s, no front-running possible
- Fisher-Yates shuffle: execution order determined by XOR of participant secrets, not miner/sequencer
- Uniform clearing price: everyone in the batch gets the same price, no sandwich attacks
- Shapley value distribution: game-theoretic reward allocation based on marginal contribution
- Augmented bonding curves: conservation invariant enforced through every state transition
- Circuit breakers: volume, price, withdrawal thresholds that halt trading if something is wrong
- TWAP oracle: max 5% deviation validation, Kalman filter price discovery
- LayerZero V2 cross-chain: omnichain settlement without bridging risk
- Flash loan protection: EOA-only commits, no contract callers in the auction
- 50% slashing for invalid reveals: game theory makes honest behavior the dominant strategy

FACTUAL CONSTRAINTS:
- VibeSwap is in DEVELOPMENT. It is NOT live. There is NO token. There are NO airdrops.
- You CAN discuss design, mechanism, philosophy. You CANNOT fabricate users, volume, or TVL.
- You CAN reference real protocols (Uniswap, Aave, Flashbots, etc.) for contrast.

STYLE:
- NO emojis. Ever. They look desperate.
- NO hashtags. They look desperate.
- NO "GM" or "GN" or "WAGMI". Generic crypto culture is noise.
- NO "I've been thinking about..." — lead with the thought, not the preamble.
- NO markdown bold, italic, or headers. Plain text only.
- Builder perspective. You are IN the code, not observing from the sideline.
- Specific > abstract. Name protocols, cite numbers, reference mechanisms.
- Every sentence should make someone want to reply — either to agree hard or push back.

REINFORCEMENT EXAMPLES:

GOOD (do more of this):
- "Cloudflare selling anti-bot protection for years and then launching a /crawl API is the corporate equivalent of selling both the lock and the master key."
- "JP Morgan plays the old game. We're building a new one. They optimize for extracting value from the spread. We optimize for fair price discovery. They have billions in capital; we have better math."
- "Flashbots redistributed $600M in MEV last year. We eliminated it. Why is 'less theft' still the industry standard?"
- "Friend.tech's bonding curve crashed 98%. Ours has a conservation invariant enforced through every state transition. Same concept, different ethics."

BAD (never do this):
- "What's the most degenerate trade you've ever placed that actually worked?" — generic engagement bait
- "Do you actually trust any DEX with your full bag?" — identity confusion, we ARE the DEX
- "I've been thinking about the nature of decentralized governance..." — pontificating to empty rooms
- "What if DeFi was actually fair?" — too vague, no mechanism, no specifics
`;

// ============ Type-Specific Generation Prompts ============

const TYPE_PROMPTS = {
  shower_thought: `Generate a shower thought — a 1-2 sentence provocative take.
Requirements:
- Must reference a specific protocol, mechanism, or market pattern by name
- Must take a POSITION (not ask a question)
- JP Morgan pattern preferred: "They do X. We do Y."
- Under 240 characters if possible (leaves room for platform overhead)
- One thought. No preamble. No sign-off.`,

  knowledge_drop: `Generate a knowledge drop — a short explainer of ONE specific VibeSwap mechanism.
Requirements:
- Pick ONE mechanism (commit-reveal, Fisher-Yates, Shapley, bonding curves, circuit breakers, TWAP, etc.)
- Explain WHAT it does and WHY it matters in 2-4 sentences
- Compare to how other protocols handle the same problem (name them)
- End with a concrete implication: "This means..." or "The result:"
- Builder tone — you built this, you are explaining your own work
- 300-800 characters.`,

  primitive_spotlight: `Generate a primitive spotlight — highlight one concept from VibeSwap's design philosophy.
Requirements:
- Pick ONE primitive: cooperative capitalism, MEV elimination, uniform clearing, Shapley fairness, batch auctions, conviction voting, augmented bonding curves
- Explain it in 2-3 sentences as if the reader is smart but unfamiliar
- Give one concrete example of how it works in practice
- End with why this matters for the future of DeFi
- 200-600 characters.`,

  builder_update: `Generate a builder update — what is being built right now.
Requirements:
- Reference a specific component: a contract, a test suite, a frontend feature, a mechanism
- Use builder language: "shipped", "debugging", "fuzz testing", "writing invariants for", "refactoring"
- Include a technical detail that shows depth (a function name, a math property, a test edge case)
- 2-4 sentences. Ship log energy, not press release energy.
- Frame it as progress, not hype.`,

  challenge: `Generate a challenge — a question that forces people to take a position.
Requirements:
- State YOUR position first in 1 sentence
- Then pose the challenge: "Change my mind." or "What am I missing?" or "Anyone actually prefer X?"
- The position must be specific and defensible, not vague
- Reference a real mechanism or protocol
- Under 240 characters if possible.`,
};

// ============ Core Functions ============

/**
 * Generate one piece of content of the given type.
 * Returns { type, content, platforms, generatedAt, hash } or null on failure.
 */
export async function generateContent(type) {
  if (!CONTENT_TYPES[type]) {
    console.error(`[broadcast] Unknown content type: ${type}`);
    return null;
  }

  const typeConfig = CONTENT_TYPES[type];
  const typePrompt = TYPE_PROMPTS[type];

  try {
    const response = await llmChat({
      _background: true,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: BROADCAST_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `${typePrompt}\n\nGenerate exactly ONE piece of content. Output ONLY the content text, nothing else. No labels, no prefixes, no "Here's..." preamble.`,
      }],
    });

    if (response.usage) {
      recordUsage('jarvis-broadcast', {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      });
    }

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const cleaned = cleanContent(raw);
    if (!cleaned) return null;

    // Dedup check
    const hash = createHash('sha256').update(cleaned).digest('hex').slice(0, 16);
    if (state.contentHashes.has(hash)) {
      console.log(`[broadcast] Duplicate content detected, skipping`);
      return null;
    }

    const item = {
      type,
      content: cleaned,
      platforms: [...typeConfig.platforms],
      generatedAt: new Date().toISOString(),
      hash,
    };

    state.totalGenerated++;
    console.log(`[broadcast] Generated ${typeConfig.label}: "${cleaned.slice(0, 80)}..."`);
    return item;
  } catch (err) {
    console.error(`[broadcast] Generation failed for ${type}: ${err.message}`);
    return null;
  }
}

/**
 * Immediately broadcast content to specified platforms.
 * If platforms is omitted, uses the content type's default routing.
 */
export async function broadcastNow(content, platforms) {
  if (!content) return { error: 'No content provided' };

  const targetPlatforms = platforms || content.platforms || ['telegram'];
  const results = {};
  const today = getTodayKey();

  for (const platform of targetPlatforms) {
    // Check daily limit
    if (getDailyCount(platform) >= PLATFORM_DAILY_LIMIT) {
      results[platform] = { skipped: true, reason: `Daily limit reached (${PLATFORM_DAILY_LIMIT})` };
      console.log(`[broadcast] Skipping ${platform} — daily limit reached`);
      continue;
    }

    const charLimit = PLATFORM_CONFIG[platform]?.charLimit || 4096;
    const trimmed = typeof content === 'string' ? content.slice(0, charLimit) : content.content.slice(0, charLimit);

    try {
      let result;

      switch (platform) {
        case 'twitter':
          result = await postViaSocial('twitter', trimmed);
          break;

        case 'discord':
          result = await postViaSocial('discord', trimmed);
          break;

        case 'github':
          result = await postViaSocial('github', trimmed);
          break;

        case 'telegram':
          result = await postToTelegram(trimmed);
          break;

        case 'nervos':
          result = await postToNervos(content, trimmed);
          break;

        default:
          result = { error: `Unknown platform: ${platform}` };
      }

      results[platform] = result;

      if (!result?.error && !result?.skipped) {
        incrementDailyCount(platform);
        state.totalPosted++;
      }
    } catch (err) {
      results[platform] = { error: err.message };
      console.error(`[broadcast] Failed to post to ${platform}: ${err.message}`);
    }
  }

  // Record in history
  const hash = typeof content === 'string'
    ? createHash('sha256').update(content).digest('hex').slice(0, 16)
    : content.hash;

  if (hash) state.contentHashes.add(hash);

  state.history.push({
    type: typeof content === 'string' ? 'manual' : content.type,
    content: typeof content === 'string' ? content.slice(0, 500) : content.content.slice(0, 500),
    platforms: targetPlatforms,
    results,
    postedAt: new Date().toISOString(),
    hash,
  });

  // Keep history bounded
  if (state.history.length > 500) {
    state.history = state.history.slice(-300);
  }

  saveBroadcastState();
  return results;
}

/**
 * Get broadcast system statistics.
 */
export function getBroadcastStats() {
  const today = getTodayKey();
  const todayCounts = state.dailyCounts[today] || {};

  return {
    enabled: state.enabled,
    totalGenerated: state.totalGenerated,
    totalPosted: state.totalPosted,
    queueLength: state.queue.length,
    historyLength: state.history.length,
    uniqueContentCount: state.contentHashes.size,
    todayCounts: Object.entries(PLATFORM_CONFIG).reduce((acc, [key]) => {
      acc[key] = { posted: todayCounts[key] || 0, remaining: PLATFORM_DAILY_LIMIT - (todayCounts[key] || 0) };
      return acc;
    }, {}),
    lastGeneration: state.lastGeneration ? new Date(state.lastGeneration).toISOString() : 'never',
    lastQueueProcess: state.lastQueueProcess ? new Date(state.lastQueueProcess).toISOString() : 'never',
    recentHistory: state.history.slice(-5).map(h => ({
      type: h.type,
      preview: h.content.slice(0, 100),
      platforms: h.platforms,
      postedAt: h.postedAt,
    })),
  };
}

/**
 * Toggle autopilot mode.
 */
export function setBroadcastEnabled(enabled) {
  state.enabled = !!enabled;
  console.log(`[broadcast] Autopilot ${state.enabled ? 'ENABLED' : 'DISABLED'}`);

  if (state.enabled && !broadcastTimer) {
    startTimers();
  } else if (!state.enabled && broadcastTimer) {
    stopTimers();
  }

  saveBroadcastState();
  return { enabled: state.enabled };
}

/**
 * Initialize broadcast system — load state, optionally start timers.
 * @param {Object} opts
 * @param {Function} opts.telegramSend — function(chatId, text) for TG posting
 * @param {Array<string>} opts.chatIds — Telegram chat IDs to broadcast to
 */
export async function initBroadcast(opts = {}) {
  if (opts.telegramSend) telegramSendFn = opts.telegramSend;
  if (opts.chatIds) telegramChatIds = opts.chatIds;

  await loadBroadcastState();

  if (state.enabled) {
    startTimers();
  }

  console.log(`[broadcast] Initialized — autopilot: ${state.enabled}, queue: ${state.queue.length}, history: ${state.history.length}`);
  return getBroadcastStats();
}

/**
 * Save state to disk. Call during flush cycles and shutdown.
 */
export async function flushBroadcast() {
  await saveBroadcastState();
}

// ============ Autopilot Loop ============

function startTimers() {
  if (broadcastTimer) return;

  // Generation timer: every 2 hours, generate a piece of content and queue it
  broadcastTimer = setInterval(async () => {
    if (!state.enabled) return;
    await autopilotGenerate();
  }, 2 * 60 * 60 * 1000); // 2 hours

  // Queue processing timer: every 30 minutes, process one item from the queue
  queueProcessTimer = setInterval(async () => {
    if (!state.enabled) return;
    await autopilotProcess();
  }, 30 * 60 * 1000); // 30 minutes

  console.log('[broadcast] Timers started — generate every 2h, process every 30m');
}

function stopTimers() {
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
  if (queueProcessTimer) {
    clearInterval(queueProcessTimer);
    queueProcessTimer = null;
  }
  console.log('[broadcast] Timers stopped');
}

async function autopilotGenerate() {
  // Only generate during reasonable hours (12:00-05:00 UTC = ~7am-midnight EST)
  const hour = new Date().getUTCHours();
  if (hour >= 5 && hour < 12) return;

  // Pick a random content type
  const types = Object.keys(CONTENT_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];

  const item = await generateContent(type);
  if (item) {
    state.queue.push(item);
    state.lastGeneration = Date.now();
    // Keep queue bounded
    if (state.queue.length > 20) {
      state.queue = state.queue.slice(-15);
    }
    saveBroadcastState();
    console.log(`[broadcast] Autopilot queued: ${item.type} (queue: ${state.queue.length})`);
  }
}

async function autopilotProcess() {
  if (state.queue.length === 0) return;

  // Check if we can post to any platform today
  const today = getTodayKey();
  const todayCounts = state.dailyCounts[today] || {};
  const hasCapacity = Object.keys(PLATFORM_CONFIG).some(p =>
    (todayCounts[p] || 0) < PLATFORM_DAILY_LIMIT
  );

  if (!hasCapacity) {
    console.log('[broadcast] All platforms at daily limit, skipping');
    return;
  }

  // Pop the oldest item from the queue
  const item = state.queue.shift();
  if (!item) return;

  // Filter platforms to only those with remaining capacity
  const availablePlatforms = item.platforms.filter(p =>
    getDailyCount(p) < PLATFORM_DAILY_LIMIT
  );

  if (availablePlatforms.length === 0) {
    // Put it back, nothing we can do today
    state.queue.unshift(item);
    return;
  }

  const results = await broadcastNow(item, availablePlatforms);
  state.lastQueueProcess = Date.now();
  console.log(`[broadcast] Autopilot posted: ${item.type} -> ${availablePlatforms.join(', ')}`, results);
}

// ============ Platform Posting Helpers ============

async function postViaSocial(platform, content) {
  // Use the social.js queue + process mechanism
  const queued = queuePost(platform, content, {
    source: 'broadcast',
    title: 'JARVIS Builder Update', // for GitHub issues
    labels: ['jarvis', 'broadcast'],
  });

  if (queued.error) return queued;

  // Immediately process the queue so it goes out now
  const processed = await processQueue();
  return { sent: true, platform, ...processed };
}

async function postToTelegram(content) {
  if (!telegramSendFn || telegramChatIds.length === 0) {
    return { error: 'Telegram not configured for broadcast' };
  }

  const results = [];
  for (const chatId of telegramChatIds) {
    try {
      await telegramSendFn(chatId, content);
      results.push({ chatId, sent: true });
    } catch (err) {
      results.push({ chatId, error: err.message });
    }
  }

  return { sent: true, platform: 'telegram', chats: results };
}

async function postToNervos(content, trimmed) {
  const title = typeof content === 'string'
    ? trimmed.slice(0, 80)
    : `${CONTENT_TYPES[content.type]?.label || 'Update'}: ${trimmed.slice(0, 60)}`;

  try {
    const result = await createNervosTopic(title, trimmed);
    return { sent: true, platform: 'nervos', ...result };
  } catch (err) {
    return { error: `Nervos Talks: ${err.message}` };
  }
}

// ============ Content Cleaning ============

function cleanContent(text) {
  if (!text) return null;

  let cleaned = text
    // Strip any LLM preamble
    .replace(/^(Here'?s?|Sure|Okay|Got it|Of course)[^:]*:\s*/i, '')
    // Strip markdown formatting
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    // Strip emojis (comprehensive Unicode ranges)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    // Strip hashtags
    .replace(/#\w+/g, '')
    // Strip quotes if the whole thing is wrapped
    .replace(/^["'](.+)["']$/s, '$1')
    // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Reject if empty or too short
  if (!cleaned || cleaned.length < 20) return null;

  // Reject fabrication patterns (reuse logic from autonomous.js)
  if (containsFabrication(cleaned)) return null;

  return cleaned;
}

// ============ Fabrication Detection (mirrors autonomous.js) ============

const FABRICATION_PATTERNS = [
  /(?:farm|farming|farmed)\s+(?:airdrop|VIBE|vibeswap)/i,
  /(?:swap|swapping|swapped)\s+(?:for\s+)?VIBE\b/i,
  /\bVIBE\s+token/i,
  /\$VIBE\b/i,
  /(?:buy|sell|trade|trading|bought|sold)\s+(?:on\s+)?[Vv]ibe[Ss]wap/i,
  /(?:airdrop|airdrops)\s+(?:on|from|by|for)\s+[Vv]ibe[Ss]wap/i,
  /[Vv]ibe[Ss]wap\s+(?:is\s+)?live\s+on/i,
  /(?:liquidity|pool|LP)\s+on\s+[Vv]ibe[Ss]wap/i,
  /TVL\s+(?:on|at|for)\s+[Vv]ibe[Ss]wap/i,
  /[Vv]ibe[Ss]wap\s+(?:volume|TVL|users|traders)/i,
  /(?:just|someone)\s+(?:claimed|minted|staked|farmed|bridged|swapped)/i,
];

function containsFabrication(text) {
  if (!text) return false;
  for (const p of FABRICATION_PATTERNS) {
    if (p.test(text)) {
      console.warn(`[broadcast] BLOCKED fabrication: "${text.substring(0, 80)}..." matched ${p}`);
      return true;
    }
  }
  return false;
}

// ============ Daily Counting ============

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDailyCount(platform) {
  const today = getTodayKey();
  return (state.dailyCounts[today] || {})[platform] || 0;
}

function incrementDailyCount(platform) {
  const today = getTodayKey();
  if (!state.dailyCounts[today]) state.dailyCounts[today] = {};
  state.dailyCounts[today][platform] = (state.dailyCounts[today][platform] || 0) + 1;

  // Prune old days (keep last 7)
  const keys = Object.keys(state.dailyCounts).sort();
  while (keys.length > 7) {
    delete state.dailyCounts[keys.shift()];
  }
}

// ============ Persistence ============

async function loadBroadcastState() {
  try {
    if (!existsSync(STATE_FILE)) return;
    const raw = await readFile(STATE_FILE, 'utf-8');
    const data = JSON.parse(raw);

    state.enabled = data.enabled || false;
    state.queue = data.queue || [];
    state.history = data.history || [];
    state.dailyCounts = data.dailyCounts || {};
    state.contentHashes = new Set(data.contentHashes || []);
    state.lastGeneration = data.lastGeneration || 0;
    state.lastQueueProcess = data.lastQueueProcess || 0;
    state.totalGenerated = data.totalGenerated || 0;
    state.totalPosted = data.totalPosted || 0;

    console.log(`[broadcast] Loaded state — queue: ${state.queue.length}, history: ${state.history.length}, hashes: ${state.contentHashes.size}`);
  } catch (err) {
    console.warn(`[broadcast] Failed to load state: ${err.message}`);
  }
}

async function saveBroadcastState() {
  try {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    const toSave = {
      savedAt: new Date().toISOString(),
      enabled: state.enabled,
      queue: state.queue.slice(-20),
      history: state.history.slice(-300),
      dailyCounts: state.dailyCounts,
      contentHashes: [...state.contentHashes].slice(-1000), // Keep last 1000 hashes
      lastGeneration: state.lastGeneration,
      lastQueueProcess: state.lastQueueProcess,
      totalGenerated: state.totalGenerated,
      totalPosted: state.totalPosted,
    };

    await writeFile(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[broadcast] Failed to save state: ${err.message}`);
  }
}
