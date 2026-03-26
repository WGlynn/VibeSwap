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
    { pair: 'ETH/USD', asset: 'ETH', price: formatPrice(getPrice('ETH')), rawPrice: getPrice('ETH') || 0, change: formatChange(getChange('ETH')), funding: '+0.0042%', rawFunding: 0.0042, oi: '$4.2M', volume24h: '$12.8M', positive: (getChange('ETH') || 0) >= 0, maxLeverage: 50 },
    { pair: 'BTC/USD', asset: 'BTC', price: formatPrice(getPrice('BTC')), rawPrice: getPrice('BTC') || 0, change: formatChange(getChange('BTC')), funding: '+0.0031%', rawFunding: 0.0031, oi: '$8.1M', volume24h: '$24.5M', positive: (getChange('BTC') || 0) >= 0, maxLeverage: 50 },
    { pair: 'SOL/USD', asset: 'SOL', price: formatPrice(getPrice('SOL')), rawPrice: getPrice('SOL') || 0, change: formatChange(getChange('SOL')), funding: '-0.0018%', rawFunding: -0.0018, oi: '$1.8M', volume24h: '$5.4M', positive: (getChange('SOL') || 0) >= 0, maxLeverage: 20 },
    { pair: 'JUL/USD', asset: 'JUL', price: formatPrice(getPrice('JUL')), rawPrice: getPrice('JUL') || 0, change: formatChange(getChange('JUL')), funding: '+0.0012%', rawFunding: 0.0012, oi: '$420K', volume24h: '$1.1M', positive: (getChange('JUL') || 0) >= 0, maxLeverage: 10 },
  ]
}

// ============ Mock Positions ============

const MOCK_POSITIONS = [
  { pair: 'ETH/USD', side: 'long', size: '2.5 ETH', entry: '$3,420', entryRaw: 3420, markRaw: 3602.50, margin: 855, pnl: '+$182.50', pnlPct: '+5.3%', leverage: '10x', liqPrice: '$3,078', marginRatio: 28.4, positive: true },
  { pair: 'BTC/USD', side: 'short', size: '0.15 BTC', entry: '$68,200', entryRaw: 68200, markRaw: 68500, margin: 2046, pnl: '-$45.00', pnlPct: '-0.4%', leverage: '5x', liqPrice: '$81,840', marginRatio: 62.1, positive: false },
]

// ============ Funding Rate History (per pair) ============

const TIMES_7 = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '00:00']
const mkFH = (rates) => rates.map((r, i) => ({ time: TIMES_7[i], rate: r }))
const FUNDING_HISTORY = {
  'ETH/USD': mkFH([0.0042, 0.0038, 0.0045, 0.0051, 0.0033, 0.0028, 0.0042]),
  'BTC/USD': mkFH([0.0031, 0.0029, 0.0035, 0.0040, 0.0027, 0.0022, 0.0031]),
  'SOL/USD': mkFH([-0.0018, -0.0022, -0.0015, -0.0010, -0.0025, -0.0020, -0.0018]),
  'JUL/USD': mkFH([0.0012, 0.0015, 0.0008, 0.0018, 0.0010, 0.0014, 0.0012]),
}

// ============ Mark vs Index Price Data ============

const mkMI = (pairs) => pairs.map(([m, idx], t) => ({ t, mark: m, index: idx }))
const MARK_INDEX_DATA = {
  'ETH/USD': mkMI([[3598,3600],[3610,3605],[3604,3602],[3615,3608],[3607,3606],[3601,3603],[3612,3610],[3605,3604],[3609,3607],[3603,3602]]),
  'BTC/USD': mkMI([[68180,68200],[68350,68280],[68250,68260],[68420,68320],[68300,68310],[68190,68220],[68380,68340],[68270,68280],[68330,68310],[68210,68230]]),
  'SOL/USD': mkMI([[142.5,142.8],[143.1,142.9],[142.7,142.85],[143.3,143.0],[142.9,142.95],[142.6,142.75],[143.2,143.05],[142.8,142.9],[143.0,142.95],[142.7,142.8]]),
  'JUL/USD': mkMI([[.0821,.082],[.0825,.0822],[.0819,.0821],[.0828,.0823],[.0822,.0822],[.0818,.082],[.0826,.0824],[.082,.0821],[.0824,.0823],[.0819,.082]]),
}

// ============ Recent Liquidations ============

