import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { usePriceFeed } from '../hooks/usePriceFeed'
import GlassCard from './ui/GlassCard'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect } from 'react'

// ============ Constants ============
const PHI = 1.618033988749895
const DURATION = 1 / (PHI * PHI * PHI)
const STAGGER = DURATION * PHI
const CYAN = '#06b6d4'
const EASE = [0.25, 0.1, 0.25, 1]

const TOKEN_COLORS = {
  ETH: '#627eea', BTC: '#f7931a', JUL: '#06b6d4', USDC: '#2775ca',
  SOL: '#9945ff', AVAX: '#e84142', MATIC: '#8247e5', ARB: '#28a0f0',
  OP: '#ff0420', BASE: '#0052ff',
}
const TOKEN_NAMES = {
  ETH: 'Ethereum', BTC: 'Bitcoin', JUL: 'Joule', USDC: 'USD Coin',
  SOL: 'Solana', AVAX: 'Avalanche', MATIC: 'Polygon', ARB: 'Arbitrum',
  OP: 'Optimism', BASE: 'Base',
}

// ============ Token Symbols for Portfolio ============
const PORTFOLIO_SYMBOLS = ['ETH', 'BTC', 'JUL', 'USDC', 'SOL', 'AVAX', 'MATIC', 'ARB', 'OP', 'BASE']

// Mock data for demo mode only (no wallet connected)
const MOCK_HOLDINGS = [
  { symbol: 'ETH',   amount: 3.247,  price: 3412.50,  change24h: 2.34 },
  { symbol: 'BTC',   amount: 0.1854, price: 67891.00, change24h: 1.12 },
  { symbol: 'JUL',   amount: 24500,  price: 0.042,    change24h: 8.76 },
  { symbol: 'USDC',  amount: 5000,   price: 1.00,     change24h: 0.01 },
  { symbol: 'SOL',   amount: 42.8,   price: 178.25,   change24h: -3.21 },
  { symbol: 'AVAX',  amount: 115.6,  price: 38.90,    change24h: -1.45 },
  { symbol: 'MATIC', amount: 3200,   price: 0.92,     change24h: 0.88 },
  { symbol: 'ARB',   amount: 2800,   price: 1.18,     change24h: 4.52 },
  { symbol: 'OP',    amount: 1500,   price: 2.65,     change24h: -0.67 },
  { symbol: 'BASE',  amount: 8500,   price: 0.034,    change24h: 12.30 },
]

const generate30DayData = () => {
  const pts = []
  let v = 28400
  for (let i = 0; i <= 30; i++) {
    v += (Math.random() - 0.42) * 600
    v = Math.max(v * 0.95, v)
    pts.push({ day: i, value: Math.max(20000, v) })
  }
  return pts
}
const PERFORMANCE_DATA = generate30DayData()

const MOCK_TRANSACTIONS = [
  { id: 1, type: 'swap',    desc: 'Swapped 0.5 ETH -> 1,706 USDC',   time: '12m ago', value: '+$1,706.25' },
  { id: 2, type: 'stake',   desc: 'Staked 500 JUL in 90-day pool',    time: '2h ago',  value: '$21.00' },
  { id: 3, type: 'receive', desc: 'Received 0.25 ETH from 0x7a...3f', time: '5h ago',  value: '+$853.12' },
  { id: 4, type: 'lp',      desc: 'Added ETH/USDC LP position',       time: '1d ago',  value: '$4,200.00' },
  { id: 5, type: 'send',    desc: 'Sent 200 USDC to 0xd4...8b',       time: '2d ago',  value: '-$200.00' },
]

const DEFI_POSITIONS = {
  staking: [
    { token: 'JUL', amount: 10000, apr: 12.5, lockDays: 90, earned: 312.5 },
    { token: 'ETH', amount: 1.5, apr: 4.2, lockDays: 0, earned: 0.016 },
  ],
  lp: [
    { pair: 'ETH/USDC', value: 4200, apr: 18.3, share: 0.0012 },
    { pair: 'JUL/ETH', value: 1850, apr: 42.7, share: 0.0058 },
  ],
  lending: [
    { token: 'USDC', supplied: 3000, apy: 5.8, earned: 14.50 },
  ],
}

const RISK_METRICS = { sharpe: 1.87, maxDrawdown: -12.4, volatility: 18.6, beta: 0.92 }

// ============ Helpers ============
const Section = ({ children, className = '' }) => (
  <div className={`mb-8 ${className}`}>{children}</div>
)

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION * PHI, delay, ease: EASE } },
})
const scaleIn = (delay = 0) => ({
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION * PHI, delay, ease: EASE } },
})
const slideIn = (delay = 0) => ({
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION, delay, ease: EASE } },
})

