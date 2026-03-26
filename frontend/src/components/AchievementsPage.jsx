import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Achievements & Quests ============
// Gamified progression: XP levels, daily/weekly quests, achievement
// categories, seasonal events, streak tracking. Seed 2020 PRNG.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease: [0.25, 0.1, 0.25, 1] } }),
}

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ XP & Level System ============
const USER_LEVEL = 14
const USER_XP = 8420
const xpFor = (lv) => Math.floor(1000 * Math.pow(PHI, lv - 1))
const XP_IN_LEVEL = USER_XP - xpFor(USER_LEVEL)
const XP_NEEDED = xpFor(USER_LEVEL + 1) - xpFor(USER_LEVEL)
const XP_PCT = Math.min(100, Math.round((XP_IN_LEVEL / XP_NEEDED) * 100))

// ============ Categories ============
const CATEGORIES = [
  { key: 'Trading', icon: 'T', color: '#22c55e' },
  { key: 'Liquidity', icon: 'L', color: '#06b6d4' },
  { key: 'Governance', icon: 'G', color: '#8b5cf6' },
  { key: 'Community', icon: 'C', color: '#f59e0b' },
  { key: 'Explorer', icon: 'E', color: '#ec4899' },
]

// ============ Achievements ============
const ALL_ACHIEVEMENTS = [
  // Trading (6)
  { id: 'T01', cat: 'Trading', title: 'First Trade', desc: 'Execute your first swap on VibeSwap', progress: 100, reward: { xp: 50, vibe: 10 }, badge: 'Novice Trader', icon: 'T' },
  { id: 'T02', cat: 'Trading', title: 'Batch Warrior', desc: 'Participate in 50 commit-reveal batch auctions', progress: 72, reward: { xp: 200, vibe: 50 }, badge: null, icon: 'T' },
  { id: 'T03', cat: 'Trading', title: 'Volume King', desc: 'Trade over $100,000 in cumulative volume', progress: 38, reward: { xp: 500, vibe: 200 }, badge: 'Volume King', icon: 'T' },
  { id: 'T04', cat: 'Trading', title: 'MEV Slayer', desc: 'Complete 100 trades with zero MEV extraction', progress: 100, reward: { xp: 300, vibe: 100 }, badge: 'MEV Slayer', icon: 'T' },
  { id: 'T05', cat: 'Trading', title: 'Multichain Trader', desc: 'Execute trades on 3+ chains via LayerZero', progress: 66, reward: { xp: 250, vibe: 80 }, badge: null, icon: 'T' },
  { id: 'T06', cat: 'Trading', title: 'Perfect Reveal', desc: 'Submit 200 consecutive valid reveals without slashing', progress: 100, reward: { xp: 400, vibe: 150 }, badge: 'Fair Player', icon: 'T' },

  // Liquidity (5)
  { id: 'L01', cat: 'Liquidity', title: 'LP Genesis', desc: 'Provide liquidity for the first time', progress: 100, reward: { xp: 75, vibe: 15 }, badge: 'LP Pioneer', icon: 'L' },
  { id: 'L02', cat: 'Liquidity', title: 'Deep Pools', desc: 'Provide liquidity to 5 different pools simultaneously', progress: 60, reward: { xp: 300, vibe: 120 }, badge: null, icon: 'L' },
  { id: 'L03', cat: 'Liquidity', title: 'Diamond LP', desc: 'Maintain an LP position for 90+ consecutive days', progress: 44, reward: { xp: 500, vibe: 250 }, badge: 'Diamond LP', icon: 'L' },
  { id: 'L04', cat: 'Liquidity', title: 'Fee Harvester', desc: 'Earn $1,000+ in LP fees from a single pool', progress: 22, reward: { xp: 350, vibe: 100 }, badge: null, icon: 'L' },
  { id: 'L05', cat: 'Liquidity', title: 'IL Survivor', desc: 'Maintain positive position after impermanent loss protection', progress: 100, reward: { xp: 200, vibe: 75 }, badge: 'IL Survivor', icon: 'L' },

  // Governance (5)
  { id: 'G01', cat: 'Governance', title: 'First Vote', desc: 'Cast your first governance vote', progress: 100, reward: { xp: 50, vibe: 10 }, badge: 'Citizen', icon: 'G' },
  { id: 'G02', cat: 'Governance', title: 'Proposal Author', desc: 'Submit a governance proposal that reaches quorum', progress: 0, reward: { xp: 500, vibe: 300 }, badge: 'Proposal Author', icon: 'G' },
  { id: 'G03', cat: 'Governance', title: 'Delegate Leader', desc: 'Receive delegation from 10+ unique wallets', progress: 30, reward: { xp: 400, vibe: 200 }, badge: null, icon: 'G' },
  { id: 'G04', cat: 'Governance', title: 'Perfect Attendance', desc: 'Vote on 25 consecutive proposals without missing one', progress: 84, reward: { xp: 350, vibe: 150 }, badge: 'Guardian', icon: 'G' },
  { id: 'G05', cat: 'Governance', title: 'Treasury Steward', desc: 'Participate in 5 treasury allocation votes', progress: 100, reward: { xp: 200, vibe: 80 }, badge: 'Steward', icon: 'G' },

  // Community (5)
  { id: 'C01', cat: 'Community', title: 'Early Adopter', desc: 'Join VibeSwap within the first 30 days of launch', progress: 100, reward: { xp: 200, vibe: 50 }, badge: 'OG', icon: 'C' },
  { id: 'C02', cat: 'Community', title: 'Referral Network', desc: 'Successfully refer 10 active users', progress: 50, reward: { xp: 400, vibe: 200 }, badge: null, icon: 'C' },
  { id: 'C03', cat: 'Community', title: 'Bug Hunter', desc: 'Report a verified bug through the security bounty program', progress: 0, reward: { xp: 750, vibe: 500 }, badge: 'Bug Hunter', icon: 'C' },
  { id: 'C04', cat: 'Community', title: 'Vibe Ambassador', desc: 'Create educational content about VibeSwap shared 100+ times', progress: 15, reward: { xp: 500, vibe: 250 }, badge: 'Ambassador', icon: 'C' },
  { id: 'C05', cat: 'Community', title: 'Forum Regular', desc: 'Post 50 constructive forum contributions', progress: 100, reward: { xp: 150, vibe: 40 }, badge: 'Regular', icon: 'C' },

  // Explorer (6)
  { id: 'E01', cat: 'Explorer', title: 'Chain Hopper', desc: 'Bridge assets to 5 different chains via LayerZero', progress: 40, reward: { xp: 300, vibe: 100 }, badge: null, icon: 'E' },
  { id: 'E02', cat: 'Explorer', title: 'Feature Explorer', desc: 'Use every core feature at least once (swap, LP, stake, bridge, vote)', progress: 80, reward: { xp: 250, vibe: 80 }, badge: 'Explorer', icon: 'E' },
  { id: 'E03', cat: 'Explorer', title: 'Vault Master', desc: 'Deposit into 3 different vault strategies', progress: 33, reward: { xp: 200, vibe: 60 }, badge: null, icon: 'E' },
  { id: 'E04', cat: 'Explorer', title: 'Oracle Watcher', desc: 'Monitor TWAP oracle data for 30 consecutive batches', progress: 100, reward: { xp: 150, vibe: 45 }, badge: 'Oracle Watcher', icon: 'E' },
  { id: 'E05', cat: 'Explorer', title: 'Gas Optimizer', desc: 'Execute 50 transactions during low-gas periods', progress: 56, reward: { xp: 200, vibe: 70 }, badge: null, icon: 'E' },
  { id: 'E06', cat: 'Explorer', title: 'Omnichain Native', desc: 'Hold positions on 5+ chains simultaneously', progress: 20, reward: { xp: 600, vibe: 300 }, badge: 'Omnichain Native', icon: 'E' },
]

