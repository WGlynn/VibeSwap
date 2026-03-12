import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { Link } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { usePriceFeed } from '../hooks/usePriceFeed'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerV = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Market Data Hook ============

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20]

function usePerpMarkets() {
  const { getPrice, getChange } = usePriceFeed(['ETH', 'BTC', 'SOL', 'JUL'])

  const formatPrice = (p) => {
    if (!p) return '--'
    return p >= 1000
      ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : `$${p.toFixed(4)}`
  }

  const formatChange = (c) => {
    if (c === undefined || c === null) return '--'
    return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`
  }

  return [
    { pair: 'ETH/USD', asset: 'ETH', price: formatPrice(getPrice('ETH')), rawPrice: getPrice('ETH') || 0, change: formatChange(getChange('ETH')), funding: '+0.0042%', oi: '$4.2M', volume24h: '$12.8M', positive: (getChange('ETH') || 0) >= 0, maxLeverage: 20 },
    { pair: 'BTC/USD', asset: 'BTC', price: formatPrice(getPrice('BTC')), rawPrice: getPrice('BTC') || 0, change: formatChange(getChange('BTC')), funding: '+0.0031%', oi: '$8.1M', volume24h: '$24.5M', positive: (getChange('BTC') || 0) >= 0, maxLeverage: 20 },
    { pair: 'SOL/USD', asset: 'SOL', price: formatPrice(getPrice('SOL')), rawPrice: getPrice('SOL') || 0, change: formatChange(getChange('SOL')), funding: '-0.0018%', oi: '$1.8M', volume24h: '$5.4M', positive: (getChange('SOL') || 0) >= 0, maxLeverage: 10 },
    { pair: 'JUL/USD', asset: 'JUL', price: formatPrice(getPrice('JUL')), rawPrice: getPrice('JUL') || 0, change: formatChange(getChange('JUL')), funding: '+0.0012%', oi: '$420K', volume24h: '$1.1M', positive: (getChange('JUL') || 0) >= 0, maxLeverage: 5 },
  ]
}

// ============ Mock Positions ============

const MOCK_POSITIONS = [
  { pair: 'ETH/USD', side: 'long', size: '2.5 ETH', entry: '$3,420', pnl: '+$182.50', pnlPct: '+5.3%', leverage: '10x', liqPrice: '$3,078', positive: true },
  { pair: 'BTC/USD', side: 'short', size: '0.15 BTC', entry: '$68,200', pnl: '-$45.00', pnlPct: '-0.4%', leverage: '5x', liqPrice: '$81,840', positive: false },
]

// ============ Funding Rate History ============

const FUNDING_HISTORY = [
  { time: '00:00', rate: 0.0042 },
  { time: '08:00', rate: 0.0038 },
  { time: '16:00', rate: 0.0045 },
  { time: '00:00', rate: 0.0051 },
  { time: '08:00', rate: 0.0033 },
  { time: '16:00', rate: 0.0028 },
  { time: '00:00', rate: 0.0042 },
]

// ============ Mini Funding Chart ============

function FundingChart({ data }) {
  const max = Math.max(...data.map(d => d.rate))
  const min = Math.min(...data.map(d => d.rate))
  const range = max - min || 0.001
  const w = 280
  const h = 60
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d.rate - min) / range) * h * 0.8 - h * 0.1
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 60 }}>
      <polyline
        points={points}
        fill="none"
        stroke={CYAN}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const x = (i / (data.length - 1)) * w
        const y = h - ((d.rate - min) / range) * h * 0.8 - h * 0.1
        return <circle key={i} cx={x} cy={y} r="2.5" fill={CYAN} opacity="0.6" />
      })}
    </svg>
  )
}

// ============ PID Controller Explainer ============

function PIDExplainer() {
  const terms = [
    { letter: 'P', name: 'Proportional', desc: 'Reacts to current imbalance between longs and shorts', color: '#3b82f6' },
    { letter: 'I', name: 'Integral', desc: 'Corrects persistent drift — accumulates historical error', color: '#a855f7' },
    { letter: 'D', name: 'Derivative', desc: 'Dampens oscillation — anticipates rate of change', color: '#22c55e' },
  ]

  return (
    <div className="space-y-3">
      {terms.map((term, i) => (
        <motion.div
          key={term.letter}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 + i * (0.1 * PHI), duration: 0.35, ease }}
          className="flex items-start gap-3"
        >
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
            style={{ background: `${term.color}15`, border: `1px solid ${term.color}40`, color: term.color }}
          >
            {term.letter}
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-white">{term.name}</p>
            <p className="text-[11px] font-mono text-black-400 mt-0.5">{term.desc}</p>
          </div>
        </motion.div>
      ))}
      <div className="mt-4 rounded-lg p-3" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}20` }}>
        <p className="text-[11px] font-mono text-cyan-400 text-center">
          Result: Funding rates converge mark price to index price without overshooting
        </p>
      </div>
    </div>
  )
}

