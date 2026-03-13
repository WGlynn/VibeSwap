import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// InfoTooltip — Hoverable info icon with tooltip
// Used for explaining DeFi terms, fee structures, settings
// ============================================================

const CYAN = '#06b6d4'

export default function InfoTooltip({
  text,
  position = 'top',
  maxWidth = 200,
  className = '',
}) {
  const [show, setShow] = useState(false)

  const positions = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', mb: 'mb-2' },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', mt: 'mt-2' },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', mr: 'mr-2' },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', ml: 'ml-2' },
  }

  const pos = positions[position] || positions.top
  const spacing = pos.mb || pos.mt || pos.mr || pos.ml || ''

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        className="text-black-500 hover:text-cyan-400 transition-colors cursor-help"
      >
        <circle cx="7" cy="7" r="6" stroke="currentColor" fill="none" strokeWidth="1.2" />
        <text x="7" y="10" textAnchor="middle" fill="currentColor" fontSize="9" fontFamily="monospace">?</text>
      </svg>

      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className={`absolute z-50 ${spacing}`}
            style={{
              ...pos,
              maxWidth,
            }}
          >
            <div
              className="px-3 py-2 rounded-lg text-[10px] font-mono text-black-300 leading-relaxed"
              style={{
                background: 'rgba(10,10,10,0.95)',
                border: `1px solid ${CYAN}20`,
                backdropFilter: 'blur(12px)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              }}
            >
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}
