import { useState, useEffect } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'
import GlassCard from './ui/GlassCard'
import PulseIndicator from './ui/PulseIndicator'

/**
 * Activity/Transaction History Page
 * Shows transaction history from block explorers
 * Currently displays demo data for demonstration purposes
 *
 * @version 1.0.0
 */

// Demo transaction history for demonstration
const DEMO_TRANSACTIONS = [
  {
    id: 'tx-001',
    hash: '0x1234...abcd',
    fullHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    type: 'swap',
    from: 'ETH',
    to: 'USDC',
    fromAmount: '0.5',
    toAmount: '1,245.50',
    status: 'confirmed',
    timestamp: Date.now() - 1000 * 60 * 15, // 15 mins ago
    gasUsed: '0.002 ETH',
    blockNumber: 19234567,
    chain: 'Ethereum',
    explorerUrl: 'https://etherscan.io/tx/0x1234567890abcdef',
  },
  {
    id: 'tx-002',
    hash: '0x5678...efgh',
    fullHash: '0x567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234',
    type: 'swap',
    from: 'USDC',
    to: 'ARB',
    fromAmount: '500.00',
    toAmount: '312.45',
    status: 'confirmed',
    timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    gasUsed: '0.0008 ETH',
    blockNumber: 19234123,
    chain: 'Arbitrum',
    explorerUrl: 'https://arbiscan.io/tx/0x567890abcdef',
  },
  {
    id: 'tx-003',
    hash: '0x9abc...ijkl',
    fullHash: '0x9abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    type: 'receive',
    from: 'External',
    to: 'ETH',
    fromAmount: null,
    toAmount: '1.25',
    status: 'confirmed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    gasUsed: null,
    blockNumber: 19230000,
    chain: 'Ethereum',
    explorerUrl: 'https://etherscan.io/tx/0x9abcdef12345',
  },
  {
    id: 'tx-004',
    hash: '0xdef0...mnop',
    fullHash: '0xdef01234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    type: 'send',
    from: 'USDC',
    to: '0x742d...3abc',
    fromAmount: '100.00',
    toAmount: null,
    status: 'confirmed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
    gasUsed: '0.0005 ETH',
    blockNumber: 19220000,
    chain: 'Base',
    explorerUrl: 'https://basescan.org/tx/0xdef0123456',
  },
  {
    id: 'tx-005',
    hash: '0x1111...2222',
    fullHash: '0x11112222333344445555666677778888999900001111222233334444555566667777',
    type: 'swap',
    from: 'ETH',
    to: 'WBTC',
    fromAmount: '2.0',
    toAmount: '0.085',
    status: 'pending',
    timestamp: Date.now() - 1000 * 60 * 2, // 2 mins ago
    gasUsed: null,
    blockNumber: null,
    chain: 'Ethereum',
    explorerUrl: 'https://etherscan.io/tx/0x111122223333',
  },
]

// Chain explorer URLs
const EXPLORERS = {
  'Ethereum': 'https://etherscan.io',
  'Arbitrum': 'https://arbiscan.io',
  'Optimism': 'https://optimistic.etherscan.io',
  'Base': 'https://basescan.org',
  'Polygon': 'https://polygonscan.com',
}

const LIVE_FEED_ITEMS = [
  { user: '0x7a2d...f1c3', action: 'swapped', detail: '2.5 ETH for 6,230 USDC', chain: 'Ethereum', time: '2s ago' },
  { user: '0xb4e1...9a02', action: 'swapped', detail: '1,000 USDC for 625 ARB', chain: 'Arbitrum', time: '5s ago' },
  { user: '0xf392...c7d8', action: 'added liquidity', detail: '5 ETH + 12,500 USDC', chain: 'Base', time: '8s ago' },
  { user: '0x1d5c...e4b6', action: 'bridged', detail: '3,000 USDC to Optimism', chain: 'Ethereum', time: '12s ago' },
  { user: '0x93af...2d71', action: 'swapped', detail: '0.15 WBTC for 4.2 ETH', chain: 'Ethereum', time: '15s ago' },
  { user: '0xc8d4...5f09', action: 'removed liquidity', detail: '2.1 ETH + 5,250 USDC', chain: 'Arbitrum', time: '18s ago' },
]

function LiveActivityTicker() {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % LIVE_FEED_ITEMS.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const item = LIVE_FEED_ITEMS[currentIndex]

  return (
    <div className="mb-4 px-3 py-2 rounded-lg bg-black-800/80 border border-black-700 overflow-hidden">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex-shrink-0 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
          <span className="text-matrix-400 font-semibold">LIVE</span>
        </span>
        <span className="text-black-400 truncate">
          <span className="text-black-300 font-mono">{item.user}</span>
          {' '}{item.action}{' '}
          <span className="text-white">{item.detail}</span>
          {' on '}
          <span className="text-terminal-400">{item.chain}</span>
          {' \u00B7 '}
          <span className="text-black-500">{item.time}</span>
        </span>
      </div>
    </div>
  )
}

