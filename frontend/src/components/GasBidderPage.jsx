import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const PURPLE = '#a855f7'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

const rng = seededRandom(31415)

// ============ Mock Data Generation ============

function generateBidHistory(count) {
  const r = seededRandom(27182)
  const outcomes = ['filled', 'filled', 'filled', 'partial', 'filled', 'missed', 'filled', 'filled']
  return Array.from({ length: count }, (_, i) => ({
    batchId: 14200 - i,
    bidAmount: (0.5 + r() * 4.5).toFixed(2),
    priority: 1 + Math.floor(r() * Math.min(8 + Math.floor(r() * 24), 10)),
    totalBids: 8 + Math.floor(r() * 24),
    outcome: outcomes[i % outcomes.length],
    timestamp: new Date(Date.now() - i * 10000).toISOString().slice(11, 19),
  }))
}

function generateEpochStats() {
  const r = seededRandom(16180)
  return { avgWinningBid: (1.2 + r() * 2.3).toFixed(2), totalBids: 4827 + Math.floor(r() * 1200),
    revenueGenerated: (34200 + r() * 12000).toFixed(0), mevCaptured: (92.4 + r() * 5.1).toFixed(1),
    mevLeaked: (2.1 + r() * 3.2).toFixed(1), medianBid: (0.8 + r() * 1.5).toFixed(2),
    maxBid: (8.5 + r() * 6.0).toFixed(2), activeBidders: 142 + Math.floor(r() * 80) }
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, glowColor, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor={glowColor || 'terminal'} spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>
          )}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Current Batch Display ============

