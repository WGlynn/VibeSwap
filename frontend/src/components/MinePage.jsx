import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============

const PHI = 1.618033988749895
const AMBER = '#f59e0b'
const EMERALD = '#10b981'

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Mock Data Generators ============

function generateHashRateHistory(points = 24) {
  const rng = seededRandom(7919); let rate = 14200
  return Array.from({ length: points }, () => {
    rate += (rng() - 0.46) * 2400; rate = Math.max(rate, 6000)
    return rate
  })
}

function generateDifficultyHistory(points = 24) {
  const rng = seededRandom(3571); let diff = 12.0
  return Array.from({ length: points }, () => {
    diff += (rng() - 0.48) * 0.6; diff = Math.max(diff, 8)
    return diff
  })
}

function generateBlockTimeHistory(points = 24) {
  const rng = seededRandom(2137); let bt = 42
  return Array.from({ length: points }, () => {
    bt += (rng() - 0.5) * 8; bt = Math.max(bt, 15); bt = Math.min(bt, 90)
    return bt
  })
}

function generateMinerCountHistory(points = 24) {
  const rng = seededRandom(9973); let mc = 24
  return Array.from({ length: points }, () => {
    mc += Math.round((rng() - 0.4) * 6); mc = Math.max(mc, 5)
    return mc
  })
}

function generateEmissionSchedule() {
  const total = 21_000_000
  const halvings = [0, 2.3, 4.6, 6.9, 9.2, 11.5, 13.8, 16.1, 18.4]
  let remaining = total; const data = []
  for (let i = 0; i < halvings.length; i++) {
    const mined = remaining * 0.5
    remaining -= mined
    data.push({ year: halvings[i], remaining, mined: total - remaining })
  }
  return data
}

// ============ Static Seed Data ============

const hashRateData = generateHashRateHistory()
const difficultyData = generateDifficultyHistory()
const blockTimeData = generateBlockTimeHistory()
const minerCountData = generateMinerCountHistory()
const emissionData = generateEmissionSchedule()

// ============ Mining Tiers ============

const MINING_TIERS = [
  {
    id: 'prospector', label: 'Prospector', icon: '\u26CF',
    requirement: '0 - 99 blocks', multiplier: '1.0x',
    color: '#a1a1aa', gradient: 'from-zinc-500/20 to-zinc-600/10',
    desc: 'Starting tier. Mine your first blocks to climb the ranks.',
  },
  {
    id: 'miner', label: 'Miner', icon: '\u2692',
    requirement: '100 - 499 blocks', multiplier: '1.25x',
    color: '#3b82f6', gradient: 'from-blue-500/20 to-blue-600/10',
    desc: 'Proven hashpower. 25% reward bonus on all mined blocks.',
  },
  {
    id: 'foreman', label: 'Foreman', icon: '\u2655',
    requirement: '500 - 1,999 blocks', multiplier: '1.618x',
    color: '#f59e0b', gradient: 'from-amber-500/20 to-amber-600/10',
    desc: 'PHI multiplier unlocked. Priority in batch settlement.',
  },
  {
    id: 'baron', label: 'Baron', icon: '\u2654',
    requirement: '2,000+ blocks', multiplier: '2.0x',
    color: '#a855f7', gradient: 'from-purple-500/20 to-purple-600/10',
    desc: 'Elite miner. Double rewards, governance weight, streak shield.',
  },
]

// ============ Mock Leaderboard ============

function generateLeaderboard() {
  const rng = seededRandom(4219)
  const names = [
    '0x7a3F...e91C', '0xdB42...0f8A', '0x19cE...a3D7', '0x5f1B...c42E',
    '0xaC08...7b6F', '0xe3D9...1a2B', '0x82fA...d05C', '0x6b1E...f93A',
    '0xc47D...2e8B', '0x0fA6...b71D',
  ]
  return names.map((addr, i) => ({
    rank: i + 1,
    address: addr,
    totalMined: Math.round((10000 - i * 800) * (0.8 + rng() * 0.4) * 100) / 100,
    streak: Math.round(14 + rng() * 60 - i * 3),
  }))
}

const leaderboard = generateLeaderboard()

// ============ Mock Active Workers ============

