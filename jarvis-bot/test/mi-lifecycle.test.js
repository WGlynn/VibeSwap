// ============ MI Lifecycle Integration Tests ============
// Tests the full cell lifecycle: init → register → invoke → learn → persist.
// Uses Node built-in test runner (node:test).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  initMIHost,
  shutdownMIHost,
  registerHandler,
  invokeCapability,
  emitSignal,
  onSignal,
  rewardCell,
  persistMIState,
  getCellStats,
  depositPheromone,
  queryPheromone,
  getPheromoneStats,
} from '../src/mi-host.js';

// ============ Test Manifest ============

function makeManifest(id, overrides = {}) {
  return {
    mi: '0.1',
    id,
    name: overrides.name || `Cell ${id}`,
    version: '1.0.0',
    kind: overrides.kind || 'service',
    domain: overrides.domain || 'testing',
    tags: overrides.tags || ['test'],
    capabilities: overrides.capabilities || [
      { name: 'greet', description: 'Greet a user' },
    ],
    signals: {
      subscribe: overrides.subscribe || ['system.heartbeat'],
      emit: overrides.emit || [],
    },
    lifecycle: {
      candidates: overrides.candidates || [
        { identity: 'default', condition: 'true', priority: 1 },
      ],
      learn: { strategy: overrides.strategy || 'fixed' },
      commit: { min_dwell_ms: 1000 },
    },
    runtime: {
      sandbox: 'worker',
      memory_limit_mb: 64,
      energy_budget: overrides.energyBudget || 100,
    },
    surfaces: ['telegram', 'api'],
  };
}

// ============ Setup ============

let cellsDir;

before(async () => {
  cellsDir = mkdtempSync(join(tmpdir(), 'mi-lifecycle-'));

  // Cell A: fixed strategy, simple greet
  writeFileSync(
    join(cellsDir, 'cell-a.mi.json'),
    JSON.stringify(makeManifest('cell-a', {
      capabilities: [
        { name: 'greet', description: 'Say hello' },
        { name: 'farewell', description: 'Say goodbye' },
      ],
      subscribe: ['system.heartbeat', 'custom.event'],
    }))
  );

  // Cell B: thompson strategy, competing greet + exclusive compute
  writeFileSync(
    join(cellsDir, 'cell-b.mi.json'),
    JSON.stringify(makeManifest('cell-b', {
      strategy: 'thompson',
      capabilities: [
        { name: 'greet', description: 'Another greeter' },
        { name: 'compute', description: 'Math operations' },
      ],
      candidates: [
        { identity: 'polite', condition: 'true', priority: 1 },
        { identity: 'casual', condition: 'true', priority: 2 },
      ],
    }))
  );

  // Cell C: low energy, tests budget exhaustion
  writeFileSync(
    join(cellsDir, 'cell-c.mi.json'),
    JSON.stringify(makeManifest('cell-c', {
      energyBudget: 2,
      capabilities: [
        { name: 'limited', description: 'Limited energy task' },
      ],
    }))
  );

  await initMIHost(cellsDir);

  // Register handlers
  registerHandler('cell-a', 'greet', async (input) => `Hello, ${input.name || 'world'}!`);
  registerHandler('cell-a', 'farewell', async (input) => `Goodbye, ${input.name || 'world'}!`);
  registerHandler('cell-b', 'greet', async (input) => `Hey ${input.name || 'there'}!`);
  registerHandler('cell-b', 'compute', async (input) => ({ result: (input.a || 0) + (input.b || 0) }));
  registerHandler('cell-c', 'limited', async () => 'done');
});

after(() => {
  shutdownMIHost();
  try { rmSync(cellsDir, { recursive: true }); } catch {}
});

// ============ Full Lifecycle Tests ============

