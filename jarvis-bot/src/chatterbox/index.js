import 'dotenv/config'
import { Telegraf } from 'telegraf'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import Anthropic from '@anthropic-ai/sdk'

// ============ Chatterbox Bot ============
//
// Separation of concerns: Jarvis handles conversations + intelligence.
// Chatterbox handles flow control — muting chatty members, managing pace.
// Same Jarvis mind (Claude API), separate throttle, separate bot token.
//
// DESIGN:
// - Tracks message rate per user per chat
// - Configurable thresholds (messages per window)
// - Warnings before mute (Jarvis personality, not robotic)
// - Will can adjust settings via /chatterbox commands
// - All actions logged with evidence hashes

const HOME = homedir()
const DATA_DIR = process.env.DATA_DIR || join(HOME, 'vibeswap', 'jarvis-bot', 'data')
const STATE_FILE = join(DATA_DIR, 'chatterbox-state.json')
const CONFIG_FILE = join(DATA_DIR, 'chatterbox-config.json')

// ============ Config ============

const OWNER_ID = parseInt(process.env.OWNER_USER_ID, 10) || 8366932263 // Will
const BOT_TOKEN = process.env.CHATTERBOX_BOT_TOKEN || '8608848856:AAHHX2l09anTTQRudiWQtLWQ5f4D0zFjigE'

function getDefaultConfig() {
  return {
    // Messages per window before warning
    messageThreshold: 10,
    // Window size in seconds
    windowSeconds: 60,
    // Warnings before auto-mute
    warningsBeforeMute: 2,
    // Mute duration in seconds (default: 5 minutes)
    muteDurationSeconds: 300,
    // Cooldown after unmute — if they immediately start again, shorter fuse
    repeatOffenderMultiplier: 2,
    // Exempt users (admins, Will, etc)
    exemptUsers: [OWNER_ID],
    // Chats this bot monitors (empty = all chats it's added to)
    monitoredChats: [],
    // Whether to use Jarvis personality for warnings (vs plain text)
    useJarvisVoice: true,
    // Quiet mode — just mute, no warning messages
    quietMode: false,
    // Max message length before it counts as 2 messages (walls of text)
    longMessageChars: 500,
    // Sticker/GIF spam — these count extra
    mediaSpamWeight: 1.5,
    // Enabled
    enabled: true,
  }
}

// ============ State ============

let chatConfig = null
let state = {
  // { chatId: { userId: { messages: [timestamp, ...], warnings: number, muteCount: number, lastMute: timestamp } } }
  trackers: {},
  // Moderation log
  log: [],
}

async function loadState() {
  try {
    await mkdir(DATA_DIR, { recursive: true })
  } catch {}
  try {
    const data = await readFile(STATE_FILE, 'utf-8')
    state = JSON.parse(data)
    // Migrate old state
    if (!state.trackers) state.trackers = {}
    if (!state.log) state.log = []
  } catch {
    state = { trackers: {}, log: [] }
  }
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8')
    chatConfig = JSON.parse(data)
  } catch {
    chatConfig = getDefaultConfig()
  }
}

async function saveState() {
  try {
    // Prune log to last 2000 entries
    if (state.log.length > 2000) state.log = state.log.slice(-2000)
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.warn(`[chatterbox] Save state failed: ${err.message}`)
  }
}

async function saveConfig() {
  try {
    await writeFile(CONFIG_FILE, JSON.stringify(chatConfig, null, 2))
  } catch (err) {
    console.warn(`[chatterbox] Save config failed: ${err.message}`)
  }
}

// ============ Tracker ============

function getTracker(chatId, userId) {
  const chatKey = String(chatId)
  const userKey = String(userId)
  if (!state.trackers[chatKey]) state.trackers[chatKey] = {}
  if (!state.trackers[chatKey][userKey]) {
    state.trackers[chatKey][userKey] = {
      messages: [],
      warnings: 0,
      muteCount: 0,
      lastMute: 0,
    }
  }
  return state.trackers[chatKey][userKey]
}

function recordMessage(chatId, userId, weight = 1) {
  const tracker = getTracker(chatId, userId)
  const now = Date.now()
  // Add weighted entries
  for (let i = 0; i < weight; i++) {
    tracker.messages.push(now)
  }
  // Prune messages outside window
  const cutoff = now - (chatConfig.windowSeconds * 1000)
  tracker.messages = tracker.messages.filter(t => t > cutoff)
  return tracker
}

