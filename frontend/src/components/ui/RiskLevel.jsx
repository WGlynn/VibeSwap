// ============================================================
// RiskLevel — Visual risk indicator (1-5 bars)
// Used for derivatives, lending, strategy risk display
// ============================================================

const RISK_LABELS = ['Very Low', 'Low', 'Medium', 'High', 'Very High']
const RISK_COLORS = ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#ef4444']

export default function RiskLevel({
  level = 1,
  maxLevel = 5,
  showLabel = true,
  className = '',
}) {
  const safeLevel = Math.min(Math.max(1, level), maxLevel)

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-end gap-0.5">
        {Array.from({ length: maxLevel }).map((_, i) => (
          <div
            key={i}
            className="w-1.5 rounded-sm transition-colors"
            style={{
              height: 4 + i * 2,
              background: i < safeLevel ? RISK_COLORS[safeLevel - 1] : 'rgba(255,255,255,0.06)',
            }}
          />
        ))}
      </div>
      {showLabel && (
        <span
          className="text-[10px] font-mono font-medium"
          style={{ color: RISK_COLORS[safeLevel - 1] }}
        >
          {RISK_LABELS[safeLevel - 1]}
        </span>
      )}
    </div>
  )
}
