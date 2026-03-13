// ============================================================
// WalletBalance — Token balance display with USD value
// Used for wallet overview, header balance, token lists
// ============================================================

export default function WalletBalance({
  token = 'ETH',
  balance = 0,
  usdValue,
  change,
  icon,
  className = '',
}) {
  const changeColor = !change ? '#6b7280' : change > 0 ? '#22c55e' : '#ef4444'

  function fmt(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
    if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
    if (n < 0.001 && n > 0) return n.toFixed(8)
    return n.toFixed(4)
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {icon && (
        <span className="text-lg shrink-0">{icon}</span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-mono font-bold text-white tabular-nums truncate">
            {fmt(balance)}
          </span>
          <span className="text-[10px] font-mono text-black-500">{token}</span>
        </div>
        {usdValue !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-black-500">
              ${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            {change !== undefined && (
              <span className="text-[9px] font-mono font-medium" style={{ color: changeColor }}>
                {change > 0 ? '+' : ''}{change.toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
