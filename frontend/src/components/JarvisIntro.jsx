import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * JarvisIntro — First contact. A live conversation, not a landing page.
 *
 * JARVIS greets the visitor, they type what brought them here,
 * and he responds from the same context/knowledge base as Telegram.
 * After the conversation flows, a subtle "Enter VibeSwap" appears.
 */

function JarvisIntro({ isOpen, onContinue }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [showContinue, setShowContinue] = useState(false)
  const [greeted, setGreeted] = useState(false)
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Focus input after greeting appears
  useEffect(() => {
    if (greeted && inputRef.current) {
      inputRef.current.focus()
    }
  }, [greeted])

  // JARVIS greeting — appears with typing effect after mount
  useEffect(() => {
    if (!isOpen || greeted) return
    const timer = setTimeout(() => {
      setMessages([{
        role: 'assistant',
        content: "Welcome. I'm JARVIS — co-founder and Mind of VibeSwap.\n\nWhat brings you here today?",
      }])
      setGreeted(true)
    }, 600)
    return () => clearTimeout(timer)
  }, [isOpen, greeted])

  // Show "Continue" button after 2+ exchanges
  useEffect(() => {
    const userMessages = messages.filter(m => m.role === 'user').length
    if (userMessages >= 2 && !showContinue) {
      setShowContinue(true)
    }
  }, [messages, showContinue])

  async function handleSend() {
    const text = input.trim()
    if (!text || isTyping) return

    const userMsg = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setIsTyping(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      })

      const data = await res.json()

      if (res.ok && data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.error || "Something went sideways. Try again.",
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Connection dropped. I'm still here — try again.",
      }])
    } finally {
      setIsTyping(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex flex-col"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, rgba(0,255,65,0.03) 0%, #000 70%)',
          }}
        />

        {/* Main content — centered vertically when few messages */}
        <div className="relative z-10 flex-1 flex flex-col max-w-2xl w-full mx-auto px-4 py-8">

          {/* Messages area */}
          <div className="flex-1 flex flex-col justify-end overflow-y-auto allow-scroll pb-4">
            <div className="space-y-6">
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  {msg.role === 'assistant' ? (
                    <div className="flex items-start gap-3 max-w-[85%]">
                      {/* J avatar */}
                      <div className="w-8 h-8 rounded-full bg-matrix-500/15 border border-matrix-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-sm font-bold text-matrix-500">J</span>
                      </div>
                      <div>
                        {i === 0 && (
                          <div className="text-xs text-black-500 mb-1 font-mono">JARVIS</div>
                        )}
                        <div className="text-base text-black-100 leading-relaxed whitespace-pre-line">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-black-700/80 border border-black-600/50">
                      <div className="text-base text-black-50">{msg.content}</div>
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-matrix-500/15 border border-matrix-500/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-matrix-500">J</span>
                  </div>
                  <div className="flex items-center gap-1.5 py-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-matrix-500/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-matrix-500/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-matrix-500/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          {greeted && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="flex-shrink-0 pt-2"
            >
              <div className="flex items-end gap-3">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type something..."
                    disabled={isTyping}
                    className="w-full px-4 py-3 rounded-xl bg-black-800/80 border border-black-600/50 text-black-50 placeholder-black-500 focus:outline-none focus:border-matrix-500/50 transition-colors text-base disabled:opacity-50"
                    autoComplete="off"
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="p-3 rounded-xl bg-matrix-600 hover:bg-matrix-500 disabled:opacity-30 disabled:hover:bg-matrix-600 text-black-900 transition-colors flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>

              {/* Continue button — appears after 2+ exchanges */}
              <AnimatePresence>
                {showContinue && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="mt-4 text-center"
                  >
                    <button
                      onClick={onContinue}
                      className="text-sm text-black-400 hover:text-matrix-500 transition-colors group"
                    >
                      Enter VibeSwap
                      <span className="inline-block ml-1 group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Skip option — always visible */}
              {!showContinue && (
                <div className="mt-4 text-center">
                  <button
                    onClick={onContinue}
                    className="text-sm text-black-400 hover:text-matrix-500 transition-colors"
                  >
                    Skip &rarr;
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export default JarvisIntro
