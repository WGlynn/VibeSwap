import { useState, useEffect, useRef, useCallback } from 'react'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://46-225-173-213.sslip.io'

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

  // Browser-native SpeechSynthesis fallback (works everywhere, no API needed)
  const browserSpeak = useCallback((text) => {
    if (!window.speechSynthesis) return false
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000))
    // Pick the best British male voice for JARVIS feel
    // Priority: Microsoft George > Google UK Male > any en-GB male > any en-GB > any en
    const voices = window.speechSynthesis.getVoices()
    const nameMatch = (v, keywords) => keywords.some(k => v.name.toLowerCase().includes(k))
    const british =
      voices.find(v => v.lang === 'en-GB' && nameMatch(v, ['george', 'daniel', 'james', 'ryan'])) ||
      voices.find(v => v.lang === 'en-GB' && nameMatch(v, ['male', 'guy'])) ||
      voices.find(v => v.lang === 'en-GB' && !nameMatch(v, ['female', 'woman', 'girl', 'zira', 'hazel', 'susan', 'libby', 'maisie', 'sonia'])) ||
      voices.find(v => v.lang === 'en-GB') ||
      voices.find(v => v.lang.startsWith('en') && nameMatch(v, ['david', 'mark', 'guy', 'male'])) ||
      voices.find(v => v.lang.startsWith('en'))
    if (british) utterance.voice = british
    utterance.rate = 1.05
    utterance.pitch = 0.9
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
    return true
  }, [])

  // Play TTS for a given text
  // Priority: Server TTS (ElevenLabs/Google) → Browser SpeechSynthesis
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
        // Server TTS unavailable — fall back to browser speech
        console.warn('[jarvis] Server TTS failed, using browser SpeechSynthesis')
        if (!browserSpeak(text)) setIsSpeaking(false)
        return
      }
      const blob = await res.blob()
      if (blob.size < 100) {
        // Empty or near-empty audio — use browser fallback
        console.warn('[jarvis] TTS returned empty audio, using browser SpeechSynthesis')
        if (!browserSpeak(text)) setIsSpeaking(false)
        return
      }
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        setIsSpeaking(false)
        URL.revokeObjectURL(url)
        audioRef.current = null
      }
      audio.onerror = () => {
        // Audio playback failed — try browser speech
        setIsSpeaking(false)
        URL.revokeObjectURL(url)
        audioRef.current = null
        browserSpeak(text)
      }
      await audio.play()
    } catch {
      // Network error — try browser speech
      console.warn('[jarvis] TTS network error, using browser SpeechSynthesis')
      if (!browserSpeak(text)) setIsSpeaking(false)
    }
  }, [voiceMode, stopSpeaking, browserSpeak])

  const toggleVoice = useCallback(() => {
    setVoiceMode(prev => {
      if (prev) stopSpeaking() // turning off — stop any playing audio
      return !prev
    })
  }, [stopSpeaking])

  const sendMessage = useCallback(async (text, attachments) => {
    if (!text.trim() || isLoading) return

    const userMsg = {
      role: 'user',
      text: text.trim(),
      timestamp: new Date(),
      attachments: attachments?.map(a => ({ name: a.name, size: a.size, type: a.type, preview: a.preview })) || undefined,
    }
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
      // If VPS fails for ANY reason (budget, network, etc.) — fall back to Vercel /api/chat
      // Chat is free. Always. No budget gates.
      try {
        const chatHistory = messages.filter(m => m.text && m.role).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text,
        }))
        chatHistory.push({ role: 'user', content: text.trim() })

        const fallbackRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatHistory }),
        })

        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json()
          const replyText = fallbackData.reply || fallbackData.text || 'Connection recovered.'
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              text: replyText,
            }
            return updated
          })
          if (voiceMode) speakText(replyText)
          setError(null)
          return // Fallback succeeded — no error shown
        }
      } catch {
        // Fallback also failed — show generic error (never mention mining/tokens)
      }

      const errorText = '> Connection issue. Please try again in a moment.'
      setMessages(prev => {
        const updated = [...prev]
        const errorMsg = {
          role: 'jarvis',
          text: errorText,
          timestamp: new Date(),
        }
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

  // Require 3 consecutive failures before showing offline — transient blips don't count
  const healthFailsRef = useRef(0)
  const HEALTH_FAIL_THRESHOLD = 3

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/health`, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        healthFailsRef.current = 0
        setHealth(await res.json())
      } else {
        healthFailsRef.current++
        if (healthFailsRef.current >= HEALTH_FAIL_THRESHOLD) {
          setHealth({ status: 'offline' })
        }
      }
    } catch {
      healthFailsRef.current++
      if (healthFailsRef.current >= HEALTH_FAIL_THRESHOLD) {
        setHealth({ status: 'offline' })
      }
    }
  }, [])

  // Poll mind data every 30s, health every 30s (3 fails = 90s before offline)
  useEffect(() => {
    fetchHealth()
    fetchMind()
    const healthInterval = setInterval(fetchHealth, 30_000)
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
