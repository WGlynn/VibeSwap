import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { usePriceFeed } from '../hooks/usePriceFeed'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Lock Period Tiers ============

const TIERS = [
  { id: 'bronze',   label: 'Bronze',   lock: '0',  days: 0,   mult: 1.0, apy: 4,  color: '#cd7f32', icon: '\u25C9' },
  { id: 'silver',   label: 'Silver',   lock: '1m', days: 30,  mult: 1.2, apy: 7,  color: '#c0c0c0', icon: '\u25C8' },
  { id: 'gold',     label: 'Gold',     lock: '3m', days: 90,  mult: 1.5, apy: 11, color: '#ffd700', icon: '\u2726' },
  { id: 'platinum', label: 'Platinum', lock: '6m', days: 180, mult: 2.0, apy: 15, color: '#e5e4e2', icon: '\u2B23' },
  { id: 'diamond',  label: 'Diamond',  lock: '1y', days: 365, mult: 3.0, apy: 22, color: '#b9f2ff', icon: '\u2666' },
]

const LOCK_STOPS = [
  { label: '1w', days: 7 },
  { label: '1m', days: 30 },
  { label: '3m', days: 90 },
  { label: '6m', days: 180 },
  { label: '1y', days: 365 },
]

// ============ Mock Validators ============

const VALIDATORS = [
  { name: 'VibeNode Alpha', uptime: 99.98, commission: 3, delegated: 1_240_000, delegators: 482, address: '0x1a2b...3c4d' },
  { name: 'StakeHouse DAO', uptime: 99.91, commission: 5, delegated: 890_000, delegators: 315, address: '0x5e6f...7a8b' },
  { name: 'Meridian Labs',  uptime: 99.87, commission: 4, delegated: 1_620_000, delegators: 621, address: '0x9c0d...1e2f' },
  { name: 'Cascade Infra',  uptime: 99.72, commission: 6, delegated: 540_000, delegators: 178, address: '0x3a4b...5c6d' },
  { name: 'ChainGuard',     uptime: 99.95, commission: 2, delegated: 2_010_000, delegators: 843, address: '0x7e8f...9a0b' },
]

// ============ Mock Unstaking Queue ============

const UNSTAKING_QUEUE = [
  { id: 1, amount: 3000, initiated: new Date(Date.now() - 3 * 86400000), available: new Date(Date.now() + 4 * 86400000), cooldown: 7 },
  { id: 2, amount: 1500, initiated: new Date(Date.now() - 1 * 86400000), available: new Date(Date.now() + 13 * 86400000), cooldown: 14 },
]

// ============ Mock Staking History ============

const STAKING_HISTORY = [
  { id: 1, action: 'Stake', amount: 5000, tier: 'Gold', date: new Date(Date.now() - 2 * 86400000) },
  { id: 2, action: 'Claim', amount: 42.5, tier: null, date: new Date(Date.now() - 5 * 86400000) },
  { id: 3, action: 'Stake', amount: 10000, tier: 'Diamond', date: new Date(Date.now() - 12 * 86400000) },
  { id: 4, action: 'Unstake', amount: 3000, tier: 'Bronze', date: new Date(Date.now() - 20 * 86400000) },
  { id: 5, action: 'Stake', amount: 2000, tier: 'Silver', date: new Date(Date.now() - 30 * 86400000) },
]

// ============ Mock Daily Rewards (30 days) ============

const DAILY_REWARDS = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  reward: 12 + Math.sin(i * 0.4) * 4 + Math.random() * 2,
}))

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

function hoursUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 3600000)) }

function tierForDays(days) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (days >= TIERS[i].days) return TIERS[i]
  }
  return TIERS[0]
}

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

// ============ Reward History SVG Chart ============

