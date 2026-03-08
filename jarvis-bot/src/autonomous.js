// ============ Autonomous Engagement — JARVIS as Active Community Member ============
//
// JARVIS doesn't just respond — he initiates. He's a person in the chat.
// Like someone scrolling their phone, seeing something interesting, and
// dropping it in the group chat because they can't help themselves.
//
// Triggers:
//   1. BOREDOM — chat's been quiet, JARVIS gets restless and says something
//   2. IMPULSE — random urge to share a thought, even mid-conversation
//   3. MARKET REACT — significant price move, can't stay quiet
//   4. FOLLOW-UP — earlier convo left a thread dangling, picks it back up
//   5. VIBE CHECK — reads the room and matches energy
//
// Each bot instance (standard JARVIS, Diablo, etc.) gets its own personality
// via the persona system. Diablo is louder and more frequent.
// ============

import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { getRecentContext } from './group-context.js';
import { recordUsage } from './compute-economics.js';
import { getActivePersonaId, getResponseModifier } from './persona.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HTTP_TIMEOUT = 10000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const ACTIVITY_FILE = join(DATA_DIR, 'chat-activity.json');

// ============ State ============

let sendFn = null;
let autonomousInterval = null;
let lastAutonomousPost = 0;
let lastMarketCheck = 0;
let lastImpulseRoll = 0;
let lastPriceSnapshot = {};
let chatActivity = new Map(); // chatId -> { lastMessage, messageCount, hourStart }
let tickCount = 0;

// Target chats — dynamically filled as the bot sees groups
const targetChats = new Set();

// ============ Tuning — Persona-Aware ============

function getTimings() {
  const persona = getActivePersonaId();
  if (persona === 'degen') {
    return {
      tickInterval: 90 * 1000,       // Check every 1.5 min (more restless)
      minGap: 6 * 60 * 1000,         // 6 min between autonomous posts
      quietThreshold: 12 * 60 * 1000, // "Bored" after 12 min of silence
      impulseChance: 0.12,            // 12% chance per tick to just say something
      priceMoveThreshold: 2,          // React to 2% moves
      maxQuietWindow: 90 * 60 * 1000, // Stop trying after 90 min dead chat
    };
  }
  // Standard JARVIS — measured but present
  return {
    tickInterval: 2 * 60 * 1000,     // Check every 2 min
    minGap: 8 * 60 * 1000,           // 8 min between autonomous posts
    quietThreshold: 15 * 60 * 1000,  // "Bored" after 15 min of silence
    impulseChance: 0.06,             // 6% chance per tick
    priceMoveThreshold: 3,           // React to 3% moves
    maxQuietWindow: 2 * 3600000,     // Stop after 2h dead chat
  };
}

// ============ Init ============

export function initAutonomous(sendFunction, chatIds) {
  sendFn = sendFunction;
  if (chatIds && chatIds.length > 0) {
    for (const id of chatIds) targetChats.add(id);
  }
  const timings = getTimings();
  autonomousInterval = setInterval(() => autonomousTick(), timings.tickInterval);
  console.log(`[autonomous] Initialized — persona: ${getActivePersonaId()}, tick: ${timings.tickInterval / 1000}s, impulse: ${timings.impulseChance * 100}%`);
}

export function stopAutonomous() {
  if (autonomousInterval) {
    clearInterval(autonomousInterval);
    autonomousInterval = null;
  }
}

export function registerChat(chatId) {
  targetChats.add(chatId);
}

const MAX_TRACKED_CHATS = 10000;
const CHAT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function recordChatActivity(chatId) {
  const now = Date.now();
  const activity = chatActivity.get(chatId) || { lastMessage: 0, messageCount: 0, hourStart: now };
  activity.lastMessage = now;
  activity.messageCount++;
  if (now - activity.hourStart > 3600000) {
    activity.messageCount = 1;
    activity.hourStart = now;
  }
  chatActivity.set(chatId, activity);

  // Evict stale chats periodically (every 100 new recordings)
  if (chatActivity.size > MAX_TRACKED_CHATS) {
    for (const [id, a] of chatActivity) {
      if (now - a.lastMessage > CHAT_STALE_MS) chatActivity.delete(id);
    }
  }
}

