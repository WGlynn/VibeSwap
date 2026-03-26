import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Achievement Badges / Soulbound Token Gallery ============
// Non-transferable soulbound tokens minted on Base.
// Categories: Trading, Liquidity, Community, Governance, Special.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Rarity Colors ============
const RARITY_COLORS = {
  Common: '#9ca3af',
  Rare: '#3b82f6',
  Epic: '#8b5cf6',
  Legendary: '#f59e0b',
}

const RARITY_ORDER = ['Common', 'Rare', 'Epic', 'Legendary']

// ============ Badge Categories ============
const CATEGORIES = ['Trading', 'Liquidity', 'Community', 'Governance', 'Special']

// ============ Badge Data ============
const ALL_BADGES = [
  // Trading (4)
  { id: 'FS', name: 'First Swap', description: 'Complete your first trade on VibeSwap', category: 'Trading', rarity: 'Common', code: 'FS', color: '#22c55e', earned: true, progress: 100 },
  { id: 'HT', name: '100 Trades', description: 'Execute 100 successful trades', category: 'Trading', rarity: 'Rare', code: 'HT', color: '#3b82f6', earned: true, progress: 100 },
  { id: 'MV', name: '1M Volume', description: 'Reach $1,000,000 in cumulative trading volume', category: 'Trading', rarity: 'Epic', code: 'MV', color: '#8b5cf6', earned: false, progress: 42 },
  { id: 'DH', name: 'Diamond Hands', description: 'Hold a position through 5 consecutive batches without selling', category: 'Trading', rarity: 'Legendary', code: 'DH', color: '#f59e0b', earned: false, progress: 18 },

  // Liquidity (4)
  { id: 'LP', name: 'LP Pioneer', description: 'Provide liquidity to any pool for the first time', category: 'Liquidity', rarity: 'Common', code: 'LP', color: '#06b6d4', earned: true, progress: 100 },
  { id: 'WH', name: 'Whale', description: 'Provide over $100,000 in liquidity to a single pool', category: 'Liquidity', rarity: 'Legendary', code: 'WH', color: '#f59e0b', earned: false, progress: 7 },
  { id: 'SM', name: 'Stable Maker', description: 'Maintain LP position for 30+ days without withdrawal', category: 'Liquidity', rarity: 'Rare', code: 'SM', color: '#3b82f6', earned: true, progress: 100 },
  { id: 'DP', name: 'Deep Pool', description: 'Provide liquidity across 5 different pools simultaneously', category: 'Liquidity', rarity: 'Epic', code: 'DP', color: '#8b5cf6', earned: false, progress: 60 },

  // Community (4)
  { id: 'EA', name: 'Early Adopter', description: 'Join VibeSwap within the first 30 days of launch', category: 'Community', rarity: 'Epic', code: 'EA', color: '#8b5cf6', earned: true, progress: 100 },
  { id: 'RF', name: 'Referral King', description: 'Successfully refer 10 active users to the platform', category: 'Community', rarity: 'Rare', code: 'RF', color: '#3b82f6', earned: false, progress: 30 },
  { id: 'BH', name: 'Bug Hunter', description: 'Report a verified bug through the security bounty program', category: 'Community', rarity: 'Legendary', code: 'BH', color: '#f59e0b', earned: false, progress: 0 },
  { id: 'VB', name: 'Vibe Check', description: 'Participate in 5 community governance discussions', category: 'Community', rarity: 'Common', code: 'VB', color: '#22c55e', earned: true, progress: 100 },

  // Governance (4)
  { id: 'OG', name: 'OG Voter', description: 'Cast your first governance vote on a VibeSwap proposal', category: 'Governance', rarity: 'Common', code: 'OG', color: '#22c55e', earned: true, progress: 100 },
  { id: 'PC', name: 'Proposal Creator', description: 'Submit a governance proposal that reaches quorum', category: 'Governance', rarity: 'Epic', code: 'PC', color: '#8b5cf6', earned: false, progress: 0 },
  { id: 'DL', name: 'Delegate', description: 'Receive delegation from 5+ unique addresses', category: 'Governance', rarity: 'Rare', code: 'DL', color: '#3b82f6', earned: false, progress: 40 },
  { id: 'GD', name: 'Guardian', description: 'Vote on 50 consecutive proposals without missing one', category: 'Governance', rarity: 'Legendary', code: 'GD', color: '#f59e0b', earned: false, progress: 24 },

  // Special (4)
  { id: 'BM', name: 'Bridge Master', description: 'Complete cross-chain swaps on 3+ chains via LayerZero', category: 'Special', rarity: 'Rare', code: 'BM', color: '#3b82f6', earned: true, progress: 100 },
  { id: 'GN', name: 'Genesis', description: 'Participate in the VibeSwap genesis batch auction', category: 'Special', rarity: 'Legendary', code: 'GN', color: '#f59e0b', earned: true, progress: 100 },
  { id: 'FP', name: 'Fair Player', description: 'Complete 50 commit-reveal rounds with zero invalid reveals', category: 'Special', rarity: 'Epic', code: 'FP', color: '#8b5cf6', earned: false, progress: 72 },
  { id: 'CB', name: 'Circuit Breaker', description: 'Be the first to trigger a circuit breaker protection event', category: 'Special', rarity: 'Legendary', code: 'CB', color: '#f59e0b', earned: false, progress: 0 },
]

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

