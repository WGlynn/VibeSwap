// ============ Hell — Deceiver Tracking System ============
//
// Automated trust enforcement / immune system for the Temple of Truth.
//
// Entry criteria:
//   1. Credible evidence (not just accusations)
//   2. Probabilistic consistency (pattern matches deception)
//   3. Behavioral alignment (actions confirm intent)
//
// Exit path: Repentance process ONLY. No automatic forgiveness.
//
// Identity tracking uses multi-signal heuristics (no DID at scale yet):
//   - Telegram userId (primary key — hard to spoof)
//   - Username history (tracks renames)
//   - Wallet addresses (linked via /linkwallet)
//   - Message fingerprint (writing style, timing patterns)
//   - IP/device heuristics from Telegram metadata
//   - Cross-reference with known aliases
//
// The state of being in Hell IS the punishment — businesses and services
// filter through this registry to avoid bad actors. Self-fulfilling prophecy.
// Credibly neutral: no punisher needed, just pattern recognition + consequence.
// ============

import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { createHash } from 'crypto';

const HELL_DIR = join(config.dataDir, 'knowledge', 'hell');
const REGISTRY_FILE = join(HELL_DIR, 'registry.json');
const AUDIT_LOG = join(HELL_DIR, 'audit.jsonl');

// In-memory registry
let registry = {
  entries: [],          // Array of deceiver entries
  identityGraph: {},    // identifier -> [linked identifiers]
  repented: [],         // Entries that completed repentance
};

let dirty = false;

// ============ Init ============

export async function initHell() {
  await mkdir(HELL_DIR, { recursive: true });

  try {
    const data = await readFile(REGISTRY_FILE, 'utf-8');
    registry = JSON.parse(data);
  } catch {
    // First run — empty registry
  }

  console.log(`[hell] Registry loaded — ${registry.entries.length} entries, ${registry.repented.length} repented`);
}

// ============ Flag Deceiver ============

