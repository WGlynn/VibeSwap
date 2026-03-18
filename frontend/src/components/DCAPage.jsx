import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const BUY_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
  { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
  { symbol: 'SOL', name: 'Solana', color: '#9945ff' },
  { symbol: 'JUL', name: 'Joule', color: CYAN },
  { symbol: 'ARB', name: 'Arbitrum', color: '#28a0f0' },
  { symbol: 'OP', name: 'Optimism', color: '#ff0420' },
]
const SPEND_TOKENS = [
  { symbol: 'USDC', name: 'USD Coin', color: '#2775ca' },
  { symbol: 'USDT', name: 'Tether', color: '#26a17b' },
  { symbol: 'DAI', name: 'Dai', color: '#f5ac37' },
]
const FREQUENCIES = [
  { id: 'hourly', label: 'Hourly', days: 1 / 24 },
  { id: 'daily', label: 'Daily', days: 1 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'monthly', label: 'Monthly', days: 30 },
]
const DURATIONS = [
  { id: 'ongoing', label: 'Ongoing', months: null }, { id: '3m', label: '3 Months', months: 3 },
  { id: '6m', label: '6 Months', months: 6 }, { id: '1y', label: '1 Year', months: 12 },
]
const STRATEGY_TEMPLATES = [
  { id: 'eth-acc', name: 'ETH Accumulator', token: 'ETH', spend: 'USDC', amount: 100, frequency: 'weekly', duration: '1y', desc: 'Steady weekly ETH accumulation for long-term holders', icon: '627eea' },
  { id: 'btc-stack', name: 'BTC Stack', token: 'BTC', spend: 'USDC', amount: 250, frequency: 'monthly', duration: '1y', desc: 'Monthly Bitcoin stacking -- classic accumulation strategy', icon: 'f7931a' },
  { id: 'stable-yield', name: 'Stablecoin Yield', token: 'JUL', spend: 'DAI', amount: 50, frequency: 'daily', duration: '6m', desc: 'Daily micro-buys to farm JUL rewards on stablecoin base', icon: '06b6d4' },
]

// ============ Mock Data ============
const MOCK_STRATEGIES = [
  { id: 1, token: 'ETH', spend: 'USDC', amount: 100, frequency: 'Weekly', totalInvested: 2600, currentValue: 3120, avgPrice: 3380, nextBuy: new Date(Date.now() + 3 * 86400000), active: true, executions: 26, startDate: new Date(Date.now() - 182 * 86400000), targetExecs: 52 },
  { id: 2, token: 'BTC', spend: 'USDC', amount: 250, frequency: 'Monthly', totalInvested: 3000, currentValue: 3450, avgPrice: 64200, nextBuy: new Date(Date.now() + 18 * 86400000), active: true, executions: 12, startDate: new Date(Date.now() - 365 * 86400000), targetExecs: 12 },
  { id: 3, token: 'JUL', spend: 'USDC', amount: 50, frequency: 'Daily', totalInvested: 1500, currentValue: 1890, avgPrice: 0.42, nextBuy: new Date(Date.now() + 0.5 * 86400000), active: false, executions: 30, startDate: new Date(Date.now() - 30 * 86400000), targetExecs: 180 },
]
const PERF_DATA = Array.from({ length: 52 }, (_, i) => ({
  week: i + 1,
  market: Math.round(3000 + Math.sin(i * 0.3) * 400 + Math.cos(i * 0.7) * 200 + i * 12),
  dca: Math.round(3000 + i * 7.2 + Math.sin(i * 0.15) * 100),
  lump: Math.round(3200 + Math.sin(i * 0.3) * 380 + Math.cos(i * 0.7) * 190 + i * 5),
}))
const SIM = { token: 'ETH', weekly: 100, totalInvested: 5200, currentValue: 5742, tokens: 1.624, avgPrice: 3201, gain: 542, gainPct: 10.42, lumpReturn: -5.96 }

// ============ Helpers ============
const fmt = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toFixed(2)
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const daysUntil = (d) => Math.max(0, Math.ceil((d - Date.now()) / 86400000))
const pct = (cur, inv) => inv ? ((cur - inv) / inv) * 100 : 0
const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', outline: 'none' }

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

