import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// Batch Countdown — 10-second cycle timer
// Shows current batch phase: COMMIT (8s) → REVEAL (2s) → SETTLE
// Can be used standalone or embedded in other components
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const BATCH_DURATION = 10 // seconds
const COMMIT_DURATION = 8
const REVEAL_DURATION = 2

function getPhase(elapsed) {
  if (elapsed < COMMIT_DURATION) return { name: 'COMMIT', color: '#06b6d4', remaining: COMMIT_DURATION - elapsed, progress: elapsed / COMMIT_DURATION }
  if (elapsed < BATCH_DURATION) return { name: 'REVEAL', color: '#f59e0b', remaining: BATCH_DURATION - elapsed, progress: (elapsed - COMMIT_DURATION) / REVEAL_DURATION }
  return { name: 'SETTLE', color: '#10b981', remaining: 0, progress: 1 }
}

export default function BatchCountdown({ compact = false, showBatchId = true, className = '' }) {
  const [elapsed, setElapsed] = useState(0)
  const [batchId, setBatchId] = useState(147832)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const t = ((Date.now() - start) / 1000) % BATCH_DURATION
      setElapsed(t)

      // Increment batch ID on cycle reset
      if (t < 0.1) {
        setBatchId((prev) => prev + 1)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [])

  const phase = getPhase(elapsed)
  const totalProgress = elapsed / BATCH_DURATION

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: phase.color }}
        />
        <span className="text-[10px] font-mono font-bold" style={{ color: phase.color }}>
          {phase.name}
        </span>
        <span className="text-[10px] font-mono text-black-500">
          {phase.remaining.toFixed(1)}s
        </span>
      </div>
    )
  }

  // Arc constants
  const R = 32
  const C = 2 * Math.PI * R
  const offset = C * (1 - totalProgress)

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      {/* Circular progress */}
      <div className="relative w-20 h-20">
        <svg width="80" height="80" viewBox="0 0 80 80" className="transform -rotate-90">
          {/* Background track */}
          <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(40,40,40,0.5)" strokeWidth="3" />
          {/* Commit phase arc */}
          <circle
            cx="40" cy="40" r={R}
            fill="none"
            stroke={phase.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.05s linear', filter: `drop-shadow(0 0 4px ${phase.color}60)` }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-mono font-bold" style={{ color: phase.color }}>
            {phase.remaining.toFixed(1)}s
          </span>
          <span className="text-[8px] font-mono text-black-500 uppercase tracking-wider">
            {phase.name}
          </span>
        </div>
      </div>

      {/* Phase indicators */}
      <div className="flex items-center gap-1">
        {['COMMIT', 'REVEAL', 'SETTLE'].map((p) => (
          <div
            key={p}
            className={`h-1 rounded-full transition-all duration-200 ${
              p === phase.name ? 'w-6' : 'w-2'
            }`}
            style={{
              backgroundColor:
                p === phase.name
                  ? phase.color
                  : 'rgba(60,60,60,0.5)',
            }}
          />
        ))}
      </div>

      {/* Batch ID */}
      {showBatchId && (
        <span className="text-[9px] font-mono text-black-500">
          Batch #{batchId.toLocaleString()}
        </span>
      )}
    </div>
  )
}
