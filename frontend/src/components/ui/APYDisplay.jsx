import { motion } from 'framer-motion'

// ============================================================
// APYDisplay — Formatted APY with breakdown tooltip
// Used for vaults, staking, farming, lending rates
// ============================================================

const CYAN = '#06b6d4'

export default function APYDisplay({
  apy = 0,
  baseApy,
  rewardApy,
  boostMultiplier,
  size = 'md',
  className = '',
}) {
  const sizes = {
    sm: { text: 'text-xs', label: 'text-[9px]' },
    md: { text: 'text-sm', label: 'text-[10px]' },
    lg: { text: 'text-lg', label: 'text-xs' },
    xl: { text: 'text-2xl', label: 'text-sm' },
  }
  const s = sizes[size] || sizes.md

  const color = apy >= 20 ? '#22c55e' : apy >= 5 ? CYAN : '#9ca3af'
  const formatted = apy >= 1000 ? `${(apy / 1000).toFixed(1)}K` : apy.toFixed(2)

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <div className="flex items-baseline gap-1">
        <motion.span
          className={`${s.text} font-mono font-bold tabular-nums`}
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {formatted}%
        </motion.span>
        <span className={`${s.label} font-mono text-black-500`}>APY</span>
      </div>

      {(baseApy !== undefined || rewardApy !== undefined) && (
        <div className="flex items-center gap-2 mt-0.5">
          {baseApy !== undefined && (
            <span className="text-[9px] font-mono text-black-500">
              Base: {baseApy.toFixed(2)}%
            </span>
          )}
          {rewardApy !== undefined && (
            <span className="text-[9px] font-mono" style={{ color: CYAN }}>
              +{rewardApy.toFixed(2)}% JUL
            </span>
          )}
          {boostMultiplier && boostMultiplier > 1 && (
            <span className="text-[9px] font-mono font-bold px-1 rounded"
              style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}
            >
              {boostMultiplier.toFixed(1)}x
            </span>
          )}
        </div>
      )}
    </div>
  )
}
