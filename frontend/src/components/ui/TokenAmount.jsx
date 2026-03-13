// ============================================================
// TokenAmount — Formatted token amount with symbol
// Handles large numbers, small decimals, USD values
// ============================================================

function format(n, decimals = 4) {
  if (n === 0) return '0'
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  if (Math.abs(n) < 0.001) return n.toFixed(8)
  return n.toFixed(decimals)
}

export default function TokenAmount({
  amount = 0,
  symbol,
  usdValue,
  decimals = 4,
  size = 'md',
  showSign = false,
  className = '',
}) {
  const sizes = {
    sm: { amount: 'text-[10px]', usd: 'text-[9px]' },
    md: { amount: 'text-xs', usd: 'text-[10px]' },
    lg: { amount: 'text-sm', usd: 'text-xs' },
    xl: { amount: 'text-lg', usd: 'text-sm' },
  }
  const s = sizes[size] || sizes.md
  const sign = showSign && amount > 0 ? '+' : ''

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <span className={`font-mono font-bold text-white tabular-nums ${s.amount}`}>
        {sign}{format(amount, decimals)}
        {symbol && <span className="text-black-500 ml-1 font-medium">{symbol}</span>}
      </span>
      {usdValue !== undefined && (
        <span className={`font-mono text-black-500 tabular-nums ${s.usd}`}>
          ${format(usdValue, 2)}
        </span>
      )}
    </span>
  )
}
