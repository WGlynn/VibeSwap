import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}
const rowV = {
  hidden: { opacity: 0, x: -12 },
  visible: (i) => ({ opacity: 1, x: 0, transition: { duration: 0.35, delay: 0.05 * i, ease } }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Kalman Simulation ============

function simulateKalmanFilter(seed = 42, steps = 80) {
  const rng = seededRandom(seed)
  const observations = [], filtered = [], upperBand = [], lowerBand = []
  let price = 2000, estimate = 2000, P = 10
  const Q = 0.5, R = 50
  for (let i = 0; i < steps; i++) {
    price += (rng() - 0.48) * 15
    const z = price + (rng() - 0.5) * R * 2
    observations.push(z)
    const Pp = P + Q
    const K = Pp / (Pp + R)
    estimate = estimate + K * (z - estimate)
    P = (1 - K) * Pp
    filtered.push(estimate)
    const u = Math.sqrt(P) * 1.96
    upperBand.push(estimate + u)
    lowerBand.push(estimate - u)
  }
  return { observations, filtered, upperBand, lowerBand }
}

function simulateTWAPvsSpot(seed = 77, steps = 60) {
  const rng = seededRandom(seed)
  const spot = [], twap = []
  let price = 2400, tw = 2400
  for (let i = 0; i < steps; i++) {
    price += (rng() - 0.47) * 18
    spot.push(price)
    tw = tw * 0.92 + price * 0.08
    twap.push(tw)
  }
  return { spot, twap }
}

// ============ Mock Data ============

const PRICE_FEEDS = (() => {
  const rng = seededRandom(999)
  const tokens = [
    { pair: 'ETH/USDC', base: 2847.32, seed: 101 },
    { pair: 'BTC/USDC', base: 67423.50, seed: 202 },
    { pair: 'ARB/USDC', base: 1.1247, seed: 303 },
    { pair: 'OP/USDC', base: 2.3891, seed: 404 },
    { pair: 'MATIC/USDC', base: 0.7823, seed: 505 },
    { pair: 'LINK/USDC', base: 14.52, seed: 606 },
    { pair: 'CKB/USDC', base: 0.00842, seed: 707 },
    { pair: 'AVAX/USDC', base: 35.67, seed: 808 },
  ]
  return tokens.map((t) => {
    const dev = (rng() - 0.5) * 0.06
    const twapDev = dev + (rng() - 0.5) * 0.02
    const conf = +(95 + rng() * 4.9).toFixed(1)
    const sources = Math.floor(3 + rng() * 4)
    const lastSec = Math.floor(1 + rng() * 8)
    const status = Math.abs(twapDev) > 0.05 ? 'alert' : Math.abs(twapDev) > 0.02 ? 'warning' : 'healthy'
    return {
      pair: t.pair,
      price: t.base * (1 + dev),
      confidence: conf,
      lastUpdate: `${lastSec}s ago`,
      sources,
      twapDeviation: +(twapDev * 100).toFixed(3),
      status,
      seed: t.seed,
    }
  })
})()

const ORACLE_SOURCES = [
  { name: 'Chainlink', weight: 0.35, reliability: 99.7, latency: '~60s', feeds: 48, status: 'active' },
  { name: 'Pyth Network', weight: 0.25, reliability: 99.3, latency: '~400ms', feeds: 36, status: 'active' },
  { name: 'Band Protocol', weight: 0.15, reliability: 98.8, latency: '~3s', feeds: 24, status: 'active' },
  { name: 'Uniswap TWAP', weight: 0.15, reliability: 99.1, latency: '~12s', feeds: 20, status: 'active' },
  { name: 'VibeSwap Custom', weight: 0.10, reliability: 99.9, latency: '~1s', feeds: 12, status: 'active' },
]

const CIRCUIT_BREAKERS = (() => {
  const rng = seededRandom(555)
  return PRICE_FEEDS.map((f) => {
    const dev = Math.abs(f.twapDeviation)
    const triggered = dev > 4.5
    const cooldown = triggered ? Math.floor(rng() * 180 + 30) : 0
    return {
      pair: f.pair,
      deviation: f.twapDeviation,
      threshold: 5.0,
      triggered,
      cooldown,
      lastTriggered: triggered ? `${Math.floor(rng() * 24)}h ago` : 'Never',
    }
  })
})()

// ============ SVG Chart Helpers ============

function chartScale(data, w, h, pad) {
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1
  const toX = (i) => pad + (i / (data.length - 1)) * (w - pad * 2)
  const toY = (v) => pad + (1 - (v - min) / range) * (h - pad * 2)
  return { min, max, range, toX, toY }
}

function toPath(vals, toX, toY) {
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(v)}`).join(' ')
}

function GridLines({ pad, w, h }) {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => (
    <line key={f} x1={pad} y1={pad + f * (h - pad * 2)} x2={w - pad} y2={pad + f * (h - pad * 2)}
      stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />
  ))
}

// ============ Kalman Visualization ============

function KalmanVisualization({ data }) {
  const W = 720, H = 280, P = 40
  const all = [...data.observations, ...data.filtered, ...data.upperBand, ...data.lowerBand]
  const { toX, toY, min, max, range } = chartScale(all, W, H, P)
  const filteredPath = toPath(data.filtered, toX, toY)
  const band = [
    ...data.upperBand.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(v)}`),
    ...[...data.lowerBand].reverse().map((v, i) => `L${toX(data.lowerBand.length - 1 - i)},${toY(v)}`),
    'Z',
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: H }}>
      <GridLines pad={P} w={W} h={H} />
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={P - 6} y={P + f * (H - P * 2) + 4} textAnchor="end"
          fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">{(max - f * range).toFixed(0)}</text>
      ))}
      <path d={band} fill={CYAN} fillOpacity={0.08} />
      {data.observations.map((v, i) => (
        <circle key={i} cx={toX(i)} cy={toY(v)} r={2} fill="rgba(239,68,68,0.5)" />
      ))}
      <path d={filteredPath} fill="none" stroke={CYAN} strokeWidth={2} strokeLinecap="round" />
      <circle cx={P + 10} cy={H - 12} r={3} fill="rgba(239,68,68,0.6)" />
      <text x={P + 18} y={H - 8} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">Noisy observations</text>
      <line x1={P + 145} y1={H - 12} x2={P + 165} y2={H - 12} stroke={CYAN} strokeWidth={2} />
      <text x={P + 172} y={H - 8} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">Kalman filtered</text>
      <rect x={P + 290} y={H - 17} width={16} height={10} fill={CYAN} fillOpacity={0.15} rx={2} />
      <text x={P + 312} y={H - 8} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">95% confidence</text>
    </svg>
  )
}