export async function flagDeceiver(identifier, evidence, pattern, severity, meta = {}) {
  const timestamp = new Date().toISOString();
  const id = `hell-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Build identity fingerprint from available signals
  const fingerprint = buildFingerprint(identifier, meta);

  // Check if already flagged — if so, add to evidence chain
  const existing = findEntry(identifier);
  if (existing) {
    existing.evidenceChain.push({
      evidence,
      pattern,
      timestamp,
      flaggedBy: meta.flaggedBy || 'system',
    });
    existing.severity = escalateSeverity(existing.severity, severity);
    existing.lastUpdated = timestamp;
    existing.flagCount++;

    await _save();
    await _auditLog('evidence_added', { entryId: existing.id, identifier, evidence, severity });
    return existing;
  }

  const entry = {
    id,
    // ---- Identity Signals (multi-heuristic, hard to spoof) ----
    primaryIdentifier: identifier,
    identitySignals: fingerprint,
    knownAliases: [identifier],
    linkedWallets: meta.walletAddress ? [meta.walletAddress] : [],
    linkedTelegramIds: meta.flaggedByUserId ? [] : [],
    telegramUserId: _extractTelegramId(identifier, meta),

    // ---- Evidence ----
    evidenceChain: [{
      evidence,
      pattern,
      timestamp,
      flaggedBy: meta.flaggedBy || 'system',
    }],
    severity,
    deceptionPattern: pattern,

    // ---- Metadata ----
    flaggedAt: timestamp,
    lastUpdated: timestamp,
    flagCount: 1,
    status: 'active', // active | under_review | repented | exonerated

    // ---- Behavioral Fingerprint ----
    behavioralMarkers: {
      messageStyleHash: null,    // Will be populated by analysis
      activeHours: null,         // Typical activity window
      languagePatterns: null,    // Writing quirks
    },
  };

  registry.entries.push(entry);

  // Update identity graph
  _linkIdentity(identifier, meta);

  await _save();
  await _auditLog('flagged', { id, identifier, evidence, severity, pattern });

  console.log(`[hell] Flagged: "${identifier}" — severity: ${severity}, pattern: "${pattern.slice(0, 60)}"`);
  return entry;
}

// ============ Identity Heuristics ============

function buildFingerprint(identifier, meta = {}) {
  const signals = {
    identifierType: _classifyIdentifier(identifier),
    identifierHash: createHash('sha256').update(identifier.toLowerCase().trim()).digest('hex').slice(0, 16),
    chatId: meta.chatId || null,
    flaggedByUserId: meta.flaggedByUserId || null,
    timestamp: Date.now(),
  };

  return signals;
}

function _classifyIdentifier(identifier) {
  if (/^\d{5,15}$/.test(identifier)) return 'telegram_user_id';
  if (/^@/.test(identifier)) return 'telegram_username';
  if (/^0x[a-fA-F0-9]{40}$/.test(identifier)) return 'evm_wallet';
  if (/^ckb[a-z0-9]+$/.test(identifier)) return 'ckb_address';
  if (/\S+@\S+\.\S+/.test(identifier)) return 'email';
  return 'alias';
}

function _extractTelegramId(identifier, meta) {
  if (/^\d{5,15}$/.test(identifier)) return identifier;
  if (meta.flaggedByUserId && /^\d+$/.test(String(meta.flaggedByUserId))) return null;
  return null;
}

function _linkIdentity(identifier, meta) {
  const links = registry.identityGraph[identifier] || [];

  // Link wallet if available
  if (meta.walletAddress && !links.includes(meta.walletAddress)) {
    links.push(meta.walletAddress);
    registry.identityGraph[meta.walletAddress] = registry.identityGraph[meta.walletAddress] || [];
    if (!registry.identityGraph[meta.walletAddress].includes(identifier)) {
      registry.identityGraph[meta.walletAddress].push(identifier);
    }
  }

  registry.identityGraph[identifier] = links;
}

// ============ Search / Query ============

export function findEntry(identifier) {
  const idLower = identifier.toLowerCase().trim();

  // Direct match
  let entry = registry.entries.find(e =>
    e.primaryIdentifier.toLowerCase() === idLower ||
    e.knownAliases.some(a => a.toLowerCase() === idLower)
  );
  if (entry) return entry;

  // Check identity graph for linked identifiers
  const linked = registry.identityGraph[idLower];
  if (linked) {
    for (const link of linked) {
      entry = registry.entries.find(e =>
        e.primaryIdentifier.toLowerCase() === link.toLowerCase() ||
        e.knownAliases.some(a => a.toLowerCase() === link.toLowerCase())
      );
      if (entry) return entry;
    }
  }

  return null;
}

export function isInHell(identifier) {
  const entry = findEntry(identifier);
  return entry && entry.status === 'active';
}

export function checkIdentity(identifier) {
  const entry = findEntry(identifier);
  if (!entry) return { clean: true };
  return {
    clean: false,
    status: entry.status,
    severity: entry.severity,
    flagCount: entry.flagCount,
    flaggedAt: entry.flaggedAt,
    pattern: entry.deceptionPattern,
  };
}

// ============ Alias Linking ============
// When we discover that two identifiers are the same person

export async function linkAlias(existingIdentifier, newAlias) {
  const entry = findEntry(existingIdentifier);
  if (!entry) return false;

  if (!entry.knownAliases.includes(newAlias)) {
    entry.knownAliases.push(newAlias);
    entry.lastUpdated = new Date().toISOString();
    _linkIdentity(newAlias, {});

    // Cross-link in identity graph
    registry.identityGraph[newAlias] = registry.identityGraph[newAlias] || [];
    if (!registry.identityGraph[newAlias].includes(existingIdentifier)) {
      registry.identityGraph[newAlias].push(existingIdentifier);
    }
    registry.identityGraph[existingIdentifier] = registry.identityGraph[existingIdentifier] || [];
    if (!registry.identityGraph[existingIdentifier].includes(newAlias)) {
      registry.identityGraph[existingIdentifier].push(newAlias);
    }

    await _save();
    await _auditLog('alias_linked', { entryId: entry.id, existingIdentifier, newAlias });
    return true;
  }
  return false;
}

// ============ Behavioral Fingerprinting ============
// Analyze message patterns to detect sockpuppets / identity evasion

export function updateBehavioralFingerprint(identifier, message) {
  const entry = findEntry(identifier);
  if (!entry) return;

  // Simple writing style hash (word frequency distribution)
  const words = message.toLowerCase().split(/\s+/);
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + ' ' + words[i + 1]);
  }
  const styleHash = createHash('sha256')
    .update(bigrams.sort().join('|'))
    .digest('hex')
    .slice(0, 16);

  entry.behavioralMarkers.messageStyleHash = styleHash;

  // Track active hours
  const hour = new Date().getUTCHours();
  if (!entry.behavioralMarkers.activeHours) {
    entry.behavioralMarkers.activeHours = new Array(24).fill(0);
  }
  entry.behavioralMarkers.activeHours[hour]++;

  dirty = true;
}

// Compare writing style between two identifiers (sockpuppet detection)
export function compareStyles(identifier1, identifier2) {
  const e1 = findEntry(identifier1);
  const e2 = findEntry(identifier2);
  if (!e1?.behavioralMarkers?.messageStyleHash || !e2?.behavioralMarkers?.messageStyleHash) return 0;

  // Simple: if style hashes match, high similarity
  if (e1.behavioralMarkers.messageStyleHash === e2.behavioralMarkers.messageStyleHash) return 1.0;

  // Compare active hours distribution if available
  if (e1.behavioralMarkers.activeHours && e2.behavioralMarkers.activeHours) {
    let overlap = 0;
    let total = 0;
    for (let i = 0; i < 24; i++) {
      overlap += Math.min(e1.behavioralMarkers.activeHours[i], e2.behavioralMarkers.activeHours[i]);
      total += Math.max(e1.behavioralMarkers.activeHours[i], e2.behavioralMarkers.activeHours[i]);
    }
    return total > 0 ? overlap / total : 0;
  }

  return 0;
}

// ============ Severity ============

function escalateSeverity(current, incoming) {
  const levels = ['minor', 'moderate', 'severe', 'critical'];
  const currentIdx = levels.indexOf(current);
  const incomingIdx = levels.indexOf(incoming);
  return levels[Math.max(currentIdx, incomingIdx)];
}

// ============ Repentance Process ============

export async function initiateRepentance(identifier, statement) {
  const entry = findEntry(identifier);
  if (!entry) return { error: 'Not found in registry' };
  if (entry.status === 'repented') return { error: 'Already repented' };

  entry.status = 'under_review';
  entry.repentanceStatement = statement;
  entry.repentanceRequestedAt = new Date().toISOString();

  await _save();
  await _auditLog('repentance_requested', { entryId: entry.id, identifier, statement });

  return { status: 'under_review', message: 'Repentance request submitted for review.' };
}

export async function approveRepentance(identifier, approvedBy) {
  const entry = findEntry(identifier);
  if (!entry) return { error: 'Not found' };
  if (entry.status !== 'under_review') return { error: 'Not under review' };

  entry.status = 'repented';
  entry.repentedAt = new Date().toISOString();
  entry.repentanceApprovedBy = approvedBy;

  // Move to repented list
  registry.repented.push({
    ...entry,
    movedAt: new Date().toISOString(),
  });

  // Remove from active entries
  registry.entries = registry.entries.filter(e => e.id !== entry.id);

  await _save();
  await _auditLog('repentance_approved', { entryId: entry.id, identifier, approvedBy });

  console.log(`[hell] Repentance approved: "${identifier}" — cleared from registry`);
  return { status: 'repented', message: 'Repentance approved. Record moved to repented archive.' };
}

// ============ Stats ============

export function getHellStats() {
  const severityCounts = { minor: 0, moderate: 0, severe: 0, critical: 0 };
  for (const entry of registry.entries) {
    severityCounts[entry.severity] = (severityCounts[entry.severity] || 0) + 1;
  }

  return {
    activeEntries: registry.entries.length,
    repentedEntries: registry.repented.length,
    totalIdentities: Object.keys(registry.identityGraph).length,
    severityCounts,
    oldestEntry: registry.entries[0]?.flaggedAt || null,
    newestEntry: registry.entries[registry.entries.length - 1]?.flaggedAt || null,
  };
}

export function getRegistry() {
  return registry.entries.map(e => ({
    id: e.id,
    identifier: e.primaryIdentifier,
    aliases: e.knownAliases,
    severity: e.severity,
    status: e.status,
    flagCount: e.flagCount,
    pattern: e.deceptionPattern,
    flaggedAt: e.flaggedAt,
  }));
}

// ============ Persistence ============

async function _save() {
  try {
    await mkdir(HELL_DIR, { recursive: true });
    await writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    dirty = false;
  } catch (err) {
    console.error(`[hell] Save failed: ${err.message}`);
  }
}

async function _auditLog(event, data) {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
  try {
    await appendFile(AUDIT_LOG, JSON.stringify(entry) + '\n');
  } catch {}
}

export async function flushHell() {
  if (dirty) await _save();
}