// ============ Quest / Challenge Generation ============
function generateDailyQuests() {
  const rng = seededRandom(2020)
  const quests = [
    { title: 'Complete 3 Swaps', desc: 'Execute 3 trades in any pool', reward: { xp: 30, vibe: 5 }, progress: 2, target: 3 },
    { title: 'Provide Liquidity', desc: 'Add liquidity to any pool once today', reward: { xp: 25, vibe: 8 }, progress: 0, target: 1 },
    { title: 'Cast a Vote', desc: 'Vote on any active governance proposal', reward: { xp: 20, vibe: 3 }, progress: 1, target: 1 },
    { title: 'Bridge Assets', desc: 'Send tokens to another chain via LayerZero', reward: { xp: 35, vibe: 10 }, progress: 0, target: 1 },
    { title: 'Claim Rewards', desc: 'Claim pending VIBE rewards from any source', reward: { xp: 15, vibe: 2 }, progress: 0, target: 1 },
    { title: 'Check Analytics', desc: 'View your portfolio analytics dashboard', reward: { xp: 10, vibe: 1 }, progress: 1, target: 1 },
  ]
  for (let i = quests.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [quests[i], quests[j]] = [quests[j], quests[i]] }
  return quests.slice(0, 3)
}

function generateWeeklyChallenges() {
  const rng = seededRandom(2020)
  const c = [
    { title: 'Volume Sprint', desc: 'Trade $10,000+ in cumulative volume this week', reward: { xp: 150, vibe: 50 }, progress: 6200, target: 10000, unit: '$' },
    { title: 'LP Marathon', desc: 'Keep LP position active for 7 consecutive days', reward: { xp: 200, vibe: 75 }, progress: 5, target: 7, unit: 'days' },
    { title: 'Governance Week', desc: 'Vote on 3 different proposals this week', reward: { xp: 120, vibe: 40 }, progress: 1, target: 3, unit: 'votes' },
    { title: 'Cross-Chain Quest', desc: 'Bridge assets to 2 new chains this week', reward: { xp: 180, vibe: 60 }, progress: 0, target: 2, unit: 'chains' },
    { title: 'Social Butterfly', desc: 'Refer 2 new users who complete their first trade', reward: { xp: 250, vibe: 100 }, progress: 1, target: 2, unit: 'referrals' },
  ]
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [c[i], c[j]] = [c[j], c[i]] }
  return c.slice(0, 3)
}

