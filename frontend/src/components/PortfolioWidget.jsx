import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { usePriceFeed } from '../hooks/usePriceFeed'

// Your portfolio. Your wealth. At a glance.
// Shows REAL data only — never fake numbers.

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', color: '#627EEA' },
  { symbol: 'USDC', name: 'USD Coin', color: '#2775CA' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', color: '#F7931A' },
  { symbol: 'ARB', name: 'Arbitrum', color: '#28A0F0' },
]

function PortfolioWidget() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { getBalance } = useBalances()
  const { getPrice } = usePriceFeed(['ETH', 'USDC', 'WBTC', 'ARB'])

  const holdings = useMemo(() => {
    if (!isConnected) return []
    return TOKENS.map(t => ({
      ...t,
      balance: getBalance(t.symbol),
      value: getBalance(t.symbol) * getPrice(t.symbol),
    })).filter(h => h.balance > 0)
  }, [isConnected, getBalance, getPrice])

  const totalValue = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings])
  const dollars = Math.floor(totalValue)
  const cents = ((totalValue - dollars) * 100).toFixed(0).padStart(2, '0')

  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
      >
        <div className="p-5 bg-gradient-to-br from-vibe-500/10 to-cyber-500/10">
          <span className="text-sm text-void-400">Your Portfolio</span>
          <div className="mt-3 text-void-500 text-sm">
            Connect a wallet to view your holdings.
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl border border-void-600/30 overflow-hidden"
    >
      <div className="p-5 bg-gradient-to-br from-vibe-500/10 to-cyber-500/10 border-b border-void-600/30">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-void-400">Your Portfolio</span>
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-3xl font-display font-bold">${dollars.toLocaleString()}</span>
          <span className="text-sm text-void-400">.{cents}</span>
        </div>
      </div>

      {holdings.length > 0 ? (
        <div className="p-4 space-y-2">
          {holdings.map(h => (
            <div key={h.symbol} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: h.color }} />
                <span className="text-xs font-mono text-white">{h.symbol}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono text-white">${h.value.toFixed(2)}</span>
                <span className="text-[10px] font-mono text-black-500 ml-2">{h.balance.toFixed(4)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-center text-void-500 text-sm">
          No positions yet. Start trading to build your portfolio.
        </div>
      )}
    </motion.div>
  )
}

export default PortfolioWidget
