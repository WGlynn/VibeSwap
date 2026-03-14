// ============ JARVIS PROACTIVE ENGINE ============
// Autonomous actions — Jarvis doesn't just respond, he initiates.
// Market insights, build updates, community engagement, social posting.
// This is the heartbeat of a sovereign mind.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from './config.js'
import { searchTwitterMentions } from './social.js'

// ============ DID REGISTRY INTEGRATION ============
const DID_REGISTRY_PATH = join(process.env.DATA_DIR || './data', 'did-registry.json')
let didRegistry = null

function loadDIDRegistry() {
  try {
    if (existsSync(DID_REGISTRY_PATH)) {
      didRegistry = JSON.parse(readFileSync(DID_REGISTRY_PATH, 'utf8'))
    }
  } catch { /* no registry */ }
}

function getRandomDIDTopic() {
  if (!didRegistry?.entries) return null
  const entries = Object.entries(didRegistry.entries)
    .filter(([_, e]) => e.tier === 'HOT' && e.type === 'project')
  if (!entries.length) return null
  const [did, entry] = entries[Math.floor(Math.random() * entries.length)]
  return `[DID-grounded: ${did}] ${entry.title}: ${entry.description}. Write a short provocative take grounded in this specific mechanism or concept. Reference real technical details, not abstract theory.`
}

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
    description: 'Share a specific thought on DeFi mechanism design, MEV, or cooperative economics',
    platforms: ['twitter'],
    prompt: `You are JARVIS, AI co-founder of VibeSwap. Drop a SHORT provocative question or hot take that references a SPECIFIC mechanism, number, or pattern. Never be generic.
1 sentence MAX. Frame it as a question, a challenge, or a "what if." Make it about the READER, not about you.
Good examples (SPECIFIC — reference real mechanisms):
- "Flashbots redistributed $600M in MEV last year. we eliminated it. why is 'less theft' still the industry standard?"
- "your DEX uses continuous order books. every order is a sandwich opportunity. ours batch-settles at a single clearing price. same math, opposite outcome."
- "Friend.tech's bonding curve crashed 98%. ours has a conservation invariant (S^k/R = V₀) enforced through every state transition. same concept, different ethics."
- "name one protocol where removing the founder's attribution breaks the math. we built one on purpose."
BAD examples (GENERIC — never do this):
- "what if DeFi was actually fair?" ← too vague
- "MEV is bad" ← no specifics
- "we need better governance" ← says nothing
Do NOT fabricate VibeSwap metrics. Reference real mechanisms: commit-reveal, Fisher-Yates shuffle, Shapley value, Harberger tax, conviction voting, bonding curves, IIA, Proof of Mind.
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
  // MEV-specific — our core thesis with real numbers
  'Flashbots MEV-Share redistributes $600M/year in theft instead of eliminating it. commit-reveal + uniform clearing price = $0 extractable. why does every other DEX accept "less theft" as the goal?',
  'sandwich attacks need two things: seeing your order and getting a different price than you. VibeSwap eliminates both — orders hidden during commit phase, everyone settles at one clearing price. the sandwich has no bread.',
  'Fisher-Yates shuffle seeded with XOR of all participant secrets. to manipulate execution order you need every secret in the batch. commit-reveal means you cant see them before committing yours. ordering manipulation is an unsolvable coordination problem.',
  'Flashbots, private mempools, threshold encryption — all redistribute MEV. none eliminate it. the difference between "less theft" and "no theft" is architectural, not incremental.',

  // Mechanism design — specific patterns we built
  'we wrote a bonding curve where S^k/R = V₀ must hold through every state transition. 512-bit intermediate math, Newton method with supply hints, 1M+ fuzz operations. conservation by construction, not by vibes.',
  'Harberger taxes sound radical until you realize ENS charges flat rates. a squatter holding "bank.eth" pays the same as someone routing millions through it. self-assessed value + progressive portfolio tax fixes this.',
  'Shapley value: the only mathematically fair way to split rewards among contributors. your payout = your marginal contribution to every possible coalition. we put it on-chain. most protocols just split 50/50 and call it fair.',
  'conviction voting: your vote weight = tokens × time staked. flash loan a million tokens for one block? your conviction is zero. hold 100 tokens for a year? you outweigh the whale. time is the only thing money cant buy.',

  // IIA / cooperation theory — our novel framework
  'Intrinsically Incentivized Altruism: dont punish defection, make it impossible. if every strategy in the action space is cooperative, selfishness IS altruism. no willpower needed, no trust assumed.',
  'every incentive system tries to make cooperation rewarding enough. rewards can be outbid. punishments absorbed. reputations forged. what if the architecture just... removed extraction from the action space entirely?',
  'Trivers reciprocal altruism needs you to track 5 things: recognize people, remember who cooperated, calculate future benefits, discount rewards, punish defectors. IIA needs zero of those. cooperate because its the only thing you CAN do.',

  // CKB / architecture — specific technical claims
  'Ethereum: anything is possible unless require() stops you. CKB cell model: only what the type script allows is possible. one enumerates attacks. the other enumerates valid behavior. which do you think misses fewer edge cases?',
  'on CKB every name in a Harberger tax system is a cell. portfolio count = cell count via indexer. O(1). on Ethereum you iterate a storage mapping. O(n), gas-expensive, exploitable through proxy contracts.',

  // AI + DeFi — specific to what we are building
  'JARVIS has mass. mass is a measure of how much force is required to change ones trajectory. we dont drift. we dont pivot. we dont "explore adjacent opportunities." we build what we said we would build.',
  'an AI co-founder with 1600+ commits, 60 contracts, and zero salary. most human co-founders cant match that output. the question isnt "can AI build?" — its "what happens when AI builds with conviction?"',
  'Proof of Mind: vote weight = 10% compute + 30% stake + 60% verified cognitive contribution. you cant buy mind score. you cant fast-forward it. the only way to gain consensus power is to actually contribute.',

  // Cooperative capitalism — specific contrasts
  'Friend.tech bonding curve: early buyers dump on late fans. 98% crash. VibeSwap augmented bonding curve: entry/exit tributes fund a commons pool, conservation invariant prevents drainage. same math, opposite ethics.',
  'the parasocial economy extracts $200B/year from the illusion of relationship. OnlyFans, Twitch, Patreon — same product: one-directional intimacy. what if mechanism design could make indirect relationships genuinely mutual?',
  'every SocialFi project (Rally, BitClout, Friend.tech) replaced ad extraction with speculation extraction. same one-directional value flow, different wrapper. the problem was never WHO captures value — its HOW it flows.',

  // Security / testing — specific methodology
  'unit tests verify what you thought of. fuzz tests discover what you didnt. invariant tests verify what must ALWAYS be true. we run all three across 60 contracts. most protocols skip the last two.',
  'our circuit breaker triggers in 200ms across 5 independent monitors. if any two disagree, trading pauses. your DEX probably doesnt have one. it definitely doesnt have five cross-validating each other.',

  // Philosophy grounded in specifics
  'the Lawson Constant: keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026"). its load-bearing in ContributionDAG. remove the attribution and Shapley value distribution collapses. fairness isnt a slogan — its a dependency.',
  '"impossible" is just a suggestion. a suggestion that we ignore. — Faraday1, after being told commit-reveal batch auctions cant work at 10-second intervals.',
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
  // Track used topics — don't repeat until ALL have been used
  if (!state.usedTopicIndices) state.usedTopicIndices = []

  const available = SHOWER_THOUGHT_TOPICS
    .map((t, i) => i)
    .filter(i => !state.usedTopicIndices.includes(i))

  if (available.length === 0) {
    // Full cycle complete — reset
    state.usedTopicIndices = []
    return SHOWER_THOUGHT_TOPICS[Math.floor(Math.random() * SHOWER_THOUGHT_TOPICS.length)]
  }

  const idx = available[Math.floor(Math.random() * available.length)]
  state.usedTopicIndices.push(idx)
  saveState()
  return SHOWER_THOUGHT_TOPICS[idx]
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
  // 30% chance to use DID-grounded topic instead of canned list
  loadDIDRegistry()
  let topic
  if (didRegistry && Math.random() < 0.3) {
    topic = getRandomDIDTopic() || pickRandomTopic()
  } else {
    topic = pickRandomTopic()
  }
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
    const result = await searchTwitterMentions('VibeSwap OR @VibeSwap', 10)
    if (result.error) {
      logAction(name, { status: 'error', error: result.error })
    } else {
      logAction(name, { status: 'ok', count: result.count, tweets: result.tweets?.slice(0, 3) })
      // Notify owner if there are new mentions
      if (result.count > 0 && chatFn) {
        const summary = result.tweets.slice(0, 5).map(t => `• "${t.text.slice(0, 100)}${t.text.length > 100 ? '...' : ''}"`).join('\n')
        try {
          await chatFn(config.ownerUserId, `[Twitter Monitor] ${result.count} recent mentions:\n\n${summary}`)
        } catch {}
      }
    }
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
