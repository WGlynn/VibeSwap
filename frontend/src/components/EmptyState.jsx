import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

// Empty state for wallet not connected
export function WalletNotConnected({ onConnect, isConnecting }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-12 px-6"
    >
      <div className="w-16 h-16 mx-auto mb-6 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center">
        <svg className="w-8 h-8 text-black-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <circle cx="17" cy="14" r="2" />
        </svg>
      </div>
      <h3 className="text-lg font-bold mb-2">connect your wallet</h3>
      <p className="text-sm text-black-400 mb-6 max-w-xs mx-auto">
        connect a wallet to start trading with zero MEV extraction
      </p>
      <button
        onClick={onConnect}
        disabled={isConnecting}
        className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors disabled:opacity-50"
      >
        {isConnecting ? 'connecting...' : 'connect wallet'}
      </button>
      <div className="mt-8 flex items-center justify-center space-x-6 text-xs text-black-500">
        <div className="flex items-center space-x-1">
          <svg className="w-3 h-3 text-matrix-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L4 7v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V7l-8-5z" />
          </svg>
          <span>mev protected</span>
        </div>
        <div className="flex items-center space-x-1">
          <svg className="w-3 h-3 text-matrix-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span>batch auctions</span>
        </div>
        <div className="flex items-center space-x-1">
          <svg className="w-3 h-3 text-matrix-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
          </svg>
          <span>uniform price</span>
        </div>
      </div>
    </motion.div>
  )
}

// Empty state for no transactions
export function NoTransactions() {
  return (
    <div className="text-center py-8 px-4">
      <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center">
        <svg className="w-6 h-6 text-black-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <p className="text-sm text-black-400">no transactions yet</p>
      <p className="text-xs text-black-500 mt-1">your trade history will appear here</p>
    </div>
  )
}

// Empty state for no LP positions
export function NoPositions() {
  return (
    <div className="text-center py-8 px-4">
      <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center">
        <svg className="w-6 h-6 text-black-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l2 2" />
        </svg>
      </div>
      <p className="text-sm text-black-400">no positions</p>
      <Link to="/pool" className="text-xs text-matrix-500 hover:text-matrix-400 mt-1 inline-block">
        add liquidity →
      </Link>
    </div>
  )
}

// Empty state for no rewards
export function NoRewards() {
  return (
    <div className="text-center py-6 px-4">
      <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center">
        <svg className="w-5 h-5 text-black-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" />
        </svg>
      </div>
      <p className="text-xs text-black-400">no rewards yet</p>
    </div>
  )
}

export default {
  WalletNotConnected,
  NoTransactions,
  NoPositions,
  NoRewards,
}
