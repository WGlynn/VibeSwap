// ============ Shadow Protocol — Private Pseudonymous Identities ============
//
// Allows high-profile individuals to participate in VibeSwap privately.
// They interact with JARVIS under codenames. Real identity is encrypted
// and visible only to the owner (Will).
//
// Flow:
//   1. Owner runs /shadow → generates single-use invite token
//   2. Famous person opens bot, sends /join <token>
//   3. JARVIS assigns a codename, encrypts their real Telegram identity
//   4. They interact freely — all contributions attributed to codename
//   5. Owner can /shadows to see all shadow identities (decrypted)
//   6. Nobody else can link codename ↔ real identity
//
// Storage: data/shadows.json (encrypted at rest)
// Crypto: AES-256-GCM via Rosetta Stone Protocol (privacy.js)
// ============

import { randomBytes, createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { encrypt, decrypt, isEncryptionEnabled } from './privacy.js';

// ============ State ============

let shadows = new Map();       // codename -> { telegramId (encrypted), joinedAt, contributions, status }
let pendingInvites = new Map(); // token -> { createdAt, createdBy, note, expiresAt }
let idToCodename = new Map();   // telegramId -> codename (runtime only, never persisted in plaintext)
const SHADOWS_FILE = () => join(config.dataDir, 'shadows.json');

// ============ Codename Generator ============
// Two-word codenames: [adjective] [noun] — memorable, anonymous, dignified

const ADJECTIVES = [
  'Silent', 'Midnight', 'Crimson', 'Iron', 'Phantom', 'Velvet', 'Arctic',
  'Ember', 'Cobalt', 'Onyx', 'Jade', 'Sterling', 'Raven', 'Solar', 'Ghost',
  'Neon', 'Frost', 'Amber', 'Obsidian', 'Echo', 'Nova', 'Lunar', 'Prism',
  'Chrome', 'Indigo', 'Titan', 'Shadow', 'Copper', 'Storm', 'Coral',
  'Ivory', 'Scarlet', 'Dusk', 'Zenith', 'Cipher', 'Vortex', 'Drift',
  'Flare', 'Omega', 'Pulse', 'Sage', 'Azure', 'Granite', 'Nexus',
];

const NOUNS = [
  'Wolf', 'Falcon', 'Phoenix', 'Orchid', 'Tiger', 'Serpent', 'Hawk',
  'Panther', 'Fox', 'Eagle', 'Bear', 'Lynx', 'Viper', 'Crane', 'Shark',
  'Lion', 'Raven', 'Orca', 'Jaguar', 'Owl', 'Stallion', 'Mantis', 'Cobra',
  'Sparrow', 'Condor', 'Heron', 'Osprey', 'Coyote', 'Drake', 'Wren',
  'Raptor', 'Puma', 'Gazelle', 'Mongoose', 'Ibis', 'Kestrel', 'Merlin',
  'Sable', 'Tempest', 'Zenith', 'Aegis', 'Bastion', 'Forge', 'Sentinel',
];

function generateCodename() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const codename = `${adj} ${noun}`;
  // Ensure uniqueness
  if (shadows.has(codename)) return generateCodename();
  return codename;
}

// ============ Token Generation ============

function generateToken() {
  return randomBytes(16).toString('hex');
}

// ============ Init ============

export async function initShadow() {
  try {
    const raw = await readFile(SHADOWS_FILE(), 'utf-8');
    const data = JSON.parse(raw);

    // Restore shadows
    if (data.shadows) {
      for (const [codename, info] of Object.entries(data.shadows)) {
        shadows.set(codename, info);
        // Rebuild runtime lookup (decrypt telegramId)
        try {
          const decryptedId = isEncryptionEnabled()
            ? decrypt(info.telegramId, deriveKey('shadow-identity'))
            : info.telegramId;
          idToCodename.set(decryptedId, codename);
        } catch {
          // Key mismatch or corruption — skip this shadow
        }
      }
    }

    // Restore pending invites
    if (data.invites) {
      const now = Date.now();
      for (const [token, info] of Object.entries(data.invites)) {
        // Skip expired invites (7 days)
        if (info.expiresAt && info.expiresAt < now) continue;
        pendingInvites.set(token, info);
      }
    }

    console.log(`[shadow] Loaded ${shadows.size} shadow identities, ${pendingInvites.size} pending invites`);
  } catch {
    console.log('[shadow] No existing shadow data — starting fresh');
  }
}