function getMessageRate(chatId, userId) {
  const tracker = getTracker(chatId, userId)
  const now = Date.now()
  const cutoff = now - (chatConfig.windowSeconds * 1000)
  return tracker.messages.filter(t => t > cutoff).length
}

function isExempt(userId) {
  return chatConfig.exemptUsers.includes(userId)
}

function isMonitored(chatId) {
  if (chatConfig.monitoredChats.length === 0) return true // monitor all
  return chatConfig.monitoredChats.includes(chatId)
}

// ============ Jarvis Voice for Warnings ============

let anthropic = null

async function getJarvisWarning(username, messageCount, windowSeconds) {
  if (!chatConfig.useJarvisVoice || !process.env.ANTHROPIC_API_KEY) {
    return `@${username}, easy on the messages — ${messageCount} in ${windowSeconds}s. Take a breath.`
  }

  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You are Jarvis from VibeSwap — witty, concise, no-nonsense AI. You're telling someone to slow down their message rate in a Telegram group. Be brief (1-2 sentences max), slightly playful but firm. Don't be mean. Don't use emojis. Reference their message count naturally.`,
      messages: [{
        role: 'user',
        content: `${username} has sent ${messageCount} messages in ${windowSeconds} seconds. Give them a brief, Jarvis-style warning to slow down.`,
      }],
    })
    return resp.content[0]?.text || `@${username}, throttle back. ${messageCount} messages in ${windowSeconds}s is a lot.`
  } catch {
    return `@${username}, throttle back. ${messageCount} messages in ${windowSeconds}s is a lot.`
  }
}

async function getJarvisMuteNotice(username, duration) {
  if (!chatConfig.useJarvisVoice || !process.env.ANTHROPIC_API_KEY) {
    return `@${username} has been muted for ${Math.round(duration / 60)} minutes. Cool off.`
  }

  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: `You are Jarvis from VibeSwap. Someone has been muted for talking too much. Announce it briefly (1 sentence), Jarvis-style. No emojis.`,
      messages: [{
        role: 'user',
        content: `${username} has been muted for ${Math.round(duration / 60)} minutes for excessive messaging.`,
      }],
    })
    return resp.content[0]?.text || `@${username} muted for ${Math.round(duration / 60)} minutes.`
  } catch {
    return `@${username} muted for ${Math.round(duration / 60)} minutes.`
  }
}

// ============ Core Logic ============

async function handleMessage(ctx) {
  if (!chatConfig.enabled) return
  if (!ctx.message) return

  const chatId = ctx.message.chat.id
  const userId = ctx.message.from.id
  const username = ctx.message.from.username || ctx.message.from.first_name || 'user'

  // Skip DMs — only moderate groups
  if (ctx.message.chat.type === 'private') return

  // Skip if chat not monitored
  if (!isMonitored(chatId)) return

  // Skip exempt users
  if (isExempt(userId)) return

  // Calculate message weight
  let weight = 1
  if (ctx.message.text && ctx.message.text.length > chatConfig.longMessageChars) weight = 2
  if (ctx.message.sticker || ctx.message.animation) weight = chatConfig.mediaSpamWeight

  // Record and check
  const tracker = recordMessage(chatId, userId, weight)
  const rate = getMessageRate(chatId, userId)

  if (rate >= chatConfig.messageThreshold) {
    tracker.warnings++

    if (tracker.warnings >= chatConfig.warningsBeforeMute) {
      // Mute
      const multiplier = Math.min(tracker.muteCount + 1, 5) // cap at 5x
      const duration = chatConfig.muteDurationSeconds * (chatConfig.repeatOffenderMultiplier ** Math.min(tracker.muteCount, 3))

      try {
        const untilDate = Math.floor((Date.now() + duration * 1000) / 1000)
        await ctx.telegram.restrictChatMember(chatId, userId, {
          permissions: {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
          },
          until_date: untilDate,
        })

        tracker.muteCount++
        tracker.lastMute = Date.now()
        tracker.warnings = 0
        tracker.messages = []

        state.log.push({
          action: 'mute',
          chatId, userId, username,
          rate, duration,
          muteNumber: tracker.muteCount,
          timestamp: Date.now(),
        })

        if (!chatConfig.quietMode) {
          const notice = await getJarvisMuteNotice(username, duration)
          await ctx.reply(notice)
        }

        console.log(`[chatterbox] Muted @${username} (${userId}) in ${chatId} for ${duration}s (mute #${tracker.muteCount})`)
      } catch (err) {
        console.warn(`[chatterbox] Failed to mute ${userId}: ${err.message}`)
      }
    } else {
      // Warning
      state.log.push({
        action: 'warn',
        chatId, userId, username,
        rate,
        warningNumber: tracker.warnings,
        timestamp: Date.now(),
      })

      if (!chatConfig.quietMode) {
        const warning = await getJarvisWarning(username, rate, chatConfig.windowSeconds)
        await ctx.reply(warning)
      }

      console.log(`[chatterbox] Warned @${username} (${userId}) — ${rate} msgs in ${chatConfig.windowSeconds}s (warning ${tracker.warnings}/${chatConfig.warningsBeforeMute})`)
    }

    await saveState()
  }
}

