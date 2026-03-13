import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Rewards Dashboard ============
// Comprehensive rewards page: overview stats, Shapley attribution,
// reward sources with sparklines, loyalty tiers, claim flow,
// history table, and referral program.

const PHI = 1.618033988749895

// Seeded PRNG — deterministic across renders
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Mock Data Generation ============
function generateRewardHistory(seed, count = 20) {
  const rng = seededRandom(seed)
  const sources = ['Trading Fees', 'LP Provision', 'Governance', 'Referrals']
  const pools = ['ETH/USDC', 'BTC/ETH', 'JUL/USDC', 'ARB/ETH', 'OP/USDC']
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => ({
    id: count - i,
    date: new Date(now - i * 10 * 60 * 1000 * (1 + rng() * 3)),
    amount: 12 + rng() * 180,
    source: sources[Math.floor(rng() * sources.length)],
    batch: 48200 - i,
    pool: pools[Math.floor(rng() * pools.length)],
  }))
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
      <span className="text-[10px] font-mono text-green-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

// ============ Countdown Timer ============
function CountdownTimer() {
  const [seconds, setSeconds] = useState(7)

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => (prev <= 0 ? 9 : prev - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const display = `00:0${seconds}`

  return (
    <div className="font-mono text-2xl font-bold text-green-400 tabular-nums">
      {display}
    </div>
  )
}

// ============ Shapley Attribution SVG ============
function ShapleyDiagram() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" className="w-full max-w-[320px]">
      {/* You node */}
      <circle cx="60" cy="90" r="28" fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth="1.5" />
      <circle cx="60" cy="90" r="22" fill="rgba(34,197,94,0.1)" />
      <text x="60" y="86" textAnchor="middle" fill="rgba(34,197,94,0.9)" fontSize="10" fontFamily="monospace" fontWeight="bold">YOU</text>
      <text x="60" y="98" textAnchor="middle" fill="rgba(34,197,94,0.6)" fontSize="8" fontFamily="monospace">v(i)</text>
      {/* Coalition nodes: C1=LPs, C2=Traders, C3=Voters */}
      <circle cx="160" cy="40" r="18" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.4)" strokeWidth="1" strokeDasharray="3,3" />
      <text x="160" y="38" textAnchor="middle" fill="rgba(59,130,246,0.8)" fontSize="8" fontFamily="monospace">C1</text>
      <text x="160" y="48" textAnchor="middle" fill="rgba(59,130,246,0.5)" fontSize="7" fontFamily="monospace">LPs</text>
      <circle cx="160" cy="90" r="18" fill="rgba(245,158,11,0.1)" stroke="rgba(245,158,11,0.4)" strokeWidth="1" strokeDasharray="3,3" />
      <text x="160" y="88" textAnchor="middle" fill="rgba(245,158,11,0.8)" fontSize="8" fontFamily="monospace">C2</text>
      <text x="160" y="98" textAnchor="middle" fill="rgba(245,158,11,0.5)" fontSize="7" fontFamily="monospace">Traders</text>
      <circle cx="160" cy="140" r="18" fill="rgba(168,85,247,0.1)" stroke="rgba(168,85,247,0.4)" strokeWidth="1" strokeDasharray="3,3" />
      <text x="160" y="138" textAnchor="middle" fill="rgba(168,85,247,0.8)" fontSize="8" fontFamily="monospace">C3</text>
      <text x="160" y="148" textAnchor="middle" fill="rgba(168,85,247,0.5)" fontSize="7" fontFamily="monospace">Voters</text>
      {/* Connections + plus signs */}
      <line x1="88" y1="80" x2="142" y2="45" stroke="rgba(34,197,94,0.3)" strokeWidth="1" strokeDasharray="4,4" />
      <line x1="88" y1="90" x2="142" y2="90" stroke="rgba(34,197,94,0.3)" strokeWidth="1" strokeDasharray="4,4" />
      <line x1="88" y1="100" x2="142" y2="135" stroke="rgba(34,197,94,0.3)" strokeWidth="1" strokeDasharray="4,4" />
      <text x="115" y="65" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12" fontFamily="monospace">+</text>
      <text x="115" y="93" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12" fontFamily="monospace">+</text>
      <text x="115" y="123" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12" fontFamily="monospace">+</text>
      {/* Arrow to marginal value result */}
      <line x1="185" y1="90" x2="230" y2="90" stroke="rgba(34,197,94,0.4)" strokeWidth="1.5" />
      <polygon points="230,85 242,90 230,95" fill="rgba(34,197,94,0.5)" />
      <rect x="248" y="62" width="66" height="56" rx="10" fill="rgba(34,197,94,0.08)" stroke="rgba(34,197,94,0.35)" strokeWidth="1.5" />
      <text x="281" y="82" textAnchor="middle" fill="rgba(34,197,94,0.5)" fontSize="7" fontFamily="monospace">MARGINAL</text>
      <text x="281" y="94" textAnchor="middle" fill="rgba(34,197,94,0.9)" fontSize="12" fontFamily="monospace" fontWeight="bold">$47.82</text>
      <text x="281" y="108" textAnchor="middle" fill="rgba(34,197,94,0.5)" fontSize="7" fontFamily="monospace">VALUE ADDED</text>
      {/* Shapley formula */}
      <text x="160" y="175" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="monospace">phi(i) = SUM |S|!(n-|S|-1)!/n! * [v(S+i) - v(S)]</text>
    </svg>
  )
}

