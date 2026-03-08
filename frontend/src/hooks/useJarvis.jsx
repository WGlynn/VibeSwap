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
  const [voiceMode, setVoiceMode] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const sessionIdRef = useRef(crypto.randomUUID())
  const audioRef = useRef(null)

  // Stop any playing audio
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsSpeaking(false)
  }, [])

  // Play TTS for a given text
  const speakText = useCallback(async (text) => {
    if (!text || !voiceMode) return
    stopSpeaking()
    setIsSpeaking(true)
    try {
      const res = await fetch(`${API_URL}/web/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 5000) }),
      })
      if (!res.ok) {
        setIsSpeaking(false)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setIsSpeaking(false)
        URL.revokeObjectURL(url)
        audioRef.current = null
      }
      audio.onerror = () => {
        setIsSpeaking(false)
        URL.revokeObjectURL(url)
        audioRef.current = null
      }
      await audio.play()
    } catch {
      setIsSpeaking(false)
    }
  }, [voiceMode, stopSpeaking])

  const toggleVoice = useCallback(() => {
    setVoiceMode(prev => {
      if (prev) stopSpeaking() // turning off — stop any playing audio
      return !prev
    })
  }, [stopSpeaking])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return

    const userMsg = { role: 'user', text: text.trim(), timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setError(null)

    // Add placeholder for streaming response
    const jarvisMsg = { role: 'jarvis', text: '', timestamp: new Date() }
    setMessages(prev => [...prev, jarvisMsg])

    try {
      const res = await fetch(`${API_URL}/web/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: text.trim(),
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      // Read SSE stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'chunk') {
              accumulated += event.text
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], text: accumulated }
                return updated
              })
            } else if (event.type === 'done') {
              if (event.budget) setBudget(event.budget)
            } else if (event.type === 'error') {
              throw new Error(event.message)
            }
          } catch (parseErr) {
            if (parseErr.message !== 'Unexpected end of JSON input') throw parseErr
          }
        }
      }

      // Final update with complete text
      if (accumulated) {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], text: accumulated }
          return updated
        })
        // Auto-speak in voice mode
        if (voiceMode) {
          speakText(accumulated)
        }
      }
    } catch (err) {
      const isBudgetExceeded = err.message.toLowerCase().includes('budget exceeded') || err.message.toLowerCase().includes('daily budget')
      const errorText = err.message.includes('Rate limited')
        ? '> Rate limited. Please wait a moment before sending another message.'
        : `> Connection error: ${err.message}`
      setMessages(prev => {
        const updated = [...prev]
        const errorMsg = {
          role: 'jarvis',
          text: errorText,
          timestamp: new Date(),
          budgetExceeded: isBudgetExceeded,
        }
        // Replace the empty streaming placeholder with error
        if (updated[updated.length - 1]?.role === 'jarvis' && !updated[updated.length - 1]?.text) {
          updated[updated.length - 1] = errorMsg
        } else {
          updated.push(errorMsg)
        }
        return updated
      })
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, voiceMode, speakText])

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

  // Cleanup audio on unmount
  useEffect(() => {
    return () => stopSpeaking()
  }, [stopSpeaking])

  return { messages, isLoading, mind, health, error, budget, sendMessage, voiceMode, toggleVoice, isSpeaking, stopSpeaking, speakText }
}
