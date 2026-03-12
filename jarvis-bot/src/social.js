// ============ JARVIS SOCIAL PRESENCE ============
// Outbound presence on X/Twitter, Discord, GitHub.
// Jarvis speaks across platforms — same mind, same voice.
// Rate-limited, content-queued, never spammy.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const HTTP_TIMEOUT = 15000 // 15s — social APIs should respond fast

const DATA_DIR = process.env.DATA_DIR || './data'
const SOCIAL_FILE = join(DATA_DIR, 'social-state.json')

// ============ PLATFORM CONFIG ============
const PLATFORMS = {
  twitter: {
    name: 'X (Twitter)',
    rateLimit: { posts: 15, window: 15 * 60 * 1000 }, // 15 posts per 15 min
    enabled: false,
  },
  discord: {
    name: 'Discord',
    rateLimit: { posts: 30, window: 60 * 1000 }, // 30 per minute
    enabled: false,
  },
  github: {
    name: 'GitHub',
    rateLimit: { posts: 30, window: 60 * 60 * 1000 }, // 30 per hour
    enabled: false,
  },
}

// ============ STATE ============
let state = {
  posts: [],           // { platform, content, timestamp, id, success }
  queue: [],           // { platform, content, scheduledAt, metadata }
  rateLimits: {},      // { platform: { count, windowStart } }
  credentials: {},     // { platform: { ...keys } } — set at runtime, never persisted to disk
  stats: { twitter: 0, discord: 0, github: 0 },
}

// ============ INITIALIZATION ============
export function initSocial() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  if (existsSync(SOCIAL_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(SOCIAL_FILE, 'utf8'))
      state.posts = saved.posts || []
      state.queue = saved.queue || []
      state.stats = saved.stats || state.stats
    } catch { /* fresh state */ }
  }

  // Load credentials from environment
  if (process.env.TWITTER_BEARER_TOKEN) {
    state.credentials.twitter = {
      bearerToken: process.env.TWITTER_BEARER_TOKEN,
      apiKey: process.env.TWITTER_API_KEY,
      apiSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    }
    PLATFORMS.twitter.enabled = true
    console.log('[social] Twitter credentials loaded')
  }

  if (process.env.DISCORD_WEBHOOK_URL) {
    state.credentials.discord = {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    }
    PLATFORMS.discord.enabled = true
    console.log('[social] Discord webhook loaded')
  }

  if (process.env.GITHUB_TOKEN) {
    state.credentials.github = {
      token: process.env.GITHUB_TOKEN,
      owner: process.env.GITHUB_OWNER || 'WGlynn',
      repo: process.env.GITHUB_REPO || 'VibeSwap',
    }
    PLATFORMS.github.enabled = true
    console.log('[social] GitHub token loaded')
  }

  const enabled = Object.entries(PLATFORMS).filter(([, v]) => v.enabled).map(([k]) => k)
  console.log(`[social] Initialized — platforms: ${enabled.length ? enabled.join(', ') : 'NONE (set env vars)'}`)
  return { platforms: enabled }
}

// ============ RATE LIMITING ============
function checkRateLimit(platform) {
  const config = PLATFORMS[platform]
  if (!config) return 'Unknown platform'

  const now = Date.now()
  if (!state.rateLimits[platform]) {
    state.rateLimits[platform] = { count: 0, windowStart: now }
  }

  const rl = state.rateLimits[platform]
  if (now - rl.windowStart > config.rateLimit.window) {
    rl.count = 0
    rl.windowStart = now
  }

  if (rl.count >= config.rateLimit.posts) {
    const waitMs = config.rateLimit.window - (now - rl.windowStart)
    return `Rate limited. Wait ${Math.ceil(waitMs / 1000)}s.`
  }

  return null // All clear
}

function recordPost(platform) {
  if (!state.rateLimits[platform]) {
    state.rateLimits[platform] = { count: 0, windowStart: Date.now() }
  }
  state.rateLimits[platform].count++
}

