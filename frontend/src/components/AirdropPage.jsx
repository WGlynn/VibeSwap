import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Season Data ============
const SEASON = {
  name: 'Season 1',
  subtitle: 'Genesis Drop',
  totalAllocation: 10_000_000,
  startDate: '2026-04-01',
  endDate: '2026-06-30',
  claimDeadline: '2026-09-30',
}

// ============ Mock Allocation Breakdown ============
const ALLOCATION_BREAKDOWN = [
  { label: 'Early user bonus', amount: 4200, pct: 33.6, icon: 'star' },
  { label: 'LP contribution', amount: 3800, pct: 30.4, icon: 'droplet' },
  { label: 'Governance participation', amount: 2500, pct: 20.0, icon: 'vote' },
  { label: 'Referral bonus', amount: 2000, pct: 16.0, icon: 'link' },
]

// ============ Eligibility Criteria ============
const CRITERIA = [
  { id: 'bridge', label: 'Bridge user', desc: 'Used VibeSwap bridge at least once', met: true },
  { id: 'swap', label: 'Swap user', desc: 'Completed 5+ swaps via commit-reveal', met: true },
  { id: 'lp', label: 'LP provider', desc: 'Provided liquidity for 30+ days', met: true },
  { id: 'gov', label: 'Governance voter', desc: 'Voted on at least 1 proposal', met: false },
  { id: 'early', label: 'Early adopter', desc: 'Wallet active before Season 1 start', met: true },
]

// ============ Vesting Schedule ============
const VESTING_MONTHS = 12
const IMMEDIATE_PCT = 25
const LINEAR_PCT = 75

// ============ Network Stats ============
const STATS = [
  { label: 'Total Eligible Wallets', value: '42,817' },
  { label: 'Total Allocated', value: '10M VIBE' },
  { label: 'Claimed So Far', value: '3.2M VIBE' },
  { label: 'Time Remaining', value: '89 days' },
]

