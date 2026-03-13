// ============================================================
// Divider — Horizontal or vertical separator
// Supports labels, gradient glow, and orientation
// ============================================================

const CYAN = '#06b6d4'

export default function Divider({
  label,
  orientation = 'horizontal',
  glow = false,
  className = '',
}) {
  if (orientation === 'vertical') {
    return (
      <div
        className={`w-px self-stretch ${className}`}
        style={{
          background: glow
            ? `linear-gradient(180deg, transparent, ${CYAN}30, transparent)`
            : 'rgba(255,255,255,0.06)',
        }}
      />
    )
  }

  if (label) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div
          className="flex-1 h-px"
          style={{
            background: glow
              ? `linear-gradient(90deg, transparent, ${CYAN}30)`
              : 'rgba(255,255,255,0.06)',
          }}
        />
        <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider shrink-0">{label}</span>
        <div
          className="flex-1 h-px"
          style={{
            background: glow
              ? `linear-gradient(90deg, ${CYAN}30, transparent)`
              : 'rgba(255,255,255,0.06)',
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`h-px ${className}`}
      style={{
        background: glow
          ? `linear-gradient(90deg, transparent, ${CYAN}30, transparent)`
          : 'rgba(255,255,255,0.06)',
      }}
    />
  )
}
