// ============================================================
// TimelineItem — Vertical timeline entry
// Used for activity feeds, proposal history, bridge tracking
// ============================================================

const CYAN = '#06b6d4'

const DOT_COLORS = {
  default: 'rgba(255,255,255,0.2)',
  active: CYAN,
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
}

export default function TimelineItem({
  title,
  time,
  description,
  status = 'default',
  isLast = false,
  children,
  className = '',
}) {
  const dotColor = DOT_COLORS[status] || DOT_COLORS.default

  return (
    <div className={`flex gap-3 ${className}`}>
      {/* Dot and line */}
      <div className="flex flex-col items-center">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
          style={{
            background: dotColor,
            boxShadow: status !== 'default' ? `0 0 6px ${dotColor}40` : 'none',
          }}
        />
        {!isLast && (
          <div className="w-px flex-1 mt-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
        )}
      </div>

      {/* Content */}
      <div className={`pb-4 min-w-0 ${isLast ? '' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-mono text-white">{title}</span>
          {time && <span className="text-[10px] font-mono text-black-500 shrink-0">{time}</span>}
        </div>
        {description && (
          <p className="text-xs font-mono text-black-400 mt-0.5">{description}</p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  )
}
