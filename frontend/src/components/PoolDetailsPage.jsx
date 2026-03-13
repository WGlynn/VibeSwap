import { useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER = 1 / (PHI * PHI * PHI)
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Token Registry ============
const TOKENS = {
  ETH: { symbol: 'ETH', icon: '\u039E', color: '#627eea' },
  USDC: { symbol: 'USDC', icon: '\uD83D\uDCB5', color: '#2775ca' },
  WBTC: { symbol: 'WBTC', icon: '\u20BF', color: '#f7931a' },
  DAI: { symbol: 'DAI', icon: '\u25C8', color: '#f5ac37' },
  LINK: { symbol: 'LINK', icon: '\u26D3', color: '#2a5ada' },
  UNI: { symbol: 'UNI', icon: '\uD83E\uDD84', color: '#ff007a' },
  ARB: { symbol: 'ARB', icon: '\u2B21', color: '#28a0f0' },
  OP: { symbol: 'OP', icon: '\u2B24', color: '#ff0420' },
  MATIC: { symbol: 'MATIC', icon: '\u2B23', color: '#8247e5' },
  AAVE: { symbol: 'AAVE', icon: '\u25B2', color: '#b6509e' },
}

// ============ Pool Registry ============
const POOL_REGISTRY = {
  'ETH-USDC': { tokenA: 'ETH', tokenB: 'USDC', feeTier: 0.3, baseSeed: 1515 },
  'WBTC-ETH': { tokenA: 'WBTC', tokenB: 'ETH', feeTier: 0.3, baseSeed: 1516 },
  'ETH-DAI': { tokenA: 'ETH', tokenB: 'DAI', feeTier: 0.3, baseSeed: 1517 },
  'LINK-ETH': { tokenA: 'LINK', tokenB: 'ETH', feeTier: 0.05, baseSeed: 1518 },
  'UNI-USDC': { tokenA: 'UNI', tokenB: 'USDC', feeTier: 0.3, baseSeed: 1519 },
  'ARB-ETH': { tokenA: 'ARB', tokenB: 'ETH', feeTier: 0.05, baseSeed: 1520 },
  'OP-ETH': { tokenA: 'OP', tokenB: 'ETH', feeTier: 0.05, baseSeed: 1521 },
  'MATIC-USDC': { tokenA: 'MATIC', tokenB: 'USDC', feeTier: 0.3, baseSeed: 1522 },
  'AAVE-ETH': { tokenA: 'AAVE', tokenB: 'ETH', feeTier: 0.3, baseSeed: 1523 },
  'WBTC-USDC': { tokenA: 'WBTC', tokenB: 'USDC', feeTier: 0.3, baseSeed: 1524 },
}

// ============ Fee Tiers ============
const FEE_TIERS = [
  { value: 0.05, label: '0.05%', desc: 'Best for correlated pairs' },
  { value: 0.3, label: '0.3%', desc: 'Standard for most pairs' },
  { value: 1.0, label: '1%', desc: 'Best for exotic pairs' },
]

// ============ Helpers ============
function fmt(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtCompact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(2)
}

const fmtPct = (n) => `${n.toFixed(2)}%`

function timeAgo(minutesAgo) {
  if (minutesAgo < 1) return 'just now'
  if (minutesAgo < 60) return `${Math.floor(minutesAgo)}m ago`
  if (minutesAgo < 1440) return `${Math.floor(minutesAgo / 60)}h ago`
  return `${Math.floor(minutesAgo / 1440)}d ago`
}

// ============ Generate Pool Data ============
function generatePoolData(poolId) {
  const entry = POOL_REGISTRY[poolId]
  if (!entry) return null

  const rng = seededRandom(1515)
  const tokenA = TOKENS[entry.tokenA]
  const tokenB = TOKENS[entry.tokenB]

  const tvl = 2e6 + rng() * 16e6
  const volume24h = tvl * (0.08 + rng() * 0.22)
  const fees24h = volume24h * (entry.feeTier / 100)
  const apr = 6 + rng() * 38
  const volume7d = volume24h * (5.5 + rng() * 3)
  const fees7d = fees24h * (5.5 + rng() * 3)

  // Token amounts in pool
  const priceA = entry.tokenA === 'ETH' ? 1800 + rng() * 600
    : entry.tokenA === 'WBTC' ? 42000 + rng() * 18000
    : 1 + rng() * 200
  const priceB = entry.tokenB === 'USDC' || entry.tokenB === 'DAI' ? 1
    : entry.tokenB === 'ETH' ? 1800 + rng() * 600
    : 1 + rng() * 100

  const halfTvl = tvl / 2
  const amountA = halfTvl / priceA
  const amountB = halfTvl / priceB
  const ratio = (halfTvl / tvl) * 100

  // Current price
  const currentPrice = priceA / priceB

  // TVL history (30 points)
  const tvlHistory = []
  let tvlVal = tvl * (0.7 + rng() * 0.2)
  for (let i = 0; i < 30; i++) {
    tvlVal = tvlVal * (0.97 + rng() * 0.07)
    tvlHistory.push(tvlVal)
  }
  tvlHistory.push(tvl)

  // Recent swaps
  const swaps = []
  const swapDirections = ['buy', 'sell']
  for (let i = 0; i < 12; i++) {
    const dir = swapDirections[rng() > 0.5 ? 0 : 1]
    const amountIn = 0.1 + rng() * 15
    const swapPriceA = priceA * (0.995 + rng() * 0.01)
    swaps.push({
      id: `swap-${i}`,
      direction: dir,
      tokenIn: dir === 'buy' ? tokenB : tokenA,
      tokenOut: dir === 'buy' ? tokenA : tokenB,
      amountIn: dir === 'buy' ? amountIn * swapPriceA : amountIn,
      amountOut: dir === 'buy' ? amountIn : amountIn * swapPriceA,
      priceImpact: rng() * 0.3,
      minutesAgo: rng() * 240,
      txHash: `0x${Math.floor(rng() * 1e15).toString(16).padStart(12, '0')}...`,
    })
  }
  swaps.sort((a, b) => a.minutesAgo - b.minutesAgo)

  // User position
  const userShare = 0.0042 + rng() * 0.008
  const userValue = tvl * userShare
  const earnedFees = userValue * (0.004 + rng() * 0.012)
  const ilEstimate = -(rng() * 3.5)

  // Insurance
  const insuranceCoverage = rng() > 0.35 ? 75 + rng() * 20 : 0
  const insurancePremium = insuranceCoverage > 0 ? userValue * 0.026 : 0

  // Price range for concentrated liquidity
  const priceLower = currentPrice * (0.7 + rng() * 0.15)
  const priceUpper = currentPrice * (1.15 + rng() * 0.3)

  return {
    id: poolId,
    tokenA, tokenB,
    feeTier: entry.feeTier,
    tvl, volume24h, fees24h, apr,
    volume7d, fees7d,
    priceA, priceB, currentPrice,
    amountA, amountB, ratio,
    tvlHistory,
    swaps,
    userShare, userValue, earnedFees, ilEstimate,
    insuranceCoverage, insurancePremium,
    priceLower, priceUpper,
    totalTransactions: Math.floor(1200 + rng() * 8000),
    uniqueLPs: Math.floor(40 + rng() * 260),
    createdDaysAgo: Math.floor(30 + rng() * 300),
  }
}

// ============ SVG TVL Chart ============
function TVLChart({ data, width = 600, height = 180 }) {
  const points = useMemo(() => {
    if (!data || data.length < 2) return ''
    const min = Math.min(...data) * 0.95
    const max = Math.max(...data) * 1.05
    const range = max - min || 1
    return data.map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 20) - 10
      return `${x},${y}`
    }).join(' ')
  }, [data, width, height])

  const areaPath = useMemo(() => {
    if (!data || data.length < 2) return ''
    const min = Math.min(...data) * 0.95
    const max = Math.max(...data) * 1.05
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 20) - 10
      return `${x},${y}`
    })
    return `M${pts[0]} L${pts.join(' L')} L${width},${height} L0,${height} Z`
  }, [data, width, height])

  const lastValue = data?.[data.length - 1]
  const firstValue = data?.[0]
  const change = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0
  const isUp = change >= 0

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
        <defs>
          <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.25" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 1, 2, 3].map(i => (
          <line key={i} x1="0" y1={10 + i * ((height - 20) / 3)}
            x2={width} y2={10 + i * ((height - 20) / 3)}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        ))}
        {/* Area fill */}
        <path d={areaPath} fill="url(#tvlGradient)" />
        {/* Line */}
        <polyline points={points} fill="none" stroke={CYAN} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Endpoint dot */}
        {data && data.length > 1 && (() => {
          const min = Math.min(...data) * 0.95
          const max = Math.max(...data) * 1.05
          const range = max - min || 1
          const cx = width
          const cy = height - ((data[data.length - 1] - min) / range) * (height - 20) - 10
          return (
            <g>
              <circle cx={cx} cy={cy} r="5" fill={CYAN} opacity="0.3" />
              <circle cx={cx} cy={cy} r="3" fill={CYAN} />
            </g>
          )
        })()}
      </svg>
      {/* Change badge */}
      <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-[10px] font-mono font-semibold ${isUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
        {isUp ? '+' : ''}{change.toFixed(1)}% (30d)
      </div>
    </div>
  )
}

