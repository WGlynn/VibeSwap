import { useState, useEffect, useCallback, useRef } from 'react'

// Use Vercel proxy in production (same-origin, no CORS issues)
// Fall back to direct Fly.io URL for local dev
const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
const API_URL = import.meta.env.VITE_JARVIS_API_URL || (isVercel ? '' : 'https://jarvis-vibeswap.fly.dev')
const MESH_PATH = isVercel ? '/jarvis-api/mesh' : `${API_URL}/web/mesh`
const POLL_INTERVAL = 30_000 // 30 seconds — mesh should feel alive

// Initial state while connecting — shows "connecting" not "disconnected"
const INITIAL_MESH = null // null = still loading, triggers "connecting" state in UI

export function useMindMesh() {
  const [mesh, setMesh] = useState(INITIAL_MESH)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const latencyRef = useRef(null)

  const fetchMesh = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000) // 15s timeout (Fly cold starts)

      const start = performance.now()
      const res = await fetch(MESH_PATH, { signal: controller.signal })
      clearTimeout(timeout)
      const latency = Math.round(performance.now() - start)
      latencyRef.current = latency

      if (res.ok) {
        const data = await res.json()
        const links = data.links?.map(link =>
          link.from === 'vercel-frontend' && link.to === 'fly-jarvis'
            ? { ...link, latency: `${latency}ms` }
            : link
        )
        setMesh({ ...data, links, measuredLatency: latency })
        setError(null)
      } else {
        setError(`HTTP ${res.status}`)
        // Keep previous good data if we had it
      }
    } catch {
      // Silently handle — VPS being down is expected state, not an error
      setError(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // First fetch immediately, retry quickly if it fails, then settle into poll interval
    fetchMesh()
    const quickRetry = setTimeout(fetchMesh, 3000)  // Retry after 3s if first attempt failed
    const interval = setInterval(fetchMesh, POLL_INTERVAL)
    return () => {
      clearTimeout(quickRetry)
      clearInterval(interval)
    }
  }, [fetchMesh])

  return { mesh, loading, error, latency: latencyRef.current, refresh: fetchMesh }
}
