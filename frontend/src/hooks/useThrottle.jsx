import { useRef, useCallback } from 'react'

// ============================================================
// useThrottle — Limit function execution to once per interval
// Used for scroll handlers, resize events, price updates
// ============================================================

export function useThrottle(fn, interval = 200) {
  const lastRun = useRef(0)
  const timeoutRef = useRef(null)

  return useCallback((...args) => {
    const now = Date.now()
    const remaining = interval - (now - lastRun.current)

    if (remaining <= 0) {
      lastRun.current = now
      fn(...args)
    } else if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        lastRun.current = Date.now()
        timeoutRef.current = null
        fn(...args)
      }, remaining)
    }
  }, [fn, interval])
}
