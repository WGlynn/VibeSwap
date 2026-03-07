// ============ MI Bandit Algorithm Tests ============
// Tests for epsilon-greedy, Thompson sampling, UCB1, and StigmergyBoard.
// Uses Node built-in test runner (node:test).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EpsilonGreedyBandit, ThompsonBandit, UCB1Bandit, createBandit, deserializeBandit, StigmergyBoard } from '../src/mi-bandit.js';

// ============ Epsilon-Greedy Tests ============

describe('EpsilonGreedyBandit', () => {
  let bandit;

  beforeEach(() => {
    bandit = new EpsilonGreedyBandit(['a', 'b', 'c'], { epsilon: 0.1 });
  });

  it('should initialize with correct arms', () => {
    assert.deepEqual(bandit.arms, ['a', 'b', 'c']);
    assert.equal(bandit.epsilon, 0.1);
  });

  it('should select an arm from available options', () => {
    const arm = bandit.select();
    assert.ok(['a', 'b', 'c'].includes(arm), `Selected arm "${arm}" not in options`);
  });

  it('should update Q-values on reward', () => {
    // Train arm 'a' as clearly better
    for (let i = 0; i < 20; i++) {
      bandit.update('a', 1.0);
      bandit.update('b', 0.0);
    }

    let aCount = 0;
    for (let i = 0; i < 100; i++) {
      if (bandit.select() === 'a') aCount++;
    }
    // With epsilon=0.1 (decayed), ~90%+ should be 'a'
    assert.ok(aCount > 50, `Expected arm 'a' to be selected most often, got ${aCount}/100`);
  });

  it('should serialize and deserialize correctly', () => {
    bandit.update('a', 1.0);
    bandit.update('b', 0.5);

    const data = bandit.serialize();
    assert.equal(data.type, 'epsilon_greedy');
    assert.deepEqual(data.arms, ['a', 'b', 'c']);

    const restored = deserializeBandit(data);
    assert.deepEqual(restored.arms, ['a', 'b', 'c']);
    // Q-values should be preserved
    assert.ok(restored.Q['a'] > restored.Q['c']);
  });

  it('should decay epsilon over time', () => {
    const b = new EpsilonGreedyBandit(['x', 'y'], { epsilon: 1.0, decay: 0.5 });
    b.update('x', 1.0);
    assert.ok(b.epsilon < 1.0, 'Epsilon should decay after update');
  });
});

// ============ Thompson Sampling Tests ============

describe('ThompsonBandit', () => {
  let bandit;

  beforeEach(() => {
    bandit = new ThompsonBandit(['a', 'b', 'c']);
  });

  it('should initialize with correct arms', () => {
    assert.deepEqual(bandit.arms, ['a', 'b', 'c']);
  });

  it('should select an arm', () => {
    const arm = bandit.select();
    assert.ok(['a', 'b', 'c'].includes(arm));
  });

  it('should learn arm preferences from rewards', () => {
    for (let i = 0; i < 50; i++) {
      bandit.update('a', 1.0);
      bandit.update('b', 0.0);
      bandit.update('c', 0.0);
    }

    let aCount = 0;
    for (let i = 0; i < 100; i++) {
      if (bandit.select() === 'a') aCount++;
    }
    assert.ok(aCount > 70, `Expected arm 'a' to dominate after training, got ${aCount}/100`);
  });

  it('should serialize and deserialize', () => {
    bandit.update('a', 1.0);
    const data = bandit.serialize();
    assert.equal(data.type, 'thompson');

    const restored = deserializeBandit(data);
    assert.deepEqual(restored.arms, ['a', 'b', 'c']);
  });
});

// ============ UCB1 Tests ============

describe('UCB1Bandit', () => {
  let bandit;

  beforeEach(() => {
    bandit = new UCB1Bandit(['a', 'b', 'c']);
  });

  it('should initialize with correct arms', () => {
    assert.deepEqual(bandit.arms, ['a', 'b', 'c']);
  });

  it('should explore all arms initially', () => {
    const selected = new Set();
    for (let i = 0; i < 10; i++) {
      const arm = bandit.select();
      selected.add(arm);
      bandit.update(arm, 0.5);
    }
    assert.ok(selected.size >= 2, `Expected exploration of multiple arms, only got ${selected.size}`);
  });

  it('should converge on best arm', () => {
    for (let i = 0; i < 30; i++) {
      bandit.update('a', 1.0);
      bandit.update('b', 0.1);
      bandit.update('c', 0.1);
    }

    let aCount = 0;
    for (let i = 0; i < 50; i++) {
      const arm = bandit.select();
      if (arm === 'a') aCount++;
      bandit.update(arm, arm === 'a' ? 1.0 : 0.1);
    }
    assert.ok(aCount > 20, `Expected arm 'a' to be preferred, got ${aCount}/50`);
  });

  it('should serialize and deserialize', () => {
    bandit.update('a', 1.0);
    const data = bandit.serialize();
    assert.equal(data.type, 'ucb1');

    const restored = deserializeBandit(data);
    assert.deepEqual(restored.arms, ['a', 'b', 'c']);
  });
});

