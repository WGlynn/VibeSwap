// ============================================================
// Badge — Small label/tag component
// Used for counts, statuses, categories, chains
// ============================================================

const CYAN = '#06b6d4'

const VARIANTS = {
  default: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.08)' },
  cyan: { bg: `${CYAN}15`, text: CYAN, border: `${CYAN}30` },
  green: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
  red: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  amber: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  purple: { bg: 'rgba(168,85,247,0.15)', text: '#a855f7', border: 'rgba(168,85,247,0.3)' },
  blue: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
  matrix: { bg: 'rgba(0,255,65,0.1)', text: '#00ff41', border: 'rgba(0,255,65,0.2)' },
}

export default function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className = '',
}) {
  const v = VARIANTS[variant] || VARIANTS.default
  const sizes = {
    xs: 'text-[8px] px-1 py-0',
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-bold rounded-full border ${sizes[size] || sizes.sm} ${className}`}
      style={{ background: v.bg, color: v.text, borderColor: v.border }}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.text }} />
      )}
      {children}
    </span>
  )
}
