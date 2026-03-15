import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useContributionsAPI } from '../hooks/useContributionsAPI'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const PURPLE = '#a855f7'
const AMBER = '#f59e0b'
const GREEN = '#22c55e'
const ease = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}
const tabV = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
}

// ============ Categories ============

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '\u2728' },
  { id: 'development', label: 'Development', icon: '\u2699' },
  { id: 'governance', label: 'Governance', icon: '\u2696' },
  { id: 'liquidity', label: 'Liquidity', icon: '\ud83d\udca7' },
  { id: 'community', label: 'Community', icon: '\ud83d\udc65' },
  { id: 'research', label: 'Research', icon: '\ud83d\udd2c' },
]

// ============ Badges ============

const BADGE_DEFS = [
  { id: 'founder', label: 'Founder', color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  { id: 'whale', label: 'Whale', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  { id: 'earlybird', label: 'Early Bird', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  { id: 'streak', label: '30d Streak', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  { id: 'topvoter', label: 'Top Voter', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  { id: 'auditor', label: 'Auditor', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  { id: 'mentor', label: 'Mentor', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)' },
  { id: 'builder', label: 'Builder', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
]

// ============ Mock Data ============

const CONTRIBUTOR_NAMES = [
  'vibemaster.eth', 'defi_sage.eth', 'lpqueen.eth', 'gov_wizard.eth',
  'code_monk.eth', 'research_owl.eth', 'liquidity_king.eth', 'dao_voice.eth',
  'shapley_fan.eth', 'mev_hunter.eth', 'batch_builder.eth', 'cross_chain.eth',
]

const CONTRIBUTION_TYPES = ['development', 'governance', 'liquidity', 'community', 'research']

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}

function shortenAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function generateContributors() {
  const rng = seededRandom(31415)
  return CONTRIBUTOR_NAMES.map((name, i) => {
    const addr = generateAddress(rng)
    const shapley = parseFloat((0.92 - i * 0.055 + rng() * 0.03).toFixed(4))
    const type = CONTRIBUTION_TYPES[Math.floor(rng() * CONTRIBUTION_TYPES.length)]
    const rewards = Math.round(4800 - i * 340 + rng() * 600)
    const badgeCount = Math.max(1, Math.floor(rng() * 4))
    const badges = []
    const usedIdx = new Set()
    for (let b = 0; b < badgeCount; b++) {
      let idx = Math.floor(rng() * BADGE_DEFS.length)
      while (usedIdx.has(idx)) idx = (idx + 1) % BADGE_DEFS.length
      usedIdx.add(idx)
      badges.push(BADGE_DEFS[idx])
    }
    const joinedDaysAgo = Math.floor(30 + rng() * 300)
    const contributions = Math.floor(12 + rng() * 180)
    return {
      rank: i + 1, name, address: addr, shapley: Math.max(0.15, shapley),
      type, rewards, badges, joinedDaysAgo, contributions,
    }
  })
}

function generateHeatmap() {
  const rng = seededRandom(27182)
  const weeks = 7
  const days = 4
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: days }, (_, d) => {
      const base = rng()
      return Math.round(base * base * 24)
    })
  )
}

const CONTRIBUTORS = generateContributors()
const HEATMAP = generateHeatmap()

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function avatarGradient(addr) {
  const h1 = parseInt(addr.slice(2, 8), 16) % 360
  const h2 = (h1 + 120 + parseInt(addr.slice(8, 12), 16) % 60) % 360
  return `linear-gradient(135deg, hsl(${h1},70%,50%), hsl(${h2},60%,40%))`
}

// ============ Rank Badge ============

const RANK_COLORS = {
  1: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.3)', text: '#eab308' },
  2: { bg: 'rgba(156,163,175,0.15)', border: 'rgba(156,163,175,0.3)', text: '#9ca3af' },
  3: { bg: 'rgba(180,83,9,0.15)', border: 'rgba(180,83,9,0.3)', text: '#b45309' },
}

function RankBadge({ rank }) {
  const medal = RANK_COLORS[rank]
  if (medal) {
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold shrink-0"
        style={{ background: medal.bg, border: `1px solid ${medal.border}`, color: medal.text }}
      >
        {rank}
      </div>
    )
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono text-black-500 shrink-0"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      {rank}
    </div>
  )
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: PURPLE }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${PURPLE}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Stats Bar ============

function StatsBar({ apiStats }) {
  const stats = apiStats ? [
    { label: 'Total Sources', value: apiStats.totalSources?.toLocaleString() || '0', color: PURPLE },
    { label: 'Derivations', value: apiStats.totalDerivations?.toLocaleString() || '0', color: GREEN },
    { label: 'Outputs Shipped', value: apiStats.totalOutputs?.toLocaleString() || '0', color: CYAN },
    { label: 'Contributors', value: apiStats.topAuthors?.length?.toString() || '0', color: AMBER },
  ] : [
    { label: 'Total Sources', value: '—', color: PURPLE },
    { label: 'Derivations', value: '—', color: GREEN },
    { label: 'Outputs Shipped', value: '—', color: CYAN },
    { label: 'Contributors', value: '—', color: AMBER },
  ]

  return (
    <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <motion.div key={s.label} custom={i} variants={cardV} initial="hidden" animate="visible">
            <GlassCard className="p-4 text-center" hover>
              <div className="text-xl md:text-2xl font-bold font-mono" style={{ color: s.color }}>
                {s.value}
              </div>
              <div className="text-[10px] font-mono text-black-400 mt-1 uppercase tracking-wider">
                {s.label}
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

// ============ Category Tabs ============

function CategoryTabs({ active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => {
        const isActive = active === cat.id
        return (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-200 border ${
              isActive
                ? 'border-purple-500/40 bg-purple-500/10 text-purple-300'
                : 'border-black-700/50 bg-black-800/40 text-black-400 hover:text-black-200 hover:border-black-600/50'
            }`}
          >
            <span className="mr-1.5">{cat.icon}</span>
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

// ============ Contributor Card ============

function ContributorCard({ contributor, index }) {
  const typeColors = {
    development: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    governance: { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
    liquidity: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    community: { text: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
    research: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  }
  const tc = typeColors[contributor.type] || typeColors.community

  return (
    <motion.div custom={index} variants={cardV} initial="hidden" animate="visible">
      <GlassCard className="p-4" hover spotlight>
        <div className="flex items-start gap-3">
          <RankBadge rank={contributor.rank} />
          <div className="flex-1 min-w-0">
            {/* Header: avatar + name */}
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-8 h-8 rounded-full shrink-0"
                style={{ background: avatarGradient(contributor.address) }}
              />
              <div className="min-w-0">
                <div className="text-sm font-mono font-semibold text-black-100 truncate">
                  {contributor.name}
                </div>
                <div className="text-[10px] font-mono text-black-500">
                  {shortenAddr(contributor.address)}
                </div>
              </div>
            </div>

            {/* Shapley score bar */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-black-400 uppercase tracking-wider">Shapley Score</span>
                <span className="text-sm font-mono font-bold" style={{ color: PURPLE }}>
                  {contributor.shapley.toFixed(3)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-black-800 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${PURPLE}, ${CYAN})` }}
                  initial={{ width: 0 }}
                  animate={{ width: `${contributor.shapley * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.2 + index * 0.05, ease }}
                />
              </div>
            </div>

            {/* Type tag + rewards */}
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${tc.text} ${tc.bg} ${tc.border}`}>
                {contributor.type}
              </span>
              <span className="text-xs font-mono text-green-400">
                {fmt(contributor.rewards)} earned
              </span>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1">
              {contributor.badges.map((badge, bi) => (
                <span
                  key={bi}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-md"
                  style={{ color: badge.color, background: badge.bg }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Contribution Heatmap ============

function ContributionHeatmap() {
  const weekLabels = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7']
  const dayLabels = ['Mon', 'Wed', 'Fri', 'Sun']

  function cellColor(val) {
    if (val === 0) return 'rgba(255,255,255,0.03)'
    if (val <= 4) return 'rgba(168,85,247,0.15)'
    if (val <= 10) return 'rgba(168,85,247,0.30)'
    if (val <= 18) return 'rgba(168,85,247,0.50)'
    return 'rgba(168,85,247,0.75)'
  }

  return (
    <div>
      {/* Day labels column + grid */}
      <div className="flex gap-1">
        <div className="flex flex-col gap-1 pr-1">
          {dayLabels.map((d) => (
            <div key={d} className="h-6 flex items-center text-[9px] font-mono text-black-500">{d}</div>
          ))}
        </div>
        <div className="flex gap-1">
          {HEATMAP.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((val, di) => (
                <motion.div
                  key={`${wi}-${di}`}
                  className="w-6 h-6 rounded-sm cursor-default"
                  style={{ background: cellColor(val) }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.02 * (wi * 4 + di) }}
                  title={`${val} contributions`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Week labels */}
      <div className="flex gap-1 mt-1 pl-8">
        {weekLabels.map((w) => (
          <div key={w} className="w-6 text-center text-[8px] font-mono text-black-500">{w}</div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-3">
        <span className="text-[9px] font-mono text-black-500">Less</span>
        {[0, 4, 10, 18, 24].map((v) => (
          <div key={v} className="w-4 h-4 rounded-sm" style={{ background: cellColor(v) }} />
        ))}
        <span className="text-[9px] font-mono text-black-500">More</span>
      </div>
    </div>
  )
}

// ============ Shapley Explainer ============

const SHAPLEY_STEPS = [
  { step: '1', title: 'Form All Coalitions', desc: 'Consider every possible subset of contributors that could form a working coalition.' },
  { step: '2', title: 'Measure Marginal Value', desc: 'For each coalition, calculate the marginal value each contributor adds when they join.' },
  { step: '3', title: 'Average Across Orderings', desc: 'Average the marginal contributions across all possible orderings of the coalition.' },
  { step: '4', title: 'Assign Fair Share', desc: 'The resulting Shapley value represents each contributor\'s provably fair share of total value created.' },
]

function ShapleyExplainer() {
  return (
    <div className="space-y-4">
      {/* Formula */}
      <div className="text-center py-4 px-3 rounded-xl" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
        <div className="text-[10px] font-mono text-black-400 uppercase tracking-wider mb-2">Shapley Value Formula</div>
        <div className="font-mono text-sm md:text-base" style={{ color: PURPLE }}>
          <span className="text-purple-300">&phi;</span>
          <span className="text-black-400">(i) = </span>
          <span className="text-black-400">&Sigma;</span>
          <sub className="text-[9px] text-black-500">S&sube;N\{'{'}i{'}'}</sub>
          <span className="text-black-400 mx-1">&middot;</span>
          <span className="text-purple-300/80">|S|!(|N|-|S|-1)!</span>
          <span className="text-black-400"> / </span>
          <span className="text-purple-300/80">|N|!</span>
          <span className="text-black-400 mx-1">&middot;</span>
          <span className="text-black-400">[</span>
          <span className="text-cyan-400">v(S&cup;{'{'}i{'}'})</span>
          <span className="text-black-400"> - </span>
          <span className="text-cyan-400">v(S)</span>
          <span className="text-black-400">]</span>
        </div>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SHAPLEY_STEPS.map((s, i) => (
          <motion.div key={i} custom={i} variants={cardV} initial="hidden" animate="visible">
            <div className="flex gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0"
                style={{ background: 'rgba(168,85,247,0.15)', color: PURPLE, border: '1px solid rgba(168,85,247,0.25)' }}
              >
                {s.step}
              </div>
              <div>
                <div className="text-xs font-mono font-semibold text-black-200">{s.title}</div>
                <div className="text-[10px] font-mono text-black-400 mt-0.5 leading-relaxed">{s.desc}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Key properties */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        {['Efficiency', 'Symmetry', 'Linearity', 'Null Player'].map((prop, i) => (
          <div key={prop} className="text-center py-2 px-2 rounded-lg" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.10)' }}>
            <div className="text-[10px] font-mono font-bold" style={{ color: PURPLE }}>{prop}</div>
            <div className="text-[8px] font-mono text-black-500 mt-0.5">
              {['Values sum to total', 'Equal work = equal pay', 'Additive games', 'Zero value = zero pay'][i]}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Your Contributions (Connected State) ============

const MY_BREAKDOWN = [
  { type: 'Liquidity', pct: 42, color: '#3b82f6' },
  { type: 'Governance', pct: 28, color: PURPLE },
  { type: 'Community', pct: 18, color: GREEN },
  { type: 'Development', pct: 12, color: CYAN },
]

function YourContributions() {
  const myShapley = 0.487, myRank = 142, pendingRewards = 284.5
  const statBoxes = [
    { val: myShapley.toFixed(3), label: 'Your Score', color: PURPLE, bg: 'rgba(168,85,247,0.06)', border: 'rgba(168,85,247,0.12)' },
    { val: `#${myRank}`, label: 'Your Rank', color: CYAN, bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.12)' },
    { val: `$${pendingRewards}`, label: 'Pending', color: GREEN, bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.12)' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {statBoxes.map((s) => (
          <div key={s.label} className="text-center p-3 rounded-lg" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.val}</div>
            <div className="text-[9px] font-mono text-black-400 uppercase">{s.label}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="text-[10px] font-mono text-black-400 uppercase tracking-wider mb-2">Contribution Breakdown</div>
        <div className="h-3 rounded-full overflow-hidden flex mb-3">
          {MY_BREAKDOWN.map((b) => (
            <motion.div key={b.type} className="h-full" style={{ background: b.color }}
              initial={{ width: 0 }} animate={{ width: `${b.pct}%` }} transition={{ duration: 0.8, ease }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {MY_BREAKDOWN.map((b) => (
            <div key={b.type} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: b.color }} />
              <span className="text-[10px] font-mono text-black-400">{b.type}</span>
              <span className="text-[10px] font-mono text-black-300 ml-auto">{b.pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <button className="w-full py-2.5 rounded-lg text-sm font-mono font-semibold transition-all"
        style={{ background: `linear-gradient(135deg, ${PURPLE}, ${CYAN})`, color: '#fff' }}>
        Claim {fmt(pendingRewards)} Rewards
      </button>
    </div>
  )
}

// ============ Become a Contributor ============

const CONTRIBUTE_WAYS = [
  { icon: '\u2699', title: 'Code', desc: 'Contribute to the protocol — smart contracts, frontend, oracle, tooling.', link: '/docs', linkLabel: 'View Docs', color: CYAN },
  { icon: '\ud83d\udca7', title: 'Liquidity', desc: 'Provide liquidity to pools and earn Shapley-weighted LP rewards.', link: '/pool', linkLabel: 'Add Liquidity', color: '#3b82f6' },
  { icon: '\u2696', title: 'Governance', desc: 'Vote on proposals, delegate, participate in batch parameter tuning.', link: '/governance', linkLabel: 'View Proposals', color: PURPLE },
  { icon: '\ud83d\udc65', title: 'Community', desc: 'Help onboard users, create content, translate docs, moderate channels.', link: '/referral', linkLabel: 'Referral Program', color: GREEN },
]

function BecomeContributor() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {CONTRIBUTE_WAYS.map((w, i) => (
        <motion.div key={w.title} custom={i} variants={cardV} initial="hidden" animate="visible">
          <div className="p-4 rounded-xl h-full flex flex-col" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
                style={{ background: `${w.color}15`, border: `1px solid ${w.color}30` }}
              >
                {w.icon}
              </div>
              <span className="text-sm font-mono font-semibold text-black-200">{w.title}</span>
            </div>
            <p className="text-[10px] font-mono text-black-400 leading-relaxed flex-1">{w.desc}</p>
            <Link
              to={w.link}
              className="mt-3 text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors"
              style={{ color: w.color }}
            >
              {w.linkLabel} &rarr;
            </Link>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Main Component ============

export default function ContributorsPage() {
  const [category, setCategory] = useState('all')
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { stats: apiStats, isLoading: apiLoading } = useContributionsAPI()

  const filtered = useMemo(() => {
    if (category === 'all') return CONTRIBUTORS
    return CONTRIBUTORS.filter((c) => c.type === category)
  }, [category])

  return (
    <div className="min-h-screen pb-24">
      {/* Hero */}
      <PageHero
        title="Contributors"
        subtitle="Every contributor's value is measured by Shapley value — fair attribution through cooperative game theory"
        category="community"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* Stats Bar — pulls from Jarvis attribution graph API */}
        <StatsBar apiStats={apiStats} />

        {/* Category Tabs + Contributors Grid */}
        <Section index={1} title="Top Contributors" subtitle="Ranked by Shapley value score across all contribution types">
          <div className="mb-4">
            <CategoryTabs active={category} onChange={setCategory} />
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={category}
              variants={tabV}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              {filtered.map((c, i) => (
                <ContributorCard key={c.address} contributor={c} index={i} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-8">
                  <div className="text-sm font-mono text-black-500">No contributors in this category yet</div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </Section>

        {/* Contribution Graph */}
        <Section index={2} title="Contribution Activity" subtitle="Community contribution intensity over the last 7 weeks">
          <ContributionHeatmap />
        </Section>

        {/* How Shapley Works */}
        <Section index={3} title="How Shapley Value Works" subtitle="Provably fair reward attribution from cooperative game theory">
          <ShapleyExplainer />
        </Section>

        {/* Your Contributions (if connected) */}
        {isConnected && (
          <Section index={4} title="Your Contributions" subtitle="Your Shapley score, rank, and pending rewards">
            <YourContributions />
          </Section>
        )}

        {/* Not connected prompt */}
        {!isConnected && (
          <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible">
            <GlassCard className="p-6 text-center" hover={false}>
              <div className="text-sm font-mono text-black-400 mb-3">
                Connect your wallet to see your contribution stats and claim rewards
              </div>
              <div className="text-[10px] font-mono text-black-500">
                Your Shapley score is calculated automatically based on on-chain activity
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Become a Contributor */}
        <Section index={5} title="Become a Contributor" subtitle="Four ways to contribute to the VibeSwap ecosystem">
          <BecomeContributor />
        </Section>
      </div>
    </div>
  )
}
