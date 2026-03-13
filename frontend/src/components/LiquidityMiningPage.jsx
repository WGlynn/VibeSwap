import { useState, useMemo, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER = 1 / (PHI * PHI * PHI)
const EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Token Registry ============
const TK = {
  ETH:  { symbol: 'ETH',  icon: '\u039E' },
  USDC: { symbol: 'USDC', icon: '\uD83D\uDCB5' },
  WBTC: { symbol: 'WBTC', icon: '\u20BF' },
  DAI:  { symbol: 'DAI',  icon: '\u25C8' },
  LINK: { symbol: 'LINK', icon: '\u26D3' },
  UNI:  { symbol: 'UNI',  icon: '\uD83E\uDD84' },
  ARB:  { symbol: 'ARB',  icon: '\u2B21' },
  OP:   { symbol: 'OP',   icon: '\u2B24' },
  VIBE: { symbol: 'VIBE', icon: '\u2726' },
  JUL:  { symbol: 'JUL',  icon: '\u2605' },
}

// ============ Mock Farm Generation ============
function buildFarms() {
  const pairs = [
    ['ETH', 'USDC'],  ['WBTC', 'ETH'],  ['VIBE', 'ETH'],
    ['JUL', 'USDC'],  ['ETH', 'DAI'],   ['LINK', 'ETH'],
    ['ARB', 'USDC'],  ['OP', 'ETH'],    ['UNI', 'USDC'],
    ['VIBE', 'USDC'],
  ]
  const rng = seededRandom(1111)
  return pairs.map(([a, b], i) => {
    const apr = 12 + rng() * 180
    const tvl = 500_000 + rng() * 24_000_000
    const dailyRewards = 800 + rng() * 12_000
    const userStake = rng() > 0.55 ? (100 + rng() * 8000) : 0
    const earned = userStake > 0 ? (userStake * (apr / 100) / 365) * (1 + rng() * 30) : 0
    const epochEnd = Date.now() + (3 + rng() * 25) * 86_400_000
    const multiplier = 1 + Math.floor(rng() * 4) * 0.5
    const featured = apr > 80
    return {
      id: `${a}-${b}`,
      tokenA: TK[a],
      tokenB: TK[b],
      apr: +apr.toFixed(1),
      tvl,
      dailyRewards: +dailyRewards.toFixed(0),
      userStake,
      earned: +earned.toFixed(4),
      epochEnd,
      multiplier,
      featured,
      seed: 1111 + i * 37,
    }
  })
}

// ============ Helpers ============
function fmt(n, d = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
function fmtDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

// ============ Animation Variants ============
const sectionVariants = {
  hidden: () => ({ opacity: 0, y: 30, filter: 'blur(4px)' }),
  visible: (i) => ({
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { delay: i * STAGGER, duration: 0.5, ease: 'easeOut' },
  }),
}

// ============ Section Wrapper ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-xs font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-4" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Epoch Countdown ============
function EpochCountdown({ epochEnd }) {
  const [remaining, setRemaining] = useState(epochEnd - Date.now())
  useEffect(() => {
    const iv = setInterval(() => setRemaining(epochEnd - Date.now()), 1000)
    return () => clearInterval(iv)
  }, [epochEnd])
  return <span className="font-mono text-xs tabular-nums" style={{ color: CYAN }}>{fmtDuration(remaining)}</span>
}

// ============ Boost Indicator ============
function BoostBadge({ multiplier }) {
  if (multiplier <= 1) return null
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold"
      style={{ background: `linear-gradient(135deg, ${CYAN}20, #8b5cf620)`, color: CYAN, border: `1px solid ${CYAN}30` }}>
      {multiplier.toFixed(1)}x
    </span>
  )
}

// ============ APR Bar ============
function AprBar({ apr }) {
  const pct = Math.min(100, (apr / 200) * 100)
  const color = apr > 100 ? '#22c55e' : apr > 50 ? CYAN : '#eab308'
  return (
    <div className="w-full h-1.5 bg-black/30 rounded-full overflow-hidden mt-1">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ backgroundColor: color }} />
    </div>
  )
}

