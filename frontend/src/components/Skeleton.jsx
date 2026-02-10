import { motion } from 'framer-motion'

// Reusable skeleton loading components
export function SkeletonLine({ width = 'w-full', height = 'h-4' }) {
  return (
    <div className={`${width} ${height} bg-black-700 rounded animate-pulse`} />
  )
}

export function SkeletonCircle({ size = 'w-8 h-8' }) {
  return (
    <div className={`${size} bg-black-700 rounded-full animate-pulse`} />
  )
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="surface rounded-lg p-4 space-y-3">
      <div className="flex items-center space-x-3">
        <SkeletonCircle />
        <SkeletonLine width="w-24" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? 'w-3/4' : 'w-full'} />
      ))}
    </div>
  )
}

export function SkeletonStats() {
  return (
    <div className="surface rounded-lg p-4">
      <SkeletonLine width="w-20" height="h-3" />
      <div className="mt-3 space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <SkeletonLine width="w-16" height="h-3" />
            <SkeletonLine width="w-12" height="h-3" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonTokenInput() {
  return (
    <div className="token-input rounded-lg p-3">
      <SkeletonLine width="w-16" height="h-3" />
      <div className="flex items-center justify-between mt-3">
        <SkeletonLine width="w-32" height="h-8" />
        <SkeletonLine width="w-24" height="h-10" />
      </div>
    </div>
  )
}

export function SkeletonActivity() {
  return (
    <div className="surface rounded-lg p-4">
      <SkeletonLine width="w-24" height="h-3" />
      <div className="mt-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center space-x-3 py-2">
            <SkeletonCircle size="w-6 h-6" />
            <div className="flex-1 space-y-1">
              <SkeletonLine width="w-full" height="h-3" />
              <SkeletonLine width="w-2/3" height="h-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default {
  Line: SkeletonLine,
  Circle: SkeletonCircle,
  Card: SkeletonCard,
  Stats: SkeletonStats,
  TokenInput: SkeletonTokenInput,
  Activity: SkeletonActivity,
}