// ============ Seasonal Events ============
const SEASONAL_EVENTS = [
  { name: 'Omnichain Odyssey', desc: 'Bridge to 5 chains and complete cross-chain swaps for bonus VIBE rewards', start: 'Mar 1', end: 'Mar 31', active: true, color: CYAN, mult: '2x VIBE', badge: 'Odyssey Pioneer' },
  { name: 'Summer of DeFi', desc: 'Earn 3x XP on all trading activities and unlock exclusive seasonal badges', start: 'Jun 1', end: 'Aug 31', active: false, color: '#f59e0b', mult: '3x XP', badge: 'Summer Trader' },
  { name: 'Governance Season', desc: 'Double XP for all governance participation. Shape the future of VibeSwap.', start: 'Apr 15', end: 'May 15', active: false, color: '#8b5cf6', mult: '2x XP', badge: 'Season Delegate' },
]

// ============ Streak ============
const STREAK_CURRENT = 12
const STREAK_BEST = 34
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100]

const TOTAL_EARNED = ALL_ACHIEVEMENTS.filter((a) => a.progress === 100).length
const TOTAL_AVAILABLE = ALL_ACHIEVEMENTS.length

// ============ Shared Sub-Components ============

function SectionHeader({ tag, title, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 1 / PHI, ease: 'easeOut' }}
      className="mb-4"
    >
      <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">
        {tag}
      </span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">
        {title}
      </h2>
    </motion.div>
  )
}

function Bar({ pct, color = CYAN, h = 6, delay = 0.3 }) {
  return (
    <div className="bg-black/30 rounded-full overflow-hidden" style={{ height: h }}>
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true }}
        transition={{ delay, duration: 0.8, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  )
}

