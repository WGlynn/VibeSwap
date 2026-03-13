import { useEffect, useRef, useState } from 'react'

// ============================================================
// NumberTicker — Animated counting number
// Used for stats, counters, portfolio values, TVL
// ============================================================

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4)
}

export default function NumberTicker({
  value = 0,
  duration = 1200,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const from = prevRef.current
    const to = typeof value === 'number' ? value : parseFloat(value) || 0
    const start = performance.now()

    function tick(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)
      const current = from + (to - from) * eased

      setDisplay(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        prevRef.current = to
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  const formatted = display.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  )
}
