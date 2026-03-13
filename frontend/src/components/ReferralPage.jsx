import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' },
  }),
}

// ============ Tier Configuration ============

const TIERS = [
  { name: 'Bronze',  minRefs: 0,  maxRefs: 4,   rebate: 10, color: '#cd7f32', icon: 'B', border: 'border-orange-500/30', bg: 'bg-orange-500/10' },
  { name: 'Silver',  minRefs: 5,  maxRefs: 19,  rebate: 15, color: '#c0c0c0', icon: 'S', border: 'border-gray-400/30',   bg: 'bg-gray-400/10' },
  { name: 'Gold',    minRefs: 20, maxRefs: 49,  rebate: 20, color: '#ffd700', icon: 'G', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10' },
  { name: 'Diamond', minRefs: 50, maxRefs: null, rebate: 30, color: '#b9f2ff', icon: 'D', border: 'border-cyan-300/30',  bg: 'bg-cyan-300/10' },
]

// ============ Mock Referral Data ============

const MOCK_REFERRALS = [
  { address: '0x7a3F...e91B', dateJoined: '2026-02-14', volume: 142_800, earnings: 428.40 },
  { address: '0x1dC4...f3A2', dateJoined: '2026-02-21', volume: 89_400,  earnings: 268.20 },
  { address: '0xbE56...2c7D', dateJoined: '2026-03-01', volume: 215_600, earnings: 646.80 },
  { address: '0x4fA8...d0E9', dateJoined: '2026-03-03', volume: 67_200,  earnings: 201.60 },
  { address: '0x9C12...a5F6', dateJoined: '2026-03-07', volume: 34_100,  earnings: 102.30 },
  { address: '0x3eD7...b8C1', dateJoined: '2026-03-10', volume: 11_500,  earnings: 34.50 },
]

// ============ Section Wrapper ============

function Section({ index, tag, title, children }) {
  return (
    <motion.section
      custom={index}
      variants={sectionV}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      <div className="mb-3">
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: CYAN, opacity: 0.7 }}>{tag}</span>
        <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
      </div>
      {children}
    </motion.section>
  )
}

// ============ How It Works Step Card ============

