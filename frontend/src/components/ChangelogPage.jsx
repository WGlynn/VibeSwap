import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895

// ============ Change Types ============
const CHANGE_TYPES = {
  added: { label: 'Added', color: '#22c55e', bg: 'bg-green-500/10', border: 'border-green-500/20', text: 'text-green-400' },
  changed: { label: 'Changed', color: '#3b82f6', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
  fixed: { label: 'Fixed', color: '#ef4444', bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  security: { label: 'Security', color: '#f59e0b', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
}

const FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'added', label: 'Features' },
  { id: 'fixed', label: 'Fixes' },
  { id: 'security', label: 'Security' },
]

// ============ Release Data ============
const RELEASES = [
  {
    version: 'v0.9.0',
    date: 'March 2026',
    codename: 'The Great Expansion',
    summary: 'Massive DeFi primitive expansion with pro trading tools, game theory visualizations, and a completely revamped UI system.',
    changes: [
      { type: 'added', text: '12 new DeFi primitives: lending, staking, yield, options, perpetuals, bonds, DCA, aggregator, insurance, launchpad, NFT marketplace, analytics' },
      { type: 'added', text: 'Categorized sidebar navigation with DeFi, Ecosystem, Community, Intelligence, and Knowledge sections' },
      { type: 'added', text: 'PageHero system with unique gradient identities per page category' },
      { type: 'added', text: 'Pro trading interface with advanced order types, depth charts, and real-time order flow' },
      { type: 'added', text: 'Game theory visualizations for commit-reveal auction mechanics and Shapley distribution' },
      { type: 'changed', text: 'Redesigned all page layouts with GlassCard components and phi-ratio spacing' },
      { type: 'changed', text: 'Upgraded animation system to framer-motion with golden ratio easing curves' },
      { type: 'fixed', text: 'Sidebar overflow on mobile devices with collapsible category groups' },
      { type: 'fixed', text: 'Page transition jank when navigating between DeFi primitives' },
      { type: 'security', text: 'Added Content Security Policy headers for all frontend routes' },
    ],
  },
  {
    version: 'v0.8.0',
    date: 'February 2026',
    codename: 'Mind Mesh',
    summary: 'AI-native intelligence layer with JARVIS integration, soulbound identity, and WebAuthn device wallets.',
    changes: [
      { type: 'added', text: 'MindMesh network for decentralized AI agent coordination and consensus' },
      { type: 'added', text: 'JARVIS integration with proactive monitoring, Telegram bot, and session intelligence' },
      { type: 'added', text: 'Soulbound identity system with on-chain reputation and contribution tracking' },
      { type: 'added', text: 'WebAuthn device wallet using Secure Element for key storage (keys never leave device)' },
      { type: 'changed', text: 'Wallet connection flow now supports both external wallets (MetaMask) and device wallets simultaneously' },
      { type: 'changed', text: 'Header redesigned with dual wallet state indicator and minimal footprint' },
      { type: 'fixed', text: 'Device wallet detection failing on iOS Safari with passkey fallback' },
      { type: 'fixed', text: 'Balance tracking hook now correctly switches between mock and real blockchain data' },
      { type: 'security', text: 'WebAuthn attestation verification hardened against relay attacks' },
      { type: 'security', text: 'PIN-encrypted iCloud backup for device wallet recovery keys' },
    ],
  },
  {
    version: 'v0.7.0',
    date: 'January 2026',
    codename: 'Cross-Chain',
    summary: 'Omnichain expansion via LayerZero V2 with multi-chain bridge, circuit breakers, and oracle network.',
    changes: [
      { type: 'added', text: 'LayerZero V2 OApp integration for cross-chain message passing and token bridging' },
      { type: 'added', text: 'Multi-chain bridge UI with 0% protocol fees and real-time transfer tracking' },
      { type: 'added', text: 'Circuit breaker system with volume, price, and withdrawal threshold triggers' },
      { type: 'added', text: 'Kalman filter oracle network for true price discovery across chains' },
      { type: 'changed', text: 'CrossChainRouter now supports configurable peer endpoints per chain' },
      { type: 'changed', text: 'Bridge page redesigned: button says "Send" instead of "Get Started", layout overflow fixed' },
      { type: 'fixed', text: 'TWAP oracle deviation calculation edge case when price feeds lag >30 seconds' },
      { type: 'fixed', text: 'Rate limiter not resetting correctly at hour boundaries for cross-chain transfers' },
      { type: 'security', text: 'Added 5% maximum TWAP deviation validation for all oracle-dependent operations' },
      { type: 'security', text: 'Rate limiting enforced at 1M tokens/hour/user across all supported chains' },
    ],
  },
  {
    version: 'v0.6.0',
    date: 'December 2025',
    codename: 'Governance',
    summary: 'DAO treasury management, Shapley-based reward distribution, covenant system, and quadratic voting.',
    changes: [
      { type: 'added', text: 'DAO treasury with multi-sig management and protocol-owned liquidity strategies' },
      { type: 'added', text: 'Shapley value distribution for fair, game-theoretic reward allocation to contributors' },
      { type: 'added', text: 'Covenant system for programmable governance constraints and constitutional rules' },
      { type: 'added', text: 'Quadratic voting module for community proposals with sybil resistance' },
      { type: 'changed', text: 'Treasury stabilizer upgraded to Trinomial Stability System (TSS) architecture' },
      { type: 'changed', text: 'Governance page now shows real-time proposal status with animated progress indicators' },
      { type: 'fixed', text: 'Shapley calculation overflow when contributor count exceeds 256 in a single epoch' },
      { type: 'security', text: 'Covenant execution now requires multi-block confirmation to prevent flash governance attacks' },
    ],
  },
  {
    version: 'v0.5.0',
    date: 'November 2025',
    codename: 'The Core',
    summary: 'Genesis release. Commit-reveal batch auction, constant product AMM, and the first VibeSwap frontend.',
    changes: [
      { type: 'added', text: 'Commit-reveal batch auction engine with 10-second cycles (8s commit, 2s reveal)' },
      { type: 'added', text: 'Constant product AMM (x*y=k) with deterministic Fisher-Yates shuffle settlement' },
      { type: 'added', text: 'Basic frontend with swap interface, pool management, and wallet connection' },
      { type: 'added', text: 'Testnet deployment on Ethereum Sepolia with faucet integration' },
      { type: 'changed', text: 'Settlement algorithm uses XORed user secrets for verifiable randomness' },
      { type: 'fixed', text: 'Commit hash validation rejecting valid orders when secret contained leading zeros' },
      { type: 'security', text: 'Flash loan protection via EOA-only commit restriction (no contract callers)' },
      { type: 'security', text: '50% slashing penalty for invalid reveals to discourage griefing attacks' },
    ],
  },
]

// ============ Animation Variants ============
const phiEase = [0.25, 0.1, 1 / PHI, 1]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 1 / (PHI * PHI * PHI),
      delayChildren: 1 / (PHI * PHI),
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1 / (PHI * PHI), ease: phiEase },
  },
}

