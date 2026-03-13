import { motion } from 'framer-motion'

// ============================================================
// ToggleSwitch — Animated on/off toggle
// Used for settings, feature flags, dark mode
// ============================================================

const CYAN = '#06b6d4'

export default function ToggleSwitch({
  checked = false,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
}) {
  const sizes = {
    sm: { w: 32, h: 18, dot: 14, pad: 2 },
    md: { w: 40, h: 22, dot: 18, pad: 2 },
    lg: { w: 48, h: 26, dot: 22, pad: 2 },
  }
  const s = sizes[size] || sizes.md

  return (
    <label
      className={`inline-flex items-center gap-2 select-none ${disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'} ${className}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange && onChange(!checked)}
        disabled={disabled}
        className="relative rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
        style={{
          width: s.w,
          height: s.h,
          background: checked ? CYAN : 'rgba(255,255,255,0.1)',
        }}
      >
        <motion.div
          className="absolute rounded-full bg-white shadow-sm"
          style={{
            width: s.dot,
            height: s.dot,
            top: s.pad,
          }}
          animate={{
            left: checked ? s.w - s.dot - s.pad : s.pad,
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
      {label && (
        <span className="text-xs font-mono text-black-400">{label}</span>
      )}
    </label>
  )
}
