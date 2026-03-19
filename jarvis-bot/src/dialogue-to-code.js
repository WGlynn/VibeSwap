// ============ DIALOGUE-TO-CODE — Autonomous Insight Pipeline ============
//
// "Everybody is a dev in VibeSwap." — Will
//
// The pipeline that turns TG conversations into GitHub contributions.
// Community members don't need to write code. Their insights, questions,
// and observations ARE the contributions. Jarvis extracts the signal,
// compiles it into a structured prompt, creates a GitHub issue, and
// attributes the contribution to the person who said it.
//
// Flow:
//   1. DETECT:    Conversation contains protocol-relevant insight
//   2. COMPILE:   Extract insight into structured prompt
//   3. PUBLISH:   Create GitHub issue with contributor credit
//   4. ATTRIBUTE: Record in attribution graph (TG user -> source -> derivation)
//   5. ANNOUNCE:  Tell the group their conversation generated a contribution
//
// When DID/wallet linking is complete, contributions flow through:
//   TG user -> ContributionDAG -> ShapleyDistributor -> VIBE rewards
//
// This is the mechanism that makes non-developers into contributors.
// The dialogue IS the code. The insight IS the PR.
// ============

import { createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'dialogue-insights');
const STATE_FILE = join(DATA_DIR, 'insights.json');

const MAX_INSIGHTS_PER_HOUR = 3;        // Per chat — prevent spam
const USER_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between insights from same user
const MIN_QUALITY_SCORE = 3;             // Minimum tracker quality to trigger
const MIN_CONVERSATION_DEPTH = 3;        // Need at least 3 messages of context
const AUTO_SAVE_INTERVAL = 60_000;       // Save every 60s

// Protocol-relevant topics that trigger deeper analysis
const PROTOCOL_KEYWORDS = [
  'price', 'oracle', 'mev', 'front-run', 'frontrun', 'batch', 'auction',
  'fairness', 'fair', 'manipulation', 'manipulate', 'extract', 'extracti',
  'middleman', 'intermediary', 'decentrali', 'permissionless', 'trustless',
  'governance', 'dao', 'vote', 'voting', 'treasury', 'shapley',
  'liquidity', 'pool', 'swap', 'amm', 'slippage', 'impermanent',
  'bridge', 'cross-chain', 'layerzero', 'omnichain',
  'wallet', 'key', 'custody', 'self-custody', 'security',
  'insurance', 'risk', 'circuit breaker', 'protection',
  'incentive', 'reward', 'stake', 'emission', 'token',
  'identity', 'reputation', 'trust', 'sybil', 'proof of mind',
  'cooperative', 'mutualism', 'commons', 'public good',
  'ux', 'onboarding', 'user experience', 'confusing', 'simple',
];

// ============ State ============

let insights = [];         // All detected insights
let chatCooldowns = {};    // chatId -> [timestamps]
let userCooldowns = {};    // TG userId -> lastInsightTimestamp
let dirty = false;
let initialized = false;

// ============ Init ============

export async function initDialogueToCode() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    insights = state.insights || [];
    chatCooldowns = state.chatCooldowns || {};
    userCooldowns = state.userCooldowns || {};
    console.log(`[dialogue-to-code] Loaded ${insights.length} insights`);
  } catch {
    console.log('[dialogue-to-code] No saved state - starting fresh');
  }
  initialized = true;
  setInterval(save, AUTO_SAVE_INTERVAL);
}

// ============ Core: Detect Insight ============

/**
 * Check if a conversation contains a protocol-relevant insight.
 * Called from the message handler after trackMessage().
 *
 * @param {string} text - The message text
 * @param {Object} context - { category, quality, userId, username, chatId, recentMessages }
 * @returns {Object|null} { isCodeworthy, relevance, keywords } or null
 */
