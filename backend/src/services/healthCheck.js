const startTime = Date.now();

export async function getSystemHealth() {
  const issues = [];
  const checks = {};

  // Memory usage
  const mem = process.memoryUsage();
  const memUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const memTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  checks.memory = {
    usedMB: memUsedMB,
    totalMB: memTotalMB,
    percentage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
  };
  if (checks.memory.percentage > 90) {
    issues.push('High memory usage');
  }

  // Uptime
  checks.uptime = {
    seconds: Math.round((Date.now() - startTime) / 1000),
    startedAt: new Date(startTime).toISOString(),
  };

  // Node.js version
  checks.runtime = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  // Environment
  checks.environment = process.env.NODE_ENV || 'development';

  const status = issues.length === 0 ? 'healthy' : 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    issues,
    version: '1.0.0',
  };
}