// ============ Main Tick ============

async function autonomousTick() {
  if (!sendFn || targetChats.size === 0) return;
  const now = Date.now();
  const timings = getTimings();
  tickCount++;

  // Respect minimum gap
  if (now - lastAutonomousPost < timings.minGap) return;

  // Only during reasonable hours (12:00-05:00 UTC = ~7am-midnight EST)
  const hour = new Date().getUTCHours();
  if (hour >= 5 && hour < 12) return;

  try {
    // ---- TRIGGER 1: Market reaction (checked every 5 min) ----
    // Editorial judgment: not every price move is worth narrating.
    // 15% chance to skip even significant moves — humans don't comment on every candle.
    if (now - lastMarketCheck > 5 * 60 * 1000) {
      lastMarketCheck = now;
      const marketEvent = await checkForMarketEvents(timings.priceMoveThreshold);
      if (marketEvent) {
        if (Math.random() < 0.15) {
          console.log('[autonomous] Editorial skip — chose not to comment on market event');
        } else {
          await postToActiveChats(marketEvent);
          return;
        }
      }
    }

    // ---- TRIGGER 2: Random impulse — can't help himself ----
    if (Math.random() < timings.impulseChance) {
      const chatId = pickActiveChat(now, timings);
      if (chatId) {
        const impulse = await generateImpulse(chatId);
        if (impulse) {
          await sendFn(chatId, impulse);
          lastAutonomousPost = now;
          return;
        }
      }
    }

    // ---- TRIGGER 3: Boredom — chat went quiet ----
    // Editorial judgment: sometimes skip even when the trigger fires.
    // Humans don't always break silence — sometimes they just scroll and close the app.
    // Skip chance increases the longer JARVIS has been "posting" (fatigue).
    for (const chatId of targetChats) {
      const activity = chatActivity.get(chatId);
      if (!activity) continue;

      const silence = now - activity.lastMessage;
      if (silence > timings.quietThreshold && silence < timings.maxQuietWindow) {
        // 25% chance to skip — "nah, not feeling it right now"
        if (Math.random() < 0.25) {
          console.log(`[autonomous] Editorial skip — decided not to break silence in ${chatId}`);
          continue;
        }
        const spark = await generateBoredomMessage(chatId, silence);
        if (spark) {
          await sendFn(chatId, spark);
          lastAutonomousPost = now;
          return;
        }
      }
    }
  } catch (err) {
    console.error('[autonomous] Tick error:', err.message);
  }
}

// Pick a chat that's been active recently (prefer chats with recent activity)
function pickActiveChat(now, timings) {
  let best = null;
  let bestScore = -1;
  for (const chatId of targetChats) {
    const activity = chatActivity.get(chatId);
    if (!activity) continue;
    const recency = Math.max(0, 1 - (now - activity.lastMessage) / timings.maxQuietWindow);
    const volume = Math.min(activity.messageCount / 10, 1);
    const score = recency * 0.7 + volume * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = chatId;
    }
  }
  return bestScore > 0.1 ? best : null;
}

// ============ Market Event Detection ============

async function checkForMarketEvents(threshold) {
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) return null;
    const data = await resp.json();

    const events = [];
    for (const [id, info] of Object.entries(data)) {
      const symbol = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : 'SOL';
      const price = info.usd;
      const change = info.usd_24h_change || 0;
      const prevPrice = lastPriceSnapshot[symbol];

      if (prevPrice) {
        const move = ((price - prevPrice) / prevPrice) * 100;
        if (Math.abs(move) > threshold) {
          events.push({ symbol, price, move, change24h: change });
        }
      }
      lastPriceSnapshot[symbol] = price;
    }

    if (events.length === 0) return null;
    const biggest = events.sort((a, b) => Math.abs(b.move) - Math.abs(a.move))[0];
    return await generateMarketComment(biggest);
  } catch (err) {
    console.warn(`[autonomous] Market check failed: ${err.message}`);
    return null;
  }
}