export function quickDetect(text, context) {
  if (!initialized) return null;
  if (!text || text.length < 30) return null;

  // Check quality threshold
  if (context.quality < MIN_QUALITY_SCORE) return null;

  // Check cooldowns
  if (!canGenerateInsight(context.chatId, context.userId)) return null;

  // Check for protocol-relevant keywords
  const lower = text.toLowerCase();
  const matchedKeywords = PROTOCOL_KEYWORDS.filter(kw => lower.includes(kw));

  if (matchedKeywords.length === 0) return null;

  // Must be a substantive category
  const validCategories = ['IDEA', 'GOVERNANCE', 'DESIGN', 'CODE', 'REVIEW'];
  if (!validCategories.includes(context.category)) return null;

  return {
    isCodeworthy: true,
    relevance: matchedKeywords.length,
    keywords: matchedKeywords,
  };
}

/**
 * Deep analysis: compile a conversation into a structured insight.
 * Uses LLM to extract the actionable insight from recent messages.
 *
 * @param {Array} recentMessages - Last N messages [{username, text, isJarvis}]
 * @param {Object} trigger - The message that triggered detection
 * @param {string[]} keywords - Matched protocol keywords
 * @returns {Object|null} Compiled insight or null if not substantial enough
 */
export async function compileInsight(recentMessages, trigger, keywords) {
  if (recentMessages.length < MIN_CONVERSATION_DEPTH) return null;

  const conversationText = recentMessages
    .map(m => `[${m.isJarvis ? 'JARVIS' : m.username}]: ${m.text.slice(0, 300)}`)
    .join('\n');

  try {
    const response = await llmChat({
      _background: true,
      max_tokens: 500,
      system: `You are a protocol insight compiler for VibeSwap, a DeFi protocol that eliminates MEV through commit-reveal batch auctions.

Your job: analyze a Telegram conversation and extract an actionable insight relevant to VibeSwap's protocol design, mechanism, user experience, or philosophy.

Output EXACTLY this format (no other text):

TITLE: [5-10 word title for the insight]
CATEGORY: [Oracle | MEV | Governance | UX | Incentives | Security | Philosophy | Infrastructure]
INSIGHT: [2-3 sentences describing what was discovered or suggested]
RELEVANCE: [1-2 sentences on how this maps to VibeSwap's protocol]
ACTIONS: [2-3 bullet points of concrete things to do]
CONTRIBUTOR: [username of the person who provided the key insight]

If the conversation does NOT contain a genuine protocol-relevant insight, output ONLY: NO_INSIGHT`,
      messages: [{
        role: 'user',
        content: `Protocol keywords detected: ${keywords.join(', ')}\n\nConversation:\n${conversationText}`,
      }],
    });

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!rawText || rawText === 'NO_INSIGHT' || rawText.length < 50) return null;

    return parseCompiledInsight(rawText, trigger, recentMessages);
  } catch (err) {
    console.warn(`[dialogue-to-code] Compilation failed: ${err.message}`);
    return null;
  }
}

// ============ Parse Compiled Insight ============

function parseCompiledInsight(text, trigger, recentMessages) {
  const sections = {};
  let currentKey = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const key of ['TITLE', 'CATEGORY', 'INSIGHT', 'RELEVANCE', 'ACTIONS', 'CONTRIBUTOR']) {
      if (trimmed.toUpperCase().startsWith(key + ':')) {
        currentKey = key.toLowerCase();
        sections[currentKey] = trimmed.slice(key.length + 1).trim();
        break;
      }
    }

    // Append to current section if it's a continuation (e.g., multi-line ACTIONS)
    if (currentKey && !trimmed.match(/^[A-Z]+:/)) {
      sections[currentKey] = (sections[currentKey] || '') + '\n' + trimmed;
    }
  }

  if (!sections.title || !sections.insight) return null;

  // Parse actions into array
  const actions = (sections.actions || '')
    .split('\n')
    .map(a => a.replace(/^[-*]\s*/, '').trim())
    .filter(a => a.length > 5);

  // Build evidence hash from the conversation
  const evidenceHash = createHash('sha256')
    .update(recentMessages.map(m => m.text).join('\n'))
    .digest('hex')
    .slice(0, 16);

  return {
    title: sections.title,
    category: sections.category || 'General',
    insight: sections.insight,
    relevance: sections.relevance || '',
    actions,
    contributor: sections.contributor || trigger.username,
    contributorId: trigger.userId,
    chatId: trigger.chatId,
    messageId: trigger.messageId,
    evidenceHash,
    timestamp: Date.now(),
    keywords: trigger.keywords || [],
  };
}

