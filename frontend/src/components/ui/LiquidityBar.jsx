import { motion } from 'framer-motion'

// ============================================================
// LiquidityBar — Dual-sided liquidity depth visualization
// Used for pool details, order book depth, token pairs
// ============================================================

const CYAN = '#06b6d4'

export default function LiquidityBar({
  tokenA = { symbol: 'ETH', amount: 0, pct: 50 },
  tokenB = { symbol: 'USDC', amount: 0, pct: 50 },
  colorA = CYAN,
  colorB = '#8b5cf6',
  height = 8,
  showLabels = true,
  className = '',
}) {
  const pctA = Math.max(1, Math.min(99, tokenA.pct || 50))
  const pctB = 100 - pctA

  return (
    <div className={className}>
      {showLabels && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono font-medium" style={{ color: colorA }}>
            {tokenA.symbol} {pctA.toFixed(1)}%
          </span>
          <span className="text-[10px] font-mono font-medium" style={{ color: colorB }}>
            {pctB.toFixed(1)}% {tokenB.symbol}
          </span>
        </div>
      )}
      <div className="flex rounded-full overflow-hidden" style={{ height }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pctA}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          style={{ background: colorA }}
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pctB}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
          style={{ background: colorB }}
        />
      </div>
      {showLabels && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] font-mono text-black-500">
            {tokenA.amount?.toLocaleString() || '0'}
          </span>
          <span className="text-[9px] font-mono text-black-500">
            {tokenB.amount?.toLocaleString() || '0'}
          </span>
        </div>
      )}
    </div>
  )
}
