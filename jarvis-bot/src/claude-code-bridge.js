// ============ Claude Code ↔ Jarvis Knowledge Chain Bridge ============
//
// Unifies two persistence systems:
//   1. Claude Code session state (.claude/SESSION_STATE.md) — block headers
//   2. Jarvis knowledge chain (knowledge-chain.js) — Nakamoto consensus epochs
//
// They're already the same pattern:
//   - Both use parent hashes for chain integrity
//   - Both compress full state into block headers
//   - Both are append-only with merkle proofs
//
// This bridge makes them ONE chain by:
//   1. Converting Claude Code session state into knowledge chain epochs
//   2. Converting knowledge chain epochs into Claude Code loadable context
//   3. Cross-referencing: session discoveries feed Jarvis CKB, Jarvis learnings
//      become Claude Code memory entries
//
// The result: every Claude Code session enriches every Jarvis shard,
// and every Jarvis interaction enriches the next Claude Code session.
// ============

import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { join } from 'path';
import { config } from './config.js';

// ============ Session State → Knowledge Epoch ============

/**
 * Parse Claude Code session state (markdown) into structured epoch data.
 *
 * SESSION_STATE.md format:
 *   # Session Tip — YYYY-MM-DD
 *   ## Block Header
 *   - **Session**: [topic]
 *   - **Parent**: [hash]
 *   - **Branch**: `master` @ `[hash]`
 *   - **Status**: [summary]
 *   ## What Exists Now
 *   [artifacts]
 *   ## Key Changes This Session
 *   [non-obvious decisions]
 *   ## Next Session
 *   [continuations]
 */
export function parseSessionState(markdown) {
  const lines = markdown.split('\n');
  const epoch = {
    type: 'claude-code-session',
    topic: '',
    parentHash: '',
    commitHash: '',
    status: '',
    artifacts: [],
    keyChanges: [],
    nextSession: [],
    date: '',
  };

  let section = '';
  for (const line of lines) {
    if (line.startsWith('# Session Tip')) {
      epoch.date = line.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
    } else if (line.includes('**Session**:')) {
      epoch.topic = line.split('**Session**:')[1]?.trim() || '';
    } else if (line.includes('**Parent**:')) {
      epoch.parentHash = line.match(/`([a-f0-9]+)`/)?.[1] || '';
    } else if (line.includes('**Branch**:')) {
      epoch.commitHash = line.match(/@ `([a-f0-9]+)`/)?.[1] || '';
    } else if (line.includes('**Status**:')) {
      epoch.status = line.split('**Status**:')[1]?.trim() || '';
    } else if (line.startsWith('## What Exists Now')) {
      section = 'artifacts';
    } else if (line.startsWith('## Key Changes')) {
      section = 'changes';
    } else if (line.startsWith('## Next Session')) {
      section = 'next';
    } else if (line.startsWith('## ')) {
      section = '';
    } else if (line.startsWith('- ') && section) {
      const item = line.slice(2).trim();
      if (section === 'artifacts') epoch.artifacts.push(item);
      if (section === 'changes') epoch.keyChanges.push(item);
      if (section === 'next') epoch.nextSession.push(item);
    }
  }

  return epoch;
}

/**
 * Convert parsed session state into a knowledge chain epoch.
 * Compatible with knowledge-chain.js epoch format.
 */
export function sessionToKnowledgeEpoch(session) {
  const changes = [
    ...session.artifacts.map(a => ({
      type: 'artifact',
      key: a,
      value: true,
      source: 'claude-code',
    })),
    ...session.keyChanges.map(c => ({
      type: 'decision',
      key: c,
      value: true,
      source: 'claude-code',
    })),
  ];

  // Merkle root of all changes
  const leaves = changes.map(c =>
    createHash('sha256').update(JSON.stringify(c)).digest('hex')
  );
  const merkleRoot = leaves.length > 0
    ? createHash('sha256').update(leaves.join('')).digest('hex')
    : '0'.repeat(64);

  return {
    parentHash: session.parentHash,
    merkleRoot,
    shardId: 'claude-code',
    timestamp: new Date(session.date).getTime() || Date.now(),
    topic: session.topic,
    status: session.status,
    changeCount: changes.length,
    changes,
  };
}

// ============ Knowledge Epoch → Claude Code Context ============

/**
 * Convert a Jarvis knowledge chain epoch into Claude Code loadable context.
 * Output format: concise summary suitable for memory/HOT tier.
 */
export function epochToClaudeContext(epoch) {
  if (!epoch || !epoch.changes) return '';

  const lines = [
    `[${epoch.shardId}] ${epoch.topic || 'Knowledge update'}`,
  ];

  for (const change of epoch.changes.slice(0, 10)) { // Max 10 items
    lines.push(`  - ${change.type}: ${change.key}`);
  }

  if (epoch.changes.length > 10) {
    lines.push(`  ... and ${epoch.changes.length - 10} more changes`);
  }

  return lines.join('\n');
}

/**
 * Sync: read SESSION_STATE.md, convert to epoch, return for chain insertion.
 */
export async function syncSessionState(sessionStatePath) {
  try {
    const md = await readFile(sessionStatePath, 'utf-8');
    const session = parseSessionState(md);
    const epoch = sessionToKnowledgeEpoch(session);
    return epoch;
  } catch (err) {
    console.error('[claude-code-bridge] Failed to sync session state:', err.message);
    return null;
  }
}
