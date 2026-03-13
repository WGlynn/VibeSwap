// ============================================================
// CountBadge — Small count indicator for tabs, nav items
// Used for unread notifications, pending items, filter counts
// ============================================================

const VARIANT_STYLES = {
  default: 'bg-black-700 text-black-300',
  primary: 'bg-cyan-500/20 text-cyan-400',
  success: 'bg-green-500/20 text-green-400',
  warning: 'bg-amber-500/20 text-amber-400',
  danger: 'bg-red-500/20 text-red-400',
}

export default function CountBadge({
  count,
  variant = 'default',
  max = 99,
  dot = false,
  className = '',
}) {
  if (count === 0 && !dot) return null

  if (dot) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          variant === 'danger' ? 'bg-red-500' : variant === 'warning' ? 'bg-amber-500' : 'bg-cyan-500'
        } ${className}`}
      />
    )
  }

  const display = count > max ? `${max}+` : count

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-bold ${
        VARIANT_STYLES[variant] || VARIANT_STYLES.default
      } ${className}`}
    >
      {display}
    </span>
  )
}
