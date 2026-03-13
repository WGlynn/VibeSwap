import { motion } from 'framer-motion'

// ============================================================
// Alert — Dismissible alert banner with variants
// Used for system messages, warnings, success confirmations
// ============================================================

const VARIANT_CONFIG = {
  info: {
    bg: 'rgba(6,182,212,0.08)',
    border: 'rgba(6,182,212,0.2)',
    icon: (
      <svg className="w-4 h-4 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    text: 'text-cyan-300',
  },
  success: {
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.2)',
    icon: (
      <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    text: 'text-green-300',
  },
  warning: {
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.2)',
    icon: (
      <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    text: 'text-amber-300',
  },
  error: {
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.2)',
    icon: (
      <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    text: 'text-red-300',
  },
}

export default function Alert({
  variant = 'info',
  title,
  children,
  onDismiss,
  className = '',
}) {
  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`flex items-start gap-3 p-3 rounded-lg border ${className}`}
      style={{ background: config.bg, borderColor: config.border }}
    >
      {config.icon}
      <div className="flex-1 min-w-0">
        {title && <div className={`text-sm font-mono font-medium ${config.text} mb-0.5`}>{title}</div>}
        <div className="text-xs font-mono text-black-300">{children}</div>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-black-500 hover:text-white transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.div>
  )
}
