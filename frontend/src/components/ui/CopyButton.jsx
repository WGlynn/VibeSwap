import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Copy Button — Click to copy text to clipboard
// Animated icon swap, "Copied!" confirmation, fallback support
// ============================================================

const CYAN = '#06b6d4'

export default function CopyButton({ text, label = 'Copy', className = '', variant = 'default' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  if (variant === 'pill') {
    return (
      <button
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold transition-all duration-200 ${className}`}
        style={{
          background: copied ? 'rgba(34,197,94,0.1)' : `${CYAN}08`,
          border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : `${CYAN}20`}`,
          color: copied ? '#22c55e' : CYAN,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.span key={copied ? 'check' : 'copy'} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
            {copied ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </motion.span>
        </AnimatePresence>
        {copied ? 'Copied!' : label}
      </button>
    )
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 text-xs font-mono transition-colors ${
        copied ? 'text-emerald-400' : 'text-black-500 hover:text-white'
      } ${className}`}
      title={copied ? 'Copied!' : `Copy ${label}`}
    >
      <AnimatePresence mode="wait">
        <motion.span key={copied ? 'check' : 'copy'} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ duration: 0.12 }}>
          {copied ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </motion.span>
      </AnimatePresence>
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  )
}
