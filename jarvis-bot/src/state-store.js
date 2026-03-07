// ============ State Store — Abstract State Storage Layer ============
//
// Decouples JARVIS state from filesystem so multiple instances can share it.
// Currently backed by FileStateStore (backward compatible). Designed for
// pluggable backends: Redis (Phase 2), CKB cells (future).
//
// Interface:
//   get(key)           → Promise<any>      — Read state by key
//   set(key, value)    → Promise<void>     — Write state by key
//   delete(key)        → Promise<void>     — Remove state by key
//   list(prefix)       → Promise<string[]> — List keys matching prefix
//   watch(key, cb)     → Unsubscribe       — Reactive sync (for multi-shard)
//
// Encryption boundary: privacy.js encrypts BEFORE set, decrypts AFTER get.
// The store never sees plaintext sensitive data.
//
// Key naming convention:
//   "user:{userId}"        → Per-user CKB
//   "group:{groupId}"      → Per-group CKB
//   "skills"               → Network skills
//   "inner-dialogue"       → Inner dialogue entries
//   "behavior"             → Behavior flags
//   "conversations:{chatId}" → Conversation history
// ============

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { config } from './config.js';

// ============ Base Interface ============

class StateStore {
  async get(key) { throw new Error('Not implemented'); }
  async set(key, value) { throw new Error('Not implemented'); }
  async delete(key) { throw new Error('Not implemented'); }
  async list(prefix) { throw new Error('Not implemented'); }
  watch(key, callback) { return () => {}; } // Default no-op unsubscribe
  async close() {} // Cleanup
}

// ============ FileStateStore ============
// Current behavior — reads/writes JSON files on disk.
// 100% backward compatible with existing data layout.

class FileStateStore extends StateStore {
  constructor(baseDir) {
    super();
    this.baseDir = baseDir;
    this.watchers = new Map(); // key -> Set<callback>
  }

  // Map key to filesystem path
  _keyToPath(key) {
    // Key format: "prefix:id" or just "prefix"
    const parts = key.split(':');

    if (parts[0] === 'user') {
      return join(this.baseDir, 'knowledge', 'users', `${parts[1]}.json`);
    }
    if (parts[0] === 'group') {
      return join(this.baseDir, 'knowledge', 'groups', `${parts[1]}.json`);
    }
    if (parts[0] === 'skills') {
      return join(this.baseDir, 'knowledge', 'skills.json');
    }
    if (parts[0] === 'inner-dialogue') {
      return join(this.baseDir, 'knowledge', 'inner-dialogue.json');
    }
    if (parts[0] === 'behavior') {
      return join(this.baseDir, 'behavior.json');
    }
    if (parts[0] === 'conversations') {
      return join(this.baseDir, `conversations.json`);
    }
    if (parts[0] === 'corrections') {
      return join(this.baseDir, 'knowledge', 'corrections.jsonl');
    }
    if (parts[0] === 'deep') {
      return join(this.baseDir, 'knowledge', 'deep', `${parts[1]}.jsonl`);
    }
    if (parts[0] === 'hell') {
      return join(this.baseDir, 'knowledge', 'hell', `${parts[1] || 'registry'}.json`);
    }

    // Generic fallback
    return join(this.baseDir, `${key.replace(/:/g, '_')}.json`);
  }

