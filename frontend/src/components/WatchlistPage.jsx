import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import Sparkline from './ui/Sparkline'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const DURATION = 1 / (PHI * PHI * PHI)
const STAGGER = DURATION / PHI
const CYAN = '#06b6d4'
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}
const rand = seededRandom(808)

// ============ Token Registry ============
const TOKEN_COLORS = {
  ETH: '#627eea', BTC: '#f7931a', JUL: '#06b6d4', USDC: '#2775ca',
  SOL: '#9945ff', AVAX: '#e84142', MATIC: '#8247e5', ARB: '#28a0f0',
  OP: '#ff0420', BASE: '#0052ff', LINK: '#2a5ada', UNI: '#ff007a',
  AAVE: '#b6509e', CRV: '#f3d15a', MKR: '#1aab9b', LDO: '#00a3ff',
  DOGE: '#c3a634', SHIB: '#ffa409', PEPE: '#3d9c3d', WLD: '#1a1a2e',
}
const TOKEN_NAMES = {
  ETH: 'Ethereum', BTC: 'Bitcoin', JUL: 'Joule', USDC: 'USD Coin',
  SOL: 'Solana', AVAX: 'Avalanche', MATIC: 'Polygon', ARB: 'Arbitrum',
  OP: 'Optimism', BASE: 'Base', LINK: 'Chainlink', UNI: 'Uniswap',
  AAVE: 'Aave', CRV: 'Curve', MKR: 'Maker', LDO: 'Lido',
  DOGE: 'Dogecoin', SHIB: 'Shiba Inu', PEPE: 'Pepe', WLD: 'Worldcoin',
}

// ============ Mock Data Generation ============
function generateTokenData(symbol, seed) {
  const rng = seededRandom(seed)
  const priceBase = {
    BTC: 67500, ETH: 3400, SOL: 175, AVAX: 38, LINK: 18.5, UNI: 12.3,
    AAVE: 105, CRV: 0.62, MKR: 2850, LDO: 2.15, ARB: 1.18, OP: 2.65,
    MATIC: 0.92, BASE: 0.034, JUL: 0.042, USDC: 1.0, DOGE: 0.165,
    SHIB: 0.0000245, PEPE: 0.0000118, WLD: 4.85,
  }
  const mcapMap = {
    BTC: 1320e9, ETH: 410e9, SOL: 78e9, AVAX: 14e9, LINK: 11e9,
    UNI: 7.4e9, AAVE: 1.5e9, CRV: 0.8e9, MKR: 2.5e9, LDO: 1.9e9,
    ARB: 1.5e9, OP: 2.8e9, MATIC: 8.5e9, BASE: 0.4e9, JUL: 0.12e9,
    USDC: 33e9, DOGE: 22e9, SHIB: 14e9, PEPE: 5e9, WLD: 1.2e9,
  }
  const base = priceBase[symbol] || 10
  const price = base * (0.95 + rng() * 0.1)
  const change24h = (rng() - 0.45) * 20
  const change7d = (rng() - 0.42) * 30
  const marketCap = mcapMap[symbol] || 1e9
  const volume = marketCap * (0.02 + rng() * 0.08)
  const sparkline = []
  let p = price * (1 - change7d / 100)
  for (let i = 0; i < 28; i++) { p *= 1 + (rng() - 0.48) * 0.04; sparkline.push(p) }
  sparkline[sparkline.length - 1] = price
  const holdingAmount = rng() > 0.5 ? rng() * (symbol === 'BTC' ? 0.5 : symbol === 'ETH' ? 5 : 1000) : 0
  return {
    symbol, name: TOKEN_NAMES[symbol] || symbol, price, change24h, change7d,
    marketCap, volume, sparkline, holdingAmount, holdingValue: holdingAmount * price,
    color: TOKEN_COLORS[symbol] || CYAN,
  }
}