// ============ Sub-Components ============
function TypeBadge({ type }) {
  const config = CHANGE_TYPES[type]
  if (!config) return null

  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border',
        config.bg, config.border, config.text,
      ].join(' ')}
    >
      {config.label}
    </span>
  )
}

function ChangeItem({ change, index }) {
  const config = CHANGE_TYPES[change.type]

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: phiEase }}
      className="flex items-start gap-3 py-2 group"
    >
      <div
        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 transition-transform group-hover:scale-150"
        style={{ backgroundColor: config.color }}
      />
      <div className="flex-1 flex flex-wrap items-start gap-2">
        <TypeBadge type={change.type} />
        <span className="text-sm text-white/70 leading-relaxed">{change.text}</span>
      </div>
    </motion.div>
  )
}

function ReleaseCard({ release, index, isLatest }) {
  const [isExpanded, setIsExpanded] = useState(isLatest)

  const typeCounts = release.changes.reduce((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1
    return acc
  }, {})

  return (
    <motion.div variants={itemVariants} className="relative flex gap-4 sm:gap-6">
      {/* Timeline spine */}
      <div className="flex flex-col items-center flex-shrink-0">
        <motion.div
          className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-xs font-mono font-bold border-2 cursor-pointer"
          style={{
            borderColor: isLatest ? '#22c55e' : 'rgba(255,255,255,0.15)',
            backgroundColor: isLatest ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.6)',
            color: isLatest ? '#22c55e' : 'rgba(255,255,255,0.5)',
            boxShadow: isLatest ? '0 0 20px rgba(34,197,94,0.2)' : 'none',
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {release.version.replace('v', '')}
        </motion.div>
        {index < RELEASES.length - 1 && (
          <div
            className="w-0.5 flex-1 min-h-[24px]"
            style={{
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.03))',
            }}
          />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 pb-6">
        <GlassCard
          glowColor={isLatest ? 'matrix' : 'none'}
          hover={true}
          className="p-0"
        >
          <motion.div
            className="p-5 cursor-pointer select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <span className="text-sm font-mono font-bold text-white/90">
                    {release.version}
                  </span>
                  {isLatest && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-green-500/10 border border-green-500/20 text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Latest
                    </span>
                  )}
                  <span className="text-xs text-white/30 font-mono">{release.date}</span>
                </div>
                <h3 className="text-lg font-bold tracking-tight">
                  {release.codename}
                </h3>
                <p className="text-sm text-white/40 mt-1 leading-relaxed">
                  {release.summary}
                </p>
              </div>

              {/* Expand indicator */}
              <motion.span
                className="text-xs text-white/20 mt-1 flex-shrink-0"
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                {'\u25BC'}
              </motion.span>
            </div>

            {/* Type summary pills */}
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(typeCounts).map(([type, count]) => {
                const config = CHANGE_TYPES[type]
                return (
                  <span
                    key={type}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                    style={{
                      color: config.color + 'cc',
                      borderColor: config.color + '20',
                      backgroundColor: config.color + '08',
                    }}
                  >
                    {count} {config.label.toLowerCase()}
                  </span>
                )
              })}
              <span className="text-[10px] font-mono text-white/20 px-2 py-0.5">
                {release.changes.length} total changes
              </span>
            </div>
          </motion.div>

          {/* Expanded change list */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 1 / (PHI * PHI), ease: phiEase }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 border-t border-white/5 pt-4">
                  <div className="space-y-0.5">
                    {release.changes.map((change, i) => (
                      <ChangeItem key={i} change={change} index={i} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </motion.div>
  )
}

// ============ Main Component ============
export default function ChangelogPage() {
  const [activeFilter, setActiveFilter] = useState('all')

  // Filter releases to only include those with matching changes
  const filteredReleases = RELEASES.map((release) => {
    if (activeFilter === 'all') return release
    return {
      ...release,
      changes: release.changes.filter((c) => c.type === activeFilter),
    }
  }).filter((release) => release.changes.length > 0)

  const totalChanges = RELEASES.reduce((sum, r) => sum + r.changes.length, 0)

  return (
    <div className="min-h-screen pb-24">
      <PageHero
        category="system"
        title="Changelog"
        subtitle="What's new in VibeSwap"
      />

      <div className="max-w-4xl mx-auto px-4">
        {/* ============ Stats + Filter Bar ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, ease: phiEase }}
          className="mb-8"
        >
          <GlassCard glowColor="none" className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Stats */}
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xl font-bold font-mono text-white/90">
                    {RELEASES.length}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-mono">
                    Releases
                  </div>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div>
                  <div className="text-xl font-bold font-mono text-white/90">
                    {totalChanges}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-mono">
                    Changes
                  </div>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div>
                  <div className="text-xl font-bold font-mono text-green-400">
                    {RELEASES[0].version}
                  </div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider font-mono">
                    Latest
                  </div>
                </div>
              </div>

              {/* Filter buttons */}
              <div className="flex items-center gap-1.5">
                {FILTER_OPTIONS.map((filter) => (
                  <motion.button
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    className={
                      activeFilter === filter.id
                        ? 'px-3 py-1.5 rounded-lg text-xs font-mono transition-all border bg-white/10 border-white/20 text-white'
                        : 'px-3 py-1.5 rounded-lg text-xs font-mono transition-all border bg-transparent border-white/5 text-white/40 hover:text-white/60 hover:border-white/10'
                    }
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {filter.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Release Timeline ============ */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="relative"
        >
          {filteredReleases.map((release, index) => (
            <ReleaseCard
              key={release.version}
              release={release}
              index={index}
              isLatest={index === 0 && activeFilter === 'all'}
            />
          ))}
        </motion.div>

        {/* ============ Empty State ============ */}
        <AnimatePresence>
          {filteredReleases.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-center py-16"
            >
              <div className="text-white/20 text-sm font-mono">
                No changes matching this filter
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ============ Footer ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="text-center py-12"
        >
          <div className="inline-flex items-center gap-2 mb-3">
            {Object.values(CHANGE_TYPES).map((config) => (
              <div key={config.label} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                <span className="text-[10px] font-mono text-white/30">{config.label}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-white/20 font-mono">
            Building in public since November 2025
          </p>
          <p className="text-xs text-white/10 mt-2 italic">
            "Every commit is a step from the cave toward the cosmos"
          </p>
        </motion.div>
      </div>
    </div>
  )
}