function generateWorkers() {
  const rng = seededRandom(1337)
  return Array.from({ length: 4 }, (_, i) => ({
    id: `worker-${i + 1}`,
    name: `Thread ${i + 1}`,
    status: i < 3 ? 'active' : 'idle',
    hashRate: i < 3 ? Math.round(1800 + rng() * 3200) : 0,
    uptime: i < 3 ? `${Math.round(1 + rng() * 6)}h ${Math.round(rng() * 59)}m` : '--',
    earnings: i < 3 ? Math.round(rng() * 120 * 100) / 100 : 0,
  }))
}

const activeWorkers = generateWorkers()

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

// ============ Mining Visualization (Animated SVG) ============

function MiningVisualization({ isMining, blockCount, difficulty }) {
  const [particles, setParticles] = useState([])
  const [pickaxeAngle, setPickaxeAngle] = useState(0)

  useEffect(() => {
    if (!isMining) { setParticles([]); return }
    const interval = setInterval(() => {
      setPickaxeAngle(prev => prev === 0 ? -25 : 0)
      setParticles(prev => {
        const rng = seededRandom(Date.now() % 100000)
        const fresh = Array.from({ length: 3 }, (_, i) => ({
          id: Date.now() + i,
          x: 140 + (rng() - 0.5) * 60,
          y: 100 + (rng() - 0.5) * 30,
          size: 2 + rng() * 3,
          vx: (rng() - 0.5) * 4,
          vy: -1 - rng() * 3,
          life: 1.0,
        }))
        const updated = [...prev, ...fresh]
          .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.04 }))
          .filter(p => p.life > 0)
          .slice(-40)
        return updated
      })
    }, 120)
    return () => clearInterval(interval)
  }, [isMining])

  return (
    <div className="relative w-full h-48 overflow-hidden rounded-xl bg-void-900/40">
      <svg viewBox="0 0 320 192" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 24} x2="320" y2={i * 24}
            stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        ))}
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`v${i}`} x1={i * 26} y1="0" x2={i * 26} y2="192"
            stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        ))}

        {/* Block being mined */}
        <motion.g
          animate={isMining ? { y: [0, -3, 0] } : { y: 0 }}
          transition={isMining ? { duration: 1 / PHI, repeat: Infinity, ease: 'easeInOut' } : {}}
        >
          <rect x="115" y="75" width="50" height="50" rx="6"
            fill="url(#blockGrad)" stroke={AMBER} strokeWidth="1.5" opacity={isMining ? 1 : 0.3} />
          <text x="140" y="105" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold"
            fontFamily="monospace" opacity={isMining ? 1 : 0.4}>
            {blockCount}
          </text>
        </motion.g>

        {/* Pickaxe */}
        <motion.g
          animate={{ rotate: pickaxeAngle }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          style={{ transformOrigin: '200px 110px' }}
        >
          <line x1="200" y1="110" x2="230" y2="80" stroke="#a1a1aa" strokeWidth="3" strokeLinecap="round" />
          <polygon points="228,82 242,72 236,68 226,78" fill={AMBER} opacity={isMining ? 1 : 0.3} />
        </motion.g>

        {/* Particles */}
        {particles.map(p => (
          <circle key={p.id} cx={p.x} cy={p.y} r={p.size}
            fill={AMBER} opacity={p.life * 0.8} />
        ))}

        {/* Difficulty indicator */}
        <text x="16" y="24" fill="rgba(255,255,255,0.5)" fontSize="10" fontFamily="monospace">
          difficulty: {difficulty} bits
        </text>

        {/* Status text */}
        <text x="304" y="24" textAnchor="end" fill={isMining ? EMERALD : 'rgba(255,255,255,0.3)'}
          fontSize="10" fontFamily="monospace">
          {isMining ? 'HASHING...' : 'IDLE'}
        </text>

        {/* Pulse ring when mining */}
        {isMining && (
          <motion.circle
            cx="140" cy="100" r="35"
            fill="none" stroke={AMBER} strokeWidth="1"
            initial={{ r: 35, opacity: 0.6 }}
            animate={{ r: 60, opacity: 0 }}
            transition={{ duration: 1 / PHI, repeat: Infinity, ease: 'easeOut' }}
          />
        )}

        <defs>
          <linearGradient id="blockGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity="0.3" />
            <stop offset="100%" stopColor={AMBER} stopOpacity="0.08" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

// ============ Emission Schedule Chart ============

function EmissionChart({ data }) {
  const W = 640, H = 200
  const PAD = { top: 20, right: 20, bottom: 32, left: 64 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom
  const maxY = 21_000_000
  const maxX = 20

  const pts = data.map(d => ({
    x: PAD.left + (d.year / maxX) * iW,
    y: PAD.top + iH - (d.remaining / maxY) * iH,
  }))

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${PAD.top + iH} L${pts[0].x},${PAD.top + iH} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="emissionGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={AMBER} stopOpacity="0.2" />
          <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y-axis labels */}
      {[0, 5_250_000, 10_500_000, 15_750_000, 21_000_000].map((t, i) => {
        const y = PAD.top + iH - (t / maxY) * iH
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.35)"
              fontSize="10" fontFamily="monospace">{fmt(t)}</text>
          </g>
        )
      })}

      {/* Halving markers */}
      {data.map((d, i) => {
        const x = PAD.left + (d.year / maxX) * iW
        return (
          <g key={i}>
            <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + iH} stroke={AMBER} strokeWidth="0.5"
              strokeDasharray="3,3" opacity="0.4" />
            <text x={x} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.35)"
              fontSize="9" fontFamily="monospace">{d.year.toFixed(1)}y</text>
          </g>
        )
      })}

      <path d={areaPath} fill="url(#emissionGrad)" />
      <path d={linePath} fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" />

      {/* Dots on halvings */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={AMBER} stroke="#111" strokeWidth="1" />
      ))}

      {/* Label */}
      <text x={PAD.left + 4} y={PAD.top + 14} fill="rgba(255,255,255,0.5)" fontSize="10" fontFamily="monospace">
        Remaining JUL Supply
      </text>
    </svg>
  )
}

