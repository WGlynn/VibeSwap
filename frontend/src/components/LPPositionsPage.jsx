import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER = 1 / (PHI * PHI * PHI)
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG (seed 2323) ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Animation Variants ============
const sectionVariants = {
  hidden: () => ({ opacity: 0, y: 30, filter: 'blur(4px)' }),
  visible: (i) => ({
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { delay: i * 0.12 / PHI, duration: 0.5, ease: 'easeOut' },
  }),
}

// ============ Formatters ============
function fmt(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
const fmtPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const fmtDays = (d) => d >= 365 ? `${(d / 365).toFixed(1)}y` : d >= 30 ? `${Math.floor(d / 30)}mo ${d % 30}d` : `${d}d`

// ============ Mock Data Generator ============
const TK = {
  ETH: { symbol: 'ETH', icon: '\u039E' }, USDC: { symbol: 'USDC', icon: '\uD83D\uDCB5' },
  WBTC: { symbol: 'WBTC', icon: '\u20BF' }, DAI: { symbol: 'DAI', icon: '\u25C8' },
  LINK: { symbol: 'LINK', icon: '\u26D3' }, UNI: { symbol: 'UNI', icon: '\uD83E\uDD84' },
  ARB: { symbol: 'ARB', icon: '\u2B21' }, OP: { symbol: 'OP', icon: '\u2B24' },
}

function buildPositions() {
  const pairs = [
    ['ETH', 'USDC', 2323], ['WBTC', 'ETH', 2324], ['ETH', 'DAI', 2325],
    ['LINK', 'ETH', 2326], ['ARB', 'USDC', 2327],
  ]
  return pairs.map(([a, b, seed]) => {
    const r = seededRandom(seed)
    const tvlPool = 2e6 + r() * 22e6
    const share = 0.001 + r() * 0.008
    const value = tvlPool * share
    const feesEarned = value * (0.02 + r() * 0.12)
    const ilPct = -(r() * 4.5)
    const ilAmount = value * (ilPct / 100)
    const apr = 6 + r() * 38
    const durationDays = Math.floor(14 + r() * 350)
    const priceLower = 1000 + r() * 2000
    const priceUpper = priceLower + 200 + r() * 1800
    const currentPrice = priceLower + (priceUpper - priceLower) * (0.2 + r() * 0.6)
    const inRange = currentPrice >= priceLower && currentPrice <= priceUpper
    const feeTier = r() > 0.6 ? 0.3 : r() > 0.3 ? 0.05 : 0.01

    // Fee collection history
    const feeHistory = Array.from({ length: 12 }, (_, i) => {
      const rh = seededRandom(seed + i * 7)
      return {
        date: new Date(Date.now() - (11 - i) * 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        amount: feesEarned / 12 * (0.5 + rh() * 1.0),
        tokenA: (feesEarned / 12 * (0.5 + rh() * 1.0)) * (0.4 + rh() * 0.2),
        tokenB: 0,
      }
    })
    feeHistory.forEach(f => { f.tokenB = f.amount - f.tokenA })

    // Performance chart data (30 points)
    const perfData = []
    let cumValue = value * 0.85
    for (let i = 0; i < 30; i++) {
      const rp = seededRandom(seed + 100 + i * 3)
      cumValue += cumValue * (-0.01 + rp() * 0.025)
      perfData.push({ day: i + 1, value: cumValue, fees: feesEarned * (i / 29), il: ilAmount * (i / 29) })
    }

    // Pool health
    const utilizationPct = 40 + r() * 55
    const volume24h = tvlPool * (0.03 + r() * 0.15)
    const tradersCount = Math.floor(50 + r() * 500)

    return {
      id: `pos-${a}-${b}`, tokenA: TK[a], tokenB: TK[b], tvlPool, share, value,
      feesEarned, ilPct, ilAmount, apr, durationDays, priceLower, priceUpper,
      currentPrice, inRange, feeTier, feeHistory, perfData,
      utilizationPct, volume24h, tradersCount,
      ilProtected: r() > 0.4, coveragePct: Math.floor(50 + r() * 50),
    }
  })
}

// ============ Section Wrapper ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-xs font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-4" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Mini Sparkline ============
function MiniChart({ data, width = 120, height = 40, color = CYAN }) {
  if (!data || data.length < 2) return null
  const vals = data.map(d => d.value)
  const max = Math.max(...vals), min = Math.min(...vals)
  const range = max - min || 1
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * width},${height - 4 - ((v - min) / range) * (height - 8)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="perf-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill="url(#perf-grad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ============ Range Indicator ============
function RangeIndicator({ lower, upper, current, inRange }) {
  const rangeSpan = upper - lower
  const padding = rangeSpan * 0.15
  const vizMin = lower - padding
  const vizMax = upper + padding
  const vizRange = vizMax - vizMin
  const leftPct = ((lower - vizMin) / vizRange) * 100
  const widthPct = ((upper - lower) / vizRange) * 100
  const currentPct = Math.min(100, Math.max(0, ((current - vizMin) / vizRange) * 100))

  return (
    <div className="relative w-full h-8 rounded-lg bg-black-800/80 overflow-hidden">
      {/* Active range bar */}
      <div
        className="absolute top-1 bottom-1 rounded"
        style={{
          left: `${leftPct}%`, width: `${widthPct}%`,
          background: inRange
            ? `linear-gradient(90deg, ${CYAN}30, ${CYAN}50, ${CYAN}30)`
            : 'rgba(239,68,68,0.15)',
          border: `1px solid ${inRange ? `${CYAN}60` : 'rgba(239,68,68,0.3)'}`,
        }}
      />
      {/* Current price marker */}
      <motion.div
        className="absolute top-0 bottom-0 w-0.5"
        style={{ left: `${currentPct}%`, background: inRange ? '#22c55e' : '#ef4444' }}
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Labels */}
      <div className="absolute inset-0 flex items-center justify-between px-2">
        <span className="text-[9px] font-mono text-black-500">{lower.toFixed(0)}</span>
        <span className={`text-[9px] font-mono font-semibold ${inRange ? 'text-green-400' : 'text-red-400'}`}>
          {current.toFixed(0)}
        </span>
        <span className="text-[9px] font-mono text-black-500">{upper.toFixed(0)}</span>
      </div>
    </div>
  )
}

// ============ Health Indicator Dots ============
function HealthDots({ value, max = 100 }) {
  const level = Math.ceil((value / max) * 5)
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e']
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="w-2 h-2 rounded-full" style={{
          backgroundColor: i < level ? colors[Math.min(level - 1, 4)] : 'rgba(255,255,255,0.08)',
        }} />
      ))}
    </div>
  )
}

