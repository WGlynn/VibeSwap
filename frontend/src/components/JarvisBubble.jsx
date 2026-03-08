import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useJarvis } from '../hooks/useJarvis'
import { remember } from '../utils/sankofa'

/**
 * Floating JARVIS chat bubble — available on every page.
 * Click to expand into a mini chat panel. Stays in corner.
 */
export default function JarvisBubble() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const { messages, isLoading, sendMessage, health, budget, voiceMode, toggleVoice, isSpeaking, speakText } = useJarvis()
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [isOpen, messages])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage(input)
    setInput('')
    remember('success', { page: '/jarvis-bubble', action: 'chat' })
  }

  const isOnline = health?.status === 'online'

  return (
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-24 right-6 z-50 w-14 h-14 rounded-full bg-matrix-600 hover:bg-matrix-500 text-black-900 shadow-lg shadow-matrix-600/30 flex items-center justify-center transition-colors"
            title="Talk to JARVIS"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {/* Online indicator */}
            <span className={`absolute top-1 right-1 w-3 h-3 rounded-full border-2 border-black-900 ${isOnline ? 'bg-matrix-400' : 'bg-red-500'}`} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 h-[28rem] flex flex-col rounded-2xl border border-black-700 shadow-2xl overflow-hidden backdrop-blur-2xl"
            style={{ background: 'rgba(4,4,4,0.95)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black-700">
              <div className="flex items-center space-x-2">
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-matrix-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-sm font-mono font-bold text-matrix-400">JARVIS</span>
                {budget && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    budget.degraded ? 'bg-amber-500/20 text-amber-400' :
                    'bg-matrix-500/10 text-matrix-500'
                  }`}>
                    {((Math.max(0, (budget.daily || 0) - (budget.used || 0))) / 1000).toFixed(1)} JUL
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* Voice mode toggle */}
                <button
                  onClick={toggleVoice}
                  className={`p-1.5 rounded transition-colors ${voiceMode ? 'bg-matrix-600/30 text-matrix-400' : 'hover:bg-black-700 text-black-400'}`}
                  title={voiceMode ? 'Voice mode ON — click to disable' : 'Enable voice responses'}
                >
                  {voiceMode ? (
                    <svg className={`w-4 h-4 ${isSpeaking ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  )}
                </button>
                <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-black-700 rounded">
                  <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto allow-scroll p-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-black-500 text-xs font-mono">Ask me anything about VibeSwap</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-matrix-600/20 text-white border border-matrix-700/30'
                        : msg.budgetExceeded
                          ? 'bg-amber-900/30 text-amber-200 border border-amber-700/50'
                          : 'bg-black-800 text-black-200 border border-black-700'
                    } ${msg.role === 'jarvis' && voiceMode ? 'cursor-pointer hover:border-matrix-600/50' : ''}`}
                    onClick={() => {
                      if (msg.role === 'jarvis' && voiceMode && msg.text) speakText(msg.text)
                    }}
                    title={msg.role === 'jarvis' && voiceMode ? 'Click to hear' : undefined}
                  >
                    {msg.text || msg.content}
                    {msg.budgetExceeded && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsOpen(false)
                          navigate('/mine')
                        }}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-matrix-600 hover:bg-matrix-500 text-black-900 font-bold text-xs rounded-lg transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Mine JUL for Extra Compute
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="px-3 py-2 rounded-xl text-sm bg-black-800 border border-black-700">
                    <span className="text-matrix-500 animate-pulse font-mono">...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-3 border-t border-black-700">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask JARVIS..."
                  className="flex-1 bg-black-800 border border-black-600 rounded-lg px-3 py-2 text-sm text-white placeholder-black-500 focus:border-matrix-600 focus:outline-none"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="px-3 py-2 bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 font-bold text-sm rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
