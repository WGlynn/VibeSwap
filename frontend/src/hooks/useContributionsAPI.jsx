import { useState, useEffect, useCallback } from 'react'

const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
const webPath = (endpoint) => isVercel ? `/jarvis-api/${endpoint}` : `https://jarvis-vibeswap.fly.dev/web/${endpoint}`

/**
 * Hook to fetch real contribution data from the Jarvis attribution graph.
 *
 * Pulls from /web/attribution (passive-attribution.js on the bot).
 * Falls back to null if API unreachable — caller decides what to show.
 */
export function useContributionsAPI() {
  const [stats, setStats] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${webPath('attribution')}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
        setError(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchAuthor = useCallback(async (author) => {
    try {
      const res = await fetch(`${API_URL}/web/attribution?author=${encodeURIComponent(author)}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        return await res.json()
      }
    } catch {
      return null
    }
    return null
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 60_000) // Refresh every 60s
    return () => clearInterval(interval)
  }, [fetchStats])

  return { stats, isLoading, error, fetchAuthor, refresh: fetchStats }
}
