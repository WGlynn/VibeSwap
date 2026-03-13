import { motion } from 'framer-motion'

// ============================================================
// StatusDot — Tiny animated status indicator
// Used for connection status, chain health, service uptime
// ============================================================

const STATUSES = {
  online: { color: '#22c55e', label: 'Online' },
  offline: { color: '#ef4444', label: 'Offline' },
  warning: { color: '#f59e0b', label: 'Warning' },
  syncing: { color: '#06b6d4', label: 'Syncing' },
  idle: { color: '#6b7280', label: 'Idle' },
}

export default function StatusDot({
  status = 'online',
  showLabel = false,
  pulse = true,
  size = 8,
  className = '',
}) {
  const config = STATUSES[status] || STATUSES.idle

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {pulse && status !== 'offline' && status !== 'idle' && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: config.color }}
            animate={{ opacity: [0.4, 0, 0.4], scale: [1, 2, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: config.color }}
        />
      </div>
      {showLabel && (
        <span
          className="text-[10px] font-mono font-medium"
          style={{ color: config.color }}
        >
          {config.label}
        </span>
      )}
    </div>
  )
}
