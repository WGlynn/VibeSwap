import { useState, useEffect, useCallback, useRef } from 'react'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://46-225-173-213.sslip.io'
const POLL_INTERVAL = 30_000 // 30 seconds

export function useMindMesh() {
  const [mesh, setMesh] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const latencyRef = useRef(null)

  const fetchMesh = useCallback(async () => {
    try {
      const start = performance.now()
      const res = await fetch(`${API_URL}/web/mesh`)
      const latency = Math.round(performance.now() - start)
      latencyRef.current = latency

      if (res.ok) {
        const data = await res.json()
        // Inject measured latency into the vercel->fly link
        const links = data.links?.map(link =>
          link.from === 'vercel-frontend' && link.to === 'fly-jarvis'
            ? { ...link, latency: `${latency}ms` }
            : link
        )
        setMesh({ ...data, links, measuredLatency: latency })
        setError(null)
      } else {
        setError(`HTTP ${res.status}`)
      }
    } catch (err) {
      setError(err.message)
      // Create offline mesh state
      setMesh({
        mantra: 'cells within cells interlinked',
        status: 'disconnected',
        cells: [
          { id: 'fly-jarvis', name: 'JARVIS', type: 'full-node', status: 'unreachable' },
          { id: 'github-repo', name: 'GitHub', type: 'persistence', status: 'unknown' },
          { id: 'vercel-frontend', name: 'VibeSwap UI', type: 'light-node', status: 'isolated' },
        ],
        links: [],
        timestamp: new Date().toISOString(),
      })
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