const ALL_TOKENS = Object.keys(TOKEN_NAMES)
const ALL_TOKEN_DATA = {}
ALL_TOKENS.forEach((sym, i) => { ALL_TOKEN_DATA[sym] = generateTokenData(sym, 808 + i * 137) })
const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL', 'JUL', 'ARB', 'LINK', 'UNI', 'OP']

// ============ Popular Tokens ============
const POPULAR = (() => {
  const all = Object.values(ALL_TOKEN_DATA)
  const sorted = [...all].sort((a, b) => b.change24h - a.change24h)
  return { trending: all.slice(0, 5), topGainers: sorted.slice(0, 5), topLosers: sorted.slice(-5).reverse() }
})()

// ============ Formatters ============
const formatPrice = (n) => n >= 1000 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n >= 1 ? '$' + n.toFixed(2) : n >= 0.01 ? '$' + n.toFixed(4) : '$' + n.toFixed(8)
const formatCompact = (n) => n >= 1e12 ? '$' + (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(2)
const formatChange = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

// ============ Token Icon ============
function TokenIcon({ symbol, size = 32 }) {
  const c = TOKEN_COLORS[symbol] || CYAN
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35, background: `linear-gradient(135deg, ${c}, ${c}88)`, boxShadow: `0 0 12px ${c}33` }}>
      {symbol.slice(0, 2)}
    </div>
  )
}

