import { motion } from 'framer-motion'

// ============================================================
// SkeletonLoader — Animated placeholder for loading states
// Variants: text, card, avatar, chart, table-row
// ============================================================

function Shimmer({ className = '', style = {} }) {
  return (
    <motion.div
      className={`rounded bg-black-700/50 overflow-hidden ${className}`}
      style={style}
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

export function TextSkeleton({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Shimmer key={i} className="h-3" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}

export function CardSkeleton({ className = '' }) {
  return (
    <div className={`rounded-xl p-5 border border-black-700/30 ${className}`} style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Shimmer className="w-10 h-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-3 w-1/3" />
          <Shimmer className="h-2 w-1/2" />
        </div>
      </div>
      <TextSkeleton lines={2} />
    </div>
  )
}

export function AvatarSkeleton({ size = 40 }) {
  return <Shimmer className="rounded-full flex-shrink-0" style={{ width: size, height: size }} />
}

export function ChartSkeleton({ className = '' }) {
  return (
    <div className={`flex items-end gap-1 h-24 ${className}`}>
      {Array.from({ length: 12 }).map((_, i) => (
        <Shimmer key={i} className="flex-1 rounded-t" style={{ height: `${30 + Math.sin(i * 0.8) * 25 + 20}%` }} />
      ))}
    </div>
  )
}

export function TableRowSkeleton({ cols = 4, className = '' }) {
  return (
    <div className={`flex items-center gap-4 py-3 ${className}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <Shimmer key={i} className="h-3 flex-1" style={{ maxWidth: i === 0 ? 120 : 80 }} />
      ))}
    </div>
  )
}

export function StatSkeleton({ className = '' }) {
  return (
    <div className={`rounded-xl p-4 border border-black-700/30 ${className}`} style={{ background: 'rgba(0,0,0,0.3)' }}>
      <Shimmer className="h-2 w-16 mb-2" />
      <Shimmer className="h-6 w-24 mb-1" />
      <Shimmer className="h-2 w-12" />
    </div>
  )
}

export default function SkeletonLoader({ variant = 'card', count = 1, ...props }) {
  const Component = {
    text: TextSkeleton,
    card: CardSkeleton,
    avatar: AvatarSkeleton,
    chart: ChartSkeleton,
    'table-row': TableRowSkeleton,
    stat: StatSkeleton,
  }[variant] || CardSkeleton

  if (count === 1) return <Component {...props} />

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} {...props} />
      ))}
    </div>
  )
}