// ============ Farm Card ============
function FarmCard({ farm, isConnected, connect, onStake }) {
  const hasStake = farm.userStake > 0
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="relative p-4 rounded-xl bg-black-700/40 border border-black-600/50 hover:border-cyan-500/30 transition-colors"
    >
      {farm.featured && (
        <div className="absolute -top-2 right-3 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/30">
          Hot
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            <span className="w-7 h-7 rounded-full bg-black-600 flex items-center justify-center text-sm">{farm.tokenA.icon}</span>
            <span className="w-7 h-7 rounded-full bg-black-600 flex items-center justify-center text-sm border-2 border-black-700">{farm.tokenB.icon}</span>
          </div>
          <div>
            <div className="font-medium text-sm text-white">{farm.tokenA.symbol}/{farm.tokenB.symbol}</div>
            <BoostBadge multiplier={farm.multiplier} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold font-mono" style={{ color: farm.apr > 80 ? '#22c55e' : CYAN }}>{farm.apr}%</div>
          <div className="text-[10px] text-black-500 uppercase tracking-wider">APR</div>
        </div>
      </div>
      <AprBar apr={farm.apr} />
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
        <div>
          <div className="text-[10px] text-black-500 uppercase">TVL</div>
          <div className="text-xs font-mono text-black-300">{fmtUsd(farm.tvl)}</div>
        </div>
        <div>
          <div className="text-[10px] text-black-500 uppercase">Daily</div>
          <div className="text-xs font-mono text-black-300">{fmt(farm.dailyRewards, 0)} VIBE</div>
        </div>
        <div>
          <div className="text-[10px] text-black-500 uppercase">Epoch</div>
          <EpochCountdown epochEnd={farm.epochEnd} />
        </div>
      </div>
      {/* User position */}
      {isConnected && hasStake && (
        <div className="p-2.5 rounded-lg bg-black-900/50 border border-cyan-500/10 mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-black-400">Your Stake</span>
            <span className="font-mono text-white">{fmtUsd(farm.userStake)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-black-400">Earned</span>
            <span className="font-mono text-green-400">+{fmt(farm.earned, 4)} VIBE</span>
          </div>
        </div>
      )}
      {/* Action button */}
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => isConnected ? onStake(farm.id) : connect()}
        className="w-full py-2 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: `linear-gradient(135deg, ${CYAN}20, ${CYAN}10)`,
          color: CYAN,
          border: `1px solid ${CYAN}30`,
        }}
      >
        {!isConnected ? 'Connect to Farm' : hasStake ? 'Manage Position' : 'Stake LP'}
      </motion.button>
    </motion.div>
  )
}