// ============ GitHub Issue Creation ============

/**
 * Create a GitHub issue from a compiled insight.
 * Uses social.js createGitHubIssue() if available.
 *
 * @param {Object} insight - Compiled insight object
 * @param {Function} createGitHubIssue - From social.js
 * @returns {Object|null} { number, url } or null
 */
export async function publishInsight(insight, createGitHubIssue) {
  if (!createGitHubIssue) {
    console.warn('[dialogue-to-code] No GitHub integration available');
    return null;
  }

  const body = formatGitHubIssueBody(insight);
  const labels = ['dialogue-insight', insight.category.toLowerCase()];

  try {
    const result = await createGitHubIssue(
      `[Dialogue] ${insight.title}`,
      body,
      labels
    );

    if (result?.number) {
      insight.githubIssue = { number: result.number, url: result.url };
      insight.status = 'published';
      dirty = true;

      console.log(
        `[dialogue-to-code] Published insight: #${result.number} "${insight.title}"`
        + ` (by @${insight.contributor})`
      );
    }

    return result;
  } catch (err) {
    console.warn(`[dialogue-to-code] GitHub publish failed: ${err.message}`);
    return null;
  }
}

function formatGitHubIssueBody(insight) {
  const actions = insight.actions.length > 0
    ? insight.actions.map(a => `- [ ] ${a}`).join('\n')
    : '- [ ] Review and implement';

  return `## Dialogue Insight: ${insight.title}

**Source**: @${insight.contributor} in VibeSwap Telegram Community
**Category**: ${insight.category}
**Detected**: ${new Date(insight.timestamp).toISOString().slice(0, 10)}
**Evidence Hash**: \`${insight.evidenceHash}\`

### The Insight

${insight.insight}

### Protocol Relevance

${insight.relevance}

### Action Items

${actions}

### Attribution

| Field | Value |
|-------|-------|
| Contributor | @${insight.contributor} |
| Telegram ID | ${insight.contributorId} |
| Keywords | ${insight.keywords.join(', ')} |
| Pipeline | JARVIS Autonomous Dialogue-to-Code |

---

*This issue was autonomously generated from a Telegram conversation by the JARVIS dialogue-to-code pipeline. The contributor does not need to write code — their insight IS the contribution. When DID-linked wallets are connected, contributions flow through ContributionDAG -> ShapleyDistributor -> VIBE rewards.*

*"Everybody is a dev in VibeSwap."*`;
}

// ============ Full Pipeline ============

/**
 * Run the full dialogue-to-code pipeline on a detected insight.
 * Call this from the message handler when quickDetect() returns positive.
 *
 * @param {Object} detection - Result from quickDetect()
 * @param {Object} ctx - Telegraf context
 * @param {Array} recentMessages - Recent conversation messages
 * @param {Object} deps - { createGitHubIssue, recordSource }
 * @returns {Object|null} Published insight or null
 */