const RECENT_LIQUIDATIONS = [
  { pair: 'ETH/USD', side: 'long', size: '$42,800', price: '$3,128', time: '2m ago' },
  { pair: 'BTC/USD', side: 'short', size: '$18,500', price: '$69,420', time: '8m ago' },
  { pair: 'SOL/USD', side: 'long', size: '$6,200', price: '$131.40', time: '14m ago' },
]

// ============ Mini Funding Chart ============

function FundingChart({ data, height = 60 }) {
  const max = Math.max(...data.map(d => d.rate))
  const min = Math.min(...data.map(d => d.rate))
  const range = max - min || 0.001
  const w = 280
  const h = height
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((d.rate - min) / range) * h * 0.8 - h * 0.1
    return `${x},${y}`
  }).join(' ')

  const zeroY = min >= 0 ? h : (max <= 0 ? 0 : h - ((0 - min) / range) * h * 0.8 - h * 0.1)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }}>
      {min < 0 && max > 0 && <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="4,3" />}
      <polyline points={points} fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = (i / (data.length - 1)) * w, y = h - ((d.rate - min) / range) * h * 0.8 - h * 0.1
        return <circle key={i} cx={x} cy={y} r="2.5" fill={CYAN} opacity="0.6" />
      })}
    </svg>
  )
}

// ============ Mark vs Index SVG Chart ============

