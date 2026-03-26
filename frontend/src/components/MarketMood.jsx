import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const PURPLE = '#a855f7'

const ease = [0.25, 0.1, 0.25, 1]

// ============ Mood Definitions ============
const MOODS = [
  { name: 'Extreme Fear', color: RED, range: [0, 20] },
  { name: 'Fear', color: '#f97316', range: [20, 40] },
  { name: 'Neutral', color: AMBER, range: [40, 60] },
  { name: 'Greed', color: '#22c55e', range: [60, 80] },
  { name: 'Extreme Greed', color: GREEN, range: [80, 100] },
]

const getMood = (index) => MOODS.find(m => index >= m.range[0] && index < m.range[1]) || MOODS[4]
const getMoodColor = (index) => {
  if (index <= 20) return RED
  if (index <= 40) return '#f97316'
  if (index <= 60) return AMBER
  if (index <= 80) return '#22c55e'
  return GREEN
}

// ============ Fear/Greed Gauge SVG ============
function FearGreedGauge({ value }) {
  const clamped = Math.min(Math.max(value, 0), 100)
  const pct = clamped / 100
  const startAngle = -210
  const endAngle = 30
  const range = endAngle - startAngle
  const angle = startAngle + range * pct
  const toRad = (d) => (d * Math.PI) / 180
  const cx = 100, cy = 90, r = 70

  const arcEnd = (a) => ({
    x: cx + r * Math.cos(toRad(a)),
    y: cy + r * Math.sin(toRad(a)),
  })

  const zoneArc = (from, to, color, opacity = 0.2) => {
    const s = arcEnd(startAngle + range * from)
    const e = arcEnd(startAngle + range * to)
    const large = range * (to - from) > 180 ? 1 : 0
    return (
      <path
        d={`M${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y}`}
        stroke={color}
        strokeWidth="8"
        fill="none"
        opacity={opacity}
        strokeLinecap="round"
      />
    )
  }

  // Active arc (filled portion)
  const activeArc = () => {
    if (pct <= 0) return null
    const s = arcEnd(startAngle)
    const e = arcEnd(angle)
    const large = range * pct > 180 ? 1 : 0
    const color = getMoodColor(clamped)
    return (
      <path
        d={`M${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y}`}
        stroke={color}
        strokeWidth="8"
        fill="none"
        opacity={0.7}
        strokeLinecap="round"
        filter="url(#mood-glow)"
      />
    )
  }

  const needle = arcEnd(angle)
  const color = getMoodColor(clamped)
  const mood = getMood(clamped)

  return (
    <svg viewBox="0 0 200 130" className="w-full max-w-[280px] mx-auto">
      <defs>
        <filter id="mood-glow">
          <feGaussianBlur stdDeviation="3" result="g" />
          <feMerge>
            <feMergeNode in="g" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="mood-glow-lg">
          <feGaussianBlur stdDeviation="5" result="g" />
          <feMerge>
            <feMergeNode in="g" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background zone arcs */}
      {zoneArc(0, 0.2, RED, 0.12)}
      {zoneArc(0.2, 0.4, '#f97316', 0.12)}
      {zoneArc(0.4, 0.6, AMBER, 0.12)}
      {zoneArc(0.6, 0.8, '#22c55e', 0.12)}
      {zoneArc(0.8, 1.0, GREEN, 0.12)}

      {/* Active arc */}
      {activeArc()}

      {/* Needle dot */}
      <circle cx={needle.x} cy={needle.y} r="5" fill={color} filter="url(#mood-glow-lg)" />
      <circle cx={needle.x} cy={needle.y} r="3" fill="white" />

      {/* Center text */}
      <text x={cx} y={cy - 8} textAnchor="middle" fill={color} fontSize="28" fontFamily="monospace" fontWeight="bold" filter="url(#mood-glow)">
        {Math.round(clamped)}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">
        {mood.name.toUpperCase()}
      </text>

      {/* Scale labels */}
      <text x="18" y="102" fill={RED} fontSize="7" fontFamily="monospace" opacity="0.5">0</text>
      <text x={cx} y="120" fill={AMBER} fontSize="7" fontFamily="monospace" opacity="0.5" textAnchor="middle">50</text>
      <text x="178" y="102" fill={GREEN} fontSize="7" fontFamily="monospace" opacity="0.5">100</text>

      {/* Label at bottom */}
      <text x="30" y="112" fill={RED} fontSize="6" fontFamily="monospace" opacity="0.4">FEAR</text>
      <text x="155" y="112" fill={GREEN} fontSize="6" fontFamily="monospace" opacity="0.4">GREED</text>
    </svg>
  )
}