// ============ Admin Commands ============

function isAdmin(userId) {
  return userId === OWNER_ID
}

function setupCommands(bot) {
  // /chatterbox — show status
  bot.command('chatterbox', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const chatId = ctx.message.chat.id
    const trackers = state.trackers[String(chatId)] || {}
    const activeUsers = Object.keys(trackers).length
    const recentMutes = state.log.filter(l => l.action === 'mute' && l.chatId === chatId).slice(-5)

    let status = `**Chatterbox Status**\n`
    status += `Enabled: ${chatConfig.enabled}\n`
    status += `Threshold: ${chatConfig.messageThreshold} msgs / ${chatConfig.windowSeconds}s\n`
    status += `Warnings before mute: ${chatConfig.warningsBeforeMute}\n`
    status += `Mute duration: ${chatConfig.muteDurationSeconds}s\n`
    status += `Tracked users: ${activeUsers}\n`
    status += `Quiet mode: ${chatConfig.quietMode}\n`

    if (recentMutes.length > 0) {
      status += `\nRecent mutes:\n`
      for (const m of recentMutes) {
        const ago = Math.round((Date.now() - m.timestamp) / 60000)
        status += `• @${m.username} — ${ago}m ago (${m.duration}s)\n`
      }
    }

    await ctx.reply(status, { parse_mode: 'Markdown' })
  })

  // /cb_set <key> <value> — adjust config
  bot.command('cb_set', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const parts = ctx.message.text.split(/\s+/).slice(1)
    if (parts.length < 2) {
      await ctx.reply('Usage: /cb_set <key> <value>\nKeys: messageThreshold, windowSeconds, warningsBeforeMute, muteDurationSeconds, quietMode, enabled, useJarvisVoice')
      return
    }

    const [key, ...rest] = parts
    const value = rest.join(' ')

    const numKeys = ['messageThreshold', 'windowSeconds', 'warningsBeforeMute', 'muteDurationSeconds', 'repeatOffenderMultiplier', 'longMessageChars', 'mediaSpamWeight']
    const boolKeys = ['quietMode', 'enabled', 'useJarvisVoice']

    if (numKeys.includes(key)) {
      chatConfig[key] = parseFloat(value)
    } else if (boolKeys.includes(key)) {
      chatConfig[key] = value === 'true' || value === '1'
    } else {
      await ctx.reply(`Unknown key: ${key}`)
      return
    }

    await saveConfig()
    await ctx.reply(`Set ${key} = ${chatConfig[key]}`)
    console.log(`[chatterbox] Config updated: ${key} = ${chatConfig[key]}`)
  })

  // /cb_exempt <userId> — add exempt user
  bot.command('cb_exempt', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const userId = parseInt(ctx.message.text.split(/\s+/)[1], 10)
    if (isNaN(userId)) {
      await ctx.reply('Usage: /cb_exempt <userId>')
      return
    }

    if (!chatConfig.exemptUsers.includes(userId)) {
      chatConfig.exemptUsers.push(userId)
      await saveConfig()
    }
    await ctx.reply(`User ${userId} is now exempt from chatterbox.`)
  })

  // /cb_unexempt <userId> — remove exemption
  bot.command('cb_unexempt', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const userId = parseInt(ctx.message.text.split(/\s+/)[1], 10)
    if (isNaN(userId)) {
      await ctx.reply('Usage: /cb_unexempt <userId>')
      return
    }

    chatConfig.exemptUsers = chatConfig.exemptUsers.filter(id => id !== userId)
    await saveConfig()
    await ctx.reply(`User ${userId} exemption removed.`)
  })

  // /cb_unmute <userId> — manually unmute
  bot.command('cb_unmute', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const userId = parseInt(ctx.message.text.split(/\s+/)[1], 10)
    if (isNaN(userId)) {
      await ctx.reply('Usage: /cb_unmute <userId>')
      return
    }

    try {
      await ctx.telegram.restrictChatMember(ctx.message.chat.id, userId, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      })

      // Reset their tracker
      const tracker = getTracker(ctx.message.chat.id, userId)
      tracker.warnings = 0
      tracker.messages = []

      state.log.push({
        action: 'unmute',
        chatId: ctx.message.chat.id,
        userId,
        by: ctx.from.id,
        timestamp: Date.now(),
      })

      await saveState()
      await ctx.reply(`User ${userId} unmuted.`)
    } catch (err) {
      await ctx.reply(`Failed to unmute: ${err.message}`)
    }
  })

  // /cb_reset — reset all trackers (fresh start)
  bot.command('cb_reset', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    state.trackers = {}
    await saveState()
    await ctx.reply('All chatterbox trackers reset.')
  })

  // /cb_log — recent actions
  bot.command('cb_log', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const recent = state.log.slice(-10)
    if (recent.length === 0) {
      await ctx.reply('No chatterbox actions yet.')
      return
    }

    let text = '**Recent Chatterbox Actions:**\n'
    for (const entry of recent) {
      const ago = Math.round((Date.now() - entry.timestamp) / 60000)
      text += `• ${entry.action} @${entry.username || entry.userId} — ${ago}m ago\n`
    }
    await ctx.reply(text, { parse_mode: 'Markdown' })
  })

  // /cb_monitor <chatId> — add chat to monitored list
  bot.command('cb_monitor', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return

    const chatId = parseInt(ctx.message.text.split(/\s+/)[1], 10)
    if (isNaN(chatId)) {
      // Default: use current chat
      if (!chatConfig.monitoredChats.includes(ctx.message.chat.id)) {
        chatConfig.monitoredChats.push(ctx.message.chat.id)
      }
      await saveConfig()
      await ctx.reply(`Now monitoring this chat (${ctx.message.chat.id}).`)
      return
    }

    if (!chatConfig.monitoredChats.includes(chatId)) {
      chatConfig.monitoredChats.push(chatId)
    }
    await saveConfig()
    await ctx.reply(`Now monitoring chat ${chatId}.`)
  })
}