function MarkIndexChart({ data }) {
  const w = 320, h = 100
  const allVals = data.flatMap(d => [d.mark, d.index])
  const max = Math.max(...allVals), min = Math.min(...allVals), range = max - min || 1
  const toY = (v) => h - ((v - min) / range) * h * 0.8 - h * 0.1
  const toX = (i) => (i / (data.length - 1)) * w
  const markPts = data.map((d, i) => `${toX(i)},${toY(d.mark)}`).join(' ')
  const indexPts = data.map((d, i) => `${toX(i)},${toY(d.index)}`).join(' ')
  const bp = data.map((d, i) => ({ x: toX(i), ym: toY(d.mark), yi: toY(d.index) }))
  const basisFill = `M${bp[0].x},${bp[0].ym} ${bp.slice(1).map(p => `L${p.x},${p.ym}`).join(' ')} L${bp[bp.length-1].x},${bp[bp.length-1].yi} ${bp.slice(0,-1).reverse().map(p => `L${p.x},${p.yi}`).join(' ')} Z`
  const last = data[data.length - 1]
  const basisBps = (((last.mark - last.index) / last.index) * 10000).toFixed(1)
  const Legend = ({ color, label }) => (
    <div className="flex items-center gap-1.5">
      <div className="w-3 h-0.5 rounded-full" style={{ background: color }} />
      <span className="text-[9px] font-mono text-black-400">{label}</span>
    </div>
  )
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <Legend color={CYAN} label="Mark" />
          <Legend color="#a855f7" label="Index" />
        </div>
        <span className={`text-[10px] font-mono font-bold ${parseFloat(basisBps) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
          Basis: {basisBps} bps
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: h }}>
        <path d={basisFill} fill={`${CYAN}10`} />
        <polyline points={indexPts} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        <polyline points={markPts} fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={toX(data.length - 1)} cy={toY(last.mark)} r="3" fill={CYAN} />
        <circle cx={toX(data.length - 1)} cy={toY(last.index)} r="3" fill="#a855f7" opacity="0.7" />
      </svg>
    </div>
  )
}

// ============ Leverage Slider ============

function LeverageSlider({ value, onChange, max = 50 }) {
  const stops = [1, 2, 5, 10, 20, 50].filter(s => s <= max)
  const pct = ((value - 1) / (max - 1)) * 100

  const riskColor = value <= 5 ? '#22c55e' : value <= 20 ? '#f59e0b' : '#ef4444'
  const riskLabel = value <= 5 ? 'Low' : value <= 20 ? 'Medium' : 'High'

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Leverage</p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${riskColor}15`, color: riskColor, border: `1px solid ${riskColor}30` }}>
            {riskLabel} Risk
          </span>
          <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>{value}x</span>
        </div>
      </div>
      <div className="relative h-8 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #22c55e, ${CYAN}, #f59e0b, #ef4444)` }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.15 }}
          />
        </div>
        <input type="range" min={1} max={max} step={1} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute inset-x-0 w-full h-8 opacity-0 cursor-pointer" style={{ zIndex: 2 }} />
        <motion.div className="absolute w-4 h-4 rounded-full border-2"
          style={{ left: `calc(${pct}% - 8px)`, background: '#0f0f0f', borderColor: CYAN, boxShadow: `0 0 8px ${CYAN}40`, zIndex: 1 }}
          animate={{ left: `calc(${pct}% - 8px)` }} transition={{ duration: 0.15 }} />
      </div>
      <div className="flex justify-between mt-1">
        {stops.map((s) => (
          <button key={s} onClick={() => onChange(s)} className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-all ${value === s ? 'text-cyan-400 font-bold' : 'text-black-500 hover:text-black-300'}`}>{s}x</button>
        ))}
      </div>
    </div>
  )
}

// ============ Position Manager ============

const DetailCell = ({ label, value, color, style }) => (
  <div>
    <p className="text-[8px] font-mono text-black-500 uppercase">{label}</p>
    <p className={`text-[10px] font-mono ${color || 'text-black-300'}`} style={style}>{value}</p>
  </div>
)

function PositionManager({ positions }) {
  const totalPnl = positions.reduce((sum, p) => {
    const val = parseFloat(p.pnl.replace(/[^-\d.]/g, ''))
    return sum + (p.pnl.startsWith('-') ? -Math.abs(val) : val)
  }, 0)
  const totalPositive = totalPnl >= 0
  const marginColor = (r) => r > 50 ? '#22c55e' : r > 20 ? '#f59e0b' : '#ef4444'

  return (
    <div>
      <div className="flex items-center justify-between mb-3 pb-3" style={{ borderBottom: `1px solid ${CYAN}10` }}>
        <div>
          <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Total Unrealized PnL</p>
          <p className={`text-sm font-mono font-bold ${totalPositive ? 'text-green-400' : 'text-red-400'}`}>
            {totalPositive ? '+' : ''}${totalPnl.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Positions</p>
          <p className="text-sm font-mono font-bold text-white">{positions.length}</p>
        </div>
      </div>
      <div className="space-y-2">
        {positions.length === 0 && (
          <div className="text-center py-4 text-black-500 text-sm font-mono">No open positions</div>
        )}
        {positions.map((pos, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
            className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${pos.positive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-white">{pos.pair}</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${pos.side === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                  {pos.side.toUpperCase()} {pos.leverage}
                </span>
              </div>
              <div className="text-right">
                <p className={`text-xs font-mono font-bold ${pos.positive ? 'text-green-400' : 'text-red-400'}`}>{pos.pnl}</p>
                <p className={`text-[9px] font-mono ${pos.positive ? 'text-green-400/60' : 'text-red-400/60'}`}>{pos.pnlPct}</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <DetailCell label="Entry" value={pos.entry} />
              <DetailCell label="Mark" value={`$${pos.markRaw.toLocaleString('en-US', { maximumFractionDigits: 2 })}`} color="text-white" />
              <DetailCell label="Liq. Price" value={pos.liqPrice} color="text-red-400" />
              <DetailCell label="Margin" value={`${pos.marginRatio}%`} style={{ color: marginColor(pos.marginRatio) }} />
            </div>
            <div className="mt-2 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pos.marginRatio, 100)}%`, background: marginColor(pos.marginRatio) }} />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Insurance Fund Status ============

function InsuranceFundStatus() {
  const sources = [
    { name: 'Liquidation Surplus', pct: 45, color: '#22c55e' },
    { name: 'Trading Fees (10%)', pct: 30, color: CYAN },
    { name: 'Treasury Allocation', pct: 15, color: '#a855f7' },
    { name: 'Penalty Fees', pct: 10, color: '#f59e0b' },
  ]
  const stats = [
    { value: '$2.4M', label: 'Balance', color: 'text-white' },
    { value: '98.2%', label: 'Coverage', color: 'text-green-400' },
    { value: '$67.5K', label: '24h Claims', color: 'text-white' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {stats.map(s => (
          <div key={s.label}>
            <p className={`text-lg font-mono font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {sources.map((s, i) => (
          <motion.div key={s.name} initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 0.2 + i * 0.1, duration: 0.4, ease }} style={{ transformOrigin: 'left' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono text-black-300">{s.name}</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: s.color }}>{s.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-black-800">
              <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color, opacity: 0.7 }} />
            </div>
          </motion.div>
        ))}
      </div>
      <div>
        <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-2">Recent Liquidations</p>
        <div className="space-y-1">
          {RECENT_LIQUIDATIONS.map((liq, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.08 }} className="flex items-center justify-between rounded-md px-2.5 py-1.5"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(239,68,68,0.1)' }}>
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                  liq.side === 'long' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                }`}>{liq.side.toUpperCase()}</span>
                <span className="text-[10px] font-mono text-white">{liq.pair}</span>
              </div>
              <span className="text-[10px] font-mono text-red-400">{liq.size}</span>
              <span className="text-[9px] font-mono text-black-500">{liq.time}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
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

// ============ Funding Rate Display ============

function FundingRateDisplay({ markets, selectedMarket, onSelect }) {
  return (
    <div className="space-y-2">
      {markets.map((m, i) => {
        const isNeg = m.rawFunding < 0
        return (
          <motion.div
            key={m.pair}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onSelect(i)}
            className={`flex items-center justify-between rounded-lg p-2.5 cursor-pointer transition-all ${
              selectedMarket === i ? 'ring-1 ring-cyan-500/30' : ''
            }`}
            style={{ background: selectedMarket === i ? `${CYAN}08` : 'rgba(0,0,0,0.25)', border: `1px solid ${selectedMarket === i ? `${CYAN}20` : 'transparent'}` }}
          >
            <span className="text-xs font-mono font-bold text-white w-20">{m.pair}</span>
            <span className={`text-xs font-mono font-bold ${isNeg ? 'text-red-400' : 'text-green-400'}`}>{m.funding}</span>
            <span className="text-[9px] font-mono text-black-500">/8h</span>
            <div className="w-20">
              <FundingChart data={FUNDING_HISTORY[m.pair] || []} height={24} />
            </div>
          </motion.div>
        )
      })}
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

  const liqPriceFormatted = useMemo(() => {
    if (!market.rawPrice || !amount || parseFloat(amount) <= 0) return null
    const p = market.rawPrice
    const lp = side === 'long' ? p * (1 - 0.9 / leverage) : p * (1 + 0.9 / leverage)
    const distPct = Math.abs(((lp - p) / p) * 100).toFixed(1)
    return { price: liqPrice, distPct }
  }, [market.rawPrice, amount, leverage, side, liqPrice])

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
            Trade perpetual futures with up to 50x leverage. PID-controlled funding. MEV-free.
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

                {/* Leverage Slider */}
                <div className="mb-4">
                  <LeverageSlider value={leverage} onChange={setLeverage} max={market.maxLeverage} />
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

                {/* Position Details + Liquidation Price */}
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
                        <div className="text-right">
                          <span className="text-red-400">{liqPrice}</span>
                          {liqPriceFormatted && (
                            <span className="text-[9px] font-mono text-black-500 ml-1.5">({liqPriceFormatted.distPct}% away)</span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Funding Rate</span>
                        <span className="text-black-300">{market.funding}/8h</span>
                      </div>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-black-400">Fee (0.05%)</span>
                        <span className="text-black-300">{(parseFloat(positionSize) * 0.0005).toFixed(6)} {market.asset}</span>
                      </div>
                      {/* Liquidation warning */}
                      {leverage >= 20 && (
                        <div className="mt-1 rounded-md p-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          <p className="text-[9px] font-mono text-red-400 text-center">
                            High leverage — liquidation at {liqPriceFormatted?.distPct || '--'}% from entry
                          </p>
                        </div>
                      )}
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
                  {!isConnected ? 'Sign In' : `Open ${side === 'long' ? 'Long' : 'Short'} ${leverage}x`}
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

              {/* Mark vs Index Price Chart */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Mark vs Index Price</h3>
                    <span className="text-[10px] font-mono text-black-400">Last 10 batches</span>
                  </div>
                  <MarkIndexChart data={MARK_INDEX_DATA[market.pair] || MARK_INDEX_DATA['ETH/USD']} />
                </div>
              </GlassCard>

              {/* Funding Rate Display */}
              <GlassCard glowColor="terminal">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: CYAN }}>Funding Rates</h3>
                    <span className="text-[10px] font-mono text-black-400">Current + 24h</span>
                  </div>
                  <FundingRateDisplay markets={MARKETS_DATA} selectedMarket={selectedMarket} onSelect={setSelectedMarket} />
                </div>
              </GlassCard>

              {/* Positions (connected only) */}
              {isConnected && (
                <GlassCard glowColor="terminal">
                  <div className="p-4">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider mb-3" style={{ color: CYAN }}>Your Positions</h3>
                    <PositionManager positions={[]} />
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
                      Insurance Fund Status
                    </h3>
                    <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                      The insurance fund backstops liquidation losses and ensures counterparty solvency.
                      Funded through multiple revenue streams for redundancy.
                    </p>
                    <InsuranceFundStatus />
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