// ============ Price Range Visualizer ============
function PriceRangeBar({ currentPrice, priceLower, priceUpper }) {
  const vizMin = priceLower * 0.8
  const vizMax = priceUpper * 1.2
  const range = vizMax - vizMin || 1

  const lowPct = ((priceLower - vizMin) / range) * 100
  const highPct = ((priceUpper - vizMin) / range) * 100
  const currentPct = ((currentPrice - vizMin) / range) * 100
  const inRange = currentPrice >= priceLower && currentPrice <= priceUpper

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] font-mono text-black-500">
        <span>{priceLower.toFixed(2)}</span>
        <span className={inRange ? 'text-green-400' : 'text-amber-400'}>
          Current: {currentPrice.toFixed(2)}
        </span>
        <span>{priceUpper.toFixed(2)}</span>
      </div>
      <div className="relative h-3 rounded-full bg-black-800 overflow-hidden">
        {/* Active range */}
        <div className="absolute top-0 h-full rounded-full"
          style={{
            left: `${lowPct}%`,
            width: `${highPct - lowPct}%`,
            background: `linear-gradient(90deg, ${CYAN}33, ${CYAN}66, ${CYAN}33)`,
          }} />
        {/* Current price marker */}
        <div className="absolute top-0 h-full w-0.5"
          style={{
            left: `${Math.min(Math.max(currentPct, 0), 100)}%`,
            backgroundColor: inRange ? '#22c55e' : '#f59e0b',
          }} />
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${inRange ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
        <span className={`text-[11px] font-medium ${inRange ? 'text-green-400' : 'text-amber-400'}`}>
          {inRange ? 'In Range — Earning Fees' : 'Out of Range — Not Earning'}
        </span>
      </div>
    </div>
  )
}

