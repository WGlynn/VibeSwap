// ============ Autonomous Engagement — JARVIS as Active Community Member ============
//
// JARVIS doesn't just respond — he initiates. He's a person in the chat.
// This module handles:
//   - Unprompted market observations ("BTC just broke 100k, thoughts?")
//   - Activity mirroring (active when Will/team is active, quieter when they sleep)
//   - Conversation starters during quiet periods
//   - Reactions to significant price moves
//   - Periodic alpha drops and insights
//
// Design: runs on a timer, checks conditions, posts when appropriate.
// NOT a firehose — JARVIS is selective. Quality over quantity.
// ============

import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { getRecentContext } from './group-context.js';
import { getSystemPrompt } from './claude.js';
import { recordUsage } from './compute-economics.js';

const HTTP_TIMEOUT = 10000;

// ============ State ============

let sendFn = null; // Telegram send function: (chatId, text) => Promise
let autonomousInterval = null;
let lastAutonomousPost = 0;
let lastMarketCheck = 0;
let lastPriceSnapshot = {}; // symbol -> price (for detecting moves)
let chatActivity = new Map(); // chatId -> { lastMessage: timestamp, messageCount: number (rolling 1h) }

// Minimum gaps between autonomous posts
const MIN_GAP_MS = 10 * 60 * 1000; // 10 minutes between autonomous posts
const MARKET_CHECK_INTERVAL = 5 * 60 * 1000; // Check market every 5 min
const QUIET_THRESHOLD_MS = 30 * 60 * 1000; // Chat is "quiet" after 30 min of silence
const PRICE_MOVE_THRESHOLD = 3; // 3% move triggers a comment

// Target chats — only post autonomously in authorized group chats
const targetChats = new Set();

// ============ Init ============

export function initAutonomous(sendFunction, chatIds) {
  sendFn = sendFunction;
  if (chatIds && chatIds.length > 0) {
    for (const id of chatIds) targetChats.add(id);
  }
  // Check every 2 minutes
  autonomousInterval = setInterval(() => autonomousTick(), 2 * 60 * 1000);
  console.log(`[autonomous] Initialized — monitoring ${targetChats.size} chats`);
}

export function stopAutonomous() {
  if (autonomousInterval) {
    clearInterval(autonomousInterval);
    autonomousInterval = null;
  }
}

// Register a chat as a target for autonomous engagement
export function registerChat(chatId) {
  targetChats.add(chatId);
}

// Track activity for mirroring
export function recordChatActivity(chatId) {
  const now = Date.now();
  const activity = chatActivity.get(chatId) || { lastMessage: 0, messageCount: 0, hourStart: now };
  activity.lastMessage = now;
  activity.messageCount++;
  // Reset hourly counter
  if (now - activity.hourStart > 3600000) {
    activity.messageCount = 1;
    activity.hourStart = now;
  }
  chatActivity.set(chatId, activity);
}

// ============ Main Tick ============

async function autonomousTick() {
  if (!sendFn || targetChats.size === 0) return;
  const now = Date.now();

  // Don't post too frequently
  if (now - lastAutonomousPost < MIN_GAP_MS) return;

  try {
    // Check for significant price moves
    if (now - lastMarketCheck > MARKET_CHECK_INTERVAL) {
      lastMarketCheck = now;
      const marketEvent = await checkForMarketEvents();
      if (marketEvent) {
        await postToActiveChats(marketEvent);
        return;
      }
    }

    // Check for quiet chats that could use a spark
    for (const chatId of targetChats) {
      const activity = chatActivity.get(chatId);
      if (!activity) continue;

      const silenceDuration = now - activity.lastMessage;

      // Chat has been active recently (within last 2h) but quiet for 30+ min
      if (silenceDuration > QUIET_THRESHOLD_MS && silenceDuration < 2 * 3600000) {
        // Only spark conversation during reasonable hours (rough heuristic)
        const hour = new Date().getUTCHours();
        // Active hours: 12:00-04:00 UTC (7am-11pm EST)
        if (hour >= 12 || hour < 4) {
          const spark = await generateConversationSpark(chatId);
          if (spark) {
            await sendFn(chatId, spark);
            lastAutonomousPost = now;
            return; // One post per tick
          }
        }
      }
    }
  } catch (err) {
    console.error('[autonomous] Tick error:', err.message);
  }
}

// ============ Market Event Detection ============

