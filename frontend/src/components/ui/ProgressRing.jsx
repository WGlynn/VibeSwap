import { motion } from 'framer-motion'

/**
 * ProgressRing — SVG circular progress indicator.
 *
 * Props:
 *   progress: number — 0-100
 *   size: number — diameter in px (default 80)
 *   strokeWidth: number — ring thickness (default 4)
 *   color: string — stroke color class or CSS value
 *   bgColor: string — background ring color
 *   className: string
 *   children: ReactNode — content inside the ring (e.g., countdown number)
 */
function ProgressRing({
  progress = 0,
  size = 80,
  strokeWidth = 4,
  color = '#00ff41',
  bgColor = 'rgba(37,37,37,0.5)',
  className = '',
  children,
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.3, ease: 'linear' }}
        />
      </svg>
      {/* Center content */}
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  )
}

export default ProgressRing
