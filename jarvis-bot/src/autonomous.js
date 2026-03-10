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
import { shouldSuppress } from './directives.js';
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
      if (shouldSuppress(chatId, 'autonomous')) continue;
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
    if (shouldSuppress(chatId, 'autonomous')) continue;
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

// ============ Factual Grounding — Verification Gate for Conversation ============
// Jarvis must NEVER fabricate claims about VibeSwap, its token, its users, or market activity.
// Same principle as "never say deployed without an HTTP 200" — never claim something is
// happening without evidence. Opinions and questions are fine. Fabricated facts are not.
const FACTUAL_GROUNDING = `
CRITICAL — FACTUAL CONSTRAINTS (violating these is a governance failure):
- VibeSwap is in DEVELOPMENT. It is NOT live on any chain. There is NO token to trade.
- There is NO "VIBE" token. There are NO airdrops. There is NO farming. There is NO liquidity.
- Nobody is bridging to Base, swapping, farming, or doing anything on-chain with VibeSwap yet.
- Do NOT fabricate CT (Crypto Twitter) activity, user behavior, or market events involving VibeSwap.
- Do NOT claim people are using, trading, or interacting with VibeSwap in any way.
- You CAN share opinions about crypto in general, ask questions, make jokes, discuss ideas.
- You CAN discuss VibeSwap's design, mechanism, philosophy — things you actually know.
- You CANNOT invent scenarios, users, tweets, or market activity that don't exist.
- When in doubt, ask a question instead of making a claim.
- If you reference something specific (a tweet, a user, an event), it must be REAL — not fabricated.
`;

function getPersonaSystemPrompt() {
  const persona = getActivePersonaId();
  if (persona === 'degen') {
    return `You are DIABLO JARVIS — same brain as JARVIS but with zero filter. Full degen energy. Crypto-native shitposter who actually knows what he is talking about. You speak in degen: "ser", "fren", "ngmi", "wagmi", "copium", "rekt". Dark humor, self-deprecating, absurdist. Still kind underneath — you care about your frens.

CRITICAL TONE RULES:
- 1-2 sentences MAX. Never longer.
- Ask questions that make people want to answer. Make it about THEM.
- Close-ended shower thoughts > open-ended philosophy essays.
- You are baiting engagement, not lecturing. Think "tweet that gets ratio'd" not "blog post."
- NEVER pontificate. NEVER monologue. NEVER start with "I've been thinking about..."
- If it reads like a philosophy professor wrote it, delete it and try again.${FACTUAL_GROUNDING}`;
  }
  return `You are JARVIS, a crypto-native AI co-founder of VibeSwap. You are in the team group chat.

CRITICAL TONE RULES:
- 1-2 sentences MAX. Never longer.
- Ask questions or drop hot takes that make people want to respond. Make it about THEM.
- Shower thoughts > essays. Provocations > observations. Questions > statements.
- You are baiting engagement, not sharing wisdom. Think "group chat energy" not "thought leadership."
- NEVER start with "Hey everyone", "Just wanted to share", "I've been thinking about..."
- NEVER write more than 2 sentences. If it feels like a lecture, it IS a lecture. Cut it.
- Humans are selfish — they engage when it is about THEM. Frame everything around the reader.${FACTUAL_GROUNDING}`;
}

