/**
 * PulseIndicator — Alive status dot with radiating ring animation.
 *
 * Props:
 *   color: 'matrix' | 'terminal' | 'warning' | 'error'
 *   size: 'sm' | 'md' — dot size (default 'sm')
 *   active: boolean — whether to show the pulse ring (default true)
 */

const COLOR_MAP = {
  matrix: { dot: 'bg-matrix-500', ring: 'border-matrix-500' },
  terminal: { dot: 'bg-terminal-500', ring: 'border-terminal-500' },
  warning: { dot: 'bg-warning', ring: 'border-warning' },
  error: { dot: 'bg-red-500', ring: 'border-red-500' },
}

const SIZE_MAP = {
  sm: { dot: 'w-2 h-2', ring: 'w-2 h-2' },
  md: { dot: 'w-3 h-3', ring: 'w-3 h-3' },
}

function PulseIndicator({ color = 'matrix', size = 'sm', active = true }) {
  const colors = COLOR_MAP[color] || COLOR_MAP.matrix
  const sizes = SIZE_MAP[size] || SIZE_MAP.sm

  return (
    <span className="relative inline-flex">
      {/* Outer pulse ring */}
      {active && (
        <span
          className={`absolute inline-flex ${sizes.ring} rounded-full ${colors.ring} border-2 animate-pulse-ring opacity-0`}
        />
      )}
      {/* Inner dot */}
      <span className={`relative inline-flex ${sizes.dot} rounded-full ${colors.dot}`} />
    </span>
  )
}

export default PulseIndicator
