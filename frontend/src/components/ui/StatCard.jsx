import AnimatedNumber from './AnimatedNumber'
import Sparkline, { generateSparklineData } from './Sparkline'
import GlassCard from './GlassCard'

/**
 * StatCard — The hero stat component.
 * Big number + sparkline + label. Makes data feel alive.
 *
 * Props:
 *   label: string — what this stat measures
 *   value: number — the value to display
 *   prefix: string — e.g. '$'
 *   suffix: string — e.g. '%'
 *   decimals: number — decimal places
 *   change: number — percentage change (shows green/red indicator)
 *   sparkSeed: number — seed for stable sparkline data
 *   sparkData: number[] — custom sparkline data (overrides seed)
 *   size: 'sm' | 'md' | 'lg'
 *   className: string
 */

function StatCard({
  label,
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  change,
  sparkSeed,
  sparkData,
  size = 'md',
  className = '',
}) {
  const data = sparkData || (sparkSeed ? generateSparklineData(sparkSeed) : null)
  const isPositive = change != null ? change >= 0 : (data ? data[data.length - 1] >= data[0] : true)

  const sizes = {
    sm: { value: 'text-lg', label: 'text-[10px]', spark: { w: 36, h: 12 } },
    md: { value: 'text-2xl', label: 'text-xs', spark: { w: 48, h: 16 } },
    lg: { value: 'text-3xl', label: 'text-sm', spark: { w: 64, h: 20 } },
  }

  const s = sizes[size]

  return (
    <GlassCard glowColor="terminal" className={`p-4 ${className}`}>
      <div className={`${s.label} text-black-500 mb-1`}>{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <AnimatedNumber
            value={value}
            prefix={prefix}
            suffix={suffix}
            decimals={decimals}
            className={`${s.value} font-bold font-mono`}
          />
          {change != null && (
            <div className={`text-[10px] font-mono mt-0.5 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{change.toFixed(2)}%
            </div>
          )}
        </div>
        {data && (
          <Sparkline
            data={data}
            width={s.spark.w}
            height={s.spark.h}
            color={isPositive ? '#22c55e' : '#ef4444'}
          />
        )}
      </div>
    </GlassCard>
  )
}

export default StatCard