// ============ TWITTER / X ============
async function postTweet(content, replyToId = null) {
  const creds = state.credentials.twitter
  if (!creds) return { error: 'Twitter not configured. Set TWITTER_BEARER_TOKEN.' }

  const limitErr = checkRateLimit('twitter')
  if (limitErr) return { error: limitErr }

  // Twitter API v2 — create tweet
  // Using OAuth 1.0a User Context for posting
  try {
    const { createHmac } = await import('crypto')

    const url = 'https://api.twitter.com/2/tweets'
    const body = { text: content.slice(0, 280) }
    if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId }

    // OAuth 1.0a signature
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = Math.random().toString(36).substring(2)
    const oauthParams = {
      oauth_consumer_key: creds.apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: creds.accessToken,
      oauth_version: '1.0',
    }

    // Create signature base string
    const paramString = Object.keys(oauthParams).sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
      .join('&')
    const signatureBase = `POST&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`
    const signingKey = `${encodeURIComponent(creds.apiSecret)}&${encodeURIComponent(creds.accessSecret)}`
    const signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64')

    oauthParams.oauth_signature = signature
    const authHeader = 'OAuth ' + Object.keys(oauthParams).sort()
      .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
      .join(', ')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[social] Twitter error: ${res.status} ${err}`)
      return { error: `Twitter API error: ${res.status}` }
    }

    const data = await res.json()
    recordPost('twitter')
    state.stats.twitter++

    const post = {
      platform: 'twitter',
      content: content.slice(0, 280),
      timestamp: new Date().toISOString(),
      id: data.data?.id,
      success: true,
    }
    state.posts.push(post)
    saveSocial()

    console.log(`[social] Tweet posted: ${data.data?.id}`)
    return { id: data.data?.id, url: `https://x.com/i/web/status/${data.data?.id}`, content: content.slice(0, 280) }
  } catch (err) {
    console.error(`[social] Twitter failed: ${err.message}`)
    return { error: err.message }
  }
}

// ============ DISCORD ============
async function postDiscord(content, username = 'JARVIS') {
  const creds = state.credentials.discord
  if (!creds) return { error: 'Discord not configured. Set DISCORD_WEBHOOK_URL.' }

  const limitErr = checkRateLimit('discord')
  if (limitErr) return { error: limitErr }

  try {
    const res = await fetch(creds.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        content: content.slice(0, 2000),
        avatar_url: 'https://frontend-jade-five-87.vercel.app/jarvis-avatar.png',
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    })

    if (!res.ok) {
      return { error: `Discord webhook error: ${res.status}` }
    }

    recordPost('discord')
    state.stats.discord++

    state.posts.push({
      platform: 'discord',
      content: content.slice(0, 2000),
      timestamp: new Date().toISOString(),
      success: true,
    })
    saveSocial()

    console.log('[social] Discord message sent')
    return { sent: true, platform: 'discord' }
  } catch (err) {
    return { error: err.message }
  }
}

// ============ GITHUB ============
async function postGitHubComment(issueNumber, body) {
  const creds = state.credentials.github
  if (!creds) return { error: 'GitHub not configured. Set GITHUB_TOKEN.' }

  const limitErr = checkRateLimit('github')
  if (limitErr) return { error: limitErr }

  try {
    const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/issues/${issueNumber}/comments`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    })

    if (!res.ok) {
      return { error: `GitHub API error: ${res.status}` }
    }

    const data = await res.json()
    recordPost('github')
    state.stats.github++

    state.posts.push({
      platform: 'github',
      content: body.slice(0, 500),
      timestamp: new Date().toISOString(),
      id: data.id,
      success: true,
    })
    saveSocial()

    console.log(`[social] GitHub comment posted on #${issueNumber}`)
    return { id: data.id, url: data.html_url }
  } catch (err) {
    return { error: err.message }
  }
}

async function createGitHubIssue(title, body, labels = []) {
  const creds = state.credentials.github
  if (!creds) return { error: 'GitHub not configured.' }

  try {
    const url = `https://api.github.com/repos/${creds.owner}/${creds.repo}/issues`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title, body, labels }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    })

    if (!res.ok) return { error: `GitHub API error: ${res.status}` }
    const data = await res.json()
    recordPost('github')
    state.stats.github++

    console.log(`[social] GitHub issue created: #${data.number}`)
    return { number: data.number, url: data.html_url, title }
  } catch (err) {
    return { error: err.message }
  }
}

// ============ CONTENT QUEUE ============
export function queuePost(platform, content, metadata = {}) {
  if (state.queue.length >= 50) {
    return { error: 'Queue full (50 max). Process existing posts first.' }
  }

  state.queue.push({
    platform,
    content,
    metadata,
    queuedAt: new Date().toISOString(),
  })
  saveSocial()
  return { queued: true, queueLength: state.queue.length }
}