// ============ Position Card ============
function PositionCard({ pos, index, onManage }) {
  const {
    tokenA, tokenB, share, value, feesEarned, ilPct, ilAmount,
    apr, durationDays, priceLower, priceUpper, currentPrice, inRange,
    feeTier, ilProtected, coveragePct, perfData,
  } = pos

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * STAGGER, duration: STAGGER * PHI, ease: EASE }}>
      <GlassCard glowColor={inRange ? 'terminal' : 'warning'} spotlight className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <span className="text-2xl">{tokenA.icon}</span>
              <span className="text-2xl">{tokenB.icon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{tokenA.symbol}/{tokenB.symbol}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono" style={{
                  background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}25`,
                }}>{feeTier}%</span>
              </div>
              <div className="text-[10px] text-black-500 font-mono">{(share * 100).toFixed(4)}% pool share</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {inRange ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-green-400 font-medium">In Range</span>
              </div>
            ) : (
              <div className="px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20">
                <span className="text-[10px] text-red-400 font-medium">Out of Range</span>
              </div>
            )}
            {ilProtected && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-[10px] text-green-400 font-medium">{coveragePct}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="p-2.5 rounded-lg bg-black-800/60">
            <div className="text-[10px] text-black-500 mb-0.5">Value</div>
            <div className="text-sm font-semibold font-mono">{fmt(value)}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-black-800/60">
            <div className="text-[10px] text-black-500 mb-0.5">Fees Earned</div>
            <div className="text-sm font-semibold font-mono text-green-400">{fmt(feesEarned)}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-black-800/60">
            <div className="text-[10px] text-black-500 mb-0.5">IL Impact</div>
            <div className={`text-sm font-semibold font-mono ${ilPct < -2 ? 'text-red-400' : ilPct < -0.5 ? 'text-amber-400' : 'text-green-400'}`}>
              {fmtPct(ilPct)}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-black-800/60">
            <div className="text-[10px] text-black-500 mb-0.5">APR</div>
            <div className="text-sm font-semibold font-mono" style={{ color: CYAN }}>{apr.toFixed(1)}%</div>
          </div>
        </div>

        {/* Range + Duration */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-black-500 font-mono uppercase tracking-wider">Price Range</span>
            <span className="text-[10px] text-black-500 font-mono">Duration: {fmtDays(durationDays)}</span>
          </div>
          <RangeIndicator lower={priceLower} upper={priceUpper} current={currentPrice} inRange={inRange} />
        </div>

        {/* Mini Performance Chart */}
        <div className="mb-4">
          <MiniChart data={perfData} height={32} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-black-700/50">
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => onManage(pos, 'add')}
            className="flex-1 py-2 text-xs font-medium rounded-lg transition-colors"
            style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}25` }}>
            + Add Liquidity
          </motion.button>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => onManage(pos, 'remove')}
            className="flex-1 py-2 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-colors">
            - Remove
          </motion.button>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => onManage(pos, 'collect')}
            className="flex-1 py-2 text-xs font-medium rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/15 transition-colors">
            Collect Fees
          </motion.button>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Range Selector Modal ============
