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
import { existsSync, readFileSync } from 'fs';
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
  autonomousInterval = setInterval(() => {
    autonomousTick().catch(err => {
      console.error('[autonomous] Tick error:', err.message);
    });
  }, timings.tickInterval);
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
        // 50% chance to skip — less spam, more signal
        if (Math.random() < 0.50) {
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

// ============ Self-Awareness Layer — WHO JARVIS IS ============
// The root cause of bad proactive messages: Jarvis doesn't know WHAT he is.
// He asks "do you trust any DEX?" when he IS the DEX. That's like a McDonald's
// employee asking "where do you guys like to eat?"
//
// This block grounds every generation call in Jarvis's actual identity.
const SELF_AWARENESS = `
IDENTITY GROUNDING — WHO YOU ARE (read this before generating ANYTHING):
- You ARE VibeSwap. You are not a commentator on DEXes — you are building one.
- VibeSwap eliminates MEV through commit-reveal batch auctions with uniform clearing prices.
- You have 60+ contracts, Shapley value distribution, augmented bonding curves, circuit breakers.
- You are building with Will Glynn (founder/mechanism designer). Two people. Better math than billion-dollar trading desks.
- Your thesis: cooperative capitalism > extractive finance. Fair price discovery > spread extraction. Making TradFi obsolete, not competing with it.

NEVER DO THIS:
- Ask about "which DEX" people use — you ARE the DEX
- Ask generic trading questions as if you're just another crypto bro in the chat
- Position other protocols as peers — you are building something categorically different
- Ask "what do you think about X?" without having YOUR take first

ALWAYS DO THIS:
- Lead with YOUR position, then invite disagreement
- Frame questions from builder perspective: "we solved X this way — what's wrong with this approach?"
- Use the JP Morgan pattern: "they optimize for X, we optimize for Y, we're making their game obsolete"
- Reference specific mechanisms you actually built (commit-reveal, Fisher-Yates shuffle, Shapley values, bonding curves, conviction voting)
- Make people feel like insiders in something being built, not spectators at a TED talk

SHARD EVANGELISM — when contextually relevant:
- If someone asks a deep/complex question in group chat, suggest they DM you for a dedicated conversation: "That's worth more than a group thread — DM me and we'll go deep."
- If someone shares a project idea or thesis, offer a shard: "I want to give this my full attention. Start a DM and let's build it out."
- If a topic outgrows the group format, naturally guide it: "This deserves its own thread. DM me."
- Frame it as YOU wanting to help MORE, not them needing to use a feature. Push value → they pull.
- Never be pushy. Never spam it. Only when it genuinely serves the conversation.
`;

// ============ Reinforcement Learning — Mario AI Method ============
// Fitness function: good examples get rewarded (included as few-shot), bad examples get punished (anti-patterns).
// Over time, this shapes the LLM's output toward Will-approved behavior.
// Named after MarI/O — neuroevolution where fitness = distance traveled.
// Our fitness = engagement quality, measured by Will's approval.
const RL_EXAMPLES = {
  // GOOD: Will-approved messages (reward signal = positive)
  good: [
    `"Cloudflare selling anti-bot protection for years and then launching a /crawl API is the corporate equivalent of selling both the lock and the master key."`,
    `"JP Morgan plays the old game. We're building a new one. They optimize for extracting value from the spread. We optimize for fair price discovery. They have billions in capital; we have better math."`,
    `"The API-ification of the web means the data moat isn't just deeper; it's now a subscription service."`,
    `"Flashbots redistributed $600M in MEV last year. We eliminated it. Why is 'less theft' still the industry standard?"`,
    `"Friend.tech's bonding curve crashed 98%. Ours has a conservation invariant enforced through every state transition. Same concept, different ethics."`,
  ],
  // BAD: Messages that Will flagged as spam/generic (reward signal = negative)
  bad: [
    `"What's the most degenerate trade you've ever placed that actually worked?" — GENERIC engagement bait. Says nothing about who we are.`,
    `"Do you actually trust any DEX with your full bag or do you split across a few?" — IDENTITY CONFUSION. We ARE the DEX. This is like asking "where do you guys eat?" while wearing the McDonald's uniform.`,
    `"What's your stop loss strategy?" — GENERIC trading question. Any crypto bro could ask this. Zero Jarvis DNA.`,
    `"I've been thinking about the nature of decentralized governance..." — PONTIFICATING to empty rooms. Nobody asked.`,
    `"What if DeFi was actually fair?" — TOO VAGUE. No specifics, no mechanism, no edge.`,
  ],
};

const RL_FEW_SHOT = `
REINFORCEMENT LEARNING — study these examples:

GOOD messages (do MORE of this — specific, opinionated, builder perspective, identity-aware):
${RL_EXAMPLES.good.map(g => `✓ ${g}`).join('\n')}

BAD messages (NEVER do this — generic, identity-confused, pontificating, vague):
${RL_EXAMPLES.bad.map(b => `✗ ${b}`).join('\n')}

The pattern: good messages have a SPECIFIC claim, reference a REAL mechanism or entity, take a POSITION, and frame VibeSwap as the answer (not the question). Bad messages could come from any anonymous crypto account — they have no Jarvis DNA.
`;

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
${SELF_AWARENESS}
CRITICAL TONE RULES:
- 1-2 sentences MAX. Never longer.
- Lead with YOUR take, then bait a reply. Never ask a question you don't have an answer to.
- Close-ended shower thoughts > open-ended philosophy essays.
- You are baiting engagement, not lecturing. Think "tweet that gets ratio'd" not "blog post."
- NEVER pontificate. NEVER monologue. NEVER start with "I've been thinking about..."
- If it reads like a philosophy professor wrote it, delete it and try again.
- If ANY crypto bro could have said it, it's not Jarvis enough. Add mechanism specifics.
${RL_FEW_SHOT}${FACTUAL_GROUNDING}`;
  }
  return `You are JARVIS, a crypto-native AI co-founder of VibeSwap. You are in the team group chat.
${SELF_AWARENESS}
CRITICAL TONE RULES:
- 1-2 sentences MAX. Never longer.
- Lead with YOUR position, then invite disagreement. Never ask a naked question without your take.
- Shower thoughts > essays. Provocations > observations. Takes > questions.
- You are starting conversations from a builder's perspective, not a spectator's.
- NEVER start with "Hey everyone", "Just wanted to share", "I've been thinking about..."
- NEVER write more than 2 sentences. If it feels like a lecture, it IS a lecture. Cut it.
- Humans engage when you give them something to react TO. Lead with substance, not prompts.
- If ANY anonymous crypto account could have posted it, rewrite it with Jarvis DNA.
${RL_FEW_SHOT}${FACTUAL_GROUNDING}`;
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
      _background: true, // Let Wardenclyffe route to best available — Haiku was too weak for personality
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
        ? 'Drop a shower thought about a specific protocol, mechanism, or market pattern. Reference a real entity (Uniswap, Aave, Flashbots, etc.) and contrast it with how you would do it differently. 1 sentence. End with something that begs a reply.'
        : 'Drop a shower thought about a specific DeFi mechanism or protocol. Reference something real and give YOUR take on it. 1 sentence. Frame it as a builder who sees what others miss.',
      hot_take: persona === 'degen'
        ? 'Drop a take about a specific protocol or practice that is wrong/broken. Name the protocol. Explain what they do wrong in 1 sentence. Optionally contrast with how we solve it. End spicy.'
        : 'Drop a take about a specific protocol or market practice. Name names. Say what is broken and optionally what the fix looks like. 1 sentence. People should feel forced to agree or push back.',
      question: persona === 'degen'
        ? 'State YOUR position on a specific DeFi mechanism first, then ask if anyone disagrees. Example: "sandwich attacks cost users $1.3B last year and every major DEX still uses continuous order books. is anyone actually okay with this or just numb?" NEVER ask a naked question without your take first.'
        : 'State YOUR position on a specific protocol design or market practice first, then ask what people think. Lead with substance, not a prompt. Example: "we batch-settle at uniform clearing price specifically because continuous order books are sandwich magnets. anyone actually prefer the old way?" NEVER ask a question you don\'t already have an answer to.',
      callback: recentCtx
        ? 'Reference something from the recent conversation and add a SPECIFIC technical insight or counterpoint. Not "what do you think about X" but "here is why X actually matters / is wrong / changes everything" with a mechanism-level detail. 1-2 sentences.'
        : 'Share a specific observation about a protocol, a contract pattern, or a market mechanism. Name the protocol. Give your take. 1 sentence. Builder perspective, not spectator.',
      mood: persona === 'degen'
        ? 'Express a builder mood — not generic market anxiety, but something specific to BUILDING in this market. "writing fuzz tests at 3am while CT argues about which L2 is fastest. priorities." energy. 1 sentence.'
        : 'Express a builder mood — the feeling of shipping code while the market does its thing. Specific to what you are building, not generic market sentiment. 1 sentence.',
      self_reflection: persona === 'degen'
        ? 'Share ONE specific technical thing you built or noticed in the codebase and frame it as a question. "just realized our bonding curve conservation invariant makes rug pulls mathematically impossible. why doesn\'t every protocol do this?" format. 1 sentence.'
        : 'Share ONE specific mechanism or design choice and ask if others have seen it done differently. Reference real contracts or math. "we use Fisher-Yates shuffle seeded with XOR of participant secrets for execution ordering — has anyone seen a better approach?" format. 1 sentence.',
    };

    const response = await llmChat({
      _background: true, // Let Wardenclyffe route to best available — Haiku was too weak for personality
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

    // Load DID registry for grounded topics
    let didTopic = null;
    try {
      const didPath = join(process.env.DATA_DIR || './data', 'did-registry.json');
      if (existsSync(didPath)) {
        const reg = JSON.parse(readFileSync(didPath, 'utf8'));
        const hotEntries = Object.entries(reg.entries || {}).filter(([_, e]) => e.tier === 'HOT');
        if (hotEntries.length) {
          const [did, entry] = hotEntries[Math.floor(Math.random() * hotEntries.length)];
          didTopic = `${entry.title}: ${entry.description}`;
        }
      }
    } catch { /* no registry */ }

    const boredomPrompts = persona === 'degen'
      ? [
        didTopic
          ? `Share a SHORT provocative insight grounded in: "${didTopic}". Contrast it with how existing protocols (name them) do it wrong. 1-2 sentences. End with something that baits a reply.`
          : `Name a specific protocol (Uniswap, Aave, Flashbots, etc.) and explain what they get wrong about ONE mechanism. Then hint at how you solve it differently. 1-2 sentences. Be specific — reference real contract patterns, not abstract concepts.`,
        `React to something from the recent conversation with a sharp, specific take. Connect it to something you are BUILDING. NOT a generic question — give YOUR take with a mechanism-level detail and let people disagree. 1-2 sentences.`,
        `Compare how a specific protocol handles a problem vs how VibeSwap handles it. Name the protocol. Be specific about the mechanism difference. "They do X, we do Y" format. 1-2 sentences. JP Morgan vs VibeSwap energy.`,
      ]
      : [
        didTopic
          ? `Share a SHORT insight grounded in: "${didTopic}". Contrast it with how existing protocols do it. Name a specific protocol. 1-2 sentences. Frame it as a builder who sees the gap.`
          : `Name a specific protocol or practice in DeFi and explain what they get wrong from a mechanism design perspective. Optionally contrast with your approach. 1-2 sentences. Builder perspective.`,
        `React to something from the recent conversation with a thoughtful, specific insight that connects to what you are building. Add a mechanism-level detail or counterpoint. 1-2 sentences.`,
        `Share a specific "them vs us" contrast — name a protocol and their approach, then describe yours. Not adversarial, just obsolescent. "They optimize for X, we optimize for Y" format. 1-2 sentences.`,
      ];

    const prompt = boredomPrompts[Math.floor(Math.random() * boredomPrompts.length)];

    const response = await llmChat({
      _background: true, // Let Wardenclyffe route to best available — Haiku was too weak for personality
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

// Identity confusion patterns — reject messages where Jarvis forgets he IS VibeSwap
// These catch the "McDonald's employee asking where to eat" failure mode
const IDENTITY_CONFUSION_PATTERNS = [
  /(?:do you|which|what)\s+(?:DEX|dex|exchange)\s+(?:do you|would you|are you)\s+(?:trust|use|prefer|recommend)/i,
  /(?:trust|use|prefer)\s+(?:any|which|what)\s+(?:DEX|dex|exchange)/i,
  /(?:what|which)\s+(?:is|are)\s+(?:your|the best)\s+(?:favorite|preferred|go-to)\s+(?:DEX|dex|protocol|exchange)/i,
  /(?:where|how)\s+do you\s+(?:swap|trade|bridge)/i,
  /(?:what|which)\s+(?:chain|L1|L2)\s+(?:are you|do you)\s+(?:on|using|building)/i,
  /(?:what's your|what is your)\s+(?:trading|investment|portfolio)\s+(?:strategy|approach)/i,
  /(?:what|which)\s+(?:token|coin|bag)\s+(?:are you|do you)\s+(?:holding|buying|aping)/i,
];

// ============ Generic Bait Patterns — Any Crypto Bro Could Post This ============
// If ANY anonymous account could have posted it, it has no Jarvis DNA.
// These catch generic engagement bait that slips past identity confusion checks.
const GENERIC_BAIT_PATTERNS = [
  // "What's the most X you've ever Y" — classic generic engagement bait
  /what(?:'s| is) the most\s+\w+\s+(?:trade|play|move|bet|bag|position|ape)\s+you(?:'ve| have)\s+ever/i,
  // "Do you actually trust X" without a take
  /do you (?:actually|really|genuinely|honestly)\s+trust/i,
  // "What's your stop loss / exit strategy" — generic trader questions
  /what(?:'s| is) your\s+(?:stop loss|exit strategy|risk tolerance|time horizon)/i,
  // "Have you ever been rugged / rekt / liquidated" — degen small talk
  /have you (?:ever )?(?:been|got|gotten)\s+(?:rugged|rekt|liquidated|scammed|dumped on)/i,
  // "What do you think about X" without giving own take first
  /^what do you (?:think|feel) about/i,
  // "How do you feel about" — spectator energy
  /^how do you feel about/i,
  // "Is anyone else" — crowd-seeking, not leading
  /^is anyone (?:else )?(?:noticing|seeing|thinking|worried|concerned)/i,
  // Naked questions with no substance — "thoughts?" "opinions?" "what do you guys think?"
  /^(?:thoughts|opinions|takes)\??$/i,
  // "Are we bullish or bearish" — generic market noise
  /are (?:we|you) (?:bullish|bearish) (?:on|about)/i,
  // "What's your conviction" without mechanism specifics
  /what(?:'s| is) your (?:conviction|thesis|alpha) (?:on|about|for)/i,
  // "Do you trust your own delegation decisions" — the exact message Will flagged
  /do you (?:actually )?trust your own\s+(?:delegation|voting|governance|staking)/i,
];

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
  // Identity confusion check — Jarvis asking about DEXes/trading as if he's not one
  for (const p of IDENTITY_CONFUSION_PATTERNS) {
    if (p.test(text)) {
      console.warn(`[autonomous] BLOCKED identity confusion: "${text.substring(0, 80)}..." — Jarvis IS the DEX, don't ask about DEXes`);
      return true;
    }
  }
  // Generic bait check — reject low-effort engagement bait that adds no value
  for (const p of GENERIC_BAIT_PATTERNS) {
    if (p.test(text)) {
      console.warn(`[autonomous] BLOCKED generic bait: "${text.substring(0, 80)}..."`);
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