// ============ Signal Indicator ============
function SignalDot({ active, color = GREEN }) {
  return (
    <div className="relative flex items-center gap-1.5">
      {active && (
        <motion.div
          className="absolute w-2 h-2 rounded-full"
          style={{ background: color }}
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
      <div className="w-2 h-2 rounded-full" style={{ background: active ? color : '#333' }} />
      <span className="text-[10px] font-mono text-gray-500">{active ? 'Live' : 'Offline'}</span>
    </div>
  )
}

// ============ Metric Row ============
function MetricRow({ label, value, change, color }) {
  const isPositive = change > 0
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono font-bold" style={{ color }}>{value}</span>
        {change != null && (
          <span
            className="text-[10px] font-mono flex items-center gap-0.5"
            style={{ color: isPositive ? GREEN : RED }}
          >
            <svg
              width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
              style={{ transform: isPositive ? 'none' : 'rotate(180deg)' }}
            >
              <path d="M4 1L7 5H1L4 1Z" />
            </svg>
            {isPositive ? '+' : ''}{change}
          </span>
        )}
      </div>
    </div>
  )
}

// ============ Main Page ============
function MarketMood() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [moodIndex, setMoodIndex] = useState(65)
  const [history, setHistory] = useState([65])

  // Simulate mood fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setMoodIndex(prev => {
        const change = (Math.random() - 0.5) * 8
        const next = Math.max(0, Math.min(100, prev + change))
        setHistory(h => [...h.slice(-29), next])
        return next
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const mood = getMood(moodIndex)
  const color = getMoodColor(moodIndex)
  const yesterday = 58
  const weekAvg = 62

  // Mini sparkline from history
  const sparkline = useMemo(() => {
    if (history.length < 2) return ''
    const min = Math.min(...history)
    const max = Math.max(...history) || 1
    const range = max - min || 1
    const w = 200
    const h = 30
    const points = history.map((v, i) => {
      const x = (i / (history.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x},${y}`
    })
    return `M${points.join(' L')}`
  }, [history])

  // Sentiment factors (mock)
  const factors = [
    { label: 'BTC Dominance', value: '52.3%', change: 1.2, color: AMBER },
    { label: 'Volatility (30d)', value: '24.1%', change: -3.8, color: CYAN },
    { label: 'Volume (24h)', value: '$42.8B', change: 12.5, color: GREEN },
    { label: 'Social Mentions', value: '18.4K', change: 8.2, color: PURPLE },
    { label: 'Whale Txns', value: '127', change: -5, color: RED },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold" style={{ color: CYAN }}>
            <span style={{ color: CYAN }}>_</span>Market Mood
          </h1>
          <div className="flex items-center gap-3">
            <SignalDot active={true} color={color} />
            {isConnected && (
              <span className="text-xs px-2 py-1 rounded-full font-mono" style={{ background: `${GREEN}15`, color: GREEN, border: `1px solid ${GREEN}30` }}>
                Connected
              </span>
            )}
          </div>
        </div>
        <p className="text-gray-400 text-sm mb-6">
          Aggregate sentiment index -- real-time fear and greed measurement
        </p>
      </motion.div>

      {/* Main Gauge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <GlassCard className="p-6 mb-6" glowColor={moodIndex >= 60 ? 'matrix' : moodIndex <= 40 ? 'warning' : 'none'}>
          {/* Animated background glow */}
          <motion.div
            animate={{
              background: [
                `radial-gradient(circle at center, ${color}08 0%, transparent 70%)`,
                `radial-gradient(circle at center, ${color}15 0%, transparent 70%)`,
                `radial-gradient(circle at center, ${color}08 0%, transparent 70%)`,
              ]
            }}
            transition={{ duration: 3, repeat: Infinity }}
            className="absolute inset-0 rounded-2xl pointer-events-none"
          />

          <div className="relative">
            <FearGreedGauge value={moodIndex} />
          </div>

          {/* Sparkline */}
          {history.length > 2 && (
            <div className="mt-4 px-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-gray-600">RECENT TREND</span>
                <span className="text-[10px] font-mono text-gray-600">{history.length} samples</span>
              </div>
              <svg viewBox="0 0 200 30" className="w-full" style={{ height: 30 }}>
                <path d={sparkline} fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />
              </svg>
            </div>
          )}

          {/* Quick Stats */}
          <div className="flex items-center justify-around mt-4 pt-4 border-t border-white/5">
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase mb-1">Yesterday</div>
              <div className="text-sm font-mono font-bold" style={{ color: getMoodColor(yesterday) }}>{yesterday}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase mb-1">Week Avg</div>
              <div className="text-sm font-mono font-bold" style={{ color: getMoodColor(weekAvg) }}>{weekAvg}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-500 uppercase mb-1">Change</div>
              <div className="text-sm font-mono font-bold" style={{ color: moodIndex > weekAvg ? GREEN : RED }}>
                {moodIndex > weekAvg ? '+' : ''}{Math.round(moodIndex - weekAvg)}
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Mood Scale */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 / PHI }}
      >
        <GlassCard className="p-4 mb-6">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-mono mb-3">
            <span style={{ color: CYAN }}>_</span>Mood Scale
          </div>
          <div className="flex gap-1">
            {MOODS.map((m, i) => {
              const isActive = moodIndex >= m.range[0] && moodIndex < (m.range[1] === 100 ? 101 : m.range[1])
              return (
                <div
                  key={i}
                  className="flex-1 relative"
                >
                  <div
                    className="h-2 rounded-full"
                    style={{
                      background: m.color,
                      opacity: isActive ? 0.8 : 0.15,
                      boxShadow: isActive ? `0 0 12px ${m.color}40` : 'none',
                    }}
                  />
                  <div className="text-[8px] text-gray-500 mt-1 text-center font-mono">{m.name}</div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </motion.div>

      {/* Sentiment Factors */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 / PHI }}
      >
        <GlassCard className="p-4 mb-6">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-mono mb-3">
            <span style={{ color: CYAN }}>_</span>Sentiment Factors
          </div>
          {isConnected ? (
            <div>
              {factors.map((f, i) => (
                <MetricRow key={i} {...f} />
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-gray-500 mb-1">Sign in to view detailed sentiment factors</p>
              <p className="text-[10px] text-gray-600">BTC dominance, volatility, volume, social signals, whale activity</p>
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* Trading Signal */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 / PHI }}
      >
        <GlassCard className="p-4 mb-6" glowColor={moodIndex <= 25 ? 'matrix' : moodIndex >= 75 ? 'warning' : 'none'}>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-mono mb-2">
            <span style={{ color: CYAN }}>_</span>Signal
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold font-mono text-sm"
              style={{
                background: `${moodIndex <= 25 ? GREEN : moodIndex >= 75 ? RED : AMBER}15`,
                color: moodIndex <= 25 ? GREEN : moodIndex >= 75 ? RED : AMBER,
                border: `1px solid ${moodIndex <= 25 ? GREEN : moodIndex >= 75 ? RED : AMBER}30`,
              }}
            >
              {moodIndex <= 25 ? 'B' : moodIndex >= 75 ? 'S' : 'H'}
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: moodIndex <= 25 ? GREEN : moodIndex >= 75 ? RED : AMBER }}>
                {moodIndex <= 25 ? 'Accumulate Zone' : moodIndex >= 75 ? 'Caution Zone' : 'Hold / Neutral'}
              </div>
              <p className="text-[10px] text-gray-500">
                {moodIndex <= 25
                  ? '"Be greedy when others are fearful" -- historically the best buy window.'
                  : moodIndex >= 75
                    ? 'Euphoria often precedes corrections. Consider taking profits or hedging.'
                    : 'Market is balanced. No strong directional signal. Stick to your plan.'}
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Methodology */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <GlassCard className="p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wider font-mono mb-2">
            <span style={{ color: CYAN }}>_</span>Methodology
          </div>
          <p className="text-xs text-gray-500 leading-relaxed mb-2">
            The Market Mood index aggregates six weighted signals into a 0-100 composite score:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { name: 'Volatility', weight: '25%' },
              { name: 'Volume', weight: '25%' },
              { name: 'Social Sentiment', weight: '15%' },
              { name: 'BTC Dominance', weight: '15%' },
              { name: 'Whale Activity', weight: '10%' },
              { name: 'Momentum', weight: '10%' },
            ].map((m, i) => (
              <div key={i} className="flex items-center justify-between bg-white/[0.02] rounded px-2 py-1.5">
                <span className="text-[10px] text-gray-400">{m.name}</span>
                <span className="text-[10px] font-mono" style={{ color: CYAN }}>{m.weight}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* Footer */}
      <div className="mt-8 text-center text-[10px] text-gray-600 font-mono">
        Powered by VibeSwap Oracle -- Kalman filter price discovery with on-chain validation
      </div>
    </div>
  )
}

export default MarketMood