// ============ Insurance Fund Visual ============

function InsuranceFund() {
  const sources = [
    { name: 'Liquidation Surplus', pct: 45, color: '#22c55e' },
    { name: 'Trading Fees (10%)', pct: 30, color: CYAN },
    { name: 'Treasury Allocation', pct: 15, color: '#a855f7' },
    { name: 'Penalty Fees', pct: 10, color: '#f59e0b' },
  ]

  return (
    <div className="space-y-3">
      <div className="text-center mb-4">
        <p className="text-2xl font-mono font-bold text-white">$2.4M</p>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Insurance Fund Balance</p>
      </div>
      {sources.map((s, i) => (
        <motion.div
          key={s.name}
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.2 + i * 0.1, duration: 0.4, ease }}
          style={{ transformOrigin: 'left' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-mono text-black-300">{s.name}</span>
            <span className="text-[11px] font-mono font-bold" style={{ color: s.color }}>{s.pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-black-800">
            <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color, opacity: 0.7 }} />
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ MEV Protection Badge ============

function MEVProtection() {
  const protections = [
    { icon: '1', title: 'Commit Phase', desc: 'Orders hidden as hash commitments — no front-running' },
    { icon: '2', title: 'Batch Settlement', desc: 'All orders in batch get uniform clearing price' },
    { icon: '3', title: 'Fisher-Yates Shuffle', desc: 'Execution order is deterministic but unpredictable' },
    { icon: '4', title: 'Priority Auction', desc: 'Want priority? Bid for it fairly, not via gas wars' },
  ]

  return (
    <div className="space-y-2">
      {protections.map((p, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 + i * (0.08 * PHI), duration: 0.3 }}
          className="flex items-start gap-3 rounded-lg p-3"
          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}12` }}
        >
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold" style={{ background: `${CYAN}15`, color: CYAN }}>
            {p.icon}
          </div>
          <div>
            <p className="text-xs font-mono font-bold text-white">{p.title}</p>
            <p className="text-[10px] font-mono text-black-400 mt-0.5">{p.desc}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function PerpetualsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const MARKETS_DATA = usePerpMarkets()
  const [selectedMarket, setSelectedMarket] = useState(0)
  const [side, setSide] = useState('long')
  const [leverage, setLeverage] = useState(5)
  const [amount, setAmount] = useState('')
  const [showPositions, setShowPositions] = useState(false)
  const [infoTab, setInfoTab] = useState('protection')

  const market = MARKETS_DATA[selectedMarket]

  const positionSize = useMemo(() => {
    const amt = parseFloat(amount) || 0
    return (amt * leverage).toFixed(4)
  }, [amount, leverage])

  const liqPrice = useMemo(() => {
    if (!market.rawPrice || !amount) return '--'
    const p = market.rawPrice
    return side === 'long'
      ? `$${(p * (1 - 0.9 / leverage)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : `$${(p * (1 + 0.9 / leverage)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  }, [market.rawPrice, amount, leverage, side])

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.3, 0], scale: [0, 1.5, 0], y: [0, -50 - (i % 4) * 20] }}
            transition={{ duration: 3 + (i % 3) * 1.5, repeat: Infinity, delay: (i * 0.8) % 4, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-6 md:pt-10">
        {/* ============ Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-8">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-24 h-px mx-auto mb-5"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-[0.1em] uppercase mb-2">
            <span style={{ color: CYAN }}>PERP</span><span className="text-white">ETUALS</span>
          </h1>
          <p className="text-sm text-black-300 font-mono">
            Trade perpetual futures with up to 20x leverage. PID-controlled funding. MEV-free.
          </p>
        </motion.div>

        {/* ============ Protocol Stats ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total OI', value: '$14.5M' },
              { label: '24h Volume', value: '$43.8M' },
              { label: 'Insurance Fund', value: '$2.4M' },
              { label: 'Active Traders', value: '1,847' },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
              >
                <GlassCard hover glowColor="terminal">
                  <div className="p-3 text-center">
                    <p className="text-lg font-mono font-bold text-white">{s.value}</p>
                    <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mt-1">{s.label}</p>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ Market Selector ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MARKETS_DATA.map((m, i) => (
              <button
                key={m.pair}
                onClick={() => setSelectedMarket(i)}
                className="shrink-0"
              >
                <GlassCard hover glowColor={selectedMarket === i ? 'terminal' : undefined}>
                  <div className={`px-4 py-3 ${selectedMarket === i ? 'ring-1 ring-cyan-500/40 rounded-xl' : ''}`}>
                    <p className="text-sm font-mono font-bold text-white">{m.pair}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono text-black-300">{m.price}</span>
                      <span className={`text-[10px] font-mono ${m.positive ? 'text-green-400' : 'text-red-400'}`}>{m.change}</span>
                    </div>
                  </div>
                </GlassCard>
              </button>
            ))}
          </div>
        </motion.div>

        {/* ============ Trading Interface ============ */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible">
          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
            {/* ---- Order Panel ---- */}
            <GlassCard glowColor="terminal">
              <div className="p-5">
                <h2 className="text-sm font-mono font-bold text-white mb-4 tracking-wider uppercase" style={{ color: CYAN }}>{market.pair}</h2>

                {/* Long/Short */}
                <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
                  <button
                    onClick={() => setSide('long')}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-md transition-all ${
                      side === 'long' ? 'bg-green-500 text-black shadow-lg shadow-green-500/20' : 'text-black-400 hover:text-white'
                    }`}
                  >
                    LONG
                  </button>
                  <button
                    onClick={() => setSide('short')}
                    className={`flex-1 py-2.5 text-sm font-bold rounded-md transition-all ${
                      side === 'short' ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'text-black-400 hover:text-white'
                    }`}
                  >
                    SHORT
                  </button>
                </div>

                {/* Leverage */}
                <div className="mb-4">
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Leverage</p>
                  <div className="flex gap-1">
                    {LEVERAGE_OPTIONS.filter(l => l <= market.maxLeverage).map((l) => (
                      <button
                        key={l}
                        onClick={() => setLeverage(l)}
                        className={`flex-1 py-2 text-xs font-mono rounded-lg border transition-all ${
                          leverage === l
                            ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-400 font-bold'
                            : 'border-black-700 text-black-400 hover:border-black-600'
                        }`}
                      >
                        {l}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div className="mb-4">
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Collateral ({market.asset})</p>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      className="w-full rounded-lg px-4 py-3 text-white font-mono placeholder-black-600 focus:outline-none"
                      style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${amount ? `${CYAN}40` : 'rgba(255,255,255,0.08)'}` }}
                    />
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono px-2 py-1 rounded"
                      style={{ background: `${CYAN}15`, color: CYAN }}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Position Details */}
                <AnimatePresence>
                  {amount && parseFloat(amount) > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 rounded-lg p-3 space-y-2"
                      style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}
                    >
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Position Size</span>
                        <span className="text-white">{positionSize} {market.asset}</span>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Liquidation Price</span>
                        <span className="text-red-400">{liqPrice}</span>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Funding Rate</span>
                        <span className="text-black-300">{market.funding}/8h</span>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Fee (0.05%)</span>
                        <span className="text-black-300">{(parseFloat(positionSize) * 0.0005).toFixed(6)} {market.asset}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit */}
                <button
                  disabled={!isConnected || !amount}
                  className={`w-full py-3.5 rounded-lg font-bold text-sm transition-all ${
                    side === 'long'
                      ? 'bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/10'
                      : 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/10'
                  } disabled:bg-black-700 disabled:text-black-500 disabled:shadow-none`}
                >
                  {!isConnected ? 'Connect Wallet' : `Open ${side === 'long' ? 'Long' : 'Short'} ${leverage}x`}
                </button>
              </div>
            </GlassCard>

            {/* ---- Right Panel ---- */}
            <div className="space-y-4">
              {/* Market Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Mark Price', value: market.price, color: 'text-white' },
                  { label: '24h Change', value: market.change, color: market.positive ? 'text-green-400' : 'text-red-400' },
                  { label: 'Open Interest', value: market.oi, color: 'text-white' },
                  { label: '24h Volume', value: market.volume24h, color: 'text-white' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}>
                    <p className={`font-mono font-bold text-sm ${s.color}`}>{s.value}</p>
                    <p className="text-[9px] font-mono text-black-500 uppercase mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Funding Rate Chart */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Funding Rate History</h3>
                    <span className="text-[10px] font-mono text-black-400">Last 24h</span>
                  </div>
                  <FundingChart data={FUNDING_HISTORY} />
                  <div className="flex justify-between mt-2">
                    {FUNDING_HISTORY.map((d, i) => (
                      <span key={i} className="text-[8px] font-mono text-black-600">{d.time}</span>
                    ))}
                  </div>
                </div>
              </GlassCard>

              {/* Positions */}
              {isConnected && (
                <GlassCard glowColor="terminal">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Your Positions</h3>
                      <span className="text-[10px] font-mono text-black-400">{MOCK_POSITIONS.length} open</span>
                    </div>
                    <div className="space-y-2">
                      {MOCK_POSITIONS.map((pos, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.08 }}
                          className="flex items-center justify-between rounded-lg p-3"
                          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${pos.positive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-white">{pos.pair}</span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                pos.side === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {pos.side.toUpperCase()} {pos.leverage}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-black-500">{pos.size} @ {pos.entry}</span>
                          </div>
                          <div className="text-right">
                            <p className={`text-xs font-mono font-bold ${pos.positive ? 'text-green-400' : 'text-red-400'}`}>{pos.pnl}</p>
                            <p className={`text-[10px] font-mono ${pos.positive ? 'text-green-400/60' : 'text-red-400/60'}`}>{pos.pnlPct}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* All Markets Table */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider mb-3" style={{ color: CYAN }}>All Markets</h3>
                  <div className="space-y-1">
                    {MARKETS_DATA.map((m, i) => (
                      <div
                        key={m.pair}
                        onClick={() => setSelectedMarket(i)}
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                          selectedMarket === i ? 'bg-cyan-500/5 border border-cyan-500/20' : 'hover:bg-black-800/40 border border-transparent'
                        }`}
                      >
                        <span className="text-sm font-mono font-bold text-white w-20">{m.pair}</span>
                        <span className="text-xs font-mono text-black-300 w-24 text-right">{m.price}</span>
                        <span className={`text-xs font-mono w-16 text-right ${m.positive ? 'text-green-400' : 'text-red-400'}`}>{m.change}</span>
                        <span className="text-[10px] font-mono text-black-500 w-16 text-right hidden sm:block">{m.funding}</span>
                        <span className="text-[10px] font-mono text-black-500 w-16 text-right hidden sm:block">{m.volume24h}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </GlassCard>
            </div>
          </div>
        </motion.div>

        {/* ============ Info Tabs ============ */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          {/* Tab selector */}
          <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: 'rgba(0,0,0,0.3)' }}>
            {[
              { id: 'protection', label: 'MEV Protection' },
              { id: 'pid', label: 'PID Funding' },
              { id: 'insurance', label: 'Insurance Fund' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setInfoTab(t.id)}
                className={`flex-1 py-2 text-xs font-mono rounded-md transition-all ${
                  infoTab === t.id ? 'text-cyan-400 font-bold' : 'text-black-400 hover:text-white'
                }`}
                style={infoTab === t.id ? { background: `${CYAN}15`, border: `1px solid ${CYAN}25` } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>

          <GlassCard glowColor="terminal" spotlight>
            <div className="p-5 md:p-6">
              <AnimatePresence mode="wait">
                {infoTab === 'protection' && (
                  <motion.div key="protection" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: CYAN }}>
                      MEV-Free Perpetuals
                    </h3>
                    <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                      Traditional perps DEXes leak value to MEV bots through front-running, sandwich attacks, and liquidation sniping.
                      VibeSwap's commit-reveal batch auction eliminates all three.
                    </p>
                    <MEVProtection />
                  </motion.div>
                )}
                {infoTab === 'pid' && (
                  <motion.div key="pid" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: CYAN }}>
                      PID-Controlled Funding Rates
                    </h3>
                    <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                      Instead of simple mark-index spread, VibeSwap uses a PID controller to calculate funding rates.
                      This produces smoother convergence with less volatility.
                    </p>
                    <PIDExplainer />
                  </motion.div>
                )}
                {infoTab === 'insurance' && (
                  <motion.div key="insurance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: CYAN }}>
                      Insurance Fund
                    </h3>
                    <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                      The insurance fund backstops liquidation losses and ensures counterparty solvency.
                      Funded through multiple revenue streams for redundancy.
                    </p>
                    <InsuranceFund />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/', label: 'Spot Trading' },
              { path: '/economics', label: 'Economics' },
              { path: '/gametheory', label: 'Game Theory' },
              { path: '/stake', label: 'Staking' },
            ].map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="mt-12 mb-8 text-center"
        >
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
            VibeSwap Perpetuals — Fair Leverage
          </p>
        </motion.div>
      </div>
    </div>
  )
}