function CurrentBatch() {
  const phases = ['commit', 'reveal', 'settle']
  const phaseColors = { commit: '#3b82f6', reveal: PURPLE, settle: '#22c55e' }
  const phaseLabels = { commit: 'COMMIT', reveal: 'REVEAL', settle: 'SETTLE' }
  const r = seededRandom(55555)
  const batchId = 14201, currentPhase = 'commit', timeRemaining = 6
  const orderCount = 14 + Math.floor(r() * 8), totalVolume = (42000 + r() * 28000).toFixed(0)
  const totalBidsInBatch = 5 + Math.floor(r() * 7), highestBid = (3.2 + r() * 2.1).toFixed(2)
  const phaseCol = phaseColors[currentPhase]
  const totalTime = currentPhase === 'commit' ? 8 : 2
  const progress = ((totalTime - timeRemaining) / totalTime) * 100

  return (
    <div>
      {/* Batch Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
            style={{ background: `${phaseCol}15`, border: `1px solid ${phaseCol}35`, color: phaseCol }}
          >
            #
          </div>
          <div>
            <p className="text-sm font-mono font-bold text-white">Batch #{batchId}</p>
            <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Current auction cycle</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
          style={{ background: `${phaseCol}10`, border: `1px solid ${phaseCol}30`, color: phaseCol }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: phaseCol }} />
          {phaseLabels[currentPhase]}
        </div>
      </div>

      {/* Phase Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          {phases.map((p, i) => {
            const isActive = p === currentPhase
            const isPast = phases.indexOf(currentPhase) > i
            const col = phaseColors[p]
            return (
              <div key={p} className="flex items-center gap-1.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-mono font-bold transition-all"
                  style={{
                    background: isActive || isPast ? `${col}20` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${isActive || isPast ? `${col}50` : 'rgba(255,255,255,0.06)'}`,
                    color: isActive || isPast ? col : 'rgba(255,255,255,0.2)',
                    boxShadow: isActive ? `0 0 8px ${col}30` : 'none',
                  }}
                >
                  {i + 1}
                </div>
                <span className={`text-[9px] font-mono uppercase tracking-wider ${isActive ? 'font-bold' : ''}`}
                  style={{ color: isActive ? col : 'rgba(255,255,255,0.3)' }}>
                  {phaseLabels[p]}
                </span>
                {i < 2 && <div className="w-6 sm:w-12 h-px mx-1" style={{ background: isPast ? `${col}40` : 'rgba(255,255,255,0.06)' }} />}
              </div>
            )
          })}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ background: `linear-gradient(90deg, ${phaseCol}80, ${phaseCol})` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] font-mono text-black-500">0s</span>
          <span className="text-[10px] font-mono font-bold" style={{ color: phaseCol }}>{timeRemaining}s remaining</span>
          <span className="text-[9px] font-mono text-black-500">{totalTime}s</span>
        </div>
      </div>

      {/* Batch Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Orders', value: orderCount, icon: '~', color: '#3b82f6' },
          { label: 'Volume', value: `$${Number(totalVolume).toLocaleString()}`, icon: '$', color: '#22c55e' },
          { label: 'Priority Bids', value: totalBidsInBatch, icon: '#', color: PURPLE },
          { label: 'Highest Bid', value: `${highestBid} JUL`, icon: '^', color: '#f59e0b' },
        ].map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.3 }}
            className="rounded-lg p-3 text-center"
            style={{ background: `${metric.color}06`, border: `1px solid ${metric.color}15` }}
          >
            <div className="w-6 h-6 rounded-md mx-auto mb-1.5 flex items-center justify-center text-[10px] font-mono font-bold"
              style={{ background: `${metric.color}12`, color: metric.color }}>
              {metric.icon}
            </div>
            <p className="text-sm font-mono font-bold" style={{ color: metric.color }}>{metric.value}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-0.5">{metric.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Bid Placement Form ============

function BidPlacement({ isConnected }) {
  const [bidAmount, setBidAmount] = useState('')
  const [showAnalysis, setShowAnalysis] = useState(false)

  const analysis = useMemo(() => {
    const amount = parseFloat(bidAmount) || 0
    if (amount <= 0) return null

    const r = seededRandom(Math.floor(amount * 1000) + 99)
    const estimatedPosition = Math.max(1, Math.ceil(12 - amount * 2.2 + r() * 2))
    const totalBidders = 11 + Math.floor(r() * 6)
    const percentile = Math.max(1, Math.min(99, Math.floor((1 - estimatedPosition / totalBidders) * 100)))
    const expectedSavings = (amount * 0.3 + r() * amount * 0.5).toFixed(2)
    const costPerPosition = (amount / Math.max(1, totalBidders - estimatedPosition + 1)).toFixed(3)
    const breakEvenSlippage = (0.1 + amount * 0.08).toFixed(2)

    return {
      estimatedPosition,
      totalBidders,
      percentile,
      expectedSavings,
      costPerPosition,
      breakEvenSlippage,
      efficiency: percentile > 70 ? 'high' : percentile > 40 ? 'medium' : 'low',
    }
  }, [bidAmount])

  const efficiencyColors = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' }
  const efficiencyLabels = { high: 'Efficient', medium: 'Moderate', low: 'Expensive' }

  return (
    <div>
      {/* Bid Input */}
      <div className="mb-4">
        <label className="text-[9px] font-mono text-black-500 uppercase tracking-wider block mb-2">
          Priority Bid Amount (JUL)
        </label>
        <div className="relative">
          <input
            type="number"
            value={bidAmount}
            onChange={(e) => {
              setBidAmount(e.target.value)
              setShowAnalysis(parseFloat(e.target.value) > 0)
            }}
            placeholder="0.00"
            className="w-full bg-transparent rounded-lg px-4 py-3 font-mono text-lg text-white placeholder-black-600 focus:outline-none transition-all"
            style={{
              border: `1px solid ${bidAmount ? `${PURPLE}40` : 'rgba(255,255,255,0.06)'}`,
              background: bidAmount ? `${PURPLE}05` : 'rgba(0,0,0,0.3)',
            }}
            step="0.1"
            min="0"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-black-500">
            JUL
          </span>
        </div>
        {/* Quick amounts */}
        <div className="flex gap-2 mt-2">
          {[0.5, 1.0, 2.5, 5.0].map((amt) => (
            <button
              key={amt}
              onClick={() => { setBidAmount(String(amt)); setShowAnalysis(true) }}
              className="flex-1 py-1.5 rounded-md text-[10px] font-mono font-bold transition-all hover:scale-[1.02]"
              style={{
                background: bidAmount === String(amt) ? `${PURPLE}15` : 'rgba(0,0,0,0.3)',
                border: `1px solid ${bidAmount === String(amt) ? `${PURPLE}40` : 'rgba(255,255,255,0.06)'}`,
                color: bidAmount === String(amt) ? PURPLE : 'rgba(255,255,255,0.4)',
              }}
            >
              {amt} JUL
            </button>
          ))}
        </div>
      </div>

      {/* Cost-Benefit Analysis */}
      {showAnalysis && analysis && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4 rounded-xl p-4 overflow-hidden"
          style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${PURPLE}20` }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Cost-Benefit Analysis</p>
            <span
              className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full"
              style={{
                background: `${efficiencyColors[analysis.efficiency]}10`,
                border: `1px solid ${efficiencyColors[analysis.efficiency]}30`,
                color: efficiencyColors[analysis.efficiency],
              }}
            >
              {efficiencyLabels[analysis.efficiency]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-2.5" style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}12` }}>
              <p className="text-[9px] font-mono text-black-500 mb-0.5">Est. Priority</p>
              <p className="text-lg font-mono font-bold" style={{ color: PURPLE }}>
                #{analysis.estimatedPosition}
              </p>
              <p className="text-[8px] font-mono text-black-500">of {analysis.totalBidders} bidders</p>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}12` }}>
              <p className="text-[9px] font-mono text-black-500 mb-0.5">Percentile</p>
              <p className="text-lg font-mono font-bold" style={{ color: CYAN }}>
                {analysis.percentile}%
              </p>
              <p className="text-[8px] font-mono text-black-500">priority rank</p>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.12)' }}>
              <p className="text-[9px] font-mono text-black-500 mb-0.5">Expected Savings</p>
              <p className="text-sm font-mono font-bold text-green-400">{analysis.expectedSavings} JUL</p>
              <p className="text-[8px] font-mono text-black-500">vs. no priority</p>
            </div>
            <div className="rounded-lg p-2.5" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)' }}>
              <p className="text-[9px] font-mono text-black-500 mb-0.5">Break-Even</p>
              <p className="text-sm font-mono font-bold text-amber-400">{analysis.breakEvenSlippage}%</p>
              <p className="text-[8px] font-mono text-black-500">slippage threshold</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg p-2.5" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[9px] font-mono text-black-500 mb-1">Cost per position: <span className="text-white">{analysis.costPerPosition} JUL</span></p>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full" style={{
                width: `${analysis.percentile}%`,
                background: `linear-gradient(90deg, ${PURPLE}80, ${efficiencyColors[analysis.efficiency]})`,
              }} />
            </div>
          </div>
        </motion.div>
      )}

      {/* Submit Button */}
      <button
        disabled={!isConnected || !bidAmount || parseFloat(bidAmount) <= 0}
        className="w-full py-3.5 rounded-lg font-mono font-bold text-sm transition-all"
        style={{
          background: isConnected && bidAmount && parseFloat(bidAmount) > 0
            ? `linear-gradient(135deg, ${PURPLE}20, ${CYAN}15)`
            : 'rgba(0,0,0,0.3)',
          border: `1px solid ${isConnected && bidAmount ? `${PURPLE}40` : 'rgba(255,255,255,0.06)'}`,
          color: isConnected && bidAmount && parseFloat(bidAmount) > 0 ? PURPLE : 'rgba(255,255,255,0.2)',
          cursor: isConnected && bidAmount && parseFloat(bidAmount) > 0 ? 'pointer' : 'not-allowed',
        }}
      >
        {!isConnected
          ? 'Connect Wallet to Bid'
          : !bidAmount || parseFloat(bidAmount) <= 0
            ? 'Enter Bid Amount'
            : `Place Priority Bid — ${bidAmount} JUL`}
      </button>

      {!isConnected && (
        <p className="text-[9px] font-mono text-black-500 text-center mt-2 italic">
          Sign in with an external or device wallet to place bids
        </p>
      )}
    </div>
  )
}

// ============ Bid History Table ============

function BidHistory() {
  const history = useMemo(() => generateBidHistory(12), [])
  const [visibleCount, setVisibleCount] = useState(6)

  const outcomeStyles = {
    filled: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' },
    partial: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
    missed: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
  }

  return (
    <div>
      {/* Table Header */}
      <div className="grid grid-cols-[0.7fr_0.8fr_0.6fr_0.6fr_0.6fr] gap-2 px-3 mb-2">
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Batch</span>
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Bid</span>
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider text-center">Priority</span>
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider text-center">Outcome</span>
        <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider text-right">Time</span>
      </div>

      {/* Table Rows */}
      <div className="space-y-1.5">
        {history.slice(0, visibleCount).map((row, i) => {
          const style = outcomeStyles[row.outcome]
          return (
            <motion.div
              key={row.batchId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * (0.04 * PHI), duration: 0.3, ease }}
              className="grid grid-cols-[0.7fr_0.8fr_0.6fr_0.6fr_0.6fr] gap-2 items-center rounded-lg px-3 py-2.5"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              <span className="text-[10px] font-mono text-white font-bold">#{row.batchId}</span>
              <span className="text-[10px] font-mono" style={{ color: PURPLE }}>{row.bidAmount} JUL</span>
              <span className="text-[10px] font-mono text-center" style={{ color: CYAN }}>
                #{row.priority}<span className="text-black-500">/{row.totalBids}</span>
              </span>
              <div className="flex justify-center">
                <span
                  className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                >
                  {row.outcome}
                </span>
              </div>
              <span className="text-[10px] font-mono text-black-500 text-right">{row.timestamp}</span>
            </motion.div>
          )
        })}
      </div>

      {/* Show More */}
      {visibleCount < history.length && (
        <button
          onClick={() => setVisibleCount((c) => Math.min(c + 6, history.length))}
          className="w-full mt-3 py-2 rounded-lg text-[10px] font-mono transition-all"
          style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15`, color: `${CYAN}99` }}
        >
          Show More ({history.length - visibleCount} remaining)
        </button>
      )}

      {/* Summary */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'Total Bids', value: history.length, color: PURPLE },
          { label: 'Fill Rate', value: `${Math.round((history.filter((h) => h.outcome === 'filled').length / history.length) * 100)}%`, color: '#22c55e' },
          { label: 'Avg Priority', value: `#${Math.round(history.reduce((s, h) => s + h.priority, 0) / history.length)}`, color: CYAN },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg p-2 text-center"
            style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}12` }}>
            <p className="text-xs font-mono font-bold" style={{ color: stat.color }}>{stat.value}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Revenue Distribution ============

function RevenueDistribution() {
  const slices = [
    { label: 'Liquidity Providers', pct: 50, color: '#22c55e',
      desc: 'Rewarded for providing the liquidity that enables trades. Proportional to LP share.' },
    { label: 'JUL Stakers', pct: 30, color: PURPLE,
      desc: 'Protocol token stakers earn yield from priority bid revenue. Aligns governance incentives.' },
    { label: 'DAO Treasury', pct: 20, color: CYAN,
      desc: 'Funds protocol development, security audits, grants, and treasury stabilization reserves.' },
  ]
  const totalRevenue = 34200

  const size = 160, strokeWidth = 20, radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let cumulativeOffset = 0

  return (
    <div>
      {/* Donut Chart */}
      <div className="flex flex-col sm:flex-row items-center gap-6 mb-4">
        <div className="relative flex-shrink-0">
          <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
            {slices.map((slice, i) => {
              const dashLength = (slice.pct / 100) * circumference
              const gapLength = circumference - dashLength
              const offset = cumulativeOffset
              cumulativeOffset += dashLength
              return (
                <motion.circle
                  key={slice.label}
                  cx={size / 2} cy={size / 2} r={radius}
                  fill="none" stroke={slice.color} strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${gapLength}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 + i * (0.15 * PHI), duration: 0.5 }}
                />
              )
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-lg font-mono font-bold text-white">${totalRevenue.toLocaleString()}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider">This Epoch</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-3 w-full">
          {slices.map((slice, i) => {
            const amount = ((slice.pct / 100) * totalRevenue).toFixed(0)
            return (
              <motion.div
                key={slice.label}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * (0.1 * PHI), duration: 0.4, ease }}
                className="rounded-lg p-3"
                style={{ background: `${slice.color}06`, border: `1px solid ${slice.color}15` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: slice.color }} />
                    <span className="text-[11px] font-mono font-bold text-white">{slice.label}</span>
                  </div>
                  <span className="text-[11px] font-mono font-bold" style={{ color: slice.color }}>
                    {slice.pct}%
                  </span>
                </div>
                <p className="text-[9px] font-mono text-black-400 leading-relaxed">{slice.desc}</p>
                <p className="text-[10px] font-mono mt-1" style={{ color: slice.color }}>
                  ${Number(amount).toLocaleString()} JUL this epoch
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Revenue Flow */}
      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}12` }}>
        <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1.5">Revenue Flow</p>
        <p className="text-[10px] font-mono text-black-400 leading-relaxed">
          Priority bids are collected during the <span style={{ color: PURPLE }}>reveal phase</span> of each batch auction.
          Revenue is distributed at settlement via the <span style={{ color: '#22c55e' }}>ShapleyDistributor</span> contract,
          ensuring fair attribution based on each party's marginal contribution to protocol value.
        </p>
      </div>
    </div>
  )
}

