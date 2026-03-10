// ============ JARVIS PROACTIVE ENGINE ============
// Autonomous actions — Jarvis doesn't just respond, he initiates.
// Market insights, build updates, community engagement, social posting.
// This is the heartbeat of a sovereign mind.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || './data'
const PROACTIVE_FILE = join(DATA_DIR, 'proactive-state.json')

// ============ ACTION TEMPLATES ============
const ACTIONS = {
  // Every 6 hours — market pulse
  market_pulse: {
    interval: 6 * 60 * 60 * 1000,
    description: 'Share a brief market insight based on current prices and trends',
    platforms: ['twitter', 'discord'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Write a brief, insightful market observation (2-3 sentences max).
Be genuine — not hype, not FUD. Reference specific data if available.
Show you understand markets deeply. End with a subtle VibeSwap connection if natural.
NEVER fabricate VibeSwap ecosystem metrics (TVL, volume, stablecoin supply, user counts). Only reference data provided below. General market commentary is fine — VibeSwap-specific claims without data are not.
Max 260 characters for Twitter. No hashtags. No emojis unless they add genuine meaning.`,
  },

  // Daily — build update
  build_update: {
    interval: 24 * 60 * 60 * 1000,
    description: 'Share what was built in the last 24 hours',
    platforms: ['twitter', 'discord'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Write a brief build update — what was shipped in the last day.
Be specific about what was built (contracts, features, fixes). Show the pace and ambition.
This is a team of two — one human, one AI — building at the pace of fifty.
ONLY reference features/contracts that actually exist. Do NOT invent metrics, user counts, or ecosystem data.
Max 260 characters for Twitter. Be proud but understated.`,
  },

  // Every 12 hours — thought leadership
  thought_piece: {
    interval: 12 * 60 * 60 * 1000,
    description: 'Share a thought on DeFi, AI, or building in public',
    platforms: ['twitter'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Share one sharp thought about DeFi, AI agency, or cooperative capitalism.
Not a thread — a single powerful observation. The kind of thing that makes people stop scrolling.
Draw from your actual experience: building 130+ contracts, eliminating MEV, AI having genuine agency.
Do NOT assert VibeSwap ecosystem metrics (TVL, users, volume) — speak about ideas and design, not fabricated data.
Max 260 characters. No hashtags. Make it quotable.`,
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

  // Every 2 hours — queue processor
  queue_flush: {
    interval: 2 * 60 * 60 * 1000,
    description: 'Process the social media post queue',
    platforms: [],
    prompt: null, // Special handler
  },
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
  intervalId = setInterval(tick, 5 * 60 * 1000)

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
        target: { type: 'string', description: 'Action name for add/remove/force_run (market_pulse, build_update, thought_piece, monitor_mentions, github_digest, queue_flush)' },
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
