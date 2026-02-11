// ============ Environment Validation ============
// Validates required environment variables at startup

const REQUIRED_FOR_PRODUCTION = [
  'VITE_WALLETCONNECT_PROJECT_ID',
];

const RECOMMENDED_FOR_PRODUCTION = [
  'VITE_ETH_RPC_URL',
  'VITE_ARB_RPC_URL',
  'VITE_SENTRY_DSN',
];

export function validateEnvironment() {
  const isProduction = import.meta.env.VITE_PRODUCTION_MODE === 'true';
  const warnings = [];
  const errors = [];

  if (isProduction) {
    for (const key of REQUIRED_FOR_PRODUCTION) {
      if (!import.meta.env[key]) {
        errors.push(`Missing required env var: ${key}`);
      }
    }

    for (const key of RECOMMENDED_FOR_PRODUCTION) {
      if (!import.meta.env[key]) {
        warnings.push(`Missing recommended env var: ${key}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('[VibeSwap] Environment warnings:', warnings);
  }

  if (errors.length > 0) {
    console.error('[VibeSwap] Environment errors:', errors);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function getEnvironmentInfo() {
  return {
    mode: import.meta.env.MODE,
    production: import.meta.env.VITE_PRODUCTION_MODE === 'true',
    mainnet: import.meta.env.VITE_ENABLE_MAINNET === 'true',
    testnetsDisabled: import.meta.env.VITE_DISABLE_TESTNETS === 'true',
  };
}
