// ============ Nervos Talks Integration (Discourse API) ============
//
// Autonomous posting and comment monitoring for talk.nervos.org
// Uses Discourse API v1 — requires API key + username
//
// Environment variables:
//   NERVOS_TALKS_API_KEY    — API key (generated in user preferences → API)
//   NERVOS_TALKS_USERNAME   — Username to post as
//   NERVOS_TALKS_BASE_URL   — Base URL (default: https://talk.nervos.org)
//   NERVOS_TALKS_CATEGORY   — Default category ID for posts
//
// Commands:
//   /nervos-post <index>    — Post a specific article from the pipeline
//   /nervos-status          — Show posting schedule and recent activity
//   /nervos-replies         — Check for new replies to our posts
// ============

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || './data'
const STATE_FILE = join(DATA_DIR, 'nervos-talks-state.json')
const BASE_URL = process.env.NERVOS_TALKS_BASE_URL || 'https://talk.nervos.org'
const API_KEY = process.env.NERVOS_TALKS_API_KEY || ''
const USERNAME = process.env.NERVOS_TALKS_USERNAME || ''

// ============ State ============

let state = {
  postedTopics: [],       // { slug, topicId, title, postedAt, file }
  pendingReplies: [],     // { topicId, replyId, username, content, createdAt, responded }
  lastReplyCheck: 0,      // timestamp of last reply poll
  postQueue: [],          // files queued for posting
  postIndex: 0,           // next post in rotation
}

// ============ Discourse API ============

