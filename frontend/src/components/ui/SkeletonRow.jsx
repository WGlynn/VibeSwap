import { motion } from 'framer-motion'

// ============================================================
// SkeletonRow — Loading placeholder row for tables/lists
// Used when data is loading or being fetched
// ============================================================

function Shimmer({ width = '100%', height = 12, rounded = 'rounded' }) {
  return (
    <motion.div
      className={`${rounded}`}
      style={{
        width,
        height,
        background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)',
        backgroundSize: '200% 100%',
      }}
      animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
    />
  )
}

export default function SkeletonRow({
  columns = 4,
  rows = 1,
  className = '',
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-2">
          {Array.from({ length: columns }).map((_, c) => (
            <Shimmer
              key={c}
              width={c === 0 ? '30%' : `${20 + (c * 5)}%`}
              height={c === 0 ? 14 : 10}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export { Shimmer }
