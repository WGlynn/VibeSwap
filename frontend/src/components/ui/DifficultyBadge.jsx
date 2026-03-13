// ============================================================
// DifficultyBadge — Badge showing content difficulty level
// Used for courses, tutorials, documentation sections
// ============================================================

const LEVELS = {
  beginner: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', label: 'Beginner' },
  intermediate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', label: 'Intermediate' },
  advanced: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', label: 'Advanced' },
  expert: { color: '#a855f7', bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.3)', label: 'Expert' },
}

export default function DifficultyBadge({ level = 'beginner', className = '' }) {
  const config = LEVELS[level.toLowerCase()] || LEVELS.beginner

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${className}`}
      style={{
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`,
      }}
    >
      {config.label}
    </span>
  )
}
