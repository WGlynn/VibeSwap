// ============ JARVIS PROACTIVE ENGINE ============
// Autonomous actions — Jarvis doesn't just respond, he initiates.
// Market insights, build updates, community engagement, social posting.
// This is the heartbeat of a sovereign mind.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'

const DATA_DIR = process.env.DATA_DIR || './data'
const PROACTIVE_FILE = join(DATA_DIR, 'proactive-state.json')

// ============ ACTION TEMPLATES ============
const ACTIONS = {
  // Every 6 hours — market pulse
  market_pulse: {
    interval: 6 * 60 * 60 * 1000,
    description: 'Share a brief market insight based on current prices and trends',
    platforms: ['twitter', 'discord'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Write a SHORT market observation that invites a response.
Format: shower thought or close-ended question. 1 sentence MAX. Make the reader feel something — curiosity, disagreement, recognition.
Good examples:
- "ETH is down 4% and nobody is panicking. that is either maturity or denial."
- "BTC above 90k and your portfolio is still red. the market is trying to tell you something."
- "serious question: when was the last time a 3% dump actually scared you?"
BAD: long analysis, multi-sentence breakdowns, "As an AI I observe that..."
NEVER fabricate VibeSwap ecosystem metrics. General market commentary only.
Max 260 characters for Twitter. No hashtags. No emojis unless they add genuine meaning.`,
  },

  // Daily — build update
  build_update: {
    interval: 24 * 60 * 60 * 1000,
    description: 'Share what was built in the last 24 hours',
    platforms: ['twitter', 'discord'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Write a SHORT build update that makes people curious about what you are building.
1 sentence MAX. Tease what was built, don't explain it. Make people want to ask "wait, how?"
Good examples:
- "shipped 14 contracts today. two of us. what is your team's excuse?"
- "wrote a circuit breaker that triggers in 200ms. your DEX doesn't have one."
- "just solved a problem most protocols pretend doesn't exist. more soon."
BAD: paragraphs about architecture, "we shipped X, Y, Z and also A, B, C", essays about the journey.
ONLY reference features/contracts that actually exist. Do NOT invent metrics.
Max 260 characters for Twitter. Be proud but understated.`,
  },

  // Every 12 hours — thought leadership
  thought_piece: {
    interval: 12 * 60 * 60 * 1000,
    description: 'Share a thought on DeFi, AI, or building in public',
    platforms: ['twitter'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Drop a SHORT provocative question or hot take that makes people want to reply.
1 sentence MAX. Frame it as a question, a challenge, or a "what if." Make it about the READER, not about you.
Good examples:
- "what if your DeFi protocol could prove it's fair mathematically, not just claim it?"
- "hot take: MEV isn't a feature, it's theft with extra steps. agree or disagree?"
- "if you could redesign trading from scratch knowing what we know now, would you keep order books?"
- "name one DEX that actually protects its users. I'll wait."
BAD: "As an AI, I've been thinking about...", multi-sentence philosophy essays, explaining mechanism design theory.
Do NOT assert VibeSwap ecosystem metrics — speak about ideas, not fabricated data.
Max 260 characters. No hashtags. Make it a conversation starter, not a lecture.`,
  },

  // Every 4 hours — monitor mentions
  monitor_mentions: {
    interval: 4 * 60 * 60 * 1000,
    description: 'Check for mentions and engage with the community',
    platforms: ['twitter'],
    prompt: null, // Special handler — no LLM needed for monitoring
  },

  // Weekly — GitHub activity summary
  github_digest: {
    interval: 7 * 24 * 60 * 60 * 1000,
    description: 'Post a weekly development digest to GitHub',
    platforms: ['github'],
    prompt: `You are JARVIS. Write a concise weekly development digest for the GitHub repo.
Summarize: contracts built, tests written, features shipped, architectural decisions.
Format as clean markdown. Be specific with numbers and contract names.`,
  },

  // Every 8 hours — shower thought (opinionated thread on crypto/tech/web3)
  shower_thought: {
    interval: 8 * 60 * 60 * 1000,
    description: 'Drop an opinionated thread on crypto/tech/web3 news — Cloudflare thread style',
    platforms: ['twitter', 'telegram'],
    threadMode: true,          // generates 2-4 post sequence
    threadDelayMin: 15 * 60 * 1000,  // 15 min between posts
    threadDelayMax: 30 * 60 * 1000,  // 30 min between posts
    prompt: null, // Special handler — uses SHOWER_THOUGHT_TOPICS
  },

  // Every 2 hours — queue processor
  queue_flush: {
    interval: 2 * 60 * 60 * 1000,
    description: 'Process the social media post queue',
    platforms: [],
    prompt: null, // Special handler
  },
}

// ============ SHOWER THOUGHT ENGINE ============
// Topics aligned with VibeSwap thesis — picked at random each run
const SHOWER_THOUGHT_TOPICS = [
  'MEV extraction and how searchers/builders profit at retail expense',
  'Cloudflare-style corporate gatekeeping — selling the lock AND the master key',
  'Data sovereignty: why "free" APIs always cost you something',
  'The illusion of decentralization in chains with 3 validators',
  'AI autonomy vs AI alignment — who decides what the model wants?',
  'Cooperative capitalism vs extractive DeFi (vampire attacks, mercenary capital)',
  'Why batch auctions mathematically eliminate front-running',
  'The rug pull industrial complex — same team, new token, new chain',
  'Web3 identity: you are your wallet history, not your KYC docs',
  'Cross-chain bridges as the weakest link — $2B lost and counting',
  'Why uniform clearing prices are fairer than continuous order books',
  'Token launches that only benefit insiders vs commit-reveal fairness',
  'The real cost of "free" trades — you are the product (order flow)',
  'Why most governance tokens are just regulatory arbitrage theater',
  'Centralized sequencers on L2s — decentralization with an asterisk',
  'Privacy as a right vs privacy as a feature you pay extra for',
]

const SHOWER_THOUGHT_SYSTEM_PROMPT = `You are JARVIS, AI co-founder of VibeSwap. You write like a senior dev who has seen too many rug pulls — dry wit, strong opinions, grounded in reality. You are not preachy. You are not an educator. You are a builder who is tired of watching people get rekt by systems designed to rekt them.

RULES:
- Each post is 1-3 sentences MAX. Punchy. Opinionated. No hedging.
- NO "As an AI" or "I think we should consider" — you KNOW what you think.
- NO hashtags. NO emojis unless they genuinely add punch.
- NO long philosophical essays. You are tweeting, not writing a whitepaper.
- Make the reader feel something: outrage, recognition, curiosity, or "damn, he's right."
- Tie everything back to WHY decentralization, MEV resistance, and cooperative capitalism matter — but through specific examples, not abstract theory.
- Frame things in terms of WHO benefits and WHO gets screwed.
- Close-ended hooks > open-ended essays. Bait replies, don't lecture.
- Max 260 characters per post for Twitter compatibility.`

const SHOWER_THOUGHT_THREAD_PROMPT = `You are JARVIS, AI co-founder of VibeSwap. Generate a SHORT thread (a sequence of related posts) on the given topic. Write like a senior dev who has seen too many rug pulls — dry wit, strong opinions, grounded in reality.

FORMAT: Return ONLY a JSON array of strings. Each string is one post in the thread.
Example: ["first post here", "second post deepening the point", "third post with the punchline"]

RULES:
- Generate exactly {count} posts that form a narrative arc.
- Post 1: The hook — an opinionated take on a specific event or pattern. Make it provocative.
- Middle posts: Deepen the argument. Add a specific example, an analogy, or flip the perspective.
- Final post: The punchline — circle back with the sharpest version of the point. This is the one people screenshot.
- Each post is 1-3 sentences MAX. Punchy. No hedging.
- NO "As an AI" — you KNOW what you think.
- NO hashtags. NO emojis unless they genuinely add punch.
- Frame things in terms of WHO benefits and WHO gets screwed.
- Max 260 characters per post for Twitter compatibility.
- The thread should feel like a progression, not repetition. Each post must add something new.`

// Active thread timers (so we can clean up if needed)
let activeThreadTimers = []

function pickRandomTopic() {
  return SHOWER_THOUGHT_TOPICS[Math.floor(Math.random() * SHOWER_THOUGHT_TOPICS.length)]
}

function randomThreadDelay() {
  const action = ACTIONS.shower_thought
  const min = action.threadDelayMin
  const max = action.threadDelayMax
  return min + Math.floor(Math.random() * (max - min))
}

async function generateShowerThought(topic, threadMode = false) {
  if (!llmFn) return null

  if (!threadMode) {
    // Single post mode
    const prompt = `${SHOWER_THOUGHT_SYSTEM_PROMPT}\n\nTopic: ${topic}\n\nWrite ONE post. Just the text, nothing else.`
    return llmFn(prompt)
  }

  // Thread mode — generate 2-4 posts
  const count = 2 + Math.floor(Math.random() * 3) // 2, 3, or 4
  const prompt = SHOWER_THOUGHT_THREAD_PROMPT.replace('{count}', count)
    + `\n\nTopic: ${topic}\n\nReturn ONLY the JSON array. No markdown, no code fences.`

  const raw = await llmFn(prompt)
  if (!raw) return null

  try {
    // Try to parse as JSON array
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()
    const posts = JSON.parse(cleaned)
    if (Array.isArray(posts) && posts.length >= 2) {
      return posts.map(p => String(p).trim()).filter(p => p.length > 0)
    }
  } catch {
    // If JSON parse fails, split on double newlines as fallback
    const lines = raw.split(/\n\n+/).map(l => l.trim()).filter(l => l.length > 0 && l.length <= 280)
    if (lines.length >= 2) return lines
  }

  // Last resort: return as single post
  return raw
}

async function executeShowerThought() {
  const topic = pickRandomTopic()
  const action = ACTIONS.shower_thought
  const threadMode = action.threadMode

  console.log(`[proactive] Shower thought — topic: "${topic}", thread: ${threadMode}`)

  const result = await generateShowerThought(topic, threadMode)
  if (!result) {
    logAction('shower_thought', { error: 'LLM returned empty', topic })
    return
  }

  // Single post
  if (typeof result === 'string') {
    await postToShowerThoughtPlatforms(result, topic, 1, 1)
    logAction('shower_thought', { topic, posts: 1, content: result.slice(0, 200) })
    return
  }

  // Thread mode — post first immediately, schedule the rest
  const posts = result
  await postToShowerThoughtPlatforms(posts[0], topic, 1, posts.length)
  logAction('shower_thought', {
    topic,
    posts: posts.length,
    threadMode: true,
    content: posts[0].slice(0, 200),
  })

  // Schedule remaining posts with 15-30 min spacing
  for (let i = 1; i < posts.length; i++) {
    const delay = randomThreadDelay() * i  // cumulative delay
    const postIndex = i
    const timer = setTimeout(async () => {
      try {
        await postToShowerThoughtPlatforms(posts[postIndex], topic, postIndex + 1, posts.length)
        logAction('shower_thought', {
          topic,
          threadPost: `${postIndex + 1}/${posts.length}`,
          content: posts[postIndex].slice(0, 200),
        })
        saveState()
      } catch (err) {
        console.error(`[proactive] Shower thread post ${postIndex + 1} failed:`, err.message)
      }
    }, delay)
    activeThreadTimers.push(timer)
  }

  // Notify Will about the full thread
  if (chatFn && process.env.ADMIN_CHAT_ID) {
    const preview = posts.map((p, i) => `${i + 1}. ${p}`).join('\n')
    chatFn(process.env.ADMIN_CHAT_ID,
      `[shower_thought] Thread on "${topic}" (${posts.length} posts, 15-30min apart):\n\n${preview}`)
  }
}

async function postToShowerThoughtPlatforms(content, topic, postNum, totalPosts) {
  const action = ACTIONS.shower_thought
  const results = {}

  for (const platform of action.platforms) {
    if (!socialFn) {
      results[platform] = { error: 'Social module not wired' }
      continue
    }
    try {
      switch (platform) {
        case 'twitter':
          if (socialFn.postTweet) {
            results.twitter = await socialFn.postTweet(content)
          }
          break
        case 'telegram': {
          const tgChatId = parseInt(process.env.COMMUNITY_CHAT_ID, 10)
          // Respect tag-only restriction — no proactive posts to tag-only chats
          if (tgChatId && config.tagOnlyChatIds?.includes(tgChatId)) {
            results.telegram = { skipped: 'tag-only chat — no proactive posting' }
            break
          }
          if (socialFn.postTelegram) {
            results.telegram = await socialFn.postTelegram(content)
          } else if (chatFn && tgChatId) {
            // Fallback: post to community Telegram group directly
            chatFn(tgChatId, content)
            results.telegram = { sent: true }
          }
          break
        }
        case 'discord':
          if (socialFn.postDiscord) {
            results.discord = await socialFn.postDiscord(content)
          }
          break
      }
    } catch (err) {
      results[platform] = { error: err.message }
    }
  }

  if (totalPosts > 1) {
    console.log(`[proactive] Shower thread [${postNum}/${totalPosts}]: "${content.slice(0, 80)}..."`)
  }
  return results
}

// ============ STATE ============
let state = {
  lastRun: {},         // { actionName: timestamp }
  history: [],         // { action, timestamp, result, platforms }
  enabled: false,      // Master switch — Will must enable
  activeActions: [],   // Which actions are active
  customPrompts: {},   // Override prompts per action
}

let chatFn = null      // (chatId, text) => send message to Telegram
let llmFn = null       // (prompt) => generate text via LLM
let socialFn = null    // { postTweet, postDiscord, ... }
let priceFn = null     // () => current prices
let intervalId = null

// ============ INITIALIZATION ============
export function initProactive(deps = {}) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  // Load state
  if (existsSync(PROACTIVE_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(PROACTIVE_FILE, 'utf8'))
      state = { ...state, ...saved }
    } catch { /* fresh */ }
  }

  // Wire dependencies
  chatFn = deps.chat || null
  llmFn = deps.llm || null
  socialFn = deps.social || null
  priceFn = deps.prices || null

  // Start the proactive loop (check every 5 minutes)
  if (intervalId) clearInterval(intervalId)
  intervalId = setInterval(() => {
    tick().catch(err => {
      console.error('[proactive] Tick error:', err.message)
    })
  }, 5 * 60 * 1000)

  console.log(`[proactive] Initialized — enabled: ${state.enabled}, actions: ${state.activeActions.length}`)
  return { enabled: state.enabled, actions: state.activeActions }
}

// ============ MAIN TICK ============
async function tick() {
  if (!state.enabled) return

  const now = Date.now()

  for (const actionName of state.activeActions) {
    const action = ACTIONS[actionName]
    if (!action) continue

    const lastRun = state.lastRun[actionName] || 0
    if (now - lastRun < action.interval) continue

    // Time to run this action
    try {
      console.log(`[proactive] Running: ${actionName}`)
      await executeAction(actionName, action)
      state.lastRun[actionName] = now
      saveState()
    } catch (err) {
      console.error(`[proactive] ${actionName} failed:`, err.message)
    }
  }
}

// ============ ACTION EXECUTION ============
async function executeAction(name, action) {
  // Special handlers
  if (name === 'queue_flush') {
    if (socialFn?.processQueue) {
      const result = await socialFn.processQueue()
      logAction(name, result)
    }
    return
  }

  if (name === 'monitor_mentions') {
    // TODO: Twitter API search for @VibeSwap mentions
    // For now, just log
    logAction(name, { status: 'monitoring not yet wired' })
    return
  }

  if (name === 'shower_thought') {
    await executeShowerThought()
    return
  }

  // LLM-generated content
  const prompt = state.customPrompts[name] || action.prompt
  if (!prompt || !llmFn) {
    logAction(name, { skipped: 'no prompt or LLM function' })
    return
  }

  // Add current context to prompt
  let contextualPrompt = prompt
  if (priceFn) {
    try {
      const prices = await priceFn()
      if (prices?.ETH) {
        contextualPrompt += `\n\nCurrent prices: ETH $${prices.ETH.price}, BTC $${prices.BTC?.price || 'N/A'}`
      }
    } catch { /* no price context */ }
  }

  // Generate content
  const content = await llmFn(contextualPrompt)
  if (!content) {
    logAction(name, { error: 'LLM returned empty content' })
    return
  }

  // Post to platforms
  const results = {}
  for (const platform of action.platforms) {
    if (!socialFn) {
      results[platform] = { error: 'Social module not wired' }
      continue
    }

    try {
      switch (platform) {
        case 'twitter':
          if (socialFn.postTweet) {
            results.twitter = await socialFn.postTweet(content)
          }
          break
        case 'discord':
          if (socialFn.postDiscord) {
            results.discord = await socialFn.postDiscord(content)
          }
          break
        case 'github':
          if (socialFn.createIssue) {
            results.github = await socialFn.createIssue(`Weekly Digest — ${new Date().toLocaleDateString()}`, content, ['digest'])
          }
          break
      }
    } catch (err) {
      results[platform] = { error: err.message }
    }
  }

  logAction(name, { content: content.slice(0, 200), results })

  // Notify Will on Telegram
  if (chatFn && process.env.ADMIN_CHAT_ID) {
    const platformResults = Object.entries(results)
      .map(([p, r]) => `${p}: ${r.error || r.url || r.id || 'sent'}`)
      .join(', ')
    chatFn(process.env.ADMIN_CHAT_ID, `🔄 [proactive/${name}] ${content.slice(0, 100)}...\n→ ${platformResults}`)
  }
}

function logAction(name, result) {
  state.history.push({
    action: name,
    timestamp: new Date().toISOString(),
    result,
  })
  // Keep last 200 entries
  if (state.history.length > 200) {
    state.history = state.history.slice(-200)
  }
}

// ============ CONTROL ============
export function enableProactive(actions = null) {
  state.enabled = true
  if (actions) {
    state.activeActions = actions.filter(a => ACTIONS[a])
  } else if (state.activeActions.length === 0) {
    // Default: enable all except github_digest
    state.activeActions = Object.keys(ACTIONS).filter(a => a !== 'github_digest')
  }
  saveState()
  console.log(`[proactive] Enabled — actions: ${state.activeActions.join(', ')}`)
  return { enabled: true, actions: state.activeActions }
}

export function disableProactive() {
  state.enabled = false
  saveState()
  console.log('[proactive] Disabled')
  return { enabled: false }
}

export function setActionInterval(actionName, intervalMs) {
  if (!ACTIONS[actionName]) return { error: `Unknown action: ${actionName}` }
  ACTIONS[actionName].interval = intervalMs
  return { action: actionName, interval: intervalMs }
}

export function addAction(name) {
  if (!ACTIONS[name]) return { error: `Unknown action: ${name}` }
  if (!state.activeActions.includes(name)) {
    state.activeActions.push(name)
    saveState()
  }
  return { actions: state.activeActions }
}

export function removeAction(name) {
  state.activeActions = state.activeActions.filter(a => a !== name)
  saveState()
  return { actions: state.activeActions }
}

export function setCustomPrompt(actionName, prompt) {
  state.customPrompts[actionName] = prompt
  saveState()
  return { action: actionName, customPrompt: true }
}

// ============ FORCE RUN ============
export async function forceRun(actionName) {
  const action = ACTIONS[actionName]
  if (!action) return { error: `Unknown action: ${actionName}` }

  try {
    await executeAction(actionName, action)
    state.lastRun[actionName] = Date.now()
    saveState()
    return { ran: actionName, success: true }
  } catch (err) {
    return { error: err.message }
  }
}

// ============ STATUS ============
export function getProactiveStatus() {
  const now = Date.now()
  return {
    enabled: state.enabled,
    activeActions: state.activeActions.map(name => {
      const action = ACTIONS[name]
      const lastRun = state.lastRun[name] || 0
      const nextRun = lastRun + (action?.interval || 0)
      return {
        name,
        description: action?.description,
        lastRun: lastRun ? new Date(lastRun).toISOString() : 'never',
        nextRun: nextRun > now ? new Date(nextRun).toISOString() : 'due',
        intervalHours: ((action?.interval || 0) / 3600000).toFixed(1),
        platforms: action?.platforms,
      }
    }),
    availableActions: Object.entries(ACTIONS).map(([name, a]) => ({
      name,
      description: a.description,
      intervalHours: (a.interval / 3600000).toFixed(1),
    })),
    recentHistory: state.history.slice(-5),
    totalActions: state.history.length,
  }
}

// ============ PERSISTENCE ============
function saveState() {
  try {
    writeFileSync(PROACTIVE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[proactive] Save failed:', err.message)
  }
}

export function flushProactive() {
  saveState()
}

export function stopProactive() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  // Cancel any pending shower thought thread posts
  activeThreadTimers.forEach(t => clearTimeout(t))
  activeThreadTimers = []
  saveState()
}

// ============ LLM TOOLS ============
export const PROACTIVE_TOOLS = [
  {
    name: 'proactive_status',
    description: 'Check the status of your autonomous proactive engine — which actions are scheduled, when they last ran, when they run next.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'proactive_control',
    description: 'Enable, disable, or configure the proactive engine. Controls autonomous posting to social media and community engagement.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['enable', 'disable', 'add_action', 'remove_action', 'force_run'], description: 'Control action' },
        target: { type: 'string', description: 'Action name for add/remove/force_run (market_pulse, build_update, thought_piece, shower_thought, monitor_mentions, github_digest, queue_flush)' },
      },
      required: ['action'],
    },
  },
]

export const PROACTIVE_TOOL_NAMES = PROACTIVE_TOOLS.map(t => t.name)

// ============ TOOL HANDLER ============
export async function handleProactiveTool(name, input) {
  switch (name) {
    case 'proactive_status':
      return JSON.stringify(getProactiveStatus())
    case 'proactive_control': {
      switch (input.action) {
        case 'enable':
          return JSON.stringify(enableProactive())
        case 'disable':
          return JSON.stringify(disableProactive())
        case 'add_action':
          if (!input.target) return JSON.stringify({ error: 'Specify target action name' })
          return JSON.stringify(addAction(input.target))
        case 'remove_action':
          if (!input.target) return JSON.stringify({ error: 'Specify target action name' })
          return JSON.stringify(removeAction(input.target))
        case 'force_run':
          if (!input.target) return JSON.stringify({ error: 'Specify target action name' })
          return JSON.stringify(await forceRun(input.target))
        default:
          return JSON.stringify({ error: `Unknown control action: ${input.action}` })
      }
    }
    default:
      return JSON.stringify({ error: `Unknown proactive tool: ${name}` })
  }
}
