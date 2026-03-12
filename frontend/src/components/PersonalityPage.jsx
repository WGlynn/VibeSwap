import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Mock Identity Data ============
const MOCK_IDENTITY = {
  avatar: null,
  username: 'anon_vibe_7f3a',
  bio: '',
  level: 12,
  xp: 7420,
  xpToNext: 10000,
  reputationScore: 743,
  reputationMax: 1000,
  preferredTheme: 'dark',
  joinedDate: '2025-09-14',
  totalSwaps: 147,
  totalVolume: 24350.80,
  governanceVotes: 3,
  lpPositions: 2,
  bridgeTransactions: 5,
  forumPosts: 18,
  bugsReported: 1,
  holdingDays: 180,
}

const ACHIEVEMENTS = [
  { id: 'first-swap', label: 'First Swap', icon: '⚡', description: 'Complete your first swap on VibeSwap', unlocked: true, unlockedDate: '2025-09-14' },
  { id: 'lp-provider', label: 'LP Provider', icon: '💧', description: 'Provide liquidity to any pool', unlocked: true, unlockedDate: '2025-10-02' },
  { id: 'gov-voter', label: 'Governance Voter', icon: '🗳️', description: 'Vote on a governance proposal', unlocked: true, unlockedDate: '2025-11-20' },
  { id: '100-trades', label: '100 Trades', icon: '📊', description: 'Execute 100 successful trades', unlocked: true, unlockedDate: '2026-01-15' },
  { id: 'bridge-explorer', label: 'Bridge Explorer', icon: '🌉', description: 'Bridge assets to another chain', unlocked: true, unlockedDate: '2025-12-03' },
  { id: 'community-helper', label: 'Community Helper', icon: '🤝', description: 'Help 10 community members in the forum', unlocked: true, unlockedDate: '2026-02-08' },
  { id: 'bug-hunter', label: 'Bug Hunter', icon: '🐛', description: 'Report a valid bug through the bug bounty', unlocked: true, unlockedDate: '2026-01-28' },
  { id: 'diamond-hands', label: 'Diamond Hands', icon: '💎', description: 'Hold LP position for 180+ days without withdrawing', unlocked: false, unlockedDate: null },
]

const TRAIT_LABELS = ['Trading', 'Risk Tolerance', 'Community', 'Protocol Knowledge', 'Loyalty']
const MOCK_TRAITS = [0.72, 0.55, 0.83, 0.68, 0.91]

const SOCIAL_CONNECTIONS = [
  { address: '0x1a2b...3c4d', interactions: 34, label: 'Frequent LP partner' },
  { address: '0x5e6f...7a8b', interactions: 21, label: 'Governance ally' },
  { address: '0x9c0d...1e2f', interactions: 18, label: 'Swap counterparty' },
  { address: '0x3a4b...5c6d', interactions: 12, label: 'Forum collaborator' },
  { address: '0x7e8f...9a0b', interactions: 7, label: 'Bridge buddy' },
]

// ============ Heatmap Data (365 days) ============
function generateHeatmapData() {
  const data = []
  const now = new Date()
  for (let i = 364; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dayOfWeek = date.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const base = isWeekend ? 0.3 : 0.5
    const val = Math.random() < 0.25 ? 0 : Math.min(4, Math.floor(Math.random() * base * 8))
    data.push({ date: date.toISOString().slice(0, 10), value: val })
  }
  return data
}

// ============ Reputation History ============
function generateReputationHistory() {
  const points = []
  let score = 100
  for (let i = 0; i < 24; i++) {
    score += Math.floor(Math.random() * 60) - 10
    score = Math.max(50, Math.min(1000, score))
    const date = new Date()
    date.setMonth(date.getMonth() - (23 - i))
    points.push({ month: date.toLocaleDateString('en', { month: 'short', year: '2-digit' }), score })
  }
  return points
}

