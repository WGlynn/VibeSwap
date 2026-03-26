import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
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
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 24 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1 + i * 0.12, ease } }),
}

// ============ Pool Data ============

const POOLS = [
  { id: 'eth-usdc', name: 'ETH / USDC', tokenA: 'ETH', tokenB: 'USDC', reserveA: 5000, reserveB: 15_750_000, fee: 0.003, tvl: 31_500_000 },
  { id: 'vibe-eth', name: 'VIBE / ETH', tokenA: 'VIBE', tokenB: 'ETH', reserveA: 12_000_000, reserveB: 2400, fee: 0.003, tvl: 7_560_000 },
  { id: 'btc-usdc', name: 'BTC / USDC', tokenA: 'BTC', tokenB: 'USDC', reserveA: 120, reserveB: 10_200_000, fee: 0.001, tvl: 20_400_000 },
  { id: 'vibe-usdc', name: 'VIBE / USDC', tokenA: 'VIBE', tokenB: 'USDC', reserveA: 8_000_000, reserveB: 2_520_000, fee: 0.003, tvl: 5_040_000 },
  { id: 'link-eth', name: 'LINK / ETH', tokenA: 'LINK', tokenB: 'ETH', reserveA: 400_000, reserveB: 1800, fee: 0.003, tvl: 5_670_000 },
]

const FEE_LABELS = { 0.001: '0.1%', 0.003: '0.3%', 0.005: '0.5%', 0.01: '1.0%' }

const SLIPPAGE_TIERS = [
  { size: '< $1K', rec: '0.1%', risk: 'Low', color: '#22c55e', note: 'Minimal impact, tight tolerance safe' },
  { size: '$1K - $10K', rec: '0.3%', risk: 'Low', color: '#22c55e', note: 'Standard trade, default setting' },
  { size: '$10K - $100K', rec: '0.5%', risk: 'Medium', color: '#f59e0b', note: 'Consider splitting into multiple trades' },
  { size: '$100K - $1M', rec: '1.0%', risk: 'High', color: '#ef4444', note: 'Use batch auctions for better execution' },
  { size: '> $1M', rec: '2.0% + batch', risk: 'Very High', color: '#dc2626', note: 'VibeSwap batch + TWAP recommended' },
]

// ============ AMM Math ============

function calcOutput(rIn, rOut, amtIn, fee) {
  const net = amtIn * (1 - fee)
  return (net * rOut) / (rIn + net)
}

function calcPriceImpact(rIn, rOut, amtIn, fee) {
  const spot = rOut / rIn
  const out = calcOutput(rIn, rOut, amtIn, fee)
  const eff = amtIn > 0 ? out / amtIn : spot
  return { output: out, effectivePrice: eff, spotPrice: spot, impact: Math.max(0, amtIn > 0 ? ((spot - eff) / spot) * 100 : 0) }
}

// ============ SVG Curve ============

function AMMCurve({ reserveA, reserveB, tradeAmountA, fee }) {
  const w = 400, h = 280, pad = 40
  const k = reserveA * reserveB
  const newRA = reserveA + tradeAmountA
  const out = calcOutput(reserveA, reserveB, tradeAmountA, fee)
  const newRB = reserveB - out
  const maxX = reserveA * 3, maxY = reserveB * 2.5
  const sx = (x) => pad + ((x / maxX) * (w - 2 * pad))
  const sy = (y) => h - pad - ((y / maxY) * (h - 2 * pad))

  const pts = []
  for (let i = 1; i <= 200; i++) {
    const x = (maxX * i) / 200, y = k / x
    if (y <= maxY && y > 0) pts.push({ x, y })
  }
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')
  const cx = sx(reserveA), cy = sy(reserveB), nx = sx(newRA), ny = sy(newRB)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {[0.25, 0.5, 0.75, 1.0].map((f) => (
        <g key={f}>
          <line x1={pad} y1={sy(maxY * f)} x2={w - pad} y2={sy(maxY * f)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <line x1={sx(maxX * f)} y1={pad} x2={sx(maxX * f)} y2={h - pad} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        </g>
      ))}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <text x={w / 2} y={h - 8} fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="middle" fontFamily="monospace">Reserve X</text>
      <text x={12} y={h / 2} fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="middle" fontFamily="monospace" transform={`rotate(-90, 12, ${h / 2})`}>Reserve Y</text>
      {tradeAmountA > 0 && <path d={`M ${cx} ${cy} L ${nx} ${ny} L ${nx} ${h - pad} L ${cx} ${h - pad} Z`} fill="rgba(239,68,68,0.12)" />}
      <path d={pathD} fill="none" stroke={CYAN} strokeWidth="2" opacity="0.8" />
      <circle cx={cx} cy={cy} r="5" fill="#22c55e" stroke="#fff" strokeWidth="1.5" />
      <text x={cx + 8} y={cy - 8} fill="#22c55e" fontSize="9" fontFamily="monospace">Current</text>
      {tradeAmountA > 0 && (
        <>
          <circle cx={nx} cy={ny} r="5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
          <text x={nx + 8} y={ny - 8} fill="#ef4444" fontSize="9" fontFamily="monospace">After Trade</text>
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 3" />
        </>
      )}
      <text x={w - pad - 4} y={pad + 14} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end" fontFamily="monospace">x * y = k</text>
    </svg>
  )
}

