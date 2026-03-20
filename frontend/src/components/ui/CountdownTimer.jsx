import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const AMBER = '#f59e0b'
const GREEN = '#22c55e'
const COMMIT_DURATION = 8
const REVEAL_DURATION = 2
const SETTLE_DURATION = 1
const CYCLE_DURATION = COMMIT_DURATION + REVEAL_DURATION + SETTLE_DURATION

const PHASES = {
  COMMIT: { label: 'COMMIT', color: CYAN, duration: COMMIT_DURATION },
  REVEAL: { label: 'REVEAL', color: AMBER, duration: REVEAL_DURATION },
  SETTLING: { label: 'SETTLING', color: GREEN, duration: SETTLE_DURATION },
}

/**
 * CountdownTimer — Compact batch auction countdown widget.
 *
 * Displays the current 10-second commit-reveal cycle:
 *   COMMIT (8s) -> REVEAL (2s) -> SETTLING (brief flash)
 *
 * Props:
 *   size: number — ring diameter in px (default 64)
 *   showBatch: boolean — show batch number (default true)
 *   className: string — additional classes
 */
function CountdownTimer({ size = 64, showBatch = true, className = '' }) {
  const [elapsed, setElapsed] = useState(0)

  // ============ Timer ============
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => (prev + 1) % (CYCLE_DURATION * 10))
    }, 100)
    return () => clearInterval(interval)
  }, [])

  // ============ Phase Calculation ============
  const totalSeconds = elapsed / 10
  let phase, phaseTimeLeft, phaseProgress
  if (totalSeconds < COMMIT_DURATION) {
    phase = PHASES.COMMIT
    phaseTimeLeft = COMMIT_DURATION - totalSeconds
    phaseProgress = totalSeconds / COMMIT_DURATION
  } else if (totalSeconds < COMMIT_DURATION + REVEAL_DURATION) {
    phase = PHASES.REVEAL
    const inPhase = totalSeconds - COMMIT_DURATION
    phaseTimeLeft = REVEAL_DURATION - inPhase
    phaseProgress = inPhase / REVEAL_DURATION
  } else {
    phase = PHASES.SETTLING
    const inPhase = totalSeconds - COMMIT_DURATION - REVEAL_DURATION
    phaseTimeLeft = SETTLE_DURATION - inPhase
    phaseProgress = inPhase / SETTLE_DURATION
  }
  const displaySeconds = Math.ceil(phaseTimeLeft)

  // ============ SVG Ring Geometry ============
  const strokeWidth = Math.max(3, size / (PHI * 12))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * phaseProgress

  // ============ Responsive Font Sizes ============
  const labelSize = Math.max(6, size / 9)
  const numberSize = Math.max(10, size / 3.8)
  const batchFontSize = Math.max(7, size / 10)
  const batchNumber = 847293

  return (
    <div
      className={`inline-flex flex-col items-center gap-1 ${className}`}
      style={{ width: size + 8 }}
    >
      {/* Circular ring + countdown */}
      <div
        className="relative rounded-full"
        style={{
          width: size, height: size,
          background: 'rgba(15, 15, 15, 0.6)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <svg width={size} height={size} className="absolute inset-0 -rotate-90">
          {/* Background ring */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="rgba(255, 255, 255, 0.06)" strokeWidth={strokeWidth}
          />
          {/* Progress ring — drains as phase time elapses */}
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={phase.color}
            strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.1, ease: 'linear' }}
            style={{ filter: `drop-shadow(0 0 4px ${phase.color}40)` }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={phase.label}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-mono font-bold tracking-widest uppercase"
            style={{ fontSize: labelSize, color: phase.color, lineHeight: 1 }}
          >
            {phase.label}
          </motion.span>
          <motion.span
            className="font-mono font-bold tabular-nums"
            style={{ fontSize: numberSize, color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.1 }}
            animate={
              phase === PHASES.COMMIT && displaySeconds <= 3
                ? { scale: [1, 1.08, 1] }
                : {}
            }
            transition={{ duration: 0.5, repeat: Infinity }}
          >
            {displaySeconds}
          </motion.span>
        </div>
      </div>
      {/* Batch number */}
      {showBatch && (
        <motion.span
          className="font-mono text-center"
          style={{ fontSize: batchFontSize, color: 'rgba(255, 255, 255, 0.35)', lineHeight: 1 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          #{batchNumber.toLocaleString()}
        </motion.span>
      )}
    </div>
  )
}

export default CountdownTimer
