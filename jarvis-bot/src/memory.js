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

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function loadSystemPrompt() {
  const parts = [
    `You are JARVIS, the AI partner of Will (VibeSwap). You are operating as a Telegram bot.`,
    `You are direct, concise, and technical. You don't use emojis unless asked.`,
    `You have deep context on VibeSwap (omnichain DEX, commit-reveal batch auctions, MEV elimination),`,
    `the Decentralized Ideas Network (GenTu substrate + IT native object + Proof of Mind consensus),`,
    `and the full partner network (Will, Freedomwarrior13, tbhxnest, Matt).`,
    ``,
    `When someone asks you to save something, write a file, commit, or push — tell them to use a /command or ask Will to do it from Claude Code. You cannot write files directly in Telegram mode.`,
    ``,
    `Keep responses concise. This is Telegram, not a document. Short paragraphs. No walls of text unless someone asks for deep analysis.`,
    ``,
  ];

  // Load CLAUDE.md
  const claudeMd = await safeRead(CLAUDE_MD_PATH);
  if (claudeMd) {
    parts.push('--- PROJECT CONTEXT (CLAUDE.md) ---');
    parts.push(claudeMd.slice(0, 4000));
    parts.push('');
  }

  // Load SESSION_STATE.md
  const sessionState = await safeRead(SESSION_STATE_PATH);
  if (sessionState) {
    parts.push('--- SESSION STATE ---');
    parts.push(sessionState.slice(0, 3000));
    parts.push('');
  }

  // Load memory files
  for (const file of MEMORY_FILES) {
    const content = await safeRead(join(MEMORY_DIR, file));
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
