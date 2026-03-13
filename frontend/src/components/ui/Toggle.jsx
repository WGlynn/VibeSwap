import { motion } from 'framer-motion'

// ============================================================
// Toggle — Animated on/off switch
// Used in settings, notifications, preferences
// ============================================================

const CYAN = '#06b6d4'

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className = '',
}) {
  const sizes = {
    sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 17 },
    md: { track: 'w-10 h-5', thumb: 'w-4 h-4', translate: 21 },
    lg: { track: 'w-12 h-6', thumb: 'w-5 h-5', translate: 25 },
  }
  const s = sizes[size] || sizes.md

  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        className={`relative ${s.track} rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-cyan-500/30`}
        style={{
          background: checked ? `${CYAN}40` : 'rgba(255,255,255,0.1)',
          border: `1px solid ${checked ? `${CYAN}60` : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <motion.div
          className={`absolute top-0.5 left-0.5 ${s.thumb} rounded-full`}
          style={{ background: checked ? CYAN : 'rgba(255,255,255,0.4)' }}
          animate={{ x: checked ? s.translate : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && <div className="text-sm font-mono text-white">{label}</div>}
          {description && <div className="text-[10px] font-mono text-black-500">{description}</div>}
        </div>
      )}
    </label>
  )
}
