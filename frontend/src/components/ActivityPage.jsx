import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

/**
 * ActivityPage — Polished transaction history with date grouping,
 * filter tabs, stat overview, and CSV export placeholder.
 * Uses seeded PRNG for deterministic mock data across renders.
 *
 * @version 2.0.0
 */

// ============ Constants ============

const PHI = 1.618033988749895
const STAGGER_STEP = 1 / (PHI * PHI * PHI * PHI)  // ~0.146s
const FADE_DURATION = 1 / (PHI * PHI)               // ~0.382s

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'swap', label: 'Swaps' },
  { id: 'bridge', label: 'Bridges' },
  { id: 'lp', label: 'LP' },
  { id: 'governance', label: 'Governance' },
  { id: 'reward', label: 'Rewards' },
]

const CHAINS = ['Ethereum', 'Arbitrum', 'Base', 'Optimism']
const EXPLORERS = {
  Ethereum: 'https://etherscan.io/tx/',
  Arbitrum: 'https://arbiscan.io/tx/',
  Base: 'https://basescan.org/tx/',
  Optimism: 'https://optimistic.etherscan.io/tx/',
}

const STATUS_OPTIONS = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'pending', 'failed']

const TOKEN_PAIRS = {
  swap: [
    { from: 'ETH', to: 'USDC', fromAmt: 1.25, toAmt: 3112.50, usd: 3112.50 },
    { from: 'USDC', to: 'ARB', fromAmt: 500.00, toAmt: 412.30, usd: 500.00 },
    { from: 'WBTC', to: 'ETH', fromAmt: 0.085, toAmt: 2.34, usd: 5832.00 },
    { from: 'ETH', to: 'OP', fromAmt: 0.75, toAmt: 615.20, usd: 1868.25 },
    { from: 'ARB', to: 'USDC', fromAmt: 200.00, toAmt: 242.80, usd: 242.80 },
  ],
  bridge: [
    { from: 'ETH', to: 'ETH', fromAmt: 2.00, toAmt: 2.00, usd: 4980.00 },
    { from: 'USDC', to: 'USDC', fromAmt: 1000.00, toAmt: 1000.00, usd: 1000.00 },
  ],
  lp: [
    { from: 'ETH', to: 'USDC', fromAmt: 1.50, toAmt: 3735.00, usd: 7470.00 },
    { from: 'WBTC', to: 'ETH', fromAmt: 0.10, toAmt: 2.75, usd: 13720.00 },
  ],
  governance: [
    { from: 'VIBE', to: null, fromAmt: 5000, toAmt: null, usd: 0 },
    { from: 'VIBE', to: null, fromAmt: 12000, toAmt: null, usd: 0 },
  ],
  reward: [
    { from: null, to: 'VIBE', fromAmt: null, toAmt: 245.80, usd: 245.80 },
    { from: null, to: 'USDC', fromAmt: null, toAmt: 18.42, usd: 18.42 },
  ],
}

