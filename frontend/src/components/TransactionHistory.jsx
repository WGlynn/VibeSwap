import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useTransactions, TX_TYPE, TX_STATUS } from '../hooks/useTransactions'
import { TransactionRowSkeleton } from './ui/Skeleton'

function TransactionHistory({ isOpen, onClose }) {
  const { isConnected } = useWallet()
  const { transactions, clearAllTransactions, pendingCount } = useTransactions()
  const [filter, setFilter] = useState('all')
  const [isClearing, setIsClearing] = useState(false)

  const filteredTxs = useMemo(() => {
    if (!transactions) return []

    return transactions.filter(tx => {
      if (filter === 'all') return true
      if (filter === 'swaps') {
        return tx.type === TX_TYPE.SWAP_COMMIT ||
               tx.type === TX_TYPE.SWAP_REVEAL ||
               tx.type === TX_TYPE.SWAP_SETTLED
      }
      if (filter === 'liquidity') {
        return tx.type === TX_TYPE.ADD_LIQUIDITY ||
               tx.type === TX_TYPE.REMOVE_LIQUIDITY
      }
      if (filter === 'bridge') return tx.type === TX_TYPE.BRIDGE
      if (filter === 'pending') {
        return tx.status === TX_STATUS.PENDING ||
               tx.status === TX_STATUS.CONFIRMING
      }
      return true
    })
  }, [transactions, filter])

  const formatTime = (timestamp) => {
    const diff = Date.now() - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    if (seconds > 10) return `${seconds}s ago`
    return 'Just now'
  }

  const handleClear = async () => {
    setIsClearing(true)
    await clearAllTransactions()
    setIsClearing(false)
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
          className="relative w-full max-w-lg max-h-[80vh] bg-void-800 rounded-3xl border border-void-600 shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-void-700">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold">Transaction History</h3>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400">
                  {pendingCount} pending
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-void-700 transition-colors"
            >
              <svg className="w-5 h-5 text-void-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center justify-between p-4 border-b border-void-700">
            <div className="flex space-x-2 overflow-x-auto">
              {[
                { key: 'all', label: 'All' },
                { key: 'pending', label: 'Pending', count: pendingCount },
                { key: 'swaps', label: 'Swaps' },
                { key: 'liquidity', label: 'Liquidity' },
                { key: 'bridge', label: 'Bridge' },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center space-x-1 ${
                    filter === f.key
                      ? 'bg-vibe-500/20 text-vibe-400'
                      : 'text-void-400 hover:text-white hover:bg-void-700'
                  }`}
                >
                  <span>{f.label}</span>
                  {f.count > 0 && (
                    <span className="text-xs bg-void-600 px-1.5 rounded-full">{f.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Transaction List */}
          <div className="flex-1 overflow-y-auto">
            {!isConnected ? (
              <div className="p-8 text-center">
                <svg className="w-16 h-16 mx-auto text-void-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-void-400">Connect wallet to view history</p>
              </div>
            ) : filteredTxs.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-16 h-16 mx-auto text-void-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-void-400">
                  {filter === 'all' ? 'No transactions yet' : `No ${filter} transactions`}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-void-700/50">
                <AnimatePresence initial={false}>
                  {filteredTxs.map((tx) => (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <TransactionRow tx={tx} formatTime={formatTime} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Footer */}
          {isConnected && transactions.length > 0 && (
            <div className="p-4 border-t border-void-700 flex items-center justify-between">
              <button
                onClick={handleClear}
                disabled={isClearing}
                className="text-sm text-void-400 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {isClearing ? 'Clearing...' : 'Clear History'}
              </button>
              <span className="text-xs text-void-500">
                {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function TransactionRow({ tx, formatTime }) {
  const getStatusConfig = (status) => {
    switch (status) {
      case TX_STATUS.COMPLETED:
        return {
          color: 'text-glow-500',
          bg: 'bg-glow-500/20',
          icon: (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ),
        }
      case TX_STATUS.PENDING:
      case TX_STATUS.CONFIRMING:
        return {
          color: 'text-yellow-400',
          bg: 'bg-yellow-500/20',
          icon: (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ),
        }
      case TX_STATUS.FAILED:
        return {
          color: 'text-red-400',
          bg: 'bg-red-500/20',
          icon: (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ),
        }
      default:
        return { color: 'text-void-400', bg: 'bg-void-600/20', icon: null }
    }
  }

  const getTypeConfig = (type) => {
    switch (type) {
      case TX_TYPE.SWAP_COMMIT:
      case TX_TYPE.SWAP_REVEAL:
      case TX_TYPE.SWAP_SETTLED:
        return {
          color: 'text-vibe-400',
          bg: 'bg-vibe-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          ),
          label: 'Swap',
        }
      case TX_TYPE.ADD_LIQUIDITY:
        return {
          color: 'text-glow-500',
          bg: 'bg-glow-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          ),
          label: 'Add Liquidity',
        }
      case TX_TYPE.REMOVE_LIQUIDITY:
        return {
          color: 'text-red-400',
          bg: 'bg-red-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          ),
          label: 'Remove Liquidity',
        }
      case TX_TYPE.BRIDGE:
        return {
          color: 'text-cyber-400',
          bg: 'bg-cyber-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          ),
          label: 'Bridge',
        }
      default:
        return {
          color: 'text-void-400',
          bg: 'bg-void-600/20',
          icon: null,
          label: 'Transaction',
        }
    }
  }

  const statusConfig = getStatusConfig(tx.status)
  const typeConfig = getTypeConfig(tx.type)

  const getSubtitle = () => {
    if (tx.type === TX_TYPE.SWAP_COMMIT || tx.type === TX_TYPE.SWAP_REVEAL || tx.type === TX_TYPE.SWAP_SETTLED) {
      if (tx.batchId) return `Batch #${tx.batchId}`
      return 'Processing...'
    }
    if (tx.type === TX_TYPE.BRIDGE) {
      return `${tx.fromChain} → ${tx.toChain}`
    }
    if (tx.pool) return tx.pool
    return null
  }

  const getMainContent = () => {
    // Swap transactions
    if (tx.type === TX_TYPE.SWAP_COMMIT || tx.type === TX_TYPE.SWAP_REVEAL || tx.type === TX_TYPE.SWAP_SETTLED) {
      const tokenIn = tx.tokenIn || {}
      const tokenOut = tx.tokenOut || {}
      return (
        <>
          <span>{tx.amountIn} {tokenIn.symbol || 'Token'}</span>
          <span className="text-void-500 mx-1">→</span>
          <span>
            {tx.status === TX_STATUS.COMPLETED && tx.amountOut
              ? tx.amountOut
              : tx.amountOutExpected || '~'
            } {tokenOut.symbol || 'Token'}
          </span>
        </>
      )
    }

    // Liquidity transactions
    if (tx.type === TX_TYPE.ADD_LIQUIDITY || tx.type === TX_TYPE.REMOVE_LIQUIDITY) {
      const token0 = tx.token0 || {}
      const token1 = tx.token1 || {}
      return (
        <>
          <span>{tx.amount0} {token0.symbol || 'Token0'}</span>
          <span className="text-void-500 mx-1">+</span>
          <span>{tx.amount1} {token1.symbol || 'Token1'}</span>
        </>
      )
    }

    // Bridge transactions
    if (tx.type === TX_TYPE.BRIDGE) {
      const token = tx.token || {}
      return <span>{tx.amount} {token.symbol || 'Token'}</span>
    }

    return null
  }

  return (
    <div className="p-4 hover:bg-void-700/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          {/* Icon */}
          <div className={`p-2 rounded-xl ${typeConfig.bg}`}>
            <span className={typeConfig.color}>{typeConfig.icon}</span>
          </div>

          {/* Details */}
          <div>
            <div className="font-medium flex items-center flex-wrap gap-x-1">
              {getMainContent()}
            </div>
            <div className="text-sm text-void-400 mt-0.5 flex items-center space-x-2">
              <span>{typeConfig.label}</span>
              {getSubtitle() && (
                <>
                  <span className="text-void-600">•</span>
                  <span>{getSubtitle()}</span>
                </>
              )}
            </div>

            {/* MEV savings for completed swaps */}
            {tx.type === TX_TYPE.SWAP_SETTLED && tx.status === TX_STATUS.COMPLETED && tx.mevSaved && (
              <div className="mt-1 inline-flex items-center space-x-1 text-xs text-glow-500 bg-glow-500/10 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>${tx.mevSaved} MEV saved</span>
              </div>
            )}
          </div>
        </div>

        {/* Status & Time */}
        <div className="text-right flex-shrink-0 ml-3">
          <div className={`flex items-center space-x-1 ${statusConfig.color}`}>
            {statusConfig.icon}
            <span className="text-sm capitalize">{tx.status}</span>
          </div>
          <div className="text-xs text-void-500 mt-0.5">
            {formatTime(tx.timestamp)}
          </div>

          {/* Phase indicator for pending swaps */}
          {(tx.type === TX_TYPE.SWAP_COMMIT || tx.type === TX_TYPE.SWAP_REVEAL) &&
           tx.status !== TX_STATUS.COMPLETED && (
            <div className="text-xs text-yellow-500/70 mt-0.5">
              {tx.type === TX_TYPE.SWAP_COMMIT ? 'committed' : 'revealed'}
            </div>
          )}

          {/* Hash link */}
          {tx.hash && (
            <a
              href={`https://etherscan.io/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-void-500 hover:text-vibe-400 mt-1 inline-block"
              onClick={(e) => e.stopPropagation()}
            >
              View tx ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionHistory
