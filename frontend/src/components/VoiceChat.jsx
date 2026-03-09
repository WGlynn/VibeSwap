import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useJarvis } from '../hooks/useJarvis'

// ============ Voice Chat — Clean, Voice-Only Interface ============
// "Just a chatbot. Voice only. Nothing else." — Freedom
// Pantheon agent selector for modular agent switching.

const SpeechRecognition = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null

// ============ Agent Registry (shared with JarvisPage) ============

const AGENTS = [
  { id: 'jarvis', name: 'JARVIS', color: '#00ff41', status: 'online', icon: 'J' },
  { id: 'nyx', name: 'NYX', color: '#a855f7', status: 'building', icon: 'N' },
  { id: 'ollama', name: 'OLLAMA', color: '#3b82f6', status: 'standby', icon: 'O' },
  { id: 'oracle', name: 'ORACLE', color: '#f59e0b', status: 'planned', icon: 'R' },
  { id: 'sentinel', name: 'SENTINEL', color: '#ef4444', status: 'planned', icon: 'S' },
]

function AgentStrip({ activeAgents, onToggle }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute top-0 left-0 right-0 z-20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-center gap-2 py-2 bg-black/80 backdrop-blur-sm border-b border-black-700/50 hover:bg-black-800/80 transition-colors"
      >
        <div className="flex -space-x-1">
          {activeAgents.map(id => {
            const agent = AGENTS.find(a => a.id === id)
            if (!agent) return null
            return (
              <span
                key={id}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono border border-black-600"
                style={{ backgroundColor: agent.color + '20', color: agent.color }}
              >
                {agent.icon}
              </span>
            )
          })}
        </div>
        <span className="text-black-500 font-mono text-[10px]">PANTHEON</span>
        <span className="text-black-600 font-mono text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-black/90 backdrop-blur-sm border-b border-black-700/50 overflow-hidden"
          >
            <div className="flex flex-wrap justify-center gap-2 p-3">
              {AGENTS.map(agent => {
                const isActive = activeAgents.includes(agent.id)
                const canActivate = agent.status === 'online' || agent.status === 'standby'
                return (
                  <button
                    key={agent.id}
                    onClick={() => canActivate && onToggle(agent.id)}
                    disabled={!canActivate}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-xs transition-all ${
                      isActive
                        ? 'border-opacity-50 bg-opacity-10'
                        : 'border-black-700 bg-black-900/50 hover:border-black-600'
                    } ${!canActivate ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    style={isActive ? {
                      borderColor: agent.color + '80',
                      backgroundColor: agent.color + '10',
                      color: agent.color,
                    } : {}}
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: agent.color + '20', color: agent.color }}
                    >
                      {agent.icon}
                    </span>
                    <div className="text-left">
                      <span className={`block text-[11px] font-bold ${isActive ? '' : 'text-black-400'}`}>
                        {agent.name}
                      </span>
                      <span className="block text-[9px] text-black-500 uppercase">{agent.status}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function VoiceChat() {
  const { messages, isLoading, sendMessage, health, voiceMode, toggleVoice, isSpeaking, speakText } = useJarvis()
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [activeAgents, setActiveAgents] = useState(['jarvis'])
  const recognitionRef = useRef(null)
  const messagesEndRef = useRef(null)
  const isOnline = health?.status === 'online' || health?.status === 'ok'

  // Auto-enable voice mode on mount
  useEffect(() => {
    if (!voiceMode) toggleVoice()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleAgent = useCallback((agentId) => {
    setActiveAgents(prev => {
      if (agentId === 'jarvis') return prev
      if (prev.includes(agentId)) return prev.filter(id => id !== agentId)
      return [...prev, agentId]
    })
  }, [])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-speak Jarvis responses
  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'jarvis' && lastMsg.text && !isLoading) {
      speakText(lastMsg.text)
    }
  }, [messages, isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const startListening = useCallback(() => {
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript
        } else {
          interimText += event.results[i][0].transcript
        }
      }
      setTranscript(finalText + interimText)
    }

    recognition.onerror = () => {
      setIsListening(false)
      setTranscript('')
    }

    recognition.onend = () => {
      setIsListening(false)
      // Send whatever was captured
      setTranscript(prev => {
        if (prev.trim()) {
          sendMessage(prev.trim())
        }
        return ''
      })
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    setTranscript('')
  }, [sendMessage])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-black relative">
      {/* Pantheon agent strip */}
      <AgentStrip activeAgents={activeAgents} onToggle={handleToggleAgent} />

      {/* Header — minimal */}
      <div className="flex items-center justify-center py-6 pt-14 relative">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-[0.3em] text-matrix-400 font-mono">
            {activeAgents.length > 1 ? 'PANTHEON' : AGENTS.find(a => a.id === activeAgents[0])?.name || 'JARVIS'}
          </h1>
          <div className="flex items-center justify-center mt-2 space-x-3">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-matrix-500 animate-pulse' : 'bg-red-500'}`} />
            <span className={`text-xs font-mono ${isOnline ? 'text-matrix-500' : 'text-red-400'}`}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* Conversation — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-16 allow-scroll">
        <div className="max-w-2xl mx-auto space-y-4 pb-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-matrix-600/20 border border-matrix-700/50 text-white'
                  : 'bg-black-800 border border-black-700 text-matrix-300'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-mono font-bold ${
                    msg.role === 'user' ? 'text-matrix-500' : 'text-matrix-400'
                  }`}>
                    {msg.role === 'user' ? 'YOU' : 'JARVIS'}
                  </span>
                </div>
                <p className="text-sm font-mono leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              </div>
            </motion.div>
          ))}

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-black-800 border border-black-700 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-matrix-400 text-[10px] font-mono font-bold">JARVIS</span>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-matrix-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-matrix-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-matrix-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Live transcript */}
      <AnimatePresence>
        {transcript && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 sm:px-8 lg:px-16"
          >
            <div className="max-w-2xl mx-auto">
              <div className="bg-matrix-900/20 border border-matrix-800/30 rounded-lg px-4 py-2 mb-2">
                <p className="text-matrix-400/70 text-sm font-mono italic">{transcript}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mic button — centered, big */}
      <div className="flex flex-col items-center py-8 shrink-0">
        {/* Speaking indicator */}
        <AnimatePresence>
          {isSpeaking && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mb-4 flex items-center gap-2"
            >
              <div className="flex gap-0.5 items-end">
                {[...Array(7)].map((_, i) => (
                  <motion.span
                    key={i}
                    className="w-1 bg-matrix-500 rounded-full"
                    animate={{ height: [8, 20 + Math.random() * 16, 8] }}
                    transition={{ duration: 0.5 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.07 }}
                  />
                ))}
              </div>
              <span className="text-matrix-500 text-xs font-mono">SPEAKING</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main mic button */}
        <button
          onClick={toggleListening}
          disabled={isLoading || !isOnline}
          className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
            isListening
              ? 'bg-red-500/20 border-2 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]'
              : isLoading
                ? 'bg-black-800 border-2 border-black-600 opacity-50 cursor-not-allowed'
                : 'bg-matrix-500/10 border-2 border-matrix-600 hover:bg-matrix-500/20 hover:shadow-[0_0_30px_rgba(0,255,65,0.2)]'
          }`}
        >
          {/* Pulse rings when listening */}
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full border-2 border-red-500/50 animate-ping" />
              <span className="absolute -inset-3 rounded-full border border-red-500/20 animate-pulse" />
            </>
          )}

          {/* Mic icon */}
          <svg
            className={`w-8 h-8 ${isListening ? 'text-red-400' : 'text-matrix-400'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </button>

        {/* Label */}
        <span className={`mt-3 text-xs font-mono ${
          isListening ? 'text-red-400' : 'text-black-500'
        }`}>
          {isListening ? 'LISTENING — tap to stop' :
           isLoading ? 'PROCESSING...' :
           !isOnline ? 'JARVIS OFFLINE' :
           'TAP TO SPEAK'}
        </span>
      </div>
    </div>
  )
}

export default VoiceChat