// ============ Rewards Calculator ============
function RewardsCalculator({ farms }) {
  const [selectedFarm, setSelectedFarm] = useState(farms[0]?.id || '')
  const [stakeAmount, setStakeAmount] = useState('1000')
  const [duration, setDuration] = useState('30')
  const [boostMultiplier, setBoostMultiplier] = useState('1.0')
  const farm = farms.find(f => f.id === selectedFarm)
  const stake = parseFloat(stakeAmount) || 0, days = parseFloat(duration) || 1, boost = parseFloat(boostMultiplier) || 1
  const dailyRate = farm ? (farm.apr / 100) / 365 : 0
  const baseRewards = stake * dailyRate * days, boostedRewards = baseRewards * boost, extraFromBoost = boostedRewards - baseRewards
  const inputCls = "w-full bg-black-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500/50 font-mono"

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-black-400 block mb-1">Farm</label>
          <select value={selectedFarm} onChange={e => setSelectedFarm(e.target.value)}
            className="w-full bg-black-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none cursor-pointer font-mono">
            {farms.map(f => <option key={f.id} value={f.id}>{f.tokenA.symbol}/{f.tokenB.symbol} ({f.apr}% APR)</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-black-400 block mb-1">Stake ($)</label>
          <input type="number" value={stakeAmount} onChange={e => setStakeAmount(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-black-400 block mb-1">Duration (days)</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)} className={inputCls} />
        </div>
      </div>
      {/* Boost slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-black-400">Boost Multiplier</label>
          <span className="text-xs font-mono" style={{ color: CYAN }}>{boost.toFixed(1)}x</span>
        </div>
        <input type="range" min="1" max="3" step="0.5" value={boostMultiplier}
          onChange={e => setBoostMultiplier(e.target.value)} className="w-full accent-cyan-500" />
        <div className="flex justify-between text-[10px] text-black-500 mt-0.5">
          <span>1.0x</span><span>1.5x</span><span>2.0x</span><span>2.5x</span><span>3.0x</span>
        </div>
      </div>
      {/* Results */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Base Rewards</div>
          <div className="text-sm font-medium font-mono text-black-300">{fmt(baseRewards, 2)} VIBE</div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Boosted</div>
          <div className="text-sm font-medium font-mono" style={{ color: CYAN }}>{fmt(boostedRewards, 2)} VIBE</div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Boost Extra</div>
          <div className="text-sm font-medium font-mono text-green-400">+{fmt(extraFromBoost, 2)}</div>
        </div>
      </div>
      <div className="p-3 rounded-xl bg-black-900/50 border border-cyan-500/10 text-center">
        <div className="text-[10px] text-black-500 uppercase mb-0.5">Estimated Value</div>
        <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>
          ${fmt(boostedRewards * 0.42, 2)}
        </div>
        <div className="text-[10px] text-black-500 mt-0.5">at current VIBE price ($0.42)</div>
      </div>
    </div>
  )
}

// ============ Boost Tier Display ============
function BoostTiers() {
  const tiers = [
    { vibeStaked: 0,      multiplier: 1.0, label: 'Base',     color: 'text-black-400', bg: 'bg-black/20', border: 'border-black-700/30' },
    { vibeStaked: 1000,   multiplier: 1.5, label: 'Bronze',   color: 'text-orange-400', bg: 'bg-orange-500/5', border: 'border-orange-500/15' },
    { vibeStaked: 5000,   multiplier: 2.0, label: 'Silver',   color: 'text-gray-300', bg: 'bg-gray-500/5', border: 'border-gray-500/15' },
    { vibeStaked: 25000,  multiplier: 2.5, label: 'Gold',     color: 'text-yellow-400', bg: 'bg-yellow-500/5', border: 'border-yellow-500/15' },
    { vibeStaked: 100000, multiplier: 3.0, label: 'Diamond',  color: 'text-cyan-400', bg: 'bg-cyan-500/5', border: 'border-cyan-500/15' },
  ]
  const currentTier = 1 // mock: Bronze

  return (
    <div className="space-y-2">
      <p className="text-xs text-black-400 leading-relaxed mb-3">
        Stake <span style={{ color: CYAN }}>VIBE</span> tokens to boost your farming rewards.
        Higher tiers earn proportionally more from every farm.
      </p>
      {tiers.map((tier, i) => {
        const isActive = i === currentTier
        const isPast = i < currentTier
        return (
          <motion.div
            key={tier.label}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * STAGGER, duration: 1 / PHI }}
            className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${tier.bg} ${tier.border} ${isActive ? 'ring-1 ring-cyan-500/30' : ''}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${tier.bg} ${tier.color} border ${tier.border}`}>
                {tier.multiplier.toFixed(1)}
              </div>
              <div>
                <p className={`text-xs font-mono font-bold ${tier.color}`}>{tier.label}</p>
                <p className="text-[10px] font-mono text-black-500">
                  {tier.vibeStaked === 0 ? 'No stake required' : `${fmt(tier.vibeStaked, 0)}+ VIBE staked`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className={`text-sm font-mono font-bold ${tier.color}`}>{tier.multiplier.toFixed(1)}x</span>
              {isActive && (
                <p className="text-[10px] font-mono text-cyan-400">Current</p>
              )}
              {isPast && (
                <p className="text-[10px] font-mono text-green-400">Unlocked</p>
              )}
            </div>
          </motion.div>
        )
      })}
      <div className="mt-3 p-3 rounded-xl bg-black-900/50 border border-cyan-500/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-black-400">Your VIBE Staked</span>
          <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>1,250 VIBE</span>
        </div>
        <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: '25%' }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${CYAN}, #8b5cf6)` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-black-500 mt-1">
          <span>Bronze (1,000)</span>
          <span>Silver (5,000)</span>
        </div>
      </div>
    </div>
  )
}

// ============ Live Earnings Counter ============
function LiveEarnings({ value }) {
  const [display, setDisplay] = useState(value)
  useEffect(() => {
    setDisplay(value)
    const iv = setInterval(() => setDisplay(p => p + Math.random() * 0.003 / PHI), 100)
    return () => clearInterval(iv)
  }, [value])
  return <span className="font-mono tabular-nums font-bold" style={{ color: CYAN }}>{fmt(display, 4)}</span>
}

// ============ Main Component ============
export default function LiquidityMiningPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const farms = useMemo(() => buildFarms(), [])

  const [isHarvesting, setIsHarvesting] = useState(false)

  const featuredFarms = useMemo(() => farms.filter(f => f.featured), [farms])
  const activeFarms = useMemo(() => farms.filter(f => f.userStake > 0), [farms])

  const totalDistributed = useMemo(() => farms.reduce((s, f) => s + f.dailyRewards * 120, 0), [farms])
  const totalActiveFarms = farms.length
  const userPositions = activeFarms.length
  const pendingHarvest = useMemo(() => activeFarms.reduce((s, f) => s + f.earned, 0), [activeFarms])

  const handleStake = useCallback((farmId) => {
    // placeholder — would open a stake modal in production
  }, [])

  const handleHarvestAll = useCallback(() => {
    setIsHarvesting(true)
    setTimeout(() => setIsHarvesting(false), 2000)
  }, [])

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 31) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1.5, 0], y: [0, -60 - (i % 5) * 20] }}
            transition={{ duration: 4 + (i % 4) * PHI, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 space-y-5">
        {/* ============ Page Hero ============ */}
        <PageHero
          category="defi"
          title="Liquidity Mining"
          subtitle="Stake LP tokens. Earn VIBE. Boost with staking."
          badge="Live"
          badgeColor={CYAN}
        />

        {/* ============ 1. Overview Stats ============ */}
        <Section index={0} title="Overview" subtitle="Protocol-wide farming metrics at a glance">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Total Rewards Distributed', fmtUsd(totalDistributed), null],
              ['Active Farms', totalActiveFarms, CYAN],
              ['Your Farming Positions', isConnected ? userPositions : '--', null],
              ['Pending Harvest', null, null],
            ].map(([label, val, color]) => (
              <div key={label} className="p-3 rounded-xl bg-black-700/50 text-center">
                <div className="text-xs text-black-400 mb-1">{label}</div>
                <div className="text-lg font-bold font-mono" style={color ? { color } : undefined}>
                  {label === 'Pending Harvest'
                    ? (isConnected ? <><LiveEarnings value={pendingHarvest} /> <span className="text-xs text-black-500">VIBE</span></> : '--')
                    : val}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ============ 2. Featured Farms ============ */}
        {featuredFarms.length > 0 && (
          <Section index={1} title="Featured Farms" subtitle="Highest APR opportunities right now">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {featuredFarms.map(farm => (
                <FarmCard
                  key={farm.id}
                  farm={farm}
                  isConnected={isConnected}
                  connect={connect}
                  onStake={handleStake}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ============ 3. All Farms ============ */}
        <Section index={2} title="All Farms" subtitle={`${farms.length} active liquidity mining pools`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {farms.map(farm => (
              <FarmCard
                key={farm.id}
                farm={farm}
                isConnected={isConnected}
                connect={connect}
                onStake={handleStake}
              />
            ))}
          </div>
        </Section>

        {/* ============ 4. Harvest All ============ */}
        <Section index={3} title="Harvest" subtitle="Collect all pending VIBE rewards">
          {!isConnected ? (
            <div className="text-center py-8">
              <p className="text-black-400 text-sm mb-4">Connect your wallet to view pending rewards</p>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={connect}
                className="px-6 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}
              >
                Connect Wallet
              </motion.button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active positions summary */}
              {activeFarms.length > 0 ? (
                <>
                  <div className="overflow-x-auto -mx-5 md:-mx-6 px-5 md:px-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-black-500 uppercase tracking-wider">
                          {['Farm', 'Staked', 'APR', 'Earned', 'Epoch'].map((h, i) => (
                            <th key={h} className={`${i === 0 ? 'text-left' : 'text-right'} pb-3 ${i < 4 ? 'pr-4' : ''}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black-700/50">
                        {activeFarms.map(farm => (
                          <tr key={farm.id} className="hover:bg-black-700/20">
                            <td className="py-3 pr-4">
                              <div className="font-medium text-white">{farm.tokenA.symbol}/{farm.tokenB.symbol}</div>
                              <BoostBadge multiplier={farm.multiplier} />
                            </td>
                            <td className="py-3 pr-4 text-right font-mono text-black-300">{fmtUsd(farm.userStake)}</td>
                            <td className="py-3 pr-4 text-right font-mono" style={{ color: CYAN }}>{farm.apr}%</td>
                            <td className="py-3 pr-4 text-right font-mono text-green-400">+{fmt(farm.earned, 4)}</td>
                            <td className="py-3 text-right"><EpochCountdown epochEnd={farm.epochEnd} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Harvest All bar */}
                  <div className="flex items-center justify-between p-4 rounded-xl bg-black-900/50">
                    <div>
                      <div className="text-xs text-black-400 mb-0.5">Total Pending</div>
                      <div className="text-xl">
                        <LiveEarnings value={pendingHarvest} />
                        <span className="text-sm text-black-500 ml-1">VIBE</span>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      disabled={isHarvesting}
                      onClick={handleHarvestAll}
                      className="relative px-6 py-2.5 rounded-xl text-sm font-medium overflow-hidden disabled:opacity-60"
                      style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}
                    >
                      {!isHarvesting && (
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                          style={{ width: '50%' }}
                        />
                      )}
                      <span className="relative z-10">{isHarvesting ? 'Harvesting...' : 'Harvest All'}</span>
                    </motion.button>
                  </div>
                </>
              ) : (
                <div className="text-center py-6">
                  <p className="text-black-400 text-sm">No active farming positions. Stake LP tokens to start earning.</p>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ============ 5. Boost Multiplier ============ */}
        <Section index={4} title="Boost Multiplier" subtitle="Stake VIBE to amplify your farming rewards">
          <BoostTiers />
        </Section>

        {/* ============ 6. Farm Epochs ============ */}
        <Section index={5} title="Farm Epochs" subtitle="Duration and countdown for each active farm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {farms.slice(0, 6).map((farm, i) => (
              <motion.div key={farm.id} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * STAGGER, duration: 1 / PHI }}
                className="flex items-center justify-between p-3 rounded-xl bg-black-700/30 border border-black-600/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white">{farm.tokenA.symbol}/{farm.tokenB.symbol}</span>
                </div>
                <div className="text-right">
                  <EpochCountdown epochEnd={farm.epochEnd} />
                  <div className="text-[10px] text-black-500">remaining</div>
                </div>
              </motion.div>
            ))}
          </div>
          <p className="text-[10px] text-black-500 mt-3 text-center">Epochs auto-renew. Rewards compound into the next epoch unless harvested.</p>
        </Section>

        {/* ============ 7. Rewards Calculator ============ */}
        <Section index={6} title="Rewards Calculator" subtitle="Estimate your farming yield with boost multiplier">
          <RewardsCalculator farms={farms} />
        </Section>

        {/* ============ 8. How It Works ============ */}
        <Section index={7} title="How It Works" subtitle="Liquidity mining in four steps">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { step: 1, title: 'Provide Liquidity', desc: 'Add tokens to a pool to receive LP tokens representing your share.' },
              { step: 2, title: 'Stake LP Tokens', desc: 'Deposit your LP tokens into the farm to start earning VIBE rewards.' },
              { step: 3, title: 'Boost with VIBE', desc: 'Stake VIBE tokens separately to multiply your farming rewards up to 3x.' },
              { step: 4, title: 'Harvest Rewards', desc: 'Claim accumulated VIBE anytime. Unclaimed rewards auto-compound each epoch.' },
            ].map((item, i) => (
              <motion.div key={item.step} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * STAGGER, duration: 1 / PHI }}
                className="p-4 rounded-xl bg-black-700/30 border border-black-600/30 text-center">
                <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-sm font-mono font-bold"
                  style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>{item.step}</div>
                <div className="text-sm font-medium text-white mb-1">{item.title}</div>
                <p className="text-xs text-black-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Footer Disclaimer ============ */}
        <motion.div custom={8} variants={sectionVariants} initial="hidden" animate="visible" className="text-center pb-8">
          <p className="text-xs text-black-500">
            APR values are variable and depend on total staked liquidity, token prices, and boost level.
            Past performance does not guarantee future results.
          </p>
          <div className="flex items-center justify-center space-x-2 mt-2 text-xs text-black-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>Non-custodial farms secured by VibeSwap circuit breakers</span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
