// ============ VIP Detector — Shard Improvement Suggestion Pipeline ============
//
// Every Jarvis shard detects improvement suggestions in conversation
// and reports them to Will's DM as formatted VIPs.
//
// Flow:
//   User says something like "what if VibeSwap did X" or "it would be cool if..."
//   → Shard detects suggestion signal
//   → Formats as VIP draft
//   → DMs Will with the suggestion + contributor credit
//   → Will can /vip_accept or /vip_reject
//   → Accepted VIPs → GitHub Issue → deployment pipeline → mainnet
//
// This connects: community users → Jarvis shards → Will's DM → GitHub → mainnet
//
// CRITICAL: Contributors get credit. Human input IS labor.
// ============

import { config } from './config.js';
import { llmChat } from './llm-provider.js';
import { recordUsage } from './compute-economics.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = config.dataDir || 'data';
const VIP_FILE = join(DATA_DIR, 'vip-suggestions.json');

// ============ Suggestion Detection Patterns ============

const SUGGESTION_PATTERNS = [
  /what if (?:vibeswap|we|the protocol|jarvis|the dex)/i,
  /it would be (?:cool|nice|great|better|useful|interesting) if/i,
  /(?:should|could|might) (?:we|vibeswap|the protocol|jarvis) (?:add|build|implement|create|make)/i,
  /(?:idea|suggestion|proposal|thought):\s/i,
  /have you (?:thought about|considered)/i,
  /why (?:don't|doesn't|not) (?:we|vibeswap|the protocol)/i,
  /(?:feature|improvement) (?:request|idea|suggestion)/i,
  /wouldn't it be (?:better|cool|nice) (?:if|to)/i,
  /i(?:'d| would) (?:love|like) (?:to see|if)/i,
];

// Minimum message length to avoid false positives on short messages
const MIN_SUGGESTION_LENGTH = 30;

// Cooldown per user — don't flood Will's DMs
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min per user
const userCooldowns = new Map();

// ============ State ============

let suggestions = [];

async function loadSuggestions() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const data = await readFile(VIP_FILE, 'utf-8');
    suggestions = JSON.parse(data);
  } catch {
    suggestions = [];
  }
}

async function saveSuggestions() {
  try {
    if (suggestions.length > 500) suggestions = suggestions.slice(-500);
    await writeFile(VIP_FILE, JSON.stringify(suggestions, null, 2));
  } catch {}
}

// ============ Detection ============

/**
 * Check if a message contains an improvement suggestion.
 */
export function detectSuggestion(text) {
  if (!text || text.length < MIN_SUGGESTION_LENGTH) return false;
  return SUGGESTION_PATTERNS.some(p => p.test(text));
}

/**
 * Check if user is on cooldown.
 */
function isOnCooldown(userId) {
  const last = userCooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

// ============ VIP Formatting ============

/**
 * Use Haiku to extract and format the suggestion as a VIP draft.
 */
async function formatAsVIP(text, username, chatTitle) {
  try {
    const resp = await llmChat({
      _background: true,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `You extract improvement suggestions from casual conversation and format them as structured VIP (VibeSwap Improvement Proposal) drafts.

Given a message that contains a suggestion, extract:
1. A clear title (5-10 words)
2. The type: Mechanism, Governance, Incentive, Infrastructure, or Community
3. A 2-sentence abstract of what they're proposing
4. Why it matters (1 sentence)

Format as:
TITLE: [title]
TYPE: [type]
ABSTRACT: [abstract]
MOTIVATION: [why it matters]

Be concise. Preserve the original intent — don't embellish or over-interpret.`,
      messages: [{
        role: 'user',
        content: `Message from @${username} in "${chatTitle || 'DM'}":\n\n"${text}"`,
      }],
    });

    if (resp.usage) {
      recordUsage('vip-detector', { input: resp.usage.input_tokens, output: resp.usage.output_tokens });
    }

    return resp.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  } catch (err) {
    console.warn(`[vip] Format failed: ${err.message}`);
    return null;
  }
}

// ============ Report to Will ============

/**
 * Process a detected suggestion and DM it to Will.
 * Returns true if reported, false if skipped (cooldown, etc.)
 */
export async function reportSuggestion(bot, ctx) {
  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'anon';
  const text = ctx.message?.text || '';
  const chatTitle = ctx.chat?.title || 'DM';
  const chatId = ctx.chat?.id;

  // Skip Will's own messages
  if (ctx.from.id === config.ownerUserId) return false;

  // Cooldown check
  if (isOnCooldown(userId)) return false;

  // Format as VIP
  const formatted = await formatAsVIP(text, username, chatTitle);
  if (!formatted) return false;

  // Assign next VIP number
  await loadSuggestions();
  const vipNumber = String(suggestions.length + 2).padStart(24, '0'); // +2 because VIP-0 and VIP-1 exist

  const suggestion = {
    vipNumber,
    userId,
    username,
    chatId,
    chatTitle,
    originalText: text.slice(0, 500),
    formatted,
    timestamp: Date.now(),
    status: 'pending', // pending → accepted → implemented | rejected
  };

  suggestions.push(suggestion);
  await saveSuggestions();
  userCooldowns.set(userId, Date.now());

  // DM Will
  try {
    const dmText = [
      `VIP-${vipNumber} (Draft)`,
      `From: @${username} in "${chatTitle}"`,
      '',
      formatted,
      '',
      `Original: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`,
      '',
      `Reply /vip_accept ${vipNumber} to approve`,
      `Reply /vip_reject ${vipNumber} to decline`,
    ].join('\n');

    await bot.telegram.sendMessage(config.ownerUserId, dmText);
    console.log(`[vip] Reported VIP-${vipNumber} from @${username} to Will`);
    return true;
  } catch (err) {
    console.warn(`[vip] Failed to DM Will: ${err.message}`);
    return false;
  }
}

// ============ Admin Commands ============

/**
 * Accept a VIP — creates GitHub issue if possible.
 */
export async function acceptVIP(vipNumber) {
  await loadSuggestions();
  const vip = suggestions.find(s => s.vipNumber === vipNumber);
  if (!vip) return { error: 'VIP not found' };
  vip.status = 'accepted';
  vip.acceptedAt = Date.now();
  await saveSuggestions();

  // TODO: Auto-create GitHub Issue
  // const { postGitHubIssue } from './social.js';
  // await postGitHubIssue(`[VIP-${vipNumber}] ${title}`, body);

  return { success: true, vip };
}

/**
 * Reject a VIP.
 */
export async function rejectVIP(vipNumber, reason) {
  await loadSuggestions();
  const vip = suggestions.find(s => s.vipNumber === vipNumber);
  if (!vip) return { error: 'VIP not found' };
  vip.status = 'rejected';
  vip.rejectedAt = Date.now();
  vip.rejectReason = reason || null;
  await saveSuggestions();
  return { success: true, vip };
}

/**
 * Get VIP stats.
 */
export async function getVIPStats() {
  await loadSuggestions();
  return {
    total: suggestions.length,
    pending: suggestions.filter(s => s.status === 'pending').length,
    accepted: suggestions.filter(s => s.status === 'accepted').length,
    rejected: suggestions.filter(s => s.status === 'rejected').length,
    implemented: suggestions.filter(s => s.status === 'implemented').length,
    recent: suggestions.slice(-5).map(s => ({
      vip: s.vipNumber,
      from: s.username,
      status: s.status,
      timestamp: s.timestamp,
    })),
  };
}

export async function flushVIPs() {
  await saveSuggestions();
}
