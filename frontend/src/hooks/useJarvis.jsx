import { useState, useEffect, useRef, useCallback } from 'react'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

const INITIAL_GREETING = {
  role: 'jarvis',
  text: `> JARVIS ONLINE\n> Systems initialized. All protocols active.\n> Ready to assist, sir.`,
  timestamp: new Date(),
}

export function useJarvis() {
  const [messages, setMessages] = useState([INITIAL_GREETING])
  const [isLoading, setIsLoading] = useState(false)
  const [mind, setMind] = useState(null)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [budget, setBudget] = useState(null)
  const sessionIdRef = useRef(crypto.randomUUID())

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return

    const userMsg = { role: 'user', text: text.trim(), timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_URL}/web/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: text.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      if (data.budget) setBudget(data.budget)

      setMessages(prev => [...prev, {
        role: 'jarvis',
        text: data.reply,
        timestamp: new Date(data.timestamp || Date.now()),
      }])
    } catch (err) {
      const errorText = err.message.includes('Rate limited')
        ? '> Rate limited. Please wait a moment before sending another message.'
        : `> Connection error: ${err.message}`
      setMessages(prev => [...prev, {
        role: 'jarvis',
        text: errorText,
        timestamp: new Date(),
      }])
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading])

  const fetchMind = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/mind`)
      if (res.ok) {
        setMind(await res.json())
      }
    } catch {
      // Silently fail — mind panels just show stale data
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/health`)
      if (res.ok) {
        setHealth(await res.json())
      } else {
        setHealth({ status: 'offline' })
      }
    } catch {
      setHealth({ status: 'offline' })
    }
  }, [])

  // Poll mind data every 30s, health every 15s
  useEffect(() => {
    fetchHealth()
    fetchMind()
    const healthInterval = setInterval(fetchHealth, 15_000)
    const mindInterval = setInterval(fetchMind, 30_000)
    return () => {
      clearInterval(healthInterval)
      clearInterval(mindInterval)
    }
  }, [fetchHealth, fetchMind])

  return { messages, isLoading, mind, health, error, budget, sendMessage }
}
