import { motion } from 'framer-motion'
import { usePriceFeed } from '../hooks/usePriceFeed'

// What's hot. What's moving. What you might be missing.
// This creates urgency. This creates discovery. This creates action.

const TOKEN_META = [
  { symbol: 'ARB', name: 'Arbitrum', logo: '◆', color: '#28A0F0' },
  { symbol: 'OP', name: 'Optimism', logo: '◯', color: '#FF0420' },
  { symbol: 'ETH', name: 'Ethereum', logo: '⟠', color: '#627EEA' },
  { symbol: 'WBTC', name: 'Bitcoin', logo: '₿', color: '#F7931A' },
  { symbol: 'LINK', name: 'Chainlink', logo: '⬡', color: '#2A5ADA' },
]

function TrendingTokens({ onSelectToken }) {
  const { getPrice, getChange } = usePriceFeed(['ARB', 'OP', 'ETH', 'WBTC', 'LINK'])

  // Build trending list from real price data, sorted by 24h change
  const TRENDING = TOKEN_META.map((t, i) => {
    const price = getPrice(t.symbol)
    const change = getChange(t.symbol)
    const priceStr = price >= 1000
      ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : price >= 1
        ? `$${price.toFixed(2)}`
        : `$${price.toFixed(4)}`
    return {
      ...t,
      price: priceStr,
      change: parseFloat(change?.toFixed(1) || '0'),
      volume: ['$12.4M', '$8.7M', '$142.8M', '$89.3M', '$6.2M'][i] || '$1.2M',
      isHot: Math.abs(change || 0) > 5,
      rank: i + 1,
    }
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .map((t, i) => ({ ...t, rank: i + 1 }))
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-void-600/30">
        <div className="flex items-center space-x-2">
          <span className="text-lg">🔥</span>
          <h3 className="font-display font-bold text-sm">TRENDING</h3>
        </div>
        <span className="text-xs text-void-400">24h</span>
      </div>

      {/* Token list */}
      <div className="divide-y divide-void-700/30">
        {TRENDING.map((token, index) => (
          <motion.button
            key={token.symbol}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ backgroundColor: 'rgba(255, 30, 232, 0.05)', x: 4 }}
            onClick={() => onSelectToken?.(token)}
            className="w-full p-4 flex items-center justify-between transition-all text-left"
          >
            <div className="flex items-center space-x-3">
              {/* Rank */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                token.rank <= 2 ? 'bg-glow-500/20 text-glow-500' : 'bg-void-700 text-void-400'
              }`}>
                {token.rank}
              </div>

              {/* Token info */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: `${token.color}20`, color: token.color }}
              >
                {token.logo}
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold">{token.symbol}</span>
                  {token.isHot && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full">
                      HOT
                    </span>
                  )}
                </div>
                <div className="text-xs text-void-400">Vol: {token.volume}</div>
              </div>
            </div>

            <div className="text-right">
              <div className="font-mono font-medium">{token.price}</div>
              <div className={`text-sm font-medium flex items-center justify-end space-x-1 ${
                token.change >= 0 ? 'text-glow-500' : 'text-red-400'
              }`}>
                <svg className={`w-3 h-3 ${token.change < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span>{token.change > 0 ? '+' : ''}{token.change}%</span>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* View all */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="w-full p-3 text-sm text-vibe-400 hover:text-vibe-300 border-t border-void-600/30 transition-colors flex items-center justify-center space-x-1"
      >
        <span>View all tokens</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </motion.button>
    </motion.div>
  )
}

export default TrendingTokens
