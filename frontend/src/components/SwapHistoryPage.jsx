import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

/**
 * SwapHistoryPage — Detailed swap/trade history with batch auction context,
 * MEV savings tracking, expandable details, monthly volume chart, and CSV export.
 * Uses seeded PRNG (seed 2121) for deterministic mock data.
 * @version 1.0.0
 */

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER = 1 / (PHI * PHI * PHI * PHI)
const FADE = 1 / (PHI * PHI)
const ease = [0.25, 0.1, 1 / PHI, 1]

const CHAINS = ['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Polygon']
const TOKEN_PRICES = { ETH: 3480, USDC: 1, USDT: 1, WBTC: 64200, ARB: 1.18, OP: 2.95, MATIC: 0.72, DAI: 1 }
const SWAP_PAIRS = [
  ['ETH', 'USDC'], ['ETH', 'USDT'], ['WBTC', 'ETH'], ['ETH', 'ARB'],
  ['USDC', 'ETH'], ['ARB', 'USDC'], ['OP', 'ETH'], ['ETH', 'OP'],
  ['USDC', 'DAI'], ['MATIC', 'USDC'], ['WBTC', 'USDC'], ['DAI', 'ETH'],
]
const EXPLORERS = {
  Ethereum: 'https://etherscan.io/tx/', Arbitrum: 'https://arbiscan.io/tx/',
  Base: 'https://basescan.org/tx/', Optimism: 'https://optimistic.etherscan.io/tx/',
  Polygon: 'https://polygonscan.com/tx/',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TOKEN_COLORS = {
  ETH: '#627EEA', USDC: '#2775CA', USDT: '#26A17B', WBTC: '#F09242',
  ARB: '#28A0F0', OP: '#FF0420', MATIC: '#8247E5', DAI: '#F5AC37',
}

// ============ Seeded PRNG (Mulberry32) ============
function mulberry32(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============ Mock Data (20 swaps, seed 2121) ============
function generateMockSwaps() {
  const rng = mulberry32(2121)
  const now = Date.now()
  const offsets = [
    12*60e3, 47*60e3, 2.3*36e5, 5.8*36e5, 14*36e5, 28*36e5, 34*36e5,
    52*36e5, 76*36e5, 98*36e5, 124*36e5, 168*36e5, 9*864e5, 13*864e5,
    18*864e5, 24*864e5, 31*864e5, 42*864e5, 55*864e5, 68*864e5,
  ]
  const swaps = []
  for (let i = 0; i < 20; i++) {
    const pair = SWAP_PAIRS[Math.floor(rng() * SWAP_PAIRS.length)]
    const [fromToken, toToken] = pair
    const chain = CHAINS[Math.floor(rng() * CHAINS.length)]
    let fromAmount = fromToken === 'ETH' ? 0.05 + rng() * 8
      : fromToken === 'WBTC' ? 0.002 + rng() * 1.5
      : ['USDC', 'USDT', 'DAI'].includes(fromToken) ? 50 + rng() * 15000
      : 10 + rng() * 3000
    const fromUsd = fromAmount * TOKEN_PRICES[fromToken]
    const toAmount = fromUsd / TOKEN_PRICES[toToken]
    const rate = TOKEN_PRICES[fromToken] / TOKEN_PRICES[toToken]
    const mevPct = 0.001 + rng() * 0.024
    const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join('')
    swaps.push({
      id: `swap-${String(i + 1).padStart(3, '0')}`, fromToken, toToken, fromAmount, toAmount, fromUsd, rate, chain,
      batchNumber: 18200 + Math.floor(rng() * 1200), blockNumber: 19000000 + Math.floor(rng() * 800000),
      gasUsed: 120000 + Math.floor(rng() * 180000), priceImpact: 0.01 + rng() * 0.45,
      mevSavings: fromUsd * mevPct, mevPct, feesPaid: fromUsd * 0.0005,
      timestamp: now - offsets[i], txHash: '0x' + hex, explorerUrl: EXPLORERS[chain] + '0x' + hex,
    })
  }
  return swaps
}
const MOCK_SWAPS = generateMockSwaps()

// ============ Formatters ============
function fmtAmt(n, t) {
  if (['USDC', 'USDT', 'DAI'].includes(t)) return n.toFixed(2)
  if (t === 'WBTC') return n.toFixed(6)
  if (t === 'ETH') return n.toFixed(4)
  return n.toFixed(2)
}
function fmtUsd(v) { return v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(2)}` }
function fmtAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}
function fmtDate(ts) { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
function truncHash(h) { return h ? `${h.slice(0, 6)}...${h.slice(-4)}` : '---' }

// ============ Small Reusable Pieces ============
function StatBox({ label, value, sub, color }) {
  return (
    <div className="text-center p-3 sm:p-4">
      <div className="text-[10px] sm:text-xs text-black-400 mb-1">{label}</div>
      <div className="text-base sm:text-lg font-bold" style={{ color: color || 'white' }}>{value}</div>
      {sub && <div className="text-[10px] text-black-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function TokenBadge({ token }) {
  const c = TOKEN_COLORS[token] || '#666'
  return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-medium" style={{ backgroundColor: c + '18', color: c }}>{token}</span>
}

function FilterChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border whitespace-nowrap ${active
      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
      : 'bg-black-800/60 border-black-700/50 text-black-400 hover:text-black-200 hover:border-black-600'}`}>
      {label}
    </button>
  )
}