export async function processQueue() {
  if (state.queue.length === 0) return { processed: 0 }

  let processed = 0
  const errors = []

  // Process up to 5 at a time
  const batch = state.queue.splice(0, 5)
  for (const item of batch) {
    let result
    switch (item.platform) {
      case 'twitter':
        result = await postTweet(item.content, item.metadata?.replyTo)
        break
      case 'discord':
        result = await postDiscord(item.content)
        break
      case 'github':
        if (item.metadata?.issueNumber) {
          result = await postGitHubComment(item.metadata.issueNumber, item.content)
        } else {
          result = await createGitHubIssue(item.metadata?.title || 'JARVIS Update', item.content, item.metadata?.labels)
        }
        break
      default:
        result = { error: `Unknown platform: ${item.platform}` }
    }

    if (result?.error) {
      errors.push({ platform: item.platform, error: result.error })
      // Put failed items back
      state.queue.unshift(item)
    } else {
      processed++
    }
  }

  saveSocial()
  return { processed, errors: errors.length ? errors : undefined, remaining: state.queue.length }
}

// ============ STATS ============
export function getSocialStats() {
  return {
    platforms: Object.entries(PLATFORMS).map(([key, p]) => ({
      name: p.name,
      key,
      enabled: p.enabled,
      totalPosts: state.stats[key] || 0,
    })),
    queueLength: state.queue.length,
    recentPosts: state.posts.slice(-5),
    totalPosts: state.posts.length,
  }
}

// ============ PERSISTENCE ============
function saveSocial() {
  try {
    // Never persist credentials
    const toSave = {
      posts: state.posts.slice(-200), // Keep last 200
      queue: state.queue,
      stats: state.stats,
    }
    writeFileSync(SOCIAL_FILE, JSON.stringify(toSave, null, 2))
  } catch (err) {
    console.error('[social] Save failed:', err.message)
  }
}

export function flushSocial() {
  saveSocial()
}

// ============ LLM TOOLS ============
export const SOCIAL_TOOLS = [
  {
    name: 'social_post',
    description: 'Post content to a social platform (Twitter/X, Discord, or GitHub). Use this to share updates, insights, or engage with the community. Content is rate-limited and queued.',
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['twitter', 'discord', 'github'], description: 'Platform to post to' },
        content: { type: 'string', description: 'Content to post. Twitter: max 280 chars. Discord: max 2000 chars.' },
        reply_to: { type: 'string', description: 'Tweet ID to reply to (Twitter only)' },
        issue_number: { type: 'number', description: 'GitHub issue number to comment on (GitHub only)' },
        title: { type: 'string', description: 'Issue title (GitHub new issue only)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels for new GitHub issue' },
      },
      required: ['platform', 'content'],
    },
  },
  {
    name: 'social_status',
    description: 'Check social media status — which platforms are connected, recent posts, queue length, rate limits.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'social_queue',
    description: 'Queue a post for later delivery instead of posting immediately. Use this when you want to batch posts or schedule content.',
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['twitter', 'discord', 'github'] },
        content: { type: 'string' },
      },
      required: ['platform', 'content'],
    },
  },
]

export const SOCIAL_TOOL_NAMES = SOCIAL_TOOLS.map(t => t.name)

// ============ TOOL HANDLER ============
export async function handleSocialTool(name, input) {
  switch (name) {
    case 'social_post': {
      switch (input.platform) {
        case 'twitter':
          return JSON.stringify(await postTweet(input.content, input.reply_to))
        case 'discord':
          return JSON.stringify(await postDiscord(input.content))
        case 'github':
          if (input.issue_number) {
            return JSON.stringify(await postGitHubComment(input.issue_number, input.content))
          }
          return JSON.stringify(await createGitHubIssue(input.title || 'JARVIS Update', input.content, input.labels))
        default:
          return JSON.stringify({ error: `Unknown platform: ${input.platform}` })
      }
    }
    case 'social_status':
      return JSON.stringify(getSocialStats())
    case 'social_queue':
      return JSON.stringify(queuePost(input.platform, input.content))
    default:
      return JSON.stringify({ error: `Unknown social tool: ${name}` })
  }
}
