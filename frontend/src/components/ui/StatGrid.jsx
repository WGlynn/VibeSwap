import { motion } from 'framer-motion'

// ============================================================
// StatGrid — Grid of stat cards with consistent styling
// Used for dashboard overviews, protocol stats, user stats
// ============================================================

const CYAN = '#06b6d4'
const PHI = 1.618033988749895

function StatCard({ label, value, change, icon, color = CYAN, delay = 0 }) {
  const isPositive = change && change > 0
  const changeColor = change === undefined ? null : isPositive ? '#22c55e' : change < 0 ? '#ef4444' : '#6b7280'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className="rounded-xl border p-4"
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <span className="text-sm opacity-40">{icon}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-mono font-bold text-white tabular-nums">
          {value}
        </span>
        {change !== undefined && (
          <span className="text-[10px] font-mono font-medium" style={{ color: changeColor }}>
            {isPositive ? '+' : ''}{change}%
          </span>
        )}
      </div>
    </motion.div>
  )
}

export default function StatGrid({
  stats = [],
  columns = 4,
  className = '',
}) {
  return (
    <div
      className={`grid gap-3 ${className}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {stats.map((stat, i) => (
        <StatCard key={stat.label || i} {...stat} delay={0.05 * i} />
      ))}
    </div>
  )
}

export { StatCard }
