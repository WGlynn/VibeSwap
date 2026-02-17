import { useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'

/**
 * GlassCard — Glass morphism card with depth, spotlight, and glow.
 * Replaces flat bg-black-800 border-black-600 cards throughout the app.
 *
 * Props:
 *   variant: 'default' | 'primary' — controls border/glow intensity
 *   glowColor: 'matrix' | 'terminal' | 'warning' | 'none'
 *   spotlight: boolean — radial gradient follows mouse cursor
 *   hover: boolean — enable hover lift + border brighten
 *   className: string — additional classes
 *   children: ReactNode
 */

const GLOW_MAP = {
  matrix: 'rgba(0,255,65,0.06)',
  terminal: 'rgba(0,212,255,0.06)',
  warning: 'rgba(255,170,0,0.06)',
  none: 'transparent',
}

const BORDER_GLOW_MAP = {
  matrix: 'rgba(0,255,65,0.12)',
  terminal: 'rgba(0,212,255,0.12)',
  warning: 'rgba(255,170,0,0.12)',
  none: 'rgba(37,37,37,1)',
}

function GlassCard({
  variant = 'default',
  glowColor = 'none',
  spotlight = false,
  hover = true,
  className = '',
  children,
  ...props
}) {
  const cardRef = useRef(null)
  const [spotlightPos, setSpotlightPos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = useCallback((e) => {
    if (!spotlight || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setSpotlightPos({ x, y })
  }, [spotlight])

  const borderColor = isHovered && hover
    ? (glowColor !== 'none' ? BORDER_GLOW_MAP[glowColor] : 'rgba(66,66,66,1)')
    : 'rgba(37,37,37,1)'

  const boxShadow = isHovered && hover
    ? `0 8px 32px rgba(0,0,0,0.4), 0 0 30px -5px ${GLOW_MAP[glowColor]}`
    : `0 2px 8px rgba(0,0,0,0.2)`

  const spotlightBg = spotlight && isHovered
    ? `radial-gradient(circle at ${spotlightPos.x}% ${spotlightPos.y}%, rgba(255,255,255,0.03) 0%, transparent 50%)`
    : 'none'

  return (
    <motion.div
      ref={cardRef}
      className={`glass-card rounded-2xl overflow-hidden ${className}`}
      style={{
        borderColor,
        boxShadow,
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={hover ? { y: -2 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...props}
    >
      {/* Diagonal gradient overlay + spotlight */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background: `
            linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 50%, rgba(0,0,0,0.05) 100%),
            ${spotlightBg}
          `,
        }}
      />
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  )
}

export default GlassCard