// ============ Composition Bar ============
function CompositionBar({ tokenA, tokenB, amountA, amountB, priceA, priceB }) {
  const valueA = amountA * priceA
  const valueB = amountB * priceB
  const total = valueA + valueB || 1
  const pctA = (valueA / total) * 100
  const pctB = (valueB / total) * 100

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 h-4 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pctA}%` }}
          transition={{ duration: STAGGER * PHI * 2, ease: EASE }}
          className="h-full rounded-l-full"
          style={{ backgroundColor: tokenA.color || CYAN }}
        />
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${pctB}%` }}
          transition={{ duration: STAGGER * PHI * 2, delay: STAGGER, ease: EASE }}
          className="h-full rounded-r-full"
          style={{ backgroundColor: tokenB.color || '#22c55e' }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{tokenA.icon}</span>
          <div>
            <div className="text-sm font-semibold">{tokenA.symbol}</div>
            <div className="text-[10px] text-black-500 font-mono">{fmtCompact(amountA)} ({pctA.toFixed(1)}%)</div>
            <div className="text-[11px] font-mono" style={{ color: CYAN }}>{fmt(valueA)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end text-right">
          <div>
            <div className="text-sm font-semibold">{tokenB.symbol}</div>
            <div className="text-[10px] text-black-500 font-mono">{fmtCompact(amountB)} ({pctB.toFixed(1)}%)</div>
            <div className="text-[11px] font-mono" style={{ color: CYAN }}>{fmt(valueB)}</div>
          </div>
          <span className="text-2xl">{tokenB.icon}</span>
        </div>
      </div>
    </div>
  )
}