function StepCard({ number, title, description, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 1 / PHI, ease: 'easeOut' }}
    >
      <GlassCard glowColor="terminal" className="p-5 h-full" hover>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-lg mb-3"
          style={{ background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}
        >
          {number}
        </div>
        <h3 className="text-sm font-bold font-mono text-white mb-1">{title}</h3>
        <p className="text-[11px] font-mono text-gray-500 leading-relaxed">{description}</p>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function ReferralPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [copied, setCopied] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)

  // ============ Mock User State ============

  const referralLink = 'vibeswap.xyz/ref/0x1234'
  const totalReferrals = 24
  const totalVolume = 560_600
  const totalEarnings = 1_681.80
  const pendingRewards = 312.45
  const currentTierIndex = 2 // Gold

  // ============ Handlers ============

  const handleCopy = () => {
    navigator.clipboard?.writeText(`https://${referralLink}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClaim = () => {
    setIsClaiming(true)
    setTimeout(() => setIsClaiming(false), 2000)
  }

  // ============ Not Connected State ============

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            <div
              className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Connect to <span style={{ color: CYAN }}>Refer</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Share your referral link, earn rebates on every trade your friends make.
            </p>
            <button
              onClick={connect}
              className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}
            >
              Connect Wallet
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected View ============

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="community"
        title="Referral Program"
        subtitle="Grow the network, earn rebates on every trade your referrals make"
        badge="Live"
        badgeColor="#a855f7"
      />

      <div className="space-y-10">

        {/* ============ Section 1: Your Referral Link ============ */}
        <Section index={0} tag="Share" title="Your Referral Link">
          <GlassCard glowColor="terminal" className="p-5">
            <p className="text-xs font-mono text-gray-500 mb-3">
              Share this link with friends. When they trade on VibeSwap, you both earn rewards.
            </p>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 rounded-xl px-4 py-3 font-mono text-sm truncate"
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  color: CYAN,
                  border: `1px solid ${CYAN}25`,
                }}
              >
                {referralLink}
              </div>
              <motion.button
                onClick={handleCopy}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                className="shrink-0 px-5 py-3 rounded-xl font-mono text-xs font-bold transition-colors"
                style={{
                  background: copied ? 'rgba(34,197,94,0.2)' : `${CYAN}20`,
                  color: copied ? '#22c55e' : CYAN,
                  border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : `${CYAN}40`}`,
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </motion.button>
            </div>
            <p className="text-[10px] font-mono text-gray-600 mt-3 text-center">
              Referral rewards are tracked on-chain via Shapley attribution
            </p>
          </GlassCard>
        </Section>

        {/* ============ Section 2: How It Works ============ */}
        <Section index={1} tag="Process" title="How It Works">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StepCard
              number="1"
              title="Share Your Link"
              description="Copy your unique referral link and share it with friends, on social media, or in your community."
              delay={0.1}
            />
            <StepCard
              number="2"
              title="Friends Trade"
              description="When someone uses your link and trades on VibeSwap, they are permanently linked to your referral address."
              delay={0.1 + 0.06 / PHI}
            />
            <StepCard
              number="3"
              title="Earn Rewards"
              description="You receive a percentage rebate on every trade your referrals make. Higher tiers unlock larger rebates."
              delay={0.1 + 0.12 / PHI}
            />
          </div>
        </Section>

        {/* ============ Section 3: Tier System ============ */}
        <Section index={2} tag="Progression" title="Referral Tiers">
          <GlassCard glowColor="terminal" className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TIERS.map((tier, i) => {
                const isActive = i === currentTierIndex
                return (
                  <motion.div
                    key={tier.name}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ delay: i * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                    className={`relative rounded-xl p-4 border text-center transition-all ${tier.border} ${tier.bg}`}
                    style={{
                      boxShadow: isActive ? `0 0 24px ${tier.color}20, inset 0 0 12px ${tier.color}08` : 'none',
                      borderWidth: isActive ? '2px' : '1px',
                    }}
                  >
                    {isActive && (
                      <motion.div
                        className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold"
                        style={{ background: tier.color, color: '#000' }}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        CURRENT
                      </motion.div>
                    )}
                    <div
                      className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center font-mono font-bold text-lg mb-2"
                      style={{ background: `${tier.color}20`, color: tier.color, border: `1px solid ${tier.color}40` }}
                    >
                      {tier.icon}
                    </div>
                    <div className="text-sm font-bold font-mono text-white">{tier.name}</div>
                    <div className="text-2xl font-bold font-mono mt-1" style={{ color: tier.color }}>
                      {tier.rebate}%
                    </div>
                    <div className="text-[10px] font-mono text-gray-500 mt-1">rebate</div>
                    <div className="text-[10px] font-mono text-gray-600 mt-2">
                      {tier.maxRefs !== null ? `${tier.minRefs}-${tier.maxRefs} refs` : `${tier.minRefs}+ refs`}
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: tier.color }}
                        initial={{ width: 0 }}
                        whileInView={{ width: i <= currentTierIndex ? '100%' : '0%' }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                      />
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <div className="mt-4 p-3 rounded-xl border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
              <p className="text-[10px] font-mono text-gray-500">
                You have <span style={{ color: CYAN }} className="font-bold">{totalReferrals} referrals</span> — need{' '}
                <span className="text-white font-bold">{TIERS[currentTierIndex + 1]?.minRefs - totalReferrals || 0} more</span>{' '}
                to reach <span style={{ color: TIERS[currentTierIndex + 1]?.color || CYAN }} className="font-bold">
                  {TIERS[currentTierIndex + 1]?.name || 'Max Tier'}
                </span>
              </p>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 4: Your Stats ============ */}
        <Section index={3} tag="Dashboard" title="Your Stats">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            {[
              { label: 'Total Referrals', value: totalReferrals.toString(), color: CYAN, sub: 'active users' },
              { label: 'Referral Volume', value: `$${(totalVolume / 1000).toFixed(1)}K`, color: '#a855f7', sub: 'all time' },
              { label: 'Rewards Earned', value: `$${totalEarnings.toFixed(2)}`, color: '#22c55e', sub: 'lifetime' },
              { label: 'Pending Rewards', value: `$${pendingRewards.toFixed(2)}`, color: '#f59e0b', sub: 'claimable' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * (0.06 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              >
                <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                  <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">{stat.label}</div>
                  <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: stat.color }}>
                    {stat.value}
                  </div>
                  <div className="text-[10px] font-mono text-gray-600 mt-1">{stat.sub}</div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </Section>

        {/* ============ Section 5: Recent Referrals ============ */}
        <Section index={4} tag="Network" title="Recent Referrals">
          <GlassCard glowColor="terminal" className="p-5">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-800/50 text-[10px] font-mono text-gray-500 uppercase">
              <div className="col-span-3">Address</div>
              <div className="col-span-3">Date Joined</div>
              <div className="col-span-3 text-right">Volume</div>
              <div className="col-span-3 text-right">Your Earnings</div>
            </div>
            {/* Table rows */}
            <div className="space-y-0.5">
              {MOCK_REFERRALS.map((ref, i) => (
                <motion.div
                  key={ref.address}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * (0.04 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                  className="grid grid-cols-12 gap-2 py-2.5 border-b border-gray-800/20 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors"
                >
                  <div className="col-span-3 text-gray-300 truncate">{ref.address}</div>
                  <div className="col-span-3 text-gray-500">{ref.dateJoined}</div>
                  <div className="col-span-3 text-right text-gray-300">
                    ${ref.volume.toLocaleString()}
                  </div>
                  <div className="col-span-3 text-right font-bold" style={{ color: '#22c55e' }}>
                    +${ref.earnings.toFixed(2)}
                  </div>
                </motion.div>
              ))}
            </div>
            {/* Summary footer */}
            <div className="mt-3 pt-3 border-t border-gray-800/30 flex items-center justify-between">
              <span className="text-[10px] font-mono text-gray-500">
                Showing {MOCK_REFERRALS.length} of {totalReferrals} referrals
              </span>
              <span className="text-[10px] font-mono" style={{ color: '#22c55e' }}>
                Total: ${MOCK_REFERRALS.reduce((s, r) => s + r.earnings, 0).toFixed(2)}
              </span>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Section 6: Claim Rewards ============ */}
        <Section index={5} tag="Collect" title="Claim Rewards">
          <GlassCard glowColor="terminal" className="p-5">
            <div className="text-center mb-5">
              <p className="text-xs font-mono text-gray-500 uppercase mb-2">Available to Claim</p>
              <p className="text-4xl font-bold font-mono" style={{ color: '#22c55e' }}>
                {pendingRewards.toFixed(2)} <span className="text-lg" style={{ color: 'rgba(34,197,94,0.6)' }}>JUL</span>
              </p>
              <p className="text-xs font-mono text-gray-500 mt-1">
                ~ ${(pendingRewards * 1.24).toFixed(2)} USD
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: 'Current Tier', val: TIERS[currentTierIndex].name, color: TIERS[currentTierIndex].color },
                { label: 'Rebate Rate', val: `${TIERS[currentTierIndex].rebate}%`, color: CYAN },
              ].map((b) => (
                <div
                  key={b.label}
                  className="rounded-xl p-3 border text-center"
                  style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}
                >
                  <p className="text-[10px] font-mono text-gray-500 uppercase">{b.label}</p>
                  <p className="text-sm font-bold font-mono mt-1" style={{ color: b.color }}>{b.val}</p>
                </div>
              ))}
            </div>

            <motion.button
              onClick={handleClaim}
              disabled={isClaiming || pendingRewards <= 0}
              className="relative w-full py-4 rounded-2xl font-bold font-mono text-lg overflow-hidden disabled:opacity-50 transition-all"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Background glow */}
              <div className="absolute inset-0 bg-gradient-to-r from-green-600 via-emerald-500 to-green-600" />
              {/* Animated shine */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                animate={{ x: ['-100%', '200%'] }}
                transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                style={{ width: '50%' }}
              />
              {/* Pulse ring */}
              {pendingRewards > 0 && !isClaiming && (
                <motion.div
                  className="absolute inset-0 rounded-2xl border-2 border-green-400/40"
                  animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }}
                />
              )}
              <span className="relative z-10 text-black drop-shadow-sm">
                {isClaiming ? 'Claiming...' : `Claim ${pendingRewards.toFixed(2)} JUL`}
              </span>
            </motion.button>

            <p className="text-[10px] font-mono text-gray-500 text-center mt-3">
              Referral rewards are distributed every batch. Claims are gas-subsidized for Gold+ tiers.
            </p>
          </GlassCard>
        </Section>

        {/* ============ Explore More ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="flex flex-wrap justify-center gap-3 pt-4"
        >
          <a href="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Rewards</a>
          <a href="/economics" className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">Economics</a>
          <a href="/game-theory" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Game Theory</a>
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-gray-500">
            "Grow the network, share the value — cooperative capitalism in action."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
