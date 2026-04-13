/**
 * CogProof Persistence Layer — SQLite via better-sqlite3
 *
 * Write-through: every mutation hits both in-memory state and SQLite.
 * On startup, loads all state from SQLite into the existing modules.
 * Modules keep their in-memory Maps for fast reads — SQLite is the
 * durable backing store.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'cogproof.db');

class CogProofDB {
  constructor(dbPath) {
    const resolvedPath = dbPath || process.env.COGPROOF_DB_PATH || DEFAULT_DB_PATH;

    // Ensure data directory exists
    const fs = require('fs');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._createTables();
    this._prepareStatements();
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY,
        block_hash TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'COMMIT',
        shuffle_seed TEXT,
        execution_order TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commits (
        batch_id INTEGER NOT NULL,
        miner_id TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (batch_id, miner_id),
        FOREIGN KEY (batch_id) REFERENCES batches(id)
      );

      CREATE TABLE IF NOT EXISTS reveals (
        batch_id INTEGER NOT NULL,
        miner_id TEXT NOT NULL,
        output TEXT NOT NULL,
        secret TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (batch_id, miner_id),
        FOREIGN KEY (batch_id) REFERENCES batches(id)
      );

      CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        credential_type TEXT NOT NULL,
        signal TEXT NOT NULL,
        weight INTEGER NOT NULL,
        batch_id INTEGER,
        metadata TEXT,
        cred_hash TEXT NOT NULL,
        credential_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        score INTEGER NOT NULL DEFAULT 0,
        total_credentials INTEGER NOT NULL DEFAULT 0,
        positive_signals INTEGER NOT NULL DEFAULT 0,
        negative_signals INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS trust_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        data TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trust_actions_user ON trust_actions(user_id);

      CREATE TABLE IF NOT EXISTS trust_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        batch_id INTEGER,
        flag_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT,
        evidence TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexer_commits (
        commit_hash TEXT PRIMARY KEY,
        tx_id TEXT NOT NULL,
        block_height INTEGER NOT NULL,
        batch_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        revealed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS indexer_reveals (
        commit_hash TEXT PRIMARY KEY,
        tx_id TEXT NOT NULL,
        block_height INTEGER NOT NULL,
        secret_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indexer_reputation (
        target_hash TEXT PRIMARY KEY,
        total_burned INTEGER NOT NULL DEFAULT 0,
        burns INTEGER NOT NULL DEFAULT 0,
        revocations INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS indexer_credentials (
        domain_hash TEXT PRIMARY KEY,
        data TEXT
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  _prepareStatements() {
    this.stmts = {
      // Batches
      insertBatch: this.db.prepare(`
        INSERT INTO batches (id, block_hash, phase, created_at)
        VALUES (?, ?, ?, ?)
      `),
      updateBatchPhase: this.db.prepare(`
        UPDATE batches SET phase = ? WHERE id = ?
      `),
      updateBatchSettlement: this.db.prepare(`
        UPDATE batches SET phase = 'SETTLED', shuffle_seed = ?, execution_order = ?
        WHERE id = ?
      `),
      getBatch: this.db.prepare(`SELECT * FROM batches WHERE id = ?`),
      getAllBatches: this.db.prepare(`SELECT * FROM batches ORDER BY id DESC`),
      getRecentBatches: this.db.prepare(`SELECT * FROM batches ORDER BY id DESC LIMIT ?`),

      // Commits
      insertCommit: this.db.prepare(`
        INSERT INTO commits (batch_id, miner_id, commit_hash, timestamp)
        VALUES (?, ?, ?, ?)
      `),
      getCommitsByBatch: this.db.prepare(`SELECT * FROM commits WHERE batch_id = ?`),

      // Reveals
      insertReveal: this.db.prepare(`
        INSERT INTO reveals (batch_id, miner_id, output, secret, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `),
      getRevealsByBatch: this.db.prepare(`SELECT * FROM reveals WHERE batch_id = ?`),

      // Credentials
      insertCredential: this.db.prepare(`
        INSERT INTO credentials (user_id, credential_type, signal, weight, batch_id, metadata, cred_hash, credential_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getCredentialsByUser: this.db.prepare(`SELECT * FROM credentials WHERE user_id = ?`),
      getAllCredentials: this.db.prepare(`SELECT * FROM credentials ORDER BY created_at DESC`),
      getRecentCredentials: this.db.prepare(`SELECT * FROM credentials ORDER BY created_at DESC LIMIT ?`),

      // User profiles
      upsertProfile: this.db.prepare(`
        INSERT INTO user_profiles (user_id, score, total_credentials, positive_signals, negative_signals)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          score = excluded.score,
          total_credentials = excluded.total_credentials,
          positive_signals = excluded.positive_signals,
          negative_signals = excluded.negative_signals
      `),
      getProfile: this.db.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`),
      getAllProfiles: this.db.prepare(`SELECT * FROM user_profiles`),

      // Trust actions
      insertAction: this.db.prepare(`
        INSERT INTO trust_actions (user_id, action_type, data, timestamp)
        VALUES (?, ?, ?, ?)
      `),
      getActionsByUser: this.db.prepare(`SELECT * FROM trust_actions WHERE user_id = ?`),
      getAllUsers: this.db.prepare(`SELECT DISTINCT user_id FROM trust_actions`),

      // Trust flags
      insertFlag: this.db.prepare(`
        INSERT INTO trust_flags (user_id, batch_id, flag_type, severity, message, evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getRecentFlags: this.db.prepare(`SELECT * FROM trust_flags ORDER BY created_at DESC LIMIT ?`),

      // Indexer
      insertIndexerCommit: this.db.prepare(`
        INSERT OR REPLACE INTO indexer_commits (commit_hash, tx_id, block_height, batch_id, amount, revealed)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      updateIndexerCommitRevealed: this.db.prepare(`
        UPDATE indexer_commits SET revealed = 1 WHERE commit_hash = ?
      `),
      insertIndexerReveal: this.db.prepare(`
        INSERT OR REPLACE INTO indexer_reveals (commit_hash, tx_id, block_height, secret_hash)
        VALUES (?, ?, ?, ?)
      `),
      upsertIndexerReputation: this.db.prepare(`
        INSERT INTO indexer_reputation (target_hash, total_burned, burns, revocations)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(target_hash) DO UPDATE SET
          total_burned = excluded.total_burned,
          burns = excluded.burns,
          revocations = excluded.revocations
      `),
      upsertIndexerCredential: this.db.prepare(`
        INSERT OR REPLACE INTO indexer_credentials (domain_hash, data) VALUES (?, ?)
      `),
      getIndexerState: this.db.prepare(`SELECT * FROM indexer_commits`),

      // KV
      setKV: this.db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`),
      getKV: this.db.prepare(`SELECT value FROM kv WHERE key = ?`),
    };
  }

  // ============ Batch Operations ============

  saveBatch(batch) {
    this.stmts.insertBatch.run(batch.id, batch.blockHash, batch.phase, batch.createdAt);
  }

  updateBatchPhase(batchId, phase) {
    this.stmts.updateBatchPhase.run(phase, batchId);
  }

  settleBatch(batchId, shuffleSeed, executionOrder) {
    this.stmts.updateBatchSettlement.run(shuffleSeed, JSON.stringify(executionOrder), batchId);
  }

  saveCommit(batchId, minerId, commitHash, timestamp) {
    this.stmts.insertCommit.run(batchId, minerId, commitHash, timestamp);
  }

  saveReveal(batchId, minerId, output, secret, timestamp) {
    this.stmts.insertReveal.run(batchId, minerId, output, secret, timestamp);
  }

  // ============ Credential Operations ============

  saveCredential(userId, credType, signal, weight, batchId, metadata, credHash, credentialJson) {
    this.stmts.insertCredential.run(
      userId, credType, signal, weight, batchId,
      JSON.stringify(metadata), credHash, JSON.stringify(credentialJson),
      Date.now()
    );
  }

  saveProfile(userId, profile) {
    this.stmts.upsertProfile.run(
      userId, profile.score, profile.totalCredentials,
      profile.positiveSignals, profile.negativeSignals
    );
  }

  // ============ Trust Operations ============

  saveAction(userId, action) {
    this.stmts.insertAction.run(userId, action.type, JSON.stringify(action), Date.now());
  }

  saveFlag(flag) {
    this.stmts.insertFlag.run(
      flag.userId || null, flag.batchId || null,
      flag.type, flag.severity, flag.message,
      JSON.stringify(flag.evidence || {}), Date.now()
    );
  }

  // ============ Indexer Operations ============

  saveIndexerCommit(commitHash, txId, blockHeight, batchId, amount) {
    this.stmts.insertIndexerCommit.run(commitHash, txId, blockHeight, batchId, amount, 0);
  }

  markIndexerRevealed(commitHash) {
    this.stmts.updateIndexerCommitRevealed.run(commitHash);
  }

  saveIndexerReveal(commitHash, txId, blockHeight, secretHash) {
    this.stmts.insertIndexerReveal.run(commitHash, txId, blockHeight, secretHash);
  }

  saveIndexerReputation(targetHash, rep) {
    this.stmts.upsertIndexerReputation.run(targetHash, rep.totalBurned, rep.burns, rep.revocations);
  }

  saveIndexerCredential(domainHash) {
    this.stmts.upsertIndexerCredential.run(domainHash, '{}');
  }

  saveBlockHeight(height) {
    this.stmts.setKV.run('blockHeight', height.toString());
  }

  saveBatchCounter(counter) {
    this.stmts.setKV.run('currentBatchId', counter.toString());
  }

  // ============ Load State (startup) ============

  loadAllState() {
    return {
      batches: this._loadBatches(),
      credentials: this._loadCredentials(),
      profiles: this._loadProfiles(),
      trustHistory: this._loadTrustHistory(),
      indexer: this._loadIndexer(),
      currentBatchId: parseInt(this.stmts.getKV.get('currentBatchId')?.value || '0'),
    };
  }

  _loadBatches() {
    const batches = new Map();
    const rows = this.stmts.getAllBatches.all();
    for (const row of rows) {
      const commits = new Map();
      for (const c of this.stmts.getCommitsByBatch.all(row.id)) {
        commits.set(c.miner_id, {
          minerId: c.miner_id,
          commitHash: c.commit_hash,
          timestamp: c.timestamp,
        });
      }

      const reveals = new Map();
      const secrets = [];
      for (const r of this.stmts.getRevealsByBatch.all(row.id)) {
        reveals.set(r.miner_id, {
          minerId: r.miner_id,
          output: r.output,
          secret: r.secret,
          timestamp: r.timestamp,
        });
        secrets.push(Buffer.from(r.secret, 'hex'));
      }

      batches.set(row.id, {
        id: row.id,
        blockHash: row.block_hash,
        phase: row.phase,
        commits,
        reveals,
        secrets,
        shuffleSeed: row.shuffle_seed,
        executionOrder: row.execution_order ? JSON.parse(row.execution_order) : null,
        createdAt: row.created_at,
      });
    }
    return batches;
  }

  _loadCredentials() {
    const rows = this.stmts.getAllCredentials.all();
    return rows.map(r => JSON.parse(r.credential_json));
  }

  _loadProfiles() {
    const profiles = new Map();
    for (const row of this.stmts.getAllProfiles.all()) {
      profiles.set(row.user_id, {
        score: row.score,
        totalCredentials: row.total_credentials,
        positiveSignals: row.positive_signals,
        negativeSignals: row.negative_signals,
      });
    }
    return profiles;
  }

  _loadTrustHistory() {
    const history = new Map();
    for (const { user_id } of this.stmts.getAllUsers.all()) {
      const actions = this.stmts.getActionsByUser.all(user_id);
      const parsed = actions.map(a => ({ ...JSON.parse(a.data), timestamp: a.timestamp }));

      history.set(user_id, {
        userId: user_id,
        actions: parsed,
        commits: parsed.filter(a => a.type === 'COMMIT'),
        reveals: parsed.filter(a => a.type === 'REVEAL'),
        mining: parsed.filter(a => a.type === 'MINE'),
        burns: parsed.filter(a => a.type === 'REP_COMMIT'),
        revocations: parsed.filter(a => a.type === 'REP_REVOKE'),
        firstSeen: actions.length > 0 ? actions[0].timestamp : Date.now(),
        lastSeen: actions.length > 0 ? actions[actions.length - 1].timestamp : Date.now(),
      });
    }
    return history;
  }

  _loadIndexer() {
    const commits = new Map();
    const reveals = new Map();
    const credentials = new Map();
    const reputation = new Map();

    for (const row of this.db.prepare('SELECT * FROM indexer_commits').all()) {
      commits.set(row.commit_hash, {
        txId: row.tx_id,
        blockHeight: row.block_height,
        batchId: row.batch_id,
        amount: row.amount,
        revealed: !!row.revealed,
      });
    }

    for (const row of this.db.prepare('SELECT * FROM indexer_reveals').all()) {
      reveals.set(row.commit_hash, {
        txId: row.tx_id,
        blockHeight: row.block_height,
        secretHash: row.secret_hash,
      });
    }

    for (const row of this.db.prepare('SELECT * FROM indexer_credentials').all()) {
      credentials.set(row.domain_hash, JSON.parse(row.data || '{}'));
    }

    for (const row of this.db.prepare('SELECT * FROM indexer_reputation').all()) {
      reputation.set(row.target_hash, {
        totalBurned: row.total_burned,
        burns: row.burns,
        revocations: row.revocations,
      });
    }

    const blockHeight = parseInt(this.stmts.getKV.get('blockHeight')?.value || '0');

    return { commits, reveals, credentials, reputation, blockHeight };
  }

  // ============ Stats (for dashboard) ============

  getStats() {
    const batchCount = this.db.prepare('SELECT COUNT(*) as c FROM batches').get().c;
    const credCount = this.db.prepare('SELECT COUNT(*) as c FROM credentials').get().c;
    const userCount = this.db.prepare('SELECT COUNT(*) as c FROM user_profiles').get().c;
    const flagCount = this.db.prepare('SELECT COUNT(*) as c FROM trust_flags').get().c;
    const recentBatches = this.stmts.getRecentBatches.all(10);
    const recentCreds = this.stmts.getRecentCredentials.all(20);
    const recentFlags = this.stmts.getRecentFlags.all(10);

    return {
      batches: batchCount,
      credentials: credCount,
      users: userCount,
      flags: flagCount,
      recentBatches: recentBatches.map(b => ({
        id: b.id,
        phase: b.phase,
        blockHash: b.block_hash,
        createdAt: b.created_at,
      })),
      recentCredentials: recentCreds.map(c => ({
        userId: c.user_id,
        type: c.credential_type,
        signal: c.signal,
        createdAt: c.created_at,
      })),
      recentFlags: recentFlags.map(f => ({
        userId: f.user_id,
        type: f.flag_type,
        severity: f.severity,
        message: f.message,
        createdAt: f.created_at,
      })),
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = { CogProofDB };