function DetailCell({ label, value, copyValue }) {
  return (
    <div className="p-2.5 rounded-lg bg-black-900/50">
      <div className="text-[10px] text-black-500 mb-0.5">{label}</div>
      <div className="text-xs font-mono text-black-300 flex items-center gap-1.5">
        <span className="truncate">{value}</span>
        {copyValue && (
          <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(copyValue) }}
            className="text-black-500 hover:text-black-200 transition-colors flex-shrink-0" title={`Copy ${label}`}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// ============ Swap Row with Expandable Detail ============
function SwapRow({ swap, isExpanded, onToggle, index }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * STAGGER, duration: FADE, ease }} className="mb-2">
      <GlassCard className="overflow-hidden">
        <button onClick={onToggle} className="w-full p-3 sm:p-4 text-left">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm font-medium text-white truncate">{fmtAmt(swap.fromAmount, swap.fromToken)} {swap.fromToken}</span>
                  <svg className="w-3.5 h-3.5 text-black-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-sm font-medium text-white truncate">{fmtAmt(swap.toAmount, swap.toToken)} {swap.toToken}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-black-500">
                  <span className="font-mono">{swap.chain}</span>
                  <span className="w-0.5 h-0.5 rounded-full bg-black-600" />
                  <span>{fmtAgo(swap.timestamp)}</span>
                  <span className="hidden sm:inline"><span className="w-0.5 h-0.5 rounded-full bg-black-600 inline-block mx-1" />Batch #{swap.batchNumber}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-sm font-mono font-semibold text-white">{fmtUsd(swap.fromUsd)}</div>
                <div className="text-[10px] font-mono text-green-400">+{fmtUsd(swap.mevSavings)} saved</div>
              </div>
              <motion.svg className="w-4 h-4 text-black-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </motion.svg>
            </div>
          </div>
          <div className="sm:hidden mt-1 text-[10px] text-black-500">Batch #{swap.batchNumber}</div>
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <div className="px-3 sm:px-4 pb-4 border-t border-black-700/50 pt-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <DetailCell label="Tx Hash" value={truncHash(swap.txHash)} copyValue={swap.txHash} />
                  <DetailCell label="Block" value={`#${swap.blockNumber.toLocaleString()}`} />
                  <DetailCell label="Gas Used" value={`${swap.gasUsed.toLocaleString()} units`} />
                  <DetailCell label="Price Impact" value={`${swap.priceImpact.toFixed(2)}%`} />
                  <DetailCell label="Effective Rate" value={`1 ${swap.fromToken} = ${swap.rate.toFixed(swap.rate > 100 ? 2 : 6)} ${swap.toToken}`} />
                  <DetailCell label="Batch Number" value={`#${swap.batchNumber}`} />
                </div>
                <div className="mt-3 p-3 rounded-lg border" style={{ backgroundColor: CYAN + '08', borderColor: CYAN + '20' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="text-xs font-medium" style={{ color: CYAN }}>MEV Protection</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><div className="text-[10px] text-black-500">Savings</div><div className="text-sm font-mono font-medium text-green-400">{fmtUsd(swap.mevSavings)}</div></div>
                    <div><div className="text-[10px] text-black-500">Savings Rate</div><div className="text-sm font-mono font-medium text-green-400">{(swap.mevPct * 100).toFixed(2)}%</div></div>
                    <div><div className="text-[10px] text-black-500">Fee Paid</div><div className="text-sm font-mono font-medium text-white">{fmtUsd(swap.feesPaid)}</div></div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <a href={swap.explorerUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-black-800/60 border border-black-700/50 text-black-400 hover:text-white hover:border-black-600 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    View on Explorer
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Monthly Volume Chart (SVG) ============
function MonthlyVolumeChart({ swaps }) {
  const data = useMemo(() => {
    const b = Array(12).fill(0)
    swaps.forEach(s => { b[new Date(s.timestamp).getMonth()] += s.fromUsd })
    return b
  }, [swaps])
  const max = Math.max(...data, 1)
  const W = 600, H = 160, bw = 36, gap = (W - bw * 12) / 13

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Monthly Volume</h3>
        <span className="text-[10px] font-mono text-black-500">Last 12 months</span>
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full" style={{ minWidth: 400 }}>
          {[0.25, 0.5, 0.75, 1].map((p, i) => (
            <line key={i} x1={0} y1={H - H * p} x2={W} y2={H - H * p} stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
          ))}
          {data.map((vol, i) => {
            const bh = max > 0 ? (vol / max) * (H - 8) : 0
            const x = gap + i * (bw + gap), y = H - bh, has = vol > 0
            return (
              <g key={i}>
                <rect x={x} y={has ? y : H - 2} width={bw} height={has ? bh : 2} rx={4}
                  fill={has ? CYAN : 'rgba(255,255,255,0.06)'} opacity={has ? 0.7 : 0.3} />
                {has && <rect x={x} y={y} width={bw} height={bh} rx={4} fill={CYAN} opacity={0.15} />}
                {has && <text x={x + bw / 2} y={y - 4} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="monospace">{fmtUsd(vol)}</text>}
                <text x={x + bw / 2} y={H + 16} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">{MONTHS[i]}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </GlassCard>
  )
}

// ============ Most Traded Pairs ============
function MostTradedPairs({ swaps }) {
  const pairs = useMemo(() => {
    const m = {}
    swaps.forEach(s => {
      const k = `${s.fromToken}/${s.toToken}`
      if (!m[k]) m[k] = { pair: k, from: s.fromToken, to: s.toToken, count: 0, volume: 0 }
      m[k].count++; m[k].volume += s.fromUsd
    })
    return Object.values(m).sort((a, b) => b.volume - a.volume).slice(0, 5)
  }, [swaps])
  const topVol = pairs.length > 0 ? pairs[0].volume : 1

  return (
    <GlassCard className="p-4">
      <h3 className="text-sm font-semibold text-white mb-4">Most Traded Pairs</h3>
      <div className="space-y-3">
        {pairs.map((ps, i) => (
          <div key={ps.pair} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-black-500 w-4">{i + 1}.</span>
            <div className="flex items-center gap-1">
              <TokenBadge token={ps.from} />
              <svg className="w-3 h-3 text-black-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <TokenBadge token={ps.to} />
            </div>
            <div className="flex-1 mx-2">
              <div className="h-1.5 rounded-full bg-black-800 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(ps.volume / topVol) * 100}%`, backgroundColor: CYAN, opacity: 0.6 }} />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-xs font-mono text-white">{fmtUsd(ps.volume)}</div>
              <div className="text-[10px] text-black-500">{ps.count} swaps</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============
function SwapHistoryPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expandedSwap, setExpandedSwap] = useState(null)
  const [dateRange, setDateRange] = useState('all')
  const [pairFilter, setPairFilter] = useState('all')
  const [chainFilter, setChainFilter] = useState('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // When connected, show real data (empty for now); when not connected, show mock data for demo
  const allSwaps = isConnected ? [] : MOCK_SWAPS

  const uniquePairs = useMemo(() => Array.from(new Set(allSwaps.map(s => `${s.fromToken}/${s.toToken}`))).sort(), [allSwaps])

  const filteredSwaps = useMemo(() => {
    let list = [...allSwaps]
    if (dateRange !== 'all') {
      const c = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6, '90d': 7776e6 }
      if (c[dateRange]) list = list.filter(s => Date.now() - s.timestamp <= c[dateRange])
    }
    if (pairFilter !== 'all') list = list.filter(s => `${s.fromToken}/${s.toToken}` === pairFilter)
    if (chainFilter !== 'all') list = list.filter(s => s.chain === chainFilter)
    const mn = parseFloat(minAmount); if (!isNaN(mn) && mn > 0) list = list.filter(s => s.fromUsd >= mn)
    const mx = parseFloat(maxAmount); if (!isNaN(mx) && mx > 0) list = list.filter(s => s.fromUsd <= mx)
    return list
  }, [allSwaps, dateRange, pairFilter, chainFilter, minAmount, maxAmount])

  const stats = useMemo(() => {
    const vol = allSwaps.reduce((a, s) => a + s.fromUsd, 0)
    const mev = allSwaps.reduce((a, s) => a + s.mevSavings, 0)
    const fees = allSwaps.reduce((a, s) => a + s.feesPaid, 0)
    return { totalSwaps: allSwaps.length, totalVolume: vol, avgSaved: allSwaps.length ? mev / allSwaps.length : 0, totalFees: fees }
  }, [allSwaps])

  const handleExportCSV = useCallback(() => {
    const hdr = 'Date,Time,From Token,From Amount,To Token,To Amount,Value (USD),Rate,Chain,Batch,MEV Saved,Fee,Price Impact,Gas,Block,Tx Hash'
    const rows = filteredSwaps.map(s => [
      fmtDate(s.timestamp), fmtTime(s.timestamp), s.fromToken, fmtAmt(s.fromAmount, s.fromToken),
      s.toToken, fmtAmt(s.toAmount, s.toToken), s.fromUsd.toFixed(2), s.rate.toFixed(6), s.chain,
      s.batchNumber, s.mevSavings.toFixed(2), s.feesPaid.toFixed(2), s.priceImpact.toFixed(2),
      s.gasUsed, s.blockNumber, s.txHash,
    ].join(','))
    const blob = new Blob([[hdr, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `vibeswap-swap-history-${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }, [filteredSwaps])

  const hasFilters = dateRange !== 'all' || pairFilter !== 'all' || chainFilter !== 'all' || minAmount || maxAmount
  const clearFilters = () => { setDateRange('all'); setPairFilter('all'); setChainFilter('all'); setMinAmount(''); setMaxAmount('') }

  return (
    <div className="min-h-screen">
      <PageHero category="account" title="Swap History" subtitle="Complete record of your MEV-protected batch auction trades" badge="Live" badgeColor={CYAN}>
        <button onClick={handleExportCSV}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-black-800/60 border border-black-700/50 text-black-400 hover:text-white hover:border-black-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </PageHero>

      <div className="max-w-4xl mx-auto px-4 pb-12">
        {/* Stats Row */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: FADE, delay: STAGGER, ease }}>
          <GlassCard className="mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-black-700/50">
              <StatBox label="Total Swaps" value={stats.totalSwaps} sub="all time" />
              <StatBox label="Volume" value={fmtUsd(stats.totalVolume)} sub="total traded" />
              <StatBox label="Avg Saved" value={fmtUsd(stats.avgSaved)} sub="per swap (MEV)" color="#4ade80" />
              <StatBox label="Fees Paid" value={fmtUsd(stats.totalFees)} sub="trading fees (to LPs)" />
            </div>
          </GlassCard>
        </motion.div>

        {/* Filter Bar */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: FADE, delay: STAGGER * 2, ease }} className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Swap List <span className="ml-2 text-xs text-black-500 font-normal">({filteredSwaps.length})</span></h2>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${showFilters || hasFilters
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-black-800/60 border-black-700/50 text-black-400 hover:text-black-200'}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters{hasFilters ? ' *' : ''}
            </button>
          </div>
          <AnimatePresence>
            {showFilters && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
                <GlassCard className="p-4 mb-4">
                  <div className="space-y-4">
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Date Range</div>
                      <div className="flex flex-wrap gap-2">
                        {[{ k: 'all', l: 'All Time' }, { k: '24h', l: '24 Hours' }, { k: '7d', l: '7 Days' }, { k: '30d', l: '30 Days' }, { k: '90d', l: '90 Days' }].map(r => (
                          <FilterChip key={r.k} label={r.l} active={dateRange === r.k} onClick={() => setDateRange(r.k)} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Token Pair</div>
                      <div className="flex flex-wrap gap-2">
                        <FilterChip label="All Pairs" active={pairFilter === 'all'} onClick={() => setPairFilter('all')} />
                        {uniquePairs.map(p => <FilterChip key={p} label={p} active={pairFilter === p} onClick={() => setPairFilter(p)} />)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Chain</div>
                      <div className="flex flex-wrap gap-2">
                        <FilterChip label="All Chains" active={chainFilter === 'all'} onClick={() => setChainFilter('all')} />
                        {CHAINS.map(c => <FilterChip key={c} label={c} active={chainFilter === c} onClick={() => setChainFilter(c)} />)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider mb-2">Amount Range (USD)</div>
                      <div className="flex items-center gap-3">
                        <input type="number" placeholder="Min" value={minAmount} onChange={e => setMinAmount(e.target.value)}
                          className="w-28 px-3 py-1.5 rounded-lg text-xs font-mono bg-black-900/50 border border-black-700/50 text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/40" />
                        <span className="text-black-500 text-xs">to</span>
                        <input type="number" placeholder="Max" value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
                          className="w-28 px-3 py-1.5 rounded-lg text-xs font-mono bg-black-900/50 border border-black-700/50 text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/40" />
                      </div>
                    </div>
                    {hasFilters && <button onClick={clearFilters} className="text-xs text-black-400 hover:text-black-200 transition-colors underline">Clear all filters</button>}
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Swap List */}
        {filteredSwaps.length === 0 ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: FADE }}>
            <GlassCard className="py-16 px-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">{isConnected ? 'No swap history yet' : 'No swaps found'}</h3>
              <p className="text-sm text-black-500 max-w-xs mx-auto">Your swap history will appear here once you execute trades through VibeSwap batch auctions.</p>
            </GlassCard>
          </motion.div>
        ) : (
          <div className="space-y-0">
            {filteredSwaps.map((swap, i) => (
              <SwapRow key={swap.id} swap={swap} isExpanded={expandedSwap === swap.id}
                onToggle={() => setExpandedSwap(expandedSwap === swap.id ? null : swap.id)} index={i} />
            ))}
          </div>
        )}

        {/* Monthly Volume Chart */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: FADE, delay: STAGGER * 4, ease }} className="mt-8">
          <MonthlyVolumeChart swaps={allSwaps} />
        </motion.div>

        {/* Most Traded Pairs */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: FADE, delay: STAGGER * 5, ease }} className="mt-4">
          <MostTradedPairs swaps={allSwaps} />
        </motion.div>

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: STAGGER * 6, duration: FADE }} className="mt-8 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-black-500">
            <svg className="w-4 h-4" style={{ color: CYAN + '80' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>All swaps executed through commit-reveal batch auctions with uniform clearing prices</span>
          </div>
          <div className="text-[10px] text-black-600 mt-1">No frontrunning &middot; No sandwich attacks &middot; MEV protection by design</div>
        </motion.div>
      </div>
    </div>
  )
}

export default SwapHistoryPage