export async function runPipeline(detection, ctx, recentMessages, deps) {
  const trigger = {
    username: ctx.from?.username || ctx.from?.first_name || 'anonymous',
    userId: String(ctx.from?.id || 0),
    chatId: String(ctx.chat?.id || 0),
    messageId: ctx.message?.message_id,
    keywords: detection.keywords,
  };

  // Step 1: Compile insight from conversation
  const insight = await compileInsight(recentMessages, trigger, detection.keywords);
  if (!insight) return null;

  // Step 2: Store locally
  insights.push(insight);
  dirty = true;

  // Record cooldowns
  recordCooldown(trigger.chatId, trigger.userId);

  // Step 3: Publish to GitHub
  const issueResult = await publishInsight(insight, deps.createGitHubIssue);

  // Step 4: Record attribution (if available)
  if (issueResult?.url && deps.recordSource) {
    try {
      deps.recordSource({
        author: insight.contributor,
        authorId: insight.contributorId,
        url: issueResult.url,
        contentHash: insight.evidenceHash,
        type: 'SOCIAL',
        title: `${insight.title} (TG Dialogue)`,
        metadata: {
          telegramId: insight.contributorId,
          messageId: insight.messageId,
          chatId: insight.chatId,
          githubIssue: issueResult.number,
          category: insight.category,
          pipeline: 'dialogue-to-code',
        },
      });
    } catch (err) {
      console.warn(`[dialogue-to-code] Attribution recording failed: ${err.message}`);
    }
  }

  // Step 5: Announce in chat
  if (issueResult?.number) {
    try {
      const announcement = `This conversation just generated a protocol contribution.\n\n`
        + `"${insight.title}" - credited to @${insight.contributor}\n`
        + `GitHub: github.com/WGlynn/VibeSwap/issues/${issueResult.number}\n\n`
        + `You don't need to write code. Your insights ARE the contributions.`;

      await ctx.reply(announcement, {
        reply_to_message_id: ctx.message?.message_id,
        disable_web_page_preview: true,
      });
    } catch (err) {
      // Chat announcement is non-critical
      console.warn(`[dialogue-to-code] Announcement failed: ${err.message}`);
    }
  }

  return insight;
}

// ============ Cooldown Management ============

function canGenerateInsight(chatId, userId) {
  const chatKey = String(chatId);
  const userKey = String(userId);
  const now = Date.now();

  // Per-chat rate limit
  const chatHistory = (chatCooldowns[chatKey] || [])
    .filter(ts => now - ts < 3600_000); // Last hour
  if (chatHistory.length >= MAX_INSIGHTS_PER_HOUR) return false;

  // Per-user cooldown
  const lastUserInsight = userCooldowns[userKey] || 0;
  if (now - lastUserInsight < USER_COOLDOWN_MS) return false;

  return true;
}

function recordCooldown(chatId, userId) {
  const chatKey = String(chatId);
  const userKey = String(userId);
  const now = Date.now();

  if (!chatCooldowns[chatKey]) chatCooldowns[chatKey] = [];
  chatCooldowns[chatKey].push(now);

  // Prune old entries
  chatCooldowns[chatKey] = chatCooldowns[chatKey]
    .filter(ts => now - ts < 3600_000);

  userCooldowns[userKey] = now;
  dirty = true;
}

// ============ Stats ============

export function getDialogueStats() {
  const published = insights.filter(i => i.status === 'published');
  const byCategory = {};
  const byContributor = {};

  for (const i of insights) {
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
    byContributor[i.contributor] = (byContributor[i.contributor] || 0) + 1;
  }

  return {
    totalDetected: insights.length,
    totalPublished: published.length,
    byCategory,
    byContributor,
    topContributors: Object.entries(byContributor)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),
    recentInsights: insights.slice(-5).map(i => ({
      title: i.title,
      contributor: i.contributor,
      category: i.category,
      githubIssue: i.githubIssue?.number || null,
      timestamp: i.timestamp,
    })),
  };
}

/**
 * Get all contributions for a specific user.
 */
export function getUserContributions(userId) {
  const userKey = String(userId);
  return insights
    .filter(i => i.contributorId === userKey)
    .map(i => ({
      title: i.title,
      category: i.category,
      githubIssue: i.githubIssue,
      timestamp: i.timestamp,
      evidenceHash: i.evidenceHash,
    }));
}

// ============ Persistence ============

async function save() {
  if (!dirty) return;
  dirty = false;
  try {
    await writeFile(STATE_FILE, JSON.stringify({
      insights,
      chatCooldowns,
      userCooldowns,
    }, null, 2));
  } catch (err) {
    console.error(`[dialogue-to-code] Save failed: ${err.message}`);
    dirty = true;
  }
}

export async function flushDialogueInsights() {
  await save();
}
