// ============ Command Relay — Telegram → Claude Code Bridge ============
//
// When Will is mobile, he can send commands to JARVIS on Telegram that
// get written to a relay file. Claude Code sessions can watch this file
// for incoming directives.
//
// Flow:
//   1. Will sends "/relay fix the mining bug" on Telegram
//   2. JARVIS writes to data/relay-commands.json
//   3. Claude Code reads the file and acts on it
//
// The relay is append-only with timestamps. Claude Code marks commands
// as acknowledged. This is a one-way bridge (TG → desktop).
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const RELAY_FILE = join(DATA_DIR, 'relay-commands.json');
const MAX_COMMANDS = 100;

let commands = [];
let dirty = false;

// ============ Init ============

export async function initRelay() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(RELAY_FILE, 'utf-8');
    commands = JSON.parse(raw);
  } catch {
    commands = [];
  }
  console.log(`[relay] Loaded ${commands.length} relay commands`);
}

// ============ Add Command ============

/**
 * Add a command from Telegram to the relay queue.
 * @param {object} params
 * @param {string} params.userId - Telegram user ID
 * @param {string} params.username - Display name
 * @param {string} params.command - The instruction text
 * @param {string} [params.priority] - 'normal' | 'urgent'
 * @returns {object} The created command entry
 */
export function addRelayCommand({ userId, username, command, priority }) {
  const entry = {
    id: `relay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: String(userId),
    username,
    command,
    priority: priority || 'normal',
    timestamp: Date.now(),
    acknowledged: false,
    acknowledgedAt: null,
  };

  commands.push(entry);

  // Prune old commands
  if (commands.length > MAX_COMMANDS) {
    commands = commands.slice(-MAX_COMMANDS);
  }

  dirty = true;
  console.log(`[relay] Command queued from ${username}: "${command.slice(0, 60)}..."`);
  return entry;
}

// ============ Read Pending Commands ============

/**
 * Get all unacknowledged relay commands.
 * Called by Claude Code to check for pending instructions.
 */
export function getPendingCommands() {
  return commands.filter(c => !c.acknowledged);
}

/**
 * Mark a command as acknowledged by Claude Code.
 */
export function acknowledgeCommand(commandId) {
  const cmd = commands.find(c => c.id === commandId);
  if (cmd) {
    cmd.acknowledged = true;
    cmd.acknowledgedAt = Date.now();
    dirty = true;
    return true;
  }
  return false;
}

/**
 * Mark all pending commands as acknowledged.
 */
export function acknowledgeAll() {
  let count = 0;
  for (const cmd of commands) {
    if (!cmd.acknowledged) {
      cmd.acknowledged = true;
      cmd.acknowledgedAt = Date.now();
      count++;
    }
  }
  if (count > 0) dirty = true;
  return count;
}

// ============ Persistence ============

export async function flushRelay() {
  if (!dirty) return;
  try {
    await writeFile(RELAY_FILE, JSON.stringify(commands, null, 2));
    dirty = false;
  } catch (err) {
    console.error(`[relay] Failed to save: ${err.message}`);
  }
}