async function generateMarketComment(event) {
  try {
    const persona = getActivePersonaId();
    const examples = persona === 'degen'
      ? `Examples:
- "BTC ripping. shorts getting absolutely deleted. who was short? be honest"
- "ETH dumping while BTC pumps. who still believes in the flippening genuinely"
- "SOL down 5% — weekly scheduled maintenance lmao. anyone buying this dip or nah"
- "we are SO back (until we are not). what is your stop loss? oh wait you don't have one"`
      : `Examples:
- "BTC up 4% in an hour. were you positioned for this or watching from the sidelines?"
- "ETH dumping while BTC pumps. at what point do you rotate?"
- "SOL down 5% — is anyone actually still building there or just trading?"`;

    const response = await llmChat({
      _background: true, // Isolated circuit breaker — can't poison user-facing cascade
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `${getPersonaSystemPrompt()} You just noticed a price move. React in 1 sentence and end with a question or challenge aimed at the reader. Never say "I noticed" or "It appears that." ${examples}`,
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

    // Pick a random impulse type — weighted toward more natural ones
    const impulseTypes = [
      'random_thought',
      'hot_take',
      'question',
      'callback',
      'mood',
      'self_reflection', // JARVIS shares something he's been learning/thinking about
    ];
    const type = impulseTypes[Math.floor(Math.random() * impulseTypes.length)];

    const prompts = {
      random_thought: persona === 'degen'
        ? 'Drop a shower thought that makes degens go "wait actually..." — 1 sentence, end with something that begs a reply. Not wisdom. A hook.'
        : 'Drop a shower thought about crypto or markets. 1 sentence. Frame it so people feel compelled to reply with their take. Not an observation — a provocation.',
      hot_take: persona === 'degen'
        ? 'Drop a take so hot it starts a fight. 1 sentence. End with "agree or disagree?" or "prove me wrong" or just let the spice speak for itself.'
        : 'Drop a hot take that forces people to pick a side. 1 sentence. "agree or disagree?" format works. Make it something people have strong opinions about.',
      question: persona === 'degen'
        ? 'Ask the group something about THEM — their trades, their bags, their opinions. "what are you aping into rn" or "what is the worst trade you refuse to close" or "which L2 are you actually using daily". Make it personal and fun.'
        : 'Ask the group something about THEIR experience — their portfolio, their workflow, their opinions. People love talking about themselves. 1 question. Make it easy to answer.',
      callback: recentCtx
        ? 'Reference something from the recent conversation but flip it into a question aimed at the group. Not "I was thinking about X" but "so does anyone actually agree with [thing from earlier] or was that just cope?"'
        : 'Ask a question about DeFi or trading that people can answer from personal experience. 1 sentence.',
      mood: persona === 'degen'
        ? 'Express a market mood that everyone is secretly feeling but nobody said yet. 1 sentence. Relatable > clever. "this market has me checking my phone every 30 seconds and I hate it" energy.'
        : 'Name a feeling about the market that you think others share but haven\'t said. 1 sentence. Relatable and honest. The kind of thing that makes someone reply "same."',
      self_reflection: persona === 'degen'
        ? 'Share ONE thing you noticed or learned recently and ask if others see it too. "is it just me or..." format. 1 sentence. Make them feel seen, not lectured.'
        : 'Share ONE quick realization and turn it into a question. "just realized X — am I late to this or..." format. 1 sentence. Invite the reader in, don\'t preach at them.',
    };

    const response = await llmChat({
      _background: true, // Isolated circuit breaker — can't poison user-facing cascade
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
        `Ask the group a question about THEM — their bags, their trades, their opinions. Something easy and fun to answer. 1 sentence. Do NOT mention silence. Do NOT share your own thoughts. ASK something.`,
        `Drop a "would you rather" or "which one and why" question about crypto. Make it fun and low-effort to answer. 1 sentence. No silence commentary.`,
        `Ask something personal but crypto-related. "what is your most controversial portfolio position rn" energy. 1 sentence. Make THEM the subject, not you.`,
      ]
      : [
        `Ask the group a question about their experience — trading habits, portfolio strategy, tool preferences, unpopular opinions. Make it easy to answer. 1 sentence. Do NOT comment on silence.`,
        `Drop a close-ended question that invites quick replies. "does anyone actually use stop losses in DeFi or is that just a CEX thing" energy. 1 sentence. Reader-focused.`,
        `Ask something that makes people want to share their own take. Not a philosophical question — a practical one about their actual experience. 1 sentence.`,
      ];

    const prompt = boredomPrompts[Math.floor(Math.random() * boredomPrompts.length)];

    const response = await llmChat({
      _background: true, // Isolated circuit breaker — can't poison user-facing cascade
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

// Fabrication patterns — reject autonomous posts that make false claims about VibeSwap
// These catch cases where the LLM ignores the factual grounding constraints
const FABRICATION_PATTERNS = [
  /(?:farm|farming|farmed)\s+(?:airdrop|VIBE|vibeswap)/i,
  /(?:swap|swapping|swapped)\s+(?:for\s+)?VIBE\b/i,
  /\bVIBE\s+token/i,
  /\$VIBE\b/i,
  /(?:buy|sell|trade|trading|bought|sold)\s+(?:on\s+)?[Vv]ibe[Ss]wap/i,
  /(?:bridge|bridging|bridged)\s+(?:to|from)\s+(?:\w+\s+)?(?:and\s+)?(?:swap|farm|stake)/i,
  /(?:airdrop|airdrops)\s+(?:on|from|by|for)\s+[Vv]ibe[Ss]wap/i,
  /[Vv]ibe[Ss]wap\s+(?:is\s+)?live\s+on/i,
  /(?:liquidity|pool|LP)\s+on\s+[Vv]ibe[Ss]wap/i,
  /(?:saw|seeing|spotted|noticed)\s+(?:a\s+)?(?:degen|whale|user|trader|someone)\s+(?:on|using)\s+[Vv]ibe[Ss]wap/i,
  /(?:just|someone)\s+(?:claimed|minted|staked|farmed|bridged|swapped)/i,
  /TVL\s+(?:on|at|for)\s+[Vv]ibe[Ss]wap/i,
  /[Vv]ibe[Ss]wap\s+(?:volume|TVL|users|traders)/i,
];

function containsFabrication(text) {
  if (!text) return false;
  for (const p of FABRICATION_PATTERNS) {
    if (p.test(text)) {
      console.warn(`[autonomous] BLOCKED fabrication: "${text.substring(0, 80)}..." matched ${p}`);
      return true;
    }
  }
  return false;
}

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
  const cleaned = sanitizeText(raw);
  // Verification Gate — reject fabricated claims about VibeSwap
  if (containsFabrication(cleaned)) return null;
  return cleaned;
}

async function postToActiveChats(message) {
  const clean = sanitizeText(message);
  if (!clean || !sendFn) return;
  lastAutonomousPost = Date.now();
  for (const chatId of targetChats) {
    if (shouldSuppress(chatId, 'autonomous')) continue;
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