function Toggle({ on, onToggle }) {
  return (
    <button onClick={onToggle} className="relative w-12 h-6 rounded-full transition-colors" style={{ background: on ? CYAN : 'rgba(255,255,255,0.1)' }}>
      <motion.div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow" animate={{ left: on ? 26 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
    </button>
  )
}

function TokenDropdown({ tokens, selected, onSelect, open, setOpen }) {
  const t = tokens[selected]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white text-left flex items-center justify-between" style={inputStyle}>
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.symbol} — {t.name}
        </span>
        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            {tokens.map((tk, i) => (
              <button key={tk.symbol} onClick={() => { onSelect(i); setOpen(false) }}
                className="w-full px-4 py-2.5 font-mono text-sm text-left flex items-center gap-2 hover:bg-white/5 text-gray-300 hover:text-white transition-colors">
                <span className="w-2 h-2 rounded-full" style={{ background: tk.color }} />{tk.symbol} — {tk.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PillSelect({ items, value, onChange, keyFn = (x) => x.id, labelFn = (x) => x.label }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(item => {
        const active = keyFn(item) === value
        return (
          <button key={keyFn(item)} onClick={() => onChange(keyFn(item))}
            className="px-2 py-2.5 rounded-lg font-mono text-xs transition-all"
            style={{ background: active ? `${CYAN}20` : 'rgba(255,255,255,0.04)', border: `1px solid ${active ? CYAN : 'rgba(255,255,255,0.08)'}`, color: active ? CYAN : '#9ca3af' }}>
            {labelFn(item)}
          </button>
        )
      })}
    </div>
  )
}

// ============ Strategy Card ============
function StrategyCard({ s, onToggle, onRemove }) {
  const gl = s.currentValue - s.totalInvested
  const glP = pct(s.currentValue, s.totalInvested)
  const pos = gl >= 0
  const progress = s.targetExecs > 0 ? Math.min(100, (s.executions / s.targetExecs) * 100) : null
  const tokenColor = BUY_TOKENS.find(t => t.symbol === s.token)?.color || CYAN
  // Mini sparkline: deterministic from strategy id
  const spark = Array.from({ length: 12 }, (_, i) => {
    const seed = (s.id * 7 + i * 13) % 100
    return 20 + seed * 0.6 + (pos ? i * 2 : -i * 1.5)
  })
  const sparkMax = Math.max(...spark), sparkMin = Math.min(...spark)
  const sparkPath = spark.map((v, i) => {
    const x = (i / 11) * 100, y = 30 - ((v - sparkMin) / (sparkMax - sparkMin || 1)) * 28
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
      <GlassCard glowColor="terminal" className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: tokenColor }} />
            <span className="text-white font-bold font-mono text-sm">{s.token}<span className="text-gray-600">/{s.spend}</span></span>
            {!s.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500">PAUSED</span>}
          </div>
          <span className="text-xs font-mono text-gray-500">${s.amount} / {s.frequency}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[10px] text-gray-500 font-mono">Invested</div>
            <div className="text-sm font-bold font-mono text-white">{fmt(s.totalInvested)}</div>
          </div>
          <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[10px] text-gray-500 font-mono">Current Value</div>
            <div className="text-sm font-bold font-mono text-white">{fmt(s.currentValue)}</div>
          </div>
          <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="text-[10px] text-gray-500 font-mono">Avg Price</div>
            <div className="text-sm font-bold font-mono text-white">${s.avgPrice.toLocaleString()}</div>
          </div>
          <div className="rounded-lg p-2" style={{ background: pos ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)' }}>
            <div className="text-[10px] text-gray-500 font-mono">Gain/Loss</div>
            <div className={`text-sm font-bold font-mono ${pos ? 'text-emerald-400' : 'text-red-400'}`}>{pos ? '+' : ''}{glP.toFixed(1)}%</div>
          </div>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <svg viewBox="0 0 100 32" className="flex-1" style={{ height: 24 }}>
            <path d={sparkPath} fill="none" stroke={pos ? '#34d399' : '#f87171'} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className={`text-[10px] font-mono font-bold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
            {pos ? '+' : ''}{glP.toFixed(1)}%
          </span>
        </div>
        {progress !== null && (
          <div className="mb-3">
            <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
              <span>{s.executions} executions</span><span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <motion.div className="h-full rounded-full" style={{ background: CYAN, width: `${progress}%` }} initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-gray-500">Next: {fmtDate(s.nextBuy)} ({daysUntil(s.nextBuy)}d)</span>
          <div className="flex gap-1.5">
            <button onClick={() => onToggle(s.id)} className="px-2 py-1 rounded-md text-xs font-mono"
              style={{ background: s.active ? 'rgba(234,179,8,0.1)' : `${CYAN}15`, color: s.active ? '#eab308' : CYAN, border: `1px solid ${s.active ? 'rgba(234,179,8,0.2)' : `${CYAN}30`}` }}>
              {s.active ? 'Pause' : 'Resume'}</button>
            <button onClick={() => onRemove(s.id)} className="px-2 py-1 rounded-md text-xs font-mono text-red-400"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>Stop</button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
export default function DCAPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [buyToken, setBuyToken] = useState(0), [spendToken, setSpendToken] = useState(0)
  const [amountPerInterval, setAmountPerInterval] = useState('')
  const [frequency, setFrequency] = useState('weekly'), [duration, setDuration] = useState('ongoing')
  const [startDate, setStartDate] = useState('')
  const [showBuy, setShowBuy] = useState(false), [showSpend, setShowSpend] = useState(false)
  const [smartDCA, setSmartDCA] = useState(false)
  const [smaUp, setSmaUp] = useState(1.5), [smaDown, setSmaDown] = useState(0.5)
  const [notifyEmail, setNotifyEmail] = useState(false), [notifyPush, setNotifyPush] = useState(true)
  const [email, setEmail] = useState('')
  const [lumpAmount, setLumpAmount] = useState('5000'), [lumpMonths, setLumpMonths] = useState(12)
  const [strategies, setStrategies] = useState(isConnected ? [] : MOCK_STRATEGIES)
  const [savingsAmount, setSavingsAmount] = useState('200'), [savingsFreq, setSavingsFreq] = useState('weekly')

  const overview = useMemo(() => {
    const active = strategies.filter(s => s.active)
    const inv = strategies.reduce((s, x) => s + x.totalInvested, 0)
    const val = strategies.reduce((s, x) => s + x.currentValue, 0)
    return { active: active.length, inv, ret: pct(val, inv), next: active.length ? new Date(Math.min(...active.map(s => s.nextBuy.getTime()))) : null }
  }, [strategies])

  const lumpCalc = useMemo(() => {
    const a = parseFloat(lumpAmount) || 0, intervals = Math.floor((lumpMonths * 30) / 7)
    const dcaVal = a * 1.085, lumpVal = a * 1.032
    return { perWeek: (a / intervals).toFixed(2), intervals, dcaVal, lumpVal, dcaRet: (((dcaVal - a) / a) * 100).toFixed(1), lumpRet: (((lumpVal - a) / a) * 100).toFixed(1) }
  }, [lumpAmount, lumpMonths])

  const chart = useMemo(() => {
    const w = 600, h = 180, pl = 50, pr = 10, pt = 10, pb = 25
    const all = PERF_DATA.flatMap(d => [d.market, d.dca, d.lump]), lo = Math.min(...all) * 0.95, hi = Math.max(...all) * 1.05
    const x = (i) => pl + (i / 51) * (w - pl - pr), y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb)
    const path = (key) => PERF_DATA.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
    const area = (key) => {
      const base = PERF_DATA.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
      return base + `L${x(51).toFixed(1)},${(h - pb).toFixed(1)}L${x(0).toFixed(1)},${(h - pb).toFixed(1)}Z`
    }
    const yTicks = Array.from({ length: 5 }, (_, i) => { const v = lo + (i / 4) * (hi - lo); return { y: y(v), label: '$' + Math.round(v).toLocaleString() } })
    return { market: path('market'), dca: path('dca'), lump: path('lump'), dcaArea: area('dca'), lumpArea: area('lump'), w, h, yTicks, xTicks: [0, 12, 25, 38, 51].map(i => ({ x: x(i), label: `W${i + 1}` })) }
  }, [])

  const savingsProjection = useMemo(() => {
    const amt = parseFloat(savingsAmount) || 0
    const freqDays = FREQUENCIES.find(f => f.id === savingsFreq)?.days || 7
    const months = [3, 6, 12, 24]
    return months.map(m => {
      const intervals = Math.floor((m * 30) / freqDays)
      const invested = amt * intervals
      const growth = 1 + (0.06 * m / 12) // ~6% annual appreciation estimate
      const projected = invested * growth
      return { months: m, label: m >= 12 ? `${m / 12}y` : `${m}mo`, invested, projected, intervals }
    })
  }, [savingsAmount, savingsFreq])

  const toggleStrategy = (id) => setStrategies(p => p.map(s => s.id === id ? { ...s, active: !s.active } : s))
  const removeStrategy = (id) => setStrategies(p => p.filter(s => s.id !== id))

  const applyTemplate = (tpl) => {
    const bi = BUY_TOKENS.findIndex(t => t.symbol === tpl.token)
    const si = SPEND_TOKENS.findIndex(t => t.symbol === tpl.spend)
    if (bi >= 0) setBuyToken(bi)
    if (si >= 0) setSpendToken(si)
    setAmountPerInterval(tpl.amount.toString())
    setFrequency(tpl.frequency)
    setDuration(tpl.duration)
  }

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">Connect to <span style={{ color: CYAN }}>DCA</span></h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">Automate your buying strategy. Dollar cost average into any token with MEV-protected batch auctions.</p>
            <button onClick={connect} className="px-8 py-3 rounded-xl font-mono font-bold text-sm" style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}>Connect Wallet</button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* ============ 1. DCA Overview ============ */}
      <Section num="01" title="DCA Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[{ label: 'Active Strategies', value: overview.active.toString(), c: CYAN },
            { label: 'Total Invested', value: fmt(overview.inv) },
            { label: 'Average Returns', value: `${overview.ret >= 0 ? '+' : ''}${overview.ret.toFixed(1)}%`, c: overview.ret >= 0 ? '#34d399' : '#f87171' },
            { label: 'Next Execution', value: overview.next ? fmtDate(overview.next) : '--' },
          ].map((s, i) => (
            <GlassCard key={i} glowColor="terminal" className="p-4">
              <div className="text-xs text-gray-500 font-mono mb-1">{s.label}</div>
              <div className="text-xl font-bold font-mono" style={{ color: s.c || 'white' }}>{s.value}</div>
            </GlassCard>
          ))}
        </div>
        <GlassCard glowColor="terminal" className="mt-3 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 font-mono">Execution Streak (last 30 days)</span>
            <span className="text-xs font-mono" style={{ color: CYAN }}>28/30 successful</span>
          </div>
          <div className="flex gap-0.5">
            {Array.from({ length: 30 }, (_, i) => {
              const success = i !== 7 && i !== 22
              return (
                <div key={i} className="flex-1 h-3 rounded-sm transition-colors" title={`Day ${i + 1}: ${success ? 'Executed' : 'Skipped'}`}
                  style={{ background: success ? `${CYAN}40` : 'rgba(239,68,68,0.25)', minWidth: 4 }} />
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-gray-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: `${CYAN}40` }} />Executed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(239,68,68,0.25)' }} />Skipped (Smart DCA)</span>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 2. Strategy Templates ============ */}
      <Section num="02" title="Strategy Templates" delay={0.05 + 0.05 * PHI}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STRATEGY_TEMPLATES.map((tpl, i) => (
            <motion.div key={tpl.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <GlassCard glowColor="terminal" className="p-4 cursor-pointer" onClick={() => applyTemplate(tpl)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: `#${tpl.icon}` }} />
                  <span className="text-sm font-bold font-mono text-white">{tpl.name}</span>
                </div>
                <p className="text-[11px] font-mono text-gray-400 leading-relaxed mb-3">{tpl.desc}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-500">${tpl.amount} / {tpl.frequency}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>Use Template</span>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 3. Create DCA Strategy ============ */}
      <Section num="03" title="Create DCA Strategy" delay={0.05 + 0.1 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Token to Buy</label>
              <TokenDropdown tokens={BUY_TOKENS} selected={buyToken} onSelect={setBuyToken} open={showBuy} setOpen={(v) => { setShowBuy(v); setShowSpend(false) }} /></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Spend Token</label>
              <TokenDropdown tokens={SPEND_TOKENS} selected={spendToken} onSelect={setSpendToken} open={showSpend} setOpen={(v) => { setShowSpend(v); setShowBuy(false) }} /></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Amount Per Interval</label>
              <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">$</span>
                <input type="number" value={amountPerInterval} onChange={e => setAmountPerInterval(e.target.value)} placeholder="100.00"
                  className="w-full pl-8 pr-4 py-3 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} /></div></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Frequency</label>
              <PillSelect items={FREQUENCIES} value={frequency} onChange={setFrequency} /></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Duration</label>
              <PillSelect items={DURATIONS} value={duration} onChange={setDuration} /></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white" style={{ ...inputStyle, colorScheme: 'dark' }} /></div>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="w-full mt-5 py-3.5 rounded-xl font-mono font-bold text-sm"
            style={{ background: CYAN, color: '#000', boxShadow: `0 0 24px ${CYAN}30` }}
            onClick={() => {
              if (!amountPerInterval) return
              const freq = FREQUENCIES.find(f => f.id === frequency)
              const dur = DURATIONS.find(d => d.id === duration)
              setStrategies(prev => [...prev, { id: Date.now(), token: BUY_TOKENS[buyToken].symbol, spend: SPEND_TOKENS[spendToken].symbol,
                amount: parseFloat(amountPerInterval), frequency: freq.label, totalInvested: 0, currentValue: 0, avgPrice: 0,
                nextBuy: new Date(startDate || Date.now()), active: true, executions: 0, startDate: new Date(),
                targetExecs: dur.months ? Math.floor((dur.months * 30) / freq.days) : 0 }])
              setAmountPerInterval('')
            }}>Create DCA Strategy</motion.button>
        </GlassCard>
      </Section>

      {/* ============ 4. Active Strategies Dashboard ============ */}
      <Section num="04" title="Active Strategies" delay={0.05 + 0.2 * PHI}>
        {strategies.length === 0 ? (
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <div className="text-gray-500 font-mono text-sm">No strategies yet. Create one above or use a template.</div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {strategies.map(s => <StrategyCard key={s.id} s={s} onToggle={toggleStrategy} onRemove={removeStrategy} />)}
            </AnimatePresence>
          </div>
        )}
      </Section>

      {/* ============ 5. DCA vs Lump Sum Comparison ============ */}
      <Section num="05" title="DCA vs Lump Sum Comparison" delay={0.05 + 0.3 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500 font-mono">Historical comparison over 52 weeks</p>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: CYAN }} /><span className="text-gray-400">DCA Avg</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-amber-500" /><span className="text-gray-400">Lump Sum</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-red-500" /><span className="text-gray-400">Market</span></span>
            </div>
          </div>
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="w-full" style={{ maxHeight: 220 }}>
            <defs>
              <linearGradient id="dcaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity="0.15" />
                <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="lumpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </linearGradient>
            </defs>
            {chart.yTicks.map((t, i) => (<g key={i}><line x1={50} x2={590} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
              <text x={2} y={t.y + 3} fill="#6b7280" fontSize="8" fontFamily="monospace">{t.label}</text></g>))}
            {chart.xTicks.map((t, i) => <text key={i} x={t.x} y={chart.h - 5} fill="#6b7280" fontSize="8" fontFamily="monospace" textAnchor="middle">{t.label}</text>)}
            <path d={chart.dcaArea} fill="url(#dcaGrad)" />
            <path d={chart.lumpArea} fill="url(#lumpGrad)" />
            <path d={chart.market} fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.5" strokeDasharray="3,3" />
            <path d={chart.lump} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.7" />
            <path d={chart.dca} fill="none" stroke={CYAN} strokeWidth="2" />
          </svg>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[{ label: 'DCA Final', value: `$${PERF_DATA[51].dca.toLocaleString()}`, c: CYAN },
              { label: 'Lump Sum Final', value: `$${PERF_DATA[51].lump.toLocaleString()}`, c: '#f59e0b' },
              { label: 'DCA Advantage', value: `+$${(PERF_DATA[51].dca - PERF_DATA[51].lump).toLocaleString()}`, c: '#34d399' },
            ].map((item, i) => (
              <div key={i} className="text-center p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-[10px] font-mono text-gray-500">{item.label}</div>
                <div className="text-sm font-bold font-mono" style={{ color: item.c }}>{item.value}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Savings Estimator ============ */}
      <Section num="06" title="Savings Estimator" delay={0.05 + 0.4 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Amount per interval</label>
              <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">$</span>
                <input type="number" value={savingsAmount} onChange={e => setSavingsAmount(e.target.value)}
                  className="w-full pl-8 pr-4 py-2.5 rounded-xl font-mono text-sm text-white" style={inputStyle} /></div></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Frequency</label>
              <PillSelect items={FREQUENCIES} value={savingsFreq} onChange={setSavingsFreq} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {savingsProjection.map((p, i) => (
              <div key={i} className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[10px] text-gray-500 font-mono mb-1">{p.label}</div>
                <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{fmt(p.projected)}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-0.5">{p.intervals} buys</div>
              </div>
            ))}
          </div>
          <svg viewBox="0 0 400 100" className="w-full" style={{ maxHeight: 120 }}>
            {savingsProjection.map((p, i) => {
              const maxVal = savingsProjection[savingsProjection.length - 1].projected || 1
              const barH = (p.projected / maxVal) * 70
              const invH = (p.invested / maxVal) * 70
              const xPos = 40 + i * 95
              return (
                <g key={i}>
                  <rect x={xPos} y={90 - barH} width={36} height={barH} rx={4} fill={`${CYAN}30`} stroke={CYAN} strokeWidth="0.5" />
                  <rect x={xPos} y={90 - invH} width={36} height={invH} rx={4} fill="rgba(255,255,255,0.08)" />
                  <text x={xPos + 18} y={98} fill="#6b7280" fontSize="8" fontFamily="monospace" textAnchor="middle">{p.label}</text>
                  <text x={xPos + 18} y={85 - barH} fill={CYAN} fontSize="7" fontFamily="monospace" textAnchor="middle">{fmt(p.projected)}</text>
                </g>
              )
            })}
          </svg>
          <div className="flex items-center gap-4 mt-2 text-[10px] font-mono text-gray-500 justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: `${CYAN}30`, border: `1px solid ${CYAN}` }} />Projected value</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: 'rgba(255,255,255,0.08)' }} />Amount invested</span>
          </div>
          {savingsProjection.length > 0 && (() => {
            const final = savingsProjection[savingsProjection.length - 1]
            const growth = final.projected - final.invested
            return (
              <div className="mt-3 p-3 rounded-lg flex items-center justify-between" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}12` }}>
                <div className="text-xs font-mono text-gray-400">
                  After <span className="text-white font-bold">{final.label}</span> at <span style={{ color: CYAN }}>${savingsAmount}/{savingsFreq}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{fmt(final.projected)}</div>
                  <div className="text-[10px] font-mono text-emerald-400">+{fmt(growth)} estimated growth</div>
                </div>
              </div>
            )
          })()}
          <p className="mt-2 text-[10px] font-mono text-gray-600 text-center">Estimates assume ~6% annual appreciation. Actual returns vary based on market conditions and token selection.</p>
        </GlassCard>
      </Section>

      {/* ============ 7. DCA vs Lump Sum Calculator ============ */}
      <Section num="07" title="DCA vs Lump Sum Calculator" delay={0.05 + 0.5 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Total Amount</label>
              <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">$</span>
                <input type="number" value={lumpAmount} onChange={e => setLumpAmount(e.target.value)} className="w-full pl-8 pr-4 py-2.5 rounded-xl font-mono text-sm text-white" style={inputStyle} /></div></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Token</label>
              <select value={BUY_TOKENS[buyToken].symbol} disabled className="w-full px-4 py-2.5 rounded-xl font-mono text-sm text-white appearance-none" style={inputStyle}>
                {BUY_TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}</select></div>
            <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Time Horizon</label>
              <PillSelect items={[{ id: 6, label: '6mo' }, { id: 12, label: '12mo' }, { id: 24, label: '24mo' }]} value={lumpMonths} onChange={setLumpMonths} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}20` }}>
              <div className="text-xs font-mono mb-2" style={{ color: CYAN }}>DCA Strategy</div>
              <div className="text-xl font-bold font-mono text-white">{fmt(lumpCalc.dcaVal)}</div>
              <div className="text-xs font-mono text-gray-400 mt-1">${lumpCalc.perWeek}/week x {lumpCalc.intervals} weeks</div>
              <div className="text-sm font-mono text-emerald-400 mt-2">+{lumpCalc.dcaRet}%</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-xs font-mono text-gray-500 mb-2">Lump Sum</div>
              <div className="text-xl font-bold font-mono text-white">{fmt(lumpCalc.lumpVal)}</div>
              <div className="text-xs font-mono text-gray-400 mt-1">All {fmt(parseFloat(lumpAmount) || 0)} at once</div>
              <div className={`text-sm font-mono mt-2 ${parseFloat(lumpCalc.lumpRet) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{lumpCalc.lumpRet}%</div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. Smart DCA (Value Averaging) ============ */}
      <Section num="08" title="Smart DCA (Value Averaging)" delay={0.05 + 0.6 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div><p className="text-sm font-mono text-gray-300">Buy more when cheap, less when expensive</p>
              <p className="text-xs font-mono text-gray-500 mt-0.5">Adjusts buy amount relative to the 20-day SMA</p></div>
            <Toggle on={smartDCA} onToggle={() => setSmartDCA(!smartDCA)} />
          </div>
          <AnimatePresence>
            {smartDCA && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-white/5">
                  <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Below SMA: Multiply by</label>
                    <div className="flex items-center gap-3"><input type="range" min="1" max="3" step="0.1" value={smaUp} onChange={e => setSmaUp(parseFloat(e.target.value))} className="flex-1 accent-cyan-500" />
                      <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>{smaUp}x</span></div>
                    <p className="text-[10px] text-gray-600 font-mono mt-1">Price below SMA: buy {smaUp}x normal</p></div>
                  <div><label className="text-xs text-gray-500 font-mono block mb-1.5">Above SMA: Multiply by</label>
                    <div className="flex items-center gap-3"><input type="range" min="0.1" max="1" step="0.1" value={smaDown} onChange={e => setSmaDown(parseFloat(e.target.value))} className="flex-1 accent-cyan-500" />
                      <span className="text-sm font-mono font-bold text-yellow-500">{smaDown}x</span></div>
                    <p className="text-[10px] text-gray-600 font-mono mt-1">Price above SMA: buy {smaDown}x normal</p></div>
                </div>
                <div className="mt-4 p-3 rounded-lg flex gap-4 text-xs font-mono" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-emerald-400">-10% below SMA: ${(100 * smaUp).toFixed(0)}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-yellow-400">+10% above SMA: ${(100 * smaDown).toFixed(0)}</span>
                </div>
              </motion.div>)}
          </AnimatePresence>
        </GlassCard>
      </Section>

      {/* ============ 9. Historical Simulation ============ */}
      <Section num="09" title="Historical Simulation" delay={0.05 + 0.65 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <p className="text-sm font-mono text-gray-400 mb-4">What if you DCA'd <span style={{ color: CYAN }}>${SIM.weekly}/week</span> into <span className="text-white font-bold">{SIM.token}</span> for the last year?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[{ l: 'Total Invested', v: fmt(SIM.totalInvested) }, { l: 'Current Value', v: fmt(SIM.currentValue) },
              { l: 'Tokens Accumulated', v: `${SIM.tokens} ${SIM.token}` }, { l: 'Avg Buy Price', v: `$${SIM.avgPrice.toLocaleString()}` }
            ].map((item, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[10px] text-gray-500 font-mono mb-0.5">{item.l}</div>
                <div className="text-sm font-bold font-mono text-white">{item.v}</div>
              </div>))}
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <div className="text-lg font-mono text-emerald-400 font-bold">+{SIM.gainPct}%</div>
            <div><div className="text-sm font-mono text-emerald-400">DCA Return: +${SIM.gain}</div>
              <div className="text-xs font-mono text-gray-500 mt-0.5">Lump sum would have returned {SIM.lumpReturn}% over the same period</div></div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. Gas Optimization ============ */}
      <Section num="10" title="Gas Optimization" delay={0.05 + 0.7 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}25` }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-mono font-bold text-white mb-1">MEV-Protected Batch Execution</h3>
              <p className="text-xs font-mono text-gray-400 leading-relaxed">DCA orders are batched into commit-reveal auctions. Hashed secrets prevent front-running. Multiple DCA orders share gas costs per batch.</p>
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[{ l: 'Avg Gas Saved', v: '62%', s: 'vs individual swaps' }, { l: 'MEV Protection', v: '100%', s: 'commit-reveal' }, { l: 'Batch Window', v: '10s', s: '8s commit + 2s reveal' }].map((x, i) => (
                  <div key={i} className="text-center"><div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{x.v}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{x.l}</div><div className="text-[9px] text-gray-600 font-mono">{x.s}</div></div>))}
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 11. Notification Preferences ============ */}
      <Section num="11" title="Notification Preferences" delay={0.05 + 0.8 * PHI}>
        <GlassCard glowColor="terminal" className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-mono text-white">Push Notifications</div><div className="text-xs font-mono text-gray-500 mt-0.5">Get notified when each DCA executes</div></div>
            <Toggle on={notifyPush} onToggle={() => setNotifyPush(!notifyPush)} />
          </div>
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-mono text-white">Email Notifications</div><div className="text-xs font-mono text-gray-500 mt-0.5">Receive execution summaries via email</div></div>
            <Toggle on={notifyEmail} onToggle={() => setNotifyEmail(!notifyEmail)} />
          </div>
          <AnimatePresence>{notifyEmail && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                className="w-full px-4 py-2.5 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} />
            </motion.div>)}</AnimatePresence>
        </GlassCard>
      </Section>

      {/* ============ 12. Fee Breakdown ============ */}
      <Section num="12" title="Fee Breakdown" delay={0.05 + 0.9 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="space-y-3">
            {[{ l: 'Commit-Reveal Execution Fee', v: '0.05%', d: 'Per-execution swap fee through batch auction', a: true },
              { l: 'DCA Service Fee', v: '0.00%', d: 'No additional fee for scheduling -- free forever', a: false },
              { l: 'Gas (Batched)', v: 'Variable', d: 'Shared across all orders in the same 10s batch window', a: false },
              { l: 'Smart DCA Premium', v: '0.00%', d: 'Value averaging adjustment is free', a: false },
            ].map((fee, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div><div className="text-sm font-mono text-white">{fee.l}</div><div className="text-[10px] font-mono text-gray-500 mt-0.5">{fee.d}</div></div>
                <div className="text-sm font-mono font-bold" style={{ color: fee.a ? CYAN : '#9ca3af' }}>{fee.v}</div>
              </div>))}
          </div>
          <div className="mt-4 p-3 rounded-lg text-center" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
            <span className="text-xs font-mono" style={{ color: CYAN }}>Total effective cost: 0.05% per DCA execution -- among the lowest in DeFi</span>
          </div>
        </GlassCard>
      </Section>

    </div>
  )
}
