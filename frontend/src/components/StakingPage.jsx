import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Staking Tiers ============

const TIERS = [
  { id: 'bronze', label: 'Bronze', days: 30, apy: 5, color: '#cd7f32', icon: '\u25C9' },
  { id: 'silver', label: 'Silver', days: 90, apy: 8, color: '#c0c0c0', icon: '\u25C8' },
  { id: 'gold', label: 'Gold', days: 180, apy: 12, color: '#ffd700', icon: '\u2726' },
  { id: 'diamond', label: 'Diamond', days: 365, apy: 18, color: '#b9f2ff', icon: '\u2666' },
]

// ============ Mock Validators ============

const VALIDATORS = [
  { name: 'VibeNode Alpha', uptime: 99.98, commission: 3, delegated: 1_240_000, address: '0x1a2b...3c4d' },
  { name: 'StakeHouse DAO', uptime: 99.91, commission: 5, delegated: 890_000, address: '0x5e6f...7a8b' },
  { name: 'Meridian Labs', uptime: 99.87, commission: 4, delegated: 1_620_000, address: '0x9c0d...1e2f' },
  { name: 'Cascade Infra', uptime: 99.72, commission: 6, delegated: 540_000, address: '0x3a4b...5c6d' },
  { name: 'ChainGuard', uptime: 99.95, commission: 2, delegated: 2_010_000, address: '0x7e8f...9a0b' },
]

// ============ Mock Staking History ============

const STAKING_HISTORY = [
  { id: 1, action: 'Stake', amount: 5000, tier: 'Gold', date: new Date(Date.now() - 2 * 86400000) },
  { id: 2, action: 'Claim', amount: 42.5, tier: null, date: new Date(Date.now() - 5 * 86400000) },
  { id: 3, action: 'Stake', amount: 10000, tier: 'Diamond', date: new Date(Date.now() - 12 * 86400000) },
  { id: 4, action: 'Unstake', amount: 3000, tier: 'Bronze', date: new Date(Date.now() - 20 * 86400000) },
  { id: 5, action: 'Stake', amount: 2000, tier: 'Silver', date: new Date(Date.now() - 30 * 86400000) },
]

// ============ Mock Unstaking Queue ============

const UNSTAKING_QUEUE = [
  { id: 1, amount: 3000, initiated: new Date(Date.now() - 3 * 86400000), available: new Date(Date.now() + 4 * 86400000), cooldown: 7 },
  { id: 2, amount: 1500, initiated: new Date(Date.now() - 1 * 86400000), available: new Date(Date.now() + 13 * 86400000), cooldown: 14 },
]

// ============ APY History (mock SVG data) ============

const APY_HISTORY = [
  { month: 'Sep', value: 14 }, { month: 'Oct', value: 13.2 }, { month: 'Nov', value: 15.1 },
  { month: 'Dec', value: 16.8 }, { month: 'Jan', value: 12.4 }, { month: 'Feb', value: 11.9 },
  { month: 'Mar', value: 13.5 },
]

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 86400000)) }

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

// ============ Main Component ============

