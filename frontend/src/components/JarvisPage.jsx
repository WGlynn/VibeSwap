import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'

const JARVIS_GREETING = `> JARVIS ONLINE
> Systems initialized. All protocols active.
> Ready to assist, sir.`

function JarvisPage() {
  const [messages, setMessages] = useState([
    { role: 'jarvis', text: JARVIS_GREETING, timestamp: new Date() }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || isTyping) return

    const userMessage = input.trim()
    setInput('')

    const updatedMessages = [...messages, {
      role: 'user',
      text: userMessage,
      timestamp: new Date()
    }]
    setMessages(updatedMessages)

    setIsTyping(true)

    try {
      // Build API messages — exclude the static greeting, convert format
      const apiMessages = updatedMessages
        .filter(m => m.role !== 'jarvis' || m.text !== JARVIS_GREETING)
        .map(m => ({
          role: m.role === 'jarvis' ? 'assistant' : 'user',
          content: m.text,
        }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'JARVIS is unreachable.')
      }

      setMessages(prev => [...prev, {
        role: 'jarvis',
        text: data.reply,
        timestamp: new Date()
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'jarvis',
        text: `> System error: ${err.message}`,
        timestamp: new Date()
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-[0.3em] text-matrix-400" style={{ fontFamily: 'monospace' }}>
          JARVIS
        </h1>
        <p className="text-black-400 text-sm mt-1 tracking-widest" style={{ fontFamily: 'monospace' }}>
          Just A Rather Very Intelligent System
        </p>
        <div className="flex items-center justify-center mt-3 space-x-2">
          <span className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
          <span className="text-matrix-500 text-xs font-mono">ONLINE</span>
        </div>
      </div>

      {/* Chat Window — AIM/AOL style */}
      <div className="flex-1 flex flex-col bg-black border border-black-600 rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-black-800 border-b border-black-600">
          <div className="flex items-center space-x-2">
            <span className="text-matrix-500 font-mono text-xs">JARVIS v1.0</span>
            <span className="text-black-500 font-mono text-xs">|</span>
            <span className="text-black-400 font-mono text-xs">vibeswap.protocol</span>
          </div>
          <div className="flex space-x-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-matrix-600" />
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 allow-scroll" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {msg.role === 'jarvis' ? (
                <div className="flex items-start space-x-2">
                  <span className="text-matrix-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                  <div>
                    <span className="text-matrix-400 font-bold">JARVIS</span>
                    <pre className="text-matrix-300 whitespace-pre-wrap mt-0.5 leading-relaxed">{msg.text}</pre>
                  </div>
                </div>
              ) : (
                <div className="flex items-start space-x-2">
                  <span className="text-black-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                  <div>
                    <span className="text-terminal-400 font-bold">you</span>
                    <p className="text-white mt-0.5">{msg.text}</p>
                  </div>
                </div>
              )}
            </motion.div>
          ))}

          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center space-x-2"
            >
              <span className="text-black-500">[{formatTime(new Date())}]</span>
              <span className="text-matrix-400 font-bold">JARVIS</span>
              <span className="text-matrix-500 animate-pulse font-mono">processing...</span>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar — command line style */}
        <form onSubmit={handleSend} className="border-t border-black-600 bg-black-900">
          <div className="flex items-center px-3 py-2">
            <span className="text-matrix-500 font-mono text-sm mr-2 shrink-0">&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isTyping}
              className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-black-500 disabled:opacity-50"
              autoComplete="off"
              spellCheck="false"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="ml-2 px-3 py-1 text-xs font-mono bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 rounded transition-colors"
            >
              SEND
            </button>
          </div>
        </form>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-black-500 font-mono text-[10px]">
          ENCRYPTED | BASE MAINNET | BLOCK #{Math.floor(Date.now() / 12000)}
        </span>
        <span className="text-black-500 font-mono text-[10px]">
          {messages.length - 1} messages
        </span>
      </div>
    </div>
  )
}

export default JarvisPage
