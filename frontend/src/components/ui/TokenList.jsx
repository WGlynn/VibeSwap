import { Link } from 'react-router-dom'

// ============================================================
// TokenList — Scrollable list of tokens with price info
// Used for watchlists, portfolio, market overview
// ============================================================

const CYAN = '#06b6d4'

function fmt(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export default function TokenList({
  tokens = [],
  showRank = true,
  onSelect,
  className = '',
}) {
  return (
    <div className={`space-y-0.5 ${className}`}>
      {tokens.map((token, i) => {
        const isPositive = (token.change || 0) >= 0
        const changeColor = isPositive ? '#22c55e' : '#ef4444'

        const content = (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.02] transition-colors cursor-pointer">
            {showRank && (
              <span className="text-[10px] font-mono text-black-600 w-5 text-right tabular-nums">
                {i + 1}
              </span>
            )}
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold text-white"
              style={{ background: token.color || CYAN }}
            >
              {token.icon || token.symbol?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-bold text-white">{token.symbol}</span>
                <span className="text-[10px] font-mono text-black-600 truncate">{token.name}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono font-bold text-white tabular-nums">
                {fmt(token.price || 0)}
              </div>
              <div className="text-[10px] font-mono font-medium tabular-nums" style={{ color: changeColor }}>
                {isPositive ? '+' : ''}{(token.change || 0).toFixed(2)}%
              </div>
            </div>
          </div>
        )

        if (token.symbol) {
          return (
            <Link key={token.symbol} to={`/token/${token.symbol}`} onClick={() => onSelect?.(token)}>
              {content}
            </Link>
          )
        }

        return <div key={i} onClick={() => onSelect?.(token)}>{content}</div>
      })}
    </div>
  )
}
