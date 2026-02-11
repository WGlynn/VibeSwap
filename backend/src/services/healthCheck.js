const startTime = Date.now();

export async function getSystemHealth(deps = {}) {
  const { priceFeed, wss } = deps;
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

  // Price feed freshness
  if (priceFeed) {
    const status = priceFeed.getStatus();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const isStale = !status.lastFetchSuccess || (Date.now() - status.lastFetchSuccess > staleThreshold);
    checks.priceFeed = {
      lastFetchSuccess: status.lastFetchSuccess ? new Date(status.lastFetchSuccess).toISOString() : null,
      cachedSymbols: status.cachedSymbols,
      hasFallbackData: status.hasFallbackData,
      stale: isStale,
    };
    if (isStale) {
      issues.push('Price feed data is stale (>5min since last successful fetch)');
    }
    if (status.hasFallbackData) {
      issues.push('Price feed is using hardcoded fallback data');
    }
  }

  // WebSocket connections
  if (wss && typeof wss.getClientCount === 'function') {
    checks.websocket = {
      connections: wss.getClientCount(),
    };
  }

  const status = issues.length === 0 ? 'healthy' : 'degraded';

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    issues,
    version: '1.0.0',
  };
}
