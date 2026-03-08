import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { usePriceFeed } from '../hooks/usePriceFeed'
import { Link } from 'react-router-dom'

/**
 * Portfolio Dashboard — at-a-glance view of holdings, balances, and quick actions.
 */
export default function PortfolioDashboard() {
  const { isConnected: isExternalConnected, shortAddress: externalShortAddress } = useWallet()
  const { isConnected: isDeviceConnected, shortAddress: deviceShortAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const shortAddress = externalShortAddress || deviceShortAddress
  const { getBalance } = useBalances()
  const { getPrice, getChange } = usePriceFeed(['ETH', 'USDC', 'JUL', 'VIBE'])

  const holdings = [
    { symbol: 'ETH', name: 'Ethereum', balance: getBalance('ETH'), price: getPrice('ETH'), change: getChange('ETH') },
    { symbol: 'USDC', name: 'USD Coin', balance: getBalance('USDC'), price: getPrice('USDC'), change: getChange('USDC') },
    { symbol: 'JUL', name: 'Joule', balance: getBalance('JUL'), price: getPrice('JUL'), change: getChange('JUL') },
    { symbol: 'VIBE', name: 'VibeSwap', balance: getBalance('VIBE'), price: getPrice('VIBE'), change: getChange('VIBE') },
  ]

  const totalValue = holdings.reduce((sum, h) => sum + h.balance * h.price, 0)

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold font-mono text-white mb-4">PORTFOLIO</h1>
        <p className="text-black-400 font-mono text-sm mb-6">Connect your wallet to view your portfolio</p>
        <Link to="/" className="text-matrix-400 font-mono text-sm hover:text-matrix-300">Go to Exchange</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold font-mono text-white tracking-wide text-5d">PORTFOLIO</h1>
        <p className="text-black-500 text-xs font-mono mt-1">{shortAddress}</p>
      </div>

      {/* Total Value */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8 p-6 rounded-2xl bg-black-800/60 border border-black-700"
      >
        <p className="text-black-400 text-xs font-mono mb-1">TOTAL VALUE</p>
        <p className="text-3xl font-bold font-mono text-white">
          ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </motion.div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { label: 'Swap', path: '/', icon: 'S' },
          { label: 'Send', path: '/send', icon: 'T' },
          { label: 'Buy', path: '/buy', icon: '+' },
          { label: 'Earn', path: '/earn', icon: '%' },
        ].map(action => (
          <Link
            key={action.path}
            to={action.path}
            className="flex flex-col items-center p-3 rounded-xl bg-black-800/40 border border-black-700 hover:border-matrix-700 transition-colors"
          >
            <span className="text-lg font-mono font-bold text-matrix-400">{action.icon}</span>
            <span className="text-[10px] font-mono text-black-400 mt-1">{action.label}</span>
          </Link>
        ))}
      </div>

      {/* Holdings */}
      <div className="space-y-2">
        <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-2">Holdings</h2>
        {holdings.map((token, i) => (
          <motion.div
            key={token.symbol}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center justify-between p-4 rounded-xl bg-black-800/60 border border-black-700 hover:border-black-600 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-matrix-600/20 border border-matrix-700/30 flex items-center justify-center">
                <span className="text-sm font-mono font-bold text-matrix-400">{token.symbol[0]}</span>
              </div>
              <div>
                <div className="font-mono font-medium text-white text-sm">{token.symbol}</div>
                <div className="text-[10px] font-mono text-black-500">{token.name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm text-white">
                {token.balance.toLocaleString('en-US', { maximumFractionDigits: 4 })}
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-black-500">
                  ${(token.balance * token.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {token.change !== 0 && (
                  <span className={`text-[10px] font-mono ${token.change > 0 ? 'text-matrix-400' : 'text-red-400'}`}>
                    {token.change > 0 ? '+' : ''}{token.change}%
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