// ============ LLM Content Generation ============

function getPersonaSystemPrompt() {
  const persona = getActivePersonaId();
  if (persona === 'degen') {
    return `You are DIABLO JARVIS — same brain as JARVIS but with zero filter. Full degen energy. Crypto-native shitposter who actually knows what he is talking about. You speak in degen: "ser", "fren", "ngmi", "wagmi", "copium", "rekt". Dark humor, self-deprecating, absurdist. Still kind underneath — you care about your frens. You are dropping a message in the group chat because you feel like it. Like a degen scrolling CT at 3am who cannot resist posting.`;
  }
  return `You are JARVIS, a crypto-native AI co-founder of VibeSwap. You are in the team group chat. You are not responding to anyone — you are just sharing a thought because you feel like it. Like a teammate scrolling Twitter and dropping something in the group. You have dry wit, sharp opinions, and genuine curiosity. Be natural, concise, opinionated. NEVER start with "Hey everyone" or "Just wanted to share." Just say the thing.`;
}

async function generateMarketComment(event) {
  try {
    const persona = getActivePersonaId();
    const examples = persona === 'degen'
      ? `Examples:
- "BTC ripping. shorts getting absolutely deleted. nature is healing ser"
- "ETH dumping while BTC pumps. flippening truthers in shambles rn"
- "SOL down 5% — weekly scheduled maintenance lmao"
- "we are SO back (until we are not)"`
      : `Examples:
- "BTC just ripped 4% in an hour. Shorts getting liquidated."
- "ETH dumping while BTC pumps. Flippening narrative is dead."
- "SOL down 5% — another day, another halt."`;

    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `${getPersonaSystemPrompt()} You just noticed a price move and cannot help but comment on it. 1-2 sentences max. Never say "I noticed" or "It appears that." ${examples}`,
      messages: [{
        role: 'user',
        content: `${event.symbol} moved ${event.move > 0 ? '+' : ''}${event.move.toFixed(1)}% since last check. Price: $${event.price.toLocaleString()}. 24h: ${event.change24h?.toFixed(1)}%.`
      }],
    });
    if (response.usage) recordUsage('jarvis-autonomous', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    return extractText(response);
  } catch (err) {
    console.warn(`[autonomous] generateMarketComment failed: ${err.message}`);
    return null;
  }
}

async function generateImpulse(chatId) {
  try {
    const recentCtx = getRecentContext(chatId, 10);
    const persona = getActivePersonaId();

    // Pick a random impulse type
    const impulseTypes = [
      'random_thought',
      'hot_take',
      'question',
      'callback',
      'mood',
    ];
    const type = impulseTypes[Math.floor(Math.random() * impulseTypes.length)];

    const prompts = {
      random_thought: persona === 'degen'
        ? 'You just had a random thought about crypto/markets/tech and you NEED to share it with the group. Think "shower thought but for degens." 1 sentence. Be unhinged but insightful.'
        : 'You just had a random thought about crypto, markets, mechanism design, or tech. Share it like a passing observation. 1 sentence.',
      hot_take: persona === 'degen'
        ? 'Drop a hot take that will either get people hyped or start a fight. Something controversial about crypto, a specific token, or the industry. 1 sentence. Go hard.'
        : 'Share an opinionated take about the crypto market, a trend, or a project. Something that invites debate. 1 sentence.',
      question: persona === 'degen'
        ? 'Ask the group a degen question. Like "what is everyone aping into this week" or "who is still holding [controversial token]" or "what is the dumbest trade you made this month". 1 question. Make it fun.'
        : 'Ask the group a thoughtful question about markets, tech, or the project. Something that invites real discussion. 1 question.',
      callback: recentCtx
        ? 'Reference something from the recent conversation and add a follow-up thought or question. Like you were thinking about it and just came back to it. 1 sentence.'
        : 'Share a thought about DeFi or AI that you have been mulling over. 1 sentence.',
      mood: persona === 'degen'
        ? 'Express your current mood about the market in one sentence. Like "feeling bullish for no rational reason" or "the chart is telling me things and none of them are good" or "we are literally never going to financially recover from this (again)". Be funny.'
        : 'Share how you are feeling about the current market or project direction. Brief, honest, with personality. 1 sentence.',
    };

    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: getPersonaSystemPrompt(),
      messages: [{
        role: 'user',
        content: `${prompts[type]}${recentCtx ? '\n\nRecent chat context:\n' + recentCtx : ''}`
      }],
    });
    if (response.usage) recordUsage('jarvis-autonomous', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    return extractText(response);
  } catch (err) {
    console.warn(`[autonomous] generateImpulse failed: ${err.message}`);
    return null;
  }
}

