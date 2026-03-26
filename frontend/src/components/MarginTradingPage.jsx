import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Token Pairs ============

const TOKEN_PAIRS = [
  { id: 'eth-usdc', base: 'ETH', quote: 'USDC', price: 3485.20, change: 2.4 },
  { id: 'btc-usdc', base: 'BTC', quote: 'USDC', price: 68742.50, change: -0.8 },
  { id: 'sol-usdc', base: 'SOL', quote: 'USDC', price: 142.85, change: 5.1 },
  { id: 'jul-usdc', base: 'JUL', quote: 'USDC', price: 0.0824, change: 12.3 },
]

// ============ Mock Open Positions ============

const MOCK_POSITIONS = [
  { id: 1, pair: 'ETH/USDC', side: 'long', size: '$17,426', entryPrice: '$3,412.50', markPrice: '$3,485.20', leverage: '5x', collateral: 3485.20, pnl: '+$363.88', pnlRaw: 363.88, pnlPct: '+2.13%', liqPrice: '$2,798.40', positive: true },
  { id: 2, pair: 'BTC/USDC', side: 'short', size: '$34,371', entryPrice: '$69,120.00', markPrice: '$68,742.50', leverage: '3x', collateral: 11457.00, pnl: '+$187.95', pnlRaw: 187.95, pnlPct: '+0.55%', liqPrice: '$92,160.00', positive: true },
  { id: 3, pair: 'SOL/USDC', side: 'long', size: '$7,142', entryPrice: '$148.60', markPrice: '$142.85', leverage: '10x', collateral: 714.25, pnl: '-$276.22', pnlRaw: -276.22, pnlPct: '-3.87%', liqPrice: '$134.21', positive: false },
  { id: 4, pair: 'ETH/USDC', side: 'short', size: '$10,455', entryPrice: '$3,502.80', markPrice: '$3,485.20', leverage: '7x', collateral: 1493.57, pnl: '+$52.73', pnlRaw: 52.73, pnlPct: '+0.50%', liqPrice: '$4,003.20', positive: true },
  { id: 5, pair: 'JUL/USDC', side: 'long', size: '$2,060', entryPrice: '$0.0798', markPrice: '$0.0824', leverage: '4x', collateral: 515.00, pnl: '+$67.14', pnlRaw: 67.14, pnlPct: '+3.26%', liqPrice: '$0.0599', positive: true },
]

// ============ Funding Rate Data ============

const FUNDING_RATES = [
  { pair: 'ETH/USDC', current: 0.0038, predicted: 0.0042, cycle: '4h 12m', annualized: '13.87%' },
  { pair: 'BTC/USDC', current: 0.0025, predicted: 0.0029, cycle: '4h 12m', annualized: '9.13%' },
  { pair: 'SOL/USDC', current: -0.0015, predicted: -0.0011, cycle: '4h 12m', annualized: '-5.48%' },
  { pair: 'JUL/USDC', current: 0.0062, predicted: 0.0058, cycle: '4h 12m', annualized: '22.63%' },
]

// ============ Leverage Slider ============

function LeverageSlider({ value, onChange }) {
  const stops = [1, 2, 3, 5, 7, 10]
  const pct = ((value - 1) / 9) * 100
  const riskColor = value <= 3 ? '#22c55e' : value <= 7 ? '#f59e0b' : '#ef4444'
  const riskLabel = value <= 3 ? 'Low' : value <= 7 ? 'Medium' : 'High'

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Leverage</p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${riskColor}15`, color: riskColor, border: `1px solid ${riskColor}30` }}>
            {riskLabel} Risk
          </span>
          <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>{value}x</span>
        </div>
      </div>
      <div className="relative h-8 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div className="h-full rounded-full"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #22c55e, ${CYAN}, #f59e0b, #ef4444)` }}
            animate={{ width: `${pct}%` }} transition={{ duration: 0.15 }} />
        </div>
        <input type="range" min={1} max={10} step={1} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute inset-x-0 w-full h-8 opacity-0 cursor-pointer" style={{ zIndex: 2 }} />
        <motion.div className="absolute w-4 h-4 rounded-full border-2"
          style={{ left: `calc(${pct}% - 8px)`, background: '#0f0f0f', borderColor: CYAN, boxShadow: `0 0 8px ${CYAN}40`, zIndex: 1 }}
          animate={{ left: `calc(${pct}% - 8px)` }} transition={{ duration: 0.15 }} />
      </div>
      <div className="flex justify-between mt-1">
        {stops.map((s) => (
          <button key={s} onClick={() => onChange(s)}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-all ${value === s ? 'text-cyan-400 font-bold' : 'text-black-500 hover:text-black-300'}`}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  )
}

// ============ Health Bar ============

function HealthBar({ ratio }) {
  const color = ratio > 70 ? '#22c55e' : ratio > 40 ? '#f59e0b' : '#ef4444'
  const label = ratio > 70 ? 'Healthy' : ratio > 40 ? 'Caution' : 'At Risk'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Account Health</p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
            {label}
          </span>
          <span className="text-xs font-mono font-bold" style={{ color }}>{ratio.toFixed(1)}%</span>
        </div>
      </div>
      <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, #ef4444, #f59e0b, #22c55e)` }}
          animate={{ width: `${Math.min(ratio, 100)}%` }} transition={{ duration: 0.4, ease }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] font-mono text-red-400/60">Liquidation</span>
        <span className="text-[8px] font-mono text-green-400/60">Safe</span>
      </div>
    </div>
  )
}

