import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Social Profile Page ============
// Public user profile with trading stats, soulbound badges,
// activity feed, reputation metrics, and portfolio overview.
// Address param seeds deterministic PRNG for consistent mock data.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

function hashAddress(addr) {
  let hash = 0
  const str = String(addr || '0x0000')
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

// ============ Animation Variants ============

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

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
      <span className="text-[10px] font-mono text-purple-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Avatar Generator ============

function GeneratedAvatar({ seed, size = 80 }) {
  const rng = seededRandom(seed)
  const hue1 = Math.floor(rng() * 360)
  const hue2 = (hue1 + 60 + Math.floor(rng() * 120)) % 360
  const hue3 = (hue2 + 40 + Math.floor(rng() * 80)) % 360
  const angle = Math.floor(rng() * 360)

  const cells = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (rng() > 0.4) {
        const cellHue = rng() > 0.5 ? hue1 : hue2
        cells.push({ row, col, hue: cellHue })
        if (col < 2) {
          cells.push({ row, col: 4 - col, hue: cellHue })
        }
      }
    }
  }

  const cellSize = size / 5
  return (
    <div
      className="rounded-full overflow-hidden flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, hsl(${hue1},70%,20%), hsl(${hue3},60%,12%))`,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.col * cellSize}
            y={c.row * cellSize}
            width={cellSize}
            height={cellSize}
            fill={`hsla(${c.hue},65%,55%,0.7)`}
            rx="1"
          />
        ))}
      </svg>
    </div>
  )
}

// ============ XP Progress Bar ============

function XPBar({ current, max, level }) {
  const pct = Math.min((current / max) * 100, 100)
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-black-500 uppercase">Level {level}</span>
        <span className="text-[10px] font-mono text-purple-400">
          {current.toLocaleString()} / {max.toLocaleString()} XP
        </span>
      </div>
      <div className="h-2.5 bg-black/30 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, #8b5cf6, ${CYAN})` }}
        />
      </div>
    </div>
  )
}

// ============ Stat Card ============

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <motion.div variants={fadeUp}>
      <GlassCard className="p-4">
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">{label}</div>
        <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
        {sub && <div className="text-[10px] font-mono text-black-500 mt-1">{sub}</div>}
      </GlassCard>
    </motion.div>
  )
}

// ============ Badge Icon ============

