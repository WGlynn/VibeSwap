import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}
const rand = seededRandom(707)

// ============ Staking Tiers ============
const TIERS = [
  { id: 'bronze',   label: 'Bronze',   icon: '\u25C9', color: '#cd7f32', lockDays: 0,   lockLabel: 'None',  baseApy: 4.0,  mult: 1.0 },
  { id: 'silver',   label: 'Silver',   icon: '\u25C8', color: '#c0c0c0', lockDays: 30,  lockLabel: '30d',   baseApy: 6.5,  mult: 1.25 },
  { id: 'gold',     label: 'Gold',     icon: '\u2726', color: '#ffd700', lockDays: 90,  lockLabel: '90d',   baseApy: 10.0, mult: 1.6 },
  { id: 'platinum', label: 'Platinum', icon: '\u2B23', color: '#e5e4e2', lockDays: 180, lockLabel: '180d',  baseApy: 14.5, mult: 2.2 },
  { id: 'diamond',  label: 'Diamond',  icon: '\u2666', color: '#b9f2ff', lockDays: 365, lockLabel: '365d',  baseApy: 22.0, mult: 3.0 },
]

// ============ Mock Protocol Stats ============
const PROTOCOL_STATS = {
  totalStaked: 8_427_310,
  currentApy: 12.8,
  yourStake: 24_750,
  pendingRewards: 1_037.42,
}

// ============ Mock Active Stakes ============
const ACTIVE_STAKES = [
  { id: 1, amount: 10000, tier: 'diamond',  startTs: Date.now() - 142 * 86400000, lockDays: 365 },
  { id: 2, amount: 8000,  tier: 'gold',     startTs: Date.now() - 61 * 86400000,  lockDays: 90 },
  { id: 3, amount: 5000,  tier: 'platinum', startTs: Date.now() - 94 * 86400000,  lockDays: 180 },
  { id: 4, amount: 1750,  tier: 'silver',   startTs: Date.now() - 22 * 86400000,  lockDays: 30 },
]

// ============ Mock Staking History ============
const STAKING_HISTORY = (() => {
  const actions = ['Stake', 'Claim', 'Compound', 'Unstake', 'Stake', 'Claim', 'Stake', 'Compound', 'Stake', 'Claim', 'Unstake', 'Stake']
  const tiers = ['diamond', 'gold', 'platinum', 'silver', 'bronze', 'gold', 'diamond', 'platinum', 'silver', 'bronze', 'gold', 'silver']
  return actions.map((action, i) => ({
    id: i + 1, action,
    amount: Math.floor(rand() * 15000) + 500,
    tier: action === 'Claim' || action === 'Compound' ? null : tiers[i],
    timestamp: Date.now() - (i * 3 + Math.floor(rand() * 5)) * 86400000,
    txHash: `0x${Array.from({ length: 8 }, () => Math.floor(rand() * 16).toString(16)).join('')}...`,
  }))
})()

// ============ Utility Functions ============
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function daysElapsed(startTs) { return Math.floor((Date.now() - startTs) / 86400000) }
function tierById(id) { return TIERS.find(t => t.id === id) || TIERS[0] }

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span>
        <span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Unlock Progress Bar ============
function UnlockProgress({ elapsed, total, color }) {
  const pct = Math.min(100, (elapsed / total) * 100)
  const isComplete = pct >= 100
  return (
    <div className="w-full">
      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
        <motion.div
          className="h-full rounded-full relative"
          style={{ background: isComplete ? '#34d399' : color || CYAN }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: PHI, ease: 'easeOut' }}
        >
          {pct > 8 && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)' }}
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] font-mono text-gray-600">{elapsed}d elapsed</span>
        <span className="text-[9px] font-mono" style={{ color: isComplete ? '#34d399' : '#6b7280' }}>
          {isComplete ? 'Unlocked' : `${total - elapsed}d remaining`}
        </span>
      </div>
    </div>
  )
}