function RangeSelectorModal({ position, onClose }) {
  const [minPrice, setMinPrice] = useState(position?.priceLower?.toFixed(0) || '')
  const [maxPrice, setMaxPrice] = useState(position?.priceUpper?.toFixed(0) || '')

  const width = useMemo(() => {
    const min = parseFloat(minPrice) || 0
    const max = parseFloat(maxPrice) || 0
    return max > min ? max - min : 0
  }, [minPrice, maxPrice])

  const concentration = useMemo(() => {
    if (!width) return 'Full Range'
    if (width < 200) return 'Narrow (High Risk / High APR)'
    if (width < 600) return 'Medium (Balanced)'
    return 'Wide (Low Risk / Low APR)'
  }, [width])

  const concentrationColor = useMemo(() => {
    if (!width) return 'text-black-400'
    if (width < 200) return 'text-red-400'
    if (width < 600) return 'text-amber-400'
    return 'text-green-400'
  }, [width])

  const inputCls = "w-full px-3 py-2.5 bg-black-800 border border-black-700/50 rounded-lg text-sm font-mono outline-none focus:border-cyan-500/40 transition-colors"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: STAGGER }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: STAGGER * PHI, ease: EASE }}
        className="relative w-full max-w-md glass-card rounded-2xl border border-black-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black-700/50">
          <div>
            <h3 className="text-lg font-semibold">Adjust Price Range</h3>
            <p className="text-[10px] text-black-500 font-mono mt-0.5">
              {position?.tokenA?.symbol}/{position?.tokenB?.symbol} Concentrated Liquidity
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black-700 transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-black-500 mb-1.5 block font-mono uppercase tracking-wider">Min Price</label>
              <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className="text-[10px] text-black-500 mb-1.5 block font-mono uppercase tracking-wider">Max Price</label>
              <input type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="\u221E" className={inputCls} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {['Full Range', '-25%', '-10%', 'Current', '+10%', '+25%'].map(preset => (
              <button key={preset} onClick={() => {
                const cur = position?.currentPrice || 2000
                if (preset === 'Full Range') { setMinPrice('0'); setMaxPrice('999999') }
                else if (preset === 'Current') { setMinPrice((cur * 0.9).toFixed(0)); setMaxPrice((cur * 1.1).toFixed(0)) }
                else {
                  const pct = parseFloat(preset) / 100
                  if (pct < 0) setMinPrice((cur * (1 + pct)).toFixed(0))
                  else setMaxPrice((cur * (1 + pct)).toFixed(0))
                }
              }}
                className="text-[10px] px-2 py-1 rounded bg-black-700 text-black-400 hover:text-white transition-colors font-mono">
                {preset}
              </button>
            ))}
          </div>

          {position && (
            <RangeIndicator
              lower={parseFloat(minPrice) || position.priceLower}
              upper={parseFloat(maxPrice) || position.priceUpper}
              current={position.currentPrice}
              inRange={position.currentPrice >= (parseFloat(minPrice) || 0) && position.currentPrice <= (parseFloat(maxPrice) || Infinity)}
            />
          )}

          <div className="p-3 rounded-xl bg-black-800/60 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-black-500">Concentration</span>
              <span className={`font-mono text-xs ${concentrationColor}`}>{concentration}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-black-500">Range Width</span>
              <span className="font-mono text-xs text-black-300">{width.toFixed(0)} {position?.tokenB?.symbol}</span>
            </div>
          </div>

          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
            className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all"
            style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}>
            Update Range
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}

