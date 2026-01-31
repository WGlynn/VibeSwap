import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'

// Mock transaction data
const MOCK_TRANSACTIONS = [
  {
    id: '1',
    type: 'swap',
    status: 'completed',
    tokenIn: { symbol: 'ETH', amount: '1.5', logo: '⟠' },
    tokenOut: { symbol: 'USDC', amount: '3,000', logo: '💵' },
    timestamp: Date.now() - 1000 * 60 * 5, // 5 min ago
    txHash: '0x1234...5678',
    batchId: 1247,
  },
  {
    id: '2',
    type: 'swap',
    status: 'completed',
    tokenIn: { symbol: 'USDC', amount: '500', logo: '💵' },
    tokenOut: { symbol: 'ARB', amount: '416.67', logo: '🔵' },
    timestamp: Date.now() - 1000 * 60 * 30, // 30 min ago
    txHash: '0x2345...6789',
    batchId: 1243,
  },
  {
    id: '3',
    type: 'addLiquidity',
    status: 'completed',
    token0: { symbol: 'ETH', amount: '2.0', logo: '⟠' },
    token1: { symbol: 'USDC', amount: '4,000', logo: '💵' },
    timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    txHash: '0x3456...7890',
    lpTokens: '2,828.42',
  },
  {
    id: '4',
    type: 'swap',
    status: 'pending',
    tokenIn: { symbol: 'WBTC', amount: '0.05', logo: '₿' },
    tokenOut: { symbol: 'ETH', amount: '~1.05', logo: '⟠' },
    timestamp: Date.now() - 1000 * 30, // 30 sec ago
    batchId: 1248,
    phase: 'reveal',
  },
  {
    id: '5',
    type: 'removeLiquidity',
    status: 'completed',
    token0: { symbol: 'ETH', amount: '0.5', logo: '⟠' },
    token1: { symbol: 'USDC', amount: '1,000', logo: '💵' },
    timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    txHash: '0x4567...8901',
    lpTokens: '707.10',
  },
  {
    id: '6',
    type: 'bridge',
    status: 'completed',
    token: { symbol: 'USDC', amount: '1,000', logo: '💵' },
    fromChain: 'Ethereum',
    toChain: 'Arbitrum',
    timestamp: Date.now() - 1000 * 60 * 60 * 48, // 2 days ago
    txHash: '0x5678...9012',
  },
]

function TransactionHistory({ isOpen, onClose }) {
  const { isConnected } = useWallet()
  const [filter, setFilter] = useState('all')

  const filteredTxs = MOCK_TRANSACTIONS.filter(tx => {
    if (filter === 'all') return true
    if (filter === 'swaps') return tx.type === 'swap'
    if (filter === 'liquidity') return tx.type === 'addLiquidity' || tx.type === 'removeLiquidity'
    if (filter === 'bridge') return tx.type === 'bridge'
    return true
  })

  const formatTime = (timestamp) => {
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 1000 / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-lg max-h-[80vh] bg-dark-800 rounded-3xl border border-dark-600 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-dark-700">
            <h3 className="text-lg font-semibold">Transaction History</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-dark-700 transition-colors"
            >
              <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Filters */}
          <div className="flex space-x-2 p-4 border-b border-dark-700 overflow-x-auto">
            {['all', 'swaps', 'liquidity', 'bridge'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  filter === f
                    ? 'bg-vibe-500/20 text-vibe-400'
                    : 'text-dark-400 hover:text-white hover:bg-dark-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Transaction List */}
          <div className="flex-1 overflow-y-auto">
            {!isConnected ? (
              <div className="p-8 text-center">
                <svg className="w-16 h-16 mx-auto text-dark-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-dark-400">Connect wallet to view history</p>
              </div>
            ) : filteredTxs.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-16 h-16 mx-auto text-dark-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-dark-400">No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y divide-dark-700/50">
                {filteredTxs.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} formatTime={formatTime} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {isConnected && filteredTxs.length > 0 && (
            <div className="p-4 border-t border-dark-700">
              <button className="w-full py-2 text-sm text-vibe-400 hover:text-vibe-300 transition-colors">
                View all on Explorer →
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function TransactionRow({ tx, formatTime }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'text-green-500'
      case 'pending': return 'text-yellow-500'
      case 'failed': return 'text-red-500'
      default: return 'text-dark-400'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )
      case 'pending':
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )
      case 'failed':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )
      default: return null
    }
  }

  return (
    <div className="p-4 hover:bg-dark-700/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          {/* Icon */}
          <div className={`p-2 rounded-xl ${
            tx.type === 'swap' ? 'bg-vibe-500/20' :
            tx.type === 'bridge' ? 'bg-blue-500/20' : 'bg-green-500/20'
          }`}>
            {tx.type === 'swap' && (
              <svg className="w-5 h-5 text-vibe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            )}
            {tx.type === 'bridge' && (
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            )}
            {(tx.type === 'addLiquidity' || tx.type === 'removeLiquidity') && (
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            )}
          </div>

          {/* Details */}
          <div>
            {tx.type === 'swap' && (
              <>
                <div className="font-medium">
                  {tx.tokenIn.amount} {tx.tokenIn.symbol} → {tx.tokenOut.amount} {tx.tokenOut.symbol}
                </div>
                <div className="text-sm text-dark-400 mt-0.5">
                  Swap • Batch #{tx.batchId}
                </div>
              </>
            )}
            {tx.type === 'bridge' && (
              <>
                <div className="font-medium">
                  {tx.token.amount} {tx.token.symbol}
                </div>
                <div className="text-sm text-dark-400 mt-0.5">
                  Bridge • {tx.fromChain} → {tx.toChain}
                </div>
              </>
            )}
            {tx.type === 'addLiquidity' && (
              <>
                <div className="font-medium">
                  {tx.token0.amount} {tx.token0.symbol} + {tx.token1.amount} {tx.token1.symbol}
                </div>
                <div className="text-sm text-dark-400 mt-0.5">
                  Add Liquidity • {tx.lpTokens} LP
                </div>
              </>
            )}
            {tx.type === 'removeLiquidity' && (
              <>
                <div className="font-medium">
                  {tx.token0.amount} {tx.token0.symbol} + {tx.token1.amount} {tx.token1.symbol}
                </div>
                <div className="text-sm text-dark-400 mt-0.5">
                  Remove Liquidity • {tx.lpTokens} LP
                </div>
              </>
            )}
          </div>
        </div>

        {/* Status & Time */}
        <div className="text-right">
          <div className={`flex items-center space-x-1 ${getStatusColor(tx.status)}`}>
            {getStatusIcon(tx.status)}
            <span className="text-sm capitalize">{tx.status}</span>
          </div>
          <div className="text-xs text-dark-500 mt-0.5">
            {formatTime(tx.timestamp)}
          </div>
          {tx.status === 'pending' && tx.phase && (
            <div className="text-xs text-yellow-500/70 mt-0.5">
              {tx.phase} phase
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionHistory
