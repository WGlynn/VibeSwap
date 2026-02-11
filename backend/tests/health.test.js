import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getSystemHealth } from '../src/services/healthCheck.js';

describe('Health Check Service', () => {
  it('should return a valid status', async () => {
    const health = await getSystemHealth();
    assert.ok(['healthy', 'degraded'].includes(health.status));
    assert.ok(health.timestamp);
    assert.ok(health.checks.memory);
    assert.ok(health.checks.uptime);
    assert.ok(health.checks.runtime);
    assert.strictEqual(health.version, '1.0.0');
  });

  it('should include memory metrics', async () => {
    const health = await getSystemHealth();
    assert.ok(typeof health.checks.memory.usedMB === 'number');
    assert.ok(typeof health.checks.memory.totalMB === 'number');
    assert.ok(typeof health.checks.memory.percentage === 'number');
  });

  it('should include uptime info', async () => {
    const health = await getSystemHealth();
    assert.ok(typeof health.checks.uptime.seconds === 'number');
    assert.ok(health.checks.uptime.startedAt);
  });
});