export default function StakingPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedTier, setSelectedTier] = useState(1)
  const [stakeAmount, setStakeAmount] = useState('')
  const [isStaking, setIsStaking] = useState(true) // true=Stake, false=Unstake
  const [selectedValidator, setSelectedValidator] = useState(0)
  const [calcAmount, setCalcAmount] = useState('10000')
  const [autoCompound, setAutoCompound] = useState(false)

  const mockBalance = 25000
  const activeTier = TIERS[selectedTier]

  // ============ Projections ============

  const projections = useMemo(() => {
    const a = parseFloat(calcAmount) || 0
    const r = activeTier.apy / 100
    return { m1: a * r / 12, m3: a * r / 4, m6: a * r / 2, y1: a * r }
  }, [calcAmount, activeTier])

  // ============ Not Connected ============

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Connect to <span style={{ color: CYAN }}>Stake</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Lock JUL to earn rewards, select validators, and gain governance power.
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

      {/* ============ 1. Staking Overview ============ */}
      <Section num="01" title="Staking Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Staked', value: '2.4M JUL' },
            { label: 'Current APY', value: '12.5%' },
            { label: 'Your Stake', value: '19.5K JUL' },
            { label: 'Pending Rewards', value: '490.66 JUL' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06 }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. Staking Tiers ============ */}
      <Section num="02" title="Staking Tiers" delay={0.12}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TIERS.map((tier, i) => {
            const sel = selectedTier === i
            return (
              <motion.div key={tier.id} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <GlassCard glowColor={sel ? 'terminal' : 'none'} className="p-4 cursor-pointer relative" hover
                  onClick={() => setSelectedTier(i)}>
                  <div className="text-2xl mb-1" style={{ color: tier.color }}>{tier.icon}</div>
                  <div className="text-sm font-mono font-bold text-white">{tier.label}</div>
                  <div className="text-2xl font-mono font-bold mt-1" style={{ color: sel ? CYAN : '#9ca3af' }}>
                    {tier.apy}%
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">APY / {tier.days}d lock</div>
                  {/* Animated progress bar */}
                  <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full"
                      style={{ background: tier.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(tier.apy / 18) * 100}%` }}
                      transition={{ duration: 0.8 * PHI, ease: 'easeOut' }} />
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 3. Stake / Unstake Form ============ */}
      <Section num="03" title={isStaking ? 'Stake JUL' : 'Unstake JUL'} delay={0.18}>
        <GlassCard glowColor="terminal" className="p-5">
          {/* Toggle */}
          <div className="flex mb-4 rounded-lg overflow-hidden border" style={{ borderColor: '#1f2937' }}>
            {['Stake', 'Unstake'].map((mode, idx) => (
              <button key={mode} onClick={() => setIsStaking(idx === 0)}
                className="flex-1 py-2 text-sm font-mono font-bold transition-all"
                style={{
                  background: (isStaking ? idx === 0 : idx === 1) ? `${CYAN}20` : 'transparent',
                  color: (isStaking ? idx === 0 : idx === 1) ? CYAN : '#6b7280',
                }}>
                {mode}
              </button>
            ))}
          </div>
          {/* Amount input */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                style={{ borderColor: stakeAmount ? `${CYAN}60` : undefined }} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button onClick={() => setStakeAmount(String(mockBalance))}
                  className="px-2 py-1 rounded-md text-[10px] font-mono font-bold"
                  style={{ background: `${CYAN}20`, color: CYAN }}>MAX</button>
                <span className="text-xs font-mono text-gray-500">JUL</span>
              </div>
            </div>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              disabled={!stakeAmount || parseFloat(stakeAmount) <= 0}
              className="px-8 py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: stakeAmount && parseFloat(stakeAmount) > 0 ? CYAN : '#374151',
                color: stakeAmount && parseFloat(stakeAmount) > 0 ? '#000' : '#6b7280',
                boxShadow: stakeAmount && parseFloat(stakeAmount) > 0 ? `0 0 20px ${CYAN}30` : 'none',
              }}>
              {isStaking ? 'Stake' : 'Unstake'}
            </motion.button>
          </div>
          {/* Lock period selector */}
          <div className="flex items-center justify-between text-xs font-mono text-gray-500 mb-3">
            <span>Balance: {fmt(mockBalance)} JUL</span>
            <span>Lock: {activeTier.label} ({activeTier.days}d) @ {activeTier.apy}% APY</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {TIERS.map((t, i) => (
              <button key={t.id} onClick={() => setSelectedTier(i)}
                className="py-2 rounded-lg text-[10px] font-mono font-bold transition-all"
                style={{
                  background: selectedTier === i ? `${CYAN}20` : 'rgba(0,0,0,0.3)',
                  color: selectedTier === i ? CYAN : '#6b7280',
                  border: `1px solid ${selectedTier === i ? `${CYAN}40` : '#374151'}`,
                }}>
                {t.label} ({t.days}d)
              </button>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Validator Selection ============ */}
      <Section num="04" title="Select Validator" delay={0.22}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-5 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Validator</div><div>Uptime</div><div>Commission</div><div>Delegated</div><div className="text-right">Select</div>
          </div>
          {VALIDATORS.map((v, i) => (
            <motion.div key={v.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-3 border-b border-gray-800/50 items-center cursor-pointer transition-colors ${selectedValidator === i ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
              onClick={() => setSelectedValidator(i)}>
              <div className="font-mono text-sm text-white font-bold">{v.name}
                <div className="text-[10px] text-gray-600">{v.address}</div>
              </div>
              <div className="font-mono text-sm" style={{ color: v.uptime >= 99.9 ? '#34d399' : '#fbbf24' }}>{v.uptime}%</div>
              <div className="font-mono text-sm text-gray-400">{v.commission}%</div>
              <div className="font-mono text-sm text-gray-300">{fmt(v.delegated)}</div>
              <div className="text-right">
                <div className="w-4 h-4 rounded-full border-2 inline-flex items-center justify-center"
                  style={{ borderColor: selectedValidator === i ? CYAN : '#4b5563' }}>
                  {selectedValidator === i && <div className="w-2 h-2 rounded-full" style={{ background: CYAN }} />}
                </div>
              </div>
            </motion.div>
          ))}
        </GlassCard>
      </Section>

      {/* ============ 5. Rewards Calculator ============ */}
      <Section num="05" title="Rewards Calculator" delay={0.26}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="mb-4">
            <label className="text-xs font-mono text-gray-400 mb-1 block">Amount (JUL)</label>
            <input type="number" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)}
              className="w-full bg-black/40 border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none"
              style={{ borderColor: `${CYAN}40` }} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '1 Month', value: projections.m1 },
              { label: '3 Months', value: projections.m3 },
              { label: '6 Months', value: projections.m6 },
              { label: '1 Year', value: projections.y1 },
            ].map((p) => (
              <div key={p.label} className="p-3 rounded-xl text-center border"
                style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="text-base sm:text-lg font-mono font-bold" style={{ color: CYAN }}>+{fmt(p.value)}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">JUL</div>
                <div className="text-[10px] font-mono text-gray-600">{p.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-center text-xs font-mono text-gray-500">
            At {activeTier.apy}% APY ({activeTier.label} tier) with {fmt(parseFloat(calcAmount) || 0)} JUL
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Staking History Timeline ============ */}
      <Section num="06" title="Staking History" delay={0.3}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="space-y-0">
            {STAKING_HISTORY.map((ev, i) => (
              <div key={ev.id} className="flex items-start gap-3 pb-4 relative">
                {/* Timeline line */}
                {i < STAKING_HISTORY.length - 1 && (
                  <div className="absolute left-[7px] top-5 w-px h-full" style={{ background: '#1f2937' }} />
                )}
                {/* Dot */}
                <div className="w-4 h-4 rounded-full shrink-0 mt-0.5 border-2 z-10"
                  style={{
                    borderColor: ev.action === 'Stake' ? CYAN : ev.action === 'Claim' ? '#34d399' : '#f87171',
                    background: '#0a0a0a',
                  }} />
                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold" style={{
                      color: ev.action === 'Stake' ? CYAN : ev.action === 'Claim' ? '#34d399' : '#f87171',
                    }}>{ev.action}</span>
                    <span className="font-mono text-sm text-white ml-2">{fmt(ev.amount)} JUL</span>
                    {ev.tier && <span className="font-mono text-[10px] text-gray-500 ml-2">({ev.tier})</span>}
                  </div>
                  <span className="font-mono text-[10px] text-gray-600">{fmtDate(ev.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Unstaking Queue ============ */}
      <Section num="07" title="Unstaking Queue" delay={0.34}>
        <GlassCard glowColor="terminal" className="p-5">
          {UNSTAKING_QUEUE.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-4">No pending unstakes</div>
          ) : (
            <div className="space-y-3">
              {UNSTAKING_QUEUE.map((q) => {
                const remaining = daysUntil(q.available)
                const progress = Math.min(1, 1 - remaining / q.cooldown)
                return (
                  <div key={q.id} className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-white font-bold">{fmt(q.amount)} JUL</span>
                      <span className="font-mono text-[10px] text-gray-500">Available {fmtDate(q.available)} ({remaining}d)</span>
                    </div>
                    {/* Cooldown progress bar */}
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                      <motion.div className="h-full rounded-full"
                        style={{ background: progress >= 1 ? '#34d399' : CYAN }}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress * 100}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }} />
                    </div>
                    <div className="text-[10px] font-mono text-gray-600 mt-1">
                      Cooldown: {q.cooldown}d total / {remaining}d remaining
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>
      </Section>

      {/* ============ 8. Governance Power ============ */}
      <Section num="08" title="Governance Power" delay={0.38}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-28 h-28 shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#1f2937" strokeWidth="8" />
                <motion.circle cx="50" cy="50" r="40" fill="none" stroke={CYAN} strokeWidth="8"
                  strokeLinecap="round" strokeDasharray={2 * Math.PI * 40}
                  initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 40 * 0.31 }}
                  transition={{ duration: PHI, ease: 'easeOut' }}
                  style={{ filter: `drop-shadow(0 0 6px ${CYAN}60)` }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-lg font-mono font-bold text-white">69.5K</div>
                <div className="text-[10px] font-mono text-gray-500">VP</div>
              </div>
            </div>
            <div className="flex-1 w-full">
              <p className="text-sm font-mono text-gray-300 mb-3">
                Stake = voting weight. Longer locks multiply your governance power.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {TIERS.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2 rounded-lg border"
                    style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <span className="font-mono text-xs" style={{ color: t.color }}>{t.icon} {t.label}</span>
                    <span className="font-mono text-xs text-gray-400">{t.days <= 30 ? '1x' : t.days <= 90 ? '2x' : t.days <= 180 ? '4x' : '6x'} VP</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. Auto-Compound Toggle ============ */}
      <Section num="09" title="Auto-Compound" delay={0.42}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-white font-bold">Auto-Compound Rewards</div>
              <div className="font-mono text-[10px] text-gray-500 mt-1">
                Automatically restake earned rewards to compound your yield.
              </div>
            </div>
            <button onClick={() => setAutoCompound(!autoCompound)}
              className="relative w-12 h-6 rounded-full transition-colors"
              style={{ background: autoCompound ? CYAN : '#374151' }}>
              <motion.div className="absolute top-1 w-4 h-4 rounded-full bg-white"
                animate={{ left: autoCompound ? 28 : 4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
            </button>
          </div>
          <AnimatePresence>
            {autoCompound && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-4 p-3 rounded-xl border" style={{ background: `${CYAN}08`, borderColor: `${CYAN}20` }}>
                  <div className="font-mono text-xs text-gray-300">
                    Compounding at {activeTier.apy}% APY: effective yield becomes ~{(activeTier.apy * 1.06).toFixed(1)}% with daily restaking.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </Section>

      {/* ============ 10. APY Over Time Chart (SVG) ============ */}
      <Section num="10" title="APY Over Time" delay={0.46}>
        <GlassCard glowColor="terminal" className="p-5">
          <svg viewBox="0 0 350 120" className="w-full" preserveAspectRatio="xMidYMid meet">
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1="30" y1={15 + i * 30} x2="340" y2={15 + i * 30} stroke="#1f2937" strokeWidth="0.5" />
            ))}
            {['18%', '14%', '10%', '6%'].map((l, i) => (
              <text key={l} x="24" y={19 + i * 30} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">{l}</text>
            ))}
            {APY_HISTORY.map((d, i) => (
              <text key={d.month} x={44 + i * 48} y={115} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">{d.month}</text>
            ))}
            <motion.path d={(() => {
              const pts = APY_HISTORY.map((d, i) => `${44 + i * 48},${105 - ((d.value - 6) / 12) * 90}`)
              return `M${pts[0]} ${pts.slice(1).map(p => `L${p}`).join(' ')} L${44 + 6 * 48},105 L44,105 Z`
            })()} fill={`${CYAN}15`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} />
            <motion.path d={APY_HISTORY.map((d, i) => `${i === 0 ? 'M' : 'L'}${44 + i * 48},${105 - ((d.value - 6) / 12) * 90}`).join(' ')}
              fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, ease: 'easeOut' }} />
            {APY_HISTORY.map((d, i) => (
              <motion.circle key={d.month} cx={44 + i * 48} cy={105 - ((d.value - 6) / 12) * 90} r="3" fill={CYAN}
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.08 }} />
            ))}
          </svg>
        </GlassCard>
      </Section>

      {/* ============ 11. Slashing Protection ============ */}
      <Section num="11" title="Slashing Protection" delay={0.5}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Insurance Pool', desc: 'Protocol treasury covers up to 50% of slashing losses from validator misbehavior.', pct: 50 },
              { title: 'Validator Monitoring', desc: 'Real-time uptime tracking with automatic re-delegation if a validator drops below 99%.', pct: 99 },
              { title: 'Grace Period', desc: '72-hour grace window before slashing executes, giving time to re-delegate stake.', pct: 72 },
            ].map((item) => (
              <div key={item.title}>
                <div className="font-mono text-sm text-white font-bold mb-1">{item.title}</div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed mb-2">{item.desc}</div>
                {/* Animated progress bar */}
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full" style={{ background: '#34d399' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${item.pct}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 12. Animated Staking Progress Bars ============ */}
      <Section num="12" title="Your Staking Progress" delay={0.54}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="space-y-4">
            {[
              { label: 'Bronze (30d)', staked: 2000, cap: 50000, color: '#cd7f32' },
              { label: 'Silver (90d)', staked: 5000, cap: 50000, color: '#c0c0c0' },
              { label: 'Gold (180d)', staked: 12500, cap: 50000, color: '#ffd700' },
              { label: 'Diamond (365d)', staked: 0, cap: 50000, color: '#b9f2ff' },
            ].map((bar) => {
              const pct = (bar.staked / bar.cap) * 100
              return (
                <div key={bar.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-bold" style={{ color: bar.color }}>{bar.label}</span>
                    <span className="font-mono text-[10px] text-gray-500">{fmt(bar.staked)} / {fmt(bar.cap)} JUL</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full relative"
                      style={{ background: `linear-gradient(90deg, ${bar.color}80, ${bar.color})` }}
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      transition={{ duration: PHI, ease: 'easeOut' }}>
                      {pct > 5 && (
                        <motion.div className="absolute inset-0 rounded-full"
                          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)' }}
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }} />
                      )}
                    </motion.div>
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </Section>

      {/* Bottom Spacer */}
      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