const ACTION_LABELS = {
  swap: 'Swap',
  bridge: 'Bridge',
  lp: 'Add Liquidity',
  governance: 'Vote',
  reward: 'Claim Reward',
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Mock Transaction Generator ============

function generateMockTransactions() {
  const rng = seededRandom(314159)
  const now = Date.now()
  const types = ['swap', 'swap', 'swap', 'swap', 'swap', 'bridge', 'bridge', 'lp', 'lp', 'governance', 'reward']
  const txs = []

  // Time offsets in ms to distribute across Today, Yesterday, This Week, Earlier
  const timeOffsets = [
    1000 * 60 * 8,              // 8 min ago — Today
    1000 * 60 * 45,             // 45 min ago — Today
    1000 * 60 * 60 * 3,        // 3 hours ago — Today
    1000 * 60 * 60 * 7,        // 7 hours ago — Today
    1000 * 60 * 60 * 26,       // ~1 day ago — Yesterday
    1000 * 60 * 60 * 30,       // ~1.25 days ago — Yesterday
    1000 * 60 * 60 * 38,       // ~1.6 days ago — Yesterday
    1000 * 60 * 60 * 72,       // 3 days ago — This Week
    1000 * 60 * 60 * 96,       // 4 days ago — This Week
    1000 * 60 * 60 * 120,      // 5 days ago — This Week
    1000 * 60 * 60 * 148,      // ~6 days ago — This Week
    1000 * 60 * 60 * 24 * 9,   // 9 days ago — Earlier
    1000 * 60 * 60 * 24 * 14,  // 14 days ago — Earlier
    1000 * 60 * 60 * 24 * 21,  // 21 days ago — Earlier
    1000 * 60 * 60 * 24 * 30,  // 30 days ago — Earlier
  ]

  for (let i = 0; i < 15; i++) {
    const type = types[Math.floor(rng() * types.length)]
    const pairs = TOKEN_PAIRS[type]
    const pair = pairs[Math.floor(rng() * pairs.length)]
    const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
    const status = STATUS_OPTIONS[Math.floor(rng() * STATUS_OPTIONS.length)]
    const batchNum = type === 'swap' ? 18400 + Math.floor(rng() * 600) : null
    const hash = '0x' + Array.from({ length: 64 }, () =>
      '0123456789abcdef'[Math.floor(rng() * 16)]
    ).join('')

    txs.push({
      id: `tx-${String(i + 1).padStart(3, '0')}`,
      type,
      hash,
      shortHash: hash.slice(0, 6) + '...' + hash.slice(-4),
      from: pair.from,
      to: pair.to,
      fromAmount: pair.fromAmt,
      toAmount: pair.toAmt,
      usd: pair.usd * (0.85 + rng() * 0.3),
      status,
      timestamp: now - timeOffsets[i],
      chain,
      batchNumber: batchNum,
      explorerUrl: EXPLORERS[chain] + hash,
    })
  }

  return txs
}

// ============ Helpers ============

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function getDateGroup(timestamp) {
  const now = new Date()
  const date = new Date(timestamp)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart = todayStart - 6 * 86400000

  if (timestamp >= todayStart) return 'Today'
  if (timestamp >= yesterdayStart) return 'Yesterday'
  if (timestamp >= weekStart) return 'This Week'
  return 'Earlier'
}

function formatUSD(value) {
  if (value >= 10000) return '$' + (value / 1000).toFixed(1) + 'k'
  if (value >= 1) return '$' + value.toFixed(2)
  return '$0.00'
}

// ============ Type Icons ============

function TypeIcon({ type }) {
  const configs = {
    swap: {
      bg: 'bg-green-500/10',
      color: 'text-green-400',
      path: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    },
    bridge: {
      bg: 'bg-cyan-500/10',
      color: 'text-cyan-400',
      path: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    },
    lp: {
      bg: 'bg-purple-500/10',
      color: 'text-purple-400',
      path: 'M12 6v6m0 0v6m0-6h6m-6 0H6',
    },
    governance: {
      bg: 'bg-amber-500/10',
      color: 'text-amber-400',
      path: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    },
    reward: {
      bg: 'bg-yellow-500/10',
      color: 'text-yellow-400',
      path: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  }
  const c = configs[type] || configs.swap

  return (
    <div className={`w-10 h-10 rounded-full ${c.bg} flex items-center justify-center flex-shrink-0`}>
      <svg className={`w-5 h-5 ${c.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={c.path} />
      </svg>
    </div>
  )
}

// ============ Status Badge ============

function StatusBadge({ status }) {
  const configs = {
    confirmed: { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400', label: 'Confirmed' },
    pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400 animate-pulse', label: 'Pending' },
    failed: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400', label: 'Failed' },
  }
  const c = configs[status] || configs.confirmed

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono rounded-full ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

// ============ Transaction Row ============

function TransactionRow({ tx, index }) {
  const description = useMemo(() => {
    switch (tx.type) {
      case 'swap':
        return `${tx.fromAmount} ${tx.from} → ${tx.toAmount?.toFixed(2)} ${tx.to}`
      case 'bridge':
        return `${tx.fromAmount} ${tx.from} → ${tx.chain}`
      case 'lp':
        return `${tx.fromAmount} ${tx.from} + ${tx.toAmount?.toFixed(2)} ${tx.to}`
      case 'governance':
        return `${tx.fromAmount?.toLocaleString()} ${tx.from} delegated`
      case 'reward':
        return `+${tx.toAmount?.toFixed(2)} ${tx.to} claimed`
      default:
        return ''
    }
  }, [tx])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * STAGGER_STEP, duration: FADE_DURATION, ease: [0.25, 0.1, 1 / PHI, 1] }}
    >
      <GlassCard className="p-3 sm:p-4">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Type Icon */}
          <TypeIcon type={tx.type} />

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-white">{ACTION_LABELS[tx.type]}</span>
              <StatusBadge status={tx.status} />
              {tx.batchNumber && (
                <span className="hidden sm:inline text-[10px] font-mono text-black-500 bg-black-800 px-1.5 py-0.5 rounded">
                  Batch #{tx.batchNumber}
                </span>
              )}
            </div>
            <p className="text-xs text-black-400 truncate">{description}</p>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-black-500">
              <span className="font-mono">{tx.chain}</span>
              <span className="w-0.5 h-0.5 rounded-full bg-black-600" />
              <span>{formatTimeAgo(tx.timestamp)}</span>
              {tx.batchNumber && (
                <span className="sm:hidden">
                  <span className="w-0.5 h-0.5 rounded-full bg-black-600 inline-block mx-1" />
                  Batch #{tx.batchNumber}
                </span>
              )}
            </div>
          </div>

          {/* Right Side: Value + Explorer Link */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="text-right">
              <div className="text-sm font-mono font-semibold text-white">
                {tx.usd > 0 ? formatUSD(tx.usd) : '--'}
              </div>
              <div className="text-[10px] font-mono text-black-500">
                {tx.shortHash}
              </div>
            </div>
            <a
              href={tx.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-black-700/60 transition-colors"
              title="View on Explorer"
            >
              <svg className="w-4 h-4 text-black-500 hover:text-black-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Empty State ============

function EmptyState({ filter, isConnected }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: FADE_DURATION }}
    >
      <GlassCard className="py-16 px-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-1">
          {isConnected ? 'No recent activity' : 'No transactions found'}
        </h3>
        <p className="text-sm text-black-500 max-w-xs mx-auto">
          {isConnected
            ? 'Your transaction history will appear here once you start trading.'
            : filter === 'all'
              ? 'Your transaction history will appear here once you start trading.'
              : `No ${filter} transactions yet. Try a different filter or start trading.`}
        </p>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

function ActivityPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeFilter, setActiveFilter] = useState('all')

  // Mock transactions for demo mode; real data (empty) when wallet connected
  const mockTransactions = useMemo(() => generateMockTransactions(), [])
  const allTransactions = isConnected ? [] : mockTransactions

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    if (activeFilter === 'all') return allTransactions
    return allTransactions.filter(tx => tx.type === activeFilter)
  }, [allTransactions, activeFilter])

  // Group by date
  const groupedTransactions = useMemo(() => {
    const groups = {}
    const order = ['Today', 'Yesterday', 'This Week', 'Earlier']
    for (const label of order) groups[label] = []
    for (const tx of filteredTransactions) {
      const group = getDateGroup(tx.timestamp)
      groups[group].push(tx)
    }
    return order.map(label => ({ label, txs: groups[label] })).filter(g => g.txs.length > 0)
  }, [filteredTransactions])

  // Compute stats from all transactions (not filtered)
  const stats = useMemo(() => {
    const confirmed = allTransactions.filter(t => t.status === 'confirmed')
    const swaps = confirmed.filter(t => t.type === 'swap')
    const totalVolume = confirmed.reduce((s, t) => s + (t.usd || 0), 0)
    const mevSaved = swaps.length * 12.40  // Avg MEV prevented per batch swap
    const uniqueDays = new Set(
      confirmed.map(t => new Date(t.timestamp).toDateString())
    ).size
    return {
      totalTrades: confirmed.length,
      volume: totalVolume,
      feesSaved: mevSaved,
      activeDays: uniqueDays,
    }
  }, [allTransactions])

  // CSV export — generates downloadable file from transaction history
  const handleExportCSV = () => {
    const header = 'Date,Type,From,To,Amount (USD),Status,Chain,Hash'
    const rows = allTransactions.map(tx =>
      [
        new Date(tx.timestamp).toISOString(),
        tx.type,
        tx.from || '',
        tx.to || '',
        tx.usd?.toFixed(2) || '0',
        tx.status,
        tx.chain,
        tx.hash,
      ].join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vibeswap-activity.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Running index for stagger across groups
  let globalIndex = 0

  return (
    <div className="min-h-screen">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="defi"
        title="Activity"
        subtitle="Your complete transaction history"
        badge="Live"
        badgeColor="#22c55e"
      >
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-black-800/60 border border-black-700/50 text-black-400 hover:text-white hover:border-black-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </PageHero>

      <div className="max-w-4xl mx-auto px-4 pb-12">
        {/* ============ Stat Cards ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: FADE_DURATION, delay: STAGGER_STEP, ease: [0.25, 0.1, 1 / PHI, 1] }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
        >
          <StatCard
            label="Total Trades"
            value={stats.totalTrades}
            prefix=""
            suffix=""
            decimals={0}
            sparkSeed={42}
            size="sm"
          />
          <StatCard
            label="Volume"
            value={stats.volume}
            prefix="$"
            suffix=""
            decimals={0}
            sparkSeed={137}
            size="sm"
          />
          <StatCard
            label="MEV Prevented"
            value={stats.feesSaved}
            prefix="$"
            suffix=""
            decimals={2}
            sparkSeed={256}
            size="sm"
          />
          <StatCard
            label="Active Days"
            value={stats.activeDays}
            prefix=""
            suffix=""
            decimals={0}
            sparkSeed={512}
            size="sm"
          />
        </motion.div>

        {/* ============ Filter Tabs ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: FADE_DURATION, delay: STAGGER_STEP * 2 }}
          className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide"
        >
          {FILTER_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                activeFilter === tab.id
                  ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                  : 'bg-black-800/60 text-black-500 border border-transparent hover:bg-black-800 hover:text-black-300'
              }`}
            >
              {tab.label}
              {activeFilter === tab.id && tab.id !== 'all' && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {filteredTransactions.length}
                </span>
              )}
            </button>
          ))}
        </motion.div>

        {/* ============ Transaction List ============ */}
        {filteredTransactions.length === 0 ? (
          <EmptyState filter={activeFilter} isConnected={isConnected} />
        ) : (
          <div className="space-y-6">
            {groupedTransactions.map(group => {
              const groupItems = group.txs.map((tx, i) => {
                const idx = globalIndex++
                return <TransactionRow key={tx.id} tx={tx} index={idx} />
              })

              return (
                <div key={group.label}>
                  {/* Date Group Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-black-500">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-black-800" />
                    <span className="text-[10px] font-mono text-black-600">
                      {group.txs.length} {group.txs.length === 1 ? 'tx' : 'txs'}
                    </span>
                  </div>

                  {/* Transaction Cards */}
                  <div className="space-y-2">
                    {groupItems}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ============ Footer Note ============ */}
        {filteredTransactions.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: globalIndex * STAGGER_STEP + 0.2, duration: FADE_DURATION }}
            className="mt-8 text-center"
          >
            <p className="text-[11px] font-mono text-black-600">
              Batch auctions eliminate MEV by design — no frontrunning, no sandwich attacks.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default ActivityPage
