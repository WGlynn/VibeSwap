import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CURRENT_PRICE = 3420.50
const EXPIRIES = [{ label: '1D', days: 1 }, { label: '7D', days: 7 }, { label: '30D', days: 30 }, { label: '90D', days: 90 }]

const MOCK_POSITIONS = [
  { id: 1, type: 'Call', strike: 3400, expiry: '2026-04-12', size: 2.0, currentValue: 418.60, pnl: 106.20 },
  { id: 2, type: 'Put', strike: 3500, expiry: '2026-03-19', size: 1.5, currentValue: 198.30, pnl: -46.70 },
  { id: 3, type: 'Call', strike: 3300, expiry: '2026-06-12', size: 5.0, currentValue: 724.50, pnl: 144.50 },
]

// ============ Black-Scholes Helpers ============

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429
  const sign = x < 0 ? -1 : 1
  const t = 1.0 / (1.0 + 0.3275911 * Math.abs(x))
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)
  return 0.5 * (1.0 + sign * y)
}

function normalPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) }

function bsPrice(S, K, T, r, v, isCall) {
  if (T <= 0 || v <= 0) return Math.max(0, isCall ? S - K : K - S)
  const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T))
  const d2 = d1 - v * Math.sqrt(T)
  return isCall ? S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2)
    : K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1)
}

function bsGreeks(S, K, T, r, v, isCall) {
  if (T <= 0 || v <= 0) return { delta: isCall ? 1 : -1, gamma: 0, theta: 0, vega: 0 }
  const sqT = Math.sqrt(T), d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * sqT)
  const d2 = d1 - v * sqT, nd1 = normalPDF(d1)
  return {
    delta: isCall ? normalCDF(d1) : normalCDF(d1) - 1,
    gamma: nd1 / (S * v * sqT),
    theta: (isCall
      ? -(S * nd1 * v) / (2 * sqT) - r * K * Math.exp(-r * T) * normalCDF(d2)
      : -(S * nd1 * v) / (2 * sqT) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365,
    vega: S * nd1 * sqT / 100,
  }
}

// ============ Data Generators ============

function generateStrikes(price, count = 5, step = 50) {
  const base = Math.round(price / step) * step
  return Array.from({ length: count * 2 + 1 }, (_, idx) => {
    const i = idx - count, strike = base + i * step, iv = 0.55 + Math.abs(i) * 0.02
    const cp = bsPrice(price, strike, 30 / 365, 0.05, iv, true)
    const pp = bsPrice(price, strike, 30 / 365, 0.05, iv, false)
    return {
      strike, iv,
      call: { bid: Math.max(0.01, cp * 0.97).toFixed(2), ask: (cp * 1.03).toFixed(2), vol: Math.floor(Math.random() * 500 + 50), oi: Math.floor(Math.random() * 2000 + 200) },
      put: { bid: Math.max(0.01, pp * 0.97).toFixed(2), ask: (pp * 1.03).toFixed(2), vol: Math.floor(Math.random() * 400 + 30), oi: Math.floor(Math.random() * 1800 + 150) },
      itm: { call: price > strike, put: price < strike },
    }
  })
}

function generateIVSurface() {
  const strikes = [3200, 3250, 3300, 3350, 3400, 3450, 3500, 3550, 3600], expiries = [7, 14, 30, 60, 90]
  const surface = expiries.map((e) => strikes.map((s) => {
    const m = Math.abs(CURRENT_PRICE - s) / CURRENT_PRICE
    return 0.5 + 0.1 * Math.sqrt(e / 365) + m * 1.2 + (Math.random() * 0.02 - 0.01)
  }))
  return { strikes, expiries, surface }
}

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

// ============ Payoff Diagram (SVG) ============

