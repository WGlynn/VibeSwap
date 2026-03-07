// ============ Shard Learnings Tests ============
// Tests for the cross-shard JSONL learning bus.
// Uses Node built-in test runner (node:test).

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';

// Test file paths
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(__dirname, '..', '.test-data');
const TEST_JSONL = join(TEST_DIR, 'test_learnings.jsonl');

// ============ JSONL Parsing Tests ============

describe('JSONL format', () => {
  it('should parse valid JSONL entries', () => {
    const lines = [
      '{"shardId":"shard-0","timestamp":"2026-03-07T10:00:00Z","topic":"teamdynamics","fact":"Test fact 1","hash":"abc123"}',
      '{"shardId":"shard-1","timestamp":"2026-03-07T11:00:00Z","topic":"decision","fact":"Test fact 2","hash":"def456"}',
    ];

    const entries = lines.map(l => JSON.parse(l));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].shardId, 'shard-0');
    assert.equal(entries[1].topic, 'decision');
  });

  it('should skip malformed lines', () => {
    const lines = [
      '{"shardId":"shard-0","fact":"valid"}',
      'not json at all',
      '{"shardId":"shard-1","fact":"also valid"}',
    ];

    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip
      }
    }
    assert.equal(entries.length, 2);
  });
});

// ============ Broadcast Threshold Tests ============

describe('shouldBroadcast logic', () => {
  // Reimplement the logic locally for testing (same as shard-learnings.js)
  const CATEGORY_MAP = {
    social: 'teamdynamics',
    project: 'decision',
    technical: 'decision',
    preference: 'preference',
    behavioral: 'preference',
  };

  const BROADCAST_TAG_KEYWORDS = [
    'team', 'decision', 'architecture', 'security', 'deploy', 'status', 'preference',
  ];

  const BROADCAST_PATTERNS = [
    /\b(left|quit|joined|departed|kicked|banned)\b/i,
    /\b(decided|pivot|pivoted|chose|chosen|agreed)\b/i,
    /\b(deployed|launched|shipped|released|live)\b/i,
    /\b(vulnerability|exploit|breach|compromised|attack)\b/i,
  ];

  function shouldBroadcast(fact, category, tags) {
    if (category && CATEGORY_MAP[category]) return true;
    if (tags && tags.some(t => BROADCAST_TAG_KEYWORDS.includes(t.toLowerCase()))) return true;
    if (BROADCAST_PATTERNS.some(rx => rx.test(fact))) return true;
    return false;
  }

  it('should broadcast social category', () => {
    assert.ok(shouldBroadcast('Some fact', 'social', []));
  });

  it('should broadcast technical category', () => {
    assert.ok(shouldBroadcast('Some fact', 'technical', []));
  });

  it('should broadcast preference category', () => {
    assert.ok(shouldBroadcast('Some fact', 'preference', []));
  });

  it('should NOT broadcast factual category without signals', () => {
    assert.ok(!shouldBroadcast('Bitcoin price is 50000', 'factual', []));
  });

  it('should broadcast factual with deploy tag', () => {
    assert.ok(shouldBroadcast('Version 2.0', 'factual', ['deploy']));
  });

  it('should broadcast when fact mentions quit', () => {
    assert.ok(shouldBroadcast('Scottie quit the project', 'factual', []));
  });

  it('should broadcast when fact mentions deployed', () => {
    assert.ok(shouldBroadcast('We deployed the new version', 'factual', []));
  });

  it('should broadcast when fact mentions vulnerability', () => {
    assert.ok(shouldBroadcast('Found a vulnerability in the bridge', 'factual', []));
  });

  it('should NOT broadcast generic factual without patterns', () => {
    assert.ok(!shouldBroadcast('The sky is blue', 'factual', []));
  });
});

// ============ Dedup Hash Tests ============

describe('dedup hashing', () => {
  function computeHash(shardId, topic, fact) {
    return createHash('sha256')
      .update(`${shardId}|${topic}|${fact}`)
      .digest('hex')
      .slice(0, 32);
  }

  it('should produce consistent hashes', () => {
    const h1 = computeHash('shard-0', 'teamdynamics', 'Scottie left');
    const h2 = computeHash('shard-0', 'teamdynamics', 'Scottie left');
    assert.equal(h1, h2);
  });

  it('should produce different hashes for different facts', () => {
    const h1 = computeHash('shard-0', 'teamdynamics', 'Scottie left');
    const h2 = computeHash('shard-0', 'teamdynamics', 'Scottie joined');
    assert.notEqual(h1, h2);
  });

  it('should produce different hashes for different shards', () => {
    const h1 = computeHash('shard-0', 'teamdynamics', 'Scottie left');
    const h2 = computeHash('shard-1', 'teamdynamics', 'Scottie left');
    assert.notEqual(h1, h2);
  });

  it('should truncate to 32 chars', () => {
    const h = computeHash('shard-0', 'test', 'hello');
    assert.equal(h.length, 32);
  });
});

// ============ Context Builder Logic Tests ============

describe('context builder logic', () => {
  function timeSince(isoStr) {
    const ms = Date.now() - new Date(isoStr).getTime();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours < 1) return `${Math.floor(ms / (1000 * 60))}m`;
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  it('should format minutes correctly', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    assert.equal(timeSince(fiveMinAgo), '5m');
  });

  it('should format hours correctly', () => {
    const twoHrsAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    assert.equal(timeSince(twoHrsAgo), '2h');
  });

  it('should format days correctly', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(timeSince(threeDaysAgo), '3d');
  });

  it('should filter out own shard entries', () => {
    const entries = [
      { shardId: 'shard-0', topic: 'test', fact: 'Own fact', timestamp: new Date().toISOString() },
      { shardId: 'shard-1', topic: 'test', fact: 'Other fact', timestamp: new Date().toISOString() },
    ];

    const ownId = 'shard-0';
    const filtered = entries.filter(e => e.shardId !== ownId);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].fact, 'Other fact');
  });

  it('should cap entries at context limit', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      shardId: 'shard-1',
      topic: 'test',
      fact: `Fact ${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
    }));

    const CONTEXT_CAP = 20;
    const capped = entries.slice(0, CONTEXT_CAP);
    assert.equal(capped.length, 20);
  });

  it('should exclude entries older than 7 days', () => {
    const entries = [
      { shardId: 'shard-1', topic: 'test', fact: 'Recent', timestamp: new Date().toISOString() },
      { shardId: 'shard-1', topic: 'test', fact: 'Old', timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    ];

    const CONTEXT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - CONTEXT_WINDOW_MS;
    const recent = entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].fact, 'Recent');
  });
});
