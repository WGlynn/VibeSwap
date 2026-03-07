// ============ MI Manifest Tests ============
// Tests for manifest validation, registration, capability matching, and querying.
// Uses Node built-in test runner (node:test).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, registerCell, unregisterCell, matchCapability, matchSignal, queryCells, getRegistryStats } from '../src/mi-manifest.js';

// ============ Helper: Create a valid manifest ============

function makeManifest(overrides = {}) {
  return {
    mi: '0.1',
    id: 'test-cell',
    name: 'Test Cell',
    version: '1.0.0',
    kind: 'service',
    domain: 'testing',
    tags: ['test', 'unit'],
    capabilities: [
      { name: 'doSomething', description: 'Does something' },
      { name: 'doAnother', description: 'Does another thing' },
    ],
    signals: {
      subscribe: ['test.signal', 'test.other'],
      emit: ['test.result'],
    },
    lifecycle: {
      candidates: [{ identity: 'default', condition: 'true', priority: 1 }],
      learn: { strategy: 'fixed' },
      commit: { min_dwell_ms: 1000 },
    },
    runtime: { sandbox: 'worker', memory_limit_mb: 64, energy_budget: 50 },
    surfaces: ['telegram', 'api'],
    ...overrides,
  };
}

// ============ Validation Tests ============

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    const result = validateManifest(makeManifest());
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should reject manifest with missing required fields', () => {
    const result = validateManifest({ mi: '0.1' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('id')));
    assert.ok(result.errors.some(e => e.includes('name')));
    assert.ok(result.errors.some(e => e.includes('kind')));
    assert.ok(result.errors.some(e => e.includes('capabilities')));
  });

  it('should reject unsupported MI version', () => {
    const result = validateManifest(makeManifest({ mi: '99.0' }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('version')));
  });

  it('should reject invalid kind', () => {
    const result = validateManifest(makeManifest({ kind: 'nonexistent' }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid kind')));
  });

  it('should reject non-array capabilities', () => {
    const result = validateManifest(makeManifest({ capabilities: 'wrong' }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must be an array')));
  });

  it('should reject capabilities without names', () => {
    const result = validateManifest(makeManifest({
      capabilities: [{ description: 'no name' }],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('missing name')));
  });

  it('should reject invalid sandbox', () => {
    const result = validateManifest(makeManifest({
      runtime: { sandbox: 'invalid' },
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('sandbox')));
  });

  it('should reject invalid surfaces', () => {
    const result = validateManifest(makeManifest({
      surfaces: ['telegram', 'hologram'],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid surface')));
  });

  it('should reject invalid learn strategy', () => {
    const result = validateManifest(makeManifest({
      lifecycle: { learn: { strategy: 'quantum' } },
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('strategy')));
  });

  it('should accept all valid kinds', () => {
    for (const kind of ['ui', 'service', 'orchestrator', 'proxy', 'sensor']) {
      const result = validateManifest(makeManifest({ kind }));
      assert.equal(result.valid, true, `Kind '${kind}' should be valid`);
    }
  });

  it('should accept all valid strategies', () => {
    for (const strategy of ['contextual_bandit', 'nca', 'evolutionary', 'fixed']) {
      const result = validateManifest(makeManifest({
        lifecycle: { learn: { strategy } },
      }));
      assert.equal(result.valid, true, `Strategy '${strategy}' should be valid`);
    }
  });
});

// ============ Registry Tests ============

describe('registerCell / unregisterCell', () => {
  afterEach(() => {
    unregisterCell('test-cell');
    unregisterCell('test-cell-2');
  });

  it('should register a cell and index capabilities', () => {
    const manifest = makeManifest();
    registerCell(manifest);

    const matches = matchCapability('doSomething');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 'test-cell');
  });

  it('should unregister a cell and remove from indexes', () => {
    registerCell(makeManifest());
    assert.equal(matchCapability('doSomething').length, 1);

    unregisterCell('test-cell');
    assert.equal(matchCapability('doSomething').length, 0);
  });

  it('should return false for unregistering non-existent cell', () => {
    assert.equal(unregisterCell('nonexistent'), false);
  });
});

// ============ Capability Matching Tests ============

describe('matchCapability', () => {
  afterEach(() => {
    unregisterCell('test-cell');
    unregisterCell('test-cell-2');
  });

  it('should match capability across multiple cells', () => {
    registerCell(makeManifest({ id: 'test-cell' }));
    registerCell(makeManifest({
      id: 'test-cell-2',
      name: 'Test Cell 2',
      capabilities: [{ name: 'doSomething', description: 'Also does it' }],
    }));

    const matches = matchCapability('doSomething');
    assert.equal(matches.length, 2);
  });

  it('should return empty for unknown capability', () => {
    assert.deepEqual(matchCapability('nonexistent'), []);
  });
});

// ============ Signal Matching Tests ============

describe('matchSignal', () => {
  afterEach(() => {
    unregisterCell('test-cell');
    unregisterCell('signal-cell');
  });

  it('should match subscribed signals', () => {
    registerCell(makeManifest());
    const matches = matchSignal('test.signal');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 'test-cell');
  });

  it('should return empty for unsubscribed signals', () => {
    registerCell(makeManifest());
    assert.deepEqual(matchSignal('unknown.signal'), []);
  });
});

// ============ Query Tests ============

describe('queryCells', () => {
  afterEach(() => {
    unregisterCell('test-cell');
    unregisterCell('test-cell-2');
  });

  it('should query by kind', () => {
    registerCell(makeManifest({ id: 'test-cell', kind: 'service' }));
    registerCell(makeManifest({ id: 'test-cell-2', kind: 'orchestrator', name: 'Orch' }));

    const services = queryCells({ kind: 'service' });
    assert.equal(services.length, 1);
    assert.equal(services[0].id, 'test-cell');
  });

  it('should query by domain', () => {
    registerCell(makeManifest({ id: 'test-cell', domain: 'trading' }));
    registerCell(makeManifest({ id: 'test-cell-2', domain: 'testing', name: 'Test 2' }));

    const trading = queryCells({ domain: 'trading' });
    assert.equal(trading.length, 1);
    assert.equal(trading[0].domain, 'trading');
  });

  it('should query by tags', () => {
    registerCell(makeManifest({ id: 'test-cell', tags: ['crypto', 'price'] }));
    registerCell(makeManifest({ id: 'test-cell-2', tags: ['fun', 'social'], name: 'Fun' }));

    const crypto = queryCells({ tags: ['crypto'] });
    assert.equal(crypto.length, 1);
    assert.equal(crypto[0].id, 'test-cell');
  });

  it('should query by surface', () => {
    registerCell(makeManifest({ id: 'test-cell', surfaces: ['telegram'] }));
    registerCell(makeManifest({ id: 'test-cell-2', surfaces: ['web'], name: 'Web' }));

    const telegram = queryCells({ surface: 'telegram' });
    assert.equal(telegram.length, 1);
    assert.equal(telegram[0].id, 'test-cell');
  });

  it('should return all cells with no filters', () => {
    registerCell(makeManifest({ id: 'test-cell' }));
    registerCell(makeManifest({ id: 'test-cell-2', name: 'Two' }));

    const all = queryCells();
    assert.ok(all.length >= 2);
  });
});
