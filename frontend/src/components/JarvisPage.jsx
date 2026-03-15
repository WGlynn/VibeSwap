import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useJarvis } from '../hooks/useJarvis'
import { useMindMesh } from '../hooks/useMindMesh'

// ============ Simple Markdown Renderer ============

function renderMarkdown(text) {
  if (!text) return ''

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (``` ... ```) — must come before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="md-codeblock"><code class="md-code-lang-${lang || 'text'}">${code.trim()}</code></pre>`
  })

  // Inline code (`...`)
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>')

  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>')

  // Italic (*...*)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em class="md-italic">$1</em>')

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>')

  // Unordered lists (- item)
  html = html.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>')
  html = html.replace(/(<li class="md-li">.*<\/li>\n?)+/g, (match) => `<ul class="md-ul">${match}</ul>`)

  // Ordered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>')
  html = html.replace(/(<li class="md-oli">.*<\/li>\n?)+/g, (match) => `<ol class="md-ol">${match}</ol>`)

  // Headers (## ...)
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')

  return html
}

const markdownStyles = `
  .md-rendered { line-height: 1.6; }
  .md-rendered .md-codeblock {
    background: rgba(0, 255, 65, 0.05);
    border: 1px solid rgba(0, 255, 65, 0.15);
    border-radius: 4px;
    padding: 10px 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-size: 12px;
    white-space: pre;
  }
  .md-rendered .md-inline-code {
    background: rgba(0, 255, 65, 0.08);
    border: 1px solid rgba(0, 255, 65, 0.12);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.9em;
  }
  .md-rendered .md-bold { color: #4ade80; font-weight: 700; }
  .md-rendered .md-italic { color: #86efac; font-style: italic; }
  .md-rendered .md-link {
    color: #22d3ee;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .md-rendered .md-link:hover { color: #67e8f9; }
  .md-rendered .md-ul, .md-rendered .md-ol {
    padding-left: 18px;
    margin: 4px 0;
  }
  .md-rendered .md-li, .md-rendered .md-oli { margin: 2px 0; }
  .md-rendered .md-h1 { font-size: 1.3em; font-weight: 700; color: #4ade80; margin: 12px 0 4px; }
  .md-rendered .md-h2 { font-size: 1.15em; font-weight: 700; color: #4ade80; margin: 10px 0 4px; }
  .md-rendered .md-h3 { font-size: 1.05em; font-weight: 600; color: #4ade80; margin: 8px 0 4px; }
`

// ============ Time Formatter ============

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatUptime(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

// ============ Hero Section ============

function HeroSection({ health }) {
  const isOnline = health?.status === 'online' || health?.status === 'ok'

  return (
    <div className="text-center py-6 relative">
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-radial from-matrix-900/20 to-transparent pointer-events-none" />

      <h1 className="text-4xl sm:text-5xl font-bold tracking-[0.3em] text-matrix-400 font-mono">
        JARVIS
      </h1>
      <p className="text-black-400 text-sm mt-1 tracking-widest font-mono">
        Just A Rather Very Intelligent System
      </p>

      <div className="flex items-center justify-center mt-3 space-x-4">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-matrix-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-xs font-mono ${isOnline ? 'text-matrix-500' : 'text-red-400'}`}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
        {health?.uptime && (
          <span className="text-black-400 text-xs font-mono">
            UP {formatUptime(health.uptime)}
          </span>
        )}
        {health?.shardId && (
          <span className="text-black-500 text-xs font-mono">
            {health.shardId}
          </span>
        )}
      </div>
    </div>
  )
}

// ============ Chat Panel ============

const MAX_INPUT_CHARS = 4000

function ChatPanel({ messages, isLoading, onSend, voiceMode, toggleVoice, isSpeaking, speakText, health, activeAgents = ['jarvis'] }) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [input, autoResize])

  // ---- Speech-to-Text (Web Speech API) ----
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('[jarvis] Speech recognition not supported')
      return
    }
    if (recognitionRef.current) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    let finalTranscript = ''

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript
        } else {
          interim = transcript
        }
      }
      setInput(prev => {
        // Append final transcript + show interim
        const base = finalTranscript
        return base + (interim ? interim : '')
      })
    }

    recognition.onerror = (event) => {
      console.warn('[jarvis] Speech recognition error:', event.error)
      setIsListening(false)
      recognitionRef.current = null
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
      // Auto-send if we got text
      if (finalTranscript.trim()) {
        setTimeout(() => {
          // Let React update input first, then auto-send
          onSend(finalTranscript.trim())
          setInput('')
          finalTranscript = ''
        }, 100)
      }
    }

    recognition.start()
    setIsListening(true)
  }, [onSend])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
    }
  }, [])

  // ---- File Attachments ----
  const handleFiles = useCallback((files) => {
    const newAttachments = Array.from(files).map(file => ({
      file,
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }))
    setAttachments(prev => [...prev, ...newAttachments])
  }, [])

  const removeAttachment = useCallback((id) => {
    setAttachments(prev => {
      const removed = prev.find(a => a.id === id)
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter(a => a.id !== id)
    })
  }, [])

  // Drag and drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files?.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  // ---- Submit ----
  const handleSubmit = useCallback((e) => {
    if (e) e.preventDefault()
    if (!input.trim() || isLoading) return
    onSend(input, attachments.length > 0 ? attachments : undefined)
    setInput('')
    setAttachments([])
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }, [input, isLoading, onSend, attachments])

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e) => {
    // Enter to send (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
      return
    }
    // Ctrl+M to toggle voice mode
    if (e.key === 'm' && e.ctrlKey) {
      e.preventDefault()
      toggleVoice()
      return
    }
  }, [handleSubmit, toggleVoice])

  // Global Ctrl+M shortcut
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'm' && e.ctrlKey) {
        e.preventDefault()
        toggleVoice()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleVoice])

  // Model info from health
  const modelName = health?.model || null

  return (
    <div
      className={`flex flex-col bg-black border rounded-lg overflow-hidden h-full transition-colors relative ${
        isDragOver ? 'border-matrix-500 bg-matrix-900/5' : 'border-black-600'
      }`}
      style={{ minHeight: '400px' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Markdown styles */}
      <style>{markdownStyles}</style>

      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black-800 border-b border-black-600 shrink-0">
        <div className="flex items-center space-x-2">
          {/* Active agent avatars */}
          <div className="flex -space-x-1">
            {activeAgents.map(id => {
              const agent = AGENTS.find(a => a.id === id)
              if (!agent) return null
              const colors = AGENT_COLORS[agent.color]
              return (
                <span
                  key={id}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono ${colors.bg} ${colors.text} border ${colors.border} relative z-10`}
                  title={`${agent.name} — ${agent.role}`}
                >
                  {agent.icon}
                </span>
              )
            })}
          </div>
          <span className="text-matrix-500 font-mono text-xs">
            {activeAgents.length > 1 ? 'MULTI-AGENT' : 'JARVIS v2.0'}
          </span>
          <span className="text-black-500 font-mono text-xs">|</span>
          <span className="text-black-400 font-mono text-xs">vibeswap.mind</span>
          {modelName && (
            <>
              <span className="text-black-500 font-mono text-xs">|</span>
              <span className="text-black-500 font-mono text-[10px] px-1.5 py-0.5 rounded border border-black-700 bg-black-800/50" title={`Active model: ${modelName}`}>
                {modelName.length > 28 ? modelName.slice(0, 28) + '...' : modelName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={toggleVoice}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${voiceMode ? 'bg-matrix-600/30 text-matrix-400' : 'text-black-500 hover:text-black-300'}`}
            title={voiceMode ? 'Voice ON (Ctrl+M)' : 'Enable voice (Ctrl+M)'}
          >
            {voiceMode ? (
              <svg className={`w-3 h-3 ${isSpeaking ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
            {voiceMode ? 'VOICE' : ''}
          </button>
          <div className="flex space-x-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-black-600" />
            <div className="w-2.5 h-2.5 rounded-full bg-matrix-600" />
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-black/80 border-2 border-dashed border-matrix-500 rounded-lg flex items-center justify-center pointer-events-none"
          >
            <div className="text-center">
              <svg className="w-12 h-12 text-matrix-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
              <p className="text-matrix-400 font-mono text-sm">DROP FILES HERE</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 allow-scroll relative" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {msg.role === 'jarvis' ? (
              <div
                className={`flex items-start space-x-2 ${voiceMode ? 'cursor-pointer hover:bg-matrix-900/10 rounded px-1 -mx-1' : ''}`}
                onClick={() => voiceMode && msg.text && speakText(msg.text)}
                title={voiceMode ? 'Click to hear' : undefined}
              >
                <span className="text-matrix-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                <div className="min-w-0 flex-1">
                  <span className="text-matrix-400 font-bold">JARVIS</span>
                  <div
                    className="md-rendered text-matrix-300 mt-0.5 leading-relaxed whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-start space-x-2">
                <span className="text-black-500 shrink-0 mt-0.5">[{formatTime(msg.timestamp)}]</span>
                <div className="min-w-0 flex-1">
                  <span className="text-terminal-400 font-bold">you</span>
                  <p className="text-white mt-0.5 whitespace-pre-wrap break-words">{msg.text}</p>
                  {/* Show attachments in user messages */}
                  {msg.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.attachments.map((att, j) => (
                        <div key={j} className="flex items-center gap-1.5 px-2 py-1 bg-black-800 border border-black-600 rounded text-[11px]">
                          {att.preview ? (
                            <img src={att.preview} alt={att.name} className="w-8 h-8 object-cover rounded" />
                          ) : (
                            <svg className="w-3.5 h-3.5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                          )}
                          <span className="text-black-300 truncate max-w-[120px]">{att.name}</span>
                          <span className="text-black-500">{(att.size / 1024).toFixed(0)}KB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        ))}

        {isLoading && (
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

      {/* Attachment previews */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-black-700 bg-black-900/50 px-3 py-2 shrink-0"
          >
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div key={att.id} className="flex items-center gap-1.5 px-2 py-1 bg-black-800 border border-black-600 rounded text-[11px] group">
                  {att.preview ? (
                    <img src={att.preview} alt={att.name} className="w-8 h-8 object-cover rounded" />
                  ) : (
                    <svg className="w-3.5 h-3.5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  <span className="text-black-300 truncate max-w-[100px]">{att.name}</span>
                  <span className="text-black-500">{(att.size / 1024).toFixed(0)}KB</span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="text-black-500 hover:text-red-400 ml-1 transition-colors"
                    title="Remove"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length > 0) handleFiles(e.target.files)
          e.target.value = '' // Reset so same file can be selected again
        }}
      />

      {/* Input area */}
      <div className="border-t border-black-600 bg-black-900 shrink-0">
        <div className="flex items-end px-3 py-2 gap-2">
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-black-500 hover:text-matrix-400 transition-colors shrink-0 pb-0.5"
            title="Attach file"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Prompt symbol */}
          <span className="text-matrix-500 font-mono text-sm shrink-0 pb-0.5">&gt;</span>

          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              if (e.target.value.length <= MAX_INPUT_CHARS) {
                setInput(e.target.value)
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Talk to JARVIS... (Shift+Enter for newline)"
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-transparent text-white font-mono text-sm outline-none placeholder-black-500 disabled:opacity-50 resize-none overflow-y-auto allow-scroll"
            style={{ maxHeight: '160px', lineHeight: '1.5' }}
            autoComplete="off"
            spellCheck="false"
          />

          {/* Character count */}
          {input.length > 100 && (
            <span className={`text-[10px] font-mono shrink-0 tabular-nums pb-0.5 ${
              input.length > MAX_INPUT_CHARS * 0.9 ? 'text-red-400' :
              input.length > MAX_INPUT_CHARS * 0.7 ? 'text-amber-400' :
              'text-black-500'
            }`}>
              {input.length}/{MAX_INPUT_CHARS}
            </span>
          )}

          {/* Mic button */}
          <button
            type="button"
            onClick={toggleListening}
            className={`shrink-0 p-1 rounded transition-all pb-0.5 ${
              isListening
                ? 'text-red-400 bg-red-500/20 animate-pulse'
                : 'text-black-500 hover:text-matrix-400'
            }`}
            title={isListening ? 'Stop listening' : 'Voice input (click to start)'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </button>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="shrink-0 px-3 py-1 text-xs font-mono bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 rounded transition-colors"
          >
            SEND
          </button>
        </div>

        {/* Listening indicator */}
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-3 pb-2"
            >
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <div className="flex gap-0.5">
                  <span className="w-1 h-3 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-4 bg-red-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-2 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                  <span className="w-1 h-5 bg-red-400 rounded-full animate-pulse" style={{ animationDelay: '100ms' }} />
                  <span className="w-1 h-3 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '250ms' }} />
                </div>
                <span className="text-red-400">LISTENING</span>
                <span className="text-black-500">Click mic or press Esc to stop</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============ Mind Panel Card ============

function MindCard({ title, icon, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-black-600 rounded-lg overflow-hidden bg-black">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-black-800 hover:bg-black-700 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <span className="text-matrix-500 text-sm">{icon}</span>
          <span className="text-matrix-400 font-mono text-xs font-bold tracking-wider">{title}</span>
        </div>
        <span className="text-black-400 font-mono text-xs">{isOpen ? '[-]' : '[+]'}</span>
      </button>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="px-3 py-2 space-y-1.5 font-mono text-xs"
        >
          {children}
        </motion.div>
      )}
    </div>
  )
}

function StatRow({ label, value, color = 'text-white' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black-300">{label}</span>
      <span className={`${color} tabular-nums`}>{value}</span>
    </div>
  )
}

// ============ Tip Jar Address (Copy-to-Clipboard) ============

function TipJarAddress({ address }) {
  const [copied, setCopied] = useState(false)

  if (!address) return <span className="text-black-500">Not configured</span>

  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      onClick={handleCopy}
      className="w-full flex items-center justify-between mt-1 px-2 py-1.5 bg-black-800 rounded border border-black-600 hover:border-matrix-600 transition-colors group"
    >
      <span className="text-matrix-400 text-[11px] truncate mr-2 font-mono">
        {address.slice(0, 6)}...{address.slice(-4)}
      </span>
      <span className={`text-[10px] shrink-0 ${copied ? 'text-matrix-500' : 'text-black-400 group-hover:text-matrix-500'}`}>
        {copied ? 'COPIED' : 'COPY'}
      </span>
    </button>
  )
}

// ============ Mind Panels ============

function MindPanels({ mind }) {
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 5000)
    return () => clearTimeout(t)
  }, [])

  if (!mind) {
    // Show loading for 5s, then show offline state instead of perpetual spinner
    if (!waited) {
      return (
        <div className="space-y-3">
          <MindCard title="KNOWLEDGE CHAIN" icon="~">
            <p className="text-black-400 animate-pulse">Connecting to mind network...</p>
          </MindCard>
          <MindCard title="SHARD NETWORK" icon="#">
            <p className="text-black-400 animate-pulse">Discovering peers...</p>
          </MindCard>
          <MindCard title="SKILLS & LEARNING" icon="*">
            <p className="text-black-400 animate-pulse">Loading cognitive state...</p>
          </MindCard>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <MindCard title="KNOWLEDGE CHAIN" icon="~">
          <p className="text-black-500 text-xs">Mind network unavailable</p>
        </MindCard>
        <MindCard title="SHARD NETWORK" icon="#">
          <p className="text-black-500 text-xs">No peers discovered</p>
        </MindCard>
        <MindCard title="SKILLS & LEARNING" icon="*">
          <p className="text-black-500 text-xs">Cognitive state offline</p>
        </MindCard>
      </div>
    )
  }

  const kc = mind.knowledgeChain
  const net = mind.network
  const learn = mind.learning
  const dialogue = mind.innerDialogue

  return (
    <div className="space-y-3">
      {/* Knowledge Chain */}
      <MindCard title="KNOWLEDGE CHAIN" icon="~">
        <StatRow label="Chain height" value={kc?.height ?? 0} color="text-matrix-400" />
        <StatRow label="Pending changes" value={kc?.pendingChanges ?? 0} />
        {kc?.head && (
          <StatRow
            label="Value density"
            value={typeof kc.head.cumulativeValueDensity === 'number'
              ? kc.head.cumulativeValueDensity.toFixed(2)
              : '—'}
            color="text-terminal-400"
          />
        )}
        {kc?.recentEpochs?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-black-700">
            <span className="text-black-400 text-[10px]">RECENT EPOCHS</span>
            {kc.recentEpochs.slice(0, 3).map((epoch, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] mt-0.5">
                <span className="text-black-300">#{epoch.height}</span>
                <span className="text-black-400">{epoch.changes} changes</span>
                <span className="text-matrix-600">{epoch.hash?.slice(0, 8)}...</span>
              </div>
            ))}
          </div>
        )}
      </MindCard>

      {/* Network */}
      <MindCard title="SHARD NETWORK" icon="#">
        <StatRow label="Shard" value={net?.shardId || 'shard-0'} color="text-terminal-400" />
        <StatRow label="Node type" value={net?.nodeType || 'full'} />
        <StatRow label="Peers" value={net?.peers ?? 0} color="text-matrix-400" />
        <StatRow label="Memory" value={`${net?.memory ?? 0} MB`} />
        {net?.topology && (
          <>
            <StatRow label="Total shards" value={net.topology.shardCount} color="text-terminal-400" />
            <StatRow
              label="Network health"
              value={net.topology.healthy ? 'HEALTHY' : 'DEGRADED'}
              color={net.topology.healthy ? 'text-matrix-500' : 'text-red-400'}
            />
          </>
        )}
      </MindCard>

      {/* Learning */}
      <MindCard title="SKILLS & LEARNING" icon="*">
        <StatRow label="Total skills" value={learn?.totalSkills ?? 0} color="text-matrix-400" />
        <StatRow label="Confirmed" value={learn?.confirmedSkills ?? 0} color="text-terminal-400" />
        {learn?.recentSkills?.length > 0 && (
          <div className="mt-2 pt-2 border-t border-black-700">
            <span className="text-black-400 text-[10px]">RECENT SKILLS</span>
            {learn.recentSkills.map((skill, i) => (
              <div key={i} className="text-[10px] mt-0.5 text-black-200 truncate">
                [{skill.category}] {skill.pattern}
              </div>
            ))}
          </div>
        )}
      </MindCard>

      {/* Inner Dialogue */}
      {dialogue?.recentThoughts?.length > 0 && (
        <MindCard title="INNER DIALOGUE" icon="%" defaultOpen={false}>
          <StatRow label="Total thoughts" value={dialogue.stats?.totalThoughts ?? 0} />
          <StatRow label="Promoted" value={dialogue.stats?.promoted ?? 0} color="text-terminal-400" />
          <div className="mt-2 pt-2 border-t border-black-700">
            {dialogue.recentThoughts.map((thought, i) => (
              <div key={i} className="mt-1.5 first:mt-0">
                <span className="text-matrix-600 text-[10px]">[{thought.category}]</span>
                <p className="text-black-200 text-[10px] mt-0.5 leading-relaxed">{thought.content}</p>
              </div>
            ))}
          </div>
        </MindCard>
      )}

      {/* Compute Economics */}
      {mind.computeEconomics && (
        <MindCard title="COMPUTE ECONOMICS" icon="$" defaultOpen={false}>
          <StatRow
            label="Pool utilization"
            value={`${mind.computeEconomics.poolUtilization || 0}%`}
            color={mind.computeEconomics.poolUtilization > 80 ? 'text-amber-400' : 'text-matrix-400'}
          />
          <StatRow
            label="Pool remaining"
            value={`${((mind.computeEconomics.poolRemaining || 0) / 1000).toFixed(0)}K tokens`}
          />
          <StatRow label="Active users" value={mind.computeEconomics.activeUsers || 0} color="text-terminal-400" />
          <StatRow label="Total users" value={mind.computeEconomics.totalUsers || 0} />
          <StatRow
            label="Shapley sum"
            value={mind.computeEconomics.shapleySum || 0}
            color="text-matrix-600"
          />
        </MindCard>
      )}

      {/* Support JARVIS — Tip Jar */}
      <MindCard title="SUPPORT JARVIS" icon="+" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-black-300 leading-relaxed">
            JARVIS costs ~$5/day in API credits. For 15 team members, that's $0.33/person.
          </p>
          <div className="pt-1">
            <span className="text-black-400 text-[10px]">TIP JAR (ETH)</span>
            <TipJarAddress address={mind.tipJar?.address} />
          </div>
          <StatRow
            label="Pool utilization"
            value={`${mind.computeEconomics?.poolUtilization || 0}%`}
            color={mind.computeEconomics?.poolUtilization > 80 ? 'text-amber-400' : 'text-matrix-400'}
          />
          <StatRow label="Active users today" value={mind.computeEconomics?.activeUsers || 0} color="text-terminal-400" />
          <p className="text-black-500 text-[10px] pt-1">
            Every tip helps fund JARVIS's compute. Cooperative capitalism in action.
          </p>
        </div>
      </MindCard>

      {/* Shadow Protocol */}
      {mind.shadows?.active > 0 && (
        <MindCard title="SHADOW PROTOCOL" icon="&" defaultOpen={false}>
          <StatRow label="Active shadows" value={mind.shadows.active} color="text-matrix-400" />
          <StatRow label="Contributions" value={mind.shadows.totalContributions} />
        </MindCard>
      )}
    </div>
  )
}

// ============ JUL Balance Bar ============

function JULBalanceBar({ budget, mind }) {
  const compute = mind?.computeEconomics
  const poolRemaining = compute?.poolRemaining || 0
  const poolTotal = compute?.poolSize || 500000
  const poolPct = poolTotal > 0 ? Math.round((poolRemaining / poolTotal) * 100) : 100
  const activeUsers = compute?.activeUsers || 0

  // User-specific budget from chat responses
  const userUsed = budget?.used || 0
  const userDaily = budget?.daily || 0
  const userPct = userDaily > 0 ? Math.round((userUsed / userDaily) * 100) : 0
  const userRemaining = Math.max(0, userDaily - userUsed)
  const isDegraded = budget?.degraded || false
  const isExhausted = userPct >= 100

  // Convert tokens to approximate JUL (1000 tokens = 1 JUL)
  const julRemaining = (userRemaining / 1000).toFixed(1)
  const julDaily = (userDaily / 1000).toFixed(1)
  const julPoolRemaining = (poolRemaining / 1000).toFixed(0)

  return (
    <div className="mb-3 rounded-lg border border-black-600 bg-black/80 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        {/* Left: JUL balance */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs font-mono ${
              isExhausted ? 'bg-red-500/20 text-red-400' :
              isDegraded ? 'bg-amber-500/20 text-amber-400' :
              'bg-matrix-500/20 text-matrix-400'
            }`}>
              JUL
            </div>
            <div>
              <div className="flex items-baseline space-x-1">
                <span className={`text-lg font-bold font-mono tabular-nums ${
                  isExhausted ? 'text-red-400' :
                  isDegraded ? 'text-amber-400' :
                  'text-matrix-400'
                }`}>
                  {julRemaining}
                </span>
                <span className="text-black-500 text-xs font-mono">/ {julDaily} JUL</span>
              </div>
              <span className="text-[10px] text-black-500 font-mono">
                {isExhausted ? 'EXHAUSTED — resets daily' :
                 isDegraded ? 'DEGRADED — responses capped' :
                 'Your daily compute budget'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Pool + users */}
        <div className="hidden sm:flex items-center space-x-4">
          <div className="text-right">
            <div className="text-xs text-black-400 font-mono">{julPoolRemaining}K JUL pool</div>
            <div className="text-[10px] text-black-500 font-mono">{activeUsers} active minds</div>
          </div>
          <div className="w-12 h-12 relative">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none"
                stroke={poolPct > 50 ? '#00ff41' : poolPct > 20 ? '#f59e0b' : '#ef4444'}
                strokeWidth="3"
                strokeDasharray={`${poolPct * 0.942} 100`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-black-300">
              {poolPct}%
            </span>
          </div>
        </div>
      </div>

      {/* Usage bar */}
      <div className="h-1 bg-black-800">
        <motion.div
          className={`h-full transition-colors ${
            isExhausted ? 'bg-red-500' :
            isDegraded ? 'bg-amber-500' :
            'bg-matrix-500'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, userPct)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ============ Agent Registry ============
// Simulated agents — each represents a mind in the Pantheon.
// When real agents come online, they register via the cascade router.

const AGENTS = [
  {
    id: 'jarvis',
    name: 'JARVIS',
    role: 'Primary AI',
    model: 'claude-sonnet',
    color: 'matrix',
    status: 'online', // pulled from health in real version
    description: 'Core reasoning, strategy, development',
    icon: 'J',
  },
  {
    id: 'nyx',
    name: 'NYX',
    role: 'Creative AI',
    model: 'pending',
    color: 'purple',
    status: 'building',
    description: 'Creative writing, art direction, narrative',
    icon: 'N',
  },
  {
    id: 'ollama-local',
    name: 'OLLAMA',
    role: 'Local LLM',
    model: 'qwen2.5:7b',
    color: 'blue',
    status: 'standby',
    description: 'Offline inference, zero-cost fallback',
    icon: 'O',
  },
  {
    id: 'oracle',
    name: 'ORACLE',
    role: 'Data Analysis',
    model: 'pending',
    color: 'amber',
    status: 'planned',
    description: 'Market data, price feeds, analytics',
    icon: 'R',
  },
  {
    id: 'sentinel',
    name: 'SENTINEL',
    role: 'Security',
    model: 'pending',
    color: 'red',
    status: 'planned',
    description: 'Auditing, threat detection, pen testing',
    icon: 'S',
  },
]

const STATUS_STYLES = {
  online:   { dot: 'bg-green-500 animate-pulse', text: 'text-green-400', label: 'ONLINE' },
  standby:  { dot: 'bg-blue-500', text: 'text-blue-400', label: 'STANDBY' },
  building: { dot: 'bg-purple-500 animate-pulse', text: 'text-purple-400', label: 'BUILDING' },
  planned:  { dot: 'bg-black-500', text: 'text-black-400', label: 'PLANNED' },
  offline:  { dot: 'bg-red-500', text: 'text-red-400', label: 'OFFLINE' },
}

const AGENT_COLORS = {
  matrix: { bg: 'bg-matrix-500/20', border: 'border-matrix-600', text: 'text-matrix-400', ring: 'ring-matrix-500/30' },
  purple: { bg: 'bg-purple-500/20', border: 'border-purple-600', text: 'text-purple-400', ring: 'ring-purple-500/30' },
  blue:   { bg: 'bg-blue-500/20', border: 'border-blue-600', text: 'text-blue-400', ring: 'ring-blue-500/30' },
  amber:  { bg: 'bg-amber-500/20', border: 'border-amber-600', text: 'text-amber-400', ring: 'ring-amber-500/30' },
  red:    { bg: 'bg-red-500/20', border: 'border-red-600', text: 'text-red-400', ring: 'ring-red-500/30' },
}

// ============ Agent Selector Bar ============

function AgentBar({ activeAgents, onToggleAgent, onSetPrimary, primaryAgent }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-3 rounded-lg border border-black-600 bg-black/80 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-black-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-matrix-500 font-mono text-xs font-bold tracking-wider">PANTHEON</span>
          <div className="flex items-center gap-1">
            {activeAgents.map(id => {
              const agent = AGENTS.find(a => a.id === id)
              if (!agent) return null
              const colors = AGENT_COLORS[agent.color]
              return (
                <span
                  key={id}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${colors.bg} ${colors.text} border ${colors.border}`}
                  title={agent.name}
                >
                  {agent.icon}
                </span>
              )
            })}
          </div>
          <span className="text-black-500 font-mono text-[10px]">
            {activeAgents.length} active
          </span>
        </div>
        <span className="text-black-400 font-mono text-xs">{expanded ? '[-]' : '[+]'}</span>
      </button>

      {/* Expanded agent cards */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-t border-black-700"
          >
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {AGENTS.map(agent => {
                const isActive = activeAgents.includes(agent.id)
                const isPrimary = primaryAgent === agent.id
                const colors = AGENT_COLORS[agent.color]
                const status = STATUS_STYLES[agent.status]
                const canActivate = agent.status === 'online' || agent.status === 'standby'

                return (
                  <div
                    key={agent.id}
                    className={`relative rounded-lg border p-3 transition-all cursor-pointer ${
                      isActive
                        ? `${colors.border} ${colors.bg} ring-1 ${colors.ring}`
                        : 'border-black-700 bg-black-900/50 hover:border-black-600'
                    } ${!canActivate ? 'opacity-50' : ''}`}
                    onClick={() => canActivate && onToggleAgent(agent.id)}
                  >
                    {/* Primary badge */}
                    {isPrimary && (
                      <span className="absolute -top-1.5 -right-1.5 bg-matrix-600 text-black-900 text-[8px] font-bold font-mono px-1.5 py-0.5 rounded-full">
                        PRIMARY
                      </span>
                    )}

                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-mono ${colors.bg} ${colors.text}`}>
                        {agent.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono text-xs font-bold ${isActive ? colors.text : 'text-black-300'}`}>
                            {agent.name}
                          </span>
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          <span className={`text-[9px] font-mono ${status.text}`}>{status.label}</span>
                        </div>
                        <span className="text-black-500 text-[10px] font-mono">{agent.role}</span>
                      </div>
                    </div>

                    <p className="text-black-400 text-[10px] font-mono leading-relaxed">{agent.description}</p>

                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-black-700/50">
                      <span className="text-black-500 text-[9px] font-mono">{agent.model}</span>
                      {isActive && agent.id !== 'jarvis' && canActivate && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSetPrimary(agent.id) }}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                            isPrimary
                              ? `${colors.text} bg-black/30`
                              : 'text-black-500 hover:text-black-300 bg-black-800/50'
                          }`}
                        >
                          {isPrimary ? 'PRIMARY' : 'SET PRIMARY'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Multi-agent mode info */}
            <div className="px-4 py-2 border-t border-black-700 bg-black-900/30">
              <p className="text-black-500 text-[10px] font-mono">
                Active agents receive your messages. Primary agent responds first. Others can be @mentioned.
                Use <span className="text-matrix-500">@nyx</span> or <span className="text-matrix-500">@oracle</span> in chat to direct a message.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Main Page ============

function JarvisPage() {
  const { messages, isLoading, mind, health, budget, sendMessage, voiceMode, toggleVoice, isSpeaking, speakText } = useJarvis()
  const { mesh } = useMindMesh()

  // Multi-agent state
  const [activeAgents, setActiveAgents] = useState(['jarvis'])
  const [primaryAgent, setPrimaryAgent] = useState('jarvis')

  const handleToggleAgent = useCallback((agentId) => {
    setActiveAgents(prev => {
      if (agentId === 'jarvis') return prev // Can't deactivate Jarvis
      if (prev.includes(agentId)) {
        const next = prev.filter(id => id !== agentId)
        // If we removed the primary, reset to jarvis
        if (primaryAgent === agentId) setPrimaryAgent('jarvis')
        return next
      }
      return [...prev, agentId]
    })
  }, [primaryAgent])

  const handleSetPrimary = useCallback((agentId) => {
    setPrimaryAgent(agentId)
    // Ensure agent is active
    setActiveAgents(prev => prev.includes(agentId) ? prev : [...prev, agentId])
  }, [])

  // Update Jarvis status from health
  useEffect(() => {
    if (health?.status === 'online' || health?.status === 'ok') {
      AGENTS[0].status = 'online'
      AGENTS[0].model = health.model || 'claude-sonnet'
    } else {
      AGENTS[0].status = 'offline'
    }
  }, [health])

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-4 py-2">
      {/* Hero */}
      <HeroSection health={health} />

      {/* Agent Selector */}
      <AgentBar
        activeAgents={activeAgents}
        onToggleAgent={handleToggleAgent}
        onSetPrimary={handleSetPrimary}
        primaryAgent={primaryAgent}
      />

      {/* JUL Balance Bar */}
      <JULBalanceBar budget={budget} mind={mind} />

      {/* Main content: Chat + Mind */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Chat — takes 3/5 on desktop, full on mobile */}
        <div className="flex-1 lg:flex-[3] min-h-0 flex flex-col">
          <ChatPanel messages={messages} isLoading={isLoading} onSend={sendMessage} voiceMode={voiceMode} toggleVoice={toggleVoice} isSpeaking={isSpeaking} speakText={speakText} health={health} activeAgents={activeAgents} />
        </div>

        {/* Mind panels — takes 2/5 on desktop, below chat on mobile */}
        <div className="lg:flex-[2] overflow-y-auto allow-scroll pb-4">
          <MindPanels mind={mind} />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between mt-2 px-1 shrink-0">
        <div className="flex items-center space-x-2">
          <Link
            to="/mesh"
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              mesh?.status === 'fully-interlinked'
                ? 'text-matrix-400 border-matrix-700 hover:border-matrix-500 bg-matrix-900/30'
                : 'text-amber-400 border-amber-700 hover:border-amber-500 bg-amber-900/20'
            }`}
          >
            MESH {mesh ? `${mesh.cells?.filter(c => c.status === 'interlinked').length || 0}/3` : '...'}
          </Link>
          <span className="text-black-500 font-mono text-[10px]">
            ENCRYPTED | VIBESWAP MIND NETWORK | {health?.model || 'claude'}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          {budget && (
            <div className="flex items-center space-x-1.5">
              <span className="text-black-500 font-mono text-[10px]">BUDGET</span>
              <div className="w-16 h-1.5 bg-black-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budget.degraded ? 'bg-amber-500' : 'bg-matrix-500'
                  }`}
                  style={{ width: `${Math.min(100, budget.daily > 0 ? (budget.used / budget.daily) * 100 : 0)}%` }}
                />
              </div>
              <span className={`font-mono text-[10px] ${budget.degraded ? 'text-amber-400' : 'text-black-400'}`}>
                {budget.daily > 0 ? Math.round((budget.used / budget.daily) * 100) : 0}%
              </span>
            </div>
          )}
          <span className="text-black-500 font-mono text-[10px]">
            {messages.length - 1} messages
          </span>
        </div>
      </div>
    </div>
  )
}

export default JarvisPage
