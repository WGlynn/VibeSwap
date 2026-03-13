import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Achievements & Quests ============
// Gamified progression system: XP levels, daily/weekly quests,
// achievement categories, seasonal events, and streak tracking.
// Seeded PRNG (2020) for deterministic mock data.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease: [0.25, 0.1, 0.25, 1] },
  }),
}

const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease: [0.25, 0.1, 0.25, 1] },
  }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const RNG = seededRandom(2020)

// ============ XP & Level System ============

const LEVEL_BASE_XP = 1000
const LEVEL_SCALE = PHI

function xpForLevel(level) {
  return Math.floor(LEVEL_BASE_XP * Math.pow(LEVEL_SCALE, level - 1))
}

const USER_LEVEL = 14
const USER_XP = 8420
const XP_CURRENT_LEVEL = xpForLevel(USER_LEVEL)
const XP_NEXT_LEVEL = xpForLevel(USER_LEVEL + 1)
const XP_IN_LEVEL = USER_XP - XP_CURRENT_LEVEL
const XP_NEEDED = XP_NEXT_LEVEL - XP_CURRENT_LEVEL
const XP_PERCENT = Math.min(100, Math.round((XP_IN_LEVEL / XP_NEEDED) * 100))

// ============ Achievement Categories ============

const CATEGORIES = [
  { key: 'Trading', icon: 'T', color: '#22c55e', label: 'Trading' },
  { key: 'Liquidity', icon: 'L', color: '#06b6d4', label: 'Liquidity' },
  { key: 'Governance', icon: 'G', color: '#8b5cf6', label: 'Governance' },
  { key: 'Community', icon: 'C', color: '#f59e0b', label: 'Community' },
  { key: 'Explorer', icon: 'E', color: '#ec4899', label: 'Explorer' },
]

// ============ Achievement Data ============