// ============ Main Component ============

export default function PriceImpactPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedPoolId, setSelectedPoolId] = useState('eth-usdc')
  const [tradePercent, setTradePercent] = useState(1)
  const [direction, setDirection] = useState('buy')
  const [ilInitialPrice, setIlInitialPrice] = useState(3150)
  const [ilCurrentPrice, setIlCurrentPrice] = useState(4000)
  const [eduTab, setEduTab] = useState('formula')

  const pool = useMemo(() => POOLS.find((p) => p.id === selectedPoolId), [selectedPoolId])
  const tradeAmountA = useMemo(() => pool ? (tradePercent / 100) * pool.reserveA : 0, [tradePercent, pool])

  const results = useMemo(() => {
    if (!pool || tradeAmountA <= 0) return { output: 0, effectivePrice: pool ? pool.reserveB / pool.reserveA : 0, spotPrice: pool ? pool.reserveB / pool.reserveA : 0, impact: 0 }
    if (direction === 'buy') return calcPriceImpact(pool.reserveA, pool.reserveB, tradeAmountA, pool.fee)
    const tradeB = (tradePercent / 100) * pool.reserveB
    return calcPriceImpact(pool.reserveB, pool.reserveA, tradeB, pool.fee)
  }, [pool, tradeAmountA, tradePercent, direction])

  const newRA = pool ? pool.reserveA + tradeAmountA : 0
  const newRB = pool ? pool.reserveB - results.output : 0
  const priceAfter = newRA > 0 ? newRB / newRA : 0

  const rng = useMemo(() => seededRandom(42), [])
  const batchReduction = useMemo(() => 0.42 + rng() * 0.16, [rng])
  const batchImpact = results.impact * (1 - batchReduction)

  const ilRatio = ilInitialPrice > 0 ? ilCurrentPrice / ilInitialPrice : 1
  const ilLoss = (2 * Math.sqrt(ilRatio)) / (1 + ilRatio) - 1
  const ilPct = Math.abs(ilLoss * 100)

  const impactColor = results.impact < 0.5 ? '#22c55e' : results.impact < 2 ? '#f59e0b' : '#ef4444'
  const impactLabel = results.impact < 0.1 ? 'Negligible' : results.impact < 0.5 ? 'Low' : results.impact < 2 ? 'Moderate' : results.impact < 5 ? 'High' : 'Severe'
  const fmt = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}K` : n.toFixed(2)

  return (
    <div className="min-h-screen pb-24">
      <PageHero title="Price Impact" subtitle="Simulate trade execution, visualize price curves, and understand slippage before you trade" category="protocol" />

      <div className="max-w-7xl mx-auto px-4 space-y-8">

        {/* ============ Simulator Panel ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6" glowColor="terminal">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Controls */}
              <div className="space-y-6">
                <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }} />
                  Trade Simulator
                </h2>
                {/* Pool selector */}
                <div>
                  <label className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2 block">Pool</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {POOLS.map((p) => (
                      <button key={p.id} onClick={() => { setSelectedPoolId(p.id); setTradePercent(1) }}
                        className={`px-3 py-2 rounded-xl text-xs font-mono transition-all border ${selectedPoolId === p.id ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'border-white/[0.06] bg-white/[0.02] text-gray-400 hover:border-white/[0.12]'}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Pool stats */}
                {pool && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'TVL', value: `$${fmt(pool.tvl)}` },
                      { label: 'Reserves', value: `${fmt(pool.reserveA)} ${pool.tokenA}` },
                      { label: 'Fee Tier', value: FEE_LABELS[pool.fee] || `${pool.fee * 100}%` },
                    ].map((s) => (
                      <div key={s.label} className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
                        <div className="text-[10px] text-gray-500 font-mono uppercase">{s.label}</div>
                        <div className="text-sm font-semibold mt-1">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Direction toggle */}
                <div>
                  <label className="text-xs text-gray-500 font-mono uppercase tracking-wider mb-2 block">Direction</label>
                  <div className="flex gap-2">
                    {['buy', 'sell'].map((d) => (
                      <button key={d} onClick={() => setDirection(d)}
                        className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all border ${direction === d ? (d === 'buy' ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-red-500/40 bg-red-500/10 text-red-400') : 'border-white/[0.06] bg-white/[0.02] text-gray-400 hover:border-white/[0.12]'}`}>
                        {d === 'buy' ? `Buy ${pool?.tokenB || ''}` : `Sell ${pool?.tokenA || ''}`}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Trade size slider */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-gray-500 font-mono uppercase tracking-wider">Trade Size</label>
                    <span className="text-xs font-mono" style={{ color: impactColor }}>{tradePercent.toFixed(1)}% of pool</span>
                  </div>
                  <input type="range" min="0" max="50" step="0.1" value={tradePercent} onChange={(e) => setTradePercent(parseFloat(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${CYAN} 0%, ${CYAN} ${tradePercent * 2}%, rgba(255,255,255,0.06) ${tradePercent * 2}%, rgba(255,255,255,0.06) 100%)` }} />
                  <div className="flex justify-between text-[10px] text-gray-600 font-mono mt-1">
                    <span>0%</span><span>10%</span><span>25%</span><span>50%</span>
                  </div>
                </div>
                {/* Presets */}
                <div className="flex gap-2">
                  {[0.1, 0.5, 1, 5, 10, 25].map((pct) => (
                    <button key={pct} onClick={() => setTradePercent(pct)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-all border ${Math.abs(tradePercent - pct) < 0.01 ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'border-white/[0.04] text-gray-500 hover:text-gray-300'}`}>
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Results */}
              <div className="space-y-6">
                <h2 className="text-lg font-semibold tracking-tight">Results</h2>
                <div className="bg-white/[0.02] rounded-2xl p-6 border border-white/[0.04] text-center">
                  <div className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Price Impact</div>
                  <div className="text-4xl font-bold font-mono" style={{ color: impactColor }}>{results.impact.toFixed(4)}%</div>
                  <div className="text-xs font-mono mt-1" style={{ color: impactColor }}>{impactLabel}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Input', val: `${fmt(direction === 'buy' ? tradeAmountA : (tradePercent / 100) * (pool?.reserveB || 0))} ${direction === 'buy' ? pool?.tokenA : pool?.tokenB}` },
                    { label: 'Output', val: `${fmt(results.output)} ${direction === 'buy' ? pool?.tokenB : pool?.tokenA}` },
                    { label: 'Spot Price', val: results.spotPrice.toFixed(4) },
                    { label: 'Effective Price', val: results.effectivePrice.toFixed(4), color: impactColor },
                  ].map((r) => (
                    <div key={r.label} className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">{r.label}</div>
                      <div className="text-sm font-semibold mt-1" style={r.color ? { color: r.color } : undefined}>{r.val}</div>
                    </div>
                  ))}
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04] col-span-2">
                    <div className="text-[10px] text-gray-500 font-mono uppercase">Price After Trade</div>
                    <div className="text-sm font-semibold mt-1">
                      {(direction === 'buy' ? priceAfter : (priceAfter > 0 ? 1 / priceAfter : 0)).toFixed(4)}{' '}
                      <span className="text-gray-400">{pool?.tokenB}/{pool?.tokenA}</span>
                    </div>
                  </div>
                </div>
                {!isConnected && (
                  <div className="bg-cyan-500/[0.04] rounded-xl p-4 border border-cyan-500/10 text-center">
                    <p className="text-xs text-gray-400 mb-2">Sign in to simulate with your actual balances</p>
                    <Link to="/wallet" className="text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">Sign In →</Link>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ AMM Curve Visualization ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold tracking-tight mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              AMM Curve Visualization
            </h2>
            <p className="text-xs text-gray-500 mb-4">The constant product curve x * y = k. Your trade moves the point along the hyperbola — larger trades cause bigger moves and more slippage.</p>
            {pool && (
              <div className="bg-white/[0.01] rounded-xl border border-white/[0.04] p-4">
                <AMMCurve reserveA={pool.reserveA} reserveB={pool.reserveB} tradeAmountA={tradeAmountA} fee={pool.fee} />
                <div className="flex justify-center gap-6 mt-3">
                  {[{ c: 'bg-green-500', l: 'Current Position' }, { c: 'bg-red-500', l: 'After Trade' }, { c: '', l: 'Price Impact Area', style: { backgroundColor: 'rgba(239,68,68,0.2)' } }].map((item) => (
                    <div key={item.l} className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${item.c}`} style={item.style} />
                      <span className="text-[10px] text-gray-400 font-mono">{item.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pool && (
              <div className="mt-4 flex gap-4 justify-center">
                <div className="bg-white/[0.02] rounded-lg px-4 py-2 border border-white/[0.04]">
                  <span className="text-[10px] text-gray-500 font-mono">k = </span>
                  <span className="text-xs font-mono text-cyan-400">{(pool.reserveA * pool.reserveB).toExponential(4)}</span>
                </div>
                <div className="bg-white/[0.02] rounded-lg px-4 py-2 border border-white/[0.04]">
                  <span className="text-[10px] text-gray-500 font-mono">k' = </span>
                  <span className="text-xs font-mono text-gray-300">{(newRA * newRB).toExponential(4)}</span>
                  <span className="text-[10px] text-gray-600 ml-1">(fees reduce k)</span>
                </div>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Batch Auction Comparison ============ */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6" glowColor="matrix">
            <h2 className="text-lg font-semibold tracking-tight mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              VibeSwap Batch Auction vs Continuous AMM
            </h2>
            <p className="text-xs text-gray-500 mb-6">VibeSwap's 10-second batch auctions aggregate trades at a uniform clearing price, significantly reducing price impact.</p>
            {/* Bars */}
            {[{ label: 'Continuous', pct: results.impact, color: '#ef4444' }, { label: 'VibeSwap', pct: batchImpact, color: '#22c55e' }].map((bar) => (
              <div key={bar.label} className="flex items-center gap-3 mb-3">
                <span className="text-xs text-gray-400 font-mono w-24 text-right shrink-0">{bar.label}</span>
                <div className="flex-1 h-6 bg-white/[0.03] rounded-lg overflow-hidden relative">
                  <motion.div className="h-full rounded-lg" style={{ backgroundColor: bar.color }}
                    initial={{ width: 0 }} animate={{ width: `${Math.min((bar.pct / Math.max(results.impact, 0.01)) * 100, 100)}%` }}
                    transition={{ duration: 0.6, ease }} />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/70">{bar.pct.toFixed(3)}%</span>
                </div>
              </div>
            ))}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Impact Reduction', value: `${(batchReduction * 100).toFixed(0)}%`, color: '#22c55e', sub: 'less slippage' },
                { label: 'MEV Extracted', value: '$0.00', color: '#ef4444', sub: 'commit-reveal prevents frontrunning' },
                { label: 'Batch Window', value: '10s', color: CYAN, sub: '8s commit + 2s reveal' },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.04] text-center">
                  <div className="text-[10px] text-gray-500 font-mono uppercase mb-1">{s.label}</div>
                  <div className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-gray-600 mt-1">{s.sub}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 bg-white/[0.01] rounded-xl border border-white/[0.04] p-4">
              <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider mb-3">How Batching Reduces Impact</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { step: '1', title: 'Aggregate', desc: 'All orders within a 10s window are collected and sealed via commit-reveal.' },
                  { step: '2', title: 'Net Offsets', desc: 'Opposing buy/sell orders partially cancel out, reducing net flow against the pool.' },
                  { step: '3', title: 'Uniform Price', desc: 'One clearing price for the entire batch — no ordering advantage, no MEV.' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono text-cyan-400">{item.step}</span>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-200 mb-0.5">{item.title}</div>
                      <div className="text-[10px] text-gray-500 leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Slippage Settings ============ */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold tracking-tight mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Recommended Slippage Settings
            </h2>
            <p className="text-xs text-gray-500 mb-4">Set your slippage tolerance based on trade size. Too low and your trade may fail; too high and you risk being sandwiched.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Trade Size', 'Recommended', 'Risk Level', 'Note'].map((h) => (
                      <th key={h} className="text-[10px] text-gray-500 font-mono uppercase tracking-wider py-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLIPPAGE_TIERS.map((t, i) => (
                    <tr key={i} className="border-b border-white/[0.03]">
                      <td className="text-xs font-mono text-gray-300 py-2.5 pr-4">{t.size}</td>
                      <td className="text-xs font-mono py-2.5 pr-4" style={{ color: CYAN }}>{t.rec}</td>
                      <td className="py-2.5 pr-4">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ backgroundColor: `${t.color}15`, color: t.color }}>{t.risk}</span>
                      </td>
                      <td className="text-[10px] text-gray-500 py-2.5">{t.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-amber-500/[0.04] rounded-xl p-3 border border-amber-500/10">
              <p className="text-[10px] text-amber-400/80 font-mono leading-relaxed">
                Tip: On VibeSwap, the commit-reveal mechanism prevents sandwich attacks regardless of slippage setting. Your tolerance only affects whether your trade executes at the batch clearing price.
              </p>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Impermanent Loss Calculator ============ */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6" glowColor="warning">
            <h2 className="text-lg font-semibold tracking-tight mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Impermanent Loss Calculator
            </h2>
            <p className="text-xs text-gray-500 mb-6">Estimate impermanent loss for LPs when token prices diverge from entry.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                {[{ label: 'Initial Price (entry)', val: ilInitialPrice, set: setIlInitialPrice }, { label: 'Current Price', val: ilCurrentPrice, set: setIlCurrentPrice }].map((input) => (
                  <div key={input.label}>
                    <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1.5 block">{input.label}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                      <input type="number" value={input.val} onChange={(e) => input.set(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5 pl-7 text-sm font-mono focus:outline-none focus:border-cyan-500/40 transition-colors" />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1.5 block">Quick Scenarios</label>
                  <div className="flex flex-wrap gap-2">
                    {[{ l: '2x', r: 2 }, { l: '3x', r: 3 }, { l: '5x', r: 5 }, { l: '0.5x', r: 0.5 }, { l: '0.25x', r: 0.25 }].map(({ l, r }) => (
                      <button key={l} onClick={() => setIlCurrentPrice(ilInitialPrice * r)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-mono border border-white/[0.06] text-gray-400 hover:text-amber-400 hover:border-amber-500/20 transition-colors">{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="bg-white/[0.02] rounded-2xl p-6 border border-white/[0.04] text-center">
                  <div className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Impermanent Loss</div>
                  <div className="text-4xl font-bold font-mono" style={{ color: ilPct > 5 ? '#ef4444' : ilPct > 2 ? '#f59e0b' : '#22c55e' }}>{ilPct.toFixed(2)}%</div>
                  <div className="text-[10px] text-gray-500 mt-1 font-mono">Price ratio: {ilRatio.toFixed(4)}x</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
                    <div className="text-[10px] text-gray-500 font-mono uppercase">HODL Value</div>
                    <div className="text-xs font-semibold mt-1 text-green-400 font-mono">${(1000 * (1 + ilRatio) / 2).toFixed(2)}</div>
                    <div className="text-[10px] text-gray-600">per $1,000 deposited</div>
                  </div>
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
                    <div className="text-[10px] text-gray-500 font-mono uppercase">LP Value</div>
                    <div className="text-xs font-semibold mt-1 font-mono" style={{ color: ilPct > 5 ? '#ef4444' : '#f59e0b' }}>${((1000 * (1 + ilRatio) / 2) * (1 + ilLoss)).toFixed(2)}</div>
                    <div className="text-[10px] text-gray-600">per $1,000 deposited</div>
                  </div>
                </div>
                <div className="bg-green-500/[0.04] rounded-xl p-3 border border-green-500/10">
                  <p className="text-[10px] text-green-400/80 font-mono leading-relaxed">
                    VibeSwap IL Protection: LPs earn insurance credits proportional to time in pool. After 90 days, up to 100% of IL is covered.
                    <Link to="/insurance" className="text-cyan-400 hover:text-cyan-300 ml-1">Learn more →</Link>
                  </p>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Educational Section ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold tracking-tight mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              Why Does Price Impact Exist?
            </h2>
            <p className="text-xs text-gray-500 mb-4">Understanding the constant product formula and how it determines trade execution.</p>
            <div className="flex gap-2 mb-6">
              {[{ id: 'formula', label: 'The Formula' }, { id: 'intuition', label: 'Intuition' }, { id: 'comparison', label: 'AMM Models' }].map((tab) => (
                <button key={tab.id} onClick={() => setEduTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${eduTab === tab.id ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-white/[0.06] text-gray-400 hover:border-white/[0.12]'}`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {eduTab === 'formula' && (
              <div className="space-y-4">
                <div className="bg-white/[0.02] rounded-xl p-5 border border-white/[0.04]">
                  <div className="text-center mb-4">
                    <div className="text-2xl font-mono font-bold tracking-wider text-cyan-400">x * y = k</div>
                    <div className="text-[10px] text-gray-500 mt-1 font-mono">The Constant Product Invariant</div>
                  </div>
                  <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
                    <p><span className="text-cyan-400 font-mono">x</span> = reserve of token A, <span className="text-cyan-400 font-mono">y</span> = reserve of token B, <span className="text-cyan-400 font-mono">k</span> = constant product.</p>
                    <p>When you trade <span className="text-cyan-400 font-mono">dx</span> of token A for token B, the AMM must maintain the invariant:</p>
                    <div className="bg-black/30 rounded-lg p-3 font-mono text-center text-sm text-cyan-300">dy = y - k / (x + dx)</div>
                    <p>As <span className="text-cyan-400 font-mono">dx</span> grows relative to <span className="text-cyan-400 font-mono">x</span>, each additional unit buys less <span className="text-cyan-400 font-mono">dy</span>. This diminishing return IS price impact.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { title: 'Spot Price', desc: 'The instantaneous ratio y/x before any trade executes. This is what you see on price charts.' },
                    { title: 'Effective Price', desc: 'The actual rate you receive: output/input. Always worse than spot for non-zero trades due to the curve shape.' },
                    { title: 'Slippage', desc: 'The gap between spot and effective price. Your tolerance is the max acceptable gap — trades revert if exceeded.' },
                  ].map((c) => (
                    <div key={c.title} className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.04]">
                      <div className="text-xs font-semibold text-gray-200 mb-1">{c.title}</div>
                      <div className="text-[10px] text-gray-500 font-mono leading-relaxed">{c.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {eduTab === 'intuition' && (
              <div className="space-y-4">
                <div className="bg-white/[0.02] rounded-xl p-5 border border-white/[0.04]">
                  <h3 className="text-sm font-semibold text-gray-200 mb-3">Think of it like a seesaw</h3>
                  <div className="space-y-3 text-xs text-gray-400 leading-relaxed">
                    <p>Imagine a pool as a balanced seesaw. Token A on one side, token B on the other. When you add weight (trade token A in), your side goes down and the other goes up.</p>
                    <p>A small pebble barely tips the seesaw. But a boulder? That is a huge shift. The ratio of your trade to the pool's depth determines how far the seesaw tips.</p>
                    <p>This is why deeper pools have less impact: the seesaw is heavier and harder to move. A $10K trade in a $100M pool barely registers. The same $10K in a $100K pool creates 10% impact.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-green-500/[0.04] rounded-xl p-4 border border-green-500/10">
                    <div className="text-xs font-semibold text-green-400 mb-2">Reduces Impact</div>
                    <ul className="space-y-1.5 text-[10px] text-gray-400 font-mono">
                      <li>+ Deeper pool liquidity (higher TVL)</li>
                      <li>+ Splitting trades across batches</li>
                      <li>+ Trading against opposing flow</li>
                      <li>+ Using batch auctions (VibeSwap)</li>
                    </ul>
                  </div>
                  <div className="bg-red-500/[0.04] rounded-xl p-4 border border-red-500/10">
                    <div className="text-xs font-semibold text-red-400 mb-2">Increases Impact</div>
                    <ul className="space-y-1.5 text-[10px] text-gray-400 font-mono">
                      <li>- Larger trade relative to pool</li>
                      <li>- Shallow liquidity (low TVL)</li>
                      <li>- One-sided flow (all buys, no sells)</li>
                      <li>- MEV bots frontrunning your trade</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {eduTab === 'comparison' && (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {['Model', 'Formula', 'Impact Profile', 'Used By'].map((h) => (
                          <th key={h} className="text-[10px] text-gray-500 font-mono uppercase tracking-wider py-2 pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { model: 'Constant Product', formula: 'x * y = k', impact: 'Quadratic — scales with trade^2', used: 'Uniswap V2, SushiSwap', badge: false },
                        { model: 'Concentrated', formula: 'x * y = k (in range)', impact: 'Lower in range, infinite outside', used: 'Uniswap V3', badge: false },
                        { model: 'StableSwap', formula: 'An^n*sum + D = ...', impact: 'Near-zero for pegged assets', used: 'Curve Finance', badge: false },
                        { model: 'Batch Auction', formula: 'Uniform clearing price', impact: 'Minimized via netting + batching', used: 'VibeSwap, CoW Protocol', badge: true },
                      ].map((row) => (
                        <tr key={row.model} className="border-b border-white/[0.03]">
                          <td className="text-xs font-semibold text-gray-200 py-2.5 pr-4">
                            {row.model}
                            {row.badge && <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">VibeSwap</span>}
                          </td>
                          <td className="text-[10px] font-mono text-cyan-400/70 py-2.5 pr-4">{row.formula}</td>
                          <td className="text-[10px] text-gray-400 py-2.5 pr-4">{row.impact}</td>
                          <td className="text-[10px] text-gray-500 py-2.5">{row.used}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-cyan-500/[0.04] rounded-xl p-4 border border-cyan-500/10">
                  <h3 className="text-xs font-semibold text-cyan-400 mb-2">Why VibeSwap is Different</h3>
                  <p className="text-[10px] text-gray-400 font-mono leading-relaxed">
                    Traditional AMMs execute trades sequentially — each trade moves the price for the next. VibeSwap's commit-reveal batch auction collects all trades in an 8-second commit phase, then reveals and executes simultaneously at one uniform clearing price. No ordering advantage. No MEV. Reduced impact through natural netting.
                  </p>
                </div>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Navigation Footer ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible">
          <div className="flex flex-wrap justify-center gap-3">
            {[{ to: '/swap', l: 'Swap' }, { to: '/pool', l: 'Pools' }, { to: '/commit-reveal', l: 'Commit-Reveal' }, { to: '/analytics', l: 'Analytics' }, { to: '/circuit-breaker', l: 'Circuit Breakers' }].map((link, i) => (
              <motion.div key={link.to} custom={i} variants={cardV} initial="hidden" animate="visible">
                <Link to={link.to} className="px-4 py-2 rounded-xl text-xs font-mono border border-white/[0.06] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/20 transition-all bg-white/[0.02] hover:bg-cyan-500/[0.04]">
                  {link.l} →
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
