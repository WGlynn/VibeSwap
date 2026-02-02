import { motion } from 'framer-motion'

// Skeleton loading component for various UI elements
export function Skeleton({ className = '', variant = 'text', width, height }) {
  const baseClasses = 'bg-void-700/50 animate-pulse rounded'

  const variantClasses = {
    text: 'h-4 rounded',
    title: 'h-6 rounded',
    circle: 'rounded-full',
    card: 'rounded-2xl',
    button: 'h-10 rounded-xl',
  }

  const style = {
    width: width || (variant === 'circle' ? '40px' : '100%'),
    height: height || (variant === 'circle' ? '40px' : undefined),
  }

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant] || ''} ${className}`}
      style={style}
    />
  )
}

// Skeleton for swap card
export function SwapCardSkeleton() {
  return (
    <div className="swap-card rounded-3xl p-5 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton width="80px" height="24px" />
        <Skeleton variant="circle" width="40px" height="40px" />
      </div>

      {/* Token input */}
      <div className="token-input rounded-2xl p-4">
        <div className="flex justify-between mb-3">
          <Skeleton width="60px" height="16px" />
          <Skeleton width="100px" height="16px" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton width="120px" height="40px" />
          <Skeleton width="100px" height="40px" variant="button" />
        </div>
      </div>

      {/* Swap button */}
      <div className="flex justify-center">
        <Skeleton variant="circle" width="48px" height="48px" />
      </div>

      {/* Token output */}
      <div className="token-input rounded-2xl p-4">
        <div className="flex justify-between mb-3">
          <Skeleton width="80px" height="16px" />
          <Skeleton width="100px" height="16px" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton width="120px" height="40px" />
          <Skeleton width="100px" height="40px" variant="button" />
        </div>
      </div>

      {/* Action button */}
      <Skeleton height="56px" className="rounded-2xl" />
    </div>
  )
}

// Skeleton for pool row
export function PoolRowSkeleton() {
  return (
    <div className="grid grid-cols-6 gap-4 px-4 py-4 border-b border-void-700/50">
      <div className="col-span-2 flex items-center space-x-3">
        <div className="flex -space-x-2">
          <Skeleton variant="circle" width="32px" height="32px" />
          <Skeleton variant="circle" width="32px" height="32px" />
        </div>
        <Skeleton width="100px" height="20px" />
      </div>
      <Skeleton width="80px" height="20px" />
      <Skeleton width="80px" height="20px" />
      <Skeleton width="60px" height="20px" />
      <Skeleton width="80px" height="20px" />
    </div>
  )
}

// Skeleton for stats card
export function StatsCardSkeleton() {
  return (
    <div className="p-4 rounded-2xl bg-void-800/50 border border-void-700/50">
      <Skeleton width="100px" height="14px" className="mb-2" />
      <Skeleton width="120px" height="32px" className="mb-1" />
      <Skeleton width="80px" height="14px" />
    </div>
  )
}

// Skeleton for transaction row
export function TransactionRowSkeleton() {
  return (
    <div className="p-4 flex items-start justify-between">
      <div className="flex items-start space-x-3">
        <Skeleton variant="circle" width="40px" height="40px" />
        <div>
          <Skeleton width="150px" height="20px" className="mb-1" />
          <Skeleton width="100px" height="14px" />
        </div>
      </div>
      <div className="text-right">
        <Skeleton width="80px" height="20px" className="mb-1" />
        <Skeleton width="60px" height="14px" />
      </div>
    </div>
  )
}

// Animated shimmer overlay
export function ShimmerOverlay() {
  return (
    <motion.div
      animate={{ x: ['-100%', '100%'] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
    />
  )
}

// Loading spinner
export function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  }

  return (
    <svg
      className={`animate-spin ${sizes[size]} ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

// Full page loading
export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        className="w-16 h-16 rounded-full border-4 border-void-600 border-t-vibe-500"
      />
      <p className="mt-4 text-void-400">{message}</p>
    </div>
  )
}

export default Skeleton