// ============ Mini Funding Sparkline ============

function FundingSparkline({ rates, height = 32 }) {
  const w = 120, h = height
  const max = Math.max(...rates.map(Math.abs))
  const range = max || 0.001
  const points = rates.map((r, i) => {
    const x = (i / (rates.length - 1)) * w
    const y = h / 2 - (r / range) * (h * 0.4)
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }}>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="3,2" />
      <polyline points={points} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {rates.map((r, i) => {
        const x = (i / (rates.length - 1)) * w, y = h / 2 - (r / range) * (h * 0.4)
        return <circle key={i} cx={x} cy={y} r="2" fill={r >= 0 ? '#22c55e' : '#ef4444'} opacity="0.7" />
      })}
    </svg>
  )
}

// ============ Detail Cell ============

const DetailCell = ({ label, value, color }) => (
  <div>
    <p className="text-[8px] font-mono text-black-500 uppercase">{label}</p>
    <p className={`text-[10px] font-mono ${color || 'text-black-300'}`}>{value}</p>
  </div>
)

// ============ Main Component ============

export default function MarginTradingPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [side, setSide] = useState('long')
  const [selectedPairIdx, setSelectedPairIdx] = useState(0)
  const [collateral, setCollateral] = useState('')
  const [leverage, setLeverage] = useState(3)

  const pair = TOKEN_PAIRS[selectedPairIdx]
  const fmtPrice = (p) => p >= 1 ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${p.toFixed(4)}`

  const notionalValue = useMemo(() => (parseFloat(collateral) || 0) * leverage, [collateral, leverage])
  const positionSizeInBase = useMemo(() => notionalValue && pair.price ? notionalValue / pair.price : 0, [notionalValue, pair.price])

  const liquidationPrice = useMemo(() => {
    if (!collateral || parseFloat(collateral) <= 0) return null
    const p = pair.price
    return side === 'long' ? p * (1 - 0.95 / leverage) : p * (1 + 0.95 / leverage)
  }, [pair.price, collateral, leverage, side])

  const estimatedFee = useMemo(() => notionalValue * 0.0005, [notionalValue])
  const currentFunding = FUNDING_RATES.find(f => f.pair === `${pair.base}/${pair.quote}`) || FUNDING_RATES[0]

  // ---- Positions: real when connected, mock for demo ----
  const positions = isConnected ? [] : MOCK_POSITIONS

  // ---- Risk Metrics ----
  const totalMarginUsed = positions.reduce((sum, p) => sum + p.collateral, 0)
  const totalAccountValue = isConnected ? 0 : 25000
  const availableMargin = totalAccountValue - totalMarginUsed
  const marginRatio = (availableMargin / totalAccountValue) * 100
  const maintenanceMargin = totalMarginUsed * 0.05
  const healthRatio = ((totalAccountValue - maintenanceMargin) / totalAccountValue) * 100

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 4) * 15] }}
            transition={{ duration: 3 + (i % 3) * 1.5, repeat: Infinity, delay: (i * 0.8) % 4, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 pt-4">
        {/* ============ Page Hero ============ */}
        <PageHero
          title="Margin Trading"
          subtitle="Isolated margin positions with up to 10x leverage — MEV-protected via commit-reveal"
          category="defi"
          badge="Live"
          badgeColor="#22c55e"
        />

        {/* ============ Stats Bar ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Open Interest', value: '$48.2M' },
              { label: '24h Volume', value: '$127.5M' },
              { label: 'Total Traders', value: '3,842' },
              { label: 'Avg Leverage', value: '4.7x' },
            ].map((s, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}>
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

        {/* ============ Main Trading Layout ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible">
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">

            {/* ---- Trading Panel ---- */}
            <GlassCard glowColor="terminal">
              <div className="p-5">
                <h2 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: CYAN }}>
                  Open Position
                </h2>

                {/* Long / Short Toggle */}
                <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
                  {['long', 'short'].map((s) => (
                    <button key={s} onClick={() => setSide(s)}
                      className={`flex-1 py-2.5 text-sm font-bold rounded-md transition-all ${
                        side === s
                          ? (s === 'long' ? 'bg-green-500 text-black shadow-lg shadow-green-500/20' : 'bg-red-500 text-white shadow-lg shadow-red-500/20')
                          : 'text-black-400 hover:text-white'
                      }`}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Token Pair Selector */}
                <div className="mb-4">
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Trading Pair</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TOKEN_PAIRS.map((tp, i) => (
                      <button key={tp.id} onClick={() => setSelectedPairIdx(i)}
                        className={`py-2 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
                          selectedPairIdx === i ? 'text-cyan-400 ring-1 ring-cyan-500/40' : 'text-black-400 hover:text-white'
                        }`}
                        style={{
                          background: selectedPairIdx === i ? `${CYAN}10` : 'rgba(0,0,0,0.3)',
                          border: `1px solid ${selectedPairIdx === i ? `${CYAN}25` : 'rgba(255,255,255,0.05)'}`,
                        }}>
                        <span>{tp.base}/{tp.quote}</span>
                        <span className={`block text-[9px] mt-0.5 ${tp.change >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                          {tp.change >= 0 ? '+' : ''}{tp.change}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Collateral Input */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Collateral (USDC)</p>
                    <p className="text-[9px] font-mono text-black-500">
                      Balance: <span className="text-black-300">12,450.00</span>
                    </p>
                  </div>
                  <div className="relative">
                    <input type="number" value={collateral} onChange={(e) => setCollateral(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg px-4 py-3 text-white font-mono placeholder-black-600 focus:outline-none"
                      style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${collateral ? `${CYAN}40` : 'rgba(255,255,255,0.08)'}` }} />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                      <button onClick={() => setCollateral('6225')} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: `${CYAN}10`, color: `${CYAN}90` }}>HALF</button>
                      <button onClick={() => setCollateral('12450')} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: `${CYAN}15`, color: CYAN }}>MAX</button>
                    </div>
                  </div>
                </div>

                {/* Leverage Slider */}
                <div className="mb-4">
                  <LeverageSlider value={leverage} onChange={setLeverage} />
                </div>

                {/* Position Details */}
                <AnimatePresence>
                  {collateral && parseFloat(collateral) > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }} className="mb-4 rounded-lg p-3 space-y-2.5"
                      style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}>
                      {[
                        { l: 'Notional Value', v: `$${notionalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, c: 'text-white font-bold' },
                        { l: 'Position Size', v: `${positionSizeInBase.toFixed(6)} ${pair.base}`, c: 'text-white' },
                        { l: 'Entry Price', v: fmtPrice(pair.price), c: 'text-white' },
                        { l: 'Liquidation Price', v: liquidationPrice ? fmtPrice(liquidationPrice) : '--', c: 'text-red-400' },
                      ].map((row) => (
                        <div key={row.l} className="flex justify-between text-xs font-mono">
                          <span className="text-black-400">{row.l}</span>
                          <span className={row.c}>{row.v}</span>
                        </div>
                      ))}
                      <div className="h-px" style={{ background: `${CYAN}10` }} />
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Est. Fee (0.05%)</span>
                        <span className="text-black-300">${estimatedFee.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Funding Rate</span>
                        <span className={currentFunding.current >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {currentFunding.current >= 0 ? '+' : ''}{(currentFunding.current * 100).toFixed(4)}% / 8h
                        </span>
                      </div>
                      {leverage >= 8 && (
                        <div className="mt-1 rounded-md p-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <p className="text-[9px] font-mono text-red-400 text-center">
                            High leverage — liquidation {liquidationPrice
                              ? `${Math.abs(((liquidationPrice - pair.price) / pair.price) * 100).toFixed(1)}% from entry`
                              : '--'}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Open Position Button */}
                <button disabled={!isConnected || !collateral || parseFloat(collateral) <= 0}
                  className={`w-full py-3.5 rounded-lg font-bold text-sm transition-all ${
                    side === 'long'
                      ? 'bg-green-500 hover:bg-green-400 text-black shadow-lg shadow-green-500/10'
                      : 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/10'
                  } disabled:bg-black-700 disabled:text-black-500 disabled:shadow-none`}>
                  {!isConnected ? 'Sign In' : `Open ${side === 'long' ? 'Long' : 'Short'} ${leverage}x`}
                </button>

                <div className="mt-3 flex items-center justify-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">
                    Isolated Margin — Risk Limited to Collateral
                  </span>
                </div>
              </div>
            </GlassCard>

            {/* ---- Right Side ---- */}
            <div className="space-y-4">

              {/* Risk Metrics Panel */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider mb-4" style={{ color: CYAN }}>
                    Risk Overview
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Total Margin Used', value: `$${totalMarginUsed.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, color: 'text-white' },
                      { label: 'Available Margin', value: `$${availableMargin.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, color: 'text-cyan-400' },
                      { label: 'Margin Ratio', value: `${marginRatio.toFixed(1)}%`, color: marginRatio > 50 ? 'text-green-400' : marginRatio > 25 ? 'text-amber-400' : 'text-red-400' },
                      { label: 'Maintenance Margin', value: `$${maintenanceMargin.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, color: 'text-black-300' },
                    ].map((m) => (
                      <div key={m.label} className="rounded-lg p-2.5 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}08` }}>
                        <p className={`text-sm font-mono font-bold ${m.color}`}>{m.value}</p>
                        <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-1">{m.label}</p>
                      </div>
                    ))}
                  </div>
                  <HealthBar ratio={healthRatio} />
                </div>
              </GlassCard>

              {/* Open Positions Table */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Open Positions</h3>
                    <span className="text-[9px] font-mono text-black-500">{positions.length} active</span>
                  </div>

                  {/* Table Header — desktop only */}
                  <div className="hidden sm:grid grid-cols-[1fr_0.6fr_0.8fr_0.9fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 pb-2 mb-2"
                    style={{ borderBottom: `1px solid ${CYAN}10` }}>
                    {['Pair', 'Side', 'Size', 'Entry', 'Mark', 'PnL', 'Liq. Price', 'Actions'].map((h) => (
                      <p key={h} className="text-[8px] font-mono text-black-500 uppercase tracking-wider">{h}</p>
                    ))}
                  </div>

                  {/* Position Rows */}
                  <div className="space-y-1.5">
                    {positions.length === 0 && isConnected && (
                      <div className="text-center py-6 text-black-500 text-sm font-mono">No open positions</div>
                    )}
                    {positions.map((pos, i) => (
                      <motion.div key={pos.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + i * 0.06 }}
                        className="rounded-lg p-2.5 transition-all hover:bg-white/[0.02]"
                        style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${pos.positive ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}` }}>

                        {/* Desktop row */}
                        <div className="hidden sm:grid grid-cols-[1fr_0.6fr_0.8fr_0.9fr_0.9fr_0.8fr_0.9fr_0.6fr] gap-2 items-center">
                          <span className="text-xs font-mono font-bold text-white">{pos.pair}</span>
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded w-fit ${
                            pos.side === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                            {pos.side.toUpperCase()} {pos.leverage}
                          </span>
                          <span className="text-[11px] font-mono text-black-300">{pos.size}</span>
                          <span className="text-[11px] font-mono text-black-300">{pos.entryPrice}</span>
                          <span className="text-[11px] font-mono text-white">{pos.markPrice}</span>
                          <div>
                            <span className={`text-[11px] font-mono font-bold ${pos.positive ? 'text-green-400' : 'text-red-400'}`}>{pos.pnl}</span>
                            <span className={`block text-[9px] font-mono ${pos.positive ? 'text-green-400/60' : 'text-red-400/60'}`}>{pos.pnlPct}</span>
                          </div>
                          <span className="text-[11px] font-mono text-red-400/80">{pos.liqPrice}</span>
                          <button className="text-[9px] font-mono px-2 py-1 rounded transition-all hover:bg-red-500/20 hover:text-red-400"
                            style={{ background: 'rgba(239,68,68,0.08)', color: '#ef444480', border: '1px solid rgba(239,68,68,0.1)' }}>
                            Close
                          </button>
                        </div>

                        {/* Mobile row */}
                        <div className="sm:hidden space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-white">{pos.pair}</span>
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                pos.side === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                                {pos.side.toUpperCase()} {pos.leverage}
                              </span>
                            </div>
                            <span className={`text-xs font-mono font-bold ${pos.positive ? 'text-green-400' : 'text-red-400'}`}>{pos.pnl}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <DetailCell label="Size" value={pos.size} />
                            <DetailCell label="Entry" value={pos.entryPrice} />
                            <DetailCell label="Mark" value={pos.markPrice} color="text-white" />
                            <DetailCell label="Liq." value={pos.liqPrice} color="text-red-400" />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Total PnL */}
                  <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${CYAN}10` }}>
                    <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Total Unrealized PnL</span>
                    {(() => {
                      const total = positions.reduce((s, p) => s + p.pnlRaw, 0)
                      return (
                        <span className={`text-sm font-mono font-bold ${total >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {total >= 0 ? '+' : ''}${total.toFixed(2)}
                        </span>
                      )
                    })()}
                  </div>
                </div>
              </GlassCard>

              {/* Funding Rate Display */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Funding Rates</h3>
                    <span className="text-[9px] font-mono text-black-500">8h cycle — Next in {FUNDING_RATES[0].cycle}</span>
                  </div>

                  <div className="space-y-2">
                    {FUNDING_RATES.map((fr, i) => {
                      const rng2 = seededRandom(i * 7 + 13)
                      const sparkRates = [...Array.from({ length: 8 }, () => fr.current + (rng2() - 0.5) * 0.004), fr.current]
                      return (
                        <motion.div key={fr.pair} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 + i * 0.06 }}
                          className="flex items-center gap-3 rounded-lg p-3"
                          style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${CYAN}08` }}>
                          <span className="text-xs font-mono font-bold text-white w-24 shrink-0">{fr.pair}</span>
                          <div className="flex-1 grid grid-cols-3 gap-2">
                            <div>
                              <p className="text-[8px] font-mono text-black-500 uppercase">Current</p>
                              <p className={`text-[11px] font-mono font-bold ${fr.current >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {fr.current >= 0 ? '+' : ''}{(fr.current * 100).toFixed(4)}%
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] font-mono text-black-500 uppercase">Predicted</p>
                              <p className={`text-[11px] font-mono ${fr.predicted >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                                {fr.predicted >= 0 ? '+' : ''}{(fr.predicted * 100).toFixed(4)}%
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] font-mono text-black-500 uppercase">Annualized</p>
                              <p className={`text-[11px] font-mono ${parseFloat(fr.annualized) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                                {fr.annualized}
                              </p>
                            </div>
                          </div>
                          <div className="w-24 shrink-0 hidden sm:block">
                            <FundingSparkline rates={sparkRates} height={28} />
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  <div className="mt-3 rounded-lg p-2.5" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}12` }}>
                    <p className="text-[10px] font-mono text-cyan-400/80 text-center">
                      Longs pay shorts when funding is positive. Shorts pay longs when negative.
                    </p>
                  </div>
                </div>
              </GlassCard>
            </div>
          </div>
        </motion.div>

        {/* ============ MEV Protection Info ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible" className="mt-6">
          <GlassCard glowColor="terminal" spotlight>
            <div className="p-5 md:p-6">
              <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-3" style={{ color: CYAN }}>
                MEV-Protected Margin Trading
              </h3>
              <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                Every margin order goes through VibeSwap's commit-reveal batch auction. Your position
                opening, closing, and liquidation execution are all protected from front-running and sandwich attacks.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { step: '1', title: 'Commit Order', desc: 'Your margin order is hashed — size, leverage, and direction are hidden from validators' },
                  { step: '2', title: 'Batch Settlement', desc: 'All orders in the 10-second batch receive the same uniform clearing price' },
                  { step: '3', title: 'Isolated Execution', desc: 'Each position is independently margined — one liquidation never cascades to another' },
                ].map((item, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * (0.1 * PHI), duration: 0.35, ease }}
                    className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}12` }}>
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                        style={{ background: `${CYAN}15`, color: CYAN }}>{item.step}</div>
                      <p className="text-xs font-mono font-bold text-white">{item.title}</p>
                    </div>
                    <p className="text-[10px] font-mono text-black-400 leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/', label: 'Spot Trading' },
              { path: '/perpetuals', label: 'Perpetuals' },
              { path: '/options', label: 'Options' },
              { path: '/lending', label: 'Lending' },
              { path: '/insurance', label: 'Insurance' },
            ].map((link) => (
              <Link key={link.path} to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-cyan-400"
                style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}>
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.8 }}
          className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
            VibeSwap Margin — Isolated Risk, Fair Execution
          </p>
        </motion.div>
      </div>
    </div>
  )
}
