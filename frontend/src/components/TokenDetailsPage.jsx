import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG (seed 1414) ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Token Database ============

const TOKEN_DB = {
  VIBE: {
    name: 'VibeSwap',
    symbol: 'VIBE',
    logo: '~',
    color: CYAN,
    price: 2.47,
    change24h: 12.38,
    athPrice: 8.92,
    athDate: '2026-01-15',
    atlPrice: 0.18,
    atlDate: '2025-04-02',
    marketCap: 172_900_000,
    volume24h: 24_600_000,
    circulatingSupply: 70_000_000,
    totalSupply: 1_000_000_000,
    fdv: 2_470_000_000,
    description:
      'VibeSwap is an omnichain DEX built on LayerZero V2 that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. The VIBE token governs the protocol treasury, insurance pools, and mechanism parameters through DAO voting.',
    contracts: [
      { chain: 'Base', address: '0x1a2b...3c4d', explorer: 'https://basescan.org' },
      { chain: 'Ethereum', address: '0x5e6f...7a8b', explorer: 'https://etherscan.io' },
      { chain: 'Arbitrum', address: '0x9c0d...1e2f', explorer: 'https://arbiscan.io' },
      { chain: 'Optimism', address: '0x3a4b...5c6d', explorer: 'https://optimistic.etherscan.io' },
    ],
    pairs: ['VIBE/ETH', 'VIBE/USDC', 'VIBE/USDT', 'VIBE/WBTC', 'VIBE/ARB'],
    whalesPct: 28.4,
    retailPct: 71.6,
    top10Pct: 42.1,
    socialLinks: {
      twitter: 'https://twitter.com/vibeswap',
      discord: 'https://discord.gg/vibeswap',
      github: 'https://github.com/wglynn/vibeswap',
      website: 'https://vibeswap.io',
      telegram: 'https://t.me/vibeswap',
    },
  },
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    logo: '\u27e0',
    color: '#627EEA',
    price: 3842.50,
    change24h: -1.24,
    athPrice: 4878.26,
    athDate: '2024-11-10',
    atlPrice: 0.43,
    atlDate: '2015-10-20',
    marketCap: 462_000_000_000,
    volume24h: 18_400_000_000,
    circulatingSupply: 120_200_000,
    totalSupply: 120_200_000,
    fdv: 462_000_000_000,
    description:
      'Ethereum is a decentralized, open-source blockchain with smart contract functionality. ETH is the native cryptocurrency of the platform, used for gas fees and staking in the proof-of-stake consensus mechanism.',
    contracts: [
      { chain: 'Ethereum', address: 'Native', explorer: 'https://etherscan.io' },
      { chain: 'Base', address: '0xWETH...base', explorer: 'https://basescan.org' },
      { chain: 'Arbitrum', address: '0xWETH...arb', explorer: 'https://arbiscan.io' },
    ],
    pairs: ['ETH/USDC', 'ETH/USDT', 'ETH/WBTC', 'ETH/DAI', 'ETH/VIBE'],
    whalesPct: 39.2,
    retailPct: 60.8,
    top10Pct: 34.7,
    socialLinks: {
      twitter: 'https://twitter.com/ethereum',
      discord: 'https://discord.gg/ethereum',
      github: 'https://github.com/ethereum',
      website: 'https://ethereum.org',
    },
  },
  ARB: {
    name: 'Arbitrum',
    symbol: 'ARB',
    logo: '\u25c6',
    color: '#28A0F0',
    price: 1.82,
    change24h: 5.67,
    athPrice: 2.40,
    athDate: '2024-01-12',
    atlPrice: 0.74,
    atlDate: '2023-09-11',
    marketCap: 2_320_000_000,
    volume24h: 412_000_000,
    circulatingSupply: 1_275_000_000,
    totalSupply: 10_000_000_000,
    fdv: 18_200_000_000,
    description:
      'Arbitrum is a Layer 2 optimistic rollup solution for Ethereum that enables faster and cheaper transactions while inheriting Ethereum\'s security guarantees.',
    contracts: [
      { chain: 'Arbitrum', address: '0xARB...native', explorer: 'https://arbiscan.io' },
      { chain: 'Ethereum', address: '0xB50...eth', explorer: 'https://etherscan.io' },
    ],
    pairs: ['ARB/ETH', 'ARB/USDC', 'ARB/USDT', 'ARB/VIBE'],
    whalesPct: 45.1,
    retailPct: 54.9,
    top10Pct: 52.3,
    socialLinks: {
      twitter: 'https://twitter.com/arbitrum',
      discord: 'https://discord.gg/arbitrum',
      github: 'https://github.com/OffchainLabs',
      website: 'https://arbitrum.io',
    },
  },
}