// ============ Badge Icon ============
function BadgeIcon({ code, color, earned, size = 48 }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-full font-mono font-bold shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: earned ? `${color}22` : 'rgba(255,255,255,0.03)',
        border: `2px solid ${earned ? color : 'rgba(255,255,255,0.08)'}`,
        color: earned ? color : 'rgba(255,255,255,0.15)',
        fontSize: size * 0.375,
      }}
    >
      {code}
      {!earned && (
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
          <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      )}
    </div>
  )
}

// ============ Badge Card ============
function BadgeCard({ badge, index, onPin, isPinned }) {
  const rarityColor = RARITY_COLORS[badge.rarity]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: index * (0.08 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard
        glowColor={badge.earned ? 'terminal' : 'none'}
        className={`p-4 h-full ${!badge.earned ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          <BadgeIcon code={badge.code} color={badge.color} earned={badge.earned} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-bold font-mono text-white truncate">{badge.name}</p>
              {badge.earned && (
                <motion.button
                  onClick={() => onPin(badge.id)}
                  whileTap={{ scale: 0.9 }}
                  className={`shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${
                    isPinned
                      ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-400'
                      : 'bg-black/30 border border-white/10 text-white/30 hover:text-white/50'
                  }`}
                  title={isPinned ? 'Unpin badge' : 'Pin to showcase'}
                >
                  {isPinned ? '\u2605' : '\u2606'}
                </motion.button>
              )}
            </div>
            <span
              className="inline-block text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full mb-1.5"
              style={{
                color: rarityColor,
                backgroundColor: `${rarityColor}15`,
                border: `1px solid ${rarityColor}33`,
              }}
            >
              {badge.rarity}
            </span>
            <p className="text-[11px] font-mono text-white/40 leading-relaxed">{badge.description}</p>
          </div>
        </div>

        {/* Progress bar for locked badges */}
        {!badge.earned && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono text-white/30 uppercase">Progress</span>
              <span className="text-[9px] font-mono text-white/40">{badge.progress}%</span>
            </div>
            <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${badge.progress}%` }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + index * 0.05, duration: 0.8, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ backgroundColor: badge.color }}
              />
            </div>
          </div>
        )}

        {/* Earned timestamp */}
        {badge.earned && (
          <div className="mt-3 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-[9px] font-mono text-green-400/60">Minted on Base</span>
          </div>
        )}
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
      <span>{category}</span>
      <span className={`ml-1.5 text-[9px] ${isActive ? 'text-cyan-400/60' : 'text-white/20'}`}>
        {earnedCount}/{count}
      </span>
      {isActive && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 rounded-xl border border-cyan-500/40"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}
    </motion.button>
  )
}

// ============ Showcase Slot ============
function ShowcaseSlot({ badge, index, onRemove }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
      className="flex flex-col items-center gap-2"
    >
      {badge ? (
        <motion.div
          className="relative cursor-pointer"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onRemove(badge.id)}
        >
          <div
            className="absolute -inset-2 rounded-full opacity-30 blur-md"
            style={{ backgroundColor: badge.color }}
          />
          <BadgeIcon code={badge.code} color={badge.color} earned={true} size={64} />
          <p className="text-[10px] font-mono text-white/70 text-center mt-1.5 max-w-[80px] truncate">{badge.name}</p>
          <p
            className="text-[8px] font-mono text-center mt-0.5"
            style={{ color: RARITY_COLORS[badge.rarity] }}
          >
            {badge.rarity}
          </p>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center">
          <div
            className="flex items-center justify-center rounded-full border-2 border-dashed border-white/10"
            style={{ width: 64, height: 64 }}
          >
            <span className="text-white/15 font-mono text-xs">#{index + 1}</span>
          </div>
          <p className="text-[10px] font-mono text-white/20 mt-1.5">Empty slot</p>
        </div>
      )}
    </motion.div>
  )
}