function RewardChart({ data }) {
  const maxR = Math.max(...data.map(d => d.reward))
  const minR = Math.min(...data.map(d => d.reward))
  const range = maxR - minR || 1
  const W = 400, H = 130, PAD_L = 36, PAD_R = 10, PAD_T = 10, PAD_B = 22
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const pts = data.map((d, i) => ({
    x: PAD_L + (i / (data.length - 1)) * plotW,
    y: PAD_T + plotH - ((d.reward - minR) / range) * plotH,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${PAD_T + plotH} L${pts[0].x.toFixed(1)},${PAD_T + plotH} Z`

  const gridLines = 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: gridLines }, (_, i) => {
        const y = PAD_T + (i / (gridLines - 1)) * plotH
        const val = (maxR - (i / (gridLines - 1)) * range).toFixed(0)
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1f2937" strokeWidth="0.5" />
            <text x={PAD_L - 4} y={y + 3} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">{val}</text>
          </g>
        )
      })}
      {[0, 6, 13, 20, 29].map(idx => (
        <text key={idx} x={pts[idx].x} y={H - 3} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">
          D{data[idx].day}
        </text>
      ))}
      <motion.path d={areaPath} fill={`${CYAN}12`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
      <motion.path d={linePath} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, ease: 'easeOut' }} />
      {pts.filter((_, i) => i % 5 === 0).map((p, i) => (
        <motion.circle key={i} cx={p.x} cy={p.y} r="2.5" fill={CYAN}
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4 + i * 0.08 }} />
      ))}
    </svg>
  )
}

// ============ veJUL Decay Curve ============

function DecayCurve({ lockDays, currentDay }) {
  const W = 200, H = 60, PAD = 4
  const pW = W - PAD * 2, pH = H - PAD * 2
  const pts = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39
    const remaining = Math.max(0, 1 - t)
    return { x: PAD + t * pW, y: PAD + pH - remaining * pH }
  })
  const progress = Math.min(1, currentDay / (lockDays || 1))
  const markerX = PAD + progress * pW
  const markerY = PAD + pH - Math.max(0, 1 - progress) * pH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <line x1={PAD} y1={PAD + pH} x2={PAD + pW} y2={PAD + pH} stroke="#1f2937" strokeWidth="0.5" />
      <motion.path
        d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none" stroke="#4b5563" strokeWidth="1" strokeDasharray="3,3"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
      />
      <motion.circle cx={markerX} cy={markerY} r="4" fill={CYAN}
        style={{ filter: `drop-shadow(0 0 4px ${CYAN})` }}
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 }} />
      <text x={PAD} y={H - 1} fill="#6b7280" fontSize="6" fontFamily="monospace">Lock start</text>
      <text x={PAD + pW} y={H - 1} fill="#6b7280" fontSize="6" fontFamily="monospace" textAnchor="end">Expiry</text>
    </svg>
  )
}

// ============ Main Component ============

export default function StakingPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedTier, setSelectedTier] = useState(2)
  const [stakeAmount, setStakeAmount] = useState('')
  const [isStaking, setIsStaking] = useState(true)
  const [selectedValidator, setSelectedValidator] = useState(0)
  const [calcAmount, setCalcAmount] = useState('10000')
  const [calcLock, setCalcLock] = useState(2) // index into LOCK_STOPS
  const [autoCompound, setAutoCompound] = useState(false)

  const { getBalance } = useBalances()
  const { getPrice } = usePriceFeed(['JUL'])

  // When connected, use real balance; demo mode uses mock
  const mockBalance = 25000
  const userBalance = isConnected ? getBalance('JUL') : mockBalance
  const activeTier = TIERS[selectedTier]

  // ============ veJUL State ============
  // When connected: real data (empty/zero for new wallet)
  // When not connected: demo mock data

  const veJUL = useMemo(() => {
    if (isConnected) {
      return { locked: 0, lockDays: 0, elapsed: 0, remaining: 0, power: 0, maxPower: 0 }
    }
    const locked = 15000
    const lockDays = 365
    const elapsed = 120
    const remaining = lockDays - elapsed
    const power = locked * (remaining / lockDays)
    return { locked, lockDays, elapsed, remaining, power: Math.round(power), maxPower: locked }
  }, [isConnected])

  // Validators, unstaking queue, staking history, daily rewards — only show mock when NOT connected
  const validators = isConnected ? [] : VALIDATORS
  const unstakingQueue = isConnected ? [] : UNSTAKING_QUEUE
  const stakingHistory = isConnected ? [] : STAKING_HISTORY
  const dailyRewards = isConnected ? [] : DAILY_REWARDS

  // ============ Calculator Projections ============

  const projections = useMemo(() => {
    const a = parseFloat(calcAmount) || 0
    const stop = LOCK_STOPS[calcLock]
    const tier = tierForDays(stop.days)
    const baseApy = tier.apy / 100
    const mult = tier.mult
    return {
      tier,
      m1: a * baseApy / 12 * mult,
      m3: a * baseApy / 4 * mult,
      m6: a * baseApy / 2 * mult,
      y1: a * baseApy * mult,
      mult,
    }
  }, [calcAmount, calcLock])

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
              Stake JUL to earn VIBE rewards, select validators, and gain governance power through VIBE.
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
            { label: 'Total Staked', value: isConnected ? '0 JUL' : '2.4M JUL' },
            { label: 'Current APY', value: `${activeTier.apy}%` },
            { label: 'Your Stake', value: isConnected ? '0 JUL' : '19.5K JUL' },
            { label: 'Pending Rewards', value: isConnected ? '0 JUL' : '490.66 JUL' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * (0.06 / PHI) }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. Lock Period Tiers ============ */}
      <Section num="02" title="Lock Period Tiers" delay={0.05 + 0.07 / PHI}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {TIERS.map((tier, i) => {
            const sel = selectedTier === i
            return (
              <motion.div key={tier.id} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + i * (0.04 * PHI) }}>
                <GlassCard glowColor={sel ? 'terminal' : 'none'} className="p-4 cursor-pointer" hover
                  onClick={() => setSelectedTier(i)}>
                  <div className="text-2xl mb-1" style={{ color: tier.color }}>{tier.icon}</div>
                  <div className="text-sm font-mono font-bold text-white">{tier.label}</div>
                  <div className="text-xl font-mono font-bold mt-1" style={{ color: sel ? CYAN : '#9ca3af' }}>
                    {tier.mult}x
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">
                    {tier.days === 0 ? 'No lock' : `${tier.lock} lock`} / {tier.apy}% APY
                  </div>
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full"
                      style={{ background: tier.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(tier.mult / 3) * 100}%` }}
                      transition={{ duration: 0.8 * PHI, ease: 'easeOut' }} />
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 3. Staking Calculator ============ */}
      <Section num="03" title="Staking Calculator" delay={0.18}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1 block">Amount (JUL)</label>
              <input type="number" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value)}
                className="w-full bg-black/40 border rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none"
                style={{ borderColor: `${CYAN}40` }} />
            </div>
            <div>
              <label className="text-xs font-mono text-gray-400 mb-1 block">
                Lock Period: <span style={{ color: CYAN }}>{LOCK_STOPS[calcLock].label}</span>
                <span className="text-gray-600 ml-2">({projections.tier.label} / {projections.mult}x)</span>
              </label>
              <input type="range" min={0} max={LOCK_STOPS.length - 1} value={calcLock}
                onChange={(e) => setCalcLock(Number(e.target.value))}
                className="w-full mt-2 accent-cyan-500" />
              <div className="flex justify-between text-[9px] font-mono text-gray-600 mt-1">
                {LOCK_STOPS.map(s => <span key={s.label}>{s.label}</span>)}
              </div>
            </div>
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
            {projections.tier.apy}% base APY x {projections.mult} loyalty multiplier = {(projections.tier.apy * projections.mult).toFixed(1)}% effective
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Stake / Unstake Form ============ */}
      <Section num="04" title={isStaking ? 'Stake JUL' : 'Unstake JUL'} delay={0.22}>
        <GlassCard glowColor="terminal" className="p-5">
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
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                style={{ borderColor: stakeAmount ? `${CYAN}60` : undefined }} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button onClick={() => setStakeAmount(String(userBalance))}
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
          <div className="flex items-center justify-between text-xs font-mono text-gray-500">
            <span>Balance: {fmt(userBalance)} JUL</span>
            <span>Tier: {activeTier.label} ({activeTier.mult}x) @ {activeTier.apy}% APY</span>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Validator Grid ============ */}
      <Section num="05" title="Validator Grid" delay={0.26}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          {validators.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-8">No validators delegated yet</div>
          ) : (
            <>
              <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
                <div>Validator</div><div>Uptime</div><div>Commission</div><div>Delegated</div><div>Delegators</div><div className="text-right">Delegate</div>
              </div>
              {validators.map((v, i) => (
                <motion.div key={v.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.28 + i * (0.04 * PHI) }}
                  className={`grid grid-cols-2 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center cursor-pointer transition-colors ${selectedValidator === i ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
                  onClick={() => setSelectedValidator(i)}>
                  <div className="font-mono text-sm text-white font-bold">{v.name}
                    <div className="text-[10px] text-gray-600">{v.address}</div>
                  </div>
                  <div className="font-mono text-sm" style={{ color: v.uptime >= 99.9 ? '#34d399' : '#fbbf24' }}>{v.uptime}%</div>
                  <div className="font-mono text-sm text-gray-400">{v.commission}%</div>
                  <div className="font-mono text-sm text-gray-300">{fmt(v.delegated)}</div>
                  <div className="font-mono text-sm text-gray-400">{v.delegators}</div>
                  <div className="text-right">
                    {selectedValidator === i ? (
                      <span className="px-2 py-1 rounded-md text-[10px] font-mono font-bold" style={{ background: `${CYAN}20`, color: CYAN }}>
                        Delegated
                      </span>
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 inline-flex items-center justify-center" style={{ borderColor: '#4b5563' }} />
                    )}
                  </div>
                </motion.div>
              ))}
            </>
          )}
        </GlassCard>
      </Section>

      {/* ============ 6. Unstaking Queue ============ */}
      <Section num="06" title="Unstaking Queue" delay={0.30}>
        <GlassCard glowColor="terminal" className="p-5">
          {unstakingQueue.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-4">No pending unstakes</div>
          ) : (
            <div className="space-y-3">
              {unstakingQueue.map((q) => {
                const remaining = daysUntil(q.available)
                const hrs = hoursUntil(q.available)
                const progress = Math.min(1, 1 - remaining / q.cooldown)
                return (
                  <div key={q.id} className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm text-white font-bold">{fmt(q.amount)} JUL</span>
                      <div className="text-right">
                        <span className="font-mono text-xs" style={{ color: remaining <= 1 ? '#34d399' : CYAN }}>
                          {remaining > 0 ? `${remaining}d ${hrs % 24}h remaining` : 'Ready to claim'}
                        </span>
                        <div className="text-[10px] font-mono text-gray-600">Unlocks {fmtDate(q.available)}</div>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                      <motion.div className="h-full rounded-full"
                        style={{ background: progress >= 1 ? '#34d399' : CYAN }}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress * 100}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-gray-600 mt-1">
                      <span>Initiated {fmtDate(q.initiated)}</span>
                      <span>Cooldown: {q.cooldown}d</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>
      </Section>

      {/* ============ 7. Reward History Chart ============ */}
      <Section num="07" title="Reward History (30d)" delay={0.34}>
        <GlassCard glowColor="terminal" className="p-5">
          {dailyRewards.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-4">No rewards earned yet</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="font-mono text-xs text-gray-400">Daily staking rewards (JUL)</div>
                <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>
                  {fmt(dailyRewards.reduce((s, d) => s + d.reward, 0))} JUL total
                </div>
              </div>
              <RewardChart data={dailyRewards} />
            </>
          )}
        </GlassCard>
      </Section>

      {/* ============ 8. veJUL Power ============ */}
      <Section num="08" title="Governance Power" delay={0.38}>
        <GlassCard glowColor="terminal" className="p-5">
          {veJUL.locked === 0 ? (
            <div className="text-center py-4">
              <div className="font-mono text-sm text-gray-500 mb-2">No JUL staked yet</div>
              <p className="font-mono text-[10px] text-gray-600 leading-relaxed max-w-sm mx-auto">
                Stake JUL to earn VIBE governance tokens. Longer locks give more VIBE rewards and voting weight.
              </p>
              <div className="grid grid-cols-3 gap-1 mt-4 max-w-xs mx-auto">
                {[
                  { lock: '3m', mult: '1.5x' },
                  { lock: '6m', mult: '2x' },
                  { lock: '1y', mult: '3x' },
                ].map(v => (
                  <div key={v.lock} className="p-1.5 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="font-mono text-[10px] text-gray-500">{v.lock}</div>
                    <div className="font-mono text-xs font-bold" style={{ color: CYAN }}>{v.mult} VIBE</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative w-20 h-20 shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#1f2937" strokeWidth="8" />
                      <motion.circle cx="50" cy="50" r="40" fill="none" stroke={CYAN} strokeWidth="8"
                        strokeLinecap="round" strokeDasharray={2 * Math.PI * 40}
                        initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 40 * (1 - veJUL.power / veJUL.maxPower) }}
                        transition={{ duration: PHI, ease: 'easeOut' }}
                        style={{ filter: `drop-shadow(0 0 6px ${CYAN}60)` }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="text-sm font-mono font-bold text-white">{fmt(veJUL.power)}</div>
                      <div className="text-[8px] font-mono text-gray-500">VIBE power</div>
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-gray-400">Locked</div>
                    <div className="font-mono text-lg font-bold text-white">{fmt(veJUL.locked)} JUL</div>
                    <div className="font-mono text-[10px] text-gray-500">{veJUL.remaining}d remaining of {veJUL.lockDays}d lock</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="font-mono text-xs text-gray-400">Governance Weight</div>
                    <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{((veJUL.power / veJUL.maxPower) * 100).toFixed(1)}%</div>
                  </div>
                  <div className="p-2 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                    <div className="font-mono text-xs text-gray-400">Decay Rate</div>
                    <div className="font-mono text-sm font-bold text-gray-300">{(veJUL.locked / veJUL.lockDays).toFixed(1)}/d</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="font-mono text-xs text-gray-400 mb-2">VIBE Governance Power Curve</div>
                <DecayCurve lockDays={veJUL.lockDays} currentDay={veJUL.elapsed} />
                <p className="font-mono text-[10px] text-gray-500 mt-3 leading-relaxed">
                  Governance power decays linearly over the lock period.
                  Longer locks earn more VIBE and give more voting weight. Re-lock to restore full power.
                </p>
                <div className="grid grid-cols-3 gap-1 mt-3">
                  {[
                    { lock: '3m', mult: '1.5x' },
                    { lock: '6m', mult: '2x' },
                    { lock: '1y', mult: '3x' },
                  ].map(v => (
                    <div key={v.lock} className="p-1.5 rounded-lg border text-center" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                      <div className="font-mono text-[10px] text-gray-500">{v.lock}</div>
                      <div className="font-mono text-xs font-bold" style={{ color: CYAN }}>{v.mult} VIBE</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
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
                    Compounding at {activeTier.apy}% APY ({activeTier.mult}x multiplier): effective yield ~{(activeTier.apy * activeTier.mult * 1.06).toFixed(1)}% with daily restaking.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </Section>

      {/* ============ 10. Slashing Protection ============ */}
      <Section num="10" title="Slashing Protection" delay={0.46}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Insurance Pool', desc: 'Protocol treasury covers up to 50% of slashing losses from validator misbehavior.', pct: 50 },
              { title: 'Validator Monitoring', desc: 'Real-time uptime tracking with automatic re-delegation if a validator drops below 99%.', pct: 99 },
              { title: 'Grace Period', desc: '72-hour grace window before slashing executes, giving time to re-delegate stake.', pct: 72 },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.48 + i * (0.04 * PHI) }}>
                <div className="font-mono text-sm text-white font-bold mb-1">{item.title}</div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed mb-2">{item.desc}</div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full" style={{ background: '#34d399' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${item.pct}%` }}
                    transition={{ duration: 1.2, ease: 'easeOut' }} />
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 11. Staking History Timeline ============ */}
      <Section num="11" title="Staking History" delay={0.50}>
        <GlassCard glowColor="terminal" className="p-5">
          {stakingHistory.length === 0 ? (
            <div className="text-center font-mono text-sm text-gray-500 py-4">No staking history yet</div>
          ) : (
            <div className="space-y-0">
              {stakingHistory.map((ev, i) => (
                <div key={ev.id} className="flex items-start gap-3 pb-4 relative">
                  {i < stakingHistory.length - 1 && (
                    <div className="absolute left-[7px] top-5 w-px h-full" style={{ background: '#1f2937' }} />
                  )}
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
          )}
        </GlassCard>
      </Section>

      {/* ============ 12. Your Staking Progress ============ */}
      <Section num="12" title="Your Staking Progress" delay={0.54}>
        <GlassCard glowColor="terminal" className="p-5">
          {isConnected ? (
            <div className="text-center font-mono text-sm text-gray-500 py-4">No staking positions yet</div>
          ) : (
            <div className="space-y-4">
              {TIERS.map((tier) => {
                const staked = tier.id === 'bronze' ? 2000 : tier.id === 'silver' ? 5000 : tier.id === 'gold' ? 12500 : tier.id === 'platinum' ? 3200 : 0
                const cap = 50000
                const pct = (staked / cap) * 100
                return (
                  <div key={tier.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold" style={{ color: tier.color }}>{tier.icon} {tier.label} ({tier.lock || 'none'})</span>
                      <span className="font-mono text-[10px] text-gray-500">{fmt(staked)} / {fmt(cap)} JUL</span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                      <motion.div className="h-full rounded-full relative"
                        style={{ background: `linear-gradient(90deg, ${tier.color}80, ${tier.color})` }}
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
          )}
        </GlassCard>
      </Section>

      {/* Bottom Spacer */}
      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
