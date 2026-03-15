import { useState, useEffect, useCallback, useRef } from 'react'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'
const POLL_INTERVAL = 60_000 // 60 seconds (reduced from 30 to avoid noise)

// Default offline state — shows gracefully when VPS is unreachable
const OFFLINE_MESH = {
  mantra: 'cells within cells interlinked',
  status: 'disconnected',
  cells: [
    { id: 'fly-jarvis', name: 'JARVIS', type: 'full-node', status: 'unreachable' },
    { id: 'github-repo', name: 'GitHub', type: 'persistence', status: 'active' },
    { id: 'vercel-frontend', name: 'VibeSwap UI', type: 'light-node', status: 'active' },
  ],
  links: [
    { from: 'vercel-frontend', to: 'github-repo', status: 'active' },
  ],
  timestamp: new Date().toISOString(),
}

export function useMindMesh() {
  const [mesh, setMesh] = useState(OFFLINE_MESH)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const latencyRef = useRef(null)

  const fetchMesh = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000) // 5s timeout

      const start = performance.now()
      const res = await fetch(`${API_URL}/web/mesh`, { signal: controller.signal })
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
        setMesh(prev => prev || OFFLINE_MESH)
      }
    } catch {
      // Silently handle — VPS being down is expected state, not an error
      setError(null)
      setMesh(prev => prev || OFFLINE_MESH)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMesh()
    const interval = setInterval(fetchMesh, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchMesh])

  return { mesh, loading, error, latency: latencyRef.current, refresh: fetchMesh }
}
