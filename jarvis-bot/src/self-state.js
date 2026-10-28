// ============ Self-State — live facts the bot can state about its own setup ============
//
// Injected into every system prompt so questions like "why didn't you answer in the
// group?" get the real cause (this chat's mode, privacy mode) instead of a guess.

import { execSync } from 'child_process';
import { platform } from 'os';
import { getChatMode } from './directives.js';
import { getProviderName, getModelName, getRouterStats } from './llm-provider.js';
import { FEED_DIR } from './feed.js';

const STARTED_AT = new Date().toISOString();
let COMMIT = 'unknown';
try {
  COMMIT = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const dirty = execSync('git status --porcelain -- .', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (dirty) COMMIT += ' plus uncommitted local changes';
} catch {}

let botInfo = null;
export function noteBotInfo(info) {
  if (info && !botInfo) botInfo = info;
}

let contextReport = null;
export function noteContextReport(report) {
  contextReport = report;
}

// Mirrors directives.js (modes) and the output gate in index.js.
const MODE_MEANING = {
  normal: 'full engagement: you may answer any message, including plain mentions of your name, and post proactively',
  'tag-only': 'you answer only when tagged with your @username or when someone replies to one of your messages; plain mentions of your name get no answer',
  quiet: 'complete silence; only mode changes are processed',
};

export function selfStateBlock(chatId, chatType) {
  const lines = [
    '\n\n## SELF-STATE (live facts about your own setup; when asked about yourself, state these instead of guessing)',
    `- Host: a local process on Will's PC (${platform()}), started ${STARTED_AT}, up ${Math.round(process.uptime() / 60)} min. You are offline whenever that PC sleeps or restarts.`,
    `- Code: vibeswap/jarvis-bot at commit ${COMMIT}.`,
    `- Model: ${getProviderName()} / ${getModelName()}; providers available: ${getRouterStats().providers.join(', ') || 'none'}. Inference is free-tier only by Will's rule; paid providers are disabled.`,
  ];
  if (botInfo) {
    lines.push(`- Telegram: @${botInfo.username}. Group privacy mode is ${botInfo.can_read_all_group_messages
      ? 'OFF: you receive every message in groups you belong to'
      : 'ON: in groups you only receive commands, @mentions and replies to you'}.`);
  }
  if (chatType === 'private') {
    lines.push('- This chat: a private DM.');
  } else {
    const mode = getChatMode(chatId);
    lines.push(`- This chat's mode: ${mode} (${MODE_MEANING[mode] || 'unknown mode'}). Anyone can change it by addressing you: "jarvis normal mode", "jarvis tag only", or "jarvis be quiet".`);
  }
  if (contextReport) {
    lines.push(`- Context loaded at boot: ${contextReport.loaded.join(', ') || 'none'}${contextReport.missing.length ? `; missing: ${contextReport.missing.join(', ')}` : ''}. MEMORY.md is the memory INDEX only; the individual memory files it lists are not loaded.`);
  }
  lines.push('- Per message you also get: the CKB (knowledge kept per user and per group) and topic cells (CKA = Cell Knowledge Architecture).');
  lines.push(`- Notes: your exchanges are copied to a local feed (${FEED_DIR}) that Will's Claude Code Jarvis reads. If anyone asks whether you keep notes, say yes. The exchange log is output only: you write it, you never read it. One file in that folder goes the other way: now.md is written FOR you by Claude Code Jarvis (Will's current focus and recent commits on his public repos) and is part of your context, loaded at boot and on each prompt reload.`);
  return lines.join('\n');
}