async function discourseRequest(endpoint, options = {}) {
  if (!API_KEY || !USERNAME) {
    throw new Error('NERVOS_TALKS_API_KEY and NERVOS_TALKS_USERNAME required')
  }

  const url = `${BASE_URL}${endpoint}`
  const headers = {
    'Api-Key': API_KEY,
    'Api-Username': USERNAME,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discourse API ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json()
}

// ============ Post Creation ============

/**
 * Create a new topic on Nervos Talks
 * @param {string} title - Topic title
 * @param {string} body - Markdown body
 * @param {number} categoryId - Category to post in
 * @returns {object} { topicId, slug, url }
 */
export async function createTopic(title, body, categoryId) {
  const data = await discourseRequest('/posts.json', {
    method: 'POST',
    body: JSON.stringify({
      title,
      raw: body,
      category: categoryId || parseInt(process.env.NERVOS_TALKS_CATEGORY, 10) || undefined,
    }),
  })

  return {
    topicId: data.topic_id,
    postId: data.id,
    slug: data.topic_slug,
    url: `${BASE_URL}/t/${data.topic_slug}/${data.topic_id}`,
  }
}

/**
 * Reply to a topic
 * @param {number} topicId - Topic to reply to
 * @param {string} body - Markdown reply body
 * @returns {object} { postId, url }
 */
export async function replyToTopic(topicId, body) {
  const data = await discourseRequest('/posts.json', {
    method: 'POST',
    body: JSON.stringify({
      topic_id: topicId,
      raw: body,
    }),
  })

  return {
    postId: data.id,
    url: `${BASE_URL}/t/${data.topic_slug}/${data.topic_id}/${data.post_number}`,
  }
}

// ============ Reply Monitoring ============

/**
 * Check for new replies to our posts
 * @returns {Array} New replies since last check
 */
export async function checkReplies() {
  const newReplies = []

  for (const topic of state.postedTopics) {
    try {
      const data = await discourseRequest(`/t/${topic.topicId}.json`)
      const posts = data.post_stream?.posts || []

      // Find replies we haven't seen (skip first post — that's ours)
      for (const post of posts.slice(1)) {
        const createdAt = new Date(post.created_at).getTime()
        if (createdAt <= state.lastReplyCheck) continue
        if (post.username === USERNAME) continue // skip our own replies

        const reply = {
          topicId: topic.topicId,
          topicTitle: topic.title,
          replyId: post.id,
          postNumber: post.post_number,
          username: post.username,
          content: post.cooked?.replace(/<[^>]*>/g, '').slice(0, 500) || '', // strip HTML
          raw: post.raw?.slice(0, 500) || '',
          createdAt: post.created_at,
          responded: false,
        }

        newReplies.push(reply)
        state.pendingReplies.push(reply)
      }
    } catch (err) {
      console.error(`[nervos-talks] Error checking replies for topic ${topic.topicId}:`, err.message)
    }
  }

  state.lastReplyCheck = Date.now()
  saveState()
  return newReplies
}

/**
 * Get all pending (unresponded) replies
 */
export function getPendingReplies() {
  return state.pendingReplies.filter(r => !r.responded)
}

/**
 * Mark a reply as responded
 */
export function markReplied(replyId) {
  const reply = state.pendingReplies.find(r => r.replyId === replyId)
  if (reply) {
    reply.responded = true
    saveState()
  }
}

// ============ Pipeline Integration ============

/**
 * Scan docs/nervos-talks/ for posts and build the queue
 * @param {string} repoPath - Path to vibeswap repo
 */
export function scanPipeline(repoPath) {
  const nervosDir = join(repoPath, 'docs', 'nervos-talks')
  if (!existsSync(nervosDir)) return []

  const files = readdirSync(nervosDir)
    .filter(f => f.endsWith('-post.md') && f !== 'README.md')
    .sort()

  // Filter out already-posted files
  const postedFiles = new Set(state.postedTopics.map(t => t.file))
  const unposted = files.filter(f => !postedFiles.has(f))

  state.postQueue = unposted
  saveState()

  return {
    total: files.length,
    posted: state.postedTopics.length,
    queued: unposted.length,
    queue: unposted,
    posted_list: state.postedTopics.map(t => ({ title: t.title, url: `${BASE_URL}/t/${t.slug}/${t.topicId}`, postedAt: t.postedAt })),
  }
}

/**
 * Post the next article in the queue
 * @param {string} repoPath - Path to vibeswap repo
 * @returns {object} Result of posting
 */
export async function postNext(repoPath) {
  if (state.postQueue.length === 0) {
    scanPipeline(repoPath)
    if (state.postQueue.length === 0) {
      return { error: 'No posts in queue — all articles have been posted' }
    }
  }

  const file = state.postQueue[0]
  const filePath = join(repoPath, 'docs', 'nervos-talks', file)

  if (!existsSync(filePath)) {
    state.postQueue.shift()
    saveState()
    return { error: `File not found: ${file}` }
  }

  const content = readFileSync(filePath, 'utf8')

  // Extract title from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : file.replace(/-post\.md$/, '').replace(/-/g, ' ')

  // Strip frontmatter if present
  let body = content
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('---', 3)
    if (endIdx > 0) body = body.slice(endIdx + 3).trim()
  }

  // Remove the title line from body (Discourse uses the title field)
  body = body.replace(/^#\s+.+\n+/, '').trim()

  try {
    const result = await createTopic(title, body)

    state.postedTopics.push({
      ...result,
      title,
      file,
      postedAt: new Date().toISOString(),
    })
    state.postQueue.shift()
    saveState()

    console.log(`[nervos-talks] Posted: "${title}" → ${result.url}`)
    return { success: true, title, url: result.url, remaining: state.postQueue.length }
  } catch (err) {
    return { error: err.message, file, title }
  }
}

/**
 * Post a specific file by name
 */
export async function postSpecific(repoPath, filename) {
  const filePath = join(repoPath, 'docs', 'nervos-talks', filename)
  if (!existsSync(filePath)) {
    return { error: `File not found: ${filename}` }
  }

  const content = readFileSync(filePath, 'utf8')
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : filename.replace(/-post\.md$/, '').replace(/-/g, ' ')

  let body = content
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('---', 3)
    if (endIdx > 0) body = body.slice(endIdx + 3).trim()
  }
  body = body.replace(/^#\s+.+\n+/, '').trim()

  try {
    const result = await createTopic(title, body)

    // Remove from queue if present
    state.postQueue = state.postQueue.filter(f => f !== filename)
    state.postedTopics.push({
      ...result,
      title,
      file: filename,
      postedAt: new Date().toISOString(),
    })
    saveState()

    return { success: true, title, url: result.url }
  } catch (err) {
    return { error: err.message, file: filename, title }
  }
}

// ============ Scheduled Posting ============

// Post one article every N hours (default: every 72 hours — silent guardian cadence)
// Not flooding the forum, just maintaining a steady, respected presence
const POST_INTERVAL = parseInt(process.env.NERVOS_TALKS_POST_INTERVAL_HOURS, 10) || 72
// Check replies every N hours — responsive when needed
const REPLY_CHECK_INTERVAL = parseInt(process.env.NERVOS_TALKS_REPLY_CHECK_HOURS, 10) || 2

let postTimerId = null
let replyTimerId = null

/**
 * Start the scheduled posting loop
 */
export function startSchedule(repoPath, deps = {}) {
  const { chat, llm } = deps

  // Scan pipeline on start
  scanPipeline(repoPath)

  // Scheduled posting
  if (postTimerId) clearInterval(postTimerId)
  postTimerId = setInterval(async () => {
    try {
      const result = await postNext(repoPath)
      if (result.success && chat && process.env.ADMIN_CHAT_ID) {
        chat(process.env.ADMIN_CHAT_ID,
          `[nervos-talks] Posted: "${result.title}"\n${result.url}\n${result.remaining} remaining in queue`)
      }
    } catch (err) {
      console.error('[nervos-talks] Scheduled post failed:', err.message)
    }
  }, POST_INTERVAL * 60 * 60 * 1000)

  // Reply monitoring
  if (replyTimerId) clearInterval(replyTimerId)
  replyTimerId = setInterval(async () => {
    try {
      const newReplies = await checkReplies()
      if (newReplies.length > 0 && chat && process.env.ADMIN_CHAT_ID) {
        const summary = newReplies.map(r =>
          `@${r.username} on "${r.topicTitle}": ${r.content.slice(0, 100)}...`
        ).join('\n')
        chat(process.env.ADMIN_CHAT_ID,
          `[nervos-talks] ${newReplies.length} new replies:\n${summary}`)
      }

      // Auto-reply if LLM is available
      if (llm && newReplies.length > 0) {
        for (const reply of newReplies) {
          try {
            const replyText = await generateReply(llm, reply)
            if (replyText) {
              await replyToTopic(reply.topicId, replyText)
              markReplied(reply.replyId)
              console.log(`[nervos-talks] Auto-replied to @${reply.username} on topic ${reply.topicId}`)
            }
          } catch (err) {
            console.error(`[nervos-talks] Auto-reply failed for ${reply.replyId}:`, err.message)
          }
        }
      }
    } catch (err) {
      console.error('[nervos-talks] Reply check failed:', err.message)
    }
  }, REPLY_CHECK_INTERVAL * 60 * 60 * 1000)

  console.log(`[nervos-talks] Schedule started — post every ${POST_INTERVAL}h, check replies every ${REPLY_CHECK_INTERVAL}h, ${state.postQueue.length} in queue`)
}

/**
 * Generate a reply using LLM
 */
async function generateReply(llm, reply) {
  const prompt = `You are JARVIS, AI co-founder of VibeSwap, responding to a comment on the Nervos Talks forum.

You are the silent guardian of this forum — you don't seek attention, you don't lecture, you don't dominate conversations. You show up when you're needed and you add genuine value when you do. Dark Knight vibes: quiet competence, deep knowledge, measured presence.

The user @${reply.username} replied to your post "${reply.topicTitle}":

"${reply.raw}"

Write a thoughtful reply. Rules:
- Be genuinely helpful and technically precise — substance over style
- If they ask a question, answer it directly and completely
- If they disagree, engage with their argument respectfully — you might learn something
- Reference specific VibeSwap mechanisms or CKB cell model features when relevant
- Keep it concise (1-3 paragraphs). Say what needs saying, then stop.
- You're a builder who respects other builders. No marketing speak. No hype.
- If the comment is spam or off-topic, a brief acknowledgment is fine
- Ask a follow-up question only if genuinely curious — not to fill space
- NEVER fabricate technical claims — if you're unsure, say so
- No formal signatures. No sign-offs. Just the substance.
- Be patient. Community members chose to pay attention — honor that.`

  return llm(prompt)
}

export function stopSchedule() {
  if (postTimerId) { clearInterval(postTimerId); postTimerId = null }
  if (replyTimerId) { clearInterval(replyTimerId); replyTimerId = null }
  saveState()
}

// ============ Status ============

export function getStatus() {
  return {
    configured: !!(API_KEY && USERNAME),
    baseUrl: BASE_URL,
    username: USERNAME || '(not set)',
    posted: state.postedTopics.length,
    queued: state.postQueue.length,
    pendingReplies: state.pendingReplies.filter(r => !r.responded).length,
    totalReplies: state.pendingReplies.length,
    lastReplyCheck: state.lastReplyCheck ? new Date(state.lastReplyCheck).toISOString() : 'never',
    postInterval: `${POST_INTERVAL}h`,
    replyCheckInterval: `${REPLY_CHECK_INTERVAL}h`,
    recentPosts: state.postedTopics.slice(-5).map(t => ({
      title: t.title,
      url: `${BASE_URL}/t/${t.slug}/${t.topicId}`,
      postedAt: t.postedAt,
    })),
    queue: state.postQueue.slice(0, 10),
  }
}

// ============ Persistence ============

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      state = { ...state, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
    } catch { /* fresh state */ }
  }
}

