// ============================================================
// MetricRow — Horizontal metric display with icon and trend
// Used for dashboard summaries, stat grids, analytics
// ============================================================

const TREND_STYLES = {
  up: { color: 'text-green-400', icon: '↑' },
  down: { color: 'text-red-400', icon: '↓' },
  neutral: { color: 'text-black-500', icon: '→' },
}

export default function MetricRow({
  icon,
  label,
  value,
  change,
  trend = 'neutral',
  className = '',
}) {
  const t = TREND_STYLES[trend] || TREND_STYLES.neutral

  return (
    <div className={`flex items-center justify-between py-2 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-sm opacity-50">{icon}</span>}
        <span className="text-xs font-mono text-black-400">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-bold text-white">{value}</span>
        {change !== undefined && (
          <span className={`text-[10px] font-mono ${t.color}`}>
            {t.icon} {change}
          </span>
        )}
      </div>
    </div>
  )
}
