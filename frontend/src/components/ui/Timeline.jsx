import { motion } from 'framer-motion'

// ============================================================
// Timeline — Vertical event timeline container
// Used for activity feeds, proposal history, bridge tracking
// Wraps TimelineItem components
// ============================================================

const CYAN = '#06b6d4'

export default function Timeline({
  children,
  title,
  className = '',
}) {
  return (
    <div className={className}>
      {title && (
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-black-500 mb-4">
          {title}
        </h3>
      )}
      <div className="relative">
        {/* Continuous left border line */}
        <div
          className="absolute left-[5px] top-3 bottom-3 w-px"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <div className="space-y-0">
          {children}
        </div>
      </div>
    </div>
  )
}

export function TimelineEvent({
  title,
  time,
  description,
  status = 'default',
  icon,
  children,
  className = '',
}) {
  const DOT_COLORS = {
    default: 'rgba(255,255,255,0.2)',
    active: CYAN,
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  }

  const dotColor = DOT_COLORS[status] || DOT_COLORS.default

  return (
    <motion.div
      className={`flex gap-3 pb-4 ${className}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col items-center shrink-0">
        {icon ? (
          <span className="text-sm mt-0.5">{icon}</span>
        ) : (
          <div
            className="w-2.5 h-2.5 rounded-full mt-1.5"
            style={{
              background: dotColor,
              boxShadow: status !== 'default' ? `0 0 6px ${dotColor}40` : 'none',
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-mono text-white">{title}</span>
          {time && <span className="text-[10px] font-mono text-black-500 shrink-0">{time}</span>}
        </div>
        {description && (
          <p className="text-xs font-mono text-black-400 mt-0.5">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </motion.div>
  )
}