// ============ TWAP vs Spot Chart ============

function TWAPvsSpotChart({ data }) {
  const W = 720, H = 240, P = 40
  const all = [...data.spot, ...data.twap]
  const { toX, toY, min, max, range } = chartScale(all, W, H, P)
  const spotPath = toPath(data.spot, toX, toY)
  const twapPath = toPath(data.twap, toX, toY)

  const thresholdRegions = []
  for (let i = 0; i < data.spot.length; i++) {
    const pctDev = Math.abs((data.spot[i] - data.twap[i]) / data.twap[i]) * 100
    if (pctDev > 5) {
      thresholdRegions.push(i)
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: H }}>
      <GridLines pad={P} w={W} h={H} />
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={P - 6} y={P + f * (H - P * 2) + 4} textAnchor="end"
          fill="rgba(255,255,255,0.3)" fontSize={9} fontFamily="monospace">{(max - f * range).toFixed(0)}</text>
      ))}
      {thresholdRegions.map((idx) => (
        <rect key={idx} x={toX(idx) - 3} y={P} width={6} height={H - P * 2}
          fill="rgba(239,68,68,0.08)" />
      ))}
      <path d={spotPath} fill="none" stroke="rgba(239,68,68,0.7)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={twapPath} fill="none" stroke={CYAN} strokeWidth={2} strokeLinecap="round" />
      <line x1={P + 10} y1={H - 10} x2={P + 30} y2={H - 10} stroke="rgba(239,68,68,0.7)" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={P + 36} y={H - 6} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">Spot price</text>
      <line x1={P + 130} y1={H - 10} x2={P + 150} y2={H - 10} stroke={CYAN} strokeWidth={2} />
      <text x={P + 156} y={H - 6} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">TWAP</text>
      <rect x={P + 220} y={H - 15} width={12} height={8} fill="rgba(239,68,68,0.12)" rx={1} />
      <text x={P + 238} y={H - 6} fill="rgba(255,255,255,0.5)" fontSize={9} fontFamily="monospace">&gt;5% deviation zone</text>
    </svg>
  )
}

