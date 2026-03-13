import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Tooltip — Hover/focus tooltip with smart positioning
// Renders above by default, repositions if near viewport edge
// ============================================================

const CYAN = '#06b6d4'

export default function Tooltip({ children, content, position = 'top', delay = 300 }) {
  const [visible, setVisible] = useState(false)
  const [actualPos, setActualPos] = useState(position)
  const timeoutRef = useRef(null)
  const triggerRef = useRef(null)

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      if (position === 'top' && rect.top < 60) setActualPos('bottom')
      else if (position === 'bottom' && rect.bottom > window.innerHeight - 60) setActualPos('top')
      else setActualPos(position)
    }
  }, [visible, position])

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const posStyles = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
  }

  const originMap = {
    top: 'bottom center',
    bottom: 'top center',
    left: 'center right',
    right: 'center left',
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <AnimatePresence>
        {visible && content && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              ...posStyles[actualPos],
              position: 'absolute',
              zIndex: 100,
              transformOrigin: originMap[actualPos],
            }}
            className="pointer-events-none"
          >
            <div
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-white whitespace-nowrap"
              style={{
                background: 'rgba(8,8,12,0.95)',
                border: `1px solid ${CYAN}20`,
                boxShadow: `0 4px 12px rgba(0,0,0,0.4), 0 0 8px ${CYAN}08`,
              }}
            >
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}
