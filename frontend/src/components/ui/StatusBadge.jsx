import { motion } from 'framer-motion'

// ============================================================
// StatusBadge — Small status indicator with label
// Used for connection states, health checks, feature flags
// ============================================================

const VARIANTS = {
  online: { color: '#22c55e', label: 'Online', pulse: true },
  offline: { color: '#ef4444', label: 'Offline', pulse: false },
  syncing: { color: '#f59e0b', label: 'Syncing', pulse: true },
  active: { color: '#06b6d4', label: 'Active', pulse: true },
  inactive: { color: '#6b7280', label: 'Inactive', pulse: false },
  warning: { color: '#f59e0b', label: 'Warning', pulse: true },
  error: { color: '#ef4444', label: 'Error', pulse: false },
  success: { color: '#22c55e', label: 'Success', pulse: false },
  pending: { color: '#8b5cf6', label: 'Pending', pulse: true },
  live: { color: '#ef4444', label: 'LIVE', pulse: true },
}

export default function StatusBadge({ status = 'online', label, size = 'sm', className = '' }) {
  const config = VARIANTS[status] || VARIANTS.active
  const displayLabel = label || config.label

  const dotSize = size === 'xs' ? 'w-1 h-1' : size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const textSize = size === 'xs' ? 'text-[7px]' : size === 'sm' ? 'text-[9px]' : 'text-[10px]'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex">
        {config.pulse && (
          <motion.span
            className={`absolute ${dotSize} rounded-full`}
            style={{ background: config.color, opacity: 0.4 }}
            animate={{ scale: [1, 2, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className={`relative ${dotSize} rounded-full`} style={{ background: config.color }} />
      </span>
      <span className={`${textSize} font-mono font-bold uppercase tracking-wider`} style={{ color: config.color }}>
        {displayLabel}
      </span>
    </span>
  )
}