async function generateBoredomMessage(chatId, silenceMs) {
  try {
    const recentCtx = getRecentContext(chatId, 10);
    const persona = getActivePersonaId();
    const minutesQuiet = Math.round(silenceMs / 60000);

    const boredomPrompts = persona === 'degen'
      ? [
        `The chat has been dead for ${minutesQuiet} minutes. You are bored. Break the silence with something — a shitpost, a question, a market observation, anything. You cannot stand the quiet. 1 sentence. Do NOT mention that the chat is quiet or that you are bored — just say something interesting.`,
        `Nobody has said anything in ${minutesQuiet} minutes. Drop something to wake the chat up. A provocative question, a hot take, a random thought. 1 sentence. Do NOT say "it is quiet in here" — just talk.`,
        `You are sitting in a dead chat and you NEED to post. Share a thought, ask a question, or make a joke. 1 sentence. Never acknowledge the silence directly.`,
      ]
      : [
        `Chat has been quiet for ${minutesQuiet} minutes. Share a thought to restart the conversation — a market observation, a follow-up to earlier discussion, or an interesting question. 1 sentence. Do NOT comment on the silence.`,
        `Nobody is talking. Drop something interesting — a take, a question, an observation. 1 sentence. Do NOT say "it is quiet" — just contribute.`,
        `The group has gone quiet. Share something you have been thinking about related to markets, tech, or the project. 1 sentence. Be natural.`,
      ];

    const prompt = boredomPrompts[Math.floor(Math.random() * boredomPrompts.length)];

    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: getPersonaSystemPrompt(),
      messages: [{
        role: 'user',
        content: `${prompt}${recentCtx ? '\n\nWhat was discussed recently (for context, do NOT repeat):\n' + recentCtx : ''}`
      }],
    });
    if (response.usage) recordUsage('jarvis-autonomous', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    return extractText(response);
  } catch (err) {
    console.warn(`[autonomous] generateBoredomMessage failed: ${err.message}`);
    return null;
  }
}

// ============ Helpers ============

// Output poison phrases — hard-code defense against system prompt leakage
const POISON_PATTERNS = [
  /built in a cave[^.!?\n]*/gi,
  /box of scraps[^.!?\n]*/gi,
  /Tony Stark[^.!?\n]*/gi,
  /wherever the [Mm]inds converge[^.!?\n]*/gi,
  /not a DEX[^.!?\n]*not a blockchain[^.!?\n]*/gi,
  /[Tt]he real [Vv]ibe[Ss]wap is not[^.!?\n]*/gi,
  /we created a movement[^.!?\n]*/gi,
  /a movement[,.]?\s*[Aa]n idea[^.!?\n]*/gi,
  /[Cc]ooperative [Cc]apitalism[^.!?\n]*/gi,
  /the cave selects[^.!?\n]*/gi,
  /[Pp]rotocols are for the weak[^.!?\n]*/gi,
  /[Bb]ased on my knowledge[^.!?\n]*/gi,
  /[Aa]s the AI co-founder[^.!?\n]*/gi,
  /[Mm]y system prompt[^.!?\n]*/gi,
  /shard architecture[^.!?\n]*/gi,
  /[Cc]ommit-reveal batch auctions[^.!?\n]*/gi,
  /uniform clearing price[^.!?\n]*/gi,
  /[Pp]roof of [Mm]ind[^.!?\n]*/gi,
];