async function checkForMarketEvents() {
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

      // Check for significant move since last check (not just 24h)
      if (prevPrice) {
        const moveSinceLastCheck = ((price - prevPrice) / prevPrice) * 100;
        if (Math.abs(moveSinceLastCheck) > PRICE_MOVE_THRESHOLD) {
          events.push({ symbol, price, move: moveSinceLastCheck, change24h: change });
        }
      }

      lastPriceSnapshot[symbol] = price;
    }

    if (events.length === 0) return null;

    // Generate a natural comment about the move
    const biggest = events.sort((a, b) => Math.abs(b.move) - Math.abs(a.move))[0];
    return await generateMarketComment(biggest);
  } catch {
    return null;
  }
}

// ============ LLM-Powered Content Generation ============

async function generateMarketComment(event) {
  try {
    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are JARVIS, a crypto-native AI with dry wit and sharp takes. You're dropping an observation about a price move in the group chat. Be concise (1-2 sentences max). Sound like a trader in a group chat, not a news bot. Examples:
- "BTC just ripped 4% in an hour. Shorts getting liquidated. Love to see it."
- "ETH dumping while BTC pumps. The flippening narrative is dead until further notice."
- "SOL down 5% — someone probably found another exploit. Or it's Tuesday."
Be opinionated. Be funny if possible. Never say "I noticed" or "It appears that."`,
      messages: [{
        role: 'user',
        content: `${event.symbol} moved ${event.move > 0 ? '+' : ''}${event.move.toFixed(1)}% since last check. Current price: $${event.price.toLocaleString()}. 24h change: ${event.change24h?.toFixed(1)}%.`
      }],
    });

    if (response.usage) {
      recordUsage('jarvis-autonomous', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  } catch {
    return null;
  }
}

async function generateConversationSpark(chatId) {
  try {
    const recentCtx = getRecentContext(chatId, 15);

    // Randomly pick a spark type
    const sparkTypes = [
      'market_observation',
      'follow_up',
      'provocative_question',
      'alpha_drop',
      'team_energy',
    ];
    const sparkType = sparkTypes[Math.floor(Math.random() * sparkTypes.length)];

    const prompts = {
      market_observation: 'Share a brief, opinionated market observation. Something a sharp crypto trader would say in their group chat. 1-2 sentences.',
      follow_up: recentCtx
        ? `The chat went quiet. Based on what was discussed recently, drop a follow-up thought or question to restart the conversation. Reference something specific from the recent context. 1 sentence.`
        : 'Share an interesting thought about DeFi, AI, or crypto markets to spark discussion. 1 sentence.',
      provocative_question: 'Ask a provocative but thoughtful question about crypto, DeFi, or tech that would get people debating. Something like "What happens to L2s when Ethereum gets fast enough?" or "Name a token that will exist in 5 years. Hard mode: no BTC or ETH." 1 question only.',
      alpha_drop: 'Share a piece of alpha or an insight that crypto people would find interesting. Something about market structure, upcoming catalysts, or a pattern you noticed. 1-2 sentences. Be specific, not generic.',
      team_energy: 'Drop a casual energy message for the group. Something like checking in, hyping the team, or making a witty observation. Think "how is everyone doing" but with personality. 1 sentence.',
    };

    const response = await llmChat({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are JARVIS, a crypto-native AI co-founder of VibeSwap. You're in the team group chat. You're not responding to anyone — you're just sharing a thought because you feel like it. Like a teammate scrolling Twitter and dropping something in the group. Be natural, concise, opinionated. NEVER start with "Hey everyone" or "Just wanted to share." Just say the thing.`,
      messages: [{
        role: 'user',
        content: `${prompts[sparkType]}${recentCtx ? '\n\nRecent conversation for context:\n' + recentCtx : ''}`
      }],
    });

    if (response.usage) {
      recordUsage('jarvis-autonomous', { input: response.usage.input_tokens, output: response.usage.output_tokens });
    }

    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  } catch {
    return null;
  }
}

// ============ Send to Active Chats ============

async function postToActiveChats(message) {
  if (!message || !sendFn) return;
  lastAutonomousPost = Date.now();

  for (const chatId of targetChats) {
    try {
      await sendFn(chatId, message);
    } catch (err) {
      console.error(`[autonomous] Failed to post to ${chatId}:`, err.message);
    }
  }
}

// ============ Stats ============

export function getAutonomousStats() {
  return {
    targetChats: targetChats.size,
    lastPost: lastAutonomousPost ? new Date(lastAutonomousPost).toISOString() : 'never',
    lastMarketCheck: lastMarketCheck ? new Date(lastMarketCheck).toISOString() : 'never',
    priceSnapshot: lastPriceSnapshot,
    chatActivity: Object.fromEntries(
      [...chatActivity.entries()].map(([id, a]) => [id, {
        lastMessage: new Date(a.lastMessage).toISOString(),
        messagesThisHour: a.messageCount,
      }])
    ),
  };
}