// ============ Persistence ============

export async function flushShadow() {
  const data = {
    shadows: Object.fromEntries(shadows),
    invites: Object.fromEntries(pendingInvites),
    lastUpdated: new Date().toISOString(),
  };
  await writeFile(SHADOWS_FILE(), JSON.stringify(data, null, 2));
}

// ============ Invite Management ============

export function createInvite(createdBy, note = '') {
  const token = generateToken();
  const now = Date.now();
  pendingInvites.set(token, {
    createdAt: now,
    createdBy,
    note,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  return token;
}

export function consumeInvite(token) {
  const invite = pendingInvites.get(token);
  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt < Date.now()) {
    pendingInvites.delete(token);
    return null;
  }
  pendingInvites.delete(token);
  return invite;
}

// ============ Shadow Identity ============

export function registerShadow(telegramId, invite) {
  const id = String(telegramId);

  // Already registered?
  if (idToCodename.has(id)) {
    return { codename: idToCodename.get(id), existing: true };
  }

  const codename = generateCodename();

  // Encrypt the real Telegram ID
  const encryptedId = isEncryptionEnabled()
    ? encrypt(id, deriveKey('shadow-identity'))
    : id;

  shadows.set(codename, {
    telegramId: encryptedId,
    joinedAt: new Date().toISOString(),
    inviteNote: invite?.note || '',
    contributions: 0,
    status: 'active',
  });

  idToCodename.set(id, codename);
  return { codename, existing: false };
}

export function isShadow(telegramId) {
  return idToCodename.has(String(telegramId));
}

export function getShadowCodename(telegramId) {
  return idToCodename.get(String(telegramId)) || null;
}

export function incrementContribution(telegramId) {
  const codename = idToCodename.get(String(telegramId));
  if (!codename) return;
  const shadow = shadows.get(codename);
  if (shadow) shadow.contributions++;
}

// ============ Owner View (decrypted) ============

export function listShadows() {
  const result = [];
  for (const [codename, info] of shadows.entries()) {
    let realId = '[encrypted]';
    try {
      realId = isEncryptionEnabled()
        ? decrypt(info.telegramId, deriveKey('shadow-identity'))
        : info.telegramId;
    } catch { /* can't decrypt */ }

    result.push({
      codename,
      telegramId: realId,
      joinedAt: info.joinedAt,
      contributions: info.contributions,
      status: info.status,
      note: info.inviteNote,
    });
  }
  return result;
}

export function listPendingInvites() {
  const result = [];
  const now = Date.now();
  for (const [token, info] of pendingInvites.entries()) {
    const expired = info.expiresAt && info.expiresAt < now;
    result.push({
      token: token.slice(0, 8) + '...',  // Truncated for display
      fullToken: token,
      note: info.note,
      createdAt: new Date(info.createdAt).toISOString(),
      expired,
      expiresIn: expired ? 'expired' : `${Math.round((info.expiresAt - now) / 3600000)}h`,
    });
  }
  return result;
}

export function revokeShadow(codename) {
  const shadow = shadows.get(codename);
  if (!shadow) return false;
  shadow.status = 'revoked';
  // Remove from runtime lookup
  for (const [id, cn] of idToCodename.entries()) {
    if (cn === codename) {
      idToCodename.delete(id);
      break;
    }
  }
  return true;
}

// ============ Stats ============

export function getShadowStats() {
  const active = [...shadows.values()].filter(s => s.status === 'active').length;
  const revoked = [...shadows.values()].filter(s => s.status === 'revoked').length;
  const totalContributions = [...shadows.values()].reduce((sum, s) => sum + s.contributions, 0);
  return {
    total: shadows.size,
    active,
    revoked,
    pendingInvites: pendingInvites.size,
    totalContributions,
  };
}

// ============ Key Derivation (uses privacy engine pattern) ============

function deriveKey(context) {
  // Deterministic key derivation from master key context
  // Uses SHA-256 as a simple KDF (privacy.js handles the heavy crypto)
  const masterKeyHex = config.privacy?.masterKey || 'shadow-default-key';
  return createHash('sha256').update(`${masterKeyHex}:shadow:${context}`).digest();
}