function AchievementCard({ a, index }) {
  const cat = CATEGORIES.find((c) => c.key === a.cat)
  const color = cat?.color || CYAN
  const done = a.progress === 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: index * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard
        glowColor={done ? 'terminal' : 'none'}
        className={`p-4 h-full ${!done ? 'opacity-70' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* Achievement icon */}
          <div
            className="relative flex items-center justify-center rounded-xl font-mono font-bold shrink-0"
            style={{
              width: 44,
              height: 44,
              backgroundColor: done ? `${color}22` : 'rgba(255,255,255,0.03)',
              border: `2px solid ${done ? color : 'rgba(255,255,255,0.08)'}`,
              color: done ? color : 'rgba(255,255,255,0.15)',
              fontSize: 17,
            }}
          >
            {a.icon}
            {done && (
              <div
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ backgroundColor: color }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
          </div>

          {/* Achievement details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-bold font-mono text-white truncate">{a.title}</p>
              {a.badge && done && (
                <span
                  className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}33` }}
                >
                  {a.badge}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">
              {a.desc}
            </p>

            {/* Reward pills */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                +{a.reward.xp} XP
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                +{a.reward.vibe} VIBE
              </span>
              {a.badge && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  Badge
                </span>
              )}
            </div>

            {/* Progress bar for incomplete */}
            {!done && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-white/30 uppercase">Progress</span>
                  <span className="text-[9px] font-mono text-white/40">{a.progress}%</span>
                </div>
                <Bar pct={a.progress} color={color} h={4} delay={0.2 + index * 0.04} />
              </div>
            )}

            {/* Completed indicator */}
            {done && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-[9px] font-mono text-green-400/60">Completed</span>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

function QuestCard({ q, index, accent = '#22c55e' }) {
  const done = q.progress >= q.target
  const pct = Math.min(100, Math.round((q.progress / q.target) * 100))

  return (
    <motion.div
      custom={index}
      variants={cardV}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      <GlassCard glowColor={done ? 'matrix' : 'none'} className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className={`text-sm font-bold font-mono ${done ? 'text-white' : 'text-white/80'}`}>
                {q.title}
              </p>
              {done && (
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: accent }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </div>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">
              {q.desc}
            </p>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-white/30 uppercase">
                {q.unit === '$'
                  ? `$${q.progress.toLocaleString()} / $${q.target.toLocaleString()}`
                  : `${q.progress}/${q.target}${q.unit ? ` ${q.unit}` : ''}`
                }
              </span>
              <span className="text-[9px] font-mono text-white/40">{pct}%</span>
            </div>
            <Bar pct={pct} color={accent} h={4} delay={0.15 + index * 0.08} />
          </div>

          {/* Reward column */}
          <div className="shrink-0 text-right">
            <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
            <div className="text-[10px] font-mono" style={{ color: CYAN }}>
              +{q.reward.xp} XP
            </div>
            <div className="text-[10px] font-mono text-green-400">
              +{q.reward.vibe} VIBE
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
export default function AchievementsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [activeCategory, setActiveCategory] = useState('Trading')

  const dailyQuests = useMemo(() => generateDailyQuests(), [])
  const weeklyChallenges = useMemo(() => generateWeeklyChallenges(), [])
  const filtered = ALL_ACHIEVEMENTS.filter((a) => a.cat === activeCategory)
  const catStats = CATEGORIES.map((c) => {
    const items = ALL_ACHIEVEMENTS.filter((a) => a.cat === c.key)
    return { ...c, count: items.length, earned: items.filter((a) => a.progress === 100).length }
  })
  const totalXP = ALL_ACHIEVEMENTS.filter((a) => a.progress === 100).reduce((s, a) => s + a.reward.xp, 0)
  const totalVIBE = ALL_ACHIEVEMENTS.filter((a) => a.progress === 100).reduce((s, a) => s + a.reward.vibe, 0)
  const dailyDone = dailyQuests.filter((q) => q.progress >= q.target).length
  const weeklyDone = weeklyChallenges.filter((c) => c.progress >= c.target).length
  const rng = seededRandom(2020)
  const resetH = Math.floor(rng() * 12) + 1
  const resetM = Math.floor(rng() * 60)
  const resetD = Math.floor(rng() * 5) + 1
  const flameI = Math.min(1, STREAK_CURRENT / 30)

  return (
    <div className="min-h-screen pb-20">
      <PageHero title="Achievements & Quests" subtitle="Level up through protocol participation and earn rewards" category="account" badge="Live" badgeColor={CYAN} />
      <div className="max-w-4xl mx-auto px-4 space-y-10">

        {/* ============ XP Bar & Level ============ */}
        <section>
          <SectionHeader tag="Progression" title="Your Level" delay={0.1} />
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}>
            <GlassCard glowColor="terminal" spotlight className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-xl" style={{ backgroundColor: `${CYAN}15`, border: `2px solid ${CYAN}40`, color: CYAN }}>{USER_LEVEL}</div>
                  <div>
                    <p className="text-sm font-bold font-mono text-white">Level {USER_LEVEL}</p>
                    <p className="text-[10px] font-mono text-white/40">{XP_IN_LEVEL.toLocaleString()} / {XP_NEEDED.toLocaleString()} XP to Level {USER_LEVEL + 1}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold font-mono" style={{ color: CYAN }}>{USER_XP.toLocaleString()}</p>
                  <p className="text-[9px] font-mono text-white/30 uppercase">Total XP</p>
                </div>
              </div>
              <div className="h-3 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <motion.div initial={{ width: 0 }} animate={{ width: `${XP_PCT}%` }} transition={{ delay: 0.4, duration: 1.2, ease: 'easeOut' }} className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${CYAN}, #22d3ee)`, boxShadow: `0 0 12px ${CYAN}60` }} />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[9px] font-mono text-white/30">Lv {USER_LEVEL}</span>
                <span className="text-[9px] font-mono" style={{ color: CYAN }}>{XP_PCT}%</span>
                <span className="text-[9px] font-mono text-white/30">Lv {USER_LEVEL + 1}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {[
                  { label: 'Achievements', val: `${TOTAL_EARNED}`, sub: `/${TOTAL_AVAILABLE}`, color: CYAN },
                  { label: 'XP Earned', val: totalXP.toLocaleString(), sub: '', color: '#fff' },
                  { label: 'VIBE Earned', val: totalVIBE.toLocaleString(), sub: '', color: '#22c55e' },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">{s.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.val}<span className="text-white/30 text-xs">{s.sub}</span></div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Streak Tracker ============ */}
        <section>
          <SectionHeader tag="Consistency" title="Streak Tracker" delay={0.1 / PHI} />
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25, ease: [0.25, 0.1, 0.25, 1] }}>
            <GlassCard glowColor="warning" className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: `rgba(249,115,22,${0.08 + flameI * 0.12})`, border: `2px solid rgba(249,115,22,${0.2 + flameI * 0.3})`, boxShadow: `0 0 ${Math.round(flameI * 20)}px rgba(249,115,22,${flameI * 0.3})` }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" fill={`rgba(249,115,22,${0.4 + flameI * 0.4})`} stroke="rgba(249,115,22,0.8)" strokeWidth="1.5" /><path d="M12 8c0 2-2 3-2 5a2 2 0 0 0 4 0c0-2-2-3-2-5z" fill={`rgba(251,191,36,${0.5 + flameI * 0.3})`} /></svg>
                </div>
                <div>
                  <div className="text-2xl font-bold font-mono text-orange-400">{STREAK_CURRENT}</div>
                  <div className="text-[10px] font-mono text-white/40">day streak</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] font-mono text-white/30 uppercase">Best</div>
                  <div className="text-sm font-bold font-mono text-white/60">{STREAK_BEST} days</div>
                </div>
              </div>
              <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[9px] font-mono text-white/30 uppercase mb-3">Milestones</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {STREAK_MILESTONES.map((ms) => {
                    const hit = STREAK_CURRENT >= ms
                    return <div key={ms} className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold" style={{ backgroundColor: hit ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${hit ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.06)'}`, color: hit ? '#f97316' : 'rgba(255,255,255,0.2)' }}>{ms}d</div>
                  })}
                </div>
                <p className="text-[10px] font-mono text-white/30 mt-3">Next milestone: <span style={{ color: '#f97316' }}>{STREAK_MILESTONES.find((m) => m > STREAK_CURRENT) || 100} days</span> — keep trading daily</p>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Daily Quests ============ */}
        <section>
          <SectionHeader tag="Daily" title="Daily Quests" delay={0.1 / (PHI * PHI)} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-white/40">Completed: <span style={{ color: CYAN }}>{dailyDone}/3</span></span>
            <span className="text-[10px] font-mono text-white/30">Resets in {resetH}h {resetM}m</span>
          </div>
          <div className="space-y-3">
            {dailyQuests.map((q, i) => <QuestCard key={i} q={q} index={i} accent="#22c55e" />)}
          </div>
        </section>

        {/* ============ Weekly Challenges ============ */}
        <section>
          <SectionHeader tag="Weekly" title="Weekly Challenges" delay={0.1} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-white/40">Completed: <span style={{ color: '#f59e0b' }}>{weeklyDone}/3</span></span>
            <span className="text-[10px] font-mono text-white/30">Resets in {resetD}d</span>
          </div>
          <div className="space-y-3">
            {weeklyChallenges.map((q, i) => <QuestCard key={i} q={q} index={i} accent="#f59e0b" />)}
          </div>
        </section>

        {/* ============ Seasonal Events ============ */}
        <section>
          <SectionHeader tag="Seasonal" title="Events & Seasons" delay={0.1 / PHI} />
          <div className="space-y-3">
            {SEASONAL_EVENTS.map((ev, i) => (
              <motion.div key={ev.name} custom={i} variants={cardV} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}>
                <GlassCard glowColor={ev.active ? 'terminal' : 'none'} className={`p-4 ${!ev.active ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold font-mono text-white">{ev.name}</p>
                        <span className={`flex items-center gap-1 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-full ${ev.active ? 'bg-green-500/15 border border-green-500/30 text-green-400' : 'bg-white/5 border border-white/10 text-white/30'}`}>
                          {ev.active && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                          {ev.active ? 'Active' : 'Upcoming'}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">{ev.desc}</p>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-white/30">{ev.start} — {ev.end}</span>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full" style={{ color: ev.color, backgroundColor: `${ev.color}15`, border: `1px solid ${ev.color}33` }}>{ev.mult}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
                      <span className="text-[9px] font-mono font-bold px-2 py-1 rounded-lg inline-block" style={{ color: ev.color, backgroundColor: `${ev.color}10`, border: `1px solid ${ev.color}25` }}>{ev.badge}</span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============ Achievement Gallery ============ */}
        <section>
          <SectionHeader tag="Achievements" title="Achievement Gallery" delay={0.1 / (PHI * PHI)} />
          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 1 / PHI }} className="mb-4">
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-white/40 uppercase mb-0.5">Total Unlocked</p>
                  <p className="text-xl font-bold font-mono" style={{ color: CYAN }}>{TOTAL_EARNED}<span className="text-sm text-white/30 ml-1">/ {TOTAL_AVAILABLE}</span></p>
                </div>
                <div className="w-32">
                  <Bar pct={Math.round((TOTAL_EARNED / TOTAL_AVAILABLE) * 100)} color={CYAN} h={6} delay={0.4} />
                  <p className="text-[9px] font-mono text-white/30 text-right mt-1">{Math.round((TOTAL_EARNED / TOTAL_AVAILABLE) * 100)}% complete</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2 mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {catStats.map((cs) => (
                  <div key={cs.key} className="text-center">
                    <div className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-[11px] font-mono font-bold mb-1" style={{ backgroundColor: `${cs.color}15`, border: `1px solid ${cs.color}30`, color: cs.color }}>{cs.icon}</div>
                    <p className="text-[9px] font-mono text-white/40">{cs.key}</p>
                    <p className="text-[9px] font-mono" style={{ color: cs.color }}>{cs.earned}/{cs.count}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
          <div className="flex flex-wrap gap-2 mb-4">
            {catStats.map((cs) => (
              <motion.button key={cs.key} onClick={() => setActiveCategory(cs.key)} whileTap={{ scale: 0.95 }} className={`relative px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all ${activeCategory === cs.key ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-400' : 'bg-black/20 border border-white/5 text-white/40 hover:text-white/60 hover:border-white/10'}`}>
                <span>{cs.key}</span>
                <span className={`ml-1.5 text-[9px] ${activeCategory === cs.key ? 'text-cyan-400/60' : 'text-white/20'}`}>{cs.earned}/{cs.count}</span>
                {activeCategory === cs.key && <motion.div layoutId="achTab" className="absolute inset-0 rounded-xl border border-cyan-500/40" transition={{ type: 'spring', stiffness: 500, damping: 30 }} />}
              </motion.button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((a, i) => <AchievementCard key={a.id} a={a} index={i} />)}
          </div>
        </section>

        {/* ============ How It Works ============ */}
        <section>
          <SectionHeader tag="Guide" title="How It Works" delay={0.1 / PHI} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="none" className="p-5">
              <div className="space-y-4">
                {[
                  {
                    step: '01',
                    title: 'Participate',
                    desc: 'Trade, provide liquidity, vote on governance, and engage with the community to earn XP.',
                    color: '#22c55e',
                  },
                  {
                    step: '02',
                    title: 'Complete Quests',
                    desc: 'Daily and weekly quests rotate automatically. Complete them for bonus XP and VIBE rewards.',
                    color: '#3b82f6',
                  },
                  {
                    step: '03',
                    title: 'Unlock Achievements',
                    desc: 'Each achievement tracks on-chain activity. Reach milestones to earn badges, XP, and tokens.',
                    color: '#8b5cf6',
                  },
                  {
                    step: '04',
                    title: 'Level Up',
                    desc: 'XP accumulates across all activities. Higher levels unlock exclusive features and multipliers.',
                    color: '#f59e0b',
                  },
                ].map((s, i) => (
                  <motion.div
                    key={s.step}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * (0.08 / PHI), duration: 1 / PHI }}
                    className="flex items-start gap-4"
                  >
                    <div
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono text-xs font-bold"
                      style={{
                        backgroundColor: `${s.color}15`,
                        border: `1px solid ${s.color}33`,
                        color: s.color,
                      }}
                    >
                      {s.step}
                    </div>
                    <div>
                      <p className="text-sm font-bold font-mono text-white">{s.title}</p>
                      <p className="text-[11px] font-mono text-white/40 leading-relaxed">{s.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Connect Prompt ============ */}
        {!isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI }}
          >
            <GlassCard glowColor="terminal" className="p-6">
              <div className="text-center">
                <div
                  className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${CYAN}15`, border: `2px solid ${CYAN}33` }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <p className="text-lg font-bold font-mono text-white mb-2">
                  Sign In to Track Progress
                </p>
                <p className="text-xs font-mono text-white/40 max-w-md mx-auto">
                  Sign in with your wallet to track achievements, complete quests,
                  and earn XP and VIBE rewards through protocol participation.
                </p>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Explore More ============ */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2, duration: 1 / PHI }} className="flex flex-wrap justify-center gap-3 pt-4">
          <a href="/badges" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Badges</a>
          <a href="/leaderboard" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Leaderboard</a>
          <a href="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Rewards</a>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3, duration: 1 / PHI }} className="text-center">
          <p className="text-[10px] font-mono text-white/30">"The cave selects for those who see past what is to what could be."</p>
        </motion.div>
      </div>
    </div>
  )
}
