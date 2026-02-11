// ============ Performance Monitor ============
// Tracks Core Web Vitals and custom metrics

export function initPerformanceMonitoring() {
  if (typeof window === 'undefined') return;

  // Track page load time
  window.addEventListener('load', () => {
    const timing = performance.getEntriesByType('navigation')[0];
    if (timing) {
      reportMetric('page_load', {
        domContentLoaded: Math.round(timing.domContentLoadedEventEnd),
        loadComplete: Math.round(timing.loadEventEnd),
        ttfb: Math.round(timing.responseStart - timing.requestStart),
      });
    }
  });

  // Track long tasks (>50ms)
  if ('PerformanceObserver' in window) {
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 100) {
            reportMetric('long_task', {
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
            });
          }
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      // PerformanceObserver not supported for longtask
    }
  }
}

function reportMetric(name, data) {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  if (!endpoint) return;

  try {
    navigator.sendBeacon(endpoint, JSON.stringify({
      type: 'metric',
      name,
      ...data,
      timestamp: Date.now(),
      url: window.location.pathname,
    }));
  } catch {
    // Silent fail
  }
}

// Export for manual metric tracking
export function trackEvent(name, data = {}) {
  reportMetric(name, data);
}
