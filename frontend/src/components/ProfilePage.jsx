import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Profile Page ============
// User profile / account page for VibeSwap DEX.
// Shows profile header, activity stats, achievement badges,
// trading history summary, connected accounts, and danger zone.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

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
      <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Mock Data ============

const MOCK_ADDRESS = '0x7F3a...c8E2'
const MOCK_FULL_ADDRESS = '0x7F3a4b1D9e6C2f8A0B5d7E1c3F9a2D4b6E8c8E2'
const MOCK_ENS = 'vibewhale.eth'
const MOCK_MEMBER_SINCE = 'November 2024'

const ACTIVITY_STATS = {
  totalSwaps: 342,
  totalVolume: 1_284_720,
  loyaltyLevel: 12,
  xpCurrent: 7_840,
  xpNext: 10_000,
  vibeEarned: 4_218.47,
}

const BADGES = [
  { id: 'first-swap',   icon: 'FS', name: 'First Swap',       earned: true,  desc: 'Completed your first swap' },
  { id: 'bridge',       icon: 'BM', name: 'Bridge Master',    earned: true,  desc: 'Bridged across 3+ chains' },
  { id: 'lp',           icon: 'LP', name: 'LP Legend',        earned: true,  desc: 'Provided liquidity for 30+ days' },
  { id: 'governance',   icon: 'GV', name: 'Governance Voter', earned: true,  desc: 'Voted on 5+ proposals' },
  { id: 'early',        icon: 'EA', name: 'Early Adopter',    earned: true,  desc: 'Joined before mainnet launch' },
  { id: 'bug',          icon: 'BH', name: 'Bug Hunter',       earned: false, desc: 'Reported a valid bug' },
  { id: '100-swaps',    icon: 'CS', name: '100 Swaps',        earned: true,  desc: 'Completed 100 swaps' },
  { id: 'diamond',      icon: 'DH', name: 'Diamond Hands',    earned: false, desc: 'Held LP for 180+ days' },
]

const PNL_DAYS = [
  { day: 'Mon', value: 320 },
  { day: 'Tue', value: -140 },
  { day: 'Wed', value: 580 },
  { day: 'Thu', value: 210 },
  { day: 'Fri', value: -90 },
  { day: 'Sat', value: 440 },
  { day: 'Sun', value: 160 },
]

const TRADING_SUMMARY = {
  winRate: 71.4,
  totalTrades: 342,
  wins: 244,
  losses: 98,
  bestTrade: { pair: 'ETH/USDC', pnl: '+$2,847.30', date: 'Jan 14, 2025' },
  worstTrade: { pair: 'ARB/ETH', pnl: '-$412.60', date: 'Dec 8, 2024' },
}

const CONNECTED_CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism']

// ============ PnL Bar Chart ============

function PnLChart({ data }) {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)))
  const W = 420, H = 140
  const PAD = { top: 12, bottom: 24, left: 8, right: 8 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom
  const midY = PAD.top + iH / 2
  const barW = (iW / data.length) * 0.6
  const gap = (iW / data.length) * 0.4

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Zero line */}
      <line x1={PAD.left} y1={midY} x2={W - PAD.right} y2={midY}
        stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      {data.map((d, i) => {
        const barH = (Math.abs(d.value) / maxAbs) * (iH / 2)
        const x = PAD.left + i * (barW + gap) + gap / 2
        const isPositive = d.value >= 0
        const y = isPositive ? midY - barH : midY
        const color = isPositive ? '#22c55e' : '#ef4444'
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barW} height={barH} rx="3" fill={color} opacity="0.75" />
            <text x={x + barW / 2} y={H - 6} textAnchor="middle"
              fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="monospace">
              {d.day}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ============ XP Progress Bar ============

function XPBar({ current, max }) {
  const pct = Math.min((current / max) * 100, 100)
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-black-500 uppercase">XP Progress</span>
        <span className="text-[10px] font-mono text-cyan-400">
          {current.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-2.5 bg-black/30 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${CYAN}, #22c55e)` }}
        />
      </div>
    </div>
  )
}

// ============ Not Connected State ============

function NotConnectedState() {
  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      <PageHero
        category="system"
        title="Profile"
        subtitle="Your VibeSwap identity and activity"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, ease: 'easeOut' }}
        className="mt-8"
      >
        <GlassCard glowColor="terminal" className="p-8">
          <div className="text-center">
            <div
              className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(34,197,94,0.15))',
                border: '1px solid rgba(6,182,212,0.2)',
              }}
            >
              <span className="text-2xl font-mono font-bold text-cyan-400/50">?</span>
            </div>
            <h3 className="text-lg font-bold font-mono text-white mb-2">
              Connect wallet to view profile
            </h3>
            <p className="text-sm font-mono text-black-500 max-w-sm mx-auto">
              Sign in with an external wallet or create a device wallet to access your profile,
              stats, achievements, and trading history.
            </p>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}