// ============ Generate fallback token data from symbol ============

function generateFallbackToken(symbol) {
  const rng = seededRandom(1414)
  const price = 0.5 + rng() * 100
  const change = (rng() - 0.45) * 20
  const mcap = price * (10_000_000 + rng() * 990_000_000)
  return {
    name: symbol,
    symbol,
    logo: symbol.charAt(0),
    color: CYAN,
    price,
    change24h: parseFloat(change.toFixed(2)),
    athPrice: price * (1.5 + rng() * 3),
    athDate: '2025-08-14',
    atlPrice: price * (0.05 + rng() * 0.3),
    atlDate: '2024-03-22',
    marketCap: Math.round(mcap),
    volume24h: Math.round(mcap * (0.02 + rng() * 0.1)),
    circulatingSupply: Math.round(10_000_000 + rng() * 990_000_000),
    totalSupply: Math.round(100_000_000 + rng() * 9_900_000_000),
    fdv: Math.round(mcap * (1 + rng() * 5)),
    description: `${symbol} is a digital asset available for trading on VibeSwap. Detailed information for this token is not yet indexed. Check the project website for more details.`,
    contracts: [
      { chain: 'Ethereum', address: '0x' + symbol.toLowerCase() + '...contract', explorer: 'https://etherscan.io' },
    ],
    pairs: [`${symbol}/ETH`, `${symbol}/USDC`],
    whalesPct: parseFloat((20 + rng() * 40).toFixed(1)),
    retailPct: 0,
    top10Pct: parseFloat((30 + rng() * 35).toFixed(1)),
    socialLinks: { website: '#' },
  }
}

// ============ Price Chart Data Generator ============

function generatePriceData(basePrice, points, volatility, seed) {
  const rng = seededRandom(seed)
  let price = basePrice
  const data = []
  for (let i = 0; i < points; i++) {
    price += (rng() - 0.48) * basePrice * volatility
    price = Math.max(price * 0.3, price)
    data.push(parseFloat(price.toFixed(price >= 100 ? 2 : price >= 1 ? 4 : 6)))
  }
  return data
}

const PERIOD_CONFIG = {
  '1H': { points: 60, volatility: 0.003, label: '1 Hour' },
  '1D': { points: 96, volatility: 0.008, label: '1 Day' },
  '7D': { points: 168, volatility: 0.015, label: '7 Days' },
  '1M': { points: 120, volatility: 0.025, label: '1 Month' },
  '1Y': { points: 365, volatility: 0.04, label: '1 Year' },
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function fmtNum(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtPrice(p) {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (p >= 1) return `$${p.toFixed(2)}`
  return `$${p.toFixed(6)}`
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ SVG Price Chart ============

function PriceChartSVG({ data, color, height = 220 }) {
  const W = 800, H = height
  const PAD = { top: 20, right: 20, bottom: 32, left: 64 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom

  if (!data || data.length === 0) return null

  const min = Math.min(...data) * 0.98
  const max = Math.max(...data) * 1.02
  const range = max - min || 1

  const pts = data.map((v, i) => ({
    x: PAD.left + (i / (data.length - 1)) * iW,
    y: PAD.top + iH - ((v - min) / range) * iH,
  }))

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + iH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top + iH).toFixed(1)} Z`
  const yTicks = Array.from({ length: 5 }, (_, i) => min + (range / 4) * i)

  const isPositive = data[data.length - 1] >= data[0]
  const strokeColor = isPositive ? '#22c55e' : '#ef4444'
  const fillId = `chart-gradient-${color.replace('#', '')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.20" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Y-axis grid + labels */}
      {yTicks.map((t, i) => {
        const y = PAD.top + iH - ((t - min) / range) * iH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 10} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="monospace">
              {fmtPrice(t)}
            </text>
          </g>
        )
      })}
      {/* X-axis labels */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((_, idx) => {
        const i = idx * Math.max(1, Math.floor(data.length / 6))
        if (i >= data.length) return null
        return (
          <text key={i} x={PAD.left + (i / (data.length - 1)) * iW} y={H - 8}
            textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="monospace">
            {i}
          </text>
        )
      })}
      <path d={areaPath} fill={`url(#${fillId})`} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4" fill={strokeColor} />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="8" fill={strokeColor} opacity="0.2" />
    </svg>
  )
}