// ============ Boot ============

async function main() {
  console.log('[chatterbox] Starting Chatterbox bot...')
  console.log('[chatterbox] Separation of concerns: same Jarvis mind, separate throttle.')

  await loadState()
  console.log(`[chatterbox] Loaded state: ${Object.keys(state.trackers).length} tracked chats, ${state.log.length} log entries`)

  const bot = new Telegraf(BOT_TOKEN)

  setupCommands(bot)

  // Monitor all messages
  bot.on('message', handleMessage)

  // Graceful shutdown
  process.once('SIGINT', () => { bot.stop('SIGINT'); saveState() })
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); saveState() })

  // Periodic state save (every 5 min)
  setInterval(() => saveState(), 5 * 60 * 1000)

  // Periodic tracker cleanup — prune stale trackers older than 1 hour
  setInterval(() => {
    const cutoff = Date.now() - (60 * 60 * 1000)
    for (const chatKey of Object.keys(state.trackers)) {
      for (const userKey of Object.keys(state.trackers[chatKey])) {
        const tracker = state.trackers[chatKey][userKey]
        const latest = Math.max(...(tracker.messages || [0]))
        if (latest < cutoff && tracker.warnings === 0) {
          delete state.trackers[chatKey][userKey]
        }
      }
      if (Object.keys(state.trackers[chatKey]).length === 0) {
        delete state.trackers[chatKey]
      }
    }
  }, 30 * 60 * 1000) // cleanup every 30 min

  await bot.launch()
  console.log('[chatterbox] Bot running. Add to group and use /chatterbox for status.')
  console.log(`[chatterbox] Owner: ${OWNER_ID}`)
  console.log(`[chatterbox] Threshold: ${chatConfig.messageThreshold} msgs / ${chatConfig.windowSeconds}s`)
}

main().catch(err => {
  console.error('[chatterbox] Fatal:', err)
  process.exit(1)
})
