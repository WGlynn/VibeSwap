import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Toast Notification System
// Global toast provider — any component can fire toasts via useToast()
// ============================================================

const PHI = 1.618033988749895
const ToastContext = createContext(null)

let toastId = 0

const TOAST_TYPES = {
  success: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    color: 'text-emerald-400',
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/10',
    glow: '0 0 20px rgba(16,185,129,0.15)',
  },
  error: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    color: 'text-red-400',
    border: 'border-red-500/30',
    bg: 'bg-red-500/10',
    glow: '0 0 20px rgba(239,68,68,0.15)',
  },
  warning: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    color: 'text-amber-400',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    glow: '0 0 20px rgba(245,158,11,0.15)',
  },
  info: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-cyan-400',
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/10',
    glow: '0 0 20px rgba(6,182,212,0.15)',
  },
  tx: {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    color: 'text-matrix-400',
    border: 'border-matrix-500/30',
    bg: 'bg-matrix-500/10',
    glow: '0 0 20px rgba(0,255,65,0.15)',
  },
}

function Toast({ toast, onDismiss }) {
  const config = TOAST_TYPES[toast.type] || TOAST_TYPES.info

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 80, scale: 0.9, filter: 'blur(2px)' }}
      transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl ${config.border} ${config.bg}`}
      style={{ background: 'rgba(0,0,0,0.85)', boxShadow: config.glow }}
    >
      <span className={`mt-0.5 shrink-0 ${config.color}`}>{config.icon}</span>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold text-white truncate">{toast.title}</p>
        )}
        <p className="text-xs text-black-300 leading-relaxed">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => { toast.action.onClick(); onDismiss(toast.id) }}
            className={`mt-1.5 text-xs font-mono font-semibold ${config.color} hover:underline`}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-black-500 hover:text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((type, message, options = {}) => {
    const id = ++toastId
    const duration = options.duration ?? 4000
    const newToast = {
      id,
      type,
      message,
      title: options.title,
      action: options.action,
    }

    setToasts((prev) => [...prev.slice(-4), newToast]) // Max 5 visible

    if (duration > 0) {
      timers.current[id] = setTimeout(() => dismiss(id), duration)
    }

    return id
  }, [dismiss])

  const api = {
    success: (msg, opts) => toast('success', msg, opts),
    error: (msg, opts) => toast('error', msg, opts),
    warning: (msg, opts) => toast('warning', msg, opts),
    info: (msg, opts) => toast('info', msg, opts),
    tx: (msg, opts) => toast('tx', msg, opts),
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast container — top right */}
      <div className="fixed top-16 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto">
              <Toast toast={t} onDismiss={dismiss} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
