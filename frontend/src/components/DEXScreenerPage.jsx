import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease },
  }),
}

const rowV = {
  hidden: { opacity: 0, x: -8 },
  visible: (i) => ({
    opacity: 1, x: 0,
    transition: { duration: 0.25, delay: 0.05 + i * (0.03 * PHI), ease },
  }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPrice(p) {
  if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (p >= 1) return `$${p.toFixed(2)}`
  if (p >= 0.001) return `$${p.toFixed(4)}`
  return `$${p.toFixed(8)}`
}

function fmtPct(n) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function pctColor(n) {
  if (n > 0) return 'text-green-400'
  if (n < 0) return 'text-red-400'
  return 'text-zinc-400'
}

function pctBg(n) {
  if (n > 0) return 'bg-green-500/10 text-green-400'
  if (n < 0) return 'bg-red-500/10 text-red-400'
  return 'bg-zinc-500/10 text-zinc-400'
}

function timeAgo(minutes) {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

// ============ Data Generation ============

const CHAIN_OPTIONS = ['All Chains', 'Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BSC']
const CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BSC']
const CHAIN_COLORS = {
  Ethereum: '#627eea', Base: '#0052ff', Arbitrum: '#28a0f0',
  Optimism: '#ff0420', Polygon: '#8247e5', Avalanche: '#e84142', BSC: '#f0b90b',
}

const AGE_OPTIONS = ['Any Age', '< 1h', '< 6h', '< 24h', '< 7d', '< 30d']
const VOLUME_OPTIONS = ['Any Volume', '> $10K', '> $50K', '> $100K', '> $500K', '> $1M']
const LIQUIDITY_OPTIONS = ['Any Liquidity', '> $10K', '> $50K', '> $100K', '> $500K', '> $1M']
const SORT_OPTIONS = ['volume', 'price', 'change24h', 'liquidity', 'marketCap', 'age']

const TOKEN_SYMBOLS = [
  'VIBE', 'ETH', 'WBTC', 'ARB', 'OP', 'MATIC', 'SOL', 'AVAX',
  'LINK', 'UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'RPL', 'GMX',
  'DYDX', 'PENDLE', 'ENA', 'TAO', 'RENDER', 'FET', 'ONDO',
  'PEPE', 'BONK', 'WIF', 'FLOKI', 'DOGE', 'SHIB', 'MEME',
  'SEI', 'TIA', 'INJ', 'SUI', 'APT', 'EIGEN', 'MANTLE',
  'IMX', 'GALA', 'AXS', 'SAND', 'PRIME', 'BEAM', 'PIXEL',
  'PORTAL', 'XAI', 'SUPER', 'ILV', 'MANA', 'BLUR',
]

const TOKEN_NAMES_MAP = {
  VIBE: 'VibeSwap', ETH: 'Ethereum', WBTC: 'Wrapped BTC', ARB: 'Arbitrum',
  OP: 'Optimism', MATIC: 'Polygon', SOL: 'Solana', AVAX: 'Avalanche',
  LINK: 'Chainlink', UNI: 'Uniswap', AAVE: 'Aave', MKR: 'Maker',
  CRV: 'Curve', LDO: 'Lido', RPL: 'Rocket Pool', GMX: 'GMX',
  DYDX: 'dYdX', PENDLE: 'Pendle', ENA: 'Ethena', TAO: 'Bittensor',
  RENDER: 'Render', FET: 'Fetch.ai', ONDO: 'Ondo', PEPE: 'Pepe',
  BONK: 'Bonk', WIF: 'dogwifhat', FLOKI: 'Floki', DOGE: 'Dogecoin',
  SHIB: 'Shiba Inu', MEME: 'Memecoin', SEI: 'Sei', TIA: 'Celestia',
  INJ: 'Injective', SUI: 'Sui', APT: 'Aptos', EIGEN: 'EigenLayer',
  MANTLE: 'Mantle', IMX: 'Immutable', GALA: 'Gala', AXS: 'Axie',
  SAND: 'Sandbox', PRIME: 'Prime', BEAM: 'Beam', PIXEL: 'Pixels',
  PORTAL: 'Portal', XAI: 'Xai', SUPER: 'SuperVerse', ILV: 'Illuvium',
  MANA: 'Decentraland', BLUR: 'Blur',
}

const BASE_PRICES = {
  VIBE: 0.42, ETH: 3842.50, WBTC: 67420, ARB: 1.84, OP: 3.48,
  MATIC: 0.92, SOL: 178.40, AVAX: 42.80, LINK: 18.60, UNI: 12.40,
  AAVE: 142.80, MKR: 2860, CRV: 0.68, LDO: 2.92, RPL: 28.60,
  GMX: 48.40, DYDX: 3.42, PENDLE: 6.84, ENA: 1.26, TAO: 582,
  RENDER: 11.40, FET: 2.84, ONDO: 1.44, PEPE: 0.0000126,
  BONK: 0.0000272, WIF: 2.86, FLOKI: 0.000184, DOGE: 0.170,
  SHIB: 0.0000286, MEME: 0.034, SEI: 0.84, TIA: 14.80,
  INJ: 34.40, SUI: 1.86, APT: 12.60, EIGEN: 4.62, MANTLE: 0.80,
  IMX: 2.42, GALA: 0.050, AXS: 9.84, SAND: 0.64, PRIME: 18.60,
  BEAM: 0.034, PIXEL: 0.44, PORTAL: 0.90, XAI: 0.96, SUPER: 1.26,
  ILV: 114, MANA: 0.60, BLUR: 0.38,
}

// Generate main token table data
const rng1 = seededRandom(31415)

function generateSparkPoints(rng, baseVal, volatility, points) {
  const data = []
  let val = baseVal
  for (let i = 0; i < points; i++) {
    val += (rng() - 0.48) * volatility
    val = Math.max(val, baseVal * 0.7)
    data.push(val)
  }
  return data
}

const ALL_TOKENS = TOKEN_SYMBOLS.map((symbol, idx) => {
  const basePrice = BASE_PRICES[symbol] || 1
  const change24h = (rng1() - 0.42) * 40
  const volume = Math.round((rng1() * 500 + 10) * 100_000)
  const liquidity = Math.round((rng1() * 300 + 20) * 100_000)
  const marketCap = Math.round((rng1() * 20 + 0.2) * 1_000_000_000)
  const buys = Math.round(80 + rng1() * 800)
  const sells = Math.round(60 + rng1() * 600)
  const ageMinutes = Math.round(rng1() * 43200) // up to 30 days
  const chain = CHAINS[Math.floor(rng1() * CHAINS.length)]
  const verified = rng1() > 0.3
  const sparkline = generateSparkPoints(rng1, 50, 15, 24)

  return {
    rank: idx + 1,
    symbol,
    name: TOKEN_NAMES_MAP[symbol] || symbol,
    price: +(basePrice + (rng1() - 0.5) * basePrice * 0.08).toFixed(
      basePrice >= 100 ? 2 : basePrice >= 1 ? 4 : 8
    ),
    change24h: +change24h.toFixed(2),
    volume,
    liquidity,
    marketCap,
    buys,
    sells,
    ageMinutes,
    chain,
    verified,
    sparkline,
  }
})

// Trending: high volume * positive change
const TRENDING_TOKENS = [...ALL_TOKENS]
  .sort((a, b) => (b.volume * Math.max(b.change24h, 1)) - (a.volume * Math.max(a.change24h, 1)))
  .slice(0, 10)

// Gainers & Losers
const SORTED_BY_CHANGE = [...ALL_TOKENS].sort((a, b) => b.change24h - a.change24h)
const TOP_GAINERS = SORTED_BY_CHANGE.slice(0, 5)
const TOP_LOSERS = SORTED_BY_CHANGE.slice(-5).reverse()

// New Pairs
const rng2 = seededRandom(27182)
const PAIR_TOKENS_A = ['VIBE', 'NEURAL', 'ZKEVM', 'RWAX', 'PIXL', 'OMNI', 'SYNTH', 'AURA', 'DRIFT', 'FLUX']
const PAIR_TOKENS_B = ['ETH', 'USDC', 'USDT', 'WBTC', 'ETH', 'USDC', 'ETH', 'USDC', 'ETH', 'USDT']

const NEW_PAIRS = PAIR_TOKENS_A.map((tokenA, i) => {
  const chain = CHAINS[Math.floor(rng2() * CHAINS.length)]
  const ageMinutes = Math.round(rng2() * 2880) // up to 2 days
  const initLiq = Math.round((rng2() * 400 + 10) * 1000)
  const currentPrice = +(rng2() * 20 + 0.01).toFixed(4)
  const change = +((rng2() - 0.3) * 200).toFixed(2)
  return {
    pair: `${tokenA} / ${PAIR_TOKENS_B[i]}`,
    tokenA,
    tokenB: PAIR_TOKENS_B[i],
    chain,
    ageMinutes,
    initialLiquidity: initLiq,
    currentPrice,
    change,
  }
}).sort((a, b) => a.ageMinutes - b.ageMinutes)

// ============ Mini Sparkline SVG ============

function MiniSparkline({ data, color = CYAN, width = 80, height = 28 }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ============ Section Header ============

function SectionTag({ children }) {
  return (
    <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">
      {children}
    </span>
  )
}

// ============ Filter Bar ============

function FilterBar({
  chainFilter, setChainFilter,
  ageFilter, setAgeFilter,
  volumeFilter, setVolumeFilter,
  liquidityFilter, setLiquidityFilter,
  verifiedOnly, setVerifiedOnly,
  searchQuery, setSearchQuery,
}) {
  const selectClass = 'font-mono text-xs bg-black/40 border border-zinc-700/60 rounded-lg px-3 py-2 text-zinc-300 focus:outline-none focus:border-cyan-500/50 transition-colors cursor-pointer'

  return (
    <GlassCard glowColor="terminal" className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search token name or symbol..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full font-mono text-xs bg-black/40 border border-zinc-700/60 rounded-lg pl-10 pr-3 py-2 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>

        {/* Chain */}
        <select value={chainFilter} onChange={(e) => setChainFilter(e.target.value)} className={selectClass}>
          {CHAIN_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Liquidity */}
        <select value={liquidityFilter} onChange={(e) => setLiquidityFilter(e.target.value)} className={selectClass}>
          {LIQUIDITY_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        {/* Volume */}
        <select value={volumeFilter} onChange={(e) => setVolumeFilter(e.target.value)} className={selectClass}>
          {VOLUME_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {/* Age */}
        <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} className={selectClass}>
          {AGE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        {/* Verified Toggle */}
        <button
          onClick={() => setVerifiedOnly(!verifiedOnly)}
          className={`font-mono text-xs px-3 py-2 rounded-lg border transition-all ${
            verifiedOnly
              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
              : 'bg-black/40 border-zinc-700/60 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {verifiedOnly ? '✓ Verified' : 'Verified'}
        </button>
      </div>
    </GlassCard>
  )
}

// ============ Sortable Header Cell ============

function SortHeader({ label, field, sortBy, sortDir, onSort, className = '' }) {
  const active = sortBy === field
  return (
    <th
      className={`px-3 py-3 text-[11px] font-mono uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-cyan-400 ${
        active ? 'text-cyan-400' : 'text-zinc-500'
      } ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active && (
          <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>
        )}
      </div>
    </th>
  )
}

// ============ Parse Filter Thresholds ============

function parseThreshold(filterVal) {
  if (!filterVal || filterVal.startsWith('Any')) return 0
  const match = filterVal.match(/([\d.]+)([KMB]?)/)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2]
  if (unit === 'K') return num * 1_000
  if (unit === 'M') return num * 1_000_000
  if (unit === 'B') return num * 1_000_000_000
  return num
}

function parseAgeMinutes(filterVal) {
  if (!filterVal || filterVal === 'Any Age') return Infinity
  const match = filterVal.match(/([\d]+)([hd])/)
  if (!match) return Infinity
  const num = parseInt(match[1])
  const unit = match[2]
  if (unit === 'h') return num * 60
  if (unit === 'd') return num * 1440
  return Infinity
}

// ============ Main Component ============

export default function DEXScreenerPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ Filter State ============
  const [searchQuery, setSearchQuery] = useState('')
  const [chainFilter, setChainFilter] = useState('All Chains')
  const [ageFilter, setAgeFilter] = useState('Any Age')
  const [volumeFilter, setVolumeFilter] = useState('Any Volume')
  const [liquidityFilter, setLiquidityFilter] = useState('Any Liquidity')
  const [verifiedOnly, setVerifiedOnly] = useState(false)

  // ============ Sort State ============
  const [sortBy, setSortBy] = useState('volume')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(field) {
    if (sortBy === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  // ============ Filtered + Sorted Tokens ============
  const filteredTokens = useMemo(() => {
    const volumeThreshold = parseThreshold(volumeFilter)
    const liquidityThreshold = parseThreshold(liquidityFilter)
    const ageMax = parseAgeMinutes(ageFilter)
    const query = searchQuery.toLowerCase().trim()

    let tokens = ALL_TOKENS.filter(t => {
      if (query && !t.symbol.toLowerCase().includes(query) && !t.name.toLowerCase().includes(query)) return false
      if (chainFilter !== 'All Chains' && t.chain !== chainFilter) return false
      if (t.volume < volumeThreshold) return false
      if (t.liquidity < liquidityThreshold) return false
      if (t.ageMinutes > ageMax) return false
      if (verifiedOnly && !t.verified) return false
      return true
    })

    tokens.sort((a, b) => {
      let av = a[sortBy]
      let bv = b[sortBy]
      if (sortBy === 'age') { av = a.ageMinutes; bv = b.ageMinutes }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })

    return tokens.map((t, i) => ({ ...t, rank: i + 1 }))
  }, [searchQuery, chainFilter, ageFilter, volumeFilter, liquidityFilter, verifiedOnly, sortBy, sortDir])

  // ============ Stats Bar ============
  const totalVolume = ALL_TOKENS.reduce((s, t) => s + t.volume, 0)
  const totalLiquidity = ALL_TOKENS.reduce((s, t) => s + t.liquidity, 0)
  const totalTokens = ALL_TOKENS.length
  const avgChange = +(ALL_TOKENS.reduce((s, t) => s + t.change24h, 0) / ALL_TOKENS.length).toFixed(2)

  // ============ Render ============
  return (
    <div className="min-h-screen font-mono">
      <PageHero
        title="DEX Screener"
        subtitle="Advanced token analytics and screening"
        category="trading"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 pb-20 space-y-6">

        {/* ============ Stats Overview ============ */}
        <motion.div
          variants={sectionV} custom={0} initial="hidden" animate="visible"
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: 'Total Volume (24h)', value: fmt(totalVolume), color: 'text-cyan-400' },
            { label: 'Total Liquidity', value: fmt(totalLiquidity), color: 'text-green-400' },
            { label: 'Tokens Tracked', value: totalTokens.toString(), color: 'text-purple-400' },
            { label: 'Avg 24h Change', value: fmtPct(avgChange), color: pctColor(avgChange) },
          ].map((stat, i) => (
            <motion.div key={stat.label} variants={cardV} custom={i}>
              <GlassCard glowColor="terminal" className="p-4">
                <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">{stat.label}</div>
                <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>

        {/* ============ Trending Tokens (Horizontal Scroll) ============ */}
        <motion.section variants={sectionV} custom={1} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <SectionTag>trending</SectionTag>
            <h2 className="text-lg font-bold tracking-tight">Trending Tokens</h2>
            <span className="text-[10px] text-zinc-500 font-mono ml-auto">Top 10 by momentum</span>
          </div>

          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent pb-2">
            <div className="flex gap-3 min-w-max">
              {TRENDING_TOKENS.map((token, i) => (
                <motion.div key={token.symbol} variants={cardV} custom={i} initial="hidden" animate="visible">
                  <GlassCard glowColor={token.change24h >= 0 ? 'matrix' : 'warning'} className="p-4 w-[160px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: `linear-gradient(135deg, ${CYAN}33, ${CYAN}11)`, border: `1px solid ${CYAN}44` }}>
                          {token.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <div className="text-sm font-bold">{token.symbol}</div>
                          <div className="text-[9px] text-zinc-500">{token.name}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-yellow-400/80">#{i + 1}</span>
                    </div>
                    <div className="text-sm font-bold mb-1">{fmtPrice(token.price)}</div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${pctColor(token.change24h)}`}>
                        {fmtPct(token.change24h)}
                      </span>
                      <MiniSparkline
                        data={token.sparkline}
                        color={token.change24h >= 0 ? '#22c55e' : '#ef4444'}
                        width={50}
                        height={20}
                      />
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* ============ Filter Bar ============ */}
        <motion.section variants={sectionV} custom={2} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <SectionTag>filters</SectionTag>
            <h2 className="text-lg font-bold tracking-tight">Screen Tokens</h2>
            <span className="text-[10px] text-zinc-500 font-mono ml-auto">
              {filteredTokens.length} / {totalTokens} tokens
            </span>
          </div>
          <FilterBar
            chainFilter={chainFilter} setChainFilter={setChainFilter}
            ageFilter={ageFilter} setAgeFilter={setAgeFilter}
            volumeFilter={volumeFilter} setVolumeFilter={setVolumeFilter}
            liquidityFilter={liquidityFilter} setLiquidityFilter={setLiquidityFilter}
            verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          />
        </motion.section>

        {/* ============ Token Table ============ */}
        <motion.section variants={sectionV} custom={3} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <SectionTag>token table</SectionTag>
            <h2 className="text-lg font-bold tracking-tight">All Tokens</h2>
          </div>

          <GlassCard glowColor="terminal" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/80">
                    <th className="px-3 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-left w-12">#</th>
                    <SortHeader label="Token" field="symbol" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-left" />
                    <SortHeader label="Price" field="price" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortHeader label="24h %" field="change24h" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <th className="px-3 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-center">Chart</th>
                    <SortHeader label="Volume" field="volume" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortHeader label="Liquidity" field="liquidity" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortHeader label="Mkt Cap" field="marketCap" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <th className="px-3 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-center">Buys/Sells</th>
                    <SortHeader label="Age" field="age" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <th className="px-3 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-center">Chain</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTokens.slice(0, 30).map((token, i) => {
                    const buyRatio = token.buys / (token.buys + token.sells)
                    return (
                      <motion.tr
                        key={token.symbol}
                        variants={rowV}
                        custom={i}
                        initial="hidden"
                        animate="visible"
                        className="border-b border-zinc-800/40 hover:bg-white/[0.02] transition-colors group"
                      >
                        {/* Rank */}
                        <td className="px-3 py-3 text-zinc-600 text-xs">{token.rank}</td>

                        {/* Token Name + Symbol */}
                        <td className="px-3 py-3">
                          <Link to={`/token/${token.symbol.toLowerCase()}`} className="flex items-center gap-2 group-hover:text-cyan-400 transition-colors">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{ background: `linear-gradient(135deg, ${CHAIN_COLORS[token.chain] || CYAN}33, ${CHAIN_COLORS[token.chain] || CYAN}11)`, border: `1px solid ${CHAIN_COLORS[token.chain] || CYAN}44` }}>
                              {token.symbol.slice(0, 2)}
                            </div>
                            <div>
                              <div className="font-bold text-sm flex items-center gap-1.5">
                                {token.symbol}
                                {token.verified && (
                                  <svg className="w-3.5 h-3.5 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-500">{token.name}</div>
                            </div>
                          </Link>
                        </td>

                        {/* Price */}
                        <td className="px-3 py-3 text-right font-bold text-sm">{fmtPrice(token.price)}</td>

                        {/* 24h Change */}
                        <td className="px-3 py-3 text-right">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${pctBg(token.change24h)}`}>
                            {fmtPct(token.change24h)}
                          </span>
                        </td>

                        {/* Sparkline */}
                        <td className="px-3 py-3 text-center">
                          <MiniSparkline
                            data={token.sparkline}
                            color={token.change24h >= 0 ? '#22c55e' : '#ef4444'}
                            width={64}
                            height={24}
                          />
                        </td>

                        {/* Volume */}
                        <td className="px-3 py-3 text-right text-zinc-300 text-xs">{fmt(token.volume)}</td>

                        {/* Liquidity */}
                        <td className="px-3 py-3 text-right text-zinc-300 text-xs">{fmt(token.liquidity)}</td>

                        {/* Market Cap */}
                        <td className="px-3 py-3 text-right text-zinc-300 text-xs">{fmt(token.marketCap)}</td>

                        {/* Buys/Sells Ratio */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 justify-center">
                            <span className="text-[10px] text-green-400">{token.buys}</span>
                            <div className="w-16 h-1.5 rounded-full bg-red-500/30 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500/80"
                                style={{ width: `${(buyRatio * 100).toFixed(0)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-red-400">{token.sells}</span>
                          </div>
                        </td>

                        {/* Age */}
                        <td className="px-3 py-3 text-right text-zinc-400 text-xs">{timeAgo(token.ageMinutes)}</td>

                        {/* Chain */}
                        <td className="px-3 py-3 text-center">
                          <span
                            className="inline-block px-2 py-0.5 rounded text-[10px] font-bold"
                            style={{
                              backgroundColor: `${CHAIN_COLORS[token.chain] || CYAN}20`,
                              color: CHAIN_COLORS[token.chain] || CYAN,
                            }}
                          >
                            {token.chain}
                          </span>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            {filteredTokens.length > 30 && (
              <div className="px-4 py-3 border-t border-zinc-800/40 text-center">
                <span className="text-xs text-zinc-500 font-mono">
                  Showing 30 of {filteredTokens.length} tokens
                </span>
              </div>
            )}
            {filteredTokens.length === 0 && (
              <div className="px-4 py-12 text-center">
                <div className="text-zinc-500 text-sm font-mono">No tokens match your filters</div>
                <div className="text-zinc-600 text-xs font-mono mt-1">Try adjusting your search criteria</div>
              </div>
            )}
          </GlassCard>
        </motion.section>

        {/* ============ New Pairs ============ */}
        <motion.section variants={sectionV} custom={4} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <SectionTag>new pairs</SectionTag>
            <h2 className="text-lg font-bold tracking-tight">Recent Listings</h2>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] text-green-400/70 font-mono">Live</span>
            </div>
          </div>

          <GlassCard glowColor="matrix" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/80">
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-left">Pair</th>
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-center">Chain</th>
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-right">Age</th>
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-right">Init. Liquidity</th>
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-right">Price</th>
                    <th className="px-4 py-3 text-[11px] font-mono uppercase tracking-wider text-zinc-500 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {NEW_PAIRS.map((pair, i) => (
                    <motion.tr
                      key={pair.pair}
                      variants={rowV}
                      custom={i}
                      initial="hidden"
                      animate="visible"
                      className="border-b border-zinc-800/40 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold border border-zinc-700"
                              style={{ background: `linear-gradient(135deg, ${CYAN}44, ${CYAN}11)` }}>
                              {pair.tokenA.slice(0, 2)}
                            </div>
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold border border-zinc-700 bg-zinc-800">
                              {pair.tokenB.slice(0, 2)}
                            </div>
                          </div>
                          <span className="font-bold text-sm">{pair.pair}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-bold"
                          style={{
                            backgroundColor: `${CHAIN_COLORS[pair.chain] || CYAN}20`,
                            color: CHAIN_COLORS[pair.chain] || CYAN,
                          }}
                        >
                          {pair.chain}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-400 text-xs">
                        {timeAgo(pair.ageMinutes)}
                        {pair.ageMinutes < 120 && (
                          <span className="ml-1.5 text-[9px] text-yellow-400/80 bg-yellow-400/10 px-1 py-0.5 rounded">NEW</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300 text-xs">{fmt(pair.initialLiquidity)}</td>
                      <td className="px-4 py-3 text-right font-bold text-sm">{fmtPrice(pair.currentPrice)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${pctBg(pair.change)}`}>
                          {fmtPct(pair.change)}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Gainers & Losers ============ */}
        <motion.section variants={sectionV} custom={5} initial="hidden" animate="visible">
          <div className="flex items-center gap-2 mb-3">
            <SectionTag>movers</SectionTag>
            <h2 className="text-lg font-bold tracking-tight">Gainers & Losers</h2>
            <span className="text-[10px] text-zinc-500 font-mono ml-auto">24h change</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Gainers */}
            <GlassCard glowColor="matrix" className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-green-400">Top Gainers</span>
              </div>
              <div className="space-y-2">
                {TOP_GAINERS.map((token, i) => (
                  <motion.div
                    key={token.symbol}
                    variants={cardV}
                    custom={i}
                    initial="hidden"
                    animate="visible"
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-600 w-5">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
                        {token.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{token.symbol}</div>
                        <div className="text-[10px] text-zinc-500">{token.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{fmtPrice(token.price)}</div>
                      <div className="text-xs font-bold text-green-400">{fmtPct(token.change24h)}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>

            {/* Top Losers */}
            <GlassCard glowColor="warning" className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-sm font-bold text-red-400">Top Losers</span>
              </div>
              <div className="space-y-2">
                {TOP_LOSERS.map((token, i) => (
                  <motion.div
                    key={token.symbol}
                    variants={cardV}
                    custom={i}
                    initial="hidden"
                    animate="visible"
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-600 w-5">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                        {token.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{token.symbol}</div>
                        <div className="text-[10px] text-zinc-500">{token.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{fmtPrice(token.price)}</div>
                      <div className="text-xs font-bold text-red-400">{fmtPct(token.change24h)}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </div>
        </motion.section>

        {/* ============ Wallet CTA ============ */}
        {!isConnected && (
          <motion.section variants={sectionV} custom={6} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-8 text-center">
              <div className="text-lg font-bold mb-2">Connect to Track & Trade</div>
              <p className="text-sm text-zinc-400 max-w-md mx-auto mb-4">
                Connect your wallet to set price alerts, add tokens to your watchlist, and trade directly from the screener.
              </p>
              <Link
                to="/wallet"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: `linear-gradient(135deg, ${CYAN}33, ${CYAN}11)`,
                  border: `1px solid ${CYAN}44`,
                  color: CYAN,
                }}
              >
                Sign In
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </GlassCard>
          </motion.section>
        )}

        {/* ============ Footer Info ============ */}
        <motion.div
          variants={sectionV} custom={7} initial="hidden" animate="visible"
          className="text-center pt-4 pb-8"
        >
          <p className="text-[10px] text-zinc-600 font-mono">
            Data refreshes every 10 seconds via commit-reveal batch auctions.
            Prices are MEV-protected with uniform clearing.
          </p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <Link to="/analytics" className="text-[10px] text-cyan-400/60 hover:text-cyan-400 font-mono transition-colors">
              Full Analytics
            </Link>
            <span className="text-zinc-700">|</span>
            <Link to="/swap" className="text-[10px] text-cyan-400/60 hover:text-cyan-400 font-mono transition-colors">
              Trade Now
            </Link>
            <span className="text-zinc-700">|</span>
            <Link to="/market-overview" className="text-[10px] text-cyan-400/60 hover:text-cyan-400 font-mono transition-colors">
              Market Overview
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
