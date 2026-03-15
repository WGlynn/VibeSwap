import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG (Mulberry32) ============
function mulberry32(seed) {
  let s = seed | 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============ Chain & Token Definitions ============
const CHAINS = [
  { id: 1, name: 'Ethereum', logo: '\u27E0', hex: '#627EEA' },
  { id: 42161, name: 'Arbitrum', logo: '\u25C8', hex: '#28A0F0' },
  { id: 8453, name: 'Base', logo: '\u2B21', hex: '#0052FF' },
  { id: 10, name: 'Optimism', logo: '\u2295', hex: '#FF0420' },
  { id: 137, name: 'Polygon', logo: '\u2B20', hex: '#8247E5' },
]
const TOKENS = ['ETH', 'USDC', 'USDT', 'WBTC']
const TOKEN_DEC = { ETH: 4, USDC: 2, USDT: 2, WBTC: 6 }

const STATUS_STYLES = {
  confirmed: { label: 'Confirmed', dot: 'bg-green-400', badge: 'bg-green-500/10 text-green-400 border-green-500/20' },
  pending: { label: 'Pending', dot: 'bg-yellow-400 animate-pulse', badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  failed: { label: 'Failed', dot: 'bg-red-400', badge: 'bg-red-500/10 text-red-400 border-red-500/20' },
}

const CHAIN_PAIRS = CHAINS.flatMap(src =>
  CHAINS.filter(dst => dst.id !== src.id).map(dst => ({ label: `${src.name} \u2192 ${dst.name}`, srcId: src.id, dstId: dst.id }))
)

// ============ Generate 15 Mock Transactions ============
function generateMockTransactions() {
  const rng = mulberry32(1313)
  const now = Date.now()
  const txs = []
  for (let i = 0; i < 15; i++) {
    const srcIdx = Math.floor(rng() * CHAINS.length)
    let dstIdx = Math.floor(rng() * (CHAINS.length - 1))
    if (dstIdx >= srcIdx) dstIdx += 1
    const src = CHAINS[srcIdx], dst = CHAINS[dstIdx]
    const token = TOKENS[Math.floor(rng() * TOKENS.length)]
    const statusRoll = rng()
    const status = statusRoll < 0.65 ? 'confirmed' : statusRoll < 0.85 ? 'pending' : 'failed'
    const baseAmount = token === 'ETH' ? 0.01 + rng() * 25
      : token === 'WBTC' ? 0.001 + rng() * 2 : 100 + rng() * 50000
    const amount = baseAmount.toFixed(TOKEN_DEC[token])
    const ageMs = Math.floor(rng() * 7 * 24 * 3600 * 1000)
    const bridgeTimeSec = status === 'failed' ? 0 : 60 + Math.floor(rng() * 600)
    const etaSec = status === 'pending' ? Math.floor(30 + rng() * 300) : 0
    const lzFee = (0.0002 + rng() * 0.0015).toFixed(4)
    const hexBytes = (n) => Array.from({ length: n }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join('')
    txs.push({
      id: i + 1, srcChain: src, dstChain: dst, token, amount, status,
      timestamp: now - ageMs, bridgeTimeSec, etaSec, lzFee,
      txHash: '0x' + hexBytes(32), lzMessageId: '0x' + hexBytes(16),
    })
  }
  return txs.sort((a, b) => b.timestamp - a.timestamp)
}
const MOCK_TXS = generateMockTransactions()

// ============ Helpers ============
function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'Just now'
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}
function fmtTime(s) {
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function truncHash(h) { return h ? `${h.slice(0, 6)}...${h.slice(-4)}` : '---' }
function fmtUsd(n) { return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}` }

// ============ Animation Variants ============
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 * PHI, delayChildren: 0.1 } },
}
const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease } } }

// ============ Sub-components ============
function ChainDot({ chain, size = 20 }) {
  return (
    <div className="flex items-center justify-center rounded-full font-bold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: chain.hex + '22', color: chain.hex, fontSize: size * 0.55 }}>
      {chain.logo}
    </div>
  )
}

function StatBox({ label, value, sub }) {
  return (
    <div className="text-center p-3">
      <div className="text-xs text-black-400 mb-1">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {sub && <div className="text-[10px] text-black-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function ChainPathVisualization({ src, dst }) {
  return (
    <div className="flex items-center gap-1.5">
      <ChainDot chain={src} size={18} />
      <div className="flex items-center gap-0.5">
        <div className="w-3 h-[2px] rounded-full" style={{ backgroundColor: src.hex + '60' }} />
        <motion.div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CYAN }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: PHI, ease: 'easeInOut' }} />
        <div className="w-3 h-[2px] rounded-full" style={{ backgroundColor: dst.hex + '60' }} />
      </div>
      <ChainDot chain={dst} size={18} />
    </div>
  )
}

function ChainPathExpanded({ src, dst, status }) {
  const isPending = status === 'pending'
  return (
    <div className="flex items-center justify-between py-3 px-2">
      <div className="flex flex-col items-center">
        <ChainDot chain={src} size={28} />
        <span className="text-[10px] text-black-400 mt-1">{src.name}</span>
        <span className="text-[9px] text-black-500">Source</span>
      </div>
      <div className="flex-1 mx-3 flex items-center">
        <div className="h-[2px] flex-1 rounded-full" style={{ backgroundColor: src.hex + '40' }} />
        <div className="mx-2 flex flex-col items-center">
          <motion.div className="w-8 h-8 rounded-lg flex items-center justify-center border"
            style={{ backgroundColor: CYAN + '15', borderColor: CYAN + '30', color: CYAN }}
            animate={isPending ? { boxShadow: [`0 0 8px ${CYAN}33`, `0 0 16px ${CYAN}55`, `0 0 8px ${CYAN}33`] } : {}}
            transition={{ repeat: Infinity, duration: PHI }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </motion.div>
          <span className="text-[9px] mt-1" style={{ color: CYAN }}>LayerZero</span>
        </div>
        <div className="h-[2px] flex-1 rounded-full" style={{ backgroundColor: dst.hex + '40' }} />
      </div>
      <div className="flex flex-col items-center">
        <ChainDot chain={dst} size={28} />
        <span className="text-[10px] text-black-400 mt-1">{dst.name}</span>
        <span className="text-[9px] text-black-500">Destination</span>
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${active
        ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
        : 'bg-black-800/60 border-black-700/50 text-black-400 hover:text-black-200 hover:border-black-600'}`}>
      {label}
    </button>
  )
}

const CopyIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
)

function DetailCell({ label, value, copyValue }) {
  return (
    <div className="p-2.5 rounded-lg bg-black-900/50">
      <div className="text-[10px] text-black-500 mb-0.5">{label}</div>
      <div className="text-xs font-mono text-black-300 flex items-center gap-1.5">
        <span className="truncate">{value}</span>
        {copyValue && (
          <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(copyValue) }}
            className="text-black-500 hover:text-black-200 transition-colors flex-shrink-0" title={`Copy ${label}`}>
            <CopyIcon />
          </button>
        )}
      </div>
    </div>
  )
}

function TransactionRow({ tx, expanded, onToggle }) {
  const sty = STATUS_STYLES[tx.status]
  const isExpanded = expanded === tx.id
  return (
    <motion.div variants={fadeUp} layout className="mb-2">
      <GlassCard className="overflow-hidden">
        <button onClick={onToggle} className="w-full p-3 sm:p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ChainPathVisualization src={tx.srcChain} dst={tx.dstChain} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{tx.amount} {tx.token}</div>
                <div className="text-[11px] text-black-400 truncate">{tx.srcChain.name} &rarr; {tx.dstChain.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right hidden sm:block">
                <div className="text-xs text-black-400">{fmtAge(tx.timestamp)}</div>
                <div className="text-[10px] text-black-500">{fmtDate(tx.timestamp)}</div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${sty.badge}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${sty.dot}`} />{sty.label}
              </span>
              <motion.svg className="w-4 h-4 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </motion.svg>
            </div>
          </div>
          <div className="sm:hidden mt-1 text-[11px] text-black-500">{fmtAge(tx.timestamp)} &middot; {fmtDate(tx.timestamp)}</div>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <div className="px-3 sm:px-4 pb-4 border-t border-black-700/50">
                <ChainPathExpanded src={tx.srcChain} dst={tx.dstChain} status={tx.status} />
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <DetailCell label="Tx Hash" value={truncHash(tx.txHash)} copyValue={tx.txHash} />
                  <DetailCell label="LZ Message ID" value={truncHash(tx.lzMessageId)} copyValue={tx.lzMessageId} />
                  <DetailCell label="Bridge Time" value={tx.status === 'failed' ? '---' : fmtTime(tx.bridgeTimeSec)} />
                  <DetailCell label="Bridge Fee" value={`${tx.lzFee} ETH`} />
                </div>

                {tx.status === 'pending' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 p-3 rounded-lg border"
                    style={{ backgroundColor: CYAN + '08', borderColor: CYAN + '20' }}>
                    <div className="flex items-center gap-2">
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: PHI, ease: 'linear' }}>
                        <svg className="w-4 h-4" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </motion.div>
                      <div>
                        <div className="text-xs font-medium" style={{ color: CYAN }}>Estimated completion: ~{fmtTime(tx.etaSec)}</div>
                        <div className="text-[10px] text-black-500">LayerZero message in transit</div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-black-800 overflow-hidden">
                      <motion.div className="h-full rounded-full" style={{ backgroundColor: CYAN }}
                        initial={{ width: '20%' }} animate={{ width: '75%' }}
                        transition={{ duration: tx.etaSec * 0.01, ease: 'linear' }} />
                    </div>
                  </motion.div>
                )}

                {tx.status === 'failed' && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <div className="flex items-center gap-2 text-xs text-red-400">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Transaction reverted on destination chain. Gas refunded to source.</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
function BridgeHistoryPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expandedTx, setExpandedTx] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [chainPairFilter, setChainPairFilter] = useState(null)
  const [dateRange, setDateRange] = useState('all')
  const [showFilters, setShowFilters] = useState(false)

  // ============ Data — real when connected, mock for demo ============
  const txs = useMemo(() => isConnected ? [] : MOCK_TXS, [isConnected])

  // ============ Computed Stats ============
  const stats = useMemo(() => {
    const confirmed = txs.filter(t => t.status === 'confirmed')
    const totalVolume = txs.reduce((acc, tx) => {
      const price = tx.token === 'ETH' ? 3500 : tx.token === 'WBTC' ? 65000 : 1
      return acc + parseFloat(tx.amount) * price
    }, 0)
    const avgTime = confirmed.length > 0
      ? Math.round(confirmed.reduce((a, t) => a + t.bridgeTimeSec, 0) / confirmed.length) : 0
    const successRate = txs.length > 0 ? ((confirmed.length / txs.length) * 100).toFixed(1) : '0.0'
    const totalFees = txs.reduce((a, t) => a + parseFloat(t.lzFee), 0)
    return { totalVolume, txCount: txs.length, avgTime, successRate, totalFees: totalFees.toFixed(4) }
  }, [txs])

  // ============ Filtered Transactions ============
  const filteredTxs = useMemo(() => {
    let list = [...txs]
    if (statusFilter !== 'all') list = list.filter(t => t.status === statusFilter)
    if (chainPairFilter) list = list.filter(t => t.srcChain.id === chainPairFilter.srcId && t.dstChain.id === chainPairFilter.dstId)
    if (dateRange !== 'all') {
      const cutoffs = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
      if (cutoffs[dateRange]) list = list.filter(t => Date.now() - t.timestamp <= cutoffs[dateRange])
    }
    return list
  }, [statusFilter, chainPairFilter, dateRange])

  const pendingTxs = txs.filter(t => t.status === 'pending')

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20">
      <PageHero title="Bridge History" subtitle="Track your cross-chain transfers powered by LayerZero V2"
        category="protocol" badge={pendingTxs.length > 0 ? `${pendingTxs.length} Pending` : undefined} badgeColor={CYAN} />

      {/* ============ Stats Row ============ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1, ease }}>
        <GlassCard className="mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-black-700/50">
            <StatBox label="Total Bridged Volume" value={fmtUsd(stats.totalVolume)} sub={`${stats.txCount} transactions`} />
            <StatBox label="Transactions" value={stats.txCount} sub="all chains" />
            <StatBox label="Average Time" value={fmtTime(stats.avgTime)} sub="confirmed txs" />
            <StatBox label="Success Rate" value={`${stats.successRate}%`}
              sub={`${txs.filter(t => t.status === 'confirmed').length} confirmed`} />
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Pending Transactions ============ */}
      {pendingTxs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease }} className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: PHI * 2, ease: 'linear' }}>
              <svg className="w-4 h-4" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </motion.div>
            <h2 className="text-sm font-semibold text-white">Pending Transfers</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: CYAN + '15', color: CYAN }}>{pendingTxs.length}</span>
          </div>
          <div className="space-y-2">
            {pendingTxs.map(tx => (
              <GlassCard key={tx.id} glowColor="terminal">
                <div className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChainPathVisualization src={tx.srcChain} dst={tx.dstChain} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white">{tx.amount} {tx.token}</div>
                        <div className="text-[11px] text-black-400">{tx.srcChain.name} &rarr; {tx.dstChain.name}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-medium" style={{ color: CYAN }}>~{fmtTime(tx.etaSec)} remaining</div>
                      <div className="text-[10px] text-black-500">{fmtAge(tx.timestamp)}</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1 rounded-full bg-black-800 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ backgroundColor: CYAN }}
                      initial={{ width: '30%' }} animate={{ width: '70%' }}
                      transition={{ duration: tx.etaSec * 0.02, ease: 'linear' }} />
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </motion.div>
      )}

      {/* ============ Bridge Fee Summary ============ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease }} className="mb-6">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="text-sm font-semibold text-white">Bridge Fee Summary</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-black-900/50">
              <div className="text-[10px] text-black-500 mb-1">Total LZ Gas Paid</div>
              <div className="text-sm font-mono font-medium text-white">{stats.totalFees} ETH</div>
              <div className="text-[10px] text-black-500 mt-0.5">~{fmtUsd(parseFloat(stats.totalFees) * 3500)}</div>
            </div>
            <div className="p-3 rounded-xl bg-black-900/50">
              <div className="text-[10px] text-black-500 mb-1">Protocol Fees</div>
              <div className="text-sm font-medium text-green-400">0.00 ETH</div>
              <div className="text-[10px] text-green-500/70 mt-0.5">Always free</div>
            </div>
            <div className="p-3 rounded-xl bg-black-900/50">
              <div className="text-[10px] text-black-500 mb-1">Avg Fee / Tx</div>
              <div className="text-sm font-mono font-medium text-white">{(parseFloat(stats.totalFees) / stats.txCount).toFixed(4)} ETH</div>
              <div className="text-[10px] text-black-500 mt-0.5">LayerZero gas only</div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Filters ============ */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25, ease }} className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">
            All Transactions <span className="ml-2 text-xs text-black-500 font-normal">({filteredTxs.length})</span>
          </h2>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${showFilters
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
              : 'bg-black-800/60 border-black-700/50 text-black-400 hover:text-black-200'}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <GlassCard className="p-4 mb-4">
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Status</div>
                    <div className="flex flex-wrap gap-2">
                      {['all', 'confirmed', 'pending', 'failed'].map(s => (
                        <FilterChip key={s} label={s === 'all' ? 'All' : STATUS_STYLES[s].label}
                          active={statusFilter === s} onClick={() => setStatusFilter(s)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Date Range</div>
                    <div className="flex flex-wrap gap-2">
                      {[{ key: 'all', label: 'All Time' }, { key: '24h', label: '24 Hours' },
                        { key: '7d', label: '7 Days' }, { key: '30d', label: '30 Days' }].map(r => (
                        <FilterChip key={r.key} label={r.label} active={dateRange === r.key} onClick={() => setDateRange(r.key)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Chain Pair</div>
                    <div className="flex flex-wrap gap-2">
                      <FilterChip label="All Pairs" active={chainPairFilter === null} onClick={() => setChainPairFilter(null)} />
                      {CHAIN_PAIRS.slice(0, 8).map(cp => (
                        <FilterChip key={cp.label} label={cp.label}
                          active={chainPairFilter?.srcId === cp.srcId && chainPairFilter?.dstId === cp.dstId}
                          onClick={() => setChainPairFilter(
                            chainPairFilter?.srcId === cp.srcId && chainPairFilter?.dstId === cp.dstId ? null : cp
                          )} />
                      ))}
                    </div>
                  </div>
                  {(statusFilter !== 'all' || chainPairFilter || dateRange !== 'all') && (
                    <button onClick={() => { setStatusFilter('all'); setChainPairFilter(null); setDateRange('all') }}
                      className="text-xs text-black-400 hover:text-black-200 transition-colors underline">
                      Clear all filters
                    </button>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ============ Transaction List ============ */}
      {filteredTxs.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
          <GlassCard className="p-8">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto text-black-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-black-400 text-sm">No transactions match your filters</p>
              <p className="text-black-500 text-xs mt-1">Try adjusting the filters above</p>
            </div>
          </GlassCard>
        </motion.div>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible">
          {filteredTxs.map((tx, i) => (
            <TransactionRow key={tx.id} tx={tx} expanded={expandedTx}
              onToggle={() => setExpandedTx(expandedTx === tx.id ? null : tx.id)} />
          ))}
        </motion.div>
      )}

      {/* ============ Footer ============ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-8 text-center">
        <div className="flex items-center justify-center gap-2 text-xs text-black-500">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" style={{ color: CYAN + '80' }}>
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>All bridge transactions are secured by LayerZero V2</span>
        </div>
        <div className="text-[10px] text-black-600 mt-1">0% protocol fees &middot; Immutable burn-and-mint transfers</div>
      </motion.div>
    </div>
  )
}

export default BridgeHistoryPage
