import { motion } from 'framer-motion'

// ============================================================
// QuorumGauge — Circular progress gauge for quorum tracking
// Used for governance proposals, voting thresholds
// ============================================================

const CYAN = '#06b6d4'

export default function QuorumGauge({
  current = 0,
  required = 100,
  label = 'Quorum',
  size = 80,
  strokeWidth = 6,
  className = '',
}) {
  const pct = Math.min(100, (current / required) * 100)
  const reached = pct >= 100
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const color = reached ? '#22c55e' : pct >= 75 ? '#f59e0b' : CYAN

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - pct / 100) }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-mono font-bold" style={{ color }}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="text-[9px] font-mono text-black-500">{label}</span>
      <span className="text-[9px] font-mono text-black-600">
        {current.toLocaleString()} / {required.toLocaleString()}
      </span>
    </div>
  )
}