  async get(key) {
    const path = this._keyToPath(key);
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') return null; // File doesn't exist — expected
      if (err instanceof SyntaxError) {
        console.error(`[state-store] JSON corruption in ${key}: ${err.message}`);
      } else {
        console.warn(`[state-store] Failed to read ${key}: ${err.message}`);
      }
      return null;
    }
  }

  async set(key, value) {
    const path = this._keyToPath(key);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value, null, 2));
    } catch (err) {
      console.error(`[state-store] Write failed for ${key}: ${err.message}`);
      return;
    }

    // Notify watchers
    const callbacks = this.watchers.get(key);
    if (callbacks) {
      for (const cb of callbacks) {
        try { cb(value); } catch (err) {
          console.error(`[state-store] Watcher error for ${key}:`, err.message);
        }
      }
    }
  }

  async delete(key) {
    const path = this._keyToPath(key);
    try {
      await unlink(path);
    } catch {
      // Already deleted or never existed
    }
  }

  async list(prefix) {
    const keys = [];

    if (prefix === 'user') {
      const dir = join(this.baseDir, 'knowledge', 'users');
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            keys.push(`user:${file.replace('.json', '')}`);
          }
        }
      } catch { /* dir doesn't exist */ }
    } else if (prefix === 'group') {
      const dir = join(this.baseDir, 'knowledge', 'groups');
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            keys.push(`group:${file.replace('.json', '')}`);
          }
        }
      } catch { /* dir doesn't exist */ }
    }

    return keys;
  }

  watch(key, callback) {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.watchers.get(key);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) this.watchers.delete(key);
      }
    };
  }
}

// ============ RedisStateStore (Stub for Phase 2) ============

class RedisStateStore extends StateStore {
  constructor(redisUrl) {
    super();
    this.redisUrl = redisUrl;
    this.client = null;
  }

  async connect() {
    // Phase 2: import redis and connect
    // import { createClient } from 'redis';
    // this.client = createClient({ url: this.redisUrl });
    // await this.client.connect();
    throw new Error('RedisStateStore not yet implemented — coming in Phase 2');
  }

  async get(key) {
    if (!this.client) throw new Error('Not connected');
    const data = await this.client.get(`jarvis:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async set(key, value) {
    if (!this.client) throw new Error('Not connected');
    await this.client.set(`jarvis:${key}`, JSON.stringify(value));
  }

  async delete(key) {
    if (!this.client) throw new Error('Not connected');
    await this.client.del(`jarvis:${key}`);
  }

  async list(prefix) {
    if (!this.client) throw new Error('Not connected');
    const keys = await this.client.keys(`jarvis:${prefix}:*`);
    return keys.map(k => k.replace('jarvis:', ''));
  }

  watch(key, callback) {
    // Phase 2: Redis pub/sub for real-time cross-shard sync
    // subscriber.subscribe(`jarvis:changed:${key}`, (message) => {
    //   callback(JSON.parse(message));
    // });
    return () => {};
  }

  async close() {
    if (this.client) await this.client.quit();
  }
}

// ============ Store Factory ============

let storeInstance = null;

export function createStateStore(backend, options = {}) {
  switch (backend) {
    case 'file':
      return new FileStateStore(options.baseDir || config.dataDir);
    case 'redis':
      return new RedisStateStore(options.redisUrl);
    default:
      return new FileStateStore(options.baseDir || config.dataDir);
  }
}

export function getStateStore() {
  if (!storeInstance) {
    const backend = config.shard?.stateBackend || 'file';
    storeInstance = createStateStore(backend, {
      baseDir: config.dataDir,
      redisUrl: config.shard?.redisUrl,
    });
    console.log(`[state-store] Initialized: ${backend} backend`);
  }
  return storeInstance;
}

export async function initStateStore() {
  const store = getStateStore();

  // Ensure base directories exist for FileStateStore
  if (store instanceof FileStateStore) {
    await mkdir(join(config.dataDir, 'knowledge', 'users'), { recursive: true });
    await mkdir(join(config.dataDir, 'knowledge', 'groups'), { recursive: true });
    await mkdir(join(config.dataDir, 'knowledge', 'deep'), { recursive: true });
    await mkdir(join(config.dataDir, 'knowledge', 'hell'), { recursive: true });
  }

  // If Redis, connect
  if (store instanceof RedisStateStore) {
    await store.connect();
  }

  console.log('[state-store] Ready.');
  return store;
}

// ============ Exports ============

export { StateStore, FileStateStore, RedisStateStore };