// ============ Status Helpers ============

function StatusDot({ status }) {
  const colors = {
    healthy: 'bg-green-400',
    warning: 'bg-amber-400',
    alert: 'bg-red-400',
  }
  const labels = {
    healthy: 'Healthy',
    warning: 'Warning',
    alert: 'Alert',
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${colors[status]} ${status === 'alert' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-mono ${
        status === 'healthy' ? 'text-green-400' : status === 'warning' ? 'text-amber-400' : 'text-red-400'
      }`}>{labels[status]}</span>
    </div>
  )
}

function DeviationBadge({ value }) {
  const abs = Math.abs(value)
  const color = abs < 1 ? 'text-green-400' : abs < 3 ? 'text-amber-400' : 'text-red-400'
  return (
    <span className={`font-mono text-xs ${color}`}>
      {value >= 0 ? '+' : ''}{value.toFixed(3)}%
    </span>
  )
}

// ============ Reliability Bar ============

function ReliabilityBar({ value }) {
  const pct = Math.min(value, 100)
  const color = pct >= 99.5 ? '#22c55e' : pct >= 99 ? '#06b6d4' : pct >= 98 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-black-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{value}%</span>
    </div>
  )
}

// ============ Main Component ============

export default function OraclePage() {
  const [tick, setTick] = useState(0)
  const kalmanData = useMemo(() => simulateKalmanFilter(42, 80), [])
  const twapData = useMemo(() => simulateTWAPvsSpot(77, 60), [])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  const activeFeedsCount = useMemo(() => PRICE_FEEDS.length + 4, [])
  const healthyCount = useMemo(() => CIRCUIT_BREAKERS.filter((c) => !c.triggered).length, [])

  return (
    <div className="min-h-screen pb-24">
      {/* 1. Hero */}
      <PageHero
        category="system"
        title="Oracle Network"
        subtitle="Kalman filter price discovery with TWAP validation"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* 2. Stats Row */}
        <motion.div className="grid grid-cols-2 lg:grid-cols-4 gap-3" variants={sectionV} custom={0} initial="hidden" animate="visible">
          <StatCard label="Active Feeds" value={12} suffix=" feeds" decimals={0} sparkSeed={2001} change={8.3} />
          <StatCard label="Update Frequency" value={2} suffix="s" decimals={0} sparkSeed={2002} />
          <StatCard label="TWAP Window" value={1} suffix="h" decimals={0} sparkSeed={2003} />
          <StatCard label="Max Deviation" value={5} suffix="%" decimals={0} sparkSeed={2004} />
        </motion.div>

        {/* 3. Price Feeds Table */}
        <motion.div variants={sectionV} custom={1} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: CYAN }} />
              Live Price Feeds
              <span className="text-xs font-mono text-black-500 ml-auto">
                Last tick: {tick}
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-black-500 text-xs font-mono border-b border-black-800">
                    {['Pair', 'Price', 'Confidence', 'Last Update', 'Sources', 'TWAP Dev', 'Status', 'Trend'].map((h, i) => (
                      <th key={h} className={`py-2 ${i === 0 ? 'text-left pr-4' : i === 7 ? 'text-right pl-4' : 'text-right px-3'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PRICE_FEEDS.map((feed, i) => (
                    <motion.tr key={feed.pair} variants={rowV} custom={i} initial="hidden" animate="visible"
                      className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                      <td className="py-2.5 pr-4">
                        <span className="font-mono font-bold text-cyan-400">{feed.pair}</span>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono">
                        ${feed.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: feed.price < 1 ? 5 : 2 })}
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono">
                        <span className={feed.confidence >= 99 ? 'text-green-400' : feed.confidence >= 97 ? 'text-amber-400' : 'text-red-400'}>
                          {feed.confidence}%
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-black-500">{feed.lastUpdate}</td>
                      <td className="text-right py-2.5 px-3 font-mono text-black-400">{feed.sources}</td>
                      <td className="text-right py-2.5 px-3"><DeviationBadge value={feed.twapDeviation} /></td>
                      <td className="text-right py-2.5 px-3"><StatusDot status={feed.status} /></td>
                      <td className="text-right py-2.5 pl-4">
                        <Sparkline data={generateSparklineData(feed.seed)} width={48} height={16} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.div>

        {/* 4. Kalman Filter Visualization */}
        <motion.div variants={sectionV} custom={2} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5">
            <h2 className="text-lg font-bold mb-1">Kalman Filter Visualization</h2>
            <p className="text-xs text-black-500 mb-4">
              Noisy market observations (red dots) converge to a reliable filtered estimate (cyan line) within a 95% confidence band.
              The filter adapts its gain in real-time based on measurement uncertainty.
            </p>
            <KalmanVisualization data={kalmanData} />
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Process Noise (Q)', value: '0.50', note: 'Expected volatility' },
                { label: 'Measurement Noise (R)', value: '50.0', note: 'Observation uncertainty' },
                { label: 'Kalman Gain (K)', value: '~0.02', note: 'Adaptive weight' },
                { label: 'Data Points', value: '80', note: 'Observations processed' },
              ].map((item) => (
                <div key={item.label} className="bg-black-900/40 rounded-lg p-3 border border-black-800/40">
                  <div className="text-[10px] text-black-600 font-mono">{item.label}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{item.value}</div>
                  <div className="text-[10px] text-black-600">{item.note}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* 5. TWAP vs Spot Chart */}
        <motion.div variants={sectionV} custom={3} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5">
            <h2 className="text-lg font-bold mb-1">TWAP vs Spot Price</h2>
            <p className="text-xs text-black-500 mb-4">
              Time-weighted average price (cyan) tracks the spot price (red dashed). When deviation exceeds the{' '}
              <span className="text-red-400 font-mono">5%</span> threshold, the shaded region flags the anomaly
              and the circuit breaker arms for intervention.
            </p>
            <TWAPvsSpotChart data={twapData} />
            <div className="mt-4 p-3 rounded-lg bg-black-900/30 border border-black-800/40">
              <div className="text-xs font-mono text-black-500 mb-2">Validation Pipeline</div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {['Raw Price', 'Kalman Filter', 'TWAP Check', 'Deviation < 5%?'].map((s, i) => (
                  <span key={s}>
                    {i > 0 && <span className="text-black-600 mr-2">-&gt;</span>}
                    <span className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-400">{s}</span>
                  </span>
                ))}
                <span className="text-black-600">-&gt;</span>
                <span className="px-2 py-1 rounded bg-green-500/10 text-green-400">Accept</span>
                <span className="text-black-600">/</span>
                <span className="px-2 py-1 rounded bg-red-500/10 text-red-400">Reject + Halt</span>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* 6. Oracle Sources */}
        <motion.div variants={sectionV} custom={4} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              Oracle Sources
              <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                {ORACLE_SOURCES.length} active
              </span>
            </h2>
            <p className="text-xs text-black-500 mb-4">
              Aggregated price feeds from multiple sources, weighted by reliability and recency.
              The Kalman filter fuses these inputs into a single optimal estimate.
            </p>
            <div className="space-y-3">
              {ORACLE_SOURCES.map((src, i) => (
                <motion.div key={src.name} variants={rowV} custom={i} initial="hidden" animate="visible"
                  className="bg-black-900/40 rounded-xl p-4 border border-black-800/50 hover:border-black-700/60 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-sm font-mono font-bold">{src.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-black-500">Weight:</span>
                      <span style={{ color: CYAN }} className="font-bold">{(src.weight * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                    <div>
                      <span className="text-black-600 block mb-1">Reliability</span>
                      <ReliabilityBar value={src.reliability} />
                    </div>
                    <div>
                      <span className="text-black-600 block mb-1">Latency</span>
                      <span className="text-black-300">{src.latency}</span>
                    </div>
                    <div>
                      <span className="text-black-600 block mb-1">Active Feeds</span>
                      <span className="text-black-300">{src.feeds}</span>
                    </div>
                    <div>
                      <span className="text-black-600 block mb-1">Status</span>
                      <span className="text-green-400">Active</span>
                    </div>
                  </div>
                  <div className="mt-3 h-1 bg-black-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${src.weight * 100}%`,
                      background: `linear-gradient(90deg, ${CYAN}, ${CYAN}66)`,
                    }} />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 bg-black-900/30 rounded-lg p-3 border border-black-800/40">
              <div className="text-xs font-mono text-black-500 mb-2">Weight Distribution</div>
              <div className="flex gap-1 h-3 rounded-full overflow-hidden">
                {ORACLE_SOURCES.map((src, i) => {
                  const colors = [CYAN, '#7c3aed', '#f59e0b', '#22c55e', '#ec4899']
                  return (
                    <div key={src.name} className="h-full rounded-sm transition-all" title={`${src.name}: ${(src.weight * 100).toFixed(0)}%`}
                      style={{ width: `${src.weight * 100}%`, backgroundColor: colors[i] }} />
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {ORACLE_SOURCES.map((src, i) => {
                  const colors = [CYAN, '#7c3aed', '#f59e0b', '#22c55e', '#ec4899']
                  return (
                    <div key={src.name} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[i] }} />
                      <span className="text-[10px] font-mono text-black-500">{src.name} ({(src.weight * 100).toFixed(0)}%)</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* 7. Circuit Breaker Status */}
        <motion.div variants={sectionV} custom={5} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-5">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              Circuit Breaker Status
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                healthyCount === CIRCUIT_BREAKERS.length
                  ? 'text-green-400 bg-green-500/10'
                  : 'text-amber-400 bg-amber-500/10'
              }`}>
                {healthyCount}/{CIRCUIT_BREAKERS.length} healthy
              </span>
            </h2>
            <p className="text-xs text-black-500 mb-4">
              When oracle deviation exceeds <span className="text-red-400 font-mono">5%</span> from TWAP,
              trading is automatically halted for that pair. The breaker cools down before re-enabling.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CIRCUIT_BREAKERS.map((cb, i) => (
                <motion.div key={cb.pair} variants={rowV} custom={i} initial="hidden" animate="visible"
                  className={`rounded-xl p-4 border transition-colors ${
                    cb.triggered
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-black-900/40 border-black-800/50'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm">{cb.pair}</span>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                      cb.triggered
                        ? 'text-red-400 bg-red-500/10 border border-red-500/20'
                        : 'text-green-400 bg-green-500/10 border border-green-500/20'
                    }`}>
                      {cb.triggered ? 'TRIPPED' : 'Armed'}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-black-500">Deviation</span>
                      <DeviationBadge value={cb.deviation} />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-black-500">Threshold</span>
                      <span className="text-black-400">{cb.threshold.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-black-500">Last Triggered</span>
                      <span className={cb.triggered ? 'text-red-400' : 'text-black-600'}>{cb.lastTriggered}</span>
                    </div>
                    {cb.triggered && (
                      <div className="flex justify-between">
                        <span className="text-black-500">Cooldown</span>
                        <span className="text-amber-400">{cb.cooldown}s remaining</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 h-1.5 bg-black-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min((Math.abs(cb.deviation) / cb.threshold) * 100, 100)}%`,
                      backgroundColor: Math.abs(cb.deviation) < cb.threshold * 0.5 ? '#22c55e'
                        : Math.abs(cb.deviation) < cb.threshold * 0.8 ? '#f59e0b' : '#ef4444',
                    }} />
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-black-900/30 border border-black-800/40">
              <div className="text-xs font-mono text-black-500 mb-2">Circuit Breaker Flow</div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {['Oracle Update', 'TWAP Diff > 5%?'].map((s, i) => (
                  <span key={s}>
                    {i > 0 && <span className="text-black-600 mr-2">-&gt;</span>}
                    <span className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-400">{s}</span>
                  </span>
                ))}
                <span className="text-black-600">-&gt;</span>
                <span className="px-2 py-1 rounded bg-red-500/10 text-red-400">Halt Trading</span>
                <span className="text-black-600">-&gt;</span>
                <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400">Cooldown</span>
                <span className="text-black-600">-&gt;</span>
                <span className="px-2 py-1 rounded bg-green-500/10 text-green-400">Re-validate &amp; Resume</span>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}