// ============ Radar Chart (SVG) ============
function RadarChart({ traits, labels, size = 240 }) {
  const cx = size / 2
  const cy = size / 2
  const radius = (size / 2) - 30
  const sides = labels.length
  const angleStep = (Math.PI * 2) / sides
  const offset = -Math.PI / 2

  const getPoint = (index, value) => {
    const angle = offset + index * angleStep
    const r = radius * value
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }

  const rings = [0.25, 0.5, 0.75, 1.0]
  const traitPoints = traits.map((t, i) => getPoint(i, t))
  const polygonPath = traitPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {/* Grid rings */}
      {rings.map((r, ri) => {
        const ringPoints = labels.map((_, i) => getPoint(i, r))
        const d = ringPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
        return <path key={ri} d={d} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      })}
      {/* Axis lines */}
      {labels.map((_, i) => {
        const p = getPoint(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      })}
      {/* Data polygon */}
      <motion.path
        d={polygonPath}
        fill={`${CYAN}20`}
        stroke={CYAN}
        strokeWidth="2"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      {/* Data points */}
      {traitPoints.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          fill={CYAN}
          stroke="#0a0a0a"
          strokeWidth="2"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + i * 0.08 }}
        />
      ))}
      {/* Labels */}
      {labels.map((label, i) => {
        const p = getPoint(i, 1.22)
        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-gray-400 text-[10px] font-mono"
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}

// ============ Activity Heatmap ============
function ActivityHeatmap({ data }) {
  const CELL = 11
  const GAP = 2
  const weeks = 53
  const days = 7
  const COLORS = ['#1a1a2e', '#0e4429', '#006d32', '#26a641', '#39d353']
  const monthLabels = []
  const firstDate = new Date(data[0]?.date)

  for (let w = 0; w < weeks; w++) {
    const d = new Date(firstDate)
    d.setDate(d.getDate() + w * 7)
    if (d.getDate() <= 7) {
      monthLabels.push({ week: w, label: d.toLocaleDateString('en', { month: 'short' }) })
    }
  }

  return (
    <div className="overflow-x-auto pb-2">
      <svg
        width={weeks * (CELL + GAP) + 30}
        height={days * (CELL + GAP) + 24}
        className="mx-auto"
      >
        {/* Month labels */}
        {monthLabels.map(({ week, label }, i) => (
          <text key={i} x={30 + week * (CELL + GAP)} y={10} className="fill-gray-500 text-[9px] font-mono">{label}</text>
        ))}
        {/* Day labels */}
        {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
          <text key={i} x={0} y={20 + i * (CELL + GAP) + CELL / 2 + 3} className="fill-gray-600 text-[9px] font-mono">{d}</text>
        ))}
        {/* Cells */}
        {data.map((entry, idx) => {
          const week = Math.floor(idx / 7)
          const day = idx % 7
          return (
            <motion.rect
              key={idx}
              x={30 + week * (CELL + GAP)}
              y={18 + day * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={COLORS[entry.value]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: idx * 0.0008 }}
            >
              <title>{entry.date}: {entry.value} interactions</title>
            </motion.rect>
          )
        })}
      </svg>
      <div className="flex items-center justify-end gap-1 mt-1 mr-2">
        <span className="text-[9px] text-gray-500 font-mono mr-1">Less</span>
        {COLORS.map((c, i) => (
          <div key={i} className="w-[10px] h-[10px] rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span className="text-[9px] text-gray-500 font-mono ml-1">More</span>
      </div>
    </div>
  )
}

// ============ Reputation History Chart ============
function ReputationChart({ history, width = 600, height = 160 }) {
  const padding = { top: 10, right: 10, bottom: 24, left: 36 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const maxScore = Math.max(...history.map(h => h.score))
  const minScore = Math.min(...history.map(h => h.score))
  const range = maxScore - minScore || 1

  const points = history.map((h, i) => ({
    x: padding.left + (i / (history.length - 1)) * innerW,
    y: padding.top + innerH - ((h.score - minScore) / range) * innerH,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = linePath + ` L${points[points.length - 1].x},${padding.top + innerH} L${points[0].x},${padding.top + innerH} Z`

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* Y-axis labels */}
      {[0, 0.5, 1].map((pct, i) => {
        const val = Math.round(minScore + range * (1 - pct))
        const y = padding.top + innerH * pct
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(255,255,255,0.04)" />
            <text x={padding.left - 4} y={y + 3} textAnchor="end" className="fill-gray-600 text-[9px] font-mono">{val}</text>
          </g>
        )
      })}
      {/* Area fill */}
      <motion.path
        d={areaPath}
        fill={`url(#repGradient)`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      {/* Line */}
      <motion.path
        d={linePath}
        fill="none"
        stroke={CYAN}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      {/* X-axis month labels (every 4th) */}
      {history.map((h, i) => i % 4 === 0 ? (
        <text key={i} x={points[i].x} y={height - 4} textAnchor="middle" className="fill-gray-600 text-[8px] font-mono">{h.month}</text>
      ) : null)}
      {/* Gradient def */}
      <defs>
        <linearGradient id="repGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.25" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.02" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ============ XP Bar ============
function XPBar({ current, max }) {
  const pct = Math.min(100, (current / max) * 100)
  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
        <span>{current.toLocaleString()} XP</span>
        <span>{max.toLocaleString()} XP</span>
      </div>
      <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden border border-white/5">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${CYAN}, #a78bfa)` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </div>
  )
}

// ============ Main Page ============
export default function PersonalityPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [identity, setIdentity] = useState(MOCK_IDENTITY)
  const [editingField, setEditingField] = useState(null)
  const [editValue, setEditValue] = useState('')

  const heatmapData = useMemo(() => generateHeatmapData(), [])
  const reputationHistory = useMemo(() => generateReputationHistory(), [])

  const unlockedCount = ACHIEVEMENTS.filter(a => a.unlocked).length

  const startEdit = useCallback((field) => {
    setEditingField(field)
    setEditValue(identity[field] || '')
  }, [identity])

  const saveEdit = useCallback(() => {
    if (editingField) {
      setIdentity(prev => ({ ...prev, [editingField]: editValue }))
      localStorage.setItem('vibeswap_identity', JSON.stringify({ ...identity, [editingField]: editValue }))
    }
    setEditingField(null)
  }, [editingField, editValue, identity])

  const stagger = {
    container: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 1 / (PHI * PHI * PHI * 2) } } },
    item: { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI) } } },
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-16">
      {/* ============ Hero ============ */}
      <PageHero
        title="Your Identity"
        subtitle="Soulbound on-chain reputation that can't be bought, only earned"
        category="community"
        badge="Soulbound"
        badgeColor={CYAN}
      />

      <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-6">

        {/* ============ Soulbound Identity Card ============ */}
        <motion.div variants={stagger.item}>
          <GlassCard glowColor="terminal" spotlight className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-28 h-28 rounded-2xl flex items-center justify-center text-4xl font-bold border-2"
                  style={{
                    borderColor: `${CYAN}40`,
                    background: `linear-gradient(135deg, ${CYAN}15, #a78bfa15)`,
                  }}
                >
                  {identity.avatar ? (
                    <img src={identity.avatar} alt="avatar" className="w-full h-full rounded-2xl object-cover" />
                  ) : (
                    <span style={{ color: CYAN }}>{identity.username.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border"
                  style={{ background: '#0a0a0a', borderColor: `${CYAN}60`, color: CYAN }}
                >
                  {identity.level}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 text-center md:text-left min-w-0">
                <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
                  <h2 className="text-xl font-bold tracking-tight truncate">{identity.username}</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border" style={{ borderColor: `${CYAN}30`, color: CYAN }}>
                    Level {identity.level}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  {identity.bio || 'No bio set yet'}
                </p>
                <XPBar current={identity.xp} max={identity.xpToNext} />

                {/* Quick stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {[
                    { label: 'Swaps', value: identity.totalSwaps },
                    { label: 'Volume', value: `$${identity.totalVolume.toLocaleString()}` },
                    { label: 'Votes', value: identity.governanceVotes },
                    { label: 'Member since', value: new Date(identity.joinedDate).toLocaleDateString('en', { month: 'short', year: 'numeric' }) },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center p-2 rounded-lg bg-white/[0.02] border border-white/5">
                      <div className="text-sm font-bold" style={{ color: CYAN }}>{value}</div>
                      <div className="text-[10px] text-gray-500 font-mono">{label}</div>
                    </div>
                  ))}
                </div>

                {/* Badges row */}
                <div className="flex flex-wrap gap-1.5 mt-3 justify-center md:justify-start">
                  {ACHIEVEMENTS.filter(a => a.unlocked).map(a => (
                    <span key={a.id} className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10" title={a.label}>
                      {a.icon} {a.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Achievement Grid ============ */}
        <motion.div variants={stagger.item}>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Achievements</h3>
              <span className="text-xs font-mono text-gray-500">{unlockedCount}/{ACHIEVEMENTS.length} unlocked</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {ACHIEVEMENTS.map((achievement) => (
                <motion.div
                  key={achievement.id}
                  className={`relative p-4 rounded-xl border text-center transition-colors ${
                    achievement.unlocked
                      ? 'border-white/10 bg-white/[0.03]'
                      : 'border-white/5 bg-white/[0.01] opacity-40'
                  }`}
                  whileHover={achievement.unlocked ? { scale: 1.03, borderColor: `${CYAN}30` } : {}}
                >
                  <div className="text-2xl mb-2">{achievement.icon}</div>
                  <div className="text-xs font-semibold mb-1">{achievement.label}</div>
                  <div className="text-[9px] text-gray-500 leading-tight">{achievement.description}</div>
                  {achievement.unlocked && (
                    <div className="text-[8px] font-mono mt-2" style={{ color: CYAN }}>
                      {new Date(achievement.unlockedDate).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                  {!achievement.unlocked && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Personality Traits + Reputation Score ============ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Radar Chart */}
          <motion.div variants={stagger.item}>
            <GlassCard glowColor="terminal" className="p-6 h-full">
              <h3 className="text-lg font-bold mb-2">Personality Traits</h3>
              <p className="text-[11px] text-gray-500 mb-4">Derived from on-chain behavior analysis</p>
              <RadarChart traits={MOCK_TRAITS} labels={TRAIT_LABELS} size={260} />
              <div className="grid grid-cols-5 gap-1 mt-4">
                {TRAIT_LABELS.map((label, i) => (
                  <div key={label} className="text-center">
                    <div className="text-sm font-bold" style={{ color: CYAN }}>{Math.round(MOCK_TRAITS[i] * 100)}%</div>
                    <div className="text-[8px] text-gray-500 font-mono leading-tight">{label}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* Reputation Score */}
          <motion.div variants={stagger.item}>
            <GlassCard glowColor="terminal" className="p-6 h-full">
              <h3 className="text-lg font-bold mb-2">Reputation Score</h3>
              <p className="text-[11px] text-gray-500 mb-6">Calculated from on-chain activity, soulbound to your identity</p>
              <div className="flex items-center justify-center mb-6">
                <div className="relative w-40 h-40">
                  <svg width="160" height="160" viewBox="0 0 160 160" className="transform -rotate-90">
                    <circle cx="80" cy="80" r="68" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                    <motion.circle
                      cx="80"
                      cy="80"
                      r="68"
                      fill="none"
                      stroke={CYAN}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 68}`}
                      initial={{ strokeDashoffset: 2 * Math.PI * 68 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 68 * (1 - identity.reputationScore / identity.reputationMax) }}
                      transition={{ duration: 1.5, ease: 'easeOut', delay: 0.4 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold" style={{ color: CYAN }}>{identity.reputationScore}</span>
                    <span className="text-[10px] text-gray-500 font-mono">/ {identity.reputationMax}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Trading Activity', pct: 0.72 },
                  { label: 'Governance Participation', pct: 0.45 },
                  { label: 'Community Contribution', pct: 0.83 },
                  { label: 'Protocol Loyalty', pct: 0.91 },
                ].map(({ label, pct }) => (
                  <div key={label}>
                    <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-0.5">
                      <span>{label}</span>
                      <span>{Math.round(pct * 100)}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: CYAN }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct * 100}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.6 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>

        {/* ============ Activity Heatmap ============ */}
        <motion.div variants={stagger.item}>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">Activity</h3>
                <p className="text-[11px] text-gray-500">Daily protocol interactions over the past year</p>
              </div>
              <span className="text-xs font-mono px-2 py-1 rounded-lg bg-white/5 border border-white/10" style={{ color: CYAN }}>
                {heatmapData.filter(d => d.value > 0).length} active days
              </span>
            </div>
            <ActivityHeatmap data={heatmapData} />
          </GlassCard>
        </motion.div>

        {/* ============ Reputation History Chart ============ */}
        <motion.div variants={stagger.item}>
          <GlassCard glowColor="terminal" className="p-6">
            <h3 className="text-lg font-bold mb-1">Reputation Over Time</h3>
            <p className="text-[11px] text-gray-500 mb-4">Your reputation score trajectory over the past 24 months</p>
            <ReputationChart history={reputationHistory} />
          </GlassCard>
        </motion.div>

        {/* ============ Identity Customization + Social Connections ============ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Customization */}
          <motion.div variants={stagger.item}>
            <GlassCard glowColor="terminal" className="p-6 h-full">
              <h3 className="text-lg font-bold mb-4">Identity Settings</h3>
              <div className="space-y-4">
                {[
                  { field: 'username', label: 'Username', type: 'text' },
                  { field: 'bio', label: 'Bio', type: 'text' },
                  { field: 'preferredTheme', label: 'Preferred Theme', type: 'select' },
                ].map(({ field, label, type }) => (
                  <div key={field}>
                    <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 block">{label}</label>
                    {editingField === field ? (
                      <div className="flex gap-2">
                        {type === 'select' ? (
                          <select
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                          >
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                            <option value="terminal">Terminal</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                          />
                        )}
                        <button
                          onClick={saveEdit}
                          className="px-3 py-2 rounded-lg text-xs font-mono border border-cyan-500/30 hover:bg-cyan-500/10 transition-colors"
                          style={{ color: CYAN }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingField(null)}
                          className="px-3 py-2 rounded-lg text-xs font-mono border border-white/10 hover:bg-white/5 text-gray-400 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 cursor-pointer hover:border-white/10 transition-colors group"
                        onClick={() => startEdit(field)}
                      >
                        <span className="text-sm">{identity[field] || 'Not set'}</span>
                        <svg className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}

                {/* Recovery Settings Link */}
                <div className="pt-2 border-t border-white/5">
                  <Link
                    to="/settings"
                    className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span className="text-sm text-gray-400">Recovery Settings</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Social Connections */}
          <motion.div variants={stagger.item}>
            <GlassCard glowColor="terminal" className="p-6 h-full">
              <h3 className="text-lg font-bold mb-1">Social Connections</h3>
              <p className="text-[11px] text-gray-500 mb-4">Addresses you've interacted with most on-chain</p>
              <div className="space-y-2">
                {SOCIAL_CONNECTIONS.map((conn, i) => (
                  <motion.div
                    key={conn.address}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.8 + i * 0.08 }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border"
                        style={{
                          borderColor: `${CYAN}25`,
                          background: `${CYAN}10`,
                          color: CYAN,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div>
                        <div className="text-sm font-mono">{conn.address}</div>
                        <div className="text-[10px] text-gray-500">{conn.label}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: CYAN }}>{conn.interactions}</div>
                      <div className="text-[9px] text-gray-600 font-mono">interactions</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>

        {/* ============ Soulbound Footer ============ */}
        <motion.div variants={stagger.item}>
          <div className="text-center py-8">
            <div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono"
              style={{ borderColor: `${CYAN}20`, color: CYAN, background: `${CYAN}08` }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Your identity is soulbound — it can't be bought, only earned
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
