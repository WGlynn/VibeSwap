import { useState } from 'react'
import { motion } from 'framer-motion'

// Your portfolio. Your wealth. At a glance.
// This isn't just numbers - it's your financial story.

const MOCK_HOLDINGS = [
  { symbol: 'ETH', name: 'Ethereum', amount: '2.5', value: 5000, change: 3.2, color: '#627EEA', logo: '⟠' },
  { symbol: 'USDC', name: 'USD Coin', amount: '5,000', value: 5000, change: 0, color: '#2775CA', logo: '◉' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', amount: '0.15', value: 6300, change: -1.5, color: '#F7931A', logo: '₿' },
  { symbol: 'ARB', name: 'Arbitrum', amount: '1,200', value: 1440, change: 8.7, color: '#28A0F0', logo: '◆' },
]

function PortfolioWidget() {
  const [showAllAssets, setShowAllAssets] = useState(false)

  const totalValue = MOCK_HOLDINGS.reduce((sum, h) => sum + h.value, 0)
  const totalChange = 2.8 // Mock 24h change

  const displayedHoldings = showAllAssets ? MOCK_HOLDINGS : MOCK_HOLDINGS.slice(0, 3)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      {/* Header with total value */}
      <div className="p-5 bg-gradient-to-br from-vibe-500/10 to-cyber-500/10 border-b border-void-600/30">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-void-400">Your Portfolio</span>
          <div className={`flex items-center space-x-1 text-sm font-medium ${
            totalChange >= 0 ? 'text-glow-500' : 'text-red-400'
          }`}>
            <svg className={`w-4 h-4 ${totalChange < 0 ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>{totalChange >= 0 ? '+' : ''}{totalChange}%</span>
          </div>
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-3xl font-display font-bold">${totalValue.toLocaleString()}</span>
          <span className="text-sm text-void-400">.00</span>
        </div>

        {/* Mini pie chart visualization */}
        <div className="flex items-center space-x-2 mt-4">
          <div className="flex-1 h-2 rounded-full bg-void-700 overflow-hidden flex">
            {MOCK_HOLDINGS.map((holding, index) => (
              <motion.div
                key={holding.symbol}
                initial={{ width: 0 }}
                animate={{ width: `${(holding.value / totalValue) * 100}%` }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className="h-full"
                style={{ backgroundColor: holding.color }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Holdings list */}
      <div className="divide-y divide-void-700/30">
        {displayedHoldings.map((holding, index) => (
          <motion.div
            key={holding.symbol}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ backgroundColor: 'rgba(255, 30, 232, 0.03)' }}
            className="p-4 flex items-center justify-between cursor-pointer transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: `${holding.color}20`, color: holding.color }}
              >
                {holding.logo}
              </div>
              <div>
                <div className="font-semibold">{holding.symbol}</div>
                <div className="text-sm text-void-400">{holding.amount}</div>
              </div>
            </div>

            <div className="text-right">
              <div className="font-mono font-medium">${holding.value.toLocaleString()}</div>
              <div className={`text-sm font-medium ${
                holding.change > 0 ? 'text-glow-500' : holding.change < 0 ? 'text-red-400' : 'text-void-400'
              }`}>
                {holding.change > 0 ? '+' : ''}{holding.change}%
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Show all toggle */}
      {MOCK_HOLDINGS.length > 3 && (
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setShowAllAssets(!showAllAssets)}
          className="w-full p-3 text-sm text-vibe-400 hover:text-vibe-300 border-t border-void-600/30 transition-colors"
        >
          {showAllAssets ? 'Show less' : `Show all ${MOCK_HOLDINGS.length} assets`}
        </motion.button>
      )}
    </motion.div>
  )
}

export default PortfolioWidget