// ============ IL Calculator ============
function ILCalculator() {
  const [initialPrice, setInitialPrice] = useState('2000')
  const [currentPriceInput, setCurrentPriceInput] = useState('2400')

  const ilResult = useMemo(() => {
    const p0 = parseFloat(initialPrice) || 1
    const p1 = parseFloat(currentPriceInput) || p0
    const ratio = p1 / p0
    const sqrtR = Math.sqrt(ratio)
    const ilPct = (2 * sqrtR / (1 + ratio) - 1) * 100
    const holdValue = (1 + ratio) / 2
    const lpValue = sqrtR
    return { ilPct, holdValue, lpValue, ratio }
  }, [initialPrice, currentPriceInput])

  const inputCls = "w-full bg-black-700 rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-cyan-500/50"

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-black-400 block mb-1.5">Initial Price</label>
          <input type="number" value={initialPrice} onChange={e => setInitialPrice(e.target.value)}
            className={inputCls} placeholder="2000" />
        </div>
        <div>
          <label className="text-xs text-black-400 block mb-1.5">Current Price</label>
          <input type="number" value={currentPriceInput} onChange={e => setCurrentPriceInput(e.target.value)}
            className={inputCls} placeholder="2400" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-black-700/50 text-center">
          <div className="text-[10px] text-black-500 mb-1 uppercase">IL Loss</div>
          <div className={`text-lg font-bold font-mono ${ilResult.ilPct < -1 ? 'text-red-400' : 'text-amber-400'}`}>
            {ilResult.ilPct.toFixed(3)}%
          </div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50 text-center">
          <div className="text-[10px] text-black-500 mb-1 uppercase">Hold Value</div>
          <div className="text-lg font-bold font-mono text-black-300">{(ilResult.holdValue * 100).toFixed(1)}%</div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50 text-center">
          <div className="text-[10px] text-black-500 mb-1 uppercase">LP Value</div>
          <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{(ilResult.lpValue * 100).toFixed(1)}%</div>
        </div>
      </div>

      {/* Quick presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-black-500 font-mono">Price change:</span>
        {[-50, -25, -10, 10, 25, 50, 100, 200].map(pct => {
          const p0 = parseFloat(initialPrice) || 2000
          return (
            <button key={pct} onClick={() => setCurrentPriceInput((p0 * (1 + pct / 100)).toFixed(0))}
              className={`text-[10px] px-2 py-1 rounded font-mono transition-colors ${pct < 0 ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}>
              {pct > 0 ? '+' : ''}{pct}%
            </button>
          )
        })}
      </div>

      <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
        <p className="text-[11px] text-black-400 leading-relaxed">
          Impermanent loss occurs when the price ratio of pooled tokens diverges from the deposit ratio.
          A {Math.abs(((parseFloat(currentPriceInput) || 2000) / (parseFloat(initialPrice) || 2000) - 1) * 100).toFixed(0)}% price
          change results in {Math.abs(ilResult.ilPct).toFixed(3)}% IL. Fees earned can offset this loss.
        </p>
      </div>
    </div>
  )
}

// ============ Fee Collection History ============
function FeeHistory({ positions }) {
  const allFees = useMemo(() => {
    const combined = []
    positions.forEach(pos => {
      pos.feeHistory.forEach((fh, i) => {
        if (combined[i]) {
          combined[i].amount += fh.amount
          combined[i].tokenA += fh.tokenA
          combined[i].tokenB += fh.tokenB
        } else {
          combined[i] = { ...fh }
        }
      })
    })
    return combined
  }, [positions])

  const maxFee = Math.max(...allFees.map(f => f.amount), 1)

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1" style={{ height: 100 }}>
        {allFees.map((fee, i) => (
          <motion.div key={i} className="flex-1 flex flex-col items-center gap-0.5"
            initial={{ height: 0 }} animate={{ height: '100%' }}
            transition={{ delay: i * 0.05, duration: 0.4 }}>
            <div className="w-full flex flex-col justify-end flex-1 gap-px">
              <div className="w-full rounded-t" style={{
                height: `${(fee.tokenA / maxFee) * 100}%`,
                background: CYAN, minHeight: 2, opacity: 0.8,
              }} />
              <div className="w-full rounded-b" style={{
                height: `${(fee.tokenB / maxFee) * 100}%`,
                background: '#22c55e', minHeight: 2, opacity: 0.8,
              }} />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[9px] text-black-500 font-mono">
        <span>{allFees[0]?.date}</span>
        <span>{allFees[allFees.length - 1]?.date}</span>
      </div>
      <div className="flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded" style={{ background: CYAN }} />
          <span className="text-black-400">Token A fees</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded bg-green-500" />
          <span className="text-black-400">Token B fees</span>
        </div>
        <div className="ml-auto font-mono text-black-300">
          Total: {fmt(allFees.reduce((s, f) => s + f.amount, 0))}
        </div>
      </div>
    </div>
  )
}

// ============ Performance Chart ============
function PerformanceChart({ positions, selectedPos }) {
  const data = selectedPos ? selectedPos.perfData : positions[0]?.perfData || []
  if (!data.length) return null

  const vals = data.map(d => d.value)
  const max = Math.max(...vals), min = Math.min(...vals)
  const range = max - min || 1
  const W = 400, H = 140, pad = 12

  const valuePts = data.map((d, i) => `${(i / (data.length - 1)) * W},${H - pad - ((d.value - min) / range) * (H - 2 * pad)}`).join(' ')

  const feesMax = Math.max(...data.map(d => d.fees), 1)
  const feesPts = data.map((d, i) => `${(i / (data.length - 1)) * W},${H - pad - (d.fees / feesMax) * (H - 2 * pad) * 0.3}`).join(' ')

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="val-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.2" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${valuePts} ${W},${H}`} fill="url(#val-grad)" />
        <polyline points={valuePts} fill="none" stroke={CYAN} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={feesPts} fill="none" stroke="#22c55e" strokeWidth="1" strokeDasharray="4 2" strokeLinejoin="round" opacity="0.6" />
      </svg>
      <div className="flex items-center justify-between text-[10px] px-1">
        <span className="text-black-500 font-mono">30d ago</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ background: CYAN }} />
            <span className="text-black-400">Position Value</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded bg-green-500 opacity-60" style={{ borderTop: '1px dashed' }} />
            <span className="text-black-400">Cumulative Fees</span>
          </div>
        </div>
        <span className="text-black-500 font-mono">Today</span>
      </div>
    </div>
  )
}

// ============ Pool Health ============
function PoolHealth({ positions }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {positions.map(pos => {
        const healthScore = Math.min(100, Math.max(0,
          (pos.inRange ? 30 : 0) + (pos.utilizationPct * 0.4) + (pos.apr > 15 ? 20 : pos.apr > 8 ? 10 : 0) + (pos.ilPct > -1 ? 10 : 0)
        ))
        return (
          <div key={pos.id} className="p-3 rounded-xl bg-black-700/30 border border-black-700/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{pos.tokenA.icon}</span>
                <span className="text-lg">{pos.tokenB.icon}</span>
                <span className="text-xs font-semibold">{pos.tokenA.symbol}/{pos.tokenB.symbol}</span>
              </div>
              <HealthDots value={healthScore} />
            </div>
            <div className="space-y-2">
              {[
                ['Utilization', `${pos.utilizationPct.toFixed(1)}%`, pos.utilizationPct > 60 ? 'text-green-400' : 'text-amber-400'],
                ['24h Volume', fmt(pos.volume24h), 'text-black-300'],
                ['Active Traders', pos.tradersCount.toString(), 'text-black-300'],
                ['Status', pos.inRange ? 'In Range' : 'Out of Range', pos.inRange ? 'text-green-400' : 'text-red-400'],
              ].map(([label, val, color]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-black-500">{label}</span>
                  <span className={`font-mono ${color}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============ Main Component ============
export default function LPPositionsPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedPosition, setSelectedPosition] = useState(null)
  const [showRangeSelector, setShowRangeSelector] = useState(false)
  const [chartPosition, setChartPosition] = useState(null)

  const positions = useMemo(() => buildPositions(), [])

  const totals = useMemo(() => ({
    value: positions.reduce((s, p) => s + p.value, 0),
    fees: positions.reduce((s, p) => s + p.feesEarned, 0),
    ilTotal: positions.reduce((s, p) => s + p.ilAmount, 0),
    avgApr: positions.reduce((s, p) => s + p.apr, 0) / positions.length,
  }), [positions])

  const handleManage = useCallback((pos, action) => {
    if (action === 'add' || action === 'remove') {
      setSelectedPosition(pos)
      setShowRangeSelector(true)
    }
  }, [])

  return (
    <div className="min-h-screen pb-20">
      {/* Background Particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 23) % 100}%`, top: `${(i * PHI * 31) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1, 0], y: [0, -40 - (i % 3) * 20] }}
            transition={{ duration: 5 + (i % 4) * PHI, repeat: Infinity, delay: i * 0.7, ease: 'easeInOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        <PageHero
          category="defi"
          title="LP Positions"
          subtitle="Manage your liquidity, track fees, and monitor impermanent loss"
          badge="Live"
          badgeColor={CYAN}
        >
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            className="px-4 py-2 text-xs font-medium rounded-lg transition-colors"
            style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}25` }}>
            + New Position
          </motion.button>
        </PageHero>

        <div className="max-w-6xl mx-auto px-4 space-y-5">

          {/* ============ 1. Portfolio Overview ============ */}
          <Section index={0} title="Portfolio Overview" subtitle="Total value and earnings across all LP positions">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Total Value', fmt(totals.value), null],
                ['Fees Earned', fmt(totals.fees), '#22c55e'],
                ['IL Impact', fmt(Math.abs(totals.ilTotal)), '#ef4444'],
                ['Avg APR', `${totals.avgApr.toFixed(1)}%`, CYAN],
              ].map(([label, val, color]) => (
                <div key={label} className="p-3 rounded-xl bg-black-700/50 text-center">
                  <div className="text-[10px] text-black-500 mb-1 uppercase tracking-wider font-mono">{label}</div>
                  <div className="text-lg font-bold font-mono" style={color ? { color } : undefined}>
                    {isConnected ? val : '--'}
                  </div>
                </div>
              ))}
            </div>
            {isConnected && (
              <div className="mt-3 p-3 rounded-xl bg-black-800/40 flex items-center justify-between">
                <div className="text-xs text-black-400">
                  Net P&L (Fees - IL): <span className={`font-mono font-semibold ${totals.fees + totals.ilTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmt(Math.abs(totals.fees + totals.ilTotal))} {totals.fees + totals.ilTotal >= 0 ? 'profit' : 'loss'}
                  </span>
                </div>
                <div className="text-[10px] text-black-500 font-mono">{positions.length} active positions</div>
              </div>
            )}
          </Section>

          {/* ============ 2. Position Cards ============ */}
          <Section index={1} title="Your Positions" subtitle="Active liquidity positions with real-time metrics">
            {!isConnected ? (
              <div className="text-center py-8">
                <p className="text-black-400 text-sm mb-4">Connect your wallet to view your LP positions</p>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={connect}
                  className="px-6 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}>
                  Connect Wallet
                </motion.button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {positions.map((pos, i) => (
                  <PositionCard key={pos.id} pos={pos} index={i} onManage={handleManage} />
                ))}
              </div>
            )}
          </Section>

          {/* ============ 3. Performance Chart ============ */}
          {isConnected && (
            <Section index={2} title="Position Performance" subtitle="30-day value tracking with cumulative fee overlay">
              <div className="mb-4 flex flex-wrap gap-2">
                <button onClick={() => setChartPosition(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors font-mono"
                  style={{
                    background: !chartPosition ? `${CYAN}20` : 'rgba(40,40,40,1)',
                    color: !chartPosition ? CYAN : 'rgba(160,160,160,1)',
                    border: `1px solid ${!chartPosition ? `${CYAN}40` : 'transparent'}`,
                  }}>All</button>
                {positions.map(pos => (
                  <button key={pos.id} onClick={() => setChartPosition(pos)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors font-mono"
                    style={{
                      background: chartPosition?.id === pos.id ? `${CYAN}20` : 'rgba(40,40,40,1)',
                      color: chartPosition?.id === pos.id ? CYAN : 'rgba(160,160,160,1)',
                      border: `1px solid ${chartPosition?.id === pos.id ? `${CYAN}40` : 'transparent'}`,
                    }}>{pos.tokenA.symbol}/{pos.tokenB.symbol}</button>
                ))}
              </div>
              <PerformanceChart positions={positions} selectedPos={chartPosition} />
            </Section>
          )}

          {/* ============ 4. Fee Collection History ============ */}
          {isConnected && (
            <Section index={3} title="Fee Collection History" subtitle="Weekly breakdown of collected trading fees">
              <FeeHistory positions={positions} />
              <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                className="w-full mt-4 py-3 rounded-xl font-medium text-sm transition-all"
                style={{ background: `linear-gradient(135deg, ${CYAN}20, ${CYAN}10)`, color: CYAN, border: `1px solid ${CYAN}30` }}>
                Collect All Unclaimed Fees ({fmt(totals.fees * 0.15)})
              </motion.button>
            </Section>
          )}

          {/* ============ 5. Pool Health Indicators ============ */}
          {isConnected && (
            <Section index={4} title="Pool Health" subtitle="Utilization, volume, and activity metrics for your pools">
              <PoolHealth positions={positions} />
            </Section>
          )}

          {/* ============ 6. Impermanent Loss Calculator ============ */}
          <Section index={5} title="IL Calculator" subtitle="Estimate impermanent loss for any price change scenario">
            <ILCalculator />
          </Section>

          {/* ============ Footer ============ */}
          <motion.div custom={6} variants={sectionVariants} initial="hidden" animate="visible" className="text-center pb-8">
            <p className="text-xs text-black-500">
              APR and fee estimates are based on trailing 7-day averages. Impermanent loss depends on price divergence.
            </p>
            <div className="flex items-center justify-center gap-2 mt-2 text-xs text-black-600">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Protected by VibeSwap IL insurance and circuit breakers</span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ============ Range Selector Modal ============ */}
      <AnimatePresence>
        {showRangeSelector && (
          <RangeSelectorModal
            position={selectedPosition}
            onClose={() => { setShowRangeSelector(false); setSelectedPosition(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