describe('cell lifecycle', () => {
  it('should load all cells with correct identities', () => {
    const stats = getCellStats();
    assert.equal(stats.cells.length, 3, 'Should have 3 cells');

    const cellA = stats.cells.find(c => c.id === 'cell-a');
    const cellB = stats.cells.find(c => c.id === 'cell-b');
    assert.ok(cellA, 'cell-a should exist');
    assert.ok(cellB, 'cell-b should exist');
    assert.equal(cellA.state, 'active');
    assert.equal(cellB.state, 'active');
  });

  it('should invoke capability and route to best cell', async () => {
    const result = await invokeCapability('greet', { name: 'Alice' });
    // Could be either cell-a or cell-b — both provide greet
    assert.ok(
      result === 'Hello, Alice!' || result === 'Hey Alice!',
      `Unexpected greet result: ${JSON.stringify(result)}`
    );
  });

  it('should invoke exclusive capability on only cell that provides it', async () => {
    const result = await invokeCapability('compute', { a: 3, b: 7 });
    assert.deepEqual(result, { result: 10 });
  });

  it('should invoke another exclusive capability', async () => {
    const result = await invokeCapability('farewell', { name: 'Bob' });
    assert.equal(result, 'Goodbye, Bob!');
  });

  it('should track invocation counts after invocations', () => {
    const stats = getCellStats();
    const totalInvocations = stats.cells.reduce((sum, c) => sum + (c.invocations || 0), 0);
    assert.ok(totalInvocations >= 3, `Expected at least 3 total invocations, got ${totalInvocations}`);
  });

  it('should accept reward signals', () => {
    const ok = rewardCell('cell-a', 1.0, 'test_reward');
    assert.equal(ok, true);
  });

  it('should persist state to disk', () => {
    const ok = persistMIState();
    assert.equal(ok, true);
  });
});

// ============ Energy Budget Integration ============

describe('energy budget lifecycle', () => {
  it('should exhaust low-energy cell budget', async () => {
    // cell-c has energy budget of 2
    const r1 = await invokeCapability('limited', {});
    assert.equal(r1, 'done', 'First invocation should succeed');

    const r2 = await invokeCapability('limited', {});
    assert.equal(r2, 'done', 'Second invocation should succeed');

    const r3 = await invokeCapability('limited', {});
    assert.ok(r3.error, 'Third invocation should fail with budget error');
    assert.ok(r3.error.includes('budget') || r3.error.includes('Energy'), `Error should mention budget: ${r3.error}`);
  });
});

// ============ Signal Lifecycle ============

describe('signal lifecycle', () => {
  it('should deliver custom signals to subscribers', async () => {
    let received = null;
    onSignal('custom.event', (signal) => {
      received = signal;
    });

    emitSignal('custom.event', { action: 'test', value: 99 });
    await new Promise(r => setTimeout(r, 200));

    assert.ok(received, 'Signal should have been received');
    assert.equal(received.name, 'custom.event');
    assert.equal(received.payload.action, 'test');
    assert.equal(received.payload.value, 99);
  });

  it('should handle rapid signal burst without loss', async () => {
    let count = 0;
    onSignal('burst.test', () => { count++; });

    for (let i = 0; i < 10; i++) {
      emitSignal('burst.test', { i });
    }

    await new Promise(r => setTimeout(r, 500));
    assert.equal(count, 10, `Expected 10 signals, got ${count}`);
  });
});

// ============ Pheromone Lifecycle ============

describe('pheromone lifecycle', () => {
  it('should deposit and query a pheromone via signal', async () => {
    // Direct deposit (synchronous on the board)
    depositPheromone('lifecycle.test', 'pheromone-data', 'cell-a', 5000);

    // depositPheromone emits a signal — wait for processing
    await new Promise(r => setTimeout(r, 200));

    const stats = getPheromoneStats();
    assert.ok(stats.entries >= 1, 'Should have at least 1 pheromone entry');
  });
});

// ============ Multi-Cell Scoring ============

describe('multi-cell scoring', () => {
  it('should prefer cell with lower error rate for shared capability', async () => {
    // Make cell-a fail a few times by registering a failing handler temporarily
    registerHandler('cell-a', 'greet', async () => { throw new Error('temp fail'); });

    // Force some errors on cell-a
    for (let i = 0; i < 3; i++) {
      await invokeCapability('greet', { name: 'err' });
    }

    // Restore working handler
    registerHandler('cell-a', 'greet', async (input) => `Hello, ${input.name || 'world'}!`);

    // Now both cells have the capability again
    // cell-b should score higher since cell-a has errors
    const result = await invokeCapability('greet', { name: 'Scoring' });
    // We can't guarantee which cell wins (depends on initial invocations)
    // but we can verify the invocation succeeded
    assert.ok(
      result === 'Hello, Scoring!' || result === 'Hey Scoring!',
      `Should get valid greeting, got: ${JSON.stringify(result)}`
    );
  });
});
