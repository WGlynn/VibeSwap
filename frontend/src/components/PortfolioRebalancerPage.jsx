import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Token Definitions ============
const TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',       color: '#627EEA', logo: '⟠' },
  { symbol: 'BTC',  name: 'Bitcoin',         color: '#F7931A', logo: '₿' },
  { symbol: 'USDC', name: 'USD Coin',        color: '#2775CA', logo: '$' },
  { symbol: 'USDT', name: 'Tether',          color: '#26A17B', logo: '$' },
  { symbol: 'ARB',  name: 'Arbitrum',        color: '#28A0F0', logo: '◈' },
  { symbol: 'OP',   name: 'Optimism',        color: '#FF0420', logo: '⊕' },
  { symbol: 'MATIC',name: 'Polygon',         color: '#8247E5', logo: '⬠' },
  { symbol: 'LINK', name: 'Chainlink',       color: '#2A5ADA', logo: '⬡' },
]

// ============ Mock Portfolio Data ============
function generatePortfolio(seed) {
  const rng = seededRandom(seed)
  const weights = TOKENS.map(() => rng() * 100)
  const total = weights.reduce((a, b) => a + b, 0)
  const normalized = weights.map(w => (w / total) * 100)

  const totalValue = 12847.53
  return TOKENS.map((token, i) => ({
    ...token,
    allocation: parseFloat(normalized[i].toFixed(1)),
    value: parseFloat((totalValue * normalized[i] / 100).toFixed(2)),
    amount: parseFloat(((totalValue * normalized[i] / 100) / (rng() * 3000 + 1)).toFixed(4)),
  }))
}

// ============ Preset Templates ============
const TEMPLATES = [
  {
    name: 'Conservative',
    description: '60% stablecoins, low volatility',
    icon: '🛡',
    allocations: { ETH: 15, BTC: 10, USDC: 35, USDT: 25, ARB: 5, OP: 3, MATIC: 5, LINK: 2 },
  },
  {
    name: 'Balanced',
    description: 'Even split between majors and stables',
    icon: '⚖',
    allocations: { ETH: 25, BTC: 20, USDC: 15, USDT: 10, ARB: 10, OP: 8, MATIC: 7, LINK: 5 },
  },
  {
    name: 'Aggressive',
    description: 'Heavy on majors and L2 tokens',
    icon: '⚡',
    allocations: { ETH: 35, BTC: 25, USDC: 5, USDT: 5, ARB: 12, OP: 8, MATIC: 5, LINK: 5 },
  },
  {
    name: 'DeFi-Heavy',
    description: 'Max exposure to DeFi ecosystem',
    icon: '◇',
    allocations: { ETH: 20, BTC: 5, USDC: 10, USDT: 5, ARB: 20, OP: 15, MATIC: 15, LINK: 10 },
  },
]

// ============ Animation Variants ============
const fadeIn = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1 / (PHI * PHI), delay, ease: [0.25, 0.1, 1 / PHI, 1] },
})

const stagger = (index) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1 / (PHI * PHI), delay: index * (1 / (PHI * PHI * PHI * PHI)), ease: [0.25, 0.1, 1 / PHI, 1] },
})

// ============ SVG Pie Chart ============
function PieChart({ data, size = 200 }) {
  const total = data.reduce((sum, d) => sum + d.allocation, 0)
  let cumulative = 0

  const slices = data.map((item) => {
    const startAngle = (cumulative / total) * 360
    const sliceAngle = (item.allocation / total) * 360
    cumulative += item.allocation

    const startRad = ((startAngle - 90) * Math.PI) / 180
    const endRad = (((startAngle + sliceAngle) - 90) * Math.PI) / 180
    const r = size / 2 - 4
    const cx = size / 2
    const cy = size / 2

    const x1 = cx + r * Math.cos(startRad)
    const y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad)
    const y2 = cy + r * Math.sin(endRad)

    const largeArc = sliceAngle > 180 ? 1 : 0

    const path = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ')

    return { ...item, path }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-lg">
      {slices.map((slice, i) => (
        <motion.path
          key={slice.symbol}
          d={slice.path}
          fill={slice.color}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="1"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.85, scale: 1 }}
          transition={{ duration: 0.4, delay: i * 0.06 }}
          className="hover:opacity-100 cursor-pointer transition-opacity"
        />
      ))}
      {/* Center hole for donut style */}
      <circle cx={size / 2} cy={size / 2} r={size / 4.5} fill="#0a0a0a" stroke="rgba(37,37,37,1)" strokeWidth="1" />
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="fill-white font-mono text-xs font-bold">$12,847</text>
      <text x={size / 2} y={size / 2 + 10} textAnchor="middle" className="fill-gray-400 font-mono" style={{ fontSize: '9px' }}>Total Value</text>
    </svg>
  )
}