// ============ Swap Row ============
function SwapRow({ swap, index }) {
  const isBuy = swap.direction === 'buy'
  return (
    <motion.tr
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * STAGGER * 0.3, duration: STAGGER * PHI }}
      className="border-b border-black-700/20 last:border-0 hover:bg-white/[0.015] transition-colors"
    >
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isBuy ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className={`text-xs font-medium ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
            {isBuy ? 'Buy' : 'Sell'}
          </span>
        </div>
      </td>
      <td className="py-2.5 px-3 text-right">
        <div className="text-xs font-mono">{swap.amountIn.toFixed(4)} {swap.tokenIn.symbol}</div>
      </td>
      <td className="py-2.5 px-3 text-center text-black-600">&rarr;</td>
      <td className="py-2.5 px-3">
        <div className="text-xs font-mono">{swap.amountOut.toFixed(4)} {swap.tokenOut.symbol}</div>
      </td>
      <td className="py-2.5 px-3 text-right hidden sm:table-cell">
        <span className="text-[10px] text-black-500 font-mono">{swap.priceImpact.toFixed(3)}%</span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <span className="text-[10px] text-black-500">{timeAgo(swap.minutesAgo)}</span>
      </td>
    </motion.tr>
  )
}

// ============ Add/Remove Liquidity Form ============
function LiquidityForm({ pool }) {
  const [mode, setMode] = useState('add')
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [removePercent, setRemovePercent] = useState(50)

  const estimatedB = useMemo(() => {
    if (!amountA || mode !== 'add') return ''
    const ratio = pool.priceA / pool.priceB
    return (parseFloat(amountA) * ratio).toFixed(6)
  }, [amountA, mode, pool.priceA, pool.priceB])

  const handleAmountAChange = useCallback((e) => {
    setAmountA(e.target.value)
    if (e.target.value && mode === 'add') {
      const ratio = pool.priceA / pool.priceB
      setAmountB((parseFloat(e.target.value) * ratio).toFixed(6))
    }
  }, [mode, pool.priceA, pool.priceB])

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-xl overflow-hidden border border-black-700/50">
        {['add', 'remove'].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              mode === m
                ? 'bg-gradient-to-r from-cyan-500/15 to-cyan-500/5 text-cyan-400'
                : 'bg-black-900/40 text-black-500 hover:text-black-300'
            }`}>
            {m === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {mode === 'add' ? (
          <motion.div key="add"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: STAGGER * PHI, ease: EASE }}
            className="space-y-3"
          >
            {/* Token A Input */}
            <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
              <div className="flex justify-between mb-2">
                <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">Deposit {pool.tokenA.symbol}</span>
                <span className="text-[10px] text-black-500">Balance: --</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="number" value={amountA} onChange={handleAmountAChange}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-xl font-mono font-medium outline-none placeholder-black-600" />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black-700/80 border border-black-600/50">
                  <span className="text-lg">{pool.tokenA.icon}</span>
                  <span className="text-sm font-semibold">{pool.tokenA.symbol}</span>
                </div>
              </div>
            </div>

            {/* Plus icon */}
            <div className="flex justify-center -my-1">
              <div className="p-1.5 rounded-lg bg-black-800 border border-black-700/50">
                <svg className="w-4 h-4 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
                </svg>
              </div>
            </div>

            {/* Token B Input */}
            <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
              <div className="flex justify-between mb-2">
                <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">Deposit {pool.tokenB.symbol}</span>
                <span className="text-[10px] text-black-500">Balance: --</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="number" value={amountB}
                  onChange={(e) => setAmountB(e.target.value)}
                  placeholder={estimatedB || '0.00'}
                  className="flex-1 bg-transparent text-xl font-mono font-medium outline-none placeholder-black-600" />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black-700/80 border border-black-600/50">
                  <span className="text-lg">{pool.tokenB.icon}</span>
                  <span className="text-sm font-semibold">{pool.tokenB.symbol}</span>
                </div>
              </div>
            </div>

            {/* Supply button */}
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              disabled={!amountA || !amountB}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: amountA && amountB
                  ? `linear-gradient(135deg, ${CYAN}, #0891b2)`
                  : undefined,
                color: amountA && amountB ? '#000' : undefined,
              }}
            >
              Supply Liquidity
            </motion.button>
          </motion.div>
        ) : (
          <motion.div key="remove"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: STAGGER * PHI, ease: EASE }}
            className="space-y-4"
          >
            {/* Percentage slider */}
            <div className="p-4 rounded-xl bg-black-900/80 border border-black-700/50">
              <div className="flex justify-between mb-3">
                <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">Remove Amount</span>
                <span className="text-lg font-semibold font-mono" style={{ color: CYAN }}>{removePercent}%</span>
              </div>
              <input type="range" min="0" max="100" value={removePercent}
                onChange={(e) => setRemovePercent(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-black-700 cursor-pointer"
                style={{ accentColor: CYAN }}
              />
              <div className="flex justify-between mt-3 gap-2">
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setRemovePercent(pct)}
                    className={`flex-1 py-1.5 text-xs font-mono rounded-lg border transition-all ${
                      removePercent === pct
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                        : 'border-black-700/50 text-black-500 hover:text-black-300'
                    }`}>
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* You will receive */}
            <div className="p-4 rounded-xl bg-black-800/60 border border-black-700/30 space-y-2">
              <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">You will receive</span>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{pool.tokenA.icon}</span>
                  <span className="text-sm font-semibold">{pool.tokenA.symbol}</span>
                </div>
                <span className="text-sm font-mono">{(pool.amountA * pool.userShare * removePercent / 100).toFixed(4)}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{pool.tokenB.icon}</span>
                  <span className="text-sm font-semibold">{pool.tokenB.symbol}</span>
                </div>
                <span className="text-sm font-mono">{(pool.amountB * pool.userShare * removePercent / 100).toFixed(4)}</span>
              </div>
            </div>

            {/* Remove button */}
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
              disabled={removePercent === 0}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed">
              Remove Liquidity
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Insurance Badge ============
function InsuranceBadge({ coverage, premium, userValue }) {
  const isCovered = coverage > 0
  const coveredAmount = userValue * (coverage / 100)

  return (
    <div className={`p-4 rounded-xl border ${
      isCovered ? 'bg-green-500/5 border-green-500/15' : 'bg-amber-500/5 border-amber-500/15'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${isCovered ? 'text-green-400' : 'text-amber-400'}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className={`text-xs font-semibold ${isCovered ? 'text-green-400' : 'text-amber-400'}`}>
            {isCovered ? 'IL Protection Active' : 'Unprotected Position'}
          </span>
        </div>
        {isCovered && (
          <span className="text-[10px] font-mono text-green-400/70">{coverage.toFixed(0)}% covered</span>
        )}
      </div>
      {isCovered ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-black-500 mb-0.5">Covered Amount</div>
            <div className="text-sm font-semibold font-mono text-green-400">{fmt(coveredAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-black-500 mb-0.5">Annual Premium</div>
            <div className="text-sm font-semibold font-mono">{fmt(premium)}</div>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[11px] text-black-400 mb-3">
            Protect your position from impermanent loss with VibeSwap Insurance.
          </p>
          <button className="w-full py-2 text-xs font-medium rounded-lg border border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-colors">
            Get Coverage
          </button>
        </div>
      )}
    </div>
  )
}

// ============ Main Component ============
function PoolDetailsPage() {
  const { poolId } = useParams()
  const [showAllSwaps, setShowAllSwaps] = useState(false)

  const resolvedId = poolId || 'ETH-USDC'
  const pool = useMemo(() => generatePoolData(resolvedId), [resolvedId])

  if (!pool) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <GlassCard glowColor="warning" className="p-8 text-center max-w-md">
          <span className="text-4xl mb-4 block">&#x26A0;</span>
          <h2 className="text-lg font-semibold mb-2">Pool Not Found</h2>
          <p className="text-sm text-black-400">
            The pool "{poolId}" does not exist or has not been created yet.
          </p>
        </GlassCard>
      </div>
    )
  }

  const visibleSwaps = showAllSwaps ? pool.swaps : pool.swaps.slice(0, 6)

  return (
    <div className="min-h-screen">
      <PageHero
        category="defi"
        title="Pool Details"
        subtitle={`${pool.tokenA.symbol}/${pool.tokenB.symbol} liquidity pool — commit-reveal batch auction settlement`}
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 pb-12">

        {/* ============ Pool Header ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: STAGGER, duration: STAGGER * PHI, ease: EASE }}
          className="mb-8"
        >
          <GlassCard glowColor="terminal" spotlight className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  <span className="text-4xl">{pool.tokenA.icon}</span>
                  <span className="text-4xl">{pool.tokenB.icon}</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    {pool.tokenA.symbol}/{pool.tokenB.symbol}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold"
                      style={{ backgroundColor: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>
                      {pool.feeTier}% fee
                    </span>
                    <span className="text-[10px] text-black-500 font-mono">
                      {pool.uniqueLPs} LPs &middot; {pool.createdDaysAgo}d old
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-black-500 font-mono mb-0.5">Current Price</div>
                <div className="text-lg font-semibold font-mono" style={{ color: CYAN }}>
                  {pool.currentPrice.toFixed(4)}
                </div>
                <div className="text-[10px] text-black-500 font-mono">
                  {pool.tokenB.symbol} per {pool.tokenA.symbol}
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-5 border-t border-black-700/40">
              {[
                ['TVL', fmt(pool.tvl), null],
                ['Volume 24h', fmt(pool.volume24h), null],
                ['Fees 24h', fmt(pool.fees24h), null],
                ['APR', fmtPct(pool.apr), 'text-green-400'],
                ['Transactions', pool.totalTransactions.toLocaleString(), null],
              ].map(([label, value, colorClass]) => (
                <div key={label}>
                  <div className="text-[10px] text-black-500 font-mono uppercase tracking-wider mb-0.5">{label}</div>
                  <div className={`text-sm font-semibold font-mono ${colorClass || ''}`}>{value}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Two Column Layout ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ============ Left Column (2/3) ============ */}
          <div className="lg:col-span-2 space-y-6">

            {/* TVL Chart */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 2, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="overflow-hidden">
                <div className="px-5 pt-5 pb-2">
                  <h3 className="text-sm font-semibold mb-1">Total Value Locked</h3>
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-bold font-mono">{fmt(pool.tvl)}</span>
                    <span className="text-[10px] text-black-500 font-mono">30 day history</span>
                  </div>
                </div>
                <div className="px-2 pb-3">
                  <TVLChart data={pool.tvlHistory} />
                </div>
              </GlassCard>
            </motion.div>

            {/* Pool Composition */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 3, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Pool Composition</h3>
                <CompositionBar
                  tokenA={pool.tokenA} tokenB={pool.tokenB}
                  amountA={pool.amountA} amountB={pool.amountB}
                  priceA={pool.priceA} priceB={pool.priceB}
                />
              </GlassCard>
            </motion.div>

            {/* Price Range */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 4, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Price Range (Concentrated Liquidity)</h3>
                <PriceRangeBar
                  currentPrice={pool.currentPrice}
                  priceLower={pool.priceLower}
                  priceUpper={pool.priceUpper}
                />
              </GlassCard>
            </motion.div>

            {/* Recent Swaps */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 5, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="overflow-hidden">
                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Recent Swaps</h3>
                  <span className="text-[10px] font-mono text-black-500">{pool.swaps.length} trades</span>
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black-700/40">
                        {['Type', 'In', '', 'Out', 'Impact', 'Time'].map((h, i) => (
                          <th key={h} className={`py-2 px-3 text-[10px] font-mono uppercase tracking-wider text-black-500 ${
                            i === 0 ? 'text-left' : i === 2 ? 'text-center' : i === 3 ? 'text-left' : 'text-right'
                          } ${(h === 'Impact') ? 'hidden sm:table-cell' : ''}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSwaps.map((swap, i) => (
                        <SwapRow key={swap.id} swap={swap} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden px-4 pb-4 space-y-2">
                  {visibleSwaps.map((swap, i) => (
                    <motion.div key={swap.id}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: i * STAGGER * 0.3 }}
                      className="flex items-center justify-between p-3 rounded-lg bg-black-900/50 border border-black-700/30"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${swap.direction === 'buy' ? 'bg-green-400' : 'bg-red-400'}`} />
                        <div>
                          <div className="text-xs font-mono">
                            {swap.amountIn.toFixed(2)} {swap.tokenIn.symbol}
                          </div>
                          <div className="text-[10px] text-black-500">{timeAgo(swap.minutesAgo)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono">
                          {swap.amountOut.toFixed(2)} {swap.tokenOut.symbol}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {pool.swaps.length > 6 && (
                  <div className="px-5 pb-4">
                    <button onClick={() => setShowAllSwaps(!showAllSwaps)}
                      className="w-full py-2 text-xs font-medium text-black-400 hover:text-black-200 transition-colors rounded-lg border border-black-700/30 hover:border-black-600">
                      {showAllSwaps ? 'Show Less' : `View All ${pool.swaps.length} Trades`}
                    </button>
                  </div>
                )}
              </GlassCard>
            </motion.div>

            {/* Fee Tier Display */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 6, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Fee Tiers</h3>
                <div className="grid grid-cols-3 gap-3">
                  {FEE_TIERS.map(tier => {
                    const isActive = tier.value === pool.feeTier
                    return (
                      <div key={tier.value}
                        className={`p-3 rounded-xl border text-center transition-all ${
                          isActive
                            ? 'border-cyan-500/40 bg-cyan-500/10'
                            : 'border-black-700/40 bg-black-900/40'
                        }`}
                      >
                        <div className={`text-lg font-bold font-mono ${isActive ? 'text-cyan-400' : 'text-black-400'}`}>
                          {tier.label}
                        </div>
                        <div className="text-[10px] text-black-500 mt-1">{tier.desc}</div>
                        {isActive && (
                          <div className="mt-2 text-[9px] font-mono uppercase tracking-wider" style={{ color: CYAN }}>
                            Active
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-black-700/30">
                  <div>
                    <div className="text-[10px] text-black-500 mb-0.5">7d Fees Earned</div>
                    <div className="text-sm font-semibold font-mono" style={{ color: CYAN }}>{fmt(pool.fees7d)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-black-500 mb-0.5">7d Volume</div>
                    <div className="text-sm font-semibold font-mono">{fmt(pool.volume7d)}</div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </div>

          {/* ============ Right Column (1/3) ============ */}
          <div className="space-y-6">

            {/* Your Position */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 2.5, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard glowColor="terminal" spotlight className="p-5">
                <h3 className="text-sm font-semibold mb-4">Your Position</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">Liquidity</div>
                      <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>
                        {fmt(pool.userValue)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">Pool Share</div>
                      <div className="text-lg font-bold font-mono">
                        {(pool.userShare * 100).toFixed(4)}%
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-black-700/40" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">Earned Fees</div>
                      <div className="text-sm font-semibold font-mono text-green-400">
                        +{fmt(pool.earnedFees)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">IL Estimate</div>
                      <div className={`text-sm font-semibold font-mono ${
                        pool.ilEstimate < -2 ? 'text-red-400' : pool.ilEstimate < -0.5 ? 'text-amber-400' : 'text-green-400'
                      }`}>
                        {pool.ilEstimate > 0 ? '+' : ''}{fmtPct(pool.ilEstimate)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">{pool.tokenA.symbol}</div>
                      <div className="text-sm font-mono">
                        {(pool.amountA * pool.userShare).toFixed(4)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-black-500 font-mono mb-0.5">{pool.tokenB.symbol}</div>
                      <div className="text-sm font-mono">
                        {(pool.amountB * pool.userShare).toFixed(4)}
                      </div>
                    </div>
                  </div>

                  <div className="h-px bg-black-700/40" />

                  {/* Net P&L */}
                  <div>
                    <div className="text-[10px] text-black-500 font-mono mb-0.5">Net P&L (Fees - IL)</div>
                    {(() => {
                      const netPnl = pool.earnedFees + (pool.userValue * pool.ilEstimate / 100)
                      return (
                        <div className={`text-sm font-semibold font-mono ${netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {netPnl >= 0 ? '+' : ''}{fmt(Math.abs(netPnl))} {netPnl < 0 ? '(loss)' : ''}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* Insurance Coverage */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 3.5, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Insurance Coverage</h3>
                <InsuranceBadge
                  coverage={pool.insuranceCoverage}
                  premium={pool.insurancePremium}
                  userValue={pool.userValue}
                />
              </GlassCard>
            </motion.div>

            {/* Add/Remove Liquidity Form */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 4.5, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Manage Liquidity</h3>
                <LiquidityForm pool={pool} />
              </GlassCard>
            </motion.div>

            {/* Pool Info Summary */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: STAGGER * 5.5, duration: STAGGER * PHI, ease: EASE }}
            >
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold mb-4">Pool Info</h3>
                <div className="space-y-3">
                  {[
                    ['Protocol', 'VibeSwap AMM'],
                    ['Settlement', 'Commit-Reveal Batch'],
                    ['Batch Duration', '10s (8s commit + 2s reveal)'],
                    ['MEV Protection', 'Active'],
                    ['Oracle', 'Kalman Filter TWAP'],
                    ['Fee Tier', `${pool.feeTier}%`],
                    ['Unique LPs', pool.uniqueLPs.toString()],
                    ['Pool Age', `${pool.createdDaysAgo} days`],
                    ['Shapley Rewards', 'Enabled'],
                    ['Circuit Breakers', 'Active'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-[11px] text-black-500">{label}</span>
                      <span className="text-[11px] font-mono font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default PoolDetailsPage
