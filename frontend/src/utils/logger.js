// ============ Production Logger ============
// Structured logging with environment-aware output

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = import.meta.env.VITE_PRODUCTION_MODE === 'true'
  ? LOG_LEVELS.warn
  : LOG_LEVELS.debug;

function formatMessage(level, context, message, data) {
  return {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...(data && { data }),
  };
}

export const logger = {
  debug(context, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.debug) {
      console.debug(formatMessage('debug', context, message, data));
    }
  },

  info(context, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.info) {
      console.info(formatMessage('info', context, message, data));
    }
  },

  warn(context, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.warn) {
      console.warn(formatMessage('warn', context, message, data));
    }
  },

  error(context, message, data) {
    if (CURRENT_LEVEL <= LOG_LEVELS.error) {
      const entry = formatMessage('error', context, message, data);
      console.error(entry);

      // Send to error tracking service if configured
      const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
      if (sentryDsn && typeof window !== 'undefined') {
        reportError(entry);
      }
    }
  },
};

function reportError(entry) {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  if (!endpoint) return;

  try {
    navigator.sendBeacon(endpoint, JSON.stringify({
      type: 'error',
      ...entry,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }));
  } catch {
    // Silently fail - don't let error reporting cause errors
  }
}