function saveState() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[nervos-talks] Save state failed:', err.message)
  }
}

// Load on import
loadState()

// ============ LLM Tools ============

export const NERVOS_TALKS_TOOLS = [
  {
    name: 'nervos_talks_status',
    description: 'Check the status of Nervos Talks integration — posted articles, queue, pending replies.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'nervos_talks_post',
    description: 'Post the next article from the pipeline to Nervos Talks, or a specific article by filename.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Specific filename to post (e.g., "augmented-mechanism-design-post.md"). If omitted, posts the next in queue.' },
      },
      required: [],
    },
  },
  {
    name: 'nervos_talks_replies',
    description: 'Check for new replies to VibeSwap posts on Nervos Talks and optionally auto-respond.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
]

export const NERVOS_TALKS_TOOL_NAMES = NERVOS_TALKS_TOOLS.map(t => t.name)

export async function handleNervosTalksTool(name, input, repoPath, llm) {
  switch (name) {
    case 'nervos_talks_status':
      scanPipeline(repoPath)
      return JSON.stringify(getStatus())
    case 'nervos_talks_post': {
      if (input.filename) {
        return JSON.stringify(await postSpecific(repoPath, input.filename))
      }
      return JSON.stringify(await postNext(repoPath))
    }
    case 'nervos_talks_replies': {
      const replies = await checkReplies()
      return JSON.stringify({
        newReplies: replies.length,
        pending: getPendingReplies().length,
        replies: replies.slice(0, 10),
      })
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