// ============ Icon Components ============
function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function BreakdownIcon({ type }) {
  const base = "w-4 h-4"
  if (type === 'star') return (
    <svg className={base} style={{ color: CYAN }} fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
  if (type === 'droplet') return (
    <svg className={base} style={{ color: CYAN }} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-3 6a4 4 0 01-4-4h8a4 4 0 01-4 4z" clipRule="evenodd" />
    </svg>
  )
  if (type === 'vote') return (
    <svg className={base} style={{ color: CYAN }} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
  return (
    <svg className={base} style={{ color: CYAN }} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
    </svg>
  )
}

// ============ Row Helper ============
function Row({ l, r }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-black-400">{l}</span>
      <span>{r}</span>
    </div>
  )
}

// ============ Main Component ============
function AirdropPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [checked, setChecked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [claimProgress, setClaimProgress] = useState(0)

  const totalAllocation = ALLOCATION_BREAKDOWN.reduce((s, a) => s + a.amount, 0)
  const criteriaMetCount = CRITERIA.filter(c => c.met).length

  // ============ Check Eligibility ============
  const handleCheck = async () => {
    if (!isConnected) { connect(); return }
    setChecking(true)
    // Simulate on-chain Merkle proof verification
    await new Promise(r => setTimeout(r, PHI * 1000))
    setChecked(true)
    setChecking(false)
  }

  // ============ Claim Tokens ============
  const handleClaim = async () => {
    if (claimed) return
    setClaiming(true)
    setClaimProgress(0)
    const steps = 20
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, (PHI * 1000) / steps))
      setClaimProgress(Math.round((i / steps) * 100))
    }
    setClaimed(true)
    setClaiming(false)
  }

  // ============ Vesting Data ============
  const immediateAmount = Math.round(totalAllocation * IMMEDIATE_PCT / 100)
  const linearPerMonth = Math.round((totalAllocation * LINEAR_PCT / 100) / VESTING_MONTHS)
  const vestingMonths = Array.from({ length: VESTING_MONTHS }, (_, i) => ({
    month: i + 1,
    cumulative: immediateAmount + linearPerMonth * (i + 1),
    unlockThisMonth: linearPerMonth,
  }))

  return (
    <div className="min-h-screen">
      <PageHero
        title="Airdrop"
        subtitle="Claim your VIBE tokens for contributing to the VibeSwap ecosystem."
        category="community"
        badge={SEASON.name}
        badgeColor={CYAN}
      />

      <div className="max-w-3xl mx-auto px-4 space-y-6 pb-16">

        {/* ============ Season Info ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, delay: 0 }}
        >
          <GlassCard className="p-5" glowColor="terminal" spotlight>
            <div className="flex items-center space-x-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-lg"
                style={{ backgroundColor: CYAN + '15', color: CYAN }}
              >
                S1
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{SEASON.name}: {SEASON.subtitle}</h2>
                <p className="text-xs text-black-400 font-mono">
                  {SEASON.startDate} &mdash; {SEASON.endDate}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                <div className="text-xs text-black-400 font-mono mb-1">Total Pool</div>
                <div className="text-lg font-bold text-white font-mono">10M</div>
                <div className="text-[10px] text-black-500">VIBE</div>
              </div>
              <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                <div className="text-xs text-black-400 font-mono mb-1">Vesting</div>
                <div className="text-lg font-bold text-white font-mono">12</div>
                <div className="text-[10px] text-black-500">months linear</div>
              </div>
              <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                <div className="text-xs text-black-400 font-mono mb-1">Immediate</div>
                <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>25%</div>
                <div className="text-[10px] text-black-500">at claim</div>
              </div>
              <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                <div className="text-xs text-black-400 font-mono mb-1">Claim Deadline</div>
                <div className="text-sm font-bold text-white font-mono">{SEASON.claimDeadline}</div>
                <div className="text-[10px] text-black-500">UTC</div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Global Stats ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, delay: 1 / (PHI * PHI * PHI) }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STATS.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1 / PHI, delay: i * (1 / (PHI * PHI * PHI)) }}
              >
                <GlassCard className="p-4 text-center">
                  <div className="text-[10px] text-black-400 font-mono uppercase tracking-wider mb-1">
                    {stat.label}
                  </div>
                  <div className="text-lg font-bold text-white font-mono">{stat.value}</div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ============ Not Connected State ============ */}
        {!isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 / PHI, delay: 1 / (PHI * PHI) }}
          >
            <GlassCard className="p-8 text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: CYAN + '10', border: `1px solid ${CYAN}22` }}
              >
                <svg className="w-8 h-8" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h2>
              <p className="text-sm text-black-400 mb-6 max-w-md mx-auto">
                Connect your wallet to check if you are eligible for the Season 1 VIBE airdrop.
              </p>
              <motion.button
                onClick={connect}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-8 py-3 rounded-xl font-medium text-white transition-all font-mono"
                style={{
                  background: `linear-gradient(135deg, ${CYAN}, ${CYAN}88)`,
                  boxShadow: `0 0 20px ${CYAN}33`,
                }}
              >
                Sign In
              </motion.button>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Check Eligibility ============ */}
        {isConnected && !checked && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 / PHI, delay: 1 / (PHI * PHI) }}
          >
            <GlassCard className="p-8 text-center" glowColor="terminal" spotlight>
              <motion.div
                className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
                style={{ backgroundColor: CYAN + '10', border: `2px solid ${CYAN}33` }}
                animate={checking ? { rotate: 360 } : {}}
                transition={checking ? { repeat: Infinity, duration: PHI, ease: 'linear' } : {}}
              >
                {checking ? (
                  <svg className="w-10 h-10" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                )}
              </motion.div>
              <h2 className="text-xl font-bold text-white mb-2">Check Your Eligibility</h2>
              <p className="text-sm text-black-400 mb-6 max-w-md mx-auto">
                We will verify your on-chain activity against the Season 1 Merkle root to determine your allocation.
              </p>
              <motion.button
                onClick={handleCheck}
                disabled={checking}
                whileHover={!checking ? { scale: 1.03 } : {}}
                whileTap={!checking ? { scale: 0.97 } : {}}
                className="px-10 py-4 rounded-xl font-bold text-lg text-white transition-all font-mono disabled:opacity-60"
                style={{
                  background: `linear-gradient(135deg, ${CYAN}, ${CYAN}88)`,
                  boxShadow: `0 0 30px ${CYAN}33`,
                }}
              >
                {checking ? 'Verifying...' : 'Check Eligibility'}
              </motion.button>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Allocation Display ============ */}
        {isConnected && checked && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="space-y-6"
          >
            {/* Total Allocation Card */}
            <GlassCard className="p-6" glowColor="terminal" spotlight>
              <div className="text-center mb-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 1 / (PHI * PHI) }}
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-mono mb-3"
                  style={{ backgroundColor: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e33' }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 mr-2 animate-pulse" />
                  Eligible
                </motion.div>
                <h2 className="text-sm text-black-400 font-mono mb-1">Your Allocation</h2>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1 / PHI, delay: 1 / (PHI * PHI * PHI) }}
                  className="text-4xl sm:text-5xl font-bold font-mono"
                  style={{ color: CYAN }}
                >
                  {totalAllocation.toLocaleString()}
                </motion.div>
                <div className="text-sm text-black-400 font-mono mt-1">VIBE tokens</div>
              </div>

              {/* Breakdown */}
              <div className="space-y-2">
                {ALLOCATION_BREAKDOWN.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 1 / PHI, delay: i * (1 / (PHI * PHI * PHI)) + 0.3 }}
                    className="flex items-center justify-between p-3 rounded-xl bg-black-800/50 border border-black-700/30"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: CYAN + '12' }}
                      >
                        <BreakdownIcon type={item.icon} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <div className="text-[10px] text-black-500 font-mono">{item.pct}% of allocation</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono text-white">{item.amount.toLocaleString()}</div>
                      <div className="text-[10px] text-black-500 font-mono">VIBE</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Claim Button */}
              <div className="mt-6">
                {claiming && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs font-mono text-black-400 mb-1">
                      <span>Claiming...</span>
                      <span>{claimProgress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-black-700 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: `linear-gradient(90deg, ${CYAN}, ${CYAN}cc)` }}
                        initial={{ width: '0%' }}
                        animate={{ width: `${claimProgress}%` }}
                        transition={{ duration: 0.1, ease: 'linear' }}
                      />
                    </div>
                  </div>
                )}
                <motion.button
                  onClick={handleClaim}
                  disabled={claiming || claimed}
                  whileHover={!claiming && !claimed ? { scale: 1.02, boxShadow: `0 0 40px ${CYAN}44` } : {}}
                  whileTap={!claiming && !claimed ? { scale: 0.98 } : {}}
                  className="w-full py-4 rounded-xl font-bold text-lg text-white transition-all font-mono disabled:opacity-60"
                  style={{
                    background: claimed
                      ? 'linear-gradient(135deg, #22c55e, #22c55e88)'
                      : `linear-gradient(135deg, ${CYAN}, ${CYAN}88)`,
                    boxShadow: claimed
                      ? '0 0 20px #22c55e33'
                      : `0 0 20px ${CYAN}33`,
                  }}
                >
                  {claimed
                    ? 'Claimed Successfully'
                    : claiming
                      ? 'Claiming...'
                      : `Claim ${totalAllocation.toLocaleString()} VIBE`}
                </motion.button>
                {claimed && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-center text-xs text-green-400 font-mono mt-2"
                  >
                    {immediateAmount.toLocaleString()} VIBE released immediately. Remaining vests linearly over 12 months.
                  </motion.p>
                )}
              </div>
            </GlassCard>

            {/* ============ Eligibility Criteria ============ */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1 / PHI, delay: 0.2 }}
            >
              <GlassCard className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 className="text-sm font-semibold text-white">Eligibility Criteria</h3>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ backgroundColor: CYAN + '15', color: CYAN }}>
                    {criteriaMetCount}/{CRITERIA.length} met
                  </span>
                </div>
                <div className="space-y-2">
                  {CRITERIA.map((c, i) => (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 1 / PHI, delay: i * 0.06 + 0.3 }}
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        c.met
                          ? 'bg-green-500/5 border-green-500/15'
                          : 'bg-red-500/5 border-red-500/15'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                          c.met ? 'bg-green-500/15' : 'bg-red-500/15'
                        }`}>
                          {c.met ? <CheckIcon /> : <CrossIcon />}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{c.label}</div>
                          <div className="text-[10px] text-black-500">{c.desc}</div>
                        </div>
                      </div>
                      <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full ${
                        c.met
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {c.met ? 'PASS' : 'FAIL'}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ============ Vesting Schedule ============ */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1 / PHI, delay: 0.35 }}
            >
              <GlassCard className="p-5">
                <div className="flex items-center space-x-2 mb-4">
                  <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-white">Vesting Schedule</h3>
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                    <div className="text-[10px] text-black-400 font-mono mb-1">Immediate</div>
                    <div className="text-base font-bold font-mono" style={{ color: CYAN }}>
                      {immediateAmount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-black-500 font-mono">{IMMEDIATE_PCT}%</div>
                  </div>
                  <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                    <div className="text-[10px] text-black-400 font-mono mb-1">Per Month</div>
                    <div className="text-base font-bold font-mono text-white">
                      {linearPerMonth.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-black-500 font-mono">linear</div>
                  </div>
                  <div className="p-3 rounded-xl bg-black-800/50 border border-black-700/30 text-center">
                    <div className="text-[10px] text-black-400 font-mono mb-1">Duration</div>
                    <div className="text-base font-bold font-mono text-white">{VESTING_MONTHS}</div>
                    <div className="text-[10px] text-black-500 font-mono">months</div>
                  </div>
                </div>

                {/* Visual Timeline */}
                <div className="relative">
                  {/* Progress bar */}
                  <div className="h-2 rounded-full bg-black-700 overflow-hidden mb-1">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${CYAN}, ${CYAN}66)` }}
                      initial={{ width: '0%' }}
                      animate={{ width: `${IMMEDIATE_PCT}%` }}
                      transition={{ duration: PHI, delay: 0.5, ease: 'easeOut' }}
                    />
                  </div>

                  {/* Month markers */}
                  <div className="flex justify-between px-0.5 mb-2">
                    {[0, 3, 6, 9, 12].map(m => (
                      <div key={m} className="flex flex-col items-center">
                        <div
                          className="w-1.5 h-1.5 rounded-full mt-1"
                          style={{ backgroundColor: m === 0 ? CYAN : `${CYAN}44` }}
                        />
                        <span className="text-[9px] text-black-500 font-mono mt-0.5">M{m}</span>
                      </div>
                    ))}
                  </div>

                  {/* Monthly unlock list */}
                  <div className="mt-3 max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {/* Immediate unlock row */}
                    <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-black-800/30">
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono"
                          style={{ backgroundColor: CYAN + '20', color: CYAN }}
                        >
                          0
                        </div>
                        <span className="text-xs text-black-300 font-mono">At claim (TGE)</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>
                          {immediateAmount.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-black-500 font-mono ml-1">VIBE</span>
                      </div>
                    </div>
                    {vestingMonths.map(v => (
                      <div
                        key={v.month}
                        className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-black-800/30 transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono bg-black-700 text-black-300">
                            {v.month}
                          </div>
                          <span className="text-xs text-black-400 font-mono">Month {v.month}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono text-black-300">
                            +{v.unlockThisMonth.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-black-500 font-mono ml-2">
                            ({v.cumulative.toLocaleString()} total)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vesting info footer */}
                <div className="mt-4 p-3 rounded-xl bg-black-900/50 border border-black-700/30">
                  <Row
                    l="Full vest date"
                    r={<span className="font-mono text-white text-xs">~{VESTING_MONTHS} months post-claim</span>}
                  />
                  <div className="mt-2">
                    <Row
                      l="Total vested"
                      r={<span className="font-mono text-xs" style={{ color: CYAN }}>{totalAllocation.toLocaleString()} VIBE</span>}
                    />
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}

        {/* ============ How It Works ============ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, delay: 0.4 }}
        >
          <GlassCard className="p-5">
            <div className="flex items-center space-x-2 mb-4">
              <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-sm font-semibold text-white">How It Works</h3>
            </div>
            <div className="space-y-3">
              {[
                { step: '1', title: 'Check eligibility', desc: 'We verify your wallet against the Merkle root snapshot.' },
                { step: '2', title: 'Review allocation', desc: 'See your VIBE breakdown by contribution category.' },
                { step: '3', title: 'Claim tokens', desc: '25% unlocks immediately. 75% vests linearly over 12 months.' },
                { step: '4', title: 'Use your VIBE', desc: 'Stake, govern, provide liquidity, or trade on VibeSwap.' },
              ].map((item, i) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 1 / PHI, delay: i * 0.08 + 0.45 }}
                  className="flex items-start space-x-3"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-mono flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: CYAN + '15', color: CYAN, border: `1px solid ${CYAN}33` }}
                  >
                    {item.step}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{item.title}</div>
                    <div className="text-xs text-black-400">{item.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Disclaimer ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 / PHI, delay: 0.5 }}
          className="text-center"
        >
          <p className="text-[10px] text-black-500 font-mono max-w-md mx-auto">
            Airdrop allocations are determined by on-chain activity snapshots. Unclaimed tokens after the
            deadline are returned to the DAO treasury. No purchase necessary.
          </p>
        </motion.div>

      </div>
    </div>
  )
}

export default AirdropPage