// ============ Animated Counter ============
function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 2, className = '' }) {
  const motionVal = useMotionValue(0)
  const rounded = useTransform(motionVal, (v) =>
    `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`
  )
  const nodeRef = useRef(null)
  useEffect(() => {
    const ctrl = animate(motionVal, value, { duration: 1.2 * PHI, ease: EASE })
    return ctrl.stop
  }, [value, motionVal])
  useEffect(() => {
    const unsub = rounded.on('change', (v) => { if (nodeRef.current) nodeRef.current.textContent = v })
    return unsub
  }, [rounded])
  return <span ref={nodeRef} className={className}>{prefix}0{suffix}</span>
}

// ============ SVG Pie Chart ============
function AllocationPie({ holdings, totalValue }) {
  const segments = useMemo(() => {
    if (totalValue === 0) return []
    const result = []
    let cum = 0
    for (const h of holdings) {
      const pct = (h.amount * h.price) / totalValue
      if (pct <= 0) continue
      const ang = pct * 360, s = cum, e = cum + ang
      const la = ang > 180 ? 1 : 0
      const sr = ((s - 90) * Math.PI) / 180, er = ((e - 90) * Math.PI) / 180
      const x1 = 80 + 60 * Math.cos(sr), y1 = 80 + 60 * Math.sin(sr)
      const x2 = 80 + 60 * Math.cos(er), y2 = 80 + 60 * Math.sin(er)
      result.push({ symbol: h.symbol, pct, color: TOKEN_COLORS[h.symbol] || '#666',
        d: `M80,80 L${x1},${y1} A60,60 0 ${la},1 ${x2},${y2} Z` })
      cum += ang
    }
    return result
  }, [holdings, totalValue])

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
        <circle cx="80" cy="80" r="60" fill="rgba(17,17,17,0.6)" />
        {segments.map((s, i) => (
          <motion.path key={s.symbol} d={s.d} fill={s.color}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 0.85, scale: 1 }}
            transition={{ duration: 0.5, delay: i * STAGGER }}
            style={{ transformOrigin: '80px 80px', filter: `drop-shadow(0 0 4px ${s.color}40)` }} />
        ))}
        <circle cx="80" cy="80" r="32" fill="rgba(10,10,10,0.95)" />
        <text x="80" y="78" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold" className="font-mono">{segments.length}</text>
        <text x="80" y="92" textAnchor="middle" fill="#666" fontSize="9" className="font-mono">TOKENS</text>
      </svg>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {segments.map((s) => (
          <div key={s.symbol} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="font-mono text-[10px] text-gray-300">{s.symbol}</span>
            <span className="font-mono text-[10px] text-gray-500">{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Performance Line Chart (SVG) ============
function PerformanceChart({ data }) {
  if (!data || data.length === 0) return null
  const values = data.map((d) => d.value)
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const W = 480, H = 140, P = 10
  const pts = data.map((d, i) => [
    P + (i / (data.length - 1)) * (W - P * 2),
    H - P - ((d.value - min) / range) * (H - P * 2),
  ])
  const polyline = pts.map((p) => p.join(',')).join(' ')
  const area = `M${P},${H - P} ${pts.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${H - P} Z`
  const pctChange = ((values[values.length - 1] - values[0]) / values[0] * 100).toFixed(2)
  const positive = parseFloat(pctChange) >= 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-gray-300">
          ${values[values.length - 1].toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
        <span className={`font-mono text-xs ${positive ? 'text-green-400' : 'text-red-400'}`}>
          {positive ? '+' : ''}{pctChange}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        <defs>
          <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.18" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((pct) => (
          <line key={pct} x1={P} y1={P + pct * (H - P * 2)} x2={W - P} y2={P + pct * (H - P * 2)}
            stroke="rgba(40,40,40,0.6)" strokeWidth="0.5" strokeDasharray="4 4" />
        ))}
        <motion.path d={area} fill="url(#perfGrad)" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: STAGGER }} />
        <motion.polyline points={polyline} fill="none" stroke={CYAN} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.8, delay: STAGGER * 0.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 4px ${CYAN}60)` }} />
        <motion.circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill={CYAN}
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.3, delay: 2 }}
          style={{ filter: `drop-shadow(0 0 8px ${CYAN})` }} />
      </svg>
      <div className="flex justify-between mt-1 px-1">
        <span className="font-mono text-[9px] text-gray-600">30d ago</span>
        <span className="font-mono text-[9px] text-gray-600">Today</span>
      </div>
    </div>
  )
}

// ============ Section Header ============
function SectionHeader({ title, delay = 0 }) {
  return (
    <motion.div variants={fadeUp(delay)} initial="hidden" animate="visible" className="flex items-center gap-3 mb-3">
      <div className="w-1.5 h-4 rounded-full" style={{ backgroundColor: CYAN, boxShadow: `0 0 8px ${CYAN}60` }} />
      <h2 className="font-mono text-xs text-gray-400 uppercase tracking-widest">{title}</h2>
    </motion.div>
  )
}

// ============ Not Connected State ============
function NotConnectedState() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }} className="max-w-md w-full">
        <GlassCard glowColor="terminal" className="p-8 text-center" hover={false}>
          <div className="relative w-24 h-24 mx-auto mb-6">
            <motion.svg width="96" height="96" viewBox="0 0 96 96"
              animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}>
              <circle cx="48" cy="48" r="38" fill="none" stroke={CYAN} strokeWidth="1.5"
                strokeDasharray="8 12" opacity="0.3" />
            </motion.svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-3xl font-bold"
              style={{ color: CYAN, textShadow: `0 0 20px ${CYAN}40` }}>$</div>
          </div>
          <h2 className="font-mono text-xl font-bold text-white mb-3">PORTFOLIO</h2>
          <div className="h-px w-16 mx-auto mb-4"
            style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }} />
          <p className="font-mono text-sm text-gray-400 mb-6 leading-relaxed">
            Connect your wallet to view holdings,<br />track performance, and manage assets.
          </p>
          <Link to="/" className="inline-block font-mono text-sm px-6 py-2.5 rounded-xl transition-all"
            style={{ color: CYAN, border: `1px solid ${CYAN}40`, background: `${CYAN}10` }}>
            Go to Exchange
          </Link>
        </GlassCard>
      </motion.div>
    </div>
  )
}

// ============ Main Component ============
export default function PortfolioDashboard() {
  const { isConnected: isExternalConnected, shortAddress: externalShortAddress } = useWallet()
  const { isConnected: isDeviceConnected, shortAddress: deviceShortAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const shortAddress = externalShortAddress || deviceShortAddress
  const { getBalance } = useBalances()
  const { getPrice, getChange } = usePriceFeed(PORTFOLIO_SYMBOLS)

  // Use real balances when wallet connected, mock data when not (demo mode)
  const holdings = useMemo(() => {
    if (!isConnected) return MOCK_HOLDINGS
    return PORTFOLIO_SYMBOLS.map(symbol => ({
      symbol,
      amount: getBalance(symbol),
      price: getPrice(symbol),
      change24h: getChange(symbol),
    })).filter(h => h.amount > 0) // Only show tokens with a balance
  }, [isConnected, getBalance, getPrice, getChange])

  const totalValue = useMemo(() => holdings.reduce((s, h) => s + h.amount * h.price, 0), [holdings])
  const change24h = useMemo(() => {
    if (totalValue === 0) return 0
    return holdings.reduce((s, h) => s + ((h.amount * h.price) / totalValue) * h.change24h, 0)
  }, [holdings, totalValue])
  const bestPerformer = useMemo(() => [...holdings].sort((a, b) => b.change24h - a.change24h)[0], [holdings])
  const worstPerformer = useMemo(() => [...holdings].sort((a, b) => a.change24h - b.change24h)[0], [holdings])
  const sortedHoldings = useMemo(() => [...holdings].sort((a, b) => b.amount * b.price - a.amount * a.price), [holdings])

  const totalStakingValue = DEFI_POSITIONS.staking.reduce((s, p) => {
    const h = holdings.find((t) => t.symbol === p.token)
    return s + (h ? p.amount * h.price : 0)
  }, 0)
  const totalLPValue = DEFI_POSITIONS.lp.reduce((s, p) => s + p.value, 0)
  const totalLendingValue = DEFI_POSITIONS.lending.reduce((s, p) => s + p.supplied, 0)

  if (!isConnected) return <NotConnectedState />

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 font-mono relative">
      {/* ============ Header ============ */}
      <motion.div variants={fadeUp(0)} initial="hidden" animate="visible" className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-widest text-white"
          style={{ textShadow: `0 0 30px ${CYAN}20` }}>PORTFOLIO</h1>
        <motion.div className="h-px w-24 mx-auto mt-3 mb-2"
          style={{ background: `linear-gradient(90deg, transparent, ${CYAN}, transparent)` }}
          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, delay: STAGGER }} />
        <p className="text-gray-500 text-xs mt-2 tracking-wider">{shortAddress}</p>
      </motion.div>

      {/* ============ Overview Cards ============ */}
      <Section>
        <SectionHeader title="Overview" delay={STAGGER} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Value', val: totalValue, pre: '$', dec: 2, color: 'text-white' },
            { label: '24h Change', val: change24h, suf: '%', dec: 2,
              color: change24h >= 0 ? 'text-green-400' : 'text-red-400',
              dp: change24h >= 0 ? '+' : '' },
            { label: 'Best Performer', txt: `${bestPerformer.symbol} +${bestPerformer.change24h.toFixed(2)}%`, color: 'text-green-400' },
            { label: 'Worst Performer', txt: `${worstPerformer.symbol} ${worstPerformer.change24h.toFixed(2)}%`, color: 'text-red-400' },
          ].map((c, i) => (
            <motion.div key={c.label} variants={scaleIn(STAGGER * (1.5 + i * 0.3))} initial="hidden" animate="visible">
              <GlassCard glowColor="terminal" className="p-4" hover>
                <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-1">{c.label}</p>
                {c.txt ? (
                  <p className={`text-sm font-bold ${c.color}`}>{c.txt}</p>
                ) : (
                  <p className={`text-lg font-bold ${c.color}`}>
                    {c.dp || ''}<AnimatedNumber value={c.val} prefix={c.pre || ''} suffix={c.suf || ''} decimals={c.dec} />
                  </p>
                )}
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ Allocation + Performance ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Section className="mb-0">
          <SectionHeader title="Asset Allocation" delay={STAGGER * 3} />
          <motion.div variants={fadeUp(STAGGER * 3.5)} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-5" hover={false}>
              <AllocationPie holdings={sortedHoldings} totalValue={totalValue} />
            </GlassCard>
          </motion.div>
        </Section>
        <Section className="mb-0">
          <SectionHeader title="30-Day Performance" delay={STAGGER * 3} />
          <motion.div variants={fadeUp(STAGGER * 3.5)} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-5" hover={false}>
              <PerformanceChart data={PERFORMANCE_DATA} />
            </GlassCard>
          </motion.div>
        </Section>
      </div>

      {/* ============ Holdings Table ============ */}
      <Section>
        <SectionHeader title="Holdings" delay={STAGGER * 4} />
        <motion.div variants={fadeUp(STAGGER * 4.5)} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-0 overflow-hidden" hover={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-800/60">
                    {['Token', 'Amount', 'Value', '24h %', 'Alloc %'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((h, i) => {
                    const val = h.amount * h.price
                    const alloc = totalValue > 0 ? (val / totalValue) * 100 : 0
                    const clr = TOKEN_COLORS[h.symbol] || '#666'
                    return (
                      <motion.tr key={h.symbol} variants={slideIn(STAGGER * (5 + i * 0.15))}
                        initial="hidden" animate="visible"
                        className="border-b border-gray-800/30 last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ backgroundColor: `${clr}20`, border: `1px solid ${clr}40`, color: clr }}>
                              {h.symbol[0]}
                            </div>
                            <div>
                              <div className="text-sm text-white font-medium">{h.symbol}</div>
                              <div className="text-[10px] text-gray-500">{TOKEN_NAMES[h.symbol]}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-300">
                          {h.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-4 py-3 text-xs text-white font-medium">
                          ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className={`px-4 py-3 text-xs font-medium ${h.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {h.change24h >= 0 ? '+' : ''}{h.change24h.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                              <motion.div className="h-full rounded-full" style={{ backgroundColor: clr }}
                                initial={{ width: 0 }} animate={{ width: `${Math.min(alloc, 100)}%` }}
                                transition={{ duration: 0.8, delay: STAGGER * (5.5 + i * 0.1) }} />
                            </div>
                            <span className="text-[10px] text-gray-400 w-10 text-right">{alloc.toFixed(1)}%</span>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.div>
      </Section>

      {/* ============ Transaction History ============ */}
      <Section>
        <SectionHeader title="Recent Transactions" delay={STAGGER * 7} />
        <motion.div variants={fadeUp(STAGGER * 7.5)} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-4" hover={false}>
            {MOCK_TRANSACTIONS.map((tx, i) => {
              const icons = { swap: '\u21C6', stake: '\u2B21', receive: '\u2193', lp: '\u2696', send: '\u2191' }
              const colors = {
                swap: 'text-cyan-400 bg-cyan-500/15', stake: 'text-green-400 bg-green-500/15',
                receive: 'text-blue-400 bg-blue-500/15', lp: 'text-purple-400 bg-purple-500/15',
                send: 'text-amber-400 bg-amber-500/15',
              }
              return (
                <motion.div key={tx.id} variants={slideIn(STAGGER * (7.5 + i * 0.2))}
                  initial="hidden" animate="visible"
                  className="flex items-center gap-3 py-3 border-b border-gray-800/40 last:border-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${colors[tx.type]}`}>
                    {icons[tx.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{tx.desc}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{tx.time}</div>
                  </div>
                  <div className="text-xs text-gray-300 shrink-0">{tx.value}</div>
                </motion.div>
              )
            })}
          </GlassCard>
        </motion.div>
      </Section>

      {/* ============ DeFi Positions ============ */}
      <Section>
        <SectionHeader title="DeFi Positions" delay={STAGGER * 9} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Staking */}
          <motion.div variants={scaleIn(STAGGER * 9.5)} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-4" hover>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Staking</span>
                <span className="text-xs text-white font-medium">${totalStakingValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
              {DEFI_POSITIONS.staking.map((p) => (
                <div key={p.token} className="flex items-center justify-between py-2 border-t border-gray-800/30">
                  <div>
                    <span className="text-xs text-gray-300">{p.amount.toLocaleString()} {p.token}</span>
                    {p.lockDays > 0 && <span className="text-[9px] text-gray-600 ml-1">{p.lockDays}d lock</span>}
                  </div>
                  <span className="text-[10px] text-green-400">{p.apr}% APR</span>
                </div>
              ))}
            </GlassCard>
          </motion.div>
          {/* LP Positions */}
          <motion.div variants={scaleIn(STAGGER * 10)} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-4" hover>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">LP Positions</span>
                <span className="text-xs text-white font-medium">${totalLPValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
              {DEFI_POSITIONS.lp.map((p) => (
                <div key={p.pair} className="flex items-center justify-between py-2 border-t border-gray-800/30">
                  <div>
                    <span className="text-xs text-gray-300">{p.pair}</span>
                    <span className="text-[9px] text-gray-600 ml-1">${p.value.toLocaleString()}</span>
                  </div>
                  <span className="text-[10px] text-green-400">{p.apr}% APR</span>
                </div>
              ))}
            </GlassCard>
          </motion.div>
          {/* Lending */}
          <motion.div variants={scaleIn(STAGGER * 10.5)} initial="hidden" animate="visible">
            <GlassCard glowColor="terminal" className="p-4" hover>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Lending</span>
                <span className="text-xs text-white font-medium">${totalLendingValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
              {DEFI_POSITIONS.lending.map((p) => (
                <div key={p.token} className="flex items-center justify-between py-2 border-t border-gray-800/30">
                  <div>
                    <span className="text-xs text-gray-300">{p.supplied.toLocaleString()} {p.token}</span>
                    <span className="text-[9px] text-gray-600 ml-1">+${p.earned.toFixed(2)} earned</span>
                  </div>
                  <span className="text-[10px] text-green-400">{p.apy}% APY</span>
                </div>
              ))}
            </GlassCard>
          </motion.div>
        </div>
      </Section>

      {/* ============ Risk Metrics ============ */}
      <Section>
        <SectionHeader title="Risk Metrics" delay={STAGGER * 11} />
        <motion.div variants={fadeUp(STAGGER * 11.5)} initial="hidden" animate="visible">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Sharpe Ratio', value: RISK_METRICS.sharpe.toFixed(2), good: RISK_METRICS.sharpe > 1, desc: '> 1.0 is good' },
              { label: 'Max Drawdown', value: `${RISK_METRICS.maxDrawdown}%`, good: RISK_METRICS.maxDrawdown > -20, desc: 'Peak to trough' },
              { label: 'Volatility', value: `${RISK_METRICS.volatility}%`, good: RISK_METRICS.volatility < 25, desc: 'Annualized' },
              { label: 'Beta', value: RISK_METRICS.beta.toFixed(2), good: Math.abs(RISK_METRICS.beta - 1) < 0.2, desc: 'vs. market' },
            ].map((m, i) => (
              <motion.div key={m.label} variants={scaleIn(STAGGER * (11.5 + i * 0.2))} initial="hidden" animate="visible">
                <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">{m.label}</p>
                  <p className={`text-lg font-bold ${m.good ? 'text-green-400' : 'text-amber-400'}`}>{m.value}</p>
                  <p className="text-[9px] text-gray-600 mt-1">{m.desc}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </Section>

      {/* ============ Footer Line ============ */}
      <motion.div className="h-px w-full mb-8"
        style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, delay: STAGGER * 13 }} />
    </div>
  )
}