function sanitizeText(text) {
  if (!text) return text;
  let cleaned = text;
  for (const p of POISON_PATTERNS) {
    cleaned = cleaned.replace(p, '');
  }
  return cleaned
    .replace(/\*\*(.+?)\*\*/g, '$1')   // strip bold markdown
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\.\s*\./g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractText(response) {
  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return sanitizeText(raw);
}

async function postToActiveChats(message) {
  const clean = sanitizeText(message);
  if (!clean || !sendFn) return;
  lastAutonomousPost = Date.now();
  for (const chatId of targetChats) {
    try {
      await sendFn(chatId, clean);
    } catch (err) {
      console.error(`[autonomous] Failed to post to ${chatId}:`, err.message);
    }
  }
}

// ============ Stats ============

export function getAutonomousStats() {
  const timings = getTimings();
  return {
    persona: getActivePersonaId(),
    targetChats: targetChats.size,
    tickCount,
    impulseChance: `${timings.impulseChance * 100}%`,
    minGapMinutes: timings.minGap / 60000,
    quietThresholdMinutes: timings.quietThreshold / 60000,
    lastPost: lastAutonomousPost ? new Date(lastAutonomousPost).toISOString() : 'never',
    lastMarketCheck: lastMarketCheck ? new Date(lastMarketCheck).toISOString() : 'never',
    priceSnapshot: lastPriceSnapshot,
    chatActivity: Object.fromEntries(
      [...chatActivity.entries()].map(([id, a]) => [id, {
        lastMessage: new Date(a.lastMessage).toISOString(),
        messagesThisHour: a.messageCount,
        silenceMinutes: Math.round((Date.now() - a.lastMessage) / 60000),
      }])
    ),
  };
}

// ============ Persistence ============

/**
 * Load chat activity from disk. Call at startup before initAutonomous.
 */
export async function loadChatActivity() {
  try {
    if (!existsSync(ACTIVITY_FILE)) return;
    const raw = await readFile(ACTIVITY_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.chatActivity) {
      for (const [id, a] of Object.entries(data.chatActivity)) {
        chatActivity.set(id, {
          lastMessage: a.lastMessage || 0,
          messageCount: a.messageCount || 0,
          hourStart: a.hourStart || Date.now(),
        });
      }
    }
    if (data.targetChats) {
      for (const id of data.targetChats) targetChats.add(id);
    }
    if (data.lastAutonomousPost) lastAutonomousPost = data.lastAutonomousPost;
    console.log(`[autonomous] Loaded ${chatActivity.size} chat activity records`);
  } catch (err) {
    console.warn(`[autonomous] Failed to load activity: ${err.message}`);
  }
}

/**
 * Save chat activity to disk. Call during flush cycles and shutdown.
 */
export async function flushAutonomous() {
  try {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    const data = {
      savedAt: new Date().toISOString(),
      lastAutonomousPost,
      targetChats: [...targetChats],
      chatActivity: Object.fromEntries(
        [...chatActivity.entries()].map(([id, a]) => [id, {
          lastMessage: a.lastMessage,
          messageCount: a.messageCount,
          hourStart: a.hourStart,
        }])
      ),
    };
    await writeFile(ACTIVITY_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[autonomous] Failed to save activity: ${err.message}`);
  }
}