// ============ Main Component ============

export default function ProfilePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [copied, setCopied] = useState(false)
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  const handleCopyAddress = () => {
    navigator.clipboard?.writeText(MOCK_FULL_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isConnected) {
    return <NotConnectedState />
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="system"
        title="Profile"
        subtitle="Your VibeSwap identity and activity"
        badge="Active"
        badgeColor={CYAN}
      />

      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-10">

        {/* ============ Section 1: Profile Header ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Identity" title="Profile" delay={0.1} />
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex items-center gap-5">
              {/* Avatar */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1 / PHI, ease: 'easeOut' }}
                className="shrink-0"
              >
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${CYAN}, #8b5cf6, #22c55e)`,
                    boxShadow: `0 0 24px -4px rgba(6,182,212,0.3)`,
                  }}
                >
                  <span className="text-2xl font-mono font-bold text-white drop-shadow-lg">VS</span>
                </div>
              </motion.div>

              {/* Identity info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-bold font-mono text-white truncate">{MOCK_ENS}</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-cyan-500/30 text-cyan-400 bg-cyan-500/10">
                    ENS
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-mono text-black-400 truncate">{MOCK_ADDRESS}</span>
                  <motion.button
                    onClick={handleCopyAddress}
                    whileTap={{ scale: 0.9 }}
                    className="shrink-0 text-[10px] font-mono px-2 py-1 rounded-lg border border-black-700/50 text-black-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </motion.button>
                </div>
                <p className="text-[11px] font-mono text-black-500">
                  Member since {MOCK_MEMBER_SINCE}
                </p>
              </div>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Section 2: Activity Stats ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Performance" title="Activity Stats" delay={0.1 / PHI} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total Swaps', value: ACTIVITY_STATS.totalSwaps.toLocaleString(), color: 'text-cyan-400' },
              { label: 'Total Volume', value: `$${(ACTIVITY_STATS.totalVolume / 1_000_000).toFixed(2)}M`, color: 'text-green-400' },
              { label: 'Loyalty Level', value: ACTIVITY_STATS.loyaltyLevel, color: 'text-amber-400' },
              { label: 'VIBE Earned', value: ACTIVITY_STATS.vibeEarned.toLocaleString(undefined, { minimumFractionDigits: 2 }), color: 'text-purple-400' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.08 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="terminal" className="p-4 text-center">
                  <p className="text-[10px] font-mono text-black-500 uppercase mb-1">{stat.label}</p>
                  <p className={`text-xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
                </GlassCard>
              </motion.div>
            ))}

            {/* XP Progress — spans 2 columns */}
            <motion.div
              className="col-span-2"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: 4 * (0.08 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
            >
              <GlassCard glowColor="terminal" className="p-4">
                <XPBar current={ACTIVITY_STATS.xpCurrent} max={ACTIVITY_STATS.xpNext} />
                <p className="text-[10px] font-mono text-black-500 mt-2 text-center">
                  {(ACTIVITY_STATS.xpNext - ACTIVITY_STATS.xpCurrent).toLocaleString()} XP to Level {ACTIVITY_STATS.loyaltyLevel + 1}
                </p>
              </GlassCard>
            </motion.div>
          </div>
        </motion.section>

        {/* ============ Section 3: Achievement Badges ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Collection" title="Achievement Badges" delay={0.1 / (PHI * PHI)} />
          <GlassCard glowColor="terminal" className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {BADGES.map((badge, i) => {
                const earned = badge.earned
                return (
                  <motion.div
                    key={badge.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true, margin: '-20px' }}
                    transition={{ delay: i * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                    className={`relative flex flex-col items-center p-3 rounded-xl border transition-colors ${
                      earned
                        ? 'bg-cyan-500/5 border-cyan-500/20 hover:border-cyan-500/40'
                        : 'bg-black/20 border-black-700/30 opacity-50'
                    }`}
                  >
                    {/* Badge icon */}
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 font-mono font-bold text-sm ${
                        earned
                          ? 'text-cyan-400'
                          : 'text-black-600'
                      }`}
                      style={{
                        background: earned
                          ? 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(34,197,94,0.1))'
                          : 'rgba(30,30,30,0.5)',
                        border: earned
                          ? '1px solid rgba(6,182,212,0.3)'
                          : '1px solid rgba(50,50,50,0.5)',
                      }}
                    >
                      {badge.icon}
                    </div>
                    <p className={`text-[11px] font-mono font-bold text-center ${
                      earned ? 'text-white' : 'text-black-600'
                    }`}>
                      {badge.name}
                    </p>
                    <p className="text-[9px] font-mono text-black-500 text-center mt-0.5">
                      {earned ? badge.desc : 'Locked'}
                    </p>
                    {/* Earned glow pulse */}
                    {earned && (
                      <motion.div
                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: CYAN }}
                        animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0.3, 0.8] }}
                        transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }}
                      />
                    )}
                  </motion.div>
                )
              })}
            </div>
            <div className="mt-4 text-center">
              <span className="text-[10px] font-mono text-black-500">
                {BADGES.filter((b) => b.earned).length} / {BADGES.length} badges earned
              </span>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Section 4: Trading History Summary ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Analytics" title="Trading History" delay={0.1} />
          <GlassCard glowColor="terminal" className="p-5">
            {/* PnL chart */}
            <div className="mb-5">
              <p className="text-[10px] font-mono text-black-500 uppercase mb-2">7-Day PnL</p>
              <PnLChart data={PNL_DAYS} />
            </div>

            {/* Win/Loss stats */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-black/30 rounded-lg p-3 border border-cyan-500/15 text-center">
                <p className="text-[10px] font-mono text-black-500 uppercase">Win Rate</p>
                <p className="text-xl font-bold font-mono text-green-400 mt-1">{TRADING_SUMMARY.winRate}%</p>
              </div>
              <div className="bg-black/30 rounded-lg p-3 border border-green-500/15 text-center">
                <p className="text-[10px] font-mono text-black-500 uppercase">Wins</p>
                <p className="text-xl font-bold font-mono text-green-400 mt-1">{TRADING_SUMMARY.wins}</p>
              </div>
              <div className="bg-black/30 rounded-lg p-3 border border-red-500/15 text-center">
                <p className="text-[10px] font-mono text-black-500 uppercase">Losses</p>
                <p className="text-xl font-bold font-mono text-red-400 mt-1">{TRADING_SUMMARY.losses}</p>
              </div>
            </div>

            {/* Best / Worst trade */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black/30 rounded-xl p-4 border border-green-500/20">
                <p className="text-[10px] font-mono text-black-500 uppercase mb-1">Best Trade</p>
                <p className="text-lg font-bold font-mono text-green-400">{TRADING_SUMMARY.bestTrade.pnl}</p>
                <p className="text-[10px] font-mono text-black-400 mt-1">{TRADING_SUMMARY.bestTrade.pair}</p>
                <p className="text-[9px] font-mono text-black-500">{TRADING_SUMMARY.bestTrade.date}</p>
              </div>
              <div className="bg-black/30 rounded-xl p-4 border border-red-500/20">
                <p className="text-[10px] font-mono text-black-500 uppercase mb-1">Worst Trade</p>
                <p className="text-lg font-bold font-mono text-red-400">{TRADING_SUMMARY.worstTrade.pnl}</p>
                <p className="text-[10px] font-mono text-black-400 mt-1">{TRADING_SUMMARY.worstTrade.pair}</p>
                <p className="text-[9px] font-mono text-black-500">{TRADING_SUMMARY.worstTrade.date}</p>
              </div>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Section 5: Connected Accounts ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Connections" title="Connected Accounts" delay={0.1 / PHI} />
          <GlassCard glowColor="terminal" className="p-5">
            {/* Wallet type */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-black-700/30">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm"
                  style={{
                    background: isExternalConnected
                      ? 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(6,182,212,0.1))'
                      : 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(6,182,212,0.1))',
                    border: '1px solid rgba(6,182,212,0.2)',
                    color: CYAN,
                  }}
                >
                  {isExternalConnected ? 'EW' : 'DW'}
                </div>
                <div>
                  <p className="text-sm font-mono font-bold text-white">
                    {isExternalConnected ? 'External Wallet' : 'Device Wallet'}
                  </p>
                  <p className="text-[10px] font-mono text-black-500">
                    {isExternalConnected ? 'MetaMask / WalletConnect' : 'WebAuthn / Passkey'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] font-mono text-green-400">Connected</span>
              </div>
            </div>

            {/* Connected chains */}
            <div className="mb-4 pb-4 border-b border-black-700/30">
              <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Connected Chains</p>
              <div className="flex flex-wrap gap-2">
                {CONNECTED_CHAINS.map((chain) => (
                  <span
                    key={chain}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-lg border border-cyan-500/20 text-cyan-400 bg-cyan-500/5"
                  >
                    {chain}
                  </span>
                ))}
              </div>
            </div>

            {/* Last active */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-black-500 uppercase">Last Active</p>
              <p className="text-[11px] font-mono text-black-400">Just now</p>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Section 6: Danger Zone ============ */}
        <motion.section variants={fadeUp}>
          <SectionHeader tag="Caution" title="Danger Zone" delay={0.1 / (PHI * PHI)} />
          <GlassCard glowColor="warning" className="p-5">
            <div className="space-y-4">
              {/* Export Data */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <div>
                  <p className="text-sm font-mono font-bold text-amber-400">Export Account Data</p>
                  <p className="text-[10px] font-mono text-black-500 mt-0.5">
                    Download your trading history, rewards, and profile data as JSON
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowExportConfirm(!showExportConfirm)}
                  className="shrink-0 px-4 py-2 rounded-lg border border-amber-500/30 text-amber-400 font-mono text-xs font-bold hover:bg-amber-500/10 transition-colors"
                >
                  Export
                </motion.button>
              </div>
              {showExportConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
                  className="bg-amber-500/5 rounded-lg p-3 border border-amber-500/15 text-center"
                >
                  <p className="text-[11px] font-mono text-amber-400 mb-2">
                    Your data export will be prepared. This may take a moment.
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="px-4 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 font-mono text-xs font-bold hover:bg-amber-500/30 transition-colors"
                  >
                    Confirm Export
                  </motion.button>
                </motion.div>
              )}

              {/* Disconnect Wallet */}
              <div className="flex items-center justify-between p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                <div>
                  <p className="text-sm font-mono font-bold text-red-400">Disconnect Wallet</p>
                  <p className="text-[10px] font-mono text-black-500 mt-0.5">
                    Remove wallet connection. You can reconnect at any time.
                  </p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowDisconnectConfirm(!showDisconnectConfirm)}
                  className="shrink-0 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 font-mono text-xs font-bold hover:bg-red-500/10 transition-colors"
                >
                  Disconnect
                </motion.button>
              </div>
              {showDisconnectConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
                  className="bg-red-500/5 rounded-lg p-3 border border-red-500/15 text-center"
                >
                  <p className="text-[11px] font-mono text-red-400 mb-2">
                    Are you sure? This will disconnect your wallet from VibeSwap.
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 font-mono text-xs font-bold hover:bg-red-500/30 transition-colors"
                  >
                    Yes, Disconnect
                  </motion.button>
                </motion.div>
              )}
            </div>

            <p className="text-[10px] font-mono text-black-500 text-center mt-4">
              Your on-chain data persists regardless of connection state.
            </p>
          </GlassCard>
        </motion.section>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-black-500">
            "Your keys, your coins. Your data, your profile."
          </p>
        </motion.div>
      </motion.div>
    </div>
  )
}