// ============ StigmergyBoard Tests ============

describe('StigmergyBoard', () => {
  let board;

  beforeEach(() => {
    board = new StigmergyBoard({ defaultTTL: 5000, maxEntries: 100 });
  });

  it('should deposit and query pheromones', () => {
    board.deposit('market.btc.bullish', 0.8, 'shard-0');
    const entry = board.query('market.btc.bullish');
    assert.ok(entry, 'Expected entry to exist');
    assert.equal(entry.value, 0.8);
    assert.equal(entry.depositor, 'shard-0');
  });

  it('should return null for unknown keys', () => {
    const entry = board.query('nonexistent');
    assert.equal(entry, null);
  });

  it('should overwrite deposits on same key', () => {
    board.deposit('signal.test', 0.5, 'shard-0');
    board.deposit('signal.test', 0.8, 'shard-1');
    const entry = board.query('signal.test');
    assert.ok(entry, 'Expected entry to exist');
    assert.equal(entry.value, 0.8);
    assert.equal(entry.depositor, 'shard-1');
  });

  it('should support prefix queries', () => {
    board.deposit('market.btc.price', 1.0, 'shard-0');
    board.deposit('market.eth.price', 0.5, 'shard-0');
    board.deposit('other.key', 0.1, 'shard-0');

    const results = board.queryPrefix('market.');
    assert.equal(results.length, 2);
  });

  it('should serialize and deserialize', () => {
    board.deposit('key1', 0.5, 'shard-0');
    board.deposit('key2', 0.8, 'shard-1');

    const data = board.serialize();
    assert.ok(Array.isArray(data), 'Serialized data should be an array');
    assert.equal(data.length, 2);

    const restored = StigmergyBoard.deserialize(data, { defaultTTL: 5000, maxEntries: 100 });
    const e1 = restored.query('key1');
    assert.ok(e1, 'Expected key1 in restored board');
    assert.equal(e1.value, 0.5);
  });

  it('should respect maxEntries limit', () => {
    const small = new StigmergyBoard({ defaultTTL: 5000, maxEntries: 3 });
    small.deposit('a', 1.0, 'x');
    small.deposit('b', 2.0, 'x');
    small.deposit('c', 3.0, 'x');
    small.deposit('d', 4.0, 'x');

    assert.ok(small.board.size <= 3, `Expected max 3 entries, got ${small.board.size}`);
  });

  it('should decay expired entries', async () => {
    board.deposit('temp', 1.0, 'shard-0', 10); // 10ms TTL
    const before = board.query('temp');
    assert.ok(before, 'Expected entry to exist initially');

    // Wait for expiry
    await new Promise(r => setTimeout(r, 20));
    board.decay();
    const after = board.query('temp');
    assert.equal(after, null, 'Expected expired entry to be removed');
  });

  it('should report stats', () => {
    board.deposit('k1', 1, 'a');
    board.deposit('k2', 2, 'b');
    const s = board.stats();
    assert.equal(s.entries, 2);
    assert.equal(s.depositors, 2);
  });
});

// ============ Factory Tests ============

describe('createBandit factory', () => {
  it('should create epsilon_greedy', () => {
    const b = createBandit('epsilon_greedy', ['x', 'y']);
    assert.ok(b instanceof EpsilonGreedyBandit);
  });

  it('should create thompson', () => {
    const b = createBandit('thompson', ['x', 'y']);
    assert.ok(b instanceof ThompsonBandit);
  });

  it('should create ucb1', () => {
    const b = createBandit('ucb1', ['x', 'y']);
    assert.ok(b instanceof UCB1Bandit);
  });

  it('should default to epsilon_greedy for unknown types', () => {
    const b = createBandit('unknown', ['x', 'y']);
    assert.ok(b instanceof EpsilonGreedyBandit);
  });
});