// ============ MinePage Component ============

function MinePage() {
  const [isMining, setIsMining] = useState(false)
  const [blockCount, setBlockCount] = useState(247)
  const [minedToday, setMinedToday] = useState(34.82)
  const [totalMined, setTotalMined] = useState(1_847.56)
  const [nextReward, setNextReward] = useState(42)
  const [displayMined, setDisplayMined] = useState(1_847.56)

  // Animated counter for mined tokens
  useEffect(() => {
    if (!isMining) return
    const interval = setInterval(() => {
      const increment = 0.001 + Math.random() * 0.004
      setMinedToday(prev => Math.round((prev + increment) * 1000) / 1000)
      setTotalMined(prev => Math.round((prev + increment) * 1000) / 1000)
      setDisplayMined(prev => Math.round((prev + increment) * 1000) / 1000)
      setNextReward(prev => {
        const n = prev - 1
        if (n <= 0) {
          setBlockCount(b => b + 1)
          return Math.round(30 + Math.random() * 30)
        }
        return n
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isMining])

  const toggleMining = useCallback(() => {
    setIsMining(prev => !prev)
  }, [])

  const currentTier = blockCount >= 2000 ? MINING_TIERS[3]
    : blockCount >= 500 ? MINING_TIERS[2]
    : blockCount >= 100 ? MINING_TIERS[1]
    : MINING_TIERS[0]

  const formatTime = (s) => {
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${s}s`
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pb-12">
      <PageHero
        category="defi"
        title="Mine JUL"
        subtitle="Contribute compute, earn tokens — proof of useful work"
        badge={isMining ? 'Mining' : 'Idle'}
        badgeColor={isMining ? '#22c55e' : '#71717a'}
      />

      <motion.div variants={stagger} initial="hidden" animate="show">

        {/* ============ Mining Dashboard ============ */}
        <motion.div variants={fadeUp} className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <GlassCard className="p-4">
            <div className="text-[10px] text-void-500 font-mono uppercase tracking-wider mb-1">Hash Rate</div>
            <div className="text-2xl font-bold font-mono text-white">
              {isMining ? '14.2' : '0'} <span className="text-sm text-void-400">KH/s</span>
            </div>
            <div className="mt-2">
              <Sparkline data={hashRateData} width={80} height={20} color={isMining ? EMERALD : '#52525b'} />
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="text-[10px] text-void-500 font-mono uppercase tracking-wider mb-1">JUL Mined Today</div>
            <div className="text-2xl font-bold font-mono text-amber-400">
              {minedToday.toFixed(2)}
            </div>
            <div className="mt-2">
              <Sparkline data={generateSparklineData(8811)} width={80} height={20} color={AMBER} />
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="text-[10px] text-void-500 font-mono uppercase tracking-wider mb-1">Total Mined</div>
            <motion.div
              key={Math.floor(displayMined)}
              className="text-2xl font-bold font-mono text-white"
            >
              {fmt(totalMined)}
            </motion.div>
            <div className="mt-2">
              <Sparkline data={generateSparklineData(4477)} width={80} height={20} color="#22c55e" />
            </div>
          </GlassCard>

          <GlassCard className="p-4">
            <div className="text-[10px] text-void-500 font-mono uppercase tracking-wider mb-1">Next Reward</div>
            <div className="text-2xl font-bold font-mono text-white">
              {formatTime(nextReward)}
            </div>
            <div className="w-full h-1.5 bg-void-800 rounded-full mt-3 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                animate={{ width: `${Math.max(0, 100 - (nextReward / 60) * 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Mining Visualization + Start/Stop ============ */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2">
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-void-300">Mining Visualization</h2>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isMining ? 'bg-green-400 animate-pulse' : 'bg-void-600'}`} />
                  <span className="text-xs font-mono text-void-400">{isMining ? 'ACTIVE' : 'STOPPED'}</span>
                </div>
              </div>
              <MiningVisualization isMining={isMining} blockCount={blockCount} difficulty={12} />
            </GlassCard>
          </div>

          <div className="flex flex-col gap-4">
            {/* Start/Stop Button */}
            <GlassCard className="p-5 flex flex-col items-center justify-center text-center flex-1">
              <div className="text-xs font-mono text-void-500 uppercase tracking-wider mb-3">Mining Control</div>
              <motion.button
                onClick={toggleMining}
                className={`relative w-28 h-28 rounded-full border-2 flex items-center justify-center transition-colors ${
                  isMining
                    ? 'border-red-500/60 bg-red-500/10 hover:bg-red-500/20'
                    : 'border-green-500/60 bg-green-500/10 hover:bg-green-500/20'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                {isMining ? (
                  <svg className="w-10 h-10 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                    <polygon points="8,5 19,12 8,19" />
                  </svg>
                )}
                {isMining && (
                  <motion.div
                    className="absolute inset-0 rounded-full border-2 border-red-400/30"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: PHI, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </motion.button>
              <div className="text-sm font-bold mt-3 text-white">
                {isMining ? 'Stop Mining' : 'Start Mining'}
              </div>
              <div className="text-[10px] text-void-500 mt-1">
                Tier: <span style={{ color: currentTier.color }}>{currentTier.icon} {currentTier.label}</span>
              </div>
            </GlassCard>
          </div>
        </motion.div>

        {/* ============ Mining Tiers ============ */}
        <motion.div variants={fadeUp} className="mb-6">
          <h2 className="text-sm font-semibold text-void-300 mb-3 px-1">Mining Tiers</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {MINING_TIERS.map((tier) => {
              const isActive = currentTier.id === tier.id
              return (
                <GlassCard
                  key={tier.id}
                  className={`p-4 relative overflow-hidden ${isActive ? 'ring-1' : ''}`}
                  style={isActive ? { '--tw-ring-color': tier.color + '40' } : {}}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${tier.gradient} pointer-events-none`} />
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl" style={{ color: tier.color }}>{tier.icon}</span>
                        <span className="font-bold text-sm" style={{ color: tier.color }}>{tier.label}</span>
                      </div>
                      <span className="font-mono text-xs text-void-400 bg-void-900/50 px-2 py-0.5 rounded">
                        {tier.multiplier}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-void-500 mb-1">{tier.requirement}</div>
                    <p className="text-xs text-void-400 leading-relaxed">{tier.desc}</p>
                    {isActive && (
                      <div className="mt-2 text-[10px] font-mono uppercase tracking-wider"
                        style={{ color: tier.color }}>
                        Current Tier
                      </div>
                    )}
                  </div>
                </GlassCard>
              )
            })}
          </div>
        </motion.div>

        {/* ============ Active Workers ============ */}
        <motion.div variants={fadeUp} className="mb-6">
          <GlassCard className="p-5">
            <h2 className="text-sm font-semibold text-void-300 mb-3">Active Workers</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-void-500 text-xs font-mono border-b border-void-800/50">
                    <th className="text-left pb-2 pr-4">Worker</th>
                    <th className="text-left pb-2 pr-4">Status</th>
                    <th className="text-right pb-2 pr-4">Hash Rate</th>
                    <th className="text-right pb-2 pr-4">Uptime</th>
                    <th className="text-right pb-2">Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {activeWorkers.map((w) => (
                    <tr key={w.id} className="border-b border-void-800/30 last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-void-300">{w.name}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            w.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-void-600'
                          }`} />
                          <span className={`text-xs font-mono ${
                            w.status === 'active' ? 'text-green-400' : 'text-void-500'
                          }`}>
                            {w.status}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-void-300">
                        {w.hashRate > 0 ? `${(w.hashRate / 1000).toFixed(1)} KH/s` : '--'}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-void-400">{w.uptime}</td>
                      <td className="py-2.5 text-right font-mono text-amber-400">
                        {w.earnings > 0 ? `${w.earnings.toFixed(2)} JUL` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Leaderboard ============ */}
        <motion.div variants={fadeUp} className="mb-6">
          <GlassCard className="p-5">
            <h2 className="text-sm font-semibold text-void-300 mb-3">Leaderboard — Top 10 Miners</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-void-500 text-xs font-mono border-b border-void-800/50">
                    <th className="text-left pb-2 pr-4 w-12">Rank</th>
                    <th className="text-left pb-2 pr-4">Address</th>
                    <th className="text-right pb-2 pr-4">Total Mined</th>
                    <th className="text-right pb-2">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((m) => (
                    <tr key={m.rank} className="border-b border-void-800/30 last:border-0">
                      <td className="py-2 pr-4">
                        <span className={`font-mono font-bold ${
                          m.rank === 1 ? 'text-amber-400' :
                          m.rank === 2 ? 'text-gray-300' :
                          m.rank === 3 ? 'text-orange-400' :
                          'text-void-500'
                        }`}>
                          {m.rank <= 3 ? ['', '\u{1F947}', '\u{1F948}', '\u{1F949}'][m.rank] : `#${m.rank}`}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-void-300">{m.address}</td>
                      <td className="py-2 pr-4 text-right font-mono text-amber-400">
                        {m.totalMined.toLocaleString()} JUL
                      </td>
                      <td className="py-2 text-right font-mono text-void-400">
                        {m.streak > 0 ? `${m.streak}d` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Emission Schedule ============ */}
        <motion.div variants={fadeUp} className="mb-6">
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-void-300">Emission Schedule</h2>
              <span className="text-[10px] font-mono text-void-500">
                Moore's Law decay ~2.3yr halving
              </span>
            </div>
            <EmissionChart data={emissionData} />
            <div className="flex items-center gap-4 mt-3 text-xs text-void-500 font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: AMBER }} />
                <span>Remaining supply</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-0.5 h-3 rounded-full" style={{ backgroundColor: AMBER, opacity: 0.4 }} />
                <span>Halving epoch</span>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Network Stats (StatCards with Sparklines) ============ */}
        <motion.div variants={fadeUp}>
          <h2 className="text-sm font-semibold text-void-300 mb-3 px-1">Network Stats</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Network Hash Rate"
              value={14.2}
              suffix=" KH/s"
              decimals={1}
              change={8.4}
              sparkData={hashRateData}
              size="sm"
            />
            <StatCard
              label="Difficulty"
              value={12}
              suffix=" bits"
              decimals={0}
              change={0}
              sparkData={difficultyData}
              size="sm"
            />
            <StatCard
              label="Avg Block Time"
              value={42}
              suffix="s"
              decimals={0}
              change={-5.2}
              sparkData={blockTimeData}
              size="sm"
            />
            <StatCard
              label="Active Miners"
              value={24}
              decimals={0}
              change={12.5}
              sparkData={minerCountData}
              size="sm"
            />
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}

export default MinePage
