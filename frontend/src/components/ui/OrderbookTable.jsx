import { useMemo } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// OrderbookTable — Dual-sided order book visualization
// Used for trading, OTC desk, limit orders
// ============================================================

const CYAN = '#06b6d4'

function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(4)
}

function Row({ price, amount, total, maxTotal, side }) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0
  const isAsk = side === 'ask'

  return (
    <div className="relative flex items-center text-[10px] font-mono py-0.5 px-2">
      <div
        className="absolute inset-0"
        style={{
          background: isAsk ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)',
          width: `${pct}%`,
          right: isAsk ? 0 : undefined,
          left: isAsk ? undefined : 0,
        }}
      />
      <span className="w-1/3 tabular-nums" style={{ color: isAsk ? '#ef4444' : '#22c55e' }}>
        {price.toFixed(4)}
      </span>
      <span className="w-1/3 text-center text-black-400 tabular-nums">{fmt(amount)}</span>
      <span className="w-1/3 text-right text-black-500 tabular-nums">{fmt(total)}</span>
    </div>
  )
}

export default function OrderbookTable({
  asks = [],
  bids = [],
  maxRows = 8,
  midPrice,
  spread,
  className = '',
}) {
  const displayAsks = useMemo(() => {
    const sorted = [...asks].sort((a, b) => a.price - b.price).slice(0, maxRows)
    let cumTotal = 0
    return sorted.map((o) => {
      cumTotal += o.amount
      return { ...o, total: cumTotal }
    }).reverse()
  }, [asks, maxRows])

  const displayBids = useMemo(() => {
    const sorted = [...bids].sort((a, b) => b.price - a.price).slice(0, maxRows)
    let cumTotal = 0
    return sorted.map((o) => {
      cumTotal += o.amount
      return { ...o, total: cumTotal }
    })
  }, [bids, maxRows])

  const maxAskTotal = displayAsks.length > 0 ? Math.max(...displayAsks.map((o) => o.total)) : 0
  const maxBidTotal = displayBids.length > 0 ? Math.max(...displayBids.map((o) => o.total)) : 0

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center text-[9px] font-mono text-black-600 px-2 py-1 uppercase tracking-wider">
        <span className="w-1/3">Price</span>
        <span className="w-1/3 text-center">Amount</span>
        <span className="w-1/3 text-right">Total</span>
      </div>

      {/* Asks */}
      <div className="border-b" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        {displayAsks.map((o, i) => (
          <Row key={i} {...o} maxTotal={maxAskTotal} side="ask" />
        ))}
      </div>

      {/* Mid price */}
      {midPrice && (
        <div className="flex items-center justify-between px-2 py-1.5 border-y" style={{ borderColor: `${CYAN}15` }}>
          <span className="text-xs font-mono font-bold text-white">{midPrice.toFixed(4)}</span>
          {spread !== undefined && (
            <span className="text-[9px] font-mono text-black-500">
              Spread: {(spread * 100).toFixed(3)}%
            </span>
          )}
        </div>
      )}

      {/* Bids */}
      <div>
        {displayBids.map((o, i) => (
          <Row key={i} {...o} maxTotal={maxBidTotal} side="bid" />
        ))}
      </div>
    </div>
  )
}
