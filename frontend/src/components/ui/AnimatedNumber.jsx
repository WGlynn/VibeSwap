import { useEffect, useRef } from 'react'
import { useSpring, useTransform, motion } from 'framer-motion'

/**
 * AnimatedNumber — Spring-interpolated number counter.
 * Numbers visually count up/down over ~0.6s.
 *
 * Props:
 *   value: number — the target value
 *   prefix: string — e.g. '$'
 *   suffix: string — e.g. '%'
 *   decimals: number — decimal places (default 2)
 *   className: string
 */
function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  className = '',
}) {
  const spring = useSpring(0, { stiffness: 100, damping: 20 })
  const display = useTransform(spring, (v) => {
    const formatted = Number(v).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    return `${prefix}${formatted}${suffix}`
  })

  const prevValue = useRef(value)

  useEffect(() => {
    spring.set(value)
    prevValue.current = value
  }, [value, spring])

  return <motion.span className={`tabular-nums ${className}`}>{display}</motion.span>
}

export default AnimatedNumber