// ============ Drift Indicator ============
function DriftBadge({ drift }) {
  const absDrift = Math.abs(drift)
  let color, bg, border, label

  if (absDrift < 1) {
    color = 'text-green-400'
    bg = 'bg-green-500/10'
    border = 'border-green-500/20'
    label = 'On Target'
  } else if (absDrift < 3) {
    color = 'text-yellow-400'
    bg = 'bg-yellow-500/10'
    border = 'border-yellow-500/20'
    label = 'Minor Drift'
  } else if (absDrift < 5) {
    color = 'text-orange-400'
    bg = 'bg-orange-500/10'
    border = 'border-orange-500/20'
    label = 'Moderate'
  } else {
    color = 'text-red-400'
    bg = 'bg-red-500/10'
    border = 'border-red-500/20'
    label = 'High Drift'
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono ${bg} ${color} border ${border}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: absDrift < 1 ? '#22c55e' : absDrift < 3 ? '#eab308' : absDrift < 5 ? '#f97316' : '#ef4444' }} />
      {label}
    </span>
  )
}

// ============ Slider Component ============
function AllocationSlider({ token, value, onChange, locked }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex items-center gap-2 w-24 shrink-0">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ backgroundColor: token.color + '22', color: token.color }}
        >
          {token.logo}
        </div>
        <span className="text-sm font-mono text-white">{token.symbol}</span>
      </div>
      <div className="flex-1 relative">
        <input
          type="range"
          min="0"
          max="100"
          step="0.5"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={locked}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${token.color} 0%, ${token.color} ${value}%, rgba(37,37,37,1) ${value}%, rgba(37,37,37,1) 100%)`,
            opacity: locked ? 0.5 : 1,
          }}
        />
      </div>
      <div className="w-16 shrink-0 text-right">
        <span className="text-sm font-mono" style={{ color: token.color }}>{value.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// ============ Main Component ============
export default function PortfolioRebalancerPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Portfolio state
  const portfolio = useMemo(() => generatePortfolio(42), [])
  const totalValue = useMemo(() => portfolio.reduce((sum, p) => sum + p.value, 0), [portfolio])

  // Target allocations
  const [targets, setTargets] = useState(() => {
    const init = {}
    portfolio.forEach(p => { init[p.symbol] = p.allocation })
    return init
  })

  const [activeTemplate, setActiveTemplate] = useState(null)
  const [lockedTokens, setLockedTokens] = useState({})
  const [rebalancing, setRebalancing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Auto-rebalance settings
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoFrequency, setAutoFrequency] = useState('daily')
  const [driftThreshold, setDriftThreshold] = useState(5)
  const [gasBudget, setGasBudget] = useState(0.01)
  const [maxSlippage, setMaxSlippage] = useState(0.5)

  // Target sum validation
  const targetSum = useMemo(() =>
    Object.values(targets).reduce((a, b) => a + b, 0),
    [targets]
  )
  const isValidAllocation = Math.abs(targetSum - 100) < 0.5

  // Drift analysis
  const drifts = useMemo(() =>
    portfolio.map(p => ({
      ...p,
      target: targets[p.symbol] || 0,
      drift: (p.allocation) - (targets[p.symbol] || 0),
      absDrift: Math.abs(p.allocation - (targets[p.symbol] || 0)),
    })).sort((a, b) => b.absDrift - a.absDrift),
    [portfolio, targets]
  )

  const maxDrift = useMemo(() =>
    Math.max(...drifts.map(d => d.absDrift)),
    [drifts]
  )

  const avgDrift = useMemo(() =>
    drifts.reduce((sum, d) => sum + d.absDrift, 0) / drifts.length,
    [drifts]
  )

  // Rebalance trades
  const trades = useMemo(() => {
    const rng = seededRandom(777)
    return drifts
      .filter(d => d.absDrift > 0.3)
      .map(d => {
        const tradeValue = Math.abs(d.drift / 100) * totalValue
        const fee = tradeValue * 0.003
        const slippage = rng() * 0.3
        return {
          ...d,
          action: d.drift > 0 ? 'SELL' : 'BUY',
          tradeValue: parseFloat(tradeValue.toFixed(2)),
          fee: parseFloat(fee.toFixed(4)),
          slippage: parseFloat(slippage.toFixed(2)),
        }
      })
      .sort((a, b) => b.tradeValue - a.tradeValue)
  }, [drifts, totalValue])

  const totalFees = useMemo(() =>
    trades.reduce((sum, t) => sum + t.fee, 0),
    [trades]
  )

  // Handlers
  const handleTargetChange = (symbol, value) => {
    if (lockedTokens[symbol]) return
    setTargets(prev => ({ ...prev, [symbol]: value }))
    setActiveTemplate(null)
  }

  const applyTemplate = (template) => {
    setTargets({ ...template.allocations })
    setActiveTemplate(template.name)
  }

  const toggleLock = (symbol) => {
    setLockedTokens(prev => ({ ...prev, [symbol]: !prev[symbol] }))
  }

  const normalizeTargets = () => {
    const sum = Object.values(targets).reduce((a, b) => a + b, 0)
    if (sum === 0) return
    const normalized = {}
    for (const [key, val] of Object.entries(targets)) {
      normalized[key] = parseFloat(((val / sum) * 100).toFixed(1))
    }
    // Fix rounding
    const newSum = Object.values(normalized).reduce((a, b) => a + b, 0)
    const diff = 100 - newSum
    const firstKey = Object.keys(normalized)[0]
    normalized[firstKey] = parseFloat((normalized[firstKey] + diff).toFixed(1))
    setTargets(normalized)
  }

  const handleRebalance = () => {
    setRebalancing(true)
    setTimeout(() => {
      setRebalancing(false)
      setShowPreview(false)
    }, 2400)
  }

  // ============ Render ============
  return (
    <div className="min-h-screen">
      <PageHero
        title="Portfolio Rebalancer"
        subtitle="Set target allocations and auto-rebalance"
        category="defi"
        badge="Beta"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 pb-12">
        {/* Not connected state */}
        {!isConnected && (
          <motion.div {...fadeIn(0)}>
            <GlassCard glowColor="terminal" className="p-8 text-center mb-8">
              <div className="text-4xl mb-4">◎</div>
              <h2 className="text-xl font-mono font-bold text-white mb-2">Connect to Rebalance</h2>
              <p className="text-sm font-mono text-gray-400 mb-4 max-w-md mx-auto">
                Sign in to view your portfolio, set target allocations, and execute one-click rebalancing across all positions.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-mono text-sm font-medium transition-all"
                style={{ backgroundColor: CYAN + '18', color: CYAN, border: `1px solid ${CYAN}33` }}
              >
                Sign In to Continue
              </Link>
            </GlassCard>
          </motion.div>
        )}

        {isConnected && (
          <>
            {/* ============ Current Portfolio Section ============ */}
            <motion.div {...fadeIn(0)}>
              <GlassCard glowColor="terminal" spotlight className="p-6 mb-6">
                <h2 className="text-lg font-mono font-bold text-white mb-4 flex items-center gap-2">
                  <span style={{ color: CYAN }}>◎</span> Current Portfolio
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Pie Chart */}
                  <div className="flex items-center justify-center">
                    <PieChart data={portfolio} size={220} />
                  </div>

                  {/* Token Breakdown */}
                  <div className="space-y-1">
                    {portfolio.map((token, i) => (
                      <motion.div key={token.symbol} {...stagger(i)}>
                        <div className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ backgroundColor: token.color + '22', color: token.color }}
                            >
                              {token.logo}
                            </div>
                            <div>
                              <span className="text-sm font-mono text-white">{token.symbol}</span>
                              <span className="text-[10px] font-mono text-gray-500 ml-2">{token.name}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono text-white">${token.value.toLocaleString()}</div>
                            <div className="text-[10px] font-mono" style={{ color: token.color }}>
                              {token.allocation.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-800 px-3">
                      <span className="text-sm font-mono text-gray-400">Total</span>
                      <span className="text-sm font-mono font-bold text-white">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Templates Section ============ */}
            <motion.div {...fadeIn(1 / (PHI * PHI * PHI))}>
              <GlassCard glowColor="none" className="p-6 mb-6">
                <h2 className="text-lg font-mono font-bold text-white mb-4 flex items-center gap-2">
                  <span style={{ color: CYAN }}>⬡</span> Allocation Templates
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {TEMPLATES.map((template, i) => (
                    <motion.button
                      key={template.name}
                      {...stagger(i)}
                      onClick={() => applyTemplate(template)}
                      className={`p-4 rounded-xl border text-left transition-all font-mono ${
                        activeTemplate === template.name
                          ? 'border-cyan-500/40 bg-cyan-500/10'
                          : 'border-gray-800 bg-white/[0.02] hover:border-gray-700 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="text-2xl mb-2">{template.icon}</div>
                      <div className="text-sm font-bold text-white mb-1">{template.name}</div>
                      <div className="text-[10px] text-gray-400 leading-tight">{template.description}</div>
                      {activeTemplate === template.name && (
                        <div className="mt-2 text-[10px] font-bold" style={{ color: CYAN }}>Active</div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Target Allocation Section ============ */}
            <motion.div {...fadeIn(2 / (PHI * PHI * PHI))}>
              <GlassCard glowColor="terminal" spotlight className="p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
                    <span style={{ color: CYAN }}>⊕</span> Target Allocation
                  </h2>
                  <div className="flex items-center gap-3">
                    {/* Sum indicator */}
                    <span className={`text-xs font-mono px-2 py-1 rounded-full border ${
                      isValidAllocation
                        ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : 'text-red-400 bg-red-500/10 border-red-500/20'
                    }`}>
                      {targetSum.toFixed(1)}% / 100%
                    </span>
                    <button
                      onClick={normalizeTargets}
                      className="text-[10px] font-mono px-2.5 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
                    >
                      Normalize
                    </button>
                  </div>
                </div>

                {/* Sliders */}
                <div className="space-y-0.5">
                  {TOKENS.map((token) => (
                    <div key={token.symbol} className="flex items-center gap-2">
                      <AllocationSlider
                        token={token}
                        value={targets[token.symbol] || 0}
                        onChange={(v) => handleTargetChange(token.symbol, v)}
                        locked={lockedTokens[token.symbol]}
                      />
                      <button
                        onClick={() => toggleLock(token.symbol)}
                        className={`text-xs p-1 rounded transition-colors ${
                          lockedTokens[token.symbol]
                            ? 'text-cyan-400 hover:text-cyan-300'
                            : 'text-gray-600 hover:text-gray-400'
                        }`}
                        title={lockedTokens[token.symbol] ? 'Unlock' : 'Lock'}
                      >
                        {lockedTokens[token.symbol] ? '🔒' : '🔓'}
                      </button>
                    </div>
                  ))}
                </div>

                {!isValidAllocation && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                  >
                    <p className="text-xs font-mono text-red-400">
                      Allocations must sum to 100%. Currently at {targetSum.toFixed(1)}%.
                      {targetSum > 100
                        ? ` Reduce by ${(targetSum - 100).toFixed(1)}%.`
                        : ` Increase by ${(100 - targetSum).toFixed(1)}%.`
                      }
                    </p>
                  </motion.div>
                )}
              </GlassCard>
            </motion.div>

            {/* ============ Drift Analysis Section ============ */}
            <motion.div {...fadeIn(3 / (PHI * PHI * PHI))}>
              <GlassCard glowColor="warning" className="p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
                    <span style={{ color: '#f59e0b' }}>⟐</span> Drift Analysis
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-gray-400">
                      Max Drift: <span className={maxDrift > 5 ? 'text-red-400' : maxDrift > 3 ? 'text-yellow-400' : 'text-green-400'}>
                        {maxDrift.toFixed(1)}%
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">
                      Avg: <span className="text-gray-300">{avgDrift.toFixed(1)}%</span>
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {drifts.map((d, i) => (
                    <motion.div key={d.symbol} {...stagger(i)}>
                      <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: d.color + '22', color: d.color }}
                        >
                          {d.logo}
                        </div>
                        <span className="text-sm font-mono text-white w-16 shrink-0">{d.symbol}</span>

                        {/* Drift bar */}
                        <div className="flex-1 relative h-5">
                          <div className="absolute inset-0 bg-gray-800/50 rounded-full" />
                          {/* Center line */}
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
                          {/* Drift indicator */}
                          <motion.div
                            className="absolute top-0.5 bottom-0.5 rounded-full"
                            style={{
                              backgroundColor: d.drift > 0 ? '#ef4444' : '#22c55e',
                              opacity: 0.6,
                              left: d.drift > 0 ? '50%' : `${50 + (d.drift / 20) * 50}%`,
                              width: `${Math.min(Math.abs(d.drift) / 20 * 50, 50)}%`,
                            }}
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: 0.5, delay: i * 0.04 }}
                          />
                        </div>

                        <div className="w-14 text-right">
                          <span className={`text-xs font-mono font-bold ${d.drift > 0 ? 'text-red-400' : d.drift < 0 ? 'text-green-400' : 'text-gray-400'}`}>
                            {d.drift > 0 ? '+' : ''}{d.drift.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-20 flex justify-end">
                          <DriftBadge drift={d.drift} />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Drift summary bar */}
                <div className="mt-4 pt-3 border-t border-gray-800">
                  <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                    <span>Portfolio health score</span>
                    <span className={maxDrift < 2 ? 'text-green-400' : maxDrift < 5 ? 'text-yellow-400' : 'text-red-400'}>
                      {maxDrift < 2 ? 'Excellent' : maxDrift < 5 ? 'Good' : 'Needs Rebalancing'}
                    </span>
                  </div>
                  <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: maxDrift < 2
                          ? 'linear-gradient(90deg, #22c55e, #06b6d4)'
                          : maxDrift < 5
                          ? 'linear-gradient(90deg, #eab308, #f97316)'
                          : 'linear-gradient(90deg, #f97316, #ef4444)',
                        width: `${Math.max(100 - maxDrift * 8, 10)}%`,
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(100 - maxDrift * 8, 10)}%` }}
                      transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Rebalance Preview Section ============ */}
            <motion.div {...fadeIn(4 / (PHI * PHI * PHI))}>
              <GlassCard glowColor="matrix" spotlight className="p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
                    <span style={{ color: '#22c55e' }}>◇</span> Rebalance Preview
                  </h2>
                  <span className="text-[10px] font-mono text-gray-400">
                    {trades.length} trade{trades.length !== 1 ? 's' : ''} needed
                  </span>
                </div>

                {trades.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-3xl mb-3 opacity-60">✓</div>
                    <p className="text-sm font-mono text-gray-400">Portfolio is already balanced</p>
                  </div>
                ) : (
                  <>
                    {/* Trade list */}
                    <div className="space-y-2 mb-4">
                      <div className="grid grid-cols-5 gap-2 px-3 py-1 text-[10px] font-mono text-gray-500 uppercase tracking-wider">
                        <span>Token</span>
                        <span>Action</span>
                        <span className="text-right">Value</span>
                        <span className="text-right">Fee</span>
                        <span className="text-right">Slippage</span>
                      </div>
                      {trades.map((trade, i) => (
                        <motion.div key={trade.symbol} {...stagger(i)}>
                          <div className="grid grid-cols-5 gap-2 items-center px-3 py-2.5 rounded-lg bg-white/[0.02] border border-gray-800/50 hover:border-gray-700/50 transition-colors">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                                style={{ backgroundColor: trade.color + '22', color: trade.color }}
                              >
                                {trade.logo}
                              </div>
                              <span className="text-sm font-mono text-white">{trade.symbol}</span>
                            </div>
                            <span className={`text-xs font-mono font-bold ${trade.action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                              {trade.action}
                            </span>
                            <span className="text-xs font-mono text-white text-right">
                              ${trade.tradeValue.toLocaleString()}
                            </span>
                            <span className="text-xs font-mono text-gray-400 text-right">
                              ${trade.fee.toFixed(2)}
                            </span>
                            <span className="text-xs font-mono text-gray-400 text-right">
                              {trade.slippage}%
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Summary */}
                    <div className="pt-3 border-t border-gray-800 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-gray-400">Total Fees</span>
                        <span className="text-white">${totalFees.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-gray-400">Estimated Gas</span>
                        <span className="text-white">~0.0028 ETH</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-gray-400">Settlement</span>
                        <span className="text-white">VibeSwap Batch Auction</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-gray-400">MEV Protection</span>
                        <span className="text-green-400">Commit-Reveal</span>
                      </div>
                    </div>

                    {/* Rebalance button */}
                    <motion.button
                      onClick={handleRebalance}
                      disabled={rebalancing || !isValidAllocation}
                      className="mt-4 w-full py-3 rounded-xl font-mono text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: rebalancing
                          ? 'rgba(6,182,212,0.1)'
                          : `linear-gradient(135deg, ${CYAN}22, ${CYAN}11)`,
                        color: CYAN,
                        border: `1px solid ${CYAN}33`,
                      }}
                      whileHover={!rebalancing && isValidAllocation ? { scale: 1.01 } : undefined}
                      whileTap={!rebalancing && isValidAllocation ? { scale: 0.99 } : undefined}
                    >
                      {rebalancing ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                            className="inline-block"
                          >
                            ◎
                          </motion.span>
                          Executing via Batch Auction...
                        </span>
                      ) : !isValidAllocation ? (
                        'Fix Allocations to Rebalance'
                      ) : (
                        `Rebalance Portfolio (${trades.length} trades)`
                      )}
                    </motion.button>
                  </>
                )}
              </GlassCard>
            </motion.div>

            {/* ============ Auto-Rebalance Section ============ */}
            <motion.div {...fadeIn(5 / (PHI * PHI * PHI))}>
              <GlassCard glowColor="terminal" className="p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
                    <span style={{ color: CYAN }}>⟳</span> Auto-Rebalance
                  </h2>
                  {/* Toggle */}
                  <button
                    onClick={() => setAutoEnabled(!autoEnabled)}
                    className={`relative w-11 h-6 rounded-full transition-all ${
                      autoEnabled ? 'bg-cyan-500/30' : 'bg-gray-700'
                    }`}
                  >
                    <motion.div
                      className="absolute top-0.5 w-5 h-5 rounded-full"
                      style={{ backgroundColor: autoEnabled ? CYAN : '#6b7280' }}
                      animate={{ left: autoEnabled ? '22px' : '2px' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>

                <div className={`space-y-4 transition-opacity ${autoEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  {/* Frequency */}
                  <div>
                    <label className="text-xs font-mono text-gray-400 mb-2 block">Rebalance Frequency</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['hourly', 'daily', 'weekly', 'monthly'].map(freq => (
                        <button
                          key={freq}
                          onClick={() => setAutoFrequency(freq)}
                          className={`py-2 rounded-lg text-xs font-mono transition-all ${
                            autoFrequency === freq
                              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                              : 'bg-white/[0.02] text-gray-400 border border-gray-800 hover:border-gray-700'
                          }`}
                        >
                          {freq.charAt(0).toUpperCase() + freq.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Drift Threshold */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-mono text-gray-400">Drift Threshold</label>
                      <span className="text-xs font-mono" style={{ color: CYAN }}>{driftThreshold}%</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="0.5"
                      value={driftThreshold}
                      onChange={(e) => setDriftThreshold(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${CYAN} 0%, ${CYAN} ${(driftThreshold / 20) * 100}%, rgba(37,37,37,1) ${(driftThreshold / 20) * 100}%, rgba(37,37,37,1) 100%)`,
                      }}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] font-mono text-gray-500">1% (tight)</span>
                      <span className="text-[10px] font-mono text-gray-500">20% (loose)</span>
                    </div>
                  </div>

                  {/* Gas Budget */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-mono text-gray-400">Max Gas Budget (ETH)</label>
                      <span className="text-xs font-mono" style={{ color: CYAN }}>{gasBudget} ETH</span>
                    </div>
                    <input
                      type="range"
                      min="0.001"
                      max="0.1"
                      step="0.001"
                      value={gasBudget}
                      onChange={(e) => setGasBudget(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${CYAN} 0%, ${CYAN} ${(gasBudget / 0.1) * 100}%, rgba(37,37,37,1) ${(gasBudget / 0.1) * 100}%, rgba(37,37,37,1) 100%)`,
                      }}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] font-mono text-gray-500">0.001 ETH</span>
                      <span className="text-[10px] font-mono text-gray-500">0.1 ETH</span>
                    </div>
                  </div>

                  {/* Max Slippage */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-mono text-gray-400">Max Slippage Tolerance</label>
                      <span className="text-xs font-mono" style={{ color: CYAN }}>{maxSlippage}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={maxSlippage}
                      onChange={(e) => setMaxSlippage(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${CYAN} 0%, ${CYAN} ${(maxSlippage / 5) * 100}%, rgba(37,37,37,1) ${(maxSlippage / 5) * 100}%, rgba(37,37,37,1) 100%)`,
                      }}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] font-mono text-gray-500">0.1% (strict)</span>
                      <span className="text-[10px] font-mono text-gray-500">5% (permissive)</span>
                    </div>
                  </div>

                  {/* Auto-rebalance status */}
                  <div className="pt-3 border-t border-gray-800">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-gray-400">Status</span>
                      <span className={autoEnabled ? 'text-green-400' : 'text-gray-500'}>
                        {autoEnabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono mt-1">
                      <span className="text-gray-400">Next Check</span>
                      <span className="text-white">
                        {autoEnabled
                          ? autoFrequency === 'hourly' ? '~54 min'
                            : autoFrequency === 'daily' ? '~22 hrs'
                            : autoFrequency === 'weekly' ? '~6 days'
                            : '~29 days'
                          : '--'
                        }
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono mt-1">
                      <span className="text-gray-400">Trigger</span>
                      <span className="text-white">
                        {autoEnabled ? `Any token drifts > ${driftThreshold}%` : '--'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono mt-1">
                      <span className="text-gray-400">MEV Protection</span>
                      <span className="text-green-400">Commit-Reveal Enforced</span>
                    </div>
                  </div>

                  {autoEnabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/15"
                    >
                      <p className="text-[10px] font-mono text-cyan-400/80 leading-relaxed">
                        Auto-rebalance will execute trades via VibeSwap batch auctions, ensuring MEV protection through commit-reveal mechanics. Trades are batched for gas efficiency and settled at uniform clearing prices. You can cancel anytime.
                      </p>
                    </motion.div>
                  )}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Footer Info ============ */}
            <motion.div {...fadeIn(6 / (PHI * PHI * PHI))}>
              <div className="flex items-center justify-center gap-4 text-[10px] font-mono text-gray-500 mt-4">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  MEV Protected
                </span>
                <span>·</span>
                <span>Batch Auction Settlement</span>
                <span>·</span>
                <Link to="/swap" className="hover:text-gray-300 transition-colors" style={{ color: CYAN }}>
                  Manual Swap
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
