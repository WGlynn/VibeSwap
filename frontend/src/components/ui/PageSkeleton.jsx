import { motion } from 'framer-motion'

// ============================================================
// Page-level loading skeleton
// Shows a structured shimmer layout while lazy components load
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

function Shimmer({ className = '', delay = 0 }) {
  return (
    <motion.div
      className={`relative overflow-hidden rounded-lg bg-black-800/40 ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay }}
    >
      <motion.div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)',
        }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', delay }}
      />
    </motion.div>
  )
}

export default function PageSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 font-mono">
      {/* Header shimmer */}
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <Shimmer className="h-7 w-48" delay={0} />
          <Shimmer className="h-3.5 w-72" delay={0.05} />
        </div>
        <Shimmer className="h-9 w-24 rounded-xl" delay={0.1} />
      </div>

      {/* Accent line */}
      <motion.div
        className="h-px w-full mb-8"
        style={{ background: `linear-gradient(90deg, transparent, ${CYAN}20, transparent)` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.8 }}
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-black-700/30 p-4 bg-black-800/20">
            <Shimmer className="h-3 w-16 mb-3" delay={0.1 + i * 0.05} />
            <Shimmer className="h-6 w-24" delay={0.15 + i * 0.05} />
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="rounded-xl border border-black-700/30 p-5 bg-black-800/20">
          <Shimmer className="h-3 w-32 mb-4" delay={0.3} />
          <Shimmer className="h-36 w-full rounded-xl" delay={0.35} />
        </div>
        <div className="rounded-xl border border-black-700/30 p-5 bg-black-800/20">
          <Shimmer className="h-3 w-28 mb-4" delay={0.3} />
          <Shimmer className="h-36 w-full rounded-xl" delay={0.35} />
        </div>
      </div>

      {/* List rows */}
      <div className="rounded-xl border border-black-700/30 p-4 bg-black-800/20 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Shimmer className="h-8 w-8 rounded-full shrink-0" delay={0.4 + i * 0.04} />
            <div className="flex-1 space-y-1.5">
              <Shimmer className="h-3.5 w-32" delay={0.42 + i * 0.04} />
              <Shimmer className="h-2.5 w-48" delay={0.44 + i * 0.04} />
            </div>
            <Shimmer className="h-4 w-16" delay={0.46 + i * 0.04} />
          </div>
        ))}
      </div>

      {/* Pulsing dot indicator */}
      <div className="flex items-center justify-center gap-2 mt-10">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: CYAN }}
            animate={{ opacity: [0.2, 0.8, 0.2] }}
            transition={{
              duration: 1 / PHI,
              repeat: Infinity,
              delay: i * (1 / (PHI * PHI)),
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </div>
  )
}
