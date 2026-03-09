import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// Your portfolio. Your wealth. At a glance.
// Shows REAL data only — never fake numbers.

const TOKEN_META = {
  ETH: { name: 'Ethereum', color: '#627EEA', logo: '\u27E0' },
  USDC: { name: 'USD Coin', color: '#2775CA', logo: '\u25C9' },
  WBTC: { name: 'Wrapped Bitcoin', color: '#F7931A', logo: '\u20BF' },
  ARB: { name: 'Arbitrum', color: '#28A0F0', logo: '\u25C6' },
}

function PortfolioWidget() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

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

  // TODO: Fetch real token balances from connected wallet
  // For now, show connected state with zero balances until real data is wired
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
          <span className="text-3xl font-display font-bold">$0</span>
          <span className="text-sm text-void-400">.00</span>
        </div>
      </div>

      <div className="p-4 text-center text-void-500 text-sm">
        No positions yet. Start trading to build your portfolio.
      </div>
    </motion.div>
  )
}

export default PortfolioWidget
