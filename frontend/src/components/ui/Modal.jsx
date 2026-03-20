import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Modal — Reusable overlay dialog
// Traps focus, handles escape key, backdrop click
// ============================================================

const PHI = 1.618033988749895

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showClose = true,
  className = '',
}) {
  // Escape to close
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.()
    },
    [onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className={`fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none`}
          >
            <div
              className={`w-full ${sizes[size] || sizes.md} rounded-2xl border border-black-600 overflow-hidden pointer-events-auto ${className}`}
              style={{
                background: 'rgba(8,8,12,0.95)',
                WebkitBackdropFilter: 'blur(24px)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 0 60px rgba(0,0,0,0.5), 0 0 20px rgba(6,182,212,0.06)',
              }}
            >
              {/* Header */}
              {(title || showClose) && (
                <div className="flex items-center justify-between px-5 py-4 border-b border-black-700">
                  {title && (
                    <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wider">{title}</h3>
                  )}
                  {showClose && (
                    <button
                      onClick={onClose}
                      className="p-1 rounded-lg hover:bg-black-700 transition-colors"
                    >
                      <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="p-5">{children}</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