// ============ Main Component ============
export default function BadgesPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('Trading')
  const [pinnedIds, setPinnedIds] = useState(['GN', 'EA', 'FS'])

  // ============ Derived State ============
  const filteredBadges = ALL_BADGES.filter(b => b.category === activeCategory)
  const totalEarned = ALL_BADGES.filter(b => b.earned).length
  const totalBadges = ALL_BADGES.length
  const collectionScore = Math.round((totalEarned / totalBadges) * 1000)

  const rarityBreakdown = RARITY_ORDER.map(rarity => ({
    rarity,
    total: ALL_BADGES.filter(b => b.rarity === rarity).length,
    earned: ALL_BADGES.filter(b => b.rarity === rarity && b.earned).length,
    color: RARITY_COLORS[rarity],
  }))

  const pinnedBadges = pinnedIds.map(id => ALL_BADGES.find(b => b.id === id)).filter(Boolean)
  // Pad to 3 slots
  while (pinnedBadges.length < 3) {
    pinnedBadges.push(null)
  }

  // ============ Handlers ============
  const handlePin = (badgeId) => {
    setPinnedIds(prev => {
      if (prev.includes(badgeId)) {
        return prev.filter(id => id !== badgeId)
      }
      if (prev.length >= 3) {
        // Replace the oldest pin
        return [...prev.slice(1), badgeId]
      }
      return [...prev, badgeId]
    })
  }

  const handleUnpin = (badgeId) => {
    setPinnedIds(prev => prev.filter(id => id !== badgeId))
  }

  // ============ Category stats ============
  const categoryStats = CATEGORIES.map(cat => ({
    category: cat,
    count: ALL_BADGES.filter(b => b.category === cat).length,
    earned: ALL_BADGES.filter(b => b.category === cat && b.earned).length,
  }))

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="community"
        title="Achievement Badges"
        subtitle="Soulbound tokens earned through protocol participation"
        badge="SBT"
        badgeColor={CYAN}
      />

      <div className="space-y-10">
        {/* ============ Section 1: Collection Stats ============ */}
        <section>
          <SectionHeader tag="Collection" title="Your Badge Stats" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            {/* Total Earned */}
            <GlassCard glowColor="terminal" className="p-4">
              <div className="text-[10px] font-mono text-white/40 uppercase mb-1">Total Earned</div>
              <div className="text-2xl font-bold font-mono" style={{ color: CYAN }}>
                {totalEarned}
                <span className="text-sm text-white/30 ml-1">/ {totalBadges}</span>
              </div>
              <div className="mt-2 h-1 bg-black/30 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(totalEarned / totalBadges) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: CYAN }}
                />
              </div>
            </GlassCard>

            {/* Collection Score */}
            <GlassCard glowColor="terminal" className="p-4">
              <div className="text-[10px] font-mono text-white/40 uppercase mb-1">Collection Score</div>
              <div className="text-2xl font-bold font-mono text-white">
                {collectionScore}
              </div>
              <div className="text-[10px] font-mono text-white/30 mt-1">
                out of 1,000
              </div>
            </GlassCard>

            {/* Rarity Breakdown */}
            {rarityBreakdown.filter(r => r.rarity === 'Legendary' || r.rarity === 'Epic').map(r => (
              <GlassCard key={r.rarity} glowColor="none" className="p-4">
                <div className="text-[10px] font-mono text-white/40 uppercase mb-1">{r.rarity}</div>
                <div className="text-2xl font-bold font-mono" style={{ color: r.color }}>
                  {r.earned}
                  <span className="text-sm text-white/30 ml-1">/ {r.total}</span>
                </div>
                <div className="mt-2 h-1 bg-black/30 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${r.total > 0 ? (r.earned / r.total) * 100 : 0}%` }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                </div>
              </GlassCard>
            ))}
          </motion.div>

          {/* Full rarity breakdown bar */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: 0.15, duration: 1 / PHI, ease: 'easeOut' }}
            className="mt-3"
          >
            <GlassCard glowColor="none" className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-white/40 uppercase">Rarity Breakdown</span>
                <span className="text-[10px] font-mono text-white/30">{totalEarned} earned</span>
              </div>
              <div className="space-y-2">
                {rarityBreakdown.map((r, i) => (
                  <div key={r.rarity} className="flex items-center gap-3">
                    <span className="text-[10px] font-mono w-20 text-right" style={{ color: r.color }}>
                      {r.rarity}
                    </span>
                    <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${r.total > 0 ? (r.earned / r.total) * 100 : 0}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-white/40 w-10">
                      {r.earned}/{r.total}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 2: Showcase ============ */}
        <section>
          <SectionHeader tag="Showcase" title="Pin Your Top 3 Badges" delay={0.1 / PHI} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="terminal" className="p-6">
              <div className="flex items-center justify-center gap-8 sm:gap-12">
                {pinnedBadges.map((badge, i) => (
                  <ShowcaseSlot
                    key={badge ? badge.id : `empty-${i}`}
                    badge={badge}
                    index={i}
                    onRemove={handleUnpin}
                  />
                ))}
              </div>
              <p className="text-[10px] font-mono text-white/30 text-center mt-4">
                Click the star icon on any earned badge to pin it to your showcase.
                Pinned badges appear on your public profile.
              </p>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 3: Badge Gallery ============ */}
        <section>
          <SectionHeader tag="Gallery" title="All Badges" delay={0.1 / (PHI * PHI)} />

          {/* Category Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="flex flex-wrap gap-2 mb-4"
          >
            {categoryStats.map((cs) => (
              <CategoryTab
                key={cs.category}
                category={cs.category}
                isActive={activeCategory === cs.category}
                onClick={() => setActiveCategory(cs.category)}
                count={cs.count}
                earnedCount={cs.earned}
              />
            ))}
          </motion.div>

          {/* Badge Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredBadges.map((badge, i) => (
              <BadgeCard
                key={badge.id}
                badge={badge}
                index={i}
                onPin={handlePin}
                isPinned={pinnedIds.includes(badge.id)}
              />
            ))}
          </div>
        </section>

        {/* ============ Section 4: Mint Information ============ */}
        <section>
          <SectionHeader tag="On-Chain" title="Soulbound Token Info" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="terminal" className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                {[
                  { label: 'Network', value: 'Base', color: '#3b82f6', sub: 'L2 Rollup' },
                  { label: 'Standard', value: 'ERC-5192', color: CYAN, sub: 'Soulbound' },
                  { label: 'Transfer', value: 'Locked', color: '#ef4444', sub: 'Non-transferable' },
                ].map((info) => (
                  <div key={info.label} className="bg-black/30 rounded-xl p-3 border border-white/5 text-center">
                    <p className="text-[10px] font-mono text-white/40 uppercase">{info.label}</p>
                    <p className="text-lg font-bold font-mono mt-1" style={{ color: info.color }}>{info.value}</p>
                    <p className="text-[10px] font-mono text-white/30">{info.sub}</p>
                  </div>
                ))}
              </div>

              <div className="bg-black/30 rounded-xl p-4 border border-cyan-500/15">
                <p className="text-xs font-mono text-white/50 leading-relaxed">
                  Badges are <span style={{ color: CYAN }}>non-transferable soulbound tokens</span> minted
                  on Base. They represent your on-chain reputation and cannot be bought, sold, or transferred.
                  Each badge is bound to your wallet address permanently, creating an immutable record of your
                  contributions to the VibeSwap protocol.
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: 'Mint Cost', value: 'Free', desc: 'Gas only' },
                  { label: 'Auto-Mint', value: 'On', desc: 'When criteria met' },
                ].map((detail) => (
                  <div key={detail.label} className="bg-black/20 rounded-lg p-3 border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-white/40 uppercase">{detail.label}</span>
                      <span className="text-xs font-mono font-bold text-green-400">{detail.value}</span>
                    </div>
                    <p className="text-[9px] font-mono text-white/25 mt-0.5">{detail.desc}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 5: How To Earn ============ */}
        <section>
          <SectionHeader tag="Guide" title="How To Earn Badges" delay={0.1 / PHI} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="none" className="p-5">
              <div className="space-y-4">
                {[
                  { step: '01', title: 'Participate', desc: 'Trade, provide liquidity, vote on governance, and engage with the community.', color: '#22c55e' },
                  { step: '02', title: 'Meet Criteria', desc: 'Each badge has specific on-chain criteria tracked by the protocol automatically.', color: '#3b82f6' },
                  { step: '03', title: 'Auto-Mint', desc: 'When criteria are met, your soulbound token is minted to your wallet on Base.', color: '#8b5cf6' },
                  { step: '04', title: 'Showcase', desc: 'Pin your top 3 badges to your public profile and build your on-chain reputation.', color: '#f59e0b' },
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
                <p className="text-lg font-bold font-mono text-white mb-2">Sign In to View Badges</p>
                <p className="text-xs font-mono text-white/40 max-w-md mx-auto">
                  Sign in with your wallet to see which badges you have earned and track your progress
                  toward unlocking new achievements.
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
          <a href="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Rewards</a>
          <a href="/governance" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Governance</a>
          <a href="/leaderboard" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Leaderboard</a>
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
            "Your reputation is the only thing that can't be forked."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
