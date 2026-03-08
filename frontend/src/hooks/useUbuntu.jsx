import { useState, useEffect, useCallback } from 'react'

// ============ Ubuntu — "I am because we are" ============
// Bantu philosophy: a person exists through their relationships.
// This hook tracks live presence — how many souls are here right now.

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'
const HEARTBEAT_INTERVAL = 30_000 // 30s

export function useUbuntu() {
  const [here, setHere] = useState(0)

  const heartbeat = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        const data = await res.json()
        setHere(data.here || 0)
      }
    } catch { /* we are still here, even in silence */ }
  }, [])

  useEffect(() => {
    heartbeat()
    const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL)
    return () => clearInterval(interval)
  }, [heartbeat])

  return { here }
}
