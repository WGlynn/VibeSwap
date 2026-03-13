import { motion } from 'framer-motion'

// ============================================================
// EmptyList — Placeholder for empty data lists/tables
// Used when search returns no results or list is empty
// ============================================================

export default function EmptyList({
  title = 'Nothing here yet',
  description,
  icon,
  action,
  onAction,
  className = '',
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}
    >
      {icon ? (
        <span className="text-3xl mb-3 opacity-40">{icon}</span>
      ) : (
        <svg className="w-10 h-10 text-black-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      )}
      <h3 className="text-sm font-mono font-medium text-black-300 mb-1">{title}</h3>
      {description && (
        <p className="text-xs font-mono text-black-500 text-center max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 rounded-lg text-xs font-mono font-medium text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10 transition-colors"
        >
          {action}
        </button>
      )}
    </motion.div>
  )
}
