// ============ Web Vitals + Error Reporting ============
// Sends performance metrics and errors to JARVIS for monitoring

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

function report(data) {
  try {
    navigator.sendBeacon?.(`${API_URL}/web/report`, JSON.stringify(data))
      || fetch(`${API_URL}/web/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true,
      }).catch(() => {})
  } catch { /* silent */ }
}

export function initErrorReporting() {
  window.addEventListener('error', (e) => {
    report({
      type: 'error',
      message: e.message,
      url: e.filename,
      line: e.lineno,
      col: e.colno,
      userAgent: navigator.userAgent,
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    report({
      type: 'error',
      message: e.reason?.message || String(e.reason),
      url: window.location.href,
      userAgent: navigator.userAgent,
    })
  })
}

export function reportWebVitals() {
  if (!('PerformanceObserver' in window)) return

  const vitals = {}

  // LCP
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      vitals.lcp = Math.round(last.startTime)
    })
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch { /* unsupported */ }

  // FCP
  try {
    const paintEntries = performance.getEntriesByType('paint')
    const fcp = paintEntries.find(e => e.name === 'first-contentful-paint')
    if (fcp) vitals.fcp = Math.round(fcp.startTime)
  } catch { /* unsupported */ }

  // CLS
  try {
    let clsValue = 0
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) clsValue += entry.value
      }
      vitals.cls = Math.round(clsValue * 1000) / 1000
    })
    clsObserver.observe({ type: 'layout-shift', buffered: true })
  } catch { /* unsupported */ }

  // Report after 10s (give page time to fully load)
  setTimeout(() => {
    if (Object.keys(vitals).length > 0) {
      report({ type: 'vitals', vitals, url: window.location.href, userAgent: navigator.userAgent })
    }
  }, 10000)
}