// ============ Price Alert Modal ============
function PriceAlertModal({ token, onClose, onSave }) {
  const [alertPrice, setAlertPrice] = useState(token.price.toFixed(2))
  const [direction, setDirection] = useState('above')
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="bg-black-900 border border-black-700 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <TokenIcon symbol={token.symbol} size={36} />
          <div>
            <h3 className="font-semibold text-white">{token.name}</h3>
            <p className="text-xs text-black-400">Current: {formatPrice(token.price)}</p>
          </div>
        </div>
        <label className="text-xs text-black-400 mb-1 block">Alert when price goes</label>
        <div className="flex gap-2 mb-4">
          {['above', 'below'].map(d => (
            <button key={d} onClick={() => setDirection(d)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${direction === d ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-black-800 text-black-400 border border-black-700 hover:border-black-600'}`}>
              {d === 'above' ? 'Above' : 'Below'}
            </button>
          ))}
        </div>
        <label className="text-xs text-black-400 mb-1 block">Target Price</label>
        <input type="number" value={alertPrice} onChange={e => setAlertPrice(e.target.value)} step="any"
          className="w-full bg-black-800 border border-black-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:border-cyan-500/50 focus:outline-none transition-colors" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm bg-black-800 text-black-400 border border-black-700 hover:bg-black-700 transition-colors">Cancel</button>
          <button onClick={() => { onSave(token.symbol, parseFloat(alertPrice), direction); onClose() }}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors" style={{ background: `linear-gradient(135deg, ${CYAN}, ${CYAN}cc)` }}>
            Set Alert
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============ Compare Panel ============
function ComparePanel({ tokens, onRemove }) {
  if (tokens.length === 0) return null
  const metrics = [
    ['price', 'Price'], ['change24h', '24h Change'], ['change7d', '7d Change'],
    ['marketCap', 'Market Cap'], ['volume', 'Volume'],
  ]
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
      transition={{ duration: DURATION, ease: EASE }}>
      <GlassCard glowColor="terminal" spotlight className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white text-sm">Compare View</h3>
          <span className="text-[10px] text-black-500 font-mono">{tokens.length}/3 selected</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black-800">
                <th className="text-left py-2 text-black-500 font-mono text-xs w-28">Metric</th>
                {tokens.map(sym => (
                  <th key={sym} className="text-right py-2 px-3">
                    <div className="flex items-center justify-end gap-2">
                      <TokenIcon symbol={sym} size={20} />
                      <span className="text-white font-medium">{sym}</span>
                      <button onClick={() => onRemove(sym)} className="text-black-600 hover:text-red-400 transition-colors ml-1 text-xs">x</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(([key, label]) => (
                <tr key={key} className="border-b border-black-800/50">
                  <td className="py-2.5 text-black-400 text-xs font-mono">{label}</td>
                  {tokens.map(sym => {
                    const t = ALL_TOKEN_DATA[sym]
                    const isChange = key === 'change24h' || key === 'change7d'
                    const val = key === 'price' ? formatPrice(t.price) : isChange ? formatChange(t[key]) : formatCompact(t[key])
                    const color = isChange ? (t[key] >= 0 ? 'text-green-400' : 'text-red-400') : 'text-white'
                    return <td key={sym} className={`py-2.5 text-right px-3 ${color}`}>{val}</td>
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-2.5 text-black-400 text-xs font-mono">7d Trend</td>
                {tokens.map(sym => (
                  <td key={sym} className="py-2.5 text-right px-3">
                    <div className="flex justify-end">
                      <Sparkline data={ALL_TOKEN_DATA[sym].sparkline} width={80} height={24} strokeWidth={1.5} fill />
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Watchlist Row ============
function WatchlistRow({ token, index, isStarred, onToggleStar, onSetAlert, onToggleCompare, isComparing }) {
  const up = token.change24h >= 0
  return (
    <motion.div layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}
      transition={{ delay: index * STAGGER, duration: DURATION, ease: EASE }} className="group">
      <GlassCard hover spotlight className="p-4">
        <div className="flex items-center gap-3">
          {/* Star + drag handle */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <button onClick={onToggleStar} title={isStarred ? 'Unstar' : 'Star'}
              className={`text-sm transition-colors ${isStarred ? 'text-yellow-400' : 'text-black-600 hover:text-yellow-400/60'}`}>
              {isStarred ? '\u2605' : '\u2606'}
            </button>
            <div className="text-black-700 text-[10px] cursor-grab select-none" title="Drag to reorder">:::</div>
          </div>
          {/* Token info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <TokenIcon symbol={token.symbol} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-sm">{token.symbol}</span>
                <span className="text-black-500 text-xs truncate hidden sm:inline">{token.name}</span>
              </div>
              {token.holdingAmount > 0 && (
                <p className="text-[10px] text-cyan-400/70 font-mono mt-0.5">
                  {token.holdingAmount < 1 ? token.holdingAmount.toFixed(4) : token.holdingAmount.toFixed(2)} held = {formatCompact(token.holdingValue)}
                </p>
              )}
            </div>
          </div>
          {/* Price */}
          <div className="text-right shrink-0 w-24">
            <p className="text-white font-medium text-sm">{formatPrice(token.price)}</p>
          </div>
          {/* 24h Change */}
          <div className="text-right shrink-0 w-20 hidden sm:block">
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${up ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {formatChange(token.change24h)}
            </span>
          </div>
          {/* 7d Sparkline */}
          <div className="shrink-0 hidden md:flex items-center justify-center w-20">
            <Sparkline data={token.sparkline} width={72} height={24} strokeWidth={1.5} fill />
          </div>
          {/* Market Cap */}
          <div className="text-right shrink-0 w-20 hidden lg:block">
            <p className="text-black-400 text-xs font-mono">{formatCompact(token.marketCap)}</p>
            <p className="text-black-600 text-[10px] font-mono">mcap</p>
          </div>
          {/* Volume */}
          <div className="text-right shrink-0 w-20 hidden lg:block">
            <p className="text-black-400 text-xs font-mono">{formatCompact(token.volume)}</p>
            <p className="text-black-600 text-[10px] font-mono">24h vol</p>
          </div>
          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={onToggleCompare} title="Compare"
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all ${isComparing ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-black-800 text-black-500 border border-black-700 hover:border-black-600 hover:text-black-300'}`}>
              {isComparing ? '\u2713' : '\u2194'}
            </button>
            <button onClick={onSetAlert} title="Set price alert"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs bg-black-800 text-black-500 border border-black-700 hover:border-cyan-500/40 hover:text-cyan-400 transition-all">
              {'\u{1F514}'}
            </button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Search Bar ============
function SearchBar({ query, setQuery, results, onAdd }) {
  return (
    <div className="relative">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tokens to add..."
          className="w-full bg-black-800/60 border border-black-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-black-500 focus:border-cyan-500/50 focus:outline-none transition-colors" />
        {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-black-500 hover:text-white transition-colors text-xs">Clear</button>}
      </div>
      <AnimatePresence>
        {query.length > 0 && results.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: DURATION }}
            className="absolute top-full left-0 right-0 mt-1 z-30 bg-black-900 border border-black-700 rounded-xl overflow-hidden shadow-2xl">
            {results.map(sym => {
              const t = ALL_TOKEN_DATA[sym]
              return (
                <button key={sym} onClick={() => onAdd(sym)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black-800 transition-colors text-left">
                  <TokenIcon symbol={sym} size={28} />
                  <div className="flex-1 min-w-0">
                    <span className="text-white text-sm font-medium">{sym}</span>
                    <span className="text-black-500 text-xs ml-2">{TOKEN_NAMES[sym]}</span>
                  </div>
                  <span className="text-white text-sm">{formatPrice(t.price)}</span>
                  <span className={`text-xs font-mono ${t.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatChange(t.change24h)}</span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Sort Controls ============
const SORT_OPTIONS = [
  { key: 'starred', label: 'Starred' }, { key: 'name', label: 'Name' }, { key: 'price', label: 'Price' },
  { key: 'change24h', label: '24h' }, { key: 'marketCap', label: 'MCap' }, { key: 'volume', label: 'Vol' },
  { key: 'holdingValue', label: 'Holdings' },
]

function SortControls({ sortBy, sortDir, onSort }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-black-600 font-mono mr-1">Sort:</span>
      {SORT_OPTIONS.map(({ key, label }) => (
        <button key={key} onClick={() => onSort(key)}
          className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${sortBy === key ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' : 'text-black-500 hover:text-black-300 border border-transparent'}`}>
          {label}{sortBy === key && <span className="ml-0.5">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
        </button>
      ))}
    </div>
  )
}

// ============ Popular Tokens Section ============
function PopularTokensSection({ watchlist, onAdd }) {
  const [tab, setTab] = useState('trending')
  const tabs = [['trending', 'Trending'], ['topGainers', 'Top Gainers'], ['topLosers', 'Top Losers']]
  const tokens = POPULAR[tab] || []
  return (
    <GlassCard glowColor="terminal" className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white text-sm">Popular Tokens</h3>
        <div className="flex gap-1">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors ${tab === key ? 'bg-cyan-500/15 text-cyan-400' : 'text-black-500 hover:text-black-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {tokens.map(token => {
          const inList = watchlist.includes(token.symbol)
          return (
            <motion.div key={token.symbol} whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
              <GlassCard hover className="p-3 cursor-pointer" onClick={() => !inList && onAdd(token.symbol)}>
                <div className="flex items-center gap-2 mb-2">
                  <TokenIcon symbol={token.symbol} size={24} />
                  <span className="text-white text-xs font-medium">{token.symbol}</span>
                  {inList && <span className="text-[9px] text-cyan-400/60 font-mono ml-auto">watching</span>}
                </div>
                <p className="text-white text-sm font-medium">{formatPrice(token.price)}</p>
                <p className={`text-xs font-mono ${token.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatChange(token.change24h)}</p>
                <div className="mt-2"><Sparkline data={token.sparkline} width={100} height={20} strokeWidth={1.2} fill /></div>
              </GlassCard>
            </motion.div>
          )
        })}
      </div>
    </GlassCard>
  )
}

// ============ Watchlist Summary ============
function WatchlistSummary({ watchlist }) {
  const stats = useMemo(() => {
    const tokens = watchlist.map(sym => ALL_TOKEN_DATA[sym]).filter(Boolean)
    const totalHoldings = tokens.reduce((s, t) => s + t.holdingValue, 0)
    const avgChange = tokens.length > 0 ? tokens.reduce((s, t) => s + t.change24h, 0) / tokens.length : 0
    const gainers = tokens.filter(t => t.change24h > 0).length
    return { totalHoldings, avgChange, gainers, losers: tokens.length - gainers, count: tokens.length }
  }, [watchlist])
  const items = [
    { label: 'Tokens', value: stats.count.toString(), color: 'text-white' },
    { label: 'Holdings', value: formatCompact(stats.totalHoldings), color: 'text-white' },
    { label: 'Avg 24h', value: formatChange(stats.avgChange), color: stats.avgChange >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Gainers / Losers', value: `${stats.gainers} / ${stats.losers}`, color: 'text-white' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {items.map(({ label, value, color }, i) => (
        <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * STAGGER, duration: DURATION, ease: EASE }}>
          <GlassCard className="p-3 text-center">
            <p className="text-[10px] text-black-500 font-mono uppercase mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Main Component ============
function WatchlistPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST)
  const [starred, setStarred] = useState(new Set(['BTC', 'ETH', 'JUL']))
  const [sortBy, setSortBy] = useState('starred')
  const [sortDir, setSortDir] = useState('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [compareTokens, setCompareTokens] = useState([])
  const [alertToken, setAlertToken] = useState(null)
  const [alerts, setAlerts] = useState({})

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return ALL_TOKENS.filter(sym => !watchlist.includes(sym) &&
      (sym.toLowerCase().includes(q) || (TOKEN_NAMES[sym] || '').toLowerCase().includes(q))
    ).slice(0, 6)
  }, [searchQuery, watchlist])

  const sortedWatchlist = useMemo(() => {
    return [...watchlist].sort((a, b) => {
      const ta = ALL_TOKEN_DATA[a], tb = ALL_TOKEN_DATA[b]
      if (sortBy === 'starred') {
        const va = starred.has(a) ? 1 : 0, vb = starred.has(b) ? 1 : 0
        return sortDir === 'asc' ? va - vb : vb - va
      }
      if (sortBy === 'name') return sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
      const va = ta[sortBy] || 0, vb = tb[sortBy] || 0
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [watchlist, sortBy, sortDir, starred])

  const handleSort = useCallback((key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }, [sortBy])

  const handleAddToken = useCallback((sym) => {
    if (!watchlist.includes(sym)) setWatchlist(prev => [...prev, sym])
    setSearchQuery('')
  }, [watchlist])

  const handleToggleStar = useCallback((sym) => {
    setStarred(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n })
  }, [])

  const handleToggleCompare = useCallback((sym) => {
    setCompareTokens(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : prev.length >= 3 ? prev : [...prev, sym])
  }, [])

  const handleSaveAlert = useCallback((symbol, price, direction) => {
    setAlerts(prev => ({ ...prev, [symbol]: { price, direction, active: true } }))
  }, [])

  return (
    <div className="min-h-screen pb-24">
      <PageHero title="Watchlist" subtitle="Track tokens, set alerts, and compare performance across your portfolio" category="account" badge="Live" badgeColor={CYAN}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-black-500">{watchlist.length} tokens</span>
          {isConnected && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-green-500/10 text-green-400 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Synced
            </div>
          )}
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        <WatchlistSummary watchlist={watchlist} />

        {/* ============ Search + Sort ============ */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: STAGGER * 2, duration: DURATION, ease: EASE }}>
          <GlassCard className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1"><SearchBar query={searchQuery} setQuery={setSearchQuery} results={searchResults} onAdd={handleAddToken} /></div>
              <SortControls sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Compare Panel ============ */}
        <AnimatePresence>
          {compareTokens.length > 0 && <ComparePanel tokens={compareTokens} onRemove={sym => setCompareTokens(prev => prev.filter(s => s !== sym))} />}
        </AnimatePresence>

        {/* ============ Watchlist ============ */}
        <div className="space-y-2">
          <div className="hidden lg:flex items-center gap-3 px-4 py-2 text-[10px] font-mono text-black-600 uppercase">
            <div className="w-10 shrink-0" /><div className="flex-1">Token</div>
            <div className="w-24 text-right">Price</div><div className="w-20 text-right hidden sm:block">24h</div>
            <div className="w-20 text-center hidden md:block">7d Chart</div><div className="w-20 text-right hidden lg:block">MCap</div>
            <div className="w-20 text-right hidden lg:block">Volume</div><div className="w-[70px] shrink-0" />
          </div>
          <AnimatePresence mode="popLayout">
            {sortedWatchlist.map((sym, i) => {
              const token = ALL_TOKEN_DATA[sym]
              return token ? (
                <WatchlistRow key={sym} token={token} index={i} isStarred={starred.has(sym)}
                  onToggleStar={() => handleToggleStar(sym)} onSetAlert={() => setAlertToken(token)}
                  onToggleCompare={() => handleToggleCompare(sym)} isComparing={compareTokens.includes(sym)} />
              ) : null
            })}
          </AnimatePresence>
          {sortedWatchlist.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
              <p className="text-black-500 text-sm mb-2">Your watchlist is empty</p>
              <p className="text-black-600 text-xs">Search for tokens above or pick from popular tokens below</p>
            </motion.div>
          )}
        </div>

        {/* ============ Popular Tokens ============ */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: STAGGER * 6, duration: DURATION, ease: EASE }}>
          <PopularTokensSection watchlist={watchlist} onAdd={handleAddToken} />
        </motion.div>

        {/* ============ Active Alerts ============ */}
        {Object.keys(alerts).length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: STAGGER * 7, duration: DURATION, ease: EASE }}>
            <GlassCard className="p-5">
              <h3 className="font-semibold text-white text-sm mb-3">Active Alerts</h3>
              <div className="space-y-2">
                {Object.entries(alerts).map(([sym, alert]) => {
                  const token = ALL_TOKEN_DATA[sym]
                  const triggered = alert.direction === 'above' ? token.price >= alert.price : token.price <= alert.price
                  return (
                    <div key={sym} className="flex items-center gap-3 py-2 border-b border-black-800/50 last:border-0">
                      <TokenIcon symbol={sym} size={24} />
                      <span className="text-white text-sm font-medium">{sym}</span>
                      <span className="text-black-500 text-xs font-mono">{alert.direction === 'above' ? '>' : '<'} {formatPrice(alert.price)}</span>
                      <div className="flex-1" />
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${triggered ? 'bg-yellow-500/10 text-yellow-400' : 'bg-black-800 text-black-400'}`}>
                        {triggered ? 'Triggered' : 'Watching'}
                      </span>
                      <button onClick={() => setAlerts(prev => { const n = { ...prev }; delete n[sym]; return n })}
                        className="text-black-600 hover:text-red-400 transition-colors text-xs">Remove</button>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Wallet CTA ============ */}
        {!isConnected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: STAGGER * 8, duration: DURATION }}>
            <GlassCard glowColor="terminal" className="p-6 text-center">
              <p className="text-black-400 text-sm mb-2">Connect your wallet to sync your watchlist and see real holdings</p>
              <p className="text-black-600 text-xs font-mono">Your watchlist is saved locally for now</p>
            </GlassCard>
          </motion.div>
        )}
      </div>

      {/* ============ Alert Modal ============ */}
      <AnimatePresence>
        {alertToken && <PriceAlertModal token={alertToken} onClose={() => setAlertToken(null)} onSave={handleSaveAlert} />}
      </AnimatePresence>
    </div>
  )
}

export default WatchlistPage
