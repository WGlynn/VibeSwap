import { motion } from 'framer-motion'

// ============================================================
// SegmentedControl — iOS-style segmented toggle
// Used for binary/ternary mode switching (Buy/Sell, Chart/Table)
// ============================================================

const PHI = 1.618033988749895

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  className = '',
}) {
  const sizes = {
    sm: 'text-[10px] py-1 px-2.5',
    md: 'text-xs py-1.5 px-3.5',
    lg: 'text-sm py-2 px-5',
  }

  const sizeClass = sizes[size] || sizes.md
  const selectedIndex = options.findIndex(
    (opt) => (typeof opt === 'string' ? opt : opt.value) === value
  )

  return (
    <div
      className={`relative inline-flex items-center rounded-lg p-0.5 font-mono ${className}`}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Sliding background */}
      {selectedIndex >= 0 && (
        <motion.div
          className="absolute top-0.5 bottom-0.5 rounded-md"
          style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.2)' }}
          initial={false}
          animate={{
            left: `${(selectedIndex / options.length) * 100}%`,
            width: `${100 / options.length}%`,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}

      {options.map((opt) => {
        const optValue = typeof opt === 'string' ? opt : opt.value
        const optLabel = typeof opt === 'string' ? opt : opt.label
        const optIcon = typeof opt === 'object' ? opt.icon : undefined
        const isSelected = value === optValue

        return (
          <button
            key={optValue}
            onClick={() => onChange(optValue)}
            className={`relative z-10 ${sizeClass} font-medium transition-colors ${
              isSelected ? 'text-cyan-400' : 'text-black-400 hover:text-black-300'
            }`}
            style={{ flex: 1, minWidth: 0 }}
          >
            <span className="flex items-center justify-center gap-1">
              {optIcon && <span>{optIcon}</span>}
              {optLabel}
            </span>
          </button>
        )
      })}
    </div>
  )
}
