// ============ Privacy Engine — Rosetta Stone Protocol ============
//
// All crypto operations centralized here (Hot/Cold separation — crypto is the "hot zone").
//
// Architecture:
//   - MASTER_KEY derived from env var (JARVIS_MASTER_KEY) via PBKDF2, or auto-generated on first boot
//   - Per-user keys: HKDF(masterKey, "user:" + userId) — deterministic, no key storage needed
//   - Per-group keys: HKDF(masterKey, "group:" + groupId)
//   - Skills key: HKDF(masterKey, "skills")
//
// Encryption: AES-256-GCM (authenticated encryption)
// Integrity: HMAC-SHA256 for Network knowledge
//
// Uses ONLY Node.js built-in crypto module — zero external dependencies.
//
// Privacy tiers mapped to encryption:
//   Private   → AES-256-GCM, per-user key, owner only
//   Shared    → AES-256-GCM, per-CKB key, session-scoped
//   Mutual    → AES-256-GCM, per-CKB key, persisted
//   Common    → AES-256-GCM, per-CKB key, persisted
//   Network   → HMAC integrity only, master key, all CKBs
//   Public    → Plaintext, no encryption
//
// Core principle (RSP): Knowledge never leaves its encryption boundary.
// Context is built server-side (compute-to-data). CKB files stay encrypted at rest;
// only the facts needed for a conversation are decrypted in-memory, used, and discarded.
// ============