// ============ Statistics Dashboard ============

function Statistics() {
  const stats = useMemo(() => generateEpochStats(), [])

  const cards = [
    { label: 'Avg Winning Bid', value: `${stats.avgWinningBid} JUL`, color: PURPLE, icon: '~' },
    { label: 'Total Bids', value: stats.totalBids.toLocaleString(), color: '#3b82f6', icon: '#' },
    { label: 'Revenue', value: `$${Number(stats.revenueGenerated).toLocaleString()}`, color: '#22c55e', icon: '$' },
    { label: 'MEV Captured', value: `${stats.mevCaptured}%`, color: CYAN, icon: '%' },
  ]
  const secondaryCards = [
    { label: 'Median Bid', value: `${stats.medianBid} JUL`, color: '#f59e0b' },
    { label: 'Max Bid', value: `${stats.maxBid} JUL`, color: '#ef4444' },
    { label: 'Bidders', value: stats.activeBidders, color: PURPLE },
    { label: 'Leaked', value: `${stats.mevLeaked}%`, color: '#ef4444' },
  ]

  return (
    <div>
      {/* Primary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {cards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * (0.06 * PHI), duration: 0.3 }}
            className="rounded-xl p-3 text-center"
            style={{ background: `${card.color}06`, border: `1px solid ${card.color}15` }}
          >
            <div className="w-7 h-7 rounded-md mx-auto mb-1.5 flex items-center justify-center text-[10px] font-mono font-bold"
              style={{ background: `${card.color}12`, color: card.color }}>
              {card.icon}
            </div>
            <p className="text-sm font-mono font-bold" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-0.5">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {secondaryCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * (0.05 * PHI), duration: 0.3 }}
            className="rounded-lg p-2.5 text-center"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}
          >
            <p className="text-xs font-mono font-bold" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-0.5">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* MEV Capture Visual */}
      <div className="mt-4 rounded-xl p-4" style={{ background: `${CYAN}04`, border: `1px solid ${CYAN}12` }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-black-400">MEV Value Capture</span>
          <span className="text-[10px] font-mono font-bold" style={{ color: CYAN }}>{stats.mevCaptured}% captured</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <motion.div
            className="h-full"
            initial={{ width: 0 }}
            animate={{ width: `${stats.mevCaptured}%` }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            style={{ background: `linear-gradient(90deg, ${CYAN}80, #22c55e)`, borderRadius: '9999px 0 0 9999px' }}
          />
          <motion.div
            className="h-full"
            initial={{ width: 0 }}
            animate={{ width: `${stats.mevLeaked}%` }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
            style={{ background: 'rgba(239,68,68,0.5)' }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ background: CYAN }} />
            <span className="text-[9px] font-mono text-black-500">Captured (to protocol)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} />
            <span className="text-[9px] font-mono text-black-500">Leaked (residual)</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ How It Works ============

function HowItWorks() {
  const steps = [
    { step: 1, title: 'Commit', duration: '8 seconds', color: '#3b82f6', icon: '#',
      description: 'Submit a hashed order commitment. Your trade intent is invisible to everyone including validators and MEV bots.',
      details: ['hash(order || secret) submitted on-chain', 'Deposit locked as anti-spam stake',
        'Flash loan protection: EOA-only', 'Optional: attach a priority bid in JUL'],
      priorityNote: 'Priority bids are encrypted inside the commitment hash. Nobody sees your bid amount until reveal.' },
    { step: 2, title: 'Reveal + Bid', duration: '2 seconds', color: PURPLE, icon: '^',
      description: 'Reveal your order and priority bid. Higher bids earn earlier execution within the batch.',
      details: ['Order + secret revealed, hash verified on-chain', 'Priority bid amount becomes visible',
        'Invalid reveals slashed 50%', 'All secrets XORed to create shuffle seed'],
      priorityNote: 'Priority bidders get execution preference, but ALL orders still receive the same uniform clearing price.' },
    { step: 3, title: 'Settle + Distribute', duration: 'instant', color: '#22c55e', icon: '=',
      description: 'Orders execute at uniform clearing price. Priority bid revenue is distributed to LPs, stakers, and treasury.',
      details: ['Fisher-Yates shuffle determines base order', 'Priority bidders promoted to front of queue',
        'Single clearing price for all orders', 'Revenue split: 50% LP / 30% stakers / 20% treasury'],
      priorityNote: 'MEV value flows to the protocol ecosystem instead of being extracted by validators.' },
  ]

  return (
    <div className="space-y-4">
      {steps.map((step, i) => (
        <motion.div
          key={step.step}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 + i * (0.12 * PHI), duration: 0.5, ease }}
        >
          <div className="rounded-xl p-4" style={{ background: `${step.color}06`, border: `1px solid ${step.color}20` }}>
            <div className="flex items-start gap-3">
              {/* Step Number */}
              <div className="flex-shrink-0">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-xl"
                  style={{ background: `${step.color}15`, border: `1px solid ${step.color}35`, color: step.color }}
                >
                  {step.icon}
                </div>
                {i < 2 && (
                  <div className="w-px h-6 mx-auto mt-2" style={{ background: `${step.color}25` }} />
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-mono font-bold" style={{ color: step.color }}>
                    Step {step.step}: {step.title}
                  </h4>
                  <span className="text-[9px] font-mono text-black-500">{step.duration}</span>
                </div>
                <p className="text-[11px] font-mono text-black-300 leading-relaxed mb-2">{step.description}</p>

                {/* Detail bullets */}
                <div className="space-y-1 mb-2">
                  {step.details.map((d, j) => (
                    <p key={j} className="text-[10px] font-mono text-black-400">+ {d}</p>
                  ))}
                </div>

                {/* Priority Note */}
                <div className="rounded-lg p-2.5" style={{ background: `${PURPLE}06`, border: `1px solid ${PURPLE}15` }}>
                  <p className="text-[9px] font-mono" style={{ color: PURPLE }}>
                    <span className="font-bold uppercase tracking-wider">Priority Auction: </span>
                    {step.priorityNote}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ))}

      {/* Key Insight */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="rounded-xl p-4 text-center"
        style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}
      >
        <p className="text-[10px] font-mono text-black-400 leading-relaxed">
          <span className="text-white font-bold">Key insight:</span> Traditional MEV is extracted by validators who can reorder
          transactions. VibeSwap replaces this with a <span style={{ color: PURPLE }}>fair priority auction</span> where bid
          revenue flows back to <span style={{ color: '#22c55e' }}>LPs, stakers, and the protocol</span> instead of being
          captured by block producers. The MEV still exists — but it's{' '}
          <span style={{ color: CYAN }}>democratized and redistributed</span>.
        </p>
      </motion.div>
    </div>
  )
}

// ============ Main Component ============

export default function GasBidderPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => {
          const r = seededRandom(i * 137 + 42)
          return (
            <motion.div
              key={i}
              className="absolute w-px h-px rounded-full"
              style={{
                background: i % 3 === 0 ? PURPLE : CYAN,
                left: `${(r() * 100)}%`,
                top: `${(r() * 100)}%`,
              }}
              animate={{
                opacity: [0, 0.3, 0],
                scale: [0, 1.5, 0],
                y: [0, -45 - (i % 4) * 18],
              }}
              transition={{
                duration: 3 + (i % 3) * 1.3,
                repeat: Infinity,
                delay: (i * 0.7) % 4.2,
                ease: 'easeOut',
              }}
            />
          )
        })}
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 pt-2">
        {/* ============ Page Hero ============ */}
        <PageHero
          title="Priority Auction"
          subtitle="Bid for execution priority in batch auctions"
          category="trading"
          badge="Live"
          badgeColor={PURPLE}
        />

        <div className="space-y-6">
          {/* ============ Current Batch ============ */}
          <Section index={0} title="Current Batch" subtitle="Live batch auction status and metrics">
            <CurrentBatch />
          </Section>

          {/* ============ Bid Placement ============ */}
          <Section index={1} title="Place Priority Bid" subtitle="Bid JUL for earlier execution in the current batch" glowColor="terminal">
            <BidPlacement isConnected={isConnected} />
          </Section>

          {/* ============ Bid History ============ */}
          <Section index={2} title="Bid History" subtitle="Your recent priority bid activity">
            <BidHistory />
          </Section>

          {/* ============ Revenue Distribution ============ */}
          <Section index={3} title="Revenue Distribution" subtitle="How priority bid revenue flows through the protocol">
            <RevenueDistribution />
          </Section>

          {/* ============ Statistics ============ */}
          <Section index={4} title="Epoch Statistics" subtitle="Aggregate priority auction metrics for the current epoch">
            <Statistics />
          </Section>

          {/* ============ How It Works ============ */}
          <Section index={5} title="How It Works" subtitle="Commit — Reveal — Settle with priority bidding">
            <HowItWorks />
          </Section>
        </div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/commit-reveal', label: 'Commit-Reveal' },
              { path: '/gametheory', label: 'Game Theory' },
              { path: '/economics', label: 'Economics' },
              { path: '/staking', label: 'Staking' },
              { path: '/pool', label: 'Liquidity Pools' },
            ].map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-purple-400"
                style={{ background: `${PURPLE}08`, border: `1px solid ${PURPLE}15`, color: `${PURPLE}99` }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 font-mono italic">
              "The solution to MEV is not to eliminate value — it's to redirect it from validators to the community."
            </p>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${PURPLE}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Priority Auction System</p>
        </motion.div>
      </div>
    </div>
  )
}