// ============ Main Component ============
export default function StakingRewardsPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [calcAmount, setCalcAmount] = useState('10000')
  const [calcTier, setCalcTier] = useState(2)
  const [compoundEnabled, setCompoundEnabled] = useState(false)
  const [claimProcessing, setClaimProcessing] = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const HISTORY_PAGE_SIZE = 6

  // ============ Calculator Projections ============
  const projections = useMemo(() => {
    const amount = parseFloat(calcAmount) || 0
    const tier = TIERS[calcTier]
    const effectiveApy = tier.baseApy * tier.mult / 100
    const daily = amount * effectiveApy / 365
    const weekly = daily * 7
    const monthly = amount * effectiveApy / 12
    const yearly = amount * effectiveApy
    return { daily, weekly, monthly, yearly, effectiveApy: tier.baseApy * tier.mult, tier }
  }, [calcAmount, calcTier])

  // ============ Active Stakes With Computed Fields ============
  const activeStakesComputed = useMemo(() => {
    return ACTIVE_STAKES.map(stake => {
      const tier = tierById(stake.tier)
      const elapsed = daysElapsed(stake.startTs)
      const effectiveApy = tier.baseApy * tier.mult / 100
      const earnedEstimate = stake.amount * effectiveApy * (elapsed / 365)
      return { ...stake, tier, elapsed, earnedEstimate }
    })
  }, [])

  // ============ History Pagination ============
  const pagedHistory = useMemo(() => {
    const start = historyPage * HISTORY_PAGE_SIZE
    return STAKING_HISTORY.slice(start, start + HISTORY_PAGE_SIZE)
  }, [historyPage])
  const totalHistoryPages = Math.ceil(STAKING_HISTORY.length / HISTORY_PAGE_SIZE)

  const handleClaim = useCallback(() => {
    setClaimProcessing(true)
    setTimeout(() => setClaimProcessing(false), 2000)
  }, [])

  const actionColor = (action) => {
    switch (action) {
      case 'Stake': return CYAN
      case 'Claim': return '#34d399'
      case 'Compound': return '#a78bfa'
      case 'Unstake': return '#f87171'
      default: return '#9ca3af'
    }
  }

  // ============ Not Connected ============
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHero title="Staking Rewards" subtitle="Stake JUL to earn rewards, compound your yield, and climb the tier ladder." category="defi" />
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center mt-8">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Connect to View <span style={{ color: CYAN }}>Rewards</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Stake JUL tokens to earn rewards, unlock tier multipliers, and compound your returns.
            </p>
            <button onClick={connect} className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}>
              Connect Wallet
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected ============
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      <PageHero title="Staking Rewards" subtitle="Stake JUL to earn rewards, compound your yield, and climb the tier ladder."
        category="defi" badge="Live" badgeColor="#22c55e" />

      {/* ============ 01. Stats Row ============ */}
      <Section num="01" title="Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Staked', value: `${fmt(PROTOCOL_STATS.totalStaked)} JUL`, sub: 'protocol-wide' },
            { label: 'Current APY', value: `${PROTOCOL_STATS.currentApy}%`, color: CYAN, sub: 'weighted average' },
            { label: 'Your Stake', value: `${fmt(PROTOCOL_STATS.yourStake)} JUL`, sub: 'across all tiers' },
            { label: 'Pending Rewards', value: `${fmt(PROTOCOL_STATS.pendingRewards)} JUL`, color: '#34d399', sub: 'claimable now' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * (0.06 / PHI) }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono" style={{ color: s.color || 'white' }}>{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
                {s.sub && <div className="text-[9px] font-mono text-gray-600 mt-0.5">{s.sub}</div>}
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 02. Staking Calculator ============ */}
      <Section num="02" title="Staking Calculator" delay={0.12}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1.5 block">Stake Amount (JUL)</label>
              <div className="relative">
                <input type="number" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black/40 border rounded-xl px-4 py-3 pr-16 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: `${CYAN}40` }} />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button onClick={() => setCalcAmount('25000')}
                    className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold"
                    style={{ background: `${CYAN}20`, color: CYAN }}>MAX</button>
                  <span className="text-xs font-mono text-gray-500">JUL</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1.5 block">
                Tier: <span style={{ color: TIERS[calcTier].color }}>{TIERS[calcTier].label}</span>
                <span className="text-gray-600 ml-2">({TIERS[calcTier].mult}x multiplier)</span>
              </label>
              <input type="range" min={0} max={TIERS.length - 1} value={calcTier}
                onChange={(e) => setCalcTier(Number(e.target.value))}
                className="w-full mt-2 accent-cyan-500" />
              <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-1">
                {TIERS.map(t => <span key={t.id}>{t.label}</span>)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Daily', value: projections.daily },
              { label: 'Weekly', value: projections.weekly },
              { label: 'Monthly', value: projections.monthly },
              { label: 'Yearly', value: projections.yearly },
            ].map((p) => (
              <div key={p.label} className="p-3 rounded-xl text-center border"
                style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="text-base sm:text-lg font-mono font-bold" style={{ color: CYAN }}>
                  +{p.value >= 1000 ? fmt(p.value) : p.value.toFixed(2)}
                </div>
                <div className="text-[10px] font-mono text-gray-500 mt-0.5">JUL</div>
                <div className="text-[10px] font-mono text-gray-600">{p.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-center text-xs font-mono text-gray-500">
            {TIERS[calcTier].baseApy}% base APY x {TIERS[calcTier].mult} tier multiplier
            = <span style={{ color: CYAN }}>{projections.effectiveApy.toFixed(1)}%</span> effective APY
            {TIERS[calcTier].lockDays > 0 && <span className="text-gray-600"> / {TIERS[calcTier].lockLabel} lock</span>}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 03. Staking Tiers ============ */}
      <Section num="03" title="Staking Tiers" delay={0.18}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {TIERS.map((tier, i) => {
            const isActive = activeStakesComputed.some(s => s.tier.id === tier.id)
            return (
              <motion.div key={tier.id} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * (0.04 * PHI) }}>
                <GlassCard glowColor={isActive ? 'terminal' : 'none'} className="p-4 relative overflow-visible" hover>
                  {isActive && (
                    <div className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full"
                      style={{ background: '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.5)' }} />
                  )}
                  <div className="text-2xl mb-1" style={{ color: tier.color }}>{tier.icon}</div>
                  <div className="text-sm font-mono font-bold text-white">{tier.label}</div>
                  <div className="text-xl font-mono font-bold mt-1" style={{ color: isActive ? CYAN : '#9ca3af' }}>
                    {tier.mult}x
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">
                    {tier.lockDays === 0 ? 'No lock' : `${tier.lockLabel} lock`}
                  </div>
                  <div className="text-[10px] font-mono mt-1" style={{ color: tier.color }}>
                    {tier.baseApy}% base / {(tier.baseApy * tier.mult).toFixed(1)}% eff.
                  </div>
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full" style={{ background: tier.color }}
                      initial={{ width: 0 }} animate={{ width: `${(tier.mult / 3) * 100}%` }}
                      transition={{ duration: 0.8 * PHI, ease: 'easeOut' }} />
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 04. Active Stakes ============ */}
      <Section num="04" title="Active Stakes" delay={0.24}>
        <GlassCard glowColor="terminal" className="p-5">
          {activeStakesComputed.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-6">No active stakes</div>
          ) : (
            <div className="space-y-4">
              {activeStakesComputed.map((stake, i) => (
                <motion.div key={stake.id} className="p-4 rounded-xl border"
                  style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.26 + i * (0.05 * PHI) }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl" style={{ color: stake.tier.color }}>{stake.tier.icon}</span>
                      <div>
                        <div className="font-mono text-sm font-bold text-white">{fmt(stake.amount)} JUL</div>
                        <div className="text-[10px] font-mono text-gray-500">
                          {stake.tier.label} tier / {(stake.tier.baseApy * stake.tier.mult).toFixed(1)}% APY
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold" style={{ color: '#34d399' }}>
                        +{stake.earnedEstimate.toFixed(2)} JUL
                      </div>
                      <div className="text-[10px] font-mono text-gray-500">earned so far</div>
                    </div>
                  </div>
                  <UnlockProgress elapsed={stake.elapsed} total={stake.lockDays} color={stake.tier.color} />
                  <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-gray-600">
                    <span>Staked {fmtShortDate(stake.startTs)}</span>
                    <span>Unlocks {fmtShortDate(stake.startTs + stake.lockDays * 86400000)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>
      </Section>

      {/* ============ 05. Claim Rewards ============ */}
      <Section num="05" title="Claim Rewards" delay={0.30}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
            <div>
              <div className="font-mono text-xs text-gray-400 mb-1">Pending Rewards</div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-mono font-bold" style={{ color: '#34d399' }}>
                  {fmt(PROTOCOL_STATS.pendingRewards)}
                </span>
                <span className="text-sm font-mono text-gray-500">JUL</span>
              </div>
              <div className="text-[10px] font-mono text-gray-600 mt-1">
                ~${(PROTOCOL_STATS.pendingRewards * 0.87).toFixed(2)} USD at current price
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">Compound</span>
                <button onClick={() => setCompoundEnabled(!compoundEnabled)}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ background: compoundEnabled ? '#a78bfa' : '#374151' }}>
                  <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
                    animate={{ left: compoundEnabled ? 22 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                </button>
              </div>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={handleClaim} disabled={claimProcessing}
                className="px-6 py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-50"
                style={{
                  background: compoundEnabled ? 'linear-gradient(135deg, #a78bfa, #7c3aed)' : `linear-gradient(135deg, ${CYAN}, #0891b2)`,
                  color: '#000',
                  boxShadow: `0 0 20px ${compoundEnabled ? 'rgba(167,139,250,0.3)' : `${CYAN}30`}`,
                }}>
                {claimProcessing ? 'Processing...' : compoundEnabled ? 'Compound' : 'Claim Rewards'}
              </motion.button>
            </div>
          </div>
          <AnimatePresence>
            {compoundEnabled && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-3 rounded-xl border mb-4" style={{ background: 'rgba(167,139,250,0.06)', borderColor: 'rgba(167,139,250,0.2)' }}>
                  <div className="font-mono text-xs text-gray-300 leading-relaxed">
                    Compounding restakes your {fmt(PROTOCOL_STATS.pendingRewards)} JUL rewards into your
                    highest-tier active stake, increasing principal and accelerating yield through compound interest.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Trading Fees', amount: PROTOCOL_STATS.pendingRewards * 0.45, pct: 45 },
              { label: 'LP Revenue', amount: PROTOCOL_STATS.pendingRewards * 0.28, pct: 28 },
              { label: 'Governance', amount: PROTOCOL_STATS.pendingRewards * 0.18, pct: 18 },
              { label: 'Referrals', amount: PROTOCOL_STATS.pendingRewards * 0.09, pct: 9 },
            ].map((source, i) => (
              <div key={source.label} className="p-3 rounded-xl border text-center"
                style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{source.amount.toFixed(2)}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-0.5">{source.label}</div>
                <div className="h-1 rounded-full overflow-hidden mt-2" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full" style={{ background: CYAN }}
                    initial={{ width: 0 }} animate={{ width: `${source.pct}%` }}
                    transition={{ duration: 0.8, delay: i * 0.1 }} />
                </div>
                <div className="text-[9px] font-mono text-gray-600 mt-1">{source.pct}%</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 06. Tier Comparison Table ============ */}
      <Section num="06" title="Tier Comparison" delay={0.36}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Tier</div><div>Lock Period</div><div>Base APY</div>
            <div>Multiplier</div><div>Effective APY</div><div className="text-right">10K JUL / Year</div>
          </div>
          {TIERS.map((tier, i) => (
            <motion.div key={tier.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.38 + i * (0.04 * PHI) }}
              className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-lg" style={{ color: tier.color }}>{tier.icon}</span>
                <span className="font-mono text-sm font-bold text-white">{tier.label}</span>
              </div>
              <div className="font-mono text-sm text-gray-400">{tier.lockDays === 0 ? 'Flexible' : `${tier.lockDays} days`}</div>
              <div className="font-mono text-sm text-gray-300">{tier.baseApy}%</div>
              <div className="font-mono text-sm font-bold" style={{ color: tier.color }}>{tier.mult}x</div>
              <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{(tier.baseApy * tier.mult).toFixed(1)}%</div>
              <div className="font-mono text-sm text-right" style={{ color: '#34d399' }}>
                +{fmt(10000 * tier.baseApy * tier.mult / 100)} JUL
              </div>
            </motion.div>
          ))}
        </GlassCard>
      </Section>

      {/* ============ 07. Staking History ============ */}
      <Section num="07" title="Staking History" delay={0.42}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-5 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Action</div><div>Amount</div><div>Tier</div><div>Date</div><div className="text-right">Tx</div>
          </div>
          {pagedHistory.map((ev, i) => (
            <motion.div key={ev.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.44 + i * 0.04 }}
              className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: actionColor(ev.action) }} />
                <span className="font-mono text-sm font-bold" style={{ color: actionColor(ev.action) }}>{ev.action}</span>
              </div>
              <div className="font-mono text-sm text-white">
                {ev.action === 'Unstake' ? '-' : '+'}{fmt(ev.amount)} JUL
              </div>
              <div className="font-mono text-sm text-gray-400">
                {ev.tier ? (
                  <span className="flex items-center gap-1">
                    <span style={{ color: tierById(ev.tier).color }}>{tierById(ev.tier).icon}</span>
                    {tierById(ev.tier).label}
                  </span>
                ) : <span className="text-gray-600">--</span>}
              </div>
              <div className="font-mono text-xs text-gray-500">{fmtDate(ev.timestamp)}</div>
              <div className="font-mono text-[10px] text-gray-600 text-right">{ev.txHash}</div>
            </motion.div>
          ))}
          {totalHistoryPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3">
              <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-mono disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: `${CYAN}15`, color: CYAN }}>Previous</button>
              <span className="text-[10px] font-mono text-gray-500">Page {historyPage + 1} of {totalHistoryPages}</span>
              <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages - 1, p + 1))}
                disabled={historyPage >= totalHistoryPages - 1}
                className="px-3 py-1.5 rounded-lg text-xs font-mono disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: `${CYAN}15`, color: CYAN }}>Next</button>
            </div>
          )}
        </GlassCard>
      </Section>

      {/* ============ Footer ============ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.50 }} className="text-center pb-4">
        <p className="text-[10px] font-mono text-gray-600 leading-relaxed max-w-xl mx-auto">
          All APYs are variable and subject to change based on protocol revenue and total staked supply.
          Rewards are distributed per batch settlement. Compounding frequency affects realized yield.
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-gray-700">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Non-custodial staking secured by VibeSwap circuit breakers</span>
        </div>
      </motion.div>

      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