function BadgeIcon({ badge }) {
  const unlocked = badge.unlocked
  return (
    <motion.div
      variants={fadeUp}
      className="flex flex-col items-center gap-2"
      title={badge.description}
    >
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center text-sm font-bold font-mono border-2 transition-all ${
          unlocked
            ? 'border-purple-400/60 shadow-lg shadow-purple-500/10'
            : 'border-black-700/40 opacity-40 grayscale'
        }`}
        style={{
          background: unlocked
            ? `linear-gradient(135deg, ${badge.color}22, ${badge.color}08)`
            : 'rgba(0,0,0,0.3)',
          color: unlocked ? badge.color : 'rgba(255,255,255,0.3)',
        }}
      >
        {unlocked ? badge.code : '?'}
      </div>
      <div className="text-center">
        <div className={`text-[10px] font-mono leading-tight ${unlocked ? 'text-white' : 'text-black-600'}`}>
          {badge.name}
        </div>
        {unlocked && (
          <div className="text-[8px] font-mono text-purple-400/60 mt-0.5">Earned</div>
        )}
      </div>
    </motion.div>
  )
}

// ============ Activity Item ============

function ActivityItem({ activity, index }) {
  const iconMap = {
    swap: { icon: 'SW', color: '#22c55e' },
    lp: { icon: 'LP', color: '#06b6d4' },
    vote: { icon: 'VT', color: '#8b5cf6' },
    badge: { icon: 'BD', color: '#f59e0b' },
  }
  const { icon, color } = iconMap[activity.type] || iconMap.swap

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04, duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className="flex items-start gap-3 py-3 border-b border-black-800/50 last:border-0"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 mt-0.5"
        style={{
          background: `${color}15`,
          color: color,
          border: `1px solid ${color}30`,
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-white">{activity.description}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono text-black-500">{activity.time}</span>
          <span className="text-[10px] font-mono text-cyan-400/50 hover:text-cyan-400 cursor-pointer">
            {activity.txHash}
          </span>
        </div>
      </div>
      {activity.amount && (
        <div className={`text-sm font-mono font-bold ${
          activity.amount.startsWith('+') ? 'text-green-400' : 'text-red-400'
        }`}>
          {activity.amount}
        </div>
      )}
    </motion.div>
  )
}

// ============ Contribution Heatmap (7x4 grid) ============

function ContributionHeatmap({ rng }) {
  const weeks = 7
  const days = 4
  const cellSize = 14
  const gap = 3

  const cells = []
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const intensity = rng()
      let color
      if (intensity < 0.2) color = 'rgba(139,92,246,0.05)'
      else if (intensity < 0.4) color = 'rgba(139,92,246,0.15)'
      else if (intensity < 0.6) color = 'rgba(139,92,246,0.30)'
      else if (intensity < 0.8) color = 'rgba(139,92,246,0.50)'
      else color = 'rgba(139,92,246,0.75)'

      cells.push({
        x: w * (cellSize + gap),
        y: d * (cellSize + gap),
        color,
        count: Math.floor(intensity * 12),
      })
    }
  }

  const totalW = weeks * (cellSize + gap) - gap
  const totalH = days * (cellSize + gap) - gap

  return (
    <div>
      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
        Activity (last 28 days)
      </div>
      <svg width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`}>
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={cellSize}
            height={cellSize}
            rx="2"
            fill={c.color}
            stroke="rgba(255,255,255,0.03)"
            strokeWidth="0.5"
          />
        ))}
      </svg>
      <div className="flex items-center gap-1 mt-2">
        <span className="text-[9px] font-mono text-black-600">Less</span>
        {[0.05, 0.15, 0.30, 0.50, 0.75].map((op, i) => (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-sm"
            style={{ background: `rgba(139,92,246,${op})` }}
          />
        ))}
        <span className="text-[9px] font-mono text-black-600">More</span>
      </div>
    </div>
  )
}

// ============ Portfolio Bar Chart ============

function PortfolioBar({ token, percentage, value, color, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.06, duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className="flex items-center gap-3"
    >
      <div className="w-12 text-right">
        <span className="text-xs font-mono font-bold text-white">{token}</span>
      </div>
      <div className="flex-1 h-6 bg-black/30 rounded-full overflow-hidden relative">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${percentage}%` }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 + index * 0.06, duration: 1 / PHI, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}cc, ${color}66)` }}
        />
        <span className="absolute inset-0 flex items-center pl-3 text-[10px] font-mono text-white/80 font-bold">
          {percentage > 15 ? `${percentage.toFixed(1)}%` : ''}
        </span>
      </div>
      <div className="w-20 text-right">
        <span className="text-xs font-mono text-black-400">${value.toLocaleString()}</span>
      </div>
    </motion.div>
  )
}

// ============ Mock Data Generator ============

