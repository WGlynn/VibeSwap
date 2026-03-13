import { motion } from 'framer-motion'

// ============================================================
// MarketTicker — Horizontal scrolling price ticker
// Used for header, dashboard, market overview
// ============================================================

const CYAN = '#06b6d4'

function TickerItem({ symbol, price, change }) {
  const isPositive = change >= 0
  const color = isPositive ? '#22c55e' : '#ef4444'
  const arrow = isPositive ? '▲' : '▼'

  return (
    <div className="flex items-center gap-2 px-4 whitespace-nowrap">
      <span className="text-[10px] font-mono font-bold text-white">{symbol}</span>
      <span className="text-[10px] font-mono text-black-400">${price.toLocaleString()}</span>
      <span className="text-[9px] font-mono font-medium" style={{ color }}>
        {arrow} {Math.abs(change).toFixed(2)}%
      </span>
    </div>
  )
}

export default function MarketTicker({
  tokens = [],
  speed = 40,
  className = '',
}) {
  if (tokens.length === 0) return null

  // Double the tokens for seamless loop
  const items = [...tokens, ...tokens]

  return (
    <div
      className={`overflow-hidden border-y ${className}`}
      style={{ borderColor: `${CYAN}08` }}
    >
      <motion.div
        className="flex items-center py-1.5"
        animate={{ x: [`0%`, `-50%`] }}
        transition={{
          x: { duration: tokens.length * (100 / speed), repeat: Infinity, ease: 'linear' },
        }}
      >
        {items.map((token, i) => (
          <TickerItem key={`${token.symbol}-${i}`} {...token} />
        ))}
      </motion.div>
    </div>
  )
}
