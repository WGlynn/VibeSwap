// ============================================================
// PriceChange — Compact price change indicator with arrow
// Used for token lists, market displays, portfolio items
// ============================================================

export default function PriceChange({ value, size = 'sm', className = '' }) {
  if (value === null || value === undefined) return <span className="text-black-500">—</span>

  const isPositive = value >= 0
  const color = isPositive ? 'text-green-400' : 'text-red-400'
  const arrow = isPositive ? '↑' : '↓'

  const sizes = {
    xs: 'text-[10px]',
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  }

  return (
    <span className={`font-mono font-medium ${color} ${sizes[size] || sizes.sm} ${className}`}>
      {arrow} {isPositive ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}
