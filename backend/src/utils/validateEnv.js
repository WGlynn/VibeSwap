// ============ Environment Validation ============

const REQUIRED_IN_PRODUCTION = {
  CORS_ORIGINS: 'CORS origin allowlist (comma-separated URLs)',
  PORT: 'Server port',
};

const OPTIONAL_VARS = {
  ETH_RPC_URL: 'Ethereum RPC endpoint',
  PRICE_CACHE_TTL: 'Price cache TTL in seconds',
  LOG_LEVEL: 'Logging level (debug/info/warn/error)',
  WS_MAX_CONNECTIONS: 'Max WebSocket connections',
};

export function validateEnv() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    return;
  }

  const missing = [];

  for (const [key, description] of Object.entries(REQUIRED_IN_PRODUCTION)) {
    if (!process.env[key] || process.env[key].trim() === '') {
      missing.push(`  ${key} - ${description}`);
    }
  }

  // CORS_ORIGINS must not be localhost in production
  const corsOrigins = process.env.CORS_ORIGINS || '';
  if (corsOrigins && /localhost|127\.0\.0\.1/.test(corsOrigins)) {
    missing.push('  CORS_ORIGINS - must not contain localhost in production');
  }

  if (missing.length > 0) {
    const msg = [
      'Missing or invalid environment variables for production:',
      ...missing,
      '',
      'Set these in your .env file or environment before starting in production mode.',
    ].join('\n');
    throw new Error(msg);
  }

  // Warn for optional vars
  for (const [key, description] of Object.entries(OPTIONAL_VARS)) {
    if (!process.env[key]) {
      // Use process.stderr since logger may not be initialized yet
      process.stderr.write(`[env] Optional: ${key} not set (${description})\n`);
    }
  }
}