function generateMockData(addressHash) {
  const rng = seededRandom(addressHash)

  // Usernames pool
  const usernames = [
    'vibemaster.eth', 'cryptonaut.eth', 'defi_whale.eth', 'ser_yield.eth',
    'batched.eth', 'fair_trader.eth', 'mev_slayer.eth', 'lp_king.eth',
    'onchain.eth', 'shapley.eth', 'commit_reveal.eth', 'batch_boss.eth',
  ]
  const username = usernames[Math.floor(rng() * usernames.length)]

  // Join dates pool
  const joinMonths = [
    'October 2024', 'November 2024', 'December 2024', 'January 2025',
    'February 2025', 'March 2025', 'August 2024', 'September 2024',
  ]
  const joinDate = joinMonths[Math.floor(rng() * joinMonths.length)]

  // Bio pool
  const bios = [
    'DeFi researcher and LP enthusiast. Building in the batch auction space.',
    'On-chain maximalist. Fair markets or no markets.',
    'Early VibeSwap adopter. Commit-reveal is the way.',
    'Trading since 2019. MEV elimination is my passion.',
    'Community builder. Cooperative capitalism believer.',
    'Yield farmer turned fair trade advocate. LFG.',
  ]
  const bio = bios[Math.floor(rng() * bios.length)]

  // Level & XP
  const level = Math.floor(rng() * 30) + 5
  const xpMax = level * 1000
  const xpCurrent = Math.floor(rng() * xpMax * 0.85) + Math.floor(xpMax * 0.1)

  // Social
  const followers = Math.floor(rng() * 2400) + 50
  const following = Math.floor(rng() * 800) + 20

  // Trading stats
  const totalVolume = Math.floor(rng() * 4_000_000) + 50_000
  const totalTrades = Math.floor(rng() * 1500) + 40
  const winRate = Math.floor(rng() * 35) + 50
  const pnl = (rng() - 0.3) * 80000
  const avgTradeSize = Math.floor(totalVolume / totalTrades)
  const favPairs = ['ETH/USDC', 'WBTC/ETH', 'ARB/USDC', 'OP/ETH', 'MATIC/USDC', 'VIBE/ETH']
  const favoritePair = favPairs[Math.floor(rng() * favPairs.length)]
  const longestStreak = Math.floor(rng() * 24) + 3

  // Badges
  const badges = [
    { id: 'ea', name: 'Early Adopter', code: 'EA', color: '#8b5cf6', description: 'Joined within the first 30 days of launch' },
    { id: '1k', name: '1K Trades', code: '1K', color: '#22c55e', description: 'Completed 1,000 trades on VibeSwap' },
    { id: 'dh', name: 'Diamond Hands', code: 'DH', color: '#3b82f6', description: 'Held LP position through 5+ volatility events' },
    { id: 'gv', name: 'Governance Voter', code: 'GV', color: '#f59e0b', description: 'Voted on 10+ governance proposals' },
    { id: 'lp', name: 'LP Provider', code: 'LP', color: '#06b6d4', description: 'Provided liquidity for 60+ continuous days' },
    { id: 'bh', name: 'Bug Hunter', code: 'BH', color: '#ef4444', description: 'Reported a verified security vulnerability' },
    { id: 'ch', name: 'Community Helper', code: 'CH', color: '#ec4899', description: 'Helped 50+ users in community channels' },
    { id: 'ww', name: 'Whale Watcher', code: 'WW', color: '#14b8a6', description: 'Monitored whale movements for 30+ days' },
  ]
  badges.forEach((b) => {
    b.unlocked = rng() > 0.35
  })

  // Activity feed
  const activityTypes = [
    { type: 'swap', descTemplate: (r) => {
      const pairs = ['ETH/USDC', 'WBTC/ETH', 'ARB/USDC', 'OP/ETH']
      return `Swapped ${pairs[Math.floor(r() * pairs.length)]}`
    }},
    { type: 'lp', descTemplate: (r) => {
      const pools = ['ETH/USDC', 'WBTC/ETH', 'VIBE/ETH']
      return `Added liquidity to ${pools[Math.floor(r() * pools.length)]} pool`
    }},
    { type: 'vote', descTemplate: () => {
      const props = ['VIP-14: Fee restructure', 'VIP-17: New pool', 'VIP-21: Treasury allocation']
      return `Voted on ${props[Math.floor(Math.random() * props.length)]}`
    }},
    { type: 'badge', descTemplate: (r) => {
      const names = ['Early Adopter', 'LP Provider', '100 Trades', 'Bridge Master']
      return `Unlocked "${names[Math.floor(r() * names.length)]}" badge`
    }},
  ]

  const timeAgo = [
    '2 min ago', '14 min ago', '1 hour ago', '3 hours ago',
    '8 hours ago', '1 day ago', '2 days ago', '5 days ago',
  ]

  const activities = Array.from({ length: 8 }, (_, i) => {
    const typeInfo = activityTypes[Math.floor(rng() * activityTypes.length)]
    const amt = typeInfo.type === 'swap'
      ? (rng() > 0.5 ? '+' : '-') + '$' + (Math.floor(rng() * 5000) + 100).toLocaleString()
      : typeInfo.type === 'lp'
        ? '+$' + (Math.floor(rng() * 20000) + 500).toLocaleString()
        : null
    const hashParts = Math.floor(rng() * 0xFFFF).toString(16).padStart(4, '0')
    return {
      id: i,
      type: typeInfo.type,
      description: typeInfo.descTemplate(rng),
      time: timeAgo[i],
      txHash: `0x${hashParts}...${Math.floor(rng() * 0xFFFF).toString(16).padStart(4, '0')}`,
      amount: amt,
    }
  })

  // Reputation
  const shapleyScore = Math.floor(rng() * 800) + 200
  const trustLevel = shapleyScore > 800 ? 'Sentinel' : shapleyScore > 600 ? 'Guardian' : shapleyScore > 400 ? 'Contributor' : 'Observer'
  const trustColor = shapleyScore > 800 ? '#f59e0b' : shapleyScore > 600 ? '#8b5cf6' : shapleyScore > 400 ? '#06b6d4' : '#9ca3af'

  // Portfolio
  const portfolioTokens = [
    { token: 'ETH', color: '#627eea' },
    { token: 'USDC', color: '#2775ca' },
    { token: 'VIBE', color: '#8b5cf6' },
    { token: 'WBTC', color: '#f7931a' },
    { token: 'ARB', color: '#28a0f0' },
  ]
  let remaining = 100
  const portfolio = portfolioTokens.map((t, i) => {
    const isLast = i === portfolioTokens.length - 1
    const pct = isLast ? remaining : Math.floor(rng() * (remaining * 0.6)) + 5
    remaining -= pct
    if (remaining < 5 && !isLast) remaining = 5
    const value = Math.floor(pct * (totalVolume / 400))
    return { ...t, percentage: pct, value }
  })
  portfolio.sort((a, b) => b.percentage - a.percentage)

  return {
    username,
    joinDate,
    bio,
    level,
    xpCurrent,
    xpMax,
    followers,
    following,
    stats: {
      totalVolume,
      totalTrades,
      winRate,
      pnl,
      avgTradeSize,
      favoritePair,
      longestStreak,
    },
    badges,
    activities,
    shapleyScore,
    trustLevel,
    trustColor,
    portfolio,
  }
}