const ALL_ACHIEVEMENTS = [
  // Trading
  { id: 'T01', cat: 'Trading', title: 'First Trade', desc: 'Execute your first swap on VibeSwap', progress: 100, reward: { xp: 50, vibe: 10 }, badge: 'Novice Trader', icon: 'T' },
  { id: 'T02', cat: 'Trading', title: 'Batch Warrior', desc: 'Participate in 50 commit-reveal batch auctions', progress: 72, reward: { xp: 200, vibe: 50 }, badge: null, icon: 'T' },
  { id: 'T03', cat: 'Trading', title: 'Volume King', desc: 'Trade over $100,000 in cumulative volume', progress: 38, reward: { xp: 500, vibe: 200 }, badge: 'Volume King', icon: 'T' },
  { id: 'T04', cat: 'Trading', title: 'MEV Slayer', desc: 'Complete 100 trades with zero MEV extraction', progress: 100, reward: { xp: 300, vibe: 100 }, badge: 'MEV Slayer', icon: 'T' },
  { id: 'T05', cat: 'Trading', title: 'Multichain Trader', desc: 'Execute trades on 3+ chains via LayerZero', progress: 66, reward: { xp: 250, vibe: 80 }, badge: null, icon: 'T' },
  { id: 'T06', cat: 'Trading', title: 'Perfect Reveal', desc: 'Submit 200 consecutive valid reveals without slashing', progress: 100, reward: { xp: 400, vibe: 150 }, badge: 'Fair Player', icon: 'T' },

  // Liquidity
  { id: 'L01', cat: 'Liquidity', title: 'LP Genesis', desc: 'Provide liquidity for the first time', progress: 100, reward: { xp: 75, vibe: 15 }, badge: 'LP Pioneer', icon: 'L' },
  { id: 'L02', cat: 'Liquidity', title: 'Deep Pools', desc: 'Provide liquidity to 5 different pools simultaneously', progress: 60, reward: { xp: 300, vibe: 120 }, badge: null, icon: 'L' },
  { id: 'L03', cat: 'Liquidity', title: 'Diamond LP', desc: 'Maintain an LP position for 90+ consecutive days', progress: 44, reward: { xp: 500, vibe: 250 }, badge: 'Diamond LP', icon: 'L' },
  { id: 'L04', cat: 'Liquidity', title: 'Fee Harvester', desc: 'Earn $1,000+ in LP fees from a single pool', progress: 22, reward: { xp: 350, vibe: 100 }, badge: null, icon: 'L' },
  { id: 'L05', cat: 'Liquidity', title: 'IL Survivor', desc: 'Maintain a positive position after impermanent loss protection kicks in', progress: 100, reward: { xp: 200, vibe: 75 }, badge: 'IL Survivor', icon: 'L' },

  // Governance
  { id: 'G01', cat: 'Governance', title: 'First Vote', desc: 'Cast your first governance vote', progress: 100, reward: { xp: 50, vibe: 10 }, badge: 'Citizen', icon: 'G' },
  { id: 'G02', cat: 'Governance', title: 'Proposal Author', desc: 'Submit a governance proposal that reaches quorum', progress: 0, reward: { xp: 500, vibe: 300 }, badge: 'Proposal Author', icon: 'G' },
  { id: 'G03', cat: 'Governance', title: 'Delegate Leader', desc: 'Receive delegation from 10+ unique wallets', progress: 30, reward: { xp: 400, vibe: 200 }, badge: null, icon: 'G' },
  { id: 'G04', cat: 'Governance', title: 'Perfect Attendance', desc: 'Vote on 25 consecutive proposals without missing one', progress: 84, reward: { xp: 350, vibe: 150 }, badge: 'Guardian', icon: 'G' },
  { id: 'G05', cat: 'Governance', title: 'Treasury Steward', desc: 'Participate in 5 treasury allocation votes', progress: 100, reward: { xp: 200, vibe: 80 }, badge: 'Steward', icon: 'G' },

  // Community
  { id: 'C01', cat: 'Community', title: 'Early Adopter', desc: 'Join VibeSwap within the first 30 days of launch', progress: 100, reward: { xp: 200, vibe: 50 }, badge: 'OG', icon: 'C' },
  { id: 'C02', cat: 'Community', title: 'Referral Network', desc: 'Successfully refer 10 active users', progress: 50, reward: { xp: 400, vibe: 200 }, badge: null, icon: 'C' },
  { id: 'C03', cat: 'Community', title: 'Bug Hunter', desc: 'Report a verified bug through the security bounty program', progress: 0, reward: { xp: 750, vibe: 500 }, badge: 'Bug Hunter', icon: 'C' },
  { id: 'C04', cat: 'Community', title: 'Vibe Ambassador', desc: 'Create educational content about VibeSwap shared 100+ times', progress: 15, reward: { xp: 500, vibe: 250 }, badge: 'Ambassador', icon: 'C' },
  { id: 'C05', cat: 'Community', title: 'Forum Regular', desc: 'Post 50 constructive forum contributions', progress: 100, reward: { xp: 150, vibe: 40 }, badge: 'Regular', icon: 'C' },

  // Explorer
  { id: 'E01', cat: 'Explorer', title: 'Chain Hopper', desc: 'Bridge assets to 5 different chains via LayerZero', progress: 40, reward: { xp: 300, vibe: 100 }, badge: null, icon: 'E' },
  { id: 'E02', cat: 'Explorer', title: 'Feature Explorer', desc: 'Use every core feature at least once (swap, LP, stake, bridge, vote)', progress: 80, reward: { xp: 250, vibe: 80 }, badge: 'Explorer', icon: 'E' },
  { id: 'E03', cat: 'Explorer', title: 'Vault Master', desc: 'Deposit into 3 different vault strategies', progress: 33, reward: { xp: 200, vibe: 60 }, badge: null, icon: 'E' },
  { id: 'E04', cat: 'Explorer', title: 'Oracle Watcher', desc: 'Monitor TWAP oracle data for 30 consecutive batches', progress: 100, reward: { xp: 150, vibe: 45 }, badge: 'Oracle Watcher', icon: 'E' },
  { id: 'E05', cat: 'Explorer', title: 'Gas Optimizer', desc: 'Execute 50 transactions during low-gas periods', progress: 56, reward: { xp: 200, vibe: 70 }, badge: null, icon: 'E' },
  { id: 'E06', cat: 'Explorer', title: 'Omnichain Native', desc: 'Hold positions on 5+ chains simultaneously', progress: 20, reward: { xp: 600, vibe: 300 }, badge: 'Omnichain Native', icon: 'E' },
]