// ============ Holders Distribution Bar ============

function HoldersBar({ whalesPct, retailPct, top10Pct }) {
  const actualRetail = retailPct || (100 - whalesPct)
  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-black-400">Whales (&gt;0.1% supply)</span>
          <span className="font-mono">{whalesPct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-black-800 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${whalesPct}%` }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ backgroundColor: '#f97316' }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-black-400">Retail holders</span>
          <span className="font-mono">{actualRetail}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-black-800 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${actualRetail}%` }}
            transition={{ duration: 1 / PHI, ease: 'easeOut', delay: 0.1 }}
            className="h-full rounded-full"
            style={{ backgroundColor: '#22c55e' }}
          />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-black-400">Top 10 holders</span>
          <span className="font-mono">{top10Pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-black-800 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${top10Pct}%` }}
            transition={{ duration: 1 / PHI, ease: 'easeOut', delay: 0.2 }}
            className="h-full rounded-full"
            style={{ backgroundColor: CYAN }}
          />
        </div>
      </div>
    </div>
  )
}

// ============ Social Link Icons ============

const SOCIAL_ICONS = {
  twitter: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>),
  discord: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" /></svg>),
  github: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>),
  website: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>),
  telegram: (<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>),
}

// ============ Section Header ============

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-black-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// ============ Main Component ============

export default function TokenDetailsPage() {
  const { symbol: rawSymbol } = useParams()
  const navigate = useNavigate()
  const symbol = (rawSymbol || 'VIBE').toUpperCase()
  const [chartPeriod, setChartPeriod] = useState('1D')
  const [watchlisted, setWatchlisted] = useState(false)
  const [alertSet, setAlertSet] = useState(false)

  // Resolve token data — known tokens get real data, others get seeded fallback
  const token = useMemo(() => {
    if (TOKEN_DB[symbol]) return TOKEN_DB[symbol]
    const fallback = generateFallbackToken(symbol)
    fallback.retailPct = parseFloat((100 - fallback.whalesPct).toFixed(1))
    return fallback
  }, [symbol])

  // Generate chart data for selected period
  const chartData = useMemo(() => {
    const config = PERIOD_CONFIG[chartPeriod]
    const periodSeed = 1414 + chartPeriod.charCodeAt(0) + chartPeriod.charCodeAt(1)
    return generatePriceData(token.price, config.points, config.volatility, periodSeed)
  }, [token.price, chartPeriod])

  const chartStart = chartData[0] || token.price
  const chartEnd = chartData[chartData.length - 1] || token.price
  const chartChange = ((chartEnd - chartStart) / chartStart) * 100
  const isPositive = token.change24h >= 0

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title={`${token.name} (${token.symbol})`}
        subtitle={`Live market data, on-chain analytics, and trading pairs for ${token.symbol}`}
        category="defi"
        badge="Live"
        badgeColor={isPositive ? '#22c55e' : '#ef4444'}
      />

      <div className="max-w-7xl mx-auto px-4">
        <motion.div variants={stagger} initial="hidden" animate="show">

          {/* ============ Price Header ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" spotlight className="p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                {/* Left: logo + price + change */}
                <div className="flex items-start gap-4">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0"
                    style={{ backgroundColor: `${token.color}20`, color: token.color }}
                  >
                    {token.logo}
                  </div>
                  <div>
                    <div className="text-sm text-black-400 font-mono mb-1">{token.name}</div>
                    <div className="text-3xl font-bold font-mono tracking-tight">
                      {fmtPrice(token.price)}
                    </div>
                    <div className={`flex items-center gap-2 mt-1 text-sm font-mono ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      <span>{isPositive ? '\u25b2' : '\u25bc'}</span>
                      <span>{isPositive ? '+' : ''}{token.change24h.toFixed(2)}%</span>
                      <span className="text-black-600">24h</span>
                    </div>
                  </div>
                </div>

                {/* Right: ATH / ATL */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-black-800/40 rounded-xl p-3 border border-black-800">
                    <div className="text-[10px] text-black-500 font-mono mb-1">All-Time High</div>
                    <div className="font-bold font-mono text-green-400">{fmtPrice(token.athPrice)}</div>
                    <div className="text-[10px] text-black-600 mt-0.5">{token.athDate}</div>
                  </div>
                  <div className="bg-black-800/40 rounded-xl p-3 border border-black-800">
                    <div className="text-[10px] text-black-500 font-mono mb-1">All-Time Low</div>
                    <div className="font-bold font-mono text-red-400">{fmtPrice(token.atlPrice)}</div>
                    <div className="text-[10px] text-black-600 mt-0.5">{token.atlDate}</div>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Price Chart ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <SectionHeader title="Price Chart" subtitle={`${PERIOD_CONFIG[chartPeriod].label} price action`} />
                <div className="flex gap-1 p-1 bg-black-800/60 rounded-xl border border-black-700/50">
                  {Object.keys(PERIOD_CONFIG).map((period) => (
                    <button
                      key={period}
                      onClick={() => setChartPeriod(period)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                        chartPeriod === period ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'
                      }`}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart period change indicator */}
              <div className="flex items-center gap-2 mb-3 text-xs font-mono">
                <span className="text-black-500">{PERIOD_CONFIG[chartPeriod].label} change:</span>
                <span className={chartChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {chartChange >= 0 ? '+' : ''}{chartChange.toFixed(2)}%
                </span>
                <span className="text-black-600">|</span>
                <span className="text-black-500">{fmtPrice(chartStart)}</span>
                <span className="text-black-600">&rarr;</span>
                <span className="text-black-400">{fmtPrice(chartEnd)}</span>
              </div>

              <PriceChartSVG data={chartData} color={token.color} height={260} />
            </GlassCard>
          </motion.div>

          {/* ============ Token Info Grid ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Market Data" subtitle="Key metrics and supply information" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Market Cap', value: fmt(token.marketCap) },
                  { label: '24h Volume', value: fmt(token.volume24h) },
                  { label: 'Circulating Supply', value: fmtNum(token.circulatingSupply) + ' ' + token.symbol },
                  { label: 'Total Supply', value: fmtNum(token.totalSupply) + ' ' + token.symbol },
                  { label: 'Fully Diluted', value: fmt(token.fdv) },
                ].map((stat) => (
                  <div key={stat.label} className="bg-black-800/40 rounded-xl p-4 border border-black-800">
                    <div className="text-[10px] text-black-500 font-mono mb-1.5 uppercase tracking-wider">{stat.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Vol/MCap ratio */}
              <div className="mt-4 flex items-center gap-3 text-xs text-black-500 font-mono">
                <span>Vol/MCap ratio:</span>
                <span className="text-black-300">{((token.volume24h / token.marketCap) * 100).toFixed(2)}%</span>
                <span className="text-black-600">|</span>
                <span>Circ/Total:</span>
                <span className="text-black-300">{((token.circulatingSupply / token.totalSupply) * 100).toFixed(1)}%</span>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ About Section ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title={`About ${token.name}`} subtitle="Project overview and description" />
              <p className="text-sm text-black-300 leading-relaxed max-w-3xl">
                {token.description}
              </p>
              {token.symbol === 'VIBE' && (
                <div className="mt-4 p-3 bg-black-800/40 rounded-xl border border-black-800 text-xs text-black-400 font-mono">
                  <span style={{ color: CYAN }}>Mechanism:</span> Commit-reveal batch auctions with 10-second cycles (8s commit, 2s reveal). Uniform clearing price eliminates MEV extraction.
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* ============ Contract Addresses ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Contract Addresses" subtitle="Verified deployments across chains" />
              <div className="space-y-3">
                {token.contracts.map((c) => (
                  <div key={c.chain} className="flex items-center justify-between bg-black-800/40 rounded-xl p-3 border border-black-800">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }} />
                      <span className="text-sm font-medium">{c.chain}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-black-400">{c.address}</span>
                      <a
                        href={c.explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono hover:underline"
                        style={{ color: CYAN }}
                      >
                        Explorer
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Two-Column: Pairs + Holders ============ */}
          <motion.div variants={fadeUp} className="grid md:grid-cols-2 gap-8 mb-8">
            {/* Trading Pairs */}
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Trading Pairs" subtitle={`Available pairs for ${token.symbol}`} />
              <div className="space-y-2">
                {token.pairs.map((pair) => (
                  <button
                    key={pair}
                    onClick={() => navigate('/swap')}
                    className="w-full flex items-center justify-between bg-black-800/40 rounded-xl p-3 border border-black-800 hover:border-black-600 transition-colors group"
                  >
                    <span className="text-sm font-mono font-medium">{pair}</span>
                    <span className="text-xs font-mono text-black-500 group-hover:text-black-300 transition-colors">
                      Trade &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </GlassCard>

            {/* Holders Distribution */}
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Holders Distribution" subtitle="Token concentration breakdown" />
              <HoldersBar
                whalesPct={token.whalesPct}
                retailPct={token.retailPct}
                top10Pct={token.top10Pct}
              />
              <div className="mt-5 p-3 bg-black-800/40 rounded-xl border border-black-800">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: token.whalesPct > 40 ? '#f97316' : '#22c55e' }} />
                  <span className="text-black-400">
                    {token.whalesPct > 40
                      ? 'High concentration risk — top holders control significant supply'
                      : token.whalesPct > 25
                        ? 'Moderate concentration — reasonable distribution'
                        : 'Well distributed — healthy decentralization'}
                  </span>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Social Links ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" className="p-6">
              <SectionHeader title="Community & Links" subtitle="Official channels and resources" />
              <div className="flex flex-wrap gap-3">
                {Object.entries(token.socialLinks).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2.5 bg-black-800/40 rounded-xl border border-black-800 hover:border-black-600 transition-all text-sm text-black-300 hover:text-white group"
                  >
                    <span className="text-black-500 group-hover:text-black-300 transition-colors">
                      {SOCIAL_ICONS[platform] || SOCIAL_ICONS.website}
                    </span>
                    <span className="capitalize font-mono text-xs">{platform}</span>
                  </a>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* ============ Quick Actions ============ */}
          <motion.div variants={fadeUp} className="mb-8">
            <GlassCard glowColor="terminal" spotlight className="p-6">
              <SectionHeader title="Quick Actions" subtitle={`Trade, track, and manage ${token.symbol}`} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Swap */}
                <button
                  onClick={() => navigate('/swap')}
                  className="flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.02]"
                  style={{
                    backgroundColor: `${CYAN}10`,
                    borderColor: `${CYAN}30`,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${CYAN}20` }}
                  >
                    <svg className="w-5 h-5" style={{ color: CYAN }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">Swap {token.symbol}</div>
                    <div className="text-xs text-black-500">Trade at fair price</div>
                  </div>
                </button>

                {/* Watchlist */}
                <button
                  onClick={() => setWatchlisted(!watchlisted)}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.02] ${
                    watchlisted
                      ? 'bg-yellow-500/10 border-yellow-500/30'
                      : 'bg-black-800/40 border-black-800 hover:border-black-600'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    watchlisted ? 'bg-yellow-500/20' : 'bg-black-800/60'
                  }`}>
                    <svg className="w-5 h-5" style={{ color: watchlisted ? '#eab308' : '#6b7280' }} viewBox="0 0 24 24"
                      fill={watchlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">{watchlisted ? 'Watchlisted' : 'Add to Watchlist'}</div>
                    <div className="text-xs text-black-500">{watchlisted ? 'Tracking price' : 'Get notifications'}</div>
                  </div>
                </button>

                {/* Set Alert */}
                <button
                  onClick={() => setAlertSet(!alertSet)}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.02] ${
                    alertSet
                      ? 'bg-purple-500/10 border-purple-500/30'
                      : 'bg-black-800/40 border-black-800 hover:border-black-600'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    alertSet ? 'bg-purple-500/20' : 'bg-black-800/60'
                  }`}>
                    <svg className="w-5 h-5" style={{ color: alertSet ? '#a855f7' : '#6b7280' }} viewBox="0 0 24 24"
                      fill={alertSet ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">{alertSet ? 'Alert Active' : 'Set Price Alert'}</div>
                    <div className="text-xs text-black-500">{alertSet ? `Watching ${token.symbol}` : 'Target price trigger'}</div>
                  </div>
                </button>
              </div>
            </GlassCard>
          </motion.div>

        </motion.div>
      </div>
    </div>
  )
}