function ActivityPage() {
  const { isConnected: isExternalConnected, address: externalAddress } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()

  const isConnected = isExternalConnected || isDeviceConnected
  const address = externalAddress || deviceAddress

  const [transactions, setTransactions] = useState(DEMO_TRANSACTIONS)
  const [filter, setFilter] = useState('all') // all, swaps, sends, receives
  const [isLoading, setIsLoading] = useState(false)

  // Filter transactions
  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return true
    if (filter === 'swaps') return tx.type === 'swap'
    if (filter === 'sends') return tx.type === 'send'
    if (filter === 'receives') return tx.type === 'receive'
    return true
  })

  // Format relative time
  const formatTime = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)

    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  // Get status badge
  const getStatusBadge = (status) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 text-xs rounded-full bg-matrix-500/20 text-matrix-400">
            <PulseIndicator color="matrix" size="sm" active={false} />
            <span>Confirmed</span>
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
            <PulseIndicator color="warning" size="sm" />
            <span>Pending</span>
          </span>
        )
      case 'failed':
        return (
          <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
            Failed
          </span>
        )
      default:
        return null
    }
  }

  // Get transaction icon
  const getTypeIcon = (type) => {
    switch (type) {
      case 'swap':
        return (
          <div className="w-10 h-10 rounded-full bg-matrix-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-matrix-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>
        )
      case 'send':
        return (
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
          </div>
        )
      case 'receive':
        return (
          <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="w-10 h-10 rounded-full bg-black-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
    }
  }

  if (!isConnected) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Wallet Connected</h2>
          <p className="text-black-400">Connect your wallet to view transaction history</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Live Activity Feed Ticker */}
      <LiveActivityTicker />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1 text-5d">Activity</h1>
        <p className="text-black-400 text-sm">Your transaction history</p>
      </div>

      {/* Demo Notice */}
      <div className="mb-4 p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
        <div className="flex items-start space-x-2">
          <svg className="w-5 h-5 text-terminal-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm text-terminal-400">Demo Mode</p>
            <p className="text-xs text-black-400 mt-0.5">
              Showing sample transactions. Real transaction history from block explorers coming soon.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
        {[
          { id: 'all', label: 'All' },
          { id: 'swaps', label: 'Swaps' },
          { id: 'sends', label: 'Sent' },
          { id: 'receives', label: 'Received' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              filter === tab.id
                ? 'bg-matrix-500/20 text-matrix-400'
                : 'bg-black-800 text-black-400 hover:bg-black-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Transaction List */}
      <StaggerContainer className="space-y-3">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-black-400">No transactions found</p>
          </div>
        ) : (
          filteredTransactions.map(tx => (
            <StaggerItem key={tx.id}>
              <GlassCard className="p-3 sm:p-4 depth-card">
                {/* Desktop layout */}
                <div className="hidden sm:flex items-center space-x-4">
                  {getTypeIcon(tx.type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-white capitalize">{tx.type}</span>
                        {getStatusBadge(tx.status)}
                      </div>
                      <span className="text-sm text-black-400">{formatTime(tx.timestamp)}</span>
                    </div>

                    <div className="text-sm">
                      {tx.type === 'swap' ? (
                        <span className="text-black-300">
                          {tx.fromAmount} {tx.from} → {tx.toAmount} {tx.to}
                        </span>
                      ) : tx.type === 'send' ? (
                        <span className="text-black-300">
                          -{tx.fromAmount} {tx.from} to {tx.to}
                        </span>
                      ) : (
                        <span className="text-black-300">
                          +{tx.toAmount} {tx.to}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 mt-2 text-xs text-black-500">
                      <span>{tx.chain}</span>
                      {tx.gasUsed && <span>Gas: {tx.gasUsed}</span>}
                      {tx.blockNumber && <span>Block: {tx.blockNumber.toLocaleString()}</span>}
                    </div>
                  </div>

                  {/* Explorer Link */}
                  <a
                    href={tx.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg hover:bg-black-700 transition-colors"
                    title="View on Explorer"
                  >
                    <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                {/* Mobile card layout */}
                <div className="sm:hidden">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-3">
                      {getTypeIcon(tx.type)}
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-white capitalize">{tx.type}</span>
                          {getStatusBadge(tx.status)}
                        </div>
                        <span className="text-xs text-black-400">{formatTime(tx.timestamp)}</span>
                      </div>
                    </div>
                    <a
                      href={tx.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-black-700 transition-colors flex-shrink-0"
                      title="View on Explorer"
                    >
                      <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>

                  <div className="text-sm ml-[52px]">
                    {tx.type === 'swap' ? (
                      <span className="text-black-300">
                        {tx.fromAmount} {tx.from} → {tx.toAmount} {tx.to}
                      </span>
                    ) : tx.type === 'send' ? (
                      <span className="text-black-300">
                        -{tx.fromAmount} {tx.from} to {tx.to}
                      </span>
                    ) : (
                      <span className="text-black-300">
                        +{tx.toAmount} {tx.to}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 ml-[52px] text-xs text-black-500">
                    <span>{tx.chain}</span>
                    {tx.gasUsed && <span>Gas: {tx.gasUsed}</span>}
                    {tx.blockNumber && <span>Block: {tx.blockNumber.toLocaleString()}</span>}
                  </div>
                </div>
              </GlassCard>
            </StaggerItem>
          ))
        )}
      </StaggerContainer>

      {/* Load More (disabled for demo) */}
      {filteredTransactions.length > 0 && (
        <div className="mt-6 text-center">
          <button
            disabled
            className="px-6 py-2 rounded-lg bg-black-800 text-black-500 text-sm cursor-not-allowed"
          >
            Load More (Demo)
          </button>
        </div>
      )}
    </div>
  )
}

export default ActivityPage