// ============ Daily Quests ============

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
  // Shuffle and pick 3 using seeded PRNG
  for (let i = quests.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[quests[i], quests[j]] = [quests[j], quests[i]]
  }
  return quests.slice(0, 3)
}

// ============ Weekly Challenges ============

function generateWeeklyChallenges() {
  const rng = seededRandom(2020)
  const challenges = [
    { title: 'Volume Sprint', desc: 'Trade $10,000+ in cumulative volume this week', reward: { xp: 150, vibe: 50 }, progress: 6200, target: 10000, unit: '$' },
    { title: 'LP Marathon', desc: 'Keep LP position active for 7 consecutive days', reward: { xp: 200, vibe: 75 }, progress: 5, target: 7, unit: 'days' },
    { title: 'Governance Week', desc: 'Vote on 3 different proposals this week', reward: { xp: 120, vibe: 40 }, progress: 1, target: 3, unit: 'votes' },
    { title: 'Cross-Chain Quest', desc: 'Bridge assets to 2 new chains this week', reward: { xp: 180, vibe: 60 }, progress: 0, target: 2, unit: 'chains' },
    { title: 'Social Butterfly', desc: 'Refer 2 new users who complete their first trade', reward: { xp: 250, vibe: 100 }, progress: 1, target: 2, unit: 'referrals' },
  ]
  for (let i = challenges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[challenges[i], challenges[j]] = [challenges[j], challenges[i]]
  }
  return challenges.slice(0, 3)
}

// ============ Seasonal Event Data ============

const SEASONAL_EVENTS = [
  {
    name: 'Summer of DeFi',
    desc: 'Earn 3x XP on all trading activities and unlock exclusive seasonal badges',
    startLabel: 'Jun 1',
    endLabel: 'Aug 31',
    active: false,
    color: '#f59e0b',
    multiplier: '3x XP',
    badge: 'Summer Trader',
  },
  {
    name: 'Omnichain Odyssey',
    desc: 'Bridge to 5 chains and complete cross-chain swaps for bonus VIBE rewards',
    startLabel: 'Mar 1',
    endLabel: 'Mar 31',
    active: true,
    color: '#06b6d4',
    multiplier: '2x VIBE',
    badge: 'Odyssey Pioneer',
  },
  {
    name: 'Governance Season',
    desc: 'Double XP for all governance participation. Shape the future of VibeSwap.',
    startLabel: 'Apr 15',
    endLabel: 'May 15',
    active: false,
    color: '#8b5cf6',
    multiplier: '2x XP',
    badge: 'Season Delegate',
  },
]

// ============ Streak Data ============

const STREAK_CURRENT = 12
const STREAK_BEST = 34
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100]

// ============ Totals ============

const TOTAL_EARNED = ALL_ACHIEVEMENTS.filter((a) => a.progress === 100).length
const TOTAL_AVAILABLE = ALL_ACHIEVEMENTS.length

// ============ Section Header ============

function SectionHeader({ tag, title, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 1 / PHI, ease: 'easeOut' }}
      className="mb-4"
    >
      <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Progress Bar ============