function PayoffDiagram({ strike, isCall, premium, size }) {
  const W = 360, H = 160, P = 30, lo = strike - 400, hi = strike + 400
  const pts = Array.from({ length: 61 }, (_, i) => {
    const price = lo + (hi - lo) * (i / 60)
    return { price, pay: (Math.max(0, isCall ? price - strike : strike - price) - premium) * size }
  })
  const maxP = Math.max(...pts.map(p => p.pay)), minP = Math.min(...pts.map(p => p.pay)), rng = maxP - minP || 1
  const x = (pr) => P + ((pr - lo) / (hi - lo)) * (W - 2 * P)
  const y = (pf) => H - P - ((pf - minP) / rng) * (H - 2 * P)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.price).toFixed(1)},${y(p.pay).toFixed(1)}`).join(' ')
  const zy = y(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36">
      <line x1={P} y1={zy} x2={W - P} y2={zy} stroke="#444" strokeWidth="1" strokeDasharray="4,4" />
      <line x1={x(strike)} y1={P} x2={x(strike)} y2={H - P} stroke={CYAN} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
      <line x1={x(CURRENT_PRICE)} y1={P} x2={x(CURRENT_PRICE)} y2={H - P} stroke="#fbbf24" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
      <path d={d} fill="none" stroke={CYAN} strokeWidth="2" />
      <circle cx={x(isCall ? strike + premium : strike - premium)} cy={zy} r="3" fill="#fbbf24" />
      <text x={x(strike)} y={H - 6} fill="#888" fontSize="9" textAnchor="middle">K={strike}</text>
      <text x={x(CURRENT_PRICE)} y={12} fill="#fbbf24" fontSize="8" textAnchor="middle">Spot</text>
    </svg>
  )
}

// ============ IV Surface Heatmap (SVG) ============

function IVSurfaceHeatmap({ data }) {
  const { strikes, expiries, surface } = data, W = 360, H = 140, P = 40
  const cW = (W - 2 * P) / strikes.length, cH = (H - 2 * P) / expiries.length
  const flat = surface.flat(), lo = Math.min(...flat), hi = Math.max(...flat), rng = hi - lo || 0.01
  const clr = (v) => { const t = (v - lo) / rng; return `rgb(${20 + t * 200|0},${80 + (1 - Math.abs(t - .5) * 2) * 140|0},${200 - t * 160|0})` }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36">
      {surface.map((row, ei) => row.map((iv, si) => (
        <rect key={`${ei}-${si}`} x={P + si * cW} y={P + ei * cH} width={cW - 1} height={cH - 1} fill={clr(iv)} rx="2" opacity="0.85">
          <title>Strike: {strikes[si]} | {expiries[ei]}D | IV: {(iv * 100).toFixed(1)}%</title>
        </rect>
      )))}
      {strikes.filter((_, i) => i % 2 === 0).map((s, i) => (
        <text key={s} x={P + i * 2 * cW + cW / 2} y={H - 6} fill="#888" fontSize="8" textAnchor="middle">{s}</text>
      ))}
      {expiries.map((e, i) => (
        <text key={e} x={P - 6} y={P + i * cH + cH / 2 + 3} fill="#888" fontSize="8" textAnchor="end">{e}D</text>
      ))}
    </svg>
  )
}

// ============ Premium Ticker ============

function PremiumTicker() {
  const [offset, setOffset] = useState(0)
  const items = [
    { pair: 'ETH 3400C', prem: '142.50', chg: '+3.2%', up: true }, { pair: 'ETH 3500P', prem: '98.30', chg: '-1.8%', up: false },
    { pair: 'BTC 68kC', prem: '1,240', chg: '+5.1%', up: true }, { pair: 'ETH 3300C', prem: '218.70', chg: '+2.4%', up: true },
    { pair: 'SOL 180P', prem: '12.40', chg: '-4.2%', up: false }, { pair: 'ETH 3600C', prem: '62.80', chg: '+0.8%', up: true },
  ]
  useEffect(() => { const id = setInterval(() => setOffset(p => (p + 1) % (items.length * 200)), 30); return () => clearInterval(id) }, [items.length])
  return (
    <div className="overflow-hidden rounded-xl bg-black-900/50 py-2">
      <div className="flex whitespace-nowrap" style={{ transform: `translateX(-${offset}px)` }}>
        {[...items, ...items, ...items].map((it, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-4 text-sm">
            <span className="text-black-300 font-mono">{it.pair}</span>
            <span className="text-white font-medium">${it.prem}</span>
            <span className={it.up ? 'text-emerald-400' : 'text-red-400'}>{it.chg}</span>
            <span className="text-black-600 mx-1">|</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function OptionsPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [isCall, setIsCall] = useState(true)
  const [strikeIdx, setStrikeIdx] = useState(5)
  const [expiryIdx, setExpiryIdx] = useState(2)
  const [optSize, setOptSize] = useState('1.0')
  const [exercising, setExercising] = useState(null)

  const strikes = useMemo(() => generateStrikes(CURRENT_PRICE), [])
  const ivSurface = useMemo(() => generateIVSurface(), [])
  const sel = strikes[strikeIdx]
  const T = EXPIRIES[expiryIdx].days / 365
  const premium = bsPrice(CURRENT_PRICE, sel.strike, T, 0.05, sel.iv, isCall)
  const greeks = bsGreeks(CURRENT_PRICE, sel.strike, T, 0.05, sel.iv, isCall)
  const totalCost = premium * (parseFloat(optSize) || 0)

  const stats = [
    { label: 'Total Volume', value: '$48.2M', sub: '24h', color: CYAN },
    { label: 'Open Interest', value: '$124.6M', sub: 'All chains', color: '#10b981' },
    { label: 'Active Options', value: '3,847', sub: 'Live contracts', color: '#a855f7' },
    { label: 'Your Positions', value: isConnected ? '3' : '--', sub: isConnected ? 'Open' : 'Connect', color: '#fbbf24' },
  ]

  // ============ Not Connected ============
  if (!isConnected) return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <h1 className="text-3xl font-bold text-white mb-1">Options</h1>
        <p className="text-black-400">DeFi options with MEV-resistant TWAP settlement</p>
      </motion.div>
      <PremiumTicker />
      <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <div className="text-5xl mb-4">&#9826;</div>
          <h2 className="text-xl font-bold text-white mb-2">Connect to Trade Options</h2>
          <p className="text-black-400 text-sm mb-6">European-style options settled against TWAP oracle for MEV protection.</p>
          <button onClick={connect} className="px-8 py-3 rounded-xl font-semibold text-black" style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)` }}>
            Connect Wallet
          </button>
        </motion.div>
      </GlassCard>
    </div>
  )

  // ============ Connected ============
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <h1 className="text-3xl font-bold text-white mb-1">Options</h1>
        <p className="text-black-400">European-style DeFi options with TWAP settlement</p>
      </motion.div>

      {/* 12. Premium Ticker */}
      <PremiumTicker />

      {/* 1. Overview */}
      <Section num="01" title="Overview" delay={0.1 * PHI}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((s) => (
            <GlassCard glowColor="terminal" key={s.label} className="p-4">
              <div className="text-xs text-black-400 mb-1">{s.label}</div>
              <div className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-black-500 mt-0.5">{s.sub}</div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 2. Options Chain */}
      <Section num="02" title="Options Chain — ETH/USD" delay={0.2 * PHI}>
        <GlassCard glowColor="terminal" className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-black-700">
                <th colSpan={4} className="py-2 px-2 text-center text-emerald-400 bg-emerald-500/5">CALLS</th>
                <th className="py-2 px-3 text-center text-black-400 border-x border-black-700">STRIKE</th>
                <th colSpan={4} className="py-2 px-2 text-center text-red-400 bg-red-500/5">PUTS</th>
              </tr>
              <tr className="border-b border-black-700 text-black-500">
                {['Bid', 'Ask', 'Vol', 'OI'].map(h => <th key={`c${h}`} className="py-1.5 px-2 text-right">{h}</th>)}
                <th className="py-1.5 px-3 border-x border-black-700" />
                {['Bid', 'Ask', 'Vol', 'OI'].map(h => <th key={`p${h}`} className="py-1.5 px-2 text-right">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {strikes.map((row, idx) => {
                const atm = Math.abs(row.strike - CURRENT_PRICE) < 25, active = idx === strikeIdx
                return (
                  <tr key={row.strike} onClick={() => setStrikeIdx(idx)}
                    className={`border-b border-black-800 cursor-pointer transition-colors ${active ? 'bg-cyan-500/10' : 'hover:bg-black-800/50'} ${atm ? 'border-l-2 border-l-yellow-500' : ''}`}>
                    <td className={`py-1.5 px-2 text-right ${row.itm.call ? 'text-emerald-400' : 'text-black-300'}`}>{row.call.bid}</td>
                    <td className={`py-1.5 px-2 text-right ${row.itm.call ? 'text-emerald-400' : 'text-black-300'}`}>{row.call.ask}</td>
                    <td className="py-1.5 px-2 text-right text-black-400">{row.call.vol}</td>
                    <td className="py-1.5 px-2 text-right text-black-500">{row.call.oi}</td>
                    <td className={`py-1.5 px-3 text-center font-bold border-x border-black-700 ${atm ? 'text-yellow-400' : 'text-white'}`}>{row.strike.toLocaleString()}</td>
                    <td className={`py-1.5 px-2 text-right ${row.itm.put ? 'text-red-400' : 'text-black-300'}`}>{row.put.bid}</td>
                    <td className={`py-1.5 px-2 text-right ${row.itm.put ? 'text-red-400' : 'text-black-300'}`}>{row.put.ask}</td>
                    <td className="py-1.5 px-2 text-right text-black-400">{row.put.vol}</td>
                    <td className="py-1.5 px-2 text-right text-black-500">{row.put.oi}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-3 py-1.5 text-[10px] text-black-500 border-t border-black-800 flex justify-between">
            <span>Spot: ${CURRENT_PRICE.toLocaleString()}</span><span>Click row to select strike</span>
          </div>
        </GlassCard>
      </Section>

      {/* 3. Trade + 4. Payoff + 5. Greeks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section num="03" title="Trade Options" delay={0.3 * PHI}>
          <GlassCard glowColor="terminal" className="p-4 space-y-4">
            <div className="flex rounded-xl bg-black-800 p-1">
              {[true, false].map(c => (
                <button key={String(c)} onClick={() => setIsCall(c)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${isCall === c ? (c ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400') : 'text-black-400'}`}>
                  {c ? 'Call' : 'Put'}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-black-400 mb-1 block">Strike Price</label>
              <select value={strikeIdx} onChange={e => setStrikeIdx(Number(e.target.value))}
                className="w-full bg-black-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none border border-black-600 focus:border-cyan-500/50">
                {strikes.map((s, i) => (
                  <option key={s.strike} value={i}>${s.strike.toLocaleString()} {Math.abs(s.strike - CURRENT_PRICE) < 25 ? '(ATM)' : s.strike < CURRENT_PRICE ? '(ITM)' : '(OTM)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-black-400 mb-1 block">Expiry</label>
              <div className="grid grid-cols-4 gap-2">
                {EXPIRIES.map((exp, i) => (
                  <button key={exp.label} onClick={() => setExpiryIdx(i)}
                    className={`py-2 rounded-lg text-sm font-mono transition-all ${expiryIdx === i ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-black-700 text-black-300 border border-black-600'}`}>
                    {exp.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-black-400 mb-1 block">Size (ETH)</label>
              <input type="number" value={optSize} onChange={e => setOptSize(e.target.value)} placeholder="1.0" min="0.01" step="0.1"
                className="w-full bg-black-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none border border-black-600 focus:border-cyan-500/50 font-mono" />
            </div>
            <div className="rounded-xl bg-black-900/60 p-3 space-y-2">
              {[
                ['Premium/unit', `$${premium.toFixed(2)}`, 'text-white'],
                ['Total Cost', `$${totalCost.toFixed(2)}`, ''],
                ['Implied Vol', `${(sel.iv * 100).toFixed(1)}%`, 'text-black-300'],
                ['Breakeven', `$${(isCall ? sel.strike + premium : sel.strike - premium).toFixed(2)}`, 'text-yellow-400'],
              ].map(([l, v, c]) => (
                <div key={l} className="flex justify-between text-sm">
                  <span className="text-black-400">{l}</span>
                  <span className={`font-mono ${c || ''}`} style={l === 'Total Cost' ? { color: CYAN, fontWeight: 700 } : undefined}>{v}</span>
                </div>
              ))}
            </div>
            <button className="w-full py-3 rounded-xl font-semibold text-sm text-white"
              style={{ background: isCall ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#ef4444,#dc2626)' }}>
              Buy {isCall ? 'Call' : 'Put'} — ${totalCost.toFixed(2)}
            </button>
          </GlassCard>
        </Section>

        <div className="space-y-6">
          {/* 4. Payoff Diagram */}
          <Section num="04" title="Payoff Diagram" delay={0.4 * PHI}>
            <GlassCard glowColor="terminal" className="p-4">
              <PayoffDiagram strike={sel.strike} isCall={isCall} premium={premium} size={parseFloat(optSize) || 1} />
              <div className="flex justify-between text-[10px] text-black-500 mt-2 px-1">
                <span>{isCall ? 'Call' : 'Put'} @ ${sel.strike}</span>
                <span>Max loss: ${(premium * (parseFloat(optSize) || 1)).toFixed(2)}</span>
              </div>
            </GlassCard>
          </Section>

          {/* 5. Greeks */}
          <Section num="05" title="Greeks" delay={0.5 * PHI}>
            <GlassCard glowColor="terminal" className="p-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { l: 'Delta', v: greeks.delta.toFixed(4), d: 'Price sensitivity', c: '#06b6d4' },
                  { l: 'Gamma', v: greeks.gamma.toFixed(6), d: 'Delta change rate', c: '#a855f7' },
                  { l: 'Theta', v: greeks.theta.toFixed(4), d: 'Time decay/day', c: '#ef4444' },
                  { l: 'Vega', v: greeks.vega.toFixed(4), d: 'Vol sensitivity', c: '#10b981' },
                ].map(g => (
                  <div key={g.l} className="rounded-lg bg-black-800 p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-black-400">{g.l}</span>
                      <span className="text-[10px] text-black-500">{g.d}</span>
                    </div>
                    <div className="text-lg font-mono font-bold mt-1" style={{ color: g.c }}>{g.v}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </Section>
        </div>
      </div>

      {/* 6. Positions + 10. Exercise */}
      <Section num="06" title="Your Positions" delay={0.6 * PHI}>
        <GlassCard glowColor="terminal" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black-700 text-black-400 text-xs">
                {['Type', 'Strike', 'Expiry', 'Size', 'Value', 'P&L', 'Action'].map(h => (
                  <th key={h} className={`py-2 px-3 ${h === 'Type' ? 'text-left' : h === 'Action' ? 'text-center' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_POSITIONS.map(pos => {
                const itm = pos.type === 'Call' ? CURRENT_PRICE > pos.strike : CURRENT_PRICE < pos.strike
                return (
                  <tr key={pos.id} className="border-b border-black-800 hover:bg-black-800/50">
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${pos.type === 'Call' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>{pos.type}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">${pos.strike.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-black-300 text-xs">{pos.expiry}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{pos.size.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">${pos.currentValue.toFixed(2)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono font-semibold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {itm ? (
                        <button onClick={() => { setExercising(pos.id); setTimeout(() => setExercising(null), 2000) }}
                          disabled={exercising === pos.id}
                          className="px-3 py-1 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50">
                          {exercising === pos.id ? 'Exercising...' : 'Exercise'}
                        </button>
                      ) : <span className="text-xs text-black-500">OTM</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </GlassCard>
      </Section>

      {/* 7. IV Surface */}
      <Section num="07" title="Implied Volatility Surface" delay={0.7 * PHI}>
        <GlassCard glowColor="terminal" className="p-4">
          <IVSurfaceHeatmap data={ivSurface} />
          <div className="flex items-center justify-between mt-3 text-[10px] text-black-500 px-1">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded" style={{ background: 'rgb(20,80,200)' }} /><span>Low IV</span></div>
            <span>Hover cells for details</span>
            <div className="flex items-center gap-2"><span>High IV</span><div className="w-3 h-3 rounded" style={{ background: 'rgb(220,150,40)' }} /></div>
          </div>
        </GlassCard>
      </Section>

      {/* 8. Pricing + 9. Settlement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section num="08" title="Pricing Model" delay={0.8 * PHI}>
          <GlassCard glowColor="terminal" className="p-4 space-y-3">
            <p className="text-sm text-black-300">VibeSwap uses a modified <span className="text-cyan-400 font-semibold">Black-Scholes model</span> with on-chain IV from TWAP oracle and commit-reveal auction data.</p>
            <div className="rounded-lg bg-black-900/60 p-3 font-mono text-xs text-black-300">
              <div className="text-cyan-400 mb-1">// European Call Price</div>
              <div>C = S*N(d1) - K*e^(-rT)*N(d2)</div>
              <div className="mt-1 text-cyan-400">// Where:</div>
              <div>d1 = [ln(S/K) + (r + v²/2)T] / (v*√T)</div>
              <div>d2 = d1 - v*√T</div>
            </div>
            <div className="text-xs text-black-500 space-y-0.5">
              {[['S', 'Spot from TWAP oracle'], ['K', 'Strike price'], ['T', 'Time to expiry'], ['v', 'Implied volatility'], ['r', 'Risk-free rate (DeFi lending)']].map(([k, v]) => (
                <div key={k} className="flex gap-2"><span style={{ color: CYAN }}>{k}</span> = {v}</div>
              ))}
            </div>
          </GlassCard>
        </Section>

        <Section num="09" title="TWAP Settlement" delay={0.9 * PHI}>
          <GlassCard glowColor="terminal" className="p-4 space-y-3">
            <p className="text-sm text-black-300">Options settle against <span className="text-yellow-400 font-semibold">TWAP oracle</span> price at expiry — <span className="text-cyan-400">MEV-resistant</span> by design.</p>
            <div className="space-y-2">
              {[['1', 'TWAP Window', '30-min TWAP ending at expiry block'], ['2', 'Max Deviation', 'Rejects if spot >5% from TWAP'], ['3', 'Auto-Exercise', 'ITM options auto-exercise if >0.5% ITM'], ['4', 'Payout', 'Cash-settled in underlying asset']].map(([n, l, d]) => (
                <div key={n} className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-cyan-400">{n}</span>
                  </div>
                  <div><div className="text-xs font-semibold text-white">{l}</div><div className="text-[10px] text-black-400">{d}</div></div>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2.5 text-xs text-yellow-300">
              TWAP settlement prevents last-block price manipulation that plagues traditional DeFi options.
            </div>
          </GlassCard>
        </Section>
      </div>

      {/* 11. Market Maker Rewards */}
      <Section num="10" title="Market Maker Rewards" delay={1.0 * PHI}>
        <GlassCard glowColor="terminal" className="p-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[['18.4%', 'Avg APY for Writers', CYAN], ['$2.4M', 'Total Premiums Earned', '#10b981'], ['142', 'Active Market Makers', '#a855f7']].map(([v, l, c]) => (
              <div key={l} className="rounded-xl bg-black-800 p-4 text-center">
                <div className="text-2xl font-bold font-mono" style={{ color: c }}>{v}</div>
                <div className="text-xs text-black-400 mt-1">{l}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-black-300">
            Earn premiums by writing options. Market makers receive <span style={{ color: CYAN }}>Shapley rewards</span> proportional to market depth contribution, distributed via commit-reveal to prevent front-running.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[['Write Covered Calls', 'Deposit ETH collateral, earn premiums. Risk: forced sale at strike if ITM.'],
              ['Write Cash-Secured Puts', 'Deposit USDC collateral, earn premiums. Risk: forced buy at strike if ITM.']].map(([t, d]) => (
              <div key={t} className="rounded-lg bg-black-900/60 p-3">
                <div className="text-xs font-semibold text-white mb-1">{t}</div>
                <div className="text-[10px] text-black-400">{d}</div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 py-3 rounded-xl font-semibold text-sm border transition-all hover:bg-cyan-500/10" style={{ borderColor: CYAN, color: CYAN }}>
            Start Writing Options
          </button>
        </GlassCard>
      </Section>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 * PHI }} className="text-center text-[10px] text-black-600 pb-4">
        European-style, cash-settled against TWAP oracle. Settlement powered by VibeSwap commit-reveal auctions.
      </motion.div>
    </div>
  )
}