// ============ Claim Button with Pulse ============
function ClaimButton({ amount, onClaim, isClaiming }) {
  return (
    <motion.button
      onClick={onClaim}
      disabled={isClaiming || amount <= 0}
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
      {/* Outer pulse ring */}
      {amount > 0 && !isClaiming && (
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-green-400/40"
          animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }}
        />
      )}
      <span className="relative z-10 text-black drop-shadow-sm">
        {isClaiming ? 'Claiming...' : `Claim ${amount.toFixed(2)} JUL`}
      </span>
    </motion.button>
  )
}

// ============ Loyalty Tier Badge ============
function TierBadge({ tier, size = 'lg' }) {
  const tierConfig = {
    Bronze:  { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', icon: 'B' },
    Silver:  { color: 'text-gray-300',   bg: 'bg-gray-500/10',   border: 'border-gray-500/30',   icon: 'S' },
    Gold:    { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: 'G' },
    Diamond: { color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',   icon: 'D' },
  }
  const cfg = tierConfig[tier] || tierConfig.Bronze
  const sizeClass = size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-10 h-10 text-base'

  return (
    <div className={`${sizeClass} ${cfg.bg} ${cfg.color} border ${cfg.border} rounded-xl flex items-center justify-center font-mono font-bold`}>
      {cfg.icon}
    </div>
  )
}

// ============ Main Component ============
export default function RewardsPage() {
  const [isClaiming, setIsClaiming] = useState(false)
  // Seeded mock data — stable across renders

  const totalEarned = 4_218.47
  const unclaimed = 347.82
  const streakBonus = 1.35
  const currentTier = 'Gold'
  const tierProgress = 68
  const daysActive = 127
  const referralCount = 14
  const referralEarnings = 284.60
  const referralLink = 'vibeswap.io/r/0x7F3a'

  const rewardSources = useMemo(() => [
    { label: 'Trading Fees',    amount: 1842.30, pct: 43.7, seed: 5001, color: '#22c55e' },
    { label: 'LP Provision',    amount: 1523.17, pct: 36.1, seed: 5002, color: '#3b82f6' },
    { label: 'Governance',      amount: 568.40,  pct: 13.5, seed: 5003, color: '#a855f7' },
    { label: 'Referrals',       amount: 284.60,  pct: 6.7,  seed: 5004, color: '#f59e0b' },
  ], [])

  const rewardHistory = useMemo(() => generateRewardHistory(8888, 20), [])

  const earnedSparkData = useMemo(() => generateSparklineData(6001, 20, 0.025), [])
  const unclaimedSparkData = useMemo(() => generateSparklineData(6002, 20, 0.04), [])
  const streakSparkData = useMemo(() => generateSparklineData(6003, 20, 0.015), [])

  const handleClaim = () => {
    setIsClaiming(true)
    setTimeout(() => setIsClaiming(false), 2000)
  }

  const loyaltyTiers = [
    { name: 'Bronze',  minDays: 0,   multiplier: 1.0,  benefits: 'Base rewards, batch participation' },
    { name: 'Silver',  minDays: 30,  multiplier: 1.25, benefits: '+25% rewards, priority reveals' },
    { name: 'Gold',    minDays: 90,  multiplier: 1.50, benefits: '+50% rewards, IL protection boost' },
    { name: 'Diamond', minDays: 180, multiplier: 2.0,  benefits: '2x rewards, governance weight, zero-fee claims' },
  ]

  const currentTierIndex = loyaltyTiers.findIndex(t => t.name === currentTier)
  const nextTier = loyaltyTiers[currentTierIndex + 1]

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="defi"
        title="Rewards"
        subtitle="Earn from every interaction — Shapley-powered distribution"
        badge="Live"
        badgeColor="#22c55e"
      />

      <div className="space-y-10">
        {/* ============ Section 1: Rewards Overview ============ */}
        <section>
          <SectionHeader tag="Your Earnings" title="Rewards Overview" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            <StatCard label="Total Earned" value={totalEarned} prefix="$" decimals={2} change={12.4} sparkData={earnedSparkData} size="sm" />
            <StatCard label="Unclaimed" value={unclaimed} prefix="$" decimals={2} change={8.2} sparkData={unclaimedSparkData} size="sm" />
            <StatCard label="Streak Bonus" value={streakBonus} suffix="x" decimals={2} change={2.1} sparkData={streakSparkData} size="sm" />
            <GlassCard glowColor="terminal" className="p-4">
              <div className="text-xs text-black-500 mb-1">Next Distribution</div>
              <CountdownTimer />
              <div className="text-[10px] font-mono text-green-400/50 mt-1">10s batches</div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 2: Reward Sources ============ */}
        <section>
          <SectionHeader tag="Breakdown" title="Reward Sources" delay={0.1 / PHI} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {rewardSources.map((source, i) => {
              const sparkData = generateSparklineData(source.seed, 20, 0.03)
              return (
                <motion.div
                  key={source.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: i * (0.1 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
                >
                  <GlassCard glowColor="matrix" className="p-4 h-full">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs font-mono text-black-500 uppercase">{source.label}</p>
                        <p className="text-xl font-bold font-mono text-white mt-1">
                          ${source.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border" style={{ color: source.color, borderColor: `${source.color}33`, backgroundColor: `${source.color}11` }}>
                          {source.pct}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="text-[10px] font-mono text-green-400">
                        +{(source.amount * 0.024).toFixed(2)} last batch
                      </div>
                      <Sparkline data={sparkData} width={64} height={20} color={source.color} />
                    </div>
                    {/* Proportion bar */}
                    <div className="mt-3 h-1 bg-black/30 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${source.pct}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: source.color }}
                      />
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </motion.div>
        </section>

        {/* ============ Section 3: Shapley Attribution ============ */}
        <section>
          <SectionHeader tag="Game Theory" title="Shapley Attribution" delay={0.1 / (PHI * PHI)} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="matrix" className="p-5">
              <p className="text-xs font-mono text-black-400 leading-relaxed mb-4">
                Your reward is your <span className="text-green-400">marginal contribution</span> — the
                value each coalition gains by including you. This ensures fairness: you earn exactly
                what you add, no more, no less.
              </p>

              {/* SVG Diagram */}
              <div className="flex justify-center mb-5">
                <ShapleyDiagram />
              </div>

              {/* Breakdown bars */}
              <div className="space-y-3">
                {[
                  { label: 'Direct Contribution', value: 40, amount: 139.13, color: 'bg-green-500' },
                  { label: 'Enabling Value',      value: 30, amount: 104.35, color: 'bg-blue-500' },
                  { label: 'Scarcity Premium',    value: 20, amount: 69.56,  color: 'bg-amber-500' },
                  { label: 'Stability Bonus',     value: 10, amount: 34.78,  color: 'bg-purple-500' },
                ].map((comp, i) => (
                  <div key={comp.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-mono text-black-400">{comp.label}</span>
                      <span className="text-[11px] font-mono text-white">${comp.amount.toFixed(2)} <span className="text-black-500">({comp.value}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${comp.value}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                        className={`h-full rounded-full ${comp.color}`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 bg-black/30 rounded-lg p-3 border border-green-500/15">
                <p className="text-[10px] font-mono text-green-400/70 text-center">
                  Shapley values are computed on-chain every batch. Your phi(i) updates every 10 seconds.
                </p>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 4: Claim Rewards ============ */}
        <section>
          <SectionHeader tag="Collect" title="Claim Rewards" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="matrix" className="p-5">
              <div className="text-center mb-5">
                <p className="text-xs font-mono text-black-500 uppercase mb-2">Available to Claim</p>
                <p className="text-4xl font-bold font-mono text-green-400">{unclaimed.toFixed(2)} <span className="text-lg text-green-400/60">JUL</span></p>
                <p className="text-xs font-mono text-black-500 mt-1">
                  ~ ${(unclaimed * 1.24).toFixed(2)} USD
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-5">
                {[{ label: 'From Fees', val: '218.40 JUL' }, { label: 'From Governance', val: '129.42 JUL' }].map((b) => (
                  <div key={b.label} className="bg-black/30 rounded-lg p-3 border border-green-500/15 text-center">
                    <p className="text-[10px] font-mono text-black-500 uppercase">{b.label}</p>
                    <p className="text-sm font-bold font-mono text-white mt-1">{b.val}</p>
                  </div>
                ))}
              </div>

              <ClaimButton amount={unclaimed} onClaim={handleClaim} isClaiming={isClaiming} />

              <p className="text-[10px] font-mono text-black-500 text-center mt-3">
                Claims are batched on-chain. Gas is subsidized for Gold+ tiers.
              </p>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 5: Loyalty Tier ============ */}
        <section>
          <SectionHeader tag="Progression" title="Loyalty Tier" delay={0.1 / PHI} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="terminal" className="p-5">
              {/* Current tier display */}
              <div className="flex items-center gap-4 mb-5">
                <TierBadge tier={currentTier} />
                <div>
                  <p className="text-lg font-bold font-mono text-white">{currentTier}</p>
                  <p className="text-xs font-mono text-black-400">{daysActive} days active</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold font-mono text-yellow-400">{loyaltyTiers[currentTierIndex].multiplier.toFixed(1)}x</p>
                  <p className="text-[10px] font-mono text-black-500">multiplier</p>
                </div>
              </div>

              {/* Progress to next tier */}
              {nextTier && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-black-500 uppercase">Progress to {nextTier.name}</span>
                    <span className="text-[10px] font-mono text-black-400">{nextTier.minDays - daysActive} days remaining</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${tierProgress}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3, duration: 1, ease: 'easeOut' }}
                      className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-cyan-400"
                    />
                  </div>
                  <p className="text-[10px] font-mono text-black-500 mt-1">
                    Next: {nextTier.multiplier.toFixed(1)}x multiplier + {nextTier.benefits}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {loyaltyTiers.map((tier, i) => {
                  const isActive = tier.name === currentTier
                  const isPast = i < currentTierIndex
                  const bg = isActive ? 'bg-yellow-500/10 border-yellow-500/30' : isPast ? 'bg-green-500/5 border-green-500/15' : 'bg-black/20 border-black-700/30'
                  return (
                    <motion.div key={tier.name} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * (0.08 / PHI), duration: 1 / PHI }} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${bg}`}>
                      <div className="flex items-center gap-3">
                        <TierBadge tier={tier.name} size="sm" />
                        <div>
                          <p className={`text-xs font-mono font-bold ${isActive ? 'text-yellow-400' : isPast ? 'text-green-400/70' : 'text-black-400'}`}>{tier.name}</p>
                          <p className="text-[10px] font-mono text-black-500">{tier.benefits}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-mono font-bold ${isActive ? 'text-yellow-400' : 'text-black-400'}`}>{tier.multiplier.toFixed(1)}x</span>
                        <p className="text-[10px] font-mono text-black-500">{tier.minDays === 0 ? 'Start' : `${tier.minDays}+ days`}</p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 6: Reward History ============ */}
        <section>
          <SectionHeader tag="Ledger" title="Reward History" delay={0.1 / (PHI * PHI)} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="matrix" className="p-5">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-black-700/30 text-[10px] font-mono text-black-500 uppercase">
                <div className="col-span-3">Date</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-3">Source</div>
                <div className="col-span-2">Pool</div>
                <div className="col-span-2 text-right">Batch</div>
              </div>
              <div className="space-y-0.5 max-h-[400px] overflow-y-auto scrollbar-hide">
                {rewardHistory.map((entry, i) => {
                  const sc = { 'Trading Fees': 'text-green-400', 'LP Provision': 'text-blue-400', 'Governance': 'text-purple-400', 'Referrals': 'text-amber-400' }
                  const ts = entry.date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  return (
                    <motion.div key={entry.id} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.02, duration: 0.3 }} className="grid grid-cols-12 gap-2 py-2 border-b border-black-700/15 text-[11px] font-mono hover:bg-white/[0.02] rounded transition-colors">
                      <div className="col-span-3 text-black-400 truncate">{ts}</div>
                      <div className="col-span-2 text-right text-green-400 font-bold">+${entry.amount.toFixed(2)}</div>
                      <div className={`col-span-3 ${sc[entry.source] || 'text-black-400'}`}>{entry.source}</div>
                      <div className="col-span-2 text-black-400 truncate">{entry.pool}</div>
                      <div className="col-span-2 text-right text-black-500">#{entry.batch}</div>
                    </motion.div>
                  )
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-black-700/30 flex items-center justify-between">
                <span className="text-[10px] font-mono text-black-500">Showing last 20 distributions</span>
                <span className="text-[10px] font-mono text-green-400">Total: ${rewardHistory.reduce((sum, e) => sum + e.amount, 0).toFixed(2)}</span>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 7: Referral Program ============ */}
        <section>
          <SectionHeader tag="Network Effect" title="Referral Program" delay={0.1} />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 1 / PHI, ease: 'easeOut' }}
          >
            <GlassCard glowColor="terminal" className="p-5">
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Referrals', value: referralCount, color: 'text-cyan-400', border: 'border-cyan-500/15', sub: 'active users' },
                  { label: 'Earnings', value: `$${referralEarnings.toFixed(2)}`, color: 'text-green-400', border: 'border-green-500/15', sub: 'all time' },
                  { label: 'Rate', value: '5%', color: 'text-amber-400', border: 'border-amber-500/15', sub: 'of referee fees' },
                ].map((s) => (
                  <div key={s.label} className={`bg-black/30 rounded-lg p-3 border ${s.border} text-center`}>
                    <p className="text-[10px] font-mono text-black-500 uppercase">{s.label}</p>
                    <p className={`text-2xl font-bold font-mono ${s.color} mt-1`}>{s.value}</p>
                    <p className="text-[10px] font-mono text-black-500">{s.sub}</p>
                  </div>
                ))}
              </div>
              <div className="bg-black/30 rounded-xl p-4 border border-cyan-500/20">
                <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Your Referral Link</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-black/40 rounded-lg px-3 py-2 font-mono text-sm text-cyan-400 truncate border border-cyan-500/15">{referralLink}</div>
                  <motion.button className="shrink-0 px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-mono text-xs font-bold hover:bg-cyan-500/25 transition-colors" whileTap={{ scale: 0.95 }} onClick={() => navigator.clipboard?.writeText(referralLink)}>Copy</motion.button>
                </div>
              </div>
              <p className="text-[10px] font-mono text-black-500 text-center mt-3">
                Earn 5% of your referrals' trading fees for 6 months. Both parties benefit from Shapley attribution.
              </p>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Explore More ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="flex flex-wrap justify-center gap-3 pt-4"
        >
          <a href="/economics" className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">Economics</a>
          <a href="/game-theory" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Game Theory</a>
          <a href="/jul" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">JUL Token</a>
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 / PHI }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-black-500">
            "Your reward is your exact marginal contribution — no more, no less."
          </p>
        </motion.div>
      </div>
    </div>
  )
}