function ProgressBar({ percent, color = CYAN, height = 6, delay = 0.3 }) {
  return (
    <div className="h-full bg-black/30 rounded-full overflow-hidden" style={{ height }}>
      <motion.div
        initial={{ width: 0 }}
        whileInView={{ width: `${percent}%` }}
        viewport={{ once: true }}
        transition={{ delay, duration: 0.8, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  )
}

// ============ Achievement Icon ============

function AchievementIcon({ letter, color, completed, size = 44 }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-xl font-mono font-bold shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: completed ? `${color}22` : 'rgba(255,255,255,0.03)',
        border: `2px solid ${completed ? color : 'rgba(255,255,255,0.08)'}`,
        color: completed ? color : 'rgba(255,255,255,0.15)',
        fontSize: size * 0.4,
      }}
    >
      {letter}
      {completed && (
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
  )
}

// ============ Achievement Card ============

function AchievementCard({ achievement, index }) {
  const cat = CATEGORIES.find((c) => c.key === achievement.cat)
  const color = cat?.color || CYAN
  const completed = achievement.progress === 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: index * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard
        glowColor={completed ? 'terminal' : 'none'}
        className={`p-4 h-full ${!completed ? 'opacity-70' : ''}`}
      >
        <div className="flex items-start gap-3">
          <AchievementIcon letter={achievement.icon} color={color} completed={completed} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-bold font-mono text-white truncate">{achievement.title}</p>
              {achievement.badge && completed && (
                <span
                  className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}33` }}
                >
                  {achievement.badge}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">{achievement.desc}</p>

            {/* Reward pills */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                +{achievement.reward.xp} XP
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                +{achievement.reward.vibe} VIBE
              </span>
              {achievement.badge && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  Badge
                </span>
              )}
            </div>

            {/* Progress */}
            {!completed && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-mono text-white/30 uppercase">Progress</span>
                  <span className="text-[9px] font-mono text-white/40">{achievement.progress}%</span>
                </div>
                <ProgressBar percent={achievement.progress} color={color} height={4} delay={0.2 + index * 0.04} />
              </div>
            )}

            {completed && (
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

// ============ Quest Card ============

function QuestCard({ quest, index, type = 'daily' }) {
  const completed = quest.progress >= quest.target
  const pct = Math.min(100, Math.round((quest.progress / quest.target) * 100))
  const accentColor = type === 'daily' ? '#22c55e' : '#f59e0b'

  return (
    <motion.div
      custom={index}
      variants={cardV}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      <GlassCard glowColor={completed ? 'matrix' : 'none'} className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className={`text-sm font-bold font-mono ${completed ? 'text-white' : 'text-white/80'}`}>
                {quest.title}
              </p>
              {completed && (
                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: accentColor }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </div>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">{quest.desc}</p>

            {/* Progress */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-white/30 uppercase">
                {quest.progress}/{quest.target}
              </span>
              <span className="text-[9px] font-mono text-white/40">{pct}%</span>
            </div>
            <ProgressBar percent={pct} color={accentColor} height={4} delay={0.15 + index * 0.08} />
          </div>

          {/* Reward */}
          <div className="shrink-0 text-right">
            <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
            <div className="text-[10px] font-mono" style={{ color: CYAN }}>+{quest.reward.xp} XP</div>
            <div className="text-[10px] font-mono text-green-400">+{quest.reward.vibe} VIBE</div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Weekly Challenge Card ============

function WeeklyChallengeCard({ challenge, index }) {
  const completed = challenge.progress >= challenge.target
  const pct = Math.min(100, Math.round((challenge.progress / challenge.target) * 100))
  const color = '#f59e0b'

  const progressLabel = challenge.unit === '$'
    ? `$${challenge.progress.toLocaleString()} / $${challenge.target.toLocaleString()}`
    : `${challenge.progress} / ${challenge.target} ${challenge.unit}`

  return (
    <motion.div
      custom={index}
      variants={cardV}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      <GlassCard glowColor={completed ? 'warning' : 'none'} className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
                style={{ backgroundColor: `${color}15`, border: `1px solid ${color}33`, color }}
              >
                W
              </div>
              <p className={`text-sm font-bold font-mono ${completed ? 'text-white' : 'text-white/80'}`}>
                {challenge.title}
              </p>
            </div>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2 ml-8">{challenge.desc}</p>

            <div className="ml-8">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-mono text-white/30">{progressLabel}</span>
                <span className="text-[9px] font-mono text-white/40">{pct}%</span>
              </div>
              <ProgressBar percent={pct} color={color} height={4} delay={0.2 + index * 0.1} />
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
            <div className="text-[10px] font-mono" style={{ color: CYAN }}>+{challenge.reward.xp} XP</div>
            <div className="text-[10px] font-mono text-green-400">+{challenge.reward.vibe} VIBE</div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Category Tab ============

function CategoryTab({ category, isActive, onClick, count, earnedCount }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`relative px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all ${
        isActive
          ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-400'
          : 'bg-black/20 border border-white/5 text-white/40 hover:text-white/60 hover:border-white/10'
      }`}
    >
      <span>{category.label}</span>
      <span className={`ml-1.5 text-[9px] ${isActive ? 'text-cyan-400/60' : 'text-white/20'}`}>
        {earnedCount}/{count}
      </span>
      {isActive && (
        <motion.div
          layoutId="achievementActiveTab"
          className="absolute inset-0 rounded-xl border border-cyan-500/40"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}
    </motion.button>
  )
}

// ============ Streak Flame ============

function StreakFlame({ days, best }) {
  const flameIntensity = Math.min(1, days / 30)

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: `rgba(249, 115, 22, ${0.08 + flameIntensity * 0.12})`,
          border: `2px solid rgba(249, 115, 22, ${0.2 + flameIntensity * 0.3})`,
          boxShadow: `0 0 ${Math.round(flameIntensity * 20)}px rgba(249, 115, 22, ${flameIntensity * 0.3})`,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z"
            fill={`rgba(249, 115, 22, ${0.4 + flameIntensity * 0.4})`}
            stroke="rgba(249, 115, 22, 0.8)"
            strokeWidth="1.5"
          />
          <path
            d="M12 8c0 2-2 3-2 5a2 2 0 0 0 4 0c0-2-2-3-2-5z"
            fill={`rgba(251, 191, 36, ${0.5 + flameIntensity * 0.3})`}
            stroke="none"
          />
        </svg>
      </div>
      <div>
        <div className="text-2xl font-bold font-mono text-orange-400">{days}</div>
        <div className="text-[10px] font-mono text-white/40">day streak</div>
      </div>
      <div className="ml-auto text-right">
        <div className="text-[10px] font-mono text-white/30 uppercase">Best</div>
        <div className="text-sm font-bold font-mono text-white/60">{best} days</div>
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function AchievementsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('Trading')

  // ============ Derived State ============

  const dailyQuests = useMemo(() => generateDailyQuests(), [])
  const weeklyChallenges = useMemo(() => generateWeeklyChallenges(), [])

  const filteredAchievements = ALL_ACHIEVEMENTS.filter((a) => a.cat === activeCategory)

  const categoryStats = CATEGORIES.map((cat) => {
    const inCat = ALL_ACHIEVEMENTS.filter((a) => a.cat === cat.key)
    return {
      ...cat,
      count: inCat.length,
      earned: inCat.filter((a) => a.progress === 100).length,
    }
  })

  const totalXPEarned = ALL_ACHIEVEMENTS
    .filter((a) => a.progress === 100)
    .reduce((sum, a) => sum + a.reward.xp, 0)

  const totalVIBEEarned = ALL_ACHIEVEMENTS
    .filter((a) => a.progress === 100)
    .reduce((sum, a) => sum + a.reward.vibe, 0)

  const dailyCompleted = dailyQuests.filter((q) => q.progress >= q.target).length
  const weeklyCompleted = weeklyChallenges.filter((c) => c.progress >= c.target).length

  // Time-until-reset (seeded, static for deterministic display)
  const rng2 = seededRandom(2020)
  const dailyResetH = Math.floor(rng2() * 12) + 1
  const dailyResetM = Math.floor(rng2() * 60)
  const weeklyResetD = Math.floor(rng2() * 5) + 1

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Page Hero ============ */}
      <PageHero
        title="Achievements & Quests"
        subtitle="Level up through protocol participation and earn rewards"
        category="account"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-4xl mx-auto px-4 space-y-10">

        {/* ============ Section 1: XP Bar & Level ============ */}
        <section>
          <SectionHeader tag="Progression" title="Your Level" delay={0.1} />
          <motion.div
            custom={0}
            variants={sectionV}
            initial="hidden"
            animate="visible"
          >
            <GlassCard glowColor="terminal" spotlight className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-xl"
                    style={{ backgroundColor: `${CYAN}15`, border: `2px solid ${CYAN}40`, color: CYAN }}
                  >
                    {USER_LEVEL}
                  </div>
                  <div>
                    <p className="text-sm font-bold font-mono text-white">Level {USER_LEVEL}</p>
                    <p className="text-[10px] font-mono text-white/40">
                      {XP_IN_LEVEL.toLocaleString()} / {XP_NEEDED.toLocaleString()} XP to Level {USER_LEVEL + 1}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold font-mono" style={{ color: CYAN }}>
                    {USER_XP.toLocaleString()}
                  </p>
                  <p className="text-[9px] font-mono text-white/30 uppercase">Total XP</p>
                </div>
              </div>

              {/* XP bar */}
              <div className="relative">
                <div className="h-3 bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${XP_PERCENT}%` }}
                    transition={{ delay: 0.4, duration: 1.2, ease: 'easeOut' }}
                    className="h-full rounded-full relative"
                    style={{
                      background: `linear-gradient(90deg, ${CYAN}, #22d3ee)`,
                      boxShadow: `0 0 12px ${CYAN}60`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[9px] font-mono text-white/30">Lv {USER_LEVEL}</span>
                  <span className="text-[9px] font-mono" style={{ color: CYAN }}>{XP_PERCENT}%</span>
                  <span className="text-[9px] font-mono text-white/30">Lv {USER_LEVEL + 1}</span>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-center">
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">Achievements</div>
                  <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>
                    {TOTAL_EARNED}<span className="text-white/30 text-xs">/{TOTAL_AVAILABLE}</span>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">XP Earned</div>
                  <div className="text-sm font-bold font-mono text-white">{totalXPEarned.toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">VIBE Earned</div>
                  <div className="text-sm font-bold font-mono text-green-400">{totalVIBEEarned.toLocaleString()}</div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 2: Streak Tracker ============ */}
        <section>
          <SectionHeader tag="Consistency" title="Streak Tracker" delay={0.1 / PHI} />
          <motion.div
            custom={1}
            variants={sectionV}
            initial="hidden"
            animate="visible"
          >
            <GlassCard glowColor="warning" className="p-5">
              <StreakFlame days={STREAK_CURRENT} best={STREAK_BEST} />

              {/* Milestone markers */}
              <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[9px] font-mono text-white/30 uppercase mb-3">Milestones</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {STREAK_MILESTONES.map((ms) => {
                    const reached = STREAK_CURRENT >= ms
                    return (
                      <div
                        key={ms}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold"
                        style={{
                          backgroundColor: reached ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${reached ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.06)'}`,
                          color: reached ? '#f97316' : 'rgba(255,255,255,0.2)',
                        }}
                      >
                        {ms}d
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] font-mono text-white/30 mt-3">
                  Next milestone: <span style={{ color: '#f97316' }}>{STREAK_MILESTONES.find((m) => m > STREAK_CURRENT) || 100} days</span>
                  {' '} — keep trading daily to maintain your streak
                </p>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 3: Daily Quests ============ */}
        <section>
          <SectionHeader tag="Daily" title="Daily Quests" delay={0.1 / (PHI * PHI)} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="flex items-center justify-between mb-3"
          >
            <span className="text-[10px] font-mono text-white/40">
              Completed: <span style={{ color: CYAN }}>{dailyCompleted}/3</span>
            </span>
            <span className="text-[10px] font-mono text-white/30">
              Resets in {dailyResetH}h {dailyResetM}m
            </span>
          </motion.div>
          <div className="space-y-3">
            {dailyQuests.map((quest, i) => (
              <QuestCard key={i} quest={quest} index={i} type="daily" />
            ))}
          </div>
        </section>

        {/* ============ Section 4: Weekly Challenges ============ */}
        <section>
          <SectionHeader tag="Weekly" title="Weekly Challenges" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="flex items-center justify-between mb-3"
          >
            <span className="text-[10px] font-mono text-white/40">
              Completed: <span style={{ color: '#f59e0b' }}>{weeklyCompleted}/3</span>
            </span>
            <span className="text-[10px] font-mono text-white/30">
              Resets in {weeklyResetD}d
            </span>
          </motion.div>
          <div className="space-y-3">
            {weeklyChallenges.map((challenge, i) => (
              <WeeklyChallengeCard key={i} challenge={challenge} index={i} />
            ))}
          </div>
        </section>

        {/* ============ Section 5: Seasonal Events ============ */}
        <section>
          <SectionHeader tag="Seasonal" title="Events & Seasons" delay={0.1 / PHI} />
          <div className="space-y-3">
            {SEASONAL_EVENTS.map((event, i) => (
              <motion.div
                key={event.name}
                custom={i}
                variants={cardV}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-40px' }}
              >
                <GlassCard
                  glowColor={event.active ? 'terminal' : 'none'}
                  className={`p-4 ${!event.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-bold font-mono text-white">{event.name}</p>
                        {event.active && (
                          <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            Active
                          </span>
                        )}
                        {!event.active && (
                          <span className="text-[9px] font-mono text-white/30 uppercase px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10">
                            Upcoming
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">{event.desc}</p>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono text-white/30">
                          {event.startLabel} — {event.endLabel}
                        </span>
                        <span
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
                          style={{ color: event.color, backgroundColor: `${event.color}15`, border: `1px solid ${event.color}33` }}
                        >
                          {event.multiplier}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
                      <span
                        className="text-[9px] font-mono font-bold px-2 py-1 rounded-lg inline-block"
                        style={{ color: event.color, backgroundColor: `${event.color}10`, border: `1px solid ${event.color}25` }}
                      >
                        {event.badge}
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ============ Section 6: Achievement Categories ============ */}
        <section>
          <SectionHeader tag="Achievements" title="Achievement Gallery" delay={0.1 / (PHI * PHI)} />

          {/* Unlocked counter */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="mb-4"
          >
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono text-white/40 uppercase mb-0.5">Total Unlocked</p>
                  <p className="text-xl font-bold font-mono" style={{ color: CYAN }}>
                    {TOTAL_EARNED}
                    <span className="text-sm text-white/30 ml-1">/ {TOTAL_AVAILABLE}</span>
                  </p>
                </div>
                <div className="w-32">
                  <ProgressBar
                    percent={Math.round((TOTAL_EARNED / TOTAL_AVAILABLE) * 100)}
                    color={CYAN}
                    height={6}
                    delay={0.4}
                  />
                  <p className="text-[9px] font-mono text-white/30 text-right mt-1">
                    {Math.round((TOTAL_EARNED / TOTAL_AVAILABLE) * 100)}% complete
                  </p>
                </div>
              </div>

              {/* Per-category mini bars */}
              <div className="grid grid-cols-5 gap-2 mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {categoryStats.map((cs) => (
                  <div key={cs.key} className="text-center">
                    <div
                      className="w-8 h-8 mx-auto rounded-lg flex items-center justify-center text-[11px] font-mono font-bold mb-1"
                      style={{
                        backgroundColor: `${cs.color}15`,
                        border: `1px solid ${cs.color}30`,
                        color: cs.color,
                      }}
                    >
                      {cs.icon}
                    </div>
                    <p className="text-[9px] font-mono text-white/40">{cs.label}</p>
                    <p className="text-[9px] font-mono" style={{ color: cs.color }}>
                      {cs.earned}/{cs.count}
                    </p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* Category tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="flex flex-wrap gap-2 mb-4"
          >
            {categoryStats.map((cs) => (
              <CategoryTab
                key={cs.key}
                category={cs}
                isActive={activeCategory === cs.key}
                onClick={() => setActiveCategory(cs.key)}
                count={cs.count}
                earnedCount={cs.earned}
              />
            ))}
          </motion.div>

          {/* Achievement grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredAchievements.map((achievement, i) => (
              <AchievementCard key={achievement.id} achievement={achievement} index={i} />
            ))}
          </div>
        </section>

        {/* ============ Connect Prompt (if not connected) ============ */}
        {!isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
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
                <p className="text-lg font-bold font-mono text-white mb-2">Connect Wallet to Track Progress</p>
                <p className="text-xs font-mono text-white/40 max-w-md mx-auto">
                  Sign in with your wallet to track achievements, complete quests, and earn XP and VIBE rewards
                  through protocol participation.
                </p>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Explore More ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="flex flex-wrap justify-center gap-3 pt-4"
        >
          <a href="/badges" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Badges</a>
          <a href="/leaderboard" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Leaderboard</a>
          <a href="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Rewards</a>
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-white/30">
            "The cave selects for those who see past what is to what could be."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
