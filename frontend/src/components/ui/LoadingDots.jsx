import { motion } from 'framer-motion'

// ============================================================
// LoadingDots — Animated loading indicator
// Three dots with staggered bounce animation
// ============================================================

const CYAN = '#06b6d4'

export default function LoadingDots({
  color = CYAN,
  size = 6,
  label,
  className = '',
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="rounded-full"
            style={{ width: size, height: size, background: color }}
            animate={{ y: [0, -size, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
      {label && (
        <span className="text-[10px] font-mono text-black-500">{label}</span>
      )}
    </div>
  )
}