import { createCipheriv, createDecipheriv, createHmac, randomBytes, pbkdf2Sync, hkdfSync, createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

// ============ State ============

let masterKey = null;
let initialized = false;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM recommended IV length
const TAG_LENGTH = 16;      // GCM auth tag length
const KEY_LENGTH = 32;      // 256 bits
const SALT = 'jarvis-privacy-v1'; // Static salt for PBKDF2 (key is already high entropy)
const PBKDF2_ITERATIONS = 100000;

// ============ Init ============

export async function initPrivacy() {
  if (!config.privacy?.encryptionEnabled) {
    console.log('[privacy] Encryption DISABLED by config.');
    initialized = false;
    return;
  }

  const masterKeyHex = config.privacy?.masterKey;

  if (masterKeyHex) {
    // Derive from env var via PBKDF2 (handles both raw hex keys and passphrases)
    masterKey = pbkdf2Sync(masterKeyHex, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
    console.log(`[privacy] Master key loaded from env (fingerprint: ${getKeyFingerprint(masterKey)})`);
  } else {
    // Auto-generate on first boot
    masterKey = await loadOrGenerateMasterKey();
  }

  initialized = true;
  console.log('[privacy] Privacy engine initialized. Encryption ENABLED.');
}

async function loadOrGenerateMasterKey() {
  const keyDir = config.dataDir;
  const keyFile = join(keyDir, '.master-key');

  try {
    const hex = await readFile(keyFile, 'utf-8');
    const key = Buffer.from(hex.trim(), 'hex');
    if (key.length !== KEY_LENGTH) throw new Error('Invalid key length');
    console.log(`[privacy] Master key loaded from ${keyFile} (fingerprint: ${getKeyFingerprint(key)})`);
    return key;
  } catch {
    // Generate new key
    const key = randomBytes(KEY_LENGTH);
    await mkdir(keyDir, { recursive: true });
    await writeFile(keyFile, key.toString('hex'), { mode: 0o600 });

    console.log('============================================================');
    console.log('[privacy] MASTER KEY GENERATED — BACK THIS UP!');
    console.log(`[privacy] Location: ${keyFile}`);
    console.log(`[privacy] Fingerprint: ${getKeyFingerprint(key)}`);
    console.log(`[privacy] Hex: ${key.toString('hex')}`);
    console.log('[privacy] Set JARVIS_MASTER_KEY env var to persist across deploys.');
    console.log('[privacy] On Fly.io: fly secrets set JARVIS_MASTER_KEY=<hex>');
    console.log('[privacy] LOSING THIS KEY = LOSING ALL ENCRYPTED KNOWLEDGE.');
    console.log('============================================================');

    return key;
  }
}

// ============ Key Derivation (HKDF) ============

export function deriveUserKey(userId) {
  if (!initialized || !masterKey) return null;
  return Buffer.from(hkdfSync('sha256', masterKey, '', `user:${userId}`, KEY_LENGTH));
}

export function deriveGroupKey(groupId) {
  if (!initialized || !masterKey) return null;
  return Buffer.from(hkdfSync('sha256', masterKey, '', `group:${groupId}`, KEY_LENGTH));
}

export function deriveSkillsKey() {
  if (!initialized || !masterKey) return null;
  return Buffer.from(hkdfSync('sha256', masterKey, '', 'skills', KEY_LENGTH));
}

// ============ AES-256-GCM Encrypt/Decrypt ============

export function encrypt(plaintext, key) {
  if (!key) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encryptedB64, key) {
  if (!key) return encryptedB64;
  try {
    const buf = Buffer.from(encryptedB64, 'base64');
    if (buf.length < IV_LENGTH + TAG_LENGTH) return encryptedB64; // Not encrypted

    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Decryption failed — likely plaintext legacy data
    return encryptedB64;
  }
}

// ============ JSON-Level Encryption ============

export function encryptJSON(obj, key) {
  if (!key) return obj;
  const json = JSON.stringify(obj);
  return encrypt(json, key);
}

export function decryptJSON(encryptedB64, key) {
  if (!key) return encryptedB64;
  try {
    const json = decrypt(encryptedB64, key);
    return JSON.parse(json);
  } catch {
    // If it's already an object (legacy plaintext), return as-is
    return encryptedB64;
  }
}

// ============ Field-Level Encryption ============

export function encryptField(value, key) {
  if (!key || value === null || value === undefined) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return encrypt(str, key);
}

export function decryptField(encrypted, key) {
  if (!key || encrypted === null || encrypted === undefined) return encrypted;
  if (typeof encrypted !== 'string') return encrypted; // Not encrypted
  try {
    return decrypt(encrypted, key);
  } catch {
    return encrypted; // Legacy plaintext
  }
}

// ============ HMAC Integrity ============

export function hmacSign(data, key) {
  if (!key) return null;
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return createHmac('sha256', key).update(str).digest('hex');
}

export function hmacVerify(data, signature, key) {
  if (!key || !signature) return false;
  const expected = hmacSign(data, key);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ============ Hashing ============

export function hashUserId(userId) {
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 16);
}

export function getKeyFingerprint(key) {
  if (!key) return 'none';
  const k = key instanceof Buffer ? key : Buffer.from(key);
  return createHash('sha256').update(k).digest('hex').slice(0, 12);
}

// ============ Key Rotation ============

export async function rotateMasterKey(oldKeyHex, newKeyHex) {
  const oldKey = pbkdf2Sync(oldKeyHex, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  const newKey = pbkdf2Sync(newKeyHex, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  // This is a placeholder — actual rotation requires:
  // 1. Load every encrypted CKB with old key
  // 2. Decrypt all fields
  // 3. Re-encrypt with new key
  // 4. Save
  // The caller (learning.js flush cycle) handles this by:
  //   - Setting masterKey = newKey
  //   - Flushing all in-memory CKBs (they'll re-encrypt with new key on save)

  masterKey = newKey;
  console.log(`[privacy] Master key rotated. New fingerprint: ${getKeyFingerprint(newKey)}`);

  return {
    oldFingerprint: getKeyFingerprint(oldKey),
    newFingerprint: getKeyFingerprint(newKey),
  };
}

// ============ Status ============

export function isEncryptionEnabled() {
  return initialized && masterKey !== null;
}

export function getPrivacyStatus() {
  return {
    enabled: initialized,
    keyLoaded: masterKey !== null,
    fingerprint: masterKey ? getKeyFingerprint(masterKey) : 'none',
    algorithm: ALGORITHM,
    keyDerivation: 'HKDF-SHA256',
    pbkdf2Iterations: PBKDF2_ITERATIONS,
  };
}

// ============ CKB Encryption Helpers ============
// These are the high-level functions that learning.js calls.
// They handle selective field encryption per the privacy tier model.

export function encryptUserCKB(data, userId) {
  if (!initialized || !masterKey) return data;
  const key = deriveUserKey(userId);
  if (!key) return data;

  const encrypted = structuredClone(data);

  // Encrypt fact content (sensitive)
  for (const fact of encrypted.facts) {
    if (!fact._encrypted) {
      fact.content = encryptField(fact.content, key);
      fact._encrypted = true;
    }
  }

  // Encrypt corrections (sensitive)
  for (const corr of encrypted.corrections || []) {
    if (!corr._encrypted) {
      if (corr.what_was_wrong) corr.what_was_wrong = encryptField(corr.what_was_wrong, key);
      if (corr.what_is_right) corr.what_is_right = encryptField(corr.what_is_right, key);
      corr._encrypted = true;
    }
  }

  // Encrypt preferences (sensitive)
  if (encrypted.preferences && Object.keys(encrypted.preferences).length > 0) {
    encrypted._preferencesEncrypted = encryptJSON(encrypted.preferences, key);
    encrypted.preferences = {};
  }

  return encrypted;
}

export function decryptUserCKB(data, userId) {
  if (!initialized || !masterKey) return data;
  const key = deriveUserKey(userId);
  if (!key) return data;

  // Decrypt fact content
  for (const fact of data.facts) {
    if (fact._encrypted) {
      fact.content = decryptField(fact.content, key);
      delete fact._encrypted;
    }
  }

  // Decrypt corrections
  for (const corr of data.corrections || []) {
    if (corr._encrypted) {
      if (corr.what_was_wrong) corr.what_was_wrong = decryptField(corr.what_was_wrong, key);
      if (corr.what_is_right) corr.what_is_right = decryptField(corr.what_is_right, key);
      delete corr._encrypted;
    }
  }

  // Decrypt preferences
  if (data._preferencesEncrypted) {
    try {
      data.preferences = decryptJSON(data._preferencesEncrypted, key);
    } catch {
      data.preferences = {};
    }
    delete data._preferencesEncrypted;
  }

  return data;
}

export function encryptGroupCKB(data, groupId) {
  if (!initialized || !masterKey) return data;
  const key = deriveGroupKey(groupId);
  if (!key) return data;

  const encrypted = structuredClone(data);

  for (const fact of encrypted.facts) {
    if (!fact._encrypted) {
      fact.content = encryptField(fact.content, key);
      fact._encrypted = true;
    }
  }

  return encrypted;
}

export function decryptGroupCKB(data, groupId) {
  if (!initialized || !masterKey) return data;
  const key = deriveGroupKey(groupId);
  if (!key) return data;

  for (const fact of data.facts) {
    if (fact._encrypted) {
      fact.content = decryptField(fact.content, key);
      delete fact._encrypted;
    }
  }

  return data;
}

export function encryptSkills(skillsData) {
  if (!initialized || !masterKey) return skillsData;
  const key = deriveSkillsKey();
  if (!key) return skillsData;

  // Skills are Network knowledge — HMAC integrity only, not encrypted
  // (they need to be readable across all CKBs)
  return skillsData.map(skill => {
    if (!skill._hmac) {
      skill._hmac = hmacSign(skill.lesson || skill.content, key);
    }
    return skill;
  });
}

export function verifySkills(skillsData) {
  if (!initialized || !masterKey) return { skills: skillsData, tampered: [] };
  const key = deriveSkillsKey();
  if (!key) return { skills: skillsData, tampered: [] };

  const tampered = [];
  for (const skill of skillsData) {
    if (skill._hmac) {
      const valid = hmacVerify(skill.lesson || skill.content, skill._hmac, key);
      if (!valid) {
        tampered.push(skill.id);
        console.warn(`[privacy] INTEGRITY VIOLATION: Skill ${skill.id} has been tampered with!`);
      }
    }
  }

  return { skills: skillsData, tampered };
}

// ============ Corrections Log HMAC ============

export function signCorrection(entry) {
  if (!initialized || !masterKey) return entry;
  const key = deriveSkillsKey(); // Use skills key for corrections (shared across users)
  entry._hmac = hmacSign(JSON.stringify({
    what_was_wrong: entry.what_was_wrong,
    what_is_right: entry.what_is_right,
    category: entry.category,
    timestamp: entry.timestamp,
  }), key);
  return entry;
}

export function verifyCorrection(entry) {
  if (!initialized || !masterKey || !entry._hmac) return true; // No HMAC = legacy, skip
  const key = deriveSkillsKey();
  return hmacVerify(JSON.stringify({
    what_was_wrong: entry.what_was_wrong,
    what_is_right: entry.what_is_right,
    category: entry.category,
    timestamp: entry.timestamp,
  }), entry._hmac, key);
}
