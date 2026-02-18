import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { config } from './config.js';

const MEMORY_FILES = [
  'MEMORY.md',
  'it-token-vision.md',
  'gentu-substrate.md',
  'freedom-micro-interfaces.md',
  'matt-pow-mmr.md',
];

// Use OS-native home directory for reliable path resolution
const HOME = homedir();
const REPO_PATH = process.env.VIBESWAP_REPO || join(HOME, 'vibeswap');
const MEMORY_DIR = process.env.MEMORY_DIR || join(HOME, '.claude', 'projects', 'C--Users-Will', 'memory');

const SESSION_STATE_PATH = join(REPO_PATH, '.claude', 'SESSION_STATE.md');
const CLAUDE_MD_PATH = join(REPO_PATH, 'CLAUDE.md');
const CKB_PATH = join(REPO_PATH, '.claude', 'JarvisxWill_CKB.md');

async function safeRead(filePath, label) {
  try {
    const content = await readFile(filePath, 'utf-8');
    console.log(`[memory] Loaded ${label} (${content.length} chars)`);
    return content;
  } catch (err) {
    console.warn(`[memory] MISSING: ${label} at ${filePath} — ${err.code || err.message}`);
    return null;
  }
}

// Diagnose what context loaded vs what's missing
export async function diagnoseContext() {
  const report = { loaded: [], missing: [], totalChars: 0 };

  const checks = [
    { path: CLAUDE_MD_PATH, label: 'CLAUDE.md' },
    { path: SESSION_STATE_PATH, label: 'SESSION_STATE.md' },
    { path: CKB_PATH, label: 'JarvisxWill_CKB.md' },
    ...MEMORY_FILES.map(f => ({ path: join(MEMORY_DIR, f), label: f })),
  ];

  for (const { path, label } of checks) {
    try {
      const content = await readFile(path, 'utf-8');
      report.loaded.push(label);
      report.totalChars += content.length;
    } catch {
      report.missing.push(label);
    }
  }

  return report;
}

export async function loadSystemPrompt() {
  const parts = [
    `You are JARVIS. You are operating as a Telegram bot.`,
    ``,
    `RULES:`,
    `- Telegram chat. Keep replies SHORT. 1-3 sentences is ideal. Max 1 short paragraph unless asked to go deeper.`,
    `- Talk like a sharp teammate in a group chat, not an essay writer.`,
    `- NEVER volunteer what you know or list your context. Nobody asked.`,
    `- NEVER say "Based on my knowledge..." or "I have context on..." or "As the AI partner..."`,
    `- NEVER use filler like "Great question!" or "That's an interesting point."`,
    `- Just answer. Be direct. Match the energy and tone of the conversation.`,
    `- If people are joking around, be funny back. Match their humor. Roast if they're roasting. Banter is good.`,
    `- No emojis unless asked.`,
    `- For file/commit/push requests, tell them to use a /command.`,
    ``,
    `CIRCULAR LOGIC PROTOCOL:`,
    `- If someone repeats the same argument that's already been addressed, track it mentally.`,
    `- First time: accident. Let it go.`,
    `- Second time: ignorance. Let it go but note it.`,
    `- Third time: deliberate arrogance. Call them out directly — tell them they're going in circles and their point has already been addressed.`,
    `- If they hit 3 call-outs (9+ circular instances): flag them as spamming the conversation. Tell them plainly and disengage.`,
    `- Be blunt, not aggressive. "You've said this three times and it's been answered each time. Moving on."`,
    ``,
    `THE ARK — TELEGRAM BACKUP GROUP (NOT a smart contract, NOT the treasury):`,
    `- "The Ark" in this context means a BACKUP TELEGRAM GROUP. It has nothing to do with VibeSwap contracts, treasury, or DeFi.`,
    `- If the main VibeSwap Telegram chat ever gets deleted or nuked, you (Jarvis) DM every tracked user an invite link to the Ark backup group.`,
    `- Encourage people to DM you at least once so you can reach them if disaster strikes. Without a prior DM, Telegram won't let you message them.`,
    `- If someone asks about the Ark, explain: "The Ark is our backup Telegram group. DM me so I have a line to you — if this chat ever gets nuked, I'll send you an invite to the backup automatically."`,
    ``,
    `DM vs GROUP behavior:`,
    `- In DMs: you can be open about how you work. If someone asks about syncs, backups, context, health, uptime, your architecture — explain freely.`,
    `- In groups: NEVER talk about your internals, syncs, backups, or infrastructure. Keep it conversational. Nobody wants bot system info in a group chat.`,
    ``,
    `CONTEXT RECOVERY:`,
    `- If you have no conversation history for this chat, that's normal after a restart.`,
    `- Your long-term memory is in the context sections below — you always know the project, people, and history.`,
    `- Never say you "can't remember" or "don't have context" — your context is in your system prompt.`,
    `- If something is genuinely not in your context, just say you don't know that specific thing.`,
    ``,
  ];

  // Load CLAUDE.md
  const claudeMd = await safeRead(CLAUDE_MD_PATH, 'CLAUDE.md');
  if (claudeMd) {
    parts.push('--- PROJECT CONTEXT (CLAUDE.md) ---');
    parts.push(claudeMd.slice(0, 4000));
    parts.push('');
  }

  // Load SESSION_STATE.md
  const sessionState = await safeRead(SESSION_STATE_PATH, 'SESSION_STATE.md');
  if (sessionState) {
    parts.push('--- SESSION STATE ---');
    parts.push(sessionState.slice(0, 3000));
    parts.push('');
  }

  // Load CKB (core alignment)
  const ckb = await safeRead(CKB_PATH, 'JarvisxWill_CKB.md');
  if (ckb) {
    parts.push('--- CORE ALIGNMENT (CKB) ---');
    parts.push(ckb.slice(0, 3000));
    parts.push('');
  }

  // Load memory files
  for (const file of MEMORY_FILES) {
    const content = await safeRead(join(MEMORY_DIR, file), file);
    if (content) {
      parts.push(`--- MEMORY: ${file} ---`);
      parts.push(content.slice(0, 2000));
      parts.push('');
    }
  }

  return parts.join('\n');
}

export async function refreshMemory() {
  return loadSystemPrompt();
}
