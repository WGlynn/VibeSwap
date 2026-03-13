import { motion } from 'framer-motion'

// ============================================================
// Chip — Small clickable/selectable filter pills
// Used for multi-select filters, category tags, toggleable labels
// ============================================================

const VARIANT_STYLES = {
  default: {
    active: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400',
    inactive: 'bg-transparent border-black-700 text-black-400 hover:border-black-500 hover:text-black-300',
  },
  green: {
    active: 'bg-green-500/15 border-green-500/40 text-green-400',
    inactive: 'bg-transparent border-black-700 text-black-400 hover:border-black-500',
  },
  amber: {
    active: 'bg-amber-500/15 border-amber-500/40 text-amber-400',
    inactive: 'bg-transparent border-black-700 text-black-400 hover:border-black-500',
  },
  red: {
    active: 'bg-red-500/15 border-red-500/40 text-red-400',
    inactive: 'bg-transparent border-black-700 text-black-400 hover:border-black-500',
  },
}

export default function Chip({
  label,
  active = false,
  onClick,
  variant = 'default',
  icon,
  removable = false,
  onRemove,
  className = '',
}) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.default
  const stateClass = active ? styles.active : styles.inactive

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono transition-colors ${stateClass} ${className}`}
    >
      {icon && <span className="text-xs">{icon}</span>}
      {label}
      {removable && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove?.() }}
          className="ml-0.5 hover:text-white transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.button>
  )
}