// ============ Truncated Address ============

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr || '0x0000...0000'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// ============ Main Component ============

export default function SocialProfilePage() {
  const { address } = useParams()
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [isFollowing, setIsFollowing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('activity')

  const addressHash = useMemo(() => hashAddress(address), [address])
  const data = useMemo(() => generateMockData(addressHash), [addressHash])
  const heatmapRng = useMemo(() => seededRandom(addressHash + 999), [addressHash])

  const handleFollow = () => setIsFollowing((prev) => !prev)

  const handleShare = () => {
    const url = `${window.location.origin}/profile/${address || '0x0000'}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const displayAddress = address || '0x7F3a4b1D9e6C2f8A0B5d7E1c3F9a2D4b6E8c8E2'

  return (
    <div className="max-w-4xl mx-auto px-4 pb-16">
      <PageHero
        category="community"
        title="Social Profile"
        subtitle="On-chain identity, reputation, and trading history"
        badge="Public"
        badgeColor="#8b5cf6"
      />

      {/* ============ Profile Header ============ */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      >
        <GlassCard glowColor="terminal" className="p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Avatar */}
            <div className="flex-shrink-0 self-center sm:self-start">
              <div
                className="rounded-full p-1"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #06b6d4, #22c55e)',
                }}
              >
                <GeneratedAvatar seed={addressHash} size={80} />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold font-mono text-white">{data.username}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-mono text-black-500">
                      {truncateAddress(displayAddress)}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(displayAddress)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="text-[10px] font-mono text-cyan-400/50 hover:text-cyan-400 transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-black-500 mt-1">
                    Joined {data.joinDate}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={handleFollow}
                    className={`px-4 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                      isFollowing
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                        : 'bg-purple-500/20 text-white border border-purple-500/40 hover:bg-purple-500/30'
                    }`}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={handleShare}
                    className="px-3 py-1.5 rounded-lg text-xs font-mono text-black-400 border border-black-700/50 hover:border-black-600 hover:text-white transition-all"
                  >
                    {copied ? 'Copied!' : 'Share'}
                  </motion.button>
                </div>
              </div>

              {/* Bio */}
              <p className="text-sm font-mono text-black-400 mt-3 leading-relaxed max-w-lg">
                {data.bio}
              </p>

              {/* Social counts */}
              <div className="flex items-center gap-4 mt-3">
                <div className="text-xs font-mono">
                  <span className="text-white font-bold">{data.followers.toLocaleString()}</span>
                  <span className="text-black-500 ml-1">Followers</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-white font-bold">{data.following.toLocaleString()}</span>
                  <span className="text-black-500 ml-1">Following</span>
                </div>
              </div>

              {/* XP Bar */}
              <div className="mt-4">
                <XPBar current={data.xpCurrent} max={data.xpMax} level={data.level} />
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Trading Stats Grid ============ */}
      <SectionHeader tag="Performance" title="Trading Stats" />
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8"
      >
        <StatCard
          label="Total Volume"
          value={`$${(data.stats.totalVolume / 1000).toFixed(0)}K`}
          sub={`${data.stats.totalTrades.toLocaleString()} trades`}
        />
        <StatCard
          label="PnL"
          value={`${data.stats.pnl >= 0 ? '+' : ''}$${Math.abs(data.stats.pnl).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`}
          color={data.stats.pnl >= 0 ? 'text-green-400' : 'text-red-400'}
          sub="All time"
        />
        <StatCard
          label="Win Rate"
          value={`${data.stats.winRate}%`}
          color={data.stats.winRate >= 60 ? 'text-green-400' : 'text-yellow-400'}
          sub={`${Math.floor(data.stats.totalTrades * data.stats.winRate / 100)}W / ${data.stats.totalTrades - Math.floor(data.stats.totalTrades * data.stats.winRate / 100)}L`}
        />
        <StatCard
          label="Avg Trade"
          value={`$${data.stats.avgTradeSize.toLocaleString()}`}
          sub="Per transaction"
        />
        <StatCard
          label="Favorite Pair"
          value={data.stats.favoritePair}
          sub="Most traded"
          color="text-cyan-400"
        />
        <StatCard
          label="Win Streak"
          value={`${data.stats.longestStreak}`}
          sub="Longest streak"
          color="text-purple-400"
        />
      </motion.div>

      {/* ============ Badges Section ============ */}
      <SectionHeader tag="Soulbound" title="Achievement Badges" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
        className="mb-8"
      >
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-mono text-black-500">
              {data.badges.filter((b) => b.unlocked).length} / {data.badges.length} unlocked
            </div>
            <Link
              to="/badges"
              className="text-[10px] font-mono text-purple-400/60 hover:text-purple-400 transition-colors"
            >
              View all badges &rarr;
            </Link>
          </div>
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-4 sm:grid-cols-8 gap-4"
          >
            {data.badges.map((badge) => (
              <BadgeIcon key={badge.id} badge={badge} />
            ))}
          </motion.div>
        </GlassCard>
      </motion.div>

      {/* ============ Tabbed Section: Activity / Reputation / Portfolio ============ */}
      <div className="flex items-center gap-1 mb-4 border-b border-black-800/50">
        {[
          { key: 'activity', label: 'Activity Feed' },
          { key: 'reputation', label: 'Reputation' },
          { key: 'portfolio', label: 'Portfolio' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-xs font-mono transition-all border-b-2 ${
              activeTab === tab.key
                ? 'text-purple-400 border-purple-400'
                : 'text-black-500 border-transparent hover:text-white hover:border-black-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ Activity Feed Tab ============ */}
      {activeTab === 'activity' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 / (PHI * PHI) }}
        >
          <GlassCard className="p-5 mb-8">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">
              Recent Activity
            </div>
            {data.activities.map((activity, i) => (
              <ActivityItem key={activity.id} activity={activity} index={i} />
            ))}
            <div className="text-center mt-4">
              <button className="text-[10px] font-mono text-purple-400/60 hover:text-purple-400 transition-colors">
                Load more activity &darr;
              </button>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ============ Reputation Tab ============ */}
      {activeTab === 'reputation' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 / (PHI * PHI) }}
          className="space-y-4 mb-8"
        >
          {/* Shapley Score + Trust Level */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GlassCard className="p-5">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
                Shapley Score
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold font-mono text-white">
                  {data.shapleyScore}
                </span>
                <span className="text-xs font-mono text-black-500 mb-1">/ 1,000</span>
              </div>
              <div className="h-2 bg-black/30 rounded-full overflow-hidden mt-3">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(data.shapleyScore / 1000) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2, duration: 1 / PHI, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${data.trustColor}, ${data.trustColor}88)` }}
                />
              </div>
              <div className="text-[10px] font-mono text-black-500 mt-2">
                Measures cooperative value contribution via game theory
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
                Trust Level
              </div>
              <div className="flex items-center gap-3 mt-1">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold font-mono"
                  style={{
                    background: `${data.trustColor}15`,
                    color: data.trustColor,
                    border: `2px solid ${data.trustColor}40`,
                  }}
                >
                  {data.trustLevel.charAt(0)}
                </div>
                <div>
                  <div className="text-lg font-bold font-mono text-white">{data.trustLevel}</div>
                  <div className="text-[10px] font-mono text-black-500">
                    {data.trustLevel === 'Sentinel' && 'Top-tier trusted community member'}
                    {data.trustLevel === 'Guardian' && 'Highly trusted, governance eligible'}
                    {data.trustLevel === 'Contributor' && 'Active contributor, building reputation'}
                    {data.trustLevel === 'Observer' && 'New member, establishing trust'}
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Contribution Heatmap */}
          <GlassCard className="p-5">
            <ContributionHeatmap rng={heatmapRng} />
          </GlassCard>

          {/* Reputation Breakdown */}
          <GlassCard className="p-5">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">
              Reputation Breakdown
            </div>
            <div className="space-y-3">
              {[
                { label: 'Trading Activity', value: Math.floor(data.shapleyScore * 0.35), max: 350, color: '#22c55e' },
                { label: 'Liquidity Provision', value: Math.floor(data.shapleyScore * 0.25), max: 250, color: '#06b6d4' },
                { label: 'Governance Participation', value: Math.floor(data.shapleyScore * 0.2), max: 200, color: '#8b5cf6' },
                { label: 'Community Contribution', value: Math.floor(data.shapleyScore * 0.2), max: 200, color: '#f59e0b' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-black-400">{item.label}</span>
                    <span className="text-[10px] font-mono text-black-500">
                      {item.value} / {item.max}
                    </span>
                  </div>
                  <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${(item.value / item.max) * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.1, duration: 1 / PHI, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ background: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ============ Portfolio Tab ============ */}
      {activeTab === 'portfolio' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 / (PHI * PHI) }}
        >
          <GlassCard className="p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                  Portfolio Overview
                </div>
                <div className="text-lg font-bold font-mono text-white mt-1">
                  ${data.portfolio.reduce((sum, t) => sum + t.value, 0).toLocaleString()}
                </div>
              </div>
              <div className="text-[10px] font-mono text-black-500">Top 5 Holdings</div>
            </div>
            <div className="space-y-3">
              {data.portfolio.map((token, i) => (
                <PortfolioBar
                  key={token.token}
                  token={token.token}
                  percentage={token.percentage}
                  value={token.value}
                  color={token.color}
                  index={i}
                />
              ))}
            </div>

            {/* Token distribution legend */}
            <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-black-800/50">
              {data.portfolio.map((token) => (
                <div key={token.token} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: token.color }}
                  />
                  <span className="text-[10px] font-mono text-black-400">
                    {token.token} ({token.percentage.toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Portfolio Stats */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            <GlassCard className="p-4">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">
                Diversity Score
              </div>
              <div className="text-xl font-bold font-mono text-cyan-400">
                {Math.min(data.portfolio.length * 20, 100)}%
              </div>
              <div className="text-[10px] font-mono text-black-500 mt-1">
                {data.portfolio.length} tokens held
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">
                Largest Position
              </div>
              <div className="text-xl font-bold font-mono text-white">
                {data.portfolio[0].token}
              </div>
              <div className="text-[10px] font-mono text-black-500 mt-1">
                {data.portfolio[0].percentage.toFixed(1)}% of portfolio
              </div>
            </GlassCard>
          </div>
        </motion.div>
      )}

      {/* ============ Back Link ============ */}
      <div className="text-center mt-8">
        <Link
          to="/leaderboard"
          className="text-xs font-mono text-purple-400/50 hover:text-purple-400 transition-colors"
        >
          &larr; Back to Leaderboard
        </Link>
      </div>
    </div>
  )
}
